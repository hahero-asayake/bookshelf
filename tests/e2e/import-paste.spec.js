// 貼り付け/クリップボード取込 (スマホ向け。ブックマークレットがコピーした JSON を取込む経路)
// 拡張・ファイル不要で、テキストエリアに JSON を貼って取込 → 本選択リストに出ることを確認する。
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

// ブックマークレットがクリップボードに出すのと同じ「本の配列」JSON
const PASTE_JSON = JSON.stringify([
    { title: '貼り付けの本A', authors: '著者A', acquiredTime: 1700000000000, readStatus: 'UNKNOWN', asin: 'B0PASTE001', productImage: '' },
    { title: '貼り付けの本B', authors: '著者B', acquiredTime: 1700000001000, readStatus: 'READ', asin: 'B0PASTE002', productImage: '' }
]);

test('取込モーダルは PC 専用 (端末タブ・モバイルレーンが存在しない, C-248)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    // PC レーンだけが見えて、モバイル系導線は DOM ごと無い
    await expect(page.locator('#import-lane-pc')).toBeVisible();
    await expect(page.locator('.import-device-tab')).toHaveCount(0);
    await expect(page.locator('#import-lane-ios')).toHaveCount(0);
    await expect(page.locator('#import-lane-android')).toHaveCount(0);
    await expect(page.locator('#add-shortcut-btn')).toHaveCount(0);
    await expect(page.locator('#copy-bookmarklet')).toHaveCount(0);
    // フォールバックの直接貼付は残る
    await expect(page.locator('#import-method-data')).toBeVisible();
    expect(errors).toEqual([]);
});

test('貼り付け取込: JSON を貼って取込むと本選択リストに出る', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await page.locator('#kindle-paste-input').fill(PASTE_JSON);
    await page.locator('#import-from-paste').click();
    // 選択UIが出て、新規2冊が並ぶ (既存フィクスチャは hide-existing 既定で非表示)
    await expect(page.locator('#book-selection')).toBeVisible();
    await expect(page.locator('#book-list .book-selection-item')).toHaveCount(2);
    await expect(page.locator('#book-list')).toContainText('貼り付けの本A');
    expect(errors).toEqual([]);
});

test('貼り付け取込: 不正な JSON はトーストで弾き選択UIを出さない', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await page.locator('#kindle-paste-input').fill('これはJSONではない');
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeHidden();
    expect(errors).toEqual([]);
});
