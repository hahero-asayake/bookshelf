// イシュー#530(1・案c): 本棚ブロック(1冊)⇄本ブロックの切替。
// 両方向で短文メモ・評価の表示設定を引き継ぎ、長文メモの本文(ASIN単位ファイル・private/books/)が
// 切替そのものでは消えないことを確認する(②承認条件)。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    await page.route('https://mockhub.test/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.addInitScript(([library]) => {
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify({
            bookshelves: [{ id: 'all', internalId: 'fixall001', name: 'すべての本', iconName: 'library', isSpecial: true, books: JSON.parse(library).books.map(b => b.asin), notes: {} }],
            notes: {}, settings: { version: '2.0', disabledPlugins: [] }, bookOrder: {}, stats: {}, version: '2.0',
            _storage: { allInternalId: 'fixall001', exclusions: [] }
        }));
    }, [fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
        const adapter = window.bookshelf.storage.adapter;
        const mem = new Map();
        const text = new Map();
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (text.has(p) ? text.get(p) : null);
        adapter.writeText = async (p, c) => { text.set(p, c); };
        adapter.fileExists = async (p) => text.has(p);
        window.bookshelf.flushSync = async () => {};
        window.bookshelf._isSyncReady = () => true;
        window.bookshelf._scheduleSync = () => {};
    });
}

// 900px以下はサイドバーがドロワー化し#sidebar-publishが画面外に出る(article-ops-count.spec.jsの
// openPublishPagesModalと同型・#528で踏んだ罠)。モバイル幅も通すため同じ分岐を踏襲する。
async function openPublishPagesModal(page) {
    const btn = page.locator('#sidebar-publish');
    const box0 = await btn.boundingBox();
    if (!box0 || box0.x < 0) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await page.waitForTimeout(350);
    }
    await btn.click({ force: true });
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
}

test('本棚ブロック(1冊)→本ブロック→本棚ブロックの往復で、短文メモ・評価の表示設定を引き継ぎ、長文メモ本文は消えない', async ({ page }) => {
    await bootApp(page);
    const asin = JSON.parse(fixtureLibrary).books[0].asin;
    const longMemoText = '# 長文メモの本文\n切替しても消えないはず。';

    // 長文メモ本文を先に書き込む(ASIN単位ファイル・ブロックのshowとは独立)
    await page.evaluate(async ([a, content]) => {
        const book = window.bookshelf.books.find(b => b.asin === a);
        await window.bookshelf.storage.writeBookMemo(a, book.title, content);
    }, [asin, longMemoText]);

    // 記事を新規作成し、本棚ブロックに1冊入れる
    await openPublishPagesModal(page);
    await page.click('#art-new');
    await page.click('#art-mode-edit');
    await page.fill('#art-title', '切替テスト');

    const canvas = page.frameLocator('#art-canvas-frame');
    await canvas.locator('.art-cv-ins-btn').last().click();
    await page.locator('#art-add-sheet [data-block-type="shelf"]').click();
    const items = page.locator('#art-drawer-list .art-drawer-item');
    await items.nth(0).click();

    // 短文メモ・評価の表示をONにする(切替後に引き継がれることを見るため)
    await page.evaluate(() => {
        const block = window.bookshelf._artDraft.blocks.find(b => b.type === 'shelf');
        block.items[0].show = { shortMemo: true, rating: true };
        window.bookshelf._artRenderBlocks();
    });

    // 900px以下は引き出しがボトムシート化し、開いたままだとスクリムが切替ボタンのクリックを
    // 奪う(#529のA-c=本棚ブロックを足すと自動で開き、完了まで閉じない設計)。閉じるボタンで畳む。
    // #art-sheet-close自体はDOM上常駐するため isVisible() では閉状態(画面外へtransform)を区別
    // できず、#art-drawer.is-openで判定する。
    const sheetClose = page.locator('#art-sheet-close');
    const closeSheetIfOpen = async () => {
        const open = await page.locator('#art-drawer').evaluate(el => el.classList.contains('is-open'));
        if (open) await sheetClose.click();
    };
    await closeSheetIfOpen();

    // 切替ボタン(長文メモを付けて紹介)が1冊の時だけ出ていること
    await expect(page.locator('.art-shelf-to-book-btn')).toBeVisible();
    await page.click('.art-shelf-to-book-btn');

    // type:'book'に変換され、show.shortMemo/ratingが引き継がれていること
    const afterToBook = await page.evaluate(() => {
        const b = window.bookshelf._artDraft.blocks[0];
        return { type: b.type, asin: b.asin, show: b.show };
    });
    expect(afterToBook.type).toBe('book');
    expect(afterToBook.asin).toBe(asin);
    expect(afterToBook.show.shortMemo).toBe(true);
    expect(afterToBook.show.rating).toBe(true);

    // 長文メモ本文は消えていない
    const memoAfterToBook = await page.evaluate(async (a) => {
        const book = window.bookshelf.books.find(b => b.asin === a);
        return window.bookshelf.storage.readBookMemo(a, book.title);
    }, asin);
    expect(memoAfterToBook).toBe(longMemoText);

    // 「本棚ブロックに戻す」ボタンで逆方向(同じくシートが開いていれば先に畳む)
    await closeSheetIfOpen();
    await expect(page.locator('.art-book-to-shelf')).toBeVisible();
    await page.click('.art-book-to-shelf');

    const afterToShelf = await page.evaluate(() => {
        const b = window.bookshelf._artDraft.blocks[0];
        return { type: b.type, items: b.items };
    });
    expect(afterToShelf.type).toBe('shelf');
    expect(afterToShelf.items[0].asin).toBe(asin);
    expect(afterToShelf.items[0].show.shortMemo).toBe(true);
    expect(afterToShelf.items[0].show.rating).toBe(true);

    // 長文メモ本文はこの往復でも消えていない
    const memoAfterToShelf = await page.evaluate(async (a) => {
        const book = window.bookshelf.books.find(b => b.asin === a);
        return window.bookshelf.storage.readBookMemo(a, book.title);
    }, asin);
    expect(memoAfterToShelf).toBe(longMemoText);
});
