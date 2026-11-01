// イシュー#435 step2: 実装後の設定画面(全画面ページ化・案A)をPC/390(一覧+節)で撮る。
// CSS注入なし=実アプリのcss/bookshelf.css・js/bookshelf.jsだけで全画面化されることを確認する。
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8135';
const SHOT_DIR = 'tmp/435';
mkdirSync(SHOT_DIR, { recursive: true });

const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const HUB = 'https://mockhub.test';

async function newLoggedInPage(ctx) {
    const page = await ctx.newPage();
    await page.route(`${HUB}/**`, async (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p === '/usage') return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576, isAdmin: true } });
        return route.fulfill({ status: 404, json: {} });
    });
    await page.addInitScript(([userData, library, hub]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            hub: { key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free', isAdmin: true, siteId: 'sid' }
        }));
    }, [fixtureUserData, fixtureLibrary, HUB]);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.HubAuth.renderSignInButton = () => {};
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        adapter.readText = async (path) => (mem.has(path) ? mem.get(path) : null);
        adapter.writeText = async (path, text) => { mem.set(path, text); };
        window.bookshelf._isSyncReady = () => true;
    });
    return page;
}

async function inspect(page) {
    return page.evaluate(() => {
        const content = document.querySelector('.settings-modal-content');
        const rootRect = content.getBoundingClientRect();
        const outside = [];
        document.querySelectorAll('#settings-modal *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const leaksHorizontally = r.right > rootRect.right + 1 || r.left < rootRect.left - 1;
            if (leaksHorizontally) outside.push({ tag: el.tagName, cls: el.className?.toString?.().slice(0, 60), left: Math.round(r.left), right: Math.round(r.right) });
        });
        const clipped = [];
        document.querySelectorAll('#settings-modal .settings-section-body').forEach(el => {
            const det = el.closest('details');
            if (getComputedStyle(det).display === 'none') return;
            const cs = getComputedStyle(el);
            if (el.scrollHeight - el.clientHeight > 4 && ['auto', 'hidden', 'scroll'].includes(cs.overflowY)) {
                clipped.push({ id: det?.id, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
            }
        });
        // サイドバーがクリック可能か(settings-fullpageでbackdropを避けているか)の実測
        const sidebar = document.getElementById('app-sidebar');
        const sbRect = sidebar ? sidebar.getBoundingClientRect() : null;
        const elAtSidebarCenter = sbRect ? document.elementFromPoint(sbRect.x + sbRect.width / 2, sbRect.y + 40) : null;
        const sidebarClickable = !!(elAtSidebarCenter && sidebar.contains(elAtSidebarCenter));
        return {
            rootRect: { x: Math.round(rootRect.x), y: Math.round(rootRect.y), width: Math.round(rootRect.width), height: Math.round(rootRect.height) },
            leakingOutsideCount: outside.length, leakingSample: outside.slice(0, 5),
            clippedSections: clipped,
            sidebarRect: sbRect ? { x: Math.round(sbRect.x), width: Math.round(sbRect.width) } : null,
            sidebarClickable,
        };
    });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const results = {};

// PC: アカウント詳細
{
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await page.waitForTimeout(250);
    results['impl-pc'] = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, '435-impl-settings-pc.png') });
    console.log('→ impl-pc', JSON.stringify(results['impl-pc']));
    await page.close();
}

// 390: 一覧(master)
{
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await page.waitForTimeout(250);
    results['impl-390-master'] = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, '435-impl-settings-390-master.png') });
    console.log('→ impl-390-master', JSON.stringify(results['impl-390-master']));
    await page.close();
}

// 390: 節(detail) = アカウント
{
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await page.waitForTimeout(250);
    results['impl-390-detail'] = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, '435-impl-settings-390-detail.png') });
    console.log('→ impl-390-detail', JSON.stringify(results['impl-390-detail']));
    await page.close();
}

await browser.close();
writeFileSync(join(SHOT_DIR, '435-shot-impl-metrics.json'), JSON.stringify(results, null, 2));
console.log('\n=== metrics written to tmp/435/435-shot-impl-metrics.json ===');
