// イシュー#662：保存先につないだまま蔵書の冊数を変え、保存を待たずに再読込しても、左ツリーの「すべての本」の冊数・
// 端末の控え (localStorage) の「すべて」本棚 books と bookOrder.all・記事の本の引き出しが、変えた後の冊数で揃うこと。
// 直す前は「すべての本」の books と bookOrder.all が別の配列になり (起動時の JSON.parse・書き出しの bookOrder.all の置き換え)、
// 本を足す経路が bookOrder.all だけを変えて保存するため、控えと表示が変える前の冊数のまま残っていた (#622 R2)。
// E・G・D はローカル (OPFS) で利用者の操作。H・J は入口だけ window.bookshelf の除外・削除を呼ぶ (確認の窓は通す)。
// I662_OUT を付けると1回ごとの記録を JSONL で残す。
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from './helpers/gate-local.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest, waitForGitHubFileContainsForTest } from './helpers/gate-github.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf-8');
const EXPORT_JSON = fixture('gate-kindle-export.json');
// G 用：見本と重ならない1冊
const EXTRA_JSON = JSON.stringify([
    { title: '二回目の取込の本', authors: '取込 四郎', acquiredTime: 1700000004000, readStatus: 'UNKNOWN', asin: 'B0M662IMP4', productImage: '' }
]);
const OUT = process.env.I662_OUT || '';
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');
const allCount = (page) => allShelf(page).locator('.bsr-count');

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

async function openLibrarySettings(page) {
    await page.locator('#sidebar-settings').click();
    await page.locator('#settings-master .settings-cat[data-cat="library-section"]').click();
}

async function addByHand(page, asin) {
    await openLibrarySettings(page);
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(asin);
    await page.locator('#manual-title').fill(`手動追加の本 ${asin}`);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
}

async function closeAddAndSettings(page) {
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
}

const readFolder = (page, dirName) => page.evaluate(async (name) => {
    try {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        const sh = await (await root.getDirectoryHandle('private')).getDirectoryHandle('bookshelves');
        const a = JSON.parse(await (await (await sh.getFileHandle('all.json')).getFile()).text());
        return (a.books || []).length;
    } catch (e) { return null; }
}, dirName);

// 端末の控えの「すべて」本棚 books と bookOrder.all の冊数
const readLocal = (page) => page.evaluate(() => {
    try {
        const u = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || 'null');
        const sh = (u.bookshelves || []).find((b) => b.isSpecial);
        return { shelf: sh && Array.isArray(sh.books) ? sh.books.length : null, order: Array.isArray(u.bookOrder && u.bookOrder.all) ? u.bookOrder.all.length : null };
    } catch (e) { return { shelf: null, order: null }; }
});

// 接続→取込3冊→フォルダの all.json が3冊になるまで待つ (1回目の書き出しを済ませる)
async function connectAndImportThree(page, dirName) {
    await stubFolderPickerForTest(page, dirName);
    await bootAppForTest(page);
    await connectLocalFolderForTest(page);
    await page.locator('#dashboard-welcome button[data-dw="import"]').click();
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await pasteImport(page, EXPORT_JSON);
    await expect.poll(() => readFolder(page, dirName), { timeout: 20000 }).toBe(3);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
}

// 待たずに再読込し、「すべての本」が出るまで待つ。読込時の3択 (#622 の R1) が出た時は「この端末の内容」を選ぶ
async function reloadNow(page) {
    await page.reload();
    await expect(allShelf(page)).toBeVisible({ timeout: 20000 });
    const dialog = page.locator('#load-conflict-dialog');
    const shown = await dialog.isVisible();
    if (shown) await dialog.locator('.cfm-local').click();
    return shown;
}

// フォルダの all.json が want 冊になるまで待つ。読込時の3択 (#622 の R1) は再読込の少し後に出ることがあり、
// 選ぶまで保存先へ書かないので、出たら「この端末の内容」を選ぶ
async function expectFolderAll(page, dirName, want) {
    const dialog = page.locator('#load-conflict-dialog');
    await expect.poll(async () => {
        if (await dialog.isVisible()) await dialog.locator('.cfm-local').click();
        return readFolder(page, dirName);
    }, { timeout: 15000, message: 'フォルダの all.json' }).toBe(want);
}

async function expectAllShelf(page, want, { dirName, label, conflict }) {
    await expect(allCount(page), '再読込の後の「すべての本」の冊数').toHaveText(String(want));
    const local = await readLocal(page);
    if (OUT) {
        mkdirSync(dirname(OUT), { recursive: true });
        appendFileSync(OUT, JSON.stringify({ label, want, conflict, count: await allCount(page).textContent(), local, folderAll: dirName ? await readFolder(page, dirName) : null }) + '\n');
    }
    expect(local, '端末の控えの「すべて」本棚 books と bookOrder.all').toEqual({ shelf: want, order: want });
}

test.describe('ローカル (フォルダ)', () => {
    test('662-E 手動で追加した直後に再読込しても、すべての本・端末の控え・フォルダの冊数が合う', async ({ page }, testInfo) => {
        const dirName = `i662-E-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await connectAndImportThree(page, dirName);
        await addByHand(page, 'B0M662ADD1');
        const conflict = await reloadNow(page);
        await expectAllShelf(page, 4, { dirName, label: 'E', conflict });
        await expectFolderAll(page, dirName, 4);
    });

    test('662-G 1回目の保存の後に新しい本を取り込んだ直後に再読込しても、すべての本・端末の控え・フォルダの冊数が合う', async ({ page }, testInfo) => {
        const dirName = `i662-G-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await connectAndImportThree(page, dirName);
        await openLibrarySettings(page);
        await page.locator('#import-kindle').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteImport(page, EXTRA_JSON);
        const conflict = await reloadNow(page);
        await expectAllShelf(page, 4, { dirName, label: 'G', conflict });
        await expectFolderAll(page, dirName, 4);
    });

    // フォルダの all.json は見ない：除外した本は all.json に残る作り (書き出しが library の全部の本から作る・別件)
    test('662-H 1冊除外した直後に再読込しても、すべての本と端末の控えの冊数が合う', async ({ page }, testInfo) => {
        const dirName = `i662-H-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await connectAndImportThree(page, dirName);
        await page.evaluate(async () => { window.confirmDialog = async () => true; await window.bookshelf.excludeBook('B0GATEIMP3'); });
        const conflict = await reloadNow(page);
        await expectAllShelf(page, 2, { label: 'H', conflict });
    });

    // 除外した本が all.json に残るため (別件)、「除外の保存がフォルダに届いた (all.json が2冊)」を前提にできない
    test.fixme('662-I 除外を取り消した直後に再読込しても、すべての本と端末の控えの冊数が合う', async () => {});

    test('662-J 1冊削除した直後に再読込しても、すべての本・端末の控え・フォルダの冊数が合う', async ({ page }, testInfo) => {
        const dirName = `i662-J-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await connectAndImportThree(page, dirName);
        await page.evaluate(async () => { window.confirmDialog = async () => true; await window.bookshelf.deleteBook('B0GATEIMP3'); });
        const conflict = await reloadNow(page);
        await expectAllShelf(page, 2, { dirName, label: 'J', conflict });
        await expectFolderAll(page, dirName, 2);
    });

    test('662-D 手動で追加した直後に再読込しても、記事の本の引き出しに足した本が出る', async ({ page }, testInfo) => {
        const dirName = `i662-D-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await connectAndImportThree(page, dirName);
        await addByHand(page, 'B0M662ADD1');
        await reloadNow(page);
        // 遅れて出る3択 (#622 の R1) が押す先を覆うので、先に済ませる
        await expectFolderAll(page, dirName, 4);
        await page.locator('#sidebar-publish').click();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await page.locator('#art-new').click();
        await expect(page.locator('#art-edit-view')).toBeVisible();
        const formDone = page.locator('#art-fs-done');
        if (await formDone.isVisible()) await formDone.click();
        const toEdit = page.locator('#art-mode-edit');
        if (await toEdit.isVisible()) await toEdit.click();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await expect(page.locator('.art-drawer-item[data-asin="B0GATEIMP1"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.art-drawer-item[data-asin="B0M662ADD1"]')).toBeVisible();
    });
});

test('662-K 端末の控えの「すべて」本棚が bookOrder.all より古いまま残っていても、起動すると bookOrder.all の冊数で出る', async ({ page }) => {
    // 直す前の版が残した控え：bookOrder.all は5冊、「すべて」本棚 books は1冊少ない4冊
    const userData = JSON.parse(fixture('fixture-userdata.json'));
    const all = userData.bookshelves.find((b) => b.isSpecial);
    userData.bookOrder.all = [...all.books];
    all.books = all.books.slice(1);
    await page.addInitScript(([ud, lib]) => {
        if (sessionStorage.getItem('i662-seeded')) return;
        sessionStorage.setItem('i662-seeded', '1');
        localStorage.setItem('virtualBookshelf_userData', ud);
        localStorage.setItem('virtualBookshelf_library', lib);
    }, [JSON.stringify(userData), fixture('fixture-library.json')]);
    await bootAppForTest(page);
    await expect(allCount(page)).toHaveText('5');
});

test('662-HUB ハブ：1回目の保存の後に手動で追加した直後に再読込しても、すべての本と端末の控えの冊数が合う', async ({ page }) => {
    test.setTimeout(90_000);
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    const start = Number(await allCount(page).textContent());
    await addByHand(page, 'B0M662HUB1');
    await waitForHubFileContainsForTest(hub, 'private/bookshelves/all.json', 'B0M662HUB1');
    await closeAddAndSettings(page);
    await addByHand(page, 'B0M662HUB2');
    await page.reload();
    await waitForHubStartupForTest(page);
    await expectAllShelf(page, start + 2, { label: 'HUB' });
});

test('662-GH GitHub：1回目の保存の後に手動で追加した直後に再読込しても、すべての本と端末の控えの冊数が合う', async ({ page }) => {
    test.setTimeout(90_000);
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    await seedGitHubLoginForTest(page, gh);
    await mockGitHubForTest(page, gh);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    const start = JSON.parse(fixture('fixture-library.json')).books.length;
    await expect(allCount(page)).toHaveText(String(start), { timeout: 20000 });
    await addByHand(page, 'B0M662GH01');
    await waitForGitHubFileContainsForTest(gh, 'private/bookshelves/all.json', 'B0M662GH01');
    await closeAddAndSettings(page);
    await addByHand(page, 'B0M662GH02');
    await page.reload();
    await waitForHubStartupForTest(page);
    await expectAllShelf(page, start + 2, { label: 'GH' });
});
