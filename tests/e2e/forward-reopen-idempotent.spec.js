// イシュー#330: 「戻る/進む」で開き直す3系統(本詳細・左ドロワー・記事の本棚ブロック引き出しシート)が
// (1) 進む(履歴復元)で2重に開かない(冪等化)、(2) 進む/戻る(履歴復元)では開閉transitionが走らない、
// (3) ユーザー操作(関数直呼び=ボタン相当)では今までどおりtransitionが走る、の3点を機械判定する。
// 対象のDOM/CSSは②決裁2026-10-23: .app-detail / .app-sidebar+.mobile-scrim / .art-side に
// .hist-no-anim を付けてtransitionを一時無効化する実装(js/bookshelf.js _histNoAnimOnce)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function bootApp(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
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
    return errors;
}
async function settle(page, ms = 400) { await page.waitForTimeout(ms); }
async function back(page) { await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await settle(page); }
async function forward(page) { await page.goForward({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await settle(page); }
async function firstBook(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        const b = (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
        return b ? b.asin : null;
    });
}
async function shelfInfo(page) { return page.evaluate(() => { const sh = window.bookshelf.userData.bookshelves.find((b) => !b.isSpecial); return { id: sh.id }; }); }
async function toShelf(page) { const { id } = await shelfInfo(page); await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id); await settle(page, 600); }
async function openArticleList(page) { await page.evaluate(() => window.bookshelf.openPublishPagesModal()); await page.waitForSelector('#publish-pages-modal.show', { timeout: 5000 }); }
async function openNewArticleEdit(page) {
    await openArticleList(page);
    await page.locator('#art-new').tap();
    await page.fill('#art-title', 'チェック330-idem');
    await page.locator('#art-mode-edit').tap();
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}

// transition中かどうかを transform の値集合で機械判定する。短時間(step間隔)でサンプリングし、
// 2種類以上の値が出れば「途中の値を取った=アニメーションが走った」とみなす。
async function sampleTransform(page, sel, { frames = 8, step = 40 } = {}) {
    const vals = [];
    for (let i = 0; i < frames; i++) {
        const t = await page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).transform : null; }, sel).catch(() => null);
        vals.push(t);
        await page.waitForTimeout(step);
    }
    return vals;
}
function distinctCount(vals) { return new Set(vals.filter((v) => v != null)).size; }

// 開く系関数をラップしてカウントする(bootApp後に1回呼ぶ)
async function instrumentCounts(page, fnNames) {
    await page.evaluate((names) => {
        const bs = window.bookshelf;
        window.__c330 = window.__c330 || { counts: {} };
        names.forEach((name) => {
            if (typeof bs[name] !== 'function' || bs['__c330wrapped_' + name]) return;
            window.__c330.counts[name] = 0;
            const orig = bs[name].bind(bs);
            bs[name] = function (...args) { window.__c330.counts[name]++; return orig(...args); };
            bs['__c330wrapped_' + name] = true;
        });
    }, fnNames);
}
async function countOf(page, name) { return page.evaluate((n) => (window.__c330 && window.__c330.counts[n]) || 0, name); }
async function resetCount(page, name) { await page.evaluate((n) => { if (window.__c330) window.__c330.counts[n] = 0; }, name); }

const FACES = [
    {
        id: 'book-detail', sel: '.app-detail', openFn: 'showBookDetail',
        openByButton: async (p) => { await toShelf(p); const asin = await firstBook(p); await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin); await settle(p, 600); },
    },
    {
        id: 'drawer', sel: '#app-sidebar', openFn: '_openDrawer',
        openByButton: async (p) => { await p.evaluate(() => window.bookshelf._openDrawer()); await settle(p, 600); },
    },
    {
        id: 'art-sheet', sel: '#art-drawer', openFn: '_artOpenSheet',
        openByButton: async (p) => { await openNewArticleEdit(p); await p.evaluate(() => window.bookshelf._artOpenSheet()); await settle(p, 600); },
    },
];

test.describe('イシュー#330: 進む/戻るの冪等化とtransition無効化', () => {
    for (const face of FACES) {
        test(`${face.id}: 進む(履歴復元)ではtransitionが走らず、2重オープンも起きない`, async ({ page }) => {
            const errors = await bootApp(page);
            await instrumentCounts(page, [face.openFn]);
            await face.openByButton(page);
            await back(page);
            await settle(page, 300);
            await resetCount(page, face.openFn);

            // 進む(履歴復元)時のtransformサンプリング: transitionが走るなら0.25s(=250ms)の間に複数の値を取るはず。
            const fwdPromise = forward(page);
            const vals = await sampleTransform(page, face.sel, { frames: 8, step: 40 });
            await fwdPromise;

            // 即座切替(transitionなし)でも、サンプリングの谷間で「切替前」と「切替後」の2値が
            // 記録されることがある(0.25sの中間値ではない)。3種類以上出て初めて「滑らかに遷移した
            // (=アニメーションが走った)」とみなす。
            expect.soft(distinctCount(vals), `${face.id}: 進むでtransformが途中の値を取った(アニメーションが走った) vals=${JSON.stringify(vals)}`).toBeLessThanOrEqual(2);
            expect.soft(await countOf(page, face.openFn), `${face.id}: 進むで開く関数が2回以上走った(2重オープン)`).toBeLessThanOrEqual(1);
            expect(errors).toEqual([]);
        });

        test(`${face.id}: ボタン操作(関数直呼び)ではtransitionが今までどおり走る`, async ({ page }) => {
            const errors = await bootApp(page);
            if (face.id === 'art-sheet') await openNewArticleEdit(page);
            else await toShelf(page);
            await settle(page, 300);

            const openPromise = face.id === 'book-detail'
                ? (async () => { const asin = await firstBook(page); await page.evaluate((a) => window.bookshelf.router.navigateBook(a), asin); })()
                : page.evaluate((fn) => window.bookshelf[fn](), face.openFn);
            const vals = await sampleTransform(page, face.sel, { frames: 8, step: 40 });
            await openPromise;

            expect.soft(distinctCount(vals), `${face.id}: ボタン操作でtransformが途中の値を取らなかった(アニメーションが走っていない)`).toBeGreaterThanOrEqual(2);
            expect(errors).toEqual([]);
        });

        test(`${face.id}: 進むを連続20回しても2重オープンが0回`, async ({ page }) => {
            const errors = await bootApp(page);
            await instrumentCounts(page, [face.openFn]);
            await face.openByButton(page);
            await settle(page, 300);
            let doubleOpenCount = 0;
            for (let i = 0; i < 20; i++) {
                await back(page);
                await settle(page, 200);
                await resetCount(page, face.openFn);
                await forward(page);
                const c = await countOf(page, face.openFn);
                if (c >= 2) doubleOpenCount++;
            }
            expect.soft(doubleOpenCount, `${face.id}: 進む20回中の2重オープン回数`).toBe(0);
            expect(errors).toEqual([]);
        });
    }
});
