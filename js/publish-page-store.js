// PublishPageStore - 公開ページ定義の CRUD (P1 静的SSG, ADR-030)
//
// 保存先: 同期先の private/publish/pages.json (private 配下 = 公開には出ない)
//   { pages: [ PublishPage ] }
//
// PublishPage = {
//   id,                      // 不変 ID
//   slug,                    // 公開 URL のパス断片 (一意・kebab)
//   title, intro,            // ページ見出し / 紹介文
//   styleId,                 // 使用スタイル
//   styleParams: {},         // スタイル別パラメータ (style.declare().fields に対応)
//   select: {
//     shelves: [internalId], // 載せる本棚
//     books:   [asin],       // 載せる本 (単体)
//     fields:  { rating, memo, detailMemo, cover, author, amazon }  // 公開項目の取捨
//   },
//   createdAt, updatedAt, lastBuiltAt
// }
//
// ※ ストアは storage ({ readJSON(path), writeJSON(path,data) }) に依存。

const PUBLISH_PAGES_PATH = 'private/publish/pages.json';

class PublishPageStore {
    constructor(storage) {
        this.storage = storage;
        this._pages = null; // 未ロード
    }

    static defaultFields() {
        return { rating: true, memo: true, detailMemo: true, cover: true, author: true, amazon: true };
    }

    // タイトル等から slug を生成 (英数/かな/漢字を残す)
    static slugify(s) {
        const base = String(s || '')
            .trim().toLowerCase()
            .replace(/[^\w぀-ヿ一-龯-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        return base || 'page';
    }

    static _newId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    async load() {
        let data = null;
        try { data = await this.storage.readJSON(PUBLISH_PAGES_PATH); } catch (_) { data = null; }
        this._pages = (data && Array.isArray(data.pages)) ? data.pages : [];
        return this._pages;
    }

    async _ensure() { if (!this._pages) await this.load(); }

    pages() { return this._pages || []; }
    get(id) { return (this._pages || []).find(p => p.id === id) || null; }

    async _persist() {
        await this.storage.writeJSON(PUBLISH_PAGES_PATH, { pages: this._pages || [] });
    }

    _uniqueSlug(base, exceptId) {
        const slug = PublishPageStore.slugify(base);
        const taken = new Set((this._pages || []).filter(p => p.id !== exceptId).map(p => p.slug));
        if (!taken.has(slug)) return slug;
        let i = 2;
        while (taken.has(`${slug}-${i}`)) i++;
        return `${slug}-${i}`;
    }

    async create(partial = {}) {
        await this._ensure();
        const now = Date.now();
        const title = partial.title || '無題の公開ページ';
        const sel = partial.select || {};
        const page = {
            id: PublishPageStore._newId(),
            slug: this._uniqueSlug(partial.slug || title),
            title,
            intro: partial.intro || '',
            styleId: partial.styleId || '',
            styleParams: partial.styleParams || {},
            select: {
                shelves: Array.isArray(sel.shelves) ? sel.shelves.slice() : [],
                books: Array.isArray(sel.books) ? sel.books.slice() : [],
                fields: { ...PublishPageStore.defaultFields(), ...(sel.fields || {}) }
            },
            createdAt: now,
            updatedAt: now,
            lastBuiltAt: null
        };
        this._pages.push(page);
        await this._persist();
        return page;
    }

    async update(id, patch = {}) {
        await this._ensure();
        const page = this.get(id);
        if (!page) throw new Error('公開ページが見つかりません: ' + id);
        if (patch.title !== undefined) page.title = patch.title;
        if (patch.intro !== undefined) page.intro = patch.intro;
        if (patch.styleId !== undefined) page.styleId = patch.styleId;
        if (patch.styleParams !== undefined) page.styleParams = patch.styleParams;
        if (patch.select !== undefined) {
            const s = patch.select;
            page.select = {
                shelves: Array.isArray(s.shelves) ? s.shelves.slice() : page.select.shelves,
                books: Array.isArray(s.books) ? s.books.slice() : page.select.books,
                fields: { ...page.select.fields, ...(s.fields || {}) }
            };
        }
        if (patch.slug !== undefined) page.slug = this._uniqueSlug(patch.slug, id);
        if (patch.lastBuiltAt !== undefined) page.lastBuiltAt = patch.lastBuiltAt;
        page.updatedAt = Date.now();
        await this._persist();
        return page;
    }

    async remove(id) {
        await this._ensure();
        const i = this._pages.findIndex(p => p.id === id);
        if (i < 0) return false;
        this._pages.splice(i, 1);
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
            intro: copy.intro,
            styleId: copy.styleId,
            styleParams: copy.styleParams,
            select: copy.select
        });
    }
}

if (typeof window !== 'undefined') window.PublishPageStore = PublishPageStore;
if (typeof globalThis !== 'undefined') globalThis.PublishPageStore = PublishPageStore;
