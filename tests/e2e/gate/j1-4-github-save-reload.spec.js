// 門のE2E (イシュー#629)。観測点 J1-4「再読込しても保存先が残る」の、保存先「GitHub」の分。
// 何も入っていない PC で、初回の案内の「保存先を選ぶ」から GitHub を選び、「GitHub に接続」(コード → 承認) で
// つないでから、リポジトリを選んで「この設定で使う」を押す。開き直した後と、利用者が再読込した後に、
// リポジトリの蔵書 (フィクスチャの本) が見え、同期の設定の保存先が GitHub とそのリポジトリのままであることを確かめる。
// GitHub は helpers/gate-github.js の模擬 (状態を持つ mockGitHubForTest と、接続の mockGitHubConnectForTest)。
// アプリの GitHub の読み書き (js/github-adapter.js) は差し替えない。
// 保存先の選択肢は、保存先を決めていない端末では「ハブ」を表示する (js/screens/settings.js の viewMethod)。
// 「GitHub」と出ることが、保存先を GitHub に決めた印になる。書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createMockGitHubForTest, seedGitHubDataForTest, mockGitHubForTest, mockGitHubConnectForTest } from '../helpers/gate-github.js';

const BOOK = 'フィクスチャの本 1';
const CODE = 'GATE-0002';
const LOGIN = 'taro';
const REPO = 'taro/bookshelf-data';
const methodSelect = (page) => page.locator('#sync-method-select');
const repoSelect = (page) => page.locator('#github-repo-select');

// 左の「設定」から「同期」を開く (利用者の操作だけ)
async function clickToSyncSettings(page) {
    await page.locator('#sidebar-settings').click();
    await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
    await expect(methodSelect(page)).toBeVisible();
}

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J1-4 PC で GitHub に接続してリポジトリを選び「この設定で使う」を押すと、開き直した後も再読込の後も、保存先はそのリポジトリでその蔵書が見える', async ({ page }) => {
    let gh = null;

    await test.step('前提: リポジトリに蔵書を置き、GitHub 側の応答を模擬して、何も入っていない状態のアプリを開いておく', async () => {
        gh = createMockGitHubForTest();
        seedGitHubDataForTest(gh);
        await mockGitHubForTest(page, gh);
        await mockGitHubConnectForTest(page, gh, { userCode: CODE });
        await bootAppForTest(page);
    });

    await test.step('操作: 案内の「保存先を選ぶ」→「GitHub」→「GitHub に接続」と押し、承認されてつながるまで待つ', async () => {
        await page.locator('#dashboard-welcome button[data-dw="sync"]').click();
        await expect(methodSelect(page)).toBeVisible();
        await methodSelect(page).selectOption('github');
        await page.locator('#github-connect-btn').click();
        await expect(page.locator('#github-user-code')).toHaveText(CODE);
        // Device Flow は最短5秒ごとに承認を確かめにいく (js/github-auth.js pollAccessToken)
        await expect(page.locator('#github-connected-login')).toHaveText(LOGIN, { timeout: 15000 });
    });

    await test.step('操作: リポジトリを選び、「この設定で使う」を押す (アプリは開き直す)', async () => {
        await repoSelect(page).selectOption(REPO);
        await expect(page.locator('#github-branch-select')).toHaveValue('main');
        await page.locator('#github-save-repo-btn').click();
        await expect(page.getByText(BOOK).first()).toBeVisible();
    });

    await test.step('確認: 開き直した後、リポジトリの蔵書が見え、同期の設定は保存先が GitHub とそのリポジトリ', async () => {
        await expect(page.getByText(BOOK).first()).toBeVisible();
        await clickToSyncSettings(page);
        await expect(methodSelect(page)).toHaveValue('github');
        await expect(page.locator('#github-connected-login')).toHaveText(LOGIN);
        await expect(repoSelect(page)).toHaveValue(REPO);
    });

    await test.step('操作: ページを再読込する', async () => {
        await page.reload();
        await expect(page.getByText(BOOK).first()).toBeVisible();
    });

    await test.step('確認: 再読込の後も、リポジトリの蔵書が見え、同期の設定は保存先が GitHub とそのリポジトリのまま', async () => {
        await expect(page.getByText(BOOK).first()).toBeVisible();
        await clickToSyncSettings(page);
        await expect(methodSelect(page)).toHaveValue('github');
        await expect(page.locator('#github-connected-login')).toHaveText(LOGIN);
        await expect(repoSelect(page)).toHaveValue(REPO);
    });
});
