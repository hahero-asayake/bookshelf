// イシュー#597: 1回開いただけの端末が、電波なしで起動できるかを確かめる (Service Worker の install の先読み)。
// 使い方: node scripts/verify/597-sw-precache-offline.mjs [--port=18197] [--browsers=chromium,webkit] [--out=<json>]
//
// 何を見るか (ブラウザごと):
//   (a) 1回開いた後の CACHE に、配信中の index.html が参照する同一オリジンの script/link が全部入っているか (差分の件数)
//   (b) 電波なしで index.html の再読込と ./?source=pwa (manifest の start_url) を開き、下のナビが出るか (= J8-1 の条件)。
//       あわせて、より厳しく「見本の書名が出る・初期化エラーが無い」も見る (下のナビは起動に失敗しても見えるため)。
//       電波なしは2通り: context.setOffline と、サーバ停止。
//       - chromium の setOffline は、SW が自分で出す下位資源の通信を止めない (イシュー#597 step2 で実測)。
//       - サーバ停止の前に、chromium は HTTP キャッシュも消す (本番 GitHub Pages の max-age=600 が切れた後に当たる)。
//         webkit は消す手段が無いため、サーバの Cache-Control を no-cache にして HTTP キャッシュが効かない形で流す。
//   (c) install 中にサーバへ届いた要求 (初回訪問のコスト)
//   (d) [chromium] 殻の先読みが1件失敗した時: install が失敗し、ページはオンラインのまま使えるか。次に開いた時に登録をやり直すか。
//
// サーバは python3 -m http.server ではなく、ここで立てる小さな静的サーバ (GitHub Pages と同じ Cache-Control: max-age=600・
// ETag で 304 を返す)。サーバ停止・SW の取得だけを失敗させる差し込み (Sec-Fetch-Dest: empty) のために自前にしている。
import { chromium, webkit } from '@playwright/test';
import http from 'node:http';
import { createReadStream, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const PORT = Number(arg('port', '18197'));
const BROWSERS = arg('browsers', 'chromium,webkit').split(',');
const OUT = arg('out', '');
const BASE = `http://127.0.0.1:${PORT}/`;
const CACHE_NAME = 'bookshelf-runtime-v4';
const BOOK_TITLE = 'フィクスチャの本 1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function makeServer({ cacheControl }) {
    const log = [];
    const sockets = new Set();
    let fail = null; // { pathname, dest } = この組み合わせの要求だけ 404 にする
    const overrides = new Map(); // pathname → 本文 (サーバ側で中身を差し替える)
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, BASE);
        let p = decodeURIComponent(u.pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = normalize(join(ROOT, p));
        const dest = req.headers['sec-fetch-dest'] || '';
        const entry = { t: Date.now(), path: u.pathname + u.search, dest, status: 0 };
        log.push(entry);
        const send = (status, headers, body) => { entry.status = status; res.writeHead(status, headers); res.end(body); };
        if (fail && u.pathname === fail.pathname && dest === fail.dest) return send(404, {}, 'injected');
        if (overrides.has(u.pathname)) return send(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, overrides.get(u.pathname));
        let st;
        try { st = statSync(file); } catch (_) { st = null; }
        if (!file.startsWith(ROOT) || !st || !st.isFile()) return send(404, {}, 'not found');
        const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
        const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': cacheControl,
            ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
        if (req.headers['if-none-match'] === etag) return send(304, headers);
        entry.status = 200;
        res.writeHead(200, headers);
        createReadStream(file).pipe(res);
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    return {
        log,
        setFail: (f) => { fail = f; },
        setOverride: (pathname, body) => { overrides.set(pathname, body); },
        start: () => new Promise((r) => server.listen(PORT, '127.0.0.1', r)),
        stop: () => new Promise((r) => { server.close(() => r()); for (const s of sockets) s.destroy(); }),
    };
}

const fixture = (name) => readFileSync(resolve(ROOT, 'tests/fixtures', name), 'utf-8');
async function newSeededPage(browser) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'allow' });
    const page = await context.newPage();
    // preload の警告 (「preloaded but not used」や credentials の不一致) を拾う
    page.preloadMsgs = [];
    page.on('console', (m) => { if (/preload/i.test(m.text())) page.preloadMsgs.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
    await page.addInitScript(([userData, library]) => {
        if (sessionStorage.getItem('gateLibrarySeeded')) return;
        sessionStorage.setItem('gateLibrarySeeded', '1');
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixture('fixture-userdata.json'), fixture('fixture-library.json')]);
    return { context, page };
}
const waitBooks = (page) => page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0, null, { timeout: 20000 });
const waitController = (page, timeout = 20000) =>
    page.waitForFunction(() => navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller), null, { timeout });

const cacheUrls = (page, name) => page.evaluate(async (n) => {
    if (!(await caches.has(n))) return null;
    return (await (await caches.open(n)).keys()).map((r) => r.url);
}, name);

// index.html が参照する同一オリジンの script/link (sw.js の _shellUrlsFromHtml とは別に、素直な正規表現で数える)
function htmlRefs(html) {
    const refs = new Set();
    const text = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const m of text.matchAll(/<(script|link)\b[^>]*?\s(src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const u = new URL(m[3], BASE);
        if (u.origin === new URL(BASE).origin) refs.add(u.href);
    }
    return [...refs].sort();
}

// 開き直して、下のナビ (J8-1 の条件)・見本の書名・初期化エラーを見る
async function bootCheck(page, how) {
    const errs = [];
    const onConsole = (m) => { if (m.type() === 'error' && /初期化エラー|config\.json/.test(m.text())) errs.push(m.text().split('\n')[0].slice(0, 100)); };
    page.on('console', onConsole);
    const preloadFrom = page.preloadMsgs.length;
    let navError = null;
    try {
        if (how === 'reload') await page.reload({ timeout: 15000 });
        else await page.goto(BASE + '?source=pwa', { timeout: 15000 });
    } catch (e) { navError = String(e.message || e).split('\n')[0].slice(0, 120); }
    await page.waitForTimeout(4000); // 「preloaded but not used」は load の数秒後に出るため、少し長めに待つ
    const r = {
        how,
        navError,
        bottomNav: await page.locator('[data-mobile-nav="shelves"]').isVisible().catch(() => false),
        bookTitle: await page.getByText(BOOK_TITLE).first().isVisible().catch(() => false),
        initErrors: errs,
        preloadWarnings: page.preloadMsgs.slice(preloadFrom),
    };
    page.off('console', onConsole);
    r.j8_1 = r.bottomNav && !navError;
    r.strict = r.j8_1 && r.bookTitle && errs.length === 0 && r.preloadWarnings.length === 0;
    return r;
}

// 1回だけ開いて、SW が画面を受け持つまで待つ
async function openOnce(browser) {
    const { context, page } = await newSeededPage(browser);
    await page.goto(BASE + 'index.html');
    await waitBooks(page);
    let controllerOk = true;
    try { await waitController(page); } catch (_) { controllerOk = false; }
    return { context, page, controllerOk };
}

async function runBrowser(name) {
    const type = name === 'webkit' ? webkit : chromium;
    // webkit は HTTP キャッシュを消せないため、最初から no-cache で流す (サーバ停止時に HTTP キャッシュが効かない形)
    const cacheControl = name === 'webkit' ? 'no-cache' : 'max-age=600';
    let server = makeServer({ cacheControl });
    await server.start();
    const browser = await type.launch();
    const out = { browser: name, cacheControl };
    try {
        // サーバ停止の確認は、setOffline より先に別の文脈で行う
        // (chromium の setOffline の間は SW の通信が通り、data/config.json などがキャッシュに入ってしまうため)
        const { context, page, controllerOk } = await openOnce(browser);
        out.controllerAfterOpen1 = controllerOk;
        await page.waitForTimeout(4000);
        out.preloadWarningsOpen1 = page.preloadMsgs.slice();
        // (c) install 中にサーバへ届いた要求 = sw.js の最初の取得以降
        const swAt = (server.log.find((e) => e.path.startsWith('/sw.js')) || {}).t || 0;
        const during = server.log.filter((e) => swAt && e.t >= swAt);
        out.installRequests = { total: during.length, byDest: {}, list: during.map((e) => `${e.status} ${e.dest || '-'} ${e.path}`) };
        for (const e of during) out.installRequests.byDest[e.dest || '-'] = (out.installRequests.byDest[e.dest || '-'] || 0) + 1;
        // (a) CACHE の中身と index.html の参照の差分
        const cached = (await cacheUrls(page, CACHE_NAME)) || [];
        const refs = htmlRefs(await (await fetch(BASE + 'index.html')).text());
        out.cacheAfterOpen1 = cached.length;
        out.indexRefs = refs.length;
        out.refsMissingInCache = refs.filter((u) => !cached.includes(u));
        out.configInCache = cached.some((u) => u.endsWith('/data/config.json'));
        // (b-2) サーバ停止 (chromium は HTTP キャッシュも消す)
        if (name === 'chromium') {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Network.clearBrowserCache');
        }
        await server.stop();
        out.serverStopped = [await bootCheck(page, 'reload'), await bootCheck(page, 'start_url')];
        await context.close();
        // (b-1) context.setOffline (新しい文脈で1回開き直してから)
        server = makeServer({ cacheControl });
        await server.start();
        const b1 = await openOnce(browser);
        // data/config.json はネットワーク優先のまま (先読みしても、電波がある時はサーバの新しい中身が返る) か
        const marker = JSON.stringify({ defaultView: 'covers', __verify597: 'v2' });
        server.setOverride('/data/config.json', marker);
        out.configNetworkFirst = await b1.page.evaluate(async () => (await (await fetch('data/config.json', { cache: 'no-store' })).text()).includes('v2'));
        await b1.context.setOffline(true);
        out.setOffline = [await bootCheck(b1.page, 'reload'), await bootCheck(b1.page, 'start_url')];
        out.configInCacheAfterSetOffline = ((await cacheUrls(b1.page, CACHE_NAME)) || []).some((u) => u.endsWith('/data/config.json'));
        await b1.context.close();
    } finally {
        await browser.close();
        await server.stop().catch(() => {});
    }
    return out;
}

// (d) 殻の先読みが1件失敗した時 (SW の取得 = Sec-Fetch-Dest: empty の js/router.js だけ 404 にする)
async function runInstallFailure(name) {
    const type = name === 'webkit' ? webkit : chromium;
    const server = makeServer({ cacheControl: 'no-store' }); // SW の取得を HTTP キャッシュで済ませず、必ずサーバへ届かせる
    server.setFail({ pathname: '/js/router.js', dest: 'empty' });
    await server.start();
    const browser = await type.launch();
    const out = { browser: name, injected: 'GET /js/router.js (Sec-Fetch-Dest: empty = SW の取得だけ) → 404' };
    try {
        const { page } = await newSeededPage(browser);
        const state = () => page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            const keys = await caches.keys();
            return {
                controller: !!navigator.serviceWorker.controller,
                active: !!(reg && reg.active), installing: !!(reg && reg.installing), waiting: !!(reg && reg.waiting),
                caches: keys,
            };
        });
        await page.goto(BASE + 'index.html');
        await waitBooks(page);
        await page.waitForTimeout(4000);
        const swAt = (server.log.find((e) => e.path.startsWith('/sw.js')) || {}).t || 0;
        out.open1 = { ...(await state()), bookTitle: await page.getByText(BOOK_TITLE).first().isVisible().catch(() => false),
            injectedHits: server.log.filter((e) => e.status === 404 && e.path.startsWith('/js/router.js')).length,
            requestsAfterSw: server.log.filter((e) => swAt && e.t >= swAt).slice(0, 12).map((e) => `${e.status} ${e.dest || '-'} ${e.path}`) };
        server.setFail(null);
        await page.reload();
        await waitBooks(page);
        let ok = true;
        try { await waitController(page, 15000); } catch (_) { ok = false; }
        const cached = (await cacheUrls(page, 'bookshelf-runtime-v4')) || [];
        out.open2 = { ...(await state()), controllerWithin15s: ok, cacheCount: cached.length,
            bookTitle: await page.getByText(BOOK_TITLE).first().isVisible().catch(() => false) };
    } finally {
        await browser.close();
        await server.stop().catch(() => {});
    }
    return out;
}

const ONLY = arg('only', '');
const result = { at: new Date().toISOString(), runs: [], installFailure: [] };
for (const b of ONLY === 'fail' ? [] : BROWSERS) {
    try { result.runs.push(await runBrowser(b)); } catch (e) { result.runs.push({ browser: b, error: String(e.message || e).slice(0, 300) }); }
}
for (const b of BROWSERS) {
    try { result.installFailure.push(await runInstallFailure(b)); } catch (e) { result.installFailure.push({ browser: b, error: String(e.message || e).slice(0, 300) }); }
}
if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(result, null, 2)); }
console.log(JSON.stringify(result, (k, v) => (k === 'list' ? undefined : v), 1));
