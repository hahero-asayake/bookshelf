// イシュー#519: 起動時の初期化confirmDialog(initGitHubSync)が、GitHub同期で新規データ(空リポジトリ)
// の場合に出て、OKを押すと initEmpty() で初期化され、起動が完了して本棚が使える状態になることを、
// 起動経路を通して確認する (関数の直呼びではない)。
// クラウド同期(hub)側の同じ経路は tests/e2e/plugin-seed.spec.js の bootWithHub が既に検証済み
// (「新規ユーザー: 起動すると標準5個が...」のテストで、起動時confirmDialogにOKを押し、初期化後の
// ensureStandardPlugins が同じ起動サイクルで走ることまで確認している)。
import { test, expect } from './helpers/test-base.js';

const OWNER = 'o519', REPO = 'r519', BRANCH = 'main';

test('GitHub同期: 新規データ(空リポジトリ)で確認にOKを押すと初期化され、本棚が使える状態になる', async ({ page }) => {
    const store = new Map();
    await page.route('https://api.github.com/**', async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        const m = url.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/contents/(.+)$`));
        if (m) {
            const path = decodeURIComponent(m[1]);
            if (method === 'GET') return route.fulfill({ status: 404, json: { message: 'Not Found' } });
            if (method === 'PUT') {
                const body = JSON.parse(route.request().postData());
                store.set(path, body.content);
                return route.fulfill({ status: 201, json: { content: { sha: `sha${store.size}` } } });
            }
        }
        // installations確認等、このテストの関心外のリクエストは無害な既定応答 (preview-real-adapter.spec.js と同型)
        return route.fulfill({ status: 200, json: { installations: [], repositories: [] } });
    });
    await page.addInitScript(([owner, repo, branch]) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
            github: { owner, repo, branch, basePath: '', token: 'ghu_test_token' }
        }));
    }, [OWNER, REPO, BRANCH]);
    await page.goto('index.html');

    const cfmOverlay = page.locator('.cfm-overlay');
    await cfmOverlay.waitFor({ state: 'visible' });
    await expect(cfmOverlay.locator('.cfm-message')).toContainText('新規データで初期化しますか');
    await cfmOverlay.locator('.cfm-ok').click();
    await cfmOverlay.waitFor({ state: 'hidden' });

    // initEmpty() が private/ 配下の初期ファイル群を書き込み、起動が完了する
    await expect.poll(() => store.has('private/library.json')).toBe(true);
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#view-main')).toBeVisible();
});

test('GitHub同期: 新規データ(空リポジトリ)で確認にキャンセルを押すと初期化せず、エラー帯が出る', async ({ page }) => {
    const store = new Map();
    await page.route('https://api.github.com/**', async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        const m = url.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/contents/(.+)$`));
        if (m && method === 'GET') return route.fulfill({ status: 404, json: { message: 'Not Found' } });
        return route.fulfill({ status: 200, json: { installations: [], repositories: [] } });
    });
    await page.addInitScript(([owner, repo, branch]) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
            github: { owner, repo, branch, basePath: '', token: 'ghu_test_token' }
        }));
    }, [OWNER, REPO, BRANCH]);
    await page.goto('index.html');

    const cfmOverlay = page.locator('.cfm-overlay');
    await cfmOverlay.waitFor({ state: 'visible' });
    await cfmOverlay.locator('.cfm-cancel').click();
    await cfmOverlay.waitFor({ state: 'hidden' });

    await expect(page.locator('#loading')).toBeHidden();
    expect(store.size).toBe(0); // initEmpty() が呼ばれていない (書き込みが一切起きない)
    await expect(page.locator('#app-status-bar .status-warn')).toBeVisible();
});
