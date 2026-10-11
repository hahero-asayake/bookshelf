// イシュー#276 step4: 完成後のスクショ (390が主、1280は回帰確認)。
// 編集・キーボード補助バー・削除トースト・未反映表示・ピッカーの印・文章の全画面(EasyMDE)を撮る。
// 実行例: node scripts/verify/shot-276-step4-final.mjs
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const STATIC_DIR = REPO;
const SHOT_DIR = resolve(REPO, 'tmp/verify-shots');
mkdirSync(SHOT_DIR, { recursive: true });
const BASE = 'http://127.0.0.1:8278/';

const fixUser = JSON.parse(readFileSync(`${REPO}/tests/fixtures/fixture-userdata.json`, 'utf-8'));
const fixLib = JSON.parse(readFileSync(`${REPO}/tests/fixtures/fixture-library.json`, 'utf-8'));

async function launch() {
    try { return await chromium.launch(); } catch (e) { return await chromium.launch({ channel: 'chrome' }); }
}
async function newCtx(browser, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (/^(http:\/\/127\.0\.0\.1:8278|data:|blob:|about:)/.test(u)) return route.continue();
        if (/unpkg\.com\/lucide-static/.test(u)) return route.continue();
        if (/pagead2\.googlesyndication\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        if (/hub\.asayake\.org\/usage/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: 'free', quotaBytes: 104857600, usedBytes: 3355443 }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    await ctx.route(BASE + '**', async (route) => {
        const u = new URL(route.request().url()); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
        const fp = join(STATIC_DIR, p);
        if (!existsSync(fp)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: MIME[extname(fp)] || 'application/octet-stream', body: readFileSync(fp) });
    });
    await ctx.addInitScript(() => {
        window.google = window.google || {}; window.google.accounts = window.google.accounts || {};
        window.google.accounts.id = { initialize() {}, prompt() {}, renderButton() {}, disableAutoSelect() {}, cancel() {}, revoke(_h, cb) { if (cb) cb({}); } };
    });
    return ctx;
}
async function bootApp(page) {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(fixUser), JSON.stringify(fixLib)]);
    await page.goto(BASE + 'index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, null, { timeout: 60000 });
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await page.evaluate(() => { if (window.HubAuth) window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(() => {
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}
// スクショを撮って固定ファイル名へ保存 (mv -n=既存があれば上書きしない)
async function shotKeep(page, name, finalName) {
    const tmp = `${SHOT_DIR}/.tmp-276-${name}.png`;
    const final = `${SHOT_DIR}/${finalName}`;
    await page.screenshot({ path: tmp });
    if (!existsSync(final)) { renameSync(tmp, final); return final; }
    return tmp;
}

async function run390() {
    const browser = await launch();
    const ctx = await newCtx(browser, 390, 844);
    const page = await ctx.newPage();
    const errors = await bootApp(page);

    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', '10月に読んだSFまとめ');
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible().catch(() => false)) await edit.click();
    // 本棚ブロック+2冊
    const ins = page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last();
    await ins.click();
    await page.click('#art-add-sheet [data-block-type="shelf"]');
    await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
    const items = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(2, await items.count());
    for (let i = 0; i < n; i++) await items.nth(i).click();
    await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
    const done = page.locator('#art-fs-done');
    if (await done.isVisible().catch(() => false)) await done.click();
    await page.evaluate(() => window.bookshelf._artFlushSave());
    await page.waitForFunction(() => { const el = document.getElementById('art-page-ops'); return el && !el.hidden; }, null, { timeout: 5000 }).catch(() => {});

    // (1) 編集状態 (構成A骨格: ヘッダー2段+下部バー)
    await shotKeep(page, '1-edit', '276-final-1-edit-390x844.png');

    // (2) ピッカーの印 (追加済み)
    await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
    await page.waitForTimeout(300);
    await shotKeep(page, '2-picker', '276-final-2-picker-390x844.png');
    await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
    await page.waitForTimeout(300);

    // (3) 削除トースト
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-more').first().click();
    await page.click('#art-blk-menu [data-blk-act="delete"]');
    await page.waitForTimeout(200);
    await shotKeep(page, '3-undo-toast', '276-final-3-undo-toast-390x844.png');
    await page.waitForTimeout(400);

    // (4) 文章ブロックの全画面 (EasyMDE)
    const ins2 = page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last();
    await ins2.click();
    await page.click('#art-add-sheet [data-block-type="text"]');
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
    await page.evaluate(() => { window.bookshelf._artTextFsEditor.value('## はじめに\n\n10月はSFを集中して読んだ。'); });
    await page.waitForTimeout(300);
    await shotKeep(page, '4-text-fs', '276-final-4-text-fs-390x844.png');
    const fsDone = page.locator('#art-fs-done');
    if (await fsDone.isVisible().catch(() => false)) await fsDone.click();

    // (5) キーボード補助バー (fake visualViewport で近似)
    await page.evaluate(() => {
        class FakeVV extends EventTarget { constructor() { super(); this.height = window.innerHeight; this.offsetTop = 0; this.width = window.innerWidth; } }
        const fake = new FakeVV();
        Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    });
    // visualViewport を差し替えたので一度リロードしてバインドし直す必要がある → 代わりに is-kb-open を直接付けて見た目だけ確認
    await page.evaluate(() => { document.getElementById('art-edit-view').classList.add('is-kb-open'); const bar = document.getElementById('art-kb-bar'); if (bar) bar.style.top = `${Math.round(window.innerHeight * 0.6)}px`; });
    await page.waitForTimeout(200);
    await shotKeep(page, '5-kb-bar', '276-final-5-kb-bar-390x844.png');
    await page.evaluate(() => { document.getElementById('art-edit-view').classList.remove('is-kb-open'); });

    // (6) 公開中・未反映の変更あり (U1)
    await page.evaluate(() => {
        const id = window.bookshelf._artEditingId;
        const a = window.bookshelf.publishArticleStore.get(id);
        a.published = true; a.lastBuiltAt = Date.now() - 100000; a.updatedAt = Date.now();
        a.publicId = 'testpub01';
    });
    await page.evaluate(() => window.bookshelf._artRefreshPublishBadge());
    await page.waitForTimeout(100);
    await shotKeep(page, '6-stale', '276-final-6-stale-390x844.png');

    // 実測: 整列・44px (構成Aの骨格 + 下部バー)
    const measure = (ids) => page.evaluate((ids) => {
        const rs = ids.map(id => { const el = document.getElementById(id); return el ? el.getBoundingClientRect() : null; }).filter(Boolean);
        const cy = rs.map(r => (r.top + r.bottom) / 2);
        return { cyRange: rs.length < 2 ? 0 : +(Math.max(...cy) - Math.min(...cy)).toFixed(2), sizes: ids.map(id => { const el = document.getElementById(id); if (!el) return [id, null, null]; const r = el.getBoundingClientRect(); return [id, +r.width.toFixed(1), +r.height.toFixed(1)]; }) };
    }, ids);
    const header = await measure(['art-back', 'art-more-btn']);
    const bar = await measure(['art-bar-add', 'art-bar-look', 'art-bar-publish', 'art-bar-done']);
    console.log('390px header cyRange:', header.cyRange, 'sizes:', JSON.stringify(header.sizes));
    console.log('390px bottom bar cyRange:', bar.cyRange, 'sizes:', JSON.stringify(bar.sizes));
    console.log('390px console errors:', errors.length ? JSON.stringify(errors.slice(0, 5)) : '(なし)');
    await browser.close();
}

async function run1280() {
    const browser = await launch();
    const ctx = await newCtx(browser, 1280, 900);
    const page = await ctx.newPage();
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', '10月に読んだSFまとめ (PC回帰)');
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible().catch(() => false)) await edit.click();
    const ins = page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last();
    await ins.click();
    await page.click('#art-add-sheet [data-block-type="text"]');
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
    await page.evaluate(() => { window.bookshelf._artTextFsEditor.value('## はじめに\n\nPCでも同じEasyMDE全画面。'); });
    await page.waitForTimeout(300);
    await shotKeep(page, 'pc-text-fs', '276-final-pc-text-fs-1280x900.png');
    const fsDone = page.locator('#art-fs-done');
    if (await fsDone.isVisible().catch(() => false)) await fsDone.click();
    await page.waitForTimeout(200);
    await shotKeep(page, 'pc-edit', '276-final-pc-edit-1280x900.png');
    const header = await page.evaluate(() => {
        const ids = ['art-back', 'art-look-btn', 'art-publish-header', 'art-mode-done', 'art-more-btn'];
        const rs = ids.map(id => document.getElementById(id).getBoundingClientRect());
        const cy = rs.map(r => (r.top + r.bottom) / 2);
        return { cyRange: +(Math.max(...cy) - Math.min(...cy)).toFixed(2), maxRight: Math.max(...rs.map(r => r.right)), vw: window.innerWidth };
    });
    console.log('1280px header cyRange:', header.cyRange, 'maxRight<=vw:', header.maxRight <= header.vw);
    console.log('1280px console errors:', errors.length ? JSON.stringify(errors.slice(0, 5)) : '(なし)');
    await browser.close();
}

await run390();
await run1280();
console.log('\n完了');
