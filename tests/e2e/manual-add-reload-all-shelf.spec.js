// イシュー#662：フォルダにつないだまま蔵書の冊数を変え、保存を待たずに再読込すると、
// 左ツリーの「すべての本」の冊数が変える前のまま残る (#622 R2・#622 の実測では手動追加の直後 E が 0/8)。
// E は利用者の操作 (設定→蔵書→手動で追加)。G は2回目の取込 (新しい本)。H〜J は同じ型の見込みの確認で、
// 入口だけ window.bookshelf の除外・除外の取り消し・削除を呼ぶ (確認の窓は通す)。
// 確かめる：再読込の後の「すべての本」の冊数・端末の控え (localStorage) の「すべて」本棚 books と bookOrder.all・
// フォルダの private/bookshelves/all.json (3択が出なかった回のみ)。I662_OUT を付けると1回ごとの記録を JSONL で残す。
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from './helpers/gate-local.js';

const EXPORT_JSON = readFileSync(new URL('../fixtures/gate-kindle-export.json', import.meta.url), 'utf-8');
// G 用：見本と重ならない1冊
const EXTRA_JSON = JSON.stringify([
    { title: '二回目の取込の本', authors: '取込 四郎', acquiredTime: 1700000004000, readStatus: 'UNKNOWN', asin: 'B0M662IMP4', productImage: '' }
]);
const OUT = process.env.I662_OUT || '';
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');

test.use({ viewport: { width: 1280, height: 800 } });

async function pasteImport(page, json) {
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(json);
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#import-results')).toContainText('取込結果');
}

async function closeImportAndOpenLibrarySettings(page) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
    await page.locator('#sidebar-settings').click();
    await page.locator('#settings-master .settings-cat[data-cat="library-section"]').click();
}

const readState = (page, dirName) => page.evaluate(async (name) => {
    const out = {};
    try {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        dir = await dir.getDirectoryHandle('private');
        try {
            const lib = JSON.parse(await (await (await dir.getFileHandle('library.json')).getFile()).text());
            out.libN = (lib.books || []).length;
        } catch (e) { out.libN = null; }
        try {
            const sh = await dir.getDirectoryHandle('bookshelves');
            const a = JSON.parse(await (await (await sh.getFileHandle('all.json')).getFile()).text());
            out.allN = (a.books || []).length;
        } catch (e) { out.allN = null; }
    } catch (e) { out.err = String(e && e.name); }
    try {
        const u = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || 'null');
        out.localOrderAll = u && u.bookOrder && Array.isArray(u.bookOrder.all) ? u.bookOrder.all.length : null;
        const sh = u && (u.bookshelves || []).find((b) => b.isSpecial);
        out.localAllShelfBooks = sh && Array.isArray(sh.books) ? sh.books.length : null;
    } catch (e) { out.localErr = true; }
    out.pending = localStorage.getItem('virtualBookshelf_pendingSync');
    return out;
}, dirName);

// 入口が関数の行 (H〜J)：確認の窓は「はい」で通す
const callApp = (page, method, asin) => page.evaluate(async ({ method, asin }) => {
    window.confirmDialog = async () => true;
    await window.bookshelf[method](asin);
}, { method, asin });

const SCENARIOS = [
    { id: 'E', title: '手動で追加した直後', wantAll: 4 },
    { id: 'G', title: '2回目の取込で新しい本を足した直後', wantAll: 4 },
    { id: 'H', title: '1冊除外した直後', wantAll: 2 },
    { id: 'I', title: '除外を取り消した直後', wantAll: 3 },
    { id: 'J', title: '1冊削除した直後', wantAll: 2 },
];

for (const sc of SCENARIOS) {
    test(`662-${sc.id} フォルダにつないだまま${sc.title}に再読込しても すべての本 の冊数が合う`, async ({ page }, testInfo) => {
        const dirName = `i662-${sc.id}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await stubFolderPickerForTest(page, dirName);
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteImport(page, EXPORT_JSON);
        // 取込3冊がフォルダに書かれるまで待つ (1回目の書き出しを済ませる)
        await expect.poll(async () => (await readState(page, dirName)).allN, { timeout: 20000 }).toBe(3);
        await page.waitForTimeout(500);

        if (sc.id === 'E') {
            await closeImportAndOpenLibrarySettings(page);
            await page.locator('#add-book-manually').click();
            await page.locator('#manual-asin').fill('B0M662ADD1');
            await page.locator('#manual-title').fill('手動追加の本');
            await page.locator('#add-manually').click();
            await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
        } else if (sc.id === 'G') {
            await closeImportAndOpenLibrarySettings(page);
            await page.locator('#import-kindle').click();
            await expect(page.locator('#import-modal')).toHaveClass(/show/);
            await pasteImport(page, EXTRA_JSON);
        } else if (sc.id === 'H') {
            await callApp(page, 'excludeBook', 'B0GATEIMP3');
        } else if (sc.id === 'I') {
            await callApp(page, 'excludeBook', 'B0GATEIMP3');
            await expect.poll(async () => (await readState(page, dirName)).allN, { timeout: 20000 }).toBe(2);
            await page.waitForTimeout(500);
            await callApp(page, 'unexcludeBook', 'B0GATEIMP3');
        } else if (sc.id === 'J') {
            await callApp(page, 'deleteBook', 'B0GATEIMP3');
        }
        const before = await readState(page, dirName);

        // 保存を待たずに再読込
        await page.reload();
        await expect(allShelf(page)).toBeVisible({ timeout: 20000 });
        const counts = [];
        for (let i = 0; i < 16; i++) {
            counts.push(await allShelf(page).locator('.bsr-count').textContent().catch(() => '?'));
            await page.waitForTimeout(250);
        }
        const dialog = await page.locator('#load-conflict-dialog, #sync-conflict-dialog').filter({ visible: true }).count();
        const after = await readState(page, dirName);
        if (OUT) {
            mkdirSync(dirname(OUT), { recursive: true });
            appendFileSync(OUT, JSON.stringify({ sc: sc.id, n: testInfo.repeatEachIndex, wantAll: sc.wantAll, counts: [...new Set(counts)].join('>'), finalCount: counts[counts.length - 1], dialog, before, after }) + '\n');
        }

        expect.soft(counts[counts.length - 1], '再読込の後の「すべての本」の冊数').toBe(String(sc.wantAll));
        expect.soft(after.localAllShelfBooks, '端末の控えの「すべて」本棚 books').toBe(sc.wantAll);
        expect.soft(after.localOrderAll, '端末の控えの bookOrder.all').toBe(sc.wantAll);
        if (!dialog) {
            await expect.poll(async () => (await readState(page, dirName)).allN, { timeout: 8000, message: 'フォルダの all.json' }).toBe(sc.wantAll);
        }
    });
}
