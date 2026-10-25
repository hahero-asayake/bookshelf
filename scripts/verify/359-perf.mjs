// イシュー#359 step2: 画面操作の応答計測ハーネス (本800冊・chromium/webkit・CPUスロットリング併記)
// 実行例:
//   node scripts/verify/359-perf.mjs --browser=chromium --width=390  --cpu=4 --reps=5 --out=tmp/359/perf-c390x4.json
//   node scripts/verify/359-perf.mjs --browser=chromium --width=1280 --cpu=1 --reps=5 --out=tmp/359/perf-c1280.json
//   (webkit は projectNote の PLAYWRIGHT_BROWSERS_PATH+LD_LIBRARY_PATH の型で) --browser=webkit --width=390
// 既定URL localhost:8000・SW は block・?v= は起動時に出す。アプリのコードは変えない (計測はページ側に
// PerformanceObserver(longtask)・MutationObserver・CDP Performance/Profiler を外付けするだけ)。
// 値: 入力→次フレーム(rAF2回)までの ms ／ 直後600msの long task 件数と合計 ／ CDP LayoutCount・RecalcStyleCount の差分 ／
//     MutationObserver の追加・削除ノード数と #bookshelf 全消し(=一覧の全体作り直し)の有無 ／ CDP Profiler の self time 上位。
import { chromium, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BROWSER = arg('browser', 'chromium');
const WIDTH = parseInt(arg('width', '390'), 10);
const CPU = parseInt(arg('cpu', '1'), 10);
const REPS = parseInt(arg('reps', '5'), 10);
const OUT = arg('out', null);
const BOOKS = parseInt(arg('books', '800'), 10);
const SHADOW = arg('shadow', 'on'); // イシュー#365: NavState 影モード (E2E/webdriver では既定 ON)。off で localStorage.navShadow='0' を置き明示 OFF
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';
const SETTLE_MS = 600;
const MOBILE = WIDTH < 900;

// ===== データ: fixture の型で 800 冊を生成 (all=全件・fixshelf=先頭300件・評価/メモは一部) =====
const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
const books = Array.from({ length: BOOKS }, (_, i) => {
    const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
    return { asin, title: `計測用の本 ${n} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 37}`, acquiredTime: 1700000000000 + n * 1000, readStatus: n % 4 ? 'READ' : 'UNREAD', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
});
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
const sub = userData.bookshelves.find((s) => !s.isSpecial); sub.books = allShelf.books.slice(0, 300);
userData.notes = {}; books.forEach((b, i) => { if (i % 3 === 0) userData.notes[b.asin] = { rating: (i % 5) + 1, memo: i % 6 === 0 ? `メモ ${i}` : '' }; });
const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
const userDataStr = JSON.stringify(userData);

// ===== 起動 =====
const bt = BROWSER === 'webkit' ? webkit : chromium;
const browser = await bt.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: MOBILE ? 844 : 800 }, hasTouch: MOBILE, serviceWorkers: 'block' });
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(([u, l, shadow]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    if (shadow === 'off') localStorage.setItem('navShadow', '0');
}, [userDataStr, libraryStr, SHADOW]);
const tBoot = Date.now();
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
const bootMs = Date.now() - tBoot;
const version = await page.evaluate(() => (document.querySelector('script[src*="bookshelf.js"]') || {}).src || '');
await page.evaluate(() => {
    const bs = window.bookshelf; const mem = new Map(); window.__mem = mem;
    const a = bs.storage.adapter;
    a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
    a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
    a.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
    a.writeText = async (p, t) => { mem.set(p, t); };
    bs._isSyncReady = () => true;
    if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    // 計測カウンタ (アプリ非改変・外付け)
    const P = window.__perf = { lt: [], added: 0, removed: 0, shelfCleared: 0, shelfAdded: 0, ltUnsupported: false };
    try { new PerformanceObserver((list) => { for (const e of list.getEntries()) P.lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (_) { P.ltUnsupported = true; }
    const shelf = document.getElementById('bookshelf');
    new MutationObserver((muts) => { for (const m of muts) { P.added += m.addedNodes.length; P.removed += m.removedNodes.length; if (m.target === shelf) { P.shelfAdded += m.addedNodes.length; P.shelfCleared += m.removedNodes.length; } } }).observe(document.body, { childList: true, subtree: true });
    P.reset = () => { P.lt = []; P.added = 0; P.removed = 0; P.shelfCleared = 0; P.shelfAdded = 0; P.shadow0 = window.__navShadow ? window.__navShadow.costMs : null; };
    window.__measure = async (fn) => { const t0 = performance.now(); const r = fn(); if (r && r.then) await r; await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); return { tFrame: Math.round((performance.now() - t0) * 10) / 10 }; };
    window.__waitEvent = (type, ms) => new Promise((res) => { let done = false; const h = () => { if (done) return; done = true; window.removeEventListener(type, h); res(true); }; window.addEventListener(type, h); setTimeout(() => { if (!done) { done = true; window.removeEventListener(type, h); res(false); } }, ms); });
    // イシュー#365 段階③: UI 由来の遷移は pushState で URL を書く (hashchange が起きない) ため、hash の値そのものを待つ
    window.__waitHash = (pred, ms) => new Promise((res) => { const t0 = performance.now(); const tick = () => { if (pred(location.hash || '')) return res(true); if (performance.now() - t0 > ms) return res(false); requestAnimationFrame(tick); }; tick(); });
});

let cdp = null;
if (BROWSER === 'chromium') {
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
}
async function metrics() { if (!cdp) return null; const { metrics } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of metrics) o[m.name] = m.value; return o; }

const results = {}; const profiles = {};
function aggregateProfile(name, prof) {
    const map = profiles[name] || (profiles[name] = new Map());
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const { samples, timeDeltas } = prof;
    for (let i = 0; i < samples.length; i++) {
        const n = byId.get(samples[i]); if (!n) continue;
        const cf = n.callFrame; const fn = cf.functionName || '(anonymous)';
        if (['(root)', '(program)', '(idle)', '(garbage collector)'].includes(fn)) continue;
        const key = `${fn} ${(cf.url || '').split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
        map.set(key, (map.get(key) || 0) + (timeDeltas[i] || 0) / 1000);
    }
}
async function op(name, action, { settle = SETTLE_MS } = {}) {
    const m0 = await metrics();
    if (cdp) await cdp.send('Profiler.start');
    await page.evaluate(() => window.__perf.reset());
    let r;
    try { r = await action(); } catch (e) { r = { tFrame: null, na: String(e).slice(0, 120) }; }
    await page.waitForTimeout(settle);
    const prof = cdp ? (await cdp.send('Profiler.stop')).profile : null;
    const m1 = await metrics();
    const P = await page.evaluate(() => { const P = window.__perf; const S = window.__navShadow; return { lt: P.lt, added: P.added, removed: P.removed, shelfCleared: P.shelfCleared, shelfAdded: P.shelfAdded, ltUnsupported: P.ltUnsupported, shadowMs: (S && P.shadow0 != null) ? Math.round((S.costMs - P.shadow0) * 1000) / 1000 : null }; });
    const row = { ...r, shadowMs: P.shadowMs, ltCount: P.ltUnsupported ? null : P.lt.length, ltTotal: P.ltUnsupported ? null : Math.round(P.lt.reduce((s, e) => s + e.d, 0)), added: P.added, removed: P.removed, shelfCleared: P.shelfCleared, shelfAdded: P.shelfAdded,
        layout: m0 && m1 ? Math.round(m1.LayoutCount - m0.LayoutCount) : null, recalc: m0 && m1 ? Math.round(m1.RecalcStyleCount - m0.RecalcStyleCount) : null, script: m0 && m1 ? Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000) : null };
    (results[name] || (results[name] = [])).push(row);
    if (prof) aggregateProfile(name, prof);
    process.stderr.write(`  ${name}: tFrame=${row.tFrame} lt=${row.ltCount}/${row.ltTotal} layout=${row.layout} added=${row.added} shelfCleared=${row.shelfCleared}${row.na ? ' NA:' + row.na : ''}\n`);
    return row;
}

// ===== 操作 (ページ側で入力→次フレームを測る) =====
const A = {
    openShelf: () => page.evaluate(() => window.__measure(() => window.bookshelf.switchBookshelf('all'))),
    scroll: () => page.evaluate(() => window.__measure(() => { const sc = document.getElementById('view-bookshelf'); const el = (sc && sc.scrollHeight > sc.clientHeight) ? sc : document.scrollingElement; el.scrollTop += 3000; })),
    openDetail: (i) => page.evaluate((i) => window.__measure(() => { const card = document.querySelectorAll('#bookshelf .book-item')[i]; if (card) card.click(); if (!document.body.classList.contains('book-detail-pinned')) { window.__detailFallback = (window.__detailFallback || 0) + 1; window.bookshelf.showBookDetail(window.bookshelf.books[i]); } }), i),
    back: () => page.evaluate(() => window.__measure(async () => { const p = window.__waitEvent('hashchange', 3000); history.back(); await p; })),
    drawerOpen: () => page.evaluate((m) => window.__measure(() => m ? window.bookshelf._openDrawer() : window.bookshelf._togglePane('left')), MOBILE),
    drawerClose: () => page.evaluate((m) => window.__measure(() => m ? window.bookshelf._closeDrawer() : window.bookshelf._togglePane('left')), MOBILE),
    navHome: () => page.evaluate(() => window.__measure(async () => { const p = window.__waitHash((h) => h === '' || h === '#' || h === '#/', 3000); const b = document.querySelector('[data-mobile-nav="home"]'); if (b && b.offsetParent !== null) b.click(); else window.bookshelf.router.navigateMain(); await p; })),
    articleOpen: () => page.evaluate(() => window.__measure(async () => { await window.bookshelf.openPublishPagesModal(); window.bookshelf._artOpenEditor(null); })),
    articleClose: () => page.evaluate(() => window.__measure(() => window.bookshelf.closePublishPagesModal())),
    save: () => page.evaluate(() => window.__measure(() => window.bookshelf.saveUserData())),
    bulkRerender: () => page.evaluate(() => window.__measure(() => { const bs = window.bookshelf; bs.updateDisplay(); bs.updateStats(); bs.updateBookshelfSelector(); bs.renderBookshelfOverview(); })),
    // イシュー#359 段階①-d: initCloudSync (js/bookshelf.js L3101-3110) と同じ判定を「無変化」で通す。
    // 指紋 (_renderFingerprint) を前後で比べ、同じなら4関数を呼ばない = この行の値がガード自体の費用 (指紋2回分)。
    syncNoChange: () => page.evaluate(() => window.__measure(() => { const bs = window.bookshelf; const fpBefore = bs._renderFingerprint(); if (fpBefore !== bs._renderFingerprint()) { bs.updateDisplay(); bs.updateStats(); bs.updateBookshelfSelector(); bs.renderBookshelfOverview(); } })),
};
// 並べ替え: カスタム順にして先頭カードのつまみを4枚目へドラッグ。pointerup(capture)→rAF2回で「離してから描画まで」を測る
async function reorder() {
    const prev = await page.evaluate(() => { const bs = window.bookshelf; const p = bs.sortOrder; bs.sortOrder = 'custom'; bs.updateDisplay(); return p; });
    await page.waitForTimeout(300);
    const h = page.locator('#bookshelf .book-item .drag-handle').first();
    const target = page.locator('#bookshelf .book-item').nth(3);
    if (!(await h.count()) || !(await target.count())) return { tFrame: null, na: 'drag-handle無し' };
    const hb = await h.boundingBox(); const tb = await target.boundingBox();
    if (!hb || !tb) return { tFrame: null, na: 'boundingBox null(つまみ非表示)' };
    await page.evaluate(() => { window.__dropT = null; const h = () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { window.__dropT = performance.now() - t0; })); window.removeEventListener('pointerup', h, true); }; window.addEventListener('pointerup', h, true); });
    const sx = hb.x + hb.width / 2, sy = hb.y + hb.height / 2, ex = tb.x + tb.width / 2, ey = tb.y + tb.height / 2;
    const tStart = Date.now();
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(sx + (ex - sx) * s / 8, sy + (ey - sy) * s / 8);
    await page.mouse.up();
    const tDrag = Date.now() - tStart;
    await page.waitForTimeout(300);
    const tFrame = await page.evaluate(() => window.__dropT);
    await page.evaluate((p) => { window.bookshelf.sortOrder = p; }, prev);
    return { tFrame: tFrame == null ? null : Math.round(tFrame * 10) / 10, tDrag };
}

const shadowOn = await page.evaluate(() => !!(window.__navShadow && window.__navShadow.enabled));
process.stderr.write(`[359-perf] ${BROWSER} ${WIDTH}px cpu x${CPU} books=${BOOKS} reps=${REPS} shadow=${shadowOn ? 'ON' : 'OFF'} boot=${bootMs}ms version=${version}\n`);
for (let rep = 0; rep < REPS; rep++) {
    process.stderr.write(`-- rep ${rep + 1}/${REPS}\n`);
    await op('本棚(all・800冊)を開く', A.openShelf);
    await page.waitForTimeout(200);
    await op('一覧スクロール(+3000px)', A.scroll);
    await page.evaluate(() => { const sc = document.getElementById('view-bookshelf'); if (sc) sc.scrollTop = 0; document.scrollingElement.scrollTop = 0; });
    await op('本詳細を開く', () => A.openDetail(5 + rep));
    await op('戻る(本詳細→本棚)', A.back);
    await op(MOBILE ? 'ドロワーを開く' : '左ペイン折り畳み', A.drawerOpen);
    await op(MOBILE ? 'ドロワーを閉じる' : '左ペイン展開', A.drawerClose);
    await op('並べ替え(ドラッグ1回・離してから描画まで)', reorder);
    await op('保存(saveUserData・同期部分)', A.save);
    await op('同期完了時の一括再描画(initCloudSync相当4関数)', A.bulkRerender);
    await op('同期完了(無変化・①-d: 指紋一致なら再描画しない)', A.syncNoChange);
    await op('下部ナビ「ホーム」(本棚→ホーム)', A.navHome);
    await op('記事エディタを開く(一覧→新規)', A.articleOpen);
    await op('記事エディタを閉じる', A.articleClose);
    await page.waitForTimeout(300);
}
const detailFallback = await page.evaluate(() => window.__detailFallback || 0);

// ===== 集計 =====
const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const max = (a) => { const v = a.filter((x) => x != null); return v.length ? Math.max(...v) : null; };
const summary = Object.entries(results).map(([name, rows]) => ({
    name,
    tFrameMed: med(rows.map((r) => r.tFrame)), tFrameMax: max(rows.map((r) => r.tFrame)),
    shadowMs: med(rows.map((r) => r.shadowMs)), shadowMsMax: max(rows.map((r) => r.shadowMs)),
    ltCount: med(rows.map((r) => r.ltCount)), ltTotal: med(rows.map((r) => r.ltTotal)),
    layout: med(rows.map((r) => r.layout)), recalc: med(rows.map((r) => r.recalc)), script: med(rows.map((r) => r.script)),
    added: med(rows.map((r) => r.added)), removed: med(rows.map((r) => r.removed)),
    shelfRebuilt: rows.filter((r) => r.shelfCleared > 0).length, shelfAdded: med(rows.map((r) => r.shelfAdded)),
    na: rows.find((r) => r.na)?.na || null,
    top: profiles[name] ? [...profiles[name].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(0)}ms`) : [],
})).sort((a, b) => (b.tFrameMed ?? -1) - (a.tFrameMed ?? -1));

const cond = `${BROWSER} ${WIDTH}px CPU x${CPU} navShadow=${shadowOn ? 'ON' : 'OFF'}`;
const lines = [];
lines.push(`### ${cond} — books=${BOOKS} reps=${REPS} boot=${bootMs}ms`);
lines.push(`?v= ${version.split('?')[1] || '(不明)'}／本詳細のカードclick不発→showBookDetail直呼び fallback: ${detailFallback}回／pageerror: ${errors.length}`);
lines.push('');
lines.push('| 操作 | 入力→次フレーム 中央値ms | 最大ms | 影の費用ms 中央値/最大 | long task 件/合計ms | Layout/Recalc 回 | 追加/削除ノード | 一覧全消し(回/5) | 原因関数 top3 (self ms・5回合計) |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|');
for (const s of summary) {
    lines.push(`| ${s.name}${s.na ? ` (N/A: ${s.na})` : ''} | ${s.tFrameMed ?? '-'} | ${s.tFrameMax ?? '-'} | ${s.shadowMs ?? '-'}/${s.shadowMsMax ?? '-'} | ${s.ltCount ?? '-'}/${s.ltTotal ?? '-'} | ${s.layout ?? '-'}/${s.recalc ?? '-'} | ${s.added ?? '-'}/${s.removed ?? '-'} | ${s.shelfRebuilt}${s.shelfAdded ? `(+${s.shelfAdded})` : ''} | ${s.top.slice(0, 3).join('<br>') || '-'} |`);
}
const md = lines.join('\n');
console.log(md);
if (errors.length) console.log('\npageerror:\n' + errors.slice(0, 5).join('\n'));
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ cond, version, bootMs, detailFallback, errors, summary, results, profilesTop: Object.fromEntries(Object.entries(profiles).map(([k, m]) => [k, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)])) }, null, 1)); writeFileSync(OUT.replace(/\.json$/, '.md'), md + '\n'); }
await browser.close();
