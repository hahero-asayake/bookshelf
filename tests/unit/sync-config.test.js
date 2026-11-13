// SyncConfigManager.setMethod: 保存先の方式 (method) だけを書き換え、接続情報など他のフィールドを残すこと (イシュー#592)。
// isConfigured() は「bookshelf_sync が保存されているか」= setMethod を呼ぶと true になること。
import { describe, it, expect, beforeEach } from 'vitest';

// この環境の jsdom は localStorage 実体を持たないため、インメモリ shim を注入 (import 前・hub-auth.test.js と同じ)。
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

await import('../../js/sync-config.js');
const { SyncConfigManager } = globalThis;

beforeEach(() => {
    SyncConfigManager.clear();
});

describe('SyncConfigManager.setMethod', () => {
    it('未保存の時に呼ぶと method が保存され、isConfigured() が true になる', () => {
        expect(SyncConfigManager.isConfigured()).toBe(false);
        SyncConfigManager.setMethod('local');
        expect(SyncConfigManager.isConfigured()).toBe(true);
        expect(JSON.parse(localStorage.getItem('bookshelf_sync')).method).toBe('local');
    });

    it('method だけを書き換え、GitHub・ハブの接続情報と公開先はそのまま残す', () => {
        SyncConfigManager.save({
            ...SyncConfigManager.defaults(),
            method: 'local',
            github: { owner: 'o', repo: 'r', branch: 'main', basePath: 'b', token: 'ghu_x', login: 'me' },
            hub: { ...SyncConfigManager.defaults().hub, apiBase: 'https://hub.example', key: 'hk_x' },
            publish: { target: 'github', owner: 'o', repo: 'pub', branch: 'main' }
        });
        SyncConfigManager.setMethod('hub');
        const cfg = SyncConfigManager.load();
        expect(cfg.method).toBe('hub');
        expect(cfg.github).toEqual({ owner: 'o', repo: 'r', branch: 'main', basePath: 'b', token: 'ghu_x', login: 'me' });
        expect(cfg.hub.key).toBe('hk_x');
        expect(cfg.hub.apiBase).toBe('https://hub.example');
        expect(cfg.publish).toEqual({ target: 'github', owner: 'o', repo: 'pub', branch: 'main' });
    });
});
