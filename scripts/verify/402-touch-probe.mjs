// イシュー#402 step1: タッチスクロール(コンポジタ駆動)の追従プローブ。402-h27-recheck.mjs の複製で計測部だけ差し替え(chromium専用)。
// イシュー#402 step1: H2-7(JS仮想化撤去→content-visibility)の理由の再計測。389-scroll-perf.mjs の複製に
//   --mode=cv(現行・全件DOM+content-visibility:auto) / --mode=window(ページ側で外付けする最小の行窓仮想化の試作)
//   と p95フレーム時間・白抜け(ビューポート内にカードが無い=窓の描き遅れ)を足した。アプリ本体は変えない。
//   例: node scripts/verify/402-h27-recheck.mjs --mode=window --browser=chromium --cpu=4 --books=3000 --reps=2 --out=tmp/402/c4-w-3000.json
// 以下は元の389の説明 ↓
// イシュー#389 step2: 本棚スクロールの重さ計測ハーネス (本800冊・表紙ビュー・修正前の基準値)。
// アプリのコードは変えない (計測はページ側に rAF ループを外付けするだけ。359-perf.mjs/387-sort-perf.mjsの型を流用)。
// 実行例:
//   node scripts/verify/389-scroll-perf.mjs --browser=chromium --width=390 --cpu=4 --size=medium --reps=3 --out=tmp/389/c-medium.json
//   node scripts/verify/389-scroll-perf.mjs --browser=webkit   --width=390          --size=small  --reps=3 --out=tmp/389/w-small.json
//
// 測る値 (ページ内 rAF ループで1フレームごとサンプリング):
//   ① 長いフレーム数: rAF間隔>50msの件数・合計ms (chromium/webkitとも同じ方式で測る=条件間比較できる値)。
//      chromiumはPerformanceObserver(longtask)・支援環境ならlong-animation-frameも追加で記録するが、
//      本集計の主値はrAF間隔方式(ブラウザ間で取れる手段が揃っているのはこれだけのため)。
//   ② 画像デコード(近似): LazyLoaderの.lazy除去(data-src→src設定)からimg.complete(かつnaturalWidth>0)に
//      なるまでの時間を「viewport内で最初に空きとして観測された時刻→complete」で近似する。
//      CDPのPerformance trace「Decode Image」イベント名そのものではない(時間の都合でこの近似に留めた。
//      ②へ要否を確認する=389-results.mdの注記参照)。
//   ③ 空の枠: 各フレームでビューポートに交差しているbook-cover-containerのimgのうち、
//      class="lazy"(src未設定)または!img.complete の枚数を積算する。
//      「空き枠×フレーム数」の累積と、「空きが1枚以上見える秒数」の両方を出す。
// 画像はローカルのrouteで固定遅延(既定80ms)付きのダミー画像を返す(ネットワークのぶれを除く)。
import { chromium, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BROWSER = arg('browser', 'chromium');
const WIDTH = parseInt(arg('width', '390'), 10);
const CPU = parseInt(arg('cpu', '1'), 10);
const SIZE = arg('size', 'medium'); // small(3列)/medium(2列) ・ view-covers固定
const REPS = parseInt(arg('reps', '3'), 10);
const OUT = arg('out', null);
const BOOKS = parseInt(arg('books', '800'), 10);
const DURATION_MS = parseInt(arg('duration', '10000'), 10);
const SPEED_PX_S = parseInt(arg('speed', '1200'), 10);
const IMG_DELAY_MS = parseInt(arg('imgdelay', '80'), 10);
const MODE = arg('mode', 'cv');
const OVERSCAN = parseInt(arg('overscan', '3'), 10);
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';

// 160x240の単色ダミー表紙PNG。1x1等の極小画像は _setupCoverFallback (js/bookshelf.js:1599-1601)
// が「naturalWidth<=1 → 画像なしASIN」と判定してplaceholder divへ即時差し替えてしまうため、
// 実寸に近いサイズにして実際のimg読み込み経路(lazy解除→デコード→complete)を計測対象にする。
const DUMMY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAADwCAIAAAAII/iNAAACPElEQVR4nO3RQQkAMAzAwPrX0/e0TcUYhIMTEMjsHsLmewFPGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncNwFOJ5W30KHEhcAAAAASUVORK5CYII=', 'base64');

// ===== fixture: 800冊 (productImageは空文字→getProductImageUrlが images-na.ssl-images-amazon.com に組み立てる) =====
const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
const books = Array.from({ length: BOOKS }, (_, i) => {
    const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
    return { asin, title: `計測用の本 ${n} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 37}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
});
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
userData.notes = {};
userData.settings = { ...(userData.settings || {}), coverSize: SIZE, defaultView: 'covers' };
const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
const userDataStr = JSON.stringify(userData);

const bt = BROWSER === 'webkit' ? webkit : chromium;
const browser = await bt.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
// 表紙画像: 固定遅延つきダミー (ネットワークのぶれを除く)
await ctx.route('https://images-na.ssl-images-amazon.com/images/P/**', async (r) => {
    await new Promise((res) => setTimeout(res, IMG_DELAY_MS));
    await r.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG });
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [userDataStr, libraryStr]);

// rep間で画像がブラウザキャッシュ/読込済み状態のまま残ると2回目以降「空き0・デコード0」に
// 退化する(一度読み終えたimgはscrollTop=0に戻しても再度読み込まれない=lazy解除も再発生しない)。
// 各repの直前に毎回フルリロードし、「初めてこの本棚をスクロールする」状態を作り直す。
async function setupFreshPage() {
    const t0 = Date.now();
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
    const ms = Date.now() - t0;
    const ver = await page.evaluate(() => (document.querySelector('script[src*="bookshelf.js"]') || {}).src || '');
    await page.evaluate(() => {
        const bs = window.bookshelf; const mem = new Map();
        const a = bs.storage.adapter;
        a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        bs._isSyncReady = () => true;
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
    await page.evaluate(([size]) => { window.bookshelf.setCoverSize(size); window.bookshelf.setView('covers'); window.bookshelf.switchBookshelf('all'); }, [SIZE]);
    await page.waitForTimeout(300);
    if (MODE === 'window') await installWindow();
    return { bootMs: ms, version: ver };
}
// 最小の行窓仮想化(試作): 描画済みの .book-item を DOM から外して配列に持ち、
// スクロール位置から「見える行±OVERSCAN行」だけを差し戻す。上下の高さは container の padding で確保。
// 窓内のカードは content-visibility を visible にする(窓そのものの費用を測るため)。
async function installWindow() {
    const info = await page.evaluate((overscan) => {
        const c = document.getElementById('bookshelf');
        const sc = document.getElementById('view-bookshelf');
        const items = [...c.querySelectorAll(':scope > .book-item')];
        items.forEach((e) => { e.style.contentVisibility = 'visible'; });
        const top0 = items[0].offsetTop; let cols = 0;
        while (cols < items.length && items[cols].offsetTop === top0) cols++;
        const rowH = items[cols] ? items[cols].offsetTop - top0 : items[0].offsetHeight;
        const totalRows = Math.ceil(items.length / cols);
        const cTop = c.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
        const basePadTop = parseFloat(getComputedStyle(c).paddingTop) || 0;
        const basePadBottom = parseFloat(getComputedStyle(c).paddingBottom) || 0;
        let cur = [-1, -1];
        let updates = 0; let updateMs = 0;
        function update() {
            const t = performance.now();
            const y = sc.scrollTop - cTop - basePadTop;
            const r0 = Math.max(0, Math.floor(y / rowH) - overscan);
            const r1 = Math.min(totalRows, Math.ceil((y + sc.clientHeight) / rowH) + overscan);
            if (r0 === cur[0] && r1 === cur[1]) return;
            cur = [r0, r1];
            c.style.paddingTop = (basePadTop + r0 * rowH) + 'px';
            c.style.paddingBottom = (basePadBottom + (totalRows - r1) * rowH) + 'px';
            c.replaceChildren(...items.slice(r0 * cols, r1 * cols));
            updates++; updateMs += performance.now() - t;
        }
        sc.addEventListener('scroll', update, { passive: true });
        update();
        window.__win = { stats: () => ({ updates, updateMs: Math.round(updateMs) }), reset: () => { updates = 0; updateMs = 0; } };
        return { cols, rowH, totalRows, items: items.length, domAfter: c.children.length };
    }, OVERSCAN);
    process.stderr.write(`  window installed: ${JSON.stringify(info)}\n`);
}
const first = await setupFreshPage();
if (process.env.PROBE) { console.log('PROBE', JSON.stringify(await page.evaluate(() => { const sc = document.getElementById('view-bookshelf'); const c = document.getElementById('bookshelf'); const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { sh: sc.scrollHeight, ch: sc.clientHeight, scDisp: getComputedStyle(sc).display, cRect: c.getBoundingClientRect().toJSON(), hit: el && (el.tagName + '.' + el.className + '#' + el.id), hash: location.hash, firstItem: c.firstElementChild && c.firstElementChild.className }; }))); }
const bootMs = first.bootMs; const version = first.version;

let cdp = null;
if (BROWSER === 'chromium') {
    cdp = await ctx.newCDPSession(page);
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
}

// ===== 1回のスクロール計測をページ内で実行 (rAFループ・外付け計装のみ) =====
async function scrollOnce() {
    return page.evaluate(({ durationMs, speedPxS }) => new Promise((resolve) => {
        const sc = document.getElementById('view-bookshelf');
        sc.scrollTop = 0;
        const maxScroll = sc.scrollHeight - sc.clientHeight;
        let longtaskSupported = true;
        const longtasks = [];
        try {
            new PerformanceObserver((list) => { for (const e of list.getEntries()) longtasks.push(e.duration); }).observe({ type: 'longtask', buffered: false });
        } catch (_) { longtaskSupported = false; }
        let lafSupported = true;
        const lafs = [];
        try {
            new PerformanceObserver((list) => { for (const e of list.getEntries()) lafs.push(e.duration); }).observe({ type: 'long-animation-frame', buffered: false });
        } catch (_) { lafSupported = false; }

        const t0 = performance.now();
        let last = t0;
        let frames = 0;
        let longFrameCount = 0;
        let longFrameTotalMs = 0;
        let emptyFrameSum = 0; // Σ(空き枚数) 全フレーム
        let emptySecondsAccum = 0; // 空きが1枚以上見えたフレームのΣdt(ms)
        const firstSeenEmpty = new Map(); // img要素 -> 最初に空きとして観測した時刻
        let decodeCount = 0;
        let decodeTotalMs = 0;
        const doneImgs = new WeakSet();
        const dts = []; let blankPoints = 0;
        if (window.__win) window.__win.reset();

        function sample(now) {
            const dt = now - last; last = now;
            frames++;
            if (dt > 50) { longFrameCount++; longFrameTotalMs += dt; }
            if (frames > 1) dts.push(dt);
            // 白抜け: ビューポートの上1/4・中央・下1/4の3点にカードが無いフレーム(窓の描き遅れ・未レイアウトの検出)
            for (const fy of [0.25, 0.5, 0.75]) {
                // 1列目の中心x(中央は列間の隙間に当たる)・y±20pxの3点が全部カード外なら白抜け(行間の隙間の誤検出を避ける)
                let hitCard = false; let inShelf = false;
                for (const dy of [-20, 0, 20]) {
                    const el = document.elementFromPoint(window.innerWidth * 0.27, window.innerHeight * fy + dy);
                    if (el && el.closest('#bookshelf')) inShelf = true;
                    if (el && el.closest('.book-item')) { hitCard = true; break; }
                }
                if (inShelf && !hitCard) blankPoints++;
            }

            // 可視範囲の cover img を見る (book-cover-container内のimg、view-coversのみ想定)
            const vh = window.innerHeight;
            const imgs = document.querySelectorAll('#bookshelf .book-item .book-cover-container img');
            let emptyNow = 0;
            for (const img of imgs) {
                const item = img.closest('.book-item');
                const r = item.getBoundingClientRect();
                if (r.bottom <= 0 || r.top >= vh) continue; // 画面外は対象外
                const isLazy = img.classList.contains('lazy');
                const isIncomplete = !img.complete || img.naturalWidth === 0;
                if (isLazy || isIncomplete) {
                    emptyNow++;
                    if (!firstSeenEmpty.has(img)) firstSeenEmpty.set(img, now);
                } else if (!doneImgs.has(img) && firstSeenEmpty.has(img)) {
                    doneImgs.add(img);
                    decodeCount++;
                    decodeTotalMs += (now - firstSeenEmpty.get(img));
                }
            }
            emptyFrameSum += emptyNow;
            if (emptyNow > 0) emptySecondsAccum += dt;

            const elapsed = now - t0;
            const target = Math.min(maxScroll, (elapsed / 1000) * speedPxS);
            sc.scrollTop = target;
            if (elapsed < durationMs && target < maxScroll) {
                requestAnimationFrame(sample);
            } else {
                const sd = dts.slice().sort((a, b) => a - b);
                resolve({
                    p95: sd.length ? Math.round(sd[Math.floor(sd.length * 0.95)] * 10) / 10 : null,
                    maxFrame: sd.length ? Math.round(sd[sd.length - 1]) : null,
                    blankPoints, domItems: document.querySelectorAll('#bookshelf .book-item').length,
                    win: window.__win ? window.__win.stats() : null,
                    frames, longFrameCount, longFrameTotalMs: Math.round(longFrameTotalMs),
                    emptyFrameSum, emptySecondsAccum: Math.round(emptySecondsAccum),
                    decodeCount, decodeTotalMs: Math.round(decodeTotalMs),
                    stillEmptyAtEnd: [...firstSeenEmpty.keys()].filter((im) => !doneImgs.has(im)).length,
                    elapsedMs: Math.round(elapsed),
                    reachedBottom: target >= maxScroll,
                    longtaskCount: longtaskSupported ? longtasks.length : null,
                    longtaskTotalMs: longtaskSupported ? Math.round(longtasks.reduce((s, d) => s + d, 0)) : null,
                    lafCount: lafSupported ? lafs.length : null,
                    lafTotalMs: lafSupported ? Math.round(lafs.reduce((s, d) => s + d, 0)) : null,
                });
            }
        }
        requestAnimationFrame(sample);
    }), { durationMs: DURATION_MS, speedPxS: SPEED_PX_S });
}

// ===== タッチスクロール(コンポジタ駆動)の追従: CDP synthesizeScrollGesture(touch) 中に rAF で白抜け・フレームを測る =====
// rAF側では scrollTop を書かない(=ブラウザのタッチスクロールに任せる)。窓試作は scroll イベントでしか差し替えないので、
// コンポジタが先に進んだぶんだけ白抜けが出るはず＝その量を測る。chromium専用(webkitにタッチ合成の手段が無い)。
async function touchOnce() {
    await page.evaluate(() => {
        const sc = document.getElementById('view-bookshelf'); sc.scrollTop = 0;
        window.__tp = { dts: [], blank: 0, frames: 0, long: 0, stop: false, y0: 0, ys: [] };
        let last = performance.now();
        const tick = (now) => {
            const s = window.__tp; if (s.stop) return;
            const dt = now - last; last = now; s.frames++; if (s.frames > 1) s.dts.push(dt); if (dt > 50) s.long++;
            s.ys.push(sc.scrollTop);
            for (const fy of [0.25, 0.5, 0.75]) {
                let hit = false; let inShelf = false;
                for (const dy of [-20, 0, 20]) {
                    const el = document.elementFromPoint(window.innerWidth * 0.27, window.innerHeight * fy + dy);
                    if (el && el.closest('#bookshelf')) inShelf = true;
                    if (el && el.closest('.book-item')) { hit = true; break; }
                }
                if (inShelf && !hit) s.blank++;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    // 1回 = 600px を 3000px/s のフリック × 8回(上→下)
    for (let i = 0; i < 8; i++) {
        await cdp.send('Input.synthesizeScrollGesture', { x: 100, y: 500, yDistance: -400, speed: 3000, gestureSourceType: process.env.GST || 'touch', preventFling: false });
    }
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
        const s = window.__tp; s.stop = true;
        const sd = s.dts.slice().sort((a, b) => a - b);
        return { frames: s.frames, longFrameCount: s.long, p95: sd.length ? Math.round(sd[Math.floor(sd.length * 0.95)] * 10) / 10 : null,
            maxFrame: sd.length ? Math.round(sd[sd.length - 1]) : null, blankPoints: s.blank,
            scrolledPx: Math.round(Math.max(...s.ys) - s.ys[0]), winY: window.scrollY, hit: (() => { const e = document.elementFromPoint(100, 500); return e && (e.tagName + '.' + e.className).slice(0, 60); })(), domItems: document.querySelectorAll('#bookshelf .book-item').length,
            win: window.__win ? window.__win.stats() : null };
    });
    r.gestureMs = Date.now() - t0;
    return r;
}
const rows = [];
process.stderr.write(`[402-touch] mode=${MODE} ${BROWSER} cpu x${CPU} books=${BOOKS} reps=${REPS}\n`);
for (let rep = 0; rep < REPS; rep++) {
    if (rep > 0) await setupFreshPage();
    const row = await touchOnce(); rows.push(row);
    process.stderr.write(`  rep${rep + 1}: ${JSON.stringify(row)}\n`);
}
console.log(`SUMMARYTOUCH ${JSON.stringify({ mode: MODE, cpu: CPU, books: BOOKS, rows })}`);
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ mode: MODE, cpu: CPU, books: BOOKS, rows }, null, 2)); }
await browser.close();
