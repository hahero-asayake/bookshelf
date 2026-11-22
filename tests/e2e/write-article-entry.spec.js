// イシュー#770 (切り替え⑤ writeEntry＝#758 の本の詳細の入口・#768 の 9)。触れるモック (_vault-work/754/inject/entry.js・
// shelf754.js・two768.js、台本 _vault-work/768/harness/check768.mjs・smoke768.mjs) で確かめた形をアプリで見る。
//   本の詳細：.bd-actions の Amazon の右隣に「この本で記事を書く」。押すと本ブロック1つ (show は全部 false) の新しい記事が編集の状態で開く。
//     本棚の画面から開いた詳細なら、その本棚が記事の元の本棚 (sourceShelfId) になる
//   本棚の画面：帯の右の道具の列の末尾に pencil の角ボタン「この本棚で記事を書く」(すべての本では出さない)。
//     押すとその本棚の本を全部入れた本棚ブロック1つの新しい記事が開く (引き出しは閉じている)
//   localStorage 'bookshelf.flag.writeEntry' = '0' でどちらも出ない。
// 390幅 (iPhone 相当) の webkit は playwright.config の webkit / gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { getArtDraft } from './helpers/art-editor.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SHELF_NAME = 'テスト本棚';
const SHELF_KEY = 'fixshelf01';

// ハブの模擬で起動する。flag は起動の後に page.evaluate で入れる (addInitScript は再読込のたびに走るため使わない)
async function boot(page, { flag = null } = {}) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    // 自作の本棚を1つ足す (ハブの見本は「すべて」だけ)。本は蔵書の先頭3冊
    const all = JSON.parse(hub.files.get('private/bookshelves/all.json').content).books;
    const put = (path, data) => { hub.seq += 1; hub.files.set(path, { content: JSON.stringify(data), etag: `"v${hub.seq}"` }); };
    put('private/bookshelves.json', { bookshelves: [
        { internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true },
        { internalId: SHELF_KEY, slug: 'fixshelf', name: SHELF_NAME, parent: 'fixall001' },
    ] });
    put('private/bookshelves/fixshelf.json', { books: all.slice(0, 3) });
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    if (flag != null) await page.evaluate((v) => localStorage.setItem('bookshelf.flag.writeEntry', v), flag);
}

// 左ナビ (スマホは引き出し) の木から本棚を開く
async function openShelf(page, name) {
    const narrow = await page.evaluate(() => window.matchMedia('(max-width: 900px)').matches);
    if (narrow) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
    }
    const node = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: name }).first();
    // 子の本棚は「すべて」の下に畳まれている時がある＝開く
    if (!(await node.isVisible())) await page.locator('#sidebar-bookshelf-tree .tree-node.lv0 .tree-toggle').first().click();
    await node.click();
    await expect(page.locator('#current-bookshelf-title')).toContainText(name);
    await expect(page.locator('#bookshelf .book-item').first()).toBeVisible();
}

const shelfBooks = (page) => page.evaluate(() => [...document.querySelectorAll('#bookshelf .book-item')].map((el) => el.dataset.asin));

async function expectEditorOpen(page) {
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
}

for (const dev of [
    { name: 'PC 1280', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'スマホ390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA } },
]) {
    test.describe(`${dev.name}: 記事を書く入口 (既定＝on)`, () => {
        test.use(dev.use);

        test('9: 本棚の画面の角ボタンで、その本棚の本を全部入れた本棚ブロックの記事が開く・すべての本では出ない', async ({ page }) => {
            await boot(page);
            await openShelf(page, SHELF_NAME);
            const btn = page.locator('#shelf-write-article');
            await expect(btn).toBeVisible();
            await expect(btn).toHaveAttribute('aria-label', 'この本棚で記事を書く');
            // 帯の右の道具の列の末尾
            expect(await page.evaluate(() => document.querySelector('#bookshelf-toolbar > :last-child').id)).toBe('shelf-write-article');
            const asins = await shelfBooks(page);
            await btn.click();
            await expectEditorOpen(page);
            await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
            const d = await getArtDraft(page);
            expect(d.sourceShelfId).toBe(SHELF_KEY);
            expect(d.blocks).toHaveLength(1);
            expect(d.blocks[0].type).toBe('shelf');
            expect(d.blocks[0].shelfId).toBe(SHELF_KEY);
            expect(d.blocks[0].items.map((it) => it.asin).sort()).toEqual([...asins].sort());
            // 題の下の入口は作らない
            await expect(page.locator('.bvh-text .amazon-link')).toHaveCount(0);
        });

        test('9: すべての本では角ボタンを出さない', async ({ page }) => {
            await boot(page);
            await openShelf(page, SHELF_NAME);
            await expect(page.locator('#shelf-write-article')).toBeVisible();
            await openShelf(page, 'すべて');
            await expect(page.locator('#shelf-write-article')).toBeHidden();
        });

        test('#758: 本棚の画面から開いた本の詳細の「この本で記事を書く」で、本ブロック1つの記事が開く (元の本棚＝その本棚)', async ({ page }) => {
            await boot(page);
            await openShelf(page, SHELF_NAME);
            const asin = (await shelfBooks(page))[0];
            await page.locator(`#bookshelf .book-item[data-asin="${asin}"]`).first().click();
            const link = page.locator('.bd-actions .bd-write-article:visible');
            await expect(link).toHaveText('この本で記事を書く');
            // Amazon の右隣
            expect(await link.evaluate((el) => el.previousElementSibling && el.previousElementSibling.textContent.trim())).toBe('Amazon');
            await link.click();
            await expectEditorOpen(page);
            const d = await getArtDraft(page);
            expect(d.sourceShelfId).toBe(SHELF_KEY);
            expect(d.blocks).toEqual([{ id: d.blocks[0].id, type: 'book', asin, show: { shortMemo: false, longMemo: false, rating: false } }]);
            await expect(page.locator('#art-blocks .art-block, #art-canvas-frame').first()).toBeAttached();
        });
    });
}

test.describe('PC 1280: writeEntry=0 で入口を出さない', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('本棚の画面の角ボタンも、本の詳細の「この本で記事を書く」も無い', async ({ page }) => {
        await boot(page, { flag: '0' });
        await openShelf(page, SHELF_NAME);
        await expect(page.locator('#shelf-write-article')).toBeHidden();
        const asin = (await shelfBooks(page))[0];
        await page.locator(`#bookshelf .book-item[data-asin="${asin}"]`).first().click();
        await expect(page.locator('.bd-actions .amazon-link').first()).toBeVisible();
        await expect(page.locator('.bd-write-article')).toHaveCount(0);
    });
});
