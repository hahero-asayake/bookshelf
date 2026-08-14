// PublishArticleGenerator - 記事モデルから自己完結の静的 HTML を生成 (S2, ADR-058 / 09_公開システム設計 §11)
//
// 役割:
//   1. 記事のブロック列 (文章/本/本棚) を蔵書データへ解決する
//   2. セマンティック HTML は 1 種類だけを出力し、見た目はテーマ (レイアウト×配色) の CSS だけで切り替える
//      (CSS Zen Garden 型・§11.3)。各要素は安定したクラス名 (.bk-cover .bk-title .bk-author .bk-memo 等) を
//      持ち、繰り返し要素 (.shelf 内の .bk) は grid-template-areas で名前付き配置する (自動配置に依存しない)
//   3. 文章ブロック・長文メモは Markdown → HTML (js/vendor/marked.umd.js。CDN 不使用・vendor 同梱, §11.4)
//   4. 長文メモ埋め込み時は見出しレベルを差分シフトする (固定 +1 にしない・h6 打ち止め・§11.5)
//   5. プライバシーガード: 出力に個人情報 (obsidian vault 名等) が混入していないか検査 (_detectLeak)
//
// ※ 旧 PublishGenerator (js/publish-generator.js, ページ=1スタイルモデル) とは別モデル・別ファイル。
//    bookshelf.js の公開ページ管理 UI (~L7500-7970) との結合はエディタUI (S3、別イシュー) の領分のため
//    本イシューでは変更しない。_amazonUrl / _detectLeak は旧クラスと同じロジックをここに複製している
//    (旧モデル終息時にどちらかへ統合すること)。
//
// 依存: app.storage.loadAll() / app.storage.readBookMemo(asin,title) / js/vendor/marked.umd.js (grobalThis.marked)

// 記事の見出し階層 (§11.5): 記事 h1 はタイトルのみ。文章ブロックの見出しは h2 から、
// 本のタイトルは h3、そこに埋め込む長文メモは h4 から始める (メモ内の相対関係は保ったまま差分シフト)。
const ARTICLE_HEADING_LEVEL = { textBlock: 2, bookTitle: 3, detailMemo: 4 };

// 配色トークン10種 (§11.3・モック ~/kuroko/discord/tmp/mock-theme.html で実証された値をベースに、
// axe-core (WCAG AA) のコントラスト検証で不足が見つかった2値だけ補正した (完了条件検証時に発見・S2):
//   white: --sub #767676→#666666 (--surface #fafafa との比が4.35→5.50)
//   orange: --acc #c2700c→#ad600a (.amz 等 --acc-t #fff との比が3.74→4.71)
// 他8色・他トークンは全数チェック済みで基準内。色だけを持ちレイアウトを知らない。
// --elev は面の分け方 (ライトは影・黒は影が見えないので none にして境界線で分ける)。
const ARTICLE_COLOR_TOKENS = {
    red: { bg: '#fffafa', surface: '#fdf3f2', txt: '#1f1414', sub: '#7a5f5f', line: '#f3dedc', acc: '#c0392b', accT: '#fff', cov1: '#f0dbd8', cov2: '#dbbdb9', elev: '0 2px 10px rgba(60,20,20,.07)' },
    orange: { bg: '#fffaf4', surface: '#fdf2e6', txt: '#1f1810', sub: '#7d6650', line: '#f2e2cd', acc: '#ad600a', accT: '#fff', cov1: '#f0e0cb', cov2: '#dcc4a5', elev: '0 2px 10px rgba(60,40,10,.07)' },
    pink: { bg: '#fff8fa', surface: '#fdf0f4', txt: '#20141a', sub: '#7d5d6a', line: '#f3dde5', acc: '#c43f72', accT: '#fff', cov1: '#f0dae3', cov2: '#dbbccb', elev: '0 2px 10px rgba(60,20,40,.07)' },
    purple: { bg: '#faf8fd', surface: '#f3eefb', txt: '#181425', sub: '#665c85', line: '#e5dcf4', acc: '#6d43ad', accT: '#fff', cov1: '#e2daf2', cov2: '#c6badf', elev: '0 2px 10px rgba(40,20,70,.08)' },
    // 黄だけ「地の色＝黄・インク＝黒」(黄をアクセントにすると白背景でコントラスト比が足りず可読性が出ないため)
    yellow: { bg: '#fdf1c4', surface: '#fbe9a8', txt: '#1c1705', sub: '#6b5c22', line: '#eddb96', acc: '#1c1705', accT: '#fdf1c4', cov1: '#f6e3a4', cov2: '#e5cd80', elev: '0 2px 10px rgba(80,65,10,.10)' },
    brown: { bg: '#fbf9f6', surface: '#f4efe7', txt: '#231d16', sub: '#6f6154', line: '#e6ddd0', acc: '#8a6a45', accT: '#fff', cov1: '#e4d9c8', cov2: '#cbb99f', elev: '0 2px 10px rgba(60,45,25,.08)' },
    green: { bg: '#f7faf7', surface: '#eef5ef', txt: '#142016', sub: '#5c7062', line: '#dce8de', acc: '#2f7346', accT: '#fff', cov1: '#dbe8dd', cov2: '#bcd0c0', elev: '0 2px 10px rgba(20,50,30,.07)' },
    blue: { bg: '#f7f9fd', surface: '#edf2fb', txt: '#111a2b', sub: '#5a6b85', line: '#dde5f2', acc: '#2a5fa8', accT: '#fff', cov1: '#dce5f3', cov2: '#bdcbe3', elev: '0 2px 10px rgba(20,35,70,.08)' },
    // 黒がダークテーマを兼ねる (別軸のダークモードは用意しない, ADR-058追補2)。影が見えないので境界線で面を分ける
    black: { bg: '#0f0f11', surface: '#191a1d', txt: '#ececee', sub: '#8f9096', line: '#2f3036', acc: '#e8e8ea', accT: '#0f0f11', cov1: '#2c2d33', cov2: '#1c1d21', elev: 'none' },
    white: { bg: '#ffffff', surface: '#fafafa', txt: '#101010', sub: '#666666', line: '#e7e7e7', acc: '#101010', accT: '#fff', cov1: '#ededed', cov2: '#d6d6d6', elev: '0 2px 10px rgba(0,0,0,.06)' }
};

// ===== 構造 CSS (全レイアウト共通・コアが出す HTML はこれ1種類。色は var() 参照のみ・レイアウトは色を知らない) =====
const ARTICLE_BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif;line-height:1.75;background:var(--bg);color:var(--txt)}
img{max-width:100%;display:block}
a{color:var(--acc)}
.article{max-width:760px;margin:0 auto;padding:48px 24px 60px}
.blk{margin:0 0 36px}
.article>h1{font-size:34px;line-height:1.28;margin:0 0 12px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 36px;list-style:none}
.tags .tag{font-size:11px;padding:3px 11px;border-radius:999px;color:var(--sub);background:var(--surface);border:1px solid var(--line)}
.blk-text h2,.blk-text h3,.blk-text h4,.blk-text h5,.blk-text h6{color:var(--acc);margin:1.2em 0 .5em}
.blk-text>:first-child{margin-top:0}
.blk-text p{margin:0 0 12px;font-size:14px}
.blk-text ul,.blk-text ol{margin:0 0 12px;padding-left:1.4em;font-size:14px}
.blk-text blockquote{margin:0 0 12px;padding-left:14px;border-left:3px solid var(--line);color:var(--sub)}
.bk-cover{aspect-ratio:5/7;object-fit:cover;border-radius:4px;background:linear-gradient(150deg,var(--cov1),var(--cov2));border:1px solid var(--line)}
.bk-cover.cover-ph{display:flex;align-items:center;justify-content:center;text-align:center;padding:10px;font-size:11px;font-weight:600;line-height:1.35;color:var(--sub);overflow:hidden}
.bk-title{font-size:13px;margin:8px 0 2px;font-weight:700}
.bk-author{font-size:11px;color:var(--sub)}
.bk-memo{font-size:12px;margin-top:6px;color:var(--sub);line-height:1.6;white-space:pre-wrap}
.bk-detail{font-size:12px;margin-top:8px;color:var(--sub);line-height:1.7}
.bk-detail h2,.bk-detail h3,.bk-detail h4,.bk-detail h5,.bk-detail h6{color:var(--txt);margin:1em 0 .4em;font-size:1em}
.blk-book{display:grid;grid-template-columns:150px 1fr;gap:24px;align-items:start;padding:22px;
  border-radius:10px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--elev)}
.blk-book .bk-title{font-size:17px;margin:0 0 3px}
.blk-book .bk-author{margin-bottom:12px}
.amz{display:inline-block;margin-top:10px;font-size:11px;text-decoration:none;padding:6px 13px;
  border-radius:5px;background:var(--acc);color:var(--acc-t);font-weight:700}
.pub-ad-top{display:flex;align-items:center;gap:.45em;margin:0 0 20px;color:var(--sub);font-size:11px;line-height:1.4}
.pub-ad-tag{font-size:10px;font-weight:600;letter-spacing:.06em;border:1px solid var(--line);border-radius:4px;padding:.05em .45em;flex:none}
footer.pub-footer{max-width:760px;margin:0 auto;padding:18px 24px 30px;font-size:10px;color:var(--sub);line-height:1.8;border-top:1px solid var(--line)}
footer.pub-footer p{margin:.3rem 0}
footer.pub-footer a{color:var(--sub)}
`;

// ===== レイアウト CSS (3種のみ・色を知らない・var() だけ参照。.bk は grid-template-areas で名前付き配置する) =====
// 注意: 各ルールは必ず ".bk .bk-*" のように本棚グリッドの繰り返し要素 (.shelf > .bk) の子孫だけに
// スコープする。".bk-*" 単体セレクタにすると本ブロック (.blk-book、grid-template-areas を使わない
// 単純2カラム) 内の同名クラスにも grid-area / display:none が漏れて配置が壊れる
// (完了条件検証で発見: card は表紙が意図しない位置に飛び、wall は本ブロックのタイトル等まで消えていた)。
const ARTICLE_LAYOUT_CSS = {
    // D: ウォール — 表紙のみ (タイトル/著者/メモは CSS で非表示)。表紙が主役
    wall: `
[data-layout="wall"] .article{max-width:940px}
[data-layout="wall"] .article>h1{font-size:24px;font-weight:600}
[data-layout="wall"] .shelf{display:grid;grid-template-columns:repeat(6,1fr);gap:9px}
[data-layout="wall"] .bk{display:grid;grid-template-areas:"cov"}
[data-layout="wall"] .bk .bk-cover{grid-area:cov;font-size:9px;border-color:var(--sub);border-radius:2px}
[data-layout="wall"] .bk .bk-title,[data-layout="wall"] .bk .bk-author,[data-layout="wall"] .bk .bk-memo,[data-layout="wall"] .bk .bk-detail{display:none}
@media(max-width:640px){[data-layout="wall"] .shelf{grid-template-columns:repeat(3,1fr)}}
`,
    // G: カウントダウン — 番号つき縦リスト。表紙小・メモは引用線つき
    count: `
[data-layout="count"] .shelf{display:flex;flex-direction:column;counter-reset:n}
[data-layout="count"] .bk{display:grid;grid-template-columns:66px 66px 1fr;gap:2px 16px;align-content:start;
  grid-template-areas:"num cov ttl" "num cov auth" "num cov memo";
  padding:22px 0;border-top:1px solid var(--line)}
[data-layout="count"] .bk::before{grid-area:num;counter-increment:n;
  content:counter(n,decimal-leading-zero);font-size:44px;line-height:.95;font-weight:800;color:var(--line)}
[data-layout="count"] .bk .bk-cover{grid-area:cov;align-self:start;font-size:8px}
[data-layout="count"] .bk .bk-title{grid-area:ttl;font-size:16px;margin:0 0 2px}
[data-layout="count"] .bk .bk-author{grid-area:auth}
[data-layout="count"] .bk .bk-memo,[data-layout="count"] .bk .bk-detail{grid-area:memo;margin-top:8px;padding-left:11px;border-left:2px solid var(--line)}
@media(max-width:560px){[data-layout="count"] .bk{grid-template-columns:52px 52px 1fr}}
`,
    // I: カード — 3列・影(または枠)付きカード。現代的な標準形
    card: `
[data-layout="card"] .article{max-width:860px}
[data-layout="card"] .blk-text{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 22px;box-shadow:var(--elev)}
[data-layout="card"] .shelf{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
[data-layout="card"] .bk{display:grid;grid-template-areas:"cov" "ttl" "auth" "memo";background:var(--surface);
  border:1px solid var(--line);border-radius:12px;padding:13px;box-shadow:var(--elev)}
[data-layout="card"] .bk .bk-cover{grid-area:cov;border-radius:7px}
[data-layout="card"] .bk .bk-title{grid-area:ttl}
[data-layout="card"] .bk .bk-author{grid-area:auth}
[data-layout="card"] .bk .bk-memo,[data-layout="card"] .bk .bk-detail{grid-area:memo;background:var(--bg);border-radius:7px;padding:7px 9px;margin-top:8px}
@media(max-width:560px){[data-layout="card"] .shelf{grid-template-columns:repeat(2,minmax(0,1fr))}}
`
};

class PublishArticleGenerator {
    constructor(app) {
        this.app = app;
    }

    // ===== Markdown → HTML (js/vendor/marked.umd.js, CDN不使用・§11.4) =====
    //
    // 生 HTML の混入 (<script> 等) は renderer.html でエスケープし、リンク/画像は http(s):/mailto: の
    // スキームのみ許可する (それ以外は無効化)。CSP script-src 'none' に加えた多層防御。
    static markdownToHtml(markdown) {
        const src = String(markdown == null ? '' : markdown);
        if (!src.trim()) return '';
        const g = (typeof globalThis !== 'undefined' && globalThis.marked) ||
                  (typeof window !== 'undefined' && window.marked);
        const esc = PublishGenerator.esc;
        if (!g || typeof g.parse !== 'function' || typeof g.Renderer !== 'function') {
            // vendor 未ロード時のフォールバック (テスト環境の取りこぼし対策)。素の段落として escape する。
            return `<p>${esc(src)}</p>`;
        }
        const SAFE_URL_RE = /^(https?:|mailto:)/i;
        const safeHref = (href) => { const h = String(href || '').trim(); return SAFE_URL_RE.test(h) ? h : null; };
        const renderer = new g.Renderer();
        renderer.html = (token) => esc(typeof token === 'string' ? token : (token && (token.text ?? token.raw)) || '');
        // リンクテキストは (安全のため) プレーンテキスト化する。ネストした強調等の装飾は失われるが、
        // 生 HTML/危険スキームの混入を確実に防げる方を優先する (§11.4・リッチ機能は作り込まない方針)。
        renderer.link = (token) => {
            const href = safeHref(token.href);
            const text = esc(token.text != null ? token.text : '');
            if (!href) return text;
            const title = token.title ? ` title="${esc(token.title)}"` : '';
            return `<a href="${esc(href)}"${title} rel="nofollow noopener" target="_blank">${text}</a>`;
        };
        renderer.image = (token) => {
            const href = safeHref(token.href);
            if (!href) return '';
            return `<img src="${esc(href)}" alt="${esc(token.text || '')}" loading="lazy">`;
        };
        return g.parse(src, { renderer, gfm: true, breaks: false });
    }

    // ===== 見出しシフト (§11.5) =====
    //
    // html 内で最も浅い見出しレベルを検出し、targetLevel との差分だけ一律シフトする (固定 +1 にしない)。
    // 相対関係は保つ・h6 で打ち止め。見出しが無ければそのまま返す。純関数 (テストしやすい形で切り出し)。
    static shiftHtmlHeadings(html, targetLevel) {
        const src = String(html == null ? '' : html);
        const levels = [];
        const scan = /<h([1-6])(?=[\s>])/gi;
        let m;
        while ((m = scan.exec(src))) levels.push(Number(m[1]));
        if (!levels.length) return src;
        const minLevel = Math.min(...levels);
        const delta = targetLevel - minLevel;
        if (!delta) return src;
        return src.replace(/<(\/)?h([1-6])(?=[\s>])/gi, (whole, closing, lvl) => {
            const nl = Math.max(1, Math.min(6, Number(lvl) + delta));
            return `<${closing || ''}h${nl}`;
        });
    }

    // ===== 配色 / レイアウト CSS =====
    static colorTokensCss(color) {
        const t = ARTICLE_COLOR_TOKENS[color] || ARTICLE_COLOR_TOKENS.white;
        return `:root{--bg:${t.bg};--surface:${t.surface};--txt:${t.txt};--sub:${t.sub};--line:${t.line};` +
            `--acc:${t.acc};--acc-t:${t.accT};--cov1:${t.cov1};--cov2:${t.cov2};--elev:${t.elev}}`;
    }
    static layoutCss(layout) {
        return ARTICLE_LAYOUT_CSS[layout] || ARTICLE_LAYOUT_CSS.card;
    }

    // ===== Amazon リンク (旧 PublishGenerator._amazonUrl と同ロジック。ADR-033/034追補) =====
    _amazonUrl(asin, linkOpts) {
        const a = encodeURIComponent(asin);
        if (linkOpts && linkOpts.goBase) return `${linkOpts.goBase}/${a}`;
        let url = `https://www.amazon.co.jp/dp/${a}`;
        const tag = linkOpts && linkOpts.tag;
        if (tag) url += `?tag=${encodeURIComponent(tag)}`;
        return url;
    }

    _helpers() {
        const esc = PublishGenerator.esc;
        return {
            esc, attr: esc,
            cover: (b) => {
                if (!b) return '';
                if (b.productImage) return `<img class="bk-cover" loading="lazy" src="${esc(b.productImage)}" alt="${esc(b.title)}">`;
                return `<div class="bk-cover cover-ph">${esc(b.title)}</div>`;
            },
            title: (b) => `<p class="bk-title">${esc(b.title)}</p>`,
            author: (b) => b.authors ? `<p class="bk-author">${esc(b.authors)}</p>` : '',
            shortMemo: (b) => b.shortMemo ? `<p class="bk-memo">${esc(b.shortMemo)}</p>` : '',
            longMemo: (html) => html ? `<div class="bk-detail">${html}</div>` : '',
            amazon: (b, label) => `<a class="amz" href="${esc(b.amazonUrl)}" target="_blank" rel="nofollow sponsored noopener">${esc(label || 'Amazon で見る')}</a>`
        };
    }

    // ===== データ解決 =====

    _resolveBookData(asin, libMap, state, linkOpts) {
        const lib = libMap.get(asin);
        if (!lib) return null;
        const effAsin = lib.updatedAsin || lib.asin;
        const note = (state.notes && state.notes[asin]) || {};
        // 短文メモ: ALL のみ (2026-06-20: 本棚 override 廃止, ADR-007)。hideMemo は ALL memo の opt-out
        const shortMemo = note.hideMemo ? '' : (note.memo || '');
        return {
            asin, title: lib.title || '', authors: lib.authors || '',
            productImage: lib.productImage || '',
            shortMemo,
            detailMemo: '', // 後で async 解決
            _hasDetail: !!(note.hasDetailMemo && !note.hideDetailMemo),
            amazonUrl: this._amazonUrl(effAsin, linkOpts)
        };
    }

    _shelfBooks(shelfKey, state) {
        const metas = (state.bookshelvesMeta && state.bookshelvesMeta.bookshelves) || [];
        const meta = metas.find(m => m.slug === shelfKey || m.internalId === shelfKey);
        if (!meta) return [];
        if (meta.slug === 'all' || meta.isSpecial) return (state.allBookshelf && state.allBookshelf.books) || [];
        const file = state.bookshelfFiles && state.bookshelfFiles[meta.internalId];
        return (file && file.books) || [];
    }

    // 記事のブロック列を蔵書データへ解決する。detailMemo (長文メモ) は表示対象のものだけ非同期で埋める。
    async _resolveBlocks(article, state, libMap, linkOpts) {
        const resolved = [];
        const detailTargets = []; // { bookData, needed:bool } を async 読み込み後に埋める

        for (const block of (article.blocks || [])) {
            if (block.type === 'text') {
                resolved.push({ type: 'text', block });
                continue;
            }
            if (block.type === 'book') {
                const bookData = this._resolveBookData(block.asin, libMap, state, linkOpts);
                if (bookData && block.show.longMemo && bookData._hasDetail) detailTargets.push(bookData);
                resolved.push({ type: 'book', block, bookData });
                continue;
            }
            if (block.type === 'shelf') {
                const items = (block.items || []).map(placement => {
                    const bookData = this._resolveBookData(placement.asin, libMap, state, linkOpts);
                    if (bookData && placement.show.longMemo && bookData._hasDetail) detailTargets.push(bookData);
                    return { placement, bookData };
                });
                resolved.push({ type: 'shelf', block, items });
            }
        }

        for (const bookData of detailTargets) {
            try {
                const text = await this.app.storage.readBookMemo(bookData.asin, bookData.title);
                if (text != null) bookData.detailMemo = PublishGenerator.stripFrontmatter(text);
            } catch (_) { /* 読み込み失敗はそのブロックのメモを空のままにする (ページ全体は落とさない) */ }
        }

        return resolved;
    }

    // ===== ブロック HTML =====

    _renderTextBlock(resolved) {
        const html = PublishArticleGenerator.markdownToHtml(resolved.block.markdown);
        const shifted = PublishArticleGenerator.shiftHtmlHeadings(html, ARTICLE_HEADING_LEVEL.textBlock);
        return shifted ? `<section class="blk blk-text">${shifted}</section>` : '';
    }

    _renderBookBlock(resolved, h) {
        const { block, bookData } = resolved;
        if (!bookData) return '';
        const longMemoHtml = (block.show.longMemo && bookData.detailMemo)
            ? PublishArticleGenerator.shiftHtmlHeadings(
                PublishArticleGenerator.markdownToHtml(bookData.detailMemo), ARTICLE_HEADING_LEVEL.detailMemo)
            : '';
        return `<section class="blk blk-book">
${h.cover(bookData)}
<div class="blk-book-body">
${h.title(bookData)}
${h.author(bookData)}
${block.show.shortMemo ? h.shortMemo(bookData) : ''}
${h.longMemo(longMemoHtml)}
${h.amazon(bookData)}
</div>
</section>`;
    }

    _renderShelfBlock(resolved, h) {
        const { items } = resolved;
        const tiles = items.map(({ placement, bookData }) => {
            if (!bookData) return '';
            const longMemoHtml = (placement.show.longMemo && bookData.detailMemo)
                ? PublishArticleGenerator.shiftHtmlHeadings(
                    PublishArticleGenerator.markdownToHtml(bookData.detailMemo), ARTICLE_HEADING_LEVEL.detailMemo)
                : '';
            return `<div class="bk">
${h.cover(bookData)}
${h.title(bookData)}
${h.author(bookData)}
${placement.show.shortMemo ? h.shortMemo(bookData) : ''}
${h.longMemo(longMemoHtml)}
</div>`;
        }).join('');
        return `<section class="blk blk-shelf"><div class="shelf">${tiles}</div></section>`;
    }

    _renderBlocks(resolvedBlocks) {
        const h = this._helpers();
        return resolvedBlocks.map(r => {
            if (r.type === 'text') return this._renderTextBlock(r);
            if (r.type === 'book') return this._renderBookBlock(r, h);
            if (r.type === 'shelf') return this._renderShelfBlock(r, h);
            return '';
        }).filter(Boolean).join('\n');
    }

    // ===== HTML シェル =====

    _wrapDoc(article, publisher, body, opts = {}) {
        const esc = PublishGenerator.esc;
        const theme = PublishArticleStore.normalizeTheme(article.theme);
        const pageHasAds = !!opts.pageHasAds;
        const siteHasAffiliate = !!opts.siteHasAffiliate;
        const ogImage = opts.ogImage || '';
        const canonical = opts.canonical || '';
        const updated = PublishGenerator._fmtDate(opts.updatedAt);
        const year = PublishGenerator._year(opts.updatedAt);
        const reportSubject = encodeURIComponent(`[通報] AsayakeBookshelf 公開記事 ${opts.reportRef || ''}`.trim());

        const tagsHtml = (article.tags || []).length
            ? `<ul class="tags">${article.tags.map(t => `<li class="tag">${esc(t)}</li>`).join('')}</ul>` : '';

        // 景表法 (ステマ規制): 実アフィリンクを含む記事は、クリック前に「広告」と分かるよう本文冒頭に明示する
        const adNoticeTop = pageHasAds
            ? `<p class="pub-ad-top"><span class="pub-ad-tag">広告</span>Amazon アソシエイトのリンクを含みます</p>` : '';
        const affiliateStanding = siteHasAffiliate
            ? `<p class="pub-affiliate">当サイトは Amazon アソシエイト・プログラムに参加しており、リンク経由の適格販売により収益を得る場合があります。</p>`
            : '';

        const head = [
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            // 公開ページは「JS が動かない」前提で安全性が成立する (ADR-032・09 §10.7)。GitHub Pages はヘッダを
            // 付けられないため、出力自体に CSP meta を埋めてどの公開先でも script を無効化する。
            `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'">`,
            `<title>${esc(article.title)} — ${esc(publisher)}</title>`,
            `<meta name="robots" content="${opts.noindex ? 'noindex,nofollow' : 'index,follow'}">`,
            `<link rel="icon" href="${PublishGenerator.FAVICON}">`,
            canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
            `<meta property="og:title" content="${esc(article.title)}">`,
            `<meta property="og:type" content="article">`,
            `<meta property="og:site_name" content="${esc(publisher)} の本棚">`,
            canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
            ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '',
            ogImage ? `<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'
        ].filter(Boolean).join('\n');

        return `<!doctype html>
<html lang="ja" data-layout="${esc(theme.layout)}" data-color="${esc(theme.color)}">
<head>
${head}
<style>${PublishArticleGenerator.colorTokensCss(theme.color)}
${ARTICLE_BASE_CSS}
${PublishArticleGenerator.layoutCss(theme.layout)}</style>
</head>
<body>
<article class="article">
<h1>${esc(article.title)}</h1>
${tagsHtml}
${adNoticeTop}
${body}
</article>
<footer class="pub-footer">
${affiliateStanding}
<p class="pub-rights">© ${year} ${esc(publisher)}　｜　書影・書誌情報は Amazon / Google 提供。掲載の感想・評価は発行者個人のものです。</p>
${updated ? `<p class="pub-updated">最終更新 ${esc(updated)}</p>` : ''}
<p class="pub-powered">Powered by <a href="https://hahero-asayake.github.io/bookshelf" target="_blank" rel="noopener">AsayakeBookshelf</a></p>
<p class="pub-legal"><a href="https://hahero-asayake.github.io/bookshelf/legal/terms.html" target="_blank" rel="noopener">利用規約</a>　<a href="https://hahero-asayake.github.io/bookshelf/legal/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>　<a href="mailto:asayake.hahero@gmail.com?subject=${reportSubject}">このページを通報</a></p>
</footer>
</body>
</html>`;
    }

    _indexHtml(publisher, articleLinks, opts = {}) {
        const esc = PublishGenerator.esc;
        const items = articleLinks.map(a =>
            `<li><a href="./${esc(a.slug)}/">${esc(a.title)}</a></li>`
        ).join('\n');
        const body = `<ul class="index-list">${items || '<li>公開記事がありません</li>'}</ul>`;
        const css = `.index-list{list-style:none;padding:0;margin:32px 0}
.index-list li{padding:16px 0;border-bottom:1px solid var(--line)}
.index-list a{font-size:1.05rem;font-weight:600;text-decoration:none}`;
        const updatedAt = articleLinks.reduce((m, a) => Math.max(m, a.updatedAt || 0), 0);
        // index はテーマを持たない一覧ページなので既定テーマ (_wrapDoc の normalizeTheme フォールバック) で包む
        const indexArticle = { title: `${publisher} の本棚`, tags: [], theme: {} };
        const doc = this._wrapDoc(indexArticle, publisher, body, {
            siteHasAffiliate: !!opts.siteHasAffiliate,
            canonical: opts.siteBaseUrl ? `${String(opts.siteBaseUrl).replace(/\/+$/, '')}/` : '',
            updatedAt,
            reportRef: opts.reportRef || ''
        });
        // index には記事別テーマの CSS だけでなく一覧用の css を追加で差し込む
        return doc.replace('</style>', `${css}</style>`);
    }

    // ===== プライバシーガード (旧 PublishGenerator._detectLeak と同ロジック) =====

    _detectLeak(files, state) {
        const ps = state.privateSettings || {};
        const vault = String(ps.obsidianVaultName || '').trim();
        const sub = String(ps.obsidianSubPath || '').trim();
        const rawNeedles = [];
        if (sub && sub.length >= 4) rawNeedles.push(sub);
        if (sub && sub.length >= 2) rawNeedles.push(`${sub}/`);
        if (vault && sub) rawNeedles.push(`${vault}/${sub}`);
        const needles = [...new Set(rawNeedles.filter(Boolean))];
        const found = new Set();
        for (const f of files) {
            for (const n of needles) {
                if (f.content.includes(n)) found.add(`${n} (${f.path})`);
            }
        }
        return [...found];
    }

    // ===== ビルド =====

    async build(articles, opts = {}) {
        const raw = (opts.state) || (await this.app.storage.loadAll()) || {};
        const state = {
            library: raw.library || { books: [] },
            bookshelvesMeta: raw.bookshelvesMeta || { bookshelves: [] },
            allBookshelf: raw.allBookshelf || { books: [] },
            bookshelfFiles: raw.bookshelfFiles || {},
            notes: raw.notes || {},
            privateSettings: raw.privateSettings || {}
        };
        const libMap = new Map((state.library.books || []).map(b => [b.asin, b]));
        const ps = state.privateSettings || {};
        let publisher = ps.publicDisplayName || '';
        if (!publisher) {
            try {
                if (typeof SyncConfigManager !== 'undefined') {
                    const email = (SyncConfigManager.load().hub || {}).email || '';
                    publisher = email ? email.split('@')[0] : '';
                }
            } catch (_) {}
        }
        if (!publisher) publisher = 'マイ本棚';

        const siteBaseUrl = String(opts.siteBaseUrl || '').replace(/\/+$/, '');

        // Amazon リンク方式 (旧 PublishGenerator と同じ規約・ADR-033/034追補)
        const target = opts.target === 'hub' ? 'hub' : 'github';
        const ownTag = ps.affiliateId || '';
        let siteId = '';
        if (target === 'hub') {
            siteId = String(opts.siteId || '').trim();
            if (!siteId) { const m = siteBaseUrl.match(/\/public\/([^/]+)/); if (m) siteId = decodeURIComponent(m[1]); }
        }
        const useGo = target === 'hub' && !!siteId;
        const linkOpts = useGo
            ? { goBase: `/go/${encodeURIComponent(siteId)}` }
            : { tag: target === 'github' ? ownTag : '' };
        const monetized = useGo ? true : (target === 'github' ? !!ownTag : false);
        const siteHasAffiliate = monetized;
        const reportRef = siteId ? `siteId=${siteId}` : siteBaseUrl;

        const files = [];
        const built = [];
        const errors = [];

        for (const article of articles) {
            let resolvedBlocks, body;
            try {
                resolvedBlocks = await this._resolveBlocks(article, state, libMap, linkOpts);
                body = this._renderBlocks(resolvedBlocks);
            } catch (e) { errors.push(`resolve ${article.title}: ${e.message}`); continue; }

            const bookCount = resolvedBlocks.reduce((n, r) => {
                if (r.type === 'book') return n + (r.bookData ? 1 : 0);
                if (r.type === 'shelf') return n + r.items.filter(i => i.bookData).length;
                return n;
            }, 0);

            // 広告ラベルは「実際に出力された当方のアフィリンク」で判定する (スタイル非依存, ADR-034追補と同方針)
            const pageHasAds = useGo
                ? body.includes(`/go/${encodeURIComponent(siteId)}/`)
                : (!!linkOpts.tag && body.includes(`tag=${encodeURIComponent(linkOpts.tag)}`));

            // OGP の代表表紙 (ブロック順で最初に見つかったもの)
            let ogImage = '';
            for (const r of resolvedBlocks) {
                if (r.type === 'book' && r.bookData && r.bookData.productImage) { ogImage = r.bookData.productImage; break; }
                if (r.type === 'shelf') {
                    const found = r.items.find(i => i.bookData && i.bookData.productImage);
                    if (found) { ogImage = found.bookData.productImage; break; }
                }
            }

            const html = this._wrapDoc(article, publisher, body, {
                pageHasAds, siteHasAffiliate, ogImage,
                canonical: siteBaseUrl ? `${siteBaseUrl}/${article.slug}/` : '',
                noindex: !article.published,
                updatedAt: article.updatedAt || article.lastBuiltAt || 0,
                reportRef
            });
            files.push({ path: `${article.slug}/index.html`, content: html });
            built.push({ id: article.id, slug: article.slug, title: article.title, url: `${article.slug}/`, books: bookCount, updatedAt: article.updatedAt || 0 });
        }

        files.push({ path: 'index.html', content: this._indexHtml(publisher, built, { siteHasAffiliate, siteBaseUrl, reportRef }) });

        const leak = this._detectLeak(files, state);
        return { files, articles: built, leak, errors, ownTag };
    }
}

if (typeof window !== 'undefined') {
    window.PublishArticleGenerator = PublishArticleGenerator;
    window.ARTICLE_HEADING_LEVEL = ARTICLE_HEADING_LEVEL;
    window.ARTICLE_COLOR_TOKENS = ARTICLE_COLOR_TOKENS;
}
if (typeof globalThis !== 'undefined') {
    globalThis.PublishArticleGenerator = PublishArticleGenerator;
    globalThis.ARTICLE_HEADING_LEVEL = ARTICLE_HEADING_LEVEL;
    globalThis.ARTICLE_COLOR_TOKENS = ARTICLE_COLOR_TOKENS;
}
