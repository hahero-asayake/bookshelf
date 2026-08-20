// Kindle 取込のバッジ表示・絞り込み (イシュー#41)。import-bookmarklet.spec.js を雛形に、
// originType/statusFromPlatformSearch 付き items を postMessage で注入し、
// 取込 → カードにバッジが出る → 絞り込みで件数が変わる → 解除で戻る → 既存フィクスチャが消えない、を検証する。
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

const NEW_ITEMS = [
    { title: 'KU本(借用中)', authors: '著者K', acquiredTime: 1700000010000, readStatus: 'UNKNOWN', asin: 'B0KUITEM01', productImage: '', originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan' },
    { title: '返却済みKU本', authors: '著者K', acquiredTime: 1700000011000, readStatus: 'UNKNOWN', asin: 'B0KUITEM02', productImage: '', originType: 'Ku', statusFromPlatformSearch: 'Revoked', lendingType: 'KU', lendingStatus: 'Terminated' },
    { title: '購入本(新規)', authors: '著者P', acquiredTime: 1700000012000, readStatus: 'READ', asin: 'B0PURITEM1', productImage: '', originType: 'Purchase', statusFromPlatformSearch: 'Active' }
];

async function importNewItems(page) {
    await page.evaluate(() => {
        window.open = () => ({ closed: false });
        window.bookshelf.userData.settings.extensionImportOrigins = [location.origin];
        window.bookshelf.showImportModal();
    });
    await page.locator('#open-amazon-for-import').click();
    await page.evaluate((items) => {
        window.postMessage({ type: 'kindleBookshelfExport', ok: true, items }, location.origin);
    }, NEW_ITEMS);
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#book-selection')).toBeHidden();
    await page.evaluate(() => window.bookshelf.closeImportModal());
}

test('取込でバッジが出る／絞り込みで件数が変わる／解除で戻る／既存フィクスチャは消えない', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(5);

    await importNewItems(page);
    // 既存5冊 + 新規3冊 = 8冊
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(8);

    // 既存フィクスチャ (フィールド無し) の本が消えていない
    await expect(page.locator('#bookshelf .book-item[data-asin="B000000001"]')).toHaveCount(1);
    await expect(page.locator('#bookshelf .book-item[data-asin="B000000005"]')).toHaveCount(1);

    // バッジ: KU本(借用中) には KU バッジ、返却済みKU本には KU + 利用終了の両方、購入本にはバッジ無し
    const kuOnLoan = page.locator('#bookshelf .book-item[data-asin="B0KUITEM01"]');
    await expect(kuOnLoan.locator('.book-badge')).toHaveCount(1);
    await expect(kuOnLoan.locator('.book-badge')).toContainText('KU');

    const kuRevoked = page.locator('#bookshelf .book-item[data-asin="B0KUITEM02"]');
    await expect(kuRevoked.locator('.book-badge')).toHaveCount(2);
    await expect(kuRevoked.locator('.book-badge').filter({ hasText: '利用終了' })).toHaveCount(1);
    await expect(kuRevoked.locator('.book-badge').filter({ hasText: 'KU' })).toHaveCount(1);

    const purchase = page.locator('#bookshelf .book-item[data-asin="B0PURITEM1"]');
    await expect(purchase.locator('.book-badge')).toHaveCount(0);

    // 絞り込み: 「利用終了」を選ぶと1件だけ (返却済みKU本)
    await page.locator('#toggle-filter').click();
    await expect(page.locator('#filter-popover')).toBeVisible();
    await page.locator('#kindle-seg .rseg[data-kindle="revoked"]').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(1);
    await expect(page.locator('#bookshelf .book-item[data-asin="B0KUITEM02"]')).toHaveCount(1);
    await expect(page.locator('#kindle-filter-reset')).toBeVisible();
    await expect(page.locator('#toggle-filter')).toHaveClass(/has-active-filter/);

    // 「KU/Prime」も追加選択すると OR で2件 (借用中KU + 返却済みKU)
    await page.locator('#kindle-seg .rseg[data-kindle="kuprime"]').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(2);

    // 解除で 8件に戻る
    await page.locator('#kindle-filter-reset').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(8);
    await expect(page.locator('#toggle-filter')).not.toHaveClass(/has-active-filter/);

    // GIS は tests/e2e/helpers/test-base.js で遮断済み。net::ERR は環境依存の外部到達要因のみ除外
    expect(errors.filter(e => !/net::ERR/.test(e))).toEqual([]);
});
