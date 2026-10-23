// イシュー#340 (OGP画像 layout() のテンプレ3型対応) 決裁用: 現状の og.png を3テンプレ分生成する。
// 現行の PublishOgpImage.layout() は theme.layout を見ていない (js/publish-ogp-image.js:6-7 のコメント・:25-71) ので、
// 3枚とも同じ絵になるはず＝それ自体の確認が目的。
// 実行: /home/sei/.nvm/versions/node/v24.18.0/bin/node scripts/verify/shot-340-ogp-layout.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const OUT = join(ROOT, 'tmp/verify-shots');
mkdirSync(OUT, { recursive: true });

const LAYOUTS = ['book-a-shelf-a', 'book-c-shelf-c', 'book-c-shelf-d'];

// unit テスト (tests/unit/publish-ogp-image.test.js) と同じサンプル記事・配色。
const ARTICLE = { title: 'わたしを構成する10冊', tags: ['エッセイ', '漫画', 'kindle'] };
const COLOR = 'aqua-white';
const OPTS = { publisher: 'hahero', siteName: 'AsayakeBookshelf' };

const browser = await chromium.launch();
const page = await browser.newPage();
// 依存順は unit テストに合わせる (publish-article-store.js → vendor/marked → publish-article-generator.js → publish-ogp-image.js)。
for (const rel of ['js/publish-article-store.js', 'js/vendor/marked.umd.js', 'js/publish-article-generator.js', 'js/publish-ogp-image.js']) {
    await page.addScriptTag({ path: join(ROOT, rel) });
}

const results = {};
for (const layout of LAYOUTS) {
    const r = await page.evaluate(async ({ article, theme, opts }) => {
        const res = await PublishOgpImage.render(article, theme, opts);
        if (!res.ok) return { ok: false, reason: res.reason };
        return { ok: true, base64: res.base64, bytes: res.bytes.length, hash: res.hash };
    }, { article: ARTICLE, theme: { layout, color: COLOR }, opts: OPTS });
    if (!r.ok) {
        console.error(`NG layout=${layout} reason=${r.reason}`);
        results[layout] = r;
        continue;
    }
    const file = join(OUT, `340-before-${layout}.png`);
    writeFileSync(file, Buffer.from(r.base64, 'base64'));
    results[layout] = { ok: true, file, bytes: r.bytes, hash: r.hash };
    console.log(`OK layout=${layout} bytes=${r.bytes} hash=${r.hash} -> ${file}`);
}

const allHashesSame = new Set(Object.values(results).filter(r => r.ok).map(r => r.hash)).size <= 1;
console.log(`---`);
console.log(`3テンプレのhashが同一か (layout()がtheme.layoutを見ていない証跡): ${allHashesSame}`);
writeFileSync(join(OUT, '340-before-manifest.json'), JSON.stringify({ results, allHashesSame }, null, 2));

// ==================================================================================
// 差し替え案 (draft): 本体の layout() は書き換えず、ここに試作関数として置く。paint() は本体のものをそのまま使う。
// テンプレの「配置の構造」(ADR-103) を rect/pill/text だけで表現する。要素はタイトル/タグ/発行者/サイト名のみ (ADR-098)。
// ==================================================================================
const DRAFT_LAYOUT_SRC = `
function draftLayout(article, theme, opts) {
    opts = opts || {};
    const PI = PublishOgpImage;
    const W = PI.WIDTH, H = PI.HEIGHT;
    const stack = PI.FONT_STACK;
    const colors = PI._colors(theme, opts.tokens);
    const measure = typeof opts.measure === 'function' ? opts.measure : PI._estimateWidth;
    const metrics = opts.metrics;   // (text,font) => { width, ascent, descent } (実ブラウザでのみ渡る。差し戻し#340で追加=余白/中央/ベースラインの実測用)
    const publisher = String(opts.publisher || 'マイ本棚');
    const siteName = String(opts.siteName || 'AsayakeBookshelf');
    const title = PI._oneLine(article && article.title) || '（無題）';
    const rawTags = ((article && article.tags) || []).map(t => PI._oneLine(t)).filter(Boolean);
    const layout = (theme && theme.layout) || 'book-a-shelf-a';
    const items = [];
    let debug = {};
    items.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: colors.bg });

    if (layout === 'book-c-shelf-c') {
        // 本C×棚C (「文章に書影を添える」): 書影の比率 (縦長 200x300) の色ブロックを左に置き、上下余白を持たせて縦中央配置。
        // 差し戻し#340-3: 220px全高の帯だと縮小表示で「ただの帯」に見える=書影比率に直す。
        const coverW = 200, coverH = 300;
        const coverX = 64, coverY = Math.round((H - coverH) / 2);
        items.push({ kind: 'rect', x: coverX, y: coverY, w: coverW, h: coverH, fill: colors.acc });
        const padL = coverX + coverW + 64, padR = 80, textW = W - padL - padR;
        const titleFont = \`bold 56px \${stack}\`;
        const titleLines = PI._wrap(title, titleFont, textW, PI.MAX_TITLE_LINES, measure);
        const titleTop = 72 + Math.round((288 - titleLines.lines.length * 74) / 2);
        titleLines.lines.forEach((line, i) => items.push({ kind: 'text', text: line, x: padL, y: titleTop + i * 74, font: titleFont, fill: colors.txt }));
        const tagFont = \`24px \${stack}\`;
        let x = padL;
        for (const raw of rawTags.slice(0, PI.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (x + w > padL + textW) break;
            items.push({ kind: 'pill', x, y: 380, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            items.push({ kind: 'text', text: label, x: x + 20, y: 380 + 23, font: tagFont, fill: colors.txt, baseline: 'middle' });
            x += w + 14;
        }
        items.push({ kind: 'rect', x: padL, y: 500, w: textW, h: 2, fill: colors.acc });
        items.push({ kind: 'text', text: \`\${publisher} の本棚\`, x: padL, y: 572, font: \`bold 30px \${stack}\`, fill: colors.sub, baseline: 'alphabetic' });
        items.push({ kind: 'text', text: siteName, x: padL + textW, y: 572, font: \`26px \${stack}\`, fill: colors.sub, align: 'right', baseline: 'alphabetic' });
        debug = {
            coverLeftX: coverX, coverTopY: coverY, coverW, coverH,
            coverTopMargin: coverY, coverBottomMargin: H - (coverY + coverH),
            coverVCenterDiff: Math.abs((coverY + coverH / 2) - H / 2),
        };
    } else if (layout === 'book-c-shelf-d') {
        // 本C×棚D (「番号つきで並べる」): css の counter(n,decimal-leading-zero) (40px・acc色) を大きな通し番号として移植。
        // 差し戻し#340-2: 01とタイトルを同じ左端・同じベースラインで横に並べる。タグの番号付けは撤去し他案と同じ pill に戻す。
        const padL = 96, padR = 80, textW = W - padL - padR;
        const numFont = \`800 54px \${stack}\`;
        const titleFont = \`bold 54px \${stack}\`;
        const numWidth = Math.ceil(measure('01', numFont));
        const gap = 16;
        const titleX = padL + numWidth + gap;
        const titleMaxW = textW - numWidth - gap;
        const titleLines = PI._wrap(title, titleFont, titleMaxW, PI.MAX_TITLE_LINES, measure);
        const titleTop = 72 + Math.round((288 - titleLines.lines.length * 70) / 2);
        // '01' とタイトル1行目は明示的に同じ baseline y に揃える (top 基準だとフォントウェイト差でascentがずれ、baselineが揃わない)。
        const titleAscent = metrics ? metrics(titleLines.lines[0] || title, titleFont).ascent : 54 * 0.8;
        const firstBaselineY = titleTop + titleAscent;
        items.push({ kind: 'text', text: '01', x: padL, y: firstBaselineY, font: numFont, fill: colors.acc, baseline: 'alphabetic' });
        titleLines.lines.forEach((line, i) => items.push({ kind: 'text', text: line, x: titleX, y: firstBaselineY + i * 70, font: titleFont, fill: colors.txt, baseline: 'alphabetic' }));
        // タグ = 他の案と同じ横並び pill (番号なし・本の順位に読めるのを避ける)
        const tagFont = \`24px \${stack}\`;
        let tx = padL;
        for (const raw of rawTags.slice(0, PI.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (tx + w > padL + textW) break;
            items.push({ kind: 'pill', x: tx, y: 380, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            items.push({ kind: 'text', text: label, x: tx + 20, y: 380 + 23, font: tagFont, fill: colors.txt, baseline: 'middle' });
            tx += w + 14;
        }
        items.push({ kind: 'rect', x: padL, y: 500, w: textW, h: 2, fill: colors.acc });
        items.push({ kind: 'text', text: \`\${publisher} の本棚\`, x: padL, y: 572, font: \`bold 28px \${stack}\`, fill: colors.sub, baseline: 'alphabetic' });
        items.push({ kind: 'text', text: siteName, x: padL + textW, y: 572, font: \`24px \${stack}\`, fill: colors.sub, align: 'right', baseline: 'alphabetic' });
        debug = { numLeftX: padL, contentLeftMargin: padL, titleTextLeftX: titleX, numBaselineY: Math.round(firstBaselineY), titleBaselineY: Math.round(firstBaselineY), baselineDiff: 0, numWidth, gap };
    } else {
        // book-a-shelf-a (「書影を大きく」): 本の要素が全部中央揃え。左帯をやめ、上下の罫線でタイトルを挟む。
        // 差し戻し#340-1: フッターを1行化して下端40px以上・上下罫線の余白を対称(差8px以内)・タイトルを罫線間の縦中央(ずれ8px以内)に。
        const contentW = 960, padL = (W - contentW) / 2, cx = W / 2;
        const footerText = \`\${publisher} の本棚 ・ \${siteName}\`;
        const footerFont = \`bold 26px \${stack}\`;
        const ruleH = 2, gap = 16, footerBottomMarginTarget = 44;

        let topRuleY = 56, bottomRuleY = 562, footerBaselineY = 592;
        if (metrics) {
            const fm = metrics(footerText, footerFont);
            footerBaselineY = Math.round(H - footerBottomMarginTarget - fm.descent);
            const footerTopY = footerBaselineY - fm.ascent;
            bottomRuleY = Math.round(footerTopY - gap - ruleH);
            const bottomMarginFromEdge = H - (bottomRuleY + ruleH);
            topRuleY = bottomMarginFromEdge;   // 上罫線の上端からの余白 = 下罫線の下端からの余白 (対称)
        }
        items.push({ kind: 'rect', x: padL, y: topRuleY, w: contentW, h: ruleH, fill: colors.acc });
        items.push({ kind: 'rect', x: padL, y: bottomRuleY, w: contentW, h: ruleH, fill: colors.acc });

        const titleAreaTop = topRuleY + ruleH, titleAreaBottom = bottomRuleY;
        const titleCenterY = (titleAreaTop + titleAreaBottom) / 2;
        const titleFont = \`bold 58px \${stack}\`;
        const titleLines = PI._wrap(title, titleFont, contentW - 40, PI.MAX_TITLE_LINES, measure);
        const lineGap = 78;
        let firstBaseline = titleCenterY - ((titleLines.lines.length - 1) * lineGap) / 2;
        let visualCenter = titleCenterY;
        if (metrics) {
            const lm = metrics(titleLines.lines[0] || title, titleFont);
            const n = titleLines.lines.length;
            const blockHeight = (n - 1) * lineGap + lm.ascent + lm.descent;
            firstBaseline = titleCenterY - blockHeight / 2 + lm.ascent;
            const lastBaseline = firstBaseline + (n - 1) * lineGap;
            visualCenter = ((firstBaseline - lm.ascent) + (lastBaseline + lm.descent)) / 2;
        }
        titleLines.lines.forEach((line, i) => items.push({ kind: 'text', text: line, x: cx, y: Math.round(firstBaseline + i * lineGap), font: titleFont, fill: colors.txt, align: 'center', baseline: 'alphabetic' }));

        const tagFont = \`24px \${stack}\`;
        const tagDefs = [];
        let totalW = 0;
        for (const raw of rawTags.slice(0, PI.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (totalW + w + (tagDefs.length ? 14 : 0) > contentW) break;
            tagDefs.push({ label, w });
            totalW += w + (tagDefs.length > 1 ? 14 : 0);
        }
        const tagY = Math.min(titleAreaBottom - 70, Math.round(visualCenter + 110));
        let tx = cx - totalW / 2;
        for (const { label, w } of tagDefs) {
            items.push({ kind: 'pill', x: tx, y: tagY, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            items.push({ kind: 'text', text: label, x: tx + w / 2, y: tagY + 23, font: tagFont, fill: colors.txt, align: 'center', baseline: 'middle' });
            tx += w + 14;
        }

        items.push({ kind: 'text', text: footerText, x: cx, y: footerBaselineY, font: footerFont, fill: colors.sub, align: 'center', baseline: 'alphabetic' });

        if (metrics) {
            const fm = metrics(footerText, footerFont);
            debug = {
                topMargin: topRuleY, bottomMargin: H - (bottomRuleY + ruleH), marginDiff: Math.abs(topRuleY - (H - (bottomRuleY + ruleH))),
                titleCenterTarget: Math.round(titleCenterY), titleVisualCenter: Math.round(visualCenter), titleCenterDiff: Math.abs(titleCenterY - visualCenter),
                footerBaselineY, footerBottomActual: H - (footerBaselineY + fm.descent),
            };
        }
    }
    return { version: 'draft-340', width: W, height: H, colors, items, debug };
}
`;

async function renderDraft(layout) {
    return page.evaluate(async ({ src, article, theme, opts }) => {
        // eslint-disable-next-line no-new-func
        const draftLayout = new Function(src + '\nreturn draftLayout;')();
        const canvas = document.createElement('canvas');
        canvas.width = PublishOgpImage.WIDTH; canvas.height = PublishOgpImage.HEIGHT;
        const ctx = canvas.getContext('2d');
        const measure = (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
        const metrics = (text, font) => {
            ctx.font = font;
            const m = ctx.measureText(text);
            return { width: m.width, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
        };
        const plan = draftLayout(article, theme, { ...opts, measure, metrics });

        // 座標の検証 (先に機械で通す・memory: UIの整列が弱い): 全 item が 0..1200 x 0..630 に収まるか (はみ出しチェック)。
        const W = PublishOgpImage.WIDTH, H = PublishOgpImage.HEIGHT;
        const violations = [];
        for (const it of plan.items) {
            if (it.kind === 'rect' || it.kind === 'pill') {
                if (it.x < 0 || it.y < 0 || it.x + it.w > W || it.y + it.h > H) violations.push({ it, reason: 'rect-bounds' });
            } else if (it.kind === 'text') {
                ctx.font = it.font; ctx.textAlign = it.align || 'left';
                const w = ctx.measureText(it.text).width;
                const left = it.align === 'center' ? it.x - w / 2 : it.align === 'right' ? it.x - w : it.x;
                const right = left + w;
                if (left < 0 || right > W || it.y < 0 || it.y > H) violations.push({ it, reason: 'text-bounds', left, right });
            }
        }

        PublishOgpImage.paint(ctx, plan);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = ''; const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
        return { base64: btoa(bin), violations, debug: plan.debug };
    }, { src: DRAFT_LAYOUT_SRC, article: ARTICLE, theme: { layout, color: COLOR }, opts: OPTS });
}

const draftResults = {};
for (const layout of LAYOUTS) {
    const r = await renderDraft(layout);
    const file = join(OUT, `340-after-${layout}.png`);
    writeFileSync(file, Buffer.from(r.base64, 'base64'));
    draftResults[layout] = { file, violations: r.violations, debug: r.debug };
    console.log(`DRAFT layout=${layout} violations=${r.violations.length} -> ${file}`);
    console.log(`  実測: ${JSON.stringify(r.debug)}`);
    if (r.violations.length) console.log(JSON.stringify(r.violations, null, 2));
}
const anyViolation = Object.values(draftResults).some(r => r.violations.length > 0);
console.log(`座標検証: 全テンプレ はみ出しなし = ${!anyViolation}`);

// ==================================================================================
// 比較画像の合成: テンプレごとに「現状｜案」+ X カード相当 (幅500px) を並べる。
// ==================================================================================
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function xCardHtml(imgDataUrl, title, desc) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#15202b;font-family:-apple-system,"Hiragino Sans",sans-serif;}
    .tweet{width:500px;background:#15202b;color:#fff;}
    .card{border:1px solid #38444d;border-radius:16px;overflow:hidden;}
    .card img{width:100%;height:262px;object-fit:cover;display:block;}
    .cardbody{padding:12px;}
    .domain{font-size:13px;color:#8899a6;}
    .ctitle{font-size:15px;color:#fff;margin-top:2px;font-weight:700;}
    .cdesc{font-size:13px;color:#8899a6;margin-top:2px;}
    </style></head><body><div class="tweet">
    <div class="card"><img src="${esc(imgDataUrl)}"><div class="cardbody">
      <div class="domain">bookshelf.asayake.org</div>
      <div class="ctitle">${esc(title)}</div>
      <div class="cdesc">${esc(desc)}</div>
    </div></div></div></body></html>`;
}

async function toDataUrl(pngPath) {
    const { readFileSync } = await import('node:fs');
    return 'data:image/png;base64,' + readFileSync(pngPath).toString('base64');
}

async function shotXCard(imgPath, outName) {
    const p = await browser.newPage({ viewport: { width: 540, height: 420 } });
    await p.setContent(xCardHtml(await toDataUrl(imgPath), ARTICLE.title, ARTICLE.tags.join(' / ')), { waitUntil: 'load' });
    await p.waitForTimeout(150);
    const file = join(OUT, outName);
    await p.screenshot({ path: file });
    await p.close();
    return file;
}

const rows = [];
for (const layout of LAYOUTS) {
    const beforeFile = join(OUT, `340-before-${layout}.png`);
    const afterFile = draftResults[layout].file;
    const xBefore = await shotXCard(beforeFile, `340-x-before-${layout}.png`);
    const xAfter = await shotXCard(afterFile, `340-x-after-${layout}.png`);
    rows.push({ layout, beforeFile, afterFile, xBefore, xAfter });
}

async function composeFinal(outName) {
    const { readFileSync } = await import('node:fs');
    const img = (p, w) => `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}" style="width:${w}px;display:block;border:1px solid #ddd;">`;
    const rowsHtml = rows.map(r => `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
        <div style="width:160px;font:bold 16px sans-serif;">${r.layout}</div>
        <div><div style="font:12px sans-serif;color:#666;">現状</div>${img(r.beforeFile, 360)}</div>
        <div><div style="font:12px sans-serif;color:#666;">案</div>${img(r.afterFile, 360)}</div>
        <div><div style="font:12px sans-serif;color:#666;">Xカード(現状)</div>${img(r.xBefore, 160)}</div>
        <div><div style="font:12px sans-serif;color:#666;">Xカード(案)</div>${img(r.xAfter, 160)}</div>
      </div>`).join('');
    const p = await browser.newPage();
    await p.setContent(`<!doctype html><html><body style="margin:0;background:#fff;padding:16px;font-family:sans-serif;">${rowsHtml}</body></html>`);
    await p.waitForTimeout(200);
    const file = join(ROOT, 'tmp', outName);
    await p.screenshot({ path: file, fullPage: true });
    await p.close();
    return file;
}

const compareFile = await composeFinal('340-ogp-compare.png');
console.log('COMPARE -> ' + compareFile);

await browser.close();
writeFileSync(join(OUT, '340-draft-manifest.json'), JSON.stringify({ draftResults, anyViolation, compareFile }, null, 2));
