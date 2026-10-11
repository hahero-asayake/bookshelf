// イシュー#276 差し戻し対応: raw/.raw-276-{before,after}-*.png を左右に並べ、赤枠+日本語キャプションを付けて
// tmp/verify-shots/276-pair-*.png を作る (#277のcompose.mjsと同じ技法=Playwright+HTMLでCJKフォント問題を回避)。
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SHOT_DIR = join(REPO, 'tmp/verify-shots');
const W = 390, H = 844;

const img = (name) => `file://${join(SHOT_DIR, `.raw-276-${name}.png`)}`;

// 赤枠の近似座標 (実測ベース・390x844基準)
const BOXES = {
    header: { x: 0, y: 0, width: 390, height: 70 },
    addband: { x: 70, y: 175, width: 250, height: 50 },
    bottombar: { x: 0, y: 782, width: 390, height: 62 },
    textfs: { x: 0, y: 0, width: 390, height: 60 },
    kbbar: { x: 0, y: 455, width: 390, height: 55 },
};
const CAPTIONS = {
    header: 'ヘッダーを「タイトル(1行目)+状態表示(2行目)」の2段にした',
    addband: 'ブロック間の「+」を28pxアイコン→「+ ここに追加」44px以上の帯にした',
    bottombar: '下部に「追加・見た目・公開(または更新)・完了」の44px以上アクションバーを新設した',
    textfs: '文章ブロックの編集を、長文メモと同じEasyMDEの全画面エディタに統一した',
    kbbar: 'キーボード表示中は下部バーを隠し、直上に「確定」の補助バーを出す',
};

function cell(src, box) {
    const boxHtml = box ? `<div style="position:absolute; left:${box.x}px; top:${box.y}px; width:${box.width}px; height:${box.height}px; border:3px solid #e8392b; border-radius:5px; box-sizing:border-box; pointer-events:none;"></div>` : '';
    return `<div style="position:relative; width:${W}px; height:${H}px; overflow:hidden; border:1px solid #ddd; background:#fff; border-radius:6px;">
        <img src="${src}" style="position:absolute; left:0; top:0; width:${W}px; display:block;">
        ${boxHtml}
    </div>`;
}
function row(beforeSrc, afterSrc, box) {
    return `<div style="display:flex; gap:10px;">
        <div><div style="font-size:14px; font-weight:700; color:#555; margin-bottom:4px; text-align:center;">修正前 (941a41c)</div>${cell(beforeSrc, null)}</div>
        <div><div style="font-size:14px; font-weight:700; color:#1455c4; margin-bottom:4px; text-align:center;">修正後</div>${cell(afterSrc, box)}</div>
    </div>`;
}
function page(caption, rowHtml) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin:0; padding:14px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP",sans-serif; background:#fff; width:826px; }
        .cap { font-size:16px; font-weight:700; color:#1a1a1a; margin-bottom:10px; }
    </style></head><body><div class="cap">${caption}</div>${rowHtml}</body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const tmpFiles = [];
for (const name of Object.keys(CAPTIONS)) {
    const html = page(CAPTIONS[name], row(img(`before-${name}`), img(`after-${name}`), BOXES[name]));
    const htmlPath = join(SHOT_DIR, `.tmp-pair-${name}.html`);
    writeFileSync(htmlPath, html);
    tmpFiles.push(htmlPath);
    const page_ = await ctx.newPage();
    await page_.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await page_.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
    const bodyBox = await page_.evaluate(() => {
        const r = document.body.getBoundingClientRect();
        return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    });
    await page_.setViewportSize(bodyBox);
    await page_.waitForTimeout(80);
    const outPath = join(SHOT_DIR, `276-pair-${name}.png`);
    await page_.screenshot({ path: outPath });
    console.log(name, '→', outPath);
    await page_.close();
}
await browser.close();

const trash = join(REPO, '_trash');
mkdirSync(trash, { recursive: true });
for (const f of tmpFiles) { try { renameSync(f, join(trash, f.split('/').pop())); } catch {} }
console.log('完了');
