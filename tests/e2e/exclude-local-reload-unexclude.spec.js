// イシュー#675: 保存先につないでいない時 (bookshelf_sync.method=local・フォルダ未接続＝端末の控えだけ)、除外した本の書誌
// (_storage.libraryBooks) が端末の控えに残らず、再読込の後に除外を取り消しても蔵書・元の本棚に戻らず book:added も出ない
// (#670 の results の c-2)。675-A〜E は保存先なし、675-G はフォルダ接続の対照 (#670 の f-4)。C〜E は step1 の仮説を測る行。
// 取り消しは除外一覧の画面 (#exclusions-list) の「元に戻す」(.unexclude-btn) を押す。1冊ずつの除外は window.bookshelf.excludeBook を
// 呼び、確認の窓は画面で押す (#670 と同じ入口・除外ボタンは編集モードの本の詳細にしか無い)。一括の除外は選択モードの画面操作。
// 起動は #670 の spec と同じ型 (fixture を localStorage に入れ、再読込で入れ直さないよう印を立てる)。
// E675_OUT を付けると1回ごとの値を JSONL で残す (results の §1 の値はここから書く)。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from './helpers/gate-local.js';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const EXPORT_JSON = readFileSync(join(here, '../fixtures/gate-kindle-export.json'), 'utf-8');
const OUT = process.env.E675_OUT || '';
const X = 'B000000001'; // 1冊ずつ除外する本
const Y = 'B000000002'; // 一括で除外する本 (D では再読込の後に1冊ずつ除外する本)
const Z = 'B000000003'; // 除外しない本
const TARGET = 'B0GATEIMP3'; // 取込の見本 (gate-kindle-export.json) の3冊目

test.use({ viewport: { width: 1280, height: 800 } });

const record = (rec) => { if (OUT) appendFileSync(OUT, JSON.stringify(rec) + '\n'); };

// fixture に、親 (X・Y・Z) > 子 (X・Y) の自作の本棚を足す
async function bootApp(page) {
    await page.addInitScript(([userData, library, x, y, z]) => {
        if (!localStorage.getItem('e2e675-seeded')) {
            const ud = JSON.parse(userData);
            ud.bookshelves.push({ id: 'e2e-p', internalId: 'e2ep0001', name: '親の本棚', iconName: 'library', books: [x, y, z], isSpecial: false, parent: 'fixall001' });
            ud.bookshelves.push({ id: 'e2e-c', internalId: 'e2ec0001', name: '子の本棚', iconName: 'library', books: [x, y], isSpecial: false, parent: 'e2ep0001' });
            localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
            localStorage.setItem('virtualBookshelf_library', library);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
            localStorage.setItem('e2e675-seeded', '1');
        }
    }, [fixtureUserData, fixtureLibrary, X, Y, Z]);
    await page.goto('index.html');
    await waitReady(page);
    await listenPluginEvents(page);
}

const waitReady = (page) => page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);

// プラグインのイベントを数える (起動・再読込の後に聞き始める)
const listenPluginEvents = (page) => page.evaluate(() => {
    window.__e2eEv = [];
    for (const ev of ['book:removed', 'book:added']) {
        window.bookshelfAPI.on(ev, (d) => window.__e2eEv.push({ ev, asin: d && (d.asin || (d.book && d.book.asin)), reason: d && d.reason }));
    }
});
const addedCount = (page, asin) => page.evaluate((a) => (window.__e2eEv || []).filter(e => e.ev === 'book:added' && e.asin === a).length, asin);

// 蔵書・除外・書誌の写し (メモリ)・端末の控え (virtualBookshelf_userData の _storage・virtualBookshelf_library) を読む
const snap = (page, asin) => page.evaluate((a) => {
    const st = (window.bookshelf.userData && window.bookshelf.userData._storage) || {};
    let ctrl = null;
    let lib = null;
    try { ctrl = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || 'null'); } catch (e) { ctrl = null; }
    try { lib = JSON.parse(localStorage.getItem('virtualBookshelf_library') || 'null'); } catch (e) { lib = null; }
    const cst = (ctrl && ctrl._storage) || {};
    return {
        inBooks: (window.bookshelf.books || []).some(b => b.asin === a),
        excluded: Array.isArray(st.exclusions) ? st.exclusions.includes(a) : null,
        memLibBooks: Array.isArray(st.libraryBooks) ? st.libraryBooks.length : null,
        memLibHas: Array.isArray(st.libraryBooks) ? st.libraryBooks.some(b => b.asin === a) : null,
        ctrlStorageKeys: Object.keys(cst).sort(),
        ctrlExcl: Array.isArray(cst.exclusions) ? cst.exclusions : null,
        ctrlLibCount: lib && Array.isArray(lib.books) ? lib.books.length : null,
        ctrlLibHas: lib && Array.isArray(lib.books) ? lib.books.some(b => b.asin === a) : null
    };
}, asin);

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);
const treeCount = (page, slug) => treeNode(page, slug).locator('.bsr-count').first();

async function expandTree(page, keys) {
    for (const key of keys) {
        const toggle = treeNode(page, key).locator('.tree-toggle').first();
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
}

// 子の本棚を開き、並んだ本の ASIN を返す (present が並んでから読む)
async function childShelfAsins(page, present) {
    await expandTree(page, ['all', 'e2e-p']);
    await treeNode(page, 'e2e-c').click();
    await expect(page).toHaveURL(/#\/bookshelf\/e2e-c$/);
    await expect(page.locator(`.book-item[data-asin="${present}"]:visible`).first()).toBeVisible();
    return page.locator('.book-item[data-asin]:visible').evaluateAll(els => els.map(e => e.getAttribute('data-asin')));
}

async function confirmOk(page) {
    const cfm = page.locator('.cfm-overlay');
    await expect(cfm).toBeVisible();
    await cfm.locator('.cfm-ok').click();
    await expect(cfm).toBeHidden();
}

async function excludeOne(page, asin) {
    const p = page.evaluate((a) => window.bookshelf.excludeBook(a), asin);
    await confirmOk(page);
    await p;
    await expect.poll(() => page.evaluate((a) => window.bookshelf.books.some(b => b.asin === a), asin)).toBe(false);
}

// 除外一覧を開き、asin の行の題を読んでから「元に戻す」を押す。取り消しの完了＝行が消え、exclusions から外れる
async function unexcludeViaList(page, asin) {
    await page.evaluate(() => window.bookshelf.showExclusionsModal());
    const row = page.locator('#exclusions-list .exclusion-item', { has: page.locator(`.unexclude-btn[data-asin="${asin}"]`) });
    await expect(row).toBeVisible();
    const title = ((await row.locator('.exclusion-title').textContent()) || '').trim();
    await row.locator('.unexclude-btn').click();
    await expect(row).toHaveCount(0);
    await expect.poll(() => page.evaluate((a) => !(((window.bookshelf.userData._storage || {}).exclusions) || []).includes(a), asin)).toBe(true);
    await page.locator('#exclusions-modal-close').click();
    await expect(page.locator('#exclusions-list')).toBeHidden();
    return title;
}

async function pasteImport(page, json) {
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(json);
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#import-results')).toContainText('取込結果');
}

// フォルダの private/ の中身 (library・exclusions) と未反映の印を読む (#670 の 670-F と同じ)
const readFolder = (page, dirName) => page.evaluate(async (name) => {
    const out = {};
    const readJson = async (dir, file) => JSON.parse(await (await (await dir.getFileHandle(file)).getFile()).text());
    try {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        dir = await dir.getDirectoryHandle('private');
        try { out.lib = ((await readJson(dir, 'library.json')).books || []).map((b) => b.asin); } catch (e) { out.lib = null; }
        try { out.excl = (await readJson(dir, 'exclusions.json')).excludedASINs || []; } catch (e) { out.excl = null; }
    } catch (e) { out.err = String(e && e.name); }
    out.pending = localStorage.getItem('virtualBookshelf_pendingSync');
    return out;
}, dirName);

// 書き出しの完了 = exclusions.json が asin の除外を want どおりに持ち、未反映の印が消える
const exported = (page, dirName, asin, want) => expect.poll(async () => {
    const s = await readFolder(page, dirName);
    return Array.isArray(s.excl) && s.excl.includes(asin) === want && s.pending !== '1';
}, { timeout: 20000, message: '書き出しの完了 (exclusions.json と未反映の印)' }).toBe(true);

test.describe('#675 保存先なしで除外した本の書誌と、再読込の後の取り消し', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'chromium で確かめる (画面の幅・エンジンに依らない決まり)');

    test('675-A 保存先なしで1冊除外して再読込した後、除外一覧から取り消すと、蔵書と元の本棚に戻り book:added が出る', async ({ page }, testInfo) => {
        await bootApp(page);
        await excludeOne(page, X);
        const beforeReload = await snap(page, X);
        await page.reload();
        await waitReady(page);
        await listenPluginEvents(page);
        const afterReload = await snap(page, X);
        const title = await unexcludeViaList(page, X);
        const after = await snap(page, X);
        const shelf = await childShelfAsins(page, Y);
        const tree = ((await treeCount(page, 'e2e-c').textContent()) || '').trim();
        const added = await addedCount(page, X);
        record({ id: 'A', n: testInfo.repeatEachIndex, beforeReload, afterReload, title, after, shelf, tree, added });
        expect.soft(afterReload.memLibHas, '再読込の後も除外した本の書誌 (_storage.libraryBooks) がある').toBe(true);
        expect.soft(title, '除外一覧の行に題が出る (ASIN だけではない)').not.toBe(X);
        expect.soft(after.inBooks, '取り消すと蔵書に戻る').toBe(true);
        expect.soft([...shelf].sort(), '取り消すと元の自作の本棚に並ぶ').toEqual([X, Y]);
        expect.soft(added, '取り消すと book:added が1回').toBe(1);
    });

    test('675-B 保存先なしで一括の除外をして再読込した後、除外一覧から取り消すと、蔵書と元の本棚に戻り book:added が出る', async ({ page }, testInfo) => {
        await bootApp(page);
        await treeNode(page, 'all').click();
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await page.locator('#toggle-select-mode').click();
        await page.locator(`#bookshelf .book-item[data-asin="${Y}"]`).first().click();
        await page.locator('#bulk-exclude').click();
        await confirmOk(page);
        await expect(page.locator('.toast-success', { hasText: '冊を除外しました' })).toBeVisible();
        await page.locator('#toggle-select-mode').click();
        const beforeReload = await snap(page, Y);
        await page.reload();
        await waitReady(page);
        await listenPluginEvents(page);
        const afterReload = await snap(page, Y);
        const title = await unexcludeViaList(page, Y);
        const after = await snap(page, Y);
        const shelf = await childShelfAsins(page, X);
        const added = await addedCount(page, Y);
        record({ id: 'B', n: testInfo.repeatEachIndex, beforeReload, afterReload, title, after, shelf, added });
        expect.soft(beforeReload.inBooks, '一括の除外の直後は蔵書に無い').toBe(false);
        expect.soft(afterReload.memLibHas, '再読込の後も除外した本の書誌がある').toBe(true);
        expect.soft(title, '除外一覧の行に題が出る').not.toBe(Y);
        expect.soft(after.inBooks, '取り消すと蔵書に戻る').toBe(true);
        expect.soft([...shelf].sort(), '取り消すと元の自作の本棚に並ぶ').toEqual([X, Y]);
        expect.soft(added, '取り消すと book:added が1回').toBe(1);
    });

    test('675-C (仮説) 保存先なしで1冊除外した後に取り込んだ本を除外して取り消すと、再読込しなくても蔵書に戻るか', async ({ page }, testInfo) => {
        await bootApp(page);
        await excludeOne(page, X);
        const afterFirst = await snap(page, TARGET);
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteImport(page, EXPORT_JSON);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate((t) => window.bookshelf.books.some(b => b.asin === t), TARGET)).toBe(true);
        const afterImport = await snap(page, TARGET);
        await excludeOne(page, TARGET);
        const afterExclude = await snap(page, TARGET);
        const title = await unexcludeViaList(page, TARGET);
        const after = await snap(page, TARGET);
        const added = await addedCount(page, TARGET);
        record({ id: 'C', n: testInfo.repeatEachIndex, afterFirst, afterImport, afterExclude, title, after, added });
        expect.soft(afterImport.memLibHas, '取り込んだ本の書誌が書誌の写しに入る').toBe(true);
        expect.soft(after.inBooks, '取り消すと蔵書に戻る').toBe(true);
        expect.soft(added, '取り消すと book:added が1回').toBe(1);
    });

    test('675-D (仮説) 保存先なしで X を除外して再読込した後に Y を除外しても、X の書誌は残るか', async ({ page }, testInfo) => {
        await bootApp(page);
        await excludeOne(page, X);
        await page.reload();
        await waitReady(page);
        await listenPluginEvents(page);
        const afterReload = await snap(page, X);
        await excludeOne(page, Y);
        const xAfterY = await snap(page, X);
        const yAfterY = await snap(page, Y);
        const titleX = await unexcludeViaList(page, X);
        const xAfter = await snap(page, X);
        const titleY = await unexcludeViaList(page, Y);
        const yAfter = await snap(page, Y);
        const addedX = await addedCount(page, X);
        const addedY = await addedCount(page, Y);
        record({ id: 'D', n: testInfo.repeatEachIndex, afterReload, xAfterY, yAfterY, titleX, xAfter, titleY, yAfter, addedX, addedY });
        expect.soft(xAfterY.memLibHas, 'Y を除外した後も X の書誌がある').toBe(true);
        expect.soft(xAfter.inBooks, 'X を取り消すと蔵書に戻る').toBe(true);
        expect.soft(yAfter.inBooks, 'Y を取り消すと蔵書に戻る').toBe(true);
        expect.soft(addedX, 'X の book:added が1回').toBe(1);
        expect.soft(addedY, 'Y の book:added が1回').toBe(1);
    });

    test('675-E (仮説) 保存先なしで除外して再読込した後にフォルダにつなぐと、書き出しの library.json に除外した本の書誌が入るか', async ({ page }, testInfo) => {
        const dirName = `e675-E-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await stubFolderPickerForTest(page, dirName);
        await bootApp(page);
        await excludeOne(page, X);
        await page.reload();
        await waitReady(page);
        const afterReload = await snap(page, X);
        await connectLocalFolderForTest(page);
        await exported(page, dirName, X, true);
        const folder = await readFolder(page, dirName);
        const after = await snap(page, X);
        record({ id: 'E', n: testInfo.repeatEachIndex, afterReload, folder: { lib: folder.lib, excl: folder.excl, err: folder.err }, after });
        expect.soft(folder.excl, 'exclusions.json に X').toContain(X);
        expect.soft(folder.lib, 'library.json は除外した本も含む全書誌 (X がある)').toContain(X);
    });
});

test('675-G (対照) フォルダにつないだまま除外して書き出し、再読込の後に除外一覧から取り消すと、蔵書に戻り book:added が出る', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'chromium で確かめる (OPFS のフォルダの模擬)');
    const dirName = `e675-G-${testInfo.repeatEachIndex}-${testInfo.retry}`;
    await stubFolderPickerForTest(page, dirName);
    await bootAppForTest(page);
    await connectLocalFolderForTest(page);
    await page.locator('#dashboard-welcome button[data-dw="import"]').click();
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await pasteImport(page, EXPORT_JSON);
    await expect.poll(async () => ((await readFolder(page, dirName)).lib || []).length, { timeout: 20000 }).toBe(3);
    await page.keyboard.press('Escape');
    await excludeOne(page, TARGET);
    await exported(page, dirName, TARGET, true);
    await page.reload();
    await waitReady(page);
    // 起動の2段目 (フォルダの読込) が済むと、書誌の写しは library.json の3冊になる (#670 の f-4)
    await expect.poll(async () => (await snap(page, TARGET)).memLibBooks, { timeout: 20000 }).toBe(3);
    await listenPluginEvents(page);
    const afterReload = await snap(page, TARGET);
    const title = await unexcludeViaList(page, TARGET);
    await exported(page, dirName, TARGET, false);
    const after = await snap(page, TARGET);
    const added = await addedCount(page, TARGET);
    record({ id: 'G', n: testInfo.repeatEachIndex, afterReload, title, after, added });
    expect(afterReload.memLibHas).toBe(true);
    expect(title).not.toBe(TARGET);
    expect(after.inBooks).toBe(true);
    expect(added).toBe(1);
});
