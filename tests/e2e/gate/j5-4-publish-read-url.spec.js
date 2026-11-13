// 門のE2E (イシュー#588)。観測点 J5-4「公開すると公開URLで読める」(G-1)。
// 利用者と同じ操作だけで、記事を作って本を1冊置き、「公開する」から公開し、公開パネルに出た公開URLを開く。
// 開いたページ (模擬のハブに書かれた公開サイト・本番と同じ URL の形) に、記事の題名と置いた本の書名が見えることを確かめる。
// 保存先はハブ (tests/e2e/helpers/gate-hub.js の模擬)。保存先の読み書きは差し替えず、本物の保存の経路を通す。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';

const TITLE = '門のE2E J5-4 公開する記事';
const BOOK_1 = 'フィクスチャの本 1';
const PUBLIC_URL_RE = /^https:\/\/bookshelf\.asayake\.org\/hahero\/[^/]+\/$/;

const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-4 記事を公開し、公開パネルの公開URLを開くと題名と本の書名が読める', async ({ page }) => {
    let hub = null;
    let publicPage = null;

    await test.step('前提: ハブに蔵書を置き、ハブにログインして保存先と公開先をハブにした状態でアプリを開く', async () => {
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

    await test.step('操作: 下の「記事の操作」の「公開」から公開パネルを開いて公開する', async () => {
        // 390幅の編集中は、見出しの「公開する」ではなく下の操作バー (見た目・公開・完了) から公開する
        await page.getByRole('toolbar', { name: '記事の操作' }).getByRole('button', { name: '公開' }).tap();
        await expect(page.locator('#art-publish-modal')).toBeVisible();
        await page.locator('#art-pub-go').tap();
        // 無料プランでは、初めての公開の前に運営のアフィリエイト ID が付くことの確認が出る
        await page.getByRole('button', { name: '同意して公開' }).tap();
        await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
    });

    await test.step('確認: 公開パネルに、本番と同じ形の公開URLが出る', async () => {
        await expect(page.locator('#art-pub-url')).toHaveText(PUBLIC_URL_RE);
    });

    await test.step('操作: 公開URLを押して開く', async () => {
        const opened = page.waitForEvent('popup');
        await page.locator('#art-pub-url').tap();
        publicPage = await opened;
        await publicPage.waitForLoadState('domcontentloaded');
    });

    await test.step('確認: 開いたページは公開URLで、記事の題名と置いた本の書名が見える', async () => {
        await expect(publicPage).toHaveURL(PUBLIC_URL_RE);
        await expect(publicPage.locator('body')).toContainText(TITLE);
        await expect(publicPage.locator('body')).toContainText(BOOK_1);
    });
});
