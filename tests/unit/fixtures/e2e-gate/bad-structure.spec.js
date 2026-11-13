// lint:e2e-gate のテスト用の見本(実行はしない)。区間の組み方が崩れている。
import { test } from './helpers/test-base.js';

test('@gate J3-1 区間の外に文があり、知らない接頭辞があり、確認が無い', async ({ page }) => {
    await page.goto('index.html');
    await test.step('準備: 知らない接頭辞', async () => {});
    await test.step('操作: 本を押す', async () => {
        await page.locator('.book').first().click();
    });
});

test('@gate J3-2 確認に expect が無い', async ({ page }) => {
    await test.step('操作: 本棚を作る', async () => {
        await page.locator('#new-shelf').click();
    });
    await test.step('確認: 何も確かめていない', async () => {
        await page.locator('#shelf').isVisible();
    });
});
