// イシュー#379 step2: 記事エディタの開閉回数ごとに「ホームへ戻る」コストと、セッション中に溜まるものを数える最小ハーネス。
// アプリは変えない (観測はページ側に外付け・CDPで読むだけ)。
// 実行例:
//   node scripts/verify/379-repro-editor10.mjs http://localhost:8801 884f97a
//   node scripts/verify/379-repro-editor10.mjs http://localhost:8802 d80d7a3
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8000';
const LABEL = process.argv[3] || 'v';
const REPS = parseInt((process.argv.find((a) => a.startsWith('--reps=')) || '--reps=10').slice(7), 10);
const OUT = `tmp/379/accum-${LABEL}.json`;
const CHECKPOINTS = [0, 1, 5, 10]; // 開閉回数のチェックポイント

const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
const books = Array.from({ length: 800 }, (_, i) => {
    const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
    return { asin, title: `計測用の本 ${n} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 37}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
});
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
userData.notes = {};
const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
const userDataStr = JSON.stringify(userData);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

// ===== 初期化スクリプト: データ注入 + Observer生成をラップして数える(bookshelf.js実行より前に差し込む) =====
await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    window.__obsCount = { Mutation: 0, Resize: 0, Intersection: 0 };
    for (const [key, Ctor] of [['Mutation', window.MutationObserver], ['Resize', window.ResizeObserver], ['Intersection', window.IntersectionObserver]]) {
        if (!Ctor) continue;
        const wrapped = function (...args) { window.__obsCount[key]++; return new Ctor(...args); };
        wrapped.prototype = Ctor.prototype;
        if (key === 'Mutation') window.MutationObserver = wrapped;
        if (key === 'Resize') window.ResizeObserver = wrapped;
        if (key === 'Intersection') window.IntersectionObserver = wrapped;
    }
}, [userDataStr, libraryStr]);

await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
const version = await page.evaluate(() => (document.querySelector('script[src*="bookshelf.js"]') || {}).src || '');
await page.evaluate(() => {
    const bs = window.bookshelf; const mem = new Map();
    const a = bs.storage.adapter;
    a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
    a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
    if (a.readText) a.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
    if (a.writeText) a.writeText = async (p, t) => { mem.set(p, t); };
    bs._isSyncReady = () => true;
    window.__measure = async (fn) => { const t0 = performance.now(); const r = fn(); if (r && r.then) await r; await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); return { tFrame: Math.round((performance.now() - t0) * 10) / 10 }; };
    window.__waitHash = (pred, ms) => new Promise((res) => { const t0 = performance.now(); const tick = () => { if (pred(location.hash || '')) return res(true); if (performance.now() - t0 > ms) return res(false); requestAnimationFrame(tick); }; tick(); });
});
await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
await page.waitForTimeout(300);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('HeapProfiler.enable');

// ===== detached DOM数: HeapProfiler.takeHeapSnapshotでname先頭"Detached "のnodeを数える =====
async function countDetached() {
    let chunks = '';
    const onChunk = (p) => { chunks += p.chunk; };
    cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
    try {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    } finally {
        cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    }
    let snap;
    try { snap = JSON.parse(chunks); } catch (e) { return { detached: null, na: 'parse失敗:' + String(e).slice(0, 80) }; }
    const fields = snap.snapshot.meta.node_fields;
    const nameIdx = fields.indexOf('name'); const typeIdx = fields.indexOf('type');
    const stride = fields.length;
    const nodes = snap.nodes; const strings = snap.strings;
    const typeEnum = snap.snapshot.meta.node_types[typeIdx];
    let detached = 0; let detachedByTag = new Map();
    for (let i = 0; i < nodes.length; i += stride) {
        const name = strings[nodes[i + nameIdx]] || '';
        if (name.startsWith('Detached ')) { detached++; detachedByTag.set(name, (detachedByTag.get(name) || 0) + 1); }
    }
    return { detached, top: [...detachedByTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) };
}

// ===== window/document の直付けリスナー数 (DOMDebugger) =====
async function listenerCount(expr) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    if (!result.objectId) return null;
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    return listeners.length;
}

async function snapshot(label) {
    const dom = await page.evaluate(() => ({
        allEls: document.querySelectorAll('*').length,
        styleEls: document.querySelectorAll('style').length,
        iframes: document.querySelectorAll('iframe').length,
        ovStackLen: window.overlays ? window.overlays.stack.length : null,
        ovSeq: window.overlays ? window.overlays._seq : null,
        obsCount: { ...window.__obsCount },
    }));
    const winListeners = await listenerCount('window');
    const docListeners = await listenerCount('document');
    const { detached, top, na } = await countDetached();
    return { label, ...dom, winListeners, docListeners, detachedDom: detached, detachedTop: top, detachedNA: na };
}

const A = {
    articleOpen: () => page.evaluate(() => window.__measure(async () => { await window.bookshelf.openPublishPagesModal(); window.bookshelf._artOpenEditor(null); })),
    articleClose: () => page.evaluate(() => window.__measure(() => window.bookshelf.closePublishPagesModal())),
    navHome: () => page.evaluate(() => window.__measure(async () => { const p = window.__waitHash((h) => h === '' || h === '#' || h === '#/', 3000); const b = document.querySelector('[data-mobile-nav="home"]'); if (b && b.offsetParent !== null) b.click(); else window.bookshelf.router.navigateMain(); await p; })),
    openShelf: () => page.evaluate(() => window.__measure(() => window.bookshelf.switchBookshelf('all'))),
};

async function measureNavHome(reps) {
    const rows = [];
    for (let r = 0; r < reps; r++) {
        await A.openShelf(); await page.waitForTimeout(200);
        const row = await A.navHome(); await page.waitForTimeout(300);
        rows.push(row.tFrame);
        if (r < reps - 1) await A.openShelf();
    }
    // 片付け: home表示のままにしておく (次のcheckpointのopenShelfが起点を揃える)
    const v = rows.filter((x) => x != null).sort((a, b) => a - b);
    return { med: v.length ? v[Math.floor(v.length / 2)] : null, max: v.length ? Math.max(...v) : null, rows };
}

const checkpoints = {};
let opened = 0;
for (const target of CHECKPOINTS) {
    while (opened < target) {
        await A.articleOpen(); await page.waitForTimeout(200);
        await A.articleClose(); await page.waitForTimeout(200);
        opened++;
    }
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.waitForTimeout(200);
    const navHomeStat = await measureNavHome(REPS);
    const snap = await snapshot(`開閉${target}回後`);
    checkpoints[target] = { navHomeStat, snap };
    process.stderr.write(`[379-accum] ${LABEL} 開閉${target}回後: navHome中央値=${navHomeStat.med}ms(max${navHomeStat.max}) allEls=${snap.allEls} ovStack=${snap.ovStackLen} ovSeq=${snap.ovSeq} winLs=${snap.winListeners} docLs=${snap.docListeners} detached=${snap.detachedDom}${snap.detachedNA ? ' NA:' + snap.detachedNA : ''} obs=${JSON.stringify(snap.obsCount)}\n`);
}

const out = { label: LABEL, base: BASE, version, reps: REPS, checkpoints, errors };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`[379-accum] ${LABEL} done. pageerror=${errors.length}`);
await browser.close();
