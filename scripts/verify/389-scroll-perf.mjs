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
    return { bootMs: ms, version: ver };
}
const first = await setupFreshPage();
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

        function sample(now) {
            const dt = now - last; last = now;
            frames++;
            if (dt > 50) { longFrameCount++; longFrameTotalMs += dt; }

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
                resolve({
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

const rows = [];
process.stderr.write(`[389-scroll-perf] ${BROWSER} ${WIDTH}px cpu x${CPU} size=${SIZE} books=${BOOKS} reps=${REPS} duration=${DURATION_MS}ms speed=${SPEED_PX_S}px/s imgdelay=${IMG_DELAY_MS}ms boot=${bootMs}ms version=${version}\n`);
for (let rep = 0; rep < REPS; rep++) {
    if (rep > 0) await setupFreshPage(); // 2回目以降も「初めてスクロールする」状態に戻す(画像キャッシュ退化対策)
    const row = await scrollOnce();
    rows.push(row);
    process.stderr.write(`  rep${rep + 1}: frames=${row.frames} longFrame=${row.longFrameCount}/${row.longFrameTotalMs}ms empty累積=${row.emptyFrameSum} 空秒=${(row.emptySecondsAccum / 1000).toFixed(2)}s decode(近似)=${row.decodeCount}/${row.decodeTotalMs}ms stillEmpty=${row.stillEmptyAtEnd} reachedBottom=${row.reachedBottom}\n`);
    await page.waitForTimeout(500);
}

const med = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
const summary = {
    frames: med(rows.map((r) => r.frames)),
    longFrameCount: med(rows.map((r) => r.longFrameCount)),
    longFrameTotalMs: med(rows.map((r) => r.longFrameTotalMs)),
    longtaskCount: med(rows.map((r) => r.longtaskCount)),
    longtaskTotalMs: med(rows.map((r) => r.longtaskTotalMs)),
    lafCount: med(rows.map((r) => r.lafCount)),
    lafTotalMs: med(rows.map((r) => r.lafTotalMs)),
    decodeCount: med(rows.map((r) => r.decodeCount)),
    decodeTotalMs: med(rows.map((r) => r.decodeTotalMs)),
    emptyFrameSum: med(rows.map((r) => r.emptyFrameSum)),
    emptySecondsAccum: med(rows.map((r) => r.emptySecondsAccum)),
    stillEmptyAtEnd: med(rows.map((r) => r.stillEmptyAtEnd)),
    reachedBottomAll: rows.every((r) => r.reachedBottom),
};

const cond = `${BROWSER} ${WIDTH}px CPUx${CPU} size=${SIZE}(view-covers)`;
const lines = [];
lines.push(`### ${cond} — books=${BOOKS} reps=${REPS} duration=${DURATION_MS}ms speed=${SPEED_PX_S}px/s imgdelay=${IMG_DELAY_MS}ms boot=${bootMs}ms`);
lines.push(`?v=${version.split('?')[1] || '(不明)'}／pageerror:${errors.length}／最下部到達:${summary.reachedBottomAll ? '全rep' : '一部未到達(本数or速度調整を検討)'}`);
lines.push('');
lines.push('| 長いフレーム数(rAF>50ms)/合計ms | longtask件/合計ms(chromiumのみ) | long-animation-frame件/合計ms(chromiumのみ) | 画像デコード近似 件/合計ms | 空き枠の累積(枚×フレーム) | 空きが見える秒数 | 終了時まだ空き | フレーム数 |');
lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|');
lines.push(`| ${summary.longFrameCount}/${summary.longFrameTotalMs} | ${summary.longtaskCount ?? '-'}/${summary.longtaskTotalMs ?? '-'} | ${summary.lafCount ?? '-'}/${summary.lafTotalMs ?? '-'} | ${summary.decodeCount}/${summary.decodeTotalMs} | ${summary.emptyFrameSum} | ${(summary.emptySecondsAccum / 1000).toFixed(2)}s | ${summary.stillEmptyAtEnd} | ${summary.frames} |`);
const md = lines.join('\n');
console.log(md);
if (errors.length) console.log('\npageerror:\n' + errors.slice(0, 5).join('\n'));
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ cond, version, bootMs, errors, summary, rows }, null, 1)); writeFileSync(OUT.replace(/\.json$/, '.md'), md + '\n'); }
await browser.close();
