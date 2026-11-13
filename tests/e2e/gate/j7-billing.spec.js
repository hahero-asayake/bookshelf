// 門のE2E: J7-1 アップグレードで Plus になる・J7-2 管理・解約ができる (イシュー#589)。
// 書き方の決まりは tests/e2e/gate/README.md。ハブと決済 (Stripe) は外部なので、前提の区間で模擬する (helpers/gate-hub.js)。
// 実際の決済・解約は人の実機の手順 H4 で確かめる。ここでは、アプリの画面の操作から決済のページへ行って戻り、
// 画面の表示が変わることを確かめる。
//
// 模擬の約束は本物 (cf-worker/asayake-hub.js) に合わせてある:
//  - POST /billing/checkout は Stripe Checkout の URL を返す。戻り先は success_url = `${戻り先}?billing=success`
//    (handleCheckout・1037-1038 行)。戻り先はクエリとハッシュを落とした origin+pathname (safeReturnUrl・1250-1260 行)
//  - POST /billing/portal は Billing Portal の URL を返す。戻り先 (return_url) にクエリは付かない (handleBillingPortal・1068 行)
//  - プランは Webhook が書く: 支払うと plan=plus・billingManaged=true (stripeCustomerId あり)・planSource='stripe'
//    (planSourceOf・356-361 行)。解約は cancel_at_period_end=true で、期間末まで Plus のまま (subMeta・1141-1152 行)
//  - GET /usage はそれらをそのまま返す (259-262 行)
// 保存先はローカルのまま、アカウント (ハブ) にだけログインした状態で始める (tests/e2e/account-billing.spec.js と同じ理由:
// 保存先をハブにすると、起動時にハブのデータの読み込みが始まる)。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, resetHubStateForTest, plusStateForTest, seedHubLoginForTest, mockHubForTest, mockBillingPagesForTest } from '../helpers/gate-hub.js';

// 模擬のハブの状態。テストごとに前提の区間で resetHubStateForTest して使う
const hub = createHubStateForTest();

// 下のナビの「設定」から「アカウント」を開く (利用者の操作だけ)
async function tapToAccountSettings(page) {
    await page.locator('[data-mobile-nav="settings"]').tap();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.locator('#settings-master .settings-cat[data-cat="account-section"]').tap();
    await expect(page.locator('#account-email')).toHaveText('taro@example.com');
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J7-1 無料のアカウントから、アップグレードして支払うと、Plus になり管理のボタンが出る', async ({ page }) => {
    await test.step('前提: 無料プランでハブにログインした状態で、アプリを開いておく (ハブと決済は模擬)', async () => {
        resetHubStateForTest(hub, { plan: 'free' });
        await seedHubLoginForTest(page, hub);
        await mockHubForTest(page, hub);
        await mockBillingPagesForTest(page, hub);
        await bootAppForTest(page);
    });

    await test.step('操作: 設定のアカウントを開く', async () => {
        await tapToAccountSettings(page);
    });

    await test.step('確認: 無料プランで、アップグレードのボタンが見え、管理のボタンは見えない', async () => {
        await expect(page.locator('#account-plan-badge')).toHaveText('無料');
        await expect(page.locator('#account-upgrade-monthly')).toBeVisible();
        await expect(page.locator('#account-manage-billing')).toBeHidden();
    });

    await test.step('操作: 「月額」でアップグレードし、決済のページで「支払う」を押す', async () => {
        await page.locator('#account-upgrade-monthly').tap();
        await expect(page.getByRole('heading', { name: 'お支払い（模擬）' })).toBeVisible();
        await page.getByRole('link', { name: '支払う' }).tap();
    });

    await test.step('確認: アプリへ戻り、支払いの完了と Plus が有効になったことが表示される', async () => {
        await expect(page.locator('.toast-success', { hasText: 'お支払いが完了しました' })).toBeVisible();
        await expect(page.locator('.toast-success', { hasText: 'Plus が有効になりました' })).toBeVisible({ timeout: 15000 });
    });

    await test.step('操作: 設定のアカウントを開く', async () => {
        await tapToAccountSettings(page);
    });

    await test.step('確認: プランが Plus になり、「プラン変更・支払い・解約」が見え、アップグレードのボタンは消えている', async () => {
        await expect(page.locator('#account-plan-badge')).toHaveText('Plus');
        await expect(page.locator('#account-manage-billing')).toBeVisible();
        await expect(page.locator('#account-upgrade-monthly')).toBeHidden();
    });
});

test('@gate J7-2 Plus のアカウントから、「プラン変更・支払い・解約」で解約すると、解約予約済みと表示される', async ({ page }) => {
    await test.step('前提: 月額の Plus (決済あり) でハブにログインした状態で、アプリを開いておく (ハブと決済は模擬)', async () => {
        resetHubStateForTest(hub, plusStateForTest('monthly'));
        await seedHubLoginForTest(page, hub);
        await mockHubForTest(page, hub);
        await mockBillingPagesForTest(page, hub);
        await bootAppForTest(page);
    });

    await test.step('操作: 設定のアカウントを開く', async () => {
        await tapToAccountSettings(page);
    });

    await test.step('確認: 月額の Plus で次回更新日が見え、「プラン変更・支払い・解約」が見える', async () => {
        await expect(page.locator('#account-plan-badge')).toHaveText('Plus');
        await expect(page.locator('#account-plan-period')).toContainText('月額 ・ 次回更新');
        await expect(page.locator('#account-manage-billing')).toBeVisible();
    });

    await test.step('操作: 「プラン変更・支払い・解約」から管理のページへ行き、「解約する」を押して、アプリへ戻る', async () => {
        await page.locator('#account-manage-billing').tap();
        await expect(page.getByRole('heading', { name: 'プランの管理（模擬）' })).toBeVisible();
        await page.getByRole('link', { name: '解約する' }).tap();
        await expect(page.getByRole('heading', { name: '解約を予約しました（模擬）' })).toBeVisible();
        await page.getByRole('link', { name: 'アプリへ戻る' }).tap();
        // 戻った後、アプリの起動が済む (ホームに書名が出る) まで待つ。下のナビ自体は起動前から見えている
        await expect(page.getByText('フィクスチャの本 1').first()).toBeVisible();
    });

    await test.step('操作: 設定のアカウントを開く', async () => {
        await tapToAccountSettings(page);
    });

    await test.step('確認: 「解約予約済み」と、期間の終わりまで使えることが表示される', async () => {
        await expect(page.locator('#account-plan-period')).toContainText('解約予約済み');
        await expect(page.locator('#account-plan-cancel')).toContainText('無料プランに戻ります');
    });
});
