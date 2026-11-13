// 門のE2E (テスト名に `@gate` と観測点ID・イシュー#583) の「前提」の置き場。
// 書き方の決まりは tests/e2e/gate/README.md。前提の区間 (test.step('前提: …')) は、この helpers/ の関数の
// 呼び出しだけで組む (lint:e2e-gate が確かめる)。ここでは内部に触ってよいが、アプリ自身のファイル
// (index.html・js/・css/・sw.js) への通信は差し替えない = 本物のコードを通す。
//
// 使う順番: seedLibraryForTest → bootAppForTest → stubStorageForTest (→ 必要なら sync.js の mockSyncReady)。
// seed は「アプリが読み込まれる前」に入れる必要があり、stub は「読み込まれた後」でないと差し替える相手が無い。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');

/** 蔵書と利用者データ (tests/fixtures の見本・「フィクスチャの本 1」ほか) を入れ、保存先の方式をローカルにしておく。
 * アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page */
export async function seedLibraryForTest(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixture('fixture-userdata.json'), fixture('fixture-library.json')]);
}

/** アプリを開き、蔵書の読み込みが終わるまで待つ。
 * @param {import('@playwright/test').Page} page */
export async function bootAppForTest(page) {
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

/** 保存先 (ローカルのフォルダ) の読み書きをメモリに置き換える。ヘッドレスではフォルダを選べないための模擬で、
 * 保存→読み直しはメモリの中で成り立つ。ハブのログインボタンの描画 (外部の Google のスクリプト) も止める。
 * アプリを開いた後に呼ぶ。
 * @param {import('@playwright/test').Page} page */
export async function stubStorageForTest(page) {
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
}
