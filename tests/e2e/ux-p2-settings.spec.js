// UI再設計 P2 (設定 master-detail, ADR-047) の回帰テスト
//  - 一覧(master) → カテゴリを押すと全画面 detail。スマホは history で戻る/スワイプ1段
//  - PC は左レール + 右ペイン。既定はアカウント、レールで切替
//  - × = 閉じる / フッターの「閉じる」(#settings-modal-done) は廃止 (二重クローズ解消)
//  - ターゲット直開き (_openSettingsModal('sync-method-select')) で該当カテゴリが開く
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

test('P2: スマホは一覧→詳細、戻るで一覧→閉じる (history 2段)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const errors = await bootApp(page);
    const content = page.locator('.settings-modal-content');
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    // 一覧 (master)
    await expect(content).toHaveAttribute('data-settings-view', 'master');
    await expect(page.locator('#settings-back')).toBeHidden();
    await expect(page.locator('#settings-master .settings-cat[data-cat="sync-section"]')).toBeVisible();
    // 同期を押す → 詳細 (pane-active・戻る表示)
    await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
    await expect(content).toHaveAttribute('data-settings-view', 'detail');
    await expect(page.locator('#sync-section')).toHaveClass(/pane-active/);
    await expect(page.locator('#settings-back')).toBeVisible();
    // 戻る (履歴) → 一覧へ1段
    await page.evaluate(() => history.back());
    await expect(content).toHaveAttribute('data-settings-view', 'master');
    await expect(page.locator('#sync-section')).not.toHaveClass(/pane-active/);
    // もう一度戻る → 閉じる
    await page.evaluate(() => history.back());
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('P2: 戻るボタンで一覧へ戻る (スマホ)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await bootApp(page);
    const content = page.locator('.settings-modal-content');
    await page.evaluate(() => window.bookshelf._openSettingsModal('publish-target-select'));
    await expect(content).toHaveAttribute('data-settings-view', 'detail');
    await expect(page.locator('#publish-section')).toHaveClass(/pane-active/);
    await page.locator('#settings-back').click();
    await expect(content).toHaveAttribute('data-settings-view', 'master');
});

test('P2: × で閉じる / フッターの「閉じる」は廃止', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await expect(page.locator('#settings-modal-done')).toHaveCount(0);
    await page.locator('#settings-modal-close').click();
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('P2: PC は左レール+ペイン。既定アカウント、レールで切替', async ({ page }) => {
    const errors = await bootApp(page); // 既定 = デスクトップ
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#settings-master .settings-cat[data-cat="account-section"]')).toHaveClass(/cat-active/);
    // レールで同期へ切替 → ペインが入れ替わる
    await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
    await expect(page.locator('#sync-section')).toBeVisible();
    await expect(page.locator('#account-section')).toBeHidden();
    await expect(page.locator('#settings-master .settings-cat[data-cat="sync-section"]')).toHaveClass(/cat-active/);
    expect(errors).toEqual([]);
});

test('P2: ターゲット直開きで該当カテゴリが開きフォーカス対象が見える', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
    await expect(page.locator('#sync-section')).toHaveClass(/pane-active/);
    await expect(page.locator('#sync-method-select')).toBeVisible();
    expect(errors).toEqual([]);
});

// スマホで設定の中身が画面より長いときスクロールできる (2026-07-28 実機報告の回帰ガード。
// .settings-modal-content が overflow:hidden のため、モバイルは .settings-md-body に
// overflow-y:auto が無いと中身が切り捨てられて届かなくなる)
test.describe('スマホ 設定スクロール', () => {
    test.use({
        viewport: { width: 390, height: 480 },
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });

    test('P2: 設定詳細が画面より長いときスクロールが効く', async ({ page }) => {
        const errors = await bootApp(page);
        // 中身が確実に長くなる状態 (公開先=GitHub のリポジトリブロック表示) にして開く
        await page.evaluate(() => {
            const cfg = SyncConfigManager.load();
            cfg.publish = { ...(cfg.publish || {}), target: 'github' };
            SyncConfigManager.save(cfg);
            window.HubAuth.renderSignInButton = () => {};
            window.bookshelf._openSettingsModal('publish-section');
        });
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        const diag = await page.evaluate(() => {
            const el = document.querySelector('.settings-md-body');
            const over = el.scrollHeight - el.clientHeight;
            el.scrollTop = 150;
            return { over, scrolledTo: el.scrollTop };
        });
        expect(diag.over).toBeGreaterThan(50);      // 前提: この viewport では中身がはみ出す
        expect(diag.scrolledTo).toBeGreaterThan(0); // はみ出した分をスクロールで送れる
        expect(errors).toEqual([]);
    });
});
