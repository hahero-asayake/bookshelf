// イシュー#596: 保存先を決めていない人が、ハブにログインしただけ・公開先を選んだだけ・トークンを更新しただけでは
// 「保存先を決めた」扱いにならない (isConfigured() が false のまま・設定の保存先セレクトはハブを最初に見せる =
// ADR-056 追補2) ことと、保存済みの人の method が変わらないこと、決める操作で印 (bookshelf_sync.methodChosen)
// が立つことを確かめる。ハブ・Google・GitHub は既存の模擬 (helpers/gate-hub.js・gate-github.js) を使う。
import { test, expect } from './helpers/test-base.js';
import { createHubStateForTest, mockHubForTest, mockHubSessionForTest, mockGoogleSignInForTest, seedHubLoginForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, mockGitHubForTest, seedGitHubLoginForTest } from './helpers/gate-github.js';

const SYNC_KEY = 'bookshelf_sync';
const FOLDER = 'issue596-folder';
const OAUTH_REFRESH_URL = 'https://bookshelf-oauth-proxy.asayake-hahero.workers.dev/login/oauth/access_token';

test.use({ viewport: { width: 1280, height: 800 } });

const readSync = (page) => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return { cfg: raw ? JSON.parse(raw) : null, configured: window.SyncConfigManager.isConfigured() };
}, SYNC_KEY);

async function waitAppReady(page) {
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

async function openSettingsCategory(page, cat) {
    await page.click('#sidebar-settings');
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    await page.locator(`#settings-master .settings-cat[data-cat="${cat}"]`).click();
}

/** 再読込してから設定の「同期」を開き、保存先セレクトの初期表示を返す。 */
async function reloadAndReadMethodSelect(page) {
    await page.reload();
    await waitAppReady(page);
    await openSettingsCategory(page, 'sync-section');
    await expect(page.locator('#sync-method-select')).toBeVisible();
    return page.locator('#sync-method-select').inputValue();
}

/** 設定の「アカウント」で規約に同意し、Google でログインする (Google とハブは模擬)。 */
async function loginHubFromAccount(page) {
    await openSettingsCategory(page, 'account-section');
    await page.locator('#account-consent-check').check();
    await page.getByRole('button', { name: 'Google でログイン（模擬）' }).first().click();
    await expect(page.locator('#account-connected')).toBeVisible();
}

/** 「フォルダを選ぶ」を押すと、ブラウザの中の実際のフォルダ (OPFS) が選ばれるようにする (sync-first-connect.spec.js と同じ模擬)。 */
async function mockFolderPicker(page, folderName) {
    await page.addInitScript((name) => {
        window.showDirectoryPicker = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle(name, { create: true });
        };
    }, folderName);
}

test.describe('保存先を決めない操作では「決めた」扱いにならない', () => {
    test('(a) 設定のアカウントでハブにログインしただけでは、保存先セレクトはハブのまま', async ({ page }) => {
        const hub = createHubStateForTest();
        await mockHubForTest(page, hub);
        await mockHubSessionForTest(page, hub);
        await mockGoogleSignInForTest(page);
        await page.goto('index.html');
        await waitAppReady(page);
        expect((await readSync(page)).cfg).toBeNull();

        await loginHubFromAccount(page);

        const after = await readSync(page);
        expect(after.cfg.hub.key, 'ログインの情報は保存される').toBe(hub.key);
        expect(after.cfg.methodChosen, '決めた印は立たない').toBeUndefined();
        expect(after.configured).toBe(false);
        expect(await reloadAndReadMethodSelect(page)).toBe('hub');
        expect((await readSync(page)).configured).toBe(false);
    });

    test('(b) 公開の設定で公開先を選んだだけでは、保存先セレクトはハブのまま', async ({ page }) => {
        await page.goto('index.html#/publish/settings');
        await waitAppReady(page);
        expect((await readSync(page)).cfg).toBeNull();
        await expect(page.locator('#publish-settings-modal')).toHaveClass(/show/);
        await page.locator('#publish-target-details > summary').click();
        await page.selectOption('#publish-target-select', 'github');

        const after = await readSync(page);
        expect(after.cfg.publish.target, '公開先は保存される').toBe('github');
        expect(after.cfg.methodChosen, '決めた印は立たない').toBeUndefined();
        expect(after.configured).toBe(false);
        await page.goto('index.html');
        expect(await reloadAndReadMethodSelect(page)).toBe('hub');
        expect((await readSync(page)).configured).toBe(false);
    });

    test('(c) 決めた印の無い人が公開しても、トークン更新の前で止まり、印は立たず保存先セレクトはハブのまま', async ({ page }) => {
        // 前提: 印の無い既存データ (method=local・フォルダ無し = 決めていない扱い) で、公開先は GitHub、
        // GitHub のトークンは期限切れ (更新用のトークンはある)。公開の書き出し (js/exporter.js export) は、トークン更新
        // (forPublish・js/bookshelf.js _ensureFreshGitHubToken) より前に「同期先が未接続」で止まる
        // (_isSyncReady は local ならフォルダが要る)。フォルダがあれば起動時に印が立つ (_recordLocalSyncChoice) ので、
        // 決めていない人のトークン更新は起きない。ここでは、その止まり方と、印が立たないことを確かめる。
        await page.addInitScript((key) => {
            if (sessionStorage.getItem('issue596Seeded')) return;
            sessionStorage.setItem('issue596Seeded', '1');
            localStorage.setItem(key, JSON.stringify({
                method: 'local',
                github: { owner: '', repo: '', branch: 'main', basePath: '', token: 'ghu_old', login: 'me',
                    refreshToken: 'ghr_old', tokenExpiresAt: Date.now() - 60 * 1000, refreshTokenExpiresAt: Date.now() + 86400 * 1000 },
                publish: { target: 'github', owner: 'me', repo: 'pub', branch: 'main' }
            }));
        }, SYNC_KEY);
        const refreshCalls = [];
        await page.route(OAUTH_REFRESH_URL, (route) => {
            refreshCalls.push(route.request().method());
            return route.fulfill({ json: { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600, token_type: 'bearer' } });
        });
        // 更新の後の公開先 repo への書き込みは失敗させる (このテストの対象はトークン更新の書き込みだけ)
        await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404, json: { message: 'Not Found' } }));
        await page.goto('index.html');
        await waitAppReady(page);
        expect((await readSync(page)).configured).toBe(false);

        // 公開の書き出しを動かす。画面から公開するには記事の作成が要るため、記事の画面が呼ぶ書き出し
        // (BookshelfExporter.export) をそのまま呼ぶ。
        const error = await page.evaluate(async () => {
            try { await window.bookshelf.exporter.export(); return null; } catch (e) { return e.message; }
        });

        expect(error).toBe('同期先が未接続です');
        expect(refreshCalls.length, 'トークン更新の通信は起きない').toBe(0);
        const after = await readSync(page);
        expect(after.cfg.github.token).toBe('ghu_old');
        expect(after.cfg.method).toBe('local');
        expect(after.cfg.methodChosen, '決めた印は立たない').toBeUndefined();
        expect(after.configured).toBe(false);
        expect(await reloadAndReadMethodSelect(page)).toBe('hub');
    });
});

test.describe('保存済みの人 (決めた印が入る前に保存した人) の method は変わらない', () => {
    test('(d-1) ハブを保存先にしていた人は、method がハブのままで「決めた」扱い', async ({ page }) => {
        const hub = createHubStateForTest();
        await seedHubLoginForTest(page, hub, { method: 'hub' });
        await mockHubForTest(page, hub);
        await page.goto('index.html');
        await waitAppReady(page);
        const before = await readSync(page);
        expect(before.cfg.methodChosen).toBeUndefined();
        expect(before.configured).toBe(true);
        await page.reload();
        await waitAppReady(page);
        const after = await readSync(page);
        expect(after.cfg.method).toBe('hub');
        expect(after.configured).toBe(true);
    });

    test('(d-2) GitHub を保存先にしていた人は、method が GitHub のままで「決めた」扱い', async ({ page }) => {
        const gh = createMockGitHubForTest();
        await seedGitHubLoginForTest(page, gh);
        await mockGitHubForTest(page, gh);
        await page.goto('index.html');
        await waitAppReady(page);
        expect((await readSync(page)).configured).toBe(true);
        await page.reload();
        await waitAppReady(page);
        const after = await readSync(page);
        expect(after.cfg.method).toBe('github');
        expect(after.configured).toBe(true);
    });

    test('(d-3) フォルダをつないでいた local の人は、起動時に印が立ち、method は local のまま', async ({ page }) => {
        await mockFolderPicker(page, FOLDER);
        await page.goto('index.html');
        await waitAppReady(page);
        await openSettingsCategory(page, 'sync-section');
        await page.locator('#sync-method-select').selectOption('local');
        await page.locator('#obsidian-sync-btn').click();
        await expect(page.locator('#obsidian-sync-path')).toHaveText(FOLDER);
        // 決めた印が入る前の形 (method=local だけ) に戻す = 修正前にフォルダをつないだ人の保存データ
        await page.evaluate((key) => {
            const cfg = JSON.parse(localStorage.getItem(key));
            delete cfg.methodChosen;
            localStorage.setItem(key, JSON.stringify(cfg));
        }, SYNC_KEY);
        expect((await readSync(page)).configured).toBe(false);

        expect(await reloadAndReadMethodSelect(page)).toBe('local');
        const after = await readSync(page);
        expect(after.cfg.method).toBe('local');
        expect(after.cfg.methodChosen).toBe(true);
        expect(after.configured).toBe(true);
    });
});

test('(e) ハブにログインして「この設定で使う」を押すと、決めた印が立ち method はハブになる', async ({ page }) => {
    const hub = createHubStateForTest();
    await mockHubForTest(page, hub);
    await mockHubSessionForTest(page, hub);
    await mockGoogleSignInForTest(page);
    await page.goto('index.html');
    await waitAppReady(page);
    await loginHubFromAccount(page);
    await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
    await expect(page.locator('#sync-method-select')).toHaveValue('hub');
    // アプリは再読込する。読み込みが終わるのを待ってから保存された設定を読む
    await Promise.all([page.waitForEvent('load'), page.locator('#hub-use-btn').click()]);
    await waitAppReady(page);
    const after = await readSync(page);
    expect(after.cfg.methodChosen, '決めた印が立つ').toBe(true);
    expect(after.cfg.method).toBe('hub');
    expect(after.configured).toBe(true);
});
