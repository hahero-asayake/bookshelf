// PublishArticleStore - 公開v2「記事」モデルの CRUD (S1, ADR-058 / 09_公開システム設計 §11)
//
// 保存先: 同期先の private/publish/articles.json (private 配下 = 公開には出ない)
//   { articles: [ Article ] }
//
// Article = {
//   id,                      // 不変 ID
//   slug,                    // 公開 URL のパス断片 (一意・kebab)
//   title,                   // 記事タイトル (公開ページの h1 はこれだけになる・§11.5)
//   tags: [ '表示表記', ... ], // 自由タグ。配列は入力表記のまま保持 (表示は初出表記)。
//                             //   同一視は normalizeTagKey() で都度判定する (§11.6)。
//   blocks: [ Block ],        // ブロック列。種類は3つだけ (§11.2)
//   theme: { layout, color }, // レイアウト(wall|count|card) と配色(10色) の直交2軸 (§11.3)
//   sourceShelfId,            // 由来本棚 (internalId・任意)。「本の引き出し」(S3) がこの本棚の全本を出す入口
//   published,                // 公開状態 (true=サイトに出す)
//   createdAt, updatedAt, lastBuiltAt
// }
//
// Block (3種のみ・§11.2。本の間に文章を挟みたい場合は本棚ブロックを分割 or 本ブロックを並べる。
//        グリッド内部への差し込みは非対応):
//   文章  { id, type:'text',  markdown }
//   本    { id, type:'book',  asin, show:{ shortMemo, longMemo } }
//         … 単一配置なのでブロック自身が表示設定を持つ (配置レコードを別途持たない)
//   本棚  { id, type:'shelf', shelfId, items:[ Placement ] }
//         … 複数冊グリッド。items は記事保存時点のスナップショット (蔵書更新を自動反映しない・§11.1)
//
// Placement (本棚ブロック内の配置単位レコード・多重集合対応・追補1):
//   { id, blockId, asin, order, show:{ shortMemo, longMemo } }
//   同じ asin が同一記事内 (同一ブロック内・別ブロック間とも) に何度でも出現できる。
//   表示設定の持ち主は「本」ではなく「配置」。
//
// ※ 旧 PublishPage (private/publish/pages.json, publish-page-store.js) とは別モデル・別ファイル。
//    bookshelf.js の公開ページ管理 UI は公開v2 S3 でこのストアへ配線し直した (旧ファイル自体はまだ
//    残置・撤去は別イシュー)。旧データからの移行は migrateFromPages() / migrateFromLegacyIfNeeded() で行う
//    (非破壊: pages.json 自体は書き換えない)。
//
// ※ ストアは storage ({ readJSON(path), writeJSON(path,data) }) に依存。

const PUBLISH_ARTICLES_PATH = 'private/publish/articles.json';
const PUBLISH_PAGES_LEGACY_PATH = 'private/publish/pages.json';
const ARTICLE_LAYOUTS = ['wall', 'count', 'card'];
const ARTICLE_COLORS = ['red', 'orange', 'pink', 'purple', 'yellow', 'brown', 'green', 'blue', 'black', 'white'];
const ARTICLE_DEFAULT_THEME = { layout: 'card', color: 'white' };

class PublishArticleStore {
    constructor(storage) {
        this.storage = storage;
        this._articles = null; // 未ロード (読込成功まで null。読込失敗時も null のまま = 空リストと区別する)
        this.lastLoadError = null;   // 直近の load() 失敗 (成功時は null)
        this.lastPersistError = null; // 直近の _persist() 失敗 (成功時は null)
        this._dirty = false; // true = メモリ上の変更が同期先へ未反映 (persist 失敗時に立つ)
    }

    static slugify(s) {
        const base = String(s || '')
            .trim().toLowerCase()
            .replace(/[^\w぀-ヿ一-龯-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        return base || 'article';
    }

    static _newId(prefix) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return (prefix || 'a') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // タグの同一視キー: 小文字化 + NFKC 正規化 (全角英数→半角・半角カナ→全角 等の統一で表記ゆれを吸収, §11.6)
    static normalizeTagKey(tag) {
        const s = String(tag == null ? '' : tag).trim();
        const nfkc = typeof s.normalize === 'function' ? s.normalize('NFKC') : s;
        return nfkc.toLowerCase();
    }

    static normalizeTheme(theme) {
        const t = theme || {};
        const layout = ARTICLE_LAYOUTS.includes(t.layout) ? t.layout : ARTICLE_DEFAULT_THEME.layout;
        const color = ARTICLE_COLORS.includes(t.color) ? t.color : ARTICLE_DEFAULT_THEME.color;
        return { layout, color };
    }

    static _normalizeShow(show) {
        const s = show || {};
        return { shortMemo: !!s.shortMemo, longMemo: !!s.longMemo };
    }

    // ブロック列を検証・正規化する (未知 type は落とす・id や配置単位レコードの id/blockId/order を補完)
    static normalizeBlocks(blocks) {
        const list = Array.isArray(blocks) ? blocks : [];
        return list.map(b => PublishArticleStore._normalizeBlock(b)).filter(Boolean);
    }

    static _normalizeBlock(b) {
        if (!b || typeof b !== 'object') return null;
        const id = b.id || PublishArticleStore._newId('blk');
        if (b.type === 'text') {
            return { id, type: 'text', markdown: String(b.markdown || '') };
        }
        if (b.type === 'book') {
            if (!b.asin) return null;
            return { id, type: 'book', asin: b.asin, show: PublishArticleStore._normalizeShow(b.show) };
        }
        if (b.type === 'shelf') {
            const items = Array.isArray(b.items) ? b.items : [];
            return {
                id, type: 'shelf',
                shelfId: b.shelfId || null,
                items: items.filter(it => it && it.asin).map((it, i) => ({
                    id: it.id || PublishArticleStore._newId('pl'),
                    blockId: id,
                    asin: it.asin,
                    order: Number.isFinite(it.order) ? it.order : i,
                    show: PublishArticleStore._normalizeShow(it.show)
                }))
            };
        }
        return null; // 未知の種別は捨てる (文章/本/本棚の3種のみ・§11.2)
    }

    // storage.readJSON の規約 (StorageAdapter): 「ファイルが無い」は null を返し、通信/認証/権限等の
    // 実失敗は例外を投げる。ここではその区別をそのまま保つ ("まだ articles.json が無い" = null → [] /
    // "読めなかった" = 例外 → 握り潰さず rethrow、this._articles は前の状態のまま更新しない)。
    async load() {
        let data;
        try {
            data = await this.storage.readJSON(PUBLISH_ARTICLES_PATH);
        } catch (e) {
            this.lastLoadError = e;
            throw e;
        }
        this.lastLoadError = null;
        this._articles = (data && Array.isArray(data.articles)) ? data.articles : [];
        return this._articles;
    }

    async _ensure() { if (!this._articles) await this.load(); }

    articles() { return this._articles || []; }
    get(id) { return (this._articles || []).find(a => a.id === id) || null; }

    // 未読込 (=一度も load() に成功していない。読込失敗直後も含む) のまま書き込むと、
    // 実データが存在するのに空リストで上書きしてしまう恐れがあるため拒否する。
    async _persist() {
        if (!this._articles) {
            throw new Error('記事データが未読込のため保存できません (読込に失敗している可能性があります)');
        }
        try {
            await this.storage.writeJSON(PUBLISH_ARTICLES_PATH, { articles: this._articles });
        } catch (e) {
            this.lastPersistError = e;
            this._dirty = true;
            throw e;
        }
        this.lastPersistError = null;
        this._dirty = false;
    }

    // 直近の persist が失敗し、メモリ上の変更が同期先へ未反映か
    hasUnsavedChanges() { return this._dirty; }

    // 直近の失敗を、メモリ上の状態 (変更済み) のまま保存し直す
    async retryPersist() { return this._persist(); }

    _uniqueSlug(base, exceptId) {
        const slug = PublishArticleStore.slugify(base);
        const taken = new Set((this._articles || []).filter(a => a.id !== exceptId).map(a => a.slug));
        if (!taken.has(slug)) return slug;
        let i = 2;
        while (taken.has(`${slug}-${i}`)) i++;
        return `${slug}-${i}`;
    }

    // 既存タグの一覧 (入力サジェスト用)。正規化キーで集約し、表示は初出表記・使用数つき (§11.6)
    allTags() {
        const map = new Map(); // key -> { key, label, count }
        for (const a of (this._articles || [])) {
            for (const tag of (a.tags || [])) {
                const key = PublishArticleStore.normalizeTagKey(tag);
                if (!key) continue;
                if (!map.has(key)) map.set(key, { key, label: tag, count: 0 });
                map.get(key).count++;
            }
        }
        return [...map.values()].sort((x, y) => y.count - x.count);
    }

    async create(partial = {}) {
        await this._ensure();
        const now = Date.now();
        const title = partial.title || '無題の記事';
        const article = {
            id: PublishArticleStore._newId('art'),
            slug: this._uniqueSlug(partial.slug || title),
            title,
            tags: Array.isArray(partial.tags) ? partial.tags.slice() : [],
            blocks: PublishArticleStore.normalizeBlocks(partial.blocks),
            theme: PublishArticleStore.normalizeTheme(partial.theme),
            sourceShelfId: partial.sourceShelfId || null,
            published: !!partial.published,
            createdAt: now,
            updatedAt: now,
            lastBuiltAt: null
        };
        this._articles.push(article);
        await this._persist();
        return article;
    }

    async update(id, patch = {}) {
        await this._ensure();
        const article = this.get(id);
        if (!article) throw new Error('記事が見つかりません: ' + id);
        if (patch.title !== undefined) article.title = patch.title;
        if (patch.tags !== undefined) article.tags = Array.isArray(patch.tags) ? patch.tags.slice() : article.tags;
        if (patch.blocks !== undefined) article.blocks = PublishArticleStore.normalizeBlocks(patch.blocks);
        if (patch.theme !== undefined) article.theme = PublishArticleStore.normalizeTheme(patch.theme);
        if (patch.sourceShelfId !== undefined) article.sourceShelfId = patch.sourceShelfId;
        if (patch.slug !== undefined) article.slug = this._uniqueSlug(patch.slug, id);
        if (patch.published !== undefined) article.published = !!patch.published;
        if (patch.lastBuiltAt !== undefined) article.lastBuiltAt = patch.lastBuiltAt;
        article.updatedAt = Date.now();
        await this._persist();
        return article;
    }

    async remove(id) {
        await this._ensure();
        const i = this._articles.findIndex(a => a.id === id);
        if (i < 0) return false;
        this._articles.splice(i, 1);
        await this._persist();
        return true;
    }

    async duplicate(id) {
        await this._ensure();
        const src = this.get(id);
        if (!src) throw new Error('複製元が見つかりません: ' + id);
        const copy = JSON.parse(JSON.stringify(src));
        return this.create({
            title: src.title + ' のコピー',
            slug: src.slug,
            tags: copy.tags,
            blocks: copy.blocks,
            theme: copy.theme,
            sourceShelfId: copy.sourceShelfId
        });
    }

    // ===== 移行 (旧 pages.json → 記事モデル, 非破壊) =====
    //
    // 1 ページ = 1 記事へ機械変換する (素直な 1:1)。旧モデルにはタグ・テーマ2軸の概念が無いため、
    // タグは空・テーマは既定値にフォールバックする (ユーザは記事として引き継いだ上で作り直せる)。
    //   - intro (紹介文) があれば先頭に文章ブロックとして追加
    //   - select.shelves の各本棚 → 本棚ブロック。呼び出し時点の本棚の中身を items にスナップショット展開する
    //     (記事は蔵書更新を自動反映しない、という記事モデルの不変条件・§11.1 に最初から合わせるため)
    //   - select.books の各本 → 本ブロック
    //
    // resolveShelfBooks(internalIdOrSlug) => [asin, ...] を呼び出し側 (蔵書 state を知っている側) から渡す。
    // ストア自身は蔵書データを持たないため注入する形にする。
    static migrateFromPages(pages, resolveShelfBooks) {
        const list = Array.isArray(pages) ? pages : [];
        const resolve = typeof resolveShelfBooks === 'function' ? resolveShelfBooks : () => [];
        return list.map(page => PublishArticleStore._migrateOnePage(page, resolve));
    }

    static _migrateOnePage(page, resolve) {
        const blocks = [];
        if (page.intro && String(page.intro).trim()) {
            blocks.push({ id: PublishArticleStore._newId('blk'), type: 'text', markdown: String(page.intro).trim() });
        }
        const sel = page.select || {};
        for (const shelfKey of (sel.shelves || [])) {
            const blockId = PublishArticleStore._newId('blk');
            const asins = resolve(shelfKey) || [];
            blocks.push({
                id: blockId, type: 'shelf', shelfId: shelfKey,
                items: asins.map((asin, i) => ({
                    id: PublishArticleStore._newId('pl'), blockId, asin, order: i,
                    show: { shortMemo: false, longMemo: false }
                }))
            });
        }
        for (const asin of (sel.books || [])) {
            blocks.push({ id: PublishArticleStore._newId('blk'), type: 'book', asin, show: { shortMemo: false, longMemo: false } });
        }
        return {
            id: PublishArticleStore._newId('art'),
            slug: page.slug || PublishArticleStore.slugify(page.title),
            title: page.title || '無題の記事',
            tags: [],
            blocks,
            theme: { ...ARTICLE_DEFAULT_THEME },
            sourceShelfId: (sel.shelves && sel.shelves[0]) || null,
            published: !!page.published,
            createdAt: page.createdAt || Date.now(),
            updatedAt: page.updatedAt || Date.now(),
            lastBuiltAt: page.lastBuiltAt || null,
            _migratedFrom: page.id // 由来ページの追跡 (デバッグ用。生成器の出力には使わない)
        };
    }

    // 旧 pages.json を読み、記事モデルへ変換して articles.json へ書き込む (非破壊: pages.json 自体は消さない)。
    // 既に articles.json に記事が1件以上あるなら二重移行を避けるため何もしない (idempotent)。
    async migrateFromLegacyIfNeeded(resolveShelfBooks) {
        // _ensure() が失敗 (読込エラー) すればここで throw する。articles.json を「0件」と
        // 誤認して legacy から再移行し、読めなかっただけの既存記事を上書きする事故を防ぐ。
        await this._ensure();
        if (this._articles.length > 0) return { migrated: 0, skipped: true };
        const legacy = await this.storage.readJSON(PUBLISH_PAGES_LEGACY_PATH);
        const pages = (legacy && Array.isArray(legacy.pages)) ? legacy.pages : [];
        if (!pages.length) return { migrated: 0, skipped: false };
        const migrated = PublishArticleStore.migrateFromPages(pages, resolveShelfBooks);
        this._articles = migrated;
        await this._persist();
        return { migrated: migrated.length, skipped: false };
    }
}

if (typeof window !== 'undefined') {
    window.PublishArticleStore = PublishArticleStore;
    window.ARTICLE_LAYOUTS = ARTICLE_LAYOUTS;
    window.ARTICLE_COLORS = ARTICLE_COLORS;
}
if (typeof globalThis !== 'undefined') {
    globalThis.PublishArticleStore = PublishArticleStore;
    globalThis.ARTICLE_LAYOUTS = ARTICLE_LAYOUTS;
    globalThis.ARTICLE_COLORS = ARTICLE_COLORS;
}
