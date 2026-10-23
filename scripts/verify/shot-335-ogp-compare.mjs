// T11 (イシュー#335) OGP画像決裁用：モック画像 + X/Discord相当の共有プレビューを並べた比較画像を作る。
// 実サービスへの投稿はしない。
// 実行: node scripts/verify/shot-335-ogp-compare.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const OUT = join(ROOT, 'tmp/verify-shots');
mkdirSync(OUT, { recursive: true });

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function xCardHtml({ title, desc, imgDataUrl, domain }) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#15202b;font-family:-apple-system,"Hiragino Sans",sans-serif;padding:0;}
    .tweet{width:500px;background:#15202b;color:#fff;padding:20px;}
    .card{border:1px solid #38444d;border-radius:16px;overflow:hidden;}
    .card img{width:100%;height:262px;object-fit:cover;display:block;}
    .cardbody{padding:12px;}
    .domain{font-size:13px;color:#8899a6;}
    .ctitle{font-size:15px;color:#fff;margin-top:2px;font-weight:700;}
    .cdesc{font-size:13px;color:#8899a6;margin-top:2px;}
    </style></head><body><div class="tweet">
    <div class="card"><img src="${esc(imgDataUrl)}"><div class="cardbody">
      <div class="domain">${esc(domain)}</div>
      <div class="ctitle">${esc(title)}</div>
      <div class="cdesc">${esc(desc)}</div>
    </div></div>
    </div></body></html>`;
}

function discordHtml({ title, desc, imgDataUrl, domain }) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#313338;font-family:-apple-system,"Hiragino Sans",sans-serif;padding:0;}
    .msg{width:520px;padding:20px;}
    .embed{border-left:4px solid #5865f2;background:#2b2d31;border-radius:4px;padding:12px;}
    .site{font-size:12px;color:#949ba4;}
    .title{font-size:16px;color:#00a8fc;font-weight:600;margin-top:4px;}
    .desc{font-size:14px;color:#dbdee1;margin-top:6px;line-height:1.4;}
    .img{margin-top:10px;max-width:100%;border-radius:4px;display:block;max-height:260px;object-fit:cover;width:100%;}
    </style></head><body><div class="msg"><div class="embed">
    <div class="site">${esc(domain)}</div>
    <div class="title">${esc(title)}</div>
    <div class="desc">${esc(desc)}</div>
    <img class="img" src="${esc(imgDataUrl)}">
    </div></div></body></html>`;
}

const browser = await chromium.launch();

async function shotMock(htmlPath, outName) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.goto('file://' + htmlPath);
    const el = await page.$('#canvas');
    const file = join(OUT, outName);
    await el.screenshot({ path: file });
    await page.close();
    return file;
}

async function toDataUrl(pngPath) {
    const { readFileSync } = await import('node:fs');
    const b64 = readFileSync(pngPath).toString('base64');
    return `data:image/png;base64,${b64}`;
}

async function shotPreview(html, outName, viewport) {
    const page = await browser.newPage({ viewport });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const file = join(OUT, outName);
    await page.screenshot({ path: file, fullPage: true });
    await page.close();
    return file;
}

// compose 複数枚を横に並べて1枚にする (モック / X / Discord)。data URL化して渡す(file://はsetContent内で読めない罠)。
async function compose(paths, outName) {
    const { readFileSync } = await import('node:fs');
    const imgs = paths.map(p => {
        const b64 = readFileSync(p).toString('base64');
        return `<img src="data:image/png;base64,${b64}">`;
    }).join('');
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;display:flex;align-items:flex-start;">
      <style>img{display:block;border:1px solid #ddd;margin:12px;}</style>${imgs}
      </body></html>`);
    await page.waitForTimeout(200);
    const file = join(OUT, outName);
    await page.screenshot({ path: file, fullPage: true });
    await page.close();
    return file;
}

// ===== A/B共通: 案A/Bの共通ブランド画像 =====
const mockAB = await shotMock(join(ROOT, 'mockups/og-export.html'), '335-ogp-mockAB-raw.png');
const dataAB = await toDataUrl(mockAB);

const xAB = await shotPreview(
    xCardHtml({ title: 'AsayakeBookshelf', desc: '積読から読了まで、本棚ごと育てる読書ライブラリ', imgDataUrl: dataAB, domain: 'asayake.org' }),
    '335-ogp-mockAB-x-raw.png', { width: 540, height: 420 }
);
const discordAB = await shotPreview(
    discordHtml({ title: 'AsayakeBookshelf', desc: '積読から読了まで、本棚ごと育てる読書ライブラリ', imgDataUrl: dataAB, domain: 'asayake.org' }),
    '335-ogp-mockAB-discord-raw.png', { width: 560, height: 440 }
);
await compose([mockAB, xAB, discordAB], '335-ogp-compare-AB.png');

// ===== 案C: 本棚ごと動的生成のコンセプト =====
const mockC = await shotMock(join(ROOT, 'mockups/og-export-optionC.html'), '335-ogp-mockC-raw.png');
const dataC = await toDataUrl(mockC);
const xC = await shotPreview(
    xCardHtml({ title: 'asayake.hahero の本棚', desc: '42冊を公開中（イメージ・実データ未接続）', imgDataUrl: dataC, domain: 'bookshelf.asayake.org' }),
    '335-ogp-mockC-x-raw.png', { width: 540, height: 420 }
);
const discordC = await shotPreview(
    discordHtml({ title: 'asayake.hahero の本棚', desc: '42冊を公開中（イメージ・実データ未接続）', imgDataUrl: dataC, domain: 'bookshelf.asayake.org' }),
    '335-ogp-mockC-discord-raw.png', { width: 560, height: 440 }
);
await compose([mockC, xC, discordC], '335-ogp-compare-C.png');

await browser.close();
console.log('OK');
console.log(' - ' + join(OUT, '335-ogp-compare-AB.png'));
console.log(' - ' + join(OUT, '335-ogp-compare-C.png'));
