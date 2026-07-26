// 同期衝突ダイアログ (WP-B2) の回帰テスト
//  3択 (何もしない / JSON書き出し / 再読込) + 書き出し後に選び直せること
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
    return errors;
}

test('衝突ダイアログに3択が出て、同期元名が入る (ハブ)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.bookshelf._handleSyncConflict('Asayake ハブ'); });
    const dlg = page.locator('#sync-conflict-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.cfm-message')).toContainText('Asayake ハブ');
    await expect(dlg.locator('.cfm-cancel')).toHaveText('何もしない');
    await expect(dlg.locator('.cfm-export')).toHaveText('編集内容をJSONで書き出す');
    await expect(dlg.locator('.cfm-ok')).toHaveText('再読込して最新版を取得');
    // 何もしない → 閉じる
    await dlg.locator('.cfm-cancel').click();
    await expect(dlg).toBeHidden();
    expect(errors).toEqual([]);
});

test('書き出しを選ぶと JSON がダウンロードされ、ダイアログに戻って再読込も選べる', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.bookshelf._handleSyncConflict('GitHub'); });
    const dlg = page.locator('#sync-conflict-dialog');
    await expect(dlg).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await dlg.locator('.cfm-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    // 退避後にダイアログへ戻る (改めて再読込を選べる)
    await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
    // 再読込を選ぶとページがリロードされる
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        page.locator('#sync-conflict-dialog .cfm-ok').click()
    ]);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    expect(errors).toEqual([]);
});
