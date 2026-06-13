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

// ===== 標準スタイル: 一覧ミニマル型 (表紙ウォール) =====
const styleCoverWall = {
    id: 'cover-wall',
    name: '一覧ミニマル型',
    description: '表紙だけを敷き詰める軽量なウォール。本棚でも本でも。',
    declare() {
        return { requires: { shelves: 'optional', books: 'optional' }, fields: [] };
    },
    render(ctx) {
        const h = ctx.helpers;
        const all = [];
        for (const s of ctx.shelves) for (const b of s.books) all.push(b);
        for (const b of ctx.books) all.push(b);
        const tiles = all.map(b => {
            const cover = h.cover(b) || `<div class="cover-ph">${h.esc(b.title)}</div>`;
            return ctx.fields.amazon
                ? `<li class="cw-tile"><a href="${h.attr(b.amazonUrl)}" target="_blank" rel="nofollow sponsored noopener" title="${h.attr(b.title)}">${cover}</a></li>`
                : `<li class="cw-tile" title="${h.attr(b.title)}">${cover}</li>`;
        }).join('');
        return { html: `<div class="pub-wrap cover-wall"><ul class="cw-grid">${tiles}</ul></div>`, css: COVER_WALL_CSS };
    }
};
const COVER_WALL_CSS = `
.cover-wall .cw-grid{ list-style:none; padding:0; margin:32px 0;
  display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:14px }
.cover-wall .cw-tile .cover, .cover-wall .cw-tile .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px }
.cover-wall .cw-tile a{ display:block }
@media(max-width:480px){ .cover-wall .cw-grid{ grid-template-columns:repeat(auto-fill,minmax(90px,1fr)); gap:10px } }
`;

// ===== 標準スタイル: 雑誌キュレーション型 =====
const styleMagazine = {
    id: 'magazine',
    name: '雑誌キュレーション型',
    description: '本棚ごとに「推し1冊」を大きく＋残りをグリッド。リード文も添えられる雑誌風。',
    declare() {
        return { requires: { shelves: 'many', books: 'none' }, fields: [{ key: 'lead', label: 'リード文（任意）', type: 'textarea', placeholder: '今月のおすすめは…' }] };
    },
    render(ctx) {
        const h = ctx.helpers;
        const lead = ctx.params.lead ? `<p class="mag-lead">${h.esc(ctx.params.lead)}</p>` : '';
        const secs = ctx.shelves.map(s => {
            const feat = s.books[0];
            const rest = s.books.slice(1);
            const featHtml = feat ? `
            <div class="mag-feature">
              <div class="mag-feat-cover">${h.cover(feat)}</div>
              <div class="mag-feat-body">
                <p class="mag-feat-title">${h.esc(feat.title)}</p>
                ${h.author(feat)}${h.stars(feat)}${h.memo(feat)}${h.amazon(feat, 'Amazon')}
              </div>
            </div>` : '';
            const grid = rest.length ? `<ul class="mag-grid">${rest.map(b => `<li>${h.cover(b)}<p class="mag-bk-title">${h.esc(b.title)}</p>${h.stars(b)}</li>`).join('')}</ul>` : '';
            return `<section class="mag-sec">
              <h2 class="mag-title">${h.esc(s.meta.name)}</h2>
              ${s.meta.description ? `<p class="mag-desc">${h.esc(s.meta.description)}</p>` : ''}
              ${featHtml}${grid}
            </section>`;
        }).join('');
        return { html: `<div class="pub-wrap magazine">${lead}${secs}</div>`, css: MAGAZINE_CSS };
    }
};
const MAGAZINE_CSS = `
.magazine .mag-lead{ font-size:1.05rem; color:#5a5263; margin:28px 0; padding-left:14px; border-left:3px solid var(--warm) }
.magazine .mag-sec{ margin:44px 0 }
.magazine .mag-title{ font-size:1.4rem; margin:0 0 4px }
.magazine .mag-desc{ color:var(--muted); margin:.2rem 0 1rem }
.magazine .mag-feature{ display:grid; grid-template-columns:160px 1fr; gap:22px; align-items:start;
  background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:20px }
.magazine .mag-feat-cover .cover, .magazine .mag-feat-cover .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:8px }
.magazine .mag-feat-title{ font-size:1.15rem; font-weight:700; margin:0 0 .3rem }
.magazine .mag-grid{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:16px }
.magazine .mag-grid .cover, .magazine .mag-grid .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px }
.magazine .mag-bk-title{ font-size:.82rem; margin:.3rem 0 0 }
@media(max-width:560px){ .magazine .mag-feature{ grid-template-columns:110px 1fr; gap:14px } }
`;

// ===== 標準スタイル: フリーフォーム/ミックス型 =====
const styleMix = {
    id: 'mix',
    name: 'フリーフォーム/ミックス型',
    description: '選んだ「本」を特集カード、選んだ「本棚」をグリッドとして 1 ページに混在。自由構成の受け皿。',
    declare() {
        return { requires: { shelves: 'optional', books: 'optional' }, fields: [{ key: 'note', label: '本文（任意）', type: 'textarea', placeholder: 'このページについての説明…' }] };
    },
    render(ctx) {
        const h = ctx.helpers;
        const note = ctx.params.note ? `<div class="mix-note">${h.esc(ctx.params.note)}</div>` : '';
        const features = ctx.books.length ? `<div class="mix-features">${ctx.books.map(b => `
          <article class="mix-feature">
            <div class="mix-feat-cover">${h.cover(b)}</div>
            <div class="mix-feat-body">
              <h3 class="mix-feat-title">${h.esc(b.title)}</h3>
              ${h.author(b)}${h.stars(b)}${h.memo(b)}${h.detailMemo(b)}${h.amazon(b, 'Amazon で見る')}
            </div>
          </article>`).join('')}</div>` : '';
        const shelfSecs = ctx.shelves.map(s => `
          <section class="mix-shelf">
            <h2 class="mix-shelf-title">${h.esc(s.meta.name)}</h2>
            <ul class="mix-grid">${s.books.map(b => `<li>${h.cover(b)}<p class="mix-bk-title">${h.esc(b.title)}</p>${h.stars(b)}</li>`).join('')}</ul>
          </section>`).join('');
        return { html: `<div class="pub-wrap mix">${note}${features}${shelfSecs}</div>`, css: MIX_CSS };
    }
};
const MIX_CSS = `
.mix .mix-note{ font-size:1rem; color:#4a4350; white-space:pre-wrap; margin:28px 0; padding:14px 16px; background:#fff; border:1px solid var(--line); border-radius:10px }
.mix .mix-feature{ display:grid; grid-template-columns:170px 1fr; gap:24px; align-items:start; margin:28px 0; padding-bottom:24px; border-bottom:1px solid var(--line) }
.mix .mix-feat-cover .cover, .mix .mix-feat-cover .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:8px; box-shadow:0 6px 20px rgba(45,38,56,.12) }
.mix .mix-feat-title{ margin:0 0 .3rem; font-size:1.3rem }
.mix .mix-shelf{ margin:36px 0 }
.mix .mix-shelf-title{ font-size:1.25rem; margin:0 0 12px; padding-bottom:6px; border-bottom:2px solid var(--warm); display:inline-block }
.mix .mix-grid{ list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:16px }
.mix .mix-grid .cover, .mix .mix-grid .cover-ph{ width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:6px }
.mix .mix-bk-title{ font-size:.82rem; margin:.3rem 0 0 }
@media(max-width:560px){ .mix .mix-feature{ grid-template-columns:110px 1fr; gap:14px } }
`;

// ===== レジストリ生成 (組み込みスタイル登録) =====
function createPublishStyleRegistry() {
    const reg = new PublishStyleRegistry();
    reg.register(styleShelfSections);
    reg.register(styleBookFeature);
    reg.register(styleCoverWall);
    reg.register(styleMagazine);
    reg.register(styleMix);
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
