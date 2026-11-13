// lint:e2e-gate のテスト用の見本(実行はしない)。前提の区間・beforeEach に helpers 以外を書いている。
import { test, expect } from './helpers/test-base.js';
import { seedLibraryForTest } from './helpers/setup.js';

async function bootApp(page) {
    await page.goto('index.html');
}

test('@gate J1-1 前提に直書きと自作関数がある', async ({ page }) => {
    await test.step('前提: 直書きで起動する', async () => {
        await page.addInitScript(() => localStorage.clear());
        await bootApp(page);
        await seedLibraryForTest(page);
    });
    await test.step('操作: アプリを開く', async () => {
        await page.goto('index.html');
    });
    await test.step('確認: 案内が出る', async () => {
        await expect(page.locator('#empty-guide')).toBeVisible();
    });
});

test.describe('beforeEach も前提として扱う', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('index.html');
    });

    test('@gate J1-2 保存先を選べる', async ({ page }) => {
        await test.step('操作: 設定を押す', async () => {
            await page.locator('#settings-btn').click();
        });
        await test.step('確認: 保存先が見える', async () => {
            await expect(page.locator('#sync-method')).toBeVisible();
        });
    });
});
