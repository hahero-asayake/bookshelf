// イシュー#435 step1 差し戻し対応: 実アプリの設定モーダルをそのまま使い、CSS注入で全画面化(案A/B)。
// ログイン状態・hidden制御・マスター/ディテール切替はすべて実アプリのJSロジックに任せる(静的モックの崩れを回避)。
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
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

// 全画面化+読み物最大幅中央寄せ+publish-section除去の共通CSS。案A/Bで中身の出し分けだけ変える。
const BASE_CSS = `
#settings-modal.modal.show { align-items: stretch !important; justify-content: stretch !important; padding: 0 !important; }
#settings-modal .settings-modal-content { max-width: none !important; width: 100vw !important; height: 100dvh !important; max-height: none !important; border-radius: 0 !important; margin: 0 !important; }
#publish-section { display: none !important; }
#settings-modal .settings-cat[data-cat="publish-section"] { display: none !important; } /* master(左ナビ)一覧側の「公開」ボタンも消す */
`;

const CSS_A = BASE_CSS + `
/* 案A: #430型。既存のmaster(左ナビ)+detail(右本文)構成(=元々1pane表示の設計)をそのまま全画面に広げ、本文側だけ読み物幅で中央寄せ */
#settings-modal .settings-md-body { height: calc(100dvh - 61px); }
#settings-modal .settings-master { width: 260px; }
#settings-modal .settings-detail { padding: 0 !important; }
#settings-modal .settings-detail > .settings-section.pane-active { max-width: 760px; margin: 0 auto; padding: 2rem 2rem 6rem; box-sizing: border-box; }
`;

const CSS_B = BASE_CSS + `
/* 案B: 1カラム縦積み+節アンカー。左ナビを隠し、既存の「1paneだけ表示」制御(.pane-active以外display:none)を無効化して全セクション縦積みにする。管理者(#admin-section)は元々hidden属性で非表示=維持 */
#settings-modal .settings-master { display: none !important; }
#settings-modal .settings-md-back { display: none !important; }
#settings-modal .settings-detail { max-width: 760px; margin: 0 auto; padding: 2rem 2rem 6rem !important; box-sizing: border-box; }
#settings-modal .settings-detail > .settings-section:not(#admin-section) { display: block !important; border-bottom: 1px solid var(--line); padding-bottom: 1.4rem; margin-bottom: 1.4rem; scroll-margin-top: 4.5rem; }
#settings-modal .settings-detail > .settings-section:not(#admin-section) > summary.settings-section-title { display: block !important; font-size: 1.05rem; font-weight: 700; margin-bottom: 0.6rem; cursor: default; }
#settings-modal .settings-detail > .settings-section:last-of-type { border-bottom: none; }
#mk435-toc { max-width: 760px; margin: 1.2rem auto 0; padding: 0.8rem 1rem; display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); position: sticky; top: 0; z-index: 2; }
#mk435-toc a { font-size: 0.82rem; color: var(--fg2); text-decoration: none; }
`;

// 検査: 主要領域の外側に見える要素が無いか / 各セクションの中身が縦に切れていないか(scrollHeight vs clientHeight)
async function inspect(page, { checkOverflowRoot }) {
    return page.evaluate((rootSel) => {
        const root = document.querySelector(rootSel);
        const rootRect = root.getBoundingClientRect();
        // 主要領域(root)の外側にはみ出て見えている要素(視覚的に意味のある葉要素のみ・幅/高さが有限のもの)
        const outside = [];
        document.querySelectorAll('#settings-modal *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            const outOfRoot = r.right <= rootRect.left || r.left >= rootRect.right || r.bottom <= rootRect.top || r.top >= rootRect.bottom;
            // rootの横幅の外側(左右)にはみ出ているものだけを「漏れ」として検出(縦は後続スクロールが正常)
            const leaksHorizontally = r.right > rootRect.right + 1 || r.left < rootRect.left - 1;
            if (leaksHorizontally && !outOfRoot) outside.push({ tag: el.tagName, cls: el.className?.toString?.().slice(0, 60), left: r.left, right: r.right });
        });
        // 各可視sectionの中身が切れていないか(scrollHeight > clientHeightなら中で2重スクロールが必要=切れている)
        const clipped = [];
        document.querySelectorAll('#settings-modal .settings-section-body').forEach(el => {
            const cs = getComputedStyle(el.closest('details'));
            if (cs.display === 'none') return;
            if (el.scrollHeight - el.clientHeight > 4 && getComputedStyle(el).overflowY !== 'visible' && getComputedStyle(el).overflowY !== undefined) {
                // overflow指定が無い(visible)なら自然に伸びるので切れない。auto/hiddenで中身が溢れていたら切れている
                if (['auto', 'hidden', 'scroll'].includes(getComputedStyle(el).overflowY)) {
                    clipped.push({ id: el.closest('details')?.id, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
                }
            }
        });
        return { leakingOutsideCount: outside.length, leakingSample: outside.slice(0, 5), clippedSections: clipped, rootRect: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height } };
    }, checkOverflowRoot);
}

async function shot({ ctx, view, viewport, label, mobileView }) {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await page.waitForTimeout(200);
    if (mobileView === 'master') {
        await page.evaluate(() => window.bookshelf._showSettingsMaster());
        await page.waitForTimeout(150);
    }
    await page.addStyleTag({ content: view === 'b' ? CSS_B : CSS_A });
    if (view === 'b') {
        await page.evaluate(() => {
            const detail = document.getElementById('settings-detail');
            document.querySelectorAll('#settings-modal .settings-section').forEach(d => { if (d.id !== 'publish-section' && d.id !== 'admin-section') d.open = true; });
            if (!document.getElementById('mk435-toc')) {
                const toc = document.createElement('nav');
                toc.id = 'mk435-toc';
                toc.innerHTML = [...document.querySelectorAll('#settings-modal .settings-section:not(#publish-section):not(#admin-section)')]
                    .map(d => `<a href="#${d.id}">${d.querySelector('.settings-section-title')?.textContent?.trim() || d.id}</a>`).join(' ');
                // .settings-md-body(flexコンテナ)の直下ではなく.settings-detail内部の先頭に置く(flexアイテムとして横並びになるのを避ける)
                detail.insertBefore(toc, detail.firstChild);
            }
        });
    }
    await page.waitForTimeout(150);

    const metrics = await inspect(page, { checkOverflowRoot: '.settings-modal-content' });
    const outPath = join(SHOT_DIR, `435-${label}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log('→', outPath, JSON.stringify(metrics));
    await page.close();
    return metrics;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });

const results = {};
results['current-pc'] = await (async () => {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
    await page.waitForTimeout(200);
    const m = await inspect(page, { checkOverflowRoot: '.settings-modal-content' });
    await page.screenshot({ path: join(SHOT_DIR, '435-current-settings-pc.png') });
    console.log('→ current-pc', JSON.stringify(m));
    await page.close();
    return m;
})();
results['current-390'] = await (async () => {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await page.waitForTimeout(200);
    const m = await inspect(page, { checkOverflowRoot: '.settings-modal-content' });
    await page.screenshot({ path: join(SHOT_DIR, '435-current-settings-390.png') });
    console.log('→ current-390', JSON.stringify(m));
    await page.close();
    return m;
})();

results['mock-A-settings-pc'] = await shot({ ctx, view: 'a', viewport: { width: 1920, height: 1080 }, label: 'mock-A-settings-pc' });
results['mock-A-settings-390-master'] = await shot({ ctx, view: 'a', viewport: { width: 390, height: 844 }, label: 'mock-A-settings-390-master', mobileView: 'master' });
results['mock-A-settings-390-detail'] = await shot({ ctx, view: 'a', viewport: { width: 390, height: 844 }, label: 'mock-A-settings-390-detail' });
results['mock-B-settings-pc'] = await shot({ ctx, view: 'b', viewport: { width: 1920, height: 1080 }, label: 'mock-B-settings-pc' });
results['mock-B-settings-390'] = await shot({ ctx, view: 'b', viewport: { width: 390, height: 844 }, label: 'mock-B-settings-390' });

await browser.close();

import { writeFileSync } from 'node:fs';
writeFileSync(join(SHOT_DIR, '435-shot-v2-metrics.json'), JSON.stringify(results, null, 2));
console.log('\n=== metrics written to tmp/435/435-shot-v2-metrics.json ===');
