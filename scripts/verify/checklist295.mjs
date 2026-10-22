// イシュー#295: ハヘロ向け実機チェックリスト §6 項目0〜8 (17_戻る挙動テスト表_20261014.md) を
// 素のPlaywright(spec経由しない)で本番/任意URLに対して確認する。#292 の prod292.mjs の型を踏襲し、
// tests/e2e/helpers/checklist-timing-core.mjs の observe()/judge() で時間差の挙動まで機械判定する。
// 使い方:
//   node scripts/verify/checklist295.mjs [URL] [chromium|webkit] [case正規表現]
//   既定: URL=https://asayake.org/bookshelf/ ・ chromium(実Chrome) ・ 全ケース
// NG時は tmp/verify-shots/295/<browserType>-<host>/<case>/ に連続スクショを残す。
import { chromium, webkit } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { observe, judge, snapState } from '../../tests/e2e/helpers/checklist-timing-core.mjs';

const URL = process.argv[2] || 'https://asayake.org/bookshelf/';
const browserType = process.argv[3] || 'chromium';
const filter = new RegExp(process.argv[4] || '.', 'i');
const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const hostTag = URL.includes('localhost') ? 'local' : 'prod';
const OUT = `tmp/verify-shots/295/${browserType}-${hostTag}`;
mkdirSync(OUT, { recursive: true });

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }
async function back(page) { await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await settle(page); }
async function forward(page) { await page.goForward({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await settle(page); }
async function tap(page, selector) { const l = page.locator(selector).first(); await l.waitFor({ state: 'visible', timeout: 6000 }); await l.tap(); }
async function firstBook(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        const b = (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
        return b ? b.asin : null;
    });
}
async function shelfInfo(page) {
    return page.evaluate(() => {
        const sh = window.bookshelf.userData.bookshelves.find((b) => !b.isSpecial);
        return { id: sh.id };
    });
}
async function toShelf(page) { const { id } = await shelfInfo(page); await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id); await settle(page, 600); }
async function openArticleList(page) { await page.evaluate(() => window.bookshelf.openPublishPagesModal()); await page.waitForSelector('#publish-pages-modal.show', { timeout: 5000 }); }
async function openNewArticleEdit(page) {
    await openArticleList(page);
    await tap(page, '#art-new');
    await page.fill('#art-title', 'チェックリスト295');
    await tap(page, '#art-mode-edit');
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}
async function openMemo(page) {
    const asin = await firstBook(page);
    await page.evaluate(async (a) => {
        const bs = window.bookshelf;
        const b = bs.bookManager.getAllBooks().find((x) => x.asin === a);
        await bs._openBookMemoInAppEditor(a, b);
    }, asin);
    await page.waitForSelector('#book-memo-modal.show', { timeout: 5000 });
    await page.waitForFunction(() => !!document.querySelector('#book-memo-modal .EasyMDEContainer'), null, { timeout: 10000 }).catch(() => {});
}

const results = [];
function record(id, verdict) {
    results.push({ id, ok: verdict.ok, forbiddenFrame: verdict.forbiddenFrame, driftFrame: verdict.driftFrame, reasons: verdict.reasons, frames: verdict.frames });
    console.log(`[${browserType}][${hostTag}] ${id}: ${verdict.ok ? 'OK' : 'NG'} ${verdict.ok ? '' : verdict.reasons.join(' / ')}`);
}

// 1ケース毎に freshPage() で新しいタブ+アプリ再起動から始める (test runner の page フィクスチャが
// テスト毎に新規生成されるのを素の Playwright で再現する)。setupAndAct はそのページに対して
// ブート直後からの全手順を行う自己完結クロージャ。
async function runCase(id, judgeOpts, setupAndAct, freshPage) {
    if (!filter.test(id)) return;
    let p = await freshPage();
    await setupAndAct(p);
    let recs = await observe(p, { ms: judgeOpts.ms ?? 3000, step: judgeOpts.step ?? 100 });
    let verdict = judge(recs, judgeOpts);
    if (!verdict.ok) {
        // 再現: もう一度ブートして同じ手順を踏み、連続スクショつきで記録する
        p = await freshPage();
        await setupAndAct(p);
        const dir = `${OUT}/${id}`;
        mkdirSync(dir, { recursive: true });
        recs = await observe(p, { ms: judgeOpts.ms ?? 3000, step: judgeOpts.step ?? 100, dir });
        verdict = judge(recs, judgeOpts);
        writeFileSync(`${dir}/_result.json`, JSON.stringify({ id, verdict, records: recs }, null, 1));
    }
    record(id, verdict);
    return p;
}

(async () => {
    const launcher = browserType === 'webkit' ? webkit : chromium;
    const launchOpts = browserType === 'webkit' ? { headless: true } : { headless: true, channel: 'chrome' };
    const browser = await launcher.launch(launchOpts);
    let page;
    const pageErrors = [];

    async function bootApp(p) {
        p.on('pageerror', (e) => pageErrors.push(String(e)));
        await p.addInitScript(([userData, library]) => {
            localStorage.setItem('virtualBookshelf_userData', userData);
            localStorage.setItem('virtualBookshelf_library', library);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        }, [fixtureUserData, fixtureLibrary]);
        await p.goto(URL, { waitUntil: 'load', timeout: 30000 });
        await p.waitForFunction(() => window.bookshelf && window.bookshelf.userData, { timeout: 20000 });
        await p.evaluate(() => {
            window.bookshelf.saveUserData = async () => {};
            const mem = new Map();
            const adapter = window.bookshelf.storage.adapter;
            adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
            adapter.writeJSON = async (path, d) => { mem.set(path, JSON.parse(JSON.stringify(d))); };
            adapter.readText = async (path) => (mem.has(path) ? mem.get(path) : null);
            adapter.writeText = async (path, t) => { mem.set(path, t); };
            window.bookshelf._isSyncReady = () => true;
            if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
        });
    }
    async function freshPage() {
        if (page) await page.close().catch(() => {});
        page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
        await bootApp(page);
        return page;
    }

    await freshPage();
    // ?v= 確認 (本番の版を記録に残す)
    const srcs = await page.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map((e) => e.src));
    const bsJs = srcs.find((s) => s.includes('/js/bookshelf.js'));
    console.log(`[${browserType}][${hostTag}] version: ${bsJs}`);

    await runCase('CHK0', { ms: 3000, expectFinal: { hash: (h) => h.includes('book/') }, forbidden: (r) => r.hash === '' || r.hash === '#/' }, async (p) => {
        await toShelf(p);
        const asin = await firstBook(p);
        await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(p, 600);
        await back(p);
        await settle(p, 300);
        await forward(p);
    }, freshPage);

    await runCase('CHK1', { ms: 3000, forbidden: (r) => r.drawer || r.openModals.length > 0 }, async (p) => {
        await p.evaluate(() => window.bookshelf._openDrawer());
        await settle(p);
        await toShelf(p);
        await back(p);
    }, freshPage);

    let y0;
    await runCase('CHK2', { ms: 3000, forbidden: (r) => r.openModals.length > 0 || r.detailPinned }, async (p) => {
        await toShelf(p);
        await p.evaluate(() => { const el = document.scrollingElement; el.scrollTop = Math.min(300, el.scrollHeight); });
        y0 = await p.evaluate(() => document.scrollingElement.scrollTop);
        const asin = await firstBook(p);
        await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(p, 600);
        await back(p);
    }, freshPage);

    const chk3Page = await runCase('CHK3', { ms: 3000, expectFinal: { openModals: (m) => !m.includes('book-memo-modal') }, forbidden: (r) => r.openModals.includes('book-memo-modal') }, async (p) => {
        await openMemo(p);
        await p.evaluate(() => { const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor; if (ed) ed.value('戻る295保存'); });
        await back(p);
    }, freshPage);
    // 時間差本番: 再度開いて文字が残っているか (CHK3 が使ったページをそのまま使う)
    await openMemo(chk3Page);
    const persisted = await chk3Page.evaluate(() => { const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor; return ed ? ed.value() : null; });
    console.log(`[${browserType}][${hostTag}] CHK3-persist: ${persisted === '戻る295保存' ? 'OK' : 'NG'} ${persisted}`);
    results.push({ id: 'CHK3-persist', ok: persisted === '戻る295保存' });

    await runCase('CHK4', { ms: 3000, expectFinal: { headingMenuOpen: false, openModals: (m) => m.includes('book-memo-modal') }, forbidden: (r) => !r.openModals.includes('book-memo-modal') }, async (p) => {
        await openMemo(p);
        await tap(p, '#book-memo-modal .mde-heading-btn');
        await p.waitForSelector('.mde-heading-menu', { state: 'visible', timeout: 5000 });
        await back(p);
    }, freshPage);

    await runCase('CHK5', { ms: 3000, expectFinal: { openModals: (m) => m.length === 0 } }, async (p) => {
        await openNewArticleEdit(p);
        const frame = p.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().tap();
        await tap(p, '#art-add-sheet [data-block-type="text"]');
        await p.waitForSelector('#art-edit-view[data-art-mode="form"]', { timeout: 5000 });
        await back(p);
        await back(p);
        await back(p);
        await back(p);
    }, freshPage);

    await runCase('CHK6', { ms: 3000 }, async (p) => {
        await toShelf(p);
        await openNewArticleEdit(p);
        await p.evaluate(() => document.getElementById('publish-pages-close').click());
        await settle(p, 800);
        await back(p);
    }, freshPage);

    await runCase('CHK7', { ms: 3000, expectFinal: { openModals: (m) => !m.includes('settings-modal') && m.includes('publish-pages-modal') } }, async (p) => {
        await openNewArticleEdit(p);
        const pub = p.locator('#art-publish-header:visible, #art-bar-publish:visible').first();
        await pub.tap();
        await p.waitForSelector('#art-publish-modal.show', { timeout: 5000 });
        const link = p.locator('#art-publish-modal .art-pub-link[data-settings]').first();
        await link.tap();
        await settle(p, 600);
        await back(p);
        await back(p);
    }, freshPage);

    await runCase('CHK8', { ms: 3000, expectFinal: { openModals: (m) => !m.includes('settings-modal') } }, async (p) => {
        await p.evaluate(() => window.bookshelf._openSettingsModal());
        await tap(p, '#settings-master .settings-cat[data-cat="display-section"]');
        await back(p);
        await back(p);
    }, freshPage);

    // 項目9: CHK0〜8 の観測すべてから「禁止状態の出現」を横断集計する (独立テストにはしない)
    const chk9 = {
        anyForbiddenFlash: results.filter((r) => r.forbiddenFrame !== null && r.forbiddenFrame !== undefined),
        anyDelayedDrift: results.filter((r) => r.driftFrame !== null && r.driftFrame !== undefined),
    };
    writeFileSync(`${OUT}/_summary.json`, JSON.stringify({ url: URL, browserType, version: bsJs, results, chk9, pageErrors }, null, 1));
    const allOk = results.every((r) => r.ok) && pageErrors.length === 0;
    console.log('PAGE_ERRORS', JSON.stringify(pageErrors));
    console.log('ALL_OK', allOk);
    await browser.close();
    process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
