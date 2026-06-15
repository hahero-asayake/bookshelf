// PublishGenerator - 公開ページ定義から自己完結の静的 HTML を生成 (P1 静的SSG, ADR-030)
//
// 役割:
//   1. ページの対象選択 (本棚/本) を蔵書データへ解決し、公開項目 (fields) を適用
//   2. スタイルの render(ctx) を呼び本文 HTML を得て、共通シェル (hero/footer/OGP/CSS) で wrap
//   3. トップ index.html (ページ一覧) を生成
//   4. プライバシーガード: 出力に個人情報 (obsidian vault 名等) が混入していないか検査
//
// 出力はアプリ実行に依存しない純粋な HTML/CSS。表紙は Amazon/Google の remote URL を直接参照
// (ローカル asset 同梱なし)。Amazon リンクにはアフィリエイト tag を付ける (公開ページの収益化、開示あり)。
//
// 依存: app.storage.loadAll() / app.storage.readBookMemo(asin,title) / styleRegistry

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/;

// 公開項目はスタイルが declare().shows で固定する (ユーザのページ毎トグルは廃止)。
// shows を宣言しないスタイル (将来のプラグイン等) のための保険として全項目 ON を既定にする。
const ALL_FIELDS_ON = { rating: true, memo: true, detailMemo: true, cover: true, author: true, amazon: true };

// hahero (運営) の Amazon アソシエイト tag (ADR-033)。Free プランの公開ページに付く。
// ⚠️ 実 tag は未確定 (一次確認 TODO)。REPLACE_ のままの間は無印リンク (誤った tag への送客を防ぐ)。
const HAHERO_AFFILIATE_TAG = 'asayake09-22';
function operatorAffiliateTag() {
    return HAHERO_AFFILIATE_TAG.startsWith('REPLACE') ? '' : HAHERO_AFFILIATE_TAG;
}

class PublishGenerator {
    constructor(app, styleRegistry) {
        this.app = app;
        this.styles = styleRegistry || (typeof createPublishStyleRegistry === 'function' ? createPublishStyleRegistry() : null);
    }

    static esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 公開物の自己完結 favicon (SVG data URI。外部 asset を要求しない)
    static get FAVICON() {
        return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232d2638'/%3E%3Ccircle cx='16' cy='21' r='8' fill='%23ff9e7d'/%3E%3Crect x='5' y='21' width='22' height='6' fill='%232d2638'/%3E%3C/svg%3E";
    }

    static _fmtDate(ms) {
        if (!ms) return '';
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    static _year(ms) {
        const d = ms ? new Date(ms) : new Date();
        return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
    }

    static stripFrontmatter(text) {
        return String(text || '').replace(FRONTMATTER_RE, '').trim();
    }

    static _starHtml(rating) {
        const n = Math.max(0, Math.min(5, Math.round(rating || 0)));
        let s = '';
        for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '<span class="off">★</span>';
        return s;
    }

    _amazonUrl(asin, affiliateId) {
        let url = `https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}`;
        if (affiliateId) url += `?tag=${encodeURIComponent(affiliateId)}`;
        return url;
    }

    // 公開項目の取捨と escape を集約した helpers (スタイルはこれ経由でのみ出力する)
    _helpers(fields) {
        const esc = PublishGenerator.esc;
        return {
            esc,
            attr: esc,
            cover: (b) => {
                if (!fields.cover) return '';
                if (b.productImage) return `<img class="cover" loading="lazy" src="${esc(b.productImage)}" alt="${esc(b.title)}">`;
                return `<div class="cover-ph">No Image</div>`;
            },
            author: (b) => (fields.author && b.authors) ? `<p class="author">${esc(b.authors)}</p>` : '',
            stars: (b) => (fields.rating && b.rating > 0) ? `<p class="stars">${PublishGenerator._starHtml(b.rating)}</p>` : '',
            memo: (b) => (fields.memo && b.memo) ? `<p class="memo">${esc(b.memo)}</p>` : '',
            detailMemo: (b) => (fields.detailMemo && b.detailMemo) ? `<div class="longmemo">${esc(b.detailMemo)}</div>` : '',
            amazon: (b, label) => fields.amazon ? `<a class="amazon" href="${esc(b.amazonUrl)}" target="_blank" rel="nofollow sponsored noopener">${esc(label || 'Amazon')}</a>` : ''
        };
    }

    // ===== データ解決 =====

    _resolveBook(asin, libMap, state, fields, shelfInternalId, affiliateId) {
        const lib = libMap.get(asin);
        if (!lib) return null;
        const effAsin = lib.updatedAsin || lib.asin;
        const allNote = (state.notes && state.notes[asin]) || {};
        const shelfFile = shelfInternalId ? state.bookshelfFiles[shelfInternalId] : null;
        const shelfNote = (shelfFile && shelfFile.notes && shelfFile.notes[asin]) || {};
        // memo: 本棚 override 優先、無ければ ALL (hideMemo は ALL memo の opt-out)
        const memo = shelfNote.memo || (allNote.hideMemo ? '' : (allNote.memo || '')) || '';
        return {
            asin,
            title: lib.title || '',
            authors: lib.authors || '',
            productImage: lib.productImage || '',
            rating: allNote.rating || 0,
            memo,
            detailMemo: '', // 後で async 解決
            _needsDetail: !!(fields.detailMemo && allNote.hasDetailMemo && !allNote.hideDetailMemo),
            amazonUrl: this._amazonUrl(effAsin, affiliateId)
        };
    }

    _shelfBooks(meta, state) {
        if (meta.slug === 'all' || meta.isSpecial) {
            return (state.allBookshelf && state.allBookshelf.books) || [];
        }
        const file = state.bookshelfFiles[meta.internalId];
        if (!file) return [];
        // publishHide が立った本は除外
        return (file.books || []).filter(asin => {
            const n = file.notes && file.notes[asin];
            return !(n && n.publishHide);
        });
    }

    // ページ 1 つを解決 → ctx を返す (detailMemo は別 pass で埋める asin リストも返す)
    // fields は呼び出し側がスタイルの declare().shows から渡す (公開項目はスタイル固定)。
    _resolvePage(page, state, libMap, affiliateId, fields) {
        const metas = state.bookshelvesMeta.bookshelves || [];
        // 本棚参照は slug でも internalId でも引けるようにする (UI は slug、保存メタは両方持つ)
        const metaByKey = new Map();
        for (const m of metas) {
            if (m.slug) metaByKey.set(m.slug, m);
            if (m.internalId) metaByKey.set(m.internalId, m);
        }

        const shelves = [];
        for (const key of (page.select.shelves || [])) {
            const meta = metaByKey.get(key);
            if (!meta) continue;
            const asins = this._shelfBooks(meta, state);
            const books = asins.map(a => this._resolveBook(a, libMap, state, fields, meta.internalId, affiliateId)).filter(Boolean);
            shelves.push({
                meta: { name: meta.name, slug: meta.slug, description: meta.description || '', internalId: meta.internalId },
                books
            });
        }

        const books = (page.select.books || [])
            .map(a => this._resolveBook(a, libMap, state, fields, null, affiliateId))
            .filter(Boolean);

        return { fields, shelves, books };
    }

    // ===== HTML シェル =====

    _wrapDoc(page, publisher, body, css, opts = {}) {
        const esc = PublishGenerator.esc;
        const intro = page.intro || '';
        // opts: { pageHasAds, siteHasAffiliate, ogImage, canonical, noindex, updatedAt }
        const pageHasAds = !!opts.pageHasAds;          // このページに実アフィリンクが出る (景表法)
        const siteHasAffiliate = !!opts.siteHasAffiliate; // サイトとして収益化している (常時表明)
        const ogImage = opts.ogImage || '';
        const canonical = opts.canonical || '';
        const updated = PublishGenerator._fmtDate(opts.updatedAt);
        const year = PublishGenerator._year(opts.updatedAt);

        // 景表法 (ステマ規制): 実アフィリンクを含むページは、クリック前に「広告」と分かるよう
        // 本文冒頭に控えめなラベルを 1 行だけ出す (景観を損ねない最小限の明示)。
        const adNoticeTop = pageHasAds
            ? `<div class="pub-wrap"><p class="pub-ad-top"><span class="pub-ad-tag">広告</span>Amazon アソシエイトのリンクを含みます</p></div>`
            : '';
        // Amazon アソシエイト規約: 収益化しているサイトは全ページに参加表明を掲示する (フッターに静かに)。
        // 収益が誰に入るか (Free=運営 / Plus=発行者) は閲覧者に開示が必要な情報ではないので出さない。
        // プラン非依存の中立な 1 文に統一する。
        const affiliateStanding = siteHasAffiliate
            ? `<p class="pub-affiliate">当サイトは Amazon アソシエイト・プログラムに参加しており、リンク経由の適格販売により収益が発生します。</p>`
            : '';

        const head = [
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width,initial-scale=1">',
            `<title>${esc(page.title)} — ${esc(publisher)}</title>`,
            `<meta name="description" content="${esc(intro)}">`,
            `<meta name="robots" content="${opts.noindex ? 'noindex,nofollow' : 'index,follow'}">`,
            `<link rel="icon" href="${PublishGenerator.FAVICON}">`,
            canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
            `<meta property="og:title" content="${esc(page.title)}">`,
            `<meta property="og:description" content="${esc(intro)}">`,
            `<meta property="og:type" content="website">`,
            `<meta property="og:site_name" content="${esc(publisher)} の本棚">`,
            canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
            ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '',
            ogImage ? `<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'
        ].filter(Boolean).join('\n');

        return `<!doctype html>
<html lang="ja">
<head>
${head}
<style>${PUBLISH_BASE_CSS}${css || ''}</style>
</head>
<body>
<header class="pub-hero"><div class="pub-wrap">
  <h1>${esc(page.title)}</h1>
  ${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
  <p class="by">${esc(publisher)} の本棚</p>
</div></header>
<main>${adNoticeTop}${body}</main>
<footer class="pub-footer"><div class="pub-wrap">
  ${affiliateStanding}
  <p class="pub-rights">© ${year} ${esc(publisher)}　｜　書影・書誌情報は Amazon / Google 提供。掲載の感想・評価は発行者個人のものです。</p>
  ${updated ? `<p class="pub-updated">最終更新 ${esc(updated)}</p>` : ''}
  <p class="pub-powered">Powered by <a href="https://hahero-asayake.github.io/bookshelf" target="_blank" rel="noopener">AsayakeBookshelf</a></p>
</div></footer>
</body>
</html>`;
    }

    _indexHtml(publisher, pageLinks, opts = {}) {
        const esc = PublishGenerator.esc;
        const items = pageLinks.map(p =>
            `<li><a href="./${esc(p.slug)}/">${esc(p.title)}</a>${p.intro ? `<span class="ix-intro">${esc(p.intro)}</span>` : ''}</li>`
        ).join('\n');
        const body = `<div class="pub-wrap"><ul class="index-list">${items || '<li>公開ページがありません</li>'}</ul></div>`;
        const css = `.index-list{ list-style:none; padding:0; margin:32px 0 }
.index-list li{ padding:16px 0; border-bottom:1px solid var(--line) }
.index-list a{ font-size:1.15rem; font-weight:600; text-decoration:none }
.index-list .ix-intro{ display:block; color:var(--muted); font-size:.85rem; margin-top:.2rem }`;
        const updatedAt = pageLinks.reduce((m, p) => Math.max(m, p.updatedAt || 0), 0);
        return this._wrapDoc({ title: `${publisher} の本棚`, intro: '' }, publisher, body, css, {
            siteHasAffiliate: !!opts.siteHasAffiliate,
            canonical: opts.siteBaseUrl ? `${String(opts.siteBaseUrl).replace(/\/+$/, '')}/` : '',
            updatedAt
        });
    }

    // ===== プライバシーガード =====

    _detectLeak(files, state) {
        const ps = state.privateSettings || {};
        const vault = String(ps.obsidianVaultName || '').trim();
        const sub = String(ps.obsidianSubPath || '').trim();
        // 公開物に出てはいけない「識別性の高い私的パス」だけを needle にする。
        // - obsidianSubPath / vault+sub: ローカル vault のサブパス（十分に特異）
        // - vault 名単体・extensionImportOrigins は needle にしない:
        //   取込元 origin はアプリ自身の公開 URL（footer の Powered by リンク）や
        //   Amazon（アフィリエイトリンク）と正当に重なり、vault 名は一般語のことがあるため、
        //   needle にすると誤検知で公開が常にブロックされる。settings 自体は出力に含めないので
        //   これらが実際に漏れることはない。
        // 素の sub は十分長い時のみ (誤検知回避)。ただし短い sub でも「パス区切り付き」(`${sub}/`)
        // なら識別性が上がるので length>=2 で拾う (obsidian URL の vault 無し先頭成分 `wip/...` 対策)。
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

    async build(pages, opts = {}) {
        const raw = (opts.state) || (await this.app.storage.loadAll()) || {};
        // 未接続/欠損でもクラッシュしないよう正規化
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
        // 発行者名: 設定の公開名義 → 未設定ならハブのアカウント名(email ローカル部) → 中立値。
        // 運営名 'hahero' を他ユーザーの公開ページに出さない (ADR-034)。
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

        // アフィリエイト tag の出し分け (ADR-033):
        //   Plus  … 自分の tag (空なら広告なし)。Free … hahero (運営) の tag。
        // プランは hub 設定 (SyncConfigManager) の plan を正本とする。未接続/テストでは free 扱い。
        let plan = 'free';
        try {
            if (typeof SyncConfigManager !== 'undefined') plan = (SyncConfigManager.load().hub || {}).plan || 'free';
            else if (this.app && this.app.syncConfig) plan = (this.app.syncConfig.hub || {}).plan || 'free';
        } catch (_) {}
        const isPlus = plan === 'plus';
        const affiliateId = isPlus ? (ps.affiliateId || '') : operatorAffiliateTag();
        const hasAds = !!affiliateId; // 実際に tag が付く時だけ広告開示を出す
        // サイトとして収益化しているか (= 1つでもアフィタグが付く)。footer の常時表明はこれで出す
        const siteHasAffiliate = hasAds;
        // 公開先の絶対 URL (分かれば canonical / og:url に使う。不明なら付けない)
        const siteBaseUrl = String(opts.siteBaseUrl || '').replace(/\/+$/, '');

        const files = [];
        const built = [];
        const errors = [];

        for (const page of pages) {
            const style = this.styles && this.styles.get(page.styleId);
            if (!style) { errors.push(`スタイル未選択/不明: ${page.title} (${page.styleId})`); continue; }

            // 公開項目はスタイルが固定 (declare().shows)。未宣言スタイルは全項目 ON にフォールバック。
            const decl = (typeof style.declare === 'function' && style.declare()) || {};
            const fields = decl.shows || ALL_FIELDS_ON;
            const resolved = this._resolvePage(page, state, libMap, affiliateId, fields);

            // detailMemo を必要な本だけ async 読み込み
            const detailTargets = [];
            for (const s of resolved.shelves) for (const b of s.books) if (b._needsDetail) detailTargets.push(b);
            for (const b of resolved.books) if (b._needsDetail) detailTargets.push(b);
            for (const b of detailTargets) {
                try {
                    const text = await this.app.storage.readBookMemo(b.asin, b.title);
                    if (text != null) b.detailMemo = PublishGenerator.stripFrontmatter(text);
                } catch (e) { errors.push(`detailMemo ${b.asin}: ${e.message}`); }
            }

            const ctx = {
                page: { title: page.title, intro: page.intro, slug: page.slug },
                params: page.styleParams || {},
                fields: resolved.fields,
                shelves: resolved.shelves,
                books: resolved.books,
                site: { publisher },
                helpers: this._helpers(resolved.fields)
            };
            let rendered;
            try { rendered = style.render(ctx); }
            catch (e) { errors.push(`render ${page.title}: ${e.message}`); continue; }

            // 広告ラベルは「ページに実際に出力された当方のアフィリンク」で判定する。スタイルの自己申告
            // (declare().shows.amazon) には依存しない — 標準でもプラグイン製でも、当方の Amazon アソシエイト
            // tag が出力に含まれれば必ず冒頭ラベルが付く (= 行儀の悪い/無自覚なスタイルの未開示リンクを構造的に防ぐ)。
            // 本が 0 件なら tag も出ないので付かない (過剰開示を防ぐ)。
            const bookCount = resolved.shelves.reduce((n, s) => n + s.books.length, 0) + resolved.books.length;
            const pageHasAds = hasAds && (rendered.html || '').includes(`tag=${affiliateId}`);

            // OGP の og:image に使う代表表紙 (本棚→本の順で最初に見つかったもの)
            let ogImage = '';
            for (const s of resolved.shelves) { for (const b of s.books) { if (b.productImage) { ogImage = b.productImage; break; } } if (ogImage) break; }
            if (!ogImage) { for (const b of resolved.books) { if (b.productImage) { ogImage = b.productImage; break; } } }

            const html = this._wrapDoc(page, publisher, rendered.html || '', rendered.css || '', {
                pageHasAds,
                siteHasAffiliate,
                ogImage,
                canonical: siteBaseUrl ? `${siteBaseUrl}/${page.slug}/` : '',
                noindex: !!page.noindex,
                updatedAt: page.updatedAt || page.lastBuiltAt || 0
            });
            files.push({ path: `${page.slug}/index.html`, content: html });
            built.push({ id: page.id, slug: page.slug, title: page.title, url: `${page.slug}/`, books: bookCount, updatedAt: page.updatedAt || 0 });
        }

        // トップ index
        files.push({ path: 'index.html', content: this._indexHtml(publisher, built, { siteHasAffiliate, siteBaseUrl }) });

        const leak = this._detectLeak(files, state);
        return { files, pages: built, leak, errors };
    }
}

if (typeof window !== 'undefined') window.PublishGenerator = PublishGenerator;
if (typeof globalThis !== 'undefined') globalThis.PublishGenerator = PublishGenerator;
