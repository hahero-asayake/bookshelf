#!/usr/bin/env node
// イシュー#575: ハヘロの見立て「本棚→ホームで数秒固まるのは本棚ハイライトのせい」をA/Bで確かめる。
//   A = 既定レイアウト(bookshelf-highlights あり) / B = 既定レイアウトから bookshelf-highlights だけ外す
// B はソースを変えず、実行時に userData._storage.main.home.widgets (dashboard.js getLayout の読み先)
// へ「DEFAULT_LAYOUT - highlights」を入れて作る(ユーザーがウィジェットを外した状態と同じ)。
// 規模は fixtures/gen-scale.mjs (本棚数 × 各本棚冊数・実表紙URL)。
// 関数ごとの描画時間は実行時ラップで測る:
//   - dashboard.render                     (js/dashboard.js:191)
//   - _registry['bookshelf-highlights'].render = _renderBookshelfHighlights (js/dashboard.js:977)
//   - app._renderBookshelfCard             (js/ui/bookshelf-card.js:93)
// chromium: CDPで Slow4G + CPU6倍、long task を PerformanceObserver で取る (#559 throttled と同じ)。
// webkit  : CDPが無いので素の回線・素のCPU。rAFギャップ最大値と click→captureハンドラ遅れ (#559 webkit と同じ)。
//
// 使い方: node tests/perf/home-return-ab.mjs --port 8175 --browser chromium --variant A \
//           --shelves 60 --perShelf 300 --sort custom --repeat 3 --out tmp/575
import { chromium, webkit } from 'playwright-core';
import { genScale } from './fixtures/gen-scale.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
}, []));
const PORT = args.port || '8175';
const BROWSER = args.browser || 'chromium';
const VARIANT = (args.variant || 'A').toUpperCase();
const SHELVES = Number(args.shelves || 10);
const PER_SHELF = Number(args.perShelf || 50);
const SORT = args.sort || 'custom';
const FROM = args.from || 'shelf1'; // 戻る前に開いておく本棚
const DEVICE = Number(args.device || 390);
const CPU = Number(args.cpu || 6);
const REPEAT = Number(args.repeat || 3);
const MID_LOAD_WAIT_MS = Number(args.midLoadWaitMs || 800);
const AFTER_WAIT_MS = Number(args.afterWaitMs || 3000);
const OUT = args.out || 'tmp/575';
const SLOW4G = { offline: false, downloadThroughput: (1.4 * 1024 * 1024) / 8, uploadThroughput: (700 * 1024) / 8, latency: 170 };

mkdirSync(OUT, { recursive: true });
const { library, userData, totalBooks } = genScale({ shelves: SHELVES, perShelf: PER_SHELF, sortOrder: SORT });
const libraryJson = JSON.stringify(library);
const userDataJson = JSON.stringify(userData);
const r1 = (v) => Math.round(v * 10) / 10;

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
        } catch (_) { /* webkit: 未実装 */ }
    }, [libraryJson, userDataJson]);
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.dashboard, null, { timeout: 60000 });
    const info = await page.evaluate((variant) => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
        const adapter = app.storage.adapter;
        const mem = new Map();
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        app.flushSync = async () => {};
        app._isSyncReady = () => true;
        app._scheduleSync = () => {};
        const dash = app.dashboard;
        // B: ハイライトだけ外したレイアウト (getLayout の読み先にユーザー設定として入れる)
        if (variant === 'B') {
            app.userData._storage = app.userData._storage || {};
            app.userData._storage.main = app.userData._storage.main || {};
            app.userData._storage.main.home = {
                widgets: BookshelfDashboard.DEFAULT_LAYOUT.filter(w => w.id !== 'bookshelf-highlights').map(w => ({ ...w }))
            };
        }
        // 関数ごとの時間 (呼ばれた回数と合計ms) を戻る1回ごとに集計する
        window.__fn = {};
        const wrap = (key, fn) => function (...a) {
            const t = performance.now();
            try { return fn.apply(this, a); } finally {
                const s = window.__fn[key] || (window.__fn[key] = { calls: 0, ms: 0 });
                s.calls++; s.ms += performance.now() - t;
            }
        };
        const entry = dash._registry['bookshelf-highlights'];
        if (entry) entry.render = wrap('_renderBookshelfHighlights(dashboard.js:977)', entry.render);
        // _renderBookshelfCard の内訳 (カード描画中だけ数える):
        //   books.find = bookshelf-card.js:144 の表紙ごとの全蔵書走査
        //   Array.sort = :122(custom) / :137(既定) の本棚全冊ソート
        //   _getLibrarySortedAsins = :134/:136 の全蔵書の並び(キャッシュ有無)
        //   _bindBookshelfOverviewEvents = dashboard.js:1000 のバインド
        let inCard = 0;
        if (Array.isArray(app.books)) {
            const origFind = Array.prototype.find;
            Object.defineProperty(app.books, 'find', { configurable: true, value: function (...a) { return inCard ? wrap('  books.find(bookshelf-card.js:144)', origFind).apply(this, a) : origFind.apply(this, a); } });
        }
        const origSort = Array.prototype.sort;
        Array.prototype.sort = function (...a) { return inCard ? wrap('  Array.sort(bookshelf-card.js:122/137)', origSort).apply(this, a) : origSort.apply(this, a); };
        if (typeof app._getLibrarySortedAsins === 'function') app._getLibrarySortedAsins = wrap('  _getLibrarySortedAsins(bookshelf-card.js:134/136)', app._getLibrarySortedAsins);
        if (typeof app._bindBookshelfOverviewEvents === 'function') app._bindBookshelfOverviewEvents = wrap('_bindBookshelfOverviewEvents(dashboard.js:1000)', app._bindBookshelfOverviewEvents);
        const cardFn = wrap('_renderBookshelfCard(bookshelf-card.js:93)', app._renderBookshelfCard);
        app._renderBookshelfCard = function (...a) { inCard++; try { return cardFn.apply(this, a); } finally { inCard--; } };
        const origRender = dash.render;
        dash.render = wrap('dashboard.render(dashboard.js:191)', function (...a) {
            const r = origRender.apply(this, a);
            requestAnimationFrame(() => { window.__homeRenderDoneAt = performance.now(); });
            return r;
        });
        return { layout: dash.getLayout().map(w => w.id), sortOrder: app.sortOrder, shelves: app.userData.bookshelves.length };
    }, VARIANT);
    return { page, info };
}

async function measureOnce(page) {
    await page.evaluate((from) => { window.bookshelf._navigateFromUi('bookshelf', from); }, FROM);
    await page.waitForSelector('#bookshelf .book-item', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(MID_LOAD_WAIT_MS);
    await page.evaluate(() => {
        window.__homeRenderDoneAt = undefined; window.__longtasks = []; window.__fn = {};
        // rAFギャップ (両ブラウザで取る)
        window.__rafGaps = []; window.__rafRun = true;
        let last = performance.now();
        const tick = (t) => { window.__rafGaps.push({ at: t, gap: t - last }); last = t; if (window.__rafRun) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        window.__clickHandledAt = undefined;
        if (!window.__clickHooked) {
            window.__clickHooked = true;
            document.addEventListener('click', () => { if (window.__clickArm) { window.__clickHandledAt = performance.now(); window.__clickArm = false; } }, true);
        }
    });
    const navStart = await page.evaluate(() => performance.now());
    await page.evaluate(() => { document.querySelector('.sidebar-brand').click(); });
    await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 60000 });
    const doneAt = await page.evaluate(() => window.__homeRenderDoneAt);
    // 戻った直後の実クリック: 発火時刻→captureハンドラ実行までの遅れ
    const clickSent = await page.evaluate(() => { window.__clickArm = true; return performance.now(); });
    await page.mouse.click(Math.floor(DEVICE / 2), 200);
    await page.waitForTimeout(AFTER_WAIT_MS);
    const res = await page.evaluate(([navStart, clickSent]) => {
        window.__rafRun = false;
        const gaps = (window.__rafGaps || []).filter(g => g.at >= navStart);
        const lts = (window.__longtasks || []).filter(l => l.start >= navStart - 50);
        return {
            rafMaxGap: gaps.reduce((m, g) => Math.max(m, g.gap), 0),
            clickDelay: window.__clickHandledAt !== undefined ? window.__clickHandledAt - clickSent : null,
            ltCount: lts.length,
            ltMax: lts.reduce((m, l) => Math.max(m, l.dur), 0),
            ltSum: lts.reduce((s, l) => s + l.dur, 0),
            fn: window.__fn,
            hlCards: document.querySelectorAll('#dashboard .bookshelf-card, #widget-bookshelves-grid-host > *').length,
            hlImgs: document.querySelectorAll('#widget-bookshelves-grid-host img').length,
            // #575: _renderBookshelfHighlights 冒頭の asin→本 Map 構築と同じループの所要時間 (同じスロットル下)
            mapBuildMs: (() => {
                const t = performance.now();
                const m = new Map();
                for (const b of (window.bookshelf.books || [])) if (!m.has(b.asin)) m.set(b.asin, b);
                return performance.now() - t;
            })(),
        };
    }, [navStart, clickSent]);
    const fn = {};
    for (const [k, v] of Object.entries(res.fn || {})) fn[k] = { calls: v.calls, ms: r1(v.ms) };
    return {
        navMs: r1(doneAt - navStart), rafMaxGap: r1(res.rafMaxGap), clickDelay: res.clickDelay == null ? null : r1(res.clickDelay),
        ltCount: res.ltCount, ltMax: r1(res.ltMax), ltSum: r1(res.ltSum), hlCards: res.hlCards, hlImgs: res.hlImgs, mapBuildMs: r1(res.mapBuildMs), fn,
    };
}

async function main() {
    const bt = BROWSER === 'webkit' ? webkit : chromium;
    const browser = await bt.launch();
    const context = await browser.newContext({ viewport: { width: DEVICE, height: 844 }, serviceWorkers: 'block' });
    const { page, info } = await setupPage(context);
    let throttle = 'none(webkit:CDP不可)';
    if (BROWSER !== 'webkit') {
        const client = await context.newCDPSession(page);
        await client.send('Network.enable');
        await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
        await client.send('Network.emulateNetworkConditions', SLOW4G);
        throttle = `slow4g+cpu${CPU}x`;
    }
    const cond = { browser: BROWSER, variant: VARIANT, shelves: SHELVES, perShelf: PER_SHELF, totalBooks, sort: SORT, from: FROM, device: DEVICE, throttle };
    console.log(`[cond] ${JSON.stringify(cond)} layout=${info.layout.join(',')} app.sortOrder=${info.sortOrder} bookshelves=${info.shelves}`);
    const results = [];
    for (let i = 0; i < REPEAT; i++) {
        try {
            const r = await measureOnce(page);
            results.push({ ...cond, run: i + 1, ...r });
            console.log(`[${BROWSER}][${VARIANT}][${SHELVES}x${PER_SHELF}][${SORT}][run${i + 1}] navMs=${r.navMs} ltCount=${r.ltCount} ltMax=${r.ltMax} ltSum=${r.ltSum} rafMaxGap=${r.rafMaxGap} clickDelay=${r.clickDelay} hlCards=${r.hlCards} hlImgs=${r.hlImgs} mapBuildMs=${r.mapBuildMs} fn=${JSON.stringify(r.fn)}`);
        } catch (e) {
            console.error(`[run${i + 1}] FAILED: ${e.message}`);
            results.push({ ...cond, run: i + 1, error: String(e.message) });
        }
    }
    await browser.close();
    const outFile = path.join(OUT, `ab-${BROWSER}-${VARIANT}-${SHELVES}x${PER_SHELF}-${SORT}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`書き出し: ${outFile}`);
}

main();
