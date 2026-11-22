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

describe('getPathLabel (イシュー#133: 別階層の同名本棚を区別するパス表記)', () => {
    it('親 / 子 の順に name を連結する', () => {
        expect(mgr.getPathLabel('c1')).toBe('親 / 子');
    });
    it('ルート直下の本棚は自身の name のみ', () => {
        expect(mgr.getPathLabel('p1')).toBe('親');
        expect(mgr.getPathLabel('o1')).toBe('別系統');
    });
    it('存在しない internalId は空文字を返す', () => {
        expect(mgr.getPathLabel('nope')).toBe('');
    });
    it('区切り文字は sep 引数で変えられる', () => {
        expect(mgr.getPathLabel('c1', ' > ')).toBe('親 > 子');
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

describe('同じ親の下の同名を止める (イシュー#745: 一意なのは親を含めた階層パス)', () => {
    const names = (parentKey) => app.userData.bookshelves.filter(b => !b.isSpecial && (b.parent === parentKey)).map(b => b.name);

    it('作る: 同じ親の下に同名は throw (code=name-conflict・文言に親のパス)。本棚は増えない', () => {
        const before = app.userData.bookshelves.length;
        let err;
        try { mgr.create({ name: '子', slug: 'dup', parent: 'p1' }); } catch (e) { err = e; }
        expect(err && err.code).toBe('name-conflict');
        expect(err.message).toBe('「親」の下に「子」という本棚がすでにあります。別の名前にしてください');
        expect(app.userData.bookshelves.length).toBe(before);
        expect(app.userData.bookOrder.dup).toBeUndefined();
    });
    it('作る: 別の親の下なら同名でも作れる', () => {
        const bs = mgr.create({ name: '子', slug: 'other-child', parent: 'o1' });
        expect(bs.parent).toBe('o1');
        expect(mgr.getPathLabel('o1')).toBe('別系統');
    });
    it('作る: トップ階層同士は parent 未指定・allId・"all"・ALL の slug を同じに数える', () => {
        for (const parent of [undefined, 'allid', 'all']) {
            expect(() => mgr.create({ name: '親', slug: `top-${parent}`, parent }), String(parent)).toThrow('トップ階層に「親」という本棚がすでにあります。別の名前にしてください');
        }
        // 既存の parent が null (旧データ) でもトップ階層として数える
        app.userData.bookshelves.find(b => b.id === 'other').parent = null;
        expect(() => mgr.create({ name: '別系統', slug: 'top-null' })).toThrow(/トップ階層に/);
    });
    it('作る: 親を slug で参照する子と internalId で参照する子を同じ親として数える', () => {
        app.userData.bookshelves.push({ id: 'slugchild', name: 'スラッグ参照の子', parent: 'parent', books: [], notes: {} });
        expect(() => mgr.create({ name: 'スラッグ参照の子', slug: 'x1', parent: 'p1' })).toThrow(/name-conflict|すでにあります/);
        expect(() => mgr.create({ name: '子', slug: 'x2', parent: 'parent' })).toThrow('「親」の下に「子」という本棚がすでにあります。別の名前にしてください');
    });
    it('比べ方: 全角・前後の空白・大文字小文字の違いは同じと見る (保存する名前は変えない)', () => {
        app.userData.bookshelves.push({ id: 'sf', internalId: 'sf1', name: 'SF', parent: 'p1', books: [], notes: {} });
        for (const n of ['ＳＦ', ' SF ', 'sf', 'Sf']) {
            expect(() => mgr.create({ name: n, slug: `sf-${encodeURIComponent(n)}`, parent: 'p1' }), n).toThrow('「親」の下に「SF」という本棚がすでにあります。別の名前にしてください');
        }
        expect(BookshelfManager.normalizeShelfName('　ＳＦ　')).toBe('sf');
        const ok = mgr.create({ name: 'SF2', slug: 'sf2', parent: 'p1' });
        expect(ok.name).toBe('SF2');
    });
    it('名前を変える: 兄弟の名前にすると throw し、名前もアイコンも変わらない。自分自身は数えない', () => {
        app.userData.bookshelves.push({ id: 'sib', internalId: 's1', name: '兄弟', parent: 'p1', books: [], notes: {}, iconName: 'library' });
        expect(() => mgr.update('s1', { name: '子', iconName: 'star' })).toThrow('「親」の下に「子」という本棚がすでにあります。別の名前にしてください');
        const s = mgr.getById('s1');
        expect(s.name).toBe('兄弟');
        expect(s.iconName).toBe('library');
        // 自分の名前の大文字小文字だけ変える・同じ名前で保存するのは通る
        expect(mgr.update('c1', { name: '子' }).name).toBe('子');
        expect(mgr.update('s1', { name: ' 兄弟 ' }).name).toBe(' 兄弟 ');
    });
    it('既存の同名 (読み込んだデータ): 名前を変えない編集は通り、片方の名前を別にすれば通る', () => {
        app.userData.bookshelves.push({ id: 'dup2', internalId: 'c2', name: '子', parent: 'p1', books: [], notes: {}, iconName: 'library' });
        mgr.rebuildReverseIndex();
        expect(names('p1')).toEqual(['子', '子']);
        expect(mgr.update('c2', { name: '子', iconName: 'star', description: '説明' }).iconName).toBe('star');
        expect(mgr.update('c1', { iconName: 'book' }).iconName).toBe('book');
        expect(mgr.update('c2', { name: '子2' }).name).toBe('子2');
        expect(names('p1')).toEqual(['子', '子2']);
    });
    it('update(parent): 移す先に同名があれば throw し親は変わらない。別の名前と一緒なら通る', () => {
        app.userData.bookshelves.push({ id: 'oc', internalId: 'oc1', name: '子', parent: 'o1', books: [], notes: {} });
        expect(() => mgr.update('oc1', { parent: 'p1' })).toThrow('「親」の下に「子」という本棚がすでにあるため移動できません。先にどちらかの名前を変えてください');
        expect(mgr.getById('oc1').parent).toBe('o1');
        expect(mgr.update('oc1', { name: '別の子', parent: 'p1' }).parent).toBe('p1');
    });
    it('previewReparent は valid:false と文言・reparent は throw し、親も本も変わらない', () => {
        app.userData.bookshelves.push({ id: 'oc', internalId: 'oc1', name: '子', parent: 'o1', books: ['A3'], notes: {} });
        mgr.rebuildReverseIndex();
        const msg = '「親」の下に「子」という本棚がすでにあるため移動できません。先にどちらかの名前を変えてください';
        expect(mgr.previewReparent('oc1', 'p1')).toEqual({ valid: false, code: 'name-conflict', reason: msg });
        const parentBooks = [...mgr.getById('p1').books];
        let err;
        try { mgr.reparent('oc1', 'p1'); } catch (e) { err = e; }
        expect(err && err.code).toBe('name-conflict');
        expect(err.message).toBe(msg);
        expect(mgr.getById('oc1').parent).toBe('o1');
        expect(mgr.getById('p1').books).toEqual(parentBooks);
        // トップ階層へ移す時も数える (トップに「親」がある)
        app.userData.bookshelves.push({ id: 'p-dup', internalId: 'pd1', name: '親', parent: 'o1', books: [], notes: {} });
        expect(mgr.previewReparent('pd1', null)).toMatchObject({ valid: false, reason: 'トップ階層に「親」という本棚がすでにあるため移動できません。先にどちらかの名前を変えてください' });
        // 衝突しなければ今までどおり移せる (移す先は slug 参照の本棚)
        expect(mgr.previewReparent('c1', 'noiid').valid).toBe(true);
        mgr.reparent('c1', 'noiid');
        expect(mgr.getById('c1').parent).toBe('noiid');
    });
    it('親が変わらない移動 (同じ親への reparent) は既存の同名でも止めない', () => {
        app.userData.bookshelves.push({ id: 'dup2', internalId: 'c2', name: '子', parent: 'p1', books: [], notes: {} });
        expect(mgr.previewReparent('c2', 'p1').valid).toBe(true);
        expect(() => mgr.reparent('c2', 'p1')).not.toThrow();
    });
    it('特殊本棚 (ALL) は数えない・ALL の名前の変更は検査しない', () => {
        expect(mgr.create({ name: 'すべての本', slug: 'all-name' }).name).toBe('すべての本');
        expect(mgr.update('allid', { name: 'すべての本' }).name).toBe('すべての本');
        expect(mgr.findSiblingNameConflict('すべての本', null, 'all-name')).toBeNull();
    });
});
