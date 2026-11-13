// 門のE2E: J7-3 退会で接続情報が消える・J7-4 再登録で旧データが戻らない (イシュー#589)。
// 書き方の決まりは tests/e2e/gate/README.md。ハブと Google のログインは外部なので、前提の区間で模擬する (helpers/gate-hub.js)。
//
// 模擬の約束は本物 (cf-worker/asayake-hub.js) に合わせてある:
//  - DELETE /account は、保存データ (data/<uid>/)・公開サイト・プラン・使用量・キーを消す (handleAccountDelete・919-975 行)。
//    消した後は古いキーで何も読めない (uid:<uid> を先に消す・947-950 行)
//  - ログイン (POST /session) の uid は Google の sub。uid の記録が無ければ、新しい siteId・無料プラン・使用量0で作る
//    (handleSession・224-245 行) = 同じ Google アカウントで登録し直すと、空の利用者になる
//  - ハブが空かどうかは private/bookshelves/all.json の有無で決まる (js/storage.js の detectFormat・66-78 行)
// アプリ側: 退会は確認のダイアログの後に DELETE /account を送り、接続情報を消して再読込する (js/screens/settings.js・1194-1221 行)。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, resetHubStateForTest, plusStateForTest, seedHubLoginForTest, mockHubForTest, mockHubSessionForTest, mockGoogleSignInForTest } from '../helpers/gate-hub.js';

const EMAIL = 'taro@example.com';
const MB = 1024 * 1024;

// 模擬のハブの状態。テストごとに前提の区間で resetHubStateForTest して使う
const hub = createHubStateForTest();
// 退会の前にハブへ保存してあったデータ (本棚・蔵書・メモ。中身は見本の形だけ)。resetHubStateForTest が毎回新しく入れ直す
const SAVED_FILES = [
    ['private/bookshelves/all.json', JSON.stringify({ id: 'all', name: 'すべての本', books: ['B000000001'] })],
    ['private/library.json', JSON.stringify({ books: [] })],
    ['private/notes.json', JSON.stringify({})]
];

// 下のナビの「設定」から「アカウント」を開く (利用者の操作だけ)
async function tapToAccountSettings(page) {
    await page.locator('[data-mobile-nav="settings"]').tap();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.locator('#settings-master .settings-cat[data-cat="account-section"]').tap();
}

// 再読込や画面の切り替えの後、アプリの起動が済む (ホームに書名が出る) まで待つ。下のナビ自体は起動前から見えている
async function waitAppReady(page) {
    await expect(page.getByText('フィクスチャの本 1').first()).toBeVisible();
}

// アカウントの「アカウントを削除」から、確認のダイアログで OK を押し、アプリが再読込して起動し直すまで待つ。
// 再読込の前の画面にも書名は出ているので、先にアカウントの欄が「ログイン」に戻る (= 再読込の後の画面) のを待つ
async function tapDeleteAccount(page) {
    await page.locator('#account-delete-btn').tap();
    await expect(page.locator('.cfm-overlay')).toContainText('アカウントを削除しますか');
    await page.locator('.cfm-overlay button', { hasText: 'OK' }).tap();
    await expect(page.locator('#sidebar-account-label')).toHaveText('ログイン');
    await waitAppReady(page);
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J7-3 アカウントを削除すると、接続が切れてメールアドレスが消え、再読込しても戻らない', async ({ page }) => {
    await test.step('前提: ハブにログインした状態で、アプリを開いておく (ハブは模擬)', async () => {
        resetHubStateForTest(hub, { plan: 'free' });
        await seedHubLoginForTest(page, hub);
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
    });

    await test.step('操作: 設定のアカウントを開く', async () => {
        await tapToAccountSettings(page);
    });

    await test.step('確認: ログイン中で、メールアドレスが見える', async () => {
        await expect(page.locator('#account-email')).toHaveText(EMAIL);
    });

    await test.step('操作: 「アカウントを削除」を押し、確認で OK を押す (アプリは再読込する)', async () => {
        await tapDeleteAccount(page);
    });

    await test.step('操作: 設定のアカウントを開く', async () => {
        await tapToAccountSettings(page);
    });

    await test.step('確認: ログインしていない表示になり、メールアドレスは見えない', async () => {
        await expect(page.locator('#account-disconnected')).toBeVisible();
        await expect(page.locator('#account-connected')).toBeHidden();
        await expect(page.getByText(EMAIL)).toHaveCount(0);
    });

    await test.step('操作: アプリを再読込して、設定のアカウントを開く', async () => {
        await page.reload();
        await waitAppReady(page);
        await tapToAccountSettings(page);
    });

    await test.step('確認: 再読込しても、ログインしていない表示のまま', async () => {
        await expect(page.locator('#account-disconnected')).toBeVisible();
        await expect(page.getByText(EMAIL)).toHaveCount(0);
    });
});

test('@gate J7-4 アカウントを削除してから同じ Google アカウントで登録し直すと、前のプラン・容量・保存データは戻らない', async ({ page }) => {
    await test.step('前提: Plus で、ハブに保存データ (50MB) がある状態でログインし、アプリを開いておく (ハブと Google は模擬)', async () => {
        resetHubStateForTest(hub, { ...plusStateForTest('monthly'), usedBytes: 50 * MB, files: SAVED_FILES });
        await seedHubLoginForTest(page, hub);
        await mockHubForTest(page, hub);
        await mockHubSessionForTest(page, hub);
        await mockGoogleSignInForTest(page);
        await bootAppForTest(page);
    });

    await test.step('操作: 設定のアカウントで「アカウントを削除」を押し、確認で OK を押す (アプリは再読込する)', async () => {
        await tapToAccountSettings(page);
        await expect(page.locator('#account-plan-badge')).toHaveText('Plus');
        await tapDeleteAccount(page);
    });

    await test.step('操作: 設定のアカウントで、規約に同意して、Google でログインし直す', async () => {
        await tapToAccountSettings(page);
        await page.locator('#account-consent-check').check();
        await page.getByRole('button', { name: 'Google でログイン（模擬）' }).first().tap();
        // ログインの後の表示に変わるのを待つ。完了のトーストは待たない: 設定の中に Google のログインボタンが2か所
        // (アカウント・同期のハブ) あり、後から描いた方の完了の処理が走るので、文言がどちらになるかが決まらない (step4 で実測・所見 J7-LOGIN-1)
        await expect(page.locator('#account-connected')).toBeVisible();
    });

    await test.step('確認: 同じメールアドレスでログインし直せて、プランは無料・使用量は 0 B (前の Plus と 50MB は戻らない)', async () => {
        await expect(page.locator('#account-email')).toHaveText(EMAIL);
        await expect(page.locator('#account-plan-badge')).toHaveText('無料');
        await expect(page.locator('#account-usage-used')).toHaveText('0 B');
    });

    await test.step('操作: 同期の設定で、保存先を「Asayake ハブ」にして「この設定で使う」を押す (アプリは再読込する)', async () => {
        await page.locator('#settings-back').tap();   // スマホ幅の設定は、詳細から「← 設定」で一覧へ戻る
        await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').tap();
        await page.locator('#sync-method-select').selectOption('hub');
        await page.locator('#hub-use-btn').tap();
    });

    await test.step('確認: ハブには保存データが無いと表示される (退会の前のデータは戻らない)', async () => {
        await expect(page.locator('.cfm-overlay')).toContainText('Asayake ハブ には保存データがありません');
    });
});
