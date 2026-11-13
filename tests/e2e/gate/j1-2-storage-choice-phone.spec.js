// 門のE2E (イシュー#590)。観測点 J1-2「その端末で使える保存先だけ選べる」の iPhone 相当の分。
// フォルダを選ぶ API が無い端末 (iOS Safari・Android のブラウザ) では、初回の案内の「保存先を選ぶ」から
// 開いた設定で「この端末のフォルダ」が選べず、ハブと GitHub だけが選べることを確かめる。
// 本物の WebKit での確認は #589 (門のE2Eを webkit でも流す) に乗る。書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest, emulatePhoneCapabilitiesForTest } from '../helpers/gate-setup.js';

const methodSelect = (page) => page.locator('#sync-method-select');
const option = (page, value) => methodSelect(page).locator(`option[value="${value}"]`);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('@gate J1-2 iPhone 相当では、初回の案内から開いた設定で「この端末のフォルダ」を選べず、ハブと GitHub だけ選べる', async ({ page }) => {
    await test.step('前提: フォルダを選ぶ API が無い端末で、何も入っていない状態のアプリを開いておく', async () => {
        await emulatePhoneCapabilitiesForTest(page);
        await bootAppForTest(page);
    });

    await test.step('操作: ホームの案内の「保存先を選ぶ」をタップする', async () => {
        await page.locator('#dashboard-welcome button[data-dw="sync"]').tap();
        await expect(methodSelect(page)).toBeVisible();
    });

    await test.step('確認: 「この端末のフォルダ」は選べず、ハブと GitHub は選べる', async () => {
        await expect(option(page, 'local')).toBeDisabled();
        await expect(option(page, 'hub')).toBeEnabled();
        await expect(option(page, 'github')).toBeEnabled();
        await expect(methodSelect(page)).toHaveValue('hub');
    });

    await test.step('操作: 「GitHub」を選ぶ', async () => {
        await methodSelect(page).selectOption('github');
    });

    await test.step('確認: GitHub に接続するボタンが見える', async () => {
        await expect(methodSelect(page)).toHaveValue('github');
        await expect(page.locator('#github-connect-btn')).toBeVisible();
    });
});
