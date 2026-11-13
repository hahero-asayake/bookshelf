// 門のE2E (イシュー#590)。観測点 J3-4「戻る・進む・Escで迷子にならない」の PC (1280幅) の分。
// ホーム → 本棚 → 本の詳細 と進み、Esc・ブラウザの戻る・進むで、見えている画面と URL が期待どおりかを確かめる。
// 390幅 (タッチ) は j3-4-back-forward-esc-phone.spec.js。書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';

const listItems = (page) => page.locator('#bookshelf .book-item');
const detail = (page) => page.locator('#book-detail-pane');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J3-4 PC で本棚→本の詳細→Esc→戻る→進む と操作しても、見えている画面と URL が食い違わない', async ({ page }) => {
    await test.step('前提: 蔵書を入れた状態でアプリを開いておく (ホーム)', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
    });

    await test.step('操作: 「すべての本」を開き、「フィクスチャの本 3」を押す', async () => {
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
        await listItems(page).filter({ hasText: 'フィクスチャの本 3' }).click();
    });

    await test.step('確認: 詳細にその本が見え、URL がその本になる', async () => {
        await expect(page).toHaveURL(/#book\/B000000003$/);
        await expect(detail(page)).toContainText('フィクスチャの本 3');
    });

    await test.step('操作: Esc を押す', async () => {
        await page.keyboard.press('Escape');
    });

    await test.step('確認: 詳細が閉じて本棚の一覧に戻り、URL も本棚になる', async () => {
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await expect(detail(page)).not.toContainText('フィクスチャの本 3');
        await expect(listItems(page)).toHaveCount(5);
    });

    await test.step('操作: ブラウザの「戻る」を押す', async () => {
        await page.goBack();
    });

    await test.step('確認: ホームに戻り、URL も本棚ではなくなる', async () => {
        await expect(page).not.toHaveURL(/#\/bookshelf\//);
        await expect(page.locator('#dashboard')).toBeVisible();
    });

    await test.step('操作: ブラウザの「進む」を押す', async () => {
        await page.goForward();
    });

    await test.step('確認: 本棚の一覧に戻り、URL も本棚になる', async () => {
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await expect(listItems(page)).toHaveCount(5);
        await expect(page.locator('#dashboard')).toBeHidden();
    });
});
