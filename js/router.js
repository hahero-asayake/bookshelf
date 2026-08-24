// BookshelfRouter
//
// シンプルな hash-based router。
//
// 受け付ける URL hash 形式:
//   (なし) or #/                    → { view: 'main' }
//   #/bookshelf/<slug>              → { view: 'bookshelf', slug }
//   #book/<asin>                    → { view: 'book', asin }
//   #book/<asin>?from=<internalId>  → { view: 'book', asin, from }
//
// 旧形式互換（既存リンクが壊れない範囲）:
//   #book-<asin>                    → { view: 'book', asin } として扱う
//
// 使い方:
//   const router = new BookshelfRouter();
//   router.onChange((route) => { ... });
//   router.start();           // 初回 dispatch + hashchange 購読
//   router.navigateMain();
//   router.navigateBookshelf(slug);
//   router.navigateBook(asin, fromInternalId);
//
// route オブジェクトのプロパティ:
//   view: 'main' | 'bookshelf' | 'book'
//   slug?: string         (bookshelf)
//   asin?: string         (book)
//   from?: string         (book — どの本棚から開いたか)

class BookshelfRouter {
    constructor() {
        this._listeners = new Set();
        this._current = null;
        this._suppressNext = false;
        this._onHashChange = this._onHashChange.bind(this);
    }

    start() {
        window.addEventListener('hashchange', this._onHashChange);
        this._dispatch(this.parse(window.location.hash));
    }

    stop() {
        window.removeEventListener('hashchange', this._onHashChange);
    }

    onChange(handler) {
        this._listeners.add(handler);
        return () => this._listeners.delete(handler);
    }

    get current() {
        return this._current;
    }

    // ===== ナビゲーション =====
    navigateMain({ replace = false } = {}) {
        this._setHash('', replace);
    }

    navigateBookshelf(slug, { replace = false } = {}) {
        if (!slug) return this.navigateMain({ replace });
        this._setHash(`#/bookshelf/${encodeURIComponent(slug)}`, replace, true);
    }

    navigateBook(asin, fromInternalId, { replace = false } = {}) {
        if (!asin) return;
        const qs = fromInternalId ? `?from=${encodeURIComponent(fromInternalId)}` : '';
        this._setHash(`#book/${encodeURIComponent(asin)}${qs}`, replace);
    }

    // ===== パース =====
    parse(hash) {
        if (!hash || hash === '#' || hash === '#/') {
            return { view: 'main' };
        }
        const stripped = hash.startsWith('#') ? hash.slice(1) : hash;

        // #/bookshelf/<slug>
        const bsMatch = stripped.match(/^\/bookshelf\/([^/?#]+)/);
        if (bsMatch) {
            return { view: 'bookshelf', slug: decodeURIComponent(bsMatch[1]) };
        }

        // #book/<asin>?from=<id>
        const bookMatch = stripped.match(/^book\/([^/?#]+)(\?(.*))?$/);
        if (bookMatch) {
            const asin = decodeURIComponent(bookMatch[1]);
            const qs = bookMatch[3] || '';
            const params = new URLSearchParams(qs);
            const from = params.get('from');
            return from
                ? { view: 'book', asin, from: decodeURIComponent(from) }
                : { view: 'book', asin };
        }

        // 旧形式 #book-<asin>
        const legacyMatch = stripped.match(/^book-([A-Z0-9]+)$/i);
        if (legacyMatch) {
            return { view: 'book', asin: legacyMatch[1] };
        }

        // フォールバック
        return { view: 'main' };
    }

    // ===== 内部 =====
    // selfHandled: true の場合のみ、このナビゲーションで発火する hashchange 由来の
    // _applyRoute 再実行を1回だけ無視する (イシュー#104)。navigateBookshelf (switchBookshelf
    // が呼ぶ) は呼び出し元が既に画面を同期更新済みなので二重実行が無駄だが、navigateMain/
    // navigateBook は呼び出し元 (goHome 等) が画面更新をせず _applyRoute に委ねる設計のため
    // 対象外 (selfHandled を渡さない = 常に _applyRoute を実行させる)。
    _setHash(hash, replace, selfHandled = false) {
        const target = hash || ' '; // 空文字だと history が機能しないので半角空白
        if (replace) {
            const url = `${window.location.pathname}${window.location.search}${hash}`;
            window.history.replaceState(null, '', url);
            this._dispatch(this.parse(hash));
        } else if ((window.location.hash || '') === hash) {
            // すでに同じ hash の場合 hashchange が発火しないので明示 dispatch
            this._dispatch(this.parse(hash));
        } else {
            // selfHandled でも、hash が実際に変わらないケース (同一 slug への再ナビゲーション等)
            // では window.location.hash 代入で hashchange 自体が発火しない。この場合フラグを
            // 立てると消費されずに残留し、次に来る本物の hashchange (戻る/進む等) を誤って
            // 握り潰す (②レビュー実測・イシュー#104)。hash が実際に変わる時だけ立てる。
            if (selfHandled && (window.location.hash || '') !== hash) this._suppressNext = true;
            window.location.hash = hash;
        }
    }

    _onHashChange() {
        if (this._suppressNext) {
            this._suppressNext = false;
            return;
        }
        this._dispatch(this.parse(window.location.hash));
    }

    _dispatch(route) {
        this._current = route;
        for (const handler of this._listeners) {
            try { handler(route); }
            catch (e) { console.error('[router] handler error:', e); }
        }
    }
}

window.BookshelfRouter = BookshelfRouter;
