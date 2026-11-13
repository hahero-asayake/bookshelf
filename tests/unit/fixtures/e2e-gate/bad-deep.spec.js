// lint:e2e-gate のテスト用の見本(実行はしない)。呼んだヘルパーの連なりが、辿る深さの上限を超えている。
import { test, expect } from './helpers/test-base.js';
import { deep1 } from './helpers/deep.js';

test('@gate J3-1 深すぎるヘルパーを呼んでいる', async ({ page }) => {
    await test.step('操作: 本を押す', async () => {
        await deep1(page);
    });
    await test.step('確認: 詳細が見える', async () => {
        await expect(page.locator('#book-detail')).toBeVisible();
    });
});
