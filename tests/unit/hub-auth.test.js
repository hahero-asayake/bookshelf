// HubAuth: /session 交換・使用量再取得・切断の検証 (ADR-032/033)
// fetch をモックし、設定 (bookshelf_sync.hub) への保存とエラー分岐を確認する。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// この環境の jsdom は localStorage 実体を持たないため、インメモリ shim を注入 (import 前)。
const __lsStore = new Map();
const __ls = {
    getItem: (k) => (__lsStore.has(k) ? __lsStore.get(k) : null),
    setItem: (k, v) => { __lsStore.set(k, String(v)); },
    removeItem: (k) => { __lsStore.delete(k); },
    clear: () => { __lsStore.clear(); }
};
try { Object.defineProperty(globalThis, 'localStorage', { value: __ls, configurable: true, writable: true }); } catch (_) { globalThis.localStorage = __ls; }
if (typeof window !== 'undefined') {
    try { Object.defineProperty(window, 'localStorage', { value: __ls, configurable: true, writable: true }); } catch (_) {}
}

await import('../../js/storage-adapter.js');
await import('../../js/hub-adapter.js');
await import('../../js/sync-config.js');
await import('../../js/hub-auth.js');
const { HubAuth, SyncConfigManager, HubStorageAdapter, HubAuthError } = globalThis;

function jsonRes(obj, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
    SyncConfigManager.clear();  // bookshelf_sync キーを削除 (localStorage.clear はjsdom実装差で使わない)
    globalThis.fetch = vi.fn();
});

describe('_exchange (/session)', () => {
    it('ID トークンを /session に渡し、key/siteId/plan/quota/used を設定に保存', async () => {
        globalThis.fetch.mockResolvedValueOnce(jsonRes({
            key: 'hk_abc', uid: 'u1', siteId: 'sid-1', email: 'a@b.co',
            plan: 'free', quotaBytes: 104857600, usedBytes: 2048,
            apiBase: 'https://hub.asayake.org', publicBase: 'https://hub.asayake.org/public/sid-1/'
        }));
        const hub = await HubAuth._exchange('idtok');
        // POST /session に idToken を渡している
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(url).toMatch(/\/session$/);
        expect(JSON.parse(init.body)).toEqual({ idToken: 'idtok' });
        // 設定へ保存
        expect(hub.key).toBe('hk_abc');
        expect(hub.siteId).toBe('sid-1');
        expect(hub.plan).toBe('free');
        expect(hub.quotaBytes).toBe(104857600);
        expect(hub.usedBytes).toBe(2048);
        const saved = SyncConfigManager.load().hub;
        expect(saved.key).toBe('hk_abc');
        expect(saved.publicBase).toBe('https://hub.asayake.org/public/sid-1/');
        // buildAdapter('hub') が HubStorageAdapter を返す
        const adapter = SyncConfigManager.buildAdapter({ method: 'hub', hub: saved });
        expect(adapter).toBeInstanceOf(HubStorageAdapter);
        expect(HubAuth.isConnected()).toBe(true);
    });

    it('非 2xx は例外', async () => {
        globalThis.fetch.mockResolvedValueOnce(new Response('aud mismatch', { status: 401 }));
        await expect(HubAuth._exchange('bad')).rejects.toThrow(/ハブ認証に失敗/);
    });
});

describe('refreshUsage (/usage)', () => {
    it('使用量を再取得して plan/quota/used を更新', async () => {
        SyncConfigManager.save({ ...SyncConfigManager.defaults(), hub: { apiBase: 'https://hub.asayake.org', key: 'hk_x', plan: 'free', quotaBytes: 1, usedBytes: 0 } });
        globalThis.fetch.mockResolvedValueOnce(jsonRes({ plan: 'plus', quotaBytes: 3221225472, usedBytes: 5000, siteId: 'sid-2', publicBase: 'https://hub.asayake.org/public/sid-2/' }));
        const hub = await HubAuth.refreshUsage();
        // Bearer ヘッダを載せている
        const [url, init] = globalThis.fetch.mock.calls[0];
        expect(url).toMatch(/\/usage$/);
        expect(init.headers.Authorization).toBe('Bearer hk_x');
        expect(hub.plan).toBe('plus');
        expect(hub.quotaBytes).toBe(3221225472);
        expect(hub.usedBytes).toBe(5000);
        expect(SyncConfigManager.load().hub.plan).toBe('plus');
    });

    it('未接続なら null (fetch しない)', async () => {
        expect(await HubAuth.refreshUsage()).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('401 は HubAuthError', async () => {
        SyncConfigManager.save({ ...SyncConfigManager.defaults(), hub: { apiBase: 'https://hub.asayake.org', key: 'hk_x' } });
        globalThis.fetch.mockResolvedValueOnce(new Response('no', { status: 401 }));
        await expect(HubAuth.refreshUsage()).rejects.toBeInstanceOf(HubAuthError);
    });
});

describe('disconnect', () => {
    it('hub 設定をクリアする', async () => {
        SyncConfigManager.save({ ...SyncConfigManager.defaults(), hub: { apiBase: 'https://hub.asayake.org', key: 'hk_x', plan: 'plus' } });
        HubAuth.disconnect();
        const hub = SyncConfigManager.load().hub;
        expect(hub.key).toBe('');
        expect(hub.apiBase).toBe('');
        expect(hub.plan).toBe('free');
        expect(HubAuth.isConnected()).toBe(false);
    });
});
