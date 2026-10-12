// イシュー#281 step2: 実装後のEasyMDEツールバー(アイコン+ラベル縦並び)を実機で実測する。
// 3場面: 長文メモ390 / PC右ペイン(文章ブロック) / 長文メモ1280。
// 各ボタンの top 一致(=1段)・w/h>=44・ラベル scrollWidth<=clientWidth を確認する。
// 実行: node scripts/verify/281-toolbar-iconized.mjs [BASE]  (既定 http://localhost:8000/)
import { chromium } from '../../node_modules/playwright/index.mjs';
import { resolveBase, logLoadedVersion } from './verify-common.mjs';

const BASE = resolveBase(process.argv[2]).replace(/\/$/, '');

const BOOKS = [['B0FIX00001', '三体', '劉慈欣']];
const library = {
    books: BOOKS.map(([asin, title, authors], i) => ({ asin, title, authors, acquiredTime: 1727000000000 + i, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1727000000000 })),
    metadata: { lastImportDate: 1727000000000, totalBooks: BOOKS.length },
};
const userData = {
    bookshelves: [{ id: 'all', name: 'すべての本', books: BOOKS.map(b => b[0]), isSpecial: true, internalId: 'all' }],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
};
const FIXTURE_ARTICLES = {
    articles: [{
        id: 'art_fix1', slug: 'fix1', publicId: 'Ab3dEf7hIj', title: '検証記事', tags: [],
        blocks: [{ id: 'blk_t1', type: 'text', markdown: '本文' }],
        theme: { layout: 'book-a-shelf-a', color: 'paper' }, sourceShelfId: null, published: false,
        createdAt: 1727000000000, updatedAt: 1727000000000, lastBuiltAt: 1727000000000,
    }],
};

async function launch({ pc = false } = {}) {
    const browser = await chromium.launch({ channel: 'chrome' });
    const ctxOpts = pc
        ? { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'ja-JP' }
        : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'ja-JP' };
    const ctx = await browser.newContext(ctxOpts);
    await ctx.route(/accounts\.google\.com|googlesyndication|doubleclick|hub\.asayake\.org/, r => r.abort());
    return { browser, ctx };
}

async function boot(page) {
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await logLoadedVersion(page);
    await page.evaluate((arts) => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        const mem = new Map([['private/publish/articles.json', arts]]);
        const a = app.storage.adapter;
        a.readJSON = async p => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        a.readText = async p => (mem.has(p) ? mem.get(p) : null);
        a.writeText = async (p, t) => { mem.set(p, t); };
        app._isSyncReady = () => true;
        if (app.publishArticleStore) app.publishArticleStore._articles = null;
    }, FIXTURE_ARTICLES);
}

async function openMemo(page, asin = BOOKS[0][0]) {
    await page.evaluate(async (a) => {
        const app = window.bookshelf;
        const book = app.books.find(b => b.asin === a);
        await app._openBookMemoInAppEditor(a, book);
    }, asin);
    await page.waitForSelector('#book-memo-modal.show .editor-toolbar.mde-iconized', { timeout: 8000 });
}

async function openTextBlockInPane(page, articleId = 'art_fix1', blockId = 'blk_t1') {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.waitForSelector('.pp-row, #art-new', { timeout: 5000 });
    await page.locator(`.pp-row[data-id="${articleId}"] [data-act="edit"]`).click();
    await page.waitForFunction(() => {
        const f = document.getElementById('art-canvas-frame');
        return f && f.contentDocument && f.contentDocument.querySelector('.article');
    }, null, { timeout: 8000 });
    await page.waitForTimeout(250);
    await page.click('#art-mode-edit');
    await page.waitForFunction(() => {
        const f = document.getElementById('art-canvas-frame');
        return f && f.contentDocument && f.contentDocument.querySelector('.art-cv-ins-btn');
    }, null, { timeout: 5000 });
    await page.evaluate((id) => window.bookshelf._artEditBlock(id), blockId);
    await page.waitForSelector('.art-fs-text-editor .editor-toolbar.mde-iconized', { timeout: 8000 });
}

// 実測: ボタンのtop一致(=1段)・各w/h>=44・ラベルscrollWidth<=clientWidth
async function measure(page, toolbarSel) {
    return page.evaluate((sel) => {
        const toolbar = document.querySelector(sel);
        if (!toolbar) return { error: `toolbar not found: ${sel}` };
        const btns = [...toolbar.querySelectorAll('button')];
        const rects = btns.map(b => b.getBoundingClientRect());
        const tops = new Set(rects.map(r => Math.round(r.top)));
        const dims = rects.map(r => ({ w: Math.round(r.width), h: Math.round(r.height) }));
        const minW = Math.min(...dims.map(d => d.w));
        const minH = Math.min(...dims.map(d => d.h));
        const labelOverflow = btns.map(b => {
            const lbl = b.querySelector('.mde-tb-lbl');
            if (!lbl) return null;
            return lbl.scrollWidth > lbl.clientWidth + 1; // +1px の丸め誤差許容
        });
        const hasIcon = btns.every(b => !!b.querySelector('.mde-tb-ico svg'));
        const hasLabel = btns.every(b => !!b.querySelector('.mde-tb-lbl'));
        return {
            count: btns.length, rows: tops.size, minW, minH,
            anyLabelOverflow: labelOverflow.some(Boolean), labelOverflowDetail: labelOverflow,
            hasIcon, hasLabel,
            toolbarBox: { w: Math.round(toolbar.getBoundingClientRect().width), h: Math.round(toolbar.getBoundingClientRect().height) },
        };
    }, toolbarSel);
}

const out = {};

// 1) 長文メモ390
{
    const { browser, ctx } = await launch();
    const page = await ctx.newPage();
    await boot(page);
    await openMemo(page);
    out.memo390 = await measure(page, '#book-memo-modal .editor-toolbar.mde-iconized');
    await browser.close();
}

// 2) PC右ペイン (文章ブロック, 1280幅内の416pxペイン)
{
    const { browser, ctx } = await launch({ pc: true });
    const page = await ctx.newPage();
    await boot(page);
    await openTextBlockInPane(page);
    out.textblockPane1280 = await measure(page, '.art-fs-text-editor .editor-toolbar.mde-iconized');
    await browser.close();
}

// 3) 長文メモ1280 (PC全幅・14ボタン)
{
    const { browser, ctx } = await launch({ pc: true });
    const page = await ctx.newPage();
    await boot(page);
    await openMemo(page);
    out.memo1280 = await measure(page, '#book-memo-modal .editor-toolbar.mde-iconized');
    await browser.close();
}

console.log(JSON.stringify(out, null, 1));
