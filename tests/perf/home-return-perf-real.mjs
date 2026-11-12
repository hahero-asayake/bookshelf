#!/usr/bin/env node
// イシュー#530 step4: 「モックした処理を外して本物のまま測り直す」版。
// step2(home-return-perf.mjs)との違い:
//   - adapter.readJSON/writeJSONをメモリMapではなく、ローカルのモックサーバー(mock-remote-server.mjs)
//     へのfetchに差し替える(②指示どおり通信先はモックサーバーで良いが、通信自体は本物にする)。
//   - flushSync/_isSyncReady/_scheduleSyncはモックせず本物の実装のまま動かす。
//   - 本の表紙画像(productImage)をモックサーバーのURLにし、LazyLoaderの実フェッチ経路を使う。
//   - 蔵書数(--n)と応答遅延(--mockPort、遅延違いのサーバーを複数ポートで用意して切替)をパラメータ化。
//
// 使い方: node tests/perf/home-return-perf-real.mjs --port 8530 --mockPort 9530 --n 780 --delayLabel 0ms --out <dir>
import { chromium } from 'playwright-core';
import { genLibraryAndUserData } from './fixtures/gen-780.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
}, []));
const PORT = args.port || '8530';
const MOCK_PORT = args.mockPort || '9530';
const N = Number(args.n || 780);
const DELAY_LABEL = args.delayLabel || '0ms';
const OUT = args.out || '/home/sei/GitHub/bookshelf/tmp/530';
const REPEAT = Number(args.repeat || 2);
const SIZES = (args.sizes || '390,1024,1440').split(',').map(Number);

mkdirSync(OUT, { recursive: true });
const { library, userData } = genLibraryAndUserData(N);
// 表紙画像をモックサーバーの実URLに向ける(LazyLoaderの実フェッチ経路を使わせる)
for (const b of library.books) b.productImage = `http://localhost:${MOCK_PORT}/img/${b.asin}.png`;
const libraryJson = JSON.stringify(library);
const userDataJson = JSON.stringify(userData);

async function setupPage(context) {
    const page = await context.newPage();
    await page.addInitScript(([lib, ud]) => {
        localStorage.setItem('virtualBookshelf_library', lib);
        localStorage.setItem('virtualBookshelf_userData', ud);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: null, publish: { target: 'hub' } }));
        window.__longtasks = [];
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) window.__longtasks.push({ start: e.startTime, dur: e.duration });
            }).observe({ type: 'longtask', buffered: true });
        } catch (_) { /* noop */ }
    }, [libraryJson, userDataJson]);
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(([mockPort]) => {
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
        // flushSync/_isSyncReady/_scheduleSyncは本物のまま。adapterだけモックサーバーへの実fetchに
        // 差し替える(メモリMapではなく実際にネットワーク往復させる・②指示)。
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => {
            const res = await fetch(`http://localhost:${mockPort}/hub/read?path=${encodeURIComponent(p)}`);
            if (!res.ok) return null;
            return res.json().catch(() => null);
        };
        adapter.writeJSON = async (p, d) => {
            await fetch(`http://localhost:${mockPort}/hub/write?path=${encodeURIComponent(p)}`, { method: 'POST', body: JSON.stringify(d) });
        };
        adapter.isConnected = () => true;
        window.bookshelf.syncMethod = 'hub';
        // dashboard.render()完了(RAF後)の計測マークのみはstep2同様に残す(指標取得のため)
        const dash = window.bookshelf.dashboard;
        const orig = dash.render.bind(dash);
        dash.render = function (...a) {
            const r = orig(...a);
            requestAnimationFrame(() => { window.__homeRenderDoneAt = performance.now(); });
            return r;
        };
    }, [MOCK_PORT]);
    return page;
}

async function gotoBookshelf(page, n) {
    await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
    await page.waitForFunction((min) => document.querySelectorAll('#bookshelf .book-item').length >= min, Math.min(700, Math.floor(n * 0.9)), { timeout: 20000 });
    await page.waitForTimeout(500);
}

async function measureOnce(page, client, n) {
    await gotoBookshelf(page, n);
    await page.evaluate(() => { window.__homeRenderDoneAt = undefined; window.__longtasks = []; });
    await client.send('Profiler.start');
    const navStart = await page.evaluate(() => performance.now());
    await page.click('.sidebar-brand');
    await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 20000 });
    const doneAt = await page.evaluate(() => window.__homeRenderDoneAt);
    const longtasks = await page.evaluate(() => window.__longtasks || []);
    await client.send('Profiler.stop');
    const navMs = doneAt - navStart;
    const inWindow = longtasks.filter(lt => lt.start >= navStart - 50);
    const ltMax = inWindow.reduce((m, lt) => Math.max(m, lt.dur), 0);
    const ltSum = inWindow.reduce((s, lt) => s + lt.dur, 0);
    return { navMs, ltMax, ltSum, ltCount: inWindow.length };
}

async function main() {
    const browser = await chromium.launch();
    const results = [];
    for (const w of SIZES) {
        const h = w <= 500 ? 844 : (w <= 1100 ? 768 : 900);
        const context = await browser.newContext({ viewport: { width: w, height: h } });
        const page = await setupPage(context);
        const client = await context.newCDPSession(page);
        await client.send('Profiler.enable');
        await client.send('Profiler.setSamplingInterval', { interval: 100 });
        await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        for (let i = 0; i < REPEAT; i++) {
            try {
                const r = await measureOnce(page, client, N);
                results.push({ size: w, n: N, delay: DELAY_LABEL, run: i + 1, navMs: Math.round(r.navMs * 10) / 10, ltMax: Math.round(r.ltMax * 10) / 10, ltSum: Math.round(r.ltSum * 10) / 10, ltCount: r.ltCount });
                console.log(`[n=${N}][delay=${DELAY_LABEL}][${w}px][run${i + 1}] navMs=${r.navMs.toFixed(1)} ltMax=${r.ltMax.toFixed(1)} ltSum=${r.ltSum.toFixed(1)} ltCount=${r.ltCount}`);
            } catch (e) {
                console.error(`[n=${N}][delay=${DELAY_LABEL}][${w}px][run${i + 1}] FAILED: ${e.message}`);
                results.push({ size: w, n: N, delay: DELAY_LABEL, run: i + 1, error: String(e.message) });
            }
        }
        await context.close();
    }
    await browser.close();
    const outFile = path.join(OUT, `home-return-perf-real-n${N}-${DELAY_LABEL}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`書き出し: ${outFile}`);
}

main();
