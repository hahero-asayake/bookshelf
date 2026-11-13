// 門のE2E (イシュー#588)。観測点 J5-6「非公開・削除が反映される」。
// 利用者と同じ操作だけで、公開した記事を「公開を取り消す」と、公開URLで読めなくなり一覧が「未公開」になること、
// 公開した記事を「削除」すると、一覧から消えて公開URLでも読めなくなることを確かめる。
// 保存先・公開先はハブ (tests/e2e/helpers/gate-hub.js の模擬・本物の保存の経路)。公開URLは利用者が控えた URL を
// 新しいタブで開き直す。書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';

const BOOK_1 = 'フィクスチャの本 1';
const PUBLIC_URL_RE = /^https:\/\/bookshelf\.asayake\.org\/hahero\/[^/]+\/$/;

const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();
const articleBar = (page) => page.getByRole('toolbar', { name: '記事の操作' });
const articleRow = (page, title) => page.locator('#art-list .pp-row', { hasText: title });

// 本棚の引き出しの「公開」から新しい記事を作って本を1冊入れ、下の「公開」から公開し、公開パネルを閉じて「完了」する。
// 出た公開URLを返す (利用者が控える URL)
async function createAndPublish(page, title) {
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
    await articleBar(page).getByRole('button', { name: '公開' }).tap();
    await page.locator('#art-pub-go').tap();
    await page.getByRole('button', { name: '同意して公開' }).tap();
    await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#art-pub-url')).toHaveText(PUBLIC_URL_RE);
    const url = await page.locator('#art-pub-url').textContent();
    await page.locator('#art-pub-close').tap();
    await expect(page.locator('#art-publish-modal')).toBeHidden();
    await articleBar(page).getByRole('button', { name: '完了' }).tap();
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'view');
    return url;
}

// 控えた公開URLを新しいタブで開く
async function openInNewTab(page, url) {
    const tab = await page.context().newPage();
    await tab.goto(url);
    return tab;
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-6 公開を取り消すと、公開URLで読めなくなり、一覧が未公開になる', async ({ page }) => {
    const TITLE = '門のE2E J5-6 取り消す記事';
    let hub = null;
    let publicUrl = null;
    let tab = null;

    await test.step('前提: ハブに蔵書を置き、ハブにログインして保存先と公開先をハブにした状態でアプリを開く', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('操作: 記事を作って公開し、公開URLを新しいタブで開く', async () => {
        publicUrl = await createAndPublish(page, TITLE);
        tab = await openInNewTab(page, publicUrl);
    });

    await test.step('確認: 取り消す前は、公開URLで題名が読める', async () => {
        await expect(tab.locator('body')).toContainText(TITLE);
    });

    await test.step('操作: 「その他の操作」→「公開を取り消す」→ 確認で「公開を取り消す」、記事の一覧へ戻る', async () => {
        await tab.close();
        await page.getByRole('button', { name: 'その他の操作' }).tap();
        await page.getByRole('menuitem', { name: '公開を取り消す' }).tap();
        await page.getByRole('dialog').getByRole('button', { name: '公開を取り消す' }).tap();
        // 取り消しはハブへの書き込みが済んでから知らせが出る (js/screens/article-editor.js _artUnpublish)
        await expect(page.getByText(`「${TITLE}」の公開を取り消しました。`)).toBeVisible({ timeout: 15000 });
        await page.locator('#art-back').tap();
        await expect(page.locator('#art-list-view')).toBeVisible();
    });

    await test.step('確認: 一覧のその記事が「○ 未公開」になる', async () => {
        await expect(articleRow(page, TITLE)).toContainText('○ 未公開');
    });

    await test.step('操作: 控えた公開URLを新しいタブで開き直す', async () => {
        tab = await openInNewTab(page, publicUrl);
    });

    await test.step('確認: 公開URLは読めず (404)、題名は出ない', async () => {
        await expect(tab.locator('body')).toContainText('404');
        await expect(tab.locator('body')).not.toContainText(TITLE);
    });
});

test('@gate J5-6 公開した記事を削除すると、一覧から消え、公開URLでも読めなくなる', async ({ page }) => {
    const TITLE = '門のE2E J5-6 削除する記事';
    let hub = null;
    let publicUrl = null;
    let tab = null;

    await test.step('前提: ハブに蔵書を置き、ハブにログインして保存先と公開先をハブにした状態でアプリを開く', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('操作: 記事を作って公開し、「その他の操作」→「削除」→ 確認で削除する', async () => {
        publicUrl = await createAndPublish(page, TITLE);
        await page.getByRole('button', { name: 'その他の操作' }).tap();
        await page.getByRole('menuitem', { name: '削除' }).tap();
        await page.getByRole('dialog').getByRole('button', { name: '削除', exact: true }).tap();
        await expect(page.locator('#art-list-view')).toBeVisible();
    });

    await test.step('確認: 記事の一覧からその記事が消える', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(0);
    });

    await test.step('操作: 控えた公開URLを新しいタブで開く', async () => {
        tab = await openInNewTab(page, publicUrl);
    });

    await test.step('確認: 公開URLは読めず (404)、題名は出ない', async () => {
        await expect(tab.locator('body')).toContainText('404');
        await expect(tab.locator('body')).not.toContainText(TITLE);
    });
});
