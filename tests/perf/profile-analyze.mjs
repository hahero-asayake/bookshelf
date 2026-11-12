#!/usr/bin/env node
// イシュー#530 step4(差し戻し): n=5000/780・1024px・nav入口でCPUプロファイルを取り直し、
// 自己時間(self time)が大きい関数を関数名・ファイル・行番号・ms付きで並べる。
// CDP Profiler.stop()が返すprofile(nodes/samples/timeDeltas)から、各サンプル区間の時間を
// 「そのサンプル時点で実行中だったノード(自己時間)」に積み上げて計算する(hitCountの粗い近似
// ではなく、timeDeltas(実測の経過時間)をsamplesの対応ノードへ正確に配分する)。
import { chromium } from 'playwright-core';
import { genLibraryAndUserData } from './fixtures/gen-780.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
}, []));
const PORT = args.port || '8530';
const N = Number(args.n || 5000);
const OUT = args.out || '/home/sei/GitHub/bookshelf/tmp/530';

mkdirSync(OUT, { recursive: true });
const { library, userData } = genLibraryAndUserData(N);

function selfTimeByFunction(profile) {
    // samples[i]はtimeDeltas[i]の間実行されていたノードid。自己時間をノードごとに積算する。
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const selfUs = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
        const nodeId = profile.samples[i];
        const dt = profile.timeDeltas[i] || 0; // マイクロ秒
        selfUs.set(nodeId, (selfUs.get(nodeId) || 0) + dt);
    }
    const rows = [...selfUs.entries()].map(([id, us]) => {
        const node = byId.get(id);
        const cf = node ? node.callFrame : {};
        return {
            fn: cf.functionName || '(anonymous)',
            url: (cf.url || '').replace(/^.*\/(js\/)/, '$1'),
            line: (cf.lineNumber || 0) + 1,
            ms: Math.round((us / 1000) * 10) / 10
        };
    }).sort((a, b) => b.ms - a.ms);
    return rows;
}

async function main() {
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
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 50 }); // 細かく取る(既定は100us*1000=通常100だが短いnavMsを割るため50us)
    await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

    await page.evaluate(() => { window.bookshelf._navigateFromUi('bookshelf', 'all'); });
    await page.waitForFunction((min) => document.querySelectorAll('#bookshelf .book-item').length >= min, Math.min(700, Math.floor(N * 0.9)), { timeout: 20000 });
    await page.waitForTimeout(500);

    await page.evaluate(() => { window.__homeRenderDoneAt = undefined; });
    await client.send('Profiler.start');
    const navStart = await page.evaluate(() => performance.now());
    await page.click('.sidebar-brand');
    await page.waitForFunction(() => window.__homeRenderDoneAt !== undefined, null, { timeout: 20000 });
    const doneAt = await page.evaluate(() => window.__homeRenderDoneAt);
    const { profile } = await client.send('Profiler.stop');
    const navMs = doneAt - navStart;

    const rows = selfTimeByFunction(profile);
    const top = rows.slice(0, 25);
    console.log(`=== n=${N}, 1024px, nav, navMs=${navMs.toFixed(1)}ms ===`);
    for (const r of top) console.log(`${r.ms}ms\t${r.fn}\t${r.url}:${r.line}`);
    writeFileSync(path.join(OUT, `profile-n${N}.json`), JSON.stringify({ navMs, top }, null, 2));

    await browser.close();
}
main();
