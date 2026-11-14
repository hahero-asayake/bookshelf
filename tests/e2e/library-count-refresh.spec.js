// 冊数が変わる操作のあと、再読込なしで左ツリーの「すべての本」の冊数とホームの「蔵書 N 冊」が正しい数になることを
// 利用者の操作で確かめる (イシュー#605)。取込の直後に左ツリー・ホームが 0 のままだった (#590 不具合2)。
// 除外・一括除外は bookOrder.all を別の配列に置き換えるため、その後の除外の取り消し・手で追加・取込でも
// 左ツリーが古くならないこと (all 本棚の配列が分かれた後) も同じ流れで見る。描き直しは共通の _onLibraryChanged()。
// 削除 (deleteBook) は本の詳細から入口を撤去済み (2026-06-01 B-8・#601) のため、利用者の操作では通せない。
// 評価・本棚の所属を変えた直後も同じ描き直しを通す (イシュー#615)。PC 幅では本の詳細を開いたままでもホームが隣に
// 見えているので、ホームの評価分布・未評価・本棚別 Top5 は詳細を開いたままで、左ツリーの本棚の冊数は詳細を閉じた後に見る。
// ホームを描き直しても、横に送っていた「最近追加した本」の位置が先頭へ戻らないことも見る (位置は描き直しの中で戻す)。
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
// fixture にある利用者の本棚 (テスト本棚)。本棚の所属の変更で使う (イシュー#615)
const SHELF = fixtureUserData.bookshelves.find((s) => !s.isSpecial);

// 蔵書0冊のユーザーデータ (dashboard-stats-after-manual-add.spec.js と同じ作り)。
// JSON から戻すので all 本棚の books と bookOrder.all は最初から別の配列になる。
// emptyShelves: 利用者の本棚の books と評価 (notes) も空にして、数え始めを 0 にそろえる (イシュー#615)。
function buildEmptyFixtures({ emptyShelves = false } = {}) {
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    const library = JSON.parse(JSON.stringify(fixtureLibrary));
    library.books = [];
    library.metadata = { ...library.metadata, totalBooks: 0 };
    const allShelf = userData.bookshelves.find((s) => s.isSpecial);
    if (allShelf) allShelf.books = [];
    if (emptyShelves) {
        for (const s of userData.bookshelves) s.books = [];
        userData.notes = {};
    }
    userData.bookOrder = { all: [] };
    userData.stats = { totalBooks: 0, notesCount: 0 };
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

async function bootAppEmpty(page, opts) {
    const { userData, library } = buildEmptyFixtures(opts);
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

// イシュー#615: 左ツリーの本棚の冊数、ホームの「未評価」の数、読書統計の「評価分布」「本棚別 Top5」の1行の数
const sidebarShelfCount = (page) => page.locator(`#sidebar-bookshelf-tree [data-bookshelf-id="${SHELF.id}"] .bsr-count`);
const homeUnrated = (page) => page.locator('.dashboard-widget').filter({ hasText: '未評価' }).locator('.bn-value');
const ratingDistCount = (page, label) => page.locator('#dashboard .widget-reading-stats .rs-row')
    .filter({ has: page.getByText(label, { exact: true }) }).locator('.rs-v');
const top5Count = (page) => page.locator('#dashboard .widget-reading-stats .rs-shelves li')
    .filter({ has: page.getByText(SHELF.name, { exact: true }) }).locator('strong');

// ホームの3か所 (評価分布の6行・「未評価」の数・本棚別 Top5 のテスト本棚) を期待値と比べる。
// 既定は check = expect.soft で、1か所が違っても止めずに残りの観測点も見る (前提の確認には expect を渡して止める)。
async function expectHomeRatingAndShelf(page, { stars = {}, unrated, shelf }, check = expect.soft) {
    for (const r of [5, 4, 3, 2, 1]) await check(ratingDistCount(page, `★${r}`)).toHaveText(String(stars[r] || 0));
    await check(ratingDistCount(page, '未評価')).toHaveText(String(unrated));
    await check(homeUnrated(page)).toHaveText(String(unrated));
    await check(top5Count(page)).toHaveText(String(shelf));
}

// イシュー#615: ホームの「最近追加した本」の行と、その横スクロール位置
const recentRow = (page) => page.locator('#dashboard .widget-book-row');
const recentRowLeft = (page) => recentRow(page).evaluate((el) => el.scrollLeft);

// 行の上でホイールを回して横へ送り、止まった位置 (scrollLeft) を返す
async function scrollRecentRow(page, dx) {
    const from = await recentRowLeft(page);
    await recentRow(page).hover();
    await page.mouse.wheel(dx, 0);
    await expect.poll(() => recentRowLeft(page)).toBeGreaterThan(from);
    let prev = -1;
    let cur = await recentRowLeft(page);
    for (let i = 0; i < 20 && cur !== prev; i++) {
        prev = cur;
        await page.waitForTimeout(100);
        cur = await recentRowLeft(page);
    }
    return cur;
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

test('評価・本棚の所属を変えたあと、再読込なしでホームの評価分布・未評価・本棚別 Top5 と左ツリーの本棚の冊数が正しい数になる', async ({ page }) => {
    await bootAppEmpty(page, { emptyShelves: true });
    const [A, B] = ASINS; // A: 評価を付け、本棚に出し入れする本 / B: 一括で本棚に足す本
    const detailFromHome = (asin) => page.locator(`#dashboard .widget-book-row [data-asin="${asin}"]`).first();

    await test.step('前提: 4冊を取り込み、左ツリーの「すべての本」を開く。評価なし・テスト本棚は 0', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteAndImport(page, BOOKS, 4);
        await expectHomeCounts(page, 4);
        // 子の本棚の行は親を開いている時だけ出る。開閉は左ツリーを描き直すので、数を変える操作の前に済ませておく
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .tree-toggle').click();
        await expect(sidebarShelfCount(page)).toHaveText('0');
        await expectHomeRatingAndShelf(page, { unrated: 4, shelf: 0 }, expect);
    });

    await test.step('評価 (ホームから本の詳細を開いて★5): 詳細を開いたままで、評価分布の★5 が 1・未評価が 3', async () => {
        await detailFromHome(A).click();
        const stars = page.locator(`#book-detail-pane .star-rating[data-asin="${A}"]`);
        await stars.locator('.star[data-rating="5"]').click();
        await expect(stars).toHaveAttribute('data-current-rating', '5');
        await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
        await expectHomeRatingAndShelf(page, { stars: { 5: 1 }, unrated: 3, shelf: 0 });
    });

    await test.step('本棚に追加 (本の詳細の編集から): 詳細を開いたままで Top5 のテスト本棚が 1、閉じた後の左ツリーも 1', async () => {
        await page.locator(`#book-detail-pane .edit-mode-btn[data-asin="${A}"]`).first().click();
        await page.locator(`#book-detail-pane .bookshelf-select[data-asin="${A}"]`).selectOption(SHELF.id);
        await page.locator(`#book-detail-pane .add-to-bookshelf[data-asin="${A}"]`).click();
        await expect(page.locator('.toast-success', { hasText: `「${SHELF.name}」に追加しました` })).toBeVisible();
        await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
        await expectHomeRatingAndShelf(page, { stars: { 5: 1 }, unrated: 3, shelf: 1 });
        await page.locator('#book-detail-pc-close').click();
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
        await expect.soft(sidebarShelfCount(page)).toHaveText('1');
    });

    // 一括の追加は左ツリーを自分で描き直す経路。ここで左ツリーを正しい 2 にそろえておき、次の「外す」で
    // 左ツリーが古いまま残るかどうかを、この経路だけの結果として見分けられるようにする。
    await test.step('一括で本棚に追加 (一覧で1冊選ぶ): 左ツリーが 2、ホームに戻ると Top5 も 2', async () => {
        await openAllShelf(page);
        await page.locator('#toggle-select-mode').click();
        await page.locator(`#bookshelf .book-item[data-asin="${B}"]`).first().click();
        await page.locator('#bulk-add-shelf').click();
        await page.locator(`#bulk-shelf-list [data-bs-internal="${SHELF.internalId}"]`).click();
        await expect(page.locator('.toast-success', { hasText: `1 冊を「${SHELF.name}」に追加しました` })).toBeVisible();
        await expect(sidebarShelfCount(page)).toHaveText('2');
        await page.locator('#toggle-select-mode').click();
        await expect(page.locator('body')).not.toHaveClass(/select-mode/);
        await goHome(page);
        await expectHomeRatingAndShelf(page, { stars: { 5: 1 }, unrated: 3, shelf: 2 }, expect);
    });

    await test.step('本棚から外す (本の詳細の編集から・外すと詳細は閉じる): 左ツリーが 1、Top5 も 1', async () => {
        await detailFromHome(A).click();
        await page.locator(`#book-detail-pane .edit-mode-btn[data-asin="${A}"]`).first().click();
        await page.locator(`#book-detail-pane .remove-from-bookshelf[data-bookshelf-id="${SHELF.id}"]`).click();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('.toast-success', { hasText: `を「${SHELF.name}」から除外しました` })).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
        await expect.soft(sidebarShelfCount(page)).toHaveText('1');
        await expectHomeRatingAndShelf(page, { stars: { 5: 1 }, unrated: 3, shelf: 1 });
    });
});

// 評価・本棚の所属の変更でもホームを描き直すようになった (イシュー#615)。描き直しは行の要素を作り直すので、
// 位置を戻さないと、横に送って選んだ本に★を付けた時に行が先頭へ飛ぶ。
test('評価・本棚への追加でホームを描き直しても、横に送った「最近追加した本」の位置が先頭へ戻らない', async ({ page }) => {
    await bootAppEmpty(page, { emptyShelves: true });
    // 行が横にあふれる冊数 (1280 幅で一度に見えるのは 5〜6 冊)
    const books = Array.from({ length: 12 }, (_, i) => ({
        title: `横位置確認の本 ${i + 1}`, authors: '冊数 確認', acquiredTime: 1700000000000 + (i + 1) * 1000,
        readStatus: 'UNKNOWN', asin: `B0CNT615${String(i + 1).padStart(2, '0')}`, productImage: ''
    }));
    let asin;

    await test.step('前提: 12冊を取り込み、行を横へ送って、まん中に見えている本の詳細を開く', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteAndImport(page, books, books.length);
        await expectHomeCounts(page, books.length);
        const left = await scrollRecentRow(page, 300);
        // まん中に見えている本を選ぶ (押す時に、行が自動で横へ動かない位置)
        asin = await recentRow(page).evaluate((el) => {
            const r = el.getBoundingClientRect();
            for (const dx of [0, 24, -24]) {
                const hit = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2);
                const cell = hit && hit.closest('[data-asin]');
                if (cell) return cell.dataset.asin;
            }
            return null;
        });
        expect(asin).toBeTruthy();
        await recentRow(page).locator(`[data-asin="${asin}"]`).click();
        await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
        expect(await recentRowLeft(page)).toBe(left);
    });

    await test.step('評価 (★5): ホームの評価分布は描き直され、行の横位置は押す前と同じ', async () => {
        const before = await recentRowLeft(page);
        const stars = page.locator(`#book-detail-pane .star-rating[data-asin="${asin}"]`);
        await stars.locator('.star[data-rating="5"]').click();
        await expect(stars).toHaveAttribute('data-current-rating', '5');
        await expect(ratingDistCount(page, '★5')).toHaveText('1');
        expect.soft(await recentRowLeft(page)).toBe(before);
    });

    await test.step('本棚に追加: ホームの本棚別 Top5 は描き直され、行の横位置は押す前と同じ', async () => {
        const before = await scrollRecentRow(page, 100);
        await page.locator(`#book-detail-pane .edit-mode-btn[data-asin="${asin}"]`).first().click();
        await page.locator(`#book-detail-pane .bookshelf-select[data-asin="${asin}"]`).selectOption(SHELF.id);
        await page.locator(`#book-detail-pane .add-to-bookshelf[data-asin="${asin}"]`).click();
        await expect(page.locator('.toast-success', { hasText: `「${SHELF.name}」に追加しました` })).toBeVisible();
        await expect(top5Count(page)).toHaveText('1');
        expect.soft(await recentRowLeft(page)).toBe(before);
    });
});
