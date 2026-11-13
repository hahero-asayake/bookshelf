// lint:e2e-gate のテスト用の見本(実行はしない)。正しい書き方 = 違反0件。
import { test, expect } from './helpers/test-base.js';
import { seedLibraryForTest, mockHubForTest } from './helpers/setup.js';
import { clickAddBlock, pingA } from './helpers/ops.js';

test.beforeEach(async ({ page }) => {
    await mockHubForTest(page);
});

test('@gate J5-2 キャンバスで本棚ブロックをタップして本を足す', async ({ page }) => {
    const bookTitle = '吾輩は猫である';
    await test.step('前提: 蔵書を入れて起動する', async () => {
        await seedLibraryForTest(page, { books: 3 });
    });
    await test.step('操作: 記事を作り、本棚ブロックを足す', async () => {
        await page.goto('index.html');
        await page.locator('#nav-publish').click();
        await page.locator('#art-new').click();
        await page.locator('#art-title').fill('見本の記事');
        await clickAddBlock(page);
        await pingA(page);
        await expect(page.locator('#art-drawer')).toBeVisible();
        await page.locator('#art-drawer').getByText(bookTitle).click();
    });
    await test.step('確認: 足した本の書名がキャンバスに見える', async () => {
        await expect(page.frameLocator('#art-canvas-frame').locator('section.art-cv-blk')).toContainText(bookTitle);
    });
});

test('門に数えないテストは今の書き方のままでよい', async ({ page }) => {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    expect(await page.title()).toBe('AsayakeBookshelf');
});
