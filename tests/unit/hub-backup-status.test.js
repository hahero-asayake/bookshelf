// @vitest-environment node
// バックアップ鮮度監視 GET /backup-status (認証なし・イシュー#236)
//  - #235 の日次バックアップ (LATEST.json) が動いているかを外形監視 (UptimeRobot) から見えるようにする
//  - 返すのは判定語 (ok|stale) と最終成功時刻だけ。email・ユーザー名・キー名・バケットの中身・件数は一切出さない
// 経路を通す形: default export の fetch (ルーティング・エラー正規化込み) を叩く (関数の直呼びはしない)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';

function makeR2(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k) { const v = store.get(k); return v == null ? null : { text: async () => v }; },
        async put(k, v) { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
    };
}

const NOW = new Date('2026-09-28T00:00:00.000Z');
const H49 = 176400; // 49h (2 周期 + 1 時間) の既定閾値・秒
let env;

const call = (method = 'GET') => worker.fetch(new Request('https://hub.example/backup-status', { method }), env, { waitUntil() {} });

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    env = { HUB_DOMAIN: 'hub.example' };
});
afterEach(() => { vi.useRealTimers(); });

describe('GET /backup-status', () => {
    it('既定閾値 (49h) 以内の成功は ok・成功時刻をそのまま返す', async () => {
        const at = new Date(NOW.getTime() - 3600e3).toISOString(); // 1h前
        env.BACKUP = makeR2({ 'LATEST.json': { ok: true, at, gen: 'g1', counts: { total: 5 } } });
        const res = await call();
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await res.json()).toEqual({ status: 'ok', lastSuccess: at });
    });

    it('既定閾値 (176400秒) を1秒でも超えたら stale', async () => {
        const at = new Date(NOW.getTime() - (H49 + 1) * 1000).toISOString();
        env.BACKUP = makeR2({ 'LATEST.json': { ok: true, at } });
        expect(await (await call()).json()).toEqual({ status: 'stale', lastSuccess: at });
    });

    it('直近が失敗 (ok:false) でも lastSuccess.at が閾値以内なら ok (失敗の通知自体は #235 の webhook が別に行う)', async () => {
        const okAt = new Date(NOW.getTime() - 3600e3).toISOString();
        env.BACKUP = makeR2({ 'LATEST.json': { ok: false, error: 'unknown', lastSuccess: { at: okAt, gen: 'g0', counts: { total: 5 } } } });
        expect(await (await call()).json()).toEqual({ status: 'ok', lastSuccess: okAt });
    });

    it('直近が失敗で lastSuccess も閾値超えなら stale', async () => {
        const oldAt = new Date(NOW.getTime() - (H49 + 1) * 1000).toISOString();
        env.BACKUP = makeR2({ 'LATEST.json': { ok: false, error: 'unknown', lastSuccess: { at: oldAt } } });
        expect(await (await call()).json()).toEqual({ status: 'stale', lastSuccess: oldAt });
    });

    it('直近が失敗で lastSuccess が無い (一度も成功していない) なら stale・lastSuccess は null', async () => {
        env.BACKUP = makeR2({ 'LATEST.json': { ok: false, error: 'config', lastSuccess: null } });
        expect(await (await call()).json()).toEqual({ status: 'stale', lastSuccess: null });
    });

    it('LATEST.json が無ければ stale・lastSuccess は null', async () => {
        env.BACKUP = makeR2({});
        expect(await (await call()).json()).toEqual({ status: 'stale', lastSuccess: null });
    });

    it('LATEST.json が壊れた JSON でも 200 で stale を返す (例外文言は出さない)', async () => {
        env.BACKUP = makeR2({});
        env.BACKUP.store.set('LATEST.json', '{not json');
        const res = await call();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'stale', lastSuccess: null });
    });

    it('BACKUP binding 自体が無ければ stale (未設定 = scheduled が動いていないのと区別しない)', async () => {
        expect(await (await call()).json()).toEqual({ status: 'stale', lastSuccess: null });
    });

    it('env.BACKUP_STALE_SECONDS で閾値を上書きできる (stale 検証用に一時的に下げる想定)', async () => {
        const at = new Date(NOW.getTime() - 120e3).toISOString(); // 2分前 (既定閾値なら ok の値)
        env.BACKUP = makeR2({ 'LATEST.json': { ok: true, at } });
        env.BACKUP_STALE_SECONDS = '60'; // 60秒まで下げる
        expect(await (await call()).json()).toEqual({ status: 'stale', lastSuccess: at });
    });

    it('レスポンスは status と lastSuccess の2キーだけ・禁止語 (email・key・bucket・gen・count 等) を含まない', async () => {
        env.BACKUP = makeR2({ 'LATEST.json': { ok: true, at: new Date(NOW.getTime() - 3600e3).toISOString(), gen: 'gen1', counts: { total: 5 }, ops: 9, warn: 'shrink' } });
        const body = await (await call()).json();
        expect(Object.keys(body).sort()).toEqual(['lastSuccess', 'status']);
        const text = JSON.stringify(body).toLowerCase();
        for (const bad of ['email', 'key', 'bucket', 'count', 'gen', 'ops', 'warn', '@']) expect(text).not.toContain(bad);
    });

    it('POST は既存の 404 経路のまま (このステップでルートを増やさない)', async () => {
        const res = await call('POST');
        expect(res.status).toBe(404);
    });
});
