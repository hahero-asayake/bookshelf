// 設定画面「アカウント」節の username 表示・設定/変更フォーム (S6・ADR-076・イシュー#126 B2-a)
//  - HubAuth.setUsername() (js/hub-auth.js) 経由で POST <hub>/username へ接続
//  - Worker のバリデーションエラー (形式不正・予約語・使用中) はフォーム脇に表示 (二重バリデーションなし)
//  - 公開ボタンの username ゲート自体は B2-b (イシュー#126 step3) で別途 E2E を書く
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, hubOverrides = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library, hub]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        // 同期方式 (データの保存先) はローカルのまま、アカウント (ハブ) 接続だけ設定する
        // (「アカウント」はハブ接続だけの第一級の面で、同期方式=hub を選ぶ必要はない, js/bookshelf.js の
        // _setupAccountUI コメント参照)。同期=hub にすると起動時に実際のハブへ fetch しにいって失敗する。
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub }));
    }, [fixtureUserData, fixtureLibrary, {
        apiBase: 'https://hub.example.test', key: 'hk_test', uid: 'u1', siteId: 's1', email: 'taro@example.com',
        plan: 'free', quotaBytes: 100000000, usedBytes: 0, username: null, bookshelfBase: null,
        ...hubOverrides
    }]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
    return errors;
}

test('未設定時は「未設定」表示、フォームから設定すると成功して表示が更新される', async ({ page }) => {
    const errors = await bootApp(page);
    await page.route('**/username', async (route) => {
        const body = route.request().postDataJSON();
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ username: body.username, bookshelfBase: `https://bookshelf.asayake.org/${body.username}/` })
        });
    });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await expect(page.locator('#account-username-current')).toContainText('未設定');
    await expect(page.locator('#account-username-current')).toHaveClass(/is-unset/);

    await page.locator('#account-username-input').fill('taro-books');
    await page.locator('#account-username-save').click();

    await expect(page.locator('#account-username-current')).toContainText('taro-books');
    await expect(page.locator('#account-username-current')).not.toHaveClass(/is-unset/);
    await expect(page.locator('#account-username-error')).toBeHidden();
    // 設定に永続化されている (次回公開時の siteBaseUrl 解決に使われる)
    const saved = await page.evaluate(() => SyncConfigManager.load().hub.username);
    expect(saved).toBe('taro-books');
    expect(errors).toEqual([]);
});

test('Worker のバリデーションエラー (409 使用中) はフォーム脇に表示され、二重バリデーションはしない', async ({ page }) => {
    const errors = await bootApp(page);
    await page.route('**/username', async (route) => {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'username taken' }) });
    });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await page.locator('#account-username-input').fill('taken-name');
    await page.locator('#account-username-save').click();

    await expect(page.locator('#account-username-error')).toBeVisible();
    await expect(page.locator('#account-username-error')).toContainText('既に使われています');
    // 失敗時は「未設定」のまま (書き換わらない)
    await expect(page.locator('#account-username-current')).toContainText('未設定');
    // 409 レスポンス自体の「Failed to load resource」はこのテストの意図した失敗なので除外
    expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});

test('Worker のバリデーションエラー (400 形式不正/予約語) もフォーム脇に表示される', async ({ page }) => {
    const errors = await bootApp(page);
    await page.route('**/username', async (route) => {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid or reserved username' }) });
    });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await page.locator('#account-username-input').fill('TOP');
    await page.locator('#account-username-save').click();

    await expect(page.locator('#account-username-error')).toBeVisible();
    await expect(page.locator('#account-username-error')).toContainText('使えません');
    // 400 レスポンス自体の「Failed to load resource」はこのテストの意図した失敗なので除外
    expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});

test('設定済みなら現在値と bookshelfBase を表示する', async ({ page }) => {
    const errors = await bootApp(page, { username: 'hahero', bookshelfBase: 'https://bookshelf.asayake.org/hahero/' });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await expect(page.locator('#account-username-current')).toContainText('hahero');
    await expect(page.locator('#account-username-current')).toContainText('bookshelf.asayake.org/hahero/');
    await expect(page.locator('#account-username-current')).not.toHaveClass(/is-unset/);
    expect(errors).toEqual([]);
});

test('ハブ未接続時は username フォームごと非表示 (account-connected が hidden)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => {
        const cfg = SyncConfigManager.load();
        cfg.hub = { apiBase: '', key: '' };
        SyncConfigManager.save(cfg);
    });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await expect(page.locator('#account-connected')).toBeHidden();
    await expect(page.locator('#account-username')).toBeHidden(); // account-connected の子なので追従して隠れる
    expect(errors).toEqual([]);
});
