// #401: 397-sort-perf.mjs の複製に4つ目の操作 reimport (再取込=既存913冊のうち約1割のステータスが変わった取込結果を importSelectedBooks で反映) を足したもの。
// イシュー#397 step1: iPhone実機の「並び替えが遅い・固まる」を、本番と同じ版(HEAD)・
// ハヘロの実データを種にした913冊・WebKit/chromium低速条件で再現し、内訳つきで測る。
// 387-sort-perf.mjs(800冊・合成データ)の構造を流用し、次を追加する:
//   - データ: tmp/397/userdata.json・library.json (実データ=bookshelf-dataを種に913冊へpadding。tmp/のみ・commitしない)
//   - 表紙: 実データのproductImage(m.media-amazon.com)はそのまま使い、ctx.routeで実物サイズのJPEG(tmp/397/covers/*.jpg、
//     実際にAmazonから取得した11枚・16-60KB)をcross-origin(app=localhost:8000, 表紙=m.media-amazon.com)で返す。
//     これはsw.jsのCOVER_HOSTS判定に一致する実ホスト名なので、本物同様にSWのcache-first経路(cache.put含む)が走る。
//     実ネットワークへは出ない(ルーティングで横取り)。
//   - SW: --sw=on で実際にsw.jsを登録(cache.putを含む実経路)・--sw=offでblock(切り分け用)。
//   - 固まる指標: 操作直後からpointerdown合成イベントを16ms間隔でスケジュールし、ハンドラ発火までの
//     実際の遅延(スケジュール時刻との差)の最大値を「入力を受け付けない時間」として記録する。
//   - 内訳: applySorting/updateDisplay/_renderListDiff(_bookCardKey合計・moved数)/LazyLoader.observe呼び出し数・
//     表紙route命中数(cache.put相当)/_showSavedNote/saveUserDataのlocalStorage書き込みバイト数。
// 使い方: node scripts/verify/397-sort-perf.mjs [BASE] --browser=chromium|webkit --cpu=4|6 --sw=on|off --n=913 --reps=5 --out=tmp/397
import { chromium, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BROWSER = arg('browser', 'chromium');
const CPU = arg('cpu', '4'); // chromiumのみ有効。webkitはCPU制限の手段が無い(素の速さ)
const SW = arg('sw', 'on');
const OUT = arg('out', 'tmp/397');
const N = parseInt(arg('n', '913'), 10);
const REPS = parseInt(arg('reps', '5'), 10);
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';
mkdirSync(OUT, { recursive: true });

const userDataStr = readFileSync(`${OUT}/userdata.json`, 'utf-8');
const libraryStr = readFileSync(`${OUT}/library.json`, 'utf-8');
const coverFiles = readdirSync(`${OUT}/covers`).filter((f) => f.endsWith('.jpg')).map((f) => readFileSync(`${OUT}/covers/${f}`));
console.log(`real-seed data: n=${N} covers=${coverFiles.length} files (${Math.min(...coverFiles.map(b=>b.length))}-${Math.max(...coverFiles.map(b=>b.length))} bytes)`);

const bt = BROWSER === 'webkit' ? webkit : chromium;
const browser = await bt.launch();
const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: BROWSER === 'chromium',
    serviceWorkers: SW === 'on' ? 'allow' : 'block',
});
let coverHits = 0;
await ctx.route('https://m.media-amazon.com/**', (r) => { coverHits++; r.fulfill({ status: 200, contentType: 'image/jpeg', body: coverFiles[coverHits % coverFiles.length] }); });
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
if (SW === 'on') {
    await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.register('./sw.js').catch(() => {}));
    await page.waitForTimeout(1200); // SW活性化を待つ (本番同様、初回ロード後に効き始める)
}
const PREWAIT = parseInt(arg('prewait', '1000'), 10); // 小さくすると「初期表紙先読み/SWが片付く前」に操作が重なる状態を再現できる
await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
await page.waitForTimeout(PREWAIT);

// 計装
await page.evaluate(() => {
    const bs = window.bookshelf;
    const T = window.__t = { acc: {}, cnt: {}, ins: 0, moved: 0, lazyObserve: 0 };
    const wrap = (obj, name, label) => {
        const orig = obj[name]; if (typeof orig !== 'function') return;
        obj[name] = function (...a) {
            const t0 = performance.now();
            const r = orig.apply(this, a);
            T.acc[label] = (T.acc[label] || 0) + (performance.now() - t0);
            T.cnt[label] = (T.cnt[label] || 0) + 1;
            return r;
        };
    };
    wrap(bs, 'applySorting', 'applySorting(全体)');
    wrap(bs, 'updateDisplay', 'updateDisplay');
    wrap(bs, 'updateStats', 'updateStats');
    wrap(bs, 'saveUserData', 'saveUserData');
    wrap(bs, 'reorderBooks', 'reorderBooks(全体)');
    wrap(bs, '_renderListDiff', '_renderListDiff');
    wrap(bs, '_bookCardKey', '_bookCardKey(合計)');
    wrap(bs, '_showSavedNote', '_showSavedNote');
    if (window.lazyLoader) wrap(window.lazyLoader, 'observe', 'LazyLoader.observe');
    const insB = Node.prototype.insertBefore, app = Node.prototype.appendChild;
    Node.prototype.insertBefore = function (...a) { if (this.id === 'bookshelf') { T.ins++; T.moved++; } return insB.apply(this, a); };
    Node.prototype.appendChild = function (...a) { if (this.id === 'bookshelf') T.ins++; return app.apply(this, a); };
    const st = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { const t0 = performance.now(); const r = st.call(this, k, v); if (k === 'virtualBookshelf_userData') { T.acc['localStorage.setItem(userData)'] = (T.acc['localStorage.setItem(userData)'] || 0) + (performance.now() - t0); T.lsBytes = String(v).length; } return r; };
    // ロングタスク (50ms超。仕様どおりchromiumのみ有効)
    T.long = [];
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => T.long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    // 「固まる」= 操作直後からpointerdownを16ms間隔でスケジュールし、ハンドラ発火までの実遅延の最大値
    const probe = document.createElement('div'); probe.id = '__inputProbe'; probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'; document.body.appendChild(probe);
    T.inputDelays = [];
    probe.addEventListener('pointerdown', (e) => { if (e.__sched != null) T.inputDelays.push(Math.max(0, performance.now() - e.__sched)); });
    T._inputTimer = null;
});

if (BROWSER === 'chromium') {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: parseInt(CPU, 10) });
}

function startInputProbe(page) {
    return page.evaluate(() => {
        const T = window.__t; T.inputDelays = [];
        const probe = document.getElementById('__inputProbe');
        let n = 0; const t0 = performance.now();
        const tick = () => {
            if (n++ > 40) return; // 最大640ms分、十分にopの固まりをカバー
            const sched = t0 + n * 16;
            const ev = new PointerEvent('pointerdown', { bubbles: true }); ev.__sched = sched;
            probe.dispatchEvent(ev);
            const delay = Math.max(0, sched - performance.now());
            setTimeout(tick, delay);
        };
        tick();
    });
}

async function op(kind, i) {
    await page.evaluate(() => { const T = window.__t; T.acc = {}; T.cnt = {}; T.ins = 0; T.moved = 0; T.long = []; });
    await startInputProbe(page);
    const t0Hits = coverHits;
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
        } else if (kind === 'reimport') {
            // 再取込: 取込画面で「取り込む」を押した時と同じ関数。既存の本はステータス更新として扱われる
            bs.pendingImportBooks = bs.books.map((b, k) => ({ ...b, readStatus: (k % 10 === i % 10) ? (b.readStatus === 'READ' ? 'UNKNOWN' : 'READ') : b.readStatus }));
            bs.importSource = 'file';
            await bs.importSelectedBooks();
        }
        const tSync = performance.now() - t0;
        // 入力から画面が変わるまで = rAF×2 (レイアウト確定後の次ペイント相当)
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const tFrame = performance.now() - t0;
        return { tSync, tFrame };
    }, { kind, i });
    await page.waitForTimeout(900); // debounce + 先読み/SWの非同期後片付けを待つ
    const t = await page.evaluate(() => JSON.parse(JSON.stringify(window.__t)));
    const coverHitsDuringOp = coverHits - t0Hits;
    return {
        kind, i, ...r, acc: t.acc, cnt: t.cnt, ins: t.ins, moved: t.moved,
        longMax: t.long.length ? Math.max(...t.long) : 0, longSum: t.long.reduce((s, x) => s + x, 0), longN: t.long.length,
        maxInputDelay: t.inputDelays.length ? Math.max(...t.inputDelays) : 0,
        lazyObserveCalls: t.cnt['LazyLoader.observe'] || 0,
        coverHitsDuringOp, lsBytes: t.lsBytes,
    };
}

// 準備: custom以外から始める
await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'acquiredTime'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(2000);
const rows = [];
for (let i = 0; i < REPS; i++) rows.push(await op('order', i));
for (let i = 0; i < REPS; i++) rows.push(await op('direction', i));
await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(2000);
for (let i = 0; i < REPS; i++) rows.push(await op('drag', i));
for (let i = 0; i < REPS; i++) { rows.push(await op('reimport', i)); await page.evaluate(() => { const m = document.querySelector('.modal.show, #import-results'); document.querySelectorAll('.modal.show').forEach((el) => el.classList.remove('show')); }); }

const med = (xs) => { const a = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
const max = (xs) => { const a = xs.filter((x) => typeof x === 'number'); return a.length ? Math.max(...a) : null; };
const summary = {};
for (const kind of ['order', 'direction', 'drag', 'reimport']) {
    const rs = rows.filter((r) => r.kind === kind);
    const keys = new Set(rs.flatMap((r) => Object.keys(r.acc)));
    const s = {
        tFrame_med: med(rs.map((r) => r.tFrame)), tFrame_max: max(rs.map((r) => r.tFrame)),
        maxInputDelay_med: med(rs.map((r) => r.maxInputDelay)), maxInputDelay_max: max(rs.map((r) => r.maxInputDelay)),
        longN_med: med(rs.map((r) => r.longN)), longSum_med: med(rs.map((r) => r.longSum)), longMax_med: med(rs.map((r) => r.longMax)),
        ins_med: med(rs.map((r) => r.ins)), moved_med: med(rs.map((r) => r.moved)),
        lazyObserveCalls_med: med(rs.map((r) => r.lazyObserveCalls)), coverHits_med: med(rs.map((r) => r.coverHitsDuringOp)),
    };
    for (const k of keys) s[`acc.${k}`] = med(rs.map((r) => r.acc[k] || 0));
    summary[kind] = s;
}
const meta = { browser: BROWSER, cpu: BROWSER === 'chromium' ? `x${CPU}` : 'none(素の速さ)', sw: SW, n: N, reps: REPS, lsBytes: rows.at(-1).lsBytes, errors };
const outFile = `${OUT}/perf-${BROWSER}-cpu${BROWSER === 'chromium' ? CPU : 'none'}-sw${SW}.json`;
writeFileSync(outFile, JSON.stringify({ meta, summary, rows }, null, 2));
console.log(JSON.stringify({ meta, summary }, null, 1));
await browser.close();
