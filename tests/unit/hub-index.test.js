// @vitest-environment node
// 索引 (ADR-099 / イシュー#220): ハブ公開の記事だけを D1 sites に載せ、公開の取り消し・退会で消す。
//  - POST /publish に index を同送 → 記事単位で upsert。files に無い publicId は載せない。deleteMissing で無い行を削除。
//  - 退会 (DELETE /account) は D1 の sites/reports/stars/comments/stats も消す (旧穴④)。
//  - POST /community/sites (任意 URL の登録口) は 410 で閉じる。GET /community/sites は status='active' だけ返す。
// 経路を通す形: default export の fetch (ルーティング・cors・エラー正規化込み) を叩く。D1 は実 SQLite (node:sqlite)。
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
    const sizeOf = (v) => (typeof v === 'string' ? new TextEncoder().encode(v).length : v.byteLength || 0);
    return {
        store,
        async get(k) { const v = store.get(k); return v == null ? null : { body: v, size: sizeOf(v) }; },
        async head(k) { const v = store.get(k); return v == null ? null : { size: sizeOf(v) }; },
        async put(k, body) { store.set(k, body); return { httpEtag: '"e"' }; },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) { return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key, size: sizeOf(store.get(key)) })), truncated: false }; }
    };
}

const A = 'AbCdEfGhIj', B = 'KlMnOpQrSt', C = 'UvWxYzAbCd';
let env, DB;

beforeEach(() => {
    DB = makeSqliteD1();
    env = {
        DB, BUCKET: makeR2(), HUB_DOMAIN: 'hub.example', QUOTA_BYTES: '104857600', ADMIN_EMAILS: 'admin@example.com',
        KV: makeKV({
            'key:hk_aaaaaa': { uid: 'ualice', siteId: 'sa' }, 'uid:ualice': { email: 'alice@example.com', siteId: 'sa', username: 'alice' }, 'usage:ualice': '0',
            'key:hk_bbbbbb': { uid: 'ubob', siteId: 'sb' }, 'uid:ubob': { email: 'bob@example.com', siteId: 'sb', username: 'bob' }, 'usage:ubob': '0'
        })
    };
});

const call = (path, method, body, key) => worker.fetch(new Request('https://hub.example' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body != null ? JSON.stringify(body) : undefined
}), env, { waitUntil() {} });
const html = (pid) => ({ path: `${pid}/index.html`, content: `<html>${pid}</html>` });
const meta = (pid, o = {}) => ({ publicId: pid, title: `記事${pid}`, description: 'd', tags: ['SF', '技術書'], coverUrl: `https://bookshelf.asayake.org/alice/${pid}/og.png?v=1`, publishedAt: 1000, modifiedAt: 2000, ...o });
const publish = (files, index, o = {}, key = 'hk_aaaaaa') => call('/publish', 'POST', { files, deleteMissing: true, ...(index ? { index } : {}), ...o }, key);
const rows = (uid = 'ualice') => DB.rows('SELECT * FROM sites WHERE uid = ? ORDER BY public_id', uid);

describe('POST /publish → 索引に載る', () => {
    it('公開すると記事ごとに 1 行 (source=hub・status=active・URL=bookshelf.asayake.org/<username>/<publicId>/) が出来る', async () => {
        const res = await publish([{ path: 'index.html', content: 'top' }, html(A), html(B)], [meta(A), meta(B)]);
        expect(res.status).toBe(200);
        expect((await res.json()).indexed).toBe(true);
        const r = rows();
        expect(r.map(x => x.public_id)).toEqual([A, B]);
        expect(r[0]).toMatchObject({ uid: 'ualice', url: `https://bookshelf.asayake.org/alice/${A}/`, title: `記事${A}`, tags: 'SF,技術書', source: 'hub', status: 'active', hidden: 0, report_count: 0, published_at: 1000, modified_at: 2000 });
        expect(r[0].cover_url).toBe(`https://bookshelf.asayake.org/alice/${A}/og.png?v=1`);
    });

    it('再公開は同じ行を更新する (重複しない・id と published_at は不変・タイトルとタグは更新)', async () => {
        await publish([html(A)], [meta(A)]);
        const first = rows()[0];
        await publish([html(A)], [meta(A, { title: '改題', tags: ['新'], publishedAt: 9999, modifiedAt: 3000 })]);
        const r = rows();
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ id: first.id, title: '改題', tags: '新', published_at: 1000, modified_at: 3000 });
    });

    it('files に置いていない publicId の index 要素は載せない (他人の URL・未公開記事は索引に入らない)', async () => {
        await publish([html(A)], [meta(A), meta(C)]);
        expect(rows().map(x => x.public_id)).toEqual([A]);
    });

    it('自分の公開先の外にある表紙 URL は落とす', async () => {
        await publish([html(A)], [meta(A, { coverUrl: 'https://evil.example/x.png' })]);
        expect(rows()[0].cover_url).toBe('');
    });

    it('通報で隠した記事は、再公開しても status が戻らない (upsert は status を触らない)', async () => {
        await publish([html(A)], [meta(A)]);
        DB._db.exec(`UPDATE sites SET status='hidden', hidden=1, report_count=2`);
        await publish([html(A)], [meta(A, { title: '再公開' })]);
        expect(rows()[0]).toMatchObject({ title: '再公開', status: 'hidden', hidden: 1, report_count: 2 });
    });

    it('別ユーザの行は触らない (uid 単位)', async () => {
        await publish([html(A)], [meta(A)]);
        await publish([html(B)], [meta(B, { coverUrl: '' })], {}, 'hk_bbbbbb');
        expect(rows('ualice').map(x => x.public_id)).toEqual([A]);
        expect(rows('ubob').map(x => x.public_id)).toEqual([B]);
    });
});

describe('公開の取り消し・削除 → 索引から消える (deleteMissing と同じ集合)', () => {
    it('記事を外して再公開すると、その行と紐づく通報・スター・コメント・集計が消え、残した記事は残る', async () => {
        await publish([html(A), html(B)], [meta(A), meta(B)]);
        const idB = rows().find(x => x.public_id === B).id;
        DB._db.exec(`INSERT INTO reports (id,target_type,target_id,uid,created_at) VALUES ('r1','site','${idB}','ubob',1)`);
        DB._db.exec(`INSERT INTO stars (target_type,target_id,uid,created_at) VALUES ('site','${idB}','ubob',1)`);
        DB._db.exec(`INSERT INTO comments (id,target_type,target_id,uid,author_name,body,created_at) VALUES ('c1','site','${idB}','ubob','bob','hi',1)`);
        DB._db.exec(`INSERT INTO stats (target_type,target_id,star_count) VALUES ('site','${idB}',1)`);
        const res = await publish([html(A)], [meta(A)]);   // B を外した (公開の取り消し)
        expect((await res.json()).indexed).toBe(true);
        expect(rows().map(x => x.public_id)).toEqual([A]);
        for (const t of ['reports', 'stars', 'comments', 'stats']) expect(DB.rows(`SELECT * FROM ${t} WHERE target_id = ?`, idB), t).toHaveLength(0);
        expect(env.BUCKET.store.has(`sites/sa/${B}/index.html`)).toBe(false);   // R2 からも消えている
    });

    it('index を送らない旧アプリでも、削除は files の集合で同期する (既存行のメタは保持)', async () => {
        await publish([html(A), html(B)], [meta(A), meta(B)]);
        await publish([html(A)], null);   // index 無し
        expect(rows().map(x => x.public_id)).toEqual([A]);
        expect(rows()[0].title).toBe(`記事${A}`);
    });

    it('全記事を取り消す (files に記事なし) と、その uid の行は全て消える', async () => {
        await publish([html(A), html(B)], [meta(A), meta(B)]);
        await publish([{ path: 'index.html', content: 'top' }], []);
        expect(rows()).toHaveLength(0);
    });

    it('deleteMissing=false のときは行を消さない', async () => {
        await publish([html(A), html(B)], [meta(A), meta(B)]);
        await publish([html(A)], [meta(A)], { deleteMissing: false });
        expect(rows().map(x => x.public_id)).toEqual([A, B]);
    });
});

describe('索引の失敗・未設定は公開を壊さない', () => {
    it('D1 未設定の環境でも公開は成功し、indexed=false / indexSkipped=no-d1', async () => {
        delete env.DB;
        const res = await publish([html(A)], [meta(A)]);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, indexed: false, indexSkipped: 'no-d1' });
        expect(env.BUCKET.store.has(`sites/sa/${A}/index.html`)).toBe(true);
    });

    it('D1 が失敗しても R2 は反映済みで公開は成功する', async () => {
        env.DB = { prepare() { throw new Error('D1 down'); } };
        const res = await publish([html(A)], [meta(A)]);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, indexed: false, indexSkipped: 'error' });
        expect(env.BUCKET.store.has(`sites/sa/${A}/index.html`)).toBe(true);
    });
});

describe('username 改名で索引の URL が追随する', () => {
    it('POST /username で名前を変えると sites.url が新しい名前になる', async () => {
        env.KV.store.set('uname:alice', JSON.stringify({ uid: 'ualice', siteId: 'sa' }));
        await publish([html(A)], [meta(A)]);
        const res = await call('/username', 'POST', { username: 'alice2' }, 'hk_aaaaaa');
        expect(res.status).toBe(200);
        expect(rows()[0].url).toBe(`https://bookshelf.asayake.org/alice2/${A}/`);
    });
});

describe('退会 (DELETE /account) → D1 の社会データも消える', () => {
    it('sites・記事への通報/スター/コメント/集計・本人の通報/スター/コメントが消え、他人の行は残り、他人の対象の集計は減算される', async () => {
        await publish([html(A)], [meta(A)]);
        await publish([html(B)], [meta(B, { coverUrl: '' })], {}, 'hk_bbbbbb');
        const idA = rows('ualice')[0].id, idB = rows('ubob')[0].id;
        DB._db.exec(`
          INSERT INTO reports (id,target_type,target_id,uid,created_at) VALUES ('r_on_a','site','${idA}','ubob',1), ('r_by_a','site','${idB}','ualice',2), ('r_other','site','${idA}','ucarol',3);
          INSERT INTO stars (target_type,target_id,uid,created_at) VALUES ('site','${idA}','ubob',1), ('site','${idB}','ualice',2), ('plugin','p1','ualice',3), ('plugin','p1','ubob',4);
          INSERT INTO comments (id,target_type,target_id,uid,author_name,body,created_at) VALUES ('c_on_a','site','${idA}','ubob','bob','x',1), ('c_by_a','site','${idB}','ualice','alice','y',2), ('c_by_a2','site','${idB}','ualice','alice','z',3);
          INSERT INTO stats (target_type,target_id,star_count,comment_count) VALUES ('site','${idA}',1,1), ('site','${idB}',1,2), ('plugin','p1',2,0);`);
        const res = await call('/account', 'DELETE', null, 'hk_aaaaaa');
        expect(res.status).toBe(200);
        expect(rows('ualice')).toHaveLength(0);
        expect(rows('ubob')).toHaveLength(1);   // 他人の行は残る
        expect(DB.rows(`SELECT id FROM reports ORDER BY id`).map(r => r.id)).toEqual([]);   // 記事宛 (r_on_a・r_other) と本人の通報 (r_by_a) はいずれも消える
        expect(DB.rows(`SELECT target_id, uid FROM stars ORDER BY uid`)).toEqual([{ target_id: 'p1', uid: 'ubob' }]);
        expect(DB.rows(`SELECT id FROM comments`)).toEqual([]);
        // 集計: 自分の記事の行は消え、他人の対象への分だけ減算 (B は star 1→0・comment 2→0、p1 は star 2→1)
        expect(DB.rows(`SELECT target_type, target_id, star_count, comment_count FROM stats ORDER BY target_id`)).toEqual([
            { target_type: 'site', target_id: idB, star_count: 0, comment_count: 0 },
            { target_type: 'plugin', target_id: 'p1', star_count: 1, comment_count: 0 }
        ].sort((x, y) => (x.target_id < y.target_id ? -1 : 1)));
    });

    it('D1 未設定の環境でも退会は成功する (KV/R2 の掃除だけ)', async () => {
        delete env.DB;
        await publish([html(A)], [meta(A)]);
        const res = await call('/account', 'DELETE', null, 'hk_aaaaaa');
        expect(res.status).toBe(200);
        expect(env.BUCKET.store.has(`sites/sa/${A}/index.html`)).toBe(false);
    });
});

describe('自前 URL の登録口を閉じる / 一覧は active のみ', () => {
    it('POST /community/sites は 410 (認証済みでも任意 URL を索引に載せられない)・行は増えない', async () => {
        const res = await call('/community/sites', 'POST', { url: 'https://someone.github.io/bookshelf/', title: '自前公開' }, 'hk_aaaaaa');
        expect(res.status).toBe(410);
        expect(DB.rows('SELECT * FROM sites')).toHaveLength(0);
    });

    it('GET /community/sites は status=active の記事だけを返し、uid・status 列は晒さない', async () => {
        await publish([html(A), html(B)], [meta(A), meta(B)]);
        DB._db.exec(`UPDATE sites SET status='hidden', hidden=1 WHERE public_id='${B}'`);
        const res = await call('/community/sites', 'GET');
        const { sites } = await res.json();
        expect(sites.map(s => s.url)).toEqual([`https://bookshelf.asayake.org/alice/${A}/`]);
        expect(sites[0].uid).toBeUndefined();
        expect(sites[0].tags).toEqual(['SF', '技術書']);
    });

    it('status=quarantined (将来の自動仮非表示 B 用の値) も一覧に出ない', async () => {
        await publish([html(A)], [meta(A)]);
        DB._db.exec(`UPDATE sites SET status='quarantined'`);
        expect((await (await call('/community/sites', 'GET')).json()).sites).toEqual([]);
    });
});
