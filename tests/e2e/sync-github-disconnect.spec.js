// イシュー#630: GitHub の接続・切断は、本のデータの保存先 (bookshelf_sync.method) と決めた印 (methodChosen) を勝手に変えない。
//  - GitHub につないだだけでは保存先は決まらない。決めるのは「この設定で使う」だけ (ハブの「ログイン」と「この設定で使う」と同じ2段)。
//  - 切断で保存先が local に戻り印が外れるのは、保存先が GitHub の人だけ。ハブ・この端末のフォルダの人
//    (公開のためだけに GitHub をつないだ人) は、接続情報が消えるだけで、保存先は変わらない。
// 接続・「この設定で使う」・切断は画面の操作で行う。ハブ・Google・GitHub は既存の模擬 (helpers/gate-hub.js・gate-github.js)。
// 直す前の動き (接続で github に変わる・切断で local に戻る) の実測は scripts/verify/630-results.md。
import { test, expect } from './helpers/test-base.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, mockHubSessionForTest, mockGoogleSignInForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, mockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubDeviceFlowForTest } from './helpers/gate-github.js';

const SYNC_KEY = 'bookshelf_sync';
const LOGIN = 'gate-user';
const REPO = 'bookshelf-data';
const FOLDER = 'issue630-folder';
const MSG_KEEP = 'GitHub との接続を切断しますか？\n接続情報を削除します。本のデータの保存先は変わりません。';
const MSG_RESET = 'GitHub との接続を切断しますか？\n接続情報を削除し、保存先を「この端末のフォルダ」に戻します。';
const MSG_PUBLISH = '\n自分の GitHub リポジトリへの公開は、もう一度接続するまでできません。';

test.use({ viewport: { width: 1280, height: 800 } });

const methodSelect = (page) => page.locator('#sync-method-select');

async function waitAppReady(page) {
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

async function openSettingsCategory(page, cat) {
    await page.click('#sidebar-settings');
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    await page.locator(`#settings-master .settings-cat[data-cat="${cat}"]`).click();
}

/** いまの保存先の設定を読む。select=true なら設定「同期」の保存先セレクトの値も読む (設定を開いておく)。 */
async function readState(page, { select = false } = {}) {
    const state = await page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        const cfg = raw ? JSON.parse(raw) : null;
        return {
            method: cfg ? cfg.method : null,
            methodChosen: cfg && 'methodChosen' in cfg ? cfg.methodChosen : '(無し)',
            githubToken: !!(cfg && cfg.github && cfg.github.token),
            hubKey: !!(cfg && cfg.hub && cfg.hub.key),
            isConfigured: window.SyncConfigManager.isConfigured(),
            appSyncMethod: window.bookshelf ? window.bookshelf.syncMethod : null
        };
    }, SYNC_KEY);
    if (select) state.select = await methodSelect(page).inputValue();
    return state;
}

/** 設定「同期」で保存先セレクトを GitHub にして「GitHub に接続」を押し、つながるまで待つ (設定「同期」を開いておく)。 */
async function connectGitHubFromSyncPanel(page) {
    await methodSelect(page).selectOption('github');
    await page.locator('#github-connect-btn').click();
    // Device Flow は最短5秒ごとに承認を確かめにいく (js/github-auth.js pollAccessToken)
    await expect(page.locator('#github-connected-login')).toHaveText(LOGIN, { timeout: 20000 });
}

/** 設定「同期」の GitHub のパネルで「切断」を押し、確認で OK する (アプリは再読込する)。確認の文面を返す。 */
async function disconnectGitHubFromSyncPanel(page) {
    await methodSelect(page).selectOption('github');
    await page.locator('#github-disconnect-btn').click();
    const cfm = page.locator('.cfm-overlay');
    await expect(cfm).toBeVisible();
    const message = await cfm.locator('.cfm-message').textContent();
    await Promise.all([page.waitForEvent('load'), cfm.locator('.cfm-ok').click()]);
    await waitAppReady(page);
    return message;
}

async function reloadAndOpenSync(page) {
    await page.reload();
    await waitAppReady(page);
    await openSettingsCategory(page, 'sync-section');
    await expect(methodSelect(page)).toBeVisible();
}

/** 「フォルダを選ぶ」を押すと、ブラウザの中の実際のフォルダ (OPFS) が選ばれるようにする (sync-chosen-mark.spec.js と同じ模擬)。 */
async function mockFolderPicker(page, folderName) {
    await page.addInitScript((name) => {
        window.showDirectoryPicker = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle(name, { create: true });
        };
    }, folderName);
}

test.describe('ハブを保存先にしている人', () => {
    test('ハブにログインして「この設定で使う」を押した人が、GitHub に接続しても、切断しても、保存先はハブのまま', async ({ page }) => {
        const hub = createHubStateForTest();
        await mockHubForTest(page, hub);
        await mockHubSessionForTest(page, hub);
        await mockGoogleSignInForTest(page);
        await mockGitHubDeviceFlowForTest(page, { login: LOGIN, repo: REPO });
        await page.goto('index.html');
        await waitAppReady(page);

        await test.step('前提: 設定のアカウントでハブにログインし、同期の「この設定で使う」でハブを保存先にする', async () => {
            await openSettingsCategory(page, 'account-section');
            await page.locator('#account-consent-check').check();
            await page.getByRole('button', { name: 'Google でログイン（模擬）' }).first().click();
            await expect(page.locator('#account-connected')).toBeVisible();
            await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
            await expect(methodSelect(page)).toHaveValue('hub');
            await Promise.all([page.waitForEvent('load'), page.locator('#hub-use-btn').click()]);
            await waitAppReady(page);
            // ハブが空の時は、起動時に「新規データで初期化しますか？」の確認が出る。答えるまで起動の後半は終わらない
            const init = page.locator('.cfm-overlay', { hasText: '新規データで初期化しますか' });
            await expect(init).toBeVisible();
            await init.locator('.cfm-ok').click();
            await waitForHubStartupForTest(page);
            const s = await readState(page);
            expect(s.method).toBe('hub');
            expect(s.methodChosen).toBe(true);
        });

        await test.step('GitHub に接続しただけでは、保存先はハブのまま (接続の直後・再読込の後)', async () => {
            await openSettingsCategory(page, 'sync-section');
            await connectGitHubFromSyncPanel(page);
            await expect(page.locator('.toast', { hasText: '「この設定で使う」を押すと、本のデータの保存先になります' })).toBeVisible();
            const connected = await readState(page);
            expect(connected.githubToken, 'GitHub の接続情報は保存される').toBe(true);
            expect(connected.method).toBe('hub');
            expect(connected.methodChosen).toBe(true);

            await reloadAndOpenSync(page);
            const reloaded = await readState(page, { select: true });
            expect(reloaded.method).toBe('hub');
            expect(reloaded.appSyncMethod, '再読込の後もアプリはハブを使う').toBe('hub');
            expect(reloaded.select).toBe('hub');
        });

        await test.step('GitHub を切断しても、保存先はハブのまま。確認の文面も「保存先は変わりません」', async () => {
            const message = await disconnectGitHubFromSyncPanel(page);
            expect(message).toBe(MSG_KEEP);
            await openSettingsCategory(page, 'sync-section');
            const after = await readState(page, { select: true });
            expect(after.githubToken, 'GitHub の接続情報は消える').toBe(false);
            expect(after.method).toBe('hub');
            expect(after.methodChosen, '決めた印はそのまま').toBe(true);
            expect(after.hubKey, 'ハブの接続情報は残る').toBe(true);
            expect(after.isConfigured).toBe(true);
            expect(after.appSyncMethod).toBe('hub');
            expect(after.select).toBe('hub');
        });
    });

    test('決めた印が入る前からハブを保存先にしていた人 (印なし) も、GitHub の接続と切断で method も印も変わらない', async ({ page }) => {
        const hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub' });
        await mockHubForTest(page, hub);
        await mockGitHubDeviceFlowForTest(page, { login: LOGIN, repo: REPO });
        await page.goto('index.html');
        await waitAppReady(page);
        await waitForHubStartupForTest(page);

        await openSettingsCategory(page, 'sync-section');
        await connectGitHubFromSyncPanel(page);
        const connected = await readState(page);
        expect(connected.githubToken).toBe(true);
        expect(connected.method).toBe('hub');
        expect(connected.methodChosen, '接続では印は立たない').toBe('(無し)');

        const message = await disconnectGitHubFromSyncPanel(page);
        expect(message).toBe(MSG_KEEP);
        await openSettingsCategory(page, 'sync-section');
        const after = await readState(page, { select: true });
        expect(after.githubToken).toBe(false);
        expect(after.method).toBe('hub');
        expect(after.methodChosen).toBe('(無し)');
        expect(after.isConfigured).toBe(true);
        expect(after.appSyncMethod).toBe('hub');
        expect(after.select).toBe('hub');
    });
});

test.describe('「この端末のフォルダ」を保存先にしている人', () => {
    test('フォルダをつないだ人が、GitHub に接続しても、切断しても、保存先は「この端末のフォルダ」のまま', async ({ page }) => {
        await mockFolderPicker(page, FOLDER);
        await mockGitHubDeviceFlowForTest(page, { login: LOGIN, repo: REPO });
        await page.goto('index.html');
        await waitAppReady(page);
        await openSettingsCategory(page, 'sync-section');
        await methodSelect(page).selectOption('local');
        await page.locator('#obsidian-sync-btn').click();
        await expect(page.locator('#obsidian-sync-path')).toHaveText(FOLDER);
        const before = await readState(page);
        expect(before.method).toBe('local');
        expect(before.methodChosen).toBe(true);

        await connectGitHubFromSyncPanel(page);
        const connected = await readState(page);
        expect(connected.githubToken).toBe(true);
        expect(connected.method, '接続しただけでは保存先は変わらない').toBe('local');
        expect(connected.methodChosen).toBe(true);

        const message = await disconnectGitHubFromSyncPanel(page);
        expect(message).toBe(MSG_KEEP);
        await openSettingsCategory(page, 'sync-section');
        const after = await readState(page, { select: true });
        expect(after.githubToken).toBe(false);
        expect(after.method).toBe('local');
        expect(after.methodChosen, '決めた印はそのまま').toBe(true);
        expect(after.isConfigured).toBe(true);
        expect(after.select).toBe('local');
    });

    test('フォルダをまだ選んでいない人 (公開先は自分の GitHub リポジトリ) が切断しても、決めた印は残り、公開の注記が出る', async ({ page }) => {
        await mockGitHubDeviceFlowForTest(page, { login: LOGIN, repo: REPO });
        // 前提: 保存先セレクトで「この端末のフォルダ」に切り替えた人 (決めた印あり・フォルダ未選択) に、GitHub の接続情報があり、
        // 公開先が自分の GitHub リポジトリの形。直す前は、切断で印が外れて保存先セレクトがハブの表示に変わっていた
        await page.addInitScript(([key, login]) => {
            if (sessionStorage.getItem('issue630Seeded')) return;
            sessionStorage.setItem('issue630Seeded', '1');
            localStorage.setItem(key, JSON.stringify({
                method: 'local', methodChosen: true,
                github: { owner: '', repo: '', branch: 'main', basePath: '', token: 'gho_gate_test_token', login },
                publish: { target: 'github', owner: login, repo: 'bookshelf-public', branch: 'main' }
            }));
        }, [SYNC_KEY, LOGIN]);
        await page.goto('index.html');
        await waitAppReady(page);
        await openSettingsCategory(page, 'sync-section');
        expect((await readState(page, { select: true })).select).toBe('local');

        const message = await disconnectGitHubFromSyncPanel(page);
        expect(message).toBe(MSG_KEEP + MSG_PUBLISH);
        await openSettingsCategory(page, 'sync-section');
        const after = await readState(page, { select: true });
        expect(after.githubToken).toBe(false);
        expect(after.method).toBe('local');
        expect(after.methodChosen, '決めた印はそのまま').toBe(true);
        expect(after.isConfigured).toBe(true);
        expect(after.select, '保存先セレクトは「この端末のフォルダ」のまま').toBe('local');
    });
});

test.describe('GitHub を保存先にする人', () => {
    test('GitHub に接続しただけでは保存先を決めた扱いにならず、「この設定で使う」を押すと GitHub に決まる', async ({ page }) => {
        await mockGitHubDeviceFlowForTest(page, { login: LOGIN, repo: REPO });
        await page.goto('index.html');
        await waitAppReady(page);
        await openSettingsCategory(page, 'sync-section');
        await connectGitHubFromSyncPanel(page);
        const connected = await readState(page);
        expect(connected.githubToken).toBe(true);
        expect(connected.method, '接続しただけでは method は書かれない').toBe('local');
        expect(connected.methodChosen).toBe('(無し)');
        expect(connected.isConfigured).toBe(false);

        // 再読込しても決めていない扱い = ホームの案内の手順1 は済みにならず、保存先セレクトはハブを最初に見せる
        await page.reload();
        await waitAppReady(page);
        const step1 = page.locator('#dashboard-welcome button[data-dw="sync"]');
        await expect(step1).toHaveText('保存先を選ぶ');
        await step1.click();
        await expect(methodSelect(page)).toHaveValue('hub');

        // GitHub のパネルでリポジトリを選び「この設定で使う」を押す (アプリは再読込する)
        await methodSelect(page).selectOption('github');
        await expect(page.locator('#github-connected-login')).toHaveText(LOGIN);
        await page.locator('#github-repo-select').selectOption(`${LOGIN}/${REPO}`);
        await expect(page.locator('#github-branch-select option', { hasText: 'main' })).toHaveCount(1);
        await Promise.all([page.waitForEvent('load'), page.locator('#github-save-repo-btn').click()]);
        await waitAppReady(page);
        const decided = await readState(page);
        expect(decided.method).toBe('github');
        expect(decided.methodChosen, '決めた印が立つ').toBe(true);
        expect(decided.isConfigured).toBe(true);
    });

    test('GitHub を保存先にしている人が切断すると、保存先は local に戻り、決めた印が外れる', async ({ page }) => {
        const gh = createMockGitHubForTest();
        seedGitHubDataForTest(gh);   // リポジトリに蔵書がある形 (空だと起動時に確認の画面が出て設定を押せない)
        await seedGitHubLoginForTest(page, gh);
        await mockGitHubForTest(page, gh);
        await page.goto('index.html');
        await waitAppReady(page);
        await openSettingsCategory(page, 'sync-section');
        const before = await readState(page, { select: true });
        expect(before.method).toBe('github');
        expect(before.select).toBe('github');

        const message = await disconnectGitHubFromSyncPanel(page);
        expect(message).toBe(MSG_RESET);
        await openSettingsCategory(page, 'sync-section');
        const after = await readState(page, { select: true });
        expect(after.githubToken).toBe(false);
        expect(after.method).toBe('local');
        expect(after.methodChosen, '決めた印は外れる').toBe('(無し)');
        expect(after.isConfigured).toBe(false);
        expect(after.select, '決めていない人には、保存先セレクトはハブを最初に見せる (ADR-056 追補2)').toBe('hub');
    });
});
