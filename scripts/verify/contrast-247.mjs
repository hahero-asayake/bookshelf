// イシュー#247 決裁1(主色)・決裁2(危険色・警告色)の実測。
// 実行: node scripts/verify/contrast-247.mjs
// 独立した最小HTML(実際に使うクラス名 .btn-primary/.btn-danger/.btn-warning/.status-row.status-warn を
// css/bookshelf.css からそのまま読み込んで再現)をヘッドレスChromiumでレンダリングし、
// getComputedStyle から実測コントラスト比を出す。before(HEAD^) と after(作業ツリー) を両方撮る。
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveShotDir } from './verify-common.mjs';

const shotDir = resolveShotDir();

function buildHtml(cssText, dark) {
  // body.plugin-dark は起動時トグル(classList.add)ではなく最初から<body>に焼き込む。
  // classList.add後にgetComputedStyleする方式は、このChromeでvar()依存のbackground-colorが
  // 再計算されない実測不具合を踏んだ(イシュー#247検証中に発見・別紙note参照)ため、
  // page.setContent を明/暗で分けて呼ぶ方式に変更した。
  const swatch = `
  <button class="btn btn-primary">主要アクション</button>
  <button class="btn btn-primary" style="background-color:var(--accent-strong);border-color:var(--accent-strong);color:#fff">hover(primary)</button>
  <button class="btn btn-danger">削除</button>
  <button class="btn btn-danger" style="background:#fce8e8;border-color:var(--danger);color:var(--danger)">hover(danger)</button>
  <button class="btn btn-warning">注意</button>
  <button class="btn btn-warning" style="background:#fff7e0;border-color:var(--warning);color:var(--warning)">hover(warning)</button>
  <div class="status-row status-warn">保存先が未設定です</div>
  <button class="bd-memo-block-remove" style="background:var(--danger);color:#fff;border:none;padding:4px 8px">×(hover相当)</button>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin:0; padding:24px; display:flex; flex-direction:column; gap:10px; font-family:sans-serif; background:var(--bg); }
</style><style>${cssText}</style></head><body class="${dark ? 'plugin-dark' : ''}">
${swatch}
</body></html>`;
}

function extractRule(css, selector) {
  // 単純な最初の { ... } ブロックだけ抜く (今回対象のシンプルな1行ルール専用)
  const idx = css.indexOf(selector);
  if (idx === -1) return '';
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(idx, close + 1);
}

function extractCssSubset(css, darkThemeJs) {
  const rootBlock = extractRule(css, ':root');
  const btnBase = extractRule(css, '.btn {') || extractRule(css, '.btn{');
  const btnPrimary = extractRule(css, '.btn-primary {');
  const btnDanger = extractRule(css, '.btn-danger {');
  const btnWarning = extractRule(css, '.btn-warning {');
  const statusWarn = extractRule(css, '.status-row.status-warn');
  const statusWarnDark = extractRule(css, 'body.plugin-dark .status-row.status-warn');
  const bdRemove = extractRule(css, '.bd-memo-block-remove {');
  // dark-theme.js の CSS テンプレート文字列を丸ごと抜く。`${BODY_CLASS}` はテンプレートリテラルの
  // 変数展開なので、正規表現抽出だと文字どおりの `${BODY_CLASS}` が残り body.plugin-dark に一致しない
  // (実際の実行時は 'plugin-dark' に展開される) → ここで明示的に置換する。
  const m = darkThemeJs.match(/const CSS = `([\s\S]*?)`;/);
  const darkThemeCss = m ? m[1].replace(/\$\{BODY_CLASS\}/g, 'plugin-dark') : '';
  return [rootBlock, btnBase, btnPrimary, btnDanger, btnWarning, statusWarn, statusWarnDark, bdRemove, darkThemeCss].join('\n');
}

async function measureScope(page) {
  return page.evaluate(() => {
    function relLum(r,g,b){const f=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);}
    function parse(str){const m=str.match(/rgba?\(([^)]+)\)/);const p=m[1].split(',').map(x=>parseFloat(x));return {r:p[0],g:p[1],b:p[2]};}
    function ratio(c1,c2){const L1=relLum(c1.r,c1.g,c1.b),L2=relLum(c2.r,c2.g,c2.b);const [hi,lo]=L1>L2?[L1,L2]:[L2,L1];return (hi+0.05)/(lo+0.05);}
    function effectiveBg(el) {
      // 半透明背景(alpha<1)は祖先の背景と合成してから輝度計算する(WCAG的に「見た目の色」で測る)。
      let node = el, layers = [];
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(',').map(x=>parseFloat(x));
          const a = p.length > 3 ? p[3] : 1;
          if (a > 0) layers.push({ r: p[0], g: p[1], b: p[2], a });
          if (a >= 1) break;
        }
        node = node.parentElement;
      }
      // 背後(祖先)から手前へ合成
      let acc = { r: 255, g: 255, b: 255 };
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        acc = { r: l.r*l.a + acc.r*(1-l.a), g: l.g*l.a + acc.g*(1-l.a), b: l.b*l.a + acc.b*(1-l.a) };
      }
      return acc;
    }
    function measureOne(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const color = parse(cs.color);
      const bg = effectiveBg(el);
      return Number(ratio(color, bg).toFixed(2));
    }
    return {
      'btn-primary': measureOne('.btn-primary:not([style])'),
      'btn-primary:hover代替': measureOne('.btn-primary[style]'),
      'btn-danger': measureOne('.btn-danger:not([style])'),
      'btn-danger:hover代替': measureOne('.btn-danger[style]'),
      'btn-warning': measureOne('.btn-warning:not([style])'),
      'btn-warning:hover代替': measureOne('.btn-warning[style]'),
      'status-warn': measureOne('.status-row.status-warn'),
      'bd-memo-remove(白文字on危険色)': measureOne('.bd-memo-block-remove'),
    };
  });
}

async function measure(page, label, cssSubset) {
  await page.setContent(buildHtml(cssSubset, false));
  const light = await measureScope(page);
  await page.screenshot({ path: `${shotDir}/247-contrast-${label}-light.png` });

  await page.setContent(buildHtml(cssSubset, true));
  const dark = await measureScope(page);
  await page.screenshot({ path: `${shotDir}/247-contrast-${label}-dark.png` });

  const out = { light, dark };
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 900, height: 420 } });

  // before: HEAD (直前コミット) の css/bookshelf.css + dark-theme/index.js
  const beforeCss = execFileSync('git', ['show', 'HEAD:css/bookshelf.css'], { encoding: 'utf-8' });
  const beforeDarkJs = execFileSync('git', ['show', 'HEAD:plugins-sample/dark-theme/index.js'], { encoding: 'utf-8' });
  const before = await measure(page, 'before', extractCssSubset(beforeCss, beforeDarkJs));

  // after: 作業ツリー
  const afterCss = readFileSync('css/bookshelf.css', 'utf-8');
  const afterDarkJs = readFileSync('plugins-sample/dark-theme/index.js', 'utf-8');
  const after = await measure(page, 'after', extractCssSubset(afterCss, afterDarkJs));

  await browser.close();

  writeFileSync(`${shotDir}/247-contrast-table.json`, JSON.stringify({ before, after }, null, 2));
  console.log(`\nスクショ・数値表: ${shotDir}/247-contrast-*.png / 247-contrast-table.json`);
}

run();
