// lint:e2e-gate のテスト用の見本(実行はしない)。操作・確認の区間に evaluate 系を直書きしている。
import { test, expect } from './helpers/test-base.js';
import { seedLibraryForTest } from './helpers/setup.js';

test('@gate J5-1 記事の入口を内部から開いている', async ({ page }) => {
    await test.step('前提: 蔵書を入れて起動する', async () => {
        await seedLibraryForTest(page);
    });
    await test.step('操作: 公開の画面を開く', async () => {
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    });
    await test.step('確認: 一覧が空である', async () => {
        const n = await page.locator('#art-list').evaluate((el) => el.children.length);
        expect(n).toBe(0);
    });
});
