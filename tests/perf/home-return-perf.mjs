#!/usr/bin/env node
// イシュー#530 step3: 本棚画面→ホーム遷移の実測(直す前の値)。
// 使い方: node tests/perf/home-return-perf.mjs --port 8530 --out /home/sei/GitHub/bookshelf/tmp/530
//
// 指標:
//   - navMs: 遷移操作(click/goBack)の発火 〜 dashboard.render()がRAF後に完了するまでのms
//   - longtask: その区間に発生した PerformanceObserver('longtask') の最大ms・合計ms
//   - CPUプロファイル: CDP Profiler.start/stopで採取し、自己サンプル数(hitCount)上位の関数を出す
//
// 入口3種: nav(左ペインのsidebar-brandクリック・PC/モバイル共通のDOM) / mobile-nav(ボトムナビの
// data-mobile-nav="home"・390のみ意味を持つ) / browser-back(history.back())。
import { chromium } from 'playwright-core';
import { genLibraryAndUserData } from './fixtures/gen-780.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
}, []));
const PORT = args.port || '8530';
const OUT = args.out || '/home/sei/GitHub/bookshelf/tmp/530';
const REPEAT = Number(args.repeat || 3);
const SIZES = [
    { w: 390, h: 844, label: '390' },
    { w: 1024, h: 768, label: '1024' },
    { w: 1440, h: 900, label: '1440' }
];
const ENTRIES = ['nav', 'mobile-nav', 'browser-back'];

mkdirSync(OUT, { recursive: true });
const { library, userData } = genLibraryAndUserData(780);
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
        } catch (_) { /* 環境によって longtask 未サポート */ }
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
        // dashboard.render() 完了(RAF後)を計測できるようにラップする。
        const dash = window.bookshelf.dashboard;
        const orig = dash.render.bind(dash);
        dash.render = function (...a) {
            const r = orig(...a);
            requestAnimationFrame(() => { window.__homeRenderDoneAt = performance.now(); });
            return r;
        };
    });
    return page;
}

async function gotoBookshelf(page) {
    // 本棚画面(all)を開く。ホームに戻る直前の状態を揃える。
    await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
    await page.waitForFunction(() => document.querySelectorAll('#bookshelf .book-item').length >= 700, null, { timeout: 15000 });
    // DOM構築後、レイアウト/ペイントが落ち着くまで待つ(段階描画は並べ替え専用で通常表示には無いため
    // 要素数が揃えば構築完了のはずだが、余裕を持って待つ)
    await page.waitForTimeout(500);
}

async function measureOnce(page, client, entry) {
    await gotoBookshelf(page);
    await page.evaluate(() => { window.__homeRenderDoneAt = undefined; window.__longtasks = []; });
    await client.send('Profiler.start');
    const navStart = await page.evaluate(() => performance.now());
    if (entry === 'nav') {
        await page.click('.sidebar-brand');
    } else if (entry === 'mobile-nav') {
        await page.click('[data-mobile-nav="home"]');
    } else if (entry === 'browser-back') {
        await page.goBack();
    }
    await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 15000 });
    const doneAt = await page.evaluate(() => window.__homeRenderDoneAt);
    const longtasks = await page.evaluate(() => window.__longtasks || []);
    const { profile } = await client.send('Profiler.stop');
    const navMs = doneAt - navStart;
    const inWindow = longtasks.filter(lt => lt.start >= navStart - 50); // 直前50ms猶予
    const ltMax = inWindow.reduce((m, lt) => Math.max(m, lt.dur), 0);
    const ltSum = inWindow.reduce((s, lt) => s + lt.dur, 0);
    return { navMs, ltMax, ltSum, ltCount: inWindow.length, profile };
}

function topSelfFunctions(profile, n = 15) {
    const byId = new Map(profile.nodes.map(nd => [nd.id, nd]));
    const hit = new Map();
    for (const nd of profile.nodes) hit.set(nd.id, nd.hitCount || 0);
    const rows = profile.nodes
        .filter(nd => (hit.get(nd.id) || 0) > 0)
        .map(nd => ({
            fn: nd.callFrame.functionName || '(anonymous)',
            url: (nd.callFrame.url || '').replace(/^.*\/(js\/)/, '$1'),
            line: nd.callFrame.lineNumber + 1,
            hitCount: hit.get(nd.id) || 0
        }))
        .sort((a, b) => b.hitCount - a.hitCount)
        .slice(0, n);
    return rows;
}

async function main() {
    const browser = await chromium.launch();
    const results = [];
    const profiles = {};
    for (const size of SIZES) {
        const context = await browser.newContext({ viewport: { width: size.w, height: size.h } });
        const page = await setupPage(context);
        const client = await context.newCDPSession(page);
        await client.send('Profiler.enable');
        await client.send('Profiler.setSamplingInterval', { interval: 100 });
        // sort-perf-budget.spec.js(#397)と同じCPUx6スロットリング(実機の非力な端末を模する)。
        await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        for (const entry of ENTRIES) {
            if (entry === 'mobile-nav' && size.w > 900) continue; // ボトムナビは900px以下限定
            if (entry === 'nav' && size.w <= 900) continue; // 390ではサイドバーがドロワー化し直接は押せない(別導線)
            for (let i = 0; i < REPEAT; i++) {
                try {
                    const r = await measureOnce(page, client, entry);
                    results.push({ size: size.label, entry, run: i + 1, navMs: Math.round(r.navMs * 10) / 10, ltMax: Math.round(r.ltMax * 10) / 10, ltSum: Math.round(r.ltSum * 10) / 10, ltCount: r.ltCount });
                    const key = `${size.label}-${entry}-${i + 1}`;
                    profiles[key] = topSelfFunctions(r.profile);
                    console.log(`[${size.label}px][${entry}][run${i + 1}] navMs=${r.navMs.toFixed(1)} ltMax=${r.ltMax.toFixed(1)} ltSum=${r.ltSum.toFixed(1)} ltCount=${r.ltCount}`);
                } catch (e) {
                    console.error(`[${size.label}px][${entry}][run${i + 1}] FAILED: ${e.message}`);
                    results.push({ size: size.label, entry, run: i + 1, error: String(e.message) });
                }
            }
        }
        await context.close();
    }
    await browser.close();
    writeFileSync(path.join(OUT, 'home-return-perf-before.json'), JSON.stringify({ results, profiles }, null, 2));
    console.log(`\n書き出し: ${path.join(OUT, 'home-return-perf-before.json')}`);
}

main();
