// イシュー#387 step1: 並び替えの重さを内訳つきで測る (本800冊・幅390)。
// 使い方: node scripts/verify/387-sort-perf.mjs [BASE] --browser=chromium|webkit --sync=local|github|hub --out=tmp/verify-shots/387
//   chromium は CDP で CPU x4。webkit は CPU 制限の手段が無い＝素の速さ (結果に明記する)。
//   同期先の偽物: adapter に beginBatch/addBatchEntry/commitBatch を生やし、commitBatch に固定遅延を入れる
//   (github=600ms・hub=300ms。実ネットワークではない＝I/O 待ちの間にメインスレッドが詰まるかを見るためのもの)。
//   ドラッグは pointer 合成ではなく、ドロップ確定時に呼ばれる reorderBooks(dragged, target) を直接呼ぶ (処理の中身は同じ)。
import { chromium, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BROWSER = arg('browser', 'chromium');
const SYNC = arg('sync', 'local');
const OUT = arg('out', 'tmp/verify-shots/387');
const N = parseInt(arg('n', '800'), 10);
const REPS = parseInt(arg('reps', '5'), 10);
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';
mkdirSync(OUT, { recursive: true });

const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
const books = Array.from({ length: N }, (_, i) => {
    const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
    return { asin, title: `計測用の本 ${(n * 7919) % N} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 37}`, acquiredTime: 1700000000000 + ((n * 104729) % N) * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
});
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
userData.notes = {};
userData.settings = { ...(userData.settings || {}), sortOrder: 'acquiredTime', sortDirection: 'desc' };
const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
const userDataStr = JSON.stringify(userData);

const bt = BROWSER === 'webkit' ? webkit : chromium;
const browser = await bt.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: BROWSER === 'chromium', serviceWorkers: 'block' });
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && errors.length < 20) errors.push('console: ' + m.text().slice(0, 300)); });
await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [userDataStr, libraryStr]);
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
await page.waitForTimeout(800);
// --noanim=1: 原因切り分け用。本カードの登場アニメ (fadeInUp 0.6s) を止めて同じ操作を測る
if (arg('noanim', '')) await page.addStyleTag({ content: '.book-item{animation:none !important}' });

// 計装: 主要関数を包んで所要時間を積算。DOM 挿入回数も数える
await page.evaluate((sync) => {
    const bs = window.bookshelf;
    const T = window.__t = { acc: {}, cnt: {}, ins: 0, syncDone: 0, commitBytes: 0 };
    const wrap = (obj, name, label) => {
        const orig = obj[name]; if (typeof orig !== 'function') return;
        obj[name] = function (...a) {
            const t0 = performance.now();
            const r = orig.apply(this, a);
            const add = () => { T.acc[label] = (T.acc[label] || 0) + (performance.now() - t0); T.cnt[label] = (T.cnt[label] || 0) + 1; };
            if (r && typeof r.then === 'function') return r.finally(add);
            add(); return r;
        };
    };
    // 同期 (sync) 部分だけを測るための包み: async 関数は await 前までの同期部分を別に記録
    const wrapSyncPart = (obj, name, label) => {
        const orig = obj[name]; if (typeof orig !== 'function') return;
        obj[name] = function (...a) {
            const t0 = performance.now();
            const r = orig.apply(this, a);
            T.acc[label] = (T.acc[label] || 0) + (performance.now() - t0);
            return r;
        };
    };
    const insB = Node.prototype.insertBefore, app = Node.prototype.appendChild;
    Node.prototype.insertBefore = function (...a) { if (this.id === 'bookshelf') T.ins++; return insB.apply(this, a); };
    Node.prototype.appendChild = function (...a) { if (this.id === 'bookshelf') T.ins++; return app.apply(this, a); };
    const st = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { const t0 = performance.now(); const r = st.call(this, k, v); if (k === 'virtualBookshelf_userData') { T.acc['localStorage.setItem(userData)'] = (T.acc['localStorage.setItem(userData)'] || 0) + (performance.now() - t0); T.lsBytes = String(v).length; } return r; };
    const js = JSON.stringify;
    // saveUserData 内の stringify は setItem の引数作成で走る＝saveUserData 全体 − setItem で近似する
    wrap(bs, 'applySorting', 'applySorting(全体)');
    wrap(bs, 'updateDisplay', 'updateDisplay');
    wrap(bs, 'updateStats', 'updateStats');
    wrap(bs, 'saveUserData', 'saveUserData');
    wrap(bs, 'reorderBooks', 'reorderBooks(全体)');
    wrap(bs, '_moveBookElement', '_moveBookElement');
    if (sync !== 'local') {
        const delay = sync === 'github' ? 600 : 300;
        const a = bs.storage.adapter; let batch = [];
        a.beginBatch = () => { batch = []; };
        a.addBatchEntry = (p, c) => { batch.push([p, c]); };
        a.addBatchDelete = (p) => { batch.push([p, null]); };
        a.discardBatch = () => { batch = []; };
        a.commitBatch = async () => { T.commitBytes = batch.reduce((s, [, c]) => s + (c ? c.length : 0), 0); T.commitFiles = batch.length; await new Promise((r) => setTimeout(r, delay)); return {}; };
        a.fileExists = async () => true; bs.storage.detectFormat = async () => 'new';
        a.readJSON = async () => null; a.writeJSON = async () => {}; a.writeText = async () => {};
        bs.syncMethod = sync; bs._isSyncReady = () => true; bs._ensureFreshGitHubToken = async () => true; bs.obsidianDirHandle = null;
        wrapSyncPart(bs, 'syncToObsidianFolder', 'syncToObsidianFolder(同期部分)');
        wrap(bs, 'syncToObsidianFolder', 'syncToObsidianFolder(全体・I/O込み)');
        wrap(bs.storage, 'syncBatch', 'storage.syncBatch(全体)');
        const rp = bs._runPendingSync;
        bs._runPendingSync = async function (...x) { try { return await rp.apply(this, x); } finally { T.syncDone++; } };
    }
    // ロングタスク (chromium のみ)
    T.long = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
}, SYNC);

if (BROWSER === 'chromium') {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

// 1操作: 同期部分 (イベント処理) と次フレームまで (=画面が変わるまで) を測り、その後 debounce+同期の完了を待つ
async function op(kind, i) {
    await page.evaluate(() => { const T = window.__t; T.acc = {}; T.cnt = {}; T.ins = 0; T.long = []; T.syncDone = 0; });
    const r = await page.evaluate(async ({ kind, i }) => {
        const bs = window.bookshelf; const t0 = performance.now();
        if (kind === 'order') {
            const sel = document.getElementById('sort-order');
            const opts = ['title', 'authors', 'acquiredTime', 'custom'];
            sel.value = opts[i % opts.length];
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (kind === 'direction') {
            document.getElementById('sort-direction').click();
        } else if (kind === 'drag') {
            const items = Array.from(document.querySelectorAll('#bookshelf > .book-item[data-asin]'));
            bs.reorderBooks(items[0].dataset.asin, items[Math.min(items.length - 1, 5 + i)].dataset.asin);
        }
        const tSync = performance.now() - t0;
        await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
        const tFrame = performance.now() - t0;
        return { tSync, tFrame };
    }, { kind, i });
    // debounce(800ms)+偽I/O を待つ (最大4秒)
    if (SYNC !== 'local') await page.waitForFunction(() => window.__t.syncDone > 0 && !window.bookshelf._syncInProgress, null, { timeout: 4000 }).catch(() => {});
    else await page.waitForTimeout(900);
    await page.waitForTimeout(150);
    const t = await page.evaluate(() => JSON.parse(JSON.stringify(window.__t)));
    return { kind, i, ...r, acc: t.acc, cnt: t.cnt, ins: t.ins, longMax: t.long.length ? Math.max(...t.long) : null, longSum: t.long.reduce((s, x) => s + x, 0), lsBytes: t.lsBytes, commitBytes: t.commitBytes, commitFiles: t.commitFiles };
}

// --profile: 並び替えの種類変更1回を CDP Profiler で撮り、自己時間の上位を出す (chromium のみ)
if (arg('profile', '') && BROWSER === 'chromium') {
    const cdp2 = await ctx.newCDPSession(page);
    await cdp2.send('Profiler.enable'); await cdp2.send('Profiler.setSamplingInterval', { interval: 200 });
    await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'acquiredTime'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(2500);
    await cdp2.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
    await cdp2.send('Profiler.start');
    await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'title'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(1500);
    const { profile } = await cdp2.send('Profiler.stop');
    const done = new Promise((res) => cdp2.once('Tracing.tracingComplete', res));
    await cdp2.send('Tracing.end'); const { stream } = await done;
    let buf = ''; for (;;) { const r = await cdp2.send('IO.read', { handle: stream }); buf += r.data; if (r.eof) break; }
    const evs = JSON.parse(buf).traceEvents || JSON.parse(buf);
    const tl = {}; for (const e of evs) { if (e.ph === 'X' && e.dur && ['UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize', 'FunctionCall', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'Commit', 'ParseHTML', 'Decode Image', 'IntersectionObserverController::computeIntersections', 'RunTask'].includes(e.name)) { tl[e.name] = tl[e.name] || { ms: 0, n: 0, max: 0 }; tl[e.name].ms += e.dur / 1000; tl[e.name].n++; tl[e.name].max = Math.max(tl[e.name].max, e.dur / 1000); } }
    // 長いタスク (>=30ms) ごとに、中で一番時間を使った子イベント名を出す
    const xs = evs.filter((e) => e.ph === 'X' && e.dur);
    const longT = xs.filter((e) => e.name === 'RunTask' && e.dur >= 30000).map((t) => {
        const kids = {}; for (const e of xs) { if (e !== t && e.tid === t.tid && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.name !== 'RunTask') { kids[e.name] = (kids[e.name] || 0) + e.dur / 1000; } }
        return { ms: Math.round(t.dur / 1000), at: Math.round((t.ts - xs[0].ts) / 1000), top: Object.entries(kids).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${Math.round(v)}`) };
    });
    tl.longTasks = longT;
    writeFileSync(`${OUT}/trace-order-${SYNC}.json`, JSON.stringify(tl, null, 1));
    console.log('TRACE:', JSON.stringify(tl));
    const dt = {}; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`; dt[k] = (dt[k] || 0) + (profile.timeDeltas[i] || 0) / 1000; }
    const top = Object.entries(dt).sort((a, b) => b[1] - a[1]).slice(0, 25);
    writeFileSync(`${OUT}/profile-order-${SYNC}.json`, JSON.stringify(top, null, 1));
    console.log('PROFILE top:', JSON.stringify(top, null, 1));
    await browser.close(); process.exit(0);
}

// 準備: custom 以外から始める
await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'acquiredTime'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(2500);
const rows = [];
for (let i = 0; i < REPS; i++) rows.push(await op('order', i));
for (let i = 0; i < REPS; i++) rows.push(await op('direction', i));
await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(2500);
for (let i = 0; i < REPS; i++) rows.push(await op('drag', i));

const med = (xs) => { const a = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
const summary = {};
for (const kind of ['order', 'direction', 'drag']) {
    const rs = rows.filter((r) => r.kind === kind);
    const keys = new Set(rs.flatMap((r) => Object.keys(r.acc)));
    const s = { tSync: med(rs.map((r) => r.tSync)), tFrame: med(rs.map((r) => r.tFrame)), ins: med(rs.map((r) => r.ins)), longMax: med(rs.map((r) => r.longMax)), longSum: med(rs.map((r) => r.longSum)) };
    for (const k of keys) s[k] = med(rs.map((r) => r.acc[k] || 0));
    summary[kind] = s;
}
const meta = { browser: BROWSER, cpu: BROWSER === 'chromium' ? 'x4' : 'none', sync: SYNC, n: N, reps: REPS, lsBytes: rows.at(-1).lsBytes, commitBytes: rows.at(-1).commitBytes, commitFiles: rows.at(-1).commitFiles, errors };
writeFileSync(`${OUT}/perf-${BROWSER}-${SYNC}${arg('noanim', '') ? '-noanim' : ''}.json`, JSON.stringify({ meta, summary, rows }, null, 2));
console.log(JSON.stringify({ meta, summary }, null, 1));
await browser.close();
