import { chromium } from '@playwright/test';
const userData = {
    bookshelves: [{ id: 'all', name: 'すべての本', isSpecial: true, books: [], internalId: 'all' }],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
};
const library = { books: [], metadata: { totalBooks: 0 } };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
const page = await ctx.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [JSON.stringify(userData), JSON.stringify(library)]);
await page.goto('http://localhost:8000/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; window.bookshelf._isSyncReady = () => true; });
await page.click('#dashboard-edit-toggle');
await page.waitForSelector('.dashboard-grid.is-edit-mode .dashboard-widget');

await page.evaluate(() => {
    window.__log = [];
    const grid = document.getElementById('dashboard-grid');
    ['pointerdown','pointermove','pointerup'].forEach(t => grid.addEventListener(t, (e) => window.__log.push(`${t}@${Math.round(e.clientX)},${Math.round(e.clientY)} type=${e.pointerType} target=${e.target.className}`)));
    window.__cmpLog = [];
    const dash = window.bookshelf.dashboard;
    const orig = dash._computeWidgetInsertIndex.bind(dash);
    dash._computeWidgetInsertIndex = (c, x, y) => {
        const r = orig(c, x, y);
        window.__cmpLog.push(`compute(${Math.round(x)},${Math.round(y)})=${r}`);
        return r;
    };
});

const cards = page.locator('#dashboard-grid .dashboard-widget');
const c0Box = await cards.nth(0).boundingBox();
const c2Box = await cards.nth(2).boundingBox();
console.log('c0Box', c0Box, 'c2Box', c2Box);
const x0 = c0Box.x + c0Box.width/2, y0 = c0Box.y + c0Box.height/2;
const x1 = c2Box.x + c2Box.width/2, y1 = c2Box.y + c2Box.height/2;
await page.mouse.move(x0, y0);
await page.mouse.down();
await page.waitForTimeout(30);
console.log('after down: is-dragging?', await page.evaluate(() => !!document.querySelector('.dashboard-widget.is-dragging')));
await page.mouse.move(x0, y0 + 5, { steps: 3 });
await page.waitForTimeout(30);
console.log('after move+5: is-dragging?', await page.evaluate(() => !!document.querySelector('.dashboard-widget.is-dragging')), 'ghost?', await page.evaluate(() => !!document.querySelector('.drag-ghost')));
await page.mouse.move(x1, y1, { steps: 5 });
await page.waitForTimeout(100);
console.log('after move to target: ghost?', await page.evaluate(() => !!document.querySelector('.drag-ghost')), 'indicator?', await page.evaluate(() => !!document.querySelector('.widget-drop-indicator')));
await page.mouse.move(x1, y1);
await page.waitForTimeout(80);
console.log('after EXTRA single move: indicator?', await page.evaluate(() => !!document.querySelector('.widget-drop-indicator')));
console.log('compute log mid:', JSON.stringify(await page.evaluate(() => window.__cmpLog)));
await page.mouse.up();
await page.waitForTimeout(100);
const after = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(c => c.dataset.widgetId));
console.log('after order:', after);
console.log('event log:', JSON.stringify(await page.evaluate(() => window.__log), null, 0));
console.log('compute log:', JSON.stringify(await page.evaluate(() => window.__cmpLog), null, 0));
await browser.close();
