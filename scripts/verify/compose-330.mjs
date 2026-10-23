// イシュー#330 step5: 修正前/修正後の比較画像(本詳細・ドロワー・記事引き出しシートの3面・各1枚)。
// 上段=修正前(進む直後50ms・スライドイン途中)、下段=修正後(進む直後50ms・既に開ききっている)。
// 入力: tmp/verify-shots/330-compose/{before,after}/<face>/01.png (shot-330-compare.mjsで撮影済み)
// 出力: tmp/verify-shots/330-compose/pair-<face>.png
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '../..');
const BASE = join(ROOT, 'tmp/verify-shots/330-compose');

const FACES = [
    { id: 'book-detail', label: '本の詳細' },
    { id: 'drawer', label: '左メニュー(ドロワー)' },
    { id: 'art-sheet', label: '記事の本棚ブロック引き出しシート' },
];

function page(caption, beforeImg, afterImg) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin:0; padding:14px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans",sans-serif; background:#fff; width:420px; }
        .cap { font-size:15px; font-weight:700; color:#1a1a1a; margin-bottom:10px; }
        .row { margin-bottom: 10px; }
        .lbl { font-size:13px; font-weight:700; margin-bottom:4px; }
        .lbl.before { color:#c23a3a; }
        .lbl.after { color:#1455c4; }
        .frame { border:1px solid #ddd; border-radius:6px; overflow:hidden; width:390px; }
        img { display:block; width:390px; }
        .note { font-size:11px; color:#888; margin-top:6px; }
    </style></head><body>
        <div class="cap">${caption}(イシュー#330)</div>
        <div class="row">
            <div class="lbl before">修正前: 進む直後50ms(開くアニメーションの途中)</div>
            <div class="frame"><img src="${beforeImg}"></div>
        </div>
        <div class="row">
            <div class="lbl after">修正後: 進む直後50ms(既に開ききった状態)</div>
            <div class="frame"><img src="${afterImg}"></div>
        </div>
        <div class="note">※ 両方とも「本棚で開く→戻る→進む」の直後、同じ50ms時点のスクショ。修正前はスライドイン途中(二重表示の原因)、修正後は即座に開ききっている。</div>
    </body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const results = {};
for (const face of FACES) {
    const beforeImg = `file://${join(BASE, 'before', face.id, '01.png')}`;
    const afterImg = `file://${join(BASE, 'after', face.id, '01.png')}`;
    const html = page(face.label, beforeImg, afterImg);
    const htmlPath = join(BASE, `_tmp-${face.id}.html`);
    writeFileSync(htmlPath, html);
    const p = await ctx.newPage();
    await p.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const bodyBox = await p.evaluate(() => { const r = document.body.getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; });
    await p.setViewportSize(bodyBox);
    await p.waitForTimeout(100);
    const outPath = join(BASE, `pair-${face.id}.png`);
    await p.screenshot({ path: outPath });
    results[face.id] = outPath;
    await p.close();
    console.log(face.id, '->', outPath);
}
await browser.close();
mkdirSync(join(ROOT, '_trash'), { recursive: true });
writeFileSync(join(BASE, 'compose-report.json'), JSON.stringify(results, null, 2));
