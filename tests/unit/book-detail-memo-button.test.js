// イシュー#611: 長文メモを「完了」で保存したら、本の詳細のボタンが「長文メモを書く」→「長文メモを開く」に変わる。
// 本の詳細 (js/screens/book-detail.js) を jsdom で実際に描き (showBookDetail)、詳細のボタンのクリック →
// アプリ内エディタを開く (_openBookMemoInAppEditor) → 完了 (_bookMemoFsDone) の経路を通す。
// VirtualBookshelf 本体 (js/bookshelf.js) の class は window に出ておらず、import では取り付け先にできない
// ため、取り付け先の最小の stub クラスを置き、本の詳細の外 (bookshelf.js 側) にある部品だけを差し替える。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const ASIN = 'B000000001';
const book = { asin: ASIN, title: 'テストの本', authors: '著者', acquiredTime: Date.UTC(2026, 0, 2) };

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
    document.body.innerHTML = `
        <div id="book-detail-pane"></div>
        <div id="book-memo-modal" class="modal">
            <div id="book-memo-fs-title"></div><div id="book-memo-status"></div>
            <textarea id="book-memo-textarea"></textarea>
        </div>`;
}

function makeApp({ writeBookMemo = async () => {}, readBookMemo = async () => null } = {}) {
    const app = Object.create(globalThis.VirtualBookshelf.prototype);
    const written = [];
    Object.assign(app, {
        userData: { notes: {}, bookshelves: [], settings: {}, hiddenBooks: [] },
        books: [book],
        bookshelfManager: { resolveMemo: () => '', resolveRating: () => 0, getById: () => null, getBySlug: () => null },
        bookManager: {
            getAmazonUrl: () => `https://www.amazon.co.jp/dp/${ASIN}`, isKindleBook: () => false, getKindleReadUrl: () => '',
            hasCoverImage: () => false, getProductImageUrl: () => '', getEffectiveASIN: (b) => b.asin,
            acquiredTimeToDateInput: () => '',
        },
        nav: null,
        router: null,
        pluginAPI: { _runDetailSections: () => [], _emit: () => {} },
        storage: {
            readBookMemo, buildBookMemoTemplate: () => '',
            writeBookMemo: async (...args) => { await writeBookMemo(...args); written.push(args); },
        },
        written,
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
        _overlays: () => ({
            open: (el) => el.classList.add('show'),
            close: (id) => document.getElementById(id).classList.remove('show'),
        }),
        _surface: () => ({ open() {}, close() {} }),
        _ensureEasyMDELoaded: async () => {},
        _openMdEditor: ({ textareaEl }) => ({ value: (v) => { if (v !== undefined) textareaEl.value = v; return textareaEl.value; } }),
        _mdeDestroyEditor() {},
        // 詳細のボタンの入口 (bookshelf.js の openOrCreateBookMemo) のうち、アプリ内エディタの分岐と同じ呼び先
        openOrCreateBookMemo(asin) { return this._openBookMemoInAppEditor(asin, this.books.find((b) => b.asin === asin)); },
    });
    return app;
}

const memoBtn = () => document.querySelector('#book-detail-pane .memo-file-btn');
const memoModalOpen = () => document.getElementById('book-memo-modal').classList.contains('show');

// 詳細のボタンを押してアプリ内エディタを開き、本文を書く (完了はまだ押さない)
async function openAndWrite(app, text) {
    memoBtn().click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    app._bookMemoEditor.value(text);
}

describe('本の詳細の長文メモのボタン (イシュー#611)', () => {
    beforeEach(() => mountDom());

    it.each([['閲覧モード', false], ['編集モード', true]])('%s: 書いて「完了」すると、再読込なしで「長文メモを開く」になる', async (_label, edit) => {
        const app = makeApp();
        app.showBookDetail(book, edit);
        expect(memoBtn().textContent.trim()).toBe('長文メモを書く');

        await openAndWrite(app, '1行目\n2行目');
        expect(memoModalOpen()).toBe(true);
        const closed = await app._bookMemoFsDone();

        expect(closed).toBe(true);
        expect(memoModalOpen()).toBe(false);
        expect(app.written.length).toBe(1);
        expect(app.userData.notes[ASIN].hasDetailMemo).toBe(true);
        expect(memoBtn().textContent.trim()).toBe('長文メモを開く');
        // 描き直した時の中身 (アイコン＋文言) と同じになる
        expect(memoBtn().querySelector('.h-icon')).not.toBeNull();
    });

    it('保存に失敗したら、閉じずに「長文メモを書く」のまま', async () => {
        const app = makeApp({ writeBookMemo: async () => { throw new Error('書き込めません'); } });
        app.showBookDetail(book, false);
        await openAndWrite(app, '本文');
        const closed = await app._bookMemoFsDone();

        expect(closed).toBe(false);
        expect(memoModalOpen()).toBe(true);
        expect(app.userData.notes[ASIN]?.hasDetailMemo).toBeFalsy();
        expect(memoBtn().textContent.trim()).toBe('長文メモを書く');
    });

    it('読み込みに失敗して開いた時は、「完了」で保存せず閉じ、「長文メモを書く」のまま', async () => {
        const app = makeApp({ readBookMemo: async () => { throw new Error('通信エラー'); } });
        app.showBookDetail(book, false);
        memoBtn().click();
        await new Promise((r) => setTimeout(r, 0));
        expect(app._bookMemoEditorContext).toBeNull();
        const closed = await app._bookMemoFsDone();

        expect(closed).toBe(true);
        expect(memoModalOpen()).toBe(false);
        expect(app.written.length).toBe(0);
        expect(memoBtn().textContent.trim()).toBe('長文メモを書く');
    });

    it('既に長文メモがある本は、最初から「長文メモを開く」で描く (描画と書き換えが同じ関数を通る)', () => {
        const app = makeApp();
        app.userData.notes[ASIN] = { memo: '', rating: 0, hasDetailMemo: true };
        app.showBookDetail(book, false);
        const rendered = memoBtn().innerHTML.trim();
        expect(memoBtn().textContent.trim()).toBe('長文メモを開く');
        app._applyDetailMemoEverywhere(ASIN);
        expect(memoBtn().innerHTML.trim()).toBe(rendered);
    });
});
