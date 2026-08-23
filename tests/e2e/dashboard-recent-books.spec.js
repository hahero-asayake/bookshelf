// ダッシュボード「最近追加した本」ウィジェットが大画面で余白を作らないことを検証する (U-8)。
// _renderRecentBooks の件数上限 (js/dashboard.js) を常に溢れる値に変更した結果、
// 幅を変えても .widget-book-row の合計セル幅がコンテナ幅を超え続け、overflow-x:auto の
// 横スクロールに任せられることを実測する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// _renderRecentBooks の上限 (80) を確実に超える件数を注入する。イシュー#59と同じ理由で
// library.books と "all" 特殊本棚の books 配列 (asin一覧) の両方を更新する。
const BOOK_COUNT = 90;

function buildManyBooksFixtures(count) {
    const userData = JSON.parse(fixtureUserData);
    const library = JSON.parse(fixtureLibrary);
    const books = [];
    const asins = [];
    for (let i = 1; i <= count; i++) {
        const asin = `B${String(i).padStart(9, '0')}`;
        asins.push(asin);
        books.push({
            asin, title: `ダミー本 ${i}`, authors: `著者${i % 10}`,
            acquiredTime: 1700000000000 + i * 1000, readStatus: 'READ',
            productImage: '', source: 'fixture', addedDate: 1700000000000 + i * 1000
        });
    }
    library.books = books;
    library.metadata = { ...library.metadata, totalBooks: books.length };
    const allShelf = userData.bookshelves.find((s) => s.isSpecial);
    allShelf.books = asins;
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

async function bootAppWithManyBooks(page, count = BOOK_COUNT) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    const { userData, library } = buildManyBooksFixtures(count);
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userData, library]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

for (const width of [1280, 1920, 3080]) {
    test(`幅${width}pxで「最近追加した本」に横余白が出ない`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors = await bootAppWithManyBooks(page);
        const row = page.locator('.widget-book-row');
        await expect(row).toBeVisible();
        const { scrollWidth, clientWidth } = await row.evaluate((el) => ({
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth
        }));
        expect(scrollWidth).toBeGreaterThan(clientWidth);
        expect(errors).toEqual([]);
    });
}

test('「最近追加した本」の横スクロールが機能する', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await bootAppWithManyBooks(page);
    const row = page.locator('.widget-book-row');
    await expect(row).toBeVisible();
    await row.evaluate((el) => { el.scrollLeft = 0; });
    const before = await row.evaluate((el) => el.scrollLeft);
    await row.evaluate((el) => { el.scrollLeft = 300; });
    const after = await row.evaluate((el) => el.scrollLeft);
    expect(after).toBeGreaterThan(before);
});
