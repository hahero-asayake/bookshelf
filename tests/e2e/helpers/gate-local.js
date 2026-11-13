// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」で使う、保存先「ローカルのフォルダ」の用意 (イシュー#588)。
// 書き方の決まりは tests/e2e/gate/README.md。OS のフォルダ選択はヘッドレスで押せないので、フォルダを選ぶ窓
// (window.showDirectoryPicker) だけを、ブラウザの中の本物のフォルダ (OPFS のフォルダ) を返す物に置き換える。
// アプリの読み書き (js/local-fs-adapter.js・フォルダの控えを IndexedDB に置く処理・再起動時の復元) は本物を通す。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
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
    await page.waitForFunction(async ([name, filePath, want]) => {
        try {
            let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
            const parts = filePath.split('/');
            for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
            const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
            return (await file.text()).includes(want);
        } catch (_) { return false; }
    }, [dirName, path, text], { timeout: timeoutMs, polling: 200 });
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
