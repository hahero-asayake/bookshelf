// 門のE2E (イシュー#590)。観測点 J1-1「蔵書0で案内が出る」。
// 何も入っていない状態 (蔵書0・保存先を決めていない) でアプリの URL を開くと、ホームに初回の案内
// (3つの手順と「保存先を選ぶ」) が見えることを、内部を呼ばずに確かめる。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';

const welcome = (page) => page.locator('#dashboard-welcome');

test('@gate J1-1 蔵書0でアプリを開くと、ホームに初回の案内と「保存先を選ぶ」が見える', async ({ page }) => {
    await test.step('操作: 何も入っていないブラウザでアプリの URL を開く', async () => {
        await page.goto('index.html');
    });

    await test.step('確認: ホームに初回の案内が出て、3つの手順と「保存先を選ぶ」ボタンが見える', async () => {
        await expect(welcome(page)).toBeVisible();
        await expect(welcome(page)).toContainText('AsayakeBookshelf へようこそ');
        await expect(welcome(page).locator('.dw-step')).toHaveCount(3);
        await expect(welcome(page).locator('.dw-step').first()).toContainText('保存先を選ぶ');
        await expect(welcome(page).locator('button[data-dw="sync"]')).toHaveText('保存先を選ぶ');
        await expect(welcome(page).locator('button[data-dw="import"]')).toBeVisible();
    });
});
