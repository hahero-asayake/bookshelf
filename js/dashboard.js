'use strict';

/**
 * BookshelfDashboard — ホーム = ダッシュボード (12 列グリッド + ウィジェット)
 *
 * 設計:
 *   - 12 列 grid (col-span: 3 / 4 / 6 / 8 / 12)
 *   - ウィジェット registry に id → { label, defaultSpan, allowedSpans, render(host, app, config) }
 *   - ユーザ配置は userData._storage.main.home.widgets = [{ id, span, config? }, ...]
 *   - 編集モード: ⋮⋮ ドラッグ並び替え / × 外す / ＋ 追加ピッカー
 *
 * ウィジェット (MVP 10 種):
 *   counter-total, counter-shelves, counter-this-month, counter-unrated,
 *   recent-books, today-pick, bookshelf-highlights,
 *   heatmap, rating-dist, pinned-memo
 */

class BookshelfDashboard {
    constructor(app) {
        this.app = app;
        this.editMode = false;
        this._dragState = null;
        this._registry = this._buildRegistry();
    }

    /**
     * ウィジェット registry。各 entry は:
     *   label: 表示名 (追加ピッカー / カードヘッダで使用)
     *   defaultSpan: 初期幅 (3/4/6/8/12)
     *   allowedSpans: ユーザが選べる幅
     *   render(host, app, config): ウィジェット本体を host に描画
     */
    _buildRegistry() {
        return {
            'heading':             { label: '見出し',     icon: 'heading',          defaultSpan: 12, allowedSpans: [12], heading: true, render: this._renderHeading },
            'counter-total':       { label: '蔵書数',     icon: 'book-open',        defaultSpan: 3, allowedSpans: [3, 4, 6], counter: true, render: this._renderCounterTotal },
            'counter-shelves':     { label: '本棚数',     icon: 'library',          defaultSpan: 3, allowedSpans: [3, 4, 6], counter: true, render: this._renderCounterShelves },
            'counter-this-month':  { label: '今月追加',   icon: 'calendar',         defaultSpan: 3, allowedSpans: [3, 4, 6], counter: true, render: this._renderCounterThisMonth },
            'counter-unrated':     { label: '未評価',     icon: 'star',             defaultSpan: 3, allowedSpans: [3, 4, 6], counter: true, render: this._renderCounterUnrated },
            'recent-books':        { label: '最近追加した本', icon: 'clock',         defaultSpan: 8, allowedSpans: [6, 8, 12], render: this._renderRecentBooks },
            'today-pick':          { label: '今日の一冊', icon: 'sparkles',         defaultSpan: 4, allowedSpans: [3, 4, 6], render: this._renderTodayPick },
            'bookshelf-highlights':{ label: '本棚ハイライト', icon: 'layout-dashboard', defaultSpan: 12, allowedSpans: [6, 8, 12], render: this._renderBookshelfHighlights },
            'heatmap':             { label: '取得アクティビティ', icon: 'activity',  defaultSpan: 8, allowedSpans: [6, 8, 12], render: this._renderHeatmap },
            'rating-dist':         { label: '評価分布',   icon: 'bar-chart-3',      defaultSpan: 4, allowedSpans: [3, 4, 6], render: this._renderRatingDist },
            'pinned-memo':         { label: 'ピン留めメモ', icon: 'pin',            defaultSpan: 6, allowedSpans: [4, 6, 8, 12], render: this._renderPinnedMemo }
        };
    }

    static DEFAULT_LAYOUT = [
        { id: 'counter-total',        span: 3 },
        { id: 'counter-shelves',      span: 3 },
        { id: 'counter-this-month',   span: 3 },
        { id: 'counter-unrated',      span: 3 },
        { id: 'recent-books',         span: 8 },
        { id: 'today-pick',           span: 4 },
        { id: 'bookshelf-highlights', span: 12 },
        { id: 'heatmap',              span: 8 },
        { id: 'rating-dist',          span: 4 }
    ];

    /**
     * userData._storage.main.home.widgets を返す (空なら DEFAULT_LAYOUT)
     */
    getLayout() {
        const home = this.app.userData?._storage?.main?.home;
        if (home && Array.isArray(home.widgets) && home.widgets.length > 0) {
            return home.widgets.filter(w => this._registry[w.id]); // 未知 id は除外
        }
        return BookshelfDashboard.DEFAULT_LAYOUT.slice();
    }

    /**
     * レイアウトを保存して同期。
     */
    async saveLayout(widgets) {
        if (!this.app.userData) this.app.userData = {};
        if (!this.app.userData._storage) this.app.userData._storage = {};
        if (!this.app.userData._storage.main) this.app.userData._storage.main = {};
        if (!this.app.userData._storage.main.home) this.app.userData._storage.main.home = {};
        this.app.userData._storage.main.home.widgets = widgets.map(w => ({
            id: w.id,
            span: w.span,
            ...(w.config ? { config: w.config } : {})
        }));
        await this.app.saveUserData();
    }

    /**
     * ダッシュボードを描画。`#dashboard` を host とする。
     */
    render() {
        const host = document.getElementById('dashboard');
        if (!host) return;
        const layout = this.getLayout();

        const ico = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        const toolbarHtml = `
            <div class="dashboard-toolbar">
                <h2 class="dashboard-title">${ico('layout-dashboard', 18)}ホーム</h2>
                <div class="dashboard-toolbar-actions">
                    ${this.editMode
                        ? `<button class="btn btn-secondary btn-small" id="dashboard-add-widget" type="button">${ico('plus')}ウィジェット追加</button>
                           <button class="btn btn-primary btn-small" id="dashboard-edit-done" type="button">${ico('check')}完了</button>`
                        : `<button class="btn btn-secondary btn-small" id="dashboard-edit-toggle" type="button">${ico('pencil')}レイアウト編集</button>`}
                </div>
            </div>
        `;

        const gridHtml = `<div class="dashboard-grid${this.editMode ? ' is-edit-mode' : ''}" id="dashboard-grid"></div>`;
        host.innerHTML = toolbarHtml + gridHtml;

        const grid = document.getElementById('dashboard-grid');
        for (let i = 0; i < layout.length; i++) {
            const w = layout[i];
            const entry = this._registry[w.id];
            if (!entry) continue;
            const card = document.createElement('div');
            // #4: 常時 accent 反転はやめ、カウンターは hover/focus 時のみ accent (CSS 側)
            const markerClass = entry.counter ? ' is-counter' : (entry.heading || w.id === 'heading' ? ' is-heading' : '');
            card.className = `dashboard-widget span-${w.span}${markerClass}`;
            card.dataset.widgetId = w.id;
            card.dataset.widgetIndex = String(i);
            card.draggable = this.editMode;
            card.innerHTML = `
                <div class="widget-header">
                    ${this.editMode ? `<span class="widget-grip" title="ドラッグで並び替え">${window.renderIcon('grip-vertical', { size: 14 })}</span>` : ''}
                    <span class="widget-title">${this._escape(entry.label)}</span>
                    ${this.editMode ? `
                        <span class="widget-actions">
                            <select class="widget-span-select" title="幅">
                                ${(entry.allowedSpans || [3,4,6,8,12]).map(s =>
                                    `<option value="${s}"${s === w.span ? ' selected' : ''}>${s}</option>`
                                ).join('')}
                            </select>
                            <button class="widget-remove-btn" type="button" title="外す">${window.renderIcon('x', { size: 14 })}</button>
                        </span>
                    ` : ''}
                </div>
                <div class="widget-body"></div>
            `;
            grid.appendChild(card);
            const body = card.querySelector('.widget-body');
            try {
                entry.render.call(this, body, this.app, w.config || {});
            } catch (e) {
                console.error(`[dashboard] widget "${w.id}" render error:`, e);
                body.innerHTML = `<p style="color:#dc2626;">${this._escape(e.message)}</p>`;
            }
        }

        // 編集モード中、末尾に「+ ウィジェット追加」dashed カードを追加 (モックアップ準拠)
        if (this.editMode) {
            const placed = new Set(layout.map(w => w.id));
            const remaining = Object.keys(this._registry).filter(id => !placed.has(id));
            if (remaining.length > 0) {
                const addCard = document.createElement('button');
                addCard.type = 'button';
                addCard.className = 'add-widget-card';
                addCard.id = 'add-widget-card';
                addCard.innerHTML = `${window.renderIcon('plus', { size: 18 })}<span>ここにウィジェットを追加 (${remaining.length} 種)</span>`;
                grid.appendChild(addCard);
            }
        }

        this._bindEvents();
    }

    _bindEvents() {
        const host = document.getElementById('dashboard');
        if (!host) return;
        if (this._abortCtrl) try { this._abortCtrl.abort(); } catch (_) {}
        this._abortCtrl = new AbortController();
        const signal = this._abortCtrl.signal;

        const toolbar = host.querySelector('.dashboard-toolbar-actions');
        toolbar?.addEventListener('click', (e) => {
            if (e.target.closest('#dashboard-edit-toggle')) {
                this.editMode = true;
                this.render();
            } else if (e.target.closest('#dashboard-edit-done')) {
                this.editMode = false;
                this.render();
            } else if (e.target.closest('#dashboard-add-widget')) {
                this._openWidgetPicker();
            }
        }, { signal });

        const grid = document.getElementById('dashboard-grid');
        if (!grid) return;
        grid.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.widget-remove-btn');
            if (removeBtn) {
                e.stopPropagation();
                const card = removeBtn.closest('.dashboard-widget');
                this._removeWidget(card?.dataset.widgetId);
                return;
            }
            // dashed 「+ ウィジェット追加」 カード or ツールバーの追加ボタンから picker 起動
            const addCardEl = e.target.closest('#add-widget-card');
            if (addCardEl) {
                this._openWidgetPicker();
            }
        }, { signal });
        grid.addEventListener('change', (e) => {
            const spanSelect = e.target.closest('.widget-span-select');
            if (spanSelect) {
                const card = spanSelect.closest('.dashboard-widget');
                this._changeSpan(card?.dataset.widgetId, Number(spanSelect.value));
            }
        }, { signal });

        // ドラッグ並び替え
        if (this.editMode) this._bindDnd(grid, signal);
    }

    _bindDnd(grid, signal) {
        const state = { sourceId: null };
        grid.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.dashboard-widget');
            if (!card) return;
            state.sourceId = card.dataset.widgetId;
            card.classList.add('is-dragging');
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }, { signal });
        grid.addEventListener('dragend', () => {
            grid.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
            grid.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
            state.sourceId = null;
        }, { signal });
        grid.addEventListener('dragover', (e) => {
            if (!state.sourceId) return;
            const card = e.target.closest('.dashboard-widget');
            if (!card || card.dataset.widgetId === state.sourceId) return;
            e.preventDefault();
            grid.querySelectorAll('.drop-target').forEach(el => {
                if (el !== card) el.classList.remove('drop-target');
            });
            card.classList.add('drop-target');
        }, { signal });
        grid.addEventListener('drop', (e) => {
            if (!state.sourceId) return;
            const targetCard = e.target.closest('.dashboard-widget');
            if (!targetCard) return;
            e.preventDefault();
            const layout = this.getLayout();
            const fromIdx = layout.findIndex(w => w.id === state.sourceId);
            const toIdx = layout.findIndex(w => w.id === targetCard.dataset.widgetId);
            if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
            const [moved] = layout.splice(fromIdx, 1);
            layout.splice(toIdx, 0, moved);
            this.saveLayout(layout).then(() => this.render());
        }, { signal });
    }

    async _removeWidget(id) {
        if (!id) return;
        const layout = this.getLayout().filter(w => w.id !== id);
        await this.saveLayout(layout);
        this.render();
    }

    async _changeSpan(id, span) {
        if (!id) return;
        const layout = this.getLayout();
        const target = layout.find(w => w.id === id);
        if (target) target.span = span;
        await this.saveLayout(layout);
        this.render();
    }

    _openWidgetPicker() {
        // 既に配置中のもの以外を候補に
        const placed = new Set(this.getLayout().map(w => w.id));
        const candidates = Object.keys(this._registry).filter(id => !placed.has(id));
        if (candidates.length === 0) {
            alert('全てのウィジェットが既に配置済みです');
            return;
        }

        // 既存があれば撤去
        document.getElementById('widget-picker-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'widget-picker-overlay';
        overlay.className = 'widget-picker-overlay';
        const ico = (n) => window.renderIcon(this._registry[n].icon || 'layout-dashboard', { size: 20 });
        overlay.innerHTML = `
            <div class="widget-picker-backdrop"></div>
            <div class="widget-picker-panel" role="dialog" aria-modal="true" aria-label="ウィジェットを追加">
                <div class="widget-picker-head">
                    <span>ウィジェットを追加</span>
                    <button type="button" class="widget-picker-close" title="閉じる">${window.renderIcon('x', { size: 16 })}</button>
                </div>
                <div class="widget-picker-grid">
                    ${candidates.map(id => `
                        <button type="button" class="widget-picker-item" data-wid="${id}">
                            <span class="wpi-icon">${ico(id)}</span>
                            <span class="wpi-label">${this._escape(this._registry[id].label)}</span>
                        </button>`).join('')}
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        overlay.querySelector('.widget-picker-backdrop').addEventListener('click', close);
        overlay.querySelector('.widget-picker-close').addEventListener('click', close);
        overlay.querySelectorAll('.widget-picker-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const newId = btn.dataset.wid;
                const entry = this._registry[newId];
                if (!entry) return;
                const layout = this.getLayout();
                layout.push({ id: newId, span: entry.defaultSpan });
                close();
                this.saveLayout(layout).then(() => this.render());
            });
        });
    }

    // ==================== ウィジェット実装 ====================

    _escape(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _bigNumber(host, value, sub) {
        host.innerHTML = `
            <div class="widget-big-number">
                <span class="bn-value">${value}</span>
                ${sub ? `<span class="bn-sub">${this._escape(sub)}</span>` : ''}
            </div>
        `;
    }

    /**
     * 見出しウィジェット。編集モードではテキスト入力、表示モードでは大きな見出し。
     */
    _renderHeading(host, app, config) {
        const text = (config && config.text) || '見出し';
        if (this.editMode) {
            host.innerHTML = `<input class="widget-heading-input" type="text" placeholder="見出しテキスト">`;
            const input = host.querySelector('.widget-heading-input');
            input.value = text;
            input.addEventListener('change', () => {
                const card = host.closest('.dashboard-widget');
                this._setWidgetConfig(card, { text: input.value });
            });
            // クリックで詳細遷移などを防ぐ
            input.addEventListener('click', (e) => e.stopPropagation());
        } else {
            host.innerHTML = `<div class="widget-heading-text">${this._escape(text)}</div>`;
        }
    }

    /**
     * カードに対応する layout エントリの config を更新して保存 (再描画はしない)。
     */
    _setWidgetConfig(card, partial) {
        if (!card) return;
        const idx = Number(card.dataset.widgetIndex);
        const layout = this.getLayout();
        if (!layout[idx]) return;
        layout[idx].config = { ...(layout[idx].config || {}), ...partial };
        this.saveLayout(layout);
    }

    _renderCounterTotal(host, app) {
        const n = (app.books || []).length;
        this._bigNumber(host, n.toLocaleString(), '冊');
    }

    _renderCounterShelves(host, app) {
        const n = (app.userData?.bookshelves || []).filter(b => !b.isSpecial).length;
        this._bigNumber(host, n.toLocaleString(), '棚');
    }

    _renderCounterThisMonth(host, app) {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const n = (app.books || []).filter(b => (b.acquiredTime || 0) >= start).length;
        this._bigNumber(host, n.toLocaleString(), '冊');
    }

    _renderCounterUnrated(host, app) {
        const notes = app.userData?.notes || {};
        const n = (app.books || []).filter(b => !notes[b.asin]?.rating).length;
        this._bigNumber(host, n.toLocaleString(), '冊');
    }

    _renderRecentBooks(host, app, config) {
        const limit = (config && config.limit) || 8;
        const sorted = (app.books || [])
            .slice()
            .sort((a, b) => (b.acquiredTime || 0) - (a.acquiredTime || 0))
            .slice(0, limit);
        if (sorted.length === 0) {
            host.innerHTML = '<p style="color:#9ca3af;">最近追加された本はありません</p>';
            return;
        }
        host.innerHTML = `
            <div class="widget-book-row">
                ${sorted.map(b => `
                    <button type="button" class="widget-book-cell" data-asin="${this._escape(b.asin)}" title="${this._escape(b.title)}">
                        ${b.productImage
                            ? `<img src="${this._escape(app.bookManager.getProductImageUrl(b))}" alt="">`
                            : `<div class="widget-book-cell-placeholder">${window.renderIcon('book-open', { size: 24 })}</div>`}
                        <div class="widget-book-cell-title">${this._escape(b.title)}</div>
                    </button>
                `).join('')}
            </div>
        `;
        host.querySelectorAll('[data-asin]').forEach(btn => {
            btn.addEventListener('click', () => {
                const book = app.books.find(b => b.asin === btn.dataset.asin);
                if (book) app.showBookDetail(book, false);
            });
        });
    }

    _renderTodayPick(host, app) {
        const books = app.books || [];
        if (books.length === 0) {
            host.innerHTML = '<p style="color:#9ca3af;">蔵書がありません</p>';
            return;
        }
        // 日付ベースの決定論的ランダム (1日同じ本)
        const today = new Date();
        const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
        const pick = books[seed % books.length];
        host.innerHTML = `
            <button type="button" class="widget-today-pick" data-asin="${this._escape(pick.asin)}">
                ${pick.productImage
                    ? `<img src="${this._escape(app.bookManager.getProductImageUrl(pick))}" alt="">`
                    : `<div class="widget-today-pick-placeholder">${window.renderIcon('book-open', { size: 32 })}</div>`}
                <div class="widget-today-pick-title">${this._escape(pick.title)}</div>
                <div class="widget-today-pick-author">${this._escape(pick.authors || '')}</div>
            </button>
        `;
        const btn = host.querySelector('[data-asin]');
        btn?.addEventListener('click', () => app.showBookDetail(pick, false));
    }

    _renderBookshelfHighlights(host, app) {
        const shelves = (app.userData?.bookshelves || []).filter(b => !b.isSpecial);
        if (shelves.length === 0) {
            host.innerHTML = '<p style="color:#9ca3af;">本棚がありません。本棚管理から作成してください。</p>';
            return;
        }
        host.innerHTML = `<div class="widget-bookshelves-grid" id="widget-bookshelves-grid-host"></div>`;
        const gridHost = host.querySelector('#widget-bookshelves-grid-host');
        // 既存 _renderBookshelfCard を使い回す
        const showImages = !!app.showImagesInOverview;
        const textOnlyClass = showImages ? '' : 'text-only';
        const all = (app.userData?.bookshelves || []).find(b => b.isSpecial);
        const cards = [];
        if (all) cards.push(app._renderBookshelfCard(all, textOnlyClass));
        for (const bs of shelves) cards.push(app._renderBookshelfCard(bs, textOnlyClass));
        gridHost.innerHTML = cards.join('');
        // バインド (既存の _bindBookshelfOverviewEvents を流用)
        if (typeof app._bindBookshelfOverviewEvents === 'function') {
            app._bindBookshelfOverviewEvents(gridHost);
        }
    }

    _renderHeatmap(host, app) {
        // 過去 26 週分の取得アクティビティをヒートマップで
        const weeks = 26;
        const days = weeks * 7;
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
        const counts = new Array(days).fill(0);
        for (const b of (app.books || [])) {
            if (!b.acquiredTime) continue;
            const d = new Date(b.acquiredTime);
            const diff = Math.floor((d - start) / (1000 * 60 * 60 * 24));
            if (diff >= 0 && diff < days) counts[diff]++;
        }
        const max = Math.max(1, ...counts);
        const cells = counts.map((c, i) => {
            const intensity = c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4));
            const dayDate = new Date(start.getTime() + i * 86400000);
            const label = `${dayDate.getMonth() + 1}/${dayDate.getDate()}: ${c}冊`;
            return `<div class="hm-cell hm-l${intensity}" title="${label}"></div>`;
        }).join('');
        host.innerHTML = `
            <div class="widget-heatmap" style="grid-template-columns: repeat(${weeks}, 1fr);">${cells}</div>
            <div class="widget-heatmap-legend">
                <span>少</span>
                <span class="hm-cell hm-l0"></span>
                <span class="hm-cell hm-l1"></span>
                <span class="hm-cell hm-l2"></span>
                <span class="hm-cell hm-l3"></span>
                <span class="hm-cell hm-l4"></span>
                <span>多</span>
            </div>
        `;
    }

    _renderRatingDist(host, app) {
        const notes = app.userData?.notes || {};
        const dist = [0, 0, 0, 0, 0, 0]; // index 0 = 未評価, 1-5 = 星数
        for (const b of (app.books || [])) {
            const r = notes[b.asin]?.rating || 0;
            dist[Math.min(5, Math.max(0, Math.floor(r)))]++;
        }
        const max = Math.max(1, ...dist);
        const labels = ['未評価', '★1', '★2', '★3', '★4', '★5'];
        host.innerHTML = `
            <div class="widget-rating-dist">
                ${labels.map((lbl, i) => `
                    <div class="rd-row">
                        <span class="rd-label">${lbl}</span>
                        <div class="rd-bar-wrap"><div class="rd-bar" style="width:${(dist[i] / max * 100).toFixed(1)}%;"></div></div>
                        <span class="rd-count">${dist[i]}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _renderPinnedMemo(host, app, config) {
        const memoKey = 'bookshelf_pinnedMemo_v1';
        const current = localStorage.getItem(memoKey) || '';
        host.innerHTML = `
            <textarea class="widget-pinned-memo" placeholder="自由メモ (localStorage に保存)...">${this._escape(current)}</textarea>
        `;
        const ta = host.querySelector('textarea');
        let timer = null;
        ta.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                try { localStorage.setItem(memoKey, ta.value); } catch (_) {}
            }, 400);
        });
    }
}

window.BookshelfDashboard = BookshelfDashboard;
