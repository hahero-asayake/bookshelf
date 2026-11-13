// イシュー#501 U0a: 本の詳細 B2〜B4 の今の振る舞いを固定する (77件の表の対象分)。
// 出典: 499-step1-inventory.md §6「B：本の詳細」・499-step4-plan.md §3-1 の77件表
// 操作はクリックだけで書く。本を開く導線は本棚一覧のカードクリック(内部メソッドは呼ばない)。
import { test, expect } from '../helpers/test-base.js';
import { mockSyncReady } from '../helpers/sync.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';
const ASIN2 = 'B000000002';

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

// ホームの「最近追加した本」ウィジェットから、クリックだけで本の詳細を開く(内部メソッド不使用)
async function openBookFromHome(page, asin) {
    await page.locator(`.widget-book-cell[data-asin="${asin}"]`).first().click();
}

const WIDTHS = [
    ['char-390', 390, 844],
    ['char-768', 768, 1024],
    ['char-1024', 1024, 1366],
    ['char-1440', 1440, 900],
    ['char-1920', 1920, 1080],
];

for (const [name] of WIDTHS) {
    test(`B2@${name}: 本の詳細から本棚を外す(remove-from-bookshelf)が反映される`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末(${testInfo.project.name})はB2の対象外ではない想定(全5幅が対象)`);
        await bootApp(page);
        await openBookFromHome(page, ASIN);
        await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
        await page.click('.edit-mode-btn');
        const chipsRow = page.locator(`#current-bookshelves-${ASIN}`);
        const before = await chipsRow.locator('.bd-chip').count();
        expect(before).toBeGreaterThan(0); // fixtureで複数本棚に所属(all + fixshelf)
        // // CHAR→U5: removeFromBookshelf() は window.confirm() ではなく confirmDialog(DOM) を使うようになった
        // (今の振る舞い)。page.once('dialog') は発火しないため、クリック後に出る .cfm-ok を明示的に押す
        // (内部メソッドは呼ばない=UI操作の結果という元の方針を保つ)。
        await chipsRow.locator('.remove-from-bookshelf').first().click();
        await page.locator('.cfm-overlay .cfm-ok').click();
        await expect.poll(() => chipsRow.locator('.bd-chip').count()).toBe(before - 1);
    });
}

test('B3@390/768/1024: 長文メモを開いて書く→戻ると本の詳細に戻る (77件表)', async ({ page }, testInfo) => {
    test.skip(!['char-390', 'char-768', 'char-1024'].includes(testInfo.project.name), 'B3の対象幅は390/768/1024(77件表)');
    await bootApp(page);
    // 実測: 長文メモの入口は.memo-file-btn(js/bookshelf.js:3297-3301)。openOrCreateBookMemo()は
    // _isSyncReady()がfalseだとtoastを出すだけなので、他のcharスペックと同じ型でモックする。
    await mockSyncReady(page, true);
    await openBookFromHome(page, ASIN);
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
    await page.click('.edit-mode-btn');
    const longMemoBtn = page.locator('.memo-file-btn').first();
    await expect(longMemoBtn).toBeVisible();
    await longMemoBtn.click();
    await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
});

test('B4@1024: 本の詳細を開いたまま隣の本へ切り替える', async ({ page }, testInfo) => {
    // 未確認の食い違い: 77件表(499-step4-plan.md)はB4の対象幅を390/768/1024とするが、B4自体の定義
    // (499-step1-inventory.md「B4: PCの右ペインで隣の本へ切替」)は元々PCの右ペイン限定のシナリオ。
    // 実測: 390も768も本の詳細が全画面オーバーレイになり、背後のホームをクリックできず測れなかった
    // (CSSの768px境目=@media(max-width:768px)がモーダル化の分岐点)。1024だけ右ペインとして測れた。
    test.skip(testInfo.project.name !== 'char-1024', 'B4の対象幅は1024のみ(390/768は全画面化のため測れない・実測)');
    await bootApp(page);
    await openBookFromHome(page, ASIN);
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
    const title1 = await page.locator('#book-detail-pane .bd-title').textContent();
    await openBookFromHome(page, ASIN2);
    await expect.poll(() => page.locator('#book-detail-pane .bd-title').textContent()).not.toBe(title1);
    // CHAR-77 B4: 2冊目クリックでペインが入れ替わる(測れた)
});
