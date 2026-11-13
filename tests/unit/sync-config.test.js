// SyncConfigManager.setMethod: 保存先の方式 (method) だけを書き換え、接続情報など他のフィールドを残すこと (イシュー#592)。
// isConfigured() は setMethod を呼ぶと true になること (setMethod は決めた印 methodChosen も立てる・イシュー#596)。
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

    it('決めた印 (methodChosen) を一緒に立てる。base を渡すとそれを土台にする (イシュー#596)', () => {
        SyncConfigManager.setMethod('local');
        expect(JSON.parse(localStorage.getItem('bookshelf_sync')).methodChosen).toBe(true);
        const base = { ...SyncConfigManager.load(), github: { ...SyncConfigManager.defaults().github, token: 'ghu_new' } };
        SyncConfigManager.setMethod('github', base);
        const cfg = SyncConfigManager.load();
        expect(cfg.method).toBe('github');
        expect(cfg.methodChosen).toBe(true);
        expect(cfg.github.token).toBe('ghu_new');
    });
});

// イシュー#596: isConfigured() はキーの有無ではなく「決めた印 (methodChosen) があるか、method が hub/github か」で判定する。
// 印の無い local (ハブへのログイン・公開先の選択などで作られただけのキー) は決めていない扱い (境界 M1)。
describe('SyncConfigManager.isConfigured (イシュー#596)', () => {
    const put = (obj) => localStorage.setItem('bookshelf_sync', JSON.stringify(obj));
    it.each([
        ['キーが無い', null, false],
        ['印の無い local (ログイン・公開先の選択などで作られただけ)', { method: 'local', hub: { key: 'hk_x' } }, false],
        ['印のある local (自分で決めた・フォルダをつないだ)', { method: 'local', methodChosen: true }, true],
        ['印の無い hub (印が入る前に保存した人)', { method: 'hub' }, true],
        ['印の無い github (印が入る前に保存した人)', { method: 'github' }, true],
        ['印のある hub', { method: 'hub', methodChosen: true }, true]
    ])('%s → %s', (_label, stored, expected) => {
        if (stored) put(stored);
        expect(SyncConfigManager.isConfigured()).toBe(expected);
    });

    it('壊れた JSON は決めていない扱い', () => {
        localStorage.setItem('bookshelf_sync', '{broken');
        expect(SyncConfigManager.isConfigured()).toBe(false);
    });

    it('決めない書き込み (load して接続情報だけ変えて save) では印は立たない', () => {
        const cfg = SyncConfigManager.load();
        cfg.hub = { ...cfg.hub, apiBase: 'https://hub.example', key: 'hk_x' };
        SyncConfigManager.save(cfg);
        expect(JSON.parse(localStorage.getItem('bookshelf_sync')).method).toBe('local');
        expect(SyncConfigManager.isConfigured()).toBe(false);
    });

    it('決めた後の決めない書き込みは印を残す (消さない)', () => {
        SyncConfigManager.setMethod('local');
        const cfg = SyncConfigManager.load();
        cfg.publish = { ...cfg.publish, target: 'github' };
        SyncConfigManager.save(cfg);
        expect(SyncConfigManager.isConfigured()).toBe(true);
    });
});

describe('SyncConfigManager.resetMethod (イシュー#596・切断用)', () => {
    it('method を local に戻し、決めた印を外す。接続情報など他のフィールドは残す', () => {
        SyncConfigManager.setMethod('github', {
            ...SyncConfigManager.defaults(),
            github: { owner: 'o', repo: 'r', branch: 'main', basePath: '', token: 'ghu_x' }
        });
        expect(SyncConfigManager.isConfigured()).toBe(true);
        const cfg = SyncConfigManager.load();
        cfg.github = { ...cfg.github, token: '' };
        SyncConfigManager.resetMethod(cfg);
        const after = JSON.parse(localStorage.getItem('bookshelf_sync'));
        expect(after.method).toBe('local');
        expect('methodChosen' in after).toBe(false);
        expect(after.github).toEqual({ owner: 'o', repo: 'r', branch: 'main', basePath: '', token: '' });
        expect(SyncConfigManager.isConfigured()).toBe(false);
    });

    it('base を渡さなければ保存済みの設定を土台にする', () => {
        SyncConfigManager.setMethod('hub');
        SyncConfigManager.resetMethod();
        expect(SyncConfigManager.load().method).toBe('local');
        expect(SyncConfigManager.isConfigured()).toBe(false);
    });
});
