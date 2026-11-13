// 設定の「管理者」カテゴリ (イシュー#409・ADR-038/099)。管理者限定機能(プラン手動切替・通報の審査)を
// アカウントから独立させた専用カテゴリに集約した。出し分け(管理者のみ表示)とプラン切替の経路を確認する。
// 通報審査の操作バリエーション(hide/restore/dismiss・配置)は tests/e2e/report-moderation.spec.js が担当。
import { test, expect } from './helpers/test-base.js';
import { mockSyncReady } from './helpers/sync.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const HUB = 'https://mockhub.test';

// loggedIn=false: 未ログイン(hub未設定)。isAdmin: ログイン時の管理者フラグ。
async function boot(page, { loggedIn = true, isAdmin = false } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error' && !/status of (4\d\d|5\d\d)/.test(msg.text())) errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    const captured = { adminPlan: [] };
    await page.route(`${HUB}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (path === '/usage') return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576, isAdmin } });
        if (path === '/admin/reports') return route.fulfill({ json: { reports: [], hidden: [] } });
        if (path === '/admin/plan' && req.method() === 'POST') {
            const body = req.postDataJSON();
            captured.adminPlan.push({ auth: req.headers()['authorization'], body });
            return route.fulfill({ json: { ok: true, email: body.email, uid: 'u_target', plan: body.resetBilling ? 'free' : body.plan, adminGrant: !body.resetBilling && body.plan === 'plus', reset: !!body.resetBilling } });
        }
        return route.fulfill({ status: 404, json: {} });
    });
    await page.addInitScript(([userData, library, hub, loggedIn, isAdmin]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            ...(loggedIn ? { hub: { key: 'hk_test', apiBase: hub, email: 'admin@example.com', plan: 'free', isAdmin, siteId: 'sid' } } : {})
        }));
    }, [fixtureUserData, fixtureLibrary, HUB, loggedIn, isAdmin]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.HubAuth.renderSignInButton = () => {};
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        adapter.readText = async (path) => (mem.has(path) ? mem.get(path) : null);
        adapter.writeText = async (path, text) => { mem.set(path, text); };
    });
    await mockSyncReady(page, true);
    return { errors, captured };
}

test.describe('設定の「管理者」カテゴリ (イシュー#409)', () => {
    test('管理者: 設定を開き左の項目一覧の「管理者」をクリックすると開く。アカウントには管理者ブロックが無い', async ({ page }) => {
        const { errors } = await boot(page, { isAdmin: true });
        // 経路を通す: サイドバーの「設定」ボタン → 項目一覧の「管理者」をクリック (UIクリックのみ・_openSettingsModal直呼びはしない)
        await page.click('#sidebar-settings, [data-mobile-nav="settings"]');
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        const navBtn = page.locator('#settings-master .settings-cat[data-cat="admin-section"]');
        await expect(navBtn).toBeVisible();
        await expect(navBtn.locator('.settings-cat-tt')).toHaveText('管理者');
        await navBtn.click();
        await expect(page.locator('#admin-section')).toBeVisible();
        await expect(page.locator('#admin-section #account-admin')).toBeVisible();
        await expect(page.locator('#admin-section #account-admin-reports')).toBeVisible();
        // アカウント側には管理者ブロックが無い (id自体がadmin-section配下に移設済み)
        await expect(page.locator('#account-section #account-admin')).toHaveCount(0);
        await expect(page.locator('#account-section #account-admin-reports')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('一般利用者: 「管理者」の項目は出ない', async ({ page }) => {
        await boot(page, { isAdmin: false });
        await page.click('#sidebar-settings, [data-mobile-nav="settings"]');
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        await expect(page.locator('#settings-master .settings-cat[data-cat="admin-section"]')).toBeHidden();
        await expect(page.locator('#admin-section')).toBeHidden();
    });

    test('未ログイン: 「管理者」の項目は出ない', async ({ page }) => {
        await boot(page, { loggedIn: false });
        await page.click('#sidebar-settings, [data-mobile-nav="settings"]');
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        await expect(page.locator('#settings-master .settings-cat[data-cat="admin-section"]')).toBeHidden();
        await expect(page.locator('#admin-section')).toBeHidden();
    });

    test('管理者: プラン手動切替が「管理者」カテゴリからUIクリックで動く (POST /admin/plan の内容を検証)', async ({ page }) => {
        const { errors, captured } = await boot(page, { isAdmin: true });
        await page.click('#sidebar-settings, [data-mobile-nav="settings"]');
        await page.click('#settings-master .settings-cat[data-cat="admin-section"]');
        await expect(page.locator('#admin-section')).toBeVisible();
        await page.fill('#account-admin-email', 'target@example.com');
        await page.click('#account-admin-plus');
        await expect(page.locator('#account-admin-result')).toBeVisible();
        await expect(page.locator('#account-admin-result')).toContainText('target@example.com');
        expect(captured.adminPlan).toEqual([{ auth: 'Bearer hk_test', body: { email: 'target@example.com', plan: 'plus', resetBilling: false } }]);

        // 無料に戻す操作も確認 (同じ入力欄・別ボタン)
        await page.click('#account-admin-free');
        await expect.poll(() => captured.adminPlan.length).toBe(2);
        expect(captured.adminPlan[1].body).toEqual({ email: 'target@example.com', plan: 'free', resetBilling: false });
        expect(errors).toEqual([]);
    });

    test('管理者: 通報の審査が「管理者」カテゴリからUIクリックで動く (GET /admin/reports 到達確認・詳細操作は report-moderation.spec.js)', async ({ page }) => {
        await boot(page, { isAdmin: true });
        await page.click('#sidebar-settings, [data-mobile-nav="settings"]');
        await page.click('#settings-master .settings-cat[data-cat="admin-section"]');
        const panel = page.locator('#admin-section #account-admin-reports');
        await expect(panel).toBeVisible();
        await expect(panel.locator('#report-review-list')).toContainText('未対応の通報はありません');
    });
});
