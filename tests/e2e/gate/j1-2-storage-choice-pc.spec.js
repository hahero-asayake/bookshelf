// 門のE2E (イシュー#590)。観測点 J1-2「その端末で使える保存先だけ選べる」の PC の分。
// PC (フォルダを選ぶ API がある Chrome/Edge) では、初回の案内の「保存先を選ぶ」から開いた設定で、
// 保存先3つ (ハブ・この端末のフォルダ・GitHub) がどれも選べることを確かめる。iPhone 相当は
// j1-2-storage-choice-phone.spec.js。書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';

const methodSelect = (page) => page.locator('#sync-method-select');
const option = (page, value) => methodSelect(page).locator(`option[value="${value}"]`);

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J1-2 PC では、初回の案内から開いた設定で保存先3つ (ハブ・この端末のフォルダ・GitHub) をどれも選べる', async ({ page }) => {
    await test.step('前提: 何も入っていない状態でアプリを開いておく', async () => {
        await bootAppForTest(page);
    });

    await test.step('操作: ホームの案内の「保存先を選ぶ」を押す', async () => {
        await page.locator('#dashboard-welcome button[data-dw="sync"]').click();
        await expect(methodSelect(page)).toBeVisible();
    });

    await test.step('確認: 保存先の選択肢が3つあり、どれも選べる (まだ決めていない人にはハブが最初に見える)', async () => {
        await expect(methodSelect(page).locator('option')).toHaveCount(3);
        await expect(option(page, 'hub')).toBeEnabled();
        await expect(option(page, 'local')).toBeEnabled();
        await expect(option(page, 'github')).toBeEnabled();
        await expect(methodSelect(page)).toHaveValue('hub');
    });

    await test.step('操作: 「この端末のフォルダ」を選ぶ', async () => {
        await methodSelect(page).selectOption('local');
    });

    await test.step('確認: フォルダを選ぶボタンが見える', async () => {
        await expect(methodSelect(page)).toHaveValue('local');
        await expect(page.locator('#obsidian-sync-btn')).toBeVisible();
    });

    await test.step('操作: 「GitHub」を選ぶ', async () => {
        await methodSelect(page).selectOption('github');
    });

    await test.step('確認: GitHub に接続するボタンが見え、フォルダのボタンは隠れる', async () => {
        await expect(methodSelect(page)).toHaveValue('github');
        await expect(page.locator('#github-connect-btn')).toBeVisible();
        await expect(page.locator('#obsidian-sync-btn')).toBeHidden();
    });
});
