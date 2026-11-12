#!/usr/bin/env node
// 仮説検証: navMsの大部分がPlaywrightのpage.click()解決処理(要素の可視性判定・座標計算等、
// CPUx6スロットリング下で遅くなる)なのか、ブラウザ内の素のDOM click()と比べて確かめる。
import { chromium } from 'playwright-core';
import { genLibraryAndUserData } from './fixtures/gen-780.mjs';

const N = Number(process.argv.includes('--n') ? process.argv[process.argv.indexOf('--n') + 1] : 5000);
const PORT = '8530';
const { library, userData } = genLibraryAndUserData(N);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await context.newPage();
await page.addInitScript(([lib, ud]) => {
    localStorage.setItem('virtualBookshelf_library', lib);
    localStorage.setItem('virtualBookshelf_userData', ud);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: null, publish: { target: 'hub' } }));
}, [JSON.stringify(library), JSON.stringify(userData)]);
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
await page.evaluate(() => {
    window.bookshelf.saveUserData = async () => {};
    const adapter = window.bookshelf.storage.adapter;
    const mem = new Map();
    adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
    adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
    window.bookshelf.flushSync = async () => {};
    window.bookshelf._isSyncReady = () => true;
    window.bookshelf._scheduleSync = () => {};
    const dash = window.bookshelf.dashboard;
    const orig = dash.render.bind(dash);
    dash.render = function (...a) {
        const r = orig(...a);
        requestAnimationFrame(() => { window.__homeRenderDoneAt = performance.now(); });
        return r;
    };
});
const client = await context.newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
await page.waitForFunction((min) => document.querySelectorAll('#bookshelf .book-item').length >= min, Math.min(700, Math.floor(N * 0.9)), { timeout: 20000 });
await page.waitForTimeout(500);

// 素のDOM click()で計測(Playwrightのクリック解決処理を経由しない)
const navMsDirect = await page.evaluate(() => new Promise((resolve) => {
    window.__homeRenderDoneAt = undefined;
    const navStart = performance.now();
    document.querySelector('.sidebar-brand').click();
    const check = () => {
        if (window.__homeRenderDoneAt !== undefined) resolve(window.__homeRenderDoneAt - navStart);
        else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
}));
console.log(`[direct DOM click] n=${N} navMs=${navMsDirect.toFixed(1)}`);

// 本棚へ戻って同じ条件でpage.click()版も測る(比較用)
await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
await page.waitForFunction((min) => document.querySelectorAll('#bookshelf .book-item').length >= min, Math.min(700, Math.floor(N * 0.9)), { timeout: 20000 });
await page.waitForTimeout(500);
await page.evaluate(() => { window.__homeRenderDoneAt = undefined; });
const navStart2 = await page.evaluate(() => performance.now());
await page.click('.sidebar-brand');
await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 20000 });
const doneAt2 = await page.evaluate(() => window.__homeRenderDoneAt);
console.log(`[page.click()] n=${N} navMs=${(doneAt2 - navStart2).toFixed(1)}`);

await browser.close();
