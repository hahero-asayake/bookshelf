#!/usr/bin/env node
// イシュー#559 step1: ハヘロの見立て「本棚→ホームで数秒固まるのは、離れた後も表紙画像の
// 読み込みが続いているせい」を、#530より実条件に近づけて検証する。
// #530 (home-return-perf.mjs / home-return-perf-real.mjs) との違い:
//   - 表紙は実Amazon CDN URL(fixtures/real-covers.mjs・m.media-amazon.com)
//   - 通信をCDP Network.emulateNetworkConditionsでスロットル(Fast 3G / Slow 4G)
//   - CPUをCDP Emulation.setCPUThrottlingRateでスロットル
//   - SWキャッシュ(sw.js)をcontext.serviceWorkers:'block'で有効/無効に切替
//   - 戻る操作は page.evaluate 内の素のDOM click()(②指示・Playwrightのオートウェイトを混入させない)
//   - 戻った後も続く画像通信の件数(Playwright request/requestfinished/requestfailedで追跡)
//   - 入力遅延はEvent Timing API(processingStart-startTime)、page.mouse.clickで実イベントを発火
//
// 使い方:
//   node tests/perf/home-return-perf-throttled.mjs --port 8159 --device 390 --network slow4g \
//        --cpu 6 --sw off --repeat 3 --midLoadWaitMs 800 --out tmp/559
import { chromium } from 'playwright-core';
import { genLibraryAndUserDataRealCovers } from './fixtures/real-covers.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
}, []));
const PORT = args.port || '8159';
const N = Number(args.n || 780);
const DEVICE = Number(args.device || 390);
const NETWORK = args.network || 'slow4g'; // slow4g | fast3g | none
const CPU = Number(args.cpu || 6);
const SW = args.sw === 'on'; // 既定off
const REPEAT = Number(args.repeat || 3);
const MID_LOAD_WAIT_MS = Number(args.midLoadWaitMs || 800);
const SCROLL_PX = Number(args.scrollPx || 0); // 0=開いた直後のまま(既定)。>0ならスクロールしてから離れる近似
const AFTER_WAIT_MS = Number(args.afterWaitMs || 5000);
const OUT = args.out || 'tmp/559';

// Chrome DevTools ネットワークスロットルプリセット(近似値・2026-11-13時点でdevtools仕様を
// 確認する時間が無く、Puppeteer PredefinedNetworkConditions由来の値を採用)。
// Fast 3G: download 1.6Mbps / upload 750Kbps / latency 562.5ms
// Slow 4G: download 1.4Mbps / upload 700Kbps / latency 170ms (要再確認・近似)
const NETWORK_PRESETS = {
    none: null,
    fast3g: { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 562.5 },
    slow4g: { offline: false, downloadThroughput: (1.4 * 1024 * 1024) / 8, uploadThroughput: (700 * 1024) / 8, latency: 170 },
};

mkdirSync(OUT, { recursive: true });
const { library, userData } = genLibraryAndUserDataRealCovers(N);
const libraryJson = JSON.stringify(library);
const userDataJson = JSON.stringify(userData);

async function setupPage(context) {
    const page = await context.newPage();
    const activeImgReqs = new Map(); // request -> startedAt(Date.now())
    page.on('request', (req) => {
        if (/m\.media-amazon\.com/.test(req.url())) activeImgReqs.set(req, Date.now());
    });
    page.on('requestfinished', (req) => activeImgReqs.delete(req));
    page.on('requestfailed', (req) => activeImgReqs.delete(req));

    await page.addInitScript(([lib, ud]) => {
        localStorage.setItem('virtualBookshelf_library', lib);
        localStorage.setItem('virtualBookshelf_userData', ud);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: null, publish: { target: 'hub' } }));
        window.__longtasks = [];
        window.__eventTimings = [];
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) window.__longtasks.push({ start: e.startTime, dur: e.duration });
            }).observe({ type: 'longtask', buffered: true });
        } catch (_) { /* noop */ }
        try {
            new PerformanceObserver((list) => {
                for (const e of list.getEntries()) {
                    window.__eventTimings.push({ name: e.name, startTime: e.startTime, processingStart: e.processingStart, processingEnd: e.processingEnd, duration: e.duration });
                }
            }).observe({ type: 'event', buffered: true, durationThreshold: 0 });
        } catch (_) { /* noop */ }
    }, [libraryJson, userDataJson]);
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
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
    return { page, activeImgReqs };
}

async function gotoBookshelfMidLoad(page) {
    const t0 = Date.now();
    await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
    // フル読み込み完了は待たない(見立ての前提=読み込み途中でホームへ戻る)。
    // 最初のカードが出た(= DOM構築が始まった)ことだけ確認してから、指定msだけ待つ。
    await page.waitForSelector('#bookshelf .book-item', { timeout: 20000 }).catch(() => {});
    if (SCROLL_PX > 0) {
        // 現実的なシナリオ近似: 本棚をスクロールしてLazyLoaderに先読みマージン分の
        // 画像を大量にトリガーさせた状態で離れる(開いた直後そのまま離れるケースより多め)。
        await page.evaluate((px) => { document.getElementById('view-bookshelf').scrollTop = px; }, SCROLL_PX);
    }
    if (process.env.DEBUG559) console.error('DEBUG selectorAppeared +ms', Date.now() - t0);
    await page.waitForTimeout(MID_LOAD_WAIT_MS);
    if (process.env.DEBUG559) {
        const info = await page.evaluate(() => {
            const imgs = document.querySelectorAll('#bookshelf img');
            let withSrc = 0, withDataSrc = 0;
            imgs.forEach(i => { if (i.src) withSrc++; if (i.dataset.src) withDataSrc++; });
            return { total: imgs.length, withSrc, withDataSrc };
        });
        console.error('DEBUG imgInfo', JSON.stringify(info));
        const res = await page.evaluate(() => performance.getEntriesByType('resource')
            .filter(r => r.name.includes('media-amazon'))
            .map(r => ({ name: r.name.slice(-30), dur: Math.round(r.duration), transferSize: r.transferSize })));
        console.error('DEBUG resources', JSON.stringify(res));
    }
}

async function measureOnce(page, client, activeImgReqs) {
    await gotoBookshelfMidLoad(page);
    const pendingAtNav = activeImgReqs.size;
    if (process.env.DEBUG559) console.error('DEBUG pendingAtNav', pendingAtNav, 'time', Date.now());
    await page.evaluate(() => { window.__homeRenderDoneAt = undefined; window.__longtasks = []; window.__eventTimings = []; });
    await client.send('Profiler.start');
    const navStart = await page.evaluate(() => performance.now());
    // ②指示: 戻る操作はpage.evaluate内の素のDOM click()(Playwrightのオートウェイトを混ぜない)
    await page.evaluate(() => { document.querySelector('.sidebar-brand').click(); });
    await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 20000 });
    const doneAt = await page.evaluate(() => window.__homeRenderDoneAt);
    const navMs = doneAt - navStart;

    // 入力遅延: ホーム表示完了直後に実クリックを1回発火し、Event Timingで計測。
    await page.mouse.click(Math.floor(DEVICE / 2), 200);
    await page.waitForTimeout(300); // Event Timingエントリのdispatchを待つ
    const eventTimings = await page.evaluate(() => window.__eventTimings || []);
    const clickEntry = eventTimings.filter(e => e.name === 'click').pop();
    const inputDelayMs = clickEntry ? Math.round((clickEntry.processingStart - clickEntry.startTime) * 10) / 10 : null;

    const remainWait = Math.max(0, AFTER_WAIT_MS - 300);
    await page.waitForTimeout(remainWait);
    const pendingAfter = activeImgReqs.size;

    const longtasks = await page.evaluate(() => window.__longtasks || []);
    await client.send('Profiler.stop');
    const inWindow = longtasks.filter(lt => lt.start >= navStart - 50);
    const ltMax = inWindow.reduce((m, lt) => Math.max(m, lt.dur), 0);
    const ltSum = inWindow.reduce((s, lt) => s + lt.dur, 0);

    return {
        navMs: Math.round(navMs * 10) / 10,
        ltMax: Math.round(ltMax * 10) / 10,
        ltSum: Math.round(ltSum * 10) / 10,
        ltCount: inWindow.length,
        inputDelayMs,
        pendingAtNav,
        pendingAfter5s: pendingAfter,
    };
}

async function main() {
    const browser = await chromium.launch();
    const h = DEVICE <= 500 ? 844 : 768;
    const context = await browser.newContext({
        viewport: { width: DEVICE, height: h },
        serviceWorkers: SW ? 'allow' : 'block',
    });
    const { page, activeImgReqs } = await setupPage(context);
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 });
    await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    const netCond = NETWORK_PRESETS[NETWORK];
    if (netCond) await client.send('Network.emulateNetworkConditions', netCond);

    const results = [];
    for (let i = 0; i < REPEAT; i++) {
        try {
            const r = await measureOnce(page, client, activeImgReqs);
            results.push({ device: DEVICE, network: NETWORK, cpu: CPU, sw: SW, run: i + 1, ...r });
            console.log(`[device=${DEVICE}][net=${NETWORK}][cpu=${CPU}x][sw=${SW}][run${i + 1}] navMs=${r.navMs} ltMax=${r.ltMax} ltSum=${r.ltSum} ltCount=${r.ltCount} inputDelayMs=${r.inputDelayMs} pendingAtNav=${r.pendingAtNav} pendingAfter5s=${r.pendingAfter5s}`);
        } catch (e) {
            console.error(`[run${i + 1}] FAILED: ${e.message}`);
            results.push({ device: DEVICE, network: NETWORK, cpu: CPU, sw: SW, run: i + 1, error: String(e.message) });
        }
    }
    await context.close();
    await browser.close();
    const outFile = path.join(OUT, `home-return-perf-throttled-d${DEVICE}-${NETWORK}-cpu${CPU}-sw${SW}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`書き出し: ${outFile}`);
}

main();
