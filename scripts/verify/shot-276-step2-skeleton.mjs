// イシュー#276 step2: 構成Aの骨格 (ヘッダー1行＋下部アクションバー) を実アプリ (作業ツリー・未コミット反映)
// でスクショ＋実測する。#275 の scripts/verify/shot-275-new-article-title.mjs (STATIC_DIR 方式) を流用。
// 実行例: node scripts/verify/shot-276-step2-skeleton.mjs
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const STATIC_DIR = REPO; // 作業ツリーをそのまま配信 (未コミットの構成A変更を見るため)
const SHOT_DIR = resolve(REPO, 'tmp/verify-shots');
mkdirSync(SHOT_DIR, { recursive: true });
const BASE = 'http://127.0.0.1:8276/';

const fixUser = JSON.parse(readFileSync(`${REPO}/tests/fixtures/fixture-userdata.json`, 'utf-8'));
const fixLib = JSON.parse(readFileSync(`${REPO}/tests/fixtures/fixture-library.json`, 'utf-8'));

async function launch() {
    try { return await chromium.launch(); } catch (e) { console.log('既定起動失敗→channel:chrome:', String(e.message).split('\n')[0]); return await chromium.launch({ channel: 'chrome' }); }
}

async function newCtx(browser, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (/^(http:\/\/127\.0\.0\.1:8276|data:|blob:|about:)/.test(u)) return route.continue();
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

// 整列 (1px以内)・タップ領域 (44px以上) の実測。e2e (publish-article-editor.spec.js の
// 「ヘッダー1行の崩れ検出」) と同じ考え方＝横に並ぶ要素の縦中心の差・各ボタンの幅/高さを見る。
async function measureRow(page, ids) {
    return page.evaluate((ids) => {
        const rs = ids.map(id => { const el = document.getElementById(id); return el ? el.getBoundingClientRect() : null; }).filter(Boolean);
        const cy = rs.map(r => (r.top + r.bottom) / 2);
        return {
            n: rs.length,
            cyRange: rs.length < 2 ? 0 : +(Math.max(...cy) - Math.min(...cy)).toFixed(2),
            maxRight: Math.max(...rs.map(r => r.right)),
            vw: window.innerWidth,
            sizes: ids.map(id => { const el = document.getElementById(id); if (!el) return [id, null, null]; const r = el.getBoundingClientRect(); return [id, +r.width.toFixed(1), +r.height.toFixed(1)]; }),
        };
    }, ids);
}

async function run(width, height, label) {
    console.log(`\n==== ${label} (${width}x${height}) ====`);
    const browser = await launch();
    const ctx = await newCtx(browser, width, height);
    const page = await ctx.newPage();
    const errors = await bootApp(page);

    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.waitForTimeout(300);
    await page.click('#art-new');
    await page.waitForFunction(() => { const v = document.getElementById('art-edit-view'); return v && !v.hidden; }, null, { timeout: 10000 });
    await page.fill('#art-title', '10月に読んだSFまとめ');

    // 本棚ブロックを1つ追加して2冊入れる (モック pair-A-edit と同じ厚み・見た目確認用)
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible().catch(() => false)) await edit.click();
    await page.waitForTimeout(200);
    const insBtn = page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last();
    await insBtn.click({ timeout: 5000 }).catch(e => console.log('追加ボタン失敗:', e.message.slice(0, 80)));
    await page.locator('#art-add-sheet [data-block-type="shelf"]').click({ timeout: 5000 }).catch(e => console.log('棚追加失敗:', e.message.slice(0, 80)));
    await page.waitForTimeout(300);
    const drawerOpen = await page.evaluate(() => window.innerWidth <= 900);
    if (drawerOpen) await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
    const items = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(2, await items.count());
    for (let i = 0; i < n; i++) await items.nth(i).click();
    if (drawerOpen) await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
    const doneBtn = page.locator('#art-fs-done');
    if (await doneBtn.isVisible().catch(() => false)) await doneBtn.click();
    await page.waitForTimeout(400);

    // 新規記事はid確定前は #art-page-ops (⋯の入れ物) が hidden のまま (既存仕様)。
    // e2e のヘッダー崩れ検出と同じく flush-save して id を確定させてから測る。
    await page.evaluate(() => window.bookshelf._artFlushSave());
    await page.waitForFunction(() => { const el = document.getElementById('art-page-ops'); return el && !el.hidden; }, null, { timeout: 5000 }).catch(() => console.log('== #art-page-ops が表示されなかった'));

    const mode = await page.locator('#art-edit-view').getAttribute('data-art-mode');
    console.log('== data-art-mode:', mode);

    const shotPath = `${SHOT_DIR}/.tmp-276-step2-${width}x${height}.png`;
    const finalPath = `${SHOT_DIR}/276-step2-${width}x${height}.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    if (!existsSync(finalPath)) { renameSync(shotPath, finalPath); console.log('== スクショ保存:', finalPath); }
    else { console.log('== 既存あり、上書きしない (mv -n):', finalPath, '/ 今回分は', shotPath); }

    const isCompact = width <= 600;
    let result = { width, height, mode, isCompact };
    if (isCompact) {
        const header = await measureRow(page, ['art-back', 'art-more-btn']);
        const bar = await measureRow(page, ['art-bar-add', 'art-bar-look', 'art-bar-publish', 'art-bar-done']);
        console.log('== header (back/⋯) cyRange:', header.cyRange, 'maxRight<=vw:', header.maxRight <= header.vw);
        console.log('== bottom bar cyRange:', bar.cyRange, 'maxRight<=vw:', bar.maxRight <= bar.vw);
        console.log('== bottom bar sizes (id,w,h):', JSON.stringify(bar.sizes));
        const under44 = bar.sizes.filter(([, w, h]) => w != null && (w < 44 || h < 44));
        console.log('== 44px未満:', JSON.stringify(under44));
        result = { ...result, header, bar, under44 };
    } else {
        const header = await measureRow(page, ['art-back', 'art-look-btn', 'art-publish-header', 'art-mode-done', 'art-more-btn']);
        console.log('== PC header cyRange:', header.cyRange, 'maxRight<=vw:', header.maxRight <= header.vw);
        result = { ...result, header };
    }
    console.log('== console errors:', errors.length ? JSON.stringify(errors.slice(0, 5)) : '(なし)');
    await browser.close();
    return result;
}

const results = [];
results.push(await run(390, 844, 'スマホ390px (構成A骨格)'));
results.push(await run(1280, 900, 'PC1280px (回帰確認・現状維持)'));

console.log('\n==== 結果まとめ ====');
console.log(JSON.stringify(results, null, 1));
