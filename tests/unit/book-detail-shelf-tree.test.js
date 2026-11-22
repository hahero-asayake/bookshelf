// イシュー#757: 本の詳細の「所属本棚」を、折り畳める字下げの木 (#753 案2＋折り畳み) で見せる。
// 組み立ては book-detail-shelf-chips.test.js と同じ (jsdom で showBookDetail を実際に描く)。本棚の親子は本物の
// BookshelfManager で辿る。追加・外すの処理 (bookshelf.js 側) は呼ばれた引数だけを記録し、データの変化はテストが
// 書いてから _applyDetailShelvesEverywhere (所属が変わった時の書き換えの入口) を通す。
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
    await import('../../js/bookshelf-manager.js');
    await import('../../js/screens/book-detail.js');
});

function mountDom(flag) {
    window.localStorage.removeItem('bookshelf.flag.detailShelfTree');
    if (flag != null) window.localStorage.setItem('bookshelf.flag.detailShelfTree', flag);
    document.body.className = '';
    document.body.innerHTML = '<div id="book-detail-pane"></div>';
}

// 本1の所属: 小説・小説/SF・小説/SF/海外・小説/ミステリー・漫画・技術書/プログラミング (技術書は所属でない＝ADR-008 の違反の写し)
// 本2の所属: 漫画・小説 (小説の下は無い)。「小説/ミステリー/古典」は本1の追加の候補
function makeApp() {
    const app = Object.create(globalThis.VirtualBookshelf.prototype);
    const shelves = [
        { id: 'all', internalId: 'all01', name: 'すべての本', isSpecial: true, books: [ASIN, ASIN2] },
        { id: 'shosetsu', internalId: 'n1', name: '小説', books: [ASIN, ASIN2] },
        { id: 'manga', internalId: 'm1', name: '漫画', books: [ASIN, ASIN2] },
        { id: 'gijutsu', internalId: 't1', name: '技術書', books: [] },
        { id: 'sf', internalId: 'n2', name: 'SF', parent: 'n1', books: [ASIN] },
        { id: 'kaigai', internalId: 'n3', name: '海外', parent: 'n2', books: [ASIN] },
        { id: 'mystery', internalId: 'n4', name: 'ミステリー', parent: 'n1', books: [ASIN] },
        { id: 'koten', internalId: 'n5', name: '古典', parent: 'n4', books: [] },
        { id: 'prog', internalId: 't2', name: 'プログラミング', parent: 't1', books: [ASIN] },
    ];
    Object.assign(app, {
        userData: { notes: {}, bookshelves: shelves, settings: {}, hiddenBooks: [] },
        books: [book, book2],
        currentBookshelf: null,
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
        addCalls: [],
        removeCalls: [],
        addBookToBookshelf(asin) { this.addCalls.push([asin]); },
        removeFromBookshelf(asin, bookshelfId) { this.removeCalls.push([asin, bookshelfId]); },
    });
    app.bookshelfManager = new window.BookshelfManager(app);
    return app;
}

const section = () => document.querySelector('#book-detail-pane .bd-section[data-section="bookshelves"] .bd-section-body');
const rows = () => Array.from(section().querySelectorAll('.bd-tree-row'));
// 見えている行を「段:名前(数)」の文字で並べる。所属でない行は頭に「-」、開いている行は数の後に「v」
const visible = () => rows().map((r) => {
    const t = r.querySelector('.bd-tree-toggle');
    const depth = r.getAttribute('style').match(/--bd-depth:(\d+)/)[1];
    return `${r.classList.contains('is-missing') ? '-' : ''}${depth}:${r.querySelector('.bd-tree-name').textContent}`
        + (t ? `(${t.querySelector('.bd-tree-count').textContent}${t.getAttribute('aria-expanded') === 'true' ? 'v' : ''})` : '');
});
const rowOf = (name) => rows().find((r) => r.querySelector('.bd-tree-name').textContent === name);
const shelf = (app, id) => app.userData.bookshelves.find((s) => s.id === id);

describe('本の詳細の所属本棚の字下げの木 (イシュー#757)', () => {
    beforeEach(() => mountDom());

    it('既定は畳む: 根の行だけを出し、下の所属の数を出す。木の順・所属でない祖先も木から作る', () => {
        const app = makeApp();
        app.showBookDetail(book, false);
        expect(section().querySelector('.bd-chips-row').classList.contains('is-tree')).toBe(true);
        expect(section().querySelector('.bd-chip')).toBeNull();
        expect(visible()).toEqual(['0:小説(3)', '0:漫画', '-0:技術書(1)']);
        const t = rowOf('小説').querySelector('.bd-tree-toggle');
        expect(t.getAttribute('aria-expanded')).toBe('false');
        expect(t.getAttribute('aria-label')).toBe('「小説」の下の3つを開く');
        // 全部開くと、根は本棚の並び順・子は getChildren の順・字下げは段
        rowOf('小説').querySelector('.bd-tree-name').click();
        rowOf('SF').querySelector('.bd-tree-toggle').click();
        rowOf('技術書').querySelector('.bd-tree-toggle').click();
        expect(visible()).toEqual(['0:小説(3v)', '1:SF(1v)', '2:海外', '1:ミステリー', '0:漫画', '-0:技術書(1v)', '1:プログラミング']);
    });

    it('行のどこを押しても開閉し、押した行の開閉へフォーカスが戻る。もう一度押すと畳む', () => {
        const app = makeApp();
        app.showBookDetail(book, false);
        rowOf('小説').querySelector('.bd-tree-name').click();
        expect(visible()).toEqual(['0:小説(3v)', '1:SF(1)', '1:ミステリー', '0:漫画', '-0:技術書(1)']);
        const t = rowOf('小説').querySelector('.bd-tree-toggle');
        expect(document.activeElement).toBe(t);
        expect(t.getAttribute('aria-label')).toBe('「小説」の下の3つを畳む');
        t.click();
        expect(visible()).toEqual(['0:小説(3)', '0:漫画', '-0:技術書(1)']);
        // 子の無い行を押しても何も変わらない
        rowOf('漫画').click();
        expect(visible()).toEqual(['0:小説(3)', '0:漫画', '-0:技術書(1)']);
    });

    it('本棚の画面から開いた時は、根からその本棚までとその本棚自身を開き、名前を強調する', () => {
        const app = makeApp();
        app.currentBookshelf = 'sf';
        app.showBookDetail(book, false);
        expect(visible()).toEqual(['0:小説(3v)', '1:SF(1v)', '2:海外', '1:ミステリー', '0:漫画', '-0:技術書(1)']);
        expect(rows().filter((r) => r.classList.contains('is-context')).map((r) => r.dataset.bookshelfId)).toEqual(['sf']);
    });

    it('編集: 所属の行にだけ × (title はパス・子がある時は下の段も外れる)。× を押しても開閉しない', () => {
        const app = makeApp();
        app.showBookDetail(book, true);
        rowOf('小説').click();
        rowOf('技術書').click();
        const xs = Array.from(section().querySelectorAll('.bd-tree-row .remove-from-bookshelf'));
        expect(xs.map((x) => [x.dataset.bookshelfId, x.title, x.textContent])).toEqual([
            ['shosetsu', '「小説」から外す（下の段も外れる）', '×'],
            ['sf', '「小説 / SF」から外す（下の段も外れる）', '×'],
            ['mystery', '「小説 / ミステリー」から外す', '×'],
            ['manga', '「漫画」から外す', '×'],
            ['prog', '「技術書 / プログラミング」から外す', '×'],
        ]);
        expect(rowOf('技術書').querySelector('.remove-from-bookshelf')).toBeNull();
        const before = visible();
        rowOf('SF').querySelector('.remove-from-bookshelf').click();
        expect(app.removeCalls).toEqual([[ASIN, 'sf']]);
        expect(visible()).toEqual(before);
    });

    it('閲覧⇄編集の切り替え・× の後の書き換えでも、開閉が残る', () => {
        const app = makeApp();
        app.showBookDetail(book, false);
        rowOf('小説').click();
        app.showBookDetail(book, true);
        expect(visible()).toEqual(['0:小説(3v)', '1:SF(1)', '1:ミステリー', '0:漫画', '-0:技術書(1)']);
        // × で SF と下の段が外れた (bookshelf.js のカスケード) 後の書き換え
        shelf(app, 'sf').books = [];
        shelf(app, 'kaigai').books = [];
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(visible()).toEqual(['0:小説(1v)', '1:ミステリー', '0:漫画', '-0:技術書(1)']);
        app.showBookDetail(book, false);
        expect(visible()).toEqual(['0:小説(1v)', '1:ミステリー', '0:漫画', '-0:技術書(1)']);
    });

    it('追加の後: 選んだ本棚の祖先とその本棚自身が開き、追加した行と下の段が見える', () => {
        const app = makeApp();
        app.showBookDetail(book, true);
        const sel = section().querySelector('.bookshelf-select');
        expect(Array.from(sel.options).map((o) => o.value).filter(Boolean)).toEqual(['gijutsu', 'koten']);
        sel.value = 'koten';
        section().querySelector('.add-to-bookshelf').click();
        expect(app.addCalls).toEqual([[ASIN]]);
        // 追加の処理 (bookshelf.js) が所属を書いた後の書き換え
        shelf(app, 'koten').books.push(ASIN);
        app._applyDetailShelvesEverywhere([ASIN]);
        expect(visible()).toEqual(['0:小説(4v)', '1:SF(1)', '1:ミステリー(1v)', '2:古典', '0:漫画', '-0:技術書(1)']);
    });

    it('別の本を開いた時・閉じた後に開いた時は、既定 (畳む) から作り直す', () => {
        const app = makeApp();
        app.showBookDetail(book, false);
        rowOf('小説').click();
        app.showBookDetail(book2, false);
        expect(visible()).toEqual(['0:小説', '0:漫画']);
        app.showBookDetail(book, false);
        expect(visible()).toEqual(['0:小説(3)', '0:漫画', '-0:技術書(1)']);
        rowOf('小説').click();
        app._closeBookModalDom();
        app.showBookDetail(book, false);
        expect(visible()).toEqual(['0:小説(3)', '0:漫画', '-0:技術書(1)']);
    });

    it("切り替え '0' は前の形 (チップ) を出し、'1' と既定は木", () => {
        mountDom('0');
        const app = makeApp();
        app.showBookDetail(book, true);
        const row = section().querySelector('.bd-chips-row');
        expect(row.className).toBe('bd-chips-row');
        expect(section().querySelector('.bd-tree')).toBeNull();
        expect(section().querySelectorAll('.bd-chip')).toHaveLength(6);
        expect(section().querySelectorAll('.bd-chip .remove-from-bookshelf')).toHaveLength(6);

        mountDom('1');
        const app2 = makeApp();
        app2.showBookDetail(book, true);
        expect(section().querySelector('.bd-chips-row.is-tree .bd-tree')).not.toBeNull();
    });

    it('所属が無い時は木を出さず「どの本棚にも追加されていません」', () => {
        const app = makeApp();
        for (const s of app.userData.bookshelves) if (!s.isSpecial) s.books = s.books.filter((a) => a !== ASIN);
        app.showBookDetail(book, false);
        expect(section().querySelector('.bd-tree')).toBeNull();
        expect(section().textContent).toContain('どの本棚にも追加されていません');
    });
});
