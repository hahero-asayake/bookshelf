// @vitest-environment node
// ハブの日次バックアップ (イシュー#235・cf-worker/backup.js)。
// 経路を通す形: default export の scheduled (Cron Trigger の入口) から実行し、KV・R2・D1 (実 SQLite) は本物に近い fake で読む。
//  - 1 世代の中身 (d1.sql・kv.json・r2 コピー・secrets.json・manifest・LATEST) と、本番側 (BUCKET・KV・DB) を書き換えないこと
//  - d1.sql が空の SQLite へ復元して元の行と一致すること
//  - 保持 (日次 7＋日曜 4)・成功した後にだけ間引く・失敗/縮小/予算超過では消さない・通知に個人情報を入れない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import worker from '../../cf-worker/asayake-hub.js';
import { scheduledBackup, selectKeep, genId, buildD1Sql, BACKUP_CRON } from '../../cf-worker/backup.js';
import { makeSqliteD1 } from './helpers/sqlite-d1.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const md5 = (u8) => createHash('md5').update(u8).digest('hex');

function makeR2({ pageSize = 1000 } = {}) {
    const store = new Map();
    const obj = (key, o) => ({ key, size: o.body.length, etag: md5(o.body), httpMetadata: o.httpMetadata || {}, customMetadata: o.customMetadata || {} });
    return {
        store,
        async put(key, value, opts = {}) {
            const body = typeof value === 'string' ? enc(value) : new Uint8Array(await new Response(value).arrayBuffer());
            const o = { body, httpMetadata: opts.httpMetadata, customMetadata: opts.customMetadata };
            store.set(key, o);
            return obj(key, o);
        },
        async get(key) {
            const o = store.get(key); if (!o) return null;
            return { ...obj(key, o), body: new Response(o.body).body, text: async () => dec(o.body), arrayBuffer: async () => o.body.buffer };
        },
        async head(key) { const o = store.get(key); return o ? obj(key, o) : null; },
        async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
        async list({ prefix = '', cursor, limit = 1000, delimiter } = {}) {
            const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
            const prefixes = new Set(); const keys = [];
            for (const k of all) {
                const rest = k.slice(prefix.length);
                if (delimiter && rest.includes(delimiter)) prefixes.add(prefix + rest.slice(0, rest.indexOf(delimiter) + 1)); else keys.push(k);
            }
            const start = cursor ? Number(cursor) : 0, n = Math.min(limit, pageSize);
            const page = keys.slice(start, start + n);
            const truncated = start + n < keys.length;
            return { objects: page.map(k => obj(k, store.get(k))), truncated, cursor: truncated ? String(start + n) : undefined, delimitedPrefixes: [...prefixes] };
        }
    };
}

function makeKV(initial = {}, { pageSize = 1000 } = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'object' && v && 'value' in v ? { ...v } : { value: typeof v === 'string' ? v : JSON.stringify(v) }]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'arrayBuffer' ? enc(v.value).buffer : v.value; },
        async put() { throw new Error('本番 KV への書き込み'); },
        async delete() { throw new Error('本番 KV への削除'); },
        async list({ cursor, limit = 1000 } = {}) {
            const keys = [...store.keys()].sort(); const start = cursor ? Number(cursor) : 0, n = Math.min(limit, pageSize);
            const page = keys.slice(start, start + n);
            return { keys: page.map(name => ({ name, ...(store.get(name).expiration ? { expiration: store.get(name).expiration } : {}), ...(store.get(name).metadata ? { metadata: store.get(name).metadata } : {}) })), list_complete: start + n >= keys.length, cursor: start + n < keys.length ? String(start + n) : undefined };
        }
    };
}

function makeD1() {
    const d1 = makeSqliteD1();
    d1._db.exec(`INSERT INTO sites (id, uid, url, title, created_at, updated_at, public_id) VALUES ('s1','ualice','https://bookshelf.asayake.org/alice/AbCdEfGhIj/','アリスの''記事"
二行目',1,2,'AbCdEfGhIj')`);
    d1._db.exec(`INSERT INTO reports (id, target_type, target_id, uid, category, reason, created_at) VALUES ('r1','site','s1','ubob','spam','広告',3)`);
    return { ...d1, batch: async (stmts) => Promise.all(stmts.map(s => s.all())) };   // 実 D1 の batch は各文の {results} を返す
}

const SALT = 'salt-value-for-test';
const HOOK = 'https://discord.example/api/webhooks/1/secret-token';
const NOW = new Date('2026-09-26T18:50:00Z');   // JST 2026-09-27 03:50 (日曜)
let env, hookCalls, realFetch;

function freshEnv(over = {}) {
    return {
        BUCKET: makeR2({ pageSize: 2 }), BACKUP: makeR2({ pageSize: 3 }), DB: makeD1(), TOMBSTONE_SALT: SALT, REPORT_WEBHOOK_URL: HOOK,
        KV: makeKV({
            'uid:ualice': { email: 'alice@example.com', siteId: 'sa' }, 'key:hk_aaaaaa': { uid: 'ualice', siteId: 'sa' }, 'plan:ualice': { plan: 'plus' },
            'rl:zzz': '1', 'kindle:relay:tmp': '1', 'report:sa': { status: 'suspended' },
            'uname:alice': { value: '{"uid":"ualice"}', expiration: 4102444800, metadata: { note: 'x' } }
        }, { pageSize: 2 }),
        ...over
    };
}
async function seedR2(bucket) {
    await bucket.put('data/ualice/library.json', '{"books":["日本語"]}', { httpMetadata: { contentType: 'application/json' }, customMetadata: { v: '1' } });
    await bucket.put('data/ualice/img.bin', new Uint8Array([0, 1, 2, 255, 254]), { httpMetadata: { contentType: 'application/octet-stream' } });
    await bucket.put('sites/sa/index.html', '<h1>hi</h1>', { httpMetadata: { contentType: 'text/html' } });
}
const snapshot = (r2) => JSON.stringify([...r2.store.entries()].map(([k, v]) => [k, [...v.body], v.httpMetadata, v.customMetadata]));
const controller = (cron) => ({ cron, scheduledTime: NOW.getTime(), type: 'scheduled' });
const gens = (r2) => [...new Set([...r2.store.keys()].filter(k => k.startsWith('gen/')).map(k => k.split('/')[1]))].sort();
const latest = (r2) => JSON.parse(dec(r2.store.get('LATEST.json').body));

beforeEach(async () => {
    env = freshEnv(); await seedR2(env.BUCKET);
    hookCalls = []; realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u, init) => { hookCalls.push({ url: String(u), body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); });
    vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); vi.useRealTimers(); });

describe('scheduled → 1 世代のバックアップ', () => {
    it('Cron の入口から 1 世代ができ、中身が元データと一致し、本番側は書き換わらない', async () => {
        const before = { r2: snapshot(env.BUCKET), kv: JSON.stringify([...env.KV.store]), db: JSON.stringify(env.DB.rows('select * from sites')) };
        await worker.scheduled(controller(BACKUP_CRON), env, { waitUntil() {} });
        const [gen] = gens(env.BACKUP);
        expect(gens(env.BACKUP)).toHaveLength(1);
        const base = `gen/${gen}/`;
        const man = JSON.parse(dec(env.BACKUP.store.get(`${base}manifest.json`).body));
        expect(man.r2.saved).toBe(3);
        expect(man.r2.listed).toBe(3);
        expect(man.kv).toMatchObject({ listed: 7, excluded: 2, saved: 5, vanished: 0 });
        expect(man.kv.byPrefix).toEqual({ 'uid:': 1, 'key:': 1, 'plan:': 1, 'uname:': 1, 'report:': 1 });
        expect(man.salt).toBe(true);
        // R2: 中身・contentType・customMetadata・etag が一致
        for (const [key, src] of env.BUCKET.store) {
            const cp = env.BACKUP.store.get(`${base}r2/${key}`);
            expect([...cp.body]).toEqual([...src.body]);
            expect(cp.httpMetadata).toEqual(src.httpMetadata);
            expect(cp.customMetadata || {}).toEqual(src.customMetadata || {});
        }
        expect(man.r2.objects.map(o => o.etag)).toEqual(man.r2.objects.map(o => md5(env.BUCKET.store.get(o.key).body)));
        // KV: 除外・expiration・metadata・値
        const kv = JSON.parse(dec(env.BACKUP.store.get(`${base}kv.json`).body));
        expect(kv.entries.map(e => e.key)).toEqual(['key:hk_aaaaaa', 'plan:ualice', 'report:sa', 'uid:ualice', 'uname:alice']);
        const un = kv.entries.find(e => e.key === 'uname:alice');
        expect(un.expiration).toBe(4102444800); expect(un.metadata).toEqual({ note: 'x' });
        expect(dec(Uint8Array.from(atob(kv.entries.find(e => e.key === 'uid:ualice').value), c => c.charCodeAt(0)))).toBe(JSON.stringify({ email: 'alice@example.com', siteId: 'sa' }));
        // salt (S1)
        expect(JSON.parse(dec(env.BACKUP.store.get(`${base}secrets.json`).body))).toEqual({ TOMBSTONE_SALT: SALT });
        expect(JSON.stringify(man)).not.toContain(SALT);
        // LATEST
        const l = latest(env.BACKUP);
        expect(l).toMatchObject({ ok: true, gen, lastSuccess: null });
        expect(JSON.stringify(l)).not.toContain(SALT);
        // 本番へは書いていない
        expect(snapshot(env.BUCKET)).toBe(before.r2);
        expect(JSON.stringify([...env.KV.store])).toBe(before.kv);
        expect(JSON.stringify(env.DB.rows('select * from sites'))).toBe(before.db);
        expect(hookCalls).toHaveLength(0);
    });

    it('d1.sql は空の SQLite へ復元でき、全テーブルの行が元と一致する (引用符・改行・日本語を含む)', async () => {
        await worker.scheduled(controller(BACKUP_CRON), env, { waitUntil() {} });
        const [gen] = gens(env.BACKUP);
        const sql = dec(env.BACKUP.store.get(`gen/${gen}/d1.sql`).body);
        const restored = makeSqliteD1({ schema: null });
        restored._db.exec(sql);
        for (const t of ['sites', 'reports', 'stars', 'comments', 'stats']) {
            expect(restored.rows(`select * from ${t} order by 1`), t).toEqual(env.DB.rows(`select * from ${t} order by 1`));
        }
        expect(restored.rows('select title from sites')[0].title).toBe('アリスの\'記事"\n二行目');
        // インデックスも復元される
        expect(restored.rows(`select count(*) c from sqlite_master where type='index' and name like 'idx_%'`)[0].c)
            .toBe(env.DB.rows(`select count(*) c from sqlite_master where type='index' and name like 'idx_%'`)[0].c);
    });

    it('BLOB は X\'..\' で、NULL・数値は素のまま書く', () => {
        const sql = buildD1Sql('g', [{ type: 'table', name: 't', sql: 'CREATE TABLE "t" (a, b, c)' }], [{ name: 't', rows: [{ a: [1, 255], b: null, c: 3.5 }] }]);
        const d = makeSqliteD1({ schema: null }); d._db.exec(sql);
        expect(d.rows('select hex(a) h, b, c from t')).toEqual([{ h: '01FF', b: null, c: 3.5 }]);
    });

    it('cron 式は問わず起動する (初回の手動実行で一時的な cron を足せる)・salt が無ければ secrets.json を作らない', async () => {
        delete env.TOMBSTONE_SALT;
        await worker.scheduled(controller('58 3 26 9 *'), env, { waitUntil() {} });
        const [gen] = gens(env.BACKUP);
        expect(env.BACKUP.store.has(`gen/${gen}/secrets.json`)).toBe(false);
        expect(JSON.parse(dec(env.BACKUP.store.get(`gen/${gen}/manifest.json`).body)).salt).toBe(false);
    });
});

describe('保持 (日次 7＋日曜 4・成功した後にだけ間引く)', () => {
    it('selectKeep: 日付ごとの最新 1 件を直近 7 日 + 日曜の最新を直近 4 週', () => {
        const ids = [];
        for (let d = 0; d < 40; d++) { const t = new Date(Date.UTC(2026, 8, 27) - d * 86400e3); ids.push(`${t.toISOString().slice(0, 10).replace(/-/g, '')}-030000`); }
        ids.push('20260927-100000');                            // 同じ日の 2 件目 (新しい方だけ残る)
        const keep = selectKeep(ids);
        expect(keep.has('20260927-100000')).toBe(true);
        expect(keep.has(ids[0])).toBe(false);                   // 同日の古い方は消える
        const dates = [...keep].map(i => i.slice(0, 8)).sort();
        expect(dates).toHaveLength(10);                         // 直近 7 日 (9/21〜9/27) + 日曜 4 (9/27・9/20・9/13・9/6)。9/27 は両方に数える
        expect(dates.filter(d => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6))).getUTCDay() === 0)).toHaveLength(4);
        expect(dates[0]).toBe('20260906');                      // 最長 28 日 (9/27 から 9/6 まで)
        expect(selectKeep(['garbage', '20260101-000000'])).toEqual(new Set(['20260101-000000']));
    });

    it('40 日ぶん毎日実行しても世代は最長約 28 日ぶんに収まり、消えた世代のオブジェクトは残らない', async () => {
        for (let d = 0; d < 40; d++) await scheduledBackup(env, new Date(NOW.getTime() + d * 86400e3));
        const ids = gens(env.BACKUP);
        expect(ids.length).toBeLessThanOrEqual(11);
        expect(ids.length).toBeGreaterThanOrEqual(10);
        expect(new Set(ids)).toEqual(selectKeep(ids));           // 残った世代はどれも保持対象 (孤立オブジェクトなし)
        expect([...env.BACKUP.store.keys()].every(k => k === 'LATEST.json' || ids.includes(k.split('/')[1]))).toBe(true);
        expect(ids.at(-1)).toBe(genId(new Date(NOW.getTime() + 39 * 86400e3)));
        expect(ids[0] >= '20260927').toBe(true);
    });

    it('manifest の無い古い世代 (中断の残り) は成功後に片付け、新しい途中の世代は残す', async () => {
        await env.BACKUP.put('gen/20260101-000000/d1.sql', 'x');
        await env.BACKUP.put('gen/20260927-030000/d1.sql', 'x');   // 実行の 50 分前＝実行中かもしれない
        await scheduledBackup(env, NOW);
        expect(gens(env.BACKUP)).toEqual([genId(NOW), '20260927-030000'].sort());
    });
});

describe('失敗・縮小・予算超過では消さない', () => {
    async function twoGood() {
        await scheduledBackup(env, new Date(NOW.getTime() - 86400e3));
        return gens(env.BACKUP);
    }
    it('R2 のコピーが失敗したら世代を消さず、LATEST に種別だけ書き、通知に個人情報・キー名・salt を入れない', async () => {
        const before = await twoGood();
        const real = env.BACKUP.put.bind(env.BACKUP);
        env.BACKUP.put = async (k, v, o) => { if (k.includes('/r2/data/ualice/library.json')) throw new Error('R2 internal error for data/ualice/library.json alice@example.com'); return real(k, v, o); };
        await expect(scheduledBackup(env, NOW)).rejects.toThrow('backup failed: unknown');
        expect(gens(env.BACKUP).filter(g => before.includes(g))).toEqual(before);
        const l = latest(env.BACKUP);
        expect(l).toMatchObject({ ok: false, error: 'unknown' });
        expect(l.lastSuccess.gen).toBe(before[0]);
        expect(hookCalls).toHaveLength(1);
        const text = hookCalls[0].body.content;
        expect(text).toContain('バックアップ失敗');
        for (const bad of ['alice', 'ualice', 'hk_', 'library.json', SALT, 'data/']) expect(text).not.toContain(bad);
        expect(JSON.stringify(l)).not.toContain('alice');
        expect(hookCalls[0].body.allowed_mentions).toEqual({ parse: [] });
    });

    it('コピーのサイズが合わなければ verify で失敗する', async () => {
        const real = env.BACKUP.put.bind(env.BACKUP);
        env.BACKUP.put = async (k, v, o) => { const r = await real(k, v, o); return k.includes('/r2/') ? { ...r, size: r.size + 1 } : r; };
        await expect(scheduledBackup(env, NOW)).rejects.toThrow('backup failed: verify');
        expect(env.BACKUP.store.has(`gen/${genId(NOW)}/manifest.json`)).toBe(false);   // manifest が無い＝不完全な世代
    });

    it('操作数の予定が上限を超えるなら、何も書かずに budget で中断する', async () => {
        env.BACKUP_OPS_LIMIT = '30';
        await expect(scheduledBackup(env, NOW)).rejects.toThrow('backup failed: budget');
        expect([...env.BACKUP.store.keys()]).toEqual(['LATEST.json']);
        expect(latest(env.BACKUP).error).toBe('budget');
    });

    it('件数が前回の半分未満に減ったら、世代は残し (間引かず) 警告だけ通知する', async () => {
        await scheduledBackup(env, new Date(NOW.getTime() - 40 * 86400e3));   // 古い世代 (通常なら間引かれる)
        const l0 = latest(env.BACKUP); l0.lastSuccess = { at: 'x', gen: 'g', counts: { total: 100 } }; l0.counts = { total: 100 };
        await env.BACKUP.put('LATEST.json', JSON.stringify(l0));
        await scheduledBackup(env, NOW);
        expect(gens(env.BACKUP)).toHaveLength(2);
        expect(latest(env.BACKUP).warn).toBe('shrink');
        expect(hookCalls).toHaveLength(1);
        expect(hookCalls[0].body.content).toContain('警告');
    });

    it('BACKUP binding が無ければ config で失敗する (通知は出る)', async () => {
        delete env.BACKUP;
        await expect(scheduledBackup(env, NOW)).rejects.toThrow('backup failed: config');
        expect(hookCalls).toHaveLength(1);
    });

    it('webhook が未設定・失敗でもバックアップ自体の結果は変わらない', async () => {
        delete env.REPORT_WEBHOOK_URL;
        await scheduledBackup(env, NOW);
        expect(latest(env.BACKUP).ok).toBe(true);
        globalThis.fetch = vi.fn(async () => { throw new Error('network'); });
        env.REPORT_WEBHOOK_URL = HOOK; env.BACKUP_OPS_LIMIT = '30';
        await expect(scheduledBackup(env, new Date(NOW.getTime() + 86400e3))).rejects.toThrow('backup failed: budget');
    });
});
