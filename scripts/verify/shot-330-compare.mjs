// イシュー#330 step5: 修正前/修正後の比較画像素材を撮る(本詳細・ドロワー・記事引き出しシートの3面)。
// 使い方: node scripts/verify/shot-330-compare.mjs <before|after>
// 「進む」直後を50ms間隔で10フレーム撮り、tmp/verify-shots/330-compose/<label>-<face>/*.png に保存する。
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const LABEL = process.argv[2] || 'after';
const URL = 'http://localhost:8000/index.html';
const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const OUT = `tmp/verify-shots/330-compose/${LABEL}`;

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }
async function firstBook(page) { return page.evaluate(() => { const bs = window.bookshelf; const b = (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0]; return b ? b.asin : null; }); }
async function toShelf(page) { const id = await page.evaluate(() => { const sh = window.bookshelf.userData.bookshelves.find((b) => !b.isSpecial); return sh.id; }); await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id); await settle(page, 600); }
async function openArticleList(page) { await page.evaluate(() => window.bookshelf.openPublishPagesModal()); await page.waitForSelector('#publish-pages-modal.show', { timeout: 5000 }); }
async function openNewArticleEdit(page) {
    await openArticleList(page);
    await page.locator('#art-new').tap();
    await page.fill('#art-title', 'チェック330-compare');
    await page.locator('#art-mode-edit').tap();
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}

const FACES = [
    { id: 'book-detail', open: async (p) => { await toShelf(p); const asin = await firstBook(p); await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin); await settle(p, 600); } },
    { id: 'drawer', open: async (p) => { await p.evaluate(() => window.bookshelf._openDrawer()); await settle(p, 600); } },
    { id: 'art-sheet', open: async (p) => { await openNewArticleEdit(p); await p.evaluate(() => window.bookshelf._artOpenSheet()); await settle(p, 600); } },
];

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, { timeout: 20000 });
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        window.bookshelf._isSyncReady = () => true;
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const face of FACES) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
        await bootApp(page);
        await face.open(page);
        await settle(page, 300);
        await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
        await settle(page, 300);
        const dir = `${OUT}/${face.id}`;
        mkdirSync(dir, { recursive: true });
        const fwd = page.goForward({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
        for (let i = 0; i < 10; i++) {
            await page.screenshot({ path: `${dir}/${String(i).padStart(2, '0')}.png` }).catch(() => {});
            await page.waitForTimeout(50);
        }
        await fwd;
        await page.close();
        console.log(`[${LABEL}] ${face.id}: done`);
    }
    await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
