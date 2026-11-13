#!/usr/bin/env node
// イシュー#559 step1差し戻し: ②指摘「ハヘロの端末はiPhone/iPad Safariの可能性が高い」への対応。
// WebKitはCDP(Network.emulateNetworkConditions / Emulation.setCPUThrottlingRate / Profiler.*)が
// 使えないため、home-return-perf-throttled.mjs(Chromium専用)とは別スクリプトにする。
// long task(PerformanceObserver longtask)もWebKit未実装のため、代わりに次の2指標で「止まり」を見る:
//   - rAFギャップ最大値: 戻った直後5秒間、requestAnimationFrameの間隔が一番開いた所(ms)
//   - clickDelay: 戻った直後、page.mouse.click()(本物のイベント)からcaptureフェーズの
//     clickハンドラが実行されるまでの時間(ms)。Event Timing API非対応の代替。
// ネットワーク/CPUスロットルはWebKitでは掛けていない(素の回線・素のCPU)。Chromium側の計測
// (Slow4G+CPU6倍)とは前提が違う比較になる点は結果にそのまま明記する。
//
// 使い方: node tests/perf/home-return-perf-webkit.mjs --port 8159 --device 390 \
//         --scrollPx 30000 --midLoadWaitMs 400 --repeat 3 --out tmp/559
import { webkit } from 'playwright-core';
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
const REPEAT = Number(args.repeat || 3);
const MID_LOAD_WAIT_MS = Number(args.midLoadWaitMs || 400);
const SCROLL_PX = Number(args.scrollPx || 30000);
const AFTER_WAIT_MS = Number(args.afterWaitMs || 5000);
const OUT = args.out || 'tmp/559';

mkdirSync(OUT, { recursive: true });
const { library, userData } = genLibraryAndUserDataRealCovers(N);
const libraryJson = JSON.stringify(library);
const userDataJson = JSON.stringify(userData);

async function setupPage(context) {
    const page = await context.newPage();
    const activeImgReqs = new Map();
    page.on('request', (req) => { if (/m\.media-amazon\.com/.test(req.url())) activeImgReqs.set(req, Date.now()); });
    page.on('requestfinished', (req) => activeImgReqs.delete(req));
    page.on('requestfailed', (req) => activeImgReqs.delete(req));

    await page.addInitScript(([lib, ud]) => {
        localStorage.setItem('virtualBookshelf_library', lib);
        localStorage.setItem('virtualBookshelf_userData', ud);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: null, publish: { target: 'hub' } }));
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
    await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
    await page.waitForSelector('#bookshelf .book-item', { timeout: 20000 }).catch(() => {});
    if (SCROLL_PX > 0) {
        await page.evaluate((px) => { document.getElementById('view-bookshelf').scrollTop = px; }, SCROLL_PX);
    }
    await page.waitForTimeout(MID_LOAD_WAIT_MS);
}

async function measureOnce(page, activeImgReqs) {
    await gotoBookshelfMidLoad(page);
    const pendingAtNav = activeImgReqs.size;
    await page.evaluate(() => {
        window.__homeRenderDoneAt = undefined;
        // rAFギャップ計測: 戻った直後から記録開始
        window.__rafGaps = [];
        window.__rafLast = null;
        window.__rafRunning = true;
        function loop(t) {
            if (window.__rafLast !== null) window.__rafGaps.push(t - window.__rafLast);
            window.__rafLast = t;
            if (window.__rafRunning) requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    });
    const navStart = await page.evaluate(() => performance.now());
    // ②指示: 戻る操作はpage.evaluate内の素のDOM click()
    await page.evaluate(() => { document.querySelector('.sidebar-brand').click(); });
    await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 20000 });
    const doneAt = await page.evaluate(() => window.__homeRenderDoneAt);
    const navMs = doneAt - navStart;

    // clickDelay: ホーム表示完了直後、本物のマウスイベント(page.mouse.click)から
    // captureフェーズのclickハンドラが実行されるまでの時間(Event Timing代替)。
    await page.evaluate(() => {
        window.__clickDelay = null;
        window.__clickSentAt = performance.now();
        const handler = () => {
            window.__clickDelay = performance.now() - window.__clickSentAt;
            document.removeEventListener('click', handler, true);
        };
        document.addEventListener('click', handler, { capture: true });
    });
    await page.mouse.click(Math.floor(DEVICE / 2), 200);
    await page.waitForTimeout(300);
    const clickDelayMs = await page.evaluate(() => (window.__clickDelay !== null ? Math.round(window.__clickDelay * 10) / 10 : null));

    const remainWait = Math.max(0, AFTER_WAIT_MS - 300);
    await page.waitForTimeout(remainWait);
    const pendingAfter = activeImgReqs.size;

    const rafGaps = await page.evaluate(() => { window.__rafRunning = false; return window.__rafGaps || []; });
    const rafGapMax = rafGaps.reduce((m, g) => Math.max(m, g), 0);

    return {
        navMs: Math.round(navMs * 10) / 10,
        rafGapMax: Math.round(rafGapMax * 10) / 10,
        clickDelayMs,
        pendingAtNav,
        pendingAfter5s: pendingAfter,
    };
}

async function main() {
    const browser = await webkit.launch();
    const h = DEVICE <= 500 ? 844 : 768;
    const context = await browser.newContext({ viewport: { width: DEVICE, height: h }, serviceWorkers: 'block' });
    const { page, activeImgReqs } = await setupPage(context);

    const results = [];
    for (let i = 0; i < REPEAT; i++) {
        try {
            const r = await measureOnce(page, activeImgReqs);
            results.push({ engine: 'webkit', device: DEVICE, run: i + 1, ...r });
            console.log(`[engine=webkit][device=${DEVICE}][run${i + 1}] navMs=${r.navMs} rafGapMax=${r.rafGapMax} clickDelayMs=${r.clickDelayMs} pendingAtNav=${r.pendingAtNav} pendingAfter5s=${r.pendingAfter5s}`);
        } catch (e) {
            console.error(`[run${i + 1}] FAILED: ${e.message}`);
            results.push({ engine: 'webkit', device: DEVICE, run: i + 1, error: String(e.message) });
        }
    }
    await context.close();
    await browser.close();
    const outFile = path.join(OUT, `home-return-perf-webkit-d${DEVICE}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`書き出し: ${outFile}`);
}

main();
