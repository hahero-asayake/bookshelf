// 門のE2E (イシュー#590)。観測点 J3-4「戻る・進む・Escで迷子にならない」の 390幅 (タッチ) の分。
// 下のナビの「本棚」→「すべての本」→ 本の詳細 と進み、ブラウザの戻る・進むで、見えている画面と URL が
// 期待どおりかを確かめる。書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';

const listItems = (page) => page.locator('#bookshelf .book-item');
const detail = (page) => page.locator('#book-detail-pane');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('@gate J3-4 390幅で本棚→本の詳細→戻る→進む と操作しても、見えている画面と URL が食い違わない', async ({ page }) => {
    await test.step('前提: 蔵書を入れた状態でアプリを開いておく (ホーム)', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
    });

    await test.step('操作: 下のナビの「本棚」→「すべての本」→「フィクスチャの本 3」をタップする', async () => {
        await page.locator('[data-mobile-nav="shelves"]').tap();
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').tap();
        await listItems(page).filter({ hasText: 'フィクスチャの本 3' }).tap();
    });

    await test.step('確認: 詳細にその本が見え、URL がその本になる', async () => {
        await expect(page).toHaveURL(/#book\/B000000003$/);
        await expect(detail(page)).toBeVisible();
        await expect(detail(page)).toContainText('フィクスチャの本 3');
    });

    await test.step('操作: ブラウザの「戻る」を押す', async () => {
        await page.goBack();
    });

    await test.step('確認: 詳細が閉じて本棚の一覧に戻り、URL も本棚になる', async () => {
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await expect(detail(page)).not.toContainText('フィクスチャの本 3');
        await expect(listItems(page).first()).toBeVisible();
    });

    await test.step('操作: ブラウザの「進む」を押す', async () => {
        await page.goForward();
    });

    await test.step('確認: もう一度その本の詳細が見え、URL もその本になる', async () => {
        await expect(page).toHaveURL(/#book\/B000000003$/);
        await expect(detail(page)).toContainText('フィクスチャの本 3');
    });
});
