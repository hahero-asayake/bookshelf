// 門のE2E (イシュー#629)。観測点 J1-3「接続が完了したと分かる」・J1-4「再読込しても保存先が残る」の、保存先「Asayake ハブ」の分。
// 何も入っていない端末で、初回の案内の「保存先を選ぶ」からハブを選び、案内に従ってアカウントで規約に同意して
// Google でログインすると、接続済み (メールアドレスでログイン中) と分かること。「この設定で使う」で開き直した後も、
// 利用者が再読込した後も、保存先がハブでログイン中のままであることを確かめる。
// ハブと Google のログインは外部なので、前提の区間で模擬する (helpers/gate-hub.js。ログインの応答は本物の
// cf-worker/asayake-hub.js の handleSession と同じく、記録の無い利用者を無料・空で作る)。
// 新しい利用者のハブは空なので、開き直した時に「保存データがありません。新規データで初期化しますか？」が出る
// (js/bookshelf.js の initCloudSync)。利用者はここで OK を押す。書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, resetHubStateForTest, mockHubForTest, mockHubSessionForTest, mockGoogleSignInForTest } from '../helpers/gate-hub.js';

const EMAIL = 'taro@example.com';
// 模擬のハブの状態。同じ worker で繰り返し流しても前の回の中身が残らないよう、前提の区間で毎回作り直す
const hub = createHubStateForTest();
const methodSelect = (page) => page.locator('#sync-method-select');

// 下のナビの「設定」から「同期」を開く (利用者の操作だけ)
async function tapToSyncSettings(page) {
    await page.locator('[data-mobile-nav="settings"]').tap();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').tap();
    await expect(methodSelect(page)).toBeVisible();
}

// 再読込の後、ハブからの読み込みが済むまで待つ (読み込み中の覆いと「最新のデータを確認しています…」の行が消える)。
// 下のナビは起動の前から見えているので、済む前に押すと何も起きない
async function waitHubReady(page) {
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('.status-row.status-checking')).toHaveCount(0);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J1-3 J1-4 スマホ幅で、初回の案内からハブを選び、規約に同意して Google でログインすると接続済みと分かり、使い始めた後も再読込の後も保存先はハブのまま', async ({ page }) => {
    await test.step('前提: 何も入っていない状態のアプリを開いておく (ハブと Google のログインは模擬・ハブはまだ空の新しい利用者)', async () => {
        resetHubStateForTest(hub);
        await mockHubForTest(page, hub);
        await mockHubSessionForTest(page, hub);
        await mockGoogleSignInForTest(page);
        await bootAppForTest(page);
    });

    await test.step('操作: ホームの案内の「保存先を選ぶ」をタップし、保存先を「Asayake ハブ」にする', async () => {
        await page.locator('#dashboard-welcome button[data-dw="sync"]').tap();
        await expect(methodSelect(page)).toBeVisible();
        await methodSelect(page).selectOption('hub');
    });

    await test.step('確認: まだログインしていないので、アカウントでログインするよう案内される', async () => {
        await expect(page.locator('#hub-disc-msg')).toContainText('まず「アカウント」で Google ログイン');
        await expect(page.locator('#hub-goto-account')).toBeVisible();
    });

    await test.step('操作: 「アカウントでログイン」をタップし、規約に同意して、Google でログインする', async () => {
        await page.locator('#hub-goto-account').tap();
        await page.locator('#account-consent-check').check();
        // Google のログインボタンは、アカウントと同期のハブの2か所に描かれる。いま見えているのはアカウントの方 (先に並ぶ)
        await page.getByRole('button', { name: 'Google でログイン（模擬）' }).first().tap();
    });

    await test.step('確認: アカウントに、ログインしたメールアドレスが出る (J1-3)', async () => {
        await expect(page.locator('#account-connected')).toBeVisible();
        await expect(page.locator('#account-email')).toHaveText(EMAIL);
    });

    await test.step('操作: 「← 設定」で一覧へ戻り、「同期」を開く', async () => {
        await page.locator('#settings-back').tap();
        await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').tap();
    });

    await test.step('確認: 同期のハブの欄も「<メールアドレス> でログイン中」になり、まだ保存先ではないので「この設定で使う」を押せる (J1-3)', async () => {
        await expect(methodSelect(page)).toHaveValue('hub');
        await expect(page.locator('#hub-auth-connected')).toBeVisible();
        await expect(page.locator('#hub-connected-email')).toHaveText(EMAIL);
        await expect(page.locator('#hub-auth-connected')).toContainText('でログイン中');
        await expect(page.locator('#hub-active-state')).toContainText('まだ本のデータの保存先になっていません');
        await expect(page.locator('#hub-use-btn')).toHaveText('この設定で使う');
        await expect(page.locator('#hub-use-btn')).toBeEnabled();
    });

    await test.step('操作: 「この設定で使う」をタップし (アプリは開き直す)、空のハブを新規データで始める確認で OK を押す', async () => {
        await page.locator('#hub-use-btn').tap();
        await expect(page.locator('.cfm-overlay')).toContainText('Asayake ハブ には保存データがありません');
        await page.locator('.cfm-overlay button', { hasText: 'OK' }).tap();
        await waitHubReady(page);
    });

    // 保存先の選択肢は、保存先を決めていない端末でも「ハブ」を表示する (js/screens/settings.js の viewMethod)。
    // 保存先として使っていることは、選択肢ではなく「この保存先を使用中です。」と「使用中」(押せない) で確かめる
    await test.step('確認: 開き直した後、同期の設定はハブを「使用中」で、ログイン中のまま (J1-4)', async () => {
        await tapToSyncSettings(page);
        await expect(methodSelect(page)).toHaveValue('hub');
        await expect(page.locator('#hub-connected-email')).toHaveText(EMAIL);
        await expect(page.locator('#hub-active-state')).toContainText('この保存先を使用中です。');
        await expect(page.locator('#hub-use-btn')).toHaveText('使用中');
        await expect(page.locator('#hub-use-btn')).toBeDisabled();
    });

    await test.step('操作: ページを再読込する', async () => {
        await page.reload();
        await waitHubReady(page);
    });

    await test.step('確認: 再読込の後も、初期化の確認は出ず、同期の設定はハブを「使用中」でログイン中のまま (J1-4)', async () => {
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
        await tapToSyncSettings(page);
        await expect(methodSelect(page)).toHaveValue('hub');
        await expect(page.locator('#hub-connected-email')).toHaveText(EMAIL);
        await expect(page.locator('#hub-active-state')).toContainText('この保存先を使用中です。');
        await expect(page.locator('#hub-use-btn')).toHaveText('使用中');
        await expect(page.locator('#hub-use-btn')).toBeDisabled();
    });
});
