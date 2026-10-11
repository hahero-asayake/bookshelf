// イシュー#276 差し戻し対応: 修正前(941a41c)|修正後の左右比較画像を5件作る (②指示・#277の型を流用)。
// 対象: ヘッダー2段+状態表示・+ここに追加・下部バー・文章ブロックのエディタ・キーボード補助バー
// 実行例: node scripts/verify/shot-276-pairs.mjs
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BEFORE_DIR = resolve(REPO, 'tmp/276-before-snapshot');
const SHOT_DIR = resolve(REPO, 'tmp/verify-shots');
mkdirSync(SHOT_DIR, { recursive: true });

const fixUser = JSON.parse(readFileSync(`${REPO}/tests/fixtures/fixture-userdata.json`, 'utf-8'));
const fixLib = JSON.parse(readFileSync(`${REPO}/tests/fixtures/fixture-library.json`, 'utf-8'));

async function launch() {
    try { return await chromium.launch(); } catch (e) { return await chromium.launch({ channel: 'chrome' }); }
}
async function newCtx(browser, staticDir, port, width, height) {
    const base = `http://127.0.0.1:${port}/`;
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(base) || /^(data:|blob:|about:)/.test(u)) return route.continue();
        if (/unpkg\.com\/lucide-static/.test(u)) return route.continue();
        if (/pagead2\.googlesyndication\.com/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        if (/hub\.asayake\.org\/usage/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: 'free', quotaBytes: 104857600, usedBytes: 3355443 }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    await ctx.route(base + '**', async (route) => {
        const u = new URL(route.request().url()); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
        const fp = join(staticDir, p);
        if (!existsSync(fp)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: MIME[extname(fp)] || 'application/octet-stream', body: readFileSync(fp) });
    });
    await ctx.addInitScript(() => {
        window.google = window.google || {}; window.google.accounts = window.google.accounts || {};
        window.google.accounts.id = { initialize() {}, prompt() {}, renderButton() {}, disableAutoSelect() {}, cancel() {}, revoke(_h, cb) { if (cb) cb({}); } };
    });
    return { ctx, base };
}
async function bootApp(page, base) {
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(fixUser), JSON.stringify(fixLib)]);
    await page.goto(base + 'index.html');
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
}

// 共通の記事セットアップ: タイトル+本棚ブロック(2冊)まで作る。edit モードで止める。
async function setupArticle(page) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', '10月に読んだSFまとめ');
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible().catch(() => false)) await edit.click();
    const ins = page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last();
    await ins.click();
    await page.click('#art-add-sheet [data-block-type="shelf"]');
    const openSheetOrNot = await page.evaluate(() => window.innerWidth <= 900);
    if (openSheetOrNot) await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
    const items = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(2, await items.count());
    for (let i = 0; i < n; i++) await items.nth(i).click();
    if (openSheetOrNot) await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
    const done = page.locator('#art-fs-done');
    if (await done.isVisible().catch(() => false)) await done.click();
    await page.evaluate(() => window.bookshelf._artFlushSave && window.bookshelf._artFlushSave());
}

async function shotState(staticDir, port, name, width, height, fn) {
    const browser = await launch();
    const { ctx, base } = await newCtx(browser, staticDir, port, width, height);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await bootApp(page, base);
    await setupArticle(page);
    await fn(page);
    await page.waitForTimeout(150);
    const outPath = join(SHOT_DIR, `.raw-276-${name}.png`);
    await page.screenshot({ path: outPath });
    await browser.close();
    if (errors.length) console.log(`[${name}] console errors:`, JSON.stringify(errors.slice(0, 3)));
    return outPath;
}

// ---- 各ケースの撮影手順 (before=941a41c / after=現行で同じ手順を踏む) ----
const CASES = {
    header: {
        caption: 'ヘッダーを「タイトル(1行目)+状態表示(2行目)」の2段にした (600px以下・編集状態)',
        async run(page) { /* setupArticleのままでOK: ヘッダーが見える状態 */ },
    },
    addband: {
        caption: 'ブロック間の「+」を28pxアイコンのみ→「+ ここに追加」44px以上の帯にした',
        async run(page) { /* setupArticleのままでOK: +ここに追加の帯が見える */ },
    },
    bottombar: {
        caption: '下部に「追加・見た目・公開(または更新)・完了」の44px以上アクションバーを新設した',
        async run(page) { /* setupArticleのままでOK: 下部バーが見える */ },
    },
    textfs: {
        caption: '文章ブロックの編集を、長文メモと同じEasyMDEの全画面エディタに統一した(その場入力は廃止)',
        async run(page) {
            const ins = page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last();
            await ins.click();
            await page.click('#art-add-sheet [data-block-type="text"]');
            // before(941a41c)はその場入力でform モードに入らない。after は全画面(EasyMDE)。
            const hasFs = await page.waitForSelector('#art-edit-view[data-art-mode="form"]', { timeout: 3000 }).then(() => true).catch(() => false);
            if (hasFs) {
                await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 5000 }).catch(() => {});
                await page.evaluate(() => { if (window.bookshelf._artTextFsEditor) window.bookshelf._artTextFsEditor.value('## はじめに\n\n10月はSFを集中して読んだ。'); });
            } else {
                // before: キャンバス内その場入力
                const ta = page.frameLocator('#art-canvas-frame').locator('.art-cv-ta');
                if (await ta.count()) await ta.fill('## はじめに\n\n10月はSFを集中して読んだ。');
            }
        },
    },
    kbbar: {
        caption: 'キーボード表示中は下部バーを隠し、キーボード直上に「確定」の補助バーを出す',
        async run(page) {
            await page.evaluate(() => {
                document.querySelectorAll('.art-fs-memo, #art-title').forEach(() => {});
            });
            const memo = page.locator('.art-fs-memo').first();
            const hasMemo = await memo.count().then(c => c > 0).catch(() => false);
            // キーボード近似: 下部を暗い帯で覆い、art-kb-bar (存在すれば) を表示状態にする
            await page.evaluate(() => {
                const kbHeight = Math.round(window.innerHeight * 0.42);
                const overlay = document.createElement('div');
                overlay.id = '__kb_fake_overlay__';
                overlay.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${kbHeight}px;background:rgba(20,20,30,.78);z-index:5000;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;`;
                overlay.textContent = 'キーボード (近似)';
                document.body.appendChild(overlay);
                const view = document.getElementById('art-edit-view');
                const bar = document.getElementById('art-kb-bar');
                if (view && bar) {
                    view.classList.add('is-kb-open');
                    bar.style.top = `${window.innerHeight - kbHeight - 1}px`;
                    bar.style.zIndex = 5001;
                }
            });
        },
    },
};

const results = {};
for (const [name, def] of Object.entries(CASES)) {
    const before = await shotState(BEFORE_DIR, 8301, `before-${name}`, 390, 844, def.run);
    const after = await shotState(REPO, 8302, `after-${name}`, 390, 844, def.run);
    results[name] = { before, after, caption: def.caption };
    console.log(name, 'done');
}
writeFileSync(join(SHOT_DIR, '.raw-276-manifest.json'), JSON.stringify(results, null, 1));
console.log('\n撮影完了:', Object.keys(results).join(', '));
