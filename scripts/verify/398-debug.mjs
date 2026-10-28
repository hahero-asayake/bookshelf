import { chromium } from '@playwright/test';

const N = 12;
const asin = (i) => `B0SORTA${String(i).padStart(3, '0')}`;
const titleOf = (i) => String.fromCharCode('L'.charCodeAt(0) - i);
const BOOKS = Array.from({ length: N }, (_, i) => ({
    asin: asin(i), title: titleOf(i), authors: `著者${i}`,
    acquiredTime: 1700000000000 + i * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000,
}));
const ALL_ASINS = BOOKS.map((b) => b.asin);
const SHELF_A_ASINS = ALL_ASINS.slice(0, 10);
const library = { books: BOOKS, metadata: { lastImportDate: 1700000000000, totalBooks: N } };
const userData = {
    bookshelves: [
        { id: 'all', name: 'すべての本', isSpecial: true, books: ALL_ASINS.slice(), internalId: 'all' },
        { id: 'shelfA', name: '棚A', isSpecial: false, books: SHELF_A_ASINS.slice(), internalId: 'shelfA' },
    ],
    notes: {}, settings: { sortOrder: 'title', sortDirection: 'asc' }, bookOrder: {}, stats: {}, version: 2,
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
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
console.log('goto...');
await page.goto('http://localhost:8000/index.html');
console.log('waitForFunction (ready)...');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 15000 });
console.log('ready. boot...');
await page.evaluate(() => {
    const bs = window.bookshelf; const a = bs.storage.adapter;
    a.beginBatch = () => {}; a.addBatchEntry = () => {}; a.addBatchDelete = () => {}; a.discardBatch = () => {};
    a.commitBatch = async () => ({}); a.fileExists = async () => false; a.readJSON = async () => null;
    a.writeJSON = async () => {}; a.writeText = async () => {};
    bs.storage.detectFormat = async () => 'new';
    bs.syncMethod = 'hub'; bs._isSyncReady = () => true; bs._ensureFreshGitHubToken = async () => true; bs.obsidianDirHandle = null;
    bs.switchBookshelf('all');
});
console.log('booted. clicking sidebar-brand...');
try {
    await page.click('.sidebar-brand', { timeout: 10000 });
    console.log('clicked.');
} catch (e) {
    console.log('[click error]', String(e));
}
console.log('checking first alt...');
const firstAlt = (shelfId) => page.evaluate((shelfId) => {
    const el = document.querySelector(`.bookshelf-preview[data-bookshelf-id="${shelfId}"] .bookshelf-preview-books img`);
    return el ? el.getAttribute('alt') : null;
}, shelfId);
console.log('title asc: all=', await firstAlt('all'), 'shelfA=', await firstAlt('shelfA'));

await page.evaluate(() => document.getElementById('sort-direction').click());
await page.waitForTimeout(100);
await page.click('.sidebar-brand');
console.log('title desc: all=', await firstAlt('all'));

await page.evaluate((v) => { const s = document.getElementById('sort-order'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, 'acquiredTime');
await page.waitForTimeout(100);
await page.click('.sidebar-brand');
console.log('acquiredTime (direction carried=desc): all=', await firstAlt('all'));

// custom
await page.evaluate(() => {
    const bs = window.bookshelf;
    bs.sortOrder = 'custom'; bs.userData.bookOrder = { all: ['B0SORTA005', 'B0SORTA000', 'B0SORTA011'] };
    bs._saveSortPrefs();
});
console.log('custom: all=', await firstAlt('all'));

// home-visible change
await page.evaluate(() => {
    const bs = window.bookshelf;
    bs.sortOrder = 'title'; bs.sortDirection = 'asc';
    bs._saveSortPrefs();
});
console.log('home-visible change to title/asc: all=', await firstAlt('all'));

// cache call-count check
await page.evaluate(() => {
    const bs = window.bookshelf;
    window.__cmpCalls = 0;
    const orig = bs._bookCompareFn.bind(bs);
    bs._bookCompareFn = (...args) => { window.__cmpCalls++; return orig(...args); };
    bs.sortOrder = 'acquiredTime'; bs.sortDirection = 'desc';
    bs._saveSortPrefs();
});
console.log('cmpCalls for 2 shelves(all+shelfA) in one render =', await page.evaluate(() => window.__cmpCalls));

await browser.close();
