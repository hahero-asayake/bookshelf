// 冊数が変わる操作のあと、再読込なしで左ツリーの「すべての本」の冊数とホームの「蔵書 N 冊」が正しい数になることを
// 利用者の操作で確かめる (イシュー#605)。取込の直後に左ツリー・ホームが 0 のままだった (#590 不具合2)。
// 除外・一括除外は bookOrder.all を別の配列に置き換えるため、その後の除外の取り消し・手で追加・取込でも
// 左ツリーが古くならないこと (all 本棚の配列が分かれた後) も同じ流れで見る。描き直しは共通の _onLibraryChanged()。
// 削除 (deleteBook) は本の詳細から入口を撤去済み (2026-06-01 B-8・#601) のため、利用者の操作では通せない。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openSettingsByClick } from './helpers/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = JSON.parse(readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8'));
const fixtureLibrary = JSON.parse(readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8'));

const BOOKS = [1, 2, 3, 4].map((n) => ({
    title: `冊数確認の本 ${n}`, authors: '冊数 確認', acquiredTime: 1700000000000 + n * 1000,
    readStatus: 'UNKNOWN', asin: `B0CNT6050${n}`, productImage: ''
}));
const ASINS = BOOKS.map((b) => b.asin);

// 蔵書0冊のユーザーデータ (dashboard-stats-after-manual-add.spec.js と同じ作り)。
// JSON から戻すので all 本棚の books と bookOrder.all は最初から別の配列になる。
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
    const { userData, library } = buildEmptyFixtures();
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userData, library]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

const sidebarAllCount = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-count');
const homeTotal = (page) => page.locator('#dashboard .rs-total');
const homeCounter = (page) => page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value');

async function expectHomeCounts(page, n) {
    await expect(homeTotal(page)).toHaveText(`蔵書 ${n} 冊`);
    await expect(homeCounter(page)).toHaveText(String(n));
}

async function pasteAndImport(page, books, expectedNew) {
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(JSON.stringify(books));
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-list .book-selection-item')).toHaveCount(expectedNew);
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#import-results .stat-value.success')).toHaveText(String(expectedNew));
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
}

async function openAllShelf(page) {
    await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
    await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
}

// 設定の中で開いた面 (除外した本・手で追加の入力) ごとに Esc で1段ずつ閉じ、設定そのものが閉じるまで押す
async function closeSettings(page) {
    for (let i = 0; i < 4 && (await page.locator('#settings-modal.show, #exclusions-modal.show').count()) > 0; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
}

async function goHome(page) {
    await page.locator('.sidebar-brand').click();
    await expect(page.locator('body')).toHaveClass(/app-view-main/);
}

test.use({ viewport: { width: 1280, height: 800 } });

test('冊数が変わる操作のあと、再読込なしで左ツリーの「すべての本」とホームの「蔵書 N 冊」が正しい数になる', async ({ page }) => {
    await bootAppEmpty(page);

    await test.step('前提: 蔵書0冊で、左ツリーもホームも0', async () => {
        await expect(sidebarAllCount(page)).toHaveText('0');
        await expectHomeCounts(page, 0);
    });

    await test.step('取込 (3冊): 取込の画面を閉じたホームのままで 3、蔵書0の案内も消える', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteAndImport(page, BOOKS.slice(0, 3), 3);
        await expect(sidebarAllCount(page)).toHaveText('3');
        await expectHomeCounts(page, 3);
        await expect(page.locator('#dashboard-welcome')).toBeHidden();
    });

    await test.step('除外 (本の詳細の編集から1冊): 左ツリーが 2', async () => {
        await openAllShelf(page);
        await page.locator(`#bookshelf .book-item[data-asin="${ASINS[0]}"]`).first().click();
        await page.locator(`.edit-mode-btn[data-asin="${ASINS[0]}"]`).first().click();
        await page.locator(`.exclude-btn[data-asin="${ASINS[0]}"]`).first().click();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('.toast-success', { hasText: '除外しました' })).toBeVisible();
        await expect(sidebarAllCount(page)).toHaveText('2');
    });

    await test.step('除外の取り消し (設定の「除外した本」から・配列が分かれた後): 左ツリーが 3', async () => {
        await openSettingsByClick(page, 'library-section');
        await page.locator('#show-exclusions').click();
        await page.locator(`#exclusions-list .unexclude-btn[data-asin="${ASINS[0]}"]`).click();
        await expect(page.locator(`#exclusions-list .unexclude-btn[data-asin="${ASINS[0]}"]`)).toHaveCount(0);
        await expect(sidebarAllCount(page)).toHaveText('3');
        await closeSettings(page);
        await expect(page.locator('#exclusions-modal')).not.toHaveClass(/show/);
    });

    await test.step('一括除外 (複数選択で2冊): 左ツリーが 1', async () => {
        await openAllShelf(page);
        await page.locator('#toggle-select-mode').click();
        await page.locator(`#bookshelf .book-item[data-asin="${ASINS[1]}"]`).first().click();
        await page.locator(`#bookshelf .book-item[data-asin="${ASINS[2]}"]`).first().click();
        await page.locator('#bulk-exclude').click();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('.toast-success', { hasText: '冊を除外しました' })).toBeVisible();
        await expect(sidebarAllCount(page)).toHaveText('1');
    });

    await test.step('手で1冊追加 (配列が分かれた後): 左ツリーが 2', async () => {
        await openSettingsByClick(page, 'library-section');
        await page.locator('#add-book-manually').click();
        await page.locator('#manual-asin').fill('B0CNT60599');
        await page.locator('#manual-title').fill('冊数確認の手で足した本');
        await page.locator('#add-manually').click();
        await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
        await expect(sidebarAllCount(page)).toHaveText('2');
        await closeSettings(page);
    });

    await test.step('取込 (設定から・新しい1冊・配列が分かれた後): 左ツリーが 3', async () => {
        await openSettingsByClick(page, 'library-section');
        await page.locator('#import-kindle').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteAndImport(page, [BOOKS[3]], 1);
        await expect(sidebarAllCount(page)).toHaveText('3');
    });

    await test.step('ホームに戻ると「蔵書 3 冊」・蔵書数 3', async () => {
        await page.keyboard.press('Escape');
        await goHome(page);
        await expectHomeCounts(page, 3);
        await expect(sidebarAllCount(page)).toHaveText('3');
    });
});
