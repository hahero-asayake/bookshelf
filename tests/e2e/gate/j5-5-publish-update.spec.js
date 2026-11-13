// 門のE2E (イシュー#588)。観測点 J5-5「更新が反映される」。
// 利用者と同じ操作だけで、記事を公開したあと題名を直してもう一度公開し、公開URLを開き直すと、新しい題名が見えて
// 古い題名は見えないことを確かめる。保存先・公開先はハブ (tests/e2e/helpers/gate-hub.js の模擬・本物の保存の経路)。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';

const OLD_TITLE = '門のE2E J5-5 最初に公開した題名';
const NEW_TITLE = '門のE2E J5-5 直してから公開した題名';
const BOOK_1 = 'フィクスチャの本 1';
const PUBLIC_URL_RE = /^https:\/\/bookshelf\.asayake\.org\/hahero\/[^/]+\/$/;

const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();
const articleBar = (page) => page.getByRole('toolbar', { name: '記事の操作' });

// 本棚の引き出しの「公開」から新しい記事を作り、本棚ブロックに本を1冊入れる (編集中のまま終わる)
async function createArticleWithBook(page, title) {
    await page.locator('[data-mobile-nav="shelves"]').tap();
    await page.locator('#sidebar-publish').tap();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.locator('#art-new').tap();
    await page.locator('#art-title').fill(title);
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
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-5 公開した記事の題名を直してもう一度公開すると、公開URLに新しい題名が出る', async ({ page }) => {
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

    await test.step('操作: 記事を作って本を1冊入れ、下の「公開」→「公開する」→「同意して公開」で公開する', async () => {
        await createArticleWithBook(page, OLD_TITLE);
        await articleBar(page).getByRole('button', { name: '公開' }).tap();
        await page.locator('#art-pub-go').tap();
        await page.getByRole('button', { name: '同意して公開' }).tap();
        await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#art-pub-url')).toHaveText(PUBLIC_URL_RE);
    });

    await test.step('操作: 公開パネルを閉じ、「完了」してから題名を直し、「編集」→下の「公開」→「公開する」', async () => {
        await page.locator('#art-pub-close').tap();
        await expect(page.locator('#art-publish-modal')).toBeHidden();
        await articleBar(page).getByRole('button', { name: '完了' }).tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'view');
        await page.locator('#art-title').fill(NEW_TITLE);
        // 390幅では見出しの「公開する」が出ない。編集に入って下の操作バーの「公開」から公開する
        await page.locator('#art-mode-edit').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        await articleBar(page).getByRole('button', { name: '公開' }).tap();
        await expect(page.locator('#art-publish-modal')).toBeVisible();
        await expect(page.locator('#art-pub-done')).toBeHidden();
        await page.locator('#art-pub-go').tap();
        await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
    });

    await test.step('操作: 公開URLを押して開く', async () => {
        const opened = page.waitForEvent('popup');
        await page.locator('#art-pub-url').tap();
        publicPage = await opened;
        await publicPage.waitForLoadState('domcontentloaded');
    });

    await test.step('確認: 公開URLのページに新しい題名が見え、古い題名は見えない', async () => {
        await expect(publicPage).toHaveURL(PUBLIC_URL_RE);
        await expect(publicPage.locator('body')).toContainText(NEW_TITLE);
        await expect(publicPage.locator('body')).not.toContainText(OLD_TITLE);
    });
});
