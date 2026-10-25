// イシュー#365 段階②: NavState 影モードの smoke。スマホ幅で 本棚→本詳細→戻る→ドロワー→ホーム を1回ずつ通し、
// window.__navShadow の inputs / diffs を出す。アプリは変えない (navigator.webdriver で影が ON になる)。
//   node scripts/verify/365-shadow-smoke.mjs [http://localhost:8000]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';
const userData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const library = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>' }));
const page = await ctx.newPage();
const warns = []; page.on('console', (m) => { if (m.text().startsWith('[nav-shadow]')) warns.push(m.text()); });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(([u, l]) => { localStorage.setItem('virtualBookshelf_userData', u); localStorage.setItem('virtualBookshelf_library', l); localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' })); }, [userData, library]);
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0);
const snap = async (label) => { const s = await page.evaluate(() => { const S = window.__navShadow; return S ? { inputs: S.inputs, diffs: S.diffs.length, faces: S.state.faces.map((f) => f.id), route: S.state.route, view: S.state.view, book: S.state.book } : null; }); console.log(label.padEnd(26), JSON.stringify(s)); };
await snap('boot');
await page.evaluate(() => window.bookshelf.switchBookshelf('all')); await page.waitForTimeout(300); await snap('switchBookshelf(all)');
await page.locator('#bookshelf .book-item').first().click(); await page.waitForTimeout(400); await snap('本詳細を開く');
await page.goBack(); await page.waitForTimeout(500); await snap('戻る(本詳細→本棚)');
await page.evaluate(() => window.bookshelf._openDrawer()); await page.waitForTimeout(300); await snap('ドロワーを開く');
await page.goBack(); await page.waitForTimeout(500); await snap('戻る(ドロワー閉)');
await page.evaluate(() => window.bookshelf._openDrawer()); await page.waitForTimeout(200);
await page.evaluate(() => window.bookshelf._navigateFromUi('main')); await page.waitForTimeout(500); await snap('ドロワー開いたまま→ホーム');
await page.goBack(); await page.waitForTimeout(500); await snap('戻る(ホーム→本棚)');
const diffs = await page.evaluate(() => window.__navShadow ? window.__navShadow.diffs : null);
console.log('\ndiffs:', JSON.stringify(diffs, null, 1));
console.log('pageerror:', errors.length, errors.slice(0, 3));
await browser.close();
