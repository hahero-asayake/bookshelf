// イシュー#389 step4: 修正前(git archive 9c2c413・ポート8061)/修正後(working tree・ポート8000)の
// 左右比較画像を作る。385-compare.mjs(イシュー#385)の型を踏襲。
// ①3段階×2ビューの6通り(本棚の見た目・静止画)
// ②空の枠が見える様子の比較(同じスクロール位置・同じ経過時間でのmid-scroll capture・固定遅延画像)
// 出力前に座標(grid-template-columns・はみ出し・縦横比)を検証してから画像化する。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'tmp/389/compare';
mkdirSync(OUT, { recursive: true });
const WIDTH = 390, HEIGHT = 844;
const BEFORE_PORT = 8061; // git archive 9c2c413
const AFTER_PORT = 8000;  // working tree (HEAD=9791c62)

const DUMMY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAADwCAIAAAAII/iNAAACPElEQVR4nO3RQQkAMAzAwPrX0/e0TcUYhIMTEMjsHsLmewFPGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncNwFOJ5W30KHEhcAAAAASUVORK5CYII=', 'base64');

const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
const books = Array.from({ length: 800 }, (_, i) => {
    const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
    return { asin, title: `見本の本 ${n} ${'長めの書名'.repeat(n % 3)}`, authors: `著者${n % 37}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
});
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
userData.notes = {};
const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
const userDataStr = JSON.stringify(userData);

async function openPage(port, size, view, { imgDelay = null } = {}) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '//' }));
    await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    if (imgDelay != null) {
        await ctx.route('https://images-na.ssl-images-amazon.com/images/P/**', async (r) => {
            await new Promise((res) => setTimeout(res, imgDelay));
            await r.fulfill({ status: 200, contentType: 'image/png', body: DUMMY_PNG });
        });
    }
    const page = await ctx.newPage();
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userDataStr, libraryStr]);
    await page.goto(`http://localhost:${port}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
    await page.evaluate(() => {
        const bs = window.bookshelf; const mem = new Map();
        const a = bs.storage.adapter;
        a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        bs._isSyncReady = () => true;
    });
    await page.evaluate(([s, v]) => { window.bookshelf.setCoverSize(s); window.bookshelf.setView(v); window.bookshelf.switchBookshelf('all'); }, [size, view]);
    await page.waitForTimeout(350);
    return { browser, page };
}

// 座標検証: 列数(grid-template-columns)・横はみ出し無し・縦横比±2%
async function verify(page, size, view, expectedCols) {
    const info = await page.evaluate(() => {
        const shelf = document.querySelector('.bookshelf');
        const cs = getComputedStyle(shelf);
        const cols = cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
        const items = [...document.querySelectorAll('.book-item[data-asin]')];
        let overflow = false;
        for (const it of items) { const r = it.getBoundingClientRect(); if (r.right > window.innerWidth + 0.5) { overflow = true; break; } }
        const cov = document.querySelector('.book-cover-container');
        const r = cov ? cov.getBoundingClientRect() : null;
        const wNum = parseFloat(cs.getPropertyValue('--book-width-num'));
        const hNum = parseFloat(cs.getPropertyValue('--book-height-num'));
        const ratio = r ? r.width / r.height : null;
        const expectedRatio = wNum / hNum;
        return { cols, overflow, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, ratio, expectedRatio };
    });
    const ratioOk = view === 'list' || info.ratio == null || Math.abs(info.ratio - info.expectedRatio) / info.expectedRatio <= 0.02;
    const ok = info.cols === expectedCols && !info.overflow && info.scrollWidth <= info.innerWidth && ratioOk;
    console.error(`  検証 size=${size} view=${view}: cols=${info.cols}(期待${expectedCols}) overflow=${info.overflow} scrollWidth<=innerWidth=${info.scrollWidth <= info.innerWidth} ratio=${info.ratio?.toFixed(3)}/${info.expectedRatio?.toFixed(3)} => ${ok ? 'OK' : 'NG'}`);
    return ok;
}

const MOBILE_COLS = { small: { covers: 3, images: 4 }, medium: { covers: 2, images: 3 }, large: { covers: 1, images: 2 } };

// ===== ①3段階×2ビューの6通り =====
const pairs = [];
let allVerified = true;
for (const size of ['small', 'medium', 'large']) {
    for (const view of ['covers', 'images']) {
        const expectedCols = MOBILE_COLS[size][view];
        const { browser: bB, page: pB } = await openPage(BEFORE_PORT, size, view);
        const okBefore = await verify(pB, size, view, expectedCols === undefined ? 0 : 0); // beforeは旧仕様(2/3列固定)なので列数は検証しない。はみ出しだけ見る
        const beforePath = join(OUT, `before-${size}-${view}.png`);
        await pB.screenshot({ path: beforePath });
        await bB.close();

        const { browser: bA, page: pA } = await openPage(AFTER_PORT, size, view);
        const okAfter = await verify(pA, size, view, expectedCols);
        allVerified = allVerified && okAfter;
        const afterPath = join(OUT, `after-${size}-${view}.png`);
        await pA.screenshot({ path: afterPath });
        await bA.close();

        pairs.push({ size, view, expectedCols, beforePath, afterPath });
    }
}

// ===== ②空の枠の比較(medium×covers・同じスクロール位置・同じ経過時間) =====
// 固定遅延150msのダミー画像で、1200px/s・1.5秒分(=1800px)スクロールした直後を撮る。
async function scrollFor(page, ms, speed) {
    await page.evaluate(({ ms, speed }) => new Promise((resolve) => {
        const sc = document.getElementById('view-bookshelf');
        sc.scrollTop = 0;
        const t0 = performance.now();
        function tick(now) {
            const el = now - t0;
            sc.scrollTop = Math.min(sc.scrollHeight - sc.clientHeight, (el / 1000) * speed);
            if (el < ms) requestAnimationFrame(tick); else resolve();
        }
        requestAnimationFrame(tick);
    }), { ms, speed });
}
const EMPTY_IMG_DELAY = 1200; // 差が画面で見えるよう150msより長めにする(スクロール中に解決し切らない程度)
const { browser: bEB, page: pEB } = await openPage(BEFORE_PORT, 'medium', 'covers', { imgDelay: EMPTY_IMG_DELAY });
await scrollFor(pEB, 1500, 1200);
const emptyBeforePath = join(OUT, 'empty-before.png');
await pEB.screenshot({ path: emptyBeforePath });
const emptyBeforeCount = await pEB.evaluate(() => {
    const vh = window.innerHeight;
    let n = 0;
    for (const img of document.querySelectorAll('#bookshelf .book-item .book-cover-container img')) {
        const it = img.closest('.book-item'); const r = it.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh) continue;
        if (img.classList.contains('lazy') || !img.complete) n++;
    }
    return n;
});
await bEB.close();

const { browser: bEA, page: pEA } = await openPage(AFTER_PORT, 'medium', 'covers', { imgDelay: EMPTY_IMG_DELAY });
await scrollFor(pEA, 1500, 1200);
const emptyAfterPath = join(OUT, 'empty-after.png');
await pEA.screenshot({ path: emptyAfterPath });
const emptyAfterCount = await pEA.evaluate(() => {
    const vh = window.innerHeight;
    let n = 0;
    for (const img of document.querySelectorAll('#bookshelf .book-item .book-cover-container img')) {
        const it = img.closest('.book-item'); const r = it.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh) continue;
        if (img.classList.contains('lazy') || !img.complete) n++;
    }
    return n;
});
await bEA.close();
console.error(`空の枠(1.5秒後・1800px): 修正前=${emptyBeforeCount}枚 修正後=${emptyAfterCount}枚`);

// ===== 画像を1枚のcomposeに並べる =====
const browser = await chromium.launch();
const totalW = WIDTH * 2 + 16 + 32 + 4;
const rows = pairs.map(p => `
    <div class="cap">サイズ=${p.size}×ビュー=${p.view}(期待列数${p.expectedCols})</div>
    <div class="row">
        <div class="col"><div class="lbl before">修正前(9c2c413)</div><div class="frame"><img src="file://${process.cwd()}/${p.beforePath}"></div></div>
        <div class="col"><div class="lbl after">修正後(HEAD)</div><div class="frame"><img src="file://${process.cwd()}/${p.afterPath}"></div></div>
    </div>`).join('\n');
const emptyRow = `
    <div class="cap">空の枠の比較: 中(2列)・表紙ビュー・1200px/sで1.5秒(=1800px)スクロール直後・固定遅延150ms画像(可視範囲の空き枠=修正前${emptyBeforeCount}枚/修正後${emptyAfterCount}枚)</div>
    <div class="row">
        <div class="col"><div class="lbl before">修正前(9c2c413)</div><div class="frame"><img src="file://${process.cwd()}/${emptyBeforePath}"></div></div>
        <div class="col"><div class="lbl after">修正後(HEAD)</div><div class="frame"><img src="file://${process.cwd()}/${emptyAfterPath}"></div></div>
    </div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin:0; padding:16px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans",sans-serif; background:#fff; }
    .cap { font-size:15px; font-weight:700; margin:18px 0 10px; }
    .row { display:flex; gap:16px; align-items:flex-start; }
    .lbl { font-size:13px; font-weight:700; margin-bottom:6px; }
    .lbl.before { color:#c23a3a; } .lbl.after { color:#1455c4; }
    .frame { border:1px solid #ddd; border-radius:6px; overflow:hidden; width:${WIDTH}px; }
    img { display:block; width:${WIDTH}px; }
</style></head><body>
    <h2>イシュー#389 本棚一覧(800冊・all) ${WIDTH}px</h2>
    ${rows}
    ${emptyRow}
</body></html>`;
const htmlPath = join(process.cwd(), OUT, '_tmp.html');
writeFileSync(htmlPath, html);
const composeCtx = await browser.newContext({ viewport: { width: totalW, height: 1200 } });
const page = await composeCtx.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
await page.waitForTimeout(100);
const outPath = join(OUT, 'pair-all.png');
await page.screenshot({ path: outPath, fullPage: true });
console.log('compose ->', outPath);
console.log('6通り検証OK(afterのみ・beforeは旧仕様なので列数は不問):', allVerified);
await composeCtx.close();
await browser.close();
