// イシュー#649 step2: Reorder.bindPointerReorder の他の呼び出し元でも、ドラッグの後の click が
// 掴んだ要素 (かその祖先) の click の処理に届くかを測る。アプリは変えない。
//   U*: サイドバーのユーティリティ (#header-controls の .header-item・つまみ無し・6px で開始)
//   W*: ホームの部品 (編集モードの .dashboard-widget・つまみ .widget-grip から運ぶ)
//   M*: 本棚管理モーダル (.bookshelf-drag-handle・掴むとすぐ開始)
// 使い方: node scripts/verify/649-click-probe-sites.mjs [chromium|webkit|all] [出力JSONのパス]  (PORT 既定 8149)
// 記録の仕方・起動の仕方は scripts/verify/649-click-probe.mjs と同じ。本棚管理モーダルは probe なので
// showBookshelfManager() を直接呼んで開く (経路の確かめではなく、click の行き先を測るだけ)。
import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8149);
const BASE = `http://localhost:${PORT}`;
const which = process.argv[2] || 'all';
const outPath = process.argv[3] || null;

const fixtureUserData = readFileSync(join(root, 'tests/fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(root, 'tests/fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';
const SHELVES = [
    { id: 's649a', internalId: 's649aiid01', name: '兄弟A', parent: 'fixall001', books: [ASIN] },
    { id: 's649b', internalId: 's649biid01', name: '兄弟B', parent: 'fixall001', books: [ASIN] },
    { id: 's649c', internalId: 's649ciid01', name: '兄弟C', parent: 'fixall001', books: [ASIN] },
];

async function boot(page) {
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        window.__sw = [];
        const orig = app.switchBookshelf.bind(app);
        app.switchBookshelf = (id) => { window.__sw.push(id); return orig(id); };
    });
}

// 画面の状態: ホームか・開いているモーダル (.show の付いた id 付き要素)・hash・ホームの「選んで置く」の状態
const state = (page) => page.evaluate(() => ({
    home: document.body.classList.contains('app-view-main'),
    hash: location.hash,
    shown: Array.from(document.querySelectorAll('[id].show, [id].is-open')).map((e) => e.id).filter((id) => !/^toast/.test(id)).sort().join(','),
    picking: (window.bookshelf.dashboard && window.bookshelf.dashboard._picking) || null,
    cfm: !!document.querySelector('.cfm-overlay .cfm-ok'),
    order: window.bookshelf.userData.bookshelves.filter((b) => !b.isSpecial).map((b) => b.id).join(','),
    headerOrder: Array.from(document.querySelectorAll('#header-controls .header-item')).map((e) => e.dataset.placementId || '?').join(','),
    widgetOrder: Array.from(document.querySelectorAll('#dashboard-grid .dashboard-widget')).map((e) => e.dataset.widgetId).join(','),
}));

async function dragFromCenter(page, fromBox, toPoint, { startRight = false } = {}) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    if (startRight) await page.mouse.move(x0 + 10, y0, { steps: 4 });
    else await page.mouse.move(x0, y0 + 5, { steps: 3 });
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.move(toPoint.x, toPoint.y);
    await page.waitForTimeout(80);
    await page.mouse.up();
}

const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

const CASES = [
    // サイドバーのユーティリティ: 最初の .header-item を、2つ目の .header-item の上へ運ぶ / 外へ落とす / その場で 10px 動かして離す
    { key: 'U1', label: 'ユーティリティ: 1つ目を2つ目の上へ運ぶ', run: async (page) => {
        const items = page.locator('#header-controls .header-item');
        const a = await items.nth(0).boundingBox(), b = await items.nth(1).boundingBox();
        await dragFromCenter(page, a, center(b), { startRight: true });
    } },
    { key: 'U2', label: 'ユーティリティ: 1つ目を外 (800,450) へ落とす', run: async (page) => {
        const a = await page.locator('#header-controls .header-item').nth(0).boundingBox();
        await dragFromCenter(page, a, { x: 800, y: 450 }, { startRight: true });
    } },
    { key: 'U3', label: 'ユーティリティ: 1つ目をその場で 10px 動かして離す', run: async (page) => {
        const a = await page.locator('#header-controls .header-item').nth(0).boundingBox();
        await dragFromCenter(page, a, { x: a.x + a.width / 2 + 10, y: a.y + a.height / 2 }, { startRight: true });
    } },
    // ホームの部品 (編集モード): 1つ目のつまみから運ぶ
    { key: 'W1', label: 'ホームの部品: 1つ目をつまみから3つ目の上へ運ぶ', pre: async (page) => {
        await page.click('#dashboard-edit-toggle');
        await page.waitForSelector('.dashboard-grid.is-edit-mode .dashboard-widget .widget-grip');
    }, run: async (page) => {
        const grip = await page.locator('#dashboard-grid .dashboard-widget').nth(0).locator('.widget-grip').boundingBox();
        const c2 = await page.locator('#dashboard-grid .dashboard-widget').nth(2).boundingBox();
        await dragFromCenter(page, grip, center(c2));
    } },
    { key: 'W2', label: 'ホームの部品: 1つ目をつまみから外 (左のサイドバー 120,800) へ落とす', pre: async (page) => {
        await page.click('#dashboard-edit-toggle');
        await page.waitForSelector('.dashboard-grid.is-edit-mode .dashboard-widget .widget-grip');
    }, run: async (page) => {
        const grip = await page.locator('#dashboard-grid .dashboard-widget').nth(0).locator('.widget-grip').boundingBox();
        await dragFromCenter(page, grip, { x: 120, y: 800 }, { startRight: true });
    } },
    // 本棚管理モーダル: s649b のつまみを s649c の真ん中へ (親の付け替え・確認あり) / 外へ落とす
    { key: 'M1', label: '本棚管理モーダル: s649b のつまみを s649c の真ん中へ', pre: async (page) => {
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await page.waitForSelector('#bookshelf-modal.show .bookshelf-item[data-id="s649c"]');
    }, run: async (page) => {
        const h = await page.locator('#bookshelf-modal .bookshelf-item[data-id="s649b"] .bookshelf-drag-handle').boundingBox();
        const t = await page.locator('#bookshelf-modal .bookshelf-item[data-id="s649c"]').boundingBox();
        await dragFromCenter(page, h, center(t));
    } },
    { key: 'M2', label: '本棚管理モーダル: s649b のつまみを外 (モーダルの外 20,20) へ落とす', pre: async (page) => {
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await page.waitForSelector('#bookshelf-modal.show .bookshelf-item[data-id="s649c"]');
    }, run: async (page) => {
        const h = await page.locator('#bookshelf-modal .bookshelf-item[data-id="s649b"] .bookshelf-drag-handle').boundingBox();
        await dragFromCenter(page, h, { x: 20, y: 20 });
    } },
];

async function runCase(browserType, c) {
    const browser = await browserType.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route((url) => !url.href.startsWith(BASE), (route) => {
        const u = route.request().url();
        const ct = u.endsWith('.svg') || u.includes('lucide') ? 'image/svg+xml' : (u.endsWith('.js') || u.includes('googlesyndication') ? 'application/javascript' : 'text/plain');
        return route.fulfill({ status: 200, contentType: ct, body: ct === 'image/svg+xml' ? '<svg xmlns="http://www.w3.org/2000/svg"></svg>' : '' });
    });
    await ctx.addInitScript(([userData, library, shelves]) => {
        const ud = JSON.parse(userData);
        for (const s of shelves) ud.bookshelves.push({ iconName: 'library', isSpecial: false, ...s });
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        window.__ev = [];
        const rec = (e) => {
            const t = e.target;
            const near = t && t.closest ? (t.closest('.tree-node, .header-item, .dashboard-widget, .bookshelf-item, .bd-section, .plugin-card-v2') || null) : null;
            const label = near ? (near.dataset.placementId || near.dataset.widgetId || near.dataset.id || near.dataset.bookshelfId || near.className.split(' ')[0]) : null;
            window.__ev.push({ type: e.type, near: label, tag: t && t.nodeName, cls: (t && typeof t.className === 'string') ? t.className.split(' ')[0] : '', id: (t && t.id) || '', connected: !!(t && t.isConnected), trusted: e.isTrusted });
        };
        for (const ty of ['pointerdown', 'pointerup', 'mouseup', 'click']) window.addEventListener(ty, rec, true);
    }, [fixtureUserData, fixtureLibrary, SHELVES]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    const res = { browser: browserType.name(), key: c.key, label: c.label };
    try {
        await boot(page);
        if (c.pre) await c.pre(page);
        res.before = await state(page);
        await page.evaluate(() => { window.__ev.length = 0; window.__sw.length = 0; });
        await c.run(page);
        await page.waitForTimeout(400);
        res.events = await page.evaluate(() => window.__ev.slice());
        res.switchCalls = await page.evaluate(() => window.__sw.slice());
        res.after = await state(page);
    } catch (e) {
        res.error = String(e).slice(0, 300);
    }
    res.pageErrors = errors;
    await browser.close();
    return res;
}

function summarize(r) {
    const f = (e) => `${e.near || e.tag + (e.id ? '#' + e.id : (e.cls ? '.' + e.cls : ''))}${e.connected ? '' : '(外れ)'}`;
    const ev = r.events || [];
    const diff = (k) => (r.before?.[k] !== r.after?.[k] ? `${k}: ${r.before?.[k]} → ${r.after?.[k]}` : null);
    return [
        `[${r.browser}] (${r.key}) ${r.label}`,
        r.error ? `  ERROR ${r.error}` : null,
        `  events: ${ev.map((e) => `${e.type}@${f(e)}`).join(' → ') || '(なし)'}`,
        `  click=${ev.filter((e) => e.type === 'click').map(f).join(',') || '(出ない)'} switchBookshelf=${(r.switchCalls || []).join(',') || '-'}`,
        `  変わったもの: ${['home', 'hash', 'shown', 'picking', 'cfm', 'order', 'headerOrder', 'widgetOrder'].map(diff).filter(Boolean).join(' | ') || '(なし)'}`,
        r.pageErrors?.length ? `  pageerror: ${r.pageErrors.join(' | ')}` : null,
    ].filter(Boolean).join('\n');
}

async function up() { try { const r = await fetch(`${BASE}/index.html`); return r.ok; } catch (_) { return false; } }
let server = null;
try {
    if (!(await up())) {
        server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
        let ok = false;
        for (let i = 0; i < 50 && !ok; i++) { ok = await up(); if (!ok) await new Promise((r) => setTimeout(r, 200)); }
        if (!ok) throw new Error(`server on ${PORT} did not start`);
    }
    const types = which === 'all' ? [chromium, webkit] : [which === 'webkit' ? webkit : chromium];
    const all = [];
    for (const bt of types) for (const c of CASES) { const r = await runCase(bt, c); console.log(summarize(r)); all.push(r); }
    if (outPath) writeFileSync(outPath, JSON.stringify(all, null, 1));
} finally {
    if (server) server.kill();
}
