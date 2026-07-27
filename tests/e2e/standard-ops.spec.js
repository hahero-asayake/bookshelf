// 標準操作マトリクス打鍵 (docs/ui-standards.md §1 が正)
// 「閉じたい/戻りたい」の標準操作 (ESC / スマホ戻る=履歴統合 / 枠外クリック) が
// 全モーダル・シートで効くことを担保する。新しい面を作ったらここに行を足す。
import { test, expect } from '@playwright/test';
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
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

// ===== PC: ESC で閉じる =====
test('ESC: 設定・取込モーダルが閉じる (PC)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('ESC/枠外クリック: 衝突ダイアログは「何もしない」で閉じる (破壊選択を既定にしない)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.bookshelf._conflictNotified = false; window.bookshelf._handleSyncConflict('GitHub'); });
    await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sync-conflict-dialog')).toBeHidden();
    // 枠外クリック
    await page.evaluate(() => { window.bookshelf._conflictNotified = false; window.bookshelf._handleSyncConflict('GitHub'); });
    await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
    await page.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#sync-conflict-dialog')).toBeHidden();
    expect(errors).toEqual([]);
});

test('枠外クリック/Enter/ESC: confirmDialog の基本作法', async ({ page }) => {
    const errors = await bootApp(page);
    // 枠外 = false
    const p1 = page.evaluate(() => window.confirmDialog({ title: 'T', message: 'M' }));
    await page.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } });
    expect(await p1).toBe(false);
    // Enter = true
    const p2 = page.evaluate(() => window.confirmDialog({ title: 'T', message: 'M' }));
    await page.locator('.cfm-box').waitFor();
    await page.keyboard.press('Enter');
    expect(await p2).toBe(true);
    expect(errors).toEqual([]);
});

// ===== スマホ: 戻る = 閉じてアプリに留まる (履歴統合) =====
test.describe('スマホ戻る (履歴統合)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('設定モーダル: 戻るで閉じてアプリに留まる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('取込モーダル: 戻るで閉じてアプリに留まる (2026-07-27 統合・再発防止)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');   // about:blank へ離脱しない
        expect(errors).toEqual([]);
    });

    test('取込モーダル: × で閉じても履歴が汚れない (直後の戻るでアプリ離脱しない)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.locator('#import-modal-close').click();
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        await page.waitForTimeout(200);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('本詳細シート: 戻るで閉じてアプリに留まる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
        await page.locator('#bookshelf .book-item').first().click();
        await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
        await page.goBack();
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });
});
