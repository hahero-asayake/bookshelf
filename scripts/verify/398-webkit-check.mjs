import { webkit } from '@playwright/test';
const userData = {
    bookshelves: [{ id: 'all', name: 'すべての本', isSpecial: true, books: [], internalId: 'all' }],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
    _storage: { main: { home: { widgets: [
        { id: 'counter-total', uid: 'w1', span: 3 },
        { id: 'counter-shelves', uid: 'w2', span: 3 },
        { id: 'recent-books', uid: 'w3', span: 6 },
    ] } } },
};
const library = { books: [], metadata: { totalBooks: 0 } };
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
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
await page.evaluate(() => {
    window.__dragstartCount = 0;
    document.getElementById('dashboard-grid').addEventListener('dragstart', () => { window.__dragstartCount++; });
});
const cards = await page.$$('.dashboard-widget');
const box1 = await cards[0].boundingBox();
const box3 = await cards[2].boundingBox();
await page.evaluate(({ x, y, tx, ty }) => {
    const el = document.elementFromPoint(x, y);
    const mk = (type, cx, cy) => new PointerEvent(type, { clientX: cx, clientY: cy, pointerType: 'touch', bubbles: true });
    el.dispatchEvent(mk('pointerdown', x, y));
    el.dispatchEvent(mk('pointermove', tx, ty));
    el.dispatchEvent(mk('pointerup', tx, ty));
}, { x: box1.x + box1.width / 2, y: box1.y + box1.height / 2, tx: box3.x + box3.width / 2, ty: box3.y + box3.height / 2 });
await page.waitForTimeout(100);
const afterOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.dashboard-widget')).map(c => c.dataset.widgetId));
const dragstartCount = await page.evaluate(() => window.__dragstartCount);
console.log('webkit order after touch attempt:', afterOrder.join(','), 'dragstartCount:', dragstartCount);
await browser.close();
