// イシュー#622: 保存先につないだまま、取込・手動追加・除外の直後に再読込 (またはタブを閉じて開き直す) しても、
// 本が消えず、1台で使っているのに保存先との衝突の3択 (読込時・書き込み時) が出ないことを確かめる。
// ローカルの保存はファイルを順に書き、版の印 (private/sync-stamp.json) を最後に書く。書き終わる前にページが閉じると
// 「library.json は新しい版・印は前の版」が残る。その時も、自分の書き込みとして扱えること (js/bookshelf.js _decideLoadedState・直しはイシュー#656)。
// 保存されたかどうかは、保存先の中身 (フォルダ・ハブ・リポジトリ) を読んで確かめる。
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from './helpers/gate-local.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest, waitForGitHubFileContainsForTest } from './helpers/gate-github.js';

const EXPORT_JSON = readFileSync(new URL('../fixtures/gate-kindle-export.json', import.meta.url), 'utf-8');
const ASINS = JSON.parse(EXPORT_JSON).map((b) => b.asin);
const MANUAL_ASIN = 'B0R622ADD1';
// ハブ・GitHub の見本の library.json に入れる版の日付 (アプリが書く library.json には必ず入る。無いと控えが空の扱いになる)
const SEED_EXPORT_DATE = '2026-11-01T00:00:00.000Z';

const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');
const conflictDialogs = (page) => page.locator('#load-conflict-dialog, #sync-conflict-dialog').filter({ visible: true });
const syncStatus = (page) => page.locator('#obsidian-sync-status');

test.use({ viewport: { width: 1280, height: 800 } });

/** フォルダ (OPFS の dirName) の private/<file> を JSON で読む。無ければ null */
const readFolderJSON = (page, dirName, file) => page.evaluate(async ([name, path]) => {
    try {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        const parts = path.split('/');
        for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
        return JSON.parse(await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text());
    } catch (_) { return null; }
}, [dirName, file]);

/** フォルダの library.json に入っている ASIN (並びは名前順) */
const folderAsins = async (page, dirName) => {
    const lib = await readFolderJSON(page, dirName, 'private/library.json');
    return lib && Array.isArray(lib.books) ? lib.books.map((b) => b.asin).sort() : [];
};

/** 取込の画面に取込データを貼って、全部を取り込む (取込の画面は開いてある前提) */
async function pasteAndImport(page) {
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(EXPORT_JSON);
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#import-results')).toContainText('取込結果');
}

/** 空のフォルダをつないでアプリを開き、ホームの案内から3冊を取り込む */
async function connectAndImport(page, dirName) {
    await stubFolderPickerForTest(page, dirName);
    await bootAppForTest(page);
    await connectLocalFolderForTest(page);
    await page.locator('#dashboard-welcome button[data-dw="import"]').click();
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await pasteAndImport(page);
}

/** 保存がフォルダに届いて落ち着くまで待つ (取込の後に別の操作をする筋書きの前提) */
async function waitFolderSettled(page, dirName, asins) {
    await expect.poll(() => folderAsins(page, dirName), { timeout: 10000 }).toEqual([...asins].sort());
    await expect(syncStatus(page)).toContainText('同期済み');
}

/** 再読込 (またはタブを閉じて開き直した) 後: 3択が出ず、読込が終わり、フォルダに want の本が入っている */
async function expectLocalKept(page, dirName, want) {
    await expect(allShelf(page)).toBeVisible({ timeout: 20000 });
    await expect(syncStatus(page)).toContainText('同期済み', { timeout: 15000 });
    await expect.poll(() => folderAsins(page, dirName), { timeout: 10000 }).toEqual([...want].sort());
    await expect(conflictDialogs(page)).toHaveCount(0);
}

test('ローカル: 取込の直後に待たずに再読込しても、3冊が残りフォルダにも入り、衝突の3択が出ない', async ({ page }, testInfo) => {
    const dirName = `r622-a-${testInfo.repeatEachIndex}`;
    await connectAndImport(page, dirName);
    await page.reload();
    await expectLocalKept(page, dirName, ASINS);
    await expect(allShelf(page).locator('.bsr-count')).toHaveText('3');
});

test('ローカル: 取込の直後にタブを閉じて開き直しても、3冊が残りフォルダにも入り、衝突の3択が出ない', async ({ page, context }, testInfo) => {
    const dirName = `r622-b-${testInfo.repeatEachIndex}`;
    await connectAndImport(page, dirName);
    const closed = page.waitForEvent('close');
    await page.close({ runBeforeUnload: true });
    await closed;
    const next = await context.newPage();
    await bootAppForTest(next);
    await expectLocalKept(next, dirName, ASINS);
    await expect(allShelf(next).locator('.bsr-count')).toHaveText('3');
});

test('ローカル: 手動で本を追加した直後に再読込しても、蔵書は4冊のままフォルダにも入り、衝突の3択が出ない', async ({ page }, testInfo) => {
    const dirName = `r622-m-${testInfo.repeatEachIndex}`;
    await connectAndImport(page, dirName);
    await waitFolderSettled(page, dirName, ASINS);
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
    await page.locator('#sidebar-settings').click();
    await page.locator('#settings-master .settings-cat[data-cat="library-section"]').click();
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(MANUAL_ASIN);
    await page.locator('#manual-title').fill('再読込で確かめる手動追加の本');
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.reload();
    await expectLocalKept(page, dirName, [...ASINS, MANUAL_ASIN]);
    // 冊数はホームの「蔵書数」で見る。「すべての本」の冊数は、手動追加の直後の再読込で3冊のまま残る別の不具合がある
    // (R2・#662 で直す) ので、ここでは条件にしない (下の fixme が受け持つ)
    await expect(page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value')).toHaveText('4');
});

test.fixme('ローカル: 手動で本を追加した直後に再読込しても、「すべての本」の冊数が4冊 (R2・#662 で直す)', async () => {});

test('ローカル: 本を除外した直後に再読込しても、除外が残りフォルダにも入り、衝突の3択が出ない', async ({ page }, testInfo) => {
    const dirName = `r622-x-${testInfo.repeatEachIndex}`;
    await connectAndImport(page, dirName);
    await waitFolderSettled(page, dirName, ASINS);
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
    await allShelf(page).locator('.bsr-label').click();
    await page.locator('#bookshelf .book-item').first().click();
    // 除外のボタンは、本の詳細の編集モードにだけ出る
    await page.locator('#book-detail-pane .edit-mode-btn').click();
    const excludeBtn = page.locator('#book-detail-pane .exclude-btn');
    const asin = await excludeBtn.getAttribute('data-asin');
    await excludeBtn.click();
    await page.locator('.cfm-overlay').getByRole('button', { name: '除外する' }).click();
    await expect(allShelf(page).locator('.bsr-count')).toHaveText('2');
    await page.reload();
    await expect(allShelf(page)).toBeVisible({ timeout: 20000 });
    await expect(syncStatus(page)).toContainText('同期済み', { timeout: 15000 });
    await expect.poll(async () => ((await readFolderJSON(page, dirName, 'private/exclusions.json')) || {}).excludedASINs || [], { timeout: 10000 }).toContain(asin);
    await expect(conflictDialogs(page)).toHaveCount(0);
    // 冊数はホームの「蔵書数」で見る。「すべての本」の冊数は、除外の直後の再読込で3冊のまま残る (手動追加と同じ R2・#662)
    await expect(page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value')).toHaveText('2');
});

test.fixme('ローカル: 本を除外した直後に再読込しても、「すべての本」の冊数が2冊 (R2・#662 で直す)', async () => {});

// GitHub は fixme: 重い時 (load 75前後) に5回中3回、再読込の後に保存が2本重なって書き込み時の3択が出た (#622 step4 の R3・別イシュー)。
// その時、保存先と控えは印まで一致していて、読込の決め方は手元を採っていた (読込時の3択ではない)
for (const kind of ['hub', 'github']) {
    const run = kind === 'github' ? test.fixme : test;
    run(`${kind === 'hub' ? 'ハブ' : 'GitHub'}: 取込の直後に待たずに再読込しても、取り込んだ本が残り保存先にも入り、衝突の3択が出ない`, async ({ page }) => {
        let waitStored;
        if (kind === 'hub') {
            const hub = createHubStateForTest();
            seedHubDataForTest(hub, { exportDate: SEED_EXPORT_DATE });
            await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
            await mockHubForTest(page, hub);
            waitStored = (asin) => waitForHubFileContainsForTest(hub, 'private/library.json', asin, 10000);
        } else {
            const gh = createMockGitHubForTest();
            seedGitHubDataForTest(gh, { exportDate: SEED_EXPORT_DATE });
            await seedGitHubLoginForTest(page, gh);
            await mockGitHubForTest(page, gh);
            waitStored = (asin) => waitForGitHubFileContainsForTest(gh, 'private/library.json', asin, 10000);
        }
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
        await expect(allShelf(page)).toBeVisible();
        const before = Number(await allShelf(page).locator('.bsr-count').textContent());
        await page.locator('#sidebar-settings').click();
        await page.locator('#settings-master .settings-cat[data-cat="library-section"]').click();
        await page.locator('#import-kindle').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteAndImport(page);
        await page.reload();
        await waitForHubStartupForTest(page);
        await expect(allShelf(page).locator('.bsr-count')).toHaveText(String(before + ASINS.length), { timeout: 15000 });
        for (const asin of ASINS) await waitStored(asin);
        await expect(conflictDialogs(page)).toHaveCount(0);
    });
}
