// イシュー#350 step2: 実スワイプに近い「連続した」操作列を1セッションで通し、戻るごとの
// 遷移先とhistory.lengthを記録する。B2b(端スワイプ)はchromium/webkitに手段が無いため、
// 既存back-nav-matrix.spec.jsの慣例(17_表 凡例0-2)と同じく page.goBack()(B2a相当)で代替する。
// 使い方: node scripts/verify/350-swipe-paths.mjs <baseURL> <webkit|chromium>
import { chromium, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || 'http://localhost:8011';
const engine = process.argv[3] === 'chromium' ? chromium : webkit;
const fixtureUserData = readFileSync(join(here, '../../tests/fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../tests/fixtures/fixture-library.json'), 'utf-8');

async function snap(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        return {
            len: history.length,
            hash: location.hash,
            stack: (bs._modalHistStack || []).map((e) => e.id),
            openModals: Array.from(document.querySelectorAll('.modal.show')).map((m) => m.id),
            drawer: document.body.classList.contains('drawer-open'),
            detailPinned: document.body.classList.contains('book-detail-pinned'),
            artMode: bs._artMode || null,
            toast: !!document.querySelector('.toast, .toast-item, [class*="toast"]'),
        };
    }).catch((e) => ({ error: String(e) }));
}

async function back(page) {
    await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(350);
    return snap(page);
}
async function fwd(page) {
    await page.goForward({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(350);
    return snap(page);
}

async function bootApp(page, errors) {
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: { key: 'dummy-test-key', apiBase: 'https://hub.example.invalid' } }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
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

async function firstBook(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        return (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
    });
}

const ROUTES = {
    // ① ホーム→本棚→本詳細→長文メモ→戻る×4
    async R1(page) {
        const trace = [];
        const book = await firstBook(page);
        await page.evaluate((b) => window.bookshelf.showBookDetail(b, false), book);
        await page.waitForTimeout(250);
        trace.push({ step: 'open detail', ...(await snap(page)) });
        await page.evaluate((b) => window.bookshelf._openBookMemoInAppEditor(b.asin, b), book);
        await page.waitForTimeout(400);
        trace.push({ step: 'open long-memo', ...(await snap(page)) });
        for (let i = 1; i <= 4; i++) trace.push({ step: `back${i}`, ...(await back(page)) });
        return trace;
    },
    // ② 記事一覧→記事編集→シート→戻る×3
    async R2(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.waitForTimeout(250);
        trace.push({ step: 'open article list', ...(await snap(page)) });
        await page.locator('#art-new').waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#art-new').tap();
        await page.fill('#art-title', '戻る350-R2').catch(() => {});
        await page.locator('#art-mode-edit').tap().catch(() => {});
        await page.waitForTimeout(300);
        trace.push({ step: 'open article edit', ...(await snap(page)) });
        await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
        await page.waitForTimeout(250);
        trace.push({ step: 'open sheet', ...(await snap(page)) });
        for (let i = 1; i <= 3; i++) trace.push({ step: `back${i}`, ...(await back(page)) });
        return trace;
    },
    // ③ ドロワー開→ツリー長押し並べ替え→戻る (並べ替え自体はヘルパーのopts.onDropを直接呼んで模擬)
    async R3(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf._openDrawer());
        await page.waitForTimeout(200);
        trace.push({ step: 'open drawer', ...(await snap(page)) });
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await page.waitForTimeout(200);
        trace.push({ step: 'open bookshelf-modal (tree)', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        trace.push({ step: 'back2', ...(await back(page)) });
        return trace;
    },
    // ④ 本詳細セクション操作→戻る
    async R4(page) {
        const trace = [];
        const book = await firstBook(page);
        await page.evaluate((b) => window.bookshelf.showBookDetail(b, true), book);
        await page.waitForTimeout(250);
        trace.push({ step: 'open detail (edit)', ...(await snap(page)) });
        const grips = await page.locator('.bd-grip').count();
        trace.push({ step: 'grip count', grips });
        trace.push({ step: 'back1', ...(await back(page)) });
        return trace;
    },
    // ⑤ 記事編集→全画面(文章ブロック)→戻る×2
    async R5(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.waitForTimeout(200);
        await page.locator('#art-new').waitFor({ state: 'visible', timeout: 5000 });
        await page.locator('#art-new').tap();
        await page.fill('#art-title', '戻る350-R5').catch(() => {});
        await page.locator('#art-mode-edit').tap().catch(() => {});
        await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor({ timeout: 5000 }).catch(() => {});
        trace.push({ step: 'open article edit', ...(await snap(page)) });
        // 挿入ボタンから文章ブロックを追加 → 全画面化(既存specのA11相当の経路)
        await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().click().catch(() => {});
        await page.waitForTimeout(200);
        await page.locator('.art-block-add-text, [data-insert-type="text"]').first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
        trace.push({ step: 'add text block (best-effort)', ...(await snap(page)) });
        for (let i = 1; i <= 2; i++) trace.push({ step: `back${i}`, ...(await back(page)) });
        return trace;
    },
    // ⑥ コマンドパレット→戻る
    async R6(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf._openPalette());
        await page.waitForTimeout(200);
        trace.push({ step: 'open palette', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        return trace;
    },
    // ⑦ アイコンピッカー→戻る
    async R7(page) {
        const trace = [];
        page.evaluate(() => { window.__iconPickerResult = window.bookshelf.openIconPicker({ title: 'test', current: '' }); });
        await page.waitForTimeout(250);
        trace.push({ step: 'open icon picker', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        return trace;
    },
    // ⑧ 通報モーダル→戻る
    async R8(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf.openReportModal('https://example.com/a/x'));
        await page.waitForTimeout(250);
        trace.push({ step: 'open report modal', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        return trace;
    },
    // ⑨ 設定→戻る
    async R9(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await page.waitForTimeout(250);
        trace.push({ step: 'open settings', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        return trace;
    },
    // ⑩ 本詳細を開く→戻る→進む→戻る
    async R10(page) {
        const trace = [];
        const book = await firstBook(page);
        await page.evaluate((b) => window.bookshelf.showBookDetail(b, false), book);
        await page.waitForTimeout(250);
        trace.push({ step: 'open detail', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        trace.push({ step: 'forward1', ...(await fwd(page)) });
        trace.push({ step: 'back2', ...(await back(page)) });
        return trace;
    },
    // ⑪ toast表示中の戻る (ドロワーを開いた状態でグローバル例外を発生させてtoastを出す)
    async R11(page) {
        const trace = [];
        await page.evaluate(() => window.bookshelf._openDrawer());
        await page.waitForTimeout(200);
        await page.evaluate(() => { setTimeout(() => { throw new Error('#350 probe induced error'); }, 0); });
        await page.waitForTimeout(300);
        trace.push({ step: 'drawer open + toast induced', ...(await snap(page)) });
        trace.push({ step: 'back1', ...(await back(page)) });
        return trace;
    },
};

function withTimeout(p, ms, label) {
    return Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${label}`)), ms)),
    ]);
}

async function run() {
    mkdirSync(join(here, '../../tmp/verify-shots'), { recursive: true });
    const browser = await engine.launch();
    const results = {};
    for (const [name, fn] of Object.entries(ROUTES)) {
        process.stderr.write(`--- ${name} start ---\n`);
        const errors = [];
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const page = await ctx.newPage();
        try {
            await withTimeout(bootApp(page, errors), 15000, `${name} bootApp`);
            const trace = await withTimeout(fn(page), 15000, `${name} route`);
            results[name] = { ok: true, trace, errors };
        } catch (e) {
            results[name] = { ok: false, error: String(e), errors };
        }
        process.stderr.write(`--- ${name} done: ${JSON.stringify(results[name]).slice(0, 200)} ---\n`);
        await ctx.close().catch(() => {});
        // 途中経過を都度書き出す(タイムアウトで落ちても到達分が残る)
        writeFileSync(join(here, '../../tmp/verify-shots/350-swipe-partial.json'), JSON.stringify(results, null, 2));
    }
    await browser.close();
    console.log(JSON.stringify(results, null, 2));
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
