// @vitest-environment node
// 端末エラーの匿名受け口 (イシュー#584・cf-worker/client-errors.js)
//  - POST /client-error: 認証なし・本文は {v, screen, msg} だけ (text/plain でも受ける)。余分なキー・型違い・長すぎ・1KB 超・壊れた JSON は 400。
//  - (JST の日, 指紋) ごとに D1 で数え、10 件を超えた最初の 1 回だけ Discord webhook へ通知。IP・UA は保存しない。
//  - レート超過 429・CLIENT_ERRORS_OFF=1 は何もせず 204・日次の新規指紋 500 超は保存しない・30 日より古い行は scheduled が消す。
// 経路を通す形: default export の fetch / scheduled。D1 は実 SQLite (node:sqlite)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import worker from '../../cf-worker/asayake-hub.js';
import { pruneClientErrors } from '../../cf-worker/client-errors.js';
import { makeSqliteD1, readRepoFile } from './helpers/sqlite-d1.js';

const HOOK = 'https://discord.example/api/webhooks/1/secret-token';
const ORIGIN = 'https://app.example';
const IP = '203.0.113.7';
const UA = 'Mozilla/5.0 (TestUA)';
const ERR = { v: '2026.11.14', screen: 'home', msg: "TypeError: Cannot read properties of undefined (reading 'x')" };
let env, DB, pending, hookCalls, realFetch;

beforeEach(() => {
    DB = makeSqliteD1();
    env = { DB, APP_ORIGIN: ORIGIN, REPORT_WEBHOOK_URL: HOOK };
    pending = []; hookCalls = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u, init) => { hookCalls.push({ url: String(u), body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); vi.restoreAllMocks(); });

const post = async (body, { type = 'text/plain;charset=UTF-8', headers = {} } = {}) => {
    const res = await worker.fetch(new Request('https://hub.example/client-error', {
        method: 'POST',
        headers: { 'Content-Type': type, Origin: ORIGIN, 'CF-Connecting-IP': IP, 'User-Agent': UA, Cookie: 'sid=zzz', Authorization: 'Bearer hk_aaaaaa', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    }), env, { waitUntil(p) { pending.push(p); } });
    await Promise.all(pending);
    return res;
};
const rows = () => DB.rows('SELECT * FROM client_errors ORDER BY day, fp');
const fpOf = ({ v, screen, msg }) => createHash('sha256').update(`${v}|${screen}|${msg}`).digest('hex').slice(0, 16);
const at = (iso) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };

describe('POST /client-error (受理と保存)', () => {
    it('text/plain の本文を受理して 204 (本文なし)・CORS は APP_ORIGIN。day は JST・fp は sha256 先頭 16 桁', async () => {
        at('2026-11-14T16:00:00Z');   // JST 11-15 01:00
        const res = await post(ERR);
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
        expect(rows()).toEqual([{ day: '2026-11-15', fp: fpOf(ERR), ...ERR, count: 1, first_at: Date.now(), last_at: Date.now(), notified: 0 }]);
    });

    it('application/json でも受理し、同じ本文は同じ行で数える', async () => {
        expect((await post(ERR)).status).toBe(204);
        expect((await post(ERR, { type: 'application/json' })).status).toBe(204);
        expect(rows()).toHaveLength(1);
        expect(rows()[0].count).toBe(2);
    });

    it('OPTIONS (preflight) は 204 + CORS', async () => {
        const res = await worker.fetch(new Request('https://hub.example/client-error', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env, {});
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    });

    it('境界値 (v 32 字・screen 40 字・msg 200 字) は受理する', async () => {
        expect((await post({ v: 'x'.repeat(32), screen: 'a-_9'.repeat(10), msg: 'あ'.repeat(200) })).status).toBe(204);
        expect(rows()).toHaveLength(1);
    });

    it('保存される列に IP・User-Agent・Cookie・Bearer が無い (値としても残らない)', async () => {
        await post(ERR);
        const cols = DB.rows(`SELECT name FROM pragma_table_info('client_errors')`).map(r => r.name);
        expect(cols).toEqual(['day', 'fp', 'v', 'screen', 'msg', 'count', 'first_at', 'last_at', 'notified']);
        const dump = JSON.stringify(rows());
        for (const secret of [IP, UA, 'sid=zzz', 'hk_aaaaaa']) expect(dump).not.toContain(secret);
    });

    it('JST の日付が変わると別の行で数え直す', async () => {
        at('2026-11-14T14:59:59Z');   // JST 11-14 23:59:59
        await post(ERR); await post(ERR);
        vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));   // JST 11-15 00:00:00
        await post(ERR);
        expect(rows().map(r => [r.day, r.count])).toEqual([['2026-11-14', 2], ['2026-11-15', 1]]);
        expect(rows()[0].fp).toBe(rows()[1].fp);
    });
});

describe('POST /client-error (不正な本文は 400・何も保存しない)', () => {
    const bad = {
        '余分なキー': { ...ERR, ua: 'x' },
        'キーが足りない': { v: ERR.v, screen: ERR.screen },
        '型違い (v が数値)': { ...ERR, v: 1 },
        '型違い (msg が null)': { ...ERR, msg: null },
        '空の v': { ...ERR, v: '' },
        '長すぎる v (33 字)': { ...ERR, v: 'x'.repeat(33) },
        '長すぎる msg (201 字)': { ...ERR, msg: 'あ'.repeat(201) },
        '空の msg': { ...ERR, msg: '' },
        '改行入りの msg': { ...ERR, msg: 'Error: a\n    at foo (app.js:1:1)' },
        '不正な screen (空白)': { ...ERR, screen: 'home page' },
        '不正な screen (日本語)': { ...ERR, screen: 'ホーム' },
        '不正な screen (41 字)': { ...ERR, screen: 'a'.repeat(41) },
        '配列': [ERR.v, ERR.screen, ERR.msg],
        '壊れた JSON': '{"v":"1","screen":"home",',
        'JSON でない': 'v=1&screen=home&msg=x',
        '空の本文': '',
        '1KB 超 (前後の空白で水増しした正しい JSON)': JSON.stringify(ERR) + ' '.repeat(1100)
    };
    for (const [name, body] of Object.entries(bad)) {
        it(name, async () => {
            expect((await post(body)).status).toBe(400);
            expect(rows()).toHaveLength(0);
        });
    }
});

describe('通知 (Discord webhook)', () => {
    it('10 回までは通知 0・11 回目でちょうど 1 回・12 回目以降も増えない', async () => {
        for (let i = 0; i < 10; i++) await post(ERR);
        expect(hookCalls).toHaveLength(0);
        await post(ERR);
        expect(hookCalls).toHaveLength(1);
        for (let i = 0; i < 5; i++) await post(ERR);
        expect(hookCalls).toHaveLength(1);
        expect(rows()[0]).toMatchObject({ count: 16, notified: 1 });

        expect(hookCalls[0].url).toBe(HOOK);
        const c = hookCalls[0].body.content;
        expect(c.startsWith('【端末エラー】')).toBe(true);
        for (const s of [ERR.v, ERR.screen, ERR.msg, '11 件']) expect(c).toContain(s);
        expect(c).not.toContain('\n');
        for (const secret of [IP, UA]) expect(c).not.toContain(secret);
        expect(hookCalls[0].body.allowed_mentions).toEqual({ parse: [] });
    });

    it('別の指紋は別に数える (片方が 11 件でも、もう片方の 10 件では通知しない)', async () => {
        for (let i = 0; i < 11; i++) await post(ERR);
        for (let i = 0; i < 10; i++) await post({ ...ERR, screen: 'settings' });
        expect(hookCalls).toHaveLength(1);
    });

    it('REPORT_WEBHOOK_URL 未設定・webhook 失敗でも 204', async () => {
        delete env.REPORT_WEBHOOK_URL;
        for (let i = 0; i < 11; i++) expect((await post(ERR)).status).toBe(204);
        expect(hookCalls).toHaveLength(0);
        expect(rows()[0].notified).toBe(1);

        env.REPORT_WEBHOOK_URL = HOOK;
        globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });
        const other = { ...ERR, screen: 'shelf' };
        for (let i = 0; i < 11; i++) expect((await post(other)).status).toBe(204);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});

describe('乱用対策・停止・D1 未設定', () => {
    it('レート超過で 429 (キーは cerr:<CF-Connecting-IP>)・何も保存しない', async () => {
        const keys = [];
        env.WRITE_LIMITER = { async limit({ key }) { keys.push(key); return { success: false }; } };
        const res = await post(ERR);
        expect(res.status).toBe(429);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
        expect(keys).toEqual([`cerr:${IP}`]);
        expect(rows()).toHaveLength(0);
    });

    it('limiter が通せば 204', async () => {
        env.WRITE_LIMITER = { async limit() { return { success: true }; } };
        expect((await post(ERR)).status).toBe(204);
        expect(rows()).toHaveLength(1);
    });

    it('CLIENT_ERRORS_OFF=1 なら保存も通知もせず 204', async () => {
        env.CLIENT_ERRORS_OFF = '1';
        for (let i = 0; i < 11; i++) expect((await post(ERR)).status).toBe(204);
        expect(rows()).toHaveLength(0);
        expect(hookCalls).toHaveLength(0);
    });

    it('DB が無ければ 503', async () => {
        delete env.DB;
        expect((await post(ERR)).status).toBe(503);
    });

    it('1 日の新規指紋が 500 に達したら新しい指紋は保存せず 204・既にある指紋の加算は続ける・翌日はまた入る', async () => {
        at('2026-11-14T03:00:00Z');   // JST 11-14 12:00
        await post(ERR);
        const ins = DB._db.prepare('INSERT INTO client_errors (day, fp, v, screen, msg, first_at, last_at) VALUES (?,?,?,?,?,?,?)');
        for (let i = 0; i < 499; i++) ins.run('2026-11-14', `f${String(i).padStart(15, '0')}`, '1', 'home', `filler ${i}`, 1, 1);
        const fresh = { ...ERR, msg: 'RangeError: new one' };
        expect((await post(fresh)).status).toBe(204);
        expect(DB.rows(`SELECT COUNT(*) AS n FROM client_errors WHERE day = '2026-11-14'`)[0].n).toBe(500);
        expect(DB.rows(`SELECT * FROM client_errors WHERE fp = ?`, fpOf(fresh))).toHaveLength(0);
        expect((await post(ERR)).status).toBe(204);
        expect(DB.rows(`SELECT count FROM client_errors WHERE fp = ?`, fpOf(ERR))[0].count).toBe(2);

        vi.setSystemTime(new Date('2026-11-14T15:00:00Z'));   // JST 11-15
        await post(fresh);
        expect(DB.rows(`SELECT day FROM client_errors WHERE fp = ?`, fpOf(fresh))).toEqual([{ day: '2026-11-15' }]);
    });
});

describe('pruneClientErrors (30 日より古い行を消す)', () => {
    const seed = () => {
        const ins = DB._db.prepare('INSERT INTO client_errors (day, fp, v, screen, msg, first_at, last_at) VALUES (?,?,?,?,?,?,?)');
        for (const day of ['2026-09-01', '2026-10-14', '2026-10-15', '2026-11-14']) ins.run(day, 'abcdef0123456789', '1', 'home', 'x', 1, 1);
    };
    const days = () => rows().map(r => r.day);

    it('JST の今日から 30 日より前の日の行だけを消す (ちょうど 30 日前は残す)', async () => {
        seed();
        const n = await pruneClientErrors(env, new Date('2026-11-13T16:00:00Z'));   // JST 11-14 01:00
        expect(n).toBe(2);
        expect(days()).toEqual(['2026-10-15', '2026-11-14']);
    });

    it('scheduled から呼ばれる。バックアップが失敗しても掃除は済み、バックアップの失敗はそのまま返る', async () => {
        seed();
        at('2026-11-13T16:00:00Z');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(worker.scheduled({ cron: '50 18 * * *' }, env, { waitUntil() {} })).rejects.toThrow('backup failed: config');
        expect(days()).toEqual(['2026-10-15', '2026-11-14']);
    });

    it('掃除が失敗してもバックアップの結果 (失敗の種別) は変わらない', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        env.DB = { prepare() { throw new Error('d1 down'); } };
        await expect(worker.scheduled({ cron: '50 18 * * *' }, env, { waitUntil() {} })).rejects.toThrow('backup failed: config');
        expect(err.mock.calls.some(a => String(a[0]).includes('[client-error] prune'))).toBe(true);
    });

    it('D1 未設定なら何もしない (0)', async () => {
        expect(await pruneClientErrors({}, new Date())).toBe(0);
    });
});

describe('マイグレーション 0004', () => {
    it('空の DB に流すと表ができ、二度流しても壊れない (community-schema.sql と同じ列)', () => {
        const m = makeSqliteD1({ schema: 'cf-worker/migrations/0004_client_errors.sql' });
        m._db.exec(readRepoFile('cf-worker/migrations/0004_client_errors.sql'));
        const cols = (d) => d.rows(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('client_errors')`);
        expect(cols(m)).toEqual(cols(DB));
    });
});
