// イシュー#620: 本の詳細の本棚のチップと「本棚を追加...」の選択肢を、所属が変わった時に、描画と同じ関数で
// 本棚セクションだけ書き換える (_applyDetailShelvesEverywhere)。DOM の断片で確かめる。
// 本の詳細 (js/screens/book-detail.js) を jsdom で実際に描き (showBookDetail)、所属のデータを変えてから書き換える。
// 取り付け先は #611 の tests/unit/book-detail-memo-button.test.js と同じ型の最小の stub クラス
// (VirtualBookshelf 本体の class は window に出ていないため)。追加・外すの処理 (bookshelf.js 側) は記録だけする。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const ASIN = 'B000000001';
const ASIN2 = 'B000000002';
const book = { asin: ASIN, title: 'テストの本', authors: '著者', acquiredTime: Date.UTC(2026, 0, 2) };
const book2 = { asin: ASIN2, title: '別の本', authors: '著者', acquiredTime: Date.UTC(2026, 0, 3) };

beforeAll(async () => {
    globalThis.VirtualBookshelf = class VirtualBookshelf {};
    await import('../../js/ui/escape.js');
    await import('../../js/icons.js');
    await import('../../js/ui-feedback.js');
    await import('../../js/ui/book-list.js');
    await import('../../js/ui/save-status.js');
    await import('../../js/storage.js');
    await import('../../js/screens/book-detail.js');
});

function mountDom() {
    document.body.className = '';
    document.body.innerHTML = '<div id="book-detail-pane"></div>';
}

// 本1は「棚A」にだけ入っている。候補は「棚B」と「棚C」
function makeApp() {
    const app = Object.create(globalThis.VirtualBookshelf.prototype);
    const shelves = [
        { id: 'all', internalId: 'all01', name: 'すべての本', isSpecial: true, books: [ASIN, ASIN2] },
        { id: 'shelf-a', internalId: 'sa01', name: '棚A', books: [ASIN, ASIN2] },
        { id: 'shelf-b', internalId: 'sb01', name: '棚B', books: [] },
        { id: 'shelf-c', internalId: 'sc01', name: '棚C', books: [] },
    ];
    const byId = (id) => shelves.find((s) => s.internalId === id || s.id === id) || null;
    Object.assign(app, {
        userData: { notes: {}, bookshelves: shelves, settings: {}, hiddenBooks: [] },
        books: [book, book2],
        currentBookshelf: null,
        bookshelfManager: { resolveMemo: () => '', resolveRating: () => 0, getById: byId, getBySlug: byId },
        bookManager: {
            getAmazonUrl: (b) => `https://www.amazon.co.jp/dp/${b.asin}`, isKindleBook: () => false, getKindleReadUrl: () => '',
            hasCoverImage: () => false, getProductImageUrl: () => '', getEffectiveASIN: (b) => b.asin,
            acquiredTimeToDateInput: () => '',
        },
        nav: null,
        router: null,
        pluginAPI: { _runDetailSections: () => [], _emit: () => {} },
        storage: { readBookMemo: async () => null, buildBookMemoTemplate: () => '', writeBookMemo: async () => {} },
        saveUserData: async () => {},
        _savePaneState() {},
        _closeOverlayFacesSilently() {},
        _navMobile: () => false,
        _dupAsinInfo: () => new Map(),
        _getStarOverlay: () => false,
        _starWidgetHtml: () => '',
        _bindPointerReorder() {},
        _noteAutoSaveTimers: new Map(),
        _applyRatingEverywhere() {},
        _toggleAllNoteFlag() {},
        saveNote() {},
        saveRating() {},
        // 追加・外すの処理 (bookshelf.js 側) は、呼ばれた引数だけを記録する
        addCalls: [],
        removeCalls: [],
        addBookToBookshelf(asin) { this.addCalls.push([asin]); },
        removeFromBookshelf(asin, bookshelfId) { this.removeCalls.push([asin, bookshelfId]); },
    });
    return app;
}

const section = () => document.querySelector('#book-detail-pane .bd-section[data-section="bookshelves"] .bd-section-body');
const chipNames = () => Array.from(section().querySelectorAll('.bd-chip')).map((c) => c.textContent.replace('×', '').trim());
const optionValues = () => Array.from(section().querySelectorAll('.bookshelf-select option')).map((o) => o.value).filter(Boolean);
const shelf = (app, id) => app.userData.bookshelves.find((s) => s.id === id);

describe('本の詳細の本棚のチップと選択肢の書き換え (イシュー#620)', () => {
    beforeEach(() => mountDom());

    it.each([['閲覧モード', false], ['編集モード', true]])('%s: データを変えずに書き換えると、本棚セクションは描画とまったく同じ', (_label, edit) => {
        const app = makeApp();
        app.showBookDetail(book, edit);
        const rendered = section().innerHTML;
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(section().innerHTML).toBe(rendered);
    });

    it('編集モード: 所属を足すとチップが増えて選択肢から消え、候補が0になると追加欄が消える', () => {
        const app = makeApp();
        app.showBookDetail(book, true);
        expect(chipNames()).toEqual(['棚A']);
        expect(optionValues()).toEqual(['shelf-b', 'shelf-c']);

        shelf(app, 'shelf-b').books.push(ASIN);
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(chipNames()).toEqual(['棚A', '棚B']);
        expect(optionValues()).toEqual(['shelf-c']);

        shelf(app, 'shelf-c').books.push(ASIN);
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(chipNames()).toEqual(['棚A', '棚B', '棚C']);
        expect(section().querySelector('.bd-add-bookshelf')).toBeNull();
    });

    it('閲覧モード: 所属が無くなると「どの本棚にも追加されていません」になり、追加欄は出ない', () => {
        const app = makeApp();
        app.showBookDetail(book, false);
        shelf(app, 'shelf-a').books = [ASIN2];
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(chipNames()).toEqual([]);
        expect(section().textContent).toContain('どの本棚にも追加されていません');
        expect(section().querySelector('.bookshelf-select')).toBeNull();
    });

    it('書き換えた後の「追加」と × を押すと、追加・外すの処理が正しい引数で1回ずつ呼ばれる', () => {
        const app = makeApp();
        app.showBookDetail(book, true);
        shelf(app, 'shelf-b').books.push(ASIN);
        app._applyDetailShelvesEverywhere([ASIN]);

        section().querySelector('.add-to-bookshelf').click();
        expect(app.addCalls).toEqual([[ASIN]]);

        section().querySelector('.remove-from-bookshelf[data-bookshelf-id="shelf-b"]').click();
        expect(app.removeCalls).toEqual([[ASIN, 'shelf-b']]);
    });

    it('別の本の詳細を開いている時は、何も書き換えない', () => {
        const app = makeApp();
        app.showBookDetail(book2, true);
        const rendered = section().innerHTML;
        shelf(app, 'shelf-b').books.push(ASIN);
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(section().innerHTML).toBe(rendered);
    });

    it('詳細を閉じている時は、何もしない', () => {
        const app = makeApp();
        app.showBookDetail(book, true);
        const rendered = section().innerHTML;
        document.body.classList.remove('book-detail-pinned');
        shelf(app, 'shelf-b').books.push(ASIN);
        expect(() => app._applyDetailShelvesEverywhere([ASIN])).not.toThrow();
        expect(section().innerHTML).toBe(rendered);
    });

    it('編集中の書名の欄は書き換えない (未保存の入力が残る)', () => {
        const app = makeApp();
        app.showBookDetail(book, true);
        const titleInput = document.querySelector('#book-detail-pane input.edit-title');
        titleInput.value = '未保存の書名';
        shelf(app, 'shelf-b').books.push(ASIN);
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(document.querySelector('#book-detail-pane input.edit-title')).toBe(titleInput);
        expect(titleInput.value).toBe('未保存の書名');
        expect(chipNames()).toEqual(['棚A', '棚B']);
    });
});
