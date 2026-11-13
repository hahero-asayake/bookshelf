// lint:e2e-gate のテスト用の見本(実行はしない)。前提のヘルパーがアプリ自身のファイルへの通信を差し替えている。
import { test, expect } from './helpers/test-base.js';
import { mockHubForTest, stubAppScriptForTest, stubAllForTest } from './helpers/setup.js';

test('@gate J8-1 アプリのファイルを差し替えて起動している', async ({ page }) => {
    await test.step('前提: 通信を差し替える', async () => {
        await mockHubForTest(page);
        await stubAppScriptForTest(page);
        await stubAllForTest(page);
    });
    await test.step('操作: アプリを開く', async () => {
        await page.goto('index.html');
    });
    await test.step('確認: 本棚が見える', async () => {
        await expect(page.locator('#bookshelf')).toBeVisible();
    });
});
