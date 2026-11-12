// Virtual Bookshelf - Main JavaScript
// Debug flag system
const DEBUG = false; // Set to false for production

// kindle_bookshelf_exporter 拡張の配布URL。未確定の間は空文字（取込モーダルではリンク非表示・代替文言を表示）
// iOS 完成版「Kindle取込ショートカット」の配布URL。未確定の間は空文字（追加ボタン非表示・代替文言を表示）
const KINDLE_SHORTCUT_URL = '';
// 各レーンの毎回操作に添える操作GIFのURL。空のレーンはスロットを描画しない（空箱を出さない）
const KINDLE_IMPORT_MEDIA = { ios: '', android: '', pc: '' };

// 記事エディタ: メモリ反映は即時のまま、リモートPUTだけこの間隔でデバウンスする (イシュー#142)。
// 編集のたび GitHub へ直接コミットしていた (2秒間隔・履歴が汚れる) のを解消する。
const ART_REMOTE_FLUSH_DEBOUNCE_MS = 10000;
// イシュー#387 (ADR-137): 見た目の好み (表示系設定) は端末ごとに覚える＝localStorage のみに置き、同期先 (private/settings.json) へは書かない。
// それ以外の settings と bookOrder は全端末共通で、キー (本棚) ごとの更新時刻 settings._updatedAt で新しい方を採る。
const DEVICE_SETTING_KEYS = ['sortOrder', 'sortDirection', 'defaultView', 'coverSize', 'booksPerPage', 'paneState', 'memoVisibility', 'starOverlay', 'starVisibility', 'detailSectionOrder', 'hiddenPluginButtons', 'bookMemoOpenWith', 'kindleOpenWith'];
const DEVICE_SETTINGS_STORAGE_KEY = 'virtualBookshelf_deviceSettings';
const ART_LOCAL_DRAFT_PREFIX = 'bookshelf_art_draft_';

// 本の引き出し (900px超) をユーザーが畳んだかどうかの記憶キー (イシュー#168)。
// 900px以下は毎回閉じたボトムシートから始まる設計のため対象外 (_artIsDrawerNarrow 参照)。
const ART_DRAWER_COLLAPSE_KEY = 'bookshelf_art_drawer_collapsed';

// 公開パネルの記事行から自分のハブ本棚トップへの導線 (イシュー#345 C案)。宣伝文言は並行中の
// コンセプト整理イシュー(#344)が未決のため仮置き。確定後はここ1箇所を差し替える
// (js/publish-article-generator.js の CTA_TO_* と対になる定数・ビルド無しのため手動同期)。
const ART_PP_HUB_LINK_TEXT = 'ハブで見る';

// イシュー#268: 見たまま編集の編集状態でキャンバス (iframe) 内へ注入する部品のCSS。
// 生成器の .blk の box-model (margin/padding) は一切変えない＝outline と absolute/行の追加だけ。
// 色は記事の配色トークン (--acc/--line/--sub) を使い、どの配色12案の上でも馴染ませる。
const ART_CANVAS_CHROME_CSS = `
.art-cv-blk{position:relative;outline:1.5px dashed var(--acc);outline-offset:4px;border-radius:6px;padding-top:26px}
.art-cv-ops{position:absolute;top:-14px;right:4px;z-index:10}
.art-cv-grip{position:absolute;top:-32px;left:4px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--sub);cursor:grab;padding:0;touch-action:none;z-index:10}
.art-cv-grip:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
.art-cv-dragging{opacity:.45}
body.art-cv-pc .art-cv-ops{top:-32px}
.art-cv-dropline{position:absolute;height:2px;background:var(--acc);border-radius:1px;pointer-events:none;z-index:20}
/* イシュー#288(ハヘロ2026-10-19 03:51決裁): 種別アイコン+文言+⋯を1つの不透明ピルに統合。
   枠の上辺の線上(つまみと同じ型・負のtopで枠の外側)、つまみ(左)とは左右反対側。タップ領域は縦28px+外側8pxの::afterで44px以上。 */
.art-cv-more{position:relative;display:inline-flex;align-items:center;gap:4px;height:28px;min-height:28px;padding:0 10px;border-radius:999px;background:var(--bg);border:1px solid var(--line);color:var(--fg2);cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;box-sizing:border-box}
.art-cv-more svg{width:14px;height:14px;flex:0 0 auto}
.art-cv-more::after{content:'';position:absolute;inset:-8px}
.art-cv-ins{min-height:44px;display:flex;align-items:center;justify-content:center;margin:0 0 8px}
.art-cv-ins-btn{min-height:44px;min-width:44px;padding:0 16px;border-radius:999px;border:1.5px solid var(--acc);background:var(--bg);color:var(--acc);display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font-size:13px;font-weight:700}
/* イシュー#442 07項目(②承認済み採用): 「ここに追加」はホバー/フォーカス時だけ表示(常時点線を解消)。
   既存の.book-item:hover .drag-handleと同型。ホバー不可(タッチ)端末は従来どおり常時表示のまま(安全側)。 */
@media (hover:hover) and (pointer:fine){
.art-cv-ins-btn{opacity:0;transition:opacity .12s}
.art-cv-ins:hover .art-cv-ins-btn,.art-cv-ins:focus-within .art-cv-ins-btn{opacity:1}
}
.art-cv-empty{min-height:64px;padding-top:26px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;box-sizing:border-box}
.art-cv-empty-guide{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:38px;border:none;background:transparent;color:var(--sub);font:inherit;font-size:13px;cursor:pointer;padding:8px;text-align:center}
.art-cv-empty-guide:hover{color:var(--acc)}
.art-cv-empty-editing{display:block}
.art-cv-ta{display:block;width:100%;min-height:120px;font:inherit;font-size:16px;line-height:1.9;color:var(--txt);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px 10px;resize:none;overflow:hidden}
.art-cv-ta:focus{outline:2px solid var(--acc);outline-offset:1px}
.article>h1{cursor:text}
.article>h1.art-cv-h1-ph::before{content:attr(data-ph);color:var(--sub)}
.art-cv-title{display:block;width:100%;font:inherit;font-size:34px;line-height:1.28;font-weight:700;color:var(--txt);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 8px;margin:0 0 12px}
`;

// 記事プレビューのストール検知 (イシュー#143・#153)。build() が失敗も成功もせず無期限に pending
// した場合、「生成中…」が永久に残ってしまう。二段構え: (1) 進捗 (長文メモの読込完了) が一定時間
// まったく進まないことで発火する検知＝10冊×遅い回線のような正常系(遅いだけ)を誤ってストール扱い
// しない。(2) それとは独立に、ビルド開始からの絶対経過時間で必ず発火する検知＝onProgressが
// stallMs未満の間隔で呼ばれ続ける限り(1)が永久にリセットされてしまう欠陥(イシュー#153実測)を
// 構造的に塞ぐ。テストから注入できるよう VirtualBookshelf インスタンスの
// _artPreviewStallMs を優先し、無ければこの既定値を使う。
const ART_PREVIEW_STALL_MS = 20000; // 20秒: 目安値 (issue依頼のとおり)

// (2)の全体上限は(1)と別値にする(イシュー#153差し戻し対応)。同じ値だと「遅いだけの正常系を
// 誤検知しない」という(1)の設計意図と矛盾する(20秒で(2)が必ず発火し、10冊×遅い回線のような
// 正常系でもストール表示に落ちてしまう)。実測(Playwright, 直列読込のため理論値と一致):
// 10冊×500ms/冊=5013ms、50冊(「まとめて追加」のconfirm閾値, js/bookshelf.js:9083)×2000ms/冊
// (ADR-081実測の通常応答上限)=100018ms。実運用最悪ケースの100秒を上回る値として stallMs の
// 5倍(100秒)を採用する。テストから注入できるよう _artPreviewHardDeadlineMs を優先する。
const ART_PREVIEW_HARD_DEADLINE_MS = ART_PREVIEW_STALL_MS * 5; // 100秒

// イシュー#163: timer-lag-summary(build完了時点の集計)からconsole.warnを出すかどうかの閾値。
// generator側の個別記録閾値(250ms、ART_TIMER_LAG_EVENT_MS)は「trace肥大抑制」用の細かい粒度で、
// 重い記事では次ブロックの同期処理時間が乗るだけで健全時でも超えうる(実測で確認済み)。ここは
// 「人間に警告する」ための粗い粒度＝pending(build完了時点で未発火)が残るか、桁が秒単位に達した
// 場合だけに絞り、健全時の誤警告(診断ノイズ)を避ける。テストから注入できるよう
// _artTimerLagWarnMs を優先する(既存の stallMs/hardDeadlineMs と同じ作法)。
const ART_TIMER_LAG_WARN_MS = 5000;

// build()のonProgressが伝える段階 (イシュー#153: 「生成中…」に段階名を出し、本人が1回試すだけで
// どこで時間が掛かっているか分かるようにする)。
// イシュー#156: #153時点は stage (reading/rendering/assembling) のみだった解像度を上げ、
// build-entered(_artRunPreviewBuild到達)・dom(DOM反映完了)・各stageのphase(fetch-start/headers/
// body-done・block-start/block-done)まで文言に出す。フィールドが無い呼び出し(古いテスト等)でも
// 従来どおりの大枠文言にフォールバックする (後方互換)。
const ART_PREVIEW_STAGE_LABEL = (progress) => {
    if (!progress) return '';
    if (progress.stage === 'build-entered') return '生成準備中・';
    if (progress.stage === 'reading') {
        const base = progress.total > 0 ? `長文メモ ${progress.done}/${progress.total} 読込中` : '長文メモ読込中';
        if (progress.phase === 'fetch-start') return `${base}（${progress.adapterKind || ''}へ問合せ中）・`;
        if (progress.phase === 'headers') return `${base}（応答ヘッダ受信・本文待ち）・`;
        if (progress.phase === 'body-done') return `${base}（本文受信完了）・`;
        return `${base}・`;
    }
    if (progress.stage === 'rendering') {
        // イシュー#161: block-start/block-done が同一文言だったため、実機報告「ブロック3: shelf」が
        // どちらの段階か区別できなかった(停止位置の曖昧さの根本原因)。文言を分け、shelf内部の
        // sub-phase・yield待ち区間も出す(コンソール・タイマー非依存＝同期的な文言生成のみ)。
        const blk = `ブロック${(progress.blockIndex ?? 0) + 1}: ${progress.blockType || ''}`;
        if (progress.phase === 'helpers-start') return 'ヘルパー準備中・';
        if (progress.phase === 'helpers-ready') return 'ヘルパー準備完了・';
        if (progress.phase === 'block-start') return `Markdown変換開始（${blk}）・`;
        if (progress.phase === 'shelf-items-start') return `本棚内訳生成中（${blk}・0/${progress.itemsTotal ?? 0}冊）・`;
        if (progress.phase === 'shelf-item-done') return `本棚内訳生成中（${blk}・${(progress.itemIndex ?? 0) + 1}/${progress.itemsTotal ?? 0}冊完了）・`;
        if (progress.phase === 'shelf-assemble-done') return `本棚ブロック結合完了（${blk}）・`;
        if (progress.phase === 'block-done') return `Markdown変換完了（${blk}・次段階へ移行待ち）・`;
        if (progress.phase === 'yield-start') return `次ブロックへ移行待ち（${blk}）・`;
        if (progress.phase === 'yield-done') return `次ブロックへ移行完了（${blk}・復帰経路:${progress.resumedBy || '不明'}）・`;
        return 'Markdown変換中・';
    }
    if (progress.stage === 'assembling') return 'ページ組立中・';
    if (progress.stage === 'dom') return '画面反映中・';
    return '';
};
// unit テストから直接検証できるよう公開 (イシュー#156・純粋関数として window に出す制約は
// extractAppVersionFromHtml と同様、tests/unit/*.test.js が import する ESM 評価では
// トップレベル const がグローバルスコープへ出ないため)。
if (typeof window !== 'undefined') window.ART_PREVIEW_STAGE_LABEL = ART_PREVIEW_STAGE_LABEL;

// アプリ本体の新バージョン検知 (イシュー#143・仮説a-1対策)。
// SW の updatefound は「load 時に reg.update() を1回呼ぶ」だけで、開きっぱなしのタブに新しい
// ?v= が届く経路が無かった (SW 自身のバイトが変わらない限り updatefound は発火しない)。
// index.html を no-store で取り直し、埋め込まれた js/bookshelf.js の ?v= を現在ロード中の値と
// 比較することで、SW の更新有無に依存せず検知する。E2E 環境で SW が動かなくても検証できる。
const APP_VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5分: 更新頻度に対して十分短く、負荷にならない値

// html 文字列からアプリのバージョン識別子 (js/bookshelf.js の ?v= 値) を取り出す。無ければ null。
function extractAppVersionFromHtml(html) {
    const m = /js\/bookshelf\.js\?v=([\w.-]+)/.exec(html || '');
    return m ? m[1] : null;
}
// unit テストから直接検証できるよう公開 (VirtualBookshelf 自体は DOM 依存が強く import 経由では
// インスタンス化しないため、検知ロジックはこの純粋関数側に切り出してテスト対象にする)。
if (typeof window !== 'undefined') window.extractAppVersionFromHtml = extractAppVersionFromHtml;

// --- Obsidian Folder Sync: IndexedDB helpers ---
function openSyncDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('bookshelf-sync', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('config');
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function getStoredDirHandle() {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('config', 'readonly');
        const req = tx.objectStore('config').get('obsidianDirHandle');
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror = e => reject(e.target.error);
    });
}

async function storeDirHandle(handle) {
    const db = await openSyncDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('config', 'readwrite');
        tx.objectStore('config').put(handle, 'obsidianDirHandle');
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
    });
}
// --- end IndexedDB helpers ---

function debugLog(...args) {
    if (DEBUG) {
        console.log('[BookShelf Debug]', ...args);
    }
}

function debugError(...args) {
    if (DEBUG) {
        console.error('[BookShelf Error]', ...args);
    }
}

class VirtualBookshelf {
    constructor() {
        this.books = [];
        this.userData = null;
        this.filteredBooks = [];
        this.currentView = 'covers';
        this.currentPage = 1;
        this.booksPerPage = 50;
        this.sortOrder = 'custom';
        this.sortDirection = 'desc';
        // 評価でしぼり込み (案A 連結セグメント)。Set に入れた評価値(0=未評価,1..5)だけ表示。
        // 空 = 絞り込みなし(全部表示)。セッション中のみ保持 (永続化しない)。
        this.ratingFilter = new Set();
        // Kindle区分でしぼり込み (イシュー#41)。'purchase'/'kuprime'/'revoked' を Set に入れた区分だけ表示。
        // 空 = 絞り込みなし(全部表示)。ratingFilter と同じくセッション中のみ保持 (永続化しない)。
        this.kindleFilter = new Set();
        // 同期方式に応じた storage 構築 (LocalFS / GitHub / ...)
        this.syncConfig = SyncConfigManager.load();
        let initialAdapter = SyncConfigManager.buildAdapter(this.syncConfig);
        // GitHub/ハブ設定が不完全 (未ログイン等) なフォールバック。元は何に繋ごうとしていたかを記録し、
        // 「保存先が未設定です」を出す場面で状況に合った文言 (例:「ハブにログインしていません」) に出し分ける。
        this._syncFallbackFrom = null;
        if (!initialAdapter) {
            this._syncFallbackFrom = this.syncConfig.method;
            this.syncConfig = { ...this.syncConfig, method: 'local' };
            initialAdapter = new LocalFSAdapter();
        }
        this.syncMethod = this.syncConfig.method;
        this.storage = new BookshelfStorage(initialAdapter);
        // 409 リトライの発火をステータス表示へ伝える (GitHubAdapter のみ持つ, イシュー#142)
        if (this.storage.adapter) {
            this.storage.adapter.onWriteStatus = (path, status) => this._handleAdapterWriteStatus(path, status);
        }
        this.bookshelfManager = new BookshelfManager(this);
        // 公開システム (公開v2「記事」モデル, ADR-058 §11): 本棚を素材にした記事の定義 + 生成
        if (window.PublishArticleStore) this.publishArticleStore = new PublishArticleStore(this.storage);
        if (window.PublishArticleGenerator) this.publishArticleGenerator = new PublishArticleGenerator(this);
        this.exporter = new BookshelfExporter(this);
        // プラグインAPI とローダを早期に生成（plugins から window.bookshelfAPI を参照可能に）
        if (window.BookshelfPluginAPI) {
            window.bookshelfAPI = new BookshelfPluginAPI(this);
            this.pluginAPI = window.bookshelfAPI;
        }
        if (window.BookshelfPluginLoader) {
            this.pluginLoader = new BookshelfPluginLoader(this);
        }
        if (window.BookshelfRouter) {
            this.router = new BookshelfRouter();
            this._suppressRouterUpdate = false;
        }
        // イシュー#359: 「今どこか」の台帳 NavState (js/nav-state.js) が履歴 (pushState/replaceState/go) の唯一の
        // 書き手・popstate の唯一の聞き手になる。各書き手 (_modalHistPush/Pop・showBookDetail・closeModal・router._setHash 等)
        // は先頭で this.nav に委譲する (イシュー#407で旧方式・kill-switchを物理撤去。NavState が読めない時は旧経路へ
        // フォールバックせずエラーを出す)。
        if (window.NavState && typeof window.NavState.createNav === 'function') {
            this.nav = window.NavState.createNav(this, {
                isMobile: () => this._navMobile(), // イシュー#513 S6: 段を積む判定はここ(1関数)に集約
                reopeners: (id, extra, snap) => this._navReopen(id, extra, snap),
                onLanded: (snap, m) => this._navOnLanded(snap, m),
                // イシュー#513 S6: boot()がreload時に開き直してよい面をSurfaceのdefine(reloadReopen)
                // をたどって判定する(個別のif文をboot()に増やさない・1つの規則)
                canReloadReopen: (id) => { const def = this._surface().get(id); return !!(def && def.reloadReopen); },
            });
            this.nav.isMobile = () => this._navMobile();
            // 本詳細の段の閉じ方 (戻る由来はアニメ無し=ADR-125)
            this.nav.closers['book-detail'] = (o) => { if (o && o.fromHistory) this._histNoAnimOnce(document.getElementById('app-detail')); this._closeBookModalDom(); return true; };
            if (this.router) {
                this.router._nav = this.nav;
                this.router._shelfIdResolver = (slug) => { const bs = this.bookshelfManager?.getBySlug?.(slug); return bs ? (bs.internalId || bs.id) : undefined; };
            }
        } else {
            console.error('[bookshelf] NavState (js/nav-state.js) が読み込めません。画面遷移・履歴が機能しません。');
        }
        // イシュー#359 段階②: NavState を影モードで並走。既存の書き手をラップして入力を流し、遷移ごとに実状態と突き合わせて
        // ずれを window.__navShadow.diffs に積むだけ (画面・履歴は変えない)。段階③では nav 自身の自己検査になる。
        // E2E (navigator.webdriver) か localStorage.navShadow==='1' の時だけ有効。
        // 影の popstate リスナーを nav より先に登録する (着地の URL を先に影へ入れないと、nav が段を閉じた瞬間の突合で route が古く見える)
        if (window.NavState) window.NavState.install(this);
        if (this.nav) {
            this.nav.start(window); // 唯一の聞き手 (popstate)
            // イシュー#359 段階⑤ (H8): bfcache から復帰した時 (pageshow persisted) は JS の台帳がそのまま、履歴エントリの写しは
            // ブラウザが復元する。両者を突き合わせ、着地と同じ手順 (閉じる→開き直す→route/book) で写しを採用する。同じなら何もしない
            window.addEventListener('pageshow', (ev) => { if (ev && ev.persisted) this.nav.onPopstate({ state: history.state }); });
        }
        // 公開は静的 SSG (公開ページ生成) へ移行済み (ADR-030)。
        // 旧 ?u= 公開閲覧モードは廃止。アプリは編集モード単一になった。

        // モバイル案内バナー（showDirectoryPicker 非対応端末で表示）
        this._setupMobileBanner();

        this.init();
    }

    /**
     * モバイル端末向けセットアップ案内バナー
     * iOS/Android のブラウザは showDirectoryPicker 非対応 → ローカル保存が使えない。
     * 配布方針 (iOS=PWA + クラウド同期, CLAUDE.md) に沿って、ローカル前提の旧案内を廃し
     * 「保存先 (GitHub / Asayake ハブ) を決める」+ iOS は「ホーム画面に追加」へ誘導する。
     * 表示条件: モバイル かつ showDirectoryPicker 非対応。ただし standalone 起動済み かつ
     * クラウド同期設定済み なら案内不要 (= 完了済み)。出すことが無ければ何も表示しない。
     */
    _setupMobileBanner() {
        try {
            const ua = navigator.userAgent || '';
            const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
            const isAndroid = /Android/.test(ua);
            const hasDirPicker = 'showDirectoryPicker' in window;

            if (!isIOS && !isAndroid) return; // PC は何もしない
            if (hasDirPicker) return; // showDirectoryPicker が生えている環境 (iOS の File Picker 拡張など)

            // ホーム画面アプリ (standalone) として起動済みか
            const standalone = (window.navigator.standalone === true) ||
                !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
            // GitHub / ハブ のクラウド同期を設定済みか (ローカルのままは未設定扱い)。
            // 生の永続値でなく実効 method (this.syncConfig.method = adapter 構築失敗時は
            // コンストラクタで 'local' にフォールバック済み) を見る。
            // = 「クラウドを選んだが設定不完全」を未同期扱いにし、復旧案内を出す。
            let method = 'local';
            try { method = (this.syncConfig && this.syncConfig.method) || (SyncConfigManager.load().method) || 'local'; } catch (_) {}
            const synced = method !== 'local';

            // 案内する内容を組み立てる。両方とも満たされていれば何も出さない。
            const lines = [];
            if (!synced) {
                lines.push('この端末ではブラウザのフォルダ保存が使えません。<strong>GitHub</strong> か <strong>Asayake ハブ</strong>（Google ログインだけ）での保存に切り替えてください。');
            }
            if (isIOS && !standalone) {
                lines.push('Safari の共有メニューから <strong>「ホーム画面に追加」</strong> でアプリのように使えます。');
            }
            if (lines.length === 0) return; // standalone かつ同期済み → 案内不要

            const dismissedKey = 'bookshelf_mobileBanner_dismissed';
            if (localStorage.getItem(dismissedKey) === '1') return;

            const banner = document.getElementById('mobile-setup-banner');
            const msg = document.getElementById('mobile-setup-banner-msg');
            const actions = document.getElementById('mobile-setup-banner-actions');
            const closeBtn = document.getElementById('mobile-setup-banner-close');
            if (!banner || !msg || !actions) return;

            msg.innerHTML = lines.join('<br>');
            actions.innerHTML = '';

            // 保存先未設定なら設定モーダルの同期節へ直行 (外部 App Store/APK 誘導は廃止。
            // ローカル保存は PC の Chrome/Edge 限定・Android ネイティブ配布も廃止のため、
            // モバイルの保存先は GitHub / Asayake ハブの 2 択に一本化)
            if (!synced) {
                const setupBtn = document.createElement('button');
                setupBtn.type = 'button';
                setupBtn.textContent = '保存先を設定する';
                setupBtn.addEventListener('click', () => {
                    this._openSettingsModal('sync-method-select');
                });
                actions.appendChild(setupBtn);
            }

            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    banner.style.display = 'none';
                    localStorage.setItem(dismissedKey, '1');
                });
            }

            banner.style.display = 'block';
        } catch (e) {
            console.warn('mobile banner setup failed:', e);
        }
    }

    async init() {
        try {
            await this.loadData();
            this.setupEventListeners();
            this._initHeaderTemplates();
            this._applyHeaderLayout();
            if (typeof window.applyIcons === 'function') window.applyIcons();
            this.updateBookshelfSelector();
            this.updateSortDirectionButton();
            // ホームをダッシュボードに置換 (renderBookshelfOverview は本棚ハイライトウィジェット内で呼ばれる)
            if (typeof window.BookshelfDashboard === 'function') {
                this.dashboard = new window.BookshelfDashboard(this);
                this.dashboard.render();
            }
            this.updateDisplay();
            this.updateStats();
            // ===== PC v2 レイアウト初期化 =====
            this._initPaneControls();
            this._renderSidebarTree();


            // 同期 (LocalFS / GitHub / Asayake ハブ) は下の finishStartup へ (起動2段化, C-277)
            // ページ離脱前に同期未完了分を localStorage に確定（async は保証されないので可能な範囲）
            // 重要な同期は flushSync() を明示的に呼ぶ運用とする
            const flushOnLeave = () => {
                if (this._syncDebounceTimer) {
                    clearTimeout(this._syncDebounceTimer);
                    this._syncDebounceTimer = null;
                    // 同期的に発火（await は出来ないので最小限）
                    this._runPendingSync();
                }
            };
            window.addEventListener('beforeunload', flushOnLeave);
            // イシュー#359 段階⑤ (H8): bfcache に入る時は beforeunload が来ない経路があるため pagehide でも同じ flush をする。
            // beforeunload 自体は Chrome/Safari では bfcache を妨げない (妨げるのは unload。Firefox のみ beforeunload も対象)
            window.addEventListener('pagehide', flushOnLeave);
            // ページ非表示時にも flush（モバイル等）
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden' && this._pendingSync) {
                    if (this._syncDebounceTimer) {
                        clearTimeout(this._syncDebounceTimer);
                        this._syncDebounceTimer = null;
                    }
                    this._runPendingSync();
                }
                // 記事エディタ: 保留中のリモートフラッシュがあればタブ非表示時に即実行 (イシュー#142)
                if (document.visibilityState === 'hidden' && this._artRemoteFlushTimer) {
                    this._artFlushRemoteNow();
                }
            });

            // 公開エクスポート先 handle の復元は廃止 (出力先は同期先 public/ に統合)

            // 後段: 同期 (ネットワーク) → プラグイン。届いた差分は initSync 内の再描画で反映される
            const finishStartup = async () => {
                try {
                    await this.initSync();
                } catch (e) {
                    // initSync 内で拾えなかった想定外エラー。裏実行時も全画面エラーにはせず帯で知らせる
                    console.error('initSync:', e);
                    this._syncError = true;
                    if (!this._syncErrorMsg) this._syncErrorMsg = '同期の初期化に失敗しました。設定から接続を確認してください。';
                    this._updateStatusBar();
                }
                // 公開v2「記事」モデルへの初回移行 (非破壊・冪等・ADR-058 §11)。同期フォルダ接続済みのタイミングで
                // 旧 pages.json → articles.json を機械変換する (articles.json に既に記事があれば何もしない)。
                if (this.publishArticleStore && this._isSyncReady()) {
                    try {
                        await this.publishArticleStore.migrateFromLegacyIfNeeded((shelfKey) => {
                            const shelf = this.bookshelfManager.getById(shelfKey);
                            return (shelf && shelf.books) || [];
                        });
                    } catch (e) {
                        console.warn('公開記事モデルへの移行に失敗:', e);
                    }
                }
                // プラグイン読み込み（同期フォルダ接続済み + 設定読み込み済みのタイミング）
                if (this.pluginLoader) {
                    try {
                        this._setLoadingSub('プラグインを読み込み中…');
                        // 標準機能5個の初回シード・欠損復元 (ADR-059)。読み込み前に済ませ、同じ起動サイクルで反映する
                        if (this._isSyncReady()) {
                            await this.pluginLoader.ensureStandardPlugins();
                        }
                        // 進捗をローディング表示に反映 (並列読み込み後、activate ごとに n/total)
                        this.pluginLoader.onProgress = (done, total) => {
                            if (total > 0) this._setLoadingSub(`プラグインを読み込み中… (${done}/${total})`);
                        };
                        await this.pluginLoader.loadEnabledPlugins();
                    } catch (e) {
                        console.warn('プラグイン読み込み中にエラー:', e);
                    } finally {
                        this.pluginLoader.onProgress = null;
                    }
                }
            };
            const startRouter = () => {
                if (this.router) {
                    this.router.onChange((route) => this._applyRoute(route));
                    this.router.start();
                }
            };

            // ===== 起動の2段化 (C-277) =====
            // この端末にデータがあるなら、ローカル描画が済んだ時点で即操作可能にする。
            // 同期とプラグインは裏で続け、確認中は細い帯だけ出す (全画面スピナーで待たせない)。
            // データが無い端末 (初回起動・新端末での再ログイン) だけは、空の本棚や welcome を
            // 一瞬見せないよう従来どおり同期完了までローディングを出す。
            if (this._hasLocalUserData) {
                startRouter();
                this.hideLoading();
                const checking = (this.syncMethod === 'hub' || this.syncMethod === 'github') && this._isSyncReady();
                if (checking) { this._syncChecking = true; this._updateStatusBar(); }
                finishStartup().finally(() => {
                    if (checking) { this._syncChecking = false; this._updateStatusBar(); }
                });
            } else {
                await finishStartup();
                startRouter();
                this.hideLoading();
            }
        } catch (error) {
            console.error('初期化エラー:', error);
            this.showError('データの読み込みに失敗しました。');
            this.hideLoading();
        }
    }

    async loadData() {
        // Initialize BookManager
        this.bookManager = new BookManager();
        await this.bookManager.initialize();

        // Get books from BookManager instead of direct kindle.json
        this.books = this.bookManager.getAllBooks();
        
        // Load config data
        let config = {};
        try {
            const configResponse = await fetch('data/config.json');
            config = await configResponse.json();
        } catch (error) {
            console.error('Failed to load config.json:', error);
            throw new Error('設定ファイルの読み込みに失敗しました');
        }
        
        // Check localStorage first for user data
        const savedUserData = localStorage.getItem('virtualBookshelf_userData');
        // 起動2段化 (C-277) の分岐材料: この端末に描画できるデータがあるか
        this._hasLocalUserData = !!savedUserData;

        if (savedUserData) {
            // Use localStorage data as primary source
            this.userData = JSON.parse(savedUserData);
        } else {
            // ローカル保存が無ければ既定値 (サーバー側サンプルの自動読込はしない: ADR-053)
            this.userData = this.createDefaultUserData();
        }

        // config は「未設定項目の既定値」。ユーザーが保存した設定を上書きしてはいけない
        // (旧: config が後勝ちで、表示形式などが再読み込みのたび既定に戻っていた)
        this.userData.settings = { ...config, ...this.userData.settings };
        // 端末ごとの見た目の好みを重ねる。初回 (端末側にまだ無い) は共通設定にあった値を写して好みを消さない (イシュー#387)
        this.userData.settings = { ...this.userData.settings, ...this._loadDeviceSettings(this.userData.settings) };
        this._snapshotSyncedState();
        
        this.currentView = this.userData.settings.defaultView || 'covers';

        // 並び順の復元 (D-2)。保存値が不正なら既定 (custom/desc) に落とす
        const savedSort = this.userData.settings.sortOrder;
        if (['custom', 'acquiredTime', 'title', 'authors'].includes(savedSort)) {
            this.sortOrder = savedSort;
            const sortSel = document.getElementById('sort-order');
            if (sortSel) sortSel.value = savedSort;
        }
        if (['asc', 'desc'].includes(this.userData.settings.sortDirection)) {
            this.sortDirection = this.userData.settings.sortDirection;
        }

        // Load cover size setting
        const coverSize = this.userData.settings.coverSize || 'medium';
        document.getElementById('cover-size').value = coverSize;

        // 取り得る値は covers / images / list (旧 hybrid 等は covers へ)
        if (!['covers', 'images', 'list'].includes(this.currentView)) {
            this.currentView = 'covers';
        }
        // 初回描画時点の「大きさ」選択肢の列数表示 (イシュー#389)
        this._updateCoverSizeOptionLabels();

        // Phase H2-5: ページネーション廃止につき booksPerPage 設定は読み込まない (全件表示)
        // 常に表示 (変更 UI のない遺産設定。古い保存値 false が残っていても無視する — 2026-07-28)
        this.showImagesInOverview = true;

        this.applyFilters();
    }

    setupEventListeners() {
        this._setupCoverFallback();
        // 表示形式セグメント (表紙/画像/リスト)。popover は閉じない (連続で試せる)
        const viewSeg = document.getElementById('view-seg');
        if (viewSeg) {
            viewSeg.addEventListener('click', (e) => {
                const cell = e.target.closest('.rseg');
                if (!cell || !cell.dataset.view) return;
                this.setView(cell.dataset.view);
                this._showSavedNote('view', viewSeg);
            });
        }

        // サイドバー「本棚を追加」(Phase G)
        const sidebarAddBtn = document.getElementById('sidebar-add-bookshelf');
        if (sidebarAddBtn) {
            sidebarAddBtn.addEventListener('click', () => this.showBookshelfForm());
        }

        // Search (popover 内の input)
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.search(e.target.value);
        });

        // 評価でしぼり込み (連結セグメント): タップした評価だけ表示 / 無選択=全部。
        const ratingSeg = document.getElementById('rating-seg');
        if (ratingSeg) {
            ratingSeg.addEventListener('click', (e) => {
                const cell = e.target.closest('.rseg');
                if (!cell) return;
                const r = Number(cell.dataset.rating);
                if (this.ratingFilter.has(r)) this.ratingFilter.delete(r);
                else this.ratingFilter.add(r);
                this._updateRatingFilterUI();
                this.applyFilters();
            });
        }
        const ratingReset = document.getElementById('rating-filter-reset');
        if (ratingReset) {
            ratingReset.addEventListener('click', () => {
                this.ratingFilter.clear();
                this._updateRatingFilterUI();
                this.applyFilters();
            });
        }
        this._updateRatingFilterUI();

        // Kindle区分でしぼり込み (連結セグメント): 評価と同じ複数選択パターン (イシュー#41)
        const kindleSeg = document.getElementById('kindle-seg');
        if (kindleSeg) {
            kindleSeg.addEventListener('click', (e) => {
                const cell = e.target.closest('.rseg');
                if (!cell) return;
                const k = cell.dataset.kindle;
                if (this.kindleFilter.has(k)) this.kindleFilter.delete(k);
                else this.kindleFilter.add(k);
                this._updateKindleFilterUI();
                this.applyFilters();
            });
        }
        const kindleReset = document.getElementById('kindle-filter-reset');
        if (kindleReset) {
            kindleReset.addEventListener('click', () => {
                this.kindleFilter.clear();
                this._updateKindleFilterUI();
                this.applyFilters();
            });
        }
        this._updateKindleFilterUI();

        // Sort
        document.getElementById('sort-order').addEventListener('change', (e) => {
            this.sortOrder = e.target.value;
            this.updateSortDirectionButton();
            this.applySorting();
            this._updateBulkBar(); // 「先頭に移動」ボタンの表示可否を更新
            this._saveSortPrefs();
        });

        document.getElementById('sort-direction').addEventListener('click', () => {
            this.toggleSortDirection();
        });

        // Phase H2-5: 「表示数」は廃止 (全件表示)

        // Cover size
        document.getElementById('cover-size').addEventListener('change', (e) => {
            this.setCoverSize(e.target.value);
            this._showSavedNote('cover', e.target);
        });

        // Export button
        document.getElementById('export-unified').addEventListener('click', () => {
            this.exportUnifiedData();
        });

        // Obsidian folder sync button: 「変更」は常にフォルダピッカーを開く（同期先を切替/再選択）
        const obsidianSyncBtn = document.getElementById('obsidian-sync-btn');
        if (obsidianSyncBtn) {
            obsidianSyncBtn.addEventListener('click', () => this.selectObsidianFolder());
        }

        // 同期方式選択 UI (LocalFS / GitHub / ...)
        this._setupSyncMethodUI();

        // #header-controls は有効プラグインの UI ボタンの受け皿 (_applyHeaderLayout が描画)。
        // 本棚管理は撤去 (⌘K から到達)、設定は下部フッターへ移設したため、組込ボタンの
        // delegation は不要 (ADR-047 P1)。プラグインボタンのクリックは _buildPlacementElement で
        // 各ボタンに直接配線される。

        // 全 popover の共通制御 (toggle ボタン押下 / 外側クリック / Esc)
        this._setupPopovers();

        // ⌘K コマンドパレット (Phase D)
        this._setupCommandPalette();

        // 複数選択モード + 一括操作 (Phase E)
        this._setupSelectMode();

        const closeSettings = document.getElementById('settings-modal-close');
        if (closeSettings) {
            closeSettings.addEventListener('click', () => this._closeSettingsModal());
        }
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                if (window.Surface.isBackdrop(e, settingsModal)) this._closeSettingsModal();
            });
        }
        // フッターの「閉じる」(#settings-modal-done) は ADR-047 P2 で廃止 (× と同機能の二重を解消)。

        this._modalHistNormalizeOnBoot();
        // 全モーダル共通: Esc で最前面の開いているモーダルを閉じる (各モーダルの × と同じ処理を呼ぶ)
        if (!this._globalModalEscBound) {
            this._globalModalEscBound = true;
            window.Surface.onEsc(document, (e) => {
                if (e.defaultPrevented) return;
                // プラグイン設定 (.modal でない独自モーダル) が設定の上に開いている時は、そちらの Esc に任せる
                // (先に登録されたこのハンドラが下の設定を閉じていた・イシュー#284 X11)
                if (document.querySelector('.plugin-settings-modal.show') && !document.querySelector('#icon-picker-modal.show')) return;
                // 重なり管理役 (イシュー#367): 管理役に載っている面があれば DOM 順ではなくスタックの最前面 (top) を閉じる
                // (設定が公開モーダルの上に積まれている時に、DOM が後ろの公開側を閉じない)。確認ダイアログは自前の capture ESC
                // esc:false の面 (Surface 経由で載せた記事の面・イシュー#509) は自前の Esc を持つ = ここでは無いものとして下の面を見る
                const ovStack = (this._overlays().stack || []).filter((f) => f.esc !== false);
                const topFace = ovStack.length ? ovStack[ovStack.length - 1] : null;
                if (topFace && topFace.kind !== 'dialog') {
                    const btn = topFace.el.querySelector('.modal-close');
                    if (btn) btn.click();
                    else {
                        // .modal-close を持たない面 (プレビュー等): 管理役で閉じ、履歴を自前で積む面 (hist:false) は段も外す
                        // (旧 fallback「remove('show') + _modalHistPop」と同じ・履歴を残留させない)
                        this._overlays().requestClose(topFace.id, 'esc');
                        if (!topFace.hist && topFace.id) this._surface().pop(topFace.id, {});
                    }
                    e.preventDefault();
                    return;
                }
                const open = Array.from(document.querySelectorAll('.modal.show'));
                if (!open.length) return;
                const top = open[open.length - 1];
                const closeBtn = top.querySelector('.modal-close');
                if (closeBtn) closeBtn.click();
                else {
                    top.classList.remove('show');
                    // .modal-close を持たない面 (プレビュー等) でも履歴を残留させない (汎用モーダル履歴)
                    if (top.id) this._surface().pop(top.id, {});
                }
                e.preventDefault();
            });
        }


        // manage-bookshelves は上記 delegation で処理 (複製配置可能なため)

        // Add bookshelf button
        const addBookshelfBtn = document.getElementById('add-bookshelf');
        if (addBookshelfBtn) {
            addBookshelfBtn.addEventListener('click', () => {
                this.addBookshelf();
            });
        }

        // Library management buttons - use correct IDs
        document.getElementById('import-kindle').addEventListener('click', () => {
            this.showImportModal();
        });

        document.getElementById('add-book-manually').addEventListener('click', () => {
            this.showAddBookModal();
        });


        // 統合エクスポートボタンは上で定義済み（export-library削除）

        // Import from file button
        document.getElementById('import-from-file').addEventListener('click', () => {
            this.importFromFile();
        });

        // ファイル選択名の自前表示 (ブラウザ既定の Choose File/No file chosen を隠すため。イシュー#89)。
        // 未選択のまま押せる primary ボタンは「押しても何も起きない」ため、選択済みの時だけ有効化する
        // (エラーで弾くより先に、押せない状態で見せる方が上位。②レビュー指摘)。
        const kindleFileInput = document.getElementById('kindle-file-input');
        if (kindleFileInput) {
            kindleFileInput.addEventListener('change', () => {
                const nameEl = document.getElementById('kindle-file-name');
                const hasFile = !!(kindleFileInput.files && kindleFileInput.files.length > 0);
                if (nameEl) nameEl.textContent = hasFile ? kindleFileInput.files[0].name : '選択されていません';
                const importBtn = document.getElementById('import-from-file');
                if (importBtn) importBtn.disabled = !hasFile;
            });
        }

        // 貼り付け / クリップボード取込 (スマホ向け。ブックマークレットがコピーした JSON を取込む)
        const importFromPasteBtn = document.getElementById('import-from-paste');
        if (importFromPasteBtn) importFromPasteBtn.addEventListener('click', () => this.importFromPasteInput());
        const readClipboardBtn = document.getElementById('read-clipboard-import');
        if (readClipboardBtn) readClipboardBtn.addEventListener('click', () => this.readClipboardForImport());

        // Plugin install (in settings modal)
        const installPluginBtn = document.getElementById('install-plugin-btn');
        if (installPluginBtn) {
            installPluginBtn.addEventListener('click', () => this.installPluginFromInput());
        }

        // Kindle 取込 (PC 専用・C-248)。主経路は取込ブックマーク (ADR-054)。
        // モバイル導線 (ショートカット/リレー) の UI は撤去、リレー機構のコアは温存 (UI から到達しないだけ)
        const openAmazonBtn = document.getElementById('open-amazon-for-import');
        if (openAmazonBtn) {
            openAmazonBtn.addEventListener('click', () => this.openAmazonForBookmarklet());
        }

        // Kindle 取込モーダル: レーン内アクションの delegation
        const importModalEl = document.getElementById('import-modal');
        if (importModalEl && !this._importModalDelegationBound) {
            this._importModalDelegationBound = true;
            importModalEl.addEventListener('click', (e) => {
                const action = e.target.closest('[data-import-action]');
                if (action) {
                    const kind = action.dataset.importAction;
                    if (kind === 'open-paste') {
                        const d = document.getElementById('import-method-data');
                        if (d) d.open = true;
                        const ta = document.getElementById('kindle-paste-input');
                        if (ta) { ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); ta.focus(); }
                    }
                    if (kind === 'copy-bookmarklet') this.copyKindleBookmarklet();
                    return;
                }
                // 取込ブックマークはドラッグ登録用 (クリックで実行するとこのページ上で動いてしまう)
                const bml = e.target.closest('#kindle-bookmarklet-link');
                if (bml) {
                    e.preventDefault();
                    toast('このボタンは押すのではなく、ブックマークバーへドラッグして登録してください。', { type: 'warn' });
                    return;
                }
                if (e.target.closest('#cancel-relay-wait')) this._cancelKindleImportWait();
            });
            // タイマー凍結対策: 画面復帰時にリレーポーリングを即 1 回実行
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && this._kindleRelayTick) this._kindleRelayTick();
            });
        }

        // 画像表示切替は overview-display ヘッダー項目に統合済み (delegation で処理)

        // Modal close - individual handlers for each modal
        const bookModalClose = document.getElementById('modal-close');
        if (bookModalClose) {
            bookModalClose.addEventListener('click', () => this.closeModal());
        }

        const bookshelfModalClose = document.getElementById('bookshelf-modal-close');
        if (bookshelfModalClose) {
            bookshelfModalClose.addEventListener('click', () => this.closeBookshelfModal());
        }

        const importModalClose = document.getElementById('import-modal-close');
        if (importModalClose) {
            importModalClose.addEventListener('click', () => this.closeImportModal());
        }

        const addBookModalClose = document.getElementById('add-book-modal-close');
        if (addBookModalClose) {
            addBookModalClose.addEventListener('click', () => this.closeAddBookModal());
        }

        const bookshelfFormModalClose = document.getElementById('bookshelf-form-modal-close');
        if (bookshelfFormModalClose) {
            bookshelfFormModalClose.addEventListener('click', () => this.closeBookshelfForm());
        }

        const cancelBookshelfForm = document.getElementById('cancel-bookshelf-form');
        if (cancelBookshelfForm) {
            cancelBookshelfForm.addEventListener('click', () => this.closeBookshelfForm());
        }

        const saveBookshelfForm = document.getElementById('save-bookshelf-form');
        if (saveBookshelfForm) {
            saveBookshelfForm.addEventListener('click', () => this.saveBookshelfForm());
        }

        // Enter key to submit bookshelf form
        const bookshelfNameInput = document.getElementById('bookshelf-name');
        if (bookshelfNameInput) {
            bookshelfNameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.saveBookshelfForm();
                }
            });
        }

        // 手動追加ボタン
        const addManuallyBtn = document.getElementById('add-manually');
        if (addManuallyBtn) {
            addManuallyBtn.addEventListener('click', () => this.addBookManually());
        }

        // ASIN自動取得ボタン
        const fetchBookInfoBtn = document.getElementById('fetch-book-info');
        if (fetchBookInfoBtn) {
            fetchBookInfoBtn.addEventListener('click', () => this.fetchBookInfoFromASIN());
        }

        // ASIN入力フィールドでEnterキー押下時の自動取得
        const asinInput = document.getElementById('manual-asin');
        if (asinInput) {
            asinInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.fetchBookInfoFromASIN();
                }
            });
        }

        // Exclusions modal
        const showExclusionsBtn = document.getElementById('show-exclusions');
        if (showExclusionsBtn) {
            showExclusionsBtn.addEventListener('click', () => this.showExclusionsModal());
        }
        const exclusionsModalClose = document.getElementById('exclusions-modal-close');
        if (exclusionsModalClose) {
            exclusionsModalClose.addEventListener('click', () => this.closeExclusionsModal());
        }

        // 記事の通報ダイアログ (ADR-099)
        const reportClose = document.getElementById('report-modal-close');
        if (reportClose) reportClose.addEventListener('click', () => this.closeReportModal());
        const reportCancel = document.getElementById('report-cancel');
        if (reportCancel) reportCancel.addEventListener('click', () => this.closeReportModal());
        const reportSubmit = document.getElementById('report-submit');
        if (reportSubmit) reportSubmit.addEventListener('click', () => this._submitReport());
        const reportReviewRefresh = document.getElementById('report-review-refresh');
        if (reportReviewRefresh) reportReviewRefresh.addEventListener('click', () => this._loadReportReview());
        const reportReviewList = document.getElementById('report-review-list');
        if (reportReviewList) reportReviewList.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-act]');
            if (btn) this._reportReviewAct(btn);
        });

        // 公開ページ管理を開く (静的SSG, ADR-030)。左ペインの「公開」ボタンから (設定からは分離)
        const publishBtn = document.getElementById('sidebar-publish');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => this.openPublishPagesModal());
        }

        // 左ペイン「プラグイン」ボタン (ADR-047 P1)。当面は設定のプラグイン節を開く
        // (P3 で #/plugins 専用ページへ差し替え予定)。

        // 左ペイン「検索」ボタン → ⌘K パレット
        const searchSideBtn = document.getElementById('sidebar-search');
        if (searchSideBtn) searchSideBtn.addEventListener('click', () => this._openPalette());

        // 左ペイン「設定」ボタン → 設定モーダル
        const settingsSideBtn = document.getElementById('sidebar-settings');
        if (settingsSideBtn) settingsSideBtn.addEventListener('click', () => this._openSettingsModal());

        // 長文メモ モーダル: 外枠をB型(#art-fs-hd)に統一(イシュー#282・②決裁B)。ヘッダーDOMは
        // _mountFsHeader が生成(文章ブロック等と同じCSSクラスを流用・二重実装を避ける)。
        // 生成はここで1回だけ行い(以降 _openBookMemoInAppEditor はタイトル/2行目の更新だけ)、
        // クリック配線もここで1回だけ張る(再生成しないので再バインドの心配もない)。
        const memoBody = document.querySelector('#book-memo-modal .book-memo-modal-body');
        const memoHd = this._mountFsHeader(memoBody, { idPrefix: 'book-memo-fs', title: '長文メモ', subId: 'book-memo-status' });
        if (memoHd) {
            memoHd.cancelBtn.addEventListener('click', () => this._bookMemoFsCancel());
            memoHd.doneBtn.addEventListener('click', () => this._bookMemoFsDone());
        }
        // 見出しボタンの3択メニュー (イシュー#282)。クリックのたびに作って閉じたら消す永続しない
        // DOMのため、個別バインドではなくグローバルに1回だけ Esc/外側クリックの配線をし、都度
        // document から開いているメニューを探して閉じる (art-more-menu・8236行と同型)。下の
        // 長文メモEscハンドラより**先に**登録する(同じdocumentのcaptureフェーズは登録順に実行
        // される=メニューが開いていればエディタ全体を閉じる前にメニューだけを閉じて消費したい)。
        document.addEventListener('click', (e) => {
            const menu = document.querySelector('.mde-heading-menu');
            if (!menu) return;
            const btn = menu._mdeAnchorBtn;
            if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
            this._mdeCloseHeadingMenu();
        });
        window.Surface.onEsc(document, (e) => {
            if (!document.querySelector('.mde-heading-menu')) return;
            this._mdeCloseHeadingMenu();
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);

        // Esc・戻る(履歴)は完了扱い(記事エディタの art-fs-done と同じ規則・②決裁)。全モーダル共通の
        // Escハンドラ(622行, bubblingフェーズ)はモーダルに .modal-close が無いとただ閉じる(保存しない)
        // ため、それより先に処理して消費する(art-item-tooltipと同型・ui-standards §1)。
        window.Surface.onEsc(document, (e) => {
            const modal = document.getElementById('book-memo-modal');
            if (!modal || !modal.classList.contains('show')) return;
            // 確認ダイアログ(キャンセルの破棄確認等)や見出しメニューが上に開いていれば、
            // そちらのEscを優先して奪わない(_artCloseBlockFs のEscハンドラ・8212行と同型のガード。
            // 見出しメニューは上のハンドラが先に登録されているため通常はここへ来る前に消費されるが、
            // 二重の安全網として明示チェックも残す)。
            if (document.querySelector('.cfm-overlay') || document.querySelector('.mde-heading-menu')) return;
            this._bookMemoFsDone();
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);

        // 長文メモ: 開き方セレクタ (settings.bookMemoOpenWith)
        const openWithSel = document.getElementById('book-memo-open-with');
        if (openWithSel) {
            const current = (this.userData?.settings?.bookMemoOpenWith) || 'app-editor';
            openWithSel.value = current;
            openWithSel.addEventListener('change', () => {
                if (!this.userData.settings) this.userData.settings = {};
                this.userData.settings.bookMemoOpenWith = openWithSel.value;
                this.saveUserData();
            });
        }

        // 一覧カードの表示設定: 星 visibility + 星 overlay + メモ visibility (全て全体設定)
        const reRenderForDisplay = () => {
            this.updateDisplay();
            if (this._lastDetailBook && document.body.classList.contains('book-detail-pinned')) {
                this.showBookDetail(this._lastDetailBook, !!this._lastDetailEditMode);
            }
        };
        // 起動時の表示形式 (settings.defaultView)。変更時は現在のビューも追従させる
        const defaultViewSel = document.getElementById('setting-default-view');
        if (defaultViewSel) {
            const dv = this.userData?.settings?.defaultView;
            defaultViewSel.value = ['covers', 'images', 'list'].includes(dv) ? dv : 'covers';
            defaultViewSel.addEventListener('change', () => {
                if (!this.userData.settings) this.userData.settings = {};
                this.userData.settings.defaultView = defaultViewSel.value;
                this.saveUserData({ deviceOnly: true });
                this.setView(defaultViewSel.value);
            });
        }
        const starVisSel = document.getElementById('setting-star-visibility');
        if (starVisSel) {
            starVisSel.value = this._getStarVisibility();
            starVisSel.addEventListener('change', () => { this._setDisplaySetting('starVisibility', starVisSel.value); reRenderForDisplay(); });
        }
        const starOverlayCb = document.getElementById('setting-star-overlay');
        if (starOverlayCb) {
            starOverlayCb.checked = this._getStarOverlay();
            starOverlayCb.addEventListener('change', () => { this._setDisplaySetting('starOverlay', starOverlayCb.checked); reRenderForDisplay(); });
        }
        const memoVisSel = document.getElementById('setting-memo-visibility');
        if (memoVisSel) {
            memoVisSel.value = this._getMemoVisibility();
            memoVisSel.addEventListener('change', () => { this._setDisplaySetting('memoVisibility', memoVisSel.value); reRenderForDisplay(); });
        }
        // 「Kindleで読む」の開き方 (settings.kindleOpenWith: 'web' 既定 / 'app')
        const kindleOpenSel = document.getElementById('setting-kindle-open-with');
        if (kindleOpenSel) {
            kindleOpenSel.value = (this.userData?.settings?.kindleOpenWith === 'app') ? 'app' : 'web';
            kindleOpenSel.addEventListener('change', () => {
                if (!this.userData.settings) this.userData.settings = {};
                this.userData.settings.kindleOpenWith = kindleOpenSel.value;
                this.saveUserData();
                reRenderForDisplay();   // 開いている本詳細のリンクを更新
            });
        }

        // イシュー#513 S6: PC/タブレットも段を積む(新しい動き)の期限付きフラグ。userData には乗せない
        // (端末ごとの見た目設定でもなく、確認用の切替なので localStorage 直書き・同期対象外)。
        const histFlagCb = document.getElementById('setting-hist-all-widths');
        if (histFlagCb) {
            histFlagCb.checked = !this._histFlagOld();
            histFlagCb.addEventListener('change', () => { this._setHistFlagOld(!histFlagCb.checked); });
        }

        // Amazon アソシエイト タグ (settings.affiliateId) — Plus 限定 (ADR-033)。
        // Free は運営タグ固定なので入力欄を隠す。Plus は自分のタグ設定/解除が可能。
        // 表示可否と値はプラン/同期に追従させる (起動時1回きりにしない) → _reflectAffiliateField()
        const affInput = document.getElementById('setting-affiliate-id');
        if (affInput) {
            affInput.addEventListener('change', () => {
                if (!this.userData.settings) this.userData.settings = {};
                // Amazon アソシエイト ID は [A-Za-z0-9_-] のみ。不正文字を除去して保存 (ハブ側 Worker の検証と一致)。
                // タグに空白/全角等が混じると github 焼き込み URL がエンコードされ、開示ラベル検出が外れる事故を防ぐ。
                const cleaned = affInput.value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
                if (affInput.value !== cleaned) affInput.value = cleaned;
                this.userData.settings.affiliateId = cleaned;
                this.saveUserData();
            });
        }
        this._reflectAffiliateField();

        // 公開名義 (発行者名)。公開ページのタイトル/フッターに使う (ADR-034)
        const pubNameInput = document.getElementById('setting-public-name');
        if (pubNameInput) {
            pubNameInput.addEventListener('change', () => {
                if (!this.userData.settings) this.userData.settings = {};
                this.userData.settings.publicDisplayName = pubNameInput.value.trim();
                this.saveUserData();
            });
        }
        this._reflectPublicNameField();

        // アカウント (ログイン) は同期方式と独立した第一級の面。
        // 起動時はチップ反映のみ (GIS の外部読込はしない)。ログインボタンの描画は設定を開いた時だけ。
        this._setupAccountUI();
        this._reflectAccountChip();
        this._initUsageAlert();

        // Event delegation for modal content
        document.addEventListener('click', (e) => {
            // 編集モード切り替え (SVG 子要素クリック対応)
            const editBtn = e.target.closest('.edit-mode-btn');
            if (editBtn) {
                const asin = editBtn.dataset.asin;
                const book = this.books.find(b => b.asin === asin);
                if (book) this.showBookDetail(book, true);
                return;
            }
            const cancelBtn = e.target.closest('.cancel-edit-btn');
            if (cancelBtn) {
                const asin = cancelBtn.dataset.asin;
                const book = this.books.find(b => b.asin === asin);
                // 案A (イシュー#453・②決裁2026-11-02): このボタンは topbar の編集終了ボタンのみが持つ
                // (旧 .bd-meta-edit 折りたたみ内の専用キャンセルボタンは撤去済み)。「編集を終える」＝
                // 「保存する」に統合したため、旧実装のように無条件で閲覧モードへ戻さず saveBookChanges を
                // 呼ぶ (バリデーション失敗時は saveBookChanges が toast を出して編集モードに留まる＝
                // 未保存入力が無言で消える欠陥を解消。成功時は saveBookChanges 自身が表示モードへ戻す)。
                if (book) this.saveBookChanges(asin);
                return;
            }
        });
    }

    setView(view) {
        if (!['covers', 'images', 'list'].includes(view)) view = 'covers';
        this.currentView = view;
        // 端末ごとの見た目の好みとして覚える (次回の起動もこの表示形式・イシュー#387)
        if (this.userData) {
            if (!this.userData.settings) this.userData.settings = {};
            this.userData.settings.defaultView = view;
        }
        this.updateDisplay();
        this.saveUserData({ deviceOnly: true });
        // ビューで列数(画像のみ/表紙)が変わるため、「大きさ」選択肢の列数表示も追従させる (イシュー#389)
        this._updateCoverSizeOptionLabels();
    }

    // 表示 popover の表示形式セグメントを現在ビューに同期
    _updateViewSegUI() {
        const seg = document.getElementById('view-seg');
        if (!seg) return;
        seg.querySelectorAll('.rseg').forEach(cell => {
            cell.classList.toggle('on', cell.dataset.view === this.currentView);
        });
    }

    /**
     * ヘッダー全 popover の共通制御 (toggle / 外側クリック / Esc)
     * data-popover-toggle 属性を持つボタンと、それに対応する popover をペアで処理。
     */
    _setupPopovers() {
        const pairs = [
            { btnId: 'toggle-filter',           popId: 'filter-popover',     onOpen: null },
            { btnId: 'toggle-display',          popId: 'display-popover',    onOpen: () => this._updateViewSegUI() },
            { btnId: 'toggle-search',           popId: 'search-popover',     onOpen: () => {
                const input = document.getElementById('search-input');
                if (input) setTimeout(() => input.focus(), 0);
            }}
        ];

        // 重なり管理役 (イシュー#367 step5): popover は「移る前に閉じる」側 (kind:'popover'・onOpen:'closeOthers'・履歴に積まない)。
        // 表示は hidden 属性のまま (showClass:null)。管理役から閉じられた時 (別の面を開いた等) も onClose で hidden に戻す
        const hide = (pop, reason) => { if (!pop) return; pop.hidden = true; this._overlays().close(pop.id, { reason: reason || 'button' }); };
        const closeAll = (except) => {
            pairs.forEach(p => {
                const pop = document.getElementById(p.popId);
                if (pop && pop !== except) hide(pop, 'closeOthers');
            });
        };

        for (const { btnId, popId, onOpen } of pairs) {
            const btn = document.getElementById(btnId);
            const pop = document.getElementById(popId);
            if (!btn || !pop) continue;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasHidden = pop.hidden;
                closeAll(wasHidden ? pop : null);
                if (wasHidden) {
                    pop.hidden = false;
                    this._overlays().open(pop, { kind: 'popover', hist: false, showClass: null, onOpen: 'closeOthers', size: 'none', onClose: () => { pop.hidden = true; } });
                    if (typeof onOpen === 'function') onOpen();
                } else {
                    hide(pop, 'button');
                }
            });
        }

        // 外側クリックで閉じる
        document.addEventListener('click', (e) => {
            for (const { btnId, popId } of pairs) {
                const pop = document.getElementById(popId);
                const btn = document.getElementById(btnId);
                if (!pop || pop.hidden) continue;
                if (pop.contains(e.target)) continue;
                if (btn && btn.contains(e.target)) continue;
                hide(pop, 'backdrop');
            }
        });

        // Esc で全 popover 閉じる
        window.Surface.onEsc(document, (e) => {
            pairs.forEach(({ popId }) => {
                const pop = document.getElementById(popId);
                if (pop && !pop.hidden) hide(pop, 'esc');
            });
        });
    }

    // ===== ⌘K コマンドパレット (Phase D) =====

    /**
     * パレットの初期化: トリガーボタン + ⌘K + 入力/キーボード操作を bind。
     */
    _setupCommandPalette() {
        if (this._paletteBound) return;
        this._paletteBound = true;

        const trigger = document.getElementById('palette-trigger');
        if (trigger) trigger.addEventListener('click', () => this._openPalette());

        // ⌘K / Ctrl+K でトグル
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                const pal = document.getElementById('command-palette');
                if (pal && !pal.hidden) this._closePalette();
                else this._openPalette();
            }
        });

        const backdrop = document.getElementById('cmdk-backdrop');
        if (backdrop) backdrop.addEventListener('click', () => this._closePalette());

        const input = document.getElementById('cmdk-input');
        if (input) {
            input.addEventListener('input', () => this._renderPaletteResults(input.value));
            input.addEventListener('keydown', (e) => this._onPaletteKeydown(e));
        }

        const results = document.getElementById('cmdk-results');
        if (results) {
            results.addEventListener('click', (e) => {
                const item = e.target.closest('.cmdk-item');
                if (item) this._runPaletteIndex(parseInt(item.dataset.idx));
            });
            results.addEventListener('mousemove', (e) => {
                const item = e.target.closest('.cmdk-item');
                if (item) this._setPaletteActive(parseInt(item.dataset.idx), false);
            });
        }
    }

    _openPalette() {
        const pal = document.getElementById('command-palette');
        const input = document.getElementById('cmdk-input');
        if (!pal || !input) return;
        pal.hidden = false;
        // 重なり管理役 (イシュー#367 step5): 中 (md・ハヘロ 05:40「検索は中」)。表示は hidden 制御のまま (showClass:null)・旧 CSS の z-index 1100 は撤去
        this._overlays().open(pal, { kind: 'modal', size: 'md', hist: false, showClass: null, sizeTarget: '.cmdk-panel' });
        document.body.classList.add('cmdk-open');
        input.value = '';
        this._renderPaletteResults('');
        this._surface().open('command-palette', { close: (o) => this._closePalette(o) });
        setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    _closePalette({ fromHistory = false, silent = false } = {}) {
        const pal = document.getElementById('command-palette');
        if (!pal) return;
        pal.hidden = true;
        this._overlays().close('command-palette', { reason: fromHistory ? 'history' : 'button' });
        document.body.classList.remove('cmdk-open');
        this._paletteItems = null;
        if (silent) {
            // イシュー#259: 呼び出し元 (switchBookshelf) がこの直後に history.replaceState で
            // 履歴エントリを書き換えるため、ここでは history.back() を予約しない。
            const st = this._modalHistStack;
            if (st) { const i = st.findIndex((e) => e.id === 'command-palette'); if (i !== -1) st.splice(i, 1); }
            return;
        }
        this._surface().close('command-palette', { fromHistory });
    }

    /**
     * パレットで実行できるコマンド一覧 (ヘッダーから移設した操作を含む)。
     */
    _paletteCommands() {
        const navMain = () => { if (this.router) this._navigateFromUi('main'); else this._setBodyView('main'); };
        const isMobile = window.viewport.isNarrow(); // 境目はjs/ui/viewport.js(900px)に一本化(イシュー#505)
        const cmds = [
            { icon: 'home',              title: 'ホーム / 本棚一覧へ',            keywords: 'home ホーム main 戻る top', run: navMain },
            { icon: 'image',             title: '表示形式: 表紙',                 keywords: 'view 表示 表紙 cover ひょうじ', run: () => this.setView('covers') },
            { icon: 'images',            title: '表示形式: 画像のみ',             keywords: 'view 表示 画像 表紙ウォール images がぞう', run: () => this.setView('images') },
            { icon: 'list',              title: '表示形式: リスト',               keywords: 'view 表示 リスト list', run: () => this.setView('list') },
            { icon: 'pen-line',          title: '本棚を管理',                     keywords: '本棚 管理 manage bookshelf へんしゅう', run: () => this.showBookshelfManager() },
            { icon: 'plus',              title: '本棚を新規作成',                 keywords: '本棚 新規 作成 add new create', run: () => this.showBookshelfForm() },
            { icon: 'download',          title: 'Kindleの本を取り込む',           keywords: 'import kindle 取込 取り込み インポート', run: () => this.showImportModal() },
            { icon: 'plus',              title: '本を手動追加',                   keywords: '手動 追加 add book マニュアル', run: () => this.showAddBookModal() },
            { icon: 'ban',               title: '除外一覧を開く',                 keywords: '除外 exclusion じょがい', run: () => this.showExclusionsModal() },
            { icon: 'settings',          title: '設定を開く',                     keywords: 'settings 設定 config せってい', run: () => this._openSettingsModal() },
        ];
        // ペイン開閉は PC のみ (モバイルはドロワー/フルシートで概念が異なり矛盾するため出さない)
        if (!isMobile) {
            cmds.push(
                { icon: 'panel-left',  title: '左サイドバーを開閉',     keywords: 'sidebar pane left ペイン 折りたたみ', run: () => this._togglePane('left') },
                { icon: 'panel-right', title: '右の本詳細ペインを開閉', keywords: 'detail pane right ペイン 折りたたみ', run: () => this._togglePane('right') }
            );
        }
        return cmds;
    }

    _renderPaletteResults(query) {
        const results = document.getElementById('cmdk-results');
        if (!results) return;
        const q = (query || '').trim().toLowerCase();
        const items = [];

        const matches = (text) => !q || (text || '').toLowerCase().includes(q);

        // 1) コマンド (組み込み)
        for (const cmd of this._paletteCommands()) {
            if (matches(cmd.title) || matches(cmd.keywords)) {
                items.push({ group: 'コマンド', icon: cmd.icon, title: cmd.title, sub: '', run: cmd.run });
            }
        }

        // 1b) プラグイン登録コマンド
        if (this.pluginAPI && typeof this.pluginAPI.getPluginCommands === 'function') {
            for (const cmd of this.pluginAPI.getPluginCommands()) {
                if (matches(cmd.title) || matches(cmd.keywords)) {
                    items.push({
                        group: 'プラグイン', icon: cmd.icon || 'puzzle', iconValue: cmd.icon,
                        title: cmd.title, sub: '',
                        run: () => { this._closePalette(); try { cmd.run(); } catch (e) { console.error(`[plugin command "${cmd.id}"]`, e); } }
                    });
                }
            }
        }

        // 2) 本棚
        for (const bs of (this.userData.bookshelves || [])) {
            if (matches(bs.name) || matches(bs.id)) {
                items.push({
                    group: '本棚', icon: bs.iconName || 'library', iconValue: bs.iconName,
                    title: bs.name || bs.id, sub: bs.isSpecial ? '特殊本棚' : '本棚',
                    run: () => this.switchBookshelf(bs.id)
                });
            }
        }

        // 3) 本 (query があるときのみ、上位 30 件)。除外済みの本は出さない。
        if (q) {
            let count = 0;
            const excludedSet = new Set((this.userData._storage && this.userData._storage.exclusions) || []);
            for (const book of (this.books || [])) {
                if (count >= 30) break;
                if (excludedSet.has(book.asin)) continue;
                if (matches(book.title) || matches(book.authors) || matches(book.asin)) {
                    const b = book;
                    items.push({ ...BookList.cmdkEntry(b), run: () => { this._closePalette(); this.showBookDetail(b); } });
                    count++;
                }
            }
        }

        this._paletteItems = items;
        this._paletteActive = 0;

        if (items.length === 0) {
            results.innerHTML = `<div class="cmdk-empty">該当なし</div>`;
            return;
        }

        let html = '';
        let lastGroup = null;
        items.forEach((it, idx) => {
            if (it.group !== lastGroup) {
                html += `<div class="cmdk-group">${it.group}</div>`;
                lastGroup = it.group;
            }
            const iconHtml = it.iconValue
                ? `<span class="cmdk-item-icon" data-icon-value="${(it.iconValue || '').replace(/"/g, '&quot;')}">${window.renderIcon(it.icon, { size: 16 })}</span>`
                : `<span class="cmdk-item-icon">${window.renderIcon(it.icon, { size: 16 })}</span>`;
            html += `
                <div class="cmdk-item${idx === 0 ? ' is-active' : ''}" data-idx="${idx}">
                    ${iconHtml}
                    <span class="cmdk-item-title">${BookshelfEscape.escapeHtml(it.title)}</span>
                    ${it.sub ? `<span class="cmdk-item-sub">${BookshelfEscape.escapeHtml(it.sub)}</span>` : ''}
                </div>`;
        });
        results.innerHTML = html;
    }

    _setPaletteActive(idx, scroll = true) {
        const results = document.getElementById('cmdk-results');
        if (!results || !this._paletteItems) return;
        const items = results.querySelectorAll('.cmdk-item');
        if (!items.length) return;
        idx = Math.max(0, Math.min(idx, items.length - 1));
        this._paletteActive = idx;
        items.forEach((el, i) => el.classList.toggle('is-active', i === idx));
        if (scroll) items[idx].scrollIntoView({ block: 'nearest' });
    }

    _onPaletteKeydown(e) {
        if (window.Surface.isEsc(e)) { e.preventDefault(); this._closePalette(); return; }
        if (!this._paletteItems || !this._paletteItems.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this._setPaletteActive((this._paletteActive ?? 0) + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._setPaletteActive((this._paletteActive ?? 0) - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); this._runPaletteIndex(this._paletteActive ?? 0); }
    }

    _runPaletteIndex(idx) {
        const it = this._paletteItems && this._paletteItems[idx];
        if (!it) return;
        // 本/本棚は run 内 (showBookDetail/switchBookshelf) が画面遷移とクローズを担う。
        // 本棚はイシュー#259: ここで先に _closePalette() を呼ぶと history.back() が予約され、
        // switchBookshelf() が積む新しい履歴と非同期に競合するため、switchBookshelf 側に
        // 「パレットがまだ開いている」ことを検知させ、silent クローズ+replaceState で処理させる。
        const closesInRun = it.group === '本' || it.group === '本棚';
        if (!closesInRun) this._closePalette();
        try { it.run(); } catch (err) { console.warn('palette command failed', err); }
    }

    // ===== 複数選択モード + 一括操作 (Phase E) =====

    _setupSelectMode() {
        if (this._selectModeBound) return;
        this._selectModeBound = true;
        this.selectMode = false;
        this.selectedAsins = new Set();

        const toggleBtn = document.getElementById('toggle-select-mode');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this._toggleSelectMode());

        const clearBtn = document.getElementById('bulk-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => this._clearSelection());

        const exclBtn = document.getElementById('bulk-exclude');
        if (exclBtn) exclBtn.addEventListener('click', () => this._bulkExclude());

        const moveFrontBtn = document.getElementById('bulk-move-front');
        if (moveFrontBtn) moveFrontBtn.addEventListener('click', () => this._bulkMoveToFront());

        const removeShelfBtn = document.getElementById('bulk-remove-shelf');
        if (removeShelfBtn) removeShelfBtn.addEventListener('click', () => this._bulkRemoveFromShelf());

        const addBtn = document.getElementById('bulk-add-shelf');
        const addPop = document.getElementById('bulk-shelf-popover');
        if (addBtn && addPop) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const willShow = addPop.hidden;
                addPop.hidden = !willShow;
                if (willShow) this._renderBulkShelfList();
            });
            document.addEventListener('click', (e) => {
                if (!addPop.hidden && window.Surface.isOutside(e, addPop, addBtn)) addPop.hidden = true;
            });
        }
    }

    _toggleSelectMode() {
        this.selectMode = !this.selectMode;
        document.body.classList.toggle('select-mode', this.selectMode);
        const btn = document.getElementById('toggle-select-mode');
        if (btn) btn.classList.toggle('is-active', this.selectMode);
        if (!this.selectMode) {
            this._clearSelection();
        } else {
            this._updateBulkBar();
        }
    }

    _clearSelection() {
        if (this.selectedAsins) this.selectedAsins.clear();
        document.querySelectorAll('.book-item.selected').forEach(el => el.classList.remove('selected'));
        const pop = document.getElementById('bulk-shelf-popover');
        if (pop) pop.hidden = true;
        this._updateBulkBar();
    }

    _toggleBookSelected(asin, el) {
        if (!this.selectedAsins) this.selectedAsins = new Set();
        if (this.selectedAsins.has(asin)) { this.selectedAsins.delete(asin); el && el.classList.remove('selected'); }
        else { this.selectedAsins.add(asin); el && el.classList.add('selected'); }
        this._updateBulkBar();
    }

    _updateBulkBar() {
        const bar = document.getElementById('bulk-bar');
        const count = document.getElementById('bulk-count');
        const n = this.selectedAsins ? this.selectedAsins.size : 0;
        if (count) count.textContent = `${n} 冊選択中`;
        if (bar) bar.hidden = !this.selectMode;

        // 文脈に応じて表示するボタンを切り替え
        const curShelf = (this.userData.bookshelves || []).find(b => b.id === this.currentBookshelf);
        const isUserShelf = !!curShelf && !curShelf.isSpecial;     // ALL/ホーム以外
        const isCustom = this.sortOrder === 'custom';
        const moveFrontBtn = document.getElementById('bulk-move-front');
        const removeShelfBtn = document.getElementById('bulk-remove-shelf');
        // 先頭に移動: カスタム順のときだけ
        if (moveFrontBtn) moveFrontBtn.hidden = !isCustom;
        // 本棚から外す: ユーザー本棚を表示中のときだけ (ALL は「除外」を使う)
        if (removeShelfBtn) removeShelfBtn.hidden = !isUserShelf;
    }

    _renderBulkShelfList() {
        const host = document.getElementById('bulk-shelf-list');
        if (!host) return;
        const shelves = (this.userData.bookshelves || []).filter(b => !b.isSpecial);
        if (!shelves.length) { host.innerHTML = `<div class="cmdk-empty">本棚がありません</div>`; return; }
        host.innerHTML = shelves.map(bs => `
            <button type="button" class="bookshelf-popover-item" data-bs-internal="${bs.internalId || bs.id}">
                <span class="bs-popover-icon" data-icon-value="${(bs.iconName || '').replace(/"/g, '&quot;')}">${window.renderIcon(bs.iconName || 'library', { size: 16 })}</span>
                <span>${BookshelfEscape.escapeHtml(bs.name)}</span>
            </button>`).join('');
        host.querySelectorAll('[data-bs-internal]').forEach(btn => {
            btn.addEventListener('click', () => this._bulkAddToShelf(btn.dataset.bsInternal));
        });
    }

    async _bulkAddToShelf(internalId) {
        const asins = [...(this.selectedAsins || [])];
        if (!asins.length) { toast('本を選択してください'); return; }
        const shelf = this.bookshelfManager.getById(internalId);
        if (!shelf) return;
        const ancestors = this.bookshelfManager.getAncestors(internalId) || [];
        const targetIds = [...ancestors.map(a => a.internalId || a.id), internalId];
        let added = 0;
        for (const asin of asins) {
            for (const id of targetIds) {
                const bs = this.bookshelfManager.getById(id);
                if (bs && !(bs.books || []).includes(asin)) this.bookshelfManager.addBookToBookshelf(id, asin);
            }
            added++;
        }
        await this.saveUserData();
        const pop = document.getElementById('bulk-shelf-popover');
        if (pop) pop.hidden = true;
        if (typeof this.renderBookshelfList === 'function') this.renderBookshelfList();
        if (typeof this._renderSidebarTree === 'function') this._renderSidebarTree();
        const ancMsg = ancestors.length ? `\n（祖先にも自動追加: ${ancestors.map(a => a.name).join('、')}）` : '';
        toast(`${added} 冊を「${shelf.name}」に追加しました${ancMsg}`);
    }

    async _bulkExclude() {
        const asins = [...(this.selectedAsins || [])];
        if (!asins.length) { toast('本を選択してください'); return; }
        const okBulkExclude = await confirmDialog({
            title: 'すべての本から除外',
            message: `選択した ${asins.length} 冊を all から除外しますか？\n\n再Kindle取込でも復活しません。除外一覧から解除できます。`,
            okLabel: '除外する',
            danger: true
        });
        if (!okBulkExclude) return;
        asins.forEach(a => this._excludeAsinCore(a));
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
        this.books = this.bookManager.getAllBooks();
        await this.saveUserData();
        this._clearSelection();
        this.applyFilters();
        this.updateDisplay();
        this.updateStats();
        toast(`${asins.length} 冊を除外しました`);
    }

    /** 現在の本棚の全メンバー ASIN を「表示順 (custom order を尊重)」で返す */
    _shelfOrderedAsins(key) {
        const bs = (this.userData.bookshelves || []).find(b => b.id === key);
        let members;
        if (bs && !bs.isSpecial) members = [...(bs.books || [])];
        else members = (this.books || []).map(b => b.asin); // all / 不明時は全蔵書
        const memberSet = new Set(members);
        const order = (this.userData.bookOrder && this.userData.bookOrder[key]) || [];
        const inOrder = order.filter(a => memberSet.has(a));
        const inOrderSet = new Set(inOrder);
        const rest = members.filter(a => !inOrderSet.has(a));
        return [...inOrder, ...rest];
    }

    /** 選択した本を現在の本棚の先頭へ移動 (カスタム順のときのみ) */
    async _bulkMoveToFront() {
        if (this.sortOrder !== 'custom') {
            toast('「並び替え」を「カスタム順」にすると、先頭に移動できます。');
            return;
        }
        const asins = [...(this.selectedAsins || [])];
        if (!asins.length) { toast('本を選択してください'); return; }
        const key = this.currentBookshelf || 'all';
        const ordered = this._shelfOrderedAsins(key);
        const selSet = new Set(asins.filter(a => ordered.includes(a)));
        if (!selSet.size) return;
        const newOrder = [...ordered.filter(a => selSet.has(a)), ...ordered.filter(a => !selSet.has(a))];
        if (!this.userData.bookOrder) this.userData.bookOrder = {};
        this.userData.bookOrder[key] = newOrder;
        await this.saveUserData();
        this.applyFilters();
        this.updateDisplay();
        toast(`${selSet.size} 冊を先頭に移動しました`);
    }

    /** 選択した本を現在の (ユーザー) 本棚から外す。本自体は削除しない。子孫からもカスケード。 */
    async _bulkRemoveFromShelf() {
        const curShelf = (this.userData.bookshelves || []).find(b => b.id === this.currentBookshelf);
        if (!curShelf || curShelf.isSpecial) {
            toast('「すべての本」では使えません。蔵書から外すには「すべての本から除外」を使ってください。');
            return;
        }
        const asins = [...(this.selectedAsins || [])].filter(a => (curShelf.books || []).includes(a));
        if (!asins.length) { toast('この本棚にある本を選択してください'); return; }
        if (!(await window.confirmDialog({ message: `選択した ${asins.length} 冊を「${curShelf.name}」から外しますか？\n\n本自体は削除されません（子の本棚に入っている場合はそこからも外れます）。`, danger: true }))) return;
        for (const asin of asins) {
            this.bookshelfManager.removeBookFromBookshelf(curShelf.internalId, asin);
        }
        await this.saveUserData();
        this._clearSelection();
        this.applyFilters();
        this.updateDisplay();
        if (typeof this._renderSidebarTree === 'function') this._renderSidebarTree();
        toast(`${asins.length} 冊を「${curShelf.name}」から外しました`);
    }

    search(query) {
        this.searchQuery = query.toLowerCase();
        this.applyFilters();
    }

    /**
     * 表紙画像の共通フォールバック。data-cover-fallback 属性を持つ <img> が
     * 読み込み失敗 (404) または「200 だが 1x1 の透明 GIF」(/images/P/ 旧エンドポイントが
     * 画像なしの ASIN に返す) だったとき、属性値のタイトルを載せた生成表紙に差し替える。
     * img の error/load は bubble しないため document の capture で全面を一括して受ける。
     */
    _setupCoverFallback() {
        const swap = (img) => {
            const title = img.dataset ? img.dataset.coverFallback : undefined;
            if (title === undefined) return;
            const div = document.createElement('div');
            div.className = 'book-cover-placeholder cover-fallback';
            div.textContent = title; // 空文字なら無地グラデ (小さいセル用)
            img.replaceWith(div);
        };
        document.addEventListener('error', (e) => {
            if (e.target instanceof HTMLImageElement) swap(e.target);
        }, true);
        document.addEventListener('load', (e) => {
            if (e.target instanceof HTMLImageElement && e.target.naturalWidth <= 1) swap(e.target);
        }, true);
    }

    /**
     * 検索・評価・プラグイン由来の絞り込みをまとめて解除する共通ヘルパ。
     * 状態クリアと入力欄/インジケータの同期のみで、再描画は呼び出し側の applyFilters() に任せる。
     * 利用元: 本棚切替 (switchBookshelf) / 空状態の「絞り込みを解除」ボタン。
     */
    _resetFilters() {
        this.searchQuery = '';
        if (this.ratingFilter) this.ratingFilter.clear();
        if (this.kindleFilter) this.kindleFilter.clear();
        const si = document.getElementById('search-input');
        if (si) si.value = '';
        if (typeof this._updateRatingFilterUI === 'function') this._updateRatingFilterUI();
        if (typeof this._updateKindleFilterUI === 'function') this._updateKindleFilterUI();
        // プラグイン由来のフィルタ (registerActiveFilter) も解除。各 reset は状態クリアのみの契約。
        if (this.pluginAPI && typeof this.pluginAPI.resetActiveFilters === 'function') this.pluginAPI.resetActiveFilters();
    }

    // book が該当する Kindle 区分の集合を返す ('purchase'/'kuprime'/'revoked')。
    // origin(購入/KU・Prime) と status(有効/利用終了) は独立した軸のため、KU で借りて返却した本は
    // 'kuprime' と 'revoked' の両方に該当しうる (排他分類ではない、複数タグ)。
    // フィールドが無い本 (既存データ・未取得の本) は既定で 'purchase' のみ扱い (イシュー#41)。
    _kindleCategoriesOf(book) {
        const cats = new Set();
        if (book.originType === 'Ku' || book.originType === 'Prime') cats.add('kuprime');
        else cats.add('purchase');
        if (book.statusFromPlatformSearch === 'Revoked') cats.add('revoked');
        return cats;
    }

    applyFilters() {
        if (!Array.isArray(this.books)) {
            this.filteredBooks = [];
            return;
        }
        this.filteredBooks = this.books.filter(book => {
            // Bookshelf filter: 特殊本棚 (all) は全件、それ以外は books 配列で絞り込み
            if (this.currentBookshelf) {
                const bookshelf = this.userData.bookshelves?.find(b => b.id === this.currentBookshelf);
                if (bookshelf && !bookshelf.isSpecial && bookshelf.books && !bookshelf.books.includes(book.asin)) {
                    return false;
                }
            }
            
            
            // 評価でしぼり込み: ratingFilter に選ばれた評価だけ通す。空なら絞り込みなし。
            if (this.ratingFilter && this.ratingFilter.size > 0) {
                const bookRating = this.userData.notes[book.asin]?.rating || 0;
                if (!this.ratingFilter.has(bookRating)) {
                    return false;
                }
            }

            // Kindle区分でしぼり込み: 選ばれた区分のいずれかに該当すれば通す(OR)。空なら絞り込みなし。
            if (this.kindleFilter && this.kindleFilter.size > 0) {
                const categories = this._kindleCategoriesOf(book);
                const matches = [...this.kindleFilter].some(k => categories.has(k));
                if (!matches) {
                    return false;
                }
            }

            // Search filter
            if (this.searchQuery) {
                const searchText = `${book.title} ${book.authors}`.toLowerCase();
                if (!searchText.includes(this.searchQuery)) {
                    return false;
                }
            }
            
            return true;
        });
        
        // プラグイン由来のフィルタを適用。適用前の件数を控える: 空状態の判定で
        // 「コアフィルタ後は本があったが、プラグインが畳んで0件にした」のか
        // 「本棚が元から空 (0件)」なのかを区別するため (誤った空状態文言＋誤解除を防ぐ)。
        this._countBeforePluginFilters = this.filteredBooks.length;
        if (this.pluginAPI && typeof this.pluginAPI._runBookFilters === 'function') {
            this.filteredBooks = this.pluginAPI._runBookFilters(this.filteredBooks);
        }

        this.applySorting();
    }

    // イシュー#398: 本棚一覧 (applySorting) とホームの本棚ハイライト (_getLibrarySortedAsins) が
    // 1か所で共有する比較ロジック。'custom' はどちらの呼び出し元も別経路 (bookOrder) で処理するため
    // ここでは扱わない。
    _bookSortKey(book, sortOrder) {
        if (sortOrder === 'acquiredTime') return parseInt(book.acquiredTime) || 0;
        return String(book[sortOrder] ?? '');
    }

    _bookCompareFn(sortOrder, sortDirection) {
        if (sortOrder === 'acquiredTime') {
            return (aKey, bKey) => {
                let c = 0;
                if (aKey > bKey) c = 1;
                if (aKey < bKey) c = -1;
                return sortDirection === 'asc' ? c : -c;
            };
        }
        // イシュー#397 A6: Intl.Collator を1つだけ作って使い回す (インスタンス生成は並び替えごとに
        // 作ると実データで無視できない負荷になるため)。
        this._sortCollator = this._sortCollator || new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
        const collator = this._sortCollator;
        return (aKey, bKey) => {
            const c = collator.compare(aKey, bKey);
            return sortDirection === 'asc' ? c : -c;
        };
    }

    applySorting() {
        if (this.sortOrder !== 'custom') {
            // 比較キーは本ごとに先に計算してから並べる (シュワルツ変換＝比較のたびに
            // 文字列を作り直さない・イシュー#397 A6)。
            const order = this.sortOrder;
            const cmp = this._bookCompareFn(order, this.sortDirection);
            const decorated = this.filteredBooks.map((book) => ({ book, key: this._bookSortKey(book, order) }));
            decorated.sort((a, b) => cmp(a.key, b.key));
            // 配列の参照は変えず内容だけ書き換える (従来の .sort() と同じin-place挙動を保つ＝
            // toggleSortDirection の反転キャッシュが参照の同一性で有効判定できる)
            for (let i = 0; i < decorated.length; i++) this.filteredBooks[i] = decorated[i].book;
        }
        // 'custom' は本来 _orderedBooksToRender 側で順序を決めるため、ここでは並べ替えない (従来どおり)。

        // イシュー#397 A4: 昇順/降順の切り替え (toggleSortDirection) が同じ配列を反転するだけで
        // 済むようにするためのキャッシュ。配列の参照が変わらない限り (=本棚切替・蔵書変更・絞り込み
        // 変更で applyFilters() が filteredBooks を新しい配列に差し替えない限り) 有効。
        this._sortedCacheKey = this.sortOrder;
        this._sortedCacheRef = this.filteredBooks;

        this.currentPage = 1;
        this.updateDisplay();
        this.updateStats();
    }

    // イシュー#398: ホームの本棚ハイライト用。全蔵書をこの端末の並び順設定で1回だけ並べてキャッシュする
    // (本棚ごとに913冊を並べ直さない＝本棚一覧表示とは別に、本棚ハイライトが呼ばれるたびに全件ソートしない)。
    // 'custom' はここでは使わない (呼び出し元が本棚ごとの bookOrder で別処理する)。
    // キャッシュ無効化は {sortOrder, sortDirection, 蔵書の版数} をキーにする。蔵書の参照一致では
    // 変更を検知できない (BookManager.getAllBooks() は参照をそのまま返し、updateBook はフィールドの
    // in-place書換のため) ので、BookManager._rev (getRev()) を使う。
    _getLibrarySortedAsins() {
        const sortOrder = this.sortOrder;
        const sortDirection = this.sortDirection;
        const rev = (this.bookManager && typeof this.bookManager.getRev === 'function') ? this.bookManager.getRev() : 0;
        const key = `${sortOrder}|${sortDirection}|${rev}`;
        if (this._librarySortCache && this._librarySortCache.key === key) return this._librarySortCache;

        const books = this.books || [];
        const cmp = this._bookCompareFn(sortOrder, sortDirection);
        const decorated = books.map((book) => ({ asin: book.asin, key: this._bookSortKey(book, sortOrder) }));
        decorated.sort((a, b) => cmp(a.key, b.key));

        const asins = decorated.map((d) => d.asin);
        const rank = new Map();
        asins.forEach((asin, i) => rank.set(asin, i));
        this._librarySortCache = { key, asins, rank };
        return this._librarySortCache;
    }

    toggleSortDirection() {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.updateSortDirectionButton();
        // イシュー#397 A4: 直前にこの並び順で実際にソートした配列がまだ有効 (参照が同じ) なら、
        // 比較をやり直さずその場で反転するだけにする (applySorting の比較コストを丸ごと避ける)。
        if (this.sortOrder !== 'custom' && this._sortedCacheKey === this.sortOrder && this._sortedCacheRef === this.filteredBooks) {
            this.filteredBooks.reverse(); // 参照はそのまま＝キャッシュは次の反転にも有効
            this.currentPage = 1;
            this.updateDisplay();
            this.updateStats();
        } else {
            this.applySorting();
        }
        this._saveSortPrefs();
    }

    // 並び順・昇降を設定として永続化 (D-2)。設定の保存経路は saveUserData が唯一の正
    // (storage.saveSettings というメソッドは存在しない。旧 paneState がこの空振りパターンだった)
    _saveSortPrefs() {
        if (!this.userData) return;
        if (!this.userData.settings) this.userData.settings = {};
        this.userData.settings.sortOrder = this.sortOrder;
        this.userData.settings.sortDirection = this.sortDirection;
        this.saveUserData({ deviceOnly: true });
        const sortRow = document.querySelector('#display-popover .fp-sort-row');
        this._showSavedNote('sort', sortRow);
        // イシュー#398: ホームを表示中に並び順を変えた場合も本棚ハイライトへすぐ反映する
        // (updateBookshelfSelector が本棚切替/蔵書変更の時に使っているのと同じガード)。
        if (this.dashboard && document.body.classList.contains('app-view-main')) {
            this.dashboard.render();
        }
    }

    // 見た目の好みを変えた行の直下に「この端末に記録しました」を短く出す (いつ記録されたか分からない、への答え・イシュー#387)。
    // 表示 popover の 表示形式 / 並び順 / 表紙の大きさ の3か所で同じ見た目・同じ挙動にする。key ごとに1つの印を使い回す
    _showSavedNote(key, anchor) {
        if (!anchor || !anchor.parentNode) return;
        const id = `${key}-saved-note`;
        let note = document.getElementById(id);
        if (!note) {
            note = document.createElement('span');
            note.id = id;
            note.className = 'device-saved-note';
            note.setAttribute('role', 'status');
        }
        if (note.previousSibling !== anchor) anchor.parentNode.insertBefore(note, anchor.nextSibling); // 行の直下 (狭い幅で行をはみ出さない)
        const ic = typeof window.renderIcon === 'function' ? window.renderIcon('check', { size: 12 }) : '';
        note.innerHTML = `${ic}この端末に記録しました`;
        note.hidden = false;
        this._savedNoteTimers = this._savedNoteTimers || {};
        clearTimeout(this._savedNoteTimers[key]);
        this._savedNoteTimers[key] = setTimeout(() => { note.hidden = true; }, 2000);
    }

    setBooksPerPage(value) {
        if (value === 'all') {
            this.booksPerPage = this.filteredBooks.length || 999999;
        } else {
            const parsedValue = parseInt(value);
            // 異常な値をチェック
            if (isNaN(parsedValue) || parsedValue <= 0) {
                this.booksPerPage = 50;
                value = 50;
            } else {
                this.booksPerPage = parsedValue;
            }
        }
        
        this.currentPage = 1;
        
        // Save the setting
        if (!this.userData.settings) {
            this.userData.settings = {};
        }
        this.userData.settings.booksPerPage = value;
        
        this.updateDisplay();
        this.saveUserData({ deviceOnly: true });
    }

    setCoverSize(size) {
        // Save the setting
        if (!this.userData.settings) {
            this.userData.settings = {};
        }
        this.userData.settings.coverSize = size;

        // Apply CSS class to bookshelf container
        const bookshelf = document.getElementById('bookshelf');
        bookshelf.classList.remove('size-small', 'size-medium', 'size-large');
        bookshelf.classList.add(`size-${size}`);

        this.saveUserData({ deviceOnly: true });
    }

    // イシュー#389: スマホでは #385 で枠が列幅追従になり小/中/大の見た目差がほぼ消えたため、
    // 「大きさ」選択肢に列数を添える(専門用語なし・案A)。リスト表示とPC幅では列数の概念が無いので
    // 添えない。
    // 列数の数字・「添えるべき幅かどうか」は css/bookshelf.css の @media 内 .bookshelf.size-* の
    // --mobile-cols-covers/--mobile-cols-images(1か所の表・現在の境界は max-width:768px・css:7581
    // 本棚一覧グリッドの実際の切替幅)をそのまま読む(getComputedStyle)。幅の判定にmatchMediaの
    // 固定値をJS側に複製しない: この変数はCSSの@media内でしか定義されないため、境界の外側(数字も
    // 含め)ではgetPropertyValueが空文字→NaN→nullになり、「列数を添えない」が自動的に正しくなる。
    // CSS側の境界を変えてもJS側は何も直さなくてよい(②指摘2026-10-28: JS側に768pxをハードコードして
    // いた旧実装は、アプリの他所で「モバイル」判定に使われる900pxと混同されやすく、境界がズレて
    // いるという誤認の指摘が実際に発生した。数字を複製しない設計に変更して再発を防ぐ)。
    _readMobileColsTable() {
        if (!this._colsProbeEl) {
            const el = document.createElement('div');
            // レイアウトに影響しない非表示プローブ。display:none にはしない
            // (getComputedStyle の値自体は display:none でも取れるが、念のため実在要素として扱う)。
            el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
            document.body.appendChild(el);
            this._colsProbeEl = el;
        }
        const el = this._colsProbeEl;
        const table = {};
        for (const size of ['small', 'medium', 'large']) {
            el.className = `bookshelf size-${size}`;
            const cs = getComputedStyle(el);
            const covers = parseInt(cs.getPropertyValue('--mobile-cols-covers'), 10);
            const images = parseInt(cs.getPropertyValue('--mobile-cols-images'), 10);
            table[size] = {
                covers: Number.isFinite(covers) ? covers : null,
                images: Number.isFinite(images) ? images : null,
            };
        }
        return table;
    }

    // 「表紙の大きさ」select の選択肢テキストを更新する (イシュー#389)。
    // view-seg (表示形式) の変更・リサイズ(768px境界を越えた時)に呼ぶ。
    // 幅の判定にmatchMediaの固定値を使わない(②指摘2026-10-28: 768pxとCSSの実際の境界900pxが
    // 食い違っていた再発防止)。_readMobileColsTable() がCSSの --mobile-cols-* を直接読むので、
    // 900px超など列数CSSが効いていない幅では値が自然にnullになり「列数を添えない」が自動的に
    // 正しくなる=JS側に境界の数字を複製しない。
    _updateCoverSizeOptionLabels() {
        const select = document.getElementById('cover-size');
        if (!select) return;
        const baseLabels = { small: '小', medium: '中', large: '大' };
        const view = this.currentView;
        const showCols = (view === 'covers' || view === 'images');
        const table = showCols ? this._readMobileColsTable() : null;
        for (const opt of select.options) {
            const base = baseLabels[opt.value] || opt.value;
            const n = table && table[opt.value] ? table[opt.value][view] : null;
            opt.textContent = n ? `${base}（${n}列）` : base;
        }
    }

    // 評価でしぼり込みセグメントの表示更新: 選択中セルを on、reset 表示、
    // ツールバーのフィルターボタンに適用中インジケータ(has-active-filter)を付ける。
    _updateRatingFilterUI() {
        const seg = document.getElementById('rating-seg');
        if (seg) {
            seg.querySelectorAll('.rseg').forEach(cell => {
                cell.classList.toggle('on', this.ratingFilter.has(Number(cell.dataset.rating)));
            });
        }
        const reset = document.getElementById('rating-filter-reset');
        if (reset) reset.hidden = this.ratingFilter.size === 0;
        this._updateFilterButtonIndicator();
    }

    // Kindle区分でしぼり込みセグメントの表示更新 (イシュー#41)。_updateRatingFilterUI と対の実装。
    _updateKindleFilterUI() {
        const seg = document.getElementById('kindle-seg');
        if (seg) {
            seg.querySelectorAll('.rseg').forEach(cell => {
                cell.classList.toggle('on', this.kindleFilter.has(cell.dataset.kindle));
            });
        }
        const reset = document.getElementById('kindle-filter-reset');
        if (reset) reset.hidden = this.kindleFilter.size === 0;
        this._updateFilterButtonIndicator();
    }

    // ツールバーのフィルターボタンに「いずれかの絞り込みが適用中」インジケータを付ける。
    // 評価・Kindle区分のどちらかが非空なら on にする (どちらか一方だけの排他ではない)。
    _updateFilterButtonIndicator() {
        const fbtn = document.getElementById('toggle-filter');
        if (!fbtn) return;
        const active = (this.ratingFilter && this.ratingFilter.size > 0) || (this.kindleFilter && this.kindleFilter.size > 0);
        fbtn.classList.toggle('has-active-filter', active);
    }

    updateSortDirectionButton() {
        const button = document.getElementById('sort-direction');
        const hint = document.getElementById('fp-custom-hint');
        if (!button) return;
        const renderArrow = (dir) => window.renderIcon(dir === 'asc' ? 'arrow-up' : 'arrow-down', { size: 14 });

        if (this.sortOrder === 'custom') {
            // カスタム順は方向の概念が無いのでボタンは隠し、ドラッグ並び替えの案内を出す
            button.style.display = 'none';
            if (hint) hint.style.display = '';
        } else {
            button.style.display = '';
            button.disabled = false;
            if (hint) hint.style.display = 'none';
            const arrow = `<span class="h-icon">${renderArrow(this.sortDirection)}</span>`;
            if (this.sortOrder === 'acquiredTime') {
                button.innerHTML = `${arrow}${this.sortDirection === 'asc' ? '古い順' : '新しい順'}`;
            } else {
                button.innerHTML = `${arrow}${this.sortDirection === 'asc' ? '昇順（A→Z）' : '降順（Z→A）'}`;
            }
        }
    }

    updateDisplay() {
        const bookshelf = document.getElementById('bookshelf');
        // Apply view and cover size classes
        const coverSize = this.userData.settings?.coverSize || 'medium';
        // is-custom-order: カスタム順のときだけ本をドラッグ並べ替えできる (grab カーソルで示す)
        const customCls = (this.sortOrder === 'custom') ? ' is-custom-order' : '';
        const baseCls = `bookshelf view-${this.currentView} size-${coverSize}`;
        const cls = baseCls + customCls;
        // イシュー#359 段階④ (R1): 一覧の全件作り直しをやめ、asin ごとの要素を差分 (追加・削除・並び替え・内容変更) で更新する。
        // ビュー/表紙サイズ (container の class) が変わった時と、まだカードが無い時は従来どおり全件描画。
        // イシュー#402: is-custom-order はカードの中身に影響しない (つまみの表示・カーソルは CSS、ドラッグ開始は sortOrder で判定)。
        // これだけが変わった時 (カスタム順への切替/カスタム順からの切替) は class を付け替えて差分描画に回す
        // (全件作り直しに落ちて x6・913冊で 1.1〜1.2秒固まっていた)。
        const canDiff = bookshelf.className.replace(/\s*\bis-custom-order\b/, '') === baseCls
            && !!bookshelf.querySelector(':scope > .book-item[data-asin]');
        if (canDiff) {
            if (bookshelf.className !== cls) bookshelf.className = cls;
            this._renderListDiff(bookshelf);
        } else {
            this._cancelListTail(); // 段階描画の残りは捨てる (全件描画がやり直す・通知も全件描画側の1回だけ) (#401)
            bookshelf.textContent = '';
            bookshelf.className = cls;
            this.renderStandardView(bookshelf);
        }

        this.setupPagination();
        this._updateViewSegUI();
    }

    // 一覧に描く順 (カスタム順は bookOrder に従い、未登録は末尾)。renderStandardView と _renderListDiff で共通
    _orderedBooksToRender() {
        const currentBookshelfId = this.currentBookshelf || 'all';
        const booksToRender = [...this.filteredBooks];
        if (this.sortOrder === 'custom' && this.userData.bookOrder && this.userData.bookOrder[currentBookshelfId]) {
            const customOrder = this.userData.bookOrder[currentBookshelfId];
            // イシュー#402: 比較のたびの indexOf (冊数の2乗×log) をやめ、位置を1回だけ Map に引く。
            // 重複 asin は indexOf と同じく最初の位置を採る
            const rank = new Map();
            customOrder.forEach((asin, i) => { if (!rank.has(asin)) rank.set(asin, i); });
            // Sort books according to custom order, with unordered books at the end
            booksToRender.sort((a, b) => {
                const aIndex = rank.has(a.asin) ? rank.get(a.asin) : -1;
                const bIndex = rank.has(b.asin) ? rank.get(b.asin) : -1;
                if (aIndex === -1 && bIndex === -1) return 0; // Both not in custom order
                if (aIndex === -1) return 1; // a not in custom order, put at end
                if (bIndex === -1) return -1; // b not in custom order, put at end
                return aIndex - bIndex; // Both in custom order, use custom order
            });
        }
        return booksToRender;
    }

    // イシュー#480: 同じ asin の本が複数冊あっても _renderListDiff の Map キーが衝突しないようにする
    // 描画専用のキー。保存はしない(②差し戻し・データ構造は変えない)。_orderedBooksToRender() が返す
    // 順で、同じ asin が何度目の出現かを数えるだけ。重複が無い本は asin そのまま(出現番号0)。
    // 戻り値は books と同じ長さの配列(books[idx] に対応するキーが dedupKeys[idx])。
    _dedupKeysFor(books) {
        const occ = new Map(); // asin -> 次に振る出現番号
        return books.map((b) => {
            const n = occ.get(b.asin) || 0;
            occ.set(b.asin, n + 1);
            return n === 0 ? b.asin : `${b.asin}#${n}`;
        });
    }

    // イシュー#359 段階④ (R1): カードの内容を決める入力の指紋。同じなら要素をそのまま使い回す (createBookElement を呼ばない)
    _bookCardKey(book, displayType) {
        const n = (this.userData.notes && this.userData.notes[book.asin]) || {};
        // 書誌は book 全体 (バッジ=利用終了/KU/Prime 等のフラグも含む・再取込で変わる) を JSON で持つ。
        // イシュー#397 A1: JSON.stringify(book) は実データ(913冊)で1件あたり数μs〜10μs程度かかり、
        // 並び替えのたびに全件作り直すと無視できない負荷になる(実測: 913冊で約6ms)。
        // 再取込時のステータス更新 (book-manager.js) は book オブジェクトの参照を変えずフィールドだけ
        // 書き換えるため、参照の同一性だけでは変化を検知できない(実測で判明・kindle-reimport-merge.spec.js
        // で検出)。book-manager.js 側が書き換えのたびに進める book.__bibV と組み合わせて判定する。
        this._bibCache = this._bibCache || new Map();
        let bib;
        const cached = this._bibCache.get(book.asin);
        if (cached && cached.ref === book && cached.v === (book.__bibV || 0)) {
            bib = cached.bib;
        } else {
            try { bib = JSON.stringify(book); } catch (_) { bib = `${book.title}\u0002${Date.now()}`; }
            this._bibCache.set(book.asin, { ref: book, bib, v: book.__bibV || 0 });
        }
        // イシュー#484: 重複ASIN検出バッジの有無もrkeyに含める。含めないと、ASIN付け替えで重複が
        // 解消された「もう一方の本」(book自体のtitle/authors等は変わらない)のカードが rkey 一致で
        // 再利用され、古いバッジが残ったままになる(実機で検出: duplicate-asin-notice.spec.js)。
        const dup = this._dupAsinInfo().get(book.asin);
        const dupFlag = dup ? (dup.sameTitle ? 's' : 'd') : '0';
        return [displayType, this._getStarVisibility(), this._getStarOverlay() ? 1 : 0, this._getMemoVisibility(),
            bib, n.rating || 0, this.bookshelfManager.resolveMemo(book.asin) || '', n.hideMemo ? 1 : 0, dupFlag].join('\u0001');
    }

    // イシュー#406: LIS(最長増加部分列)で「動かさなくてよい本の集合」を求める。seq[i] は
    // books配列のi番目の本の旧DOM位置(無ければ-1=新規、常にLIS対象外)。patience sorting で O(n log n)。
    // 戻り値は books配列の添字(idx)の Set。
    _computeLisKeepSet(seq) {
        const tailsIdx = []; // tailsIdx[k] = 長さk+1のLISの末尾となるseq中の添字
        const prevArr = new Array(seq.length).fill(-1);
        for (let i = 0; i < seq.length; i++) {
            const v = seq[i];
            if (v < 0) continue; // 新規(旧DOMに無い)はLIS対象外=常に挿入
            let lo = 0, hi = tailsIdx.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tailsIdx[mid]] < v) lo = mid + 1; else hi = mid; }
            if (lo > 0) prevArr[i] = tailsIdx[lo - 1];
            if (lo === tailsIdx.length) tailsIdx.push(i); else tailsIdx[lo] = i;
        }
        const keep = new Set();
        let k = tailsIdx.length ? tailsIdx[tailsIdx.length - 1] : -1;
        while (k !== undefined && k !== -1) { keep.add(k); k = prevArr[k]; }
        return keep;
    }

    // イシュー#359 段階④ (R1): 既存のカードを asin で引き、追加・削除・並び替え・内容変更だけ DOM を触る。
    // 旧 updateDisplay が全件作り直しで落としていた状態 (選択・ホバーポップ・D&D の罫線) は使い回す要素でも落とす (見える挙動は同じ)。
    _renderListDiff(container) {
        this._flushListTail(); // 段階描画の途中なら、先に残りを置き切ってから差分を取る (#401)
        const books = this._orderedBooksToRender();
        if (books.length === 0) {
            container.textContent = '';
            container.appendChild(this._buildBookshelfEmptyState());
            if (this.pluginAPI) this.pluginAPI._emit('ui:books-rendered', { view: this.currentView, changed: 0 });
            return;
        }
        // イシュー#480: asin が重複する本(別内容の本に同じ asin が付いた既存データを含む)でも
        // old/oldIndex の Map キーが衝突しないよう、asin ではなく dedupKey (= asin。重複時は
        // `${asin}#${出現番号}`) を使う。#406(c5a466d)が入れた「DOM走査で2枚目以降を即removeする」
        // 対症療法(dupAsins)は、この方式では不要になる(dedupKeyが別なら同じMapキーを奪い合わない
        // ため孤立要素そのものが発生しない)ので撤去する。
        const dedupKeys = this._dedupKeysFor(books); // books[idx] に対応するキーが dedupKeys[idx]
        const old = new Map();
        const oldIndex = new Map();
        { let i = 0; for (const el of Array.from(container.children)) {
            if (el.classList.contains('book-item') && el.dataset.asin && !el.classList.contains('drag-ghost')) {
                // dedupKey は前回の描画で付与したもの。無い要素(他経路で生成された直後等)は asin に
                // フォールバックする。
                const dk = el.dataset.dedupKey || el.dataset.asin;
                if (old.has(dk)) { el.remove(); continue; } // 理論上は発生しないはずの保険
                old.set(dk, el); oldIndex.set(dk, i++);
            }
            else el.remove(); // 空状態・ゴースト等
        } }
        // イシュー#397 A5: 昇順/降順の反転など「ほぼ全件の順序が変わる」場合、1件ずつ insertBefore
        // すると(913冊で900回前後)ブラウザ内部のレイアウト/ペイントが都度走り重い。移動する件数が
        // 全体の半分を超える見込みなら、既存カードを再利用したまま1回の replaceChildren で
        // まとめて差し替える(要素は作り直さない=画像の再取得もしない)。半分以下(通常のドラッグ並べ替え
        // 等)なら従来どおり変わった分だけ insertBefore する。
        // イシュー#406: 旧実装は「新旧で位置が違う本の絶対数」を見込みにしていたが、insertBefore経路の
        // 実際のコストは cursor 比較の連鎖(1件のズレで以降全件が el!==cursor になる)で決まり、両者は
        // 一致しない(再取込で見込み2なのに実際は898件連鎖・406-results.md step1)。見込みと実際の移動数を
        // 同じ数え方(LIS=最長増加部分列で「動かさなくてよい本の集合」)にそろえる(movedEstimate=動かす
        // 本の数の見込み=books.length-keepSet.size)。
        // イシュー#406 (②差し戻し): 旧位置があっても内容が変わる(rkey不一致=作り直し)本は、
        // 位置が変わらなくても必ずinsertBefore対象になる(新しい要素を挿す必要があるため)。
        const lisSeq = books.map((b, idx) => {
            const dk = dedupKeys[idx];
            const p = oldIndex.get(dk);
            if (p === undefined) return -1;
            const el = old.get(dk);
            return (el && el.dataset.rkey === this._bookCardKey(b, this.currentView)) ? p : -1;
        });
        const keepSet = this._computeLisKeepSet(lisSeq); // Set<number>: books配列の添字。動かさなくてよい本
        const movedEstimate = books.length - keepSet.size;
        let created = 0, moved = 0, removed = 0;
        if (movedEstimate > books.length * 0.5) {
            const finalEls = new Array(books.length);
            for (let idx = 0; idx < books.length; idx++) {
                const book = books[idx];
                const dk = dedupKeys[idx];
                const key = this._bookCardKey(book, this.currentView);
                let el = old.get(dk);
                if (el && el.dataset.rkey === key) {
                    el.classList.add('bk-settled'); // 挿し直しで登場アニメを再生しない (イシュー#387)
                    el.classList.remove('selected', 'show-pop');
                    el.style.borderLeft = '';
                } else {
                    if (el) removed++; // 既存要素はあったが内容が変わったので作り直す
                    el = this.createBookElement(book, this.currentView);
                    el.dataset.rkey = key;
                    el.dataset.dedupKey = dk; // イシュー#480
                    created++;
                }
                old.delete(dk);
                finalEls[idx] = el;
            }
            removed += old.size; // 新しい一覧に無い本
            moved = movedEstimate;
            // イシュー#401 案C (ADR-139): 並べ替えの時だけ段階描画。いま見えている所までを先に置き、
            // 残りは小分けにして後から足す (1回で913件を置くとレイアウトで固まるため)。置き終えた時の DOM は
            // 従来と同じ全件・並び順どおりで、ui:books-rendered は置き終えてから1回だけ出す。
            const head = this._listHeadCount(container, finalEls.length);
            if (head < finalEls.length) {
                container.replaceChildren(...finalEls.slice(0, head));
                this._startListTail(container, finalEls, head, created + removed + moved);
                return;
            }
            container.replaceChildren(...finalEls);
        } else {
            // イシュー#406 (②差し戻し): keepSet(LIS)に入っている本は、相対順序がもともと正しいので
            // 一切動かさない。前からcursorを比較する旧方式は、1件のズレ以降「次に来るべき要素」の
            // 判定を1個ずつの一致比較に頼っていたため、孤立要素や多数の局所的ズレがあると、
            // keep本であっても cursor と一致しなくなり連鎖した(406-results.md step3「custom順切替で
            // moved=787」の真因)。代わりに新しい並びを後ろから辿り、「直後に来る本の要素」を anchor
            // として持つ: keep本は anchor を自分に更新するだけ(動かさない)。非keep本(作り直し含む)は
            // insertBefore(el, anchor) で anchor の直前へ差す(=正しい位置に確定)。keep本の cursor 比較
            // が要らないので、挿入回数は必ず books.length-keepSet.size(=movedEstimate)に一致する。
            let anchor = null; // 末尾の次(末尾要素は insertBefore(el, null) = appendChild相当)
            for (let idx = books.length - 1; idx >= 0; idx--) {
                const book = books[idx];
                const dk = dedupKeys[idx];
                const key = this._bookCardKey(book, this.currentView);
                let el = old.get(dk);
                if (el && el.dataset.rkey === key) {
                    el.classList.add('bk-settled'); // 挿し直しで登場アニメを再生しない (イシュー#387)
                    el.classList.remove('selected', 'show-pop');
                    el.style.borderLeft = '';
                    old.delete(dk);
                    if (keepSet.has(idx)) { anchor = el; continue; } // 動かさない
                } else {
                    if (el) { old.delete(dk); el.remove(); removed++; }
                    el = this.createBookElement(book, this.currentView);
                    el.dataset.rkey = key;
                    el.dataset.dedupKey = dk; // イシュー#480
                    created++;
                }
                container.insertBefore(el, anchor);
                moved++;
                anchor = el;
            }
            // 残り (新しい一覧に無い本) を外す
            for (const el of old.values()) { el.remove(); removed++; }
        }
        // view 系プラグイン用: 一覧更新を従来どおり通知 (changed は加算情報・ADR-041)
        if (this.pluginAPI) this.pluginAPI._emit('ui:books-rendered', { view: this.currentView, changed: created + removed + moved });
    }

    // イシュー#401 案C (ADR-139): 段階描画で先に置く件数。並べ替え前の一覧で、画面の下端より上にある
    // カードの数 + 余裕分 (並べ替え前のレイアウトは確定済みなので読んでも追加の計算は起きない)。
    _listHeadCount(container, total) {
        const EXTRA = 24, MIN = 48;
        const items = container.children;
        const scroller = document.getElementById('view-bookshelf');
        const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
        // 画面下端より上にある最後のカードを二分探索で探す
        let lo = 0, hi = items.length - 1, last = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (items[mid].getBoundingClientRect().top < bottom) { last = mid; lo = mid + 1; } else hi = mid - 1;
        }
        return Math.min(total, Math.max(MIN, last + 1 + EXTRA));
    }

    _startListTail(container, finalEls, from, changed) {
        const CHUNK = 120;
        const tail = { container, finalEls, next: from, changed, timer: null };
        this._listTail = tail;
        const step = () => {
            if (this._listTail !== tail) return;
            const end = Math.min(finalEls.length, tail.next + CHUNK);
            container.append(...finalEls.slice(tail.next, end));
            tail.next = end;
            if (end >= finalEls.length) this._finishListTail(tail);
            else tail.timer = setTimeout(step, 0);
        };
        tail.timer = setTimeout(step, 0);
    }

    // 段階描画の残りを今すぐ全部置く (再描画・ドラッグ開始・1冊移動の前に呼ぶ)。途中で無ければ何もしない。
    _flushListTail() {
        const tail = this._listTail;
        if (!tail) return;
        clearTimeout(tail.timer);
        if (tail.next < tail.finalEls.length) tail.container.append(...tail.finalEls.slice(tail.next));
        tail.next = tail.finalEls.length;
        this._finishListTail(tail);
    }

    _finishListTail(tail) {
        if (this._listTail !== tail) return;
        this._listTail = null;
        if (this.pluginAPI) this.pluginAPI._emit('ui:books-rendered', { view: this.currentView, changed: tail.changed });
    }

    _cancelListTail() {
        const tail = this._listTail;
        if (!tail) return;
        clearTimeout(tail.timer);
        this._listTail = null;
    }

    renderStandardView(container) {
        this._cancelListTail();
        const booksToRender = this._orderedBooksToRender();

        // Phase H2-5: ページネーション廃止。全件を 1 リストで描画 (D&D がページを跨げる)。
        // Phase H2-7 改 (仮想化撤去 + content-visibility): JS 仮想化はスクロール時の再描画で
        // カクつくため廃止。画面外カードを CSS の content-visibility:auto (css: .book-item) で
        // ブラウザがレイアウト/描画を自動スキップ → ALL 約2400冊でも初期レイアウトが激減し、
        // スクロールも JS を介さずネイティブで滑らか。一括描画のままで OK。
        // ※ ソフトウェアレンダリング環境 (CI のヘッドレス等) では cv+大量要素でレンダラが
        //   詰まることがあるが、GPU 有効の実ブラウザでは問題なし。
        // 0 件のときは空状態を出す (絞り込み由来 / 空本棚 で出し分け)。真っ白を防ぐ。
        if (booksToRender.length === 0) {
            container.appendChild(this._buildBookshelfEmptyState());
            if (this.pluginAPI) this.pluginAPI._emit('ui:books-rendered', { view: this.currentView });
            return;
        }
        const frag = document.createDocumentFragment();
        const dedupKeys = this._dedupKeysFor(booksToRender); // イシュー#480: _renderListDiff が次回読む
        for (let idx = 0; idx < booksToRender.length; idx++) {
            const book = booksToRender[idx];
            const el = this.createBookElement(book, this.currentView);
            el.dataset.rkey = this._bookCardKey(book, this.currentView); // 段階④: 次回の差分更新で使い回す判定に使う
            el.dataset.dedupKey = dedupKeys[idx]; // イシュー#480
            frag.appendChild(el);
        }
        container.appendChild(frag);
        // view 系プラグイン用: 一覧描画完了を通知
        if (this.pluginAPI) this.pluginAPI._emit('ui:books-rendered', { view: this.currentView });
    }

    // 一覧 0 件のときの空状態。絞り込み中 / all が空 / 通常本棚が空 で文言と導線を変える。
    _buildBookshelfEmptyState() {
        const wrap = document.createElement('div');
        wrap.className = 'bookshelf-empty';
        const icon = (name) => (typeof window.renderIcon === 'function' ? window.renderIcon(name, { size: 32 }) : '');
        // プラグインフィルタが「原因で」0件になった時だけ絞り込み版を出す:
        // (a) コアフィルタ後は本があった (_countBeforePluginFilters > 0) かつ
        // (b) いずれかのプラグインが「フィルタ中」を申告している (解除導線が効く相手がいる)。
        // 本棚が元から空のケース ((a) が false) は通常の空状態に落とす。
        const pluginFilterActive = (this._countBeforePluginFilters || 0) > 0
            && !!(this.pluginAPI && typeof this.pluginAPI.isAnyFilterActive === 'function' && this.pluginAPI.isAnyFilterActive());
        const filterActive = !!this.searchQuery || (this.ratingFilter && this.ratingFilter.size > 0) || (this.kindleFilter && this.kindleFilter.size > 0) || pluginFilterActive;
        const shelf = this.userData.bookshelves?.find(b => b.id === this.currentBookshelf);
        const isAll = !this.currentBookshelf || (shelf && shelf.isSpecial);

        const head = (iconName, title, sub) => {
            const i = document.createElement('div'); i.className = 'bse-icon'; i.innerHTML = icon(iconName);
            const t = document.createElement('p'); t.className = 'bse-title'; t.textContent = title;
            const s = document.createElement('p'); s.className = 'bse-sub'; s.textContent = sub;
            wrap.append(i, t, s);
        };
        const action = (label, primary, fn) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-small`;
            b.textContent = label; b.addEventListener('click', fn); wrap.appendChild(b);
        };

        if (filterActive) {
            head('search-x', '条件に合う本がありません', '検索や評価の絞り込みを外すと表示されます。');
            action('絞り込みを解除', false, () => {
                this._resetFilters();
                this.applyFilters();
            });
        } else if (isAll) {
            head('book-plus', 'まだ本がありません', 'Kindle から取り込むか、ASIN を手動で追加すると、ここに本が並びます。');
            action('本を取り込む', true, () => this.showImportModal());
        } else {
            head('book-plus', `「${shelf ? shelf.name : 'この本棚'}」にはまだ本がありません`, '「すべての本」から本を選んで、この本棚に追加できます。');
            action('すべての本を見る', false, () => this.switchBookshelf('all'));
        }
        return wrap;
    }

    // イシュー#484: 同じ asin を持つ本のグループ (bookManager.findDuplicateAsinGroups()) を
    // asin → group の Map にしてキャッシュする。蔵書が変わらない限り再計算しない (#398 と同じ
    // _rev 方式)。データ構造は変えない(検出のみ)ため notes/bookOrder/exclusions 側には影響しない。
    _dupAsinInfo() {
        const rev = this.bookManager.getRev();
        if (this._dupAsinCache && this._dupAsinCache.rev === rev) return this._dupAsinCache.map;
        const map = new Map();
        for (const g of this.bookManager.findDuplicateAsinGroups()) map.set(g.asin, g);
        this._dupAsinCache = { rev, map };
        return map;
    }

    createBookElement(book, displayType) {
        const bookElement = document.createElement('div');
        bookElement.className = 'book-item';
        bookElement.dataset.asin = book.asin;

        bookElement.setAttribute('data-book-asin', book.asin);

        bookElement.classList.add('clickable');
        // 複数選択モード中は選択状態を維持
        if (this.selectMode && this.selectedAsins && this.selectedAsins.has(book.asin)) {
            bookElement.classList.add('selected');
        }

        // 描画は BookList (イシュー#523 U6) に寄せる。一覧カードの星・メモ表示は全体設定で制御。
        //  星: visibility (always/hover/hidden) + overlay (表紙に重ねる) boolean
        //  メモ: visibility (always/hover/hidden)
        //  hover は「表紙に重なるポップアップ」で表示し、行のスペースを取らず位置もずらさない。
        // リスト表示は表紙が小さいので overlay でも below 配置にフォールバック。
        bookElement.innerHTML = BookList.cardInnerHtml(book, {
            displayType,
            userNote: this.userData.notes[book.asin],
            // 一覧表示用メモ: ALL の短文メモ (2026-06-20: 本棚 override は廃止)
            listMemo: this.bookshelfManager.resolveMemo(book.asin),
            starVisibility: this._getStarVisibility(),
            starOverlay: this._getStarOverlay(),
            memoVisibility: this._getMemoVisibility(),
            starWidgetHtml: (asin, rating, size) => this._starWidgetHtml(asin, rating, size),
            formatMemo: (memo, maxLen) => this.formatMemoForDisplay(memo, maxLen),
            // イシュー#484: Kindleバッジに加え、重複ASIN検出バッジも同じ枠で出す
            dupGroup: this._dupAsinInfo().get(book.asin),
            hasCoverImage: (b) => this.bookManager.hasCoverImage(b),
            getProductImageUrl: (b) => this.bookManager.getProductImageUrl(b),
        });

        // Pointer Events drag (カスタム順のみ有効。drag-handle 上の pointerdown で起動)
        const dragHandle = bookElement.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.addEventListener('pointerdown', (e) => this._onBookPointerDown(e, bookElement));
        }

        bookElement.addEventListener('click', (e) => {
            // 長押しで pop を出した直後の click は抑制 (詳細を開かない)
            if (bookElement._suppressClick) {
                bookElement._suppressClick = false;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (e.target.closest('.drag-handle') || bookElement.classList.contains('dragging')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // 複数選択モード: クリックで選択トグル (詳細は開かない)
            if (this.selectMode) {
                e.preventDefault();
                e.stopPropagation();
                this._toggleBookSelected(book.asin, bookElement);
                return;
            }
            // 星クリックは評価変更 (詳細は開かない)。同じ星を再クリックで解除。
            const starEl = e.target.closest('.star-rating .star');
            if (starEl) {
                e.preventDefault();
                e.stopPropagation();
                const clicked = parseInt(starEl.dataset.rating) || 0;
                const cur = this.userData.notes[book.asin]?.rating || 0;
                const next = (clicked === cur) ? 0 : clicked;
                this.saveRating(book.asin, next);
                this._applyRatingEverywhere(book.asin, next);
                return;
            }
            // 本のどこをクリックしても詳細モーダル
            e.preventDefault();
            e.stopPropagation();
            this.showBookDetail(book);
        });
        
        return bookElement;
    }

    // ===== Pointer Events ドラッグ並べ替え (P4) =====
    // HTML5 Drag API を廃し、Pointer Events で実装。モバイル(touch)でも動作する。

    _onBookPointerDown(e, bookElement) {
        if (this.sortOrder !== 'custom') return;
        this._flushListTail(); // 段階描画の途中なら残りを置き切ってからドラッグを始める (#401)
        e.preventDefault();
        e.stopPropagation();

        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);

        this.draggedElement = bookElement;
        this.draggedASIN = bookElement.dataset.asin;
        bookElement.classList.add('dragging');
        bookElement._suppressClick = true;

        // ゴースト: 元要素を fixed clone して pointer に追従させる
        const rect = bookElement.getBoundingClientRect();
        const ghost = bookElement.cloneNode(true);
        ghost.className = 'book-item drag-ghost';
        ghost.style.cssText = [
            'position:fixed',
            `width:${rect.width}px`,
            `height:${rect.height}px`,
            `left:${rect.left}px`,
            `top:${rect.top}px`,
            'pointer-events:none',
            'z-index:9999',
            'opacity:0.78',
            'box-shadow:0 6px 24px rgba(0,0,0,.35)',
            'transition:none',
        ].join(';');
        document.body.appendChild(ghost);
        this._dragGhost = ghost;
        this._dragOffsetX = e.clientX - rect.left;
        this._dragOffsetY = e.clientY - rect.top;
        this._dragPointerY = e.clientY;
        this._lastDragOverTarget = null;

        this._boundPMove = (ev) => this._onBookPointerMove(ev);
        this._boundPUp   = (ev) => this._onBookPointerUp(ev);
        handle.addEventListener('pointermove',   this._boundPMove);
        handle.addEventListener('pointerup',     this._boundPUp);
        handle.addEventListener('pointercancel', this._boundPUp);
        this._dragHandle = handle;

        this._startBookDragAutoScroll();
    }

    _onBookPointerMove(e) {
        e.preventDefault();
        if (!this.draggedElement) return;

        // ゴーストをポインタに追従
        this._dragGhost.style.left = (e.clientX - this._dragOffsetX) + 'px';
        this._dragGhost.style.top  = (e.clientY - this._dragOffsetY) + 'px';
        this._dragPointerY = e.clientY;

        // ゴーストを一時非表示にして elementFromPoint でゴースト下の要素を得る
        this._dragGhost.style.display = 'none';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        this._dragGhost.style.display = '';

        const target = el && el.closest('.book-item');
        if (target && target !== this.draggedElement) {
            if (this._lastDragOverTarget && this._lastDragOverTarget !== target) {
                this._lastDragOverTarget.style.borderLeft = '';
            }
            target.style.borderLeft = '3px solid var(--accent)';
            this._lastDragOverTarget = target;
        } else if (!target && this._lastDragOverTarget) {
            this._lastDragOverTarget.style.borderLeft = '';
            this._lastDragOverTarget = null;
        }
    }

    _onBookPointerUp(e) {
        if (!this.draggedElement) return;
        if (this._lastDragOverTarget && this._lastDragOverTarget !== this.draggedElement) {
            const targetASIN = this._lastDragOverTarget.dataset.asin;
            this.reorderBooks(this.draggedASIN, targetASIN);
        }
        this._cancelBookPointerDrag();
    }

    _cancelBookPointerDrag() {
        if (this.draggedElement) this.draggedElement.classList.remove('dragging');
        if (this._dragGhost) { this._dragGhost.remove(); this._dragGhost = null; }
        if (this._lastDragOverTarget) { this._lastDragOverTarget.style.borderLeft = ''; this._lastDragOverTarget = null; }
        document.querySelectorAll('.book-item').forEach(item => { item.style.borderLeft = ''; });
        if (this._dragHandle) {
            this._dragHandle.removeEventListener('pointermove',   this._boundPMove);
            this._dragHandle.removeEventListener('pointerup',     this._boundPUp);
            this._dragHandle.removeEventListener('pointercancel', this._boundPUp);
            this._dragHandle = null;
        }
        this.draggedElement = null;
        this.draggedASIN = null;
        this._stopBookDragAutoScroll();
    }

    // ===== Phase H2-5: 本D&Dの端オートスクロール =====
    // .view-bookshelf (スクロール容器) の上下端付近にポインタが来たら自動スクロール。
    _bookScrollContainer() {
        return document.querySelector('.view-bookshelf');
    }

    _startBookDragAutoScroll() {
        if (this._dragRAF) return; // 二重起動防止
        const EDGE = 90, MAX = 20;
        const step = () => {
            if (!this.draggedElement) { this._dragRAF = null; return; }
            const scroller = this._bookScrollContainer();
            if (!scroller) { this._dragRAF = null; return; }
            const r = scroller.getBoundingClientRect();
            const y = this._dragPointerY || 0;
            let dy = 0;
            if (y < r.top + EDGE)         dy = -Math.ceil(MAX * Math.min(1, (r.top + EDGE - y) / EDGE));
            else if (y > r.bottom - EDGE) dy =  Math.ceil(MAX * Math.min(1, (y - (r.bottom - EDGE)) / EDGE));
            if (dy) scroller.scrollTop += dy;
            this._dragRAF = requestAnimationFrame(step);
        };
        this._dragRAF = requestAnimationFrame(step);
    }

    _stopBookDragAutoScroll() {
        if (this._dragRAF) { cancelAnimationFrame(this._dragRAF); this._dragRAF = null; }
    }

    // ===== Pointer Events 汎用ドラッグ並べ替え (P4残り, イシュー#337) =====
    // 本体は js/ui/reorder.js (Reorder.bindPointerReorder) へ移した (イシュー#517 U4・移すだけ)。
    // サイドバーツリー・ヘッダーutility行・プラグインカード・本棚管理モーダル・bd-section・
    // ホームのウィジェット(js/dashboard.js)の6か所は、このメソッドを呼ぶだけで変更不要。
    // opts の形は js/ui/reorder.js 冒頭のコメントを参照。
    _bindPointerReorder(container, opts) {
        window.Reorder.bindPointerReorder(container, opts);
    }

    // indexモード用: 縦1列のリストで clientY のみを見て挿入位置を返す汎用ヘルパー
    // (ヘッダーutility行は「同じ行で左寄り」判定が要るため個別の computeInsertIndex を使う)
    _computeInsertIndexByY(container, itemSelector, clientY) {
        const items = Array.from(container.querySelectorAll(itemSelector));
        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (clientY < r.top + r.height / 2) return i;
        }
        return items.length;
    }

    reorderBooks(draggedASIN, targetASIN) {
        const currentBookshelfId = this.currentBookshelf || 'all';
        if (!this.userData.bookOrder) this.userData.bookOrder = {};

        // 二重管理の解消 (Phase H2-8 再): 並び順の「正本」を 1 つに統一する。
        //   非ALL本棚 → shelf.books が正本 (同期 <slug>.json に書かれ、読込時 bookOrder[slug]=books に復元)
        //   ALL       → bookOrder.all が正本 (同期 all.json.books に書かれる)
        // 旧実装は描画用 bookOrder[slug] だけ更新し shelf.books を放置 → GitHub/ローカルFS の
        // 読込で bookOrder[slug] が shelf.books に上書きされ並び替えが消えていた。
        // ここでは「現在の表示順」を起点に移動を適用し、shelf.books と bookOrder[slug] の
        // 両方へ同じ配列を書き戻して齟齬をゼロにする (初回の表示ジャンプも防ぐ)。
        const shelf = this.userData.bookshelves?.find(b => b.id === currentBookshelfId);
        const useShelfBooks = !!(shelf && !shelf.isSpecial);

        // 起点 = 現在の表示順 (bookOrder[slug] があればそれ、無ければ filteredBooks)
        const prev = this.userData.bookOrder[currentBookshelfId];
        let order = (Array.isArray(prev) && prev.length)
            ? [...prev]
            : this.filteredBooks.map(b => b.asin);

        // 非ALLは shelf.books のメンバーに正規化 (表示順を保ちつつ非メンバー除去・漏れ補完)
        if (useShelfBooks && Array.isArray(shelf.books) && shelf.books.length) {
            const memberSet = new Set(shelf.books);
            order = order.filter(a => memberSet.has(a));
            for (const a of shelf.books) if (!order.includes(a)) order.push(a);
        }

        // draggedASIN を targetASIN の直前へ移動
        if (!order.includes(draggedASIN)) order.push(draggedASIN);
        order.splice(order.indexOf(draggedASIN), 1);
        const ti = order.indexOf(targetASIN);
        if (ti !== -1) order.splice(ti, 0, draggedASIN);
        else order.push(draggedASIN);

        // 正本へ書き戻し + 描画用を完全一致 (齟齬ゼロ)
        if (useShelfBooks) shelf.books = [...order];
        this.userData.bookOrder[currentBookshelfId] = [...order];

        // Switch to custom order automatically when manually reordering
        this.sortOrder = 'custom';
        const sortSel = document.getElementById('sort-order');
        if (sortSel) sortSel.value = 'custom';
        // 直後の saveUserData() が settings ごと保存するので、ここでは値の更新だけ
        if (this.userData.settings) this.userData.settings.sortOrder = 'custom';

        // Save and refresh display
        this.saveUserData();
        // イシュー#359 段階①: 動かした1冊だけ DOM 上で移す (全件作り直しは約365ms)。移せない時だけ従来どおり作り直す。
        // 一覧の更新としてプラグインには従来どおり ui:books-rendered を通知する (changed は加算情報・ADR-041)。
        if (this._moveBookElement(draggedASIN, targetASIN)) {
            if (this.pluginAPI) this.pluginAPI._emit('ui:books-rendered', { view: this.currentView, changed: 1 });
        } else {
            this.updateDisplay();
        }
    }










    // ALL スコープのフラグ (hideMemo / hideDetailMemo / hasDetailMemo)
    async _toggleAllNoteFlag(asin, flag, value) {
        if (!this.userData.notes) this.userData.notes = {};
        if (!this.userData.notes[asin]) this.userData.notes[asin] = {};
        if (value) {
            this.userData.notes[asin][flag] = true;
        } else {
            delete this.userData.notes[asin][flag];
            // memo / rating / hasDetailMemo を保持しているなら entry は消さない
            const n = this.userData.notes[asin];
            if (!n.memo && !n.rating && !n.hasDetailMemo && Object.keys(n).length === 0) {
                delete this.userData.notes[asin];
            }
        }
        await this.saveUserData();
    }

    // saveNote(asin, memo) — 短文メモは ALL 1段 (2026-06-20: 本棚 override 廃止)。余分な scope 引数は無視。
    async saveNote(asin, memo) {
        this.bookshelfManager.setMemo(asin, memo);
        await this.saveUserData();
        if (this.pluginAPI) this.pluginAPI._emit('note:updated', { asin, note: this.userData.notes?.[asin] || { memo } });
    }



    updateStats() {
        const el = document.getElementById('total-books');
        if (el) el.textContent = this.books.length.toLocaleString();
    }



    setupPagination() {
        // Phase H2-5: ページネーション廃止 (全件 1 リスト)。互換のため呼出は受けるが常に空。
        const pagination = document.getElementById('pagination');
        if (pagination) pagination.innerHTML = '';
    }

    goToPage(page) {
        // Phase H2-5: ページ概念を廃止 (互換 no-op)。
        this.currentPage = 1;
        this.updateDisplay();
    }

    createDefaultUserData() {
        return {
            exportDate: new Date().toISOString(),
            bookshelves: [],
            notes: {},
            settings: this.getDefaultSettings(),
            bookOrder: {},
            stats: { totalBooks: 0, notesCount: 0 },
            version: '2.0'
        };
    }

    getDefaultSettings() {
        return {
            defaultView: 'covers',
            showHighlights: true,
            currentBookshelf: 'all',
            theme: 'light',
            booksPerPage: 50,
            showImagesInOverview: true
        };
    }

    /**
     * ユーザデータの保存。localStorage は即時、Obsidian 同期は debounce してバックグラウンドで実行。
     *
     * 設計意図:
     *   - 編集 → サイレント sync で UI が再描画されモーダルやフォームが閉じる問題を回避
     *   - 連続操作 (複数プラグイン有効化、メモ高速入力など) を 1 回の I/O にまとめる
     *   - await で呼ばれてもブロックしない（同期はバックグラウンドで進む）
     *   - ページ離脱時は _flushPendingSync() で残り分を強制実行（beforeunload）
     *
     * 呼び出し側で「sync 完了を待ちたい」（例: copyToPublic 直前）場合は
     * 明示的に await this.flushSync() を呼ぶ。
     */
    // --- 端末ごとの設定と、共通設定・並び順の更新時刻 (イシュー#387・ADR-137) ---

    /** 端末ごとの設定を localStorage から読む。無ければ fallback (共通設定) の該当キーを写して保存する (初回移行) */
    _loadDeviceSettings(fallback) {
        let dev = null;
        try { dev = JSON.parse(localStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY) || 'null'); } catch (e) { dev = null; }
        if (!dev || typeof dev !== 'object') {
            dev = {};
            DEVICE_SETTING_KEYS.forEach(k => { if (fallback && fallback[k] !== undefined) dev[k] = fallback[k]; });
            try { localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(dev)); } catch (e) {}
        }
        return dev;
    }

    /** settings から端末ごとのキーを除いたもの (同期先へ書く共通設定) */
    _commonSettings(settings) {
        const out = { ...(settings || {}) };
        DEVICE_SETTING_KEYS.forEach(k => { delete out[k]; });
        return out;
    }

    /** 更新時刻の比較元を控える (読込・同期読込の直後に呼ぶ) */
    _snapshotSyncedState() {
        const st = this.userData && this.userData.settings ? this._commonSettings(this.userData.settings) : {};
        delete st._updatedAt;
        const snap = {};
        Object.keys(st).forEach(k => { snap[k] = JSON.stringify(st[k]); });
        const bo = (this.userData && this.userData.bookOrder) || {};
        Object.keys(bo).forEach(id => { snap['bookOrder:' + id] = JSON.stringify(bo[id]); });
        this._syncedSnap = snap;
    }

    /** 前回の控えから変わった共通設定・本棚の並び順に更新時刻を付ける */
    _stampChangedKeys() {
        if (!this.userData) return;
        if (!this.userData.settings) this.userData.settings = {};
        const prev = this._syncedSnap || {};
        const ts = { ...(this.userData.settings._updatedAt || {}) };
        const now = Date.now();
        const st = this._commonSettings(this.userData.settings);
        delete st._updatedAt;
        Object.keys(st).forEach(k => { if (prev[k] !== JSON.stringify(st[k])) ts[k] = now; });
        const bo = this.userData.bookOrder || {};
        Object.keys(bo).forEach(id => { if (prev['bookOrder:' + id] !== JSON.stringify(bo[id])) ts['bookOrder:' + id] = now; });
        this.userData.settings._updatedAt = ts;
        this._snapshotSyncedState();
    }

    // opts.deviceOnly: 端末ごとの見た目の好みだけを変えた時。localStorage には残すが同期は走らせない
    // (同期先へ書く内容が変わらないのに全ファイルを送り直さない・開いたままの別端末の古い内容で上書きしない。イシュー#387)
    async saveUserData(opts = {}) {
        this._stampChangedKeys();
        // 端末ごとの設定は localStorage の専用キーへ (同期しない)
        try {
            const dev = {};
            DEVICE_SETTING_KEYS.forEach(k => { if (this.userData.settings && this.userData.settings[k] !== undefined) dev[k] = this.userData.settings[k]; });
            localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(dev));
        } catch (e) {}
        const persisted = { ...this.userData };
        if (persisted._storage) {
            const { libraryBooks, ...rest } = persisted._storage;
            persisted._storage = rest;
        }
        try {
            localStorage.setItem('virtualBookshelf_userData', JSON.stringify(persisted));
        } catch (e) {
            console.error('localStorage 保存失敗:', e);
        }
        if (opts.deviceOnly) return;
        if (this._isSyncReady()) {
            this._scheduleSync();
        }
    }

    /** 同期方式に応じて「書き込み可能か」を返す (LocalFS=handle 有り / GitHub・ハブ=adapter 接続済み) */
    _isSyncReady() {
        if (this.syncMethod === 'github' || this.syncMethod === 'hub') {
            return this.storage && this.storage.adapter && this.storage.adapter.isConnected && this.storage.adapter.isConnected();
        }
        return !!this.obsidianDirHandle;
    }

    /**
     * Obsidian 同期をスケジュール（debounce）
     */
    _scheduleSync() {
        this._pendingSync = true;
        // 未同期のローカル編集があることを永続化（リロード/crash を跨いで残す）。
        // 同期が成功するまで消さない → 次回読込時にローカル優先で復元できる。
        try { localStorage.setItem('virtualBookshelf_pendingSync', '1'); } catch (e) {}
        if (this._syncDebounceTimer) clearTimeout(this._syncDebounceTimer);
        const delay = this._syncDebounceMs || 800;
        this._syncDebounceTimer = setTimeout(() => {
            this._syncDebounceTimer = null;
            this._runPendingSync();
        }, delay);
    }

    async _runPendingSync() {
        if (this._syncInProgress) {
            // 既に進行中。完了後にもう一度走らせるため pending を残す
            this._pendingSync = true;
            return;
        }
        if (!this._pendingSync) return;
        this._pendingSync = false;
        this._syncInProgress = true;
        try {
            await this._ensureFreshGitHubToken();
            await this._syncWithAuthRetry();
            // 保存成功 → 同期エラー解消
            if (this._syncError) { this._syncError = false; this._syncErrorMsg = ''; this._updateStatusBar(); }
        } catch (e) {
            console.error('Obsidian同期エラー:', e);
            // 保存失敗 (トークン失効・ハンドル喪失等) を上部バーに出す
            this._syncError = true;
            if (this.syncMethod === 'github') {
                this._syncErrorMsg = (typeof GitHubAuthError !== 'undefined' && e instanceof GitHubAuthError)
                    ? 'GitHub の認証が切れました。設定から再接続してください。'
                    : 'GitHub への保存に失敗しました。再接続が必要かもしれません。';
            } else if (this.syncMethod === 'hub') {
                // 容量超過・認証失効はメッセージをそのまま見せる (ユーザ対処可能)
                this._syncErrorMsg = (typeof HubQuotaError !== 'undefined' && e instanceof HubQuotaError)
                    ? 'ハブの保存容量がいっぱいです。不要なデータを減らすか、Plus へのアップグレードをご検討ください。'
                    : (typeof HubAuthError !== 'undefined' && e instanceof HubAuthError)
                        ? 'Asayake ハブの認証が切れました。設定から再ログインしてください。'
                        : 'Asayake ハブへの保存に失敗しました。通信環境や接続をご確認ください。';
            } else {
                this._syncErrorMsg = '保存先への書き込みに失敗しました。同期設定を確認してください。';
            }
            this._updateStatusBar();
        } finally {
            this._syncInProgress = false;
            // 進行中に再要求されていれば再度実行
            if (this._pendingSync) {
                this._scheduleSync();
            } else if (this._lastSyncOk) {
                // 同期が成功し、保留も無くなったので未同期フラグを解除
                try { localStorage.removeItem('virtualBookshelf_pendingSync'); } catch (e) {}
            }
        }
    }

    /**
     * 同期完了まで待つ。debounce タイマーをキャンセルして即実行。
     * 公開エクスポート前など「ファイルに反映済みを保証したい」場面で呼ぶ。
     */
    async flushSync() {
        if (this._syncDebounceTimer) {
            clearTimeout(this._syncDebounceTimer);
            this._syncDebounceTimer = null;
        }
        if (this._pendingSync || this._syncInProgress) {
            // pending を確実に処理してから完了待ち
            await this._runPendingSync();
            // 進行中だった場合、終わるまで待つ
            while (this._syncInProgress) {
                await new Promise(r => setTimeout(r, 50));
            }
            if (this._pendingSync) {
                await this._runPendingSync();
            }
        }
    }

    // --- Sync method dispatching (LocalFS / GitHub / ...) ---

    async initSync() {
        if (this.syncMethod === 'github') {
            await this.initGitHubSync();
        } else if (this.syncMethod === 'hub') {
            await this.initCloudSync('hub');
        } else {
            await this.initObsidianSync();
        }
    }

    // クラウド同期の初期化 (GitHub と同型: loadAll → 適用、空なら initEmpty)。現状は Asayake ハブ専用。
    async initCloudSync(method) {
        const adapter = this.storage.adapter;
        if (!(adapter instanceof HubStorageAdapter)) {
            console.warn(`initCloudSync(${method}): adapter type mismatch`);
            return;
        }
        const label = 'Asayake ハブ';
        const svc = 'Asayake ハブ';
        this.updateSyncStatus('loading', label);
        try {
            const format = await this.storage.detectFormat();
            if (format === 'empty') {
                // 別端末からの再ログイン直後などにハブが空に見えても、無確認で初期化しない
                // (GitHub と対称。誤って既存アカウントを空データで上書きする事故を防ぐ)。
                // イシュー#519: confirmDialog は overlay-manager のダイアログ帯 (--ov-z-dialog) に
                // 載るため、起動中のローディング表示より常に前面に出る (z-index実測・docs/char/boot-flow.md §2)。
                this.updateSyncStatus('reconnect', `${label} (空)`);
                const ok = await window.confirmDialog({ message: `${label} には保存データがありません。\n新規データで初期化しますか？\n（別の端末・アカウントのデータがある場合はキャンセルし、ログイン先を確認してください）` });
                if (!ok) {
                    // 初期化せず中断。接続済みのまま放置すると次回 save で手元の古いデータが
                    // 空ハブへ上書きされる恐れがあるため、目立つ警告を出して状態を error にする。
                    this._syncError = true;
                    this._syncErrorMsg = `${svc} は空です。初期化していません。設定でログイン先を確認してください（このまま編集すると空のハブに上書きされる恐れがあります）。`;
                    this._updateStatusBar();
                    return;
                }
                await this.storage.initEmpty();
            } else if (format === 'pre-notes-split') {
                await this.storage.migrateNotesSplit();
            } else if (format === 'legacy') {
                await this.storage.migrateFromLegacy();
            }
            const state = await this.storage.loadAll();
            const fpBefore = this._renderFingerprint();
            const loaded = this._applyLoadedState(state);
            // イシュー#359 段階①: 同期先の内容が手元と同じなら一覧を作り直さない (800冊で約350ms・裏で走ると
            // スクロール位置や操作中の状態が飛ぶ)。変わった時は従来どおり全件 (差分描画は段階④)。
            if (loaded && fpBefore !== this._renderFingerprint()) {
                this.updateDisplay();
                this.updateStats();
                this.updateBookshelfSelector();
                this.renderBookshelfOverview();
            }
            this.updateSyncStatus('synced', label);
            // ハブは保存のたびに usedBytes が変わる → 読込後に使用量バーを更新
            if (method === 'hub') this._refreshHubUsage().catch(() => {});
        } catch (e) {
            console.error(`initCloudSync(${method}):`, e);
            this.updateSyncStatus('reconnect', label);
            this._syncError = true;
            const isAuthErr = (e && e.name === 'HubAuthError');
            this._syncErrorMsg = isAuthErr
                ? `${svc} の認証が切れました。設定から再接続してください。`
                : `${svc} からの読み込みに失敗しました。`;
            this._updateStatusBar();
        }
    }

    /**
     * GitHub の access_token が失効間近 (10 分前) なら refresh して差し替える。
     * - 同時実行ガード: 進行中の refresh があれば同じ Promise を待つ (二重 refresh 防止。
     *   refresh_token はローテーションするため、二重実行は片方を失効させる)
     * - 後方互換: 旧接続 (refreshToken なし) は refresh せず true を返し、
     *   401 時の再接続誘導に委ねる
     * @param {object} [options]
     * @param {boolean} [options.force] 期限に関わらず refresh する (401 フォールバック用)
     * @returns {Promise<boolean>} false = refresh を試みて失敗 (再接続が必要)
     */
    async _ensureFreshGitHubToken({ force = false, forPublish = false } = {}) {
        // 公開先=GitHub のとき (forPublish) は同期方式が github 以外でもトークンを更新する
        if (this.syncMethod !== 'github' && !forPublish) return true;
        if (this._tokenRefreshPromise) return this._tokenRefreshPromise;
        const gh = (SyncConfigManager.load().github) || {};
        if (!gh.refreshToken) return !force; // 旧接続: refresh 不可。force 時は失敗扱い
        const needsRefresh = force
            || (gh.tokenExpiresAt && Date.now() > gh.tokenExpiresAt - 10 * 60 * 1000);
        if (!needsRefresh) return true;
        this._tokenRefreshPromise = (async () => {
            try {
                const r = await GitHubDeviceAuth.refreshAccessToken(gh.refreshToken);
                const merged = SyncConfigManager.load();
                merged.github = {
                    ...(merged.github || {}),
                    token: r.token,
                    refreshToken: r.refreshToken,
                    tokenExpiresAt: r.tokenExpiresAt,
                    refreshTokenExpiresAt: r.refreshTokenExpiresAt
                };
                SyncConfigManager.save(merged);
                this.syncConfig = merged;
                const adapter = this.storage && this.storage.adapter;
                if (adapter instanceof GitHubAdapter) adapter.setToken(r.token);
                console.info('GitHub token refreshed');
                return true;
            } catch (e) {
                console.error('GitHub token refresh failed:', e.message);
                this._syncError = true;
                this._syncErrorMsg = 'GitHub の認証が切れました。設定から再接続してください。';
                this._updateStatusBar();
                return false;
            } finally {
                this._tokenRefreshPromise = null;
            }
        })();
        return this._tokenRefreshPromise;
    }

    /**
     * 同期を実行し、401 (トークン失効) なら refresh を 1 回だけ試してリトライする。
     */
    async _syncWithAuthRetry() {
        try {
            await this.syncToObsidianFolder();
        } catch (e) {
            if (this.syncMethod === 'github' && e instanceof GitHubAuthError) {
                const refreshed = await this._ensureFreshGitHubToken({ force: true });
                if (refreshed) {
                    await this.syncToObsidianFolder(); // リトライは 1 回だけ (無限リトライ禁止)
                    return;
                }
            }
            throw e;
        }
    }

    async initGitHubSync() {
        const adapter = this.storage.adapter;
        if (!(adapter instanceof GitHubAdapter)) {
            console.warn('initGitHubSync: storage adapter is not GitHubAdapter');
            return;
        }
        await this._ensureFreshGitHubToken();
        const label = `${adapter.owner}/${adapter.repo}@${adapter.branch}`;
        this.updateSyncStatus('loading', label);
        try {
            const format = await this.storage.detectFormat();
            if (format === 'empty') {
                // イシュー#519: confirmDialog は overlay-manager のダイアログ帯 (--ov-z-dialog) に
                // 載るため、起動中のローディング表示より常に前面に出る (z-index実測・docs/char/boot-flow.md §2)。
                this.updateSyncStatus('reconnect', `${label} (空)`);
                const ok = await window.confirmDialog({ message: `GitHub リポジトリ ${label} は空です。\n新規データで初期化しますか？` });
                if (!ok) return;
                await this.storage.initEmpty();
            } else if (format === 'pre-notes-split') {
                await this.storage.migrateNotesSplit();
            } else if (format === 'legacy') {
                await this.storage.migrateFromLegacy();
            }
            const state = await this.storage.loadAll();
            const fpBefore = this._renderFingerprint();
            const loaded = this._applyLoadedState(state);
            // イシュー#359 段階①: 同期先の内容が手元と同じなら一覧を作り直さない (800冊で約350ms・裏で走ると
            // スクロール位置や操作中の状態が飛ぶ)。変わった時は従来どおり全件 (差分描画は段階④)。
            if (loaded && fpBefore !== this._renderFingerprint()) {
                this.updateDisplay();
                this.updateStats();
                this.updateBookshelfSelector();
                this.renderBookshelfOverview();
            }
            this.updateSyncStatus('synced', label);
        } catch (e) {
            console.error('initGitHubSync:', e);
            this.updateSyncStatus('reconnect', label);
            if (e instanceof GitHubAuthError) {
                toast('GitHub との接続に失敗しました。\n「切断」してから、もう一度「GitHub に接続」をお試しください。');
            } else {
                // 失敗しても画面は直前の手元データのまま(起動2段化・C-277、loadData()が先に描画済み)。
                // エラー文言だけだと「表示が壊れているのでは」という不安を招くため、「今表示しているのは
                // 手元のデータであること」と「再試行できること」を併せて出す
                // (ui-standards §2-11「失敗を無言にしない・何が起きたか+次にどうすればよいかの2要素」・イシュー#391 E案)。
                toast('手元のデータで表示中です。GitHub からの読み込みに失敗しました。', {
                    type: 'error',
                    action: { label: '再試行', onClick: () => this.initGitHubSync() },
                    duration: 10000
                });
            }
        }
    }

    // ===== 記事の通報 (ADR-099・全件手動審査) =====
    // 公開記事フッタの「通報」リンクは https://asayake.org/bookshelf/?report=<記事URL>。ルーターはハッシュ専用のため query は衝突しない。
    // 初めてアプリを開く人は SW 初回登録の controllerchange で自動リロードされる (index.html の swRefreshing)。
    // ?report= は URL から除去済みなのでリロードでダイアログが消える → sessionStorage に退避し、閉じるまで起動時に開き直す。
    _handleReportParam() {
        if (this._reportParamHandled) return;
        let params;
        try { params = new URLSearchParams(location.search); } catch (_) { return; }
        let target = params.get('report');
        if (target) {
            this._pendingReportSet(target);
            try {   // 閉じた後のリロードで再表示しない。段階③: 台帳の写し (history.state) は保つ (H4)
                params.delete('report');
                const qs = params.toString();
                history.replaceState(this.nav ? history.state : null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
            } catch (_) {}
        } else {
            target = this._pendingReportGet();
        }
        if (!target) return;
        this._reportParamHandled = true;
        this.openReportModal(target);
    }

    // 通報対象の退避 (sessionStorage・タブ限り)。TTL 内かつダイアログを閉じる前のリロードだけを救う。
    _pendingReportSet(url) {
        try { sessionStorage.setItem('bookshelf.pendingReport', JSON.stringify({ url, at: Date.now() })); } catch (_) {}
    }

    _pendingReportGet() {
        try {
            const v = JSON.parse(sessionStorage.getItem('bookshelf.pendingReport') || 'null');
            return v && typeof v.url === 'string' && Date.now() - v.at < 10 * 60 * 1000 ? v.url : null;
        } catch (_) { return null; }
    }

    _pendingReportClear() {
        try { sessionStorage.removeItem('bookshelf.pendingReport'); } catch (_) {}
    }

    async openReportModal(articleUrl) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) {
            await this._confirmOpenSettings('通報には Asayake アカウントへのログインが必要です。設定の「アカウント」でログインしてから、もう一度通報のリンクを開いてください。', 'account-section');
            this._pendingReportClear();   // 案内が解決するまでは残す (案内表示中のリロードで再表示するため)
            return;
        }
        const url = String(articleUrl || '').trim();
        if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 500) { this._pendingReportClear(); toast('通報の対象を読み取れませんでした。記事のページから、もう一度リンクを開いてください。', { type: 'error' }); return; }
        const modal = document.getElementById('report-modal');
        if (!modal) { this._pendingReportClear(); return; }
        this._reportTarget = url;
        document.getElementById('report-target-url').textContent = url;
        document.getElementById('report-category').value = '';
        document.getElementById('report-reason').value = '';
        this._setReportError('');
        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this._surface().open('report-modal', { close: (o) => this._formBackGuard('report-modal', o, (oo) => this.closeReportModal(oo)), extra: { url } });
        this._formSnapTake('report-modal');
    }

    closeReportModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('report-modal');
        this._overlays().close('report-modal', { reason: fromHistory ? 'history' : 'button' });
        this._pendingReportClear();
        this._surface().close('report-modal', { fromHistory });
    }

    _setReportError(msg) {
        const el = document.getElementById('report-error');
        if (!el) return;
        el.textContent = msg || '';
        el.hidden = !msg;
    }

    async _submitReport() {
        const hub = (SyncConfigManager.load().hub) || {};
        const category = (document.getElementById('report-category') || {}).value || '';
        const reason = ((document.getElementById('report-reason') || {}).value || '').trim();
        if (!(hub.key && hub.apiBase)) { this._setReportError('ログインが切れています。設定の「アカウント」でログインし直してください。'); return; }
        if (!category) { this._setReportError('通報の種類を選んでください。'); return; }
        const btn = document.getElementById('report-submit');
        if (btn) btn.disabled = true;   // 二度押し防止 (ui-standards §2-6)
        this._setReportError('');
        try {
            const res = await fetch(`${hub.apiBase}/community/report`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ articleUrl: this._reportTarget, category, reason })
            });
            if (res.status === 404) { this._setReportError('対象の記事が見つかりませんでした。すでに一覧から外れているか、ハブで公開された記事ではありません。'); return; }
            if (res.status === 429) { this._setReportError('本日の通報の上限に達しました。明日もう一度お試しください。'); return; }
            if (res.status === 401) { this._setReportError('ログインが切れています。設定の「アカウント」でログインし直してください。'); return; }
            if (res.status === 400) { this._setReportError('この記事は通報できません（自分の記事、または入力の不備です）。'); return; }
            if (!res.ok) { this._setReportError('通報を送れませんでした。時間をおいて、もう一度お試しください。'); return; }
            const data = await res.json().catch(() => ({}));
            this.closeReportModal();
            toast(data.duplicate ? 'この記事はすでに通報済みです。' : '通報を受け付けました。返信はしませんが、内容を確認します。', { type: 'success' });
        } catch (e) {
            console.error('通報の送信に失敗:', e);
            this._setReportError('通報を送れませんでした。通信状況を確認して、もう一度お試しください。');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 管理者: 通報の審査パネル (設定→管理者・#409)。一覧・一覧から外す・一覧に戻す・却下。
    async _loadReportReview() {
        const hub = (SyncConfigManager.load().hub) || {};
        const list = document.getElementById('report-review-list');
        if (!list || !(hub.key && hub.apiBase)) return;
        this._reportReviewLoadedAt = Date.now();
        try {
            const res = await fetch(`${hub.apiBase}/admin/reports?status=open`, { headers: { 'Authorization': `Bearer ${hub.key}` } });
            if (!res.ok) throw new Error(String(res.status));
            this._renderReportReview(await res.json());
        } catch (e) {
            this._reportReviewLoadedAt = 0;
            list.textContent = '通報の一覧を読み込めませんでした。「一覧を更新」でもう一度お試しください。';
        }
    }

    _renderReportReview(data) {
        const list = document.getElementById('report-review-list');
        if (!list) return;
        const LABEL = { spam: 'スパム', abuse: '誹謗中傷', illegal: '違法', discrimination: '差別', dead: 'リンク切れ', other: 'その他' };
        list.textContent = '';
        const mk = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
        const item = (a, hiddenItem) => {
            const row = mk('div', 'report-item');
            row.dataset.articleId = a.articleId;
            const t = mk('div', 'report-item-title');
            const link = mk('a', '', a.title || a.url);
            link.href = a.url; link.target = '_blank'; link.rel = 'noopener';
            t.appendChild(link);
            row.appendChild(t);
            if (hiddenItem) row.appendChild(mk('div', 'report-item-meta', '一覧から外し中'));
            else {
                const cats = Object.entries(a.categories || {}).map(([k, n]) => `${LABEL[k] || k} ${n}`).join('・');
                row.appendChild(mk('div', 'report-item-meta', `通報 ${a.count} 件（${cats}）`));
                if (a.latestReason) row.appendChild(mk('div', 'report-item-reason', a.latestReason));
            }
            const actions = mk('div', 'report-item-actions');
            const add = (act, label, cls) => {
                const b = mk('button', `btn ${cls} btn-small`, label);
                b.type = 'button'; b.dataset.act = act; b.dataset.articleId = a.articleId;
                if (a.reportIds) b.dataset.reportIds = a.reportIds.join(',');
                actions.appendChild(b);
            };
            if (hiddenItem) add('restore', '一覧に戻す', 'btn-secondary');
            else { add('hide', '一覧から外す', 'btn-danger'); add('dismiss', '却下', 'btn-secondary'); }
            row.appendChild(actions);
            return row;
        };
        const reports = data.reports || [], hidden = data.hidden || [];
        if (!reports.length && !hidden.length) { list.appendChild(mk('p', 'account-admin-hint', '未対応の通報はありません。')); return; }
        for (const a of reports) list.appendChild(item(a, false));
        for (const h of hidden) list.appendChild(item(h, true));
    }

    async _reportReviewAct(btn) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) return;
        const act = btn.dataset.act, id = btn.dataset.articleId;
        const call = (path) => fetch(`${hub.apiBase}${path}`, { method: 'POST', headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' }, body: '{}' });
        const row = btn.closest('.report-item');
        row.querySelectorAll('button').forEach(b => { b.disabled = true; });   // 二度押し防止
        try {
            if (act === 'dismiss') {
                for (const rid of (btn.dataset.reportIds || '').split(',').filter(Boolean)) {
                    const r = await call(`/admin/reports/${encodeURIComponent(rid)}/dismiss`);
                    if (!r.ok) throw new Error(String(r.status));
                }
            } else {
                const r = await call(`/admin/articles/${encodeURIComponent(id)}/${act === 'hide' ? 'hide' : 'restore'}`);
                if (!r.ok) throw new Error(String(r.status));
            }
            toast(act === 'hide' ? '記事を一覧から外しました。' : (act === 'restore' ? '記事を一覧に戻しました。' : '通報を却下しました。'), { type: 'success' });
            await this._loadReportReview();
        } catch (e) {
            console.error('通報の審査操作に失敗:', e);
            toast('操作できませんでした。時間をおいて、もう一度お試しください。', { type: 'error' });
            row.querySelectorAll('button').forEach(b => { b.disabled = false; });
        }
    }

    // 管理者: 対象アカウント (メール指定) のプランを Stripe を経由せず切替える (ADR-038)。
    // 自分が管理者のときだけ UI が出る。サーバ側でも ADMIN_EMAILS で再検証される。
    async _adminSetPlan(plan, reset = false) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('先にログインしてください。', { type: 'warn' }); return; }
        const input = document.getElementById('account-admin-email');
        const email = (input && input.value || '').trim();
        if (!email) { toast('対象のメールを入力してください。', { type: 'warn' }); return; }
        const result = document.getElementById('account-admin-result');
        const btns = ['account-admin-plus', 'account-admin-free', 'account-admin-reset'].map(id => document.getElementById(id));
        btns.forEach(b => { if (b) b.disabled = true; });
        try {
            const res = await fetch(`${hub.apiBase}/admin/plan`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, plan, resetBilling: reset })
            });
            if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {} throw new Error(`${res.status}${d ? ': ' + d : ''}`); }
            const data = await res.json();
            const label = data.reset ? '無料（課金リンクをリセット）' : (data.plan === 'plus' ? 'Plus' : '無料');
            if (result) { result.textContent = `${data.email} を ${label} にしました。`; result.hidden = false; }
            toast(`${data.email} を ${label} にしました。`, { type: 'success' });
            // 自分自身を切替えた場合は表示も更新
            if (email.toLowerCase() === String(hub.email || '').toLowerCase()) this._refreshHubUsage({ notify: false });
        } catch (e) {
            if (result) { result.textContent = `切替に失敗: ${e.message}`; result.hidden = false; }
            toast(`プラン切替に失敗しました: ${e.message}`, { type: 'error' });
        } finally {
            btns.forEach(b => { if (b) b.disabled = false; });
        }
    }

    // --- Obsidian Folder Sync methods ---

    async initObsidianSync() {
        this.obsidianDirHandle = null;
        if (!('showDirectoryPicker' in window)) return;
        try {
            const handle = await getStoredDirHandle();
            if (!handle) return;
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                this.obsidianDirHandle = handle;
                this.storage.setDirHandle(handle);
                this.updateSyncStatus('loading', handle.name);
                const loaded = await this.loadFromObsidianFile();
                this.updateSyncStatus('synced', handle.name);
                if (loaded) {
                    this.updateDisplay();
                    this.updateStats();
                    this.updateBookshelfSelector();
                    this.renderBookshelfOverview();
                }
            } else {
                this.updateSyncStatus('reconnect');
            }
        } catch (e) {
            console.warn('initObsidianSync:', e);
        }
    }

    async selectObsidianFolder() {
        if (!('showDirectoryPicker' in window)) {
            toast('このブラウザはフォルダ選択に対応していません。\nChrome または Edge をご利用ください。');
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await storeDirHandle(handle);
            this.obsidianDirHandle = handle;
            this.storage.setDirHandle(handle);
            this.updateSyncStatus('loading', handle.name);

            // フォルダの内容を先に判定: 空のときだけ初期化、それ以外はあるデータを尊重して読み込む
            const format = await this.storage.detectFormat();
            if (format === 'empty') {
                await this.storage.initEmpty();
            }

            const loaded = await this.loadFromObsidianFile();
            if (loaded) {
                this.updateDisplay();
                this.updateStats();
                this.updateBookshelfSelector();
                this.renderBookshelfOverview();
                this.updateSyncStatus('synced', handle.name);
                if (format === 'empty') {
                    toast(`「${handle.name}」に新ファイル構造で初期化しました。`);
                } else {
                    toast(`「${handle.name}」から ${this.books.length} 冊を読み込みました。`);
                }
            } else {
                // load 失敗時は同期フォルダの既存データを上書きしないため、ここでは何もしない
                this.updateSyncStatus('reconnect', handle.name);
                toast(`「${handle.name}」のデータ読み込みに失敗しました。\nlibrary.json / bookshelves/all.json の存在を確認してください。\n（既存ファイルを保護するため、自動初期化は行いませんでした）`);
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('フォルダ選択エラー:', e);
            if (e.name === 'SecurityError') {
                toast('フォルダへのアクセスが拒否されました。\nHTTPS環境（GitHub Pages）またはlocalhost上で実行してください。');
            } else {
                toast(`フォルダ選択エラー: ${e.message}`);
            }
        }
    }

    async loadFromObsidianFile() {
        if (!this.obsidianDirHandle) return false;
        this.storage.setDirHandle(this.obsidianDirHandle);
        try {
            const format = await this.storage.detectFormat();

            if (format === 'legacy') {
                console.log('旧形式 library.json を検出。新ファイル構造へマイグレーションします。');
                await this.storage.migrateFromLegacy();
            } else if (format === 'pre-notes-split') {
                console.log('旧構造（notes が all.json 内）を検出。notes.json に分離します。');
                await this.storage.migrateNotesSplit();
            } else if (format === 'empty') {
                return false;
            }

            const state = await this.storage.loadAll();
            return this._applyLoadedState(state);
        } catch (e) {
            console.error('ファイル読み込みエラー:', e);
            return false;
        }
    }

    _applyLoadedState(state) {
        if (!state.allBookshelf) return false;
        // 未同期ローカル編集の保護:
        // 直近の編集 (並び替え等) が同期先 (GitHub) に未反映のまま再読込されると、
        // 古いリモート断面で localStorage が上書きされ巻き戻ってしまう。
        // pendingSync フラグが立っていれば、本棚の順序/所属とメモはローカルを優先採用し、
        // 読込後に再 push して確定させる。
        const _priorLocal = this.userData;
        let _hasPendingLocal = false;
        try {
            _hasPendingLocal = localStorage.getItem('virtualBookshelf_pendingSync') === '1'
                && !!(_priorLocal && Array.isArray(_priorLocal.bookshelves) && _priorLocal.bookshelves.length);
        } catch (e) { _hasPendingLocal = false; }
        // library.json が無くても allBookshelf があれば空 library として続行
        const libraryBooks = (state.library && Array.isArray(state.library.books)) ? state.library.books : [];
        const excluded = new Set(state.exclusions.excludedASINs || []);

        const visibleBooks = libraryBooks.filter(b => !excluded.has(b.asin));
        this.bookManager.library = {
            books: visibleBooks,
            metadata: {
                totalBooks: visibleBooks.length,
                manuallyAdded: visibleBooks.filter(b => b.source === 'manual_add').length,
                importedFromKindle: visibleBooks.filter(b => b.source === 'kindle_import').length,
                lastImportDate: state.library.exportDate || null
            }
        };
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
        this.books = this.bookManager.getAllBooks();

        // global notes（notes.json 由来、全本の rating/memo/hasDetailMemo の正本）
        const notes = {};
        Object.entries(state.notes || {}).forEach(([asin, n]) => {
            notes[asin] = {
                memo: n.memo || '',
                rating: n.rating || 0,
                ...(n.hasDetailMemo ? { hasDetailMemo: true } : {})
            };
        });

        // 本棚配列: bookshelves.json のエントリ全部
        // all 本棚は state.bookshelfFiles に無いので、state.allBookshelf から構築
        // all.books は常に library - exclusions と一致するよう正規化（保存値の順序は維持）
        const libraryAsins = libraryBooks.map(b => b.asin);
        const libraryAsinSet = new Set(libraryAsins);
        const visibleLibraryAsins = libraryAsins.filter(a => !excluded.has(a));

        const bookshelves = (state.bookshelvesMeta.bookshelves || []).map(meta => {
            const isAll = meta.slug === 'all';
            const fileData = isAll ? state.allBookshelf : state.bookshelfFiles[meta.internalId];
            const savedBooks = (fileData && Array.isArray(fileData.books)) ? fileData.books : [];

            let books = savedBooks;
            if (isAll) {
                // all.books = library - exclusions（保存順序を維持しつつ漏れを補完、無効ASIN除外）
                const orderedSet = new Set(savedBooks);
                books = [
                    ...savedBooks.filter(a => libraryAsinSet.has(a) && !excluded.has(a)),
                    ...visibleLibraryAsins.filter(a => !orderedSet.has(a))
                ];
            }

            return {
                id: meta.slug,
                internalId: meta.internalId,
                name: meta.name,
                iconName: meta.iconName || (fileData && fileData.iconName) || 'library',
                parent: meta.parent || null,
                appliedPlugins: meta.appliedPlugins || [],
                isSpecial: meta.isSpecial || isAll,
                description: meta.description || (fileData && fileData.description) || '',
                books,
                notes: (fileData && fileData.notes) || {}
            };
        });

        const bookOrder = {};
        bookshelves.forEach(b => { bookOrder[b.id] = b.books; });
        // 既存コードとの互換のため 'all' キーも維持（本棚 slug='all' と一致）
        if (!bookOrder.all) bookOrder.all = state.allBookshelf.books || [];

        // 未同期ローカル編集があれば、本棚の順序/所属はローカルを優先（リモートの古い断面で潰さない）
        if (_hasPendingLocal) {
            const validAsin = new Set(libraryAsins);
            bookshelves.forEach(shelf => {
                const local = _priorLocal.bookshelves.find(b => b.id === shelf.id);
                if (!local) return;
                // 他の端末がこの本棚をあとから並べ替えていたら、そちらを採る (イシュー#387)
                const _ok = 'bookOrder:' + shelf.id;
                if ((((state.privateSettings || {})._updatedAt || {})[_ok] || 0) > (((_priorLocal.settings || {})._updatedAt || {})[_ok] || 0)) return;
                const localOrder = (_priorLocal.bookOrder && Array.isArray(_priorLocal.bookOrder[shelf.id]))
                    ? _priorLocal.bookOrder[shelf.id]
                    : (Array.isArray(local.books) ? local.books : null);
                if (!localOrder) return;
                if (shelf.isSpecial) {
                    // ALL: メンバーは library-exclusions で確定済み。順序のみローカルを尊重
                    const memberSet = new Set(shelf.books);
                    shelf.books = [
                        ...localOrder.filter(a => memberSet.has(a)),
                        ...shelf.books.filter(a => !localOrder.includes(a))
                    ];
                } else {
                    // 通常本棚: ローカルの所属+順序を採用（無効 ASIN は除外）
                    shelf.books = localOrder.filter(a => validAsin.has(a));
                }
                bookOrder[shelf.id] = shelf.books;
            });
            // メモ/評価もローカル優先マージ
            Object.entries(_priorLocal.notes || {}).forEach(([asin, n]) => { if (n) notes[asin] = n; });
        }

        // 設定のマージ (イシュー#387・ADR-137):
        //   端末ごとの見た目の好み → 常に手元 (同期先の値は使わない)
        //   共通設定 → キーごとの更新時刻 (_updatedAt) で新しい方。時刻が同じ/無い時は同期先 (従来どおり)
        let _localWon = false;
        const currentSettings = this.userData?.settings || {};
        const remoteSettings = this._commonSettings(state.privateSettings || {});
        const localTs = currentSettings._updatedAt || {};
        const remoteTs = remoteSettings._updatedAt || {};
        const mergedSettings = { ...currentSettings, ...remoteSettings };
        Object.keys(localTs).forEach(k => {
            if (k.startsWith('bookOrder:')) return;
            if ((localTs[k] || 0) > (remoteTs[k] || 0) && k in currentSettings) mergedSettings[k] = currentSettings[k];
        });
        const mergedTs = { ...remoteTs };
        Object.keys(localTs).forEach(k => { if ((localTs[k] || 0) > (mergedTs[k] || 0)) mergedTs[k] = localTs[k]; });
        mergedSettings._updatedAt = mergedTs;
        DEVICE_SETTING_KEYS.forEach(k => { if (k in currentSettings) mergedSettings[k] = currentSettings[k]; else delete mergedSettings[k]; });
        // 本棚の並び順: 手元の方が新しく並べ替えた本棚は手元の順を採る (未同期フラグの有無によらない)
        if (_priorLocal && _priorLocal.bookOrder) {
            bookshelves.forEach(shelf => {
                const k = 'bookOrder:' + shelf.id;
                const lo = _priorLocal.bookOrder[shelf.id];
                if (!Array.isArray(lo) || !((localTs[k] || 0) > (remoteTs[k] || 0))) return;
                // 所属は同期先、順序だけ手元 (所属の変更は並べ替えの更新時刻の対象外)
                const memberSet = new Set(shelf.books);
                const loSet = new Set(lo);
                shelf.books = [...lo.filter(a => memberSet.has(a)), ...shelf.books.filter(a => !loSet.has(a))];
                bookOrder[shelf.id] = shelf.books;
                _localWon = true;
            });
        }
        Object.keys(localTs).forEach(k => { if (!k.startsWith('bookOrder:') && (localTs[k] || 0) > (remoteTs[k] || 0)) _localWon = true; });
        this.userData = {
            bookshelves,
            notes,
            bookOrder,
            settings: mergedSettings,
            _storage: {
                allInternalId: state.allBookshelf.internalId,
                exclusions: state.exclusions.excludedASINs || [],
                main: state.privateMain,
                libraryBooks: libraryBooks
            }
        };
        // libraryBooks は容量大のため localStorage には保存しない
        {
            const persisted = { ...this.userData };
            const { libraryBooks: _omit, ...storageRest } = persisted._storage;
            persisted._storage = storageRest;
            try {
                localStorage.setItem('virtualBookshelf_userData', JSON.stringify(persisted));
            } catch (e) {
                console.error('localStorage 保存失敗:', e);
            }
        }

        this._snapshotSyncedState();
        // 未同期ローカル編集・手元の方が新しい項目を採用した場合は、読込後に同期先へ再 push して確定させる
        // (GitHub は閉じる時に送り切れないため、次に開いた時のこの再送で保証する)
        if ((_hasPendingLocal || _localWon) && this._isSyncReady()) {
            this._scheduleSync();
        }

        if (this.pluginAPI) this.pluginAPI._emit('books:changed', {});
        if (this.bookshelfManager) this.bookshelfManager.rebuildReverseIndex();
        return true;
    }

    async reloadFromObsidianFile() {
        if (!this.obsidianDirHandle) return;
        this.updateSyncStatus('loading', this.obsidianDirHandle.name);
        const loaded = await this.loadFromObsidianFile();
        if (loaded) {
            this.updateDisplay();
            this.updateStats();
            this.updateBookshelfSelector();
            this.renderBookshelfOverview();
            this.updateSyncStatus('synced', this.obsidianDirHandle.name);
        } else {
            this.updateSyncStatus('synced', this.obsidianDirHandle.name);
            toast('library.json が見つかりません。');
        }
    }

    // 旧形式の単一 library.json ダウンロード用（exportUnifiedData が利用）
    buildExportData() {
        const exportData = {
            exportDate: new Date().toISOString(),
            books: {},
            bookshelves: this.userData.bookshelves || [],
            settings: (() => {
                const { affiliateId, ...rest } = this.userData.settings;
                return rest;
            })(),
            bookOrder: this.userData.bookOrder || {},
            stats: { totalBooks: 0, notesCount: Object.keys(this.userData.notes || {}).length },
            version: '2.0'
        };
        const books = {};
        (this.books || []).forEach(book => {
            if (!book.asin) return;
            books[book.asin] = {
                title: book.title || '',
                authors: book.authors || '',
                acquiredTime: book.acquiredTime || Date.now(),
                readStatus: book.readStatus || 'UNREAD',
                productImage: book.productImage || '',
                source: book.source || 'unknown',
                addedDate: book.addedDate || Date.now(),
                memo: this.userData.notes?.[book.asin]?.memo || '',
                rating: this.userData.notes?.[book.asin]?.rating || 0,
                ...(book.updatedAsin?.trim() && { updatedAsin: book.updatedAsin })
            };
        });
        exportData.books = books;
        exportData.stats.totalBooks = Object.keys(books).length;
        return exportData;
    }

    // 同期先への書き出し (LocalFS / GitHub Adapter 等、storage の adapter に委譲)
    async syncToObsidianFolder() {
        if (!this._isSyncReady()) return;
        await this._ensureFreshGitHubToken();
        this._lastSyncOk = false;
        try {
            // LocalFS 時のみ FS permission を確認 (GitHub Adapter は token ベースなので不要)
            if (this.syncMethod !== 'github' && this.obsidianDirHandle) {
                let perm = await this.obsidianDirHandle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    perm = await this.obsidianDirHandle.requestPermission({ mode: 'readwrite' });
                }
                if (perm !== 'granted') {
                    this.obsidianDirHandle = null;
                    this.updateSyncStatus('disconnected');
                    return;
                }
                this.storage.setDirHandle(this.obsidianDirHandle);
            }

            const format = await this.storage.detectFormat();
            if (format === 'empty') {
                const { allInternalId } = await this.storage.initEmpty();
                if (!this.userData._storage) this.userData._storage = {};
                this.userData._storage.allInternalId = allInternalId;
            }

            const allInternalId = (this.userData._storage && this.userData._storage.allInternalId)
                || generateInternalId();
            if (!this.userData._storage) this.userData._storage = {};
            this.userData._storage.allInternalId = allInternalId;

            // entries 配列に集めて、最後に syncBatch で一括書き込み (GitHub は 1 commit)
            // 新構造 (2026-05-31〜): 全部 private/ 配下に集約
            const entries = [];

            // library.json: 全書誌（除外含む全本）を毎回再構築
            const exclusionsSet = new Set((this.userData._storage && this.userData._storage.exclusions) || []);
            const currentBooksByAsin = new Map((this.books || []).map(b => [b.asin, b]));
            const excludedCache = ((this.userData._storage && this.userData._storage.libraryBooks) || [])
                .filter(b => exclusionsSet.has(b.asin) && !currentBooksByAsin.has(b.asin));
            const normalize = (b) => ({
                asin: b.asin,
                title: b.title || '',
                authors: b.authors || '',
                acquiredTime: b.acquiredTime || Date.now(),
                readStatus: b.readStatus || 'UNKNOWN',
                productImage: b.productImage || '',
                source: b.source || 'unknown',
                addedDate: b.addedDate || Date.now(),
                ...(b.updatedAsin ? { updatedAsin: b.updatedAsin } : {}),
                // Amazon 生値をそのまま保持 (イシュー#41)。無い場合はキー自体を持たせない
                // (= 未設定 = 「購入・有効」扱い。既存の本の表示・分類を変えないため既定値は入れない)
                ...(b.originType ? { originType: b.originType } : {}),
                ...(b.statusFromPlatformSearch ? { statusFromPlatformSearch: b.statusFromPlatformSearch } : {}),
                ...(b.lendingType ? { lendingType: b.lendingType } : {}),
                ...(b.lendingStatus ? { lendingStatus: b.lendingStatus } : {})
            });
            const libraryBooks = [
                ...Array.from(currentBooksByAsin.values()).map(normalize),
                ...excludedCache.map(normalize)
            ];
            this.userData._storage.libraryBooks = libraryBooks;
            entries.push({ op: 'put', path: 'private/library.json', data: {
                exportDate: new Date().toISOString(),
                books: libraryBooks
            }});

            // exclusions.json
            entries.push({ op: 'put', path: 'private/exclusions.json', data: {
                excludedASINs: (this.userData._storage && this.userData._storage.exclusions) || []
            }});

            // notes.json: 全本の rating/memo/hasDetailMemo（all.json には持たせない）
            const notesPayload = {};
            Object.entries(this.userData.notes || {}).forEach(([asin, n]) => {
                if (!n) return;
                const e = {};
                if (n.memo) e.memo = n.memo;
                if (n.rating) e.rating = n.rating;
                if (n.hasDetailMemo) e.hasDetailMemo = true;
                if (Object.keys(e).length > 0) notesPayload[asin] = e;
            });
            entries.push({ op: 'put', path: 'private/notes.json', data: { notes: notesPayload } });

            // bookshelves/all.json: 本棚メタ + books のみ
            const orderedAll = (this.userData.bookOrder && Array.isArray(this.userData.bookOrder.all))
                ? this.userData.bookOrder.all
                : [];
            const libraryAsins = libraryBooks.map(b => b.asin);
            const orderedSet = new Set(orderedAll);
            const allBooksList = [
                ...orderedAll.filter(a => libraryAsins.includes(a)),
                ...libraryAsins.filter(a => !orderedSet.has(a))
            ];
            this.userData.bookOrder = this.userData.bookOrder || {};
            this.userData.bookOrder.all = allBooksList;

            const allMeta = this.bookshelfManager.getBySlug('all');
            entries.push({ op: 'put', path: 'private/bookshelves/all.json', data: {
                internalId: allInternalId,
                slug: 'all',
                name: (allMeta && allMeta.name) || 'すべての本',
                isSpecial: true,
                parent: null,
                defaultBookOrder: this.userData.settings?.defaultBookOrder || 'addedDate-desc',
                appliedPlugins: (allMeta && allMeta.appliedPlugins) || [],
                books: allBooksList
            }});

            // bookshelves.json + 各 slug ファイル
            for (const b of (this.userData.bookshelves || [])) {
                if (!b.internalId) b.internalId = generateInternalId();
            }
            if (!this.userData.bookshelves.some(b => b.isSpecial)) {
                this.userData.bookshelves.unshift({
                    id: 'all',
                    internalId: allInternalId,
                    name: 'すべての本',
                    isSpecial: true,
                    parent: null,
                    appliedPlugins: [],
                    books: allBooksList,
                    notes: {}
                });
            }
            const bookshelvesMetaEntries = (this.userData.bookshelves || []).map(b => ({
                internalId: b.internalId,
                slug: b.id,
                name: b.name,
                iconName: b.iconName || 'library',
                parent: b.isSpecial ? null : (b.parent || allInternalId),
                appliedPlugins: b.appliedPlugins || [],
                ...(b.isSpecial ? { isSpecial: true } : {}),
                ...(b.description ? { description: b.description } : {})
            }));
            entries.push({ op: 'put', path: 'private/bookshelves.json', data: { bookshelves: bookshelvesMetaEntries } });
            for (let i = 0; i < (this.userData.bookshelves || []).length; i++) {
                const b = this.userData.bookshelves[i];
                if (b.isSpecial) continue;
                const meta = bookshelvesMetaEntries[i];
                entries.push({ op: 'put', path: `private/bookshelves/${meta.slug}.json`, data: {
                    internalId: meta.internalId,
                    slug: meta.slug,
                    name: meta.name,
                    iconName: meta.iconName,
                    parent: meta.parent,
                    books: b.books || [],
                    notes: b.notes || {}
                }});
            }

            // private/settings.json
            // 端末ごとの見た目の好みは書かない (イシュー#387)。_updatedAt (キーごとの更新時刻) は共通側に載せる
            entries.push({ op: 'put', path: 'private/settings.json', data: {
                version: '2.0',
                ...this._commonSettings(this.userData.settings)
            }});

            // private/main.json
            const existingMain = (this.userData._storage && this.userData._storage.main) || {};
            entries.push({ op: 'put', path: 'private/main.json', data: {
                enabledPlugins: existingMain.enabledPlugins || [],
                appliedPlugins: existingMain.appliedPlugins || [],
                bookshelves: bookshelvesMetaEntries.map(b => b.internalId),
                defaultSort: existingMain.defaultSort || 'addedDate-desc',
                ...(existingMain.home ? { home: existingMain.home } : {})
            }});

            // バッチ書き込み (GitHub なら Trees API で 1 commit にまとめる)
            try {
                await this.storage.syncBatch(entries, {
                    message: `chore(bookshelf): sync ${entries.length} file(s)`
                });
            } catch (err) {
                // GitHub (Trees API) と Asayake ハブ (412/HubConflictError) の衝突を同じダイアログに合流させる (WP-B2)
                if (err && (err.name === 'GitHubConflictError' || err.name === 'HubConflictError')) {
                    this.updateSyncStatus('reconnect', this._syncLabel());
                    this._handleSyncConflict(err.name === 'HubConflictError' ? 'Asayake ハブ' : 'GitHub');
                    return;
                }
                throw err;
            }

            this._lastSyncOk = true;
            this.updateSyncStatus('synced', this._syncLabel());
            if (this.pluginAPI) this.pluginAPI._emit('sync:completed', {});
        } catch (e) {
            console.error('同期エラー:', e);
            this.updateSyncStatus('reconnect', this._syncLabel());
            // dirHandle が dangling (フォルダ削除/リネーム) なら明示的に再選択を促す
            const isHandleStale = e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError');
            if (isHandleStale && this.syncMethod === 'local' && !this._syncReconnectNotified) {
                this._syncReconnectNotified = true;
                toast('保存フォルダが見つかりません（削除または名前変更された可能性があります）。\n設定 →「同期」→「フォルダを選ぶ」から選び直してください。\nGitHub 保存に切り替える場合は、同じ画面の保存先の選択から変更できます。');
                if (this.storage && this.storage.adapter && typeof this.storage.adapter.setDirHandle === 'function') {
                    this.storage.adapter.setDirHandle(null);
                }
            }
        }
    }

    async _handleSyncConflict(source = 'GitHub') {
        if (this._conflictNotified) return;
        this._conflictNotified = true;
        const choice = await this._showConflictDialog(source);
        if (choice === 'export') {
            // リロード前のローカル状態を JSON で退避 (データ破壊防止・WP-B2)。退避後は改めて選び直せる
            try { this.exportUnifiedData(); toast('現在の編集内容を書き出しました。', { type: 'success' }); }
            catch (e) { toast(`書き出しに失敗しました: ${e.message}`, { type: 'error' }); }
            this._conflictNotified = false;
            return this._handleSyncConflict(source);
        }
        if (choice === 'reload') { location.reload(); return; }
        // 何もしない: 一定時間後にもう一度知らせる余地を残す
        setTimeout(() => { this._conflictNotified = false; }, 60000);
    }

    // 衝突時の3択ダイアログ (confirmDialog は2択専用のため cfm-* スタイルを流用して自前構築)
    _showConflictDialog(source) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'cfm-overlay';
            const box = document.createElement('div');
            box.className = 'cfm-box';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.id = 'sync-conflict-dialog';
            box.innerHTML = `
                <div class="cfm-title"></div>
                <div class="cfm-message"></div>
                <div class="cfm-actions">
                    <button type="button" class="btn btn-secondary cfm-cancel"></button>
                    <button type="button" class="btn btn-secondary cfm-export"></button>
                    <button type="button" class="btn btn-primary cfm-ok"></button>
                </div>`;
            box.querySelector('.cfm-title').textContent = '同期の衝突';
            box.querySelector('.cfm-message').textContent =
                `同期先（${source}）のデータが他の場所から更新されています。このセッションの直近の編集はまだ同期先に反映されていません。` +
                '「再読込」を選ぶと最新版を取得しますが、未反映の編集は失われます。心配なときは先に「編集内容を書き出す」で退避してください。';
            box.querySelector('.cfm-cancel').textContent = '何もしない';
            box.querySelector('.cfm-export').textContent = '編集内容をJSONで書き出す';
            box.querySelector('.cfm-ok').textContent = '再読込して最新版を取得';
            // 重なり管理役 (イシュー#367): ダイアログ帯・小 (sm)。履歴には積まない (D04)
            let ov = null;
            const done = (r) => { document.removeEventListener('keydown', onKey, true); if (ov) ov.close(r === 'cancel' ? 'cancel' : 'button'); overlay.remove(); resolve(r); };
            const onKey = (e) => { if (window.Surface.isEsc(e)) { e.stopPropagation(); done('cancel'); } };
            box.querySelector('.cfm-ok').addEventListener('click', () => done('reload'));
            box.querySelector('.cfm-export').addEventListener('click', () => done('export'));
            box.querySelector('.cfm-cancel').addEventListener('click', () => done('cancel'));
            overlay.addEventListener('click', (e) => { if (window.Surface.isBackdrop(e, overlay)) done('cancel'); });
            document.addEventListener('keydown', onKey, true);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            if (window.overlays) ov = window.overlays.open(overlay, { id: 'sync-conflict-dialog', kind: 'dialog', size: 'sm', hist: false, showClass: null, sizeTarget: box });
            box.querySelector('.cfm-ok').focus();
        });
    }

    _syncLabel() {
        if (this.syncMethod === 'github') {
            const a = this.storage && this.storage.adapter;
            if (a && a.owner && a.repo) return `${a.owner}/${a.repo}@${a.branch}`;
            return 'GitHub';
        }
        if (this.syncMethod === 'hub') {
            return 'Asayake ハブ';
        }
        return this.obsidianDirHandle ? this.obsidianDirHandle.name : '';
    }

    updateSyncStatus(state, folderName = '') {
        const pathEl = document.getElementById('obsidian-sync-path');
        const status = document.getElementById('obsidian-sync-status');
        if (!pathEl || !status) return;
        if (state === 'synced') {
            pathEl.textContent = folderName;
            pathEl.title = folderName;
            pathEl.style.color = '';
            status.textContent = `${new Date().toLocaleTimeString()} 同期済み（「フォルダを選ぶ」で再読み込み）`;
            status.style.color = '#4caf50';
        } else if (state === 'loading') {
            pathEl.textContent = folderName;
            pathEl.title = folderName;
            pathEl.style.color = '';
            status.textContent = '読み込み中...';
            status.style.color = '#888';
        } else if (state === 'reconnect') {
            pathEl.textContent = `${folderName || ''}（要再接続）`;
            pathEl.title = folderName || '';
            pathEl.style.color = '#f44336';
            status.textContent = '「フォルダを選ぶ」を押してフォルダを選び直してください';
            status.style.color = '#f44336';
        } else {
            pathEl.textContent = '（未接続）';
            pathEl.title = '';
            pathEl.style.color = '#888';
            status.textContent = '';
        }
    }

    // 旧 _updateExportDirDisplay は R-2 で廃止 (公開出力先は同期先の public/ に統合)

    // --- end Obsidian Folder Sync methods ---

    // exportUserData function removed - replaced with exportUnifiedData

    autoSaveUserDataFile() {
        // BookManagerから書籍データを取得
        const bookManager = window.bookManager;
        const books = {};
        
        // 書籍データを統合形式に変換
        if (bookManager && bookManager.library && bookManager.library.books) {
            bookManager.library.books.forEach(book => {
                const asin = book.asin;
                books[asin] = {
                    title: book.title,
                    authors: book.authors,
                    acquiredTime: book.acquiredTime,
                    readStatus: book.readStatus,
                    productImage: book.productImage,
                    source: book.source,
                    addedDate: book.addedDate,
                    memo: this.userData.notes[asin]?.memo || '',
                    rating: this.userData.notes[asin]?.rating || 0
                };
            });
        }

        const backupData = {
            exportDate: new Date().toISOString(),
            books: books,
            bookshelves: this.userData.bookshelves,
            settings: this.userData.settings,
            bookOrder: this.userData.bookOrder,
            stats: {
                totalBooks: Object.keys(books).length,
                notesCount: Object.keys(this.userData.notes).length
            },
            version: '2.0'
        };
        
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'library.json';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('library.jsonファイルを自動生成しました');
    }

    updateBookshelfSelector() {
        // 本棚切替は左サイドバーツリーに一本化 (bookshelf-selector popover は 2026-06-07 撤去)。
        // PC v2: 左サイドバーツリーを更新
        this._renderSidebarTree();
        // ダッシュボードも再描画 (本棚ハイライトウィジェットや、カウンターが本棚数に依存するため)
        if (this.dashboard && document.body.classList.contains('app-view-main')) {
            this.dashboard.render();
        }
    }

    switchBookshelf(bookshelfId) {
        // 別の本棚へ移るときは前の本棚の絞り込みを持ち越さない
        // (見えない検索/評価フィルタが効き続けて「この本棚は空?」に見える事故の防止)
        if (bookshelfId !== this.currentBookshelf) this._resetFilters();
        // イシュー#259 (②差し戻し 2026-09-29): スマホ幅でドロワー(サイドバー)や⌘Kパレットを
        // 開いたまま本棚を選ぶと、それらを閉じる _closeDrawer/_closePalette が予約する
        // history.back() (_modalHistPop、「戻る」操作をモーダルクローズに割り当てる仕組み) が
        // 非同期に処理される一方、この後 router.navigateBookshelf() が同期的に location.hash へ
        // 新しい履歴エントリを積む。両者の実行順序はブラウザ/端末の速度依存で確定しないため、
        // setTimeout 等の時間待ちでは実機で再発しうる (②指摘)。back() 自体を呼ばせず、開いていた
        // ドロワー/パレットの履歴エントリをそのまま本棚のハッシュへ replaceState で書き換える
        // (履歴の深さを変えない = 戻るを1回押せば元のホームへ戻れる、実測: tmp/verify259/)。
        // イシュー#359 段階①: 上の判断 (開いていた面の段を本棚のハッシュへ replace で書き換える) は _navigateFromUi に
        // 一般化した (下部ナビ「ホーム」等の同型経路にも同じ扱いが要るため)。
        // 同じ本棚を既に表示中 (本詳細から「戻る」で来た hashchange 等) なら一覧を作り直さない
        // (800冊で約400ms = step2 の最重項目)。絞り込み・並び替えの変更は別経路 (applyFilters 直呼び) なので影響しない。
        const sameShelf = bookshelfId === this.currentBookshelf && document.body.classList.contains('app-view-bookshelf');
        this.currentBookshelf = bookshelfId;
        if (!sameShelf) this.applyFilters();
        // 本棚ビューに切替
        this._setBodyView('bookshelf');
        if (!sameShelf) this._updateBookshelfViewTitle();
        // PC v2: 左サイドバーツリーのハイライト更新
        this._updateSidebarActive();
        // Router 連携（_applyRoute 由来でない場合のみ URL を更新）
        if (this.router && !this._suppressRouterUpdate) {
            const bs = this.bookshelfManager?.getById?.(bookshelfId);
            const slug = bs?.slug || bookshelfId;
            this._navigateFromUi('bookshelf', slug);
        }
        // 複数選択中なら一括バーのボタン表示 (本棚から外す等) を本棚に合わせて更新
        if (this.selectMode) this._updateBulkBar();
    }

    /**
     * ビュー切替: body クラスを app-view-{main|bookshelf} に
     */
    _setBodyView(view) {
        document.body.classList.remove('app-view-main', 'app-view-bookshelf');
        document.body.classList.add(`app-view-${view}`);
        if (this.nav) this.nav.setView(view); // 段階③: 台帳の view (履歴は書かない)
        // モバイル: ビュー切替時はドロワーを閉じる
        this._closeDrawer();   // ビュー切替でドロワーを畳む (開いていなければ no-op)
        // ホームに戻ったら右ペインのピン留めも解除
        if (view === 'main') {
            document.body.classList.remove('book-detail-pinned');
        }
        // イシュー#371/#373(案D): CSS側は display:none をやめ、ホーム表示中は transform で画面外へ
        // 移動するだけにした (切替コスト対策)。display:none 相当のアクセシビリティ挙動
        // (フォーカス/クリック/スクリーンリーダー対象外) は inert と aria-hidden の両方で明示的に保つ
        // (inert だけでも AT からは除外されるが、2026-10-26 ②指示によりホーム表示中に Tab で一覧へ
        // フォーカスが入らないことを二重に保証する)。
        const shelfView = document.getElementById('view-bookshelf');
        if (shelfView) {
            const hidden = (view !== 'bookshelf');
            shelfView.inert = hidden;
            if (hidden) shelfView.setAttribute('aria-hidden', 'true');
            else shelfView.removeAttribute('aria-hidden');
        }
        // 左サイドバーの選択ハイライトを更新
        this._updateSidebarActive();
    }

    // ===== PC v2: ペイン制御 (UI-4) =====
    _initPaneControls() {
        // 永続化された折りたたみ状態を復元
        const paneState = (this.userData?.settings?.paneState) || {};
        if (paneState.left)  document.body.classList.add('left-collapsed');
        if (paneState.right) document.body.classList.add('right-collapsed');

        // 折りたたみボタン
        const sidebarToggle = document.getElementById('sidebar-toggle-btn');
        const sidebarRestore = document.getElementById('sidebar-restore-btn');
        const detailToggle = document.getElementById('detail-toggle-btn');
        const detailRestore = document.getElementById('detail-restore-btn');

        if (sidebarToggle && !sidebarToggle._bound) {
            sidebarToggle._bound = true;
            sidebarToggle.addEventListener('click', () => this._togglePane('left'));
        }
        if (sidebarRestore && !sidebarRestore._bound) {
            sidebarRestore._bound = true;
            sidebarRestore.addEventListener('click', () => this._togglePane('left'));
        }
        if (detailToggle && !detailToggle._bound) {
            detailToggle._bound = true;
            detailToggle.addEventListener('click', () => this._togglePane('right'));
        }
        if (detailRestore && !detailRestore._bound) {
            detailRestore._bound = true;
            detailRestore.addEventListener('click', () => this._togglePane('right'));
        }

        // キーバインド: ⌘[ / ⌘] / ⌘\ (mac は metaKey, win/linux は ctrlKey)
        if (!this._paneKeysBound) {
            this._paneKeysBound = true;
            document.addEventListener('keydown', (e) => {
                if (!(e.metaKey || e.ctrlKey)) return;
                if (e.key === '[') { e.preventDefault(); this._togglePane('left'); }
                else if (e.key === ']') { e.preventDefault(); this._togglePane('right'); }
                else if (e.key === '\\') { e.preventDefault(); this._togglePane('both'); }
            });
        }

        // ホームナビボタン
        const homeBtn = document.querySelector('.sidebar-nav-item[data-nav="home"]');
        if (homeBtn && !homeBtn._bound) {
            homeBtn._bound = true;
            homeBtn.addEventListener('click', () => {
                if (this.router) this._navigateFromUi('main');
                else { this._setBodyView('main'); }
            });
        }

        // ブランドロゴ = ホーム (Web 慣習)。span 要素なのでキーボード操作も付与
        const brand = document.querySelector('.sidebar-brand');
        if (brand && !brand._bound) {
            brand._bound = true;
            brand.style.cursor = 'pointer';
            brand.setAttribute('role', 'button');
            brand.setAttribute('tabindex', '0');
            brand.setAttribute('title', 'ホーム');
            const goHome = () => { if (this.router) this._navigateFromUi('main'); else this._setBodyView('main'); };
            brand.addEventListener('click', goHome);
            brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
        }

        // モバイル UI (ドロワー / 下部ナビ / 詳細シート) の初期化
        this._initMobileNav();
    }

    // ===== モバイル UI (<=768px): ドロワー + 下部ナビ + 詳細フルシート =====

    // ドロワー開閉 (C-281 で関数に集約。旧: classList 直接操作が7箇所に散在し履歴統合が不可能だった)
    // イシュー#330: 「戻る/進む」で開き直す/閉じ直す時だけ、対象要素のCSS transitionを1回分だけ
    // 無効化して即座に表示・非表示する(開くアニメーションの二重見え対策)。ユーザー操作(タップ/ボタン)
    // 由来の通常の開閉では呼ばない=今までどおりアニメーションが残る。
    _histNoAnimOnce(el) {
        if (!el) return;
        el.classList.add('hist-no-anim');
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('hist-no-anim')));
    }

    _openDrawer() {
        // イシュー#330: 冪等化(安全策)。既に開いていれば何もしない。
        if (document.body.classList.contains('drawer-open')) return;
        document.body.classList.add('drawer-open');
        // 重なり管理役 (イシュー#367 step5): ドロワーは一時的な面 (kind:'sheet'・closeOthers・表示は body.drawer-open のまま)。
        // 管理役から閉じられた時 (別の面を開いた等) は onClose → _closeDrawer
        const side = document.getElementById('app-sidebar');
        if (side) this._overlays().open(side, { kind: 'sheet', hist: false, showClass: null, size: 'none', onOpen: 'closeOthers', onClose: () => this._closeDrawer() });
        this._surface().open('drawer', { close: (o) => this._closeDrawer(o) });
    }

    _closeDrawer({ fromHistory = false, silent = false } = {}) {
        // ビュー切替 (_setBodyView) から無条件に呼ばれるため、開いていない時は何もしない
        if (!document.body.classList.contains('drawer-open')) return;
        // イシュー#330: 「戻る」で閉じ直す時(fromHistory)だけ、閉じるtransitionを無効化する
        // (iOSは戻るでもスナップショットを見せるため、スライドアウトも二重に見える・②決裁2026-10-23)。
        if (fromHistory) {
            this._histNoAnimOnce(document.getElementById('app-sidebar'));
            this._histNoAnimOnce(document.querySelector('.mobile-scrim'));
        }
        document.body.classList.remove('drawer-open');
        this._overlays().close('app-sidebar', { reason: fromHistory ? 'history' : 'button' }); // 重なり管理役 (イシュー#367 step5)
        if (silent) {
            // イシュー#259: 呼び出し元 (switchBookshelf) がこの直後に history.replaceState で
            // 履歴エントリを書き換えるため、ここでは history.back() を予約しない
            // (_modalHistStack からのみ静かに外す。DOM は既に上で閉じている)。
            const st = this._modalHistStack;
            if (st) { const i = st.findIndex((e) => e.id === 'drawer'); if (i !== -1) st.splice(i, 1); }
            return;
        }
        this._surface().close('drawer', { fromHistory });
    }

    _initMobileNav() {
        if (this._mobileNavBound) return;
        this._mobileNavBound = true;
        const body = document.body;

        // スクリム: タップでドロワーを閉じる
        const scrim = document.getElementById('mobile-scrim');
        if (scrim) scrim.addEventListener('click', () => this._closeDrawer());

        // 下部ナビ
        const nav = document.getElementById('mobile-bottom-nav');
        if (nav) nav.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mobile-nav]');
            if (!btn) return;
            const action = btn.dataset.mobileNav;
            if (action === 'home') {
                this._closeDrawer();
                if (this.router) this._navigateFromUi('main'); else this._setBodyView('main');
            } else if (action === 'shelves') {
                if (body.classList.contains('drawer-open')) this._closeDrawer(); else this._openDrawer();
            } else if (action === 'search') {
                this._closeDrawer();
                this._openPalette();
            } else if (action === 'settings') {
                // 閉じたドロワーの段は設定へ引き継がれる (_modalHistPush・イシュー#284 K2)
                this._closeDrawer();
                this._openSettingsModal();
            }
        });

        // 詳細シートの戻る (スマホ)。PC の × (#book-detail-pc-close・イシュー#511 X1 P11) も同じ処理
        const back = document.getElementById('mobile-detail-back');
        if (back) back.addEventListener('click', () => this._exitBookDetail());
        const pcClose = document.getElementById('book-detail-pc-close');
        if (pcClose) pcClose.addEventListener('click', () => this._exitBookDetail());
        // PC (901px以上) だけ: Esc で本の詳細 (手元の資料) を閉じる。他の面が Esc で閉じた時 (defaultPrevented)
        // は二重に動かない。本詳細は .modal ではない (右ペインに inject) ため既存の全モーダル共通 Esc (685行)
        // には引っかからない=ここで個別に見る必要がある (イシュー#511 X1 P11: PCの本の詳細に×とEscを付ける)
        if (!this._bdPcEscBound) {
            this._bdPcEscBound = true;
            window.Surface.onEsc(document, (e) => {
                if (e.defaultPrevented) return;
                if (this._isHistMobile()) return; // スマホは既存の履歴統合(戻る/端スワイプ)が担う
                if (!document.body.classList.contains('book-detail-pinned')) return;
                this._exitBookDetail();
                e.preventDefault();
            });
        }

        // Esc でドロワーを閉じる
        if (!this._mobileEscBound) {
            this._mobileEscBound = true;
            document.addEventListener('keydown', (e) => {
                if (window.Surface.isEsc(e) && body.classList.contains('drawer-open')) {
                    this._closeDrawer();
                }
            });
        }

        // 一覧カードの hover ポップを長押しで表示 (タッチ端末)
        this._initBookPopLongPress();

        // はみ出しテキストのマーキーをリサイズで再評価 (debounce)
        if (!this._marqueeResizeBound) {
            this._marqueeResizeBound = true;
            let rt = null;
            window.addEventListener('resize', () => {
                clearTimeout(rt);
                rt = setTimeout(() => this._refreshMarquees(), 200);
            });
        }

        // リサイズで境界を越えたら「大きさ」選択肢の列数表示を更新する (イシュー#389)。
        // 特定の境界値へのmatchMediaではなく汎用resize(debounce)にする: 境界の数字はCSS側にしか
        // 持たず(_readMobileColsTable参照)、JS側はいつ再チェックしてもよいだけなので、
        // 上のマーキー再評価と同じ型を使う(②指摘2026-10-28: 固定値の重複を無くす)。
        if (!this._coverSizeResizeBound) {
            this._coverSizeResizeBound = true;
            let rt2 = null;
            window.addEventListener('resize', () => {
                clearTimeout(rt2);
                rt2 = setTimeout(() => this._updateCoverSizeOptionLabels(), 200);
            });
        }

        // 上部ステータスバー (#4 同期切断 / #5 更新あり) + pull-to-refresh
        this._initStatusBar();
        this._initPullToRefresh();
    }

    /**
     * タッチ端末で一覧カードの hover ポップ (.card-hover-pop = 星 + メモ) を
     * 「長押し」で表示する。マウスの :hover はタッチで誤動作/選択状態になるため、
     * タッチは長押し→ .show-pop 付与に一本化 (CSS 側で :hover はマウス端末限定)。
     */
    _initBookPopLongPress() {
        if (this._popLongPressBound) return;
        this._popLongPressBound = true;
        const container = document.querySelector('.app-main-pane') || document.body;
        let timer = null, sx = 0, sy = 0;
        const clearAll = () => document.querySelectorAll('.book-item.show-pop')
            .forEach(el => el.classList.remove('show-pop'));
        const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

        container.addEventListener('touchstart', (e) => {
            // 既に開いている pop 内の操作 (星タップ等) は素通し
            if (e.target.closest('.book-item.show-pop')) return;
            clearAll();
            const item = e.target.closest('.book-item');
            if (!item || !item.querySelector('.card-hover-pop')) return;
            if (document.body.classList.contains('select-mode')) return;
            item._suppressClick = false;
            const t = e.touches[0];
            sx = t.clientX; sy = t.clientY;
            timer = setTimeout(() => {
                timer = null;
                item.classList.add('show-pop');
                item._suppressClick = true;   // 直後の click(詳細) を抑制
            }, 450);
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!timer) return;
            const t = e.touches[0];
            if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) cancel(); // スクロール
        }, { passive: true });

        container.addEventListener('touchend', cancel, { passive: true });
        container.addEventListener('touchcancel', cancel, { passive: true });
    }

    _togglePane(which) {
        const body = document.body;
        if (which === 'left') {
            body.classList.toggle('left-collapsed');
        } else if (which === 'right') {
            body.classList.toggle('right-collapsed');
        } else if (which === 'both') {
            const anyCollapsed = body.classList.contains('left-collapsed') || body.classList.contains('right-collapsed');
            if (anyCollapsed) {
                body.classList.remove('left-collapsed', 'right-collapsed');
            } else {
                body.classList.add('left-collapsed', 'right-collapsed');
            }
        }
        this._savePaneState();
    }

    _savePaneState() {
        if (!this.userData) return;
        if (!this.userData.settings) this.userData.settings = {};
        this.userData.settings.paneState = {
            left:  document.body.classList.contains('left-collapsed'),
            right: document.body.classList.contains('right-collapsed')
        };
        this.saveUserData({ deviceOnly: true });
    }

    // ===== PC v2: 本棚ツリー (UI-1 + UI-2) =====
    /**
     * 本棚を「左ペインツリーと同じ表示順」で平坦化して返す。
     *   ALL(特殊) を先頭 → ルートを配列順 → 各本棚の子孫を深さ優先。
     * ツリーと本棚ハイライト(ダッシュボード)で順序を揃えるための共通ヘルパ。
     */
    _bookshelvesInTreeOrder() {
        const all = (this.userData?.bookshelves || []);
        const bm = this.bookshelfManager;
        const keyOf = (bs) => bm ? bm._keyOf(bs) : (bs.internalId || bs.id);
        const byParent = new Map();
        for (const bs of all) {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        }
        const result = [];
        const seen = new Set();
        const walk = (bs) => {
            const k = keyOf(bs);
            if (seen.has(k)) return;        // 循環ガード
            seen.add(k);
            result.push(bs);
            for (const child of (byParent.get(k) || [])) walk(child);
        };
        const roots = (byParent.get(null) || []).slice();
        roots.sort((a, b) => (b.isSpecial ? 1 : 0) - (a.isSpecial ? 1 : 0)); // ALL 先頭
        for (const r of roots) walk(r);
        return result;
    }

    _renderSidebarTree() {
        const container = document.getElementById('sidebar-bookshelf-tree');
        if (!container) return;
        const bookshelves = this.bookshelfManager?.getBookshelves?.() || [];
        if (bookshelves.length === 0) {
            container.innerHTML = '<p class="tree-empty" style="padding:0.5rem 0.6rem;color:#9ca3af;font-size:0.8rem;">本棚がありません</p>';
            return;
        }
        // 展開状態を localStorage から復元
        const expandedKey = 'bookshelf_treeExpanded_v1';
        let expanded;
        try {
            expanded = new Set(JSON.parse(localStorage.getItem(expandedKey) || '[]'));
        } catch { expanded = new Set(); }
        this._treeExpanded = expanded;

        const byParent = new Map(); // parent internalId -> [bookshelf]
        bookshelves.forEach(bs => {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        });

        const renderNode = (bs, depth) => {
            const nodeKey = this.bookshelfManager._keyOf(bs);  // internalId||id (実データは slug)
            const children = byParent.get(nodeKey) || [];
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(nodeKey);
            const bookCount = (bs.books && bs.books.length) || 0;
            const isActive = this.currentBookshelf && (bs.id === this.currentBookshelf || bs.internalId === this.currentBookshelf);

            const node = document.createElement('div');
            node.className = `tree-node lv${Math.min(depth, 4)}${isActive ? ' is-active' : ''}`;
            node.dataset.bookshelfId = bs.id;
            node.dataset.internalId = bs.internalId;
            node.dataset.special = bs.isSpecial ? '1' : '0';
            const toggleIconName = isExpanded ? 'chevron-down' : 'chevron-right';
            // 本棚の「アイコン+名前+冊数」は共通コンポーネントで描画 (ツリー固有の indent/more/toggle だけ付加)
            node.innerHTML = `
                <span class="tree-indent"></span>
                ${window.BookshelfUI.rowCore(bs, { count: bookCount })}
                <button class="tree-more" type="button" title="${bs.isSpecial ? '本棚の操作 (編集)' : '本棚の操作 (編集 / 子追加 / 削除)'}">${window.renderIcon('more-horizontal', { size: 14 })}</button>
                ${hasChildren
                    ? `<button class="tree-toggle" type="button" title="${isExpanded ? '折りたたむ' : '展開'}">${window.renderIcon(toggleIconName, { size: 12 })}</button>`
                    : '<span class="tree-toggle-placeholder"></span>'}
            `;
            // 本棚選択
            node.addEventListener('click', (e) => {
                if (e.target.closest('.tree-toggle') || e.target.closest('.tree-more')) return;
                this.switchBookshelf(bs.id);
            });
            // 本棚操作メニュー (Phase G: ツリーから直接編集)
            const moreBtn = node.querySelector('.tree-more');
            if (moreBtn) {
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._openTreeNodeMenu(bs, moreBtn);
                });
            }
            // 展開トグル
            const toggleBtn = node.querySelector('.tree-toggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (expanded.has(nodeKey)) expanded.delete(nodeKey);
                    else expanded.add(nodeKey);
                    try { localStorage.setItem(expandedKey, JSON.stringify([...expanded])); } catch {}
                    this._renderSidebarTree();
                });
            }
            // ===== D&D: 並び替え (同階層) + 親変更 (Phase H2-2, Pointer Events化=イシュー#337) =====
            // 実際のバインドは container 単位 (_bindPointerReorder、_renderSidebarTree 末尾で1回だけ) で行う。

            container.appendChild(node);
            if (hasChildren && isExpanded) {
                children.forEach(child => renderNode(child, depth + 1));
            }
        };

        container.innerHTML = '';
        // ルート (parent なし)
        const roots = byParent.get(null) || [];
        // all 本棚を先頭に
        roots.sort((a, b) => {
            if (a.isSpecial && !b.isSpecial) return -1;
            if (!a.isSpecial && b.isSpecial) return 1;
            return 0;
        });
        roots.forEach(bs => renderNode(bs, 0));

        this._bindPointerReorder(container, {
            itemSelector: '.tree-node',
            canDrag: (el) => el.dataset.special !== '1',
            dragClass: 'tree-dragging',
            zoneMode: 'segment',
            zoneClassPrefix: 'tree-drop-',
            computeZone: (targetEl, clientY) => {
                if (targetEl.dataset.special === '1') return 'inside';
                const rect = targetEl.getBoundingClientRect();
                const y = clientY - rect.top;
                return y < rect.height * 0.3 ? 'before' : (y > rect.height * 0.7 ? 'after' : 'inside');
            },
            getKey: (el) => el.dataset.internalId,
            onDrop: (draggedId, targetId, zone) => this._onTreeDrop(draggedId, targetId, zone),
        });
    }

    // ツリー D&D のドロップ処理 (Phase H2-2)
    //   zone: 'before' | 'after' (= target の兄弟として並び替え) / 'inside' (= target の子にする)
    //   (T06: 確認モーダルが async のため async。drop ハンドラからの fire-and-forget で問題ない)
    async _onTreeDrop(draggedId, targetId, zone) {
        const bm = this.bookshelfManager;
        if (!bm || draggedId === targetId) return;
        const dragged = bm.getById(draggedId);
        const target = bm.getById(targetId);
        if (!dragged || !target || dragged.isSpecial) return;
        const allId = bm.getAllInternalId();

        let newParent, beforeId = null;
        if (zone === 'inside') {
            newParent = bm._keyOf(target);                 // target の子にする
        } else {
            newParent = target.isSpecial ? allId : (target.parent || allId);
            // 位置計算は必ず _keyOf (internalId||id) で行う。
            // 実データは internalId 欠落 (undefined) のため、.internalId 直参照だと
            // beforeId が常に undefined → reorderSibling が末尾追加になり「並べても末尾に飛ぶ」バグになる。
            if (zone === 'before') {
                beforeId = bm._keyOf(target);
            } else { // after
                const sibs = bm.getBookshelves().filter(b => (b.parent || allId) === newParent && bm._keyOf(b) !== draggedId);
                const idx = sibs.findIndex(b => bm._keyOf(b) === targetId);
                beforeId = (idx >= 0 && idx + 1 < sibs.length) ? bm._keyOf(sibs[idx + 1]) : null;
            }
        }
        if (!newParent) newParent = allId;

        if (!bm.canSetParent(draggedId, newParent)) {
            toast('循環参照になるため移動できません');
            return;
        }

        const sameParent = (dragged.parent || allId) === newParent;
        if (sameParent) {
            if (beforeId === draggedId) return;            // 変化なし
            bm.reorderSibling(draggedId, beforeId);
        } else {
            if (!(await this._applyReparentWithConfirm(draggedId, newParent))) return;
            bm.reorderSibling(draggedId, beforeId);
            // 親に入れたら展開して結果を見せる
            if (zone === 'inside') {
                try {
                    const key = 'bookshelf_treeExpanded_v1';
                    const set = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
                    set.add(newParent);
                    localStorage.setItem(key, JSON.stringify([...set]));
                } catch (_) {}
            }
        }

        this.saveUserData();
        if (typeof this.updateBookshelfSelector === 'function') this.updateBookshelfSelector();
        else this._renderSidebarTree();
        if (typeof this.renderBookshelfOverview === 'function') this.renderBookshelfOverview();
        if (typeof this._updateBookshelfViewTitle === 'function') this._updateBookshelfViewTitle();
        // 本棚管理モーダルが開いていれば同じ並びに更新 (左ペインと共通の挙動)
        const bsModal = document.getElementById('bookshelf-modal');
        if (bsModal && bsModal.classList.contains('show') && typeof this.renderBookshelfList === 'function') {
            this.renderBookshelfList();
        }
    }

    // 親キーの正規化: 「ルート(ALL 直下)」を表す値 (null/''/undefined/'all'/ALL の internalId・slug)
    // を全て null に畳む。同期時にルート本棚の parent が allInternalId で書かれるため、編集フォームの
    // 親比較で null と allInternalId が食い違い、毎回 reparent 確認が出るのを防ぐ。
    _normalizeParentKey(p) {
        if (!p || p === 'all') return null;
        const bm = this.bookshelfManager;
        const allInternalId = (bm && bm.getAllInternalId && bm.getAllInternalId())
            || this.userData?._storage?.allInternalId;
        if (allInternalId && p === allInternalId) return null;
        const all = bm && bm.getBySlug && bm.getBySlug('all');
        if (all && (p === all.internalId || p === all.id)) return null;
        return p;
    }

    // 親変更を確認ダイアログ付きで適用 (ツリー D&D / 編集フォーム 共用)。成功で true。
    async _applyReparentWithConfirm(internalId, newParentId) {
        const bm = this.bookshelfManager;
        const prev = bm.previewReparent(internalId, newParentId);
        if (!prev.valid) { toast('' + (prev.reason || '移動できません')); return false; }
        const bs = bm.getById(internalId);
        const parent = bm.getById(newParentId);
        const parentName = parent ? parent.name : '(ルート)';
        let msg = `「${bs.name}」を「${parentName}」の下へ移動します。\n`;
        if (prev.targetShelves && prev.targetShelves.length > 0) {
            const lines = prev.targetShelves.map(t => `　・${t.name}: +${t.addCount} 冊`).join('\n');
            msg += `\n「子は親の本の中から持つ」制約を保つため、` +
                   `「${bs.name}」と子本棚の本が移動先の親本棚にも追加されます:\n${lines}`;
        }
        const ok = await confirmDialog({ title: '本棚を移動', message: msg, okLabel: '移動する' });
        if (!ok) return false;
        try {
            bm.reparent(internalId, newParentId);
        } catch (e) {
            toast('' + e.message);
            return false;
        }
        return true;
    }

    /**
     * ツリーノードの操作メニュー (Phase G): 編集 / 子本棚を追加 / 削除。
     */
    _openTreeNodeMenu(bs, anchorEl) {
        document.getElementById('tree-node-menu')?.remove();
        const ico = (n) => window.renderIcon(n, { size: 14 });
        const menu = document.createElement('div');
        menu.id = 'tree-node-menu';
        menu.className = 'tree-node-menu';
        // 特殊本棚(ALL)は編集のみ (slug/親はフォーム側でロック、削除・子追加は不可)
        menu.innerHTML = bs.isSpecial
            ? `<button type="button" data-act="edit">${ico('pencil')}<span>編集</span></button>`
            : `
            <button type="button" data-act="edit">${ico('pencil')}<span>編集</span></button>
            <button type="button" data-act="add-child">${ico('plus')}<span>子本棚を追加</span></button>
            <button type="button" data-act="delete" class="is-danger">${ico('trash-2')}<span>削除</span></button>
        `;
        document.body.appendChild(menu);
        const r = anchorEl.getBoundingClientRect();
        const menuW = 180;
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8))}px`;

        const cleanup = () => {
            if (!menu.isConnected) return; // 管理役の onClose 経由と二重に呼ばれても 1 回だけ
            menu.remove();
            document.removeEventListener('click', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            this._overlays().close('tree-node-menu', { reason: 'button' });
        };
        // 重なり管理役 (イシュー#367 step5): メニューは「移る前に閉じる」側 (kind:'menu'・closeOthers・履歴に積まない・旧 z-index 1200 は撤去)
        this._overlays().open(menu, { kind: 'menu', hist: false, showClass: null, size: 'none', onClose: () => cleanup() });
        const onOutside = (e) => { if (window.Surface.isOutside(e, menu)) cleanup(); };
        const onKey = (e) => { if (window.Surface.isEsc(e)) cleanup(); };
        menu.querySelector('[data-act="edit"]')?.addEventListener('click', () => { cleanup(); this.editBookshelf(bs.id); });
        menu.querySelector('[data-act="add-child"]')?.addEventListener('click', () => { cleanup(); this.showBookshelfForm(null, bs.internalId); });
        menu.querySelector('[data-act="delete"]')?.addEventListener('click', () => { cleanup(); this.deleteBookshelf(bs.id); });
        setTimeout(() => {
            document.addEventListener('click', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    }

    _updateSidebarActive() {
        const isMain = document.body.classList.contains('app-view-main');
        const tree = document.getElementById('sidebar-bookshelf-tree');
        if (tree) tree.querySelectorAll('.tree-node').forEach(node => {
            const id = node.dataset.bookshelfId;
            const internalId = node.dataset.internalId;
            const matches = !isMain && (this.currentBookshelf === id || this.currentBookshelf === internalId);
            node.classList.toggle('is-active', !!matches);
        });
        // 下部フッターの現在地ハイライト (ADR-047 P1)。ホーム=main ビュー / 本棚=本棚ビュー。
        // 検索・設定はモーダルなので持続ハイライトしない。
        const nav = document.getElementById('mobile-bottom-nav');
        if (nav) nav.querySelectorAll('[data-mobile-nav]').forEach(btn => {
            const a = btn.dataset.mobileNav;
            const active = (a === 'home' && isMain) || (a === 'shelves' && !isMain);
            btn.classList.toggle('is-active', active);
        });
    }

    // ===== Header Icon Override (localStorage、全ヘッダーアイテム共通) =====
    //
    // ヘッダーボタンのアイコンをユーザが自由に変更できる。プラグインも静的アイテムも全て同じ
    // 体系で扱う。
    //
    // key 体系:
    //   - 静的: 'back-to-main', 'bookshelf-selector', 'manage-bookshelves', ...
    //   - 状態切替: 'overview-display:images', 'overview-display:text'
    //     (view-toggle:* は T03 のツールバー4動詞化でボタンごと廃止)
    //   - プラグイン: 'plugin:<id>'
    static HEADER_ICON_OVERRIDES_KEY = 'bookshelf_headerIconOverrides_v1';

    // ===== Icon Picker (Lucide 共通) =====
    /**
     * IconPicker を開く。選択結果は Promise<string|null> で返す (キャンセル/クリア時は null)。
     * @param {object} opts - { title, current, candidates }
     */
    openIconPicker(opts = {}) {
        return new Promise((resolve) => {
            const modal = document.getElementById('icon-picker-modal');
            const titleEl = document.getElementById('icon-picker-title');
            // 共通
            const cancelBtn = document.getElementById('icon-picker-cancel');
            const closeBtn = document.getElementById('icon-picker-modal-close');
            const clearBtn = document.getElementById('icon-picker-clear');
            const tabs = Array.from(document.querySelectorAll('.icon-picker-tab'));
            const tabContents = Array.from(document.querySelectorAll('.icon-picker-tab-content'));
            // Lucide tab
            const lucideGrid = document.getElementById('icon-picker-grid');
            const lucideInput = document.getElementById('icon-picker-lucide-input');
            const lucidePreview = document.getElementById('icon-picker-lucide-preview');
            const lucideUseBtn = document.getElementById('icon-picker-lucide-use');
            // Text tab
            const textGrid = document.getElementById('icon-picker-text-grid');
            const textInput = document.getElementById('icon-picker-text-input');
            const textPreview = document.getElementById('icon-picker-text-preview');
            const textUseBtn = document.getElementById('icon-picker-text-use');
            if (!modal || !lucideGrid) { resolve(null); return; }

            const title = opts.title || 'アイコンを選択';
            const current = opts.current || null;
            const candidates = opts.candidates || (window.BOOKSHELF_PICKER_DEFAULTS || Object.keys(window.LUCIDE_ICONS || {}));
            titleEl.textContent = title;

            // 初期化
            lucideInput.value = '';
            lucidePreview.innerHTML = '';
            lucideUseBtn.disabled = true;
            lucideUseBtn.dataset.pendingValue = '';
            textInput.value = '';
            textPreview.innerHTML = '';
            textUseBtn.disabled = true;
            textUseBtn.dataset.pendingValue = '';

            // タブ切替
            const activateTab = (name) => {
                tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
                tabContents.forEach(c => {
                    if (c.dataset.tabContent === name) c.removeAttribute('hidden');
                    else c.setAttribute('hidden', '');
                });
                setTimeout(() => {
                    if (name === 'lucide') lucideInput.focus();
                    else textInput.focus();
                }, 30);
            };
            // 初期タブは「文字アイコン」が current か判定して切替
            const isCurrentLucide = current && /^[a-z][a-z0-9-]*$/.test(current);
            activateTab(isCurrentLucide || !current ? 'lucide' : 'text');

            // セル生成
            const cellHtml = (value, isSel) => `
                <button type="button" class="icon-picker-cell${isSel ? ' is-selected' : ''}" data-icon-value="${BookshelfEscape.escapeHtml(value)}" title="${BookshelfEscape.escapeHtml(value)}">
                    ${window.renderIcon(value, { size: 22 })}
                    <span class="icon-picker-cell-name">${BookshelfEscape.escapeHtml(value)}</span>
                </button>
            `;

            // ===== Lucide tab: 履歴 (Lucide 名のみ) + おすすめ =====
            const renderLucideGrid = (filter) => {
                const q = (filter || '').trim().toLowerCase();
                const recents = (window.getIconRecents ? window.getIconRecents() : [])
                    .filter(v => /^[a-z][a-z0-9-]*$/.test(v)); // Lucide 名のみ
                const filterFn = (v) => !q || v.toLowerCase().includes(q);
                const recentList = recents.filter(filterFn);
                const candList = candidates.filter(filterFn).filter(v => !recents.includes(v));
                let html = '';
                if (recentList.length > 0) {
                    html += `<div class="icon-picker-section-label">🕐 履歴</div>`;
                    html += `<div class="icon-picker-section">${recentList.map(v => cellHtml(v, v === current)).join('')}</div>`;
                }
                if (candList.length > 0) {
                    html += `<div class="icon-picker-section-label">★ おすすめ</div>`;
                    html += `<div class="icon-picker-section">${candList.map(v => cellHtml(v, v === current)).join('')}</div>`;
                }
                if (!html) html = '<p style="color:#9ca3af;padding:0.5rem;">該当なし</p>';
                lucideGrid.innerHTML = html;
            };
            renderLucideGrid('');

            // Lucide 直接入力プレビュー
            let lucideTimer = null;
            let lucideSeq = 0;
            const updateLucidePreview = () => {
                clearTimeout(lucideTimer);
                const raw = lucideInput.value.trim().toLowerCase();
                if (!raw) {
                    lucidePreview.innerHTML = '';
                    lucideUseBtn.disabled = true;
                    lucideUseBtn.dataset.pendingValue = '';
                    renderLucideGrid('');
                    return;
                }
                // 検索フィルタはリアルタイム
                renderLucideGrid(raw);
                // Lucide 名パターンで CDN チェック
                if (!/^[a-z][a-z0-9-]*$/.test(raw)) {
                    lucidePreview.innerHTML = `<span style="color:#dc2626;font-size:0.75rem;">英小文字/数字/ハイフンのみ。文字アイコンタブへ →</span>`;
                    lucideUseBtn.disabled = true;
                    lucideUseBtn.dataset.pendingValue = '';
                    return;
                }
                lucidePreview.innerHTML = '<span style="color:#9ca3af;font-size:0.75rem;">CDN 確認中…</span>';
                lucideUseBtn.disabled = true;
                const mySeq = ++lucideSeq;
                lucideTimer = setTimeout(async () => {
                    const inner = await window.resolveIcon(raw);
                    if (mySeq !== lucideSeq) return;
                    if (inner) {
                        lucidePreview.innerHTML = window.icon(raw, { size: 24 }) + `<span style="color:#374151;font-size:0.8rem;">${raw}</span>`;
                        lucideUseBtn.disabled = false;
                        lucideUseBtn.dataset.pendingValue = raw;
                    } else {
                        lucidePreview.innerHTML = `<span style="color:#dc2626;font-size:0.75rem;">"${raw}" は Lucide に見つかりません</span>`;
                        lucideUseBtn.disabled = true;
                        lucideUseBtn.dataset.pendingValue = '';
                    }
                }, 250);
            };

            // ===== Text tab: 履歴 (任意文字のみ) =====
            const renderTextGrid = () => {
                const recents = (window.getIconRecents ? window.getIconRecents() : [])
                    .filter(v => !/^[a-z][a-z0-9-]*$/.test(v)); // Lucide 以外
                if (recents.length === 0) {
                    textGrid.innerHTML = '<p style="color:#9ca3af;padding:0.5rem;font-size:0.85rem;">履歴はまだありません。上の入力欄から文字を指定してください。</p>';
                    return;
                }
                let html = '<div class="icon-picker-section-label">🕐 履歴</div>';
                html += `<div class="icon-picker-section">${recents.map(v => cellHtml(v, v === current)).join('')}</div>`;
                textGrid.innerHTML = html;
            };
            renderTextGrid();

            // Text 直接入力プレビュー (即時、CDN 不要)
            const updateTextPreview = () => {
                const raw = textInput.value;
                if (!raw || !raw.trim()) {
                    textPreview.innerHTML = '';
                    textUseBtn.disabled = true;
                    textUseBtn.dataset.pendingValue = '';
                    return;
                }
                const v = raw.trim();
                textPreview.innerHTML = window.renderTextIcon(v, { size: 28 }) + `<span style="color:#374151;font-size:0.8rem;">${BookshelfEscape.escapeHtml(v)}</span>`;
                textUseBtn.disabled = false;
                textUseBtn.dataset.pendingValue = v;
            };

            // ===== イベントハンドラ =====
            const cleanup = ({ fromHistory = false } = {}) => {
                this._overlays().close('icon-picker-modal', { reason: fromHistory ? 'history' : 'button' });
                this._surface().close('icon-picker-modal', { fromHistory });
                lucideGrid.removeEventListener('click', onLucideGridClick);
                textGrid.removeEventListener('click', onTextGridClick);
                lucideInput.removeEventListener('input', updateLucidePreview);
                lucideInput.removeEventListener('keydown', onLucideKey);
                lucideUseBtn.removeEventListener('click', onLucideUse);
                textInput.removeEventListener('input', updateTextPreview);
                textInput.removeEventListener('keydown', onTextKey);
                textUseBtn.removeEventListener('click', onTextUse);
                tabs.forEach(t => t.removeEventListener('click', onTabClick));
                cancelBtn.removeEventListener('click', onCancel);
                closeBtn.removeEventListener('click', onCancel);
                clearBtn.removeEventListener('click', onClear);
                if (lucideTimer) clearTimeout(lucideTimer);
            };
            const finish = (value) => {
                cleanup();
                if (value && window.pushIconRecent) window.pushIconRecent(value);
                resolve(value);
            };
            const onLucideGridClick = (e) => {
                const cell = e.target.closest('.icon-picker-cell');
                if (cell) finish(cell.dataset.iconValue);
            };
            const onTextGridClick = (e) => {
                const cell = e.target.closest('.icon-picker-cell');
                if (cell) finish(cell.dataset.iconValue);
            };
            const onLucideUse = () => {
                const v = lucideUseBtn.dataset.pendingValue;
                if (v) finish(v);
            };
            const onTextUse = () => {
                const v = textUseBtn.dataset.pendingValue;
                if (v) finish(v);
            };
            const onLucideKey = (e) => { if (e.key === 'Enter' && !lucideUseBtn.disabled) { e.preventDefault(); onLucideUse(); } };
            const onTextKey   = (e) => { if (e.key === 'Enter' && !textUseBtn.disabled)   { e.preventDefault(); onTextUse();   } };
            const onTabClick = (e) => {
                const t = e.currentTarget;
                activateTab(t.dataset.tab);
            };
            const onCancel = () => { cleanup(); resolve(null); };
            const onClear = () => { cleanup(); resolve(''); };

            lucideGrid.addEventListener('click', onLucideGridClick);
            textGrid.addEventListener('click', onTextGridClick);
            lucideInput.addEventListener('input', updateLucidePreview);
            lucideInput.addEventListener('keydown', onLucideKey);
            lucideUseBtn.addEventListener('click', onLucideUse);
            textInput.addEventListener('input', updateTextPreview);
            textInput.addEventListener('keydown', onTextKey);
            textUseBtn.addEventListener('click', onTextUse);
            tabs.forEach(t => t.addEventListener('click', onTabClick));
            cancelBtn.addEventListener('click', onCancel);
            closeBtn.addEventListener('click', onCancel);
            clearBtn.addEventListener('click', onClear);

            // 重なり管理役 (イシュー#367): 中 (md・②決裁 2026-10-26: sm だと列が減って縦に伸び選びにくい)。
            // 親候補 (本棚フォーム等) の上に data-layer で積まれる (旧 CSS の z-index: 99999 !important は撤去)。
            // 履歴は従来どおり _modalHistPush/Pop (hist:false)
            this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false });
            // スマホ戻る: キャンセル扱いで閉じる (Promise を必ず resolve する)
            this._surface().open('icon-picker-modal', { close: (o) => { cleanup(o); resolve(null); }, extra: { pickerTitle: title, pickerCurrent: current } });
        });
    }

    // 設定 master-detail のカテゴリ定義 (順序 = 一覧/レールの並び)。ADR-047 P2。
    // イシュー#442: 公開は「公開の設定」モーダル(一覧から開く1か所)へ移設済み。この一覧には置かない(二重入口防止)
    static SETTINGS_CATEGORIES = [
        { id: 'account-section',  icon: 'user-circle',      label: 'アカウント',        desc: 'ログイン・プラン・使用量' },
        { id: 'sync-section',     icon: 'folder-cog',       label: '同期',              desc: '保存先: この端末 / GitHub / ハブ' },
        { id: 'library-section',  icon: 'library',          label: '蔵書',              desc: '取り込み・手動追加・除外一覧' },
        { id: 'plugins-section',  icon: 'puzzle',           label: 'プラグイン',         desc: '開発者向け・導入と管理' },
        { id: 'longmemo-section', icon: 'notebook-pen',     label: '長文メモ',           desc: 'エディタの選択' },
        { id: 'display-section',  icon: 'layout-dashboard', label: '表示',              desc: '星・メモ・Kindle の開き方' },
        { id: 'about-section',    icon: 'info',             label: 'このアプリについて',  desc: 'バージョン・各種ポリシー' },
        { id: 'admin-section',    icon: 'shield',           label: '管理者',            desc: 'プラン手動切替・通報の審査' },
    ];

    // ===== ハブ容量アラート (WP-B3/B4) =====
    // 使用率のしきい値判定 (純関数・E2E とロジックを共有するため static)
    //   null=非表示 / 'warn'=80%↑ / 'strong'=95%↑ / 'over'=Free で上限超過 (降格後の保存不能状態)
    static usageAlertLevel(used, quota, plan) {
        if (!(quota > 0)) return null;
        if (used > quota && plan !== 'plus') return 'over';
        const ratio = used / quota;
        if (ratio >= 0.95) return 'strong';
        if (ratio >= 0.8) return 'warn';
        return null;
    }
    // ===== Header customization (V6: square icon buttons, linear flow, vertical drag&drop editor) =====
    //
    // レイアウト構造:
    //   { items: [{ id, key }] }
    // - id は placement 単位の一意値
    // - 全アイテム duplicatable: false (1つのボタンに状態が紐づくため)
    // - プラグインボタン (plugin:<id>) は duplicatable: false 扱い (1配置のみ)
    // - needsBookshelf: メインビューでは disabled 表示 (現状 plugin: のみ運用)
    // 組込ヘッダーアイテムは廃止 (ADR-047 P1)。本棚管理は撤去 (⌘K)、設定はフッターへ移設。
    // #header-controls は有効プラグインの UI ボタン (plugin:<id>) 専用の受け皿になった。
    // 旧 back-to-main / bookshelf-selector / overview-display も既に撤去済み (2026-06-07)。
    static HEADER_ITEMS_META = {};
    static HEADER_LAYOUT_STORAGE_KEY = 'headerLayoutV8';
    static PLUGIN_ORDER_STORAGE_KEY = 'pluginOrderV1';
    // 検索対象 (タイトル + 説明) の最大文字数。長すぎる説明文の中だけマッチするのを避ける。
    static PLUGIN_SEARCH_NAME_LIMIT = 60;
    static PLUGIN_SEARCH_DESC_LIMIT = 140;
    // ===== プラグイン分類キャッシュ (無効でも分類バッジを出すため、ロード時の推定を保存) =====
    static PLUGIN_CONTRIB_CACHE_KEY = 'pluginContribCacheV1';

    // 設定等の面を開く前に「移る前に閉じる」側の面を畳む (設計案 19 §6-4・イシュー#367)。閉じるのは一時的な面
    // (管理役の popover/menu・未移行の公開パネル=記事エディタの上の 1 段) だけで、公開記事モーダル (多段) は閉じずに
    // 設定を上に積む: 管理役の面は data-layer で未移行の .modal より上に出るので、どの入口から来ても設定が最前面になる。
    // (多段をまとめて閉じてから開くと、NavState の go(-k) 合流が 1 段しか引き継げず着地時に設定が巻き戻される = SP390 で実測)。
    // 同じパターン (設定へ移る入口) は全て _openSettingsModal を通るので、閉じ方はここだけ
    _closeOverlaysForTransition() {
        this._overlays().closeAll({ kinds: ['popover', 'menu'], reason: 'closeOthers' });
        if (typeof this._artClosePublishPanel === 'function') this._artClosePublishPanel();
    }

    /**
     * 本棚の説明文を解決 (ホームカード / 本棚ヘッダー 共通)。
     * ALL(特殊)は既定文を返し、表示をどこでも一致させる (Phase H2-4)。
     */
    _bookshelfDescription(bs) {
        if (!bs) return '';
        return bs.description || (bs.isSpecial ? '除外していない全ての蔵書' : '');
    }

    /**
     * 本棚ビューのタイトル・説明を更新
     */
    _updateBookshelfViewTitle() {
        const titleEl = document.getElementById('current-bookshelf-title');
        const descEl = document.getElementById('current-bookshelf-desc');
        const iconEl = document.getElementById('current-bookshelf-icon');
        if (!titleEl) return;
        const id = this.currentBookshelf;
        // currentBookshelf は slug が入る場合と internalId が入る場合の両方がある (router 経由など)
        const bs = id
            ? (this.bookshelfManager?.getBySlug?.(id) || this.bookshelfManager?.getById?.(id))
            : null;
        let title = '';
        let desc = '';
        if (bs) {
            title = bs.name || '';
            desc = this._bookshelfDescription(bs);
        } else if (id === 'all') {
            title = '全ての本';
            desc = '除外していない全ての蔵書';
        }
        // アイコンは名前(上)＋説明(下)の左に立ててヘッダー高さに渡す (icon 左 / text 右の縦積み)
        const effectiveTitleIcon = (bs && bs.iconName) || 'library';
        if (iconEl) {
            iconEl.dataset.iconValue = effectiveTitleIcon;
            iconEl.innerHTML = window.renderIcon(effectiveTitleIcon, { size: 26 });
        }
        // イシュー#359 段階①: _refreshMarquees は scrollWidth/clientWidth を読んで一覧800枚のレイアウトを同期で
        // 強制する (step2 の self time 2位)。タイトル/説明が変わった時だけ呼ぶ。
        const changed = titleEl.textContent !== title || (descEl && descEl.textContent !== desc);
        titleEl.textContent = title;
        if (descEl) {
            descEl.textContent = desc;
            descEl.style.display = desc ? '' : 'none';
        }
        if (changed || !this._marqueeInitDone) { this._marqueeInitDone = true; this._refreshMarquees(); }
    }

    /**
     * はみ出しテキストの自動マーキー。overflow している要素だけ往復スクロールさせる。
     * el の中身を .amq-inner で一度だけ包み、overflow 幅から --amq-shift/--amq-dur を算出。
     */
    _setupMarqueeEl(el) {
        if (!el) return;
        let inner = el.querySelector(':scope > .amq-inner');
        if (!inner || el.childNodes.length !== 1) {
            // 中身が差し替えられた等で未ラップ → 包み直す
            inner = document.createElement('span');
            inner.className = 'amq-inner';
            while (el.firstChild) inner.appendChild(el.firstChild);
            el.appendChild(inner);
            el.classList.add('auto-marquee');
        }
        const overflow = inner.scrollWidth - el.clientWidth;
        if (overflow > 4 && el.clientWidth > 0) {
            el.style.setProperty('--amq-shift', `-${overflow + 12}px`);
            el.style.setProperty('--amq-dur', `${Math.max(6, Math.round(overflow / 22))}s`);
            el.classList.add('is-marquee');
        } else {
            el.classList.remove('is-marquee');
            el.style.removeProperty('--amq-shift');
        }
    }

    /** マーキー対象 (1行で省略されがちな箇所) をまとめて再評価。
     *  イシュー#359 段階⑤: scrollWidth/clientWidth の読みは一覧 800 枚のレイアウトを同期で強制するため、描画の後 (rAF) に回す
     *  (同一フレーム内の複数回呼び出しは 1 回にまとめる)。 */
    _refreshMarquees() {
        if (this._marqueeRaf) return;
        this._marqueeRaf = requestAnimationFrame(() => { this._marqueeRaf = null; this._refreshMarqueesNow(); });
    }

    _refreshMarqueesNow() {
        const els = [
            document.getElementById('current-bookshelf-title'),
            document.getElementById('current-bookshelf-desc'),
            ...document.querySelectorAll('.path-display')
        ];
        els.forEach(el => { if (el && el.offsetParent !== null) this._setupMarqueeEl(el); });
    }

    // ===== 上部ステータスバー (#4 同期切断 / #5 更新あり) =====
    _initStatusBar() {
        const bar = document.getElementById('app-status-bar');
        if (bar && !bar._bound) {
            bar._bound = true;
            bar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-status-action]');
                if (!btn) return;
                if (btn.dataset.statusAction === 'update') this._applyPwaUpdate();
                else if (btn.dataset.statusAction === 'open-sync') this._openSettingsModal('sync-method-select');
            });
        }
        this._updateStatusBar();
        if (!this._statusBarWatch) {
            this._statusBarWatch = true;
            // 同期切れに気づけるよう、復帰時と一定間隔で再評価。読込完了後の状態も拾う。
            window.addEventListener('focus', () => this._updateStatusBar());
            setInterval(() => this._updateStatusBar(), 30000);
            setTimeout(() => this._updateStatusBar(), 1500);
        }
        if (!this._appVersionWatch) {
            this._appVersionWatch = true;
            // 開きっぱなしのタブでも新バージョンに気づけるよう、復帰時と一定間隔でチェック (イシュー#143)。
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') this._checkAppVersion();
            });
            setInterval(() => this._checkAppVersion(), APP_VERSION_CHECK_INTERVAL_MS);
        }
    }

    /**
     * index.html を取り直し、埋め込まれたアプリのバージョンが現在ロード中のものと異なれば
     * 既存の PWA 更新バー (_onPwaUpdateReady → _updateStatusBar → _applyPwaUpdate) に接続する。
     * SW の updatefound とは独立した経路 (イシュー#143・仮説a-1対策)。表示は自作せず、
     * SW 検知時と同じ更新バー・同じ「更新」ボタンに乗せる。
     */
    async _checkAppVersion() {
        if (this._pwaUpdateReady) return; // 既に (SW経由も含め) 検知済みなら再チェック不要
        try {
            const res = await fetch('index.html', { cache: 'no-store' });
            if (!res.ok) return;
            const html = await res.text();
            const latest = extractAppVersionFromHtml(html);
            const current = extractAppVersionFromHtml(document.documentElement.outerHTML);
            if (latest && current && latest !== current) {
                // reg=null → _applyPwaUpdate() は reg.waiting が無い分岐 (location.reload()) を使う。
                this._onPwaUpdateReady(null);
            }
        } catch (_) { /* オフライン等は無視。次回チェックに任せる */ }
    }

    _updateStatusBar() {
        const bar = document.getElementById('app-status-bar');
        if (!bar) return;
        const ico = (n) => `<span class="status-ico">${window.renderIcon(n, { size: 15 })}</span>`;
        const rows = [];
        if (this._pwaUpdateReady) {
            rows.push(`<div class="status-row status-update">${ico('refresh-cw')}<span class="status-msg">新しいバージョンがあります</span><button class="status-btn" data-status-action="update" type="button">更新</button></div>`);
        }
        if (this._syncChecking) {
            rows.push(`<div class="status-row status-checking">${ico('refresh-cw')}<span class="status-msg">最新のデータを確認しています…</span></div>`);
        }
        if (!this._isSyncReady()) {
            const msg = this._syncFallbackFrom === 'hub'
                ? 'Asayake ハブにログインしていません。設定からログインしてください。'
                : '保存先が未設定です。今はこの端末の中だけに保存されています。';
            rows.push(`<div class="status-row status-warn">${ico('alert-triangle')}<span class="status-msg">${msg}</span><button class="status-btn" data-status-action="open-sync" type="button">保存先を選ぶ</button></div>`);
        } else if (this._syncError) {
            const msg = this._syncErrorMsg || '同期でエラーが発生しました。変更が保存できていない可能性があります。';
            rows.push(`<div class="status-row status-warn">${ico('alert-triangle')}<span class="status-msg">${BookshelfEscape.escapeHtml(msg)}</span><button class="status-btn" data-status-action="open-sync" type="button">確認</button></div>`);
        }
        if (rows.length === 0) { bar.hidden = true; bar.innerHTML = ''; return; }
        bar.innerHTML = rows.join('');
        bar.hidden = false;
    }

    // ===== PWA 更新 (#5) =====
    _onPwaUpdateReady(reg) {
        this._pwaUpdateReg = reg;
        this._pwaUpdateReady = true;
        this._updateStatusBar();
    }

    _applyPwaUpdate() {
        const reg = this._pwaUpdateReg;
        if (reg && reg.waiting) {
            reg.waiting.postMessage({ type: 'skipWaiting' }); // controllerchange でリロード
        } else {
            location.reload();
        }
    }

    // ===== pull-to-refresh (#5、タッチ。スタンドアロンで下に引いて更新) =====
    _initPullToRefresh() {
        const pane = document.querySelector('.app-main-pane');
        const indicator = document.getElementById('ptr-indicator');
        if (!pane || !indicator || pane._ptrBound) return;
        if (!window.matchMedia('(pointer: coarse)').matches) return; // タッチ端末のみ
        pane._ptrBound = true;
        const THRESHOLD = 72, MAX = 120;
        const txt = indicator.querySelector('.ptr-text');
        let startY = 0, startX = 0, active = false, dist = 0;
        const scroller = () => document.body.classList.contains('app-view-main')
            ? document.getElementById('view-main') : document.getElementById('view-bookshelf');

        pane.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1 || document.body.classList.contains('drawer-open')
                || document.body.classList.contains('book-detail-pinned')) { active = false; return; }
            const sc = scroller();
            if (sc && sc.scrollTop <= 0) { startY = e.touches[0].clientY; startX = e.touches[0].clientX; active = true; dist = 0; }
            else active = false;
        }, { passive: true });

        pane.addEventListener('touchmove', (e) => {
            if (!active) return;
            dist = e.touches[0].clientY - startY;
            // イシュー#359 段階⑤ (H11): 横の移動が縦より大きい (端スワイプの戻る/進む・横スクロール) は引っ張り更新にしない
            if (Math.abs(e.touches[0].clientX - startX) > Math.abs(dist)) { active = false; indicator.style.transform = 'translateY(-100%)'; indicator.classList.remove('is-armed'); return; }
            if (dist <= 0) { active = false; indicator.style.transform = 'translateY(-100%)'; indicator.classList.remove('is-armed'); return; }
            if (e.cancelable) e.preventDefault(); // 自前のPTRに切替 (ネイティブのバウンス抑制)
            const pull = Math.min(dist * 0.5, MAX);
            indicator.style.transform = `translateY(${pull - 52}px)`;
            const armed = dist >= THRESHOLD;
            indicator.classList.toggle('is-armed', armed);
            if (txt) txt.textContent = armed ? '離して更新' : '下に引いて更新';
        }, { passive: false });

        const end = () => {
            if (!active) return;
            const trigger = dist >= THRESHOLD;
            active = false;
            if (trigger) {
                indicator.classList.add('is-refreshing', 'is-armed');
                if (txt) txt.textContent = '更新中…';
                setTimeout(() => location.reload(), 350);
            } else {
                indicator.style.transform = 'translateY(-100%)';
                indicator.classList.remove('is-armed');
            }
            dist = 0;
        };
        pane.addEventListener('touchend', end, { passive: true });
        pane.addEventListener('touchcancel', end, { passive: true });
    }

    /**
     * Router からのルート変更を受信
     */
    _applyRoute(route) {
        if (!route) return;
        this._suppressRouterUpdate = true;
        try {
            if (route.view === 'main') {
                this._setBodyView('main');
                this._closeBookModalDom();
                if (typeof this.renderBookshelfOverview === 'function') this.renderBookshelfOverview();
                // イシュー#398: renderBookshelfOverview() は旧 #bookshelves-grid 向けの互換no-op
                // (ホーム=ダッシュボードに置換済み・該当DOMが無く何もしない)。他の画面からホームへ
                // 戻った時に本棚ハイライトが並び順の変更を反映していない状態で止まっていたのは
                // ここでダッシュボードを再描画していなかったため。
                if (this.dashboard) this.dashboard.render();
            } else if (route.view === 'bookshelf') {
                this._closeBookModalDom();
                let targetId = null;
                if (route.slug === 'all') {
                    targetId = 'all';
                } else {
                    const bs = this.bookshelfManager?.getBySlug?.(route.slug);
                    targetId = bs ? (bs.id || bs.internalId) : null;
                }
                if (targetId) {
                    this.switchBookshelf(targetId);
                } else {
                    // slug 解決できなければメインに戻す
                    this.router.navigateMain({ replace: true });
                }
            } else if (route.view === 'book') {
                // from が指定されていれば、まず本棚を切替えてから本を開く
                if (route.from) {
                    const bs = this.bookshelfManager?.getByInternalId?.(route.from)
                            || this.bookshelfManager?.getById?.(route.from);
                    if (bs) {
                        const id = bs.id || bs.internalId;
                        this.currentBookshelf = id;
                        this.applyFilters();
                        this._setBodyView('bookshelf');
                        this._updateBookshelfViewTitle();
                    }
                }
                const book = (this.books || []).find(b => b.asin === route.asin);
                if (!book) {
                    this.router.navigateMain({ replace: true });
                    return;
                }
                // イシュー#350: showBookDetail(book, true) は内部で router.navigateBook() を呼び、
                // 今のhashと異なる場合はブラウザが非同期にhashchangeを発火する。その結果ここが
                // 固定値 false で呼び直してしまい、開いた直後に編集モードが静かに戻っていた。
                // 「同じ本をまだ編集中」の時だけ編集モードを引き継ぐ (reRenderForDisplay:916-919 と
                // 同型)。別の本への遷移・deep link・再読込では常に閲覧モード (従来どおり)。
                const keepEditMode = !!(this._lastDetailBook && this._lastDetailBook.asin === book.asin && this._lastDetailEditMode);
                this.showBookDetail(book, keepEditMode);
            } else if (route.view === 'publish') {
                // イシュー#468: #/publish・#/publish/<id> への直リンク・起動時の着地。一覧を開き、
                // idがあればその記事を開く(進むボタンでの再構築は _reopenArtContext が別途担当)
                const modal = document.getElementById('publish-pages-modal');
                const already = modal && modal.classList.contains('show');
                const openArticleIfNeeded = () => {
                    if (!route.id || this._artEditingId === route.id) return;
                    const exists = this.publishArticleStore.get(route.id);
                    if (exists) this._artOpenEditor(route.id);
                    // ②指示(a): ストアに無いidは白画面/例外にせず #/publish へ replace して一覧を出す
                    else if (this.router) this.router.navigatePublish(null, { replace: true });
                };
                if (already) openArticleIfNeeded();
                else this.openPublishPagesModal().then(openArticleIfNeeded).catch(() => {});
            } else if (route.view === 'publish-settings') {
                // イシュー#468: #/publish/settings への直リンク・起動時の着地
                const modal = document.getElementById('publish-pages-modal');
                const already = modal && modal.classList.contains('show');
                if (already) this.openPublishSettingsModal();
                else this.openPublishPagesModal().then(() => this.openPublishSettingsModal()).catch(() => {});
            } else if (route.view === 'settings') {
                // イシュー#494: #/settings への直リンク・起動時の着地・リロード (#468では見送り、ここで対応)
                const modal = document.getElementById('settings-modal');
                const already = modal && modal.classList.contains('show');
                if (!already) this._openSettingsModal();
            }
        } finally {
            this._suppressRouterUpdate = false;
        }
    }

    // イシュー#359: UI 由来の hash 遷移 (ホーム/本棚/本) の唯一の入口。_applyRoute 由来 (_suppressRouterUpdate) では呼ばない。
    _navigateFromUi(kind, ...args) {
        if (!this.router) return false;
        this._closeOverlayFacesSilently();
        // replace/push の判断は台帳 (historyOp: overlay を閉じた遷移は replace・他は push)。router._setHash が nav へ委譲する
        if (kind === 'main') this.router.navigateMain();
        else if (kind === 'bookshelf') this.router.navigateBookshelf(args[0]);
        else if (kind === 'book') this.router.navigateBook(args[0], args[1]);
        return true;
    }

    // ビューの上に重なる面 (ドロワー/パレット) を、履歴を動かさず静かに閉じる (silent オプションは #259 で既設)。
    // 他のモーダルは hash 遷移の対象外 (従来どおり開いたまま) = 挙動を変えない。
    _closeOverlayFacesSilently() {
        if (document.body.classList.contains('drawer-open')) this._closeDrawer({ silent: true });
        const pal = document.getElementById('command-palette');
        if (pal && !pal.hidden) this._closePalette({ silent: true });
    }

    // イシュー#359 段階①: 同期完了時に「表示に影響する内容が変わったか」を比べるための指紋。
    // 変わっていなければ一覧 (800冊で約350ms) を作り直さない。比較できない時は「変わった」扱い (描画する側に倒す)。
    _renderFingerprint() {
        try {
            const ud = this.userData || {};
            const { _storage, ...rest } = ud;
            const st = _storage ? Object.assign({}, _storage, { libraryBooks: undefined }) : null;
            return JSON.stringify([(this.books || []).map((b) => [b.asin, b.title, b.productImage, b.readStatus]), rest, st]);
        } catch (_) { return `changed-${Date.now()}-${Math.random()}`; }
    }

    // イシュー#359 段階①: 並べ替えで動かした1冊だけを DOM 上で目標位置へ移す (_saveDetailSectionOrder と同型)。
    // 一覧800枚の作り直し (約365ms) を避ける。要素が見つからない時は false を返し、呼び出し元が従来どおり作り直す。
    _moveBookElement(draggedASIN, targetASIN) {
        const container = document.getElementById('bookshelf');
        if (!container) return false;
        this._flushListTail(); // 段階描画の途中でも、残りを置き切ってから1冊を動かす (#401)
        const sel = (asin) => container.querySelector(`.book-item[data-asin="${CSS.escape(asin)}"]`);
        const dragged = sel(draggedASIN);
        const target = sel(targetASIN);
        if (!dragged || !target || dragged === target) return false;
        target.before(dragged);
        // 描画用配列も同じ順に揃える (次の全件描画・前後の本の参照で齟齬を出さない)
        const fb = this.filteredBooks || [];
        const di = fb.findIndex((b) => b.asin === draggedASIN);
        if (di !== -1) {
            const [item] = fb.splice(di, 1);
            const ti = fb.findIndex((b) => b.asin === targetASIN);
            if (ti !== -1) fb.splice(ti, 0, item); else fb.push(item);
        }
        return true;
    }



    showBookshelfManager() {
        const modal = document.getElementById('bookshelf-modal');
        this._overlays().open(modal, { kind: 'modal', size: 'lg', hist: false }); // 重なり管理役 (イシュー#367 step5): lg
        this.renderBookshelfList();
        this._surface().open('bookshelf-modal', { close: (o) => this.closeBookshelfModal(o) });
    }

    closeBookshelfModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('bookshelf-modal');
        this._overlays().close('bookshelf-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('bookshelf-modal', { fromHistory });
    }

    renderBookshelfList() {
        const container = document.getElementById('bookshelves-list');
        if (!this.userData.bookshelves) {
            this.userData.bookshelves = [];
        }
        const bm = this.bookshelfManager;

        // 左ペインツリーと同じ階層構造で並べる (parent||null でグループ化、ALL を先頭、深さ優先)。
        // これにより並び替え時も子は親の下にまとまって表示される。
        const byParent = new Map();
        this.userData.bookshelves.forEach(bs => {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        });
        const rows = [];
        const walk = (bs, depth) => {
            rows.push({ bs, depth });
            (byParent.get(bm._keyOf(bs)) || []).forEach(c => walk(c, depth + 1));
        };
        const roots = (byParent.get(null) || []).slice().sort((a, b) => {
            if (a.isSpecial && !b.isSpecial) return -1;
            if (!a.isSpecial && b.isSpecial) return 1;
            return 0;
        });
        roots.forEach(r => walk(r, 0));

        let html = '';
        rows.forEach(({ bs: bookshelf, depth }) => {
            const bookCount = bookshelf.books ? bookshelf.books.length : 0;
            const isSpecial = bookshelf.isSpecial || false;
            const specialBadge = isSpecial
                ? `<span class="special-badge"><span class="h-icon">${window.renderIcon('lock', { size: 12 })}</span>特殊</span>`
                : '';
            const dragHandle = isSpecial
                ? window.renderIcon('lock', { size: 14 })
                : window.renderIcon('grip-vertical', { size: 14 });
            const bsEffectiveIcon = bookshelf.iconName || 'library';
            const bsIconSvg = window.renderIcon(bsEffectiveIcon, { size: 16 });
            html += `
                <div class="bookshelf-item" data-id="${bookshelf.id}" data-internal-id="${bm._keyOf(bookshelf)}" data-special="${isSpecial ? '1' : '0'}" style="margin-left:${depth * 1.5}rem;">
                    <div class="bookshelf-drag-handle">${dragHandle}</div>
                    <div class="bookshelf-info">
                        <h4><span class="bookshelf-list-icon" data-icon-value="${bsEffectiveIcon.replace(/"/g,'&quot;')}">${bsIconSvg}</span>${bookshelf.name} ${specialBadge}</h4>
                        <p>${bookshelf.description || ''}</p>
                        <span class="book-count">${bookCount}冊</span>
                    </div>
                    <div class="bookshelf-actions">
                        <button class="btn btn-secondary edit-bookshelf" data-id="${bookshelf.id}">編集</button>
                        ${isSpecial ? '' : `<button class="btn btn-danger delete-bookshelf" data-id="${bookshelf.id}">削除</button>`}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Remove existing event listeners to prevent duplicates
        const oldContainer = container.cloneNode(true);
        container.parentNode.replaceChild(oldContainer, container);
        
        // Add event listeners for edit/delete/share buttons
        oldContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-bookshelf')) {
                this.editBookshelf(e.target.dataset.id);
            } else if (e.target.classList.contains('delete-bookshelf')) {
                this.deleteBookshelf(e.target.dataset.id);
            }
        });

        // Add drag and drop functionality for bookshelf reordering
        this.setupBookshelfDragAndDrop(oldContainer);
    }

    addBookshelf() {
        this.showBookshelfForm();
    }

    showBookshelfForm(bookshelfToEdit = null, presetParentInternalId = null) {
        const modal = document.getElementById('bookshelf-form-modal');
        const title = document.getElementById('bookshelf-form-title');
        const nameInput = document.getElementById('bookshelf-name');
        const parentSelect = document.getElementById('bookshelf-parent');
        const iconNameInput = document.getElementById('bookshelf-icon-name');
        const iconLabel = document.getElementById('bookshelf-icon-label');
        const iconPreview = document.getElementById('bookshelf-icon-preview');
        const iconTrigger = document.getElementById('bookshelf-icon-trigger');
        const descriptionInput = document.getElementById('bookshelf-description');

        // 親本棚ドロップダウン構築（編集中は自身と子孫を除外）。
        // 実データは internalId 欠落のため _keyOf(=internalId||id) をキーに使う。
        // 先頭に「トップ階層」(=ルート直下, value="") を置く。ALL(特殊)は候補に出さない。
        const bm = this.bookshelfManager;
        const editKey = bookshelfToEdit ? bm._keyOf(bookshelfToEdit) : null;
        const excludedIds = bookshelfToEdit
            ? new Set([editKey, ...bm.getDescendants(editKey).map(b => bm._keyOf(b))])
            : new Set();
        const candidates = bm.getBookshelves().filter(b => !b.isSpecial && !excludedIds.has(bm._keyOf(b)));
        parentSelect.innerHTML = '<option value="">（トップ階層）</option>' + candidates
            .map(b => `<option value="${bm._keyOf(b)}">${BookshelfEscape.escapeHtml(b.name)}</option>`)
            .join('');

        const setIcon = (name) => {
            const effective = name || 'library';
            iconNameInput.value = effective;
            iconLabel.textContent = effective;
            iconPreview.dataset.iconValue = effective;
            iconPreview.innerHTML = window.renderIcon(effective, { size: 18 });
        };

        const titleIcon = `<span class="h-icon" data-icon="library" data-icon-size="20"></span>`;
        if (bookshelfToEdit) {
            title.innerHTML = `${titleIcon}本棚を編集`;
            if (typeof window.applyIcons === 'function') window.applyIcons(title);
            nameInput.value = bookshelfToEdit.name;
            parentSelect.value = bookshelfToEdit.parent || '';
            setIcon(bookshelfToEdit.iconName);
            descriptionInput.value = bookshelfToEdit.description || '';
            // 特殊本棚（all）は親変更不可。slug は自動採番・不変 (UI なし)
            if (bookshelfToEdit.isSpecial) {
                parentSelect.disabled = true;
                parentSelect.title = '特殊本棚は親を持てません';
            } else {
                parentSelect.disabled = false;
                parentSelect.title = '';
            }
        } else {
            title.innerHTML = `${titleIcon}新しい本棚`;
            if (typeof window.applyIcons === 'function') window.applyIcons(title);
            nameInput.value = '';
            // Phase G: ツリーから「子本棚を追加」した場合は親を事前選択
            parentSelect.value = presetParentInternalId || '';
            setIcon('library');
            descriptionInput.value = '';
        }

        // IconPicker トリガ (1 回だけ bind)
        if (iconTrigger && !iconTrigger._bound) {
            iconTrigger._bound = true;
            iconTrigger.addEventListener('click', async () => {
                const picked = await this.openIconPicker({
                    title: '本棚のアイコンを選択',
                    current: iconNameInput.value || 'library'
                });
                if (picked === null) return; // キャンセル
                setIcon(picked || 'library'); // 空文字 (クリア) なら library
            });
        }

        this.currentEditingBookshelf = bookshelfToEdit;

        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this._surface().open('bookshelf-form-modal', { close: (o) => this._formBackGuard('bookshelf-form-modal', o, (oo) => this.closeBookshelfForm(oo)), extra: { bsKey: editKey } });
        this._formSnapTake('bookshelf-form-modal');
        nameInput.focus();
    }

    closeBookshelfForm({ fromHistory = false } = {}) {
        const modal = document.getElementById('bookshelf-form-modal');
        this._overlays().close('bookshelf-form-modal', { reason: fromHistory ? 'history' : 'button' });
        this.currentEditingBookshelf = null;
        this._surface().close('bookshelf-form-modal', { fromHistory });
    }

    async saveBookshelfForm() {
        const nameInput = document.getElementById('bookshelf-name');
        const parentSelect = document.getElementById('bookshelf-parent');
        const iconNameInput = document.getElementById('bookshelf-icon-name');
        const descriptionInput = document.getElementById('bookshelf-description');

        const name = nameInput.value.trim();
        if (!name) {
            toast('本棚の名前を入力してください');
            nameInput.focus();
            return;
        }

        // slug は URL・ファイル名の正本キー (ADR-009)。手動入力 UI は廃止し自動採番に一本化。
        // 編集時は既存 slug を維持 (リネームしない)、新規は bookshelf1, bookshelf2 ... を自動付与。
        const slug = this.currentEditingBookshelf
            ? (this.currentEditingBookshelf.id || this._generateDefaultSlug())
            : this._generateDefaultSlug();

        const parentId = parentSelect.value || null;   // "" = トップ階層(ルート)
        const meta = {
            name,
            slug,
            iconName: iconNameInput.value.trim() || 'library',
            description: descriptionInput.value.trim()
        };

        let _emitCreated = null, _emitUpdated = null;
        try {
            if (this.currentEditingBookshelf) {
                const editing = this.currentEditingBookshelf;
                const editKey = this.bookshelfManager._keyOf(editing);
                const _prevMeta = { ...editing };
                // 親以外のフィールドを更新 (parent は meta に含めず update では触らない)
                this.bookshelfManager.update(editKey, meta);
                _emitUpdated = { prev: _prevMeta, key: editKey };
                // 親変更は確認ダイアログ + 本の補充フロー経由 (H2-2 と共用)。
                // ルートを表す値 (null/''/allInternalId/'all') は正規化して比較し、
                // 親が実際に変わった時だけ確認を出す (無変更編集で警告が出るのを防ぐ)。
                const curParent = this._normalizeParentKey(editing.parent);
                const newParent = this._normalizeParentKey(parentId);
                if (newParent !== curParent) {
                    await this._applyReparentWithConfirm(editKey, newParent);
                    // キャンセル時は親のみ据え置き (他フィールドは保存済み)
                }
                // slug 変更があれば rename（ファイル削除も走る）
                if (slug !== editing.id) {
                    await this.bookshelfManager.rename(editKey, slug);
                }
            } else {
                const created = this.bookshelfManager.create({ ...meta, parent: parentId || undefined });
                _emitCreated = created || { ...meta, id: slug };
            }
        } catch (e) {
            toast(`${e.message}`);
            return;
        }

        await this.saveUserData();
        // プラグイン通知 (保存確定後)
        if (this.pluginAPI) {
            if (_emitCreated) this.pluginAPI._emit('bookshelf:created', { meta: _emitCreated });
            if (_emitUpdated) {
                const cur = this.bookshelfManager.getBySlug(slug) || this.bookshelfManager.getByInternalId(_emitUpdated.key);
                this.pluginAPI._emit('bookshelf:updated', { meta: cur ? { ...cur } : { ...meta }, prev: _emitUpdated.prev });
            }
        }
        this.updateBookshelfSelector();    // popover + サイドバーツリー再描画
        this.renderBookshelfList();        // 本棚管理モーダル
        this.renderBookshelfOverview();    // ホーム本棚カード
        this._updateBookshelfViewTitle();  // 現在開いている本棚のタイトル
        this.closeBookshelfForm();
    }

    _generateDefaultSlug() {
        const existing = new Set(this.bookshelfManager.getBookshelves().map(b => b.id));
        let i = 1;
        while (existing.has(`bookshelf${i}`)) i++;
        return `bookshelf${i}`;
    }

    editBookshelf(bookshelfId) {
        const bookshelf = this.userData.bookshelves.find(b => b.id === bookshelfId);
        if (!bookshelf) return;
        
        this.showBookshelfForm(bookshelf);
    }

    async deleteBookshelf(bookshelfId) {
        const bookshelf = this.bookshelfManager.getBySlug(bookshelfId);
        if (!bookshelf) return;

        let _removedTargets = [];
        const result = await this.bookshelfManager.remove(bookshelf.internalId, {
            confirmCallback: async (targets) => {
                _removedTargets = targets.slice();
                const cascade = targets.length > 1
                    ? `\n\n子孫本棚もカスケード削除されます:\n${targets.map(t => `・${t.name}`).join('\n')}`
                    : '';
                return await confirmDialog({
                    title: '本棚を削除',
                    message: `本棚「${bookshelf.name}」を削除しますか？${cascade}\n\nこの操作は取り消せません。`,
                    okLabel: '削除する',
                    danger: true
                });
            }
        });

        if (!result) return;

        await this.saveUserData();
        // プラグイン通知: 削除された本棚 (カスケード分も含む)
        if (this.pluginAPI) {
            const removed = _removedTargets.length ? _removedTargets : [bookshelf];
            for (const t of removed) {
                this.pluginAPI._emit('bookshelf:removed', { internalId: t.internalId, meta: { ...t } });
            }
        }
        this.updateBookshelfSelector();
        this.renderBookshelfList();

        if (this.currentBookshelf === bookshelfId) {
            this.currentBookshelf = 'all';
            this.applyFilters();
        }
    }

    async addBookToBookshelf(asin) {
        // select は id ではなく class + data-asin で描画される (showBookDetail の addBookshelfHtml 参照)
        const bookshelfSelect = document.querySelector(`.bookshelf-select[data-asin="${CSS.escape(asin)}"]`);
        if (!bookshelfSelect) {
            toast('本棚を選択してください');
            return;
        }
        const bookshelfId = bookshelfSelect.value;

        if (!bookshelfId) {
            toast('本棚を選択してください');
            return;
        }

        const bookshelf = this.bookshelfManager.getBySlug(bookshelfId);
        if (!bookshelf) {
            toast('本棚が見つかりません');
            return;
        }

        if ((bookshelf.books || []).includes(asin)) {
            toast(`この本は既に「${bookshelf.name}」に追加済みです`);
            return;
        }

        // サブセット制約: 祖先で本を含んでいない本棚は自動追加
        const ancestors = this.bookshelfManager.getAncestors(bookshelf.internalId);
        const ancestorsToAdd = ancestors.filter(a => !(a.books || []).includes(asin));

        // 子孫がいれば「子孫にも追加するか」プロンプト（Phase 2 では prompt 簡易UI）
        const descendants = this.bookshelfManager.getDescendants(bookshelf.internalId);
        const propagateTo = await this._chooseDescendantsToAddTo(descendants);

        // 祖先 + 自身 + 選択した子孫 に追加
        const targetIds = [...ancestorsToAdd.map(a => a.internalId), bookshelf.internalId, ...propagateTo];
        for (const id of targetIds) {
            this.bookshelfManager.addBookToBookshelf(id, asin);
        }

        await this.saveUserData();
        this.renderBookshelfList();

        const book = this.books.find(b => b.asin === asin);
        if (book) {
            this.showBookDetail(book, true);
        }

        const ancestorMsg = ancestorsToAdd.length > 0
            ? `\n（祖先にも自動追加: ${ancestorsToAdd.map(a => a.name).join('、')}）`
            : '';
        const descendantMsg = propagateTo.length > 0
            ? `\n（子孫にも追加: ${propagateTo.length}個の本棚）`
            : '';
        toast(`「${bookshelf.name}」に追加しました${ancestorMsg}${descendantMsg}`);
        bookshelfSelect.value = '';
    }

    _chooseDescendantsToAddTo(descendants) {
        return new Promise((resolve) => {
            if (!descendants || descendants.length === 0) {
                resolve([]);
                return;
            }
            const modal = document.getElementById('descendants-pick-modal');
            const list = document.getElementById('descendants-pick-list');
            const confirmBtn = document.getElementById('descendants-pick-confirm');
            const skipBtn = document.getElementById('descendants-pick-skip');
            const closeBtn = document.getElementById('descendants-pick-modal-close');

            list.innerHTML = `
                <label style="display: block; padding: 0.25rem 0; font-weight: bold;">
                    <input type="checkbox" id="descendants-pick-all">
                    全て選択
                </label>
                <hr style="margin: 0.5rem 0;">
            ` + descendants.map(d => `
                <label style="display: block; padding: 0.25rem 0;">
                    <input type="checkbox" class="descendants-pick-item" value="${d.internalId}">
                    <span data-icon-value="${(d.iconName || 'library').replace(/"/g,'&quot;')}" style="display:inline-flex;vertical-align:-3px;color:#4338ca;margin-right:0.25rem;">${window.renderIcon(d.iconName || 'library', { size: 14 })}</span>${d.name}
                </label>
            `).join('');

            const allCheck = document.getElementById('descendants-pick-all');
            allCheck.addEventListener('change', () => {
                list.querySelectorAll('.descendants-pick-item').forEach(c => {
                    c.checked = allCheck.checked;
                });
            });

            // 重なり管理役 (イシュー#367): 小 (sm)。履歴は従来どおり _modalHistPush/Pop (hist:false = 管理役は履歴に触らない)
            this._overlays().open(modal, { kind: 'modal', size: 'sm', hist: false });

            const cleanup = ({ fromHistory = false } = {}) => {
                this._overlays().close('descendants-pick-modal', { reason: fromHistory ? 'history' : 'button' });
                this._surface().close('descendants-pick-modal', { fromHistory });
                confirmBtn.removeEventListener('click', onConfirm);
                skipBtn.removeEventListener('click', onSkip);
                closeBtn.removeEventListener('click', onSkip);
            };
            const onConfirm = () => {
                const selected = Array.from(list.querySelectorAll('.descendants-pick-item:checked'))
                    .map(c => c.value);
                cleanup();
                resolve(selected);
            };
            const onSkip = () => {
                cleanup();
                resolve([]);
            };
            confirmBtn.addEventListener('click', onConfirm);
            skipBtn.addEventListener('click', onSkip);
            closeBtn.addEventListener('click', onSkip);
            // スマホ戻る: スキップ扱いで閉じる (Promise を必ず resolve する)
            this._surface().open('descendants-pick-modal', { close: (o) => { cleanup(o); resolve([]); }, extra: { descIds: descendants.map((d) => d.internalId) } });
        });
    }

    async removeFromBookshelf(asin, bookshelfId) {
        const bookshelf = this.bookshelfManager.getBySlug(bookshelfId);
        if (!bookshelf || !bookshelf.books) {
            toast('本棚が見つかりません');
            return;
        }
        // 特殊本棚（all）からの削除は permanent でないため excludeBook を案内
        if (bookshelf.isSpecial) {
            toast('「全ての本」から本を外すには「all から除外」ボタンを使ってください');
            return;
        }

        const book = this.books.find(b => b.asin === asin);
        const bookTitle = book ? book.title : 'この本';

        if (!bookshelf.books.includes(asin)) {
            toast(`この本は「${bookshelf.name}」にありません`);
            return;
        }

        const descendants = this.bookshelfManager.getDescendants(bookshelf.internalId);
        const descendantsWithBook = descendants.filter(d => (d.books || []).includes(asin));

        let confirmMsg = `「${bookTitle}」を「${bookshelf.name}」から除外しますか？\n\n本自体は削除されず、この本棚からのみ削除されます。`;
        if (descendantsWithBook.length > 0) {
            const names = descendantsWithBook.map(d => `・${d.name}`).join('\n');
            confirmMsg += `\n\n子孫本棚にも含まれているため、自動カスケード削除されます:\n${names}`;
        }

        if (!(await window.confirmDialog({ message: confirmMsg, danger: true }))) return;

        // BookshelfManager 経由でカスケード削除
        this.bookshelfManager.removeBookFromBookshelf(bookshelf.internalId, asin);

        await this.saveUserData();
        this.renderBookshelfList();

        if (this.currentBookshelf === bookshelfId) {
            this.applyFilters();
            this.updateDisplay();
        }

        toast(`「${bookTitle}」を「${bookshelf.name}」から除外しました`);
        this.closeModal();
    }

    /**
     * all本棚から除外（library.json には残るが表示・操作対象から外れる）
     */
    /**
     * 除外のコア処理 (確認・保存・再描画なし)。単体/一括の両方から呼ぶ。
     * library.books からの除去と exclusions/_storage の更新まで行う。
     */
    _excludeAsinCore(asin) {
        if (!this.userData._storage) this.userData._storage = {};
        if (!Array.isArray(this.userData._storage.exclusions)) this.userData._storage.exclusions = [];
        if (!Array.isArray(this.userData._storage.libraryBooks)) {
            this.userData._storage.libraryBooks = (this.books || []).map(b => ({
                asin: b.asin,
                title: b.title || '',
                authors: b.authors || '',
                acquiredTime: b.acquiredTime || Date.now(),
                readStatus: b.readStatus || 'UNKNOWN',
                productImage: b.productImage || '',
                source: b.source || 'unknown',
                addedDate: b.addedDate || Date.now(),
                ...(b.updatedAsin ? { updatedAsin: b.updatedAsin } : {}),
                ...(b.originType ? { originType: b.originType } : {}),
                ...(b.statusFromPlatformSearch ? { statusFromPlatformSearch: b.statusFromPlatformSearch } : {}),
                ...(b.lendingType ? { lendingType: b.lendingType } : {}),
                ...(b.lendingStatus ? { lendingStatus: b.lendingStatus } : {})
            }));
        }
        if (!this.userData._storage.exclusions.includes(asin)) {
            this.userData._storage.exclusions.push(asin);
        }
        this.bookManager.library.books = this.bookManager.library.books.filter(b => b.asin !== asin);
        this.bookManager.library.metadata.totalBooks = this.bookManager.library.books.length;
        if (this.userData.bookOrder && Array.isArray(this.userData.bookOrder.all)) {
            this.userData.bookOrder.all = this.userData.bookOrder.all.filter(a => a !== asin);
        }
    }

    async excludeBook(asin) {
        const book = this.books.find(b => b.asin === asin);
        if (!book) {
            toast('指定された書籍が見つかりません');
            return;
        }
        const okExclude = await confirmDialog({
            title: 'すべての本から除外',
            message: `「${book.title}」を all から除外しますか？\n\n再Kindle取込でも復活しません。\n除外一覧から解除できます。`,
            okLabel: '除外する',
            danger: true
        });
        if (!okExclude) {
            return;
        }
        this._excludeAsinCore(asin);
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
        this.books = this.bookManager.getAllBooks();

        await this.saveUserData();
        if (this.pluginAPI) this.pluginAPI._emit('book:removed', { asin, reason: 'excluded' });
        this.applyFilters();
        this.updateDisplay();
        this.updateStats();
        this.closeModal();
        toast(`「${book.title}」を除外しました`);
    }

    /**
     * 除外を解除（library.json から書誌を取り出して復活）
     */
    async unexcludeBook(asin) {
        if (!this.userData._storage || !Array.isArray(this.userData._storage.exclusions)) return;
        if (!this.userData._storage.exclusions.includes(asin)) return;

        this.userData._storage.exclusions = this.userData._storage.exclusions.filter(a => a !== asin);

        const libraryBooks = this.userData._storage.libraryBooks || [];
        const book = libraryBooks.find(b => b.asin === asin);
        if (book) {
            if (!this.bookManager.library.books.some(b => b.asin === asin)) {
                this.bookManager.library.books.push(book);
            }
            this.bookManager.library.metadata.totalBooks = this.bookManager.library.books.length;
            localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
            this.books = this.bookManager.getAllBooks();

            if (!this.userData.bookOrder) this.userData.bookOrder = {};
            if (!Array.isArray(this.userData.bookOrder.all)) this.userData.bookOrder.all = [];
            if (!this.userData.bookOrder.all.includes(asin)) {
                this.userData.bookOrder.all.unshift(asin);
            }
        }

        await this.saveUserData();
        if (book && this.pluginAPI) this.pluginAPI._emit('book:added', { book: { ...book }, reason: 'unexcluded' });
        this.applyFilters();
        this.updateDisplay();
        this.updateStats();
        this.renderExclusionsList();
    }

    /**
     * 公開実行の共通処理 (ADR-030): 接続/公開先 repo チェック → flushSync → exporter.export()。
     * 公開はページ単位 (published フラグ) で制御し、サイトは「公開中ページの集合」。
     * publish/unpublish の両方からこれを呼ぶ。戻り値 { ok, result?, reason? }。
     */

    async _runPublishExport() {
        // 多重実行ガード: 公開処理は await を多数挟むため、連打/並行起動を防ぐ
        if (this._publishInFlight) {
            toast('公開処理を実行中です。完了までお待ちください。', { type: 'warn' });
            return { ok: false, reason: 'inflight' };
        }
        if (!this._isSyncReady()) {
            await this._confirmOpenSettings('本のデータの保存先がまだ設定されていません。設定の「同期」で保存先を選んでください。', 'sync-method-select');
            return { ok: false, reason: 'sync' };
        }
        if (this.syncMethod !== 'github' && this.obsidianDirHandle) {
            this.storage.setDirHandle(this.obsidianDirHandle);
        }
        const pub = this.exporter._resolvePublishConfig();
        if (pub.target === 'hub') {
            // 共有ハブ公開: GitHub repo は不要。ハブへのログインだけ確認
            const hub = (SyncConfigManager.load().hub) || {};
            if (!(hub.key && hub.apiBase)) {
                await this._confirmOpenSettings('共有（ハブ）公開には Asayake アカウントへのログインが必要です。設定の「アカウント」でログインしてください。', 'account-section');
                return { ok: false, reason: 'hub' };
            }
        } else {
            // 自分の GitHub repo 公開: GitHub 接続と公開先 repo が必要
            const gh = (SyncConfigManager.load().github) || {};
            if (!gh.token) {
                await this._confirmOpenSettings('公開には GitHub 接続が必要です。設定の「同期」で GitHub に接続してください。', 'sync-method-select');
                return { ok: false, reason: 'github' };
            }
            if (!pub.repo) {
                await this._confirmOpenSettings('公開先リポジトリが未設定です。設定の「公開」で公開用 GitHub リポジトリ（public）を選んでください。', 'publish-target-select');
                return { ok: false, reason: 'repo' };
            }
        }
        // 未保存編集が保存先に書けているかを公開後に判定するため、flush 前に pending 有無を記録
        let hadPending = this._pendingSync || this._syncInProgress;
        try { hadPending = hadPending || localStorage.getItem('virtualBookshelf_pendingSync') === '1'; } catch (_) {}

        this._publishInFlight = true;
        try {
            // 編集中の変更を確実に書き出してから export
            await this.flushSync();
            // flush で同期が失敗した場合、保存先には古い内容しか無い → 古い内容での公開を防ぐ
            if (hadPending && this._syncError) {
                toast('未保存の変更を保存先に書き込めませんでした。同期エラーを解消してから公開してください。', { type: 'warn' });
                return { ok: false, reason: 'flush' };
            }
            const result = await this.exporter.export();
            console.info('公開 URL:', result.siteUrl);
            // 公開先を記録 (target 切替時に旧公開先の残存を警告するため)
            try {
                const c = SyncConfigManager.load();
                c.publish = { ...(c.publish || {}), lastPublishedTarget: pub.target };
                SyncConfigManager.save(c);
            } catch (_) {}
            return { ok: true, result };
        } catch (e) {
            console.error('公開エクスポートエラー:', e);
            toast(e.message, { type: 'error' });
            return { ok: false, reason: 'export', error: e };
        } finally {
            this._publishInFlight = false;
        }
    }

    /**
     * 記事単位の公開系操作 (公開/公開取消/削除) を直列化するガード (イシュー#374・案D)。
     * 同じ記事に対して2回目の呼び出しが来ても何もしない (何も起きないだけで toast も出さない。
     * 一覧の公開ボタンは呼び出し側で disabled にするのが一次防御・これは連打やダブルクリックに
     * 対する最後の防波堤)。_runPublishExport の _publishInFlight (処理全体で1本) とは独立に、
     * 記事ごとの多重実行を防ぐ。
     * @param {string} id
     * @param {function():Promise<*>} task
     */

    // アンカー要素の直下にメニューを position:fixed (ビューポート基準の絶対座標) で配置する。
    // menuEl は祖先の position/DOM構造を問わず fixed なので、祖先が overflow:auto の
    // スクロールコンテナ化していてもクリップされない (position:absolute だとクリップされる。
    // ui-standards §2-12・イシュー#82 で #59 の .art-col スクロールコンテナ化により再発)。
    // 下に入らず上には入る→上開きへフリップ (is-up)。上下どちらにも入らなければ margin だけ
    // 空けて画面内へ収める (fixed のため scrollIntoView は効かない＝クランプのみで保証する)。
    // 呼ぶたびに向きをリセットするので、開くたびに呼び直せば前回の is-up は残らない。
    _placeAnchoredMenu(anchorEl, menuEl) {
        menuEl.classList.remove('is-up');
        const margin = 8;
        const anchorRect = anchorEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();
        const spaceBelow = window.innerHeight - anchorRect.bottom;
        const spaceAbove = anchorRect.top;
        let top;
        if (spaceBelow < menuRect.height + margin && spaceAbove >= menuRect.height + margin) {
            menuEl.classList.add('is-up');
            top = anchorRect.top - menuRect.height;
        } else {
            top = anchorRect.bottom;
        }
        top = Math.max(margin, Math.min(top, window.innerHeight - menuRect.height - margin));
        let left = anchorRect.left + anchorRect.width / 2 - menuRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
        menuEl.style.top = `${top}px`;
        menuEl.style.left = `${left}px`;
    }


    /**
     * 長文メモ books/<ASIN>__<title>.md を作成 / Obsidian で開く
     * 同期フォルダが vault 外の場合があるため、初回に vault 名・サブパスを設定で持つ
     */
    async openOrCreateBookMemo(asin) {
        if (!this._isSyncReady()) {
            toast('先に「同期」で保存先（Asayake ハブ・この端末のフォルダ・GitHub のどれか）を設定してください。');
            return;
        }
        const book = this.books.find(b => b.asin === asin);
        if (!book) return;

        if (this.syncMethod !== 'github' && this.obsidianDirHandle) {
            this.storage.setDirHandle(this.obsidianDirHandle);
        }

        const settings = this.userData.settings || (this.userData.settings = {});
        const requestedOpenWith = settings.bookMemoOpenWith || 'app-editor';
        // クラウド同期 (GitHub / ハブ) では外部リンクは動かない (ローカルファイル不在のため強制 app-editor)
        const isCloud = (this.syncMethod === 'github' || this.syncMethod === 'hub');
        const openWith = isCloud ? 'app-editor' : requestedOpenWith;

        // アプリ内エディタ: モーダルを開き、雛形は EasyMDE 側で扱う (空時は buildBookMemoTemplate)
        if (openWith === 'app-editor') {
            await this._openBookMemoInAppEditor(asin, book);
            return;
        }

        // 外部エディタ向け: 雛形をまず書き込む (ファイルが存在しないと obsidian:// が無効になるため)
        let created = false;
        try {
            const exists = await this.storage.bookMemoExists(asin, book.title);
            if (!exists) {
                const content = this.storage.buildBookMemoTemplate(book);
                await this.storage.writeBookMemo(asin, book.title, content);
                created = true;
            }
            if (!this.userData.notes[asin]) this.userData.notes[asin] = { memo: '', rating: 0 };
            this.userData.notes[asin].hasDetailMemo = true;
            this.saveUserData();
        } catch (e) {
            console.error('長文メモ作成エラー:', e);
            toast(`ファイル操作に失敗しました: ${e.message}`);
            return;
        }

        const fullPath = this.storage.bookMemoFullPath(asin, book.title); // private/books/...
        const folderName = (this.obsidianDirHandle && this.obsidianDirHandle.name) || '(同期先)';
        try { await navigator.clipboard.writeText(fullPath); } catch (_) {}

        if (openWith === 'obsidian') {
            // vault 名未設定なら初回プロンプト
            if (typeof settings.obsidianVaultName === 'undefined') {
                const vaultInput = prompt(
                    'Obsidian で開くために vault 名を設定します\n\n同期フォルダが vault 自体: vault 名を入力\n同期フォルダが vault のサブフォルダ: vault 名を入力 (後でサブパスも聞きます)',
                    folderName
                );
                if (vaultInput && vaultInput.trim()) {
                    settings.obsidianVaultName = vaultInput.trim();
                    const subInput = prompt('vault 内のサブパス (例: 40_reading)\n空欄で vault 直下', '');
                    settings.obsidianSubPath = (subInput || '').trim();
                } else {
                    settings.obsidianVaultName = '';
                    settings.obsidianSubPath = '';
                }
                this.saveUserData();
            }
            const vaultName = settings.obsidianVaultName;
            if (vaultName) {
                const subPath = (settings.obsidianSubPath || '').replace(/^\/+|\/+$/g, '');
                const filePath = subPath ? `${subPath}/${fullPath}` : fullPath;
                const obsidianUrl = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
                if (await window.confirmDialog({ message: `${created ? '詳細メモを作成しました' : '詳細メモ'}\n\n${fullPath}\n（パスをクリップボードにコピー済）\n\nObsidian vault "${vaultName}" で開きますか？` })) {
                    window.location.href = obsidianUrl;
                }
            } else {
                toast(`${folderName}/${fullPath}\n（パスをクリップボードにコピー済）\n\nvault 名が未設定です。設定 → 長文メモから「アプリ内エディタ」に切り替えるか、再度この操作で設定してください。`);
            }
        } else if (openWith === 'system') {
            toast(`同期フォルダの ${fullPath} を OS のエクスプローラ等で開いてください。\n（パスはクリップボードにコピー済み）`);
        }

        // PC v2: 右ペインで表示中なら再描画 (modal の互換用に旧 #book-modal もチェック)
        const isOpen = document.body.classList.contains('book-detail-pinned')
            || (document.getElementById('book-modal')?.classList.contains('show'));
        if (isOpen) {
            this.showBookDetail(book, true);
        }
    }

    // 共通 Markdown エディタ (EasyMDE) 生成 (イシュー#279)。長文メモ (_openBookMemoInAppEditor) と
    // 文章ブロック全画面 (_artOpenTextFsEditor) は、別々に EasyMDE を new していた (コンストラクタ
    // オプション・ツールバー設定・ラベル適用・フォーカス制御が二重実装)。ここへ統合し、両者はこの
    // 関数を呼ぶだけにする。DOM (ヘッダー/保存ボタンの配置) は呼び出し元がそれぞれ持つ (長文メモ=
    // #book-memo-modal・文章ブロック=#art-fs-hd+.art-fs-text-editor、本棚/本の全画面と共有する
    // 枠のため今回は手を入れない)。状態・保存方式の違いは呼び出し元が onChange の有無で切り替える
    // (showStatus/compact/autoFocusIfWide も同様に引数化)。
    _openMdEditor({ textareaEl, compact = false, showStatus = false, autoFocusIfWide = false, onChange } = {}) {
        if (!textareaEl) return null;
        const editor = new EasyMDE({
            element: textareaEl,
            autoDownloadFontAwesome: false,
            spellChecker: false,
            autosave: { enabled: false },
            status: showStatus ? ['lines', 'words'] : false,
            toolbar: this._mdeToolbarConfig({ compact }),
        });
        this._mdeApplyToolbarLabels(editor);
        if (autoFocusIfWide && window.viewport.isWide()) editor.codemirror.focus(); // 境目はjs/ui/viewport.js(900px)に一本化(イシュー#505)
        if (onChange) editor.codemirror.on('change', () => onChange(editor.value()));
        return editor;
    }

    // EasyMDEツールバーの構成 (②決裁2026-10-13・イシュー#282差し戻し。ハヘロとの精査でPCと
    // スマホの機能差を無くす方針に確定)。どの画面でも同じ8個(見出し・太字・箇条書き・番号付き・
    // 引用・リンク・表・プレビュー)。斜体・画像・区切り線・ガイドと「⋯その他」(step3実装)は廃止
    // =記号は手書きすれば従来どおり効く(コア境界は変えない)。PC全幅(600px超)だけ区切りの後ろに
    // 並べて表示・全画面を足す(画面の広さに依存する表示切替のため・ハヘロ了承済み)。
    // 見出しはカスタムボタン(押すと3択メニュー・_mdeToggleHeadingMenu)にする。
    _mdeToolbarConfig({ compact = false } = {}) {
        const headingBtn = { name: 'heading', action: (editor) => this._mdeToggleHeadingMenu(editor), className: 'mde-heading-btn', title: '見出し' };
        const base = [headingBtn, 'bold', 'unordered-list', 'ordered-list', 'quote', 'link', 'table', 'preview'];
        if (compact || window.innerWidth <= 600) return base; // スマホ・PC右ペイン: 8個のみ
        return [...base, '|', 'side-by-side', 'fullscreen'];
    }

    // EasyMDEツールバーのボタン (②決裁2026-10-12・イシュー#281「案1」・2026-10-13イシュー#282で
    // 対象ボタンを8個+PC2個に絞り込み)。autoDownloadFontAwesome:false のためデフォルトの
    // FontAwesomeアイコンは空ボタンになる (FontAwesomeは読み込まない方針を維持)。
    // editor.toolbarElements (EasyMDE公式API・ボタンname→DOM要素のマップ) を使って
    // 「アイコン(SVG)+下にラベル」の縦並びに差し替える。長文メモ・文章ブロック全画面の両方で使う。
    _mdeApplyToolbarLabels(easymde) {
        const els = easymde && easymde.toolbarElements;
        if (!els) return;
        const ICONS = {
            bold: 'bold', heading: 'heading', 'unordered-list': 'list', 'ordered-list': 'list-ordered',
            quote: 'quote', link: 'link', table: 'table', preview: 'eye',
            'side-by-side': 'columns-2', fullscreen: 'maximize',
        };
        const LABELS = {
            bold: '太字', heading: '見出し', 'unordered-list': '箇条書き', 'ordered-list': '番号付き',
            quote: '引用', link: 'リンク', table: '表', preview: 'プレビュー',
            'side-by-side': '並べて表示', fullscreen: '全画面',
        };
        let toolbarEl = null;
        for (const [name, label] of Object.entries(LABELS)) {
            const btn = els[name];
            if (!btn) continue;
            const iconSvg = typeof window.renderIcon === 'function' ? window.renderIcon(ICONS[name], { size: 20 }) : '';
            btn.innerHTML = `<span class="mde-tb-ico">${iconSvg}</span><span class="mde-tb-lbl">${label}</span>`;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
            if (!toolbarEl) toolbarEl = btn.closest('.editor-toolbar');
        }
        if (els.heading) {
            els.heading.setAttribute('aria-haspopup', 'menu');
            els.heading.setAttribute('aria-expanded', 'false');
        }
        // EasyMDEのCSS (vendor) がこの関数より後に読み込まれ、文字色等が上書きされる罠が
        // あった (イシュー#276) ため、見た目はクラス付与でCSS側に委ね、ここではDOM/属性のみ触る。
        if (toolbarEl) toolbarEl.classList.add('mde-iconized');
    }

    // 見出しボタン: 押すと「大見出し(##)/小見出し(###)/見出しを外す」の3択メニュー(イシュー#282・
    // ハヘロ了承済み方針)。現在行のレベルに✓。EasyMDE.toggleHeading2/3(すでにそのレベルなら外す
    // 挙動も標準装備)をそのまま使う。メニューはクリックのたびに作って閉じたら消す(永続DOMを
    // 持たない=#282 step3で踏んだ「その他」パネルの孤児DOM化バグを再発させない設計)。
    _mdeToggleHeadingMenu(easymde) {
        const existing = document.querySelector('.mde-heading-menu');
        if (existing) { this._mdeCloseHeadingMenu(); return; }
        const btn = easymde.toolbarElements && easymde.toolbarElements.heading;
        if (!btn) return;
        const level = this._mdeCurrentHeadingLevel(easymde);
        const items = [
            { label: '大見出し（##）', level: 2 },
            { label: '小見出し（###）', level: 3 },
            { label: '見出しを外す', level: 0 },
        ];
        const esc = (typeof BookshelfEscape !== 'undefined' && BookshelfEscape.escapeHtml) || ((s) => s);
        const menu = document.createElement('div');
        menu.className = 'mde-heading-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = items.map((it) => {
            const isCurrent = it.level === level;
            const checkSvg = typeof window.renderIcon === 'function' ? window.renderIcon('check', { size: 16 }) : '✓';
            return `<button type="button" class="mde-heading-item${isCurrent ? ' is-current' : ''}" role="menuitemradio" aria-checked="${isCurrent}" data-level="${it.level}">
                <span>${esc(it.label)}</span><span class="mde-heading-check">${checkSvg}</span></button>`;
        }).join('');
        document.body.appendChild(menu);
        this._surface().open('mde-heading-menu', { close: (o) => this._mdeCloseHeadingMenu(o), extra: { articleId: this._artEditingId } }); // D01
        menu.querySelectorAll('.mde-heading-item').forEach((item) => {
            item.addEventListener('click', () => {
                this._mdeApplyHeadingLevel(easymde, Number(item.dataset.level));
                this._mdeCloseHeadingMenu();
            });
        });
        this._placeAnchoredMenu(btn, menu);
        btn.setAttribute('aria-expanded', 'true');
        menu._mdeAnchorBtn = btn;
    }

    _mdeCloseHeadingMenu({ fromHistory = false } = {}) {
        const menu = document.querySelector('.mde-heading-menu');
        if (!menu) return;
        if (menu._mdeAnchorBtn) menu._mdeAnchorBtn.setAttribute('aria-expanded', 'false');
        menu.remove();
        this._surface().close('mde-heading-menu', { fromHistory }); // D01
    }

    _mdeCurrentHeadingLevel(easymde) {
        try {
            const cm = easymde.codemirror;
            const line = cm.getLine(cm.getCursor().line) || '';
            const m = line.match(/^(#{1,6})\s/);
            return m ? m[1].length : 0;
        } catch (e) { return 0; }
    }

    // level: 2=大見出し／3=小見出し／0=見出しを外す。EasyMDE.toggleHeading2/3は「すでにそのレベル
    // なら外す」挙動を標準で持つため、2/3の選択はそのまま呼ぶだけでよい。0(外す)は現在のレベルに
    // 応じて対応するtoggleを呼んで外す(2/3以外の見出しが手入力で付いていた場合だけ手動で剥がす)。
    _mdeApplyHeadingLevel(easymde, targetLevel) {
        try {
            if (targetLevel === 2) EasyMDE.toggleHeading2(easymde);
            else if (targetLevel === 3) EasyMDE.toggleHeading3(easymde);
            else {
                const current = this._mdeCurrentHeadingLevel(easymde);
                if (current === 2) EasyMDE.toggleHeading2(easymde);
                else if (current === 3) EasyMDE.toggleHeading3(easymde);
                else if (current > 0) {
                    const cm = easymde.codemirror;
                    const ln = cm.getCursor().line;
                    const line = cm.getLine(ln);
                    cm.replaceRange(line.replace(/^#{1,6}\s/, ''), { line: ln, ch: 0 }, { line: ln, ch: line.length });
                }
            }
        } catch (e) { console.error('見出し変更に失敗:', e); }
        try { easymde.codemirror.focus(); } catch (_) {}
    }

    // EasyMDEインスタンスを破棄する共通処理 (イシュー#282)。開いていた見出しメニューが残らないよう
    // 併せて閉じる。長文メモ・文章ブロックの両方の破棄箇所がこれを通す。
    _mdeDestroyEditor(editor) {
        if (!editor) return;
        this._mdeCloseHeadingMenu();
        try { editor.toTextArea(); } catch (_) {}
    }

    // EasyMDE (106KB・css+js) は起動時に読み込まず、長文メモのアプリ内エディタを開く時だけ
    // 動的読み込みする (イシュー#247 決裁5・mobile Perf)。1回だけ挿入し、以降は同じPromiseを返す。
    _ensureEasyMDELoaded() {
        if (typeof EasyMDE !== 'undefined') return Promise.resolve();
        if (this._easyMDELoadPromise) return this._easyMDELoadPromise;
        const VER = '2026081801';
        if (!document.querySelector('link[data-easymde-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `js/vendor/easymde.min.css?v=${VER}`;
            link.setAttribute('data-easymde-css', '1');
            document.head.appendChild(link);
        }
        this._easyMDELoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `js/vendor/easymde.min.js?v=${VER}`;
            script.onload = () => resolve();
            script.onerror = () => { this._easyMDELoadPromise = null; reject(new Error('EasyMDE読み込み失敗')); };
            document.head.appendChild(script);
        });
        return this._easyMDELoadPromise;
    }

    // 共通: B型ヘッダー(キャンセル/タイトル(+2行目)/完了)のDOM生成(イシュー#282)。
    // 文章ブロック・本棚・本の全画面は #art-fs-hd (index.html) が静的に持ち、_artBindBlocksEvents
    // 側で個別配線済みのため対象外(型は元々Bで変更不要)。長文メモは唯一の非B型だったため、ここで
    // 同じDOM構造・CSSクラス(.art-fs-hd/.art-fs-title/.btn.btn-secondary.btn-small/
    // .btn.btn-primary.btn-small/.art-save-status)を動的生成して流用する(二重実装を避ける・
    // ②決裁B)。host: ヘッダーを差し込む親要素の先頭。idPrefix: 生成するid群の接頭辞。
    // subId省略時は `${idPrefix}-sub`。呼び出しは起動時1回だけを想定(既に生成済みならテキスト更新
    // のみ行い、DOM・クリック配線は再生成しない=呼び出し元で二重バインドを気にしなくてよい)。
    _mountFsHeader(host, { idPrefix, title = '', subText = '', subId } = {}) {
        if (!host) return null;
        const resolvedSubId = subId || `${idPrefix}-sub`;
        let hd = host.querySelector(`#${idPrefix}-hd`);
        if (!hd) {
            hd = document.createElement('div');
            hd.className = 'art-fs-hd';
            hd.id = `${idPrefix}-hd`;
            hd.innerHTML = `
                <button type="button" id="${idPrefix}-cancel" class="btn btn-secondary btn-small">キャンセル</button>
                <span class="book-memo-fs-title-col">
                    <span id="${idPrefix}-title" class="art-fs-title"></span>
                    <span id="${resolvedSubId}" class="art-save-status"></span>
                </span>
                <button type="button" id="${idPrefix}-done" class="btn btn-primary btn-small">完了</button>`;
            host.insertBefore(hd, host.firstChild);
        }
        const titleEl = hd.querySelector(`#${idPrefix}-title`);
        const subEl = hd.querySelector(`#${resolvedSubId}`);
        if (titleEl) titleEl.textContent = title;
        if (subEl) subEl.textContent = subText;
        return { hd, cancelBtn: hd.querySelector(`#${idPrefix}-cancel`), doneBtn: hd.querySelector(`#${idPrefix}-done`), titleEl, subEl };
    }






    // スマホ: モーダルを履歴に積む (物理戻る/スワイプバック = アプリ離脱でなくモーダルを閉じる)。
    // 新しい面を作ったら show で _modalHistPush、close で _modalHistPop を呼ぶ (ui-standards §1)。
    // 設定 (一覧/詳細の2段)・取込・メニュー・確認ダイアログもすべてこの仕組みに載る (イシュー#284・D12)。
    // 方式 (イシュー#284 K5): 積んだ段に深さ d (= 積んだ後のスタック長) を持たせ、popstate では
    // 着地した段の d とスタック長を数え合わせて、d より上の面を閉じる。能動的に閉じた時は
    // 同じ操作内の pop をまとめて history.go(-n) を1回だけ呼ぶ。旧方式 (pop ごとに history.back()
    // + 抑制カウンタ) は WebKit で連続 back がまとめられた時にカウンタが余り、次のユーザーの戻るを
    // 食っていた (イシュー#284 H1)。数え合わせ方式は余分な popstate が来ても来なくても自己修復する。
    // isMobile: 既定は _isHistMobile() (900px 以下・イシュー#284 K6 で判定幅を統一。
    // #505でjs/ui/viewport.jsへ一本化=900pxの値自体は変えていない)。
    // この関数自体は「画面幅がスマホか」の判定として他の用途(例: 6360行付近のPC Escガード・
    // スマホの戻る統合と二重処理しない判定)にも使われているため意味を変えない。
    _isHistMobile() {
        return window.viewport.isNarrow();
    }

    // イシュー#513 S6: 「段を積むかどうか(PCでも1段ずつ戻る)」の判定だけをここへ集約する
    // (期限付きフラグ・既定は新しい動き)。_isHistMobile() 自体は上の用途のため変えない。
    // 旧い動きに戻すフラグが立っている間だけ _isHistMobile() (幅判定) にフォールバックする。
    // フラグ撤去の単位(2026-11-17目安)で、この関数と _histFlagOld() を外し、呼び出し元を
    // 「常に true」へ畳む(docs/char/s6-scope.md §4-5)。
    _navMobile() {
        return this._histFlagOld() ? this._isHistMobile() : true;
    }

    // S6フラグ: localStorage 'bookshelf.flag.histAllWidths' === '0' の時だけ旧い動き
    // (PC/タブレットは段を積まない)。未設定・それ以外は新しい動き(既定)。
    _histFlagOld() {
        try { return window.localStorage.getItem('bookshelf.flag.histAllWidths') === '0'; } catch (_) { return false; }
    }

    _setHistFlagOld(old) {
        try {
            if (old) window.localStorage.setItem('bookshelf.flag.histAllWidths', '0');
            else window.localStorage.removeItem('bookshelf.flag.histAllWidths');
        } catch (_) { /* no-op: ストレージ不可時は既定(新しい動き)のまま */ }
    }

    // D13 (イシュー#284): 入力途中のフォームを「戻る」で閉じる時、開いた時から変更があれば破棄を確認する。
    // 開いた時に入力欄の値を控え (_formSnapTake)、戻る (fromHistory) の close でだけ比べる。
    // 変更があれば確認を出す (確認は履歴に積まない)。「編集を続ける」なら false を返し、popstate ハンドラが
    // 段を積み直してフォームに留まる。「破棄する」ならそのまま閉じる (段は戻る操作で消費済み)。
    _formSnapOf(id) {
        const el = document.getElementById(id);
        if (!el) return '';
        return JSON.stringify(Array.from(el.querySelectorAll('input, textarea, select'))
            .filter((x) => x.type !== 'hidden' && x.type !== 'file')
            .map((x) => (x.type === 'checkbox' || x.type === 'radio') ? x.checked : x.value));
    }

    _formSnapTake(id) {
        this._formSnaps = this._formSnaps || {};
        this._formSnaps[id] = this._formSnapOf(id);
    }

    async _formBackGuard(id, o, doClose) {
        const snaps = this._formSnaps || {};
        if (o && o.fromHistory && id in snaps && snaps[id] !== this._formSnapOf(id)) {
            const ok = await window.confirmDialog({ title: '入力した内容を破棄しますか？', message: '戻ると、入力した内容は保存されません。', okLabel: '破棄する', cancelLabel: '編集を続ける', danger: true });
            if (!ok) return false; // 留まる: popstate ハンドラが段を積み直す
        }
        delete snaps[id];
        doClose(o);
        return true;
    }

    // イシュー#359: 台帳の読み取りビュー ([{id, close}])
    get _modalHistStack() { return this.nav ? this.nav.facesCompat : undefined; }

    // 戻る/進むで着地した写しの面を開き直す。thunk|null を返す
    _navReopen(id, extra) {
        const st = extra || {};
        if (st.blockId) return () => this._reopenArtFs(st); // art-fs の引き継ぎ (旧名のまま残る) は blockId で判定
        const t = {
            'settings-modal': () => this._openSettingsModal(),
            'settings-cat': () => this._openSettingsModal(st.cat),
            'drawer': () => { this._histNoAnimOnce(document.getElementById('app-sidebar')); this._histNoAnimOnce(document.querySelector('.mobile-scrim')); this._openDrawer(); },
            'publish-pages-modal': () => this.openPublishPagesModal(),
            'publish-settings-modal': () => this.openPublishSettingsModal(),
            'book-memo-modal': () => this._reopenBookMemo(st.asin),
            'art-fs': () => this._reopenArtFs(st),
            'command-palette': () => this._openPalette(),
            'bookshelf-modal': () => this.showBookshelfManager(),
            'exclusions-modal': () => this.showExclusionsModal(),
            'import-modal': () => this.showImportModal(),
            'add-book-modal': () => this.showAddBookModal(),
            'report-modal': () => this.openReportModal(st.url),
            'plugin-settings-modal': () => this._openPluginSettings(st.pluginId),
            'bookshelf-form-modal': () => this._reopenBookshelfForm(st),
            'icon-picker-modal': () => this.openIconPicker({ title: st.pickerTitle, current: st.pickerCurrent }),
            'descendants-pick-modal': () => this._reopenDescendantsPick(st),
            'art-viewing': () => this._reopenArtViewing(st),
            'art-edit-mode': () => this._reopenArtEdit(st),
            'art-add-sheet': () => this._reopenArtAddSheet(st),
            'art-look-sheet': () => this._reopenArtLookSheet(st),
            'art-sheet': () => this._reopenArtSheet(st),
            'art-publish-modal': () => this._reopenArtPublishPanel(st),
            'pp-preview-modal': () => this._reopenArtPreview(st),
            'art-blk-menu': () => this._reopenArtContextOnly(st),
            'art-more-menu': () => this._reopenArtContextOnly(st),
            'mde-heading-menu': () => this._reopenArtContextOnly(st),
        };
        return t[id] || null;
    }

    // 着地した写しの route/book に画面を合わせる (戻る/進む由来はアニメ無し=ADR-125 をここ1箇所で)
    _navOnLanded(snap, m) {
        if (m && m.bookChanged) this._histNoAnimOnce(document.getElementById('app-detail'));
        const route = snap.route || { view: 'main' };
        this._applyRoute(route);
        if (route.view === 'book' && snap.book && snap.book.edit) { // 編集モードは写しから (R08i)
            const book = (this.books || []).find((b) => b.asin === route.asin);
            if (book) { this._suppressRouterUpdate = true; try { this.showBookDetail(book, true); } finally { this._suppressRouterUpdate = false; } }
        }
    }

    // 重なり管理役 (js/overlay-manager.js・イシュー#367)。読み込み前・単体テスト等で無い時は何もしない代替を返す。
    // 履歴との接点 (設計 tmp/367/design.md §2-3): hist:true の面が開いた/閉じた時だけ hooks が呼ばれ、
    // _modalHistPush/Pop (= NavState の nav.open/close) に委譲する。管理役は history.* を触らない
    _overlays() {
        const ov = window.overlays;
        if (!ov) return { open: () => null, close: () => false, requestClose: async () => false, closeAll: () => 0, top: () => null, isTop: () => false, has: () => false, stackInfo: () => [] };
        if (!ov._histBound) {
            ov._histBound = true;
            ov.hooks.onOpen = (id, { closeFn, route }) => this._modalHistPush(id, closeFn, { route }); // route: イシュー#468
            ov.hooks.onClose = (id, { fromHistory, route }) => this._modalHistPop(id, { fromHistory: !!fromHistory, route });
        }
        return ov;
    }

    // route: イシュー#468。渡された時だけ face の push/pop と NavState route の変化を1 apply で行う
    // (省略時は従来どおり route 不変 = 既存呼び出しの挙動は変えない)
    // イシュー#509 U3: 中身は Surface.push へ移した (委譲・U9 で外す)
    _modalHistPush(id, close, { isMobile, extra, route } = {}) {
        this._surface().push(id, close, { isMobile, extra, route });
    }

    // 面の登録 (イシュー#509 U3)。振る舞いは載せ替え前と同じ指定にする (docs/arch/surface.md §2)
    _defineSurfaces(S) {
        // プラグインの一覧: 今どの幅でも段を積まない (旧 overlays.open hist:false のみ) を固定。変えるのは S6
        S.define('plugins-modal', { kind: 'modal', size: 'md', hist: 'never' });
        // 記事の6面 (#499 inventory O14〜O19): 今は overlays を通っていなかった。載せるが重なり順・Esc・枠外は今のまま
        // = layer:false (自前の z-index のまま)・esc:false (各面の capture の Esc が先に処理)・backdrop:'ignore'・showClass:null
        // (開閉は今どおり hidden / is-open)・kind:'sheet'+onOpen:'stack' (popover/menu の closeOthers に巻き込まない)
        const artFace = { kind: 'sheet', size: 'none', layer: false, esc: false, backdrop: 'ignore', showClass: null, onOpen: 'stack' };
        S.define('art-add-sheet', Object.assign({}, artFace));
        S.define('art-blk-menu', Object.assign({}, artFace));
        S.define('art-look-sheet', Object.assign({}, artFace));
        S.define('art-sheet', Object.assign({ el: '#art-drawer' }, artFace));
        S.define('art-more-menu', Object.assign({}, artFace));
        // 全面編集 (art-fs) は1枚の root を持たない (編集ビューの中の状態) = 段だけ Surface 経由。overlays には載せない
        S.define('art-fs', Object.assign({}, artFace, { overlay: false }));
        // 段だけ Surface 経由にする面 (overlays へは各画面が今どおり hist:false で載せる・または overlays を使わない面)。
        // 載せ替え前の _modalHistPush/_modalHistPop と同じ判定・同じ呼び順 (イシュー#509 U3 step3)
        ['add-book-modal', 'art-edit-mode', 'art-publish-modal', 'art-viewing', 'book-memo-modal', 'bookshelf-form-modal', 'bookshelf-modal', 'command-palette', 'descendants-pick-modal', 'drawer', 'exclusions-modal', 'icon-picker-modal', 'import-modal', 'mde-heading-menu', 'plugin-settings-modal', 'pp-preview-modal', 'publish-pages-modal', 'settings-cat'].forEach((id) => S.define(id, { overlay: false }));
        // イシュー#513 S6: report-modal だけ reloadReopen:true(リロードでも開き直してよい・
        // nav-state.js boot() の o.canReloadReopen が見る)。sessionStorage の pendingReport から
        // 明示的に開き直す既存の仕組み(_handleReportParam)が元からあり、全幅化で段を積むようになった
        // ことでboot()のH.go(-depth)と競合していたため。他の面(長文メモ等)はD06「再読込は段を畳む」
        // が元の決まりのままなので reloadReopen は立てない(back-nav-matrix L16/A39/X12で実測確認済み)。
        S.define('report-modal', { overlay: false, reloadReopen: true });
        // 出口の決まり (イシュー#511 X1): ページとして開く面は exit:'page' + parent (←の行き先)。
        // ×の代わりに←を出す/PCでは←も置かない、の見た目は各画面側 (index.html・CSS)。親は1か所 (ここ) で決める
        S.define('settings-modal', { overlay: false, exit: 'page', parent: { view: 'main' } }); // 行き先の1つ (PCは←無し・§4-2)
        S.define('publish-settings-modal', { overlay: false, exit: 'page', parent: { view: 'publish' } }); // 親は常に公開の一覧 (開いた場所には戻さない・§4-3)
        // ホームの編集モード (イシュー#511 X1 W8): overlay(DOM)を持たない状態トグル。exit:'edit'=Esc/戻るは
        // 完了と同じ(_exitEditMode)。hist既定(mobile)のまま=スマホは段を積み戻るで抜けられる・PCは積まない
        // (P9と同じ非対称だが、ここは新設の面なのでS6を待たず既存のhist:'mobile'に素直に従うだけ)
        S.define('dashboard-edit', { overlay: false, exit: 'edit' });
    }

    // Surface (js/ui/surface.js・イシュー#509)。読み込み前・単体テスト等で無い時はこの場で作る
    _surface() {
        if (!this._surfaceInst) {
            const S = (typeof window !== 'undefined' && window.surface) || (typeof window !== 'undefined' && window.Surface ? new window.Surface() : null);
            this._surfaceInst = S ? S.bind(this) : null;
            if (this._surfaceInst) this._defineSurfaces(this._surfaceInst);
        }
        return this._surfaceInst;
    }

    _modalHistPop(id, { fromHistory = false, route } = {}) {
        this._surface().pop(id, { fromHistory, route }); // イシュー#509 U3: 委譲 (U9 で外す)
    }


    // イシュー#291: 「進む」で記事のブロック全画面(フォーム)を開き直す。記事自体(articleId)が
    // 開いていなければ publish-pages-modal → 該当記事の順に積み直してから対象ブロックを開く。
    async _reopenArtFs(state) {
        if (!(await this._reopenArtContext(state))) return;
        const blockId = state.blockId;
        const block = blockId && (this._artDraft.blocks || []).find((b) => b.id === blockId);
        if (!block) return;
        this._artEditBlock(block.id);
    }

    // イシュー#291: 記事一覧・記事閲覧/編集状態を state.articleId から積み直す共通処理。
    // publish-pages-modal(一覧)が開いていなければ開き、_artEditingId が対象と違えば開き直す。
    // 戻り値 false = articleId が無い、または記事が見つからない(開き直せない)。
    async _reopenArtContext(state) {
        const id = state && state.articleId;
        const showEditorIfHidden = () => { if (document.getElementById('art-edit-view').hidden) this._artShowEditor(); };
        if (id == null) {
            // 新規記事(自動保存の600msデバウンス前)は push 時点では articleId が未確定。進むで
            // 着地するまでの間に自動保存が完了して確定することがあるため、articleId の有無ではなく
            // 「その下書きが(同じ _artDraft のまま)まだ開いているか」で判定する。
            if (!(this._artDraft && document.getElementById('publish-pages-modal').classList.contains('show'))) return false;
            showEditorIfHidden();
            if (state.artMode === 'edit' && this._artMode !== 'edit' && this._artMode !== 'form') this._artSetMode('edit');
            return true;
        }
        if (!document.getElementById('publish-pages-modal').classList.contains('show')) {
            await this.openPublishPagesModal();
        }
        if (this._artEditingId !== id || !this._artDraft) {
            const exists = this.publishArticleStore.get(id);
            if (!exists) {
                // イシュー#468 (②指示a): ストアに無いidで開いた(保存前の仮idで再読込・既に削除済み等)。
                // 白画面/例外にせず #/publish へ replace して一覧を出す(一覧モーダルは既に開いている)
                if (this.router) this.router.navigatePublish(null, { replace: true });
                return false;
            }
            this._artOpenEditor(id);
        } else {
            // 戻るで _artShowList まで戻った後の「進む」: 同じ記事はまだ開いているが
            // 一覧ビューに表示が切り替わっているため、編集ビューを再表示する(push し直すのは
            // _artShowEditor 自身・_modalHistPush の二重オープン防止で安全・イシュー#291)。
            showEditorIfHidden();
        }
        if (state.artMode === 'edit' && this._artMode !== 'edit' && this._artMode !== 'form') this._artSetMode('edit');
        return true;
    }

    // イシュー#291: 記事閲覧状態(art-viewing)を開き直す。
    async _reopenArtViewing(state) { await this._reopenArtContext(Object.assign({}, state, { artMode: 'view' })); }
    // イシュー#291: 記事編集状態(art-edit-mode)を開き直す。
    async _reopenArtEdit(state) { await this._reopenArtContext(Object.assign({}, state, { artMode: 'edit' })); }

    // イシュー#291: ＋追加シート(art-add-sheet)を開き直す。
    async _reopenArtAddSheet(state) {
        if (!(await this._reopenArtContext(state))) return;
        const idx = typeof state.menuIndex === 'number' ? state.menuIndex : (this._artDraft.blocks || []).length;
        this._artOpenAddSheet(idx);
    }
    // イシュー#291: 見た目シート(art-look-sheet)を開き直す。
    async _reopenArtLookSheet(state) {
        if (!(await this._reopenArtContext(state))) return;
        this._artOpenLookSheet();
    }
    // イシュー#291: 本棚ブロックの引き出しシート(art-sheet)を開き直す。
    async _reopenArtSheet(state) {
        if (!(await this._reopenArtContext(state))) return;
        if (state.menuBlockId) this._artActiveShelfBlockId = state.menuBlockId;
        // イシュー#330: 「進む」で開き直す時は開くtransitionを無効化する(②決裁2026-10-23)。
        this._histNoAnimOnce(document.getElementById('art-drawer'));
        this._artOpenSheet();
    }
    // イシュー#291: 公開パネル(art-publish-modal)を開き直す。
    async _reopenArtPublishPanel(state) {
        if (!(await this._reopenArtContext(state))) return;
        this._artOpenPublishPanel();
    }
    // イシュー#291: プレビュー(pp-preview-modal)を開き直す。
    async _reopenArtPreview(state) {
        if (!(await this._reopenArtContext(state))) return;
        this._artOpenPreviewModal();
    }
    // イシュー#291: ブロック⋯メニュー(art-blk-menu)・記事⋯メニュー(art-more-menu)・見出しメニュー
    // (mde-heading-menu)は、開くのに iframe 内 DOM 要素(アンカー位置)が要るため、メニュー自体の
    // 再現は見送り、親の記事編集状態まで開き直す(メニューは開かない)。D06 の history.back() は
    // 呼ばない(呼ぶと「一瞬映って消える」が残るため・②指示)。
    async _reopenArtContextOnly(state) { await this._reopenArtContext(Object.assign({}, state, { artMode: 'edit' })); }
    // イシュー#291: 本棚フォーム(bookshelf-form-modal)を開き直す。state.bsKey から対象本棚を特定。
    _reopenBookshelfForm(state) {
        const key = state && state.bsKey;
        if (!key) { this.showBookshelfForm(); return; }
        const bs = this.bookshelfManager.getBookshelves().find((b) => this.bookshelfManager._keyOf(b) === key);
        this.showBookshelfForm(bs || null);
    }
    // イシュー#291: 子孫選択(descendants-pick-modal)を開き直す。Promise の解決先は捨てる(②指示)。
    _reopenDescendantsPick(state) {
        const ids = (state && state.descIds) || [];
        if (!ids.length) return;
        const all = this.bookshelfManager.getBookshelves();
        const descendants = ids.map((id) => all.find((b) => b.internalId === id)).filter(Boolean);
        if (descendants.length) this._chooseDescendantsToAddTo(descendants);
    }

    // 起動時: 再読込前に積んだ段が残っていれば、開いている面は無いので段を畳んで元の位置へ戻す (イシュー#284 K4・D06)
    _modalHistNormalizeOnBoot() {
        this.nav.boot(); // 起動時の写し・再読込の段の畳み方 (D06) は台帳が行う
    }

    showExclusionsModal() {
        const modal = document.getElementById('exclusions-modal');
        if (!modal) return;
        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this.renderExclusionsList();
        this._surface().open('exclusions-modal', { close: (o) => this.closeExclusionsModal(o) });
    }

    closeExclusionsModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('exclusions-modal');
        this._overlays().close('exclusions-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('exclusions-modal', { fromHistory });
    }

    renderExclusionsList() {
        const listDiv = document.getElementById('exclusions-list');
        if (!listDiv) return;

        // 除外は localStorage (userData._storage.exclusions) で完結する。
        // 旧「同期先を接続すると管理できます」ガードは同期必須時代の名残で撤去 (C-277)。
        const exclusions = (this.userData._storage && this.userData._storage.exclusions) || [];
        if (exclusions.length === 0) {
            listDiv.innerHTML = '<p class="muted-hint">除外した本はありません。本の詳細メニューの「除外」を使うと、ここに入ります。</p>';
            return;
        }

        const libraryBooks = (this.userData._storage && this.userData._storage.libraryBooks) || [];
        const items = exclusions.map(asin => {
            const book = libraryBooks.find(b => b.asin === asin) || {};
            return BookList.exclusionItemHtml(book, asin);
        }).join('');

        listDiv.innerHTML = items;
        listDiv.querySelectorAll('.unexclude-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.unexcludeBook(e.currentTarget.dataset.asin);
            });
        });
    }

    /**
     * 書籍を完全削除（BookManager連携）
     */
    async deleteBook(asin) {
        const book = this.books.find(b => b.asin === asin);
        if (!book) {
            toast('指定された書籍が見つかりません');
            return;
        }

        const confirmMessage = `書籍「${book.title}」を完全削除しますか？

この操作は取り消せません。
お気に入り、メモ、本棚からも削除されます。`;

        if (!(await window.confirmDialog({ message: confirmMessage, danger: true }))) {
            return;
        }

        try {
            // BookManager で完全削除
            await this.bookManager.deleteBook(asin, true);

            // ユーザーデータからも削除
            if (this.userData.notes[asin]) {
                delete this.userData.notes[asin];
            }

            // 全ての本棚から削除
            if (this.userData.bookshelves) {
                this.userData.bookshelves.forEach(bookshelf => {
                    if (bookshelf.books) {
                        bookshelf.books = bookshelf.books.filter(id => id !== asin);
                    }
                });
            }

            // _storage の参照からも削除
            if (this.userData._storage) {
                if (Array.isArray(this.userData._storage.libraryBooks)) {
                    this.userData._storage.libraryBooks = this.userData._storage.libraryBooks.filter(b => b.asin !== asin);
                }
                if (Array.isArray(this.userData._storage.exclusions)) {
                    this.userData._storage.exclusions = this.userData._storage.exclusions.filter(a => a !== asin);
                }
            }
            if (this.userData.bookOrder && Array.isArray(this.userData.bookOrder.all)) {
                this.userData.bookOrder.all = this.userData.bookOrder.all.filter(a => a !== asin);
            }

            await this.saveUserData();
            if (this.pluginAPI) this.pluginAPI._emit('book:removed', { asin, reason: 'deleted' });

            // 表示を更新
            this.books = this.bookManager.getAllBooks();
            this.applyFilters();
            this.updateStats();
            this.renderBookshelfOverview();

            // モーダルを閉じる
            this.closeModal();

            toast(`「${book.title}」を削除しました`);
        } catch (error) {
            console.error('削除エラー:', error);
            toast(`削除に失敗しました: ${error.message}`);
        }
    }


    showBookSelectionForImport(books, source) {
        this.pendingImportBooks = books;
        this.importSource = source;

        // インポートオプションを非表示にして選択UIを表示
        document.querySelector('.import-options').style.display = 'none';
        const selectionDiv = document.getElementById('book-selection');
        selectionDiv.style.display = 'block';

        // 既存の本を取得（重複チェック用）
        const existingASINs = new Set(this.bookManager.getAllBooks().map(book => book.asin));
        // 除外済みの本（ユーザが意図的に除外）も取り込み対象から外す
        const excludedASINs = new Set((this.userData._storage && this.userData._storage.exclusions) || []);

        // 本のリストを生成（フィルター機能付き）
        this.renderBookList(books, existingASINs, excludedASINs);

        // イベントリスナーを追加
        this.setupBookSelectionListeners();
        this.updateSelectedCount();
    }

    renderBookList(books, existingASINs, excludedASINs = new Set()) {
        const bookList = document.getElementById('book-list');
        bookList.innerHTML = '';

        // フィルター設定を取得
        const hideExisting = document.getElementById('hide-existing-books').checked;

        let visibleCount = 0;
        let excludedCount = 0;
        let revokedCount = 0;
        let kuPrimeCount = 0;
        books.forEach((book, index) => {
            const isExisting = existingASINs.has(book.asin);
            const isExcluded = !isExisting && excludedASINs.has(book.asin);
            if (isExcluded) excludedCount++;
            if (book.statusFromPlatformSearch === 'Revoked') revokedCount++;
            if (book.originType === 'Ku' || book.originType === 'Prime') kuPrimeCount++;
            // 既存・除外はどちらも取り込み不可 (チェックボックス無効)
            const isBlocked = isExisting || isExcluded;

            // フィルター適用: 取り込み済み/除外済みを非表示にする場合はスキップ
            if (hideExisting && isBlocked) {
                return;
            }

            visibleCount++;
            const stateClass = isExisting ? 'existing-book' : (isExcluded ? 'excluded-book' : '');
            const stateLabel = isExisting ? '(取り込み済み)' : (isExcluded ? '(除外済み・取り込みません)' : '');
            const bookItem = document.createElement('div');
            bookItem.className = `book-selection-item ${stateClass}`;
            bookItem.dataset.bookIndex = index;
            bookItem.innerHTML = BookList.selectionItemInnerHtml(book, { index, isBlocked, stateLabel });
            bookList.appendChild(bookItem);
        });

        // 表示件数を更新
        this.updateBookListStats(books.length, visibleCount, existingASINs.size, excludedCount, revokedCount, kuPrimeCount);
    }

    updateBookListStats(totalBooks, visibleBooks, existingBooks, excludedBooks = 0, revokedBooks = 0, kuPrimeBooks = 0) {
        // 統計情報を表示する要素を追加/更新
        let statsElement = document.getElementById('book-list-stats');
        if (!statsElement) {
            statsElement = document.createElement('div');
            statsElement.id = 'book-list-stats';
            statsElement.className = 'book-list-stats';
            document.getElementById('book-list').parentNode.insertBefore(statsElement, document.getElementById('book-list'));
        }

        const newBooks = totalBooks - existingBooks - excludedBooks;
        const excludedPart = excludedBooks > 0 ? ` ／ 除外済み: ${excludedBooks}冊` : '';
        const kindleStatusPart = (revokedBooks > 0 || kuPrimeBooks > 0)
            ? ` ／ うち利用終了: ${revokedBooks}冊・KU/Prime: ${kuPrimeBooks}冊` : '';
        statsElement.textContent = `全体: ${totalBooks}冊 ／ 新規: ${newBooks}冊 ／ 取り込み済み: ${existingBooks}冊（自動更新対象）${excludedPart} ／ 表示中: ${visibleBooks}冊${kindleStatusPart}`;
    }
    
    setupBookSelectionListeners() {
        // モーダル DOM は静的・再生成しない前提の一度きり配線
        // (取込のたびの重複登録 = importSelectedBooks 二重発火の防止)
        if (this._bookSelectionBound) return;
        this._bookSelectionBound = true;
        // フィルター変更時にリストを再描画
        document.getElementById('hide-existing-books').addEventListener('change', () => {
            const existingASINs = new Set(this.bookManager.getAllBooks().map(book => book.asin));
            const excludedASINs = new Set((this.userData._storage && this.userData._storage.exclusions) || []);
            this.renderBookList(this.pendingImportBooks, existingASINs, excludedASINs);
            this.updateSelectedCount();
        });

        // 全て選択
        document.getElementById('select-all-books').addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('#book-list input[type="checkbox"]:not([disabled])');
            checkboxes.forEach(cb => cb.checked = true);
            this.updateSelectedCount();
        });

        // 全て解除
        document.getElementById('deselect-all-books').addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('#book-list input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            this.updateSelectedCount();
        });

        // チェックボックス変更時
        document.getElementById('book-list').addEventListener('change', () => {
            this.updateSelectedCount();
        });

        // 選択した本をインポート
        document.getElementById('import-selected-books').addEventListener('click', () => {
            this.importSelectedBooks();
        });

        // キャンセル
        document.getElementById('cancel-import').addEventListener('click', () => {
            this.cancelImport();
        });
    }
    
    updateSelectedCount() {
        const checkboxes = document.querySelectorAll('#book-list input[type="checkbox"]:checked');
        const count = checkboxes.length;
        document.getElementById('selected-count').textContent = count;

        // 既存ASIN分は選択と無関係に自動更新される (イシュー#41差し戻し)。新規の選択が0件でも
        // 自動更新対象が1件でもあればボタンを押せるようにする (イシュー#68: 新規0件・既存の
        // ステータス変化のみの再取込で「取り込む」ボタンが disabled のまま押せない穴があった)。
        const existingASINs = new Set(this.bookManager.getAllBooks().map(b => b.asin));
        const excludedASINs = new Set((this.userData._storage && this.userData._storage.exclusions) || []);
        const hasStatusUpdates = (this.pendingImportBooks || [])
            .some(b => b && existingASINs.has(b.asin) && !excludedASINs.has(b.asin));

        const importButton = document.getElementById('import-selected-books');
        importButton.disabled = count === 0 && !hasStatusUpdates;
    }
    
    async importSelectedBooks() {
        const checkboxes = document.querySelectorAll('#book-list input[type="checkbox"]:checked');
        const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value));
        // 除外済み/既存は取り込み対象から除く (UI では disabled だが念のため二重に防ぐ)
        const existingASINs = new Set(this.bookManager.getAllBooks().map(b => b.asin));
        const excludedASINs = new Set((this.userData._storage && this.userData._storage.exclusions) || []);
        const selectedBooks = selectedIndices
            .map(index => this.pendingImportBooks[index])
            .filter(b => b && !existingASINs.has(b.asin) && !excludedASINs.has(b.asin));

        // 既存ASIN分は選択の有無と無関係に、Amazon側のステータス系属性だけ自動更新する (イシュー#41)。
        // 取込モーダルの disabled 判定 (新規追加の可否) とは別の話: ユーザーが選ばなくても
        // 「Amazon から取得できた=最新の借用/返却状態」は反映してよい。除外済み ASIN は対象外
        // (ユーザーが明示的に除外した本の属性まで書き換えない)。
        const existingStatusUpdates = (this.pendingImportBooks || [])
            .filter(b => b && existingASINs.has(b.asin) && !excludedASINs.has(b.asin));

        // イシュー#480: 取込バッチ(selectedBooks)内に同じ asin が複数含まれると、
        // book-manager.js の既存チェックがループ開始前の1回限りのスナップショットのため、
        // 両方とも「既存なし」と判定されて重複登録される(480-step1-investigation.md参照)。
        // ここでは検出して警告するだけにとどめ、既存チェック自体(再取込時のステータス更新)の
        // ロジックは変えない(②承認・480-step2-decision.md=本を失うリスクがある排除は採らない)。
        const selectedAsinCounts = new Map();
        for (const b of selectedBooks) selectedAsinCounts.set(b.asin, (selectedAsinCounts.get(b.asin) || 0) + 1);
        const dupAsinCount = [...selectedAsinCounts.values()].filter((c) => c > 1).length;
        if (dupAsinCount > 0) {
            toast(`取込データに同じASINの本が複数含まれています(${dupAsinCount}件)。重複したまま取り込まれます。`, { type: 'warn' });
        }

        if (selectedBooks.length === 0 && existingStatusUpdates.length === 0) {
            toast('取り込む本を選んでください');
            return;
        }

        try {
            const results = await this.bookManager.importSelectedBooks([...selectedBooks, ...existingStatusUpdates]);
            this.showImportResults(results);

            // 表示を更新
            this.books = this.bookManager.getAllBooks();

            // bookOrder.all の先頭に新規追加分を反映
            if (!this.userData.bookOrder) this.userData.bookOrder = {};
            if (!Array.isArray(this.userData.bookOrder.all)) this.userData.bookOrder.all = [];
            const allOrderSet = new Set(this.userData.bookOrder.all);
            for (const imported of (results.imported || [])) {
                if (!allOrderSet.has(imported.asin)) {
                    this.userData.bookOrder.all.unshift(imported.asin);
                }
            }

            await this.saveUserData();
            this.applyFilters();
            this.updateStats();

            // 実取込の成功 = 初回準備 (PC 拡張) が済んでいる証拠として自動フラグ (PC 専用化 C-248)
            if (this.importSource === 'bookmarklet' || this.importSource === 'relay') {
                const setup = this._importSetupFlags();
                if (!setup.pc) {
                    setup.pc = true;
                    try { localStorage.setItem('bookshelf_import_setup', JSON.stringify(setup)); } catch (_) {}
                }
            }

            // 選択UIを非表示
            document.getElementById('book-selection').style.display = 'none';

        } catch (error) {
            console.error('選択インポートエラー:', error);
            toast(`取り込みに失敗しました: ${error.message}`);
        }
    }
    
    cancelImport() {
        // 選択UIを非表示にしてインポートオプションを表示
        document.getElementById('book-selection').style.display = 'none';
        document.querySelector('.import-options').style.display = 'block';
        
        // 一時データをクリア
        this.pendingImportBooks = null;
        this.importSource = null;
    }

    async saveBookChanges(asin) {
        const titleInput = document.querySelector(`.edit-title[data-asin="${asin}"]`);
        const authorsInput = document.querySelector(`.edit-authors[data-asin="${asin}"]`);
        const acquiredTimeInput = document.querySelector(`.edit-acquired-time[data-asin="${asin}"]`);
        const originalAsinInput = document.querySelector(`.edit-original-asin[data-asin="${asin}"]`);
        const updatedAsinInput = document.querySelector(`.edit-updated-asin[data-asin="${asin}"]`);

        const newTitle = titleInput.value.trim();
        const newAuthors = authorsInput.value.trim();
        const newAcquiredTime = acquiredTimeInput.value;
        const newOriginalAsin = originalAsinInput.value.trim();
        const newUpdatedAsin = updatedAsinInput.value.trim();

        if (!newTitle) {
            toast('タイトルは必須です');
            return;
        }

        // オリジナルASINの妥当性チェック
        if (!newOriginalAsin || !this.bookManager.isValidASIN(newOriginalAsin)) {
            toast('🔖 オリジナルASINは10桁の英数字で入力してください（例: B07ABC1234）');
            return;
        }

        // 変更後ASINの妥当性チェック
        if (newUpdatedAsin && !this.bookManager.isValidASIN(newUpdatedAsin)) {
            toast('変更後ASINは10桁の英数字で入力してください（例: B07ABC1234）');
            return;
        }

        // オリジナルASINが変更された場合の重複チェック
        if (newOriginalAsin !== asin) {
            const existingBook = this.books.find(book => book.asin === newOriginalAsin);
            if (existingBook) {
                toast('🔖 このオリジナルASINは既に使用されています');
                return;
            }
        }

        try {
            const updateData = {
                title: newTitle,
                authors: newAuthors || '著者未設定'
            };

            // オリジナルASINが変更された場合
            if (newOriginalAsin !== asin) {
                updateData.asin = newOriginalAsin;
            }

            // 購入日が変更されている場合は更新
            if (newAcquiredTime) {
                updateData.acquiredTime = new Date(newAcquiredTime).getTime();
            }

            // 変更後ASINの処理。productImage は ASIN が実際に変わったときだけ更新する
            // (タイトル等の編集のたびに Kindle 取込の恒久 CDN URL を組み立て URL で潰していた事故の防止)
            const currentBook = this.books.find(b => b.asin === asin) || {};
            if (newUpdatedAsin) {
                updateData.updatedAsin = newUpdatedAsin;
                if (newUpdatedAsin !== currentBook.updatedAsin) {
                    // 新しいASINで画像URLも更新 (URL 形式は getProductImageUrl が唯一の正)
                    updateData.productImage = this.bookManager.getProductImageUrl({ asin: newUpdatedAsin });
                }
            } else {
                // 変更後ASINが削除された場合、プロパティを削除
                updateData.updatedAsin = undefined;
                if (currentBook.updatedAsin) {
                    // 差し替え解除: 保存 URL は差し替え先のものになっているので、元 ASIN の組み立て URL に戻す
                    updateData.productImage = this.bookManager.getProductImageUrl({ asin: newOriginalAsin });
                }
            }

            const success = await this.bookManager.updateBook(asin, updateData);

            if (success) {
                // オリジナルASINが変更された場合、ユーザーデータを移行
                if (newOriginalAsin !== asin) {
                    this.migrateUserData(asin, newOriginalAsin);
                }

                // 表示を更新
                this.books = this.bookManager.getAllBooks();
                this.applyFilters();
                this.updateStats();

                toast('本の情報を更新しました');

                // 編集モードから表示モードに戻る
                if (newOriginalAsin !== asin) {
                    // ASINが変更された場合はモーダルを閉じる
                    this.closeModal();
                } else {
                    // 表示モードで再表示
                    const book = this.books.find(b => b.asin === newOriginalAsin);
                    if (book) {
                        this.showBookDetail(book, false);
                    }
                }
            }

        } catch (error) {
            console.error('本の更新エラー:', error);
            toast(`更新に失敗しました: ${error.message}`);
        }
    }

    /**
     * オリジナルASIN変更時のユーザーデータ移行
     */
    migrateUserData(oldAsin, newAsin) {
        // イシュー#484(②差し戻し・2026-11-02): oldAsinを使う本がlibrary.booksにまだ残っている場合
        // (=別の本に同じASINが付いていたケース、本関数はupdateBook完了後に呼ばれるため、この時点で
        // oldAsinの本が残っているなら「もう一方の本」が実在する)、notes/hiddenBooks/exclusions/
        // bookshelves[].books は移す(move)のではなくコピーする。旧ASIN側はそのまま残す(既存データは
        // 削除・統合しない方針。旧実装はmoveのため「もう一方の本」からメモ・除外・非表示・本棚所属が
        // 消えてしまっていた＝②指摘で訂正)。oldAsinの本が無ければ(通常の、重複していない本の付け直し)
        // 従来どおり移して元を消す。
        const oldAsinStillUsed = this.bookManager.library.books.some(b => b.asin === oldAsin);

        // 星評価とメモ。②指摘(2026-11-02): { ...obj } は浅いコピーのため、メモの中に入れ子の
        // オブジェクト/配列があると2冊で同じ参照を共有したままになる(片方の変更がもう片方にも
        // 反映されうる)。structuredCloneで値を完全に分離する。
        if (this.userData.notes[oldAsin]) {
            this.userData.notes[newAsin] = structuredClone(this.userData.notes[oldAsin]);
            if (!oldAsinStillUsed) delete this.userData.notes[oldAsin];
        }

        // 非表示設定
        if (this.userData.hiddenBooks && this.userData.hiddenBooks.includes(oldAsin)) {
            if (oldAsinStillUsed) {
                if (!this.userData.hiddenBooks.includes(newAsin)) this.userData.hiddenBooks.push(newAsin);
            } else {
                const index = this.userData.hiddenBooks.indexOf(oldAsin);
                this.userData.hiddenBooks[index] = newAsin;
            }
        }

        // 本棚情報
        if (this.userData.bookshelves) {
            Object.values(this.userData.bookshelves).forEach(bookshelf => {
                if (bookshelf.books && bookshelf.books.includes(oldAsin)) {
                    if (oldAsinStillUsed) {
                        if (!bookshelf.books.includes(newAsin)) bookshelf.books.push(newAsin);
                    } else {
                        const index = bookshelf.books.indexOf(oldAsin);
                        bookshelf.books[index] = newAsin;
                    }
                }
            });
        }

        // イシュー#484: 除外設定(exclusions)を移行 (既存の移行漏れ修正)。exclusions は asin の配列
        // (userData._storage.exclusions)。
        if (Array.isArray(this.userData._storage?.exclusions) && this.userData._storage.exclusions.includes(oldAsin)) {
            if (oldAsinStillUsed) {
                if (!this.userData._storage.exclusions.includes(newAsin)) this.userData._storage.exclusions.push(newAsin);
            } else {
                const index = this.userData._storage.exclusions.indexOf(oldAsin);
                this.userData._storage.exclusions[index] = newAsin;
            }
        }

        // イシュー#484: 並び順(bookOrder)を移行 (既存の移行漏れ修正)。bookOrder は
        // 本棚id → asin配列。重複していた2件のうちindexOfで最初の1件だけを書き換える方式のままで
        // よい(②指示)。元から本1冊ごとに別のインデックスに分かれているため、コピーではなく
        // この方式のままで「もう一方の本」のエントリはそのまま残る。
        if (this.userData.bookOrder) {
            Object.values(this.userData.bookOrder).forEach(order => {
                if (Array.isArray(order) && order.includes(oldAsin)) {
                    const index = order.indexOf(oldAsin);
                    order[index] = newAsin;
                }
            });
        }

        // ユーザーデータを保存
        this.saveUserData();
    }

    updateMemoPreview(textarea) {
        const preview = textarea.parentElement.querySelector('.note-preview');
        const previewContent = preview.querySelector('.note-preview-content');
        
        const text = textarea.value.trim();
        if (text) {
            // マークダウンリンクをHTMLリンクに変換
            const htmlContent = this.convertMarkdownLinksToHtml(text);
            previewContent.innerHTML = htmlContent;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
    }

    convertMarkdownLinksToHtml(text) {
        // [リンクテキスト](URL) の形式をHTMLリンクに変換
        return text
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/\n/g, '<br>'); // 改行もHTMLに変換
    }

    formatMemoForDisplay(memo, maxLength) {
        if (!memo) return '';
        
        // 改行を保持しつつ、長さ制限を適用
        const lines = memo.split('\n');
        let formattedText = '';
        let currentLength = 0;
        
        for (const line of lines) {
            if (currentLength + line.length > maxLength) {
                const remainingLength = maxLength - currentLength;
                if (remainingLength > 10) {
                    formattedText += line.substring(0, remainingLength) + '...';
                } else {
                    formattedText += '...';
                }
                break;
            }
            
            formattedText += line + '\n';
            currentLength += line.length + 1; // +1 for newline
        }
        
        // マークダウンリンクをHTMLリンクに変換
        return this.convertMarkdownLinksToHtml(formattedText.trim());
    }

    /**
     * Kindleインポートモーダルを表示 (開くたびに状態をリセットして必ず方式一覧から始める)
     */
    showImportModal() {
        const modal = document.getElementById('import-modal');
        // 毎回リセット: 選択画面のまま閉じても次回は必ず方式一覧から（旧: closeImportModal が
        // #import-results しか戻さず .import-options が display:none のまま残るバグの根治）
        const opts = document.querySelector('.import-options');
        if (opts) opts.style.display = '';
        const sel = document.getElementById('book-selection');
        if (sel) sel.style.display = 'none';
        const res = document.getElementById('import-results');
        if (res) { res.style.display = 'none'; res.innerHTML = ''; }
        this.pendingImportBooks = null;
        this.importSource = null;
        this._renderImportLanes();
        // 受信待ち中でなければステータスを隠す（ポーリング / PC 待機の in-flight が正）
        const st = document.getElementById('import-relay-status');
        if (st && !this._kindleImportInFlight) st.hidden = true;
        this._overlays().open(modal, { kind: 'modal', size: 'lg', hist: false }); // 重なり管理役 (イシュー#367 step5): lg
        // スマホ: 物理戻る/ブラウザバックで「アプリ離脱でなくモーダルを閉じる」ため履歴に積む (設定モーダルと同作法・ui-standards §1)
        // popstate 配線は設定モーダル初回オープン時だけだったので、取込単独オープンでも配線する
        this._surface().open('import-modal', { close: (o) => this.closeImportModal(o) });
    }

    /**
     * Kindleインポートモーダルを閉じる
     * @param {{fromHistory?: boolean}} [opts] popstate 起点なら履歴を消費済みのため back しない
     */
    closeImportModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('import-modal');
        this._overlays().close('import-modal', { reason: fromHistory ? 'history' : 'button' });
        // 結果表示をリセット
        const resultsDiv = document.getElementById('import-results');
        resultsDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
        // 自前で積んだ履歴を掃除 (×/ESC で閉じた場合)。popstate 経由なら不要
        this._surface().close('import-modal', { fromHistory });
    }

    /** 取込モーダルの端末レーンを UA から自動判定 ('pc' | 'ios' | 'android') */
    _detectImportDevice() {
        const ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'; // iPadOS の Mac 偽装対策
        if (/Android/.test(ua)) return 'android';
        return 'pc';
    }

    /** レーン別の初回準備完了フラグ ({pc:true,...})。端末固有のため localStorage (userData 同期に載せない) */
    _importSetupFlags() {
        try { return JSON.parse(localStorage.getItem('bookshelf_import_setup')) || {}; } catch (_) { return {}; }
    }

    /**
     * 取込モーダルの端末タブ・レーン表示・初回準備の開閉・接続状態別文言を一括反映。
     * 方式④ (#import-method-data) はアクティブレーンの準備完了フラグが立っている時だけ畳む
     * (素の localStorage では常に open = E2E import-paste.spec.js 互換の要)。
     */
    _renderImportLanes() {
        // PC 専用 (C-248)。レーンは import-lane-pc の 1 本のみ・端末タブなし。
        // 主経路は取込ブックマーク (ADR-054・拡張機能は配布しない)。スマホは案内文のみ表示。
        const isPc = this._detectImportDevice() === 'pc';
        const laneEl = document.getElementById('import-lane-pc');
        if (laneEl) laneEl.hidden = !isPc;
        const pcLead = document.getElementById('import-pc-lead');
        if (pcLead) pcLead.hidden = !isPc;   // スマホでは案内文 (#import-mobile-note) と重複するため片方だけ出す
        const mobileNote = document.getElementById('import-mobile-note');
        if (mobileNote) mobileNote.hidden = isPc;
        const setup = this._importSetupFlags();
        const setupEl = document.getElementById('import-setup-pc');
        if (setupEl) {
            const done = !!setup.pc;
            setupEl.open = !done;
            // 手順1の注記: 未登録=「最初の1回だけ」/ 登録済み (実取込成功で自動記録)=「登録済み」
            const state = setupEl.querySelector('.import-setup-state');
            if (state) state.textContent = done ? '登録済み' : '最初の1回だけ';
        }
        // 方式② (直接貼付): 初回準備が済んでいれば畳む (ブックマーク不具合時のフォールバック位置づけ)。
        // スマホでは常に畳み、見出し注記も「PCで保存したデータがあるとき」向けに差し替える
        // (「取込はPC専用」の案内と矛盾して見えないように)
        const dataEl = document.getElementById('import-method-data');
        if (dataEl) {
            dataEl.open = isPc && !setup.pc;
            const note = dataEl.querySelector('.pp-advanced-note');
            if (note) note.textContent = isPc ? 'ブックマークが使えないときはこちら' : 'PCで保存した取込データがあるときはこちら';
        }
        // 取込ブックマーク: ドラッグ登録用に href へ javascript: コードを注入
        const bml = document.getElementById('kindle-bookmarklet-link');
        if (bml) bml.href = this._buildKindleBookmarkletCode();
        // GIF スロット: media URL が非空のレーンだけ <img> を描画 (空なら空箱を出さない)
        document.querySelectorAll('#import-modal [data-import-media]').forEach((slot) => {
            const src = (KINDLE_IMPORT_MEDIA && KINDLE_IMPORT_MEDIA[slot.dataset.importMedia]) || '';
            if (src) {
                slot.hidden = false;
                if (slot.dataset.mediaSrc !== src) {
                    slot.dataset.mediaSrc = src;
                    slot.innerHTML = '';
                    const img = document.createElement('img');
                    img.src = src; img.alt = ''; img.loading = 'lazy'; img.className = 'import-media-gif';
                    slot.appendChild(img);
                }
            } else {
                slot.hidden = true;
                if (slot.firstChild) { slot.innerHTML = ''; delete slot.dataset.mediaSrc; }
            }
        });
    }

    /** 「準備完了にする」: レーンの初回準備を完了として記録し、以後は初回準備と方式④を畳む */
    // 旧「準備完了にする」ボタンは C-281 で廃止 (ステップ形式化)。フラグは実取込成功時に自動で立つ

    /** 受信待ち（PC postMessage 待機 / リレーポーリング）を手動で中止する */
    _cancelKindleImportWait() {
        if (this._kindleImportCleanup) {
            this._kindleImportCleanup();
        } else {
            this._stopKindleRelayPoll();
            this._kindleImportInFlight = false;
        }
        toast('受信待ちを中止しました。', { type: 'info' });
    }

    /**
     * ファイルからKindleデータをインポート
     */
    async importFromFile() {
        const fileInput = document.getElementById('kindle-file-input');
        if (!fileInput.files || fileInput.files.length === 0) {
            toast('ファイルを選択してください');
            return;
        }

        try {
            // ファイルを読み込んで本の一覧を表示
            const file = fileInput.files[0];
            const text = await file.text();
            const books = JSON.parse(text);
            
            this.showBookSelectionForImport(books, 'file');
            
        } catch (error) {
            console.error('ファイル読み込みエラー:', error);
            toast(`ファイルの読み込みに失敗しました: ${error.message}`);
        }
    }

    /**
     * 貼り付け / クリップボードの JSON テキストから取込 (拡張の無いスマホでブックマークレット経路を完結させる)。
     * 受理形: 配列 `[..]` (ブックマークレット/ファイル) / `{items:[..]}` / `{books:[..]}`。
     */
    importFromPastedText(text) {
        const raw = String(text || '').trim();
        if (!raw) { toast('取込データを貼り付けてください'); return; }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            toast('取込データとして読み取れませんでした。「コピーしました」と出た内容を、そのまま全部貼り付けてください。', { type: 'error' });
            return;
        }
        const books = Array.isArray(parsed) ? parsed
            : (Array.isArray(parsed.items) ? parsed.items
                : (Array.isArray(parsed.books) ? parsed.books : null));
        if (!books) { toast('取込データに本が見つかりませんでした。', { type: 'warn' }); return; }
        if (books.length === 0) { toast('取込対象の本がありませんでした。', { type: 'warn' }); return; }
        this.showBookSelectionForImport(books, 'paste');
    }

    /** テキストエリアに貼り付けられた内容から取込 */
    importFromPasteInput() {
        const ta = document.getElementById('kindle-paste-input');
        this.importFromPastedText(ta ? ta.value : '');
    }

    /** クリップボードを読み取り、テキストエリアに反映して取込 (権限が無ければ手動貼り付けへ誘導) */
    async readClipboardForImport() {
        try {
            const text = await navigator.clipboard.readText();
            const ta = document.getElementById('kindle-paste-input');
            if (ta) ta.value = text;
            this.importFromPastedText(text);
        } catch (e) {
            toast('クリップボードを読み取れませんでした。「取込データを直接渡す」の欄に手で貼り付けてください。', { type: 'warn' });
            // 方式④を自動で開いて貼り付け先へフォーカス
            const d = document.getElementById('import-method-data');
            if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); }
            const ta = document.getElementById('kindle-paste-input');
            if (ta) ta.focus();
        }
    }

    // インストール済みプラグインのうち manifest.publishable=true の id 集合を返す
    async _collectPublishablePluginIds() {
        const ids = new Set();
        if (!this.pluginLoader || !this._isSyncReady()) return ids;
        try {
            const installed = await this.pluginLoader.listInstalledPlugins({ refresh: true });
            for (const { id, manifest } of installed) {
                if (manifest && manifest.publishable) ids.add(id);
            }
        } catch (e) {
            console.warn('publishable plugin 収集失敗:', e);
        }
        return ids;
    }

    // ===== プラグイン管理 UI =====

    async showPluginsModal() {
        this._surface().open('plugins-modal'); // Surface (イシュー#509 U3): md・どの幅でも段なし (hist:'never')
        document.getElementById('plugin-repo-url').value = '';
        await this._renderPluginsList();
    }

    closePluginsModal() {
        this._surface().close('plugins-modal', { reason: 'button' });
    }

    async _renderPluginsList() {
        const container = document.getElementById('plugins-list');
        if (!container || !this.pluginLoader) {
            container.innerHTML = '<p style="color:#888">プラグインローダ未初期化</p>';
            return;
        }
        container.innerHTML = '<p style="color:#888;">読み込み中...</p>';

        if (!this._isSyncReady()) {
            container.innerHTML = '<p style="color:#888;">同期先 (ローカルフォルダ or GitHub) を先に接続してください。</p>';
            return;
        }

        let installed;
        try {
            installed = await this.pluginLoader.listInstalledPlugins({ refresh: true });
        } catch (e) {
            container.innerHTML = `<p style="color:#c00;">読み込み失敗: ${e.message}</p>`;
            return;
        }

        if (installed.length === 0) {
            container.innerHTML = '<p style="color:#888;">インストール済みのプラグインはありません。</p>';
            return;
        }

        const disabledSet = new Set(this.userData?.settings?.disabledPlugins || []);
        const loadedSet = new Set(this.pluginLoader.loaded.keys());

        container.innerHTML = installed.map(({ id, manifest }) => {
            const enabled = !disabledSet.has(id);
            return `
                <div class="plugin-card" data-plugin-card="${id}" style="border:1px solid #ddd; border-radius:6px; padding:0.8rem; margin-bottom:0.6rem; display:flex; justify-content:space-between; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                    <div style="flex:1 1 200px; min-width:0;">
                        <div style="font-weight:600;">${manifest.name || id} <span style="color:#888; font-weight:normal; font-size:0.85rem;">v${manifest.version || '?'} ${manifest.publishable ? '' : ''}</span></div>
                        <div style="font-size:0.85rem; color:#666;">${manifest.description || ''}</div>
                        <div class="plugin-status"></div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                        <label style="display:flex; gap:0.3rem; align-items:center; font-size:0.85rem;">
                            <input type="checkbox" data-toggle-plugin="${id}" ${enabled ? 'checked' : ''}> 有効
                        </label>
                        <button class="btn btn-secondary btn-small" data-uninstall-plugin="${id}">削除</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-toggle-plugin]').forEach(cb => {
            cb.addEventListener('change', (e) => this.togglePlugin(e.target.dataset.togglePlugin, e.target.checked));
        });
        container.querySelectorAll('[data-uninstall-plugin]').forEach(btn => {
            btn.addEventListener('click', (e) => this.uninstallPluginById(e.target.dataset.uninstallPlugin));
        });

        // 各カードの status 部分のみ部分更新
        installed.forEach(({ id }) => this._refreshPluginCardStatus(id));
    }

    /**
     * トグル時に DOM 全体を再描画せず、該当カードの status 部分だけ更新
     * （checkbox 含む再生成を避けて UI チラつき/フォーカス喪失を防ぐ）
     */
    _refreshPluginCardStatus(id) {
        const container = document.getElementById('plugins-list');
        if (!container) return;
        const statusEl = container.querySelector(`[data-plugin-card="${CSS.escape(id)}"] .plugin-status`);
        if (!statusEl) return;
        const loaded = this.pluginLoader && this.pluginLoader.loaded.has(id);
        const failure = this.pluginLoader && this.pluginLoader.failedToLoad.get(id);
        let html = '';
        if (failure) html += `<div style="font-size:0.8rem; color:#c00;">${failure}</div>`;
        if (loaded) html += '<div style="font-size:0.8rem; color:#0a0;">✓ 読み込み済み（リロード不要で有効）</div>';
        statusEl.innerHTML = html;
    }

    async installPluginFromInput() {
        const input = document.getElementById('plugin-repo-url');
        const url = (input.value || '').trim();
        if (!url) {
            toast('プラグインがある GitHub の場所（URL）を入力してください');
            return;
        }
        if (!this._isSyncReady()) {
            toast('先に「同期」で保存先（Asayake ハブ・この端末のフォルダ・GitHub のどれか）を設定してください');
            return;
        }
        try {
            const manifest = await this.pluginLoader.installFromGitHub(url);
            if (manifest) {
                toast(`${manifest.name || manifest.id} v${manifest.version || '?'} をインストールしました`);
                // 新規プラグインをサイドバー(ボタン)と一覧に反映
                this._applyHeaderLayout();
                await this._renderPluginListSection();
                input.value = '';
            }
        } catch (e) {
            toast(`インストール失敗: ${e.message}`);
        }
    }

    async togglePlugin(id, enabled) {
        if (!this.userData.settings) this.userData.settings = {};
        if (!Array.isArray(this.userData.settings.disabledPlugins)) this.userData.settings.disabledPlugins = [];
        const list = this.userData.settings.disabledPlugins;
        // オプトアウト: enabled=true なら disabled から除去、false なら追加
        if (enabled) {
            this.userData.settings.disabledPlugins = list.filter(x => x !== id);
        } else if (!list.includes(id)) {
            list.push(id);
        }
        await this.saveUserData();
        // 即時反映: 有効化→_loadPlugin, 無効化→unloadPlugin（リロード不要）
        if (enabled && !this.pluginLoader.loaded.has(id)) {
            const installed = await this.pluginLoader.listInstalledPlugins({ refresh: true });
            const target = installed.find(p => p.id === id);
            if (target) await this.pluginLoader._loadPlugin(target);
        } else if (!enabled && this.pluginLoader.loaded.has(id)) {
            await this.pluginLoader.unloadPlugin(id);
        }
        // モーダル全体は再描画せず、該当カードの status 部分だけ更新
        this._refreshPluginCardStatus(id);
    }

    async uninstallPluginById(id) {
        if (!(await window.confirmDialog({ message: `プラグイン "${id}" を削除しますか？\n同期フォルダの plugins/${id}/ も削除されます。`, danger: true }))) return;
        try {
            await this.pluginLoader.uninstall(id);
            await this._renderPluginsList();
        } catch (e) {
            toast(`削除失敗: ${e.message}`);
        }
    }

    /**
     * Amazon Kindle ライブラリページで実行されるブックマークレットのコードを生成
     * - window.csrfToken と認証 cookie を使って Amazon の内部 API を叩く
     * - ?bs_relay=UUID&bs_hub=URL があれば hub リレー経由で送信（iOS/Android 対応）
     * - window.opener がある場合は postMessage（PC 拡張フロー）
     * - どちらもなければクリップボードにコピー（フォールバック）
     */
    /**
     * Amazon 蔵書一覧ページに一意 id (bs-import-progress) の表示を出し、
     * 起動→取得中(n/total)→送信中→完了/失敗 を表示する (イシュー#89)。
     * <style> 注入・setAttribute('style',…) は使わず style.cssText で当てる (CSP の style-src-attr 対象外)。
     * 呼び直すたびに同 id の古い表示を除去する = 進捗表示は最終結果パネルに置き換わって残らない。
     * 完了/失敗のうちユーザーが読む必要のある内容 (clipboard 完了・失敗理由・csrfToken 不在) だけ閉じるボタン付き
     * 全画面パネルにする。進捗中 (closable=false) は全画面暗幕にすると fetch が詰まった時に操作不能になる
     * (fetch はタイムアウトしないため中止手段が無くなる) ため、ページ操作を奪わない画面上部の固定バナーにする
     * (ADR-071 追記・②レビュー指摘の是正)。
     */
    _buildKindleBookmarkletPanelCode() {
        return `var bp=function(msg,isErr,closable){var o=document.getElementById('bs-import-progress');if(o)o.remove();var v=document.createElement('div');v.id='bs-import-progress';if(closable){v.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;font-family:sans-serif';}else{v.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(15,23,42,.92);display:flex;align-items:center;justify-content:center;padding:10px 16px;font-family:sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none';}var p=document.createElement('div');p.style.cssText='color:'+(isErr?'#fca5a5':'#fff')+';font-size:'+(closable?'17px':'14px')+';line-height:1.6;text-align:center;max-width:'+(closable?'520px':'90%')+';word-break:break-word';p.textContent=msg;v.appendChild(p);if(closable){var x=document.createElement('button');x.textContent='閉じる';x.style.cssText='font-size:14px;padding:10px 24px;border:0;border-radius:8px;background:#475569;color:#fff;cursor:pointer';x.onclick=function(){v.remove();};v.appendChild(x);}document.body.appendChild(v);return p;};var bu=function(el,msg){if(el&&el.isConnected)el.textContent=msg;};`;
    }

    _buildKindleBookmarkletCode() {
        // 2026-08-18 実測(イシュー#41): itemStatusList は "Active"/"Expired" の2値のみ意味を持ち、
        // それ以外は無視される。明示指定では最大846件までしか取れず取りこぼしが出るため、
        // itemStatusList を渡さず全件取得する(kindle_bookshelf_exporter content.js と同じ方針)。
        // 安全弁: Active のみの件数(ao)を基準に、全件取得(items)がそれを下回ったら失敗させる。
        const panelSrc = this._buildKindleBookmarkletPanelCode();
        const fetchSrc = `var fp=async function(st,isl){var body={contentType:"Ebook",contentCategoryReference:"booksAll",showSharedContent:true,fetchCriteria:{sortOrder:"DESCENDING",sortIndex:"DATE",startIndex:st,batchSize:100,totalContentCount:-1},surfaceType:"Desktop"};if(isl)body.itemStatusList=isl;var p=JSON.stringify(body);var r=await fetch("https://www.amazon.co.jp/hz/mycd/digital-console/ajax",{headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({activity:"GetContentOwnershipData",activityInput:p,csrfToken:c}),method:"POST",credentials:"include"});var j=await r.json();if(j.success===false)throw new Error(JSON.stringify(j.error));return j.GetContentOwnershipData;};`;
        const code = `(async()=>{${panelSrc}var m=bp('bookshelf: 蔵書を取得しています…',false,false);try{var c=window.csrfToken;if(!c){for(var si=0;si<document.scripts.length;si++){var mm=(document.scripts[si].textContent||"").match(/csrfToken['"]?\\s*[:=]\\s*['"]([^'"]{8,})['"]/);if(mm){c=mm[1];break;}}}if(!c){var te=document.querySelector('input[name="csrfToken"], meta[name="csrfToken"]');c=te?(te.value||te.content||null):null;}if(!c){bp('Amazonの蔵書一覧ページ（digital-console/contentlist/booksAll）で実行してください',true,true);return;}${fetchSrc}var ao=await fp(0,["Active"]);var aoc=ao.numberOfItems||0;var f0=await fp(0);var t=f0.numberOfItems||0;var fc=f0.items.length;bu(m,'bookshelf: 蔵書を取得しています…（'+fc+'/'+t+'件）');var ss=[];for(var s2=100;s2<t;s2+=100)ss.push(s2);var rest=await Promise.all(ss.map(function(s3){return fp(s3).then(function(d){fc+=d.items.length;bu(m,'bookshelf: 蔵書を取得しています…（'+fc+'/'+t+'件）');return d;});}));var items=f0.items;for(var ri=0;ri<rest.length;ri++)items=items.concat(rest[ri].items);if(items.length===0)throw new Error('取得件数が0件でした。Amazon側の仕様が変わった可能性があります。');if(items.length<aoc)throw new Error('取得件数('+items.length+'件)が「Active」のみの件数('+aoc+'件)を下回りました。');var pl=items.map(function(i){return{title:i.title,authors:i.authors,acquiredTime:i.acquiredTime,readStatus:i.readStatus,asin:i.asin,productImage:i.productImage,originType:i.originType,statusFromPlatformSearch:i.statusFromPlatformSearch,lendingType:i.lendingType,lendingStatus:i.lendingStatus};});bu(m,'bookshelf: '+pl.length+'件を送信しています…');var u=new URLSearchParams(location.search);var rid=u.get('bs_relay');var hub=u.get('bs_hub');if(rid&&hub){try{await fetch(hub+'/kindle/relay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:rid,items:pl})});bp(pl.length+'冊を bookshelf に送信しました。bookshelf タブに戻ってください。',false,true);return;}catch(re){console.warn('relay failed:',re);}}if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'kindleBookshelfExport',ok:true,items:pl},'*');bp(pl.length+'冊を bookshelf に送信しました。',false,false);try{window.close();}catch(_){}setTimeout(function(){bp(pl.length+'冊を bookshelf に送信しました。このタブは閉じてください。',false,true);},1000);return;}await navigator.clipboard.writeText(JSON.stringify(pl));bp(pl.length+'冊取得。クリップボードにコピーしました。bookshelf の「取込データを直接渡す」に貼り付けてください。',false,true);}catch(e){console.error(e);var msg=e.message||String(e);if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'kindleBookshelfExport',ok:false,error:msg},'*');}bp('失敗: '+msg,true,true);}})();`;
        return 'javascript:' + encodeURIComponent(code);
    }

    async copyKindleBookmarklet() {
        const bm = this._buildKindleBookmarkletCode();
        try {
            await navigator.clipboard.writeText(bm);
            toast('取込ブックマークのコードをコピーしました。ブックマークを新規作成して、URL欄に貼り付けてください。', { type: 'success' });
        } catch (e) {
            // clipboard 失敗時は prompt で表示
            prompt('自動コピーできませんでした。以下を全選択してコピーし、ブックマークのURL欄に貼り付けてください:', bm);
        }
    }

    /**
     * iOS ショートカット「WebページでJavaScriptを実行」アクションに貼り付けるコードを生成。
     * docs/ios-shortcut-import.md 第1章のコードと機能一致が正。
     * 結果の表示もクリップボードへのコピーも Amazon ページ上のパネルで完結する (v4)。
     * ショートカット側は本アクション 1 個だけでよく、completion() には短い状態文字列しか返さない
     * （大きな JSON を Shortcuts ブリッジに渡さない・分岐/通知アクション不要。ADR-049 追記参照）。
     * パネルのボタンは inline onclick 属性で配線する: Shortcuts の JS コンテキストは completion()
     * 後に破棄され得るため、クロージャのハンドラはタップ時に死んでいる (v3 実機で無反応を確認)。
     * ※ スクレイパ本体は _buildKindleBookmarkletCode と重複 (一本化は 07_残検討事項)。
     */
    _buildKindleShortcutCode() {
        return `// Amazon Kindle 一覧ページ (mycd/digital-console/contentlist/booksAll) を Safari で開き、共有シートから実行する。
// 結果表示もコピーもこのスクリプトがページ上に出すパネルで完結する。ショートカット側はこのアクション1個だけでよい。
// 注意: Shortcuts の JS コンテキストは completion() 後に破棄され得るため、パネルのボタンは
// クロージャでなく inline onclick 属性（ページ本体のコンテキストで実行される）で配線する。
(async () => {
  // ページ上に結果パネルを出す（ショートカット側の通知・分岐に依存しない）
  const panel = (msg, isError) => {
    const old = document.getElementById("bs-import-panel");
    if (old) old.remove();
    const ov = document.createElement("div");
    ov.id = "bs-import-panel";
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;font-family:sans-serif";
    const p = document.createElement("div");
    p.id = "bs-import-msg";
    p.style.cssText = "color:" + (isError ? "#fca5a5" : "#fff") + ";font-size:17px;line-height:1.7;text-align:center;max-width:520px;word-break:break-word";
    p.textContent = msg;
    ov.appendChild(p);
    const x = document.createElement("button");
    x.textContent = "閉じる";
    x.style.cssText = "font-size:14px;padding:10px 24px;border:0;border-radius:8px;background:#475569;color:#fff";
    x.setAttribute("onclick", "document.getElementById('bs-import-panel').remove()");
    ov.appendChild(x);
    document.body.appendChild(ov);
    return { ov: ov, p: p, x: x };
  };
  try {
    // csrfToken はページのグローバル変数に無いレイアウト（モバイル表示等）があるため、
    // inline script と input/meta もフォールバック探索する
    const findToken = () => {
      if (window.csrfToken) return window.csrfToken;
      for (const s of document.scripts) {
        const m = (s.textContent || "").match(/csrfToken['"]?\\s*[:=]\\s*['"]([^'"]{8,})['"]/);
        if (m) return m[1];
      }
      const el = document.querySelector('input[name="csrfToken"], meta[name="csrfToken"]');
      return el ? (el.value || el.content || null) : null;
    };
    const c = findToken();
    if (!c) {
      const msg = "Amazonの蔵書一覧ページで実行してください（今のページ: " + location.hostname + location.pathname + "）。蔵書一覧を開いているのにこれが出る場合は、Safariのアドレスバー左の「ぁあ」→「デスクトップ用Webサイトを表示」に切り替えてからもう一度実行してください。";
      panel(msg, true);
      completion("ERROR:" + msg);
      return;
    }
    // 2026-08-18 実測(イシュー#41): itemStatusList は "Active"/"Expired" の2値のみ意味を持ち、
    // それ以外は無視される。明示指定では最大846件までしか取れず取りこぼしが出るため、
    // itemStatusList を渡さず全件取得する(kindle_bookshelf_exporter content.js と同じ方針)。
    const fetchPage = async (start, itemStatusList) => {
      const body = {
        contentType: "Ebook", contentCategoryReference: "booksAll", showSharedContent: true,
        fetchCriteria: { sortOrder: "DESCENDING", sortIndex: "DATE", startIndex: start, batchSize: 100, totalContentCount: -1 },
        surfaceType: "Desktop"
      };
      if (itemStatusList) body.itemStatusList = itemStatusList;
      const input = JSON.stringify(body);
      const r = await fetch("https://www.amazon.co.jp/hz/mycd/digital-console/ajax", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ activity: "GetContentOwnershipData", activityInput: input, csrfToken: c })
      });
      const j = await r.json();
      if (j.success === false) throw new Error(JSON.stringify(j.error));
      return j.GetContentOwnershipData;
    };
    // 安全弁: Active のみの件数を基準に、全件取得がそれを下回ったら失敗させる(黙って取りこぼさない)
    const activeOnly = await fetchPage(0, ["Active"]);
    const activeOnlyCount = activeOnly.numberOfItems || 0;
    // ショートカットのJS実行には時間制限があるため、1ページ目で総数を得て残りは並列取得
    // （2,000冊超でも直列25回→並列1波で数秒に収まる）
    const first = await fetchPage(0);
    const total = first.numberOfItems || 0;
    const starts = [];
    for (let s = 100; s < total; s += 100) starts.push(s);
    const rest = await Promise.all(starts.map(s => fetchPage(s)));
    const items = first.items.concat(...rest.map(d => d.items));
    if (items.length === 0) {
      throw new Error("取得件数が0件でした。Amazon側の仕様が変わった可能性があります。");
    }
    if (items.length < activeOnlyCount) {
      throw new Error("取得件数(" + items.length + "件)が「Active」のみの件数(" + activeOnlyCount + "件)を下回りました。");
    }
    const out = items.map(i => ({
      title: i.title, authors: i.authors, acquiredTime: i.acquiredTime,
      readStatus: i.readStatus, asin: i.asin, productImage: i.productImage,
      originType: i.originType, statusFromPlatformSearch: i.statusFromPlatformSearch,
      lendingType: i.lendingType, lendingStatus: i.lendingStatus
    }));
    const json = JSON.stringify(out);

    // 自動受け渡し対応: ?bs_relay=UUID&bs_hub=URL があれば直接送信（クリップボード不要）
    const p = new URLSearchParams(location.search);
    const rid = p.get('bs_relay');
    const hub = p.get('bs_hub');
    if (rid && hub) {
      try {
        await fetch(hub + '/kindle/relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: rid, items: out })
        });
        panel(out.length + "冊を bookshelf に自動送信しました。bookshelf のタブに戻ってください。", false);
        completion("OK:" + out.length);
        return;
      } catch (_) {
        // Amazon のページが外部送信をブロックした場合はページ上コピーへフォールバック
      }
    }

    // ページ上のボタンからコピーする（fetch 完了後はユーザー操作なしのクリップボード書込が
    // 許可されないことがあるため、ボタンのタップを新しいユーザー操作として使う）。
    // JSON は常時表示の textarea にも置く: ボタン系が全滅しても長押しコピーで必ず取れる。
    const ui = panel(out.length + "冊の一覧を取得しました。ボタンを押してコピーしてください。", false);
    const btn = document.createElement("button");
    btn.textContent = "クリップボードにコピー";
    btn.style.cssText = "font-size:18px;padding:14px 32px;border:0;border-radius:10px;background:#2563eb;color:#fff";
    btn.setAttribute("onclick", "(function(){var t=document.getElementById('bs-import-json');var m=document.getElementById('bs-import-msg');var okmsg='コピーしました。bookshelf の設定 → 取込 → 「取込データを直接渡す」に貼り付けてください。';var fin=false;var ok=function(){if(fin)return;fin=true;m.textContent=okmsg;};var ng=function(){if(fin)return;fin=true;var c=false;try{t.focus();t.select();c=document.execCommand('copy');}catch(e){}m.textContent=c?okmsg:'自動コピーできませんでした。下の欄を長押し →「すべてを選択」→ コピーしてください。';};try{navigator.clipboard.writeText(t.value).then(ok,ng);setTimeout(ng,2000);}catch(e){ng();}})()");
    const hint = document.createElement("div");
    hint.style.cssText = "color:#cbd5e1;font-size:12px;line-height:1.6;text-align:center;max-width:520px";
    hint.textContent = "ボタンで何も起きない場合は、下の欄を長押し →「すべてを選択」→ コピーしてください。";
    const ta = document.createElement("textarea");
    ta.id = "bs-import-json";
    ta.textContent = json;
    ta.setAttribute("readonly", "readonly");
    ta.setAttribute("onclick", "this.select()");
    ta.style.cssText = "width:92%;max-width:520px;height:110px;font-size:11px;background:#fff;color:#111;border-radius:8px;padding:8px;border:0";
    ui.ov.insertBefore(btn, ui.x);
    ui.ov.insertBefore(hint, ui.x);
    ui.ov.insertBefore(ta, ui.x);
    completion("OK:" + out.length + "冊");
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e));
    panel("取得に失敗しました: " + msg, true);
    completion("ERROR:" + msg);
  }
})();`;
    }

    /** iOS ショートカット用コードをクリップボードへコピー */
    async copyKindleShortcutCode() {
        const code = this._buildKindleShortcutCode();
        try {
            await navigator.clipboard.writeText(code);
            toast('取込用コードをコピーしました。ショートカットAppの「WebページでJavaScriptを実行」に貼り付けてください。', { type: 'success' });
        } catch (e) {
            prompt('自動コピーできませんでした。以下を全選択してコピーしてください:', code);
        }
    }

    openAmazonForBookmarklet({ mobile = false } = {}) {
        if (this._kindleImportInFlight) {
            toast('すでに取込の受信待ちです。「待機をやめる」で中断できます。', { type: 'warn' });
            return;
        }

        const hub = SyncConfigManager.load().hub || {};
        const apiBase = hub.apiBase || '';

        // hub が設定済みならリレー ID を生成し URL に埋め込む。ブックマークレットがリレー経由で返送する。
        let relayId = null;
        if (apiBase) {
            relayId = crypto.randomUUID();
        }

        const baseUrl = 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/';
        const params = new URLSearchParams({ bookshelfImport: '1' });
        if (relayId) {
            params.set('bs_relay', relayId);
            params.set('bs_hub', apiBase);
        }
        const url = baseUrl + '?' + params.toString();

        this._kindleImportInFlight = true;

        if (mobile) {
            // スマホ向け: window.open は試みず「リンクをコピー + 画面に表示」で受け渡す
            const statusEl = document.getElementById('import-relay-status');
            const showStatus = (waiting) => {
                if (!statusEl) return;
                statusEl.hidden = false;
                statusEl.querySelectorAll('[data-relay-waiting]').forEach((n) => { n.hidden = !waiting; });
                const row = statusEl.querySelector('.relay-url-row');
                if (row) row.hidden = false;
                const a = statusEl.querySelector('.relay-url-copy');
                if (a) { a.textContent = url; a.href = url; } // タップでも開ける <a>
            };
            navigator.clipboard.writeText(url)
                .then(() => toast('取込リンクをコピーしました。下のリンクからも開けます。', { type: 'success' }))
                .catch(() => toast('リンクを自動コピーできませんでした。下のリンクをタップして開くか、長押しでコピーしてください。', { type: 'warn' }));
            if (!relayId) {
                // 接続未設定: 自動受信なし (エラー扱いしない。経路はレーン内の [data-nohub-only] 文言で案内済み)
                this._kindleImportInFlight = false; // フラグ解放 (commit 40ef855 踏襲)
                showStatus(false);
                return;
            }
            this._startKindleRelayPoll(relayId, apiBase);
            showStatus(true);
            return;
        }

        // PC 向け: 新規タブで開く
        const win = window.open(url, '_blank');
        if (!win) {
            this._kindleImportInFlight = false;
            toast('ポップアップがブロックされました。\nブラウザのポップアップを許可してから再試行してください。');
            return;
        }

        // リレーポーリング（hub 接続時）と window.opener 待機を並走させる
        if (relayId) this._startKindleRelayPoll(relayId, apiBase);

        // PC 側でも「受信待ち」を可視化する (リンク行は不要なので隠す)
        const statusEl = document.getElementById('import-relay-status');
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.querySelectorAll('[data-relay-waiting]').forEach((n) => { n.hidden = false; });
            const row = statusEl.querySelector('.relay-url-row');
            if (row) row.hidden = true;
        }

        const allowedOrigins = new Set([
            'https://www.amazon.co.jp',
            ...((this.userData && this.userData.settings && this.userData.settings.extensionImportOrigins) || [])
        ]);

        let timer = null;
        const cleanup = () => {
            window.removeEventListener('message', handler);
            if (timer) clearTimeout(timer);
            this._stopKindleRelayPoll();
            this._kindleImportInFlight = false;
            this._kindleImportCleanup = null;
        };
        this._kindleImportCleanup = cleanup;

        const handler = (event) => {
            if (!allowedOrigins.has(event.origin)) return;
            const data = event.data;
            if (!data || data.type !== 'kindleBookshelfExport') return;
            cleanup();
            if (!data.ok) { toast(`Kindle 取込に失敗しました: ${data.error || '不明なエラー'}`); return; }
            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) { toast('取込対象の本がありませんでした。'); return; }
            this.showImportModal();
            this.showBookSelectionForImport(items, 'bookmarklet');
        };

        window.addEventListener('message', handler);
        timer = setTimeout(() => {
            cleanup();
            toast('受信待ちを終了しました（15分経過）。Amazonタブで取込が完了しなかった可能性があります。もう一度「Amazonから取り込む」からやり直してください。', { type: 'warn' });
        }, 15 * 60 * 1000);
    }

    _startKindleRelayPoll(relayId, apiBase) {
        this._stopKindleRelayPoll();
        if (!relayId || !apiBase) return;

        const el = document.getElementById('import-relay-status');
        if (el) {
            el.hidden = false;
            el.querySelectorAll('[data-relay-waiting]').forEach((n) => { n.hidden = false; });
        }

        const INTERVAL = 3000;
        const TIMEOUT = 15 * 60 * 1000;
        const startedAt = Date.now(); // 実時刻基準 (visibilitychange の追加呼び出しでタイムアウトが縮まないように)

        const tick = async () => {
            if (Date.now() - startedAt > TIMEOUT) {
                // 共有 cleanup があれば postMessage handler と 15分 setTimeout も畳む
                // (PC でリレーと postMessage を並走させた場合の二重トースト/誤タイムアウト防止)
                if (this._kindleImportCleanup) { this._kindleImportCleanup(); }
                else { this._stopKindleRelayPoll(); this._kindleImportInFlight = false; }
                // ポーリングタイムアウトは必ず通知する (旧: 無通知で停止していた)
                toast('15分たっても届かなかったため、受信待ちを終了しました。スマホ側で「コピーしました」と出ていた場合は「取込データを直接渡す」から取り込めます。', { type: 'warn' });
                return;
            }
            try {
                const r = await fetch(`${apiBase}/kindle/relay/${relayId}`);
                if (!r.ok) return;
                const d = await r.json();
                if (!Array.isArray(d.items)) return; // まだ届いていない
                // 共有 cleanup があれば postMessage handler と 15分 setTimeout も畳む
                // (受信成功後に PC 側の 15分 setTimeout が誤タイムアウトを出さないように)
                if (this._kindleImportCleanup) { this._kindleImportCleanup(); }
                else { this._stopKindleRelayPoll(); this._kindleImportInFlight = false; }
                if (d.items.length === 0) { toast('取込対象の本がありませんでした。', { type: 'warn' }); return; }
                toast(`${d.items.length}冊の一覧を受信しました。取り込む本を選んでください。`, { type: 'success' });
                this.showImportModal();
                this.showBookSelectionForImport(d.items, 'relay');
            } catch (_) { /* ネットワークエラーは無視してリトライ */ }
        };
        this._kindleRelayTick = tick;
        this._kindleRelayPollId = setInterval(tick, INTERVAL);
    }

    _stopKindleRelayPoll() {
        if (this._kindleRelayPollId) {
            clearInterval(this._kindleRelayPollId);
            this._kindleRelayPollId = null;
        }
        this._kindleRelayTick = null;
        const el = document.getElementById('import-relay-status');
        if (el) el.hidden = true;
    }

    /**
     * インポート結果を表示
     */
    showImportResults(results) {
        const resultsDiv = document.getElementById('import-results');
        resultsDiv.innerHTML = `
            <div class="import-summary">
                <h3>取込結果</h3>
                <div class="import-stats">
                    <div class="stat-item">
                        <span class="stat-value">${results.total}</span>
                        <span class="stat-label">総書籍数</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value success">${results.added}</span>
                        <span class="stat-label">新規追加</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value warning">${results.updated}</span>
                        <span class="stat-label">更新</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${results.skipped}</span>
                        <span class="stat-label">スキップ</span>
                    </div>
                </div>
                <p class="import-note">
                    取り込みが完了しました。新規追加: ${results.added}冊、更新: ${results.updated}冊
                </p>
            </div>
        `;
        resultsDiv.style.display = 'block';
    }

    /**
     * 手動追加モーダルを表示
     */
    showAddBookModal() {
        const modal = document.getElementById('add-book-modal');
        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this._surface().open('add-book-modal', { close: (o) => this._formBackGuard('add-book-modal', o, (oo) => this.closeAddBookModal(oo)) });
        this._formSnapTake('add-book-modal');
    }

    /**
     * 手動追加モーダルを閉じる
     */
    closeAddBookModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('add-book-modal');
        this._overlays().close('add-book-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('add-book-modal', { fromHistory });

        // フォームをリセット（存在する要素のみ）
        const amazonUrlInput = document.getElementById('amazon-url-input');
        if (amazonUrlInput) amazonUrlInput.value = '';
        
        const manualAsin = document.getElementById('manual-asin');
        if (manualAsin) manualAsin.value = '';

        const manualTitle = document.getElementById('manual-title');
        if (manualTitle) manualTitle.value = '';

        const manualAuthors = document.getElementById('manual-authors');
        if (manualAuthors) manualAuthors.value = '';

        const manualImageUrl = document.getElementById('manual-image-url');
        if (manualImageUrl) manualImageUrl.value = '';

        const manualAcquiredDate = document.getElementById('manual-acquired-date');
        if (manualAcquiredDate) manualAcquiredDate.value = '';

        // ASINステータスをリセット
        const asinStatus = document.getElementById('asin-status');
        if (asinStatus) asinStatus.style.display = 'none';

        // 結果表示をリセット
        const resultsDiv = document.getElementById('add-book-results');
        if (resultsDiv) {
            resultsDiv.style.display = 'none';
            resultsDiv.innerHTML = '';
        }
    }

    /**
     * Amazonリンクから書籍を追加
     */


    async fetchBookMetadata(asin) {
        try {
            // 簡易的にASINから書籍情報を推測（完全ではない）
            
            // まず既存の蔵書データから同じASINがないかチェック
            const existingBook = this.books.find(book => book.asin === asin);
            if (existingBook) {
                throw new Error('この本は既に蔵書に追加されています');
            }
            
            // Amazon画像URLから表紙画像の存在確認
            const imageUrl = `https://images-amazon.com/images/P/${asin}.01.L.jpg`;
            
            return {
                asin: asin,
                title: '', // 自動取得できない
                authors: '', // 自動取得できない
                acquiredTime: Date.now(),
                readStatus: 'UNKNOWN',
                productImage: imageUrl,
                source: 'manual_add'
            };
            
        } catch (error) {
            console.error('メタデータ取得エラー:', error);
            throw error;
        }
    }
    
    fallbackToManualInput(asin) {
        // 自動取得に失敗した場合、手動入力フォームにASINを設定
        document.getElementById('manual-title').value = '';
        document.getElementById('manual-authors').value = '';
        document.getElementById('manual-asin').value = asin;
        document.getElementById('manual-asin').readOnly = true;
        
        toast(`書籍情報の自動取得に失敗しました。\nASIN: ${asin}\n\n手動でタイトルと著者を入力してください。`);
    }

    /**
     * ASINから書籍情報を自動取得してフォームに入力
     */
    async fetchBookInfoFromASIN() {
        const asinInput = document.getElementById('manual-asin');
        const titleInput = document.getElementById('manual-title');
        const authorsInput = document.getElementById('manual-authors');
        const statusDiv = document.getElementById('asin-status');
        const fetchBtn = document.getElementById('fetch-book-info');

        const asin = asinInput.value.trim();

        if (!asin) {
            this.showASINStatus('error', 'ASINを入力してください');
            return;
        }

        if (!this.bookManager.isValidASIN(asin)) {
            this.showASINStatus('error', '有効なASINフォーマットではありません（例: B012345678）');
            return;
        }

        // ローディング状態を表示
        this.showASINStatus('loading', '書籍情報を取得中...');
        fetchBtn.disabled = true;
        fetchBtn.textContent = '取得中...';

        try {
            const bookData = await this.bookManager.fetchBookDataFromAmazon(asin);

            console.log('取得した書籍データ:', bookData);

            // フィールドに情報を設定
            titleInput.value = bookData.title;
            authorsInput.value = bookData.authors;

            // 取得結果に応じてメッセージを表示
            if (bookData.title && bookData.title !== 'タイトル未取得' && bookData.title !== '') {
                this.showASINStatus('success', `自動取得成功: ${bookData.title}`);
            } else {
                this.showASINStatus('error', '情報取得できませんでした。手動で入力してください。');
                // 自動取得失敗の場合、タイトルフィールドにフォーカス
                titleInput.focus();
            }

        } catch (error) {
            console.error('書籍情報取得エラー:', error);
            this.showASINStatus('error', '取得に失敗しました。手動で入力してください。');
        } finally {
            // ボタンを元に戻す
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = `<span class="h-icon">${window.renderIcon('download', { size: 14 })}</span>自動取得`;
        }
    }

    /**
     * ASIN取得ステータスを表示
     */
    showASINStatus(type, message) {
        const statusDiv = document.getElementById('asin-status');
        statusDiv.className = `asin-status ${type}`;
        statusDiv.textContent = message;
        statusDiv.style.display = 'block';

        // 成功またはエラーメッセージは5秒後に自動で隠す
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 5000);
        }
    }

    /**
     * 手動入力で書籍を追加
     */
    async addBookManually() {
        const asin = document.getElementById('manual-asin').value.trim();
        const title = document.getElementById('manual-title').value.trim();
        const authors = document.getElementById('manual-authors').value.trim();
        const imageUrl = document.getElementById('manual-image-url')?.value.trim() || '';
        const dateInput = document.getElementById('manual-acquired-date')?.value;

        if (!asin) {
            toast('ASINを入力してください');
            return;
        }

        if (!title) {
            toast('タイトルを入力してください');
            return;
        }

        const acquiredTime = dateInput ? new Date(dateInput).getTime() : Date.now();

        try {
            const bookData = {
                asin: asin,
                title: title,
                authors: authors || '著者未設定',
                readStatus: dateInput ? 'READ' : 'UNKNOWN',
                acquiredTime,
                ...(imageUrl ? { productImage: imageUrl } : {})
            };

            const newBook = await this.bookManager.addBookManually(bookData);

            // _storage.libraryBooks にも追加（除外/同期で参照されるため）
            if (this.userData._storage) {
                if (!Array.isArray(this.userData._storage.libraryBooks)) {
                    this.userData._storage.libraryBooks = [];
                }
                if (!this.userData._storage.libraryBooks.some(b => b.asin === newBook.asin)) {
                    this.userData._storage.libraryBooks.push({ ...newBook });
                }
            }
            // all bookshelf 順序の先頭に追加
            if (!this.userData.bookOrder) this.userData.bookOrder = {};
            if (!Array.isArray(this.userData.bookOrder.all)) this.userData.bookOrder.all = [];
            if (!this.userData.bookOrder.all.includes(newBook.asin)) {
                this.userData.bookOrder.all.unshift(newBook.asin);
            }

            this.showAddBookSuccess(newBook);

            // 表示を更新
            this.books = this.bookManager.getAllBooks();
            this.saveUserData();
            if (this.pluginAPI) this.pluginAPI._emit('book:added', { book: { ...newBook } });
            this.applyFilters();
            this.updateStats();
            // updateStats() は #total-books (蔵書一覧ヘッダ) だけを更新し、ホームの「蔵書数」ウィジェット
            // (BookshelfDashboard._renderCounterTotal) は再描画しない。手動追加直後にホームへ戻っても
            // 統計が0冊のまま(再読込すれば直る=描画漏れ)だった。他の更新経路(本棚切替等)と同じく
            // updateBookshelfSelector() 経由でダッシュボードも再描画する (#225 P4・イシュー#232 step3)。
            this.updateBookshelfSelector();

        } catch (error) {
            console.error('追加エラー:', error);
            toast(`追加に失敗しました: ${error.message}`);
        }
    }

    /**
     * 書籍追加成功を表示
     */
    showAddBookSuccess(book) {
        const resultsDiv = document.getElementById('add-book-results');
        resultsDiv.innerHTML = `
            <div class="add-success">
                <h3>書籍を追加しました</h3>
                <div class="added-book-info">
                    <p><strong>タイトル:</strong> ${book.title}</p>
                    <p><strong>著者:</strong> ${book.authors}</p>
                    <p><strong>ASIN:</strong> ${book.asin}</p>
                </div>
            </div>
        `;
        resultsDiv.style.display = 'block';
    }

    /**
     * 蔵書データをエクスポート
     */
    exportUnifiedData() {
        let exportData = this.buildExportData();
        // プラグインのエクスポート変換フック (export:before → transforms → export:after)
        if (this.pluginAPI) {
            this.pluginAPI._emit('export:before', { state: exportData });
            exportData = this.pluginAPI._runExportTransforms(exportData) || exportData;
        }
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'library.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (this.pluginAPI) this.pluginAPI._emit('export:after', { result: exportData });
        toast('データを library.json に書き出しました（バックアップ用）。');
    }

    renderBookshelfOverview() {
        // ホーム = ダッシュボードに置換されたため、旧 #bookshelves-grid は使わない。
        // 本棚カードはダッシュボードの「本棚ハイライト」ウィジェット (_renderBookshelfHighlights) が描画する。
        // 互換のため呼出は受け付けるが何もしない (DOM が無いので no-op)。
        const grid = document.getElementById('bookshelves-grid');
        if (!grid) return;
        const overviewSection = document.getElementById('bookshelves-overview');
        if (overviewSection) overviewSection.style.display = 'block';
        const textOnlyClass = this.showImagesInOverview ? '' : 'text-only';
        const bookshelves = (this.userData.bookshelves || []).slice();
        bookshelves.sort((a, b) => (b.isSpecial ? 1 : 0) - (a.isSpecial ? 1 : 0));
        grid.innerHTML = bookshelves.map(bs => this._renderBookshelfCard(bs, textOnlyClass)).join('');
        this._bindBookshelfOverviewEvents(grid);
    }

    /**
     * 本棚カード grid (renderBookshelfOverview / dashboard 本棚ハイライトウィジェット 共通) の
     * クリックハンドラをバインド。複数 host で呼ばれるため signal は使わず、各 host で 1 回だけ bind。
     */
    _bindBookshelfOverviewEvents(grid) {
        if (!grid) return;
        if (grid._bookshelfClickBound) return;
        grid._bookshelfClickBound = true;
        grid.addEventListener('click', (e) => {
            if (e.target.classList.contains('select-bookshelf')) {
                const bookshelfId = e.target.dataset.bookshelfId;
                this.switchBookshelf(bookshelfId);
                setTimeout(() => {
                    const bs = document.getElementById('bookshelf');
                    if (bs) bs.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            } else {
                const bookshelfPreview = e.target.closest('.bookshelf-preview');
                if (bookshelfPreview && !e.target.closest('.bookshelf-preview-actions')) {
                    const bookshelfId = bookshelfPreview.dataset.bookshelfId;
                    this.switchBookshelf(bookshelfId);
                    setTimeout(() => {
                        const bs = document.getElementById('bookshelf');
                        if (bs) bs.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                }
            }
        });
    }

    /**
     * 本棚プレビューカード 1 枚を生成 (all / ユーザ作成本棚 統一)
     */
    _renderBookshelfCard(bookshelf, textOnlyClass) {
        const isSpecial = !!bookshelf.isSpecial;
        const cardEffectiveIcon = bookshelf.iconName || 'library';
        const iconSvg = window.renderIcon(cardEffectiveIcon, { size: 18 });
        const name = bookshelf.name || (isSpecial ? 'すべての本' : bookshelf.id);
        const description = this._bookshelfDescription(bookshelf);

        // プレビュー対象の本のリスト（特殊本棚 = all は全蔵書）
        let previewAsins = [];
        if (isSpecial) {
            previewAsins = (this.books || []).map(b => b.asin);
        } else if (Array.isArray(bookshelf.books)) {
            previewAsins = bookshelf.books.slice();
        }
        const bookCount = previewAsins.length;

        // イシュー#398: この端末の並び順の設定 (#387 sortOrder/sortDirection) に合わせる。
        // 「自由な並び」の時だけ bookOrder (ドラッグで決めた順) を使い、それ以外は本棚一覧
        // (applySorting) と共有する _bookSortKey/_bookCompareFn で並べる。以前は sortOrder を見ず
        // bookOrder があれば無条件に使っていたため、タイトル順/取得日順に変えてもハイライトだけ
        // 古い (ドラッグ済みの) 順のままになっていた。
        if (this.sortOrder === 'custom') {
            if (this.userData.bookOrder && this.userData.bookOrder[bookshelf.id]) {
                const customOrder = this.userData.bookOrder[bookshelf.id];
                // イシュー#530 step2で見つけた低リスク改善: indexOf()はO(n)なのでsort比較のたびに
                // 全走査していた(O(n^2 log n)相当)。Map化してO(1)引きにする(n=780では0.6ms→0.1msと
                // 実測上は小さいが、蔵書数・本棚数が増えるほど効いてくるアルゴリズム的な非効率のため
                // 直す。②指示どおり「これで#530(3)の固まりが直った」とは言えない=未確認のまま)。
                const orderIndex = new Map(customOrder.map((asin, i) => [asin, i]));
                previewAsins.sort((a, b) => {
                    const ai = orderIndex.has(a) ? orderIndex.get(a) : -1;
                    const bi = orderIndex.has(b) ? orderIndex.get(b) : -1;
                    if (ai === -1 && bi === -1) return 0;
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                });
            }
        } else if (isSpecial) {
            // 「すべての本」は全蔵書を並べた結果そのものの先頭が答え (本棚ごとに並べ直さない)
            previewAsins = this._getLibrarySortedAsins().asins;
        } else {
            // 通常本棚はこの本棚の冊数 (913件より十分小さい) だけを順位表で並べ替える
            const { rank } = this._getLibrarySortedAsins();
            previewAsins.sort((a, b) => (rank.has(a) ? rank.get(a) : Infinity) - (rank.has(b) ? rank.get(b) : Infinity));
        }

        const previewBooks = previewAsins.slice(0, 8);
        const previewHtml = previewBooks.map(asin => {
            const book = (this.books || []).find(b => b.asin === asin);
            // data-asin: 表紙が読み込み失敗/1x1(_setupCoverFallback)で<img>がプレースホルダdivに
            // 差し替わっても、並び順をasinで検証できるように外側のラッパーに持たせる(イシュー#398)。
            if (book && this.bookManager.hasCoverImage(book)) {
                return `<div class="bookshelf-preview-book" data-asin="${asin}"><img src="${this.bookManager.getProductImageUrl(book)}" alt="${book.title}" data-cover-fallback=""></div>`;
            }
            return `<div class="bookshelf-preview-book bookshelf-preview-placeholder" data-asin="${asin}">${window.renderIcon('book-open', { size: 20 })}</div>`;
        }).join('');

        return `
            <div class="bookshelf-preview ${textOnlyClass}" data-bookshelf-id="${bookshelf.id}">
                <div class="bookshelf-preview-header">
                    <h3><span class="bs-card-icon" data-icon-value="${cardEffectiveIcon.replace(/"/g,'&quot;')}">${iconSvg}</span>${name}</h3>
                </div>
                <p class="bs-card-desc">${description}</p>
                <p class="book-count">${bookCount}冊</p>
                <div class="bookshelf-preview-books">${previewHtml}</div>
            </div>
        `;
    }

    showError(message) {
        const bookshelf = document.getElementById('bookshelf');
        bookshelf.innerHTML = `<div class="error-message">${message}</div>`;
    }
    
    generateStarRating(rating, size = 18) {
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            const filled = i <= rating;
            const cls = `lucide-star${filled ? ' is-filled' : ' is-empty'}`;
            stars += `<span class="star ${filled ? 'active' : ''}" data-rating="${i}">${window.renderIcon('star', { size, class: cls })}</span>`;
        }
        return stars;
    }

    /**
     * 一覧カードの表示制御 (全体設定)。星評価・短文メモとも visibility は
     * 'always' (常に表示) / 'hover' (ホバー時のみ) / 'hidden' (非表示) の 3 値。
     * 星は加えて「表紙に重ねる」(overlay) の boolean を別に持つ。
     * 旧 starDisplay (overlay/below/hidden) / 旧 boolean starOverlay からも移行する。
     */
    _getStarVisibility() {
        const s = (this.userData && this.userData.settings) || {};
        if (s.starVisibility === 'always' || s.starVisibility === 'hover' || s.starVisibility === 'hidden') return s.starVisibility;
        if (s.starDisplay === 'hidden') return 'hidden';
        return 'always';
    }
    _getStarOverlay() {
        const s = (this.userData && this.userData.settings) || {};
        if (typeof s.starOverlay === 'boolean') return s.starOverlay;
        if (s.starDisplay === 'below') return false;
        return true; // default: 表紙に重ねる
    }
    _getMemoVisibility() {
        const s = (this.userData && this.userData.settings) || {};
        if (s.memoVisibility === 'always' || s.memoVisibility === 'hover' || s.memoVisibility === 'hidden') return s.memoVisibility;
        return 'always';
    }
    _setDisplaySetting(key, value) {
        if (!this.userData.settings) this.userData.settings = {};
        this.userData.settings[key] = value;
        delete this.userData.settings.starDisplay; // 旧キーは破棄
        this.saveUserData({ deviceOnly: true });
    }

    /**
     * 評価の星ウィジェット (クリックで編集) を返す。一覧カード・本詳細で共用。
     */
    _starWidgetHtml(asin, rating, size = 18) {
        return `<div class="star-rating" data-asin="${BookshelfEscape.escapeHtml(asin)}" data-current-rating="${rating || 0}" data-star-size="${size}" title="クリックで評価">${this.generateStarRating(rating || 0, size)}</div>`;
    }

    /**
     * 評価変更を画面内の全ウィジェット (一覧カード + 本詳細) に即時反映する。
     */
    _applyRatingEverywhere(asin, rating) {
        let sel;
        try { sel = `.star-rating[data-asin="${(window.CSS && CSS.escape) ? CSS.escape(asin) : asin}"]`; }
        catch (_) { sel = `.star-rating[data-asin="${asin}"]`; }
        document.querySelectorAll(sel).forEach(w => {
            w.dataset.currentRating = rating;
            const size = parseInt(w.dataset.starSize) || 18;
            w.innerHTML = this.generateStarRating(rating, size);
        });
        this.updateStats();
        // 評価フィルタ適用中に評価を変えたら、絞り込み条件と表示の食い違いを防ぐため再フィルタする
        // (一覧カード・本詳細の両方の星がこの共通メソッドを通るため一箇所で両経路に効く)
        if (this.ratingFilter && this.ratingFilter.size > 0) this.applyFilters();
    }
    
    saveRating(asin, rating) {
        if (!this.userData.notes[asin]) {
            this.userData.notes[asin] = { memo: '', rating: 0 };
        }
        this.userData.notes[asin].rating = rating;
        this.saveUserData();
    }
    
    /**
     * ローディング表示
     */
    showLoading() {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'flex';
        }
    }

    /** ローディング中の補助テキスト (例: プラグイン読み込み進捗) を更新 */
    _setLoadingSub(text) {
        const el = document.getElementById('loading-sub');
        if (el) el.textContent = text || '';
    }

    hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }

    // 本棚管理モーダルの D&D 並び替え (Pointer Events化=イシュー#337)。
    // .bookshelf-drag-handle 上の pointerdown で開始 (本カードと同じ型)。ゾーン判定は左ペインツリーと共用。
    setupBookshelfDragAndDrop(container) {
        this._bindPointerReorder(container, {
            itemSelector: '.bookshelf-item',
            handleSelector: '.bookshelf-drag-handle',
            canDrag: (el) => el.dataset.special !== '1',
            dragClass: 'dragging',
            zoneMode: 'segment',
            zoneClassPrefix: 'bsm-drop-',
            computeZone: (targetEl, clientY) => {
                if (targetEl.dataset.special === '1') return 'inside';
                const rect = targetEl.getBoundingClientRect();
                const y = clientY - rect.top;
                return y < rect.height * 0.3 ? 'before' : (y > rect.height * 0.7 ? 'after' : 'inside');
            },
            getKey: (el) => el.dataset.internalId,
            // 左ペインと同じ並び替え/親子整合ロジックを共用 (子は親に追従、reparent は確認ダイアログ)
            onDrop: (draggedKey, targetKey, zone) => {
                if (targetKey && targetKey !== draggedKey) this._onTreeDrop(draggedKey, targetKey, zone);
            },
        });
    }

}

// Lazy Loading for Images
// イシュー#389: 本棚スクロール中に「空の枠」が見える時間を減らすための先読み。
// 計測(scripts/verify/389-scroll-perf.mjs・389-results.md)で、旧rootMargin:'200px'は
// 1200px/sのスクロールに対して先読みの時間的余裕(≒167ms)が足りず、空き枠が見える秒数が
// 10秒中4〜7秒に達していた。rootMarginを進行方向(下)に厚く広げ、decoding/fetchpriorityの
// ヒントも付ける。呼び出し側(各テンプレートのimgタグ)は変えず、ここ1か所にまとめる。
class LazyLoader {
    constructor() {
        // 既に observe 済みの要素を覚えておき、再スキャン時の二重 observe を避ける。
        // content-visibility:auto の画面外カードは交差しないので .lazy のまま残り、
        // observe() が呼ばれるたびに querySelectorAll に再ヒットするため必須。
        // 重要(実測で判明・2点): 本棚一覧は #view-bookshelf (overflow:auto) が実際にスクロールする
        // コンテナで、ページ本体(html/body)は動かない。IntersectionObserverの既定root(=トップレベル
        // のビューポート)のままrootMarginを広げても、中間のスクロールコンテナ自身の矩形でクリップ
        // されてしまい効果が出なかった→rootにこのコンテナを明示して解決する。
        // もう1点: WebKitは、root指定後も観測対象が img 自体だとcontent-visibility:auto を持つ
        // 祖先(.book-item)のクリッピングでrootMarginの拡張域に届かず「交差」が検知されなかった
        // (chromiumは img 直接観測でも効いたがWebKitは効かなかった・実測で確認)。
        // content-visibility:auto を持つ .book-item 自身を観測対象にすると両ブラウザで効く。
        this._observed = new WeakSet();
        const scrollRoot = document.getElementById('view-bookshelf') || null;
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const item = entry.target;
                        const img = item.querySelector('img.lazy');
                        if (img) {
                            // rootMarginの拡張域(先読み分)で交差したのか、実ビューポート内に既にあるのかを
                            // 区別し、本当に見えている分を優先してデコード/取得させる(fetchpriority)。
                            const r = entry.boundingClientRect;
                            const reallyVisible = r.bottom > 0 && r.top < window.innerHeight;
                            img.setAttribute('fetchpriority', reallyVisible ? 'high' : 'low');
                            img.setAttribute('decoding', 'async'); // メインスレッドのデコード待ちでスクロールを止めない
                            img.src = img.dataset.src;
                            img.classList.remove('lazy');
                        }
                        this.observer.unobserve(item);
                        this._observed.delete(item);
                    }
                });
            },
            // 画面1〜2画面ぶん先読みする。下方向(スクロールで進む側)を厚く・上方向(戻り)も少し持つ。
            { root: scrollRoot, rootMargin: '300px 0px 1200px 0px' }
        );
    }

    observe() {
        const imgs = document.querySelectorAll('img.lazy');
        for (const img of imgs) {
            const item = img.closest('.book-item') || img; // content-visibility:autoを持つ祖先を観測
            if (this._observed.has(item)) continue;   // 二重 observe を防ぐ
            this._observed.add(item);
            this.observer.observe(item);
        }
    }
}

// Global utility functions
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            toast('URLをクリップボードにコピーしました！');
        }).catch(() => {
            fallbackCopyToClipboard(text);
        });
    } else {
        fallbackCopyToClipboard(text);
    }
}

function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        toast('URLをクリップボードにコピーしました！');
    } catch (err) {
        console.error('Failed to copy: ', err);
        toast('コピーに失敗しました。手動でURLを選択してコピーしてください。');
    }
    document.body.removeChild(textArea);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.bookshelf = new VirtualBookshelf();
    window.lazyLoader = new LazyLoader();

    // Bookshelf management event listeners are handled in setupEventListeners

    // Set up mutation observer to handle dynamically added images.
    // 分割追記 (チャンクレンダ) で大量の childList mutation が連発するので、
    // rAF で 1 フレーム 1 回に束ねる (毎 mutation で全 DOM 再スキャンすると重い)。
    let lazyScanScheduled = false;
    const mutationObserver = new MutationObserver(() => {
        if (lazyScanScheduled) return;
        lazyScanScheduled = true;
        requestAnimationFrame(() => {
            lazyScanScheduled = false;
            window.lazyLoader.observe();
        });
    });

    mutationObserver.observe(document.getElementById('bookshelf'), {
        childList: true,
        subtree: true
    });
});