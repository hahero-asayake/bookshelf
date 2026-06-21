// BookshelfManager のドメインロジックテスト
// クラスは window 公開 (ビルドレス) のため、jsdom でスクリプトを読み込み window から取得する。
import { describe, it, expect, beforeEach } from 'vitest';

// create() が参照するグローバル (storage.js 定義) を先にスタブ
let idCounter = 0;
globalThis.generateInternalId = () => `gen${++idCounter}`;

await import('../../js/bookshelf-manager.js');
const BookshelfManager = window.BookshelfManager;

// fake app: 階層 all > 親(p1) > 子(c1)、別系統 other(o1)、internalId 欠落棚 (slug 参照)
function makeApp() {
    return {
        userData: {
            bookshelves: [
                { id: 'all', internalId: 'allid', name: 'すべての本', isSpecial: true, books: ['A1', 'A2', 'A3', 'A4'], notes: {} },
                { id: 'parent', internalId: 'p1', name: '親', parent: 'allid', books: ['A1', 'A2'], notes: {} },
                { id: 'child', internalId: 'c1', name: '子', parent: 'p1', books: ['A1'], notes: { A1: { memo: '子のoverride' } } },
                { id: 'other', internalId: 'o1', name: '別系統', parent: 'allid', books: ['A3'], notes: {} },
                { id: 'noiid', name: '内部ID欠落', parent: 'allid', books: [], notes: {} }
            ],
            notes: { A1: { memo: 'ALLメモ', rating: 4 } },
            bookOrder: { all: ['A1', 'A2', 'A3', 'A4'], parent: ['A1', 'A2'], child: ['A1'], other: ['A3'] },
            _storage: { allInternalId: 'allid' }
        }
    };
}

let app, mgr;
beforeEach(() => {
    app = makeApp();
    mgr = new BookshelfManager(app);
    mgr.rebuildReverseIndex();
});

describe('_keyOf / getById', () => {
    it('internalId があれば internalId、無ければ id (slug) を返す', () => {
        expect(mgr._keyOf({ internalId: 'x', id: 'slug' })).toBe('x');
        expect(mgr._keyOf({ id: 'slug' })).toBe('slug');
    });
    it('getById は internalId 優先、slug フォールバック', () => {
        expect(mgr.getById('p1').id).toBe('parent');
        expect(mgr.getById('noiid').name).toBe('内部ID欠落');
    });
});

describe('getDescendants / canSetParent', () => {
    it('階層の子孫を列挙する', () => {
        const names = mgr.getDescendants('p1').map(b => b.id);
        expect(names).toEqual(['child']);
        expect(mgr.getDescendants('allid').map(b => b.id).sort())
            .toEqual(['child', 'noiid', 'other', 'parent']);
    });
    it('循環データでも無限ループしない', () => {
        // p1 → c1 → p1 の循環を作る
        app.userData.bookshelves.find(b => b.internalId === 'p1').parent = 'c1';
        const result = mgr.getDescendants('p1');
        expect(Array.isArray(result)).toBe(true);
    });
    it('canSetParent: 自分自身 / 子孫は false、それ以外は true', () => {
        expect(mgr.canSetParent('p1', 'p1')).toBe(false);
        expect(mgr.canSetParent('p1', 'c1')).toBe(false);
        expect(mgr.canSetParent('c1', 'o1')).toBe(true);
        expect(mgr.canSetParent('p1', null)).toBe(true);
    });
});

describe('create', () => {
    it('親の books と bookOrder をコピーして作成する', () => {
        const bs = mgr.create({ name: '新規', slug: 'fresh', parent: 'p1' });
        expect(bs.books).toEqual(['A1', 'A2']);
        expect(app.userData.bookOrder['fresh']).toEqual(['A1', 'A2']);
        expect(bs.parent).toBe('p1');
    });
    it('slug 重複は throw', () => {
        expect(() => mgr.create({ name: 'x', slug: 'parent' })).toThrow();
    });
});

describe('reparent / previewReparent', () => {
    it('reparent: 部分木の本が新親チェーンに補充される (子⊆親)', () => {
        // 子(c1, books=[A1]) を 別系統(o1, books=[A3]) の下へ
        mgr.reparent('c1', 'o1');
        const other = mgr.getById('o1');
        expect(mgr.getById('c1').parent).toBe('o1');
        expect(other.books).toContain('A1');
        expect(app.userData.bookOrder['other']).toContain('A1');
    });
    it('reparent: 特殊本棚は throw / 循環は throw', () => {
        expect(() => mgr.reparent('allid', 'o1')).toThrow();
        expect(() => mgr.reparent('p1', 'c1')).toThrow();
    });
    it('previewReparent: mutate せず addedToNewParent が正しい', () => {
        const before = JSON.stringify(app.userData);
        const p = mgr.previewReparent('c1', 'o1');
        expect(p.valid).toBe(true);
        expect(p.addedToNewParent).toBe(1); // A1 が other に無い
        expect(JSON.stringify(app.userData)).toBe(before);
    });
    it('previewReparent: 循環は invalid', () => {
        expect(mgr.previewReparent('p1', 'c1').valid).toBe(false);
    });
});

describe('reorderSibling', () => {
    const order = () => app.userData.bookshelves.map(b => b.id);
    it('before 指定の直前へ移動する', () => {
        mgr.reorderSibling('o1', 'p1');
        expect(order()).toEqual(['all', 'other', 'parent', 'child', 'noiid']);
    });
    it('null で末尾へ移動する', () => {
        mgr.reorderSibling('p1', null);
        expect(order()).toEqual(['all', 'child', 'other', 'noiid', 'parent']);
    });
});

describe('addBookToBookshelf / removeBookFromBookshelf', () => {
    it('追加: books + 逆引き + bookOrder 先頭', () => {
        mgr.addBookToBookshelf('o1', 'A9');
        expect(mgr.getById('o1').books).toContain('A9');
        expect(mgr.getBookshelvesForBook('A9').map(b => b.id)).toContain('other');
        expect(app.userData.bookOrder['other'][0]).toBe('A9');
    });
    it('親から削除すると子孫へカスケードし bookOrder も同期する', () => {
        mgr.removeBookFromBookshelf('p1', 'A1');
        expect(mgr.getById('p1').books).not.toContain('A1');
        expect(mgr.getById('c1').books).not.toContain('A1');
        expect(app.userData.bookOrder['parent']).not.toContain('A1');
        expect(app.userData.bookOrder['child']).not.toContain('A1');
    });
});

describe('短文メモ (ALL 1段。本棚 override は廃止 — 2026-06-20)', () => {
    it('resolveMemo: 常に ALL.notes の memo を返す (本棚 override は無視)', () => {
        // fixture の child(c1) には A1 の override メモがあるが、もう参照されない
        expect(mgr.resolveMemo('A1')).toBe('ALLメモ');
        expect(mgr.resolveMemo('A1', 'c1')).toBe('ALLメモ');
        expect(mgr.resolveMemo('A1', 'allid')).toBe('ALLメモ');
        expect(mgr.resolveMemo('A1', null)).toBe('ALLメモ');
        expect(mgr.resolveMemo('ZZZ')).toBe('');
    });
    it('setMemo: ALL.notes に保存 (他フィールドは保持)', () => {
        mgr.setMemo('A1', '新メモ');
        expect(mgr.resolveMemo('A1')).toBe('新メモ');
        expect(app.userData.notes['A1'].rating).toBe(4);
    });
    it('setMemo: 全フィールド空ならエントリ削除 / rating があれば残す', () => {
        app.userData.notes['A2'] = { memo: 'x' };
        mgr.setMemo('A2', '');
        expect(app.userData.notes['A2']).toBeUndefined();
        mgr.setMemo('A1', '');
        expect(app.userData.notes['A1']).toBeDefined();
        expect(app.userData.notes['A1'].rating).toBe(4);
    });
    it('resolveRating: ALL.notes が唯一の正本', () => {
        expect(mgr.resolveRating('A1')).toBe(4);
        expect(mgr.resolveRating('ZZZ')).toBe(0);
    });
});
