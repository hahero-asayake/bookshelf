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
 * ウィジェット:
 *   heading, counter-total, counter-shelves, counter-this-month, counter-unrated,
 *   recent-books, today-pick, bookshelf-highlights, reading-stats, pinned-memo
 *   (reading-stats は旧プラグインを既定機能化。heatmap/monthly-additions/rating-dist は
 *    reading-stats に集約して廃止 — MIGRATE_WIDGETS で旧レイアウトを移行)
 */

class BookshelfDashboard {
    constructor(app) {
        this.app = app;
        this.editMode = false;
        this._dragState = null;
        this._registry = this._buildRegistry();
        // ブレークポイントを跨いだら (PC↔スマホ) 大きさセレクトの中身が変わるので再描画。
        // m-half/m-full クラスは常時付くのでレイアウト自体は再描画なしでも正しい。
        // 境目の判定はjs/ui/viewport.jsに一本化(イシュー#505)。
        this._unsubViewport = window.viewport.onChange(() => {
            const host = document.getElementById('dashboard');
            if (host && host.offsetParent !== null) this.render();
        });
    }

    /** 現在スマホ幅か (大きさ設定を「半分/全幅」に切替える基準)。 */
    _isMobile() {
        return window.viewport.isNarrow();
    }

    /**
     * ウィジェット registry。各 entry は:
     *   label: 表示名 (追加ピッカー / カードヘッダで使用)
     *   defaultSpan: 初期幅 (3/4/6/8/12)
     *   allowedSpans: ユーザが選べる幅
     *   render(host, app, config): ウィジェット本体を host に描画
     */
    _buildRegistry() {
        // 大きさは T シャツサイズ (allowedSizes のキー)。PC では列数 (SIZE_COLS) に、
        // モバイルでは半分/全幅に自動マッピング (CSS 側)。defaultSpan は列数 (= サイズの実体)。
        return {
            'heading':             { label: '見出し',     icon: 'heading',          defaultSpan: 12, allowedSizes: ['xl'], heading: true, render: this._renderHeading },
            'counter-total':       { label: '蔵書数',     icon: 'book-open',        defaultSpan: 3, allowedSizes: ['sm', 'md'], counter: true, render: this._renderCounterTotal },
            'counter-shelves':     { label: '本棚数',     icon: 'library',          defaultSpan: 3, allowedSizes: ['sm', 'md'], counter: true, render: this._renderCounterShelves },
            'counter-this-month':  { label: '今月追加',   icon: 'calendar',         defaultSpan: 3, allowedSizes: ['sm', 'md'], counter: true, render: this._renderCounterThisMonth },
            'counter-unrated':     { label: '未評価',     icon: 'star',             defaultSpan: 3, allowedSizes: ['sm', 'md'], counter: true, render: this._renderCounterUnrated },
            'recent-books':        { label: '最近追加した本', icon: 'clock',         defaultSpan: 9, allowedSizes: ['md', 'lg', 'xl'], render: this._renderRecentBooks },
            'today-pick':          { label: '今日の一冊', icon: 'sparkles',         defaultSpan: 6, allowedSizes: ['sm', 'md'], render: this._renderTodayPick },
            'bookshelf-highlights':{ label: '本棚ハイライト', icon: 'layout-dashboard', defaultSpan: 12, allowedSizes: ['md', 'lg', 'xl'], render: this._renderBookshelfHighlights },
            'reading-stats':       { label: '読書統計',   icon: 'bar-chart-3',      defaultSpan: 6, allowedSizes: ['md', 'lg', 'xl'], render: this._renderReadingStats },
            'pinned-memo':         { label: 'ピン留めメモ', icon: 'pin',            defaultSpan: 6, allowedSizes: ['md', 'lg', 'xl'], render: this._renderPinnedMemo }
        };
    }

    static DEFAULT_LAYOUT = [
        { id: 'counter-total',        span: 3 },
        { id: 'counter-shelves',      span: 3 },
        { id: 'counter-this-month',   span: 3 },
        { id: 'counter-unrated',      span: 3 },
        { id: 'recent-books',         span: 9 },
        { id: 'today-pick',           span: 6 },
        { id: 'bookshelf-highlights', span: 12 },
        { id: 'reading-stats',        span: 12 }
    ];

    // 廃止したウィジェット → 置換先。既存レイアウトに残っていても読み込み時に読書統計へ寄せる。
    // (追加カレンダー heatmap / 月別の追加数 monthly-additions / 評価分布 rating-dist は廃止し
    //  「読書統計」reading-stats に集約。reading-stats は旧プラグインを既定機能化したもの)
    static MIGRATE_WIDGETS = {
        'heatmap': 'reading-stats',
        'monthly-additions': 'reading-stats',
        'rating-dist': 'reading-stats'
    };

    // ウィジェットの大きさ = T シャツサイズ。PC は列数(SIZE_COLS)、モバイルは半分/全幅(CSS)。
    // 小・中 → モバイル半分 / 大・全幅 → モバイル全幅 (css/bookshelf.css のリフロー参照)。
    static SIZE_COLS  = { sm: 3, md: 6, lg: 9, xl: 12 };
    static SIZE_LABEL = { sm: '小', md: '中', lg: '大', xl: '全幅' };

    // 保存値 (span=列数) から最も近いサイズキーを返す (旧 span 4/8 等の互換)。
    static spanToSizeKey(span) {
        const entries = Object.entries(BookshelfDashboard.SIZE_COLS);
        let best = 'md', bestDiff = Infinity;
        for (const [k, cols] of entries) {
            const d = Math.abs(cols - (span || 6));
            if (d < bestDiff) { bestDiff = d; best = k; }
        }
        return best;
    }

    // --- スマホ専用の大きさ (半分 / 全幅) ---
    // スマホは 2 列グリッドなので意味のある幅は「半分 / 全幅」の 2 択のみ。
    // PC の T シャツサイズとは独立に spanMobile ('half'|'full') を保存する。
    static MOBILE_SIZE_LABEL = { half: '半分', full: '全幅' };

    // PC span から既定のスマホ大きさを導出 (未設定時のフォールバック)。
    // 小・中 (列数 ≤6) → 半分 / 大・全幅 (≥8) → 全幅。
    static mobileSizeFromSpan(span) {
        return (Number(span) || 6) >= 8 ? 'full' : 'half';
    }

    // レイアウトエントリの実効スマホ大きさ。spanMobile 未設定なら span から導出。
    // 見出しは常に全幅 (区切りなので半分は不自然)。
    _mobileSizeOf(w, entry) {
        if (entry && entry.heading) return 'full';
        return (w.spanMobile === 'half' || w.spanMobile === 'full')
            ? w.spanMobile
            : BookshelfDashboard.mobileSizeFromSpan(w.span);
    }

    /**
     * 大きさセレクトの HTML。PC は T シャツ 4 段階 (値=列数)、スマホは半分/全幅 (値='half'|'full')。
     * 選べる段階が 1 つ以下 (見出し) は出さない。値の型で change ハンドラが分岐する。
     */
    _sizeSelectHtml(w, entry) {
        if (!entry.allowedSizes || entry.allowedSizes.length <= 1) return '';
        if (this._isMobile()) {
            const cur = this._mobileSizeOf(w, entry);
            const opts = ['half', 'full'].map(k =>
                `<option value="${k}"${k === cur ? ' selected' : ''}>${BookshelfDashboard.MOBILE_SIZE_LABEL[k]}</option>`).join('');
            return `<select class="widget-size-select" title="大きさ (スマホ)">${opts}</select>`;
        }
        const curKey = BookshelfDashboard.spanToSizeKey(w.span);
        const opts = entry.allowedSizes.map(k => {
            const cols = BookshelfDashboard.SIZE_COLS[k];
            const sel = (k === curKey) ? ' selected' : '';
            return `<option value="${cols}"${sel}>${BookshelfDashboard.SIZE_LABEL[k]}</option>`;
        }).join('');
        return `<select class="widget-size-select" title="大きさ">${opts}</select>`;
    }

    /**
     * userData._storage.main.home.widgets を返す (空なら DEFAULT_LAYOUT)。
     * 各エントリには配置インスタンスを一意に指す `uid` (= `id#index`) を付与する。
     * これで同一ウィジェットを複数配置しても、削除・幅変更・並び替えが正しいインスタンスに効く。
     * (uid は派生値で保存しない。ストアの並びが安定している限り getLayout 間で一致する)
     * 注: ストア/DEFAULT_LAYOUT のオブジェクトは破壊しないよう新しいオブジェクトに写す。
     */
    getLayout() {
        const home = this.app.userData?._storage?.main?.home;
        const src = (home && Array.isArray(home.widgets) && home.widgets.length > 0)
            ? home.widgets
            : BookshelfDashboard.DEFAULT_LAYOUT;
        // 廃止ウィジェットの移行 + 未知 id 除去。移行先 (読書統計) は重複生成しないよう 1 つに寄せる。
        const out = [];
        let migratedStats = false;
        for (const w of src) {
            const repl = BookshelfDashboard.MIGRATE_WIDGETS[w.id];
            if (repl) {
                if (migratedStats || !this._registry[repl]) continue; // 廃止ウィジェットは出さない
                out.push({ id: repl, span: this._registry[repl].defaultSpan });
                migratedStats = true;
                continue;
            }
            if (!this._registry[w.id]) continue;                    // 未知 id は除外
            out.push({ id: w.id, span: w.span, spanMobile: w.spanMobile, config: w.config });
        }
        // uid (= id#index) を付与: 同一ウィジェット複数配置でも操作が正しいインスタンスに効く
        return out.map((w, i) => ({ ...w, uid: `${w.id}#${i}` }));
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
            ...(w.spanMobile ? { spanMobile: w.spanMobile } : {}),
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

        // ===== toolbar: 既存ノードがあればアクションボタンだけ差し替え、無ければ作る =====
        // (イシュー#265: index.html 側に「蔵書0・同期未設定」前提の静的初期HTMLを置いてあるため、
        //  初回描画では要素を作り直さず再利用する＝LCP要素が消えて再生成されるのを避ける)
        const actionsHtml = this.editMode
            ? `<button class="btn btn-secondary btn-small" id="dashboard-add-widget" type="button">${ico('plus')}ウィジェット追加</button>
               <button class="btn btn-primary btn-small" id="dashboard-edit-done" type="button">${ico('check')}完了</button>`
            : `<button class="btn btn-secondary btn-small" id="dashboard-edit-toggle" type="button">${ico('pencil')}レイアウト編集</button>`;
        let toolbar = host.querySelector('.dashboard-toolbar');
        if (toolbar) {
            const actions = toolbar.querySelector('.dashboard-toolbar-actions');
            if (actions) actions.innerHTML = actionsHtml;
        } else {
            toolbar = document.createElement('div');
            toolbar.className = 'dashboard-toolbar';
            toolbar.innerHTML = `<h2 class="dashboard-title">${ico('layout-dashboard', 18)}ホーム</h2><div class="dashboard-toolbar-actions">${actionsHtml}</div>`;
            host.insertBefore(toolbar, host.firstChild);
        }

        // ===== welcome: 既存ノードがあれば step1 の状態だけ更新、無ければ作る。出さないなら消す =====
        const showWelcome = !this.editMode && (this.app.books || []).length === 0 && !this._welcomeDismissed();
        // index.html の inline script が「蔵書ありの可能性が高い」と仮判定して
        // html.bs-likely-has-data で welcome を隠している場合がある。実データで
        // showWelcome=true と分かった時点でここを外す (フラッシュ防止・イシュー#265)。
        if (showWelcome) document.documentElement.classList.remove('bs-likely-has-data');
        let welcomeEl = document.getElementById('dashboard-welcome');
        if (showWelcome) {
            if (welcomeEl) {
                this._updateWelcomeStep1(welcomeEl);
                // index.html の静的HTML由来のwelcomeは一度もbindされていないので、
                // ここで初めて見つけた既存ノードにもbindする (bs-boundで二重bindを防ぐ・イシュー#265)。
                if (!welcomeEl.dataset.bsBound) {
                    this._bindWelcome();
                    welcomeEl.dataset.bsBound = '1';
                }
            } else {
                const tmp = document.createElement('div');
                tmp.innerHTML = this._welcomeHtml();
                welcomeEl = tmp.firstElementChild;
                toolbar.after(welcomeEl);
                this._bindWelcome();
                welcomeEl.dataset.bsBound = '1';
            }
        } else if (welcomeEl) {
            welcomeEl.remove();
        }

        // ===== grid: 既存ノードがあれば中身だけ作り直す (データ依存なので毎回再構築) =====
        let grid = document.getElementById('dashboard-grid');
        if (!grid) {
            grid = document.createElement('div');
            grid.id = 'dashboard-grid';
            host.appendChild(grid);
        }
        if (!this.editMode) this._picking = null; // 編集モードを出たら「選んで置く」も解除
        grid.className = `dashboard-grid${this.editMode ? ' is-edit-mode' : ''}${this._picking ? ' is-picking' : ''}`;
        // イシュー#521 X2: 並べ替え・追加・外すの結果を読み上げる場所 (grid の外に1つ。再描画で消さない)
        if (!document.getElementById('dashboard-live')) {
            const live = document.createElement('div');
            live.id = 'dashboard-live';
            live.className = 'dashboard-live';
            live.setAttribute('aria-live', 'polite');
            host.appendChild(live);
        }
        // 作り直す前に、横に流せる行 (最近追加した本) の位置を部品ごとに覚えておき、作り直した後に戻す。評価・本棚の
        // 所属の変更でも描き直すので、戻さないと読んでいた位置が先頭へ飛ぶ (イシュー#615)
        const rowLefts = new Map();
        grid.querySelectorAll('.dashboard-widget .widget-book-row').forEach(r => {
            if (r.scrollLeft > 0) rowLefts.set(r.closest('.dashboard-widget').dataset.widgetId, r.scrollLeft);
        });
        grid.innerHTML = '';
        // イシュー#521 X2 (G3): 編集モードの時だけ、流し方で残る穴に「＋ここに追加」の枠を出す。
        // 枠は穴の幅ぴったりなので、差し込んでも他の部品の位置は変わらない。穴の位置は保存しない。
        const holesAt = new Map();
        if (this.editMode) {
            for (const h of this._computeHoles(layout)) {
                if (!holesAt.has(h.index)) holesAt.set(h.index, []);
                holesAt.get(h.index).push(h);
            }
        }
        const appendHoles = (idx) => (holesAt.get(idx) || []).forEach(h => grid.appendChild(this._holeEl(h)));
        for (let i = 0; i < layout.length; i++) {
            const w = layout[i];
            const entry = this._registry[w.id];
            if (!entry) continue;
            appendHoles(i);
            const card = document.createElement('div');
            // #4: 常時 accent 反転はやめ、カウンターは hover/focus 時のみ accent (CSS 側)
            const markerClass = entry.counter ? ' is-counter' : (entry.heading || w.id === 'heading' ? ' is-heading' : '');
            // span-N = PC の列幅 / m-half・m-full = スマホの幅 (CSS のメディアクエリで切替)
            const mSize = this._mobileSizeOf(w, entry);
            card.className = `dashboard-widget span-${w.span} m-${mSize}${markerClass}${this._picking === w.uid ? ' is-picked' : ''}`;
            card.dataset.widgetId = w.uid;          // インスタンス一意キー (同一ウィジェット複数配置に対応)
            card.dataset.widgetIndex = String(i);
            card.innerHTML = `
                <div class="widget-header">
                    ${this.editMode ? `<button type="button" class="widget-grip" title="押して移動先を選ぶ・ドラッグ・↑↓で並び替え" aria-label="「${BookshelfEscape.escapeHtml(entry.label)}」を移動" aria-pressed="${this._picking === w.uid}">${window.renderIcon('grip-vertical', { size: 14 })}</button>` : ''}
                    <span class="widget-title">${BookshelfEscape.escapeHtml(entry.label)}</span>
                    ${this.editMode ? `
                        <span class="widget-actions">
                            ${this._sizeSelectHtml(w, entry)}
                            <button class="widget-insert-btn" type="button" title="この後ろに追加" aria-label="「${BookshelfEscape.escapeHtml(entry.label)}」の後ろに追加">${window.renderIcon('plus', { size: 14 })}</button>
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
                body.innerHTML = `<p style="color:var(--danger);">${BookshelfEscape.escapeHtml(e.message)}</p>`;
            }
        }

        appendHoles(layout.length); // 最後の行の残り

        // 編集モード中、末尾に「+ ウィジェット追加」dashed カードを追加 (モックアップ準拠)。
        // 同一ウィジェットを複数置けるので、配置済みかどうかに関わらず常に表示する。
        if (this.editMode) {
            const total = Object.keys(this._registry).length;
            const addCard = document.createElement('button');
            addCard.type = 'button';
            addCard.className = 'add-widget-card';
            addCard.id = 'add-widget-card';
            addCard.innerHTML = `${window.renderIcon('plus', { size: 18 })}<span>ここにウィジェットを追加 (${total} 種)</span>`;
            grid.appendChild(addCard);
        }

        rowLefts.forEach((left, uid) => {
            const r = grid.querySelector(`.dashboard-widget[data-widget-id="${CSS.escape(uid)}"] .widget-book-row`);
            if (r) r.scrollLeft = left;
        });

        this._bindEvents();
    }

    // 部品1つの、今の格子での幅 (列数)。PC は span (12列)、スマホは half=1 / full=2 (2列)。
    _colsOf(w) {
        const entry = this._registry[w.id];
        if (this._isMobile()) return this._mobileSizeOf(w, entry) === 'full' ? 2 : 1;
        return Number(w.span) || (entry ? entry.defaultSpan : 6);
    }

    // 今の格子の列の数と、並びから計算した穴 (js/ui/widget-holes.js)。
    _computeHoles(layout) {
        const C = this._isMobile() ? 2 : 12;
        return window.WidgetHoles.compute(layout.filter(w => this._registry[w.id]).map(w => this._colsOf(w)), C);
    }

    // 「＋ここに追加」の枠。押すと穴の幅に入る候補が出る。ドラッグの落とす先にもなる (holeSelector)。
    // .dashboard-widget は付けない (並べ替えの挿入位置の計算が、このクラスで部品を数えるため)。
    _holeEl(h) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'widget-hole';
        el.style.gridColumn = `span ${h.width}`;
        el.dataset.holeIndex = String(h.index);
        el.dataset.holeWidth = String(h.width);
        el.setAttribute('aria-label', `ここに追加（${this._isMobile() ? '半分' : `${h.width}列`}の空き）`);
        el.innerHTML = `${window.renderIcon('plus', { size: 16 })}<span>ここに追加</span>`;
        return el;
    }

    // 穴 (幅 width 列) に入る大きさ。PC は部品の allowedSizes のうち列数が width 以下のもの、
    // スマホの穴は常に1列 (=半分) なので sm/md を持つ部品だけ (見出しは全幅だけなので入らない)。
    _sizesFitting(entry, width) {
        const sizes = entry.allowedSizes || [];
        if (this._isMobile()) return (entry.heading || !sizes.some(k => k === 'sm' || k === 'md')) ? [] : ['half'];
        return sizes.filter(k => BookshelfDashboard.SIZE_COLS[k] <= width);
    }

    // ===== 初回オンボーディング (蔵書0のときだけ出す3ステップ案内) =====
    // × で閉じてもそのセッション限り (sessionStorage)。蔵書 0 の間は次回起動でまた出す。
    // 恒久非表示は「本を1冊でも入れる」ことで達成される (showWelcome の books.length 条件)。
    _welcomeDismissed() {
        try { return sessionStorage.getItem('bookshelf_welcome_dismissed') === '1'; } catch (_) { return false; }
    }

    // step1 の「設定済み」は実際に使える状態のときだけ:
    // 一度も保存していなければ未設定。保存済みでも hub は認証キー・github はトークン・
    // local はフォルダハンドル復元まで揃って初めて done (method だけ見ると嘘になる)。
    _computeSyncDone() {
        try {
            const SCM = window.SyncConfigManager;
            if (SCM && SCM.isConfigured()) {
                const cfg = SCM.load();
                if (cfg.method === 'hub') return !!(cfg.hub && cfg.hub.key);
                if (cfg.method === 'github') return !!(cfg.github && cfg.github.token);
                if (cfg.method === 'local') return !!(this.app && this.app.obsidianDirHandle);
            }
        } catch (_) {}
        return false;
    }

    // 静的初期HTML(index.html)・再利用中の既存welcomeノードに対し、step1のdone状態と
    // ボタン文言だけを差し替える (要素自体は残す＝イシュー#265)。
    _updateWelcomeStep1(welcomeEl) {
        const syncDone = this._computeSyncDone();
        const step1 = welcomeEl.querySelector('.dw-steps > .dw-step:nth-child(1)');
        if (!step1) return;
        step1.classList.toggle('is-done', syncDone);
        const num = step1.querySelector('.dw-num');
        if (num) num.innerHTML = syncDone ? window.renderIcon('check', { size: 14 }) : '1';
        const btn = step1.querySelector('button[data-dw="sync"]');
        if (btn) btn.textContent = syncDone ? '設定済み' : '保存先を選ぶ';
    }

    _welcomeHtml() {
        const ico = (n, s = 16) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        const syncDone = this._computeSyncDone();
        const step = (n, done, title, desc, label, primary, act, disabled = false) =>
            `<li class="dw-step${done ? ' is-done' : ''}">
                <span class="dw-num">${done ? window.renderIcon('check', { size: 14 }) : n}</span>
                <div class="dw-body"><strong>${title}</strong><span>${desc}</span></div>
                <button class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-small" data-dw="${act}" type="button"${disabled ? ' disabled' : ''}>${label}</button>
            </li>`;
        // welcome は蔵書 0 のときしか出ないので、step3 (公開) は常に無効。
        // 奥まで進んでから「本がありません」で弾くのではなく、入口で条件を示す。
        return `<div class="dashboard-welcome" id="dashboard-welcome">
            <button class="dw-close" id="dw-close" type="button" title="閉じる">${window.renderIcon('x', { size: 16 })}</button>
            <h3 class="dw-title">${ico('sparkles', 18)}AsayakeBookshelf へようこそ</h3>
            <p class="dw-sub">3 ステップで本棚を作って公開できます。</p>
            <ol class="dw-steps">
                ${step(1, syncDone, '保存先を選ぶ', '本のデータの保存場所（Asayake ハブ／この端末／GitHub）', syncDone ? '設定済み' : '保存先を選ぶ', false, 'sync')}
                ${step(2, false, '本を取り込む', 'Kindle から取り込むか、ASIN を手動で追加', '本を追加・取り込み', true, 'import')}
                ${step(3, false, '公開ページを作る', '本を取り込むと公開できるようになります', '公開を開く', false, 'publish', true)}
            </ol>
        </div>`;
    }

    _bindWelcome() {
        const wel = document.getElementById('dashboard-welcome');
        if (!wel) return;
        const close = document.getElementById('dw-close');
        if (close) close.addEventListener('click', () => {
            try { sessionStorage.setItem('bookshelf_welcome_dismissed', '1'); } catch (_) {}
            wel.remove();
        });
        wel.querySelectorAll('[data-dw]').forEach((b) => {
            b.addEventListener('click', async () => {
                const act = b.getAttribute('data-dw');
                if (act === 'publish') { if (typeof this.app.openPublishPagesModal === 'function') await this.app.openPublishPagesModal(); return; }
                if (act === 'import') { if (typeof this.app.showImportModal === 'function') this.app.showImportModal(); return; }
                // act === 'sync': 設定の同期方式セレクトへ直接ジャンプ (_scrollSettingsTo が details を開く)
                if (typeof this.app._openSettingsModal === 'function') await this.app._openSettingsModal('sync-method-select');
            });
        });
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
                // イシュー#511 X1 W8: Surfaceのdashboard-edit(exit:'edit')に段を積む(hist:'mobile'のまま=
                // スマホだけ段あり)。閉じ手(close)はEsc/戻る/完了のどれでも同じ_exitEditModeを呼ぶ
                this.app._surface().open('dashboard-edit', { close: (o) => this._exitEditMode(o) });
            } else if (e.target.closest('#dashboard-edit-done')) {
                this._exitEditMode();
            } else if (e.target.closest('#dashboard-add-widget')) {
                this._openWidgetPicker();
            }
        }, { signal });

        // イシュー#511 X1 W8: 編集モード中のEscは完了と同じ(他の面が既に処理した時は二重に動かない)
        document.addEventListener('keydown', (e) => {
            if (!this.editMode || e.defaultPrevented) return;
            if (!window.Surface.isEsc(e)) return;
            // イシュー#521 X2: 「選んで置く」の途中なら、Esc はその解除だけ (編集モードは終えない)
            if (this._picking) { this._cancelPicking(); e.preventDefault(); return; }
            this._exitEditMode();
            e.preventDefault();
        }, { signal });

        const grid = document.getElementById('dashboard-grid');
        if (!grid) return;
        // イシュー#521 X2「選んで置く」: つまみを押す → 置きたい部品 (その前に入る)・穴の枠・末尾の追加カードを押す。
        // 選んでいる間は、部品の中のリンクやボタンを動かさない (capture で先に受けて止める)
        grid.addEventListener('click', (e) => {
            const grip = e.target.closest('.widget-grip');
            if (grip) {
                e.preventDefault(); e.stopPropagation();
                const uid = grip.closest('.dashboard-widget')?.dataset.widgetId;
                if (this._picking === uid) this._cancelPicking();
                else this._startPicking(uid);
                return;
            }
            if (!this._picking) return;
            e.preventDefault(); e.stopPropagation();
            const uid = this._picking;
            this._picking = null;
            const holeEl = e.target.closest('.widget-hole');
            const card = e.target.closest('.dashboard-widget');
            if (holeEl) {
                this._moveWidgetToHole(uid, Number(holeEl.dataset.holeIndex), Number(holeEl.dataset.holeWidth)).then(() => this._announceMoved(uid));
            } else if (e.target.closest('#add-widget-card')) {
                this._moveWidgetTo(uid, Infinity);
            } else if (card && card.dataset.widgetId !== uid) {
                this._moveWidgetTo(uid, Number(card.dataset.widgetIndex));
            } else {
                this._cancelPicking();
            }
        }, { signal, capture: true });
        // つまみにフォーカスがある時の ↑↓ (記事のブロックに合わせて Alt+↑↓ も同じ)
        grid.addEventListener('keydown', (e) => {
            const grip = e.target.closest('.widget-grip');
            if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            const card = grip.closest('.dashboard-widget');
            const from = Number(card?.dataset.widgetIndex);
            this._moveWidgetBy(card?.dataset.widgetId, from, e.key === 'ArrowUp' ? -1 : 1);
        }, { signal });
        grid.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('.widget-remove-btn');
            if (removeBtn) {
                e.stopPropagation();
                const card = removeBtn.closest('.dashboard-widget');
                this._removeWidget(card?.dataset.widgetId);
                return;
            }
            // イシュー#521 X2: 穴の枠 → その位置に入る大きさだけの候補。カードの＋ → そのカードの直後へ
            const holeEl = e.target.closest('.widget-hole');
            if (holeEl) {
                this._openWidgetPicker({ insertAt: Number(holeEl.dataset.holeIndex), holeWidth: Number(holeEl.dataset.holeWidth) });
                return;
            }
            const insertBtn = e.target.closest('.widget-insert-btn');
            if (insertBtn) {
                e.stopPropagation();
                const card = insertBtn.closest('.dashboard-widget');
                this._openWidgetPicker({ insertAt: Number(card?.dataset.widgetIndex) + 1 });
                return;
            }
            // dashed 「+ ウィジェット追加」 カード or ツールバーの追加ボタンから picker 起動
            const addCardEl = e.target.closest('#add-widget-card');
            if (addCardEl) {
                this._openWidgetPicker();
            }
        }, { signal });
        grid.addEventListener('change', (e) => {
            const sizeSelect = e.target.closest('.widget-size-select');
            if (sizeSelect) {
                const card = sizeSelect.closest('.dashboard-widget');
                const val = sizeSelect.value;
                // 値が 'half'/'full' ならスマホ大きさ、数値なら PC 列幅
                if (val === 'half' || val === 'full') {
                    this._changeMobileSize(card?.dataset.widgetId, val);
                } else {
                    this._changeSpan(card?.dataset.widgetId, Number(val));
                }
            }
        }, { signal });

        // イシュー#398: ドラッグ並び替え。HTML5 Drag API (dragstart/dragover/drop) はタッチで
        // 発火しない (実測: dragstartCount=0のまま並び順が変わらない)。_bindPointerReorder
        // (#337・本棚ツリー/本棚管理モーダル/プラグイン一覧と同じ部品) に揃える＝「同じ操作は
        // 同じ見た目・同じ挙動」。PCマウスも同じ経路 (handleSelector無し=6px移動で即開始、
        // タッチは450ms長押し=スクロール優先に分岐、他の一覧と同じ判定)。
        // container (grid) は再描画をまたいで使い回すため、bindは初回のみ (_bindPointerReorder
        // 自身の container._pointerReorderBound ガードで2回目以降は no-op)。実際にドラッグを
        // 許可するかは canDrag で都度の this.editMode を見て判定する。
        this.app._bindPointerReorder(grid, {
            itemSelector: '.dashboard-widget',
            // つまみ (button) からはドラッグを始められるようにする (#521 X2・つまみを button にしたため)
            excludeSelector: '.widget-actions, button:not(.widget-grip), select',
            dragClass: 'is-dragging',
            zoneMode: 'index',
            indicatorClass: 'widget-drop-indicator',
            computeInsertIndex: (container, clientX, clientY) => this._computeWidgetInsertIndex(container, clientX, clientY),
            getKey: (el) => el.dataset.widgetId,
            onDrop: (uid, idx) => this._reorderWidgetByIndex(uid, idx),
            // イシュー#521 X2: 穴の枠も落とす先 (U4 の口)。指の下にカードが無い時だけ拾われる
            holeSelector: '.widget-hole',
            onDropHole: (uid, holeEl) => this._moveWidgetToHole(uid, Number(holeEl.dataset.holeIndex), Number(holeEl.dataset.holeWidth)),
            canDrag: () => this.editMode,
            // Home (#dashboard) はページ自体がスクロールする (本棚一覧の.view-bookshelfのような
            // 専用スクロール容器が無い) ため、window をスクロール対象とする薄いアダプタを渡す。
            scrollContainer: () => ({
                getBoundingClientRect: () => ({ top: 0, bottom: window.innerHeight }),
                get scrollTop() { return window.scrollY || document.documentElement.scrollTop; },
                set scrollTop(v) { window.scrollTo(0, v); },
            }),
        });
    }

    // grid (12列CSS grid) 上のドラッグ位置から挿入先インデックスを決める。単純な縦1列ではなく
    // span違いのカードが横に並ぶため、カード矩形内ならそのindex、無ければ中心点が最も近いカードの
    // indexを返す (旧実装の「ドロップ先カードの位置に挿入」を踏襲)。
    _computeWidgetInsertIndex(container, clientX, clientY) {
        const items = Array.from(container.querySelectorAll('.dashboard-widget')).filter(el => !el.classList.contains('is-dragging'));
        let best = items.length, bestDist = Infinity;
        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return i;
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
            if (d < bestDist) { bestDist = d; best = i; }
        }
        return best;
    }

    async _reorderWidgetByIndex(uid, idx) {
        if (!uid) return;
        const layout = this.getLayout();
        const fromIdx = layout.findIndex(w => w.uid === uid);
        if (fromIdx < 0) return;
        const [moved] = layout.splice(fromIdx, 1);
        const insertIdx = Math.max(0, Math.min(idx, layout.length));
        layout.splice(insertIdx, 0, moved);
        await this.saveLayout(layout);
        this.render();
    }

    // イシュー#521 X2: 部品を穴へ移す。holeIndex は「今の並び」での挿入位置なので、前から後ろへ
    // 動かす時は取り出した分を1つ引く。穴より大きい部品は、穴に入る大きさがあればそれに縮める
    // (PC は入る中で最大の大きさ、スマホは半分)。入る大きさが無ければ大きさは変えずに位置だけ移す。
    async _moveWidgetToHole(uid, holeIndex, holeWidth) {
        if (!uid || !Number.isFinite(holeIndex)) return;
        const layout = this.getLayout();
        const fromIdx = layout.findIndex(w => w.uid === uid);
        if (fromIdx < 0) return;
        const [moved] = layout.splice(fromIdx, 1);
        const entry = this._registry[moved.id];
        if (entry && this._colsOf(moved) > holeWidth) {
            const fit = this._sizesFitting(entry, holeWidth);
            if (fit[0] === 'half') moved.spanMobile = 'half';
            else if (fit.length) moved.span = BookshelfDashboard.SIZE_COLS[fit[fit.length - 1]];
        }
        const insertIdx = Math.max(0, Math.min(fromIdx < holeIndex ? holeIndex - 1 : holeIndex, layout.length));
        layout.splice(insertIdx, 0, moved);
        this._lastMovedIndex = insertIdx;
        await this.saveLayout(layout);
        this.render();
    }

    // 編集モードを終える(完了・Esc・戻るの共通の閉じ手・イシュー#511 X1 W8)。配置は都度保存済みのため
    // 確認は無い(確認が要る場面はP10/A-dの対象で、ここには無い)。fromHistory(戻る由来)はSurfaceの段を
    // 既に台帳が外しているので、ここでは段を外す呼び出しをしない(他のexit:'edit'実装と同じ型)
    _exitEditMode(opts = {}) {
        if (!this.editMode) return;
        if (!opts.fromHistory) this.app._surface().close('dashboard-edit', {});
        this.editMode = false;
        this.render();
    }

    // イシュー#521 X2: 外した時は UndoToast で「元に戻す」を出す。押すと元の位置へ、大きさ・設定もそのまま戻す
    // (1段だけ。記事のブロック削除の Undo と同じ考え方)。
    async _removeWidget(uid) {
        if (!uid) return;
        const all = this.getLayout();
        const index = all.findIndex(w => w.uid === uid);
        if (index < 0) return;
        const { uid: _u, ...removed } = all[index];
        const layout = all.filter(w => w.uid !== uid);
        await this.saveLayout(layout);
        this.render();
        const label = this._registry[removed.id]?.label || removed.id;
        this._announce(`「${label}」を外しました。`);
        if (window.UndoToast) {
            window.UndoToast.show(`「${label}」を外しました。`, {
                onUndo: async () => {
                    const cur = this.getLayout();
                    cur.splice(Math.min(index, cur.length), 0, removed);
                    await this.saveLayout(cur);
                    this.render();
                    this._announce(`「${label}」を元に戻しました。`);
                },
            });
        }
    }

    // --- イシュー#521 X2: 「選んで置く」と ↑↓ ---
    _startPicking(uid) {
        if (!uid || !this.editMode) return;
        this._picking = uid;
        this.render();
        const label = this._labelOfUid(uid);
        this._announce(`「${label}」を選びました。置きたい部品か「ここに追加」の枠を押してください。Esc で取り消します。`);
        this._focusGripOf(uid);
    }

    _cancelPicking() {
        const uid = this._picking;
        if (!uid) return;
        this._picking = null;
        this.render();
        this._announce('移動を取り消しました。');
        this._focusGripOf(uid);
    }

    // to = 「今の並び」での目標位置 (その部品の前に入る。Infinity なら末尾)。
    async _moveWidgetTo(uid, to) {
        const layout = this.getLayout();
        const from = layout.findIndex(w => w.uid === uid);
        if (from < 0) return;
        const idx = from < to ? to - 1 : to; // 取り出した分を引く (_reorderWidgetByIndex は取り出した後の位置)
        await this._reorderWidgetByIndex(uid, Math.min(idx, layout.length - 1));
        this._announceMoved(uid, Math.min(idx, layout.length - 1));
    }

    // ↑↓: 1つ前 / 後ろへ。描画し直した後もフォーカスはつまみに残す (uid は id#index なので新しい位置で探す)
    async _moveWidgetBy(uid, from, delta) {
        const layout = this.getLayout();
        if (!uid || !Number.isFinite(from)) return;
        const to = from + delta;
        if (to < 0 || to >= layout.length) {
            this._announce(delta < 0 ? 'これ以上前へは動かせません。' : 'これ以上後ろへは動かせません。');
            return;
        }
        await this._reorderWidgetByIndex(uid, to);
        this._announceMoved(uid, to);
        this._focusGripAt(to);
    }

    _labelOfUid(uid) {
        const id = String(uid || '').split('#')[0];
        return this._registry[id]?.label || id;
    }

    // 移動の後の読み上げ。toIdx を省いた時は、移した部品を並びから探す (穴へ移した時など)
    _announceMoved(uid, toIdx) {
        const layout = this.getLayout();
        const label = this._labelOfUid(uid);
        let n = toIdx;
        if (!Number.isFinite(n)) {
            n = this._lastMovedIndex;
        }
        if (Number.isFinite(n)) this._announce(`「${label}」を ${n + 1} 番目に移動しました（全 ${layout.length} 件）。`);
    }

    _announce(text) {
        const live = document.getElementById('dashboard-live');
        if (!live) return;
        live.textContent = '';
        // 同じ文でも読み上げ直されるよう、空にしてから次のフレームで入れる
        requestAnimationFrame(() => { live.textContent = text; });
    }

    _focusGripOf(uid) {
        document.querySelector(`#dashboard-grid .dashboard-widget[data-widget-id="${CSS.escape(uid)}"] .widget-grip`)?.focus();
    }

    _focusGripAt(index) {
        document.querySelector(`#dashboard-grid .dashboard-widget[data-widget-index="${index}"] .widget-grip`)?.focus();
    }

    async _changeSpan(uid, span) {
        if (!uid) return;
        const layout = this.getLayout();
        const target = layout.find(w => w.uid === uid);
        if (target) target.span = span;
        await this.saveLayout(layout);
        this.render();
    }

    // スマホ専用の大きさ ('half'|'full') を変更。PC の span には影響しない。
    async _changeMobileSize(uid, size) {
        if (!uid || (size !== 'half' && size !== 'full')) return;
        const layout = this.getLayout();
        const target = layout.find(w => w.uid === uid);
        if (target) target.spanMobile = size;
        await this.saveLayout(layout);
        this.render();
    }

    // opts (イシュー#521 X2): insertAt=並びへの挿入位置 (省略=末尾)、holeWidth=穴の幅 (列数。穴の枠から開いた時だけ)。
    // 大きさの欄: 「既定」か、PC は 小/中/大/全幅・スマホは 半分/全幅。穴から開いた時は入らない大きさを選べない。
    _openWidgetPicker(opts = {}) {
        const insertAt = Number.isFinite(opts.insertAt) ? opts.insertAt : null;
        const holeWidth = Number.isFinite(opts.holeWidth) ? opts.holeWidth : null;
        const mobile = this._isMobile();
        // 同一ウィジェットを複数置けるようにするため、全ウィジェットを常に候補にする。
        // 穴から開いた時だけ、穴に入る大きさを持つ部品に絞る
        const candidates = Object.keys(this._registry)
            .filter(id => holeWidth === null || this._sizesFitting(this._registry[id], holeWidth).length > 0);
        const sizeKeys = mobile ? ['half', 'full'] : Object.keys(BookshelfDashboard.SIZE_COLS);
        const sizeLabel = (k) => mobile ? BookshelfDashboard.MOBILE_SIZE_LABEL[k] : BookshelfDashboard.SIZE_LABEL[k];
        const sizeFits = (k) => holeWidth === null || (mobile ? k === 'half' : BookshelfDashboard.SIZE_COLS[k] <= holeWidth);
        // 部品がその大きさを選べるか (スマホの半分/全幅は見出し以外どれでも選べる)
        const entryHas = (entry, k) => mobile ? (k === 'full' || !entry.heading) : (entry.allowedSizes || []).includes(k);
        const initialSize = (holeWidth !== null && mobile) ? 'half' : 'auto';

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
                    <span>${holeWidth !== null ? 'この空きに追加' : 'ウィジェットを追加'}</span>
                    <button type="button" class="widget-picker-close" title="閉じる">${window.renderIcon('x', { size: 16 })}</button>
                </div>
                <div class="widget-picker-sizes" role="radiogroup" aria-label="大きさ">
                    <span class="wps-label">大きさ</span>
                    ${['auto', ...sizeKeys].map(k => `
                        <button type="button" class="wps-btn" role="radio" data-size="${k}" aria-checked="${k === initialSize}"${sizeFits(k) || k === 'auto' ? '' : ' disabled'}>${k === 'auto' ? '既定' : sizeLabel(k)}</button>`).join('')}
                </div>
                <div class="widget-picker-grid">
                    ${candidates.map(id => `
                        <button type="button" class="widget-picker-item" data-wid="${id}">
                            <span class="wpi-icon">${ico(id)}</span>
                            <span class="wpi-label">${BookshelfEscape.escapeHtml(this._registry[id].label)}</span>
                        </button>`).join('')}
                </div>
            </div>`;
        document.body.appendChild(overlay);

        // 重なり管理役 (イシュー#367 step5): 一時的な面として載せる (閉じると DOM ごと消す・履歴に積まない・旧 z-index 1100 は撤去)。
        // 全画面の重ね (inset 0) なので、保存の失敗・未保存の帯が出ている間は帯の下から始める (belowNotice・イシュー#671)
        const close = () => {
            if (!overlay.isConnected) return; // 管理役の onClose 経由と二重に呼ばれても 1 回だけ
            overlay.remove(); document.removeEventListener('keydown', onKey);
            if (window.overlays) window.overlays.close('widget-picker-overlay', { reason: 'button' });
        };
        if (window.overlays) window.overlays.open(overlay, { kind: 'popover', hist: false, showClass: null, size: 'none', belowNotice: true, onClose: () => close() });
        const onKey = (e) => { if (window.Surface.isEsc(e)) close(); };
        document.addEventListener('keydown', onKey);
        overlay.querySelector('.widget-picker-backdrop').addEventListener('click', close);
        overlay.querySelector('.widget-picker-close').addEventListener('click', close);
        // 大きさの欄: 選んだ大きさを持たない部品は隠す (.is-unfit。.widget-picker-item は display:flex
        // なので [hidden] ではなくクラスで隠す＝ui-standards の [hidden] の罠)
        let chosen = initialSize;
        const applySize = () => {
            overlay.querySelectorAll('.wps-btn').forEach(b => b.setAttribute('aria-checked', String(b.dataset.size === chosen)));
            overlay.querySelectorAll('.widget-picker-item').forEach(btn => {
                const entry = this._registry[btn.dataset.wid];
                btn.classList.toggle('is-unfit', chosen !== 'auto' && !entryHas(entry, chosen));
            });
        };
        overlay.querySelectorAll('.wps-btn').forEach(b => b.addEventListener('click', () => {
            if (b.disabled) return;
            chosen = b.dataset.size;
            applySize();
        }));
        applySize();
        overlay.querySelectorAll('.widget-picker-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const newId = btn.dataset.wid;
                const entry = this._registry[newId];
                if (!entry) return;
                const item = { id: newId, span: entry.defaultSpan };
                if (mobile) {
                    if (chosen === 'half' || chosen === 'full') item.spanMobile = chosen;
                } else if (chosen !== 'auto') {
                    item.span = BookshelfDashboard.SIZE_COLS[chosen];
                } else if (holeWidth !== null && item.span > holeWidth) {
                    // 既定のままでは穴に入らない時は、入る中で最大の大きさにする
                    const fit = this._sizesFitting(entry, holeWidth);
                    item.span = BookshelfDashboard.SIZE_COLS[fit[fit.length - 1]];
                }
                const layout = this.getLayout();
                if (insertAt === null) layout.push(item);
                else layout.splice(Math.max(0, Math.min(insertAt, layout.length)), 0, item);
                close();
                this.saveLayout(layout).then(() => this.render());
            });
        });
    }

    // ==================== ウィジェット実装 ====================


    _bigNumber(host, value, sub) {
        host.innerHTML = `
            <div class="widget-big-number">
                <span class="bn-value">${value}</span>
                ${sub ? `<span class="bn-sub">${BookshelfEscape.escapeHtml(sub)}</span>` : ''}
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
            host.innerHTML = `<div class="widget-heading-text">${BookshelfEscape.escapeHtml(text)}</div>`;
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
        // 幅がいくつでも overflow-x:auto で埋まるよう常に溢れる件数を取る (U-8)。
        // 実測ピッチ88px(cell80px+gap8px)基準、xl(span12)・左右ペイン畳み・5120px幅でも埋まる件数
        const limit = (config && config.limit) || 80;
        const sorted = (app.books || [])
            .slice()
            .sort((a, b) => (b.acquiredTime || 0) - (a.acquiredTime || 0))
            .slice(0, limit);
        if (sorted.length === 0) {
            host.innerHTML = '<p style="color:var(--muted);">最近追加された本はありません</p>';
            return;
        }
        const cellOpts = {
            hasCoverImage: (b) => app.bookManager.hasCoverImage(b),
            getProductImageUrl: (b) => app.bookManager.getProductImageUrl(b),
        };
        host.innerHTML = `
            <div class="widget-book-row">
                ${sorted.map(b => BookList.recentCellHtml(b, cellOpts)).join('')}
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
            host.innerHTML = '<p style="color:var(--muted);">蔵書がありません</p>';
            return;
        }
        // 日付ベースの決定論的ランダム (1日同じ本)
        const today = new Date();
        const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
        const pick = books[seed % books.length];
        host.innerHTML = `
            <button type="button" class="widget-today-pick" data-asin="${BookshelfEscape.escapeHtml(pick.asin)}">
                ${app.bookManager.hasCoverImage(pick)
                    ? `<img src="${BookshelfEscape.escapeHtml(app.bookManager.getProductImageUrl(pick))}" alt="" data-cover-fallback="${BookshelfEscape.escapeHtml(pick.title)}">`
                    : `<div class="widget-today-pick-placeholder">${window.renderIcon('book-open', { size: 32 })}</div>`}
                <div class="widget-today-pick-title">${BookshelfEscape.escapeHtml(pick.title)}</div>
                <div class="widget-today-pick-author">${BookshelfEscape.escapeHtml(pick.authors || '')}</div>
            </button>
        `;
        const btn = host.querySelector('[data-asin]');
        btn?.addEventListener('click', () => app.showBookDetail(pick, false));
    }

    _renderBookshelfHighlights(host, app) {
        // 並び順は左ペインツリーと同じ (ALL 先頭 → ルート配列順 → 子孫を深さ優先)。
        // 旧実装はフラット配列順だったため、親子のある本棚でツリーと順序が食い違っていた。
        const ordered = (typeof app._bookshelvesInTreeOrder === 'function')
            ? app._bookshelvesInTreeOrder()
            : (app.userData?.bookshelves || []).slice();
        const hasAll = ordered.some(b => b.isSpecial);
        const showImages = !!app.showImagesInOverview;
        const textOnlyClass = showImages ? '' : 'text-only';
        // イシュー#575: 表紙の本引き用 asin→本 の Map を描画1回につき1回だけ作る (キャッシュしない=
        // 古い値が残らない)。asin 重複時は find と同じく最初の本を残す。
        const bookByAsin = new Map();
        for (const b of (app.books || [])) if (!bookByAsin.has(b.asin)) bookByAsin.set(b.asin, b);
        const cards = [];
        // 実データに特殊本棚(ALL)が無い場合は擬似 ALL を先頭に合成 (本棚ヘッダーと表示を揃える)
        if (!hasAll) {
            const synthAll = { id: 'all', name: '全ての本', isSpecial: true, iconName: 'library', description: '', books: [] };
            cards.push(app._renderBookshelfCard(synthAll, textOnlyClass, bookByAsin));
        }
        if (ordered.length === 0 && cards.length === 0) {
            host.innerHTML = '<p style="color:var(--muted);">本棚がありません。本棚管理から作成してください。</p>';
            return;
        }
        for (const bs of ordered) cards.push(app._renderBookshelfCard(bs, textOnlyClass, bookByAsin));
        host.innerHTML = `<div class="widget-bookshelves-grid" id="widget-bookshelves-grid-host"></div>`;
        const gridHost = host.querySelector('#widget-bookshelves-grid-host');
        gridHost.innerHTML = cards.join('');
        // バインド (既存の _bindBookshelfOverviewEvents を流用)
        if (typeof app._bindBookshelfOverviewEvents === 'function') {
            app._bindBookshelfOverviewEvents(gridHost);
        }
    }

    _renderReadingStats(host, app) {
        // 読書統計 (旧 reading-stats プラグインを既定機能化):
        //   蔵書数 / 年別取得 / 評価分布 / 本棚別 Top5 を 1 ウィジェットに集約。
        const books = app.books || [];
        const notes = app.userData?.notes || {};
        const shelves = (app.userData?.bookshelves || []);

        // 年別取得
        const yearCounts = new Map();
        for (const b of books) {
            const ts = Number(b.acquiredTime);
            if (!Number.isFinite(ts)) continue;
            const y = new Date(ts).getFullYear();
            if (Number.isFinite(y)) yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
        }
        const years = [...yearCounts.entries()].sort((a, b) => a[0] - b[0]);
        const maxYear = years.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

        // 評価分布 (0=未評価)
        const ratings = [0, 0, 0, 0, 0, 0];
        for (const b of books) {
            const r = notes[b.asin]?.rating;
            ratings[(Number.isInteger(r) && r >= 1 && r <= 5) ? r : 0]++;
        }
        const maxRating = Math.max(...ratings) || 1;

        // 本棚別 Top5 (特殊本棚 ALL は除外)
        const shelfTop = shelves.filter(s => !s.isSpecial)
            .map(s => ({ name: s.name, count: (s.books || []).length }))
            .sort((a, b) => b.count - a.count).slice(0, 5);

        const esc = (s) => BookshelfEscape.escapeHtml(s);
        const bar = (w, cls) => `<div class="rs-track"><div class="rs-fill ${cls}" style="width:${w}%"></div></div>`;
        host.innerHTML = `
            <div class="widget-reading-stats">
                <div class="rs-total">蔵書 <strong>${books.length.toLocaleString()}</strong> 冊</div>
                <div class="rs-block">
                    <div class="rs-h">年別取得</div>
                    ${years.length ? years.map(([y, c]) => `
                        <div class="rs-row"><span class="rs-k">${y}</span>${bar((c / maxYear * 100).toFixed(1), 'rs-y')}<span class="rs-v">${c}</span></div>
                    `).join('') : '<div class="rs-empty">取得日データなし</div>'}
                </div>
                <div class="rs-block">
                    <div class="rs-h">評価分布</div>
                    ${[5, 4, 3, 2, 1, 0].map(r => `
                        <div class="rs-row"><span class="rs-k">${r === 0 ? '未評価' : '★' + r}</span>${bar((ratings[r] / maxRating * 100).toFixed(1), 'rs-r')}<span class="rs-v">${ratings[r]}</span></div>
                    `).join('')}
                </div>
                <div class="rs-block">
                    <div class="rs-h">本棚別 Top5</div>
                    ${shelfTop.length ? `<ul class="rs-shelves">${shelfTop.map(s =>
                        `<li><span>${esc(s.name)}</span><strong>${s.count}</strong></li>`).join('')}</ul>`
                        : '<div class="rs-empty">ユーザ本棚なし</div>'}
                </div>
            </div>
        `;
    }

    _renderPinnedMemo(host, app, config) {
        const memoKey = 'bookshelf_pinnedMemo_v1';
        const current = localStorage.getItem(memoKey) || '';
        host.innerHTML = `
            <textarea class="widget-pinned-memo" placeholder="自由メモ (localStorage に保存)...">${BookshelfEscape.escapeHtml(current)}</textarea>
        `;
        const ta = host.querySelector('textarea');
        // イシュー#618: 予約は PendingSave (js/ui/pending-save.js) に置く。保存待ちの間にページを離れたら、その場で
        // 書き切る (localStorage.setItem は同期)。描き直しで textarea が替わっても、同じ key の予約が置き換わるだけ
        ta.addEventListener('input', () => {
            window.PendingSave.schedule('dashboard:pinned-memo', () => {
                try { localStorage.setItem(memoKey, ta.value); } catch (_) {}
            }, 400);
        });
    }
}

window.BookshelfDashboard = BookshelfDashboard;
