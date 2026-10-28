// イシュー#398 step4: 修正前後の比較画像 (2版配信の型を簡略化: 修正前は step3 で撮った
// タッチが一切反応しない状態のスクショ、修正後は _bindPointerReorder 導入後の実際の
// タッチ長押しドラッグのスクショ。同一コードベース内での前後比較のため、個別archive配信は
// 省略し、既存の確定スクショを並べる(389-compare.mjs等と同じcompose方式)。
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHOT_DIR = 'tmp/verify-shots/398';
const abs = (name) => `file://${join(process.cwd(), SHOT_DIR, name)}`;

function cell(src, label, color) {
    return `<div style="width:300px;">
        <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:6px;">${label}</div>
        <img src="${src}" style="width:100%;border:1px solid #ddd;border-radius:6px;display:block;">
    </div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin:0; padding:24px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP",sans-serif; background:#fff; width:1000px; color:#1a1a1a; }
    h1 { font-size:18px; margin:0 0 6px; }
    p.lead { color:#555; font-size:13px; margin:0 0 20px; }
    h2 { font-size:14px; margin:0 0 8px; }
</style></head><body>
    <h1>イシュー#398: スマホでのウィジェット並べ替え — 修正前後比較(案A: _bindPointerReorder)</h1>
    <p class="lead">390px・タッチ(chromium hasTouch)。修正前はHTML5 Drag APIのみでタッチでは一切反応しない(dragstartCount:0のまま並び順不変、実測済み)。修正後は長押し(450ms)でドラッグが始まり、他の並べ替え(本棚ツリー/本棚管理/プラグイン一覧)と同じゴースト追従+挿入線で並べ替えられる。</p>
    <div style="display:flex;gap:24px;">
        ${cell(abs('0-current-annotated.png'), '修正前: 長押ししても何も起きない(HTML5 DnDはタッチ非対応)', '#b91c1c')}
        ${cell(abs('after-dragging.png'), '修正後: 長押し中(ゴースト追従・挿入線で位置を示す)', '#1455c4')}
        ${cell(abs('after-result.png'), '修正後: ドロップ後、順序が変わって保存される', '#1455c4')}
    </div>
</body></html>`;

const htmlPath = join(SHOT_DIR, '.tmp-before-after.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`file://${join(process.cwd(), htmlPath)}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
const bodyBox = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
});
await page.setViewportSize(bodyBox);
await page.waitForTimeout(80);
const outPath = join(SHOT_DIR, '398-before-after.png');
await page.screenshot({ path: outPath });
console.log('→', outPath);
await browser.close();
