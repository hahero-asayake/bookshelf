// 手動で本を追加した直後、ホームの統計ウィジェット(蔵書数)が更新されることを検証する。
// addBookManually() は applyFilters()/updateStats() のみ呼んでおり、updateStats() は
// #total-books (蔵書一覧ヘッダ) だけを更新してホームの「蔵書数」ウィジェット
// (BookshelfDashboard._renderCounterTotal) は再描画されない。実測でも「手動で本を追加した
// 直後にホームの統計が0冊のまま」(#225 P4) を確認した。updateBookshelfSelector() 経由で
// ダッシュボードも再描画するよう直した (イシュー#232 step3)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = JSON.parse(readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8'));
const fixtureLibrary = JSON.parse(readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8'));

// 蔵書0冊のユーザーデータを作る (ようこそカードが出る状態と同じ条件)。
function buildEmptyFixtures() {
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    const library = JSON.parse(JSON.stringify(fixtureLibrary));
    library.books = [];
    library.metadata = { ...library.metadata, totalBooks: 0 };
    const allShelf = userData.bookshelves.find((s) => s.isSpecial);
    if (allShelf) allShelf.books = [];
    userData.bookOrder = { all: [] };
    userData.stats = { totalBooks: 0, notesCount: 0 };
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

async function bootAppEmpty(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    const { userData, library } = buildEmptyFixtures();
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userData, library]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

test('実UI操作: 手動で本を追加した直後にホームの蔵書数ウィジェットが更新される', async ({ page }) => {
    await bootAppEmpty(page);

    // 蔵書0冊スタートなのでホームに「蔵書数」ウィジェットが 0 で出ている
    const counterCard = page.locator('.dashboard-widget').filter({ hasText: '蔵書数' });
    await expect(counterCard.locator('.bn-value')).toHaveText('0');

    // 実UI操作で手動追加 (#add-book-manually は設定モーダル「蔵書」セクション内)
    await page.evaluate(() => window.bookshelf._openSettingsModal('library-section'));
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill('B0STATSTEST');
    await page.locator('#manual-title').fill('統計更新確認用ダミー本');
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    await page.locator('#settings-modal-close').click();
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);

    // ホームへ戻った時点で「蔵書数」ウィジェットが再読込なしで 1 に更新されていること
    await expect(counterCard.locator('.bn-value')).toHaveText('1');
});
