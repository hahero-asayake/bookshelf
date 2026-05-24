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
//   bookshelf:created { meta }
//   bookshelf:updated { meta, prev }
//   bookshelf:removed { internalId }
//   note:updated     { asin, note }
//   export:before    { state }
//   export:after     { result }
//   sync:completed   {}
//   ui:bookshelf-rendered { internalId }
//   ui:book-modal-opened  { asin }

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
        // pluginId → { eventHandlers: [{ event, handler }], uiButtonIds: Set, exportTransforms: [fn] }
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
                exportTransforms: []
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
            updateNote: (asin, partial) => self.updateNote(asin, partial),
            refreshUI: () => self.refreshUI(),
            addUIButton: (opts) => {
                const entry = self.addUIButton(opts);
                if (entry) reg.uiButtonIds.add(entry.id);
                return entry;
            },
            removeUIButton: (id) => {
                self.removeUIButton(id);
                reg.uiButtonIds.delete(id);
            },
            registerExportTransform: (fn) => {
                self.registerExportTransform(fn);
                reg.exportTransforms.push(fn);
            },
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
        const b = this._app.bookshelfManager.getByInternalId(internalId);
        return b ? { ...b } : null;
    }
    getBookshelfBySlug(slug) {
        if (!this._app.bookshelfManager) return null;
        const b = this._app.bookshelfManager.getBySlug(slug);
        return b ? { ...b } : null;
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
        if (typeof this._app.updateDisplay === 'function') this._app.updateDisplay();
        if (typeof this._app.updateStats === 'function') this._app.updateStats();
        if (typeof this._app.renderBookshelfOverview === 'function') this._app.renderBookshelfOverview();
    }

    // ===== UI 拡張ポイント =====
    // where: 'library-management' | 'bookshelf-toolbar' | 'book-modal-actions'
    addUIButton({ id, where, label, title, onClick, emoji }) {
        if (!id || !label || typeof onClick !== 'function') {
            console.warn('[pluginAPI] addUIButton: id, label, onClick are required');
            return null;
        }
        const existing = this._uiButtons.find(b => b.id === id);
        if (existing) return existing;
        const entry = { id, where: where || 'library-management', label, title: title || '', onClick, emoji: emoji || '🧩', element: null };
        this._uiButtons.push(entry);
        this._renderUIButton(entry);
        return entry;
    }

    removeUIButton(id) {
        const idx = this._uiButtons.findIndex(b => b.id === id);
        if (idx < 0) return;
        const [entry] = this._uiButtons.splice(idx, 1);
        if (entry.element && entry.element.parentNode) {
            entry.element.parentNode.removeChild(entry.element);
        }
    }

    _renderUIButton(entry) {
        const containerMap = {
            'library-management': '.management-buttons',
            'bookshelf-toolbar': '#bookshelf-toolbar',
            'book-modal-actions': '#book-modal-actions'
        };
        const sel = containerMap[entry.where] || containerMap['library-management'];
        const container = document.querySelector(sel);
        if (!container) {
            console.warn(`[pluginAPI] addUIButton: container "${sel}" not found yet`);
            return;
        }
        const btn = document.createElement('button');
        btn.id = `plugin-btn-${entry.id}`;
        btn.className = 'btn btn-secondary plugin-ui-button';
        btn.textContent = `${entry.emoji} ${entry.label}`;
        if (entry.title) btn.title = entry.title;
        btn.addEventListener('click', () => {
            try { entry.onClick(); }
            catch (e) { console.error(`[plugin button "${entry.id}"]`, e); }
        });
        container.appendChild(btn);
        entry.element = btn;
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

    // ===== ストレージ補助 =====
    // プラグインが同期フォルダに任意ファイルを書きたい場合のヘルパー
    // 制限: plugins/<pluginId>/data/ 配下のみ許可
    async writePluginFile(pluginId, relPath, text) {
        if (!pluginId || !relPath) throw new Error('pluginId と relPath が必要です');
        if (relPath.includes('..')) throw new Error('相対パスに .. は不可');
        if (!this._app.obsidianDirHandle) throw new Error('同期フォルダ未接続');
        const storage = this._app.storage;
        await storage._writeText(text, 'plugins', pluginId, 'data', ...relPath.split('/'));
    }

    async readPluginFile(pluginId, relPath) {
        if (!pluginId || !relPath) throw new Error('pluginId と relPath が必要です');
        if (relPath.includes('..')) throw new Error('相対パスに .. は不可');
        if (!this._app.obsidianDirHandle) return null;
        const storage = this._app.storage;
        return await storage._readText('plugins', pluginId, 'data', ...relPath.split('/'));
    }
}

window.PluginEventBus = PluginEventBus;
window.BookshelfPluginAPI = BookshelfPluginAPI;
