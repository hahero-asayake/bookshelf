// BookshelfPluginAPI
//
// プラグインから利用する公開 API。`window.bookshelfAPI` に注入される。
// 設計指針:
//   - app 本体の内部実装は隠蔽（メソッド経由でアクセス）
//   - イベントバスでフックポイントを提供
//   - 副作用のあるメソッドは内部で saveUserData / refreshUI まで面倒見る
//   - プラグインは plugins/<id>/index.js から bookshelfAPI を参照する想定
//
// イベント名一覧:
//   book:added       { book }
//   book:updated     { book, prev }
//   book:removed     { asin }
//   books:changed    {}                       同期完了などで蔵書配列が差し替わった
//   bookshelf:created { meta }
//   bookshelf:updated { meta, prev }
//   bookshelf:removed { internalId }
//   note:updated     { asin, note }
//   export:before    { state }
//   export:after     { result }
//   sync:completed   {}
//   ui:books-rendered      { view }           本一覧の描画完了 (view 系プラグイン用)
//   ui:book-detail-rendered { asin, book, container }  本詳細ペイン描画完了 (推奨)
//   ui:book-modal-opened   { asin }           [非推奨] ui:book-detail-rendered の別名
//
// 拡張レジストリ (forPlugin スコープ API):
//   registerCommand({ id, title, icon, keywords, run })  ⌘K パレットにコマンド追加
//   registerWidget({ id, label, icon, defaultSpan, allowedSpans, render })  ダッシュボードに widget 追加
//   registerDetailSection({ id, render })  本詳細ペインにセクション追加 (render(host, book, ctx))
//   injectCSS(id, css) / removeCSS(id)     スコープ付き <style> 注入 (unload で自動除去)
//   registerBookFilter(fn) / registerExportTransform(fn)  蔵書フィルタ / エクスポート変換
//
// 読み取りヘルパー (コア BookManager への薄いラッパ。ADR-043):
//   getAmazonUrl(bookOrAsin, affiliateId?)  Amazon 商品 URL (affiliateId 省略でユーザ設定を自動付与)
//   getProductImageUrl(bookOrAsin)          表紙画像 URL
//   effectiveAsin(bookOrAsin)               表示・リンク用の有効 ASIN (updatedAsin 優先)

class PluginEventBus {
    constructor() {
        this._handlers = new Map();
    }

    on(event, handler) {
        if (!this._handlers.has(event)) this._handlers.set(event, new Set());
        this._handlers.get(event).add(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        const set = this._handlers.get(event);
        if (set) set.delete(handler);
    }

    emit(event, data) {
        const set = this._handlers.get(event);
        if (!set) return;
        for (const handler of set) {
            try {
                handler(data);
            } catch (e) {
                console.error(`[pluginAPI] event handler error for "${event}":`, e);
            }
        }
    }
}

class BookshelfPluginAPI {
    constructor(app) {
        this._app = app;
        this._bus = new PluginEventBus();
        this._uiButtons = []; // { id, where, label, onClick, element, _pluginId }
        this._exportTransforms = []; // { fn, _pluginId }
        this._bookFilters = []; // fn(books) => filteredBooks。applyFilters 内で順次適用
        this._commands = [];      // { id, title, icon, keywords, run, pluginId } ⌘K パレット
        this._detailSections = []; // { id, render, pluginId } 本詳細ペインのセクション
        this._pluginSettings = new Map(); // pluginId → render(host, api) プラグインごとの設定画面
        // pluginId → 登録トラッキング (unregister で一括解除)
        this._pluginRegistrations = new Map();
    }

    /**
     * プラグインスコープ付き API を返す。activate(scopedApi, manifest) に渡される。
     * scopedApi 経由で登録された UI ボタン / イベントハンドラ / エクスポート変換は
     * pluginId 別にトラックされ、unloadPlugin 時に一括解除可能。
     */
    forPlugin(pluginId) {
        if (!pluginId) return this;
        if (!this._pluginRegistrations.has(pluginId)) {
            this._pluginRegistrations.set(pluginId, {
                eventHandlers: [],
                uiButtonIds: new Set(),
                exportTransforms: [],
                bookFilters: [],
                commandIds: new Set(),
                widgetIds: new Set(),
                detailSectionIds: new Set(),
                styleIds: new Set(),
                settingsRegistered: false
            });
        }
        const reg = this._pluginRegistrations.get(pluginId);
        const self = this;
        // Proxy ではなくシンプルな wrapper を返す（メソッド数が限定的なので明示）
        return {
            on(event, handler) {
                const off = self._bus.on(event, handler);
                reg.eventHandlers.push({ event, handler, off });
                return off;
            },
            off(event, handler) { self._bus.off(event, handler); },
            getBooks: () => self.getBooks(),
            getBook: (asin) => self.getBook(asin),
            getNotes: () => self.getNotes(),
            getNote: (asin) => self.getNote(asin),
            getBookshelves: () => self.getBookshelves(),
            getBookshelf: (id) => self.getBookshelf(id),
            getBookshelfBySlug: (slug) => self.getBookshelfBySlug(slug),
            getCurrentBookshelf: () => self.getCurrentBookshelf(),
            getAmazonUrl: (bookOrAsin, affiliateId) => self.getAmazonUrl(bookOrAsin, affiliateId),
            getProductImageUrl: (bookOrAsin) => self.getProductImageUrl(bookOrAsin),
            effectiveAsin: (bookOrAsin) => self.effectiveAsin(bookOrAsin),
            updateNote: (asin, partial) => self.updateNote(asin, partial),
            openBook: (asin) => self.openBook(asin),
            openBookshelf: (slug) => self.openBookshelf(slug),
            refreshUI: () => self.refreshUI(),
            addUIButton: (opts) => {
                // pluginId を明示的に渡す (base の this._pluginId は未設定のため、
                // 渡さないと entry.pluginId=undefined となり icon override が plugin:undefined で迷子になる)
                const entry = self.addUIButton(opts, pluginId);
                if (entry) reg.uiButtonIds.add(entry.id);
                return entry;
            },
            removeUIButton: (id) => {
                self.removeUIButton(id);
                reg.uiButtonIds.delete(id);
            },
            setUIButtonActive: (id, on) => self.setUIButtonActive(id, on),
            registerExportTransform: (fn) => {
                self.registerExportTransform(fn);
                reg.exportTransforms.push(fn);
            },
            registerBookFilter: (fn) => {
                self.registerBookFilter(fn);
                reg.bookFilters.push(fn);
            },
            registerCommand: (opts) => {
                const entry = self.registerCommand(opts, pluginId);
                if (entry) reg.commandIds.add(entry.id);
                return entry;
            },
            removeCommand: (id) => { self.removeCommand(id); reg.commandIds.delete(id); },
            registerWidget: (opts) => {
                const id = self.registerWidget(opts, pluginId);
                if (id) reg.widgetIds.add(id);
                return id;
            },
            removeWidget: (id) => { self.removeWidget(id); reg.widgetIds.delete(id); },
            registerDetailSection: (opts) => {
                const entry = self.registerDetailSection(opts, pluginId);
                if (entry) reg.detailSectionIds.add(entry.id);
                return entry;
            },
            removeDetailSection: (id) => { self.removeDetailSection(id); reg.detailSectionIds.delete(id); },
            injectCSS: (id, css) => {
                const styleId = self.injectCSS(id, css, pluginId);
                if (styleId) reg.styleIds.add(styleId);
                return styleId;
            },
            removeCSS: (id) => {
                const styleId = self.removeCSS(id, pluginId);
                if (styleId) reg.styleIds.delete(styleId);
            },
            registerSettings: (render) => { self.registerSettings(render, pluginId); reg.settingsRegistered = true; },
            getConfig: () => self.getPluginConfig(pluginId),
            setConfig: (partial) => self.setPluginConfig(pluginId, partial),
            writePluginFile: (rel, text) => self.writePluginFile(pluginId, rel, text),
            readPluginFile: (rel) => self.readPluginFile(pluginId, rel)
        };
    }

    /**
     * プラグインが登録した拡張点を一括解除（無効化時に loader が呼ぶ）
     */
    unregisterPlugin(pluginId) {
        const reg = this._pluginRegistrations.get(pluginId);
        if (!reg) return;
        for (const { off } of reg.eventHandlers) {
            try { off(); } catch (_) {}
        }
        for (const id of reg.uiButtonIds) {
            this.removeUIButton(id);
        }
        // exportTransforms は配列実体から filter で除外
        if (reg.exportTransforms.length > 0) {
            this._exportTransforms = this._exportTransforms.filter(fn => !reg.exportTransforms.includes(fn));
        }
        if (reg.bookFilters && reg.bookFilters.length > 0) {
            this._bookFilters = this._bookFilters.filter(fn => !reg.bookFilters.includes(fn));
        }
        if (reg.commandIds) {
            for (const id of reg.commandIds) this.removeCommand(id);
        }
        if (reg.widgetIds) {
            for (const id of reg.widgetIds) this.removeWidget(id);
        }
        if (reg.detailSectionIds) {
            for (const id of reg.detailSectionIds) this.removeDetailSection(id);
        }
        if (reg.styleIds) {
            for (const styleId of reg.styleIds) {
                const el = document.getElementById(styleId);
                if (el) el.remove();
            }
        }
        this._pluginSettings.delete(pluginId);
        this._pluginRegistrations.delete(pluginId);
    }

    // ===== イベントバス =====
    on(event, handler) { return this._bus.on(event, handler); }
    off(event, handler) { this._bus.off(event, handler); }
    _emit(event, data) { this._bus.emit(event, data); }

    // ===== 蔵書アクセス（読み取り） =====
    getBooks() {
        return Array.isArray(this._app.books) ? this._app.books.slice() : [];
    }
    getBook(asin) {
        return (this._app.books || []).find(b => b.asin === asin) || null;
    }
    getNotes() {
        return { ...(this._app.userData?.notes || {}) };
    }
    getNote(asin) {
        const n = (this._app.userData?.notes || {})[asin];
        return n ? { ...n } : null;
    }

    // ===== 本棚アクセス（読み取り） =====
    getBookshelves() {
        if (!this._app.bookshelfManager) return [];
        return this._app.bookshelfManager.getBookshelves().map(b => ({ ...b }));
    }
    getBookshelf(internalId) {
        if (!this._app.bookshelfManager) return null;
        // getById は internalId→slug フォールバック付き (getByInternalId は BookshelfManager に未定義)
        const b = this._app.bookshelfManager.getById(internalId);
        return b ? { ...b } : null;
    }
    getBookshelfBySlug(slug) {
        if (!this._app.bookshelfManager) return null;
        const b = this._app.bookshelfManager.getBySlug(slug);
        return b ? { ...b } : null;
    }
    // 現在表示中の本棚 (live state の純加算 READ。ADR-043。slug は返り値の .id)
    getCurrentBookshelf() {
        if (!this._app.bookshelfManager || typeof this._app._currentBookshelfInternalId !== 'function') return null;
        const internalId = this._app._currentBookshelfInternalId();
        if (!internalId) return null;
        const b = this._app.bookshelfManager.getById(internalId);
        return b ? { ...b } : null;
    }

    // ===== Amazon / 画像 URL（コア BookManager への薄いラッパ。ADR-043） =====
    // 引数は book オブジェクト または ASIN 文字列。ASIN 文字列は蔵書から解決し、
    // 未所蔵なら { asin } を合成して扱う（関連本など蔵書外 ASIN も渡せる）。
    _resolveBookArg(bookOrAsin) {
        if (bookOrAsin && typeof bookOrAsin === 'object') return bookOrAsin;
        if (!bookOrAsin) return null;
        return this.getBook(bookOrAsin) || { asin: bookOrAsin };
    }
    /** 表示・リンク用の有効 ASIN（updatedAsin 優先） */
    effectiveAsin(bookOrAsin) {
        const bm = this._app.bookManager;
        const b = this._resolveBookArg(bookOrAsin);
        return (bm && b) ? bm.getEffectiveASIN(b) : null;
    }
    /** Amazon 商品画像 URL */
    getProductImageUrl(bookOrAsin) {
        const bm = this._app.bookManager;
        const b = this._resolveBookArg(bookOrAsin);
        return (bm && b) ? bm.getProductImageUrl(b) : null;
    }
    /** Amazon 商品 URL。affiliateId 省略時はユーザ設定の affiliateId を自動付与、
     *  null を明示すると無タグの素 URL を返す。 */
    getAmazonUrl(bookOrAsin, affiliateId) {
        const bm = this._app.bookManager;
        const b = this._resolveBookArg(bookOrAsin);
        if (!bm || !b) return null;
        const tag = affiliateId !== undefined
            ? affiliateId
            : (this._app.userData?.settings?.affiliateId || null);
        return bm.getAmazonUrl(b, tag);
    }

    // ===== 書き込み（副作用あり、内部で sync/redraw 実行） =====
    async updateNote(asin, partial) {
        if (!this._app.userData.notes) this._app.userData.notes = {};
        const prev = this._app.userData.notes[asin] || {};
        const merged = { ...prev, ...partial };
        this._app.userData.notes[asin] = merged;
        await this._app.saveUserData();
        this._emit('note:updated', { asin, note: merged });
        if (typeof this._app.updateDisplay === 'function') this._app.updateDisplay();
    }

    async refreshUI() {
        // applyFilters は registerBookFilter (シリーズまとめ等) を再適用してから
        // sort → updateDisplay → updateStats まで行う。フィルタ系プラグインのトグルを
        // 反映するため、updateDisplay 単体ではなく applyFilters を呼ぶ。
        if (typeof this._app.applyFilters === 'function') {
            this._app.applyFilters();
        } else {
            if (typeof this._app.updateDisplay === 'function') this._app.updateDisplay();
            if (typeof this._app.updateStats === 'function') this._app.updateStats();
        }
        if (typeof this._app.renderBookshelfOverview === 'function') this._app.renderBookshelfOverview();
    }

    // ===== ナビゲーション =====
    /** 本詳細ペインを開く */
    openBook(asin) {
        const b = this.getBook(asin);
        if (b && typeof this._app.showBookDetail === 'function') this._app.showBookDetail(b);
    }
    /** 本棚を開く (slug 指定) */
    openBookshelf(slug) {
        if (typeof this._app.switchBookshelf === 'function') this._app.switchBookshelf(slug);
    }

    // ===== UI 拡張ポイント =====
    // V6 以降、ボタンの可視 DOM はヘッダーカスタマイザ側で都度生成する。
    // ここでは entry の登録 + 内部 pool への参照 wrapper 生成のみを行う。
    //
    // iconName: Lucide アイコン名 (例: 'puzzle', 'rocket')。manifest の icon フィールドから渡される
    //           ことを想定。ユーザは設定モーダルのプラグイン一覧で override 可能 (localStorage)。
    // emoji   : 後方互換用フォールバック (iconName 未指定かつ override 無しの時に使う)
    // `where` パラメータは過去互換で受け取るが利用しない。
    addUIButton({ id, label, title, onClick, iconName, emoji }, pluginId = this._pluginId) {
        if (!id || !label || typeof onClick !== 'function') {
            console.warn('[pluginAPI] addUIButton: id, label, onClick are required');
            return null;
        }
        const existing = this._uiButtons.find(b => b.id === id);
        if (existing) return existing;
        const entry = {
            id,
            label,
            title: title || '',
            onClick,
            iconName: iconName || this._pluginIconNameFromManifest(pluginId),
            emoji: emoji || '',
            pluginId: pluginId,
            active: false, // ON/OFF 型ボタンの現在状態 (setUIButtonActive で更新、再描画でも保持)
            element: null
        };
        this._uiButtons.push(entry);
        this._renderUIButton(entry);
        return entry;
    }

    removeUIButton(id) {
        const idx = this._uiButtons.findIndex(b => b.id === id);
        if (idx < 0) return;
        const [entry] = this._uiButtons.splice(idx, 1);
        const node = entry.wrapper || entry.element;
        if (node && node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }

    /**
     * ON/OFF 型ボタンの現在状態を設定 (背景色で ON を明示)。
     * シリーズまとめ・背表紙ビュー・ダークテーマ等、トグルで効果を切り替える
     * プラグインが sync() 内で呼ぶ。entry.active に保持し、ヘッダー再描画後も復元される。
     */
    setUIButtonActive(id, isActive) {
        const entry = this._uiButtons.find(b => b.id === id);
        if (!entry) return;
        entry.active = !!isActive;
        // サイドバー配置済みボタン + 内部 pool の両方に反映 (DOM が再生成される前提で都度走査)
        document.querySelectorAll(`[data-header-item="plugin:${CSS.escape(id)}"] .plugin-ui-button`).forEach(btn => {
            btn.classList.toggle('is-on', entry.active);
        });
    }

    // manifest の icon フィールドを取得 (plugin-loader が _manifest を entry につけている前提)
    _pluginIconNameFromManifest(pluginId = this._pluginId) {
        const manifests = (window.bookshelf && window.bookshelf.pluginLoader && window.bookshelf.pluginLoader.manifests) || {};
        const m = manifests[pluginId];
        return (m && typeof m.icon === 'string') ? m.icon : '';
    }

    // ユーザ override (localStorage) — bookshelf 側 _getPluginIconOverride を呼ぶ
    _getEffectiveIconName(entry) {
        const override = (window.bookshelf && typeof window.bookshelf._getPluginIconOverride === 'function')
            ? window.bookshelf._getPluginIconOverride(entry.pluginId) : '';
        return override || entry.iconName || '';
    }

    _renderUIButton(entry) {
        // 内部 pool (#plugin-buttons, hidden) に登録だけする。
        // ヘッダーへの配置とアイコンボタン化はカスタマイザ + _buildPlacementElement 側で行う。
        const container = document.querySelector('#plugin-buttons');
        if (!container) {
            console.warn('[pluginAPI] addUIButton: #plugin-buttons pool not found');
            return;
        }
        const wrapper = document.createElement('span');
        wrapper.className = 'header-item plugin-button-item';
        wrapper.dataset.headerItem = `plugin:${entry.id}`;
        const btn = document.createElement('button');
        btn.className = 'btn-icon-square plugin-ui-button';
        this._applyIconToButton(btn, entry);
        if (entry.active) btn.classList.add('is-on');
        if (entry.title) btn.title = entry.title;
        btn.addEventListener('click', () => {
            try { entry.onClick(); }
            catch (e) { console.error(`[plugin button "${entry.id}"]`, e); }
        });
        wrapper.appendChild(btn);
        container.appendChild(wrapper);
        entry.element = btn;
        entry.wrapper = wrapper;
        // ヘッダーレイアウト適用を要求（app 側に通知）
        if (window.bookshelf && typeof window.bookshelf._applyHeaderLayout === 'function') {
            window.bookshelf._applyHeaderLayout();
        }
    }

    _applyIconToButton(btn, entry) {
        const iconValue = this._getEffectiveIconName(entry);
        if (iconValue && window.renderIcon) {
            // 任意文字 (Lucide 名 / 絵文字 / 漢字 / 任意文字列) を統一的に描画
            btn.innerHTML = window.renderIcon(iconValue, { size: 20 });
            btn.dataset.iconValue = iconValue; // CDN 後追い差し替え用
            return;
        }
        btn.textContent = entry.emoji || '🧩';
    }

    // ===== コマンド登録 (⌘K パレット) =====
    // { id, title, icon?, keywords?, run } — run() 実行時はパレットを閉じてから呼ばれる
    registerCommand({ id, title, icon, keywords, run } = {}, pluginId = this._pluginId) {
        if (!id || !title || typeof run !== 'function') {
            console.warn('[pluginAPI] registerCommand: id, title, run are required');
            return null;
        }
        if (this._commands.find(c => c.id === id)) return null;
        const entry = { id, title, icon: icon || 'puzzle', keywords: keywords || '', run, pluginId };
        this._commands.push(entry);
        return entry;
    }
    removeCommand(id) {
        this._commands = this._commands.filter(c => c.id !== id);
    }
    /** bookshelf 側パレットが読む: プラグイン登録コマンド一覧 */
    getPluginCommands() {
        return this._commands.slice();
    }

    // ===== ダッシュボード widget 登録 =====
    // { id, label, icon?, defaultSpan?, allowedSpans?, render(host, app, config) }
    // dashboard._registry に live で差し込み、ホーム表示中なら再描画する。
    registerWidget({ id, label, icon, defaultSpan, allowedSpans, render } = {}, pluginId = this._pluginId) {
        if (!id || typeof render !== 'function') {
            console.warn('[pluginAPI] registerWidget: id, render(host, app, config) are required');
            return null;
        }
        const dash = this._app.dashboard;
        if (!dash || !dash._registry) {
            console.warn('[pluginAPI] registerWidget: dashboard 未初期化');
            return null;
        }
        // プラグイン widget であることを示すフラグ付きで登録
        dash._registry[id] = {
            label: label || id,
            icon: icon || 'puzzle',
            defaultSpan: defaultSpan || 6,
            allowedSpans: Array.isArray(allowedSpans) ? allowedSpans : [3, 4, 6, 8, 12],
            plugin: true,
            pluginId,
            render(host, app, config) {
                try { render(host, app, config); }
                catch (e) { console.error(`[plugin widget "${id}"]`, e); host.textContent = 'widget エラー'; }
            }
        };
        this._rerenderDashboardIfHome();
        return id;
    }
    removeWidget(id) {
        const dash = this._app.dashboard;
        if (dash && dash._registry && dash._registry[id]) {
            delete dash._registry[id];
            this._rerenderDashboardIfHome();
        }
    }
    _rerenderDashboardIfHome() {
        const dash = this._app.dashboard;
        if (dash && typeof dash.render === 'function' && document.getElementById('dashboard')) {
            try { dash.render(); } catch (_) {}
        }
    }

    // ===== 本詳細ペインのセクション登録 =====
    // { id, render(host, book, ctx) } — showBookDetail のたびに呼ばれる。host は本棚ごとに再生成。
    registerDetailSection({ id, render } = {}, pluginId = this._pluginId) {
        if (!id || typeof render !== 'function') {
            console.warn('[pluginAPI] registerDetailSection: id, render(host, book, ctx) are required');
            return null;
        }
        if (this._detailSections.find(s => s.id === id)) return null;
        const entry = { id, render, pluginId };
        this._detailSections.push(entry);
        return entry;
    }
    removeDetailSection(id) {
        this._detailSections = this._detailSections.filter(s => s.id !== id);
        // 既に描画済みの DOM があれば除去
        document.querySelectorAll(`.plugin-detail-section[data-plugin-section="${id}"]`).forEach(el => el.remove());
    }
    /** bookshelf 側 showBookDetail から呼ばれる: 登録セクションを container に描画。
     *  bookshelf = 本詳細を開いた文脈の本棚 (ADR-043。null=ホーム/検索など本棚文脈なし) */
    _runDetailSections(container, book, bookshelf) {
        if (!container || !this._detailSections.length) return;
        const shelf = bookshelf ? { ...bookshelf } : null; // プラグインへは浅コピーで渡す
        for (const s of this._detailSections) {
            let host = container.querySelector(`.plugin-detail-section[data-plugin-section="${s.id}"]`);
            if (!host) {
                host = document.createElement('div');
                host.className = 'plugin-detail-section';
                host.dataset.pluginSection = s.id;
                container.appendChild(host);
            }
            host.innerHTML = '';
            try { s.render(host, book, { app: this._app, asin: book && book.asin, bookshelf: shelf }); }
            catch (e) { console.error(`[plugin detailSection "${s.id}"]`, e); }
        }
    }

    // ===== スコープ付き CSS 注入 =====
    // id はプラグイン内で一意。<style id="plugin-style-<pluginId>-<id>"> を head に注入/更新。
    injectCSS(id, css, pluginId = this._pluginId) {
        if (!id) { console.warn('[pluginAPI] injectCSS: id required'); return null; }
        const styleId = `plugin-style-${pluginId}-${id}`;
        let el = document.getElementById(styleId);
        if (!el) {
            el = document.createElement('style');
            el.id = styleId;
            document.head.appendChild(el);
        }
        el.textContent = css || '';
        return styleId;
    }
    removeCSS(id, pluginId = this._pluginId) {
        const styleId = `plugin-style-${pluginId}-${id}`;
        const el = document.getElementById(styleId);
        if (el) el.remove();
        return styleId;
    }

    // ===== プラグインごとの設定画面 =====
    // render(host, api) — 設定モーダルの「プラグイン設定」枠に描画される (プラグインが有効な時のみ)
    registerSettings(render, pluginId = this._pluginId) {
        if (typeof render !== 'function') {
            console.warn('[pluginAPI] registerSettings: render(host, api) function required');
            return;
        }
        this._pluginSettings.set(pluginId, render);
    }
    getPluginSettingsRenderer(pluginId) {
        return this._pluginSettings.get(pluginId) || null;
    }

    // ===== プラグインごとの永続設定 (userData.settings.pluginConfig[id]) =====
    getPluginConfig(pluginId) {
        const all = this._app.userData?.settings?.pluginConfig || {};
        return { ...(all[pluginId] || {}) };
    }
    async setPluginConfig(pluginId, partial) {
        if (!this._app.userData.settings) this._app.userData.settings = {};
        if (!this._app.userData.settings.pluginConfig) this._app.userData.settings.pluginConfig = {};
        const cur = this._app.userData.settings.pluginConfig[pluginId] || {};
        this._app.userData.settings.pluginConfig[pluginId] = { ...cur, ...partial };
        await this._app.saveUserData();
    }

    // ===== プラグインの貢献カテゴリ (管理画面のバッジ用) =====
    // 有効化されているプラグインについて、登録済みの拡張点からカテゴリを推定する。
    getPluginContributions(pluginId) {
        const reg = this._pluginRegistrations.get(pluginId);
        if (!reg) return [];
        const cats = [];
        if (reg.commandIds && reg.commandIds.size) cats.push('command');
        if (reg.widgetIds && reg.widgetIds.size) cats.push('widget');
        if (reg.detailSectionIds && reg.detailSectionIds.size) cats.push('detail');
        if (reg.uiButtonIds && reg.uiButtonIds.size) cats.push('button');
        if (reg.styleIds && reg.styleIds.size) cats.push('theme');
        if (reg.bookFilters && reg.bookFilters.length) cats.push('filter');
        if (reg.exportTransforms && reg.exportTransforms.length) cats.push('export');
        if (reg.settingsRegistered) cats.push('settings');
        return cats;
    }

    // ===== エクスポート変換フック =====
    // fn: (state) => state  ※ state は exporter が組み立て中の構造
    registerExportTransform(fn) {
        if (typeof fn !== 'function') return;
        this._exportTransforms.push(fn);
    }

    _runExportTransforms(state) {
        return this._exportTransforms.reduce((acc, fn) => {
            try { return fn(acc) || acc; }
            catch (e) { console.error('[exportTransform] error:', e); return acc; }
        }, state);
    }

    // ===== 蔵書フィルタフック =====
    // fn: (books) => books  applyFilters の末尾で全フィルタを順次適用
    registerBookFilter(fn) {
        if (typeof fn !== 'function') return;
        this._bookFilters.push(fn);
    }

    _runBookFilters(books) {
        return this._bookFilters.reduce((acc, fn) => {
            try {
                const out = fn(acc);
                return Array.isArray(out) ? out : acc;
            } catch (e) {
                console.error('[bookFilter] error:', e);
                return acc;
            }
        }, books);
    }

    // ===== ストレージ補助 =====
    // プラグインが同期先に任意ファイルを書きたい場合のヘルパー。
    // storage adapter 経由なので LocalFS / GitHub どちらでも動く。
    // 制限: plugins/<pluginId>/data/ 配下のみ許可
    _isStorageReady() {
        return typeof this._app._isSyncReady === 'function' && this._app._isSyncReady();
    }
    async writePluginFile(pluginId, relPath, text) {
        if (!pluginId || !relPath) throw new Error('pluginId と relPath が必要です');
        if (relPath.includes('..')) throw new Error('相対パスに .. は不可');
        if (!this._isStorageReady()) throw new Error('同期先が未接続です');
        const path = `plugins/${pluginId}/data/${relPath}`;
        await this._app.storage.syncBatch(
            [{ op: 'put', path, data: String(text == null ? '' : text), kind: 'text' }],
            { message: `chore(plugin): ${pluginId} data write` }
        );
    }

    async readPluginFile(pluginId, relPath) {
        if (!pluginId || !relPath) throw new Error('pluginId と relPath が必要です');
        if (relPath.includes('..')) throw new Error('相対パスに .. は不可');
        if (!this._isStorageReady()) return null;
        try {
            return await this._app.storage.readText(`plugins/${pluginId}/data/${relPath}`);
        } catch (_) {
            return null;
        }
    }
}

window.PluginEventBus = PluginEventBus;
window.BookshelfPluginAPI = BookshelfPluginAPI;
