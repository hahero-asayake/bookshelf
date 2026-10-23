// イシュー#337: 修正前後の「並べ替え中」の見た目比較画像を作る (#277の型=Playwright+HTMLでCJKフォント問題を回避)。
// 入力: tmp/verify-shots/337/{before,after}/*.png (6面)
// 出力: tmp/verify-shots/337/337-compare.png (縦に6行、各行=before/afterを左右に並べる)
import { chromium } from '../../node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SHOT_DIR = join(REPO, 'tmp/verify-shots/337');

const ROWS = [
    { name: '1-tree', caption: '① サイドバーツリー: 「SF」を長押しでドラッグ中' },
    { name: '2-bookshelf-modal', caption: '② 本棚管理モーダル: ハンドルを長押しでドラッグ中' },
    { name: '3-plugin-card', caption: '③ プラグインカード: カードを長押しでドラッグ中' },
    { name: '4-header-utility', caption: '④ ヘッダーutility行: 通常表示 (HEADER_ITEMS_METAが空のためプラグインボタンのみ)' },
    { name: '5-plugin-button', caption: '⑤ プラグインボタン: 長押しでドラッグ中' },
    { name: '6-bd-section', caption: '⑥ bd-section(本詳細セクション・②承認で追加): グリップでドラッグ中' },
];

function img(label, name) {
    const p = join(SHOT_DIR, label, `${name}.png`);
    if (!existsSync(p)) return null;
    return `file://${p}`;
}

function cell(src, label, color) {
    if (!src) return `<div style="width:260px;height:120px;display:flex;align-items:center;justify-content:center;color:#999;border:1px dashed #ccc;">(画像なし)</div>`;
    return `<div>
        <div style="font-size:12px;font-weight:700;color:${color};margin-bottom:4px;">${label}</div>
        <img src="${src}" style="max-width:420px;max-height:360px;display:block;border:1px solid #ddd;border-radius:4px;">
    </div>`;
}

function row({ name, caption }) {
    const before = img('before', name);
    const after = img('after', name);
    return `<div style="margin-bottom:28px;">
        <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">${caption}</div>
        <div style="display:flex;gap:16px;align-items:flex-start;">
            ${cell(before, '修正前 (HTML5 Drag API)', '#555')}
            ${cell(after, '修正後 (Pointer Events)', '#1455c4')}
        </div>
    </div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin:0; padding:20px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP",sans-serif; background:#fff; width:980px; }
    h1 { font-size:18px; margin:0 0 16px; }
</style></head><body>
    <h1>イシュー#337: 本棚ツリー・プラグインカード等の並べ替えPointer Events化 — 修正前後比較</h1>
    ${ROWS.map(row).join('')}
</body></html>`;

const htmlPath = join(SHOT_DIR, '.tmp-compare.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
const bodyBox = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
});
await page.setViewportSize(bodyBox);
await page.waitForTimeout(80);
const outPath = join(SHOT_DIR, '337-compare.png');
await page.screenshot({ path: outPath });
console.log('→', outPath);
await browser.close();
