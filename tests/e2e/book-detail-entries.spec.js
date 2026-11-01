// イシュー#453 step2: 本の詳細 (共通パネル) を ホーム・本棚・⌘K の3つの入口から開き、
// どこから開いても同じように 編集→保存→再表示 が動くことを確かめる。
// 併せて、案A (.bd-meta-edit の入れ子を撤去しtopbarの編集終了ボタン1つに保存を統合) で
// 「.cancel-edit-btn 共有により未保存入力が無言で消える」旧実装の欠陥が解消したことと、
// topbar の ✓ を position:sticky にしたことで 390 のキーボード近似下でも見えることを確かめる。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

// ===== 3つの入口 =====
async function openFromHome(page) {
    await page.evaluate(() => window.bookshelf.router.navigateMain());
    await page.waitForTimeout(300);
    await page.locator(`.widget-book-cell[data-asin="${ASIN}"]`).first().click();
}
async function openFromShelf(page) {
    await page.evaluate((asin) => {
        const bs = window.bookshelf.userData.bookshelves.find(b => !b.isSpecial) || window.bookshelf.userData.bookshelves[0];
        window.bookshelf.switchBookshelf(bs.id);
    }, ASIN);
    await page.waitForTimeout(300);
    await page.locator(`.book-item[data-asin="${ASIN}"]`).first().click();
}
async function openFromPalette(page) {
    await page.evaluate(() => window.bookshelf._openPalette());
    await page.waitForTimeout(200);
    await page.fill('#command-palette input', 'フィクスチャの本 1');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
}

const ENTRIES = [
    ['ホーム', openFromHome],
    ['本棚', openFromShelf],
    ['⌘K', openFromPalette],
];

for (const [label, openFn] of ENTRIES) {
    test(`本の詳細(${label}入口): 編集→保存→再表示が同じように動く`, async ({ page }) => {
        await bootApp(page);
        await openFn(page);
        await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
        // 編集モードへ
        await page.click('.edit-mode-btn');
        await expect(page.locator('.bd.editing')).toBeVisible();
        const titleInput = page.locator(`.edit-title[data-asin="${ASIN}"]`);
        await expect(titleInput).toBeVisible(); // 案A: <details>展開不要で常時表示
        const newTitle = `編集後タイトル(${label})`;
        await titleInput.fill(newTitle);
        // topbar の編集終了ボタン(✓)=保存 (旧実装の専用「保存」ボタンは撤去済み)
        await expect(page.locator('.save-book-changes')).toHaveCount(0);
        await page.click('.bd-edit-toggle.cancel-edit-btn');
        await page.waitForTimeout(300);
        // 保存されて閲覧モードへ再表示
        await expect(page.locator('.bd.editing')).toHaveCount(0);
        await expect(page.locator('#book-detail-pane .bd-title')).toHaveText(newTitle);
        expect(await page.evaluate((asin) => window.bookshelf.books.find(b => b.asin === asin).title, ASIN)).toBe(newTitle);
    });
}

test('案A: .cancel-edit-btn 共有の欠陥が解消(メタ編集中に「編集を終える」を押すと無言で消えず保存される)', async ({ page }) => {
    await bootApp(page);
    await openFromHome(page);
    await page.click('.edit-mode-btn');
    const titleInput = page.locator(`.edit-title[data-asin="${ASIN}"]`);
    await titleInput.fill('保存されるはずのタイトル');
    // 旧実装では .bd-meta-edit-actions 内の専用キャンセルも topbar の✓も同じ
    // .cancel-edit-btn クラスで無条件に showBookDetail(book,false) を呼び、
    // 未保存入力が確認なしで消えていた。案Aはこのボタンが存在しない(撤去済み)ことに加え、
    // 残る唯一の .cancel-edit-btn (topbarの編集終了) が saveBookChanges を呼ぶため、
    // 「編集を終える」操作が常に保存を伴うことを確認する。
    await expect(page.locator('.bd-meta-edit-actions')).toHaveCount(0);
    await expect(page.locator('.cancel-edit-btn')).toHaveCount(1);
    await page.click('.cancel-edit-btn');
    await page.waitForTimeout(300);
    await expect(page.locator('#book-detail-pane .bd-title')).toHaveText('保存されるはずのタイトル');
});

test('390: topbar の✓(編集終了=保存)はキーボード近似(viewport55%)でもASIN欄フォーカス時に完全に見える(position:sticky)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootApp(page);
    await page.evaluate((asin) => {
        const book = window.bookshelf.books.find(b => b.asin === asin);
        window.bookshelf.showBookDetail(book, true);
    }, ASIN);
    await page.waitForTimeout(200);
    await page.click(`.edit-original-asin[data-asin="${ASIN}"]`);
    // キーボード近似: viewport高さを55%に縮小 (記事エディタ390実測#273と同型の手法・453-shot-bookdetail.mjsと同じ近似)
    await page.setViewportSize({ width: 390, height: Math.round(844 * 0.55) });
    await page.waitForTimeout(150);
    const toggle = page.locator('.bd-edit-toggle.cancel-edit-btn');
    const box = await toggle.boundingBox();
    expect(box, '✓ ボタンがDOM上に存在する').toBeTruthy();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(Math.round(844 * 0.55));
});
