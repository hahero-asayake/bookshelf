// BookshelfRouter
//
// シンプルな hash-based router。
//
// 受け付ける URL hash 形式:
//   (なし) or #/                    → { view: 'main' }
//   #/bookshelf/<slug>              → { view: 'bookshelf', slug }
//   #book/<asin>                    → { view: 'book', asin }
//   #book/<asin>?from=<internalId>  → { view: 'book', asin, from }
//   #/publish                       → { view: 'publish' }
//   #/publish/settings              → { view: 'publish-settings' }
//   #/publish/<id>                  → { view: 'publish', id }
//   #/settings                      → { view: 'settings' }        (本体設定・イシュー#494)
//
// 旧形式互換（既存リンクが壊れない範囲）:
//   #book-<asin>                    → { view: 'book', asin } として扱う
//
// 使い方:
//   const router = new BookshelfRouter();
//   router.onChange((route) => { ... });
//   router.start();           // 初回 dispatch (履歴の聞き手は NavState の popstate のみ・イシュー#407)
//   router.navigateMain();
//   router.navigateBookshelf(slug);
//   router.navigateBook(asin, fromInternalId);
//   router.navigatePublish(id);
//   router.navigatePublishSettings();
//   router.navigateSettings();        // イシュー#494
//
// route オブジェクトのプロパティ:
//   view: 'main' | 'bookshelf' | 'book' | 'publish' | 'publish-settings' | 'settings'
//   slug?: string         (bookshelf)
//   asin?: string         (book)
//   from?: string         (book — どの本棚から開いたか)
//   id?: string           (publish — 記事id。新規記事は仮id。無ければ一覧)

class BookshelfRouter {
    constructor() {
        this._listeners = new Set();
        this._current = null;
    }

    start() {
        // イシュー#359: 履歴の唯一の聞き手は NavState (this._nav.start() が popstate を購読)。hashchange は
        // 購読しない (nav.onPopstate → onLanded → _applyRoute)。(イシュー#407で旧経路・kill-switchを物理撤去)
        this._dispatch(this.parse(window.location.hash));
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

    // イシュー#468: 公開/設定の画面にURLを持たせる
    navigatePublish(id, { replace = false } = {}) {
        this._setHash(id ? `#/publish/${encodeURIComponent(id)}` : '#/publish', replace);
    }

    navigatePublishSettings({ replace = false } = {}) {
        this._setHash('#/publish/settings', replace);
    }

    // イシュー#494: 本体設定モーダルの開閉をURLと連動させる
    navigateSettings({ replace = false } = {}) {
        this._setHash('#/settings', replace);
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

        // #/publish/settings (イシュー#468・<id> より先に判定し "settings" という id と誤判定しない)
        if (/^\/publish\/settings\/?$/.test(stripped)) {
            return { view: 'publish-settings' };
        }
        // #/publish/<id>
        const pubIdMatch = stripped.match(/^\/publish\/([^/?#]+)/);
        if (pubIdMatch) {
            return { view: 'publish', id: decodeURIComponent(pubIdMatch[1]) };
        }
        // #/publish
        if (/^\/publish\/?$/.test(stripped)) {
            return { view: 'publish' };
        }

        // #/settings (イシュー#494: 本体設定モーダル)
        if (/^\/settings\/?$/.test(stripped)) {
            return { view: 'settings' };
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
        // イシュー#359: 履歴の書き手は NavState (this._nav) だけ。URL は pushState/replaceState で書く
        // (location.hash 代入をしない = hashchange を起こさない)。画面は同期 dispatch で合わせる
        // (selfHandled = 呼び出し元が画面を済ませている navigateBookshelf は dispatch しない・イシュー#104 と同じ意味)。
        // (イシュー#407で旧経路・kill-switchを物理撤去。NavState が読めない時は旧経路へフォールバックせずエラーを出す)
        if (!this._nav) { console.error('[router] NavState が読み込めず遷移できません。'); return; }
        const route = this.parse(hash);
        if (route.view === 'book') this._nav.openBook(route.asin, false, route.from, { mobile: this._nav.isMobile ? this._nav.isMobile() : undefined });
        else this._nav.navigate(route, { replace: !!replace, shelfInternalId: this._shelfIdResolver ? this._shelfIdResolver(route.slug) : undefined });
        if (!selfHandled) this._dispatch(route);
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
