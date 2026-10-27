// イシュー#385 step4: 修正前(tmp/385/srv/before・git archive HEAD=42b2c9d)/修正後(working tree・
// localhost:8000)を390pxで撮り、左右に並べた比較画像を作る。本棚一覧(all・800冊)・表紙サイズ「大」・
// 表紙ビューに揃える(②指示「比較画像は390px・表紙サイズ大・表紙ビュー」)。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'tmp/385/compare';
mkdirSync(OUT, { recursive: true });

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

async function shot(port, width, label) {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width, height: 844 } });
    await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '//' }));
    await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
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
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.waitForTimeout(150);
    // 表紙サイズ「大」・表紙ビューに揃える(②指示)
    await page.evaluate(() => { window.bookshelf.setCoverSize('large'); window.bookshelf.setView('covers'); });
    await page.waitForTimeout(300);
    const outPath = join(OUT, `${label}-${width}.png`);
    await page.screenshot({ path: outPath });
    await browser.close();
    return outPath;
}

const width = 390;
const before = await shot(8061, width, 'before');
const after = await shot(8000, width, 'after');
console.log(width, before, after);

const browser = await chromium.launch();
const totalW = width * 2 + 16 + 32 + 4;
const totalH = 844 + 60 + 32;
const composeCtx = await browser.newContext({ viewport: { width: totalW, height: totalH } });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin:0; padding:16px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans",sans-serif; background:#fff; }
    .cap { font-size:16px; font-weight:700; margin-bottom:12px; }
    .row { display:flex; gap:16px; align-items:flex-start; }
    .lbl { font-size:13px; font-weight:700; margin-bottom:6px; }
    .lbl.before { color:#c23a3a; }
    .lbl.after { color:#1455c4; }
    .frame { border:1px solid #ddd; border-radius:6px; overflow:hidden; width:${width}px; }
    img { display:block; width:${width}px; }
</style></head><body>
    <div class="cap">イシュー#385 本棚一覧(800冊・all) ${width}px・表紙サイズ大・表紙ビュー</div>
    <div class="row">
        <div class="col"><div class="lbl before">修正前(42b2c9d・.book-cover-container width固定px)</div><div class="frame"><img src="file://${process.cwd()}/${before}"></div></div>
        <div class="col"><div class="lbl after">修正後(working tree・width:100%+aspect-ratio)</div><div class="frame"><img src="file://${process.cwd()}/${after}"></div></div>
    </div>
</body></html>`;
const htmlPath = join(process.cwd(), OUT, `_tmp-${width}.html`);
writeFileSync(htmlPath, html);
const page = await composeCtx.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
await page.waitForTimeout(100);
const outPath = join(OUT, `pair-${width}.png`);
await page.screenshot({ path: outPath, fullPage: true });
console.log('pair ->', outPath);
await composeCtx.close();
await browser.close();
