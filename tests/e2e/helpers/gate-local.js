// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」で使う、保存先「ローカルのフォルダ」の用意 (イシュー#588)。
// 書き方の決まりは tests/e2e/gate/README.md。OS のフォルダ選択はヘッドレスで押せないので、フォルダを選ぶ窓
// (window.showDirectoryPicker) だけを、ブラウザの中の本物のフォルダ (OPFS のフォルダ) を返す物に置き換える。
// アプリの読み書き (js/local-fs-adapter.js・フォルダの控えを IndexedDB に置く処理・再起動時の復元) は本物を通す。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from './test-base.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');

/** 「フォルダを選ぶ」で、ブラウザの中のフォルダ dirName (OPFS) が選ばれるようにする。アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page @param {string} [dirName] */
export async function stubFolderPickerForTest(page, dirName = 'gate-local') {
    await page.addInitScript((name) => {
        window.showDirectoryPicker = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle(name, { create: true });
        };
    }, dirName);
}

/** 端末内の蔵書の見本 (「フィクスチャの本 1」ほか) と保存先の方式 (ローカル) を、そのタブで最初の1回だけ入れる。
 * gate-setup.js の seedLibraryForTest は再読込のたびに入れ直すので、再起動をまたいで確かめるテストではこちらを使う。
 * @param {import('@playwright/test').Page} page */
export async function seedLocalLibraryOnceForTest(page) {
    await page.addInitScript(([userData, library]) => {
        if (sessionStorage.getItem('gateLocalSeeded')) return;
        sessionStorage.setItem('gateLocalSeeded', '1');
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        // 保存先を「この端末のフォルダ」に決めた人 (決めた印つき・イシュー#596。印の無い local は設定がハブを見せる)
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true }));
    }, [fixture('fixture-userdata.json'), fixture('fixture-library.json')]);
}

/** フォルダ dirName (OPFS) に、蔵書の見本をアプリの保存の形で置いておく (「既にデータの入ったフォルダ」を選ぶ前提)。
 * 形は gate-hub.js の seedHubDataForTest と同じ (private/library.json・bookshelves.json・bookshelves/all.json・notes.json)。
 * 空のフォルダを選ぶと、アプリはフォルダを空で初期化してから読み込む (js/bookshelf.js selectObsidianFolder)。
 * アプリを開いた後、「フォルダを選ぶ」より前に呼ぶ。
 * @param {import('@playwright/test').Page} page @param {string} [dirName] */
export async function seedLocalFolderForTest(page, dirName = 'gate-local') {
    const library = JSON.parse(fixture('fixture-library.json'));
    const userData = JSON.parse(fixture('fixture-userdata.json'));
    const files = {
        'private/library.json': library,
        'private/bookshelves.json': { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] },
        'private/bookshelves/all.json': { books: library.books.map((b) => b.asin) },
        'private/notes.json': { notes: userData.notes || {} }
    };
    await page.evaluate(async ([name, entries]) => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
        for (const [filePath, data] of entries) {
            const parts = filePath.split('/');
            let dir = root;
            for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
            const writable = await (await dir.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
            await writable.write(JSON.stringify(data, null, 2));
            await writable.close();
        }
    }, [dirName, Object.entries(files)]);
}

/** フォルダ dirName の中のファイル path に text が入るまで待つ (アプリの書き込みがフォルダに届いたことの前提)。
 * @param {import('@playwright/test').Page} page @param {string} dirName @param {string} path @param {string} text @param {number} [timeoutMs] */
export async function waitForLocalFileContainsForTest(page, dirName, path, text, timeoutMs = 20000) {
    // waitForFunction に async 関数を渡すと、返る Promise が真とみなされて待たずに通る (#607)。expect.poll で毎回の結果を待つ
    await expect.poll(() => page.evaluate(async ([name, filePath, want]) => {
        try {
            let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
            const parts = filePath.split('/');
            for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
            const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
            return (await file.text()).includes(want);
        } catch (_) { return false; }
    }, [dirName, path, text]), { timeout: timeoutMs, intervals: [200] }).toBe(true);
}

/** 端末内の控え (localStorage の蔵書・利用者データ) だけを消す。フォルダと、フォルダの控え (IndexedDB) は残す。
 * 再起動の後に見えるものが、フォルダから読んだものだけになるようにする (②判断 (c))。
 * @param {import('@playwright/test').Page} page */
export async function clearLocalCacheForTest(page) {
    await page.evaluate(() => {
        localStorage.removeItem('virtualBookshelf_userData');
        localStorage.removeItem('virtualBookshelf_library');
    });
}

// ---- イシュー#590 (門のE2E J1〜J4) で足した分 ----

/** 保存先を「この端末のフォルダ」にして、つないだ状態にする (中身は空のフォルダ)。
 * stubFolderPickerForTest → bootAppForTest の後に呼ぶ。つなぐ処理はアプリの本物のコード (フォルダを選ぶ) を
 * 呼ぶので、そのあとの保存・再読込での読み直しも本物のコードがこのフォルダに対して行う。
 * 保存先の設定 (bookshelf_sync) も「この端末のフォルダ」にしておく (取込・整理・メモの観測点で、初回の保存先の選び方に左右されないため)。
 * @param {import('@playwright/test').Page} page */
export async function connectLocalFolderForTest(page) {
    await page.evaluate(async () => {
        const cfg = JSON.parse(localStorage.getItem('bookshelf_sync') || '{}');
        localStorage.setItem('bookshelf_sync', JSON.stringify({ ...cfg, method: 'local' }));
        await window.bookshelf.selectObsidianFolder();
    });
    await page.waitForFunction(() => !!(window.bookshelf && window.bookshelf.obsidianDirHandle));
}

/** つないだフォルダに、取込データ (JSON の文字列) の本を入れて、再読込しておく (J4 の前提)。
 * connectLocalFolderForTest の後に呼ぶ。入れ方は利用者と同じ取込の画面。保存がフォルダに届いてから再読込し、
 * 再読込のあとフォルダから本を読み直すまで待つ (並列で流しても時間切れにならないよう、expect.poll で待つ・#607)。
 * @param {import('@playwright/test').Page} page
 * @param {string} exportJson
 * @param {string} [dirName] stubFolderPickerForTest に渡したフォルダの名前 */
export async function fillFolderWithBooksForTest(page, exportJson, dirName = 'gate-local') {
    await page.locator('#dashboard-welcome button[data-dw="import"]').click();
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(exportJson);
    await page.locator('#import-from-paste').click();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await page.locator('#book-selection').waitFor({ state: 'hidden' });
    const firstAsin = JSON.parse(exportJson)[0].asin;
    await waitForLocalFileContainsForTest(page, dirName, 'private/library.json', firstAsin, 30000);
    await page.reload();
    await expect.poll(() => page.evaluate(() => (window.bookshelf && window.bookshelf.books ? window.bookshelf.books.length : 0)), { timeout: 30000 }).toBeGreaterThan(0);
}
