// イシュー#398 step4: 修正後(_bindPointerReorderに置き換えた dashboard.js)の
// スマホ(390px・タッチ)でのウィジェット並べ替えを撮る。修正前は scripts/verify/398-widget-reorder-repro.mjs
// の 0-current-annotated.png (タッチで一切反応しない状態)。
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'tmp/verify-shots/398';
mkdirSync(OUT, { recursive: true });

const userData = {
    bookshelves: [{ id: 'all', name: 'すべての本', isSpecial: true, books: [], internalId: 'all' }],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
    _storage: { main: { home: { widgets: [
        { id: 'counter-total', span: 3 },
        { id: 'counter-shelves', span: 3 },
        { id: 'recent-books', span: 6 },
        { id: 'reading-stats', span: 12 },
    ] } } },
};
const library = { books: [], metadata: { totalBooks: 0 } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
const page = await ctx.newPage();
await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [JSON.stringify(userData), JSON.stringify(library)]);
await page.goto('http://localhost:8000/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books, null, { timeout: 15000 });
await page.evaluate(() => {
    const bs = window.bookshelf; const a = bs.storage.adapter;
    a.beginBatch = () => {}; a.addBatchEntry = () => {}; a.addBatchDelete = () => {}; a.discardBatch = () => {};
    a.commitBatch = async () => ({}); a.fileExists = async () => false; a.readJSON = async () => null;
    a.writeJSON = async () => {}; a.writeText = async () => {};
    bs.storage.detectFormat = async () => 'new';
    bs.syncMethod = 'hub'; bs._isSyncReady = () => true; bs._ensureFreshGitHubToken = async () => true; bs.obsidianDirHandle = null;
});
await page.click('#dashboard-edit-toggle');
await page.waitForTimeout(150);

const cards = await page.$$('.dashboard-widget');
const box0 = await cards[0].boundingBox();
const box2 = await cards[2].boundingBox();
const x0 = box0.x + box0.width / 2, y0 = box0.y + box0.height / 2;
const tx = box2.x + box2.width / 2, ty = box2.y + box2.height - 3;

// 長押し(タッチ)でドラッグ開始 → 移動中の見た目を撮る(ゴースト追従+挿入線)
await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 55, clientX: x, clientY: y }));
}, [x0, y0]);
await page.waitForTimeout(550); // 450ms長押し成立を跨ぐ
await page.evaluate(([x, y]) => {
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 55, clientX: x, clientY: y }));
}, [x0, y0 + 4]);
await page.evaluate(([x, y]) => {
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 55, clientX: x, clientY: y }));
}, [tx, ty]);
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/after-dragging.png` });

await page.evaluate(([x, y]) => {
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 55, clientX: x, clientY: y }));
}, [tx, ty]);
await page.waitForTimeout(150);
const order = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(c => c.dataset.widgetId));
console.log('after order:', order);
await page.screenshot({ path: `${OUT}/after-result.png` });

await browser.close();
console.log('DONE');
