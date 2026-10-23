// イシュー#350: push後版(437173a)で、#337の長押し並べ替え・ドロワー内ツリー・本詳細セクションを
// 操作した直後に「戻る」を1回押した時の履歴状態を記録する。対象URLは引数で渡す(既定は :8001=after)。
// 使い方: node scripts/verify/350-backnav-trace.mjs [baseURL]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || 'http://localhost:8001';
const fixtureUserData = readFileSync(join(here, '../../tests/fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../tests/fixtures/fixture-library.json'), 'utf-8');

async function snap(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        return {
            len: history.length,
            state: history.state,
            hash: location.hash,
            stack: (bs._modalHistStack || []).map((e) => e.id),
            drawer: document.body.classList.contains('drawer-open'),
            detailPinned: document.body.classList.contains('book-detail-pinned'),
            openModals: Array.from(document.querySelectorAll('.modal.show')).map((m) => m.id),
        };
    });
}

async function bootApp(page, errors) {
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('[console] ' + msg.text()); });
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
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

async function longPressDrag(page, fromSel, toSel) {
    const from = page.locator(fromSel).first();
    const to = page.locator(toSel).first();
    const fb = await from.boundingBox();
    const tb = await to.boundingBox();
    const fx = fb.x + fb.width / 2, fy = fb.y + fb.height / 2;
    const tx = tb.x + tb.width / 2, ty = tb.y + tb.height / 2;
    await page.mouse.move(fx, fy);
    await page.dispatchEvent(fromSel, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: fx, clientY: fy, isPrimary: true, button: 0 });
    await page.waitForTimeout(500); // LONG_PRESS_MS(450)超え
    await page.dispatchEvent(fromSel, 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: tx, clientY: ty, isPrimary: true });
    await page.waitForTimeout(80);
    await page.dispatchEvent(fromSel, 'pointerup', { pointerType: 'touch', pointerId: 1, clientX: tx, clientY: ty, isPrimary: true, button: 0 });
}

// history.length<=1(appが何も積んでいない)で back すると画面自体から出てwindow.bookshelfが
// 消える(ナビゲーション破壊)ため、積んでいる時だけ戻る。戻れなかった場合はそう記録する。
async function safeBack(page) {
    const len = await page.evaluate(() => history.length);
    if (len <= 1) return { skipped: true, reason: 'history.length<=1 (appが何も積んでいない)' };
    await page.evaluate(() => history.back());
    await page.waitForTimeout(400);
    return { skipped: false };
}

const results = {};

async function run() {
    const browser = await chromium.launch();

    // ケース1: ドロワー内ツリー(本棚管理モーダルの並べ替え)操作後に戻る
    {
        const errors = [];
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const page = await ctx.newPage();
        await bootApp(page, errors);
        const before = await snap(page);
        // ドロワーを開く → 本棚管理モーダルを開く(ツリー行の並べ替えハンドルがある場所)
        await page.click('[data-action="open-drawer"], #drawer-toggle, .mobile-nav-toggle').catch(() => {});
        await page.evaluate(() => window.bookshelf._openDrawer && window.bookshelf._openDrawer());
        await page.waitForTimeout(200);
        const afterDrawer = await snap(page);
        await page.evaluate(() => window.bookshelf.showBookshelfManager && window.bookshelf.showBookshelfManager());
        await page.waitForTimeout(200);
        const afterMgmt = await snap(page);
        const handles = await page.locator('.bookshelf-drag-handle').count();
        let dragSnap = null, dragErr = null;
        if (handles >= 2) {
            try {
                await longPressDrag(page, '.bookshelf-item:nth-of-type(1) .bookshelf-drag-handle', '.bookshelf-item:nth-of-type(2) .bookshelf-drag-handle');
                dragSnap = await snap(page);
            } catch (e) { dragErr = String(e); }
        }
        const back1 = await safeBack(page);
        const afterBack1 = back1.skipped ? null : await snap(page);
        const back2 = back1.skipped ? { skipped: true, reason: 'back1 skipped' } : await safeBack(page);
        const afterBack2 = back2.skipped ? null : await snap(page);
        results.case1_drawer_tree_reorder = { before, afterDrawer, afterMgmt, handles, dragSnap, dragErr, back1, afterBack1, back2, afterBack2, errors };
        await ctx.close();
    }

    // ケース2: 本詳細のセクション(bd-section)を並べ替えたあとに戻る
    {
        const errors = [];
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        const page = await ctx.newPage();
        await bootApp(page, errors);
        const before = await snap(page);
        // 本棚→本を1冊開く(本詳細シート)
        await page.evaluate(() => {
            const first = window.bookshelf.filteredBooks?.[0] || window.bookshelf.userData.library[0];
            window.bookshelf.showBookDetail && window.bookshelf.showBookDetail(first, true);
        });
        await page.waitForTimeout(300);
        const afterDetail = await snap(page);
        const grips = await page.locator('.bd-grip').count();
        let dragSnap = null, dragErr = null;
        if (grips >= 2) {
            try {
                await longPressDrag(page, '.bd-grip >> nth=0', '.bd-grip >> nth=1');
                dragSnap = await snap(page);
            } catch (e) { dragErr = String(e); }
        }
        const back1 = await safeBack(page);
        const afterBack1 = back1.skipped ? null : await snap(page);
        results.case2_book_detail_section_reorder = { before, afterDetail, grips, dragSnap, dragErr, back1, afterBack1, errors };
        await ctx.close();
    }

    await browser.close();
    console.log(JSON.stringify(results, null, 2));
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
