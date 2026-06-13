// PublishStyles - 公開ページの「スタイル」(テンプレート) と レジストリ (P1 静的SSG, ADR-030)
//
// スタイル = 自己完結の静的 HTML を組み立てるテンプレート。将来はプラグインで追加 (P2)。
//
// スタイル オブジェクトの契約:
//   {
//     id, name, description,
//     declare(): {                         // UI 駆動用メタ
//       requires: { shelves:'many'|'one'|'optional'|'none', books:'many'|'one'|'optional'|'none' },
//       fields:   [ {key,label,type:'text'|'textarea',default,placeholder} ]   // styleParams の入力欄
//     },
//     render(ctx): { html, css }           // ctx から本文 HTML 断片と CSS を返す (generator が doc に wrap)
//   }
//
// render(ctx) に渡る ctx (PublishGenerator が用意。データ解決・項目取捨・サニタイズ済):
//   {
//     page:   { title, intro, slug },
//     params: {...styleParams},
//     fields: { rating,memo,detailMemo,cover,author,amazon },
//     shelves:[ { meta:{name,slug,description,internalId}, books:[book] } ],
//     books:  [ book ],                     // 単体選択された本
//     site:   { publisher },
//     helpers:{ esc, attr, cover, author, stars, memo, detailMemo, amazon }  // ← 出力はこれ経由 (項目取捨と escape を集約)
//   }
//   book = { asin, title, authors, productImage, rating, memo, detailMemo, amazonUrl }
//
// ※ helpers は「OFF の項目は空文字を返す」。スタイルは helpers の戻り値を並べるだけで、
//   未エスケープのユーザ入力を直接埋め込まない (XSS と項目漏れを構造的に防ぐ)。

class PublishStyleRegistry {
    constructor() { this._styles = new Map(); }
    register(style) {
        if (!style || !style.id) throw new Error('style.id is required');
        this._styles.set(style.id, style);
        return this;
    }
    get(id) { return this._styles.get(id) || null; }
    has(id) { return this._styles.has(id); }
    list() { return [...this._styles.values()]; }
}

// ===== 共通 CSS (全スタイルの土台。generator が必ず差し込む) =====
const PUBLISH_BASE_CSS = `
:root{ --ink:#241f2b; --muted:#6b6675; --line:#ece7ef; --bg:#fbfafc;
  --night:#2d2638; --glow:#ff9e7d; --warm:#fcb69f; --accent:#b35a3e; }
*{box-sizing:border-box}
html{ -webkit-text-size-adjust:100% }
body{ margin:0; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;
  color:var(--ink); background:var(--bg); line-height:1.65; }
img{ max-width:100%; display:block }
a{ color:var(--accent) }
.pub-wrap{ max-width:1040px; margin:0 auto; padding:0 20px }
.pub-hero{ background:linear-gradient(160deg,#2d2638,#4a3b4e 60%,#7a5a52);
  color:#fff7ef; padding:56px 20px 44px; text-align:center }
.pub-hero h1{ margin:0 0 8px; font-size:1.9rem; letter-spacing:.02em }
.pub-hero .intro{ margin:0 auto; max-width:640px; opacity:.92 }
.pub-hero .by{ margin-top:12px; font-size:.85rem; opacity:.8 }
.cover-ph{ aspect-ratio:2/3; background:linear-gradient(160deg,#efe9f1,#ddd4e2);
  display:flex; align-items:center; justify-content:center; color:#9b93a6; font-size:.75rem; border-radius:6px }
.stars{ color:var(--glow); letter-spacing:1px; margin:.2rem 0; font-size:.95rem }
.stars .off{ color:#d8d2dd }
.memo{ color:#473f50; white-space:pre-wrap; margin:.4rem 0 }
.longmemo{ white-space:pre-wrap; color:#39323f; background:#fff; border:1px solid var(--line);
  border-radius:8px; padding:12px 14px; margin:.6rem 0 }
.author{ color:var(--muted); font-size:.85rem; margin:.15rem 0 }
.amazon{ display:inline-block; margin-top:.4rem; font-size:.85rem; text-decoration:none;
  border:1px solid var(--accent); color:var(--accent); padding:.25rem .6rem; border-radius:999px }
.amazon:hover{ background:var(--accent); color:#fff }
.pub-footer{ margin:48px 0 0; padding:24px 20px 40px; border-top:1px solid var(--line);
  color:var(--muted); font-size:.8rem; text-align:center }
.pub-footer a{ color:var(--muted) }
`;

// ===== 標準スタイル: 本棚セクション型 =====
const styleShelfSections = {
    id: 'shelf-sections',
    name: '本棚セクション型',
    description: '公開する本棚ごとにセクション分けし、表紙グリッドで並べる。複数本棚向け。',
    declare() {
        return { requires: { shelves: 'many', books: 'none' }, fields: [] };
    },
    render(ctx) {
        const h = ctx.helpers;
        const sections = ctx.shelves.map(s => {
            const cards = s.books.map(b => `
            <li class="card">
              ${h.cover(b)}
              <div class="card-body">
                <p class="card-title">${h.esc(b.title)}</p>
                ${h.author(b)}
                ${h.stars(b)}
                ${h.memo(b)}
                ${h.amazon(b, 'Amazon')}
              </div>
            </li>`).join('');
            return `
        <section class="shelf">
          <h2 class="shelf-title">${h.esc(s.meta.name)}</h2>
          ${s.meta.description ? `<p class="shelf-desc">${h.esc(s.meta.description)}</p>` : ''}
          <ul class="grid">${cards}</ul>
        </section>`;
        }).join('\n');
        return { html: `<div class="pub-wrap shelf-sections">${sections}</div>`, css: SHELF_SECTIONS_CSS };
    }
};
const SHELF_SECTIONS_CSS = `
.shelf{ margin:40px 0 }
.shelf-title{ font-size:1.3rem; margin:0 0 4px; padding-bottom:6px; border-bottom:2px solid var(--warm); display:inline-block }
.shelf-desc{ color:var(--muted); margin:.2rem 0 1rem }
.shelf-sections .grid{ list-style:none; padding:0; margin:0;
  display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:20px }
.shelf-sections .card{ background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden;
  display:flex; flex-direction:column }
.shelf-sections .card .cover, .shelf-sections .card .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover }
.shelf-sections .card-body{ padding:10px 12px 14px }
.shelf-sections .card-title{ font-weight:600; font-size:.92rem; margin:0 0 .2rem }
@media(max-width:480px){ .shelf-sections .grid{ grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:14px } }
`;

// ===== 標準スタイル: 本単体じっくり型 =====
const styleBookFeature = {
    id: 'book-feature',
    name: '本単体じっくり型',
    description: '選んだ本を表紙大きめ＋長文メモ中心で 1 冊ずつ紹介する。書評記事風。',
    declare() {
        return { requires: { shelves: 'none', books: 'many' }, fields: [] };
    },
    render(ctx) {
        const h = ctx.helpers;
        const items = ctx.books.map(b => `
        <article class="feature">
          <div class="feature-cover">${h.cover(b)}</div>
          <div class="feature-main">
            <h2 class="feature-title">${h.esc(b.title)}</h2>
            ${h.author(b)}
            ${h.stars(b)}
            ${h.memo(b)}
            ${h.detailMemo(b)}
            ${h.amazon(b, 'Amazon で見る')}
          </div>
        </article>`).join('\n');
        return { html: `<div class="pub-wrap book-feature">${items}</div>`, css: BOOK_FEATURE_CSS };
    }
};
const BOOK_FEATURE_CSS = `
.book-feature .feature{ display:grid; grid-template-columns:200px 1fr; gap:28px; align-items:start;
  margin:40px 0; padding-bottom:36px; border-bottom:1px solid var(--line) }
.book-feature .feature:last-child{ border-bottom:none }
.book-feature .feature-cover .cover, .book-feature .feature-cover .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:8px; box-shadow:0 8px 24px rgba(45,38,56,.15) }
.book-feature .feature-title{ margin:0 0 .3rem; font-size:1.4rem }
@media(max-width:560px){ .book-feature .feature{ grid-template-columns:120px 1fr; gap:16px } }
`;

// ===== レジストリ生成 (組み込みスタイル登録) =====
function createPublishStyleRegistry() {
    const reg = new PublishStyleRegistry();
    reg.register(styleShelfSections);
    reg.register(styleBookFeature);
    return reg;
}

if (typeof window !== 'undefined') {
    window.PublishStyleRegistry = PublishStyleRegistry;
    window.createPublishStyleRegistry = createPublishStyleRegistry;
    window.PUBLISH_BASE_CSS = PUBLISH_BASE_CSS;
}
if (typeof globalThis !== 'undefined') {
    globalThis.PublishStyleRegistry = PublishStyleRegistry;
    globalThis.createPublishStyleRegistry = createPublishStyleRegistry;
    globalThis.PUBLISH_BASE_CSS = PUBLISH_BASE_CSS;
}
