// 門のE2E (イシュー#699)。観測点 J5-7「公開した記事の本から Amazon へ移れる」。
// 利用者と同じ操作だけで、記事を作って本を1冊置いて公開し、公開URLのページで本の表紙と題名を押す。
// 新しいタブが、置いた本の Amazon の商品ページ (https://www.amazon.co.jp/dp/<ASIN>) になることを確かめる。
// 公開ページの本のリンクは /go/<siteId>/<ASIN> (中継) で、公開ページの配信元 (bookshelf.asayake.org) から
// ハブの /go を経て Amazon へ送られる。配信元に /go の道が無いと、新しいタブは 404 になる (#699 の不具合)。
// 保存先はハブ (tests/e2e/helpers/gate-hub.js の模擬)、Amazon の商品ページも模擬 (gate-amazon.js) で、外へは出ない。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';
import { mockAmazonProductPageForTest } from '../helpers/gate-amazon.js';

const TITLE = '門のE2E J5-7 本から Amazon へ移る記事';
const BOOK_1 = 'フィクスチャの本 1';
const PUBLIC_URL_RE = /^https:\/\/bookshelf\.asayake\.org\/hahero\/[^/]+\/$/;
// 「フィクスチャの本 1」の ASIN は B000000001 (tests/fixtures/fixture-library.json)。タグ (?tag=…) は付いても付かなくてもよい
const AMAZON_BOOK_1_RE = /^https:\/\/www\.amazon\.co\.jp\/dp\/B000000001(\?|$)/;

const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-7 公開した記事の本の表紙と題名を押すと、新しいタブで Amazon の商品ページが開く', async ({ page }) => {
    let hub = null;
    let publicPage = null;
    let amazonPage = null;

    await test.step('前提: Amazon の商品ページを模擬し、ハブに蔵書を置き、保存先と公開先をハブにした状態でアプリを開く', async () => {
        await mockAmazonProductPageForTest(page);
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('操作: 本棚の引き出しの「公開」から新しい記事を作り、本棚ブロックに本を1冊入れる', async () => {
        await page.locator('[data-mobile-nav="shelves"]').tap();
        await page.locator('#sidebar-publish').tap();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await page.locator('#art-new').tap();
        await page.locator('#art-title').fill(TITLE);
        await page.locator('#art-mode-edit').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        // 挿入ボタンのタップがまれに届かない窓がある (#372・見本 J5-2 と同じ)。シートが開くまでだけやり直す
        await expect(async () => {
            await canvas(page).locator('.art-cv-ins-btn').last().tap();
            await expect(page.locator('#art-add-sheet [data-block-type="shelf"]')).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 15000 });
        await page.locator('#art-add-sheet [data-block-type="shelf"]').tap();
        await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
        await expect(drawerBook(page, BOOK_1)).toBeInViewport();
        await drawerBook(page, BOOK_1).tap();
        await page.locator('#art-fs-done').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        await expect(canvas(page).locator('section.art-cv-blk').first()).toContainText(BOOK_1);
    });

    await test.step('操作: 下の「記事の操作」の「公開」から公開し、公開パネルの公開URLを押して開く', async () => {
        await page.getByRole('toolbar', { name: '記事の操作' }).getByRole('button', { name: '公開' }).tap();
        await expect(page.locator('#art-publish-modal')).toBeVisible();
        await page.locator('#art-pub-go').tap();
        // 無料プランでは、初めての公開の前に運営のアフィリエイト ID が付くことの確認が出る
        await page.getByRole('button', { name: '同意して公開' }).tap();
        await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
        const opened = page.waitForEvent('popup');
        await page.locator('#art-pub-url').tap();
        publicPage = await opened;
        await publicPage.waitForLoadState('domcontentloaded');
    });

    await test.step('確認: 開いたページは公開URLで、置いた本の書名が見える', async () => {
        await expect(publicPage).toHaveURL(PUBLIC_URL_RE);
        await expect(publicPage.locator('body')).toContainText(BOOK_1);
    });

    await test.step('操作: 公開ページの本の表紙を押す', async () => {
        const opened = publicPage.waitForEvent('popup');
        await publicPage.locator('a.bk-cover-link').first().tap();
        amazonPage = await opened;
    });

    await test.step('確認: 新しいタブが、置いた本の Amazon の商品ページになる', async () => {
        await expect(amazonPage).toHaveURL(AMAZON_BOOK_1_RE);
        await expect(amazonPage.locator('body')).toContainText('Amazon の商品ページ (模擬)');
    });

    await test.step('操作: 新しいタブを閉じ、公開ページの本の題名を押す', async () => {
        await amazonPage.close();
        const opened = publicPage.waitForEvent('popup');
        await publicPage.locator('.bk-title a', { hasText: BOOK_1 }).first().tap();
        amazonPage = await opened;
    });

    await test.step('確認: 題名からも、同じ Amazon の商品ページが開く', async () => {
        await expect(amazonPage).toHaveURL(AMAZON_BOOK_1_RE);
        await expect(amazonPage.locator('body')).toContainText('Amazon の商品ページ (模擬)');
    });
});
