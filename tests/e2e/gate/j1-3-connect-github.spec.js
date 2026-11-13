// 門のE2E (イシュー#590)。観測点 J1-3「接続が完了したと分かる」の、保存先「GitHub」(OAuth Device Flow) の分。
// 初回の案内の「保存先を選ぶ」から GitHub を選び、「GitHub に接続」を押すとコードが出て、承認されると
// つながったアカウント名と使えるリポジトリが見えることを確かめる。GitHub 側の応答だけを模擬する
// (helpers/gate-github.js)。リポジトリを選んで保存し再読込する分 (J1-4) はリポジトリの中身の模擬が要るため別に足す。
// 書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { mockGitHubDeviceFlowForTest } from '../helpers/gate-github.js';

const LOGIN = 'gate-user';
const REPO = 'bookshelf-data';
const CODE = 'GATE-0001';
const methodSelect = (page) => page.locator('#sync-method-select');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J1-3 PC で保存先を GitHub にして「GitHub に接続」を押すと、コードが出て、承認後につながったアカウントが見える', async ({ page }) => {
    await test.step('前提: GitHub 側の応答を模擬し、何も入っていない状態のアプリを開いておく', async () => {
        await mockGitHubDeviceFlowForTest(page, { login: LOGIN, repo: REPO, userCode: CODE });
        await bootAppForTest(page);
    });

    await test.step('操作: 案内の「保存先を選ぶ」→「GitHub」→「GitHub に接続」と押す', async () => {
        await page.locator('#dashboard-welcome button[data-dw="sync"]').click();
        await expect(methodSelect(page)).toBeVisible();
        await methodSelect(page).selectOption('github');
        await page.locator('#github-connect-btn').click();
    });

    await test.step('確認: GitHub で入れるコードと、承認を待っていることが見える', async () => {
        await expect(page.locator('#github-user-code')).toHaveText(CODE);
        await expect(page.locator('#github-auth-pending-status')).toContainText('GitHub で承認されるのを待っています');
    });

    await test.step('確認: 承認されると、つながったアカウント名・知らせ・選べるリポジトリが見える', async () => {
        // Device Flow は最短5秒ごとに承認を確かめにいく (js/github-auth.js pollAccessToken)
        await expect(page.locator('#github-connected-login')).toHaveText(LOGIN, { timeout: 15000 });
        await expect(page.locator('.toast', { hasText: `GitHub に接続しました (${LOGIN})` })).toBeVisible();
        await expect(page.locator('#github-repo-select option', { hasText: `${LOGIN}/${REPO}` })).toHaveCount(1);
        await expect(page.locator('#github-connect-btn')).toBeHidden();
    });
});
