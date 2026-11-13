// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」のうち、Service Worker を動かす実行 (J8 オフライン・イシュー#589) で使うもの。
// 書き方の決まりは tests/e2e/gate/README.md。SW を動かすのは、spec の先頭の test.use({ serviceWorkers: 'allow' }) で行う
// (playwright.config.js の既定は 'block' のまま = 他の spec に影響しない)。
//
// 使う順番: seedLibraryOnceForTest → openAppForTest (→ 「2回開いた端末」にするなら reopenAppForTest)。
// gate-setup.js の seedLibraryForTest は再読込のたびに localStorage を入れ直すので、再読込をまたいで「残る」を
// 確かめる J8 では使わない (利用者が書いた分が、再読込で見本に戻って見えてしまう)。
//
// webkit (gate-webkit) では、電波なし (context.setOffline) の間は SW のキャッシュからも読めない
// (教科書どおりの最小の SW でも、ページからの fetch は「Load failed」・再読込は「WebKit encountered an internal error」。
// 2026-11-14・イシュー#589 step2 で実測 = Playwright の WebKit の制約)。そのため J8 の spec は gate-webkit の対象から外してある。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');

// 蔵書を最初の1回だけ入れる前提は gate-setup.js の seedLibraryOnceForTest を正とする (②・2026-11-14 #590 の rebase で1つに寄せた)。
// J8 の spec はこれまでどおりこのファイルから import できるよう、ここから出し直す。
export { seedLibraryOnceForTest } from './gate-setup.js';

/** アプリを開き、蔵書の読み込みと、SW の登録 (有効になるまで) を待つ = 「1回開いただけの端末」。
 * @param {import('@playwright/test').Page} page */
export async function openAppForTest(page) {
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller));
}

/** 電波があるうちに、もう1回開き直す (再読込) = 「2回開いた端末」。2回目は SW が最初から画面を制御するので、
 * 読み込んだ資産が SW のキャッシュに入る (sw.js のネットワーク優先・成功した同一オリジン GET を保存)。
 * @param {import('@playwright/test').Page} page */
export async function reopenAppForTest(page) {
    await page.reload();
    await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0 && !!navigator.serviceWorker.controller);
}
