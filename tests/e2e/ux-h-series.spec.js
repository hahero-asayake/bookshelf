// UX 監査 (2026-06-25) の High 項目の回帰テスト
//  H-1 モバイルセットアップバナー: ローカル前提の旧案内を廃し PWA+クラウド同期へ誘導
//  H-3 ハブ再ログイン: 「ログイン済み」と「保存先として使用中」を明示 + 節内ログイン導線
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, { initScript, sync, userData } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    if (initScript) await page.addInitScript(initScript);
    await page.addInitScript(([ud, library, syncJson]) => {
        localStorage.setItem('virtualBookshelf_userData', ud);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', syncJson);
    }, [userData || fixtureUserData, fixtureLibrary, JSON.stringify(sync || { method: 'local' })]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

// showDirectoryPicker を消し、UA をモバイルに偽装する初期化スクリプト (バナー発火条件を作る)
function asMobile(ua, { standalone = false } = {}) {
    return new Function(`
        Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ${JSON.stringify(ua)} });
        ${standalone ? "Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });" : ''}
        try { delete window.showDirectoryPicker; } catch (_) {}
        try { delete Object.getPrototypeOf(window).showDirectoryPicker; } catch (_) {}
    `);
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ===== H-1 モバイルバナー =====

test('H-1: iOS・未同期では保存先設定へ誘導するバナーが出る (ローカル前提の旧案内を廃止)', async ({ page }) => {
    await bootApp(page, { initScript: asMobile(IOS_UA) });
    const banner = page.locator('#mobile-setup-banner');
    await expect(banner).toBeVisible();
    // 方針整合: GitHub/ハブ同期 + 「ホーム画面に追加」を案内 (File Picker 拡張案内は消えた)
    await expect(banner).toContainText('Asayake ハブ');
    await expect(banner).toContainText('ホーム画面に追加');
    await expect(banner).not.toContainText('File Picker');
    // アクションは外部リンクではなく設定モーダルの同期節へ直行
    const setupBtn = page.locator('#mobile-setup-banner-actions button');
    await expect(setupBtn).toHaveText('保存先を設定する');
    await setupBtn.click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await expect(page.locator('#sync-method-select')).toBeVisible();
});

test('ローカルは PC 限定: showDirectoryPicker 非対応環境では同期セレクトの local が無効', async ({ page }) => {
    await bootApp(page, { initScript: asMobile(IOS_UA) });
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    // モバイル等ではローカル保存は選べない (GitHub / ハブの 2 択に一本化)
    await expect(page.locator('#sync-method-select option[value="local"]')).toBeDisabled();
    await expect(page.locator('#sync-method-select option[value="github"]')).toBeEnabled();
});

test('H-1: standalone かつクラウド同期済みならバナーは出ない', async ({ page }) => {
    // method!=='local' (github) で同期済み扱い。GitHub への実通信は失敗するがバナー判定には無関係
    await bootApp(page, {
        initScript: asMobile(IOS_UA, { standalone: true }),
        sync: { method: 'github', github: { owner: 'o', repo: 'r', branch: 'main', token: 't' } }
    });
    await expect(page.locator('#mobile-setup-banner')).toBeHidden();
});

// ===== H-3 ハブ再ログイン (ログイン済み⇄使用中の明示) =====

// ハブ接続情報を localStorage に流し込み、設定モーダルでハブパネルを開く
async function openHubPanel(page, { method }) {
    await page.evaluate((m) => {
        const cfg = JSON.parse(localStorage.getItem('bookshelf_sync') || '{}');
        cfg.method = m;
        cfg.hub = {
            apiBase: 'https://hub.example.test', key: 'k-test', uid: 'u1', siteId: 's1',
            email: 'reader@example.com', plan: 'free', usedBytes: 0, quotaBytes: 100 * 1024 * 1024
        };
        localStorage.setItem('bookshelf_sync', JSON.stringify(cfg));
        window.bookshelf.syncConfig = cfg;
    }, method);
    // 同期セクション (details) を開いてセレクトを可視化してから切替える
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    await page.selectOption('#sync-method-select', 'hub');
}

test('H-3: ログイン済みでも保存先未適用なら「この設定で使う」を促す警告が出る', async ({ page }) => {
    await bootApp(page);
    await openHubPanel(page, { method: 'local' });
    const state = page.locator('#hub-active-state');
    await expect(state).toBeVisible();
    await expect(state).not.toHaveClass(/is-active/);
    await expect(state).toContainText('まだ本のデータの保存先になっていません');
    const useBtn = page.locator('#hub-use-btn');
    await expect(useBtn).toBeEnabled();
    await expect(useBtn).toContainText('この設定で使う');
});

test('H-3: 保存先がハブのときは「使用中」表示でボタンは無効', async ({ page }) => {
    await bootApp(page);
    await openHubPanel(page, { method: 'hub' });
    const state = page.locator('#hub-active-state');
    await expect(state).toBeVisible();
    await expect(state).toHaveClass(/is-active/);
    await expect(state).toContainText('使用中');
    const useBtn = page.locator('#hub-use-btn');
    await expect(useBtn).toBeDisabled();
    await expect(useBtn).toContainText('使用中');
});

test('H-3: 未ログイン・規約同意済みならハブ節内に直接ログインボタンを出す', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        // 外部 GIS 読込を伴う描画はスタブ化し、同意ゲートのロジックだけを検証する
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
        if (!window.bookshelf.userData.settings) window.bookshelf.userData.settings = {};
        window.bookshelf.userData.settings.ackTermsPrivacy = { at: '2026-06-26T00:00:00Z', v: 'v1.0' };
    });
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    await page.selectOption('#sync-method-select', 'hub');
    await expect(page.locator('#hub-gsi-button')).toBeVisible();
    await expect(page.locator('#hub-goto-account')).toBeHidden();
});

test('H-3: 規約同意済み・未ログインでもブート時に Google GIS を先読みしない (パネルを開くまで遅延)', async ({ page }) => {
    // window.HubAuth 代入を横取りして renderSignInButton 呼び出し回数を数える
    await page.addInitScript(() => {
        let real;
        window.__gisRenderCount = 0;
        Object.defineProperty(window, 'HubAuth', {
            configurable: true,
            get() { return real; },
            set(v) {
                real = v;
                if (v && typeof v.renderSignInButton === 'function' && !v.__spied) {
                    const orig = v.renderSignInButton.bind(v);
                    v.renderSignInButton = (...a) => { window.__gisRenderCount++; return orig(...a); };
                    v.__spied = true;
                }
            },
        });
    });
    // 規約同意済み・ハブ未接続・method=local (ハブパネルは閉じた状態で起動)
    const ud = JSON.parse(fixtureUserData);
    ud.settings = ud.settings || {};
    ud.settings.ackTermsPrivacy = { at: '2026-06-26T00:00:00Z', v: 'v1.0' };
    await bootApp(page, { userData: JSON.stringify(ud) });
    // ブート直後は GIS を実体化していない (遅延読込方針)
    expect(await page.evaluate(() => window.__gisRenderCount)).toBe(0);
    // ハブパネルを開いて初めて実体化される
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    await page.selectOption('#sync-method-select', 'hub');
    await expect.poll(() => page.evaluate(() => window.__gisRenderCount)).toBe(1);
});

test('H-3: 未ログイン・規約未同意ならアカウント節への誘導を出す', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        if (window.bookshelf.userData.settings) delete window.bookshelf.userData.settings.ackTermsPrivacy;
    });
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    await page.selectOption('#sync-method-select', 'hub');
    await expect(page.locator('#hub-goto-account')).toBeVisible();
    await expect(page.locator('#hub-gsi-button')).toBeHidden();
});
