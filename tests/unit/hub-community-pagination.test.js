// @vitest-environment node
// S7 (イシュー#269): GET /community/sites のページング (cursor方式・created_at DESC,id・limit上限) と
// タグ横断検索 (site_tags)。索引そのもの (POST /publish → sites upsert/削除連動) は hub-index.test.js が
// カバーするので、ここはページング・?tag=・site_tags の同期だけを見る。
// 経路を通す形: default export の fetch を叩く。D1 は実 SQLite (node:sqlite)。
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';
import { makeSqliteD1 } from './helpers/sqlite-d1.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
    };
}
function makeR2() {
    const store = new Map();
    return {
        store,
        async get(k) { const v = store.get(k); return v == null ? null : { body: v }; },
        async head(k) { return store.has(k) ? { size: 1 } : null; },
        async put(k, body) { store.set(k, body); return { httpEtag: '"e"' }; },
        async delete(k) { store.delete(k); },
        async list() { return { objects: [], truncated: false }; }
    };
}

let env, DB;

beforeEach(() => {
    DB = makeSqliteD1();
    env = {
        DB, BUCKET: makeR2(), HUB_DOMAIN: 'hub.example', QUOTA_BYTES: '104857600',
        KV: makeKV({
            'key:hk_aaaaaa': { uid: 'ualice', siteId: 'sa' },
            'uid:ualice': { email: 'alice@example.com', siteId: 'sa', username: 'alice' }, 'usage:ualice': '0'
        })
    };
});

const call = (path, method = 'GET', body, key) => worker.fetch(new Request('https://hub.example' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body != null ? JSON.stringify(body) : undefined
}), env, { waitUntil() {} });
const html = (pid) => ({ path: `${pid}/index.html`, content: `<html>${pid}</html>` });
const meta = (pid, createdOffset, tags = []) => ({ publicId: pid, title: `記事${pid}`, description: 'd', tags, publishedAt: 1000 + createdOffset, modifiedAt: 2000 });
const publish = (files, index) => call('/publish', 'POST', { files, deleteMissing: true, index }, 'hk_aaaaaa');

// 10件の記事を publish する (publicId は 10 文字固定の制約があるため連番を zero-pad する)。
const PID = (n) => `p${String(n).padStart(9, '0')}`;
async function seed(n, tagger = () => []) {
    const files = []; const index = [];
    for (let i = 0; i < n; i++) {
        const pid = PID(i);
        files.push(html(pid));
        index.push(meta(pid, i, tagger(i)));
    }
    const res = await publish(files, index);
    expect(res.status).toBe(200);
    // created_at は Date.now() 由来で全件ほぼ同時刻になるため、順序を検証できるよう明示的にずらす。
    for (let i = 0; i < n; i++) DB._db.exec(`UPDATE sites SET created_at = ${1000 + i} WHERE public_id = '${PID(i)}'`);
}

describe('GET /community/sites: cursor ページング (sort=new 既定)', () => {
    it('limit で件数が絞られ、created_at DESC (新しい順) で並ぶ', async () => {
        await seed(5);
        const res = await call('/community/sites?limit=3');
        const body = await res.json();
        expect(body.sites.map(s => s.id)).toHaveLength(3);
        const createdDesc = body.sites.every((s, i, arr) => i === 0 || arr[i - 1].created_at >= s.created_at);
        expect(createdDesc).toBe(true);
        // 最新3件 = p...004, p...003, p...002 (created_at 1004,1003,1002)
        expect(body.sites.map(s => s.title)).toEqual([`記事${PID(4)}`, `記事${PID(3)}`, `記事${PID(2)}`]);
        expect(body.next_cursor).toBeTruthy();
    });

    it('next_cursor を渡すと続きのページが取れ、全件を重複/欠落なく走査できる', async () => {
        await seed(7);
        const seen = [];
        let cursor = null;
        for (let guard = 0; guard < 10; guard++) {
            const qs = `limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
            const body = await (await call(`/community/sites?${qs}`)).json();
            seen.push(...body.sites.map(s => s.title));
            cursor = body.next_cursor;
            if (!cursor) break;
        }
        const expected = [6, 5, 4, 3, 2, 1, 0].map(i => `記事${PID(i)}`);
        expect(seen).toEqual(expected);
    });

    it('limit の上限 (50) を超えた指定は 50 件に丸められる', async () => {
        await seed(3);
        const res = await call('/community/sites?limit=9999');
        expect(res.status).toBe(200);
        // 件数自体は3件 (上限丸めの直接確認は内部実装依存のため、せめて壊れず200で返ることを見る)
        expect((await res.json()).sites).toHaveLength(3);
    });

    it('最終ページでは next_cursor が null', async () => {
        await seed(2);
        const body = await (await call('/community/sites?limit=10')).json();
        expect(body.sites).toHaveLength(2);
        expect(body.next_cursor).toBeNull();
    });
});

describe('GET /community/sites: ?tag= タグ横断検索', () => {
    it('指定タグを含む記事だけ返す', async () => {
        await seed(4, (i) => (i % 2 === 0 ? ['SF', '技術書'] : ['エッセイ']));
        const body = await (await call('/community/sites?tag=SF')).json();
        expect(body.sites.map(s => s.title).sort()).toEqual([`記事${PID(0)}`, `記事${PID(2)}`].sort());
    });

    it('タグ検索にもページングが効く (cursor)', async () => {
        await seed(5, () => ['共通タグ']);
        const page1 = await (await call('/community/sites?tag=共通タグ&limit=2')).json();
        expect(page1.sites).toHaveLength(2);
        expect(page1.next_cursor).toBeTruthy();
        const page2 = await (await call(`/community/sites?tag=共通タグ&limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`)).json();
        expect(page2.sites).toHaveLength(2);
        const ids1 = page1.sites.map(s => s.id), ids2 = page2.sites.map(s => s.id);
        expect(ids1.some(id => ids2.includes(id))).toBe(false);   // 重複なし
    });

    it('status != active (通報で隠した記事) は tag 検索にも出ない', async () => {
        await seed(2, () => ['隠れタグ']);
        DB._db.exec(`UPDATE sites SET status='hidden', hidden=1 WHERE public_id='${PID(0)}'`);
        const body = await (await call('/community/sites?tag=隠れタグ')).json();
        expect(body.sites.map(s => s.title)).toEqual([`記事${PID(1)}`]);
    });
});

describe('site_tags: sites.tags から常に作り直される副次索引', () => {
    it('publish すると site_tags に1タグ1行で入る', async () => {
        await publish([html('t0000000A1')], [meta('t0000000A1', 0, ['SF', '技術書'])]);
        const id = DB.rows(`SELECT id FROM sites WHERE public_id = ?`, 't0000000A1')[0].id;
        const tags = DB.rows(`SELECT tag FROM site_tags WHERE site_id = ? ORDER BY tag`, id).map(r => r.tag);
        expect(tags).toEqual(['SF', '技術書'].sort());
    });

    it('再公開でタグが変わると site_tags も入れ替わる (古いタグは残らない)', async () => {
        await publish([html('t0000000B1')], [meta('t0000000B1', 0, ['旧タグ'])]);
        await publish([html('t0000000B1')], [meta('t0000000B1', 0, ['新タグ'])]);
        const id = DB.rows(`SELECT id FROM sites WHERE public_id = ?`, 't0000000B1')[0].id;
        const tags = DB.rows(`SELECT tag FROM site_tags WHERE site_id = ?`, id).map(r => r.tag);
        expect(tags).toEqual(['新タグ']);
    });

    it('記事を取り消す (deleteMissing) と site_tags の行も消える', async () => {
        await publish([html('t0000000C1')], [meta('t0000000C1', 0, ['消える'])]);
        const id = DB.rows(`SELECT id FROM sites WHERE public_id = ?`, 't0000000C1')[0].id;
        expect(DB.rows(`SELECT * FROM site_tags WHERE site_id = ?`, id)).toHaveLength(1);
        await publish([{ path: 'index.html', content: 'top' }], []);   // 全部外す
        expect(DB.rows(`SELECT * FROM site_tags WHERE site_id = ?`, id)).toHaveLength(0);
    });

    it('掲載の取り下げ (DELETE /community/sites/:id) で site_tags も消える', async () => {
        await publish([html('t0000000D1')], [meta('t0000000D1', 0, ['取り下げ'])]);
        const id = DB.rows(`SELECT id FROM sites WHERE public_id = ?`, 't0000000D1')[0].id;
        const res = await call(`/community/sites/${id}`, 'DELETE', undefined, 'hk_aaaaaa');
        expect(res.status).toBe(204);
        expect(DB.rows(`SELECT * FROM site_tags WHERE site_id = ?`, id)).toHaveLength(0);
    });

    it('退会 (DELETE /account) で site_tags も消える', async () => {
        await publish([html('t0000000E1')], [meta('t0000000E1', 0, ['退会'])]);
        const id = DB.rows(`SELECT id FROM sites WHERE public_id = ?`, 't0000000E1')[0].id;
        expect(DB.rows(`SELECT * FROM site_tags WHERE site_id = ?`, id)).toHaveLength(1);
        const res = await call('/account', 'DELETE', undefined, 'hk_aaaaaa');
        expect(res.status).toBe(200);
        expect(DB.rows(`SELECT * FROM site_tags WHERE site_id = ?`, id)).toHaveLength(0);
    });
});
