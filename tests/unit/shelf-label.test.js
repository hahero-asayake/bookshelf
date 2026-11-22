// イシュー#746: 本棚を単独で示す所の表示の文字 (案A・T1) を作る BookshelfManager の
// shelfPathOn / getShelfPath / getShelfLabel / getShelfTextLabel と、その文字が
// 本の詳細の「本棚を追加...」の選択肢 (H1・js/screens/book-detail.js) に出るまでを確かめる。
// 見本は #743 の harness/shelves-fixture.json と同じ形 (同名「小説 / SF」「漫画 / SF」・3階層・長いパス)。
// 通知・確認の文 (bookshelf.js 側の H3〜H7・M7) は VirtualBookshelf の class が window に出ていないため
// 単体では通せない＝画面の操作で通す E2E (tests/e2e/shelf-path-label.spec.js) で確かめる。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

let BookshelfManager;
beforeAll(async () => {
    globalThis.VirtualBookshelf = globalThis.VirtualBookshelf || class VirtualBookshelf {};
    await import('../../js/ui/escape.js');
    await import('../../js/icons.js');
    await import('../../js/ui-feedback.js');
    await import('../../js/ui/book-list.js');
    await import('../../js/ui/save-status.js');
    await import('../../js/storage.js');
    await import('../../js/bookshelf-manager.js');
    await import('../../js/screens/book-detail.js');
    BookshelfManager = window.BookshelfManager;
});

const LONG_SELF = '2026年に読み返したい本';
function makeShelves() {
    return [
        { id: 'all', internalId: 'allx', name: 'すべての本', isSpecial: true, books: ['B1'] },
        { id: 's01', internalId: 's01x', name: '小説', parent: 'allx', books: ['B1'] },
        { id: 's02', internalId: 's02x', name: '漫画', parent: null, books: ['B1'] },
        { id: 's03', internalId: 's03x', name: 'ビジネスと自己啓発', parent: null, books: [] },
        { id: 's07', internalId: 's07x', name: 'SF', parent: 's01x', books: ['B1'] },
        { id: 's09', internalId: 's09x', name: 'SF', parent: 's02x', books: [] },
        { id: 's11', internalId: 's11x', name: 'マーケティングとブランド', parent: 's03x', books: [] },
        { id: 's16', internalId: 's16x', name: '海外', parent: 's07x', books: [] },
        { id: 's18', internalId: 's18x', name: LONG_SELF, parent: 's11x', books: [] },
        // 名前に ' / ' を含む棚 (U4)。段は分けない
        { id: 'sl', internalId: 'slx', name: 'A / B', parent: 's01x', books: [] },
        // 親が見つからない棚
        { id: 'orph', internalId: 'orphx', name: '迷子', parent: 'nothere', books: [] },
        // 循環 (x1 → x2 → x1)
        { id: 'x1', internalId: 'x1x', name: '循環1', parent: 'x2x', books: [] },
        { id: 'x2', internalId: 'x2x', name: '循環2', parent: 'x1x', books: [] },
        // internalId 欠落 (slug 参照) の子
        { id: 'noiid', name: '内部ID無し', parent: 's02', books: [] },
    ];
}

let mgr;
beforeEach(() => {
    localStorage.removeItem('bookshelf.flag.shelfPath');
    mgr = new BookshelfManager({ userData: { bookshelves: makeShelves(), _storage: { allInternalId: 'allx' } } });
});
afterEach(() => localStorage.removeItem('bookshelf.flag.shelfPath'));

describe('getShelfPath (根→自身の名前の配列)', () => {
    it('1階層は名前だけ・ALL は出さない', () => {
        expect(mgr.getShelfPath('s01x')).toEqual(['小説']);
    });
    it('3階層は根→自身', () => {
        expect(mgr.getShelfPath('s16x')).toEqual(['小説', 'SF', '海外']);
    });
    it('名前に「 / 」を含んでも1段のまま', () => {
        expect(mgr.getShelfPath('slx')).toEqual(['小説', 'A / B']);
    });
    it('親が見つからない棚は自身だけ・循環は止まる', () => {
        expect(mgr.getShelfPath('orphx')).toEqual(['迷子']);
        const c = mgr.getShelfPath('x1x');
        expect(c[c.length - 1]).toBe('循環1');
        expect(c.length).toBeLessThanOrEqual(3);
    });
    it('internalId・slug・本棚の物のどれで引いても同じ', () => {
        const obj = mgr.getById('s16x');
        expect(mgr.getShelfPath('s16')).toEqual(['小説', 'SF', '海外']);
        expect(mgr.getShelfPath(obj)).toEqual(['小説', 'SF', '海外']);
        expect(mgr.getShelfPath('noiid')).toEqual(['漫画', '内部ID無し']);
    });
    it('見つからない引数は空', () => {
        expect(mgr.getShelfPath('none')).toEqual([]);
        expect(mgr.getShelfPath(null)).toEqual([]);
    });
});

describe('getShelfLabel (表示の文字)', () => {
    it('同名の2つが別の文字になる', () => {
        expect(mgr.getShelfLabel('s07x')).toBe('小説 / SF');
        expect(mgr.getShelfLabel('s09x')).toBe('漫画 / SF');
    });
    it('1階層は名前だけ・ALL は name・見つからなければ空', () => {
        expect(mgr.getShelfLabel('s02x')).toBe('漫画');
        expect(mgr.getShelfLabel('allx')).toBe('すべての本');
        expect(mgr.getShelfLabel('none')).toBe('');
    });
    it('切り替え: 0=名前だけ(前の形)・1=パス・無し=既定(パス)', () => {
        localStorage.setItem('bookshelf.flag.shelfPath', '0');
        expect(mgr.shelfPathOn()).toBe(false);
        expect(mgr.getShelfLabel('s16x')).toBe('海外');
        expect(mgr.getShelfTextLabel('s18x')).toBe(LONG_SELF);
        localStorage.setItem('bookshelf.flag.shelfPath', '1');
        expect(mgr.getShelfLabel('s16x')).toBe('小説 / SF / 海外');
        localStorage.setItem('bookshelf.flag.shelfPath', 'x');
        expect(mgr.shelfPathOn()).toBe(true);
    });
    it('ストレージが例外を投げる時は既定 (パス)', () => {
        const orig = Storage.prototype.getItem;
        Storage.prototype.getItem = () => { throw new Error('denied'); };
        try {
            expect(mgr.shelfPathOn()).toBe(true);
            expect(mgr.getShelfLabel('s07x')).toBe('小説 / SF');
        } finally {
            Storage.prototype.getItem = orig;
        }
    });
    it('max: 短いパスは省かない・長いパスは根の側から「… / 」にして自身を残す', () => {
        expect(mgr.getShelfLabel('s16x', { max: 24 })).toBe('小説 / SF / 海外');
        const full = 'ビジネスと自己啓発 / マーケティングとブランド / ' + LONG_SELF;
        expect(mgr.getShelfLabel('s18x')).toBe(full);
        expect(mgr.getShelfLabel('s18x', { max: 33 })).toBe('… / マーケティングとブランド / ' + LONG_SELF);
        expect(mgr.getShelfLabel('s18x', { max: 24 })).toBe('… / ' + LONG_SELF);
    });
    it('max: 自身だけで max を超えても自身は全部出す', () => {
        expect(mgr.getShelfLabel('s18x', { max: 5 })).toBe('… / ' + LONG_SELF);
        expect(mgr.getShelfLabel('s02x', { max: 1 })).toBe('漫画');
    });
    it('getShelfTextLabel は SHELF_LABEL_TEXT_MAX で省く (通知・確認の文の中)', () => {
        expect(BookshelfManager.SHELF_LABEL_TEXT_MAX).toBe(24);
        expect(mgr.getShelfTextLabel('s09x')).toBe('漫画 / SF');
        const t = mgr.getShelfTextLabel('s18x');
        expect(t.startsWith('… / ')).toBe(true);
        expect(t.endsWith(LONG_SELF)).toBe(true);
    });
});

describe('previewReparent の補充先に key が付く (M7 の確認の文をパスで出すため)', () => {
    it('targetShelves に name と key が並ぶ', () => {
        const app = { userData: { bookshelves: makeShelves(), _storage: { allInternalId: 'allx' } } };
        app.userData.bookshelves.find((b) => b.id === 's16').books = ['B9'];
        const m = new BookshelfManager(app);
        const prev = m.previewReparent('s16x', 's09x');
        expect(prev.valid).toBe(true);
        const keys = prev.targetShelves.map((t) => t.key);
        expect(keys).toContain('s09x');
        expect(prev.targetShelves.find((t) => t.key === 's09x').name).toBe('SF');
        expect(m.getShelfTextLabel(prev.targetShelves.find((t) => t.key === 's09x').key)).toBe('漫画 / SF');
    });
});

describe('H1: 本の詳細の「本棚を追加...」の選択肢に、描画の関数を通してパスが出る', () => {
    function makeApp() {
        const app = Object.create(globalThis.VirtualBookshelf.prototype);
        const userData = { notes: {}, bookshelves: makeShelves(), settings: {}, hiddenBooks: [], _storage: { allInternalId: 'allx' } };
        Object.assign(app, { userData, currentBookshelf: null });
        app.bookshelfManager = new BookshelfManager(app);
        return app;
    }
    const optionTexts = (html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return Array.from(div.querySelectorAll('.bookshelf-select option')).filter((o) => o.value).map((o) => o.textContent);
    };
    it('同名の SF が「漫画 / SF」と出て、value は slug のまま', () => {
        const app = makeApp();
        const html = app._detailShelvesBodyHtml({ asin: 'B1', title: '本' }, true);
        const texts = optionTexts(html);
        expect(texts).toContain('漫画 / SF');
        expect(texts).toContain('小説 / SF / 海外');
        expect(texts).toContain('ビジネスと自己啓発');
        const div = document.createElement('div');
        div.innerHTML = html;
        const opt = Array.from(div.querySelectorAll('.bookshelf-select option')).find((o) => o.textContent === '漫画 / SF');
        expect(opt.value).toBe('s09');
    });
    it('切り替え off では今と同じ名前だけ', () => {
        localStorage.setItem('bookshelf.flag.shelfPath', '0');
        const app = makeApp();
        const texts = optionTexts(app._detailShelvesBodyHtml({ asin: 'B1', title: '本' }, true));
        expect(texts).toContain('SF');
        expect(texts).not.toContain('漫画 / SF');
    });
});
