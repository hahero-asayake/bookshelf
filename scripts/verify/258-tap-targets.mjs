// イシュー#258: モバイルのタップ領域を44pxに (バナー×・詳細編集・Amazonで見る・公開フッタリンク)
// #232の型(position:relative + ::after)の適用結果を390px幅で実測する検証ハーネス。
// 実行: node scripts/verify/258-tap-targets.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolveShotDir, logLoadedVersion } from './verify-common.mjs';

const SHOT_DIR = resolveShotDir();
mkdirSync(SHOT_DIR, { recursive: true });

const b = await chromium.launch();

// ---- (1)(2)(3) 本体アプリ (バナー×は Android UA + showDirectoryPicker 削除で表示条件を作る) ----
const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
});
await ctx.addInitScript(() => { try { delete window.showDirectoryPicker; } catch (e) {} });
const page = await ctx.newPage();
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await logLoadedVersion(page);
await page.waitForTimeout(2500);

const bannerResult = await page.evaluate(() => {
    const el = document.getElementById('mobile-setup-banner-close');
    const titleEl = document.querySelector('#mobile-setup-banner-msg');
    const bannerEl = document.getElementById('mobile-setup-banner');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el, '::after');
    const tr = titleEl ? titleEl.getBoundingClientRect() : null;
    return {
        found: true,
        display: bannerEl ? getComputedStyle(bannerEl).display : null,
        rect: { w: r.width, h: r.height, x: r.x, y: r.y },
        after: { content: cs.content, w: cs.width, h: cs.height },
        titleRect: tr ? { x: tr.x, y: tr.y, w: tr.width, h: tr.height } : null,
    };
});
await page.screenshot({ path: `${SHOT_DIR}/258-1-banner-after.png` });

await page.evaluate(() => {
    const app = window.bookshelf;
    const book = { asin: 'B00TEST0001', title: 'テストタイトルでやや長めの書名にしてみるテスト本', authors: 'テスト著者', acquiredTime: Date.now(), productImage: '' };
    if (!app.bookManager.library) app.bookManager.library = { books: [], metadata: {} };
    if (!app.bookManager.library.books) app.bookManager.library.books = [];
    app.bookManager.library.books.push(book);
    app.showBookDetail(book, false);
});
await page.waitForTimeout(800);

const detailResult = await page.evaluate(() => {
    function m(sel) {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el, '::after');
        return { found: true, rect: { w: r.width, h: r.height, x: r.x, y: r.y }, after: { content: cs.content, w: cs.width, h: cs.height } };
    }
    const title = document.querySelector('.bd-title');
    const tr = title ? title.getBoundingClientRect() : null;
    return { editToggle: m('.bd-edit-toggle'), amazonLink: m('.amazon-link'), titleRect: tr ? { x: tr.x, y: tr.y, w: tr.width, h: tr.height } : null };
});
await page.screenshot({ path: `${SHOT_DIR}/258-2-detail-after.png`, fullPage: true });
await ctx.close();

// ---- (4) 公開ページフッタ ----
// A) before と同条件 (siteHasAffiliate 未設定・通報リンクあり) = 位置ズレ確認用
// B) 最悪ケース (siteHasAffiliate:true で行数最大) = ::after 重なり確認用
async function renderFooter(opts) {
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await ctx2.newPage();
    await page2.goto('http://localhost:8000/', { waitUntil: 'load' });
    await page2.waitForTimeout(1500);
    const html = await page2.evaluate((o) => {
        const gen = new PublishArticleGenerator(null);
        const article = { title: 'テスト記事', tags: ['エッセイ'], theme: { layout: 'wall', color: 'blue' } };
        const body = '<p>本文サンプル</p>';
        return gen._wrapDoc(article, 'テスト発行者', body, o);
    }, opts);
    await page2.setContent(html, { waitUntil: 'load' });
    const result = await page2.evaluate(() => {
        const links = [...document.querySelectorAll('footer.pub-footer a')];
        return links.map(a => {
            const r = a.getBoundingClientRect();
            const cs = getComputedStyle(a, '::after');
            return { text: a.textContent, parentClass: a.parentElement.className, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, after: { content: cs.content, w: cs.width, h: cs.height } };
        });
    });
    return { page2, ctx2, result };
}

const footerSame = await renderFooter({
    updatedAt: Date.now(),
    reportAppUrl: 'https://asayake.org/bookshelf/?report=abc',
    canonical: 'https://asayake.org/bookshelf/testuser/test/',
});
await footerSame.page2.screenshot({ path: `${SHOT_DIR}/258-4-footer-after-samecond.png`, fullPage: true });
await footerSame.ctx2.close();

const footerWorst = await renderFooter({
    updatedAt: Date.now(),
    reportAppUrl: 'https://asayake.org/bookshelf/?report=abc',
    canonical: 'https://asayake.org/bookshelf/testuser/test/',
    siteHasAffiliate: true,
});
await footerWorst.page2.screenshot({ path: `${SHOT_DIR}/258-4-footer-after-worst.png`, fullPage: true });
await footerWorst.ctx2.close();

console.log(JSON.stringify({ bannerResult, detailResult, footerSame: footerSame.result, footerWorst: footerWorst.result }, null, 2));
await b.close();
