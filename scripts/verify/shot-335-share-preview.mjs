// T11 (イシュー#335) 本番meta実測から X / Discord 相当の共有プレビューを再現して撮影する。
// 実サービスへの投稿はしない＝実メタ値から静的HTMLを組んでPlaywrightでスクショするだけ。
// 実行: node scripts/verify/shot-335-share-preview.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../../tmp/verify-shots');
mkdirSync(OUT, { recursive: true });

// 本番から実測したmeta値(curl取得・2026-10-24 00:39 JST)。JS実行前の生HTMLから抜いた値のみを使う。
const PAGES = [
    {
        key: 'app',
        url: 'https://asayake.org/bookshelf/',
        title: 'AsayakeBookshelf',
        desc: '読書ライブラリ',
        image: null,
    },
    {
        key: 'top',
        url: 'https://bookshelf.asayake.org/hahero/',
        title: 'asayake.hahero の本棚',
        desc: null, // og:description 無し
        image: null, // og:image 無し
    },
    {
        key: 'article',
        url: 'https://bookshelf.asayake.org/hahero/kZ0XxQt4hb/',
        title: 'test',
        desc: null, // og:description 無し
        image: 'https://m.media-amazon.com/images/I/51e4nVDynnL.jpg',
    },
    {
        key: 'topidx',
        url: 'https://bookshelf.asayake.org/top',
        title: '公開された記事 | bookshelf.asayake.org',
        desc: 'AsayakeBookshelf で公開された本棚記事の一覧です。',
        image: null, // og:*一式が無い(titleタグ+descriptionのみ)
    },
];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function domainOf(url) { try { return new URL(url).hostname; } catch { return url; } }

// X (summary_large_image 相当: 画像あり=大型カード、無し=カード無しのテキストリンクのみ)
function xCardHtml(p) {
    const hasImg = !!p.image;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#15202b;font-family:-apple-system,"Hiragino Sans",sans-serif;padding:40px;}
    .tweet{width:500px;background:#15202b;color:#fff;}
    .txt{font-size:15px;line-height:1.4;margin-bottom:10px;}
    .card{border:1px solid #38444d;border-radius:16px;overflow:hidden;}
    .card img{width:100%;height:260px;object-fit:cover;display:block;background:#273340;}
    .cardbody{padding:12px;}
    .domain{font-size:13px;color:#8899a6;}
    .ctitle{font-size:15px;color:#fff;margin-top:2px;}
    .cdesc{font-size:13px;color:#8899a6;margin-top:2px;}
    .noimg{display:flex;border:1px solid #38444d;border-radius:16px;overflow:hidden;}
    .noimg .ph{width:120px;height:120px;background:#273340;flex:0 0 auto;}
    </style></head><body><div class="tweet">
    <div class="txt">(共有プレビュー再現・投稿はしていません)</div>
    ${hasImg ? `
    <div class="card"><img src="${esc(p.image)}"><div class="cardbody">
      <div class="domain">${esc(domainOf(p.url))}</div>
      <div class="ctitle">${esc(p.title)}</div>
      ${p.desc ? `<div class="cdesc">${esc(p.desc)}</div>` : '<div class="cdesc" style="color:#e0245e">(og:description 無し)</div>'}
    </div></div>` : `
    <div class="noimg"><div class="ph"></div><div class="cardbody">
      <div class="domain">${esc(domainOf(p.url))}</div>
      <div class="ctitle">${esc(p.title)}</div>
      ${p.desc ? `<div class="cdesc">${esc(p.desc)}</div>` : '<div class="cdesc" style="color:#e0245e">(og:description 無し)</div>'}
    </div></div>
    <div style="color:#e0245e;font-size:12px;margin-top:6px">(og:image 無し＝summary_large_imageにならない)</div>`}
    </div></body></html>`;
}

// Discord embed 相当
function discordHtml(p) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#313338;font-family:-apple-system,"Hiragino Sans",sans-serif;padding:40px;}
    .msg{width:520px;}
    .embed{border-left:4px solid #5865f2;background:#2b2d31;border-radius:4px;padding:12px;}
    .site{font-size:12px;color:#949ba4;}
    .title{font-size:16px;color:#00a8fc;font-weight:600;margin-top:4px;}
    .desc{font-size:14px;color:#dbdee1;margin-top:6px;line-height:1.4;}
    .img{margin-top:10px;max-width:100%;border-radius:4px;display:block;}
    .nodesc{color:#f23f42;font-size:12px;margin-top:6px;}
    </style></head><body><div class="msg"><div class="embed">
    <div class="site">${esc(domainOf(p.url))}</div>
    <div class="title">${esc(p.title)}</div>
    ${p.desc ? `<div class="desc">${esc(p.desc)}</div>` : '<div class="nodesc">(og:description 無し＝本文プレビューが出ない)</div>'}
    ${p.image ? `<img class="img" src="${esc(p.image)}" style="max-height:300px;object-fit:cover;width:100%">` : '<div class="nodesc">(og:image 無し＝サムネイルが出ない)</div>'}
    </div></div></body></html>`;
}

const browser = await chromium.launch();
const results = [];
for (const p of PAGES) {
    for (const [kind, html, viewport] of [['x', xCardHtml(p), { width: 580, height: 480 }], ['discord', discordHtml(p), { width: 600, height: 420 }]]) {
        const page = await browser.newPage({ viewport });
        await page.setContent(html, { waitUntil: 'load' });
        if (p.image) {
            try { await page.waitForLoadState('load'); await page.waitForTimeout(600); } catch {}
        }
        const file = join(OUT, `335-before-${p.key}-${kind}.png`);
        await page.screenshot({ path: file, fullPage: true });
        results.push(file);
        await page.close();
    }
}
await browser.close();
writeFileSync(join(OUT, '335-before-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), files: results }, null, 2));
console.log('OK', results.length, 'files');
for (const f of results) console.log(' -', f);
