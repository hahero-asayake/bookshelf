// イシュー#505 (U2) step3: 画像基準54枚のうちchar-820で差が出た7枚の、修正前後比較画像を作る
// (#277/#337のcompose.mjsと同じ技法=Playwright+HTMLでCJKフォント問題を回避)。
// 入力: test-results-visual/<testディレクトリ>/<name>-{expected,actual}.png
//   (expected=修正前の基準画像・origin/mainの振る舞い、actual=修正後の現在の描画)
// 出力: docs/char/u2-820-compare.png (commitする場所)
import { chromium } from '../../node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SHOT_DIR = join(REPO, 'test-results-visual');
const OUT_PATH = join(REPO, 'docs/char/u2-820-compare.png');

const ROWS = [
    { dir: 'screens-ホーム-char-820', name: '01-home', caption: '① ホーム' },
    { dir: 'screens-ホームの編集-char-820', name: '02-home-edit', caption: '② ホームの編集(dashboardウィジェット)' },
    { dir: 'screens-本棚の一覧-char-820', name: '03-bookshelf-list', caption: '③ 本棚の一覧' },
    { dir: 'screens-本の詳細-char-820', name: '04-book-detail', caption: '④ 本の詳細' },
    { dir: 'screens-設定の一覧-char-820', name: '05-settings-list', caption: '⑤ 設定の一覧' },
    { dir: 'screens-設定の1節-char-820', name: '06-settings-section', caption: '⑥ 設定の1節' },
    { dir: 'screens-記事の一覧-char-820', name: '07-article-list', caption: '⑦ 記事の一覧' },
];

function img(dir, name, kind) {
    const p = join(SHOT_DIR, dir, `${name}-${kind}.png`);
    if (!existsSync(p)) return null;
    return `file://${p}`;
}

function cell(src, label, color) {
    if (!src) return `<div style="width:246px;height:354px;display:flex;align-items:center;justify-content:center;color:#999;border:1px dashed #ccc;">(画像なし)</div>`;
    return `<div>
        <div style="font-size:12px;font-weight:700;color:${color};margin-bottom:4px;">${label}</div>
        <img src="${src}" style="width:246px;height:354px;object-fit:contain;display:block;border:1px solid #ddd;border-radius:4px;background:#fff;">
    </div>`;
}

function row({ dir, name, caption }) {
    const before = img(dir, name, 'expected');
    const after = img(dir, name, 'actual');
    return `<div style="margin-bottom:24px;">
        <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">${caption}</div>
        <div style="display:flex;gap:16px;align-items:flex-start;">
            ${cell(before, '修正前 (769〜900pxはJS/CSSの境目がまだら)', '#555')}
            ${cell(after, '修正後 (境目を900pxの1組に統一)', '#1455c4')}
        </div>
    </div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin:0; padding:20px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP",sans-serif; background:#fff; width:600px; }
    h1 { font-size:18px; margin:0 0 6px; }
    p { font-size:13px; color:#555; margin:0 0 16px; }
</style></head><body>
    <h1>イシュー#505 (U2): 画面の切り替わる幅を900pxに統一 — char-820(820px幅)の修正前後比較</h1>
    <p>画像基準54枚のうち、差が出たのはこの7枚(char-820のみ)。769〜900px以外の幅には差が出ていない(e2e-diff-main.mjs・playwright.visual.config.jsで確認)。</p>
    ${ROWS.map(row).join('')}
</body></html>`;

const htmlPath = join(SHOT_DIR, '.tmp-compare-505.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
const bodyBox = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
});
await page.setViewportSize(bodyBox);
await page.waitForTimeout(80);
await page.screenshot({ path: OUT_PATH });
console.log('→', OUT_PATH);
await browser.close();
