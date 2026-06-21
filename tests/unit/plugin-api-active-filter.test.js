// BookshelfPluginAPI の registerActiveFilter (属性プロバイダ。ADR-041/043)
// 「自分は今フィルタ中」の申告・一括 reset・スコープ解除・例外耐性を検証する。
import { describe, it, expect, vi } from 'vitest';

await import('../../js/plugin-api.js');
const BookshelfPluginAPI = window.BookshelfPluginAPI;

function makeApi() {
    return new BookshelfPluginAPI({ books: [], userData: { settings: {}, notes: {} } });
}

describe('registerActiveFilter / isAnyFilterActive', () => {
    it('isActive() が無いと登録を拒否し null', () => {
        const api = makeApi();
        expect(api.registerActiveFilter({})).toBeNull();
        expect(api.registerActiveFilter({ isActive: 'x' })).toBeNull();
        expect(api.isAnyFilterActive()).toBe(false);
    });
    it('プロバイダ無しなら false', () => {
        expect(makeApi().isAnyFilterActive()).toBe(false);
    });
    it('いずれかが true を返せば true', () => {
        const api = makeApi();
        let on = false;
        api.registerActiveFilter({ isActive: () => on });
        expect(api.isAnyFilterActive()).toBe(false);
        on = true;
        expect(api.isAnyFilterActive()).toBe(true);
    });
    it('複数プロバイダの OR', () => {
        const api = makeApi();
        api.registerActiveFilter({ isActive: () => false });
        api.registerActiveFilter({ isActive: () => true });
        expect(api.isAnyFilterActive()).toBe(true);
    });
    it('isActive() の例外は握りつぶして false 扱い (他に影響しない)', () => {
        const api = makeApi();
        api.registerActiveFilter({ isActive: () => { throw new Error('boom'); } });
        expect(api.isAnyFilterActive()).toBe(false);
        api.registerActiveFilter({ isActive: () => true });
        expect(api.isAnyFilterActive()).toBe(true);
    });
});

describe('resetActiveFilters', () => {
    it('登録プロバイダの reset を全て呼ぶ', () => {
        const api = makeApi();
        const r1 = vi.fn(), r2 = vi.fn();
        api.registerActiveFilter({ isActive: () => true, reset: r1 });
        api.registerActiveFilter({ isActive: () => true, reset: r2 });
        api.resetActiveFilters();
        expect(r1).toHaveBeenCalledTimes(1);
        expect(r2).toHaveBeenCalledTimes(1);
    });
    it('reset 省略のプロバイダはスキップ、例外は他を止めない', () => {
        const api = makeApi();
        const ok = vi.fn();
        api.registerActiveFilter({ isActive: () => true }); // reset 無し
        api.registerActiveFilter({ isActive: () => true, reset: () => { throw new Error('x'); } });
        api.registerActiveFilter({ isActive: () => true, reset: ok });
        expect(() => api.resetActiveFilters()).not.toThrow();
        expect(ok).toHaveBeenCalledTimes(1);
    });
});

describe('スコープ登録と unregisterPlugin での解除', () => {
    it('forPlugin 経由で登録 → unregister でプロバイダが消える', () => {
        const api = makeApi();
        const scoped = api.forPlugin('p1');
        scoped.registerActiveFilter({ isActive: () => true });
        expect(api.isAnyFilterActive()).toBe(true);
        expect(api.getPluginContributions('p1')).toContain('filter');
        api.unregisterPlugin('p1');
        expect(api.isAnyFilterActive()).toBe(false);
    });
    it('removeActiveFilter で個別解除', () => {
        const api = makeApi();
        const entry = api.registerActiveFilter({ isActive: () => true });
        expect(api.isAnyFilterActive()).toBe(true);
        api.removeActiveFilter(entry);
        expect(api.isAnyFilterActive()).toBe(false);
    });
    it('scoped removeActiveFilter は reg も同期する (contributions が剥がれる)', () => {
        const api = makeApi();
        const scoped = api.forPlugin('p2');
        const entry = scoped.registerActiveFilter({ isActive: () => true });
        expect(api.getPluginContributions('p2')).toContain('filter');
        scoped.removeActiveFilter(entry);
        expect(api.isAnyFilterActive()).toBe(false);
        expect(api.getPluginContributions('p2')).not.toContain('filter');
    });
});
