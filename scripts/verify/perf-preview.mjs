// イシュー#134 step0: 記事プレビュー生成の区間計測ハーネス (実データ主)
// 実行: BOOKSHELF_VERIFY_DATA_DIR=/path/to/private/data node scripts/verify/perf-preview.mjs [URL] [--blocked] [--out=path.json] [--articleBooks=N]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBase, requireDataRoot, resolveShotDir, resolveRepoRoot } from './verify-common.mjs';

const BLOCKED = process.argv.includes('--blocked');
const outArg = process.argv.find(a => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : null;
const countArg = process.argv.find(a => a.startsWith('--articleBooks='));
const ARTICLE_BOOK_COUNT = countArg ? parseInt(countArg.slice('--articleBooks='.length), 10) : 10;
const urlArg = process.argv.slice(2).find(a => !a.startsWith('--'));

const ROOT = requireDataRoot();
const BASE = resolveBase(urlArg);

// 実データ (private/library.json、実 ASIN・実 productImage URL)
const realLibrary = JSON.parse(readFileSync(resolve(ROOT, 'private/library.json'), 'utf-8')).books;
const fixtureUserData = JSON.parse(readFileSync(resolve(resolveRepoRoot(), 'tests/fixtures/fixture-userdata.json'), 'utf-8'));

// userData: "all" 特殊本棚に実 ASIN 全件、サブ本棚1つ (記事のソース本棚) に先頭N件
const allAsins = realLibrary.map(b => b.asin);
const articleAsins = allAsins.slice(0, ARTICLE_BOOK_COUNT);
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find(s => s.isSpecial);
allShelf.books = allAsins;
const subShelf = userData.bookshelves.find(s => !s.isSpecial);
subShelf.books = articleAsins;

const library = JSON.stringify({ books: realLibrary, metadata: { totalBooks: realLibrary.length } });
const userDataStr = JSON.stringify(userData);

function installGisMock() {
    window.google = window.google || {};
    window.google.accounts = window.google.accounts || {};
    window.google.accounts.id = {
        initialize() {}, prompt() {}, renderButton() {}, disableAutoSelect() {}, cancel() {},
        revoke(_h, cb) { if (cb) cb({}); }
    };
}

const browser = await chromium.launch();
const context = await browser.newContext();

if (BLOCKED) {
    await context.addInitScript(installGisMock);
    await context.route('https://pagead2.googlesyndication.com/**', (route) => route.fulfill({
        status: 200, contentType: 'application/javascript', body: '// stub'
    }));
    await context.route('https://unpkg.com/lucide-static@*/icons/**', (route) => route.fulfill({
        status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    }));
}

const page = await context.newPage();
const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [userDataStr, library]);

await page.goto(BASE);
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
await page.evaluate(() => { if (window.HubAuth) window.HubAuth.renderSignInButton = () => {}; });
await page.evaluate(() => {
    const mem = new Map();
    const adapter = window.bookshelf.storage.adapter;
    adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
    adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
    window.bookshelf._isSyncReady = () => true;
});

// 記事ドラフトを直接注入 (UI 経路を通さず _artPreview() の計測に専念する)
const subShelfInternalId = subShelf.internalId || subShelf.id;
await page.evaluate(([asins, shelfId]) => {
    window.bookshelf._artDraft = {
        id: '_preview', title: '実測用記事', tags: [],
        blocks: [{
            id: 'blk_perf', type: 'shelf', shelfId,
            items: asins.map((asin, i) => ({
                id: `pl_${i}`, blockId: 'blk_perf', asin, order: i,
                show: { shortMemo: false, longMemo: false }, addedAt: Date.now()
            }))
        }],
        theme: { layout: 'card', color: 'white' },
        sourceShelfId: shelfId, published: false
    };
}, [articleAsins, subShelfInternalId]);

// 計測用フック: build() と _artSetPreview() をラップして区間を記録
await page.evaluate(() => {
    window.__perf = {};
    const gen = window.bookshelf.publishArticleGenerator;
    const origBuild = gen.build.bind(gen);
    gen.build = async (...args) => {
        const t0 = performance.now();
        const r = await origBuild(...args);
        window.__perf.buildMs = performance.now() - t0;
        return r;
    };
    const origSetPreview = window.bookshelf._artSetPreview.bind(window.bookshelf);
    window.bookshelf._artSetPreview = function (html) {
        const t0 = performance.now();
        origSetPreview(html);
        window.__perf.srcdocAssignMs = performance.now() - t0;
        const frame = document.getElementById('pp-preview-frame');
        if (!frame) return;
        frame.addEventListener('load', () => {
            window.__perf.iframeLoadMs = performance.now() - t0;
            try {
                const imgs = [...frame.contentDocument.querySelectorAll('img.bk-cover')];
                window.__perf.imgCount = imgs.length;
                if (imgs.length === 0) { window.__perf.allImagesMs = 0; window.__perf.imgErrCount = 0; return; }
                let done = 0, errCount = 0;
                const finish = () => { if (done === imgs.length) window.__perf.allImagesMs = performance.now() - t0; };
                imgs.forEach((img) => {
                    if (img.complete) { done++; return finish(); }
                    img.addEventListener('load', () => { done++; finish(); }, { once: true });
                    img.addEventListener('error', () => { done++; errCount++; window.__perf.imgErrCount = errCount; finish(); }, { once: true });
                });
                window.__perf.imgErrCount = errCount;
            } catch (e) { window.__perf.imgReadError = String(e); }
        }, { once: true });
    };
}, );

async function runOnce(label) {
    await page.evaluate(() => { window.__perf = {}; });
    const t0 = Date.now();
    await page.evaluate(() => window.bookshelf._artPreview());
    await page.waitForFunction(() => window.__perf && window.__perf.allImagesMs !== undefined, { timeout: 60000 }).catch(() => {});
    const perf = await page.evaluate(() => window.__perf);
    const wallMs = Date.now() - t0;
    return { label, wallMs, ...perf };
}

const first = await runOnce('first-open');
// モーダルを閉じてから2回目 (実運用の「開き直し」に近づける)
await page.evaluate(() => { const m = document.getElementById('pp-preview-modal'); if (m) m.classList.remove('show'); });
const second = await runOnce('second-open');

// 変更前の公開HTML出力をstep2の diff 基準として保存 (build() の実際の戻り値をそのまま使う)
const rawBuild = await page.evaluate(async () => {
    const state = window.bookshelf._artBuildPreviewState();
    const tempArticle = { ...window.bookshelf._artDraft, id: '_preview', slug: 'preview', publicId: 'preview' };
    // 直接 generator を呼ぶ (計測ラップを経由してもよいが、ここでは出力保存が目的)
    const result = await window.bookshelf.publishArticleGenerator.build([tempArticle], { state });
    const file = result.files.find(f => f.path === 'preview/index.html');
    return file ? file.content : null;
});
if (rawBuild) writeFileSync(resolve(resolveShotDir(), 'preview-before.html'), rawBuild, 'utf-8');

const result = {
    mode: BLOCKED ? 'blocked(GIS/AdSense/lucide stub, Amazon画像は実ネットワーク)' : 'unblocked(無遮断)',
    dataScale: `実データ: library ${realLibrary.length}冊 / 記事ブロック内 ${articleAsins.length}冊(実ASIN・実productImage)`,
    consoleErrorCount: consoleErrors.length,
    consoleErrorsSample: consoleErrors.slice(0, 5),
    first, second
};

console.log(JSON.stringify(result, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf-8');

await browser.close();
