// イシュー#391 E2E#2: SW許可下で、表紙画像(Amazon)が2回目のロードでCache Storageから
// 返され、ネットワーク要求が0件になることを固定する。
//
// page.route はSWのfetchイベントを安定して横取りできない(②指摘・2026-10-29実測で再現性に
// ばらつきを確認)ため、本物の別オリジンHTTPサーバーを立てて検証する(sw.jsのCOVER_HOSTSには
// 本番ホストに加えテスト専用で127.0.0.1を一時注入する)。
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';

const DUMMY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAADwCAIAAAAII/iNAAACPElEQVR4nO3RQQkAMAzAwPrX0/e0TcUYhIMTEMjsHsLmewFPGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncNwFOJ5W30KHEhcAAAAASUVORK5CYII=', 'base64');

let imgServer;
let imgPort;
let swTestDir;
let staticServer;
let staticPort;

test.beforeAll(async () => {
    // (1) テスト専用の画像サーバー (CORS許可ヘッダ付き)
    imgServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Content-Length': DUMMY_PNG.length });
        res.end(DUMMY_PNG);
    });
    await new Promise((resolve) => imgServer.listen(0, '127.0.0.1', resolve));
    imgPort = imgServer.address().port;

    // (2) アプリ一式を一時ディレクトリにコピーし、sw.js の COVER_HOSTS に 127.0.0.1 を一時追加、
    //     book-manager.js の getProductImageUrl を http:// も許可するよう緩和(テスト専用)。
    swTestDir = mkdtempSync(join(tmpdir(), 'bookshelf-391-e2e-'));
    execSync(`git -C "${process.cwd()}" archive HEAD | tar -x -C "${swTestDir}"`);
    let swSrc = readFileSync(join(swTestDir, 'sw.js'), 'utf-8');
    swSrc = swSrc.replace(
        "const COVER_HOSTS = ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-amazon.com'];",
        "const COVER_HOSTS = ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-amazon.com', '127.0.0.1']; // E2Eテスト専用追加"
    );
    writeFileSync(join(swTestDir, 'sw.js'), swSrc);
    let bmSrc = readFileSync(join(swTestDir, 'js/book-manager.js'), 'utf-8');
    bmSrc = bmSrc.replace(/\/\^https:\\\/\\\/\//, '/^https?:\\/\\//');
    writeFileSync(join(swTestDir, 'js/book-manager.js'), bmSrc);

    // (3) このディレクトリを配信する最小の静的サーバー
    staticServer = http.createServer((req, res) => {
        let p = req.url.split('?')[0];
        if (p === '/') p = '/index.html';
        const full = join(swTestDir, p);
        try {
            const body = readFileSync(full);
            const ext = extname(full);
            const ct = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': ct });
            res.end(body);
        } catch (e) {
            res.writeHead(404); res.end('not found');
        }
    });
    await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
    staticPort = staticServer.address().port;
});

test.afterAll(async () => {
    await new Promise((r) => imgServer.close(r));
    await new Promise((r) => staticServer.close(r));
});

test('SW許可下で、2回目のロードでは表紙画像(別オリジン)のネットワーク要求が0件になる', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    let reqCount = 0;
    await ctx.route(`http://127.0.0.1:${imgPort}/**`, async (route) => {
        reqCount++;
        await route.continue();
    });
    const page = await ctx.newPage();

    const fixtureUserData = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/fixture-userdata.json'), 'utf-8'));
    const books = Array.from({ length: 8 }, (_, i) => {
        const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
        return { asin, title: `本${n}`, authors: 'a', acquiredTime: 1700000000000 + n, readStatus: 'READ', productImage: `http://127.0.0.1:${imgPort}/cover/${asin}.jpg`, source: 'fixture', addedDate: 1700000000000 + n };
    });
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
    userData.notes = {}; userData.settings = { ...(userData.settings || {}), coverSize: 'medium', defaultView: 'covers' };
    const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
    const userDataStr = JSON.stringify(userData);

    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userDataStr, libraryStr]);

    async function openAndSettle() {
        await page.goto(`http://127.0.0.1:${staticPort}/index.html`);
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
        await page.evaluate(() => {
            const bs = window.bookshelf; const mem = new Map();
            const a = bs.storage.adapter;
            a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
            a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
            bs._isSyncReady = () => true;
        });
        await page.evaluate(() => { window.bookshelf.setCoverSize('medium'); window.bookshelf.setView('covers'); window.bookshelf.switchBookshelf('all'); });
        await page.waitForTimeout(1200);
    }

    await openAndSettle();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 }).catch(() => {});
    const firstLoadCount = reqCount;
    expect(firstLoadCount).toBeGreaterThan(0); // 初回はSW未制御でネットワークへ行く

    reqCount = 0;
    await openAndSettle();
    expect(reqCount).toBe(0); // 2回目はSWのCache Storageから返り、ネットワーク要求が0件

    await ctx.close();
});
