// OGP 画像 (og.png・イシュー#213 S5・ADR-098) の実ブラウザ検証。
//  1) PublishOgpImage.render を実 Chromium で回し、ケース別に PNG を保存する (desktop 6 ケース + 390px 1 ケース)。
//     見た目は目視だけにせず座標・画素で測る: 左揃え線・タグ内文字の縦中央・フッターの基線・はみ出し・
//     余白ゾーンが背景 1 色のまま (=グラデーション無し) ・アクセント帯が単色。
//  2) 公開経路 (exporter.export → hub /publish をモック) を通して出力された files をディスクに書き出す。
//     → `python3 -m http.server --directory <OUT>/site` で配信して curl で meta / Content-Type を確認する。
// 実行: PLAYWRIGHT_BROWSERS_PATH=... node scripts/verify/og-shots.mjs [BASE=http://localhost:8000]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OG_OUT || join(here, '../../tmp/verify-shots/issue213');
const BASE = process.argv[2] || process.env.BASE || 'http://localhost:8000';
mkdirSync(join(OUT, 'site/hahero'), { recursive: true });

const LONG = '2026年に読み返したい、人生を変えた小説・エッセイ・漫画のベスト50冊と、その選び方のすべて〜初心者から上級者まで、迷ったらここから始めたい保存版の読書リスト〜';
const CASES = [
    { name: '1-typical-blue', viewport: [1280, 720], article: { title: 'わたしを構成する10冊', tags: ['エッセイ', '漫画'] }, color: 'blue' },
    { name: '2-long-title-orange', viewport: [1280, 720], article: { title: LONG, tags: ['小説', 'エッセイ', '漫画'] }, color: 'orange' },
    { name: '3-many-tags-green', viewport: [1280, 720], article: { title: '積読を減らす技術', tags: ['積読', 'ミステリー', 'SF', '歴史', '新書', '文庫', '洋書', '技術書'] }, color: 'green' },
    { name: '4-no-tags-white', viewport: [1280, 720], article: { title: 'タグの無い記事', tags: [] }, color: 'white' },
    { name: '5-black', viewport: [1280, 720], article: { title: '夜に読む本', tags: ['ホラー', 'SF'] }, color: 'black' },
    { name: '6-yellow', viewport: [1280, 720], article: { title: '黄色のテーマ', tags: ['実用書'] }, color: 'yellow' },
    { name: '7-mobile390-purple', viewport: [390, 844], article: { title: LONG, tags: ['小説', 'エッセイ', 'kindle'] }, color: 'purple' }
];

// ページ内で実行する測定 (render → 座標・画素の検査)
async function measure(page, c) {
    return page.evaluate(async ({ article, color }) => {
        const r = await PublishOgpImage.render(article, { color }, { publisher: 'hahero' });
        if (!r.ok) return { ok: false, reason: r.reason };
        const plan = r.plan;
        const cv = new OffscreenCanvas(10, 10); const x = cv.getContext('2d');
        const boxOf = (i) => {
            const bl = i.baseline || 'top';
            x.font = i.font; x.textAlign = i.align || 'left'; x.textBaseline = bl;
            const m = x.measureText(i.text);
            // 基線の y (alphabetic=y そのもの・top=y+ascent・middle=y+(ascent-descent)/2)
            const baseline = bl === 'alphabetic' ? i.y : bl === 'top' ? i.y + m.fontBoundingBoxAscent : i.y + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
            return { text: i.text, x: i.x, y: i.y, bl, size: parseFloat(/(\d+)px/.exec(i.font)[1]),
                inkL: i.x - m.actualBoundingBoxLeft, inkR: i.x + m.actualBoundingBoxRight,
                inkT: i.y - m.actualBoundingBoxAscent, inkB: i.y + m.actualBoundingBoxDescent,
                baseline, align: i.align || 'left' };
        };
        const texts = plan.items.filter(i => i.kind === 'text').map(boxOf);
        const pills = plan.items.filter(i => i.kind === 'pill');
        const title = texts.filter(t => t.size === 60);
        const tagTexts = texts.filter(t => t.size === 24);
        const foot = texts.filter(t => t.bl === 'alphabetic');
        const publisher = foot.find(t => t.align === 'left'); const site = foot.find(t => t.align === 'right');

        // 画素
        const bmp = await createImageBitmap(new Blob([r.bytes], { type: 'image/png' }));
        const cv2 = new OffscreenCanvas(bmp.width, bmp.height); const y2 = cv2.getContext('2d'); y2.drawImage(bmp, 0, 0);
        const data = y2.getImageData(0, 0, bmp.width, bmp.height).data;
        const hex = (i) => '#' + [data[i], data[i + 1], data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
        const zoneColors = (x0, y0, x1, y1) => { const s = new Set(); for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s.add(hex((yy * bmp.width + xx) * 4)); return [...s]; };
        const lastTitleBottom = Math.max(...title.map(t => t.inkB));
        const zones = {
            gapAccentToText: zoneColors(30, 0, 90, 630),
            gapTitleToTags: zoneColors(96, Math.ceil(lastTitleBottom) + 4, 1120, 372),
            gapTagsToDivider: zoneColors(96, 436, 1120, 496),
            rightMargin: zoneColors(1124, 0, 1200, 630),
            belowFooter: zoneColors(96, 596, 1120, 630),
            accentBar: zoneColors(0, 0, 24, 630)
        };
        const all = new Set(); for (let i = 0; i < data.length; i += 4) all.add(hex(i));
        const c = plan.colors;
        const flat = (arr, want) => arr.length === 1 && arr[0] === want;
        const checks = {
            leftAnchorTitleAllX96: title.every(t => t.x === 96),
            leftAnchorFirstPillX96: pills.length === 0 || pills[0].x === 96,
            leftAnchorPublisherX96: publisher.x === 96,
            dividerX96W1024: plan.items.some(i => i.kind === 'rect' && i.x === 96 && i.w === 1024 && i.h === 2),
            siteNameRightEdge1120: site.x === 1120,
            titleInkInsideText: title.every(t => t.inkL >= 90 && t.inkR <= 1120 + 1),
            titleAboveTags: lastTitleBottom < 380,
            pillsSameYH: pills.every(p => p.y === pills[0].y && p.h === pills[0].h),
            pillGaps14: pills.every((p, i) => i === 0 || p.x - (pills[i - 1].x + pills[i - 1].w) === 14),
            pillsInsideText: pills.every(p => p.x + p.w <= 1120),
            tagTextYIsPillCenter: tagTexts.every((t, i) => t.bl === 'middle' && t.y === pills[i].y + pills[i].h / 2),
            tagTextInsidePill: tagTexts.every((t, i) => t.inkL >= pills[i].x && t.inkR <= pills[i].x + pills[i].w),
            footerBaselineDelta: Math.abs(publisher.baseline - site.baseline),
            footerGap: site.inkL - publisher.inkR,
            inkInsideCanvas: texts.every(t => t.inkL >= 0 && t.inkR <= 1200 && t.inkT >= 0 && t.inkB <= 630),
            flatGapAccentToText: flat(zones.gapAccentToText, c.bg),
            flatGapTitleToTags: flat(zones.gapTitleToTags, c.bg),
            flatGapTagsToDivider: flat(zones.gapTagsToDivider, c.bg),
            flatRightMargin: flat(zones.rightMargin, c.bg),
            flatBelowFooter: flat(zones.belowFooter, c.bg),
            accentBarSingleColor: flat(zones.accentBar, c.acc)
        };
        // タグ内文字の縦中央 (ピル中心とインク中心の差)。「グリフの高さ」ではなくインク上下の中点で測る
        checks.tagTextCenterDelta = tagTexts.map((t, i) => Math.round(((t.inkT + t.inkB) / 2 - (pills[i].y + pills[i].h / 2)) * 10) / 10);
        // 本文の左端のインク (グリフのサイドベアリング分だけ 96 からずれる)
        const inkLeft = { title: title.map(t => Math.round(t.inkL * 10) / 10), publisher: Math.round(publisher.inkL * 10) / 10 };
        return { ok: true, base64: (() => { let b = ''; for (let i = 0; i < r.bytes.length; i += 0x8000) b += String.fromCharCode.apply(null, r.bytes.subarray(i, i + 0x8000)); return btoa(b); })(),
            size: r.bytes.length, hash: r.hash, colors: c, titleLines: plan.title.lines, titleTruncated: plan.title.truncated, tags: plan.tags,
            distinctColors: all.size, checks, inkLeft };
    }, { article: c.article, color: c.color });
}

const b = await chromium.launch();
const report = [];
for (const c of CASES) {
    const ctx = await b.newContext({ viewport: { width: c.viewport[0], height: c.viewport[1] } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => window.PublishOgpImage && window.ARTICLE_COLOR_TOKENS);
    const m = await measure(page, c);
    if (m.ok) writeFileSync(join(OUT, `og-${c.name}.png`), Buffer.from(m.base64, 'base64'));
    delete m.base64;
    report.push({ case: c.name, viewport: c.viewport.join('x'), ...m });
    await ctx.close();
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));

// ---- 公開経路 (exporter.export) を通した files をディスクへ ----
const fixtureUserData = readFileSync(join(here, '../../tests/fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../tests/fixtures/fixture-library.json'), 'utf-8');
const HUB = 'https://hub.example.test';
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
let captured = null;
await ctx.route(`${HUB}/**`, async (route) => {
    const u = route.request().url();
    if (u.includes('/publish')) { captured = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, siteUrl: 'https://bookshelf.asayake.org/hahero/' } }); }
    if (u.includes('/usage')) return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576 } });
    return route.fulfill({ status: 404, json: {} });
});
await page.addInitScript(([ud, lib, hub]) => {
    localStorage.setItem('virtualBookshelf_userData', ud); localStorage.setItem('virtualBookshelf_library', lib);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: { key: 'hk_abc123', apiBase: hub, email: 'test@example.com', plan: 'free', publicBase: `${hub}/public/sid/`, siteId: 'sid', username: 'hahero', bookshelfBase: 'https://bookshelf.asayake.org/hahero/' }, publish: { target: 'hub' } }));
}, [fixtureUserData, fixtureLibrary, HUB]);
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
await page.evaluate(([library, notes]) => {
    const mem = new Map();
    mem.set('private/library.json', library);
    mem.set('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
    mem.set('private/bookshelves/all.json', { books: library.books.map(b => b.asin) });
    mem.set('private/notes.json', { notes });
    const a = window.bookshelf.storage.adapter;
    a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
    a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
    window.bookshelf.flushSync = async () => {}; window.bookshelf._isSyncReady = () => true; window.bookshelf._scheduleSync = () => {};
}, [JSON.parse(fixtureLibrary), JSON.parse(fixtureUserData).notes]);
const publicId = await page.evaluate(async () => {
    const s = window.bookshelf.publishArticleStore;
    const a = await s.create({ title: 'わたしを構成する10冊', tags: ['エッセイ', '漫画'], published: true, theme: { layout: 'card', color: 'blue' },
        blocks: [{ type: 'text', markdown: '## はじめに\n\n人生で何度も読み返した本を、**10冊**だけ選びました。[出典](https://example.com)' }] });
    await s.ensurePublicId(a.id);
    await window.bookshelf.exporter.export();
    return s.get(a.id).publicId;
});
for (const f of captured.files) {
    const p = join(OUT, 'site/hahero', f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : f.content);
}
writeFileSync(join(OUT, 'publish-summary.json'), JSON.stringify({ publicId, deleteMissing: captured.deleteMissing, files: captured.files.map(f => ({ path: f.path, encoding: f.encoding || null, chars: f.content.length })), consoleErrors: errors }, null, 1));
await b.close();
console.log(JSON.stringify({ OUT, publicId, cases: report.length }));
