// Virtual Bookshelf - Main JavaScript
// Debug flag system
const DEBUG = false; // Set to false for production

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
        // 同期方式に応じた storage 構築 (LocalFS / GitHub / ...)
        this.syncConfig = SyncConfigManager.load();
        let initialAdapter = SyncConfigManager.buildAdapter(this.syncConfig);
        if (!initialAdapter) {
            // GitHub 設定が不完全等のフォールバック
            this.syncConfig = { ...this.syncConfig, method: 'local' };
            initialAdapter = new LocalFSAdapter();
        }
        this.syncMethod = this.syncConfig.method;
        this.storage = new BookshelfStorage(initialAdapter);
        this.bookshelfManager = new BookshelfManager(this);
        // 公開システム (P1 静的SSG, ADR-030): 公開ページ定義 + スタイル + 生成
        if (window.PublishPageStore) this.publishPageStore = new PublishPageStore(this.storage);
        if (window.createPublishStyleRegistry) this.publishStyles = createPublishStyleRegistry();
        if (window.PublishGenerator) this.publishGenerator = new PublishGenerator(this, this.publishStyles);
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
        // 公開は静的 SSG (公開ページ生成) へ移行済み (ADR-030)。
        // 旧 ?u= 公開閲覧モードは廃止。アプリは編集モード単一になった。

        // モバイル案内バナー（showDirectoryPicker 非対応端末で表示）
        this._setupMobileBanner();

        this.init();
    }

    /**
     * モバイル端末で showDirectoryPicker が無い場合の案内バナー
     * - iOS: App Store の File Picker 拡張をインストールして再読み込み
     * - Android: 配布 APK をインストール
     * - File Picker 拡張で API が生えている場合はバナー出さない
     */
    _setupMobileBanner() {
        try {
            const ua = navigator.userAgent || '';
            const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
            const isAndroid = /Android/.test(ua);
            const hasDirPicker = 'showDirectoryPicker' in window;

            if (!isIOS && !isAndroid) return; // PC は何もしない
            if (hasDirPicker) return; // 既に API が生えている（File Picker 入り / Capacitor アプリ内）

            const dismissedKey = 'bookshelf_mobileBanner_dismissed';
            if (localStorage.getItem(dismissedKey) === '1') return;

            const banner = document.getElementById('mobile-setup-banner');
            const msg = document.getElementById('mobile-setup-banner-msg');
            const actions = document.getElementById('mobile-setup-banner-actions');
            const closeBtn = document.getElementById('mobile-setup-banner-close');
            if (!banner || !msg || !actions) return;

            if (isIOS) {
                msg.innerHTML = '<strong>iOS Safari</strong> でローカル vault を編集するには、無料の Safari 拡張「<strong>File Picker</strong>」が必要です。インストール後にこのページを再読み込みしてください。';
                actions.innerHTML = `
                    <a href="https://apps.apple.com/jp/app/file-picker/id1595132894" target="_blank" rel="noopener">App Store で入手</a>
                    <a href="https://filepicker.app/" target="_blank" rel="noopener">詳細</a>
                `;
            } else if (isAndroid) {
                msg.innerHTML = '<strong>Android Chrome</strong> ではローカル vault に直接アクセスできません。<strong>Android アプリ版</strong>（Capacitor ラップ APK）のインストールが必要です。';
                actions.innerHTML = `
                    <a href="https://github.com/hahero-asayake/bookshelf/releases/latest" target="_blank" rel="noopener">最新 APK をダウンロード</a>
                `;
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


            // 同期 (LocalFS / GitHub / Asayake ハブ)
            await this.initSync();
            // ページ離脱前に同期未完了分を localStorage に確定（async は保証されないので可能な範囲）
            // 重要な同期は flushSync() を明示的に呼ぶ運用とする
            window.addEventListener('beforeunload', () => {
                if (this._syncDebounceTimer) {
                    clearTimeout(this._syncDebounceTimer);
                    this._syncDebounceTimer = null;
                    // 同期的に発火（await は出来ないので最小限）
                    this._runPendingSync();
                }
            });
            // ページ非表示時にも flush（モバイル等）
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden' && this._pendingSync) {
                    if (this._syncDebounceTimer) {
                        clearTimeout(this._syncDebounceTimer);
                        this._syncDebounceTimer = null;
                    }
                    this._runPendingSync();
                }
            });

            // 公開エクスポート先 handle の復元は廃止 (出力先は同期先 public/ に統合)

            // プラグイン読み込み（同期フォルダ接続済み + 設定読み込み済みのタイミング）
            if (this.pluginLoader) {
                try {
                    this._setLoadingSub('プラグインを読み込み中…');
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

            // Router 起動（最後に行うことでデータ・プラグインがすべて準備済みになる）
            if (this.router) {
                this.router.onChange((route) => this._applyRoute(route));
                this.router.start();
            }

            this.hideLoading();
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
        
        if (savedUserData) {
            // Use localStorage data as primary source
            this.userData = JSON.parse(savedUserData);
        } else {
            // Fallback to file if localStorage is empty
            try {
                const libraryResponse = await fetch('data/library.json');
                if (!libraryResponse.ok) {
                    throw new Error('library.json not found');
                }
                
                const text = await libraryResponse.text();
                if (!text.trim()) {
                    // 空ファイルの場合はデフォルトデータを使用
                    console.log('Empty library.json detected, using defaults');
                    this.userData = this.createDefaultUserData();
                } else {
                    const libraryData = JSON.parse(text);
                    // 新しい統合データから必要な部分を抽出
                    this.userData = {
                        exportDate: libraryData.exportDate || new Date().toISOString(),
                        bookshelves: libraryData.bookshelves || [],
                        notes: {},
                        settings: libraryData.settings || this.getDefaultSettings(),
                        bookOrder: libraryData.bookOrder || {},
                        stats: libraryData.stats || { totalBooks: 0, notesCount: 0 },
                        version: libraryData.version || '2.0'
                    };
                    // 書籍データからnotesを再構築
                    if (libraryData.books) {
                        Object.keys(libraryData.books).forEach(asin => {
                            const book = libraryData.books[asin];
                            if (book.memo || book.rating) {
                                this.userData.notes[asin] = {
                                    memo: book.memo || '',
                                    rating: book.rating || 0
                                };
                            }
                        });
                    }
                }
            } catch (error) {
                console.error('Failed to load library.json:', error);
                console.log('Using default user data');
                this.userData = this.createDefaultUserData();
            }
        }
        
        // Merge config into userData settings
        this.userData.settings = { ...this.userData.settings, ...config };
        
        this.currentView = this.userData.settings.defaultView || 'covers';

        // Load cover size setting
        const coverSize = this.userData.settings.coverSize || 'medium';
        document.getElementById('cover-size').value = coverSize;

        // 取り得る値は covers / images / list (旧 hybrid 等は covers へ)
        if (!['covers', 'images', 'list'].includes(this.currentView)) {
            this.currentView = 'covers';
        }
        
        // Phase H2-5: ページネーション廃止につき booksPerPage 設定は読み込まない (全件表示)
        this.showImagesInOverview = this.userData.settings.showImagesInOverview !== false; // Default true

        this.applyFilters();
    }

    setupEventListeners() {
        // 表示形式セグメント (表紙/画像/リスト)。popover は閉じない (連続で試せる)
        const viewSeg = document.getElementById('view-seg');
        if (viewSeg) {
            viewSeg.addEventListener('click', (e) => {
                const cell = e.target.closest('.rseg');
                if (!cell || !cell.dataset.view) return;
                this.setView(cell.dataset.view);
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

        // Sort
        document.getElementById('sort-order').addEventListener('change', (e) => {
            this.sortOrder = e.target.value;
            this.updateSortDirectionButton();
            this.applySorting();
            this._updateBulkBar(); // 「先頭に移動」ボタンの表示可否を更新
        });

        document.getElementById('sort-direction').addEventListener('click', () => {
            this.toggleSortDirection();
        });

        // Phase H2-5: 「表示数」は廃止 (全件表示)

        // Cover size
        document.getElementById('cover-size').addEventListener('change', (e) => {
            this.setCoverSize(e.target.value);
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

        // ヘッダー: 静的ボタン全部を event delegation で処理 (clone でも動くように)
        const headerEl = document.getElementById('header-controls');
        if (headerEl) {
            headerEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const item = e.target.closest('[data-header-item]');
                if (!item) return;
                const key = item.dataset.headerItem;
                switch (key) {
                    case 'manage-bookshelves':
                        this.showBookshelfManager();
                        break;
                    case 'open-settings':
                        this._openSettingsModal();
                        break;
                }
            });
        }

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
                if (e.target === settingsModal) this._closeSettingsModal();
            });
        }
        const doneSettings = document.getElementById('settings-modal-done');
        if (doneSettings) {
            doneSettings.addEventListener('click', () => this._closeSettingsModal());
        }

        // 全モーダル共通: Esc で最前面の開いているモーダルを閉じる (各モーダルの × と同じ処理を呼ぶ)
        if (!this._globalModalEscBound) {
            this._globalModalEscBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || e.defaultPrevented) return;
                const open = Array.from(document.querySelectorAll('.modal.show'));
                if (!open.length) return;
                const top = open[open.length - 1];
                const closeBtn = top.querySelector('.modal-close');
                if (closeBtn) closeBtn.click();
                else top.classList.remove('show');
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

        // Bookmarklet-based import (no extension required)
        const copyBookmarkletBtn = document.getElementById('copy-bookmarklet');
        if (copyBookmarkletBtn) {
            copyBookmarkletBtn.addEventListener('click', () => this.copyKindleBookmarklet());
        }
        const openAmazonBtn = document.getElementById('open-amazon-for-import');
        if (openAmazonBtn) {
            openAmazonBtn.addEventListener('click', () => this.openAmazonForBookmarklet());
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

        // 公開ページ管理を開く (静的SSG, ADR-030)。左ペインの「公開」ボタンから (設定からは分離)
        const publishBtn = document.getElementById('sidebar-publish');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => this.openPublishPagesModal());
        }

        // 長文メモ モーダル
        const memoSaveBtn = document.getElementById('book-memo-save-btn');
        if (memoSaveBtn) memoSaveBtn.addEventListener('click', () => this.saveBookMemoFromModal());
        const memoCloseBtn = document.getElementById('book-memo-close-btn');
        if (memoCloseBtn) memoCloseBtn.addEventListener('click', () => this.closeBookMemoModal());
        const memoModalCloseBtn = document.getElementById('book-memo-modal-close');
        if (memoModalCloseBtn) memoModalCloseBtn.addEventListener('click', () => this.closeBookMemoModal());

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
                this.saveUserData();
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
                if (book) this.showBookDetail(book, false);
                return;
            }
        });
    }

    setView(view) {
        if (!['covers', 'images', 'list'].includes(view)) view = 'covers';
        this.currentView = view;
        this.updateDisplay();
        this.saveUserData();
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

        const closeAll = (except) => {
            pairs.forEach(p => {
                const pop = document.getElementById(p.popId);
                if (pop && pop !== except) pop.hidden = true;
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
                pop.hidden = !wasHidden;
                if (!pop.hidden && typeof onOpen === 'function') onOpen();
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
                pop.hidden = true;
            }
        });

        // Esc で全 popover 閉じる
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            pairs.forEach(({ popId }) => {
                const pop = document.getElementById(popId);
                if (pop) pop.hidden = true;
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
        document.body.classList.add('cmdk-open');
        input.value = '';
        this._renderPaletteResults('');
        setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    _closePalette() {
        const pal = document.getElementById('command-palette');
        if (!pal) return;
        pal.hidden = true;
        document.body.classList.remove('cmdk-open');
        this._paletteItems = null;
    }

    /**
     * パレットで実行できるコマンド一覧 (ヘッダーから移設した操作を含む)。
     */
    _paletteCommands() {
        const navMain = () => { if (this.router) this.router.navigateMain(); else this._setBodyView('main'); };
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const cmds = [
            { icon: 'home',              title: 'ホーム / 本棚一覧へ',            keywords: 'home ホーム main 戻る top', run: navMain },
            { icon: 'image',             title: '表示形式: 表紙',                 keywords: 'view 表示 表紙 cover ひょうじ', run: () => this.setView('covers') },
            { icon: 'images',            title: '表示形式: 画像のみ',             keywords: 'view 表示 画像 表紙ウォール images がぞう', run: () => this.setView('images') },
            { icon: 'list',              title: '表示形式: リスト',               keywords: 'view 表示 リスト list', run: () => this.setView('list') },
            { icon: 'pen-line',          title: '本棚を管理',                     keywords: '本棚 管理 manage bookshelf へんしゅう', run: () => this.showBookshelfManager() },
            { icon: 'plus',              title: '本棚を新規作成',                 keywords: '本棚 新規 作成 add new create', run: () => this.showBookshelfForm() },
            { icon: 'download',          title: 'Kindle インポート',             keywords: 'import kindle 取込 取り込み インポート', run: () => this.showImportModal() },
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
                    items.push({ group: '本', icon: 'book-open', title: b.title, sub: b.authors || '', run: () => { this._closePalette(); this.showBookDetail(b); } });
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
                    <span class="cmdk-item-title">${this.escapeHtml(it.title)}</span>
                    ${it.sub ? `<span class="cmdk-item-sub">${this.escapeHtml(it.sub)}</span>` : ''}
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
        if (e.key === 'Escape') { e.preventDefault(); this._closePalette(); return; }
        if (!this._paletteItems || !this._paletteItems.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); this._setPaletteActive((this._paletteActive ?? 0) + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._setPaletteActive((this._paletteActive ?? 0) - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); this._runPaletteIndex(this._paletteActive ?? 0); }
    }

    _runPaletteIndex(idx) {
        const it = this._paletteItems && this._paletteItems[idx];
        if (!it) return;
        // 本は run 内で自前 close するが、他はここで閉じる
        const isBook = it.group === '本';
        if (!isBook) this._closePalette();
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
                if (!addPop.hidden && !addPop.contains(e.target) && !addBtn.contains(e.target)) addPop.hidden = true;
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
                <span>${this.escapeHtml(bs.name)}</span>
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
        if (!confirm(`選択した ${asins.length} 冊を「${curShelf.name}」から外しますか？\n\n本自体は削除されません（子の本棚に入っている場合はそこからも外れます）。`)) return;
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

    applySorting() {
        this.filteredBooks.sort((a, b) => {
            let aValue = a[this.sortOrder];
            let bValue = b[this.sortOrder];
            
            if (this.sortOrder === 'acquiredTime') {
                aValue = parseInt(aValue);
                bValue = parseInt(bValue);
            }
            
            if (typeof aValue === 'string') {
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }
            
            let comparison = 0;
            if (aValue > bValue) comparison = 1;
            if (aValue < bValue) comparison = -1;
            
            return this.sortDirection === 'asc' ? comparison : -comparison;
        });
        
        this.currentPage = 1;
        this.updateDisplay();
        this.updateStats();
    }
    
    toggleSortDirection() {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        this.updateSortDirectionButton();
        this.applySorting();
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
        this.saveUserData();
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
        
        this.saveUserData();
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
        const fbtn = document.getElementById('toggle-filter');
        if (fbtn) fbtn.classList.toggle('has-active-filter', this.ratingFilter.size > 0);
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateDisplay() {
        const bookshelf = document.getElementById('bookshelf');
        bookshelf.textContent = '';
        
        // Apply view and cover size classes
        const coverSize = this.userData.settings?.coverSize || 'medium';
        // is-custom-order: カスタム順のときだけ本をドラッグ並べ替えできる (grab カーソルで示す)
        const customCls = (this.sortOrder === 'custom') ? ' is-custom-order' : '';
        bookshelf.className = `bookshelf view-${this.currentView} size-${coverSize}${customCls}`;
        
        this.renderStandardView(bookshelf);

        this.setupPagination();
        this._updateViewSegUI();
    }



    renderStandardView(container) {
        // Apply custom book order only if sort order is set to 'custom'
        const currentBookshelfId = this.currentBookshelf || 'all';
        let booksToRender = [...this.filteredBooks];
        
        if (this.sortOrder === 'custom' && this.userData.bookOrder && this.userData.bookOrder[currentBookshelfId]) {
            const customOrder = this.userData.bookOrder[currentBookshelfId];
            
            // Sort books according to custom order, with unordered books at the end
            booksToRender.sort((a, b) => {
                const aIndex = customOrder.indexOf(a.asin);
                const bIndex = customOrder.indexOf(b.asin);
                
                if (aIndex === -1 && bIndex === -1) return 0; // Both not in custom order
                if (aIndex === -1) return 1; // a not in custom order, put at end
                if (bIndex === -1) return -1; // b not in custom order, put at end
                return aIndex - bIndex; // Both in custom order, use custom order
            });
        }
        
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
        for (const book of booksToRender) {
            frag.appendChild(this.createBookElement(book, this.currentView));
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
        const filterActive = !!this.searchQuery || (this.ratingFilter && this.ratingFilter.size > 0) || pluginFilterActive;
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
                this.searchQuery = '';
                if (this.ratingFilter) this.ratingFilter.clear();
                const si = document.getElementById('search-input'); if (si) si.value = '';
                if (typeof this._updateRatingFilterUI === 'function') this._updateRatingFilterUI();
                // プラグイン由来のフィルタ (registerActiveFilter) も解除する。各 reset は状態クリアのみで
                // 再描画はしない契約なので、最後の applyFilters() 1 回でまとめて反映する。
                if (this.pluginAPI && typeof this.pluginAPI.resetActiveFilters === 'function') this.pluginAPI.resetActiveFilters();
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

    createBookElement(book, displayType) {
        const bookElement = document.createElement('div');
        bookElement.className = 'book-item';
        bookElement.dataset.asin = book.asin;
        
        // 手動ドラッグ並べ替えは「カスタム順」のときだけ許可する。
        // 項目ソート中 (購入日/タイトル/著者) は、ドラッグの起点が保存済みの手動順 (bookOrder) で
        // 画面の表示順と一致しないため、動かすと見た目と反する順番になる。カスタム順のときは
        // 表示順 = bookOrder なので、見たまま並べ替えられる。
        bookElement.draggable = (this.sortOrder === 'custom');
        bookElement.setAttribute('data-book-asin', book.asin);
        
        const userNote = this.userData.notes[book.asin];
        // 一覧表示用メモ: ALL の短文メモ (2026-06-20: 本棚 override は廃止)
        const listMemo = this.bookshelfManager.resolveMemo(book.asin);
        const listRating = userNote?.rating || 0;

        // 一覧カードの星・メモ表示は全体設定で制御。
        //  星: visibility (always/hover/hidden) + overlay (表紙に重ねる) boolean
        //  メモ: visibility (always/hover/hidden)
        //  hover は「表紙に重なるポップアップ」で表示し、行のスペースを取らず位置もずらさない。
        // リスト表示は表紙が小さいので overlay でも below 配置にフォールバック。
        const isCoverView = (displayType === 'cover' || displayType === 'covers');
        // 画像のみビュー: 表紙ウォール。星・メモ・ホバーポップ・book-info を一切出さない
        const isImagesView = (displayType === 'images');
        const starVis = this._getStarVisibility();
        const overlayOn = this._getStarOverlay() && isCoverView;
        let starSize;
        if (starVis === 'hover') starSize = 16;             // ホバーポップアップ
        else if (overlayOn) starSize = 18;                  // 常に表示 + 表紙に重ねる (大きめ)
        else starSize = isCoverView ? 15 : 16;              // 常に表示 + 独立
        const starWidget = (starVis === 'hidden' || isImagesView) ? '' : this._starWidgetHtml(book.asin, listRating, starSize);
        const memoVis = isImagesView ? 'hidden' : this._getMemoVisibility();

        // 常時表示 (in-flow)
        const overlayAlwaysStars = (starVis === 'always' && overlayOn && starWidget)
            ? `<div class="cover-stars-layer stars-overlay">${starWidget}</div>` : '';
        const belowAlwaysStars = (starVis === 'always' && !overlayOn && starWidget)
            ? `<div class="book-rating">${starWidget}</div>` : '';
        const alwaysMemo = (memoVis === 'always' && listMemo)
            ? `<div class="book-memo">${this.formatMemoForDisplay(listMemo, isCoverView ? 90 : 140)}</div>` : '';

        // ホバーポップアップ (表紙に重ねる absolute、レイアウトに影響しない)
        const popStars = (starVis === 'hover' && starWidget)
            ? `<div class="pop-stars stars-overlay">${starWidget}</div>` : '';
        const popMemo = (memoVis === 'hover' && listMemo)
            ? `<div class="book-memo pop-memo">${this.formatMemoForDisplay(listMemo, 160)}</div>` : '';
        const hoverPop = (popStars || popMemo)
            ? `<div class="card-hover-pop">${popStars}${popMemo}</div>` : '';
        // 表紙表示: ポップは表紙 (.book-cover-container) に重ねる。
        // リスト表示: 表紙が小さいので行 (.book-item) 全体に重ねる (CSS で位置を分岐)。
        const coverHoverPop = isCoverView ? hoverPop : '';
        const rowHoverPop = isCoverView ? '' : hoverPop;

        const placeholderHtml = (isCoverView || isImagesView)
            ? `<div class="book-cover-placeholder">${this.escapeHtml(book.title)}</div>`
            : `<div class="book-cover-placeholder">${window.renderIcon('book-open', { size: 24 })}</div>`;

        bookElement.classList.add('clickable');
        // 複数選択モード中は選択状態を維持
        if (this.selectMode && this.selectedAsins && this.selectedAsins.has(book.asin)) {
            bookElement.classList.add('selected');
        }
        // 画像のみビューは book-info (タイトル・著者・星・メモ) を出力しない
        const infoHtml = isImagesView ? '' : `
                <div class="book-info">
                    <div class="book-title">${this.escapeHtml(book.title)}</div>
                    <div class="book-author">${this.escapeHtml(book.authors)}</div>
                    ${belowAlwaysStars}
                    ${alwaysMemo}
                </div>`;
        bookElement.innerHTML = `
                <div class="book-cover-container">
                    <div class="drag-handle">${window.renderIcon('grip-vertical', { size: 14 })}</div>
                    <div class="book-select-check" aria-hidden="true">${window.renderIcon('check', { size: 13 })}</div>
                    <div class="book-cover-link">
                        ${book.productImage ?
                            `<img class="book-cover lazy" data-src="${this.escapeHtml(this.bookManager.getProductImageUrl(book))}" alt="${this.escapeHtml(book.title)}">` :
                            placeholderHtml
                        }
                    </div>
                    ${overlayAlwaysStars}
                    ${coverHoverPop}
                </div>${infoHtml}
                ${rowHoverPop}
            `;
        
        // Add drag event listeners
        bookElement.addEventListener('dragstart', (e) => this.handleDragStart(e));
        bookElement.addEventListener('dragover', (e) => this.handleDragOver(e));
        bookElement.addEventListener('drop', (e) => this.handleDrop(e));
        bookElement.addEventListener('dragend', (e) => this.handleDragEnd(e));
        
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

    handleDragStart(e) {
        // Get the book-item element, not the drag handle
        const bookItem = e.target.closest('.book-item');
        this.draggedElement = bookItem;
        this.draggedASIN = bookItem.dataset.asin;
        bookItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.draggedASIN);
        // Phase H2-5: ドラッグ中の端オートスクロール開始
        this._dragPointerY = e.clientY;
        this._startBookDragAutoScroll();
    }

    handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        this._dragPointerY = e.clientY;   // オートスクロール用

        // Visual feedback (直前のインジケータは消してから付ける)
        const target = e.target.closest('.book-item');
        if (target && target !== this.draggedElement) {
            if (this._lastDragOverTarget && this._lastDragOverTarget !== target) {
                this._lastDragOverTarget.style.borderLeft = '';
            }
            target.style.borderLeft = '3px solid var(--accent)';
            this._lastDragOverTarget = target;
        }
        return false;
    }

    handleDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }

        const target = e.target.closest('.book-item');
        if (target && target !== this.draggedElement) {
            const targetASIN = target.dataset.asin;
            this.reorderBooks(this.draggedASIN, targetASIN);
        }

        // Clear visual feedback
        document.querySelectorAll('.book-item').forEach(item => {
            item.style.borderLeft = '';
        });

        return false;
    }

    handleDragEnd(e) {
        const bookItem = e.target.closest('.book-item');
        if (bookItem) {
            bookItem.classList.remove('dragging');
        }
        this.draggedElement = null;
        this.draggedASIN = null;
        this._stopBookDragAutoScroll();

        // Clear all visual feedback
        document.querySelectorAll('.book-item').forEach(item => {
            item.style.borderLeft = '';
        });
    }

    // ===== Phase H2-5: 本D&Dの端オートスクロール =====
    // .view-bookshelf (スクロール容器) の上下端付近にポインタが来たら自動スクロール。
    _bookScrollContainer() {
        return document.querySelector('.view-bookshelf');
    }

    _startBookDragAutoScroll() {
        const scroller = this._bookScrollContainer();
        if (!scroller) return;
        // ポインタ位置追跡 (容器全体で dragover を拾う。1度だけ bind)
        if (!scroller._dragTrackBound) {
            scroller._dragTrackBound = true;
            scroller.addEventListener('dragover', (e) => { this._dragPointerY = e.clientY; });
        }
        if (this._dragRAF) return; // 二重起動防止
        const EDGE = 90, MAX = 20;
        const step = () => {
            if (!this.draggedElement) { this._dragRAF = null; return; }
            const r = scroller.getBoundingClientRect();
            const y = this._dragPointerY || 0;
            let dy = 0;
            if (y < r.top + EDGE)      dy = -Math.ceil(MAX * Math.min(1, (r.top + EDGE - y) / EDGE));
            else if (y > r.bottom - EDGE) dy = Math.ceil(MAX * Math.min(1, (y - (r.bottom - EDGE)) / EDGE));
            if (dy) scroller.scrollTop += dy;
            this._dragRAF = requestAnimationFrame(step);
        };
        this._dragRAF = requestAnimationFrame(step);
    }

    _stopBookDragAutoScroll() {
        if (this._dragRAF) { cancelAnimationFrame(this._dragRAF); this._dragRAF = null; }
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

        // Save and refresh display
        this.saveUserData();
        this.updateDisplay();
    }

    // 本詳細ペインのセクション順序 (全本共通、settings 永続化)
    // デフォルト: 所属本棚 → 短文メモ → 長文メモ → 基本情報
    _getDetailSectionOrder() {
        const DEFAULT = ['bookshelves', 'short-memo', 'long-memo', 'basic-info'];
        const saved = this.userData?.settings?.detailSectionOrder;
        if (Array.isArray(saved) && saved.length === DEFAULT.length
            && DEFAULT.every(id => saved.includes(id))) {
            return saved.slice();
        }
        return DEFAULT.slice();
    }

    async _saveDetailSectionOrder(order) {
        if (!this.userData.settings) this.userData.settings = {};
        this.userData.settings.detailSectionOrder = order;
        if (this.storage && typeof this.storage.saveSettings === 'function') {
            try { await this.storage.saveSettings(this.userData.settings); }
            catch (e) { console.warn('detailSectionOrder 保存失敗', e); }
        }
    }

    // 編集モード時のセクション drag&drop 並び替え
    _bindDetailSectionReorder(root, book) {
        const container = root.querySelector('#bd-sections');
        if (!container) return;
        let dragEl = null;
        container.querySelectorAll('.bd-section[draggable="true"]').forEach(sec => {
            sec.addEventListener('dragstart', (e) => {
                dragEl = sec;
                sec.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            sec.addEventListener('dragend', () => {
                sec.classList.remove('is-dragging');
                dragEl = null;
            });
            sec.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!dragEl || dragEl === sec) return;
                const rect = sec.getBoundingClientRect();
                const after = (e.clientY - rect.top) > rect.height / 2;
                if (after) sec.after(dragEl);
                else sec.before(dragEl);
            });
        });
        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            const newOrder = Array.from(container.querySelectorAll('.bd-section'))
                .map(s => s.dataset.section)
                .filter(Boolean);
            await this._saveDetailSectionOrder(newOrder);
        });
    }

    _currentBookshelfInternalId() {
        // ホームビューでは「from 文脈」は無い（本棚を開いていない）
        if (document.body.classList.contains('app-view-main')) return null;
        if (!this.currentBookshelf) return null;
        const bs = this.bookshelfManager.getBySlug(this.currentBookshelf);
        // 特殊本棚（all）は notes.json スコープを指すので null を返す
        if (!bs || bs.isSpecial) return null;
        // internalId 欠落データは id (slug) を識別子として使う (getById が id フォールバック対応済み)
        return bs.internalId || bs.id;
    }

    showBookDetail(book, isEditMode = false) {
        // Router 連携（_applyRoute 由来でない場合のみ URL を更新）
        if (this.router && !this._suppressRouterUpdate && book && book.asin) {
            const fromInternalId = this._currentBookshelfInternalId();
            this.router.navigateBook(book.asin, fromInternalId);
        }
        // PC v2: 本詳細は右ペインに表示する。modal は使わず、右ペインの #book-detail-pane に inject。
        // ホームビューでは右ペインを表示するため book-detail-pinned を付ける。
        const modal = document.getElementById('book-modal');
        if (modal) modal.classList.remove('show'); // 念のため閉じる
        document.body.classList.add('book-detail-pinned');
        // 右ペインが折りたたまれていたら展開
        if (document.body.classList.contains('right-collapsed')) {
            document.body.classList.remove('right-collapsed');
            this._savePaneState();
        }
        const modalBody = document.getElementById('book-detail-pane');
        if (!modalBody) return;
        this._lastDetailBook = book;
        this._lastDetailEditMode = isEditMode;

        const isHidden = this.userData.hiddenBooks && this.userData.hiddenBooks.includes(book.asin);
        const contextInternalId = this._currentBookshelfInternalId();
        const allRecord = this.userData.notes[book.asin] || {};
        const resolvedMemo = this.bookshelfManager.resolveMemo(book.asin);
        const userNote = {
            memo: resolvedMemo,
            rating: this.bookshelfManager.resolveRating(book.asin),
            hasDetailMemo: allRecord.hasDetailMemo || false,
            hideMemo: !!allRecord.hideMemo,
            hideDetailMemo: !!allRecord.hideDetailMemo
        };
        const contextBookshelf = contextInternalId ? this.bookshelfManager.getById(contextInternalId) : null;
        const amazonUrl = this.bookManager.getAmazonUrl(book, this.userData.settings.affiliateId);
        const ico = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));

        // Kindleで読む (タイトル直下)。開き方は設定 settings.kindleOpenWith ('web' 既定 / 'app')。
        // 紙書籍 (ISBN ASIN) では出さない。app スキームは別タブ不要 (現タブのまま外部アプリ起動)。
        const kindleMethod = (this.userData?.settings?.kindleOpenWith === 'app') ? 'app' : 'web';
        const kindleReadHtml = this.bookManager.isKindleBook(book)
            ? `<div class="bd-read"><a class="kindle-link" href="${esc(this.bookManager.getKindleReadUrl(book, kindleMethod))}"${kindleMethod === 'web' ? ' target="_blank" rel="noopener"' : ''} title="${kindleMethod === 'app' ? 'Kindle アプリで開く（PC/Mac はその本が開く／スマホはアプリ起動のみ）' : 'Kindle Cloud Reader で開く（所有していればその本が開きます）'}">${ico('book-open')}Kindleで読む</a></div>`
            : '';

        // 所属本棚 (chips) — 開いている本棚 (context) は色を強調
        const contextSlug = contextBookshelf ? contextBookshelf.id : null;
        const memberBookshelves = (this.userData.bookshelves || [])
            .filter(bs => !bs.isSpecial && Array.isArray(bs.books) && bs.books.includes(book.asin));
        const candidateBookshelves = (this.userData.bookshelves || [])
            .filter(bs => !bs.isSpecial && !(Array.isArray(bs.books) && bs.books.includes(book.asin)));

        const chipsHtml = memberBookshelves.map(bs => {
            const isCtx = contextSlug && bs.id === contextSlug;
            return `
            <span class="bd-chip${isCtx ? ' is-context' : ''}" data-bookshelf-id="${esc(bs.id)}"${isCtx ? ' title="いま開いている本棚"' : ''}>
                <span class="bd-chip-icon" data-icon-value="${(bs.iconName || 'library').replace(/"/g,'&quot;')}">${window.renderIcon(bs.iconName || 'library', { size: 12 })}</span>
                <span>${esc(bs.name)}</span>
                ${isEditMode ? `<button class="bd-chip-remove remove-from-bookshelf" type="button" data-asin="${esc(book.asin)}" data-bookshelf-id="${esc(bs.id)}" title="この本棚から外す">×</button>` : ''}
            </span>`;
        }).join('');

        const addBookshelfHtml = (isEditMode && candidateBookshelves.length > 0) ? `
            <div class="bd-add-bookshelf">
                <select class="bookshelf-select" data-asin="${esc(book.asin)}">
                    <option value="">本棚を追加...</option>
                    ${candidateBookshelves.map(bs => `<option value="${esc(bs.id)}">${esc(bs.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-small add-to-bookshelf" data-asin="${esc(book.asin)}" type="button">${ico('plus')}追加</button>
            </div>
        ` : '';

        // 短文メモ section (2026-06-20: 本棚 override 廃止 → ALL 1段のみ。閲覧/編集どちらでも直接編集可)
        const allMemoValue = (allRecord && allRecord.memo) || '';

        // ===== セクション本体 (順序は設定で並び替え可、デフォルト: 本棚→短文→長文→基本情報) =====
        const grip = window.renderIcon('grip-vertical', { size: 12 });

        // 本棚セクション body
        const bookshelvesBody = `
            <div class="bd-chips-row" id="current-bookshelves-${esc(book.asin)}">
                ${chipsHtml || '<span class="bd-empty-note">どの本棚にも追加されていません</span>'}
            </div>
            ${addBookshelfHtml}
        `;

        // 短文メモセクション body (ALL 1段。閲覧/編集どちらでも直接編集できる textarea。星と対称)
        const shortMemoBody = `
            <div class="bd-memo-block">
                <textarea class="note-textarea bd-textarea" data-asin="${esc(book.asin)}" data-scope="all" rows="4" placeholder="この本のメモ">${esc(allMemoValue)}</textarea>
                <span class="save-note-status bd-save-status" data-asin="${esc(book.asin)}" data-scope="all"></span>
                ${isEditMode ? `
                    <label class="bd-flag-label">
                        <input type="checkbox" class="hide-memo-check" data-asin="${esc(book.asin)}" ${userNote.hideMemo ? 'checked' : ''}>
                        公開時にこのメモを非公開
                    </label>
                ` : ''}
            </div>
        `;

        // 長文メモセクション body
        const longMemoBody = `
            <button class="bd-memo-link memo-file-btn" data-asin="${esc(book.asin)}" type="button">
                ${ico('file-text')}${userNote.hasDetailMemo ? '長文メモを開く' : '長文メモを書く'}
            </button>
            ${isEditMode ? `
                <label class="bd-flag-label">
                    <input type="checkbox" class="hide-detail-memo-check" data-asin="${esc(book.asin)}" ${userNote.hideDetailMemo ? 'checked' : ''}>
                    公開時に長文メモを非公開
                </label>
            ` : ''}
        `;

        // 基本情報セクション body (meta-row + メタ編集折りたたみ)
        const basicInfoBody = `
            <div class="bd-meta">
                <div class="bd-meta-row"><span class="k">購入</span><span>${new Date(book.acquiredTime).toLocaleDateString('ja-JP')}</span></div>
                <div class="bd-meta-row"><span class="k">ASIN</span><span>${esc(book.asin)}${book.updatedAsin ? ` → ${esc(book.updatedAsin)}` : ''}</span></div>
            </div>
            ${isEditMode ? `
                <details class="bd-meta-edit">
                    <summary>${ico('settings-2', 14)}メタ情報を編集</summary>
                    <div class="bd-meta-edit-body">
                        <div class="edit-field"><label>タイトル</label>
                            <input type="text" class="edit-title" data-asin="${esc(book.asin)}" value="${esc(book.title)}"></div>
                        <div class="edit-field"><label>著者</label>
                            <input type="text" class="edit-authors" data-asin="${esc(book.asin)}" value="${esc(book.authors)}"></div>
                        <div class="edit-field"><label>購入日</label>
                            <input type="date" class="edit-acquired-time" data-asin="${esc(book.asin)}" value="${new Date(book.acquiredTime).toISOString().split('T')[0]}"></div>
                        <div class="edit-field"><label>オリジナル ASIN</label>
                            <input type="text" class="edit-original-asin" data-asin="${esc(book.asin)}" value="${esc(book.asin)}" maxlength="10" pattern="[A-Z0-9]{10}"></div>
                        <div class="edit-field"><label>変更後 ASIN (オプション)</label>
                            <input type="text" class="edit-updated-asin" data-asin="${esc(book.asin)}" value="${esc(book.updatedAsin || '')}" placeholder="新しい ASIN" maxlength="10" pattern="[A-Z0-9]{10}"></div>
                        <div class="bd-meta-edit-actions">
                            <button class="btn btn-primary btn-small save-book-changes" data-asin="${esc(book.asin)}" type="button">${ico('save')}保存</button>
                            <button class="btn btn-secondary btn-small cancel-edit-btn" data-asin="${esc(book.asin)}" type="button">キャンセル</button>
                        </div>
                    </div>
                </details>
            ` : ''}
        `;

        const sectionDefs = {
            'bookshelves': { icon: 'library',      title: '所属本棚', body: bookshelvesBody, context: !!contextBookshelf },
            'short-memo':  { icon: 'notebook-pen', title: '短文メモ', body: shortMemoBody },
            'long-memo':   { icon: 'file-text',    title: '長文メモ', body: longMemoBody },
            'basic-info':  { icon: 'info',         title: '基本情報', body: basicInfoBody }
        };
        const order = this._getDetailSectionOrder();
        const sectionsHtml = order.map(id => {
            const def = sectionDefs[id];
            if (!def) return '';
            return `
                <div class="bd-section${def.context ? ' has-context' : ''}" data-section="${id}" ${isEditMode ? 'draggable="true"' : ''}>
                    <div class="bd-section-head">
                        ${isEditMode ? `<span class="bd-grip" title="ドラッグで並び替え">${grip}</span>` : ''}
                        <span class="bd-section-title">${ico(def.icon, 12)}${def.title}</span>
                    </div>
                    <div class="bd-section-body">${def.body}</div>
                </div>
            `;
        }).join('');

        // 星 widget。本詳細は編集面なので常に表示・常に編集可。配置のみ全体設定の
        // 「表紙に重ねる」(starOverlay) に従う。表示/非表示の visibility 設定は一覧カード専用。
        const overlayOnDetail = this._getStarOverlay();
        const starWidget = this._starWidgetHtml(book.asin, userNote.rating || 0, 18);
        // 評価解除は「同じ星を再クリック」で行えるため専用リセットボタンは廃止
        const showOverlay = overlayOnDetail;
        const showBelow = !overlayOnDetail;

        modalBody.innerHTML = `
            <div class="bd${isEditMode ? ' editing' : ''}">
                <div class="bd-topbar">
                    <button class="bd-edit-toggle${isEditMode ? ' is-active' : ''} ${isEditMode ? 'cancel-edit-btn' : 'edit-mode-btn'}" data-asin="${esc(book.asin)}" title="${isEditMode ? '編集を終える' : '編集モードに切替'}" type="button">
                        ${window.renderIcon(isEditMode ? 'check' : 'pencil', { size: 14 })}
                    </button>
                </div>

                <div class="bd-cover-wrap">
                    <div class="bd-cover">
                        ${book.productImage
                            ? `<img src="${esc(this.bookManager.getProductImageUrl(book))}" alt="${esc(book.title)}">`
                            : `<span class="bd-cover-placeholder">${window.renderIcon('book-open', { size: 40 })}</span>`}
                        ${showOverlay ? `<div class="bd-cover-stars stars-overlay">${starWidget}</div>` : ''}
                    </div>
                </div>

                <h3 class="bd-title">${esc(book.title)}</h3>
                <div class="bd-author">${esc(book.authors)}</div>

                ${kindleReadHtml}

                ${showBelow ? `<div class="bd-stars">${starWidget}</div>` : ''}

                <div class="bd-sections" id="bd-sections">
                    ${sectionsHtml}
                </div>

                <div class="bd-actions">
                    <a class="amazon-link" href="${esc(amazonUrl)}" target="_blank" rel="noopener">${ico('external-link')}Amazon</a>
                    ${isEditMode ? `<button class="btn btn-warning exclude-btn" data-asin="${esc(book.asin)}" type="button" title="「全ての本」から除外">${ico('ban')}除外</button>` : ''}
                </div>
            </div>
        `;
        if (isEditMode) this._bindDetailSectionReorder(modalBody, book);
        
        // Setup modal event listeners
        // 短文メモ textarea は閲覧/編集どちらでも自動保存 (星と対称に、閲覧のまま書ける)
        modalBody.querySelectorAll('.note-textarea').forEach(ta => {
            ta.addEventListener('input', (e) => {
                this._scheduleNoteAutoSave(e.target.dataset.asin, e.target.value, modalBody, e.target.dataset.scope || 'all');
            });
        });

        const hideDetailMemoCheck = modalBody.querySelector('.hide-detail-memo-check');
        if (hideDetailMemoCheck) {
            hideDetailMemoCheck.addEventListener('change', async (e) => {
                await this._toggleAllNoteFlag(e.currentTarget.dataset.asin, 'hideDetailMemo', e.currentTarget.checked);
            });
        }
        const hideMemoCheck = modalBody.querySelector('.hide-memo-check');
        if (hideMemoCheck) {
            hideMemoCheck.addEventListener('change', async (e) => {
                await this._toggleAllNoteFlag(e.currentTarget.dataset.asin, 'hideMemo', e.currentTarget.checked);
            });
        }
        // 旧「💾 メモを保存」ボタンは廃止。自動保存に切り替わったため不要。
        
        const addToBookshelfBtn = modalBody.querySelector('.add-to-bookshelf');
        if (addToBookshelfBtn) {
            addToBookshelfBtn.addEventListener('click', (e) => {
                // currentTarget = ボタン本体。e.target だとボタン内アイコン(SVG)クリックで asin が undefined になる
                this.addBookToBookshelf(e.currentTarget.dataset.asin);
            });
        }
        
        // Remove from bookshelf buttons
        modalBody.querySelectorAll('.remove-from-bookshelf').forEach(button => {
            button.addEventListener('click', (e) => {
                const asin = e.target.dataset.asin;
                const bookshelfId = e.target.dataset.bookshelfId;
                this.removeFromBookshelf(asin, bookshelfId);
            });
        });
        
        const deleteBtn = modalBody.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                this.deleteBook(e.target.dataset.asin);
            });
        }

        const excludeBtn = modalBody.querySelector('.exclude-btn');
        if (excludeBtn) {
            excludeBtn.addEventListener('click', (e) => {
                this.excludeBook(e.target.dataset.asin);
            });
        }

        const memoFileBtn = modalBody.querySelector('.memo-file-btn');
        if (memoFileBtn) {
            memoFileBtn.addEventListener('click', (e) => {
                this.openOrCreateBookMemo(e.currentTarget.dataset.asin);
            });
        }
        
        // Add book edit functionality
        const saveChangesBtn = modalBody.querySelector('.save-book-changes');
        if (saveChangesBtn) {
            saveChangesBtn.addEventListener('click', (e) => {
                this.saveBookChanges(e.target.dataset.asin);
            });
        }
        
        
        // 星評価 (クリックで編集 / hover プレビュー)。SVG 子要素クリックにも closest で対応。
        const starRating = modalBody.querySelector('.star-rating');
        if (starRating) {
            const previewFill = (n) => {
                starRating.querySelectorAll('.star').forEach((star, index) => {
                    const ic = star.querySelector('.lucide-star');
                    if (!ic) return;
                    const on = (index + 1) <= n;
                    ic.classList.toggle('is-filled', on);
                    ic.classList.toggle('is-empty', !on);
                });
            };

            starRating.addEventListener('mousemove', (e) => {
                const st = e.target.closest('.star');
                if (st) previewFill(parseInt(st.dataset.rating) || 0);
            });
            starRating.addEventListener('mouseleave', () => {
                previewFill(parseInt(starRating.dataset.currentRating) || 0);
            });
            starRating.addEventListener('click', (e) => {
                const st = e.target.closest('.star');
                if (!st) return;
                const asin = starRating.dataset.asin;
                let rating = parseInt(st.dataset.rating) || 0;
                const cur = parseInt(starRating.dataset.currentRating) || 0;
                if (rating === cur) rating = 0; // 同じ星を再クリックで解除
                this.saveRating(asin, rating);
                this._applyRatingEverywhere(asin, rating);
            });
        }
        
        // modal は使わず右ペインに表示する (PC v2)
        // プラグインの本詳細セクションを描画 + イベント発火
        if (this.pluginAPI) {
            this.pluginAPI._runDetailSections(modalBody, book, contextBookshelf);
            this.pluginAPI._emit('ui:book-detail-rendered', { asin: book.asin, book, container: modalBody });
            // [非推奨] 旧名 (互換用): #book-modal を前提とした旧プラグインは動かないが名前は残す
            this.pluginAPI._emit('ui:book-modal-opened', { asin: book.asin });
        }
    }

    closeModal() {
        this._closeBookModalDom();
        // Router 連携: 現在のルートが book なら戻す
        if (this.router && !this._suppressRouterUpdate) {
            const cur = this.router.current;
            if (cur && cur.view === 'book') {
                if (cur.from) {
                    const bs = this.bookshelfManager?.getByInternalId?.(cur.from)
                            || this.bookshelfManager?.getById?.(cur.from);
                    if (bs?.slug) {
                        this.router.navigateBookshelf(bs.slug, { replace: true });
                        return;
                    }
                }
                this.router.navigateMain({ replace: true });
            }
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

    /**
     * メモ自動保存（textarea の oninput から呼ばれる）
     * 300ms 入力停止で saveNote 実行。さらに saveUserData 側で 800ms debounce されるので
     * 連続入力時の Obsidian I/O は最小化される。
     */
    _scheduleNoteAutoSave(asin, value, modalRoot, scope = 'all') {
        if (!this._noteAutoSaveTimers) this._noteAutoSaveTimers = new Map();
        const key = `${asin}::${scope}`;
        const existing = this._noteAutoSaveTimers.get(key);
        if (existing) clearTimeout(existing);
        const statusEl = (modalRoot || document).querySelector(`.save-note-status[data-asin="${asin}"][data-scope="${scope}"]`);
        if (statusEl) statusEl.textContent = '入力中…';
        const timer = setTimeout(async () => {
            this._noteAutoSaveTimers.delete(key);
            try {
                await this.saveNote(asin, value);
                if (statusEl) {
                    statusEl.textContent = '保存しました';
                    setTimeout(() => { if (statusEl.textContent === '保存しました') statusEl.textContent = ''; }, 1500);
                }
            } catch (e) {
                console.error('メモ自動保存エラー:', e);
                if (statusEl) statusEl.textContent = e.message || '保存失敗';
            }
        }, 300);
        this._noteAutoSaveTimers.set(key, timer);
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
    async saveUserData() {
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
                await this.storage.initEmpty();
            } else if (format === 'pre-notes-split') {
                await this.storage.migrateNotesSplit();
            } else if (format === 'legacy') {
                await this.storage.migrateFromLegacy();
            }
            const state = await this.storage.loadAll();
            const loaded = this._applyLoadedState(state);
            if (loaded) {
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
                this.updateSyncStatus('reconnect', `${label} (空)`);
                const ok = confirm(`GitHub リポジトリ ${label} は空です。\n新規データで初期化しますか？`);
                if (!ok) return;
                await this.storage.initEmpty();
            } else if (format === 'pre-notes-split') {
                await this.storage.migrateNotesSplit();
            } else if (format === 'legacy') {
                await this.storage.migrateFromLegacy();
            }
            const state = await this.storage.loadAll();
            const loaded = this._applyLoadedState(state);
            if (loaded) {
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
                toast(`GitHub からの読み込みに失敗しました:\n${e.message}`);
            }
        }
    }

    _setupSyncMethodUI() {
        const selector = document.getElementById('sync-method-select');
        const localPanel = document.getElementById('sync-config-local');
        const githubPanel = document.getElementById('sync-config-github');
        if (!selector || !localPanel || !githubPanel) return;

        const hubPanel = document.getElementById('sync-config-hub');
        const showPanel = (method) => {
            localPanel.hidden = (method !== 'local');
            githubPanel.hidden = (method !== 'github');
            if (hubPanel) hubPanel.hidden = (method !== 'hub');
            // ハブを表示する時だけ Google ログインボタンを遅延描画 (外部 GIS 読込)
            if (method === 'hub') this._ensureHubSignInButton();
        };

        const config = this.syncConfig || SyncConfigManager.load();
        selector.value = config.method || 'local';
        showPanel(selector.value);

        this._renderGitHubAuthState();
        this._renderHubAuthState();
        this._setupHubUI();

        selector.addEventListener('change', () => {
            const newMethod = selector.value;
            showPanel(newMethod);
            const current = (this.syncConfig && this.syncConfig.method) || 'local';
            if (newMethod === 'local' && current !== 'local') {
                const ok = confirm('保存先を「この端末のフォルダ」に切り替えますか？\nGitHub の接続情報はそのまま残ります。\nOK を押すとページを再読み込みします。');
                if (ok) {
                    const merged = { ...SyncConfigManager.load(), method: 'local' };
                    SyncConfigManager.save(merged);
                    location.reload();
                } else {
                    selector.value = current;
                    showPanel(current);
                }
            }
        });

        const connectBtn = document.getElementById('github-connect-btn');
        if (connectBtn) connectBtn.addEventListener('click', () => this._connectToGitHub());

        const cancelBtn = document.getElementById('github-cancel-auth-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this._cancelGitHubAuth());

        const copyBtn = document.getElementById('github-copy-code-btn');
        if (copyBtn) copyBtn.addEventListener('click', () => this._copyDeviceCode());

        const disconnectBtn = document.getElementById('github-disconnect-btn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => this._disconnectGitHub());

        const saveRepoBtn = document.getElementById('github-save-repo-btn');
        if (saveRepoBtn) saveRepoBtn.addEventListener('click', () => this._saveGitHubRepo());

        const reloadReposBtn = document.getElementById('github-reload-repos-btn');
        if (reloadReposBtn) reloadReposBtn.addEventListener('click', () => this._loadGitHubRepos());

        const reloadAfterInstallBtn = document.getElementById('github-reload-after-install-btn');
        if (reloadAfterInstallBtn) reloadAfterInstallBtn.addEventListener('click', () => this._loadGitHubRepos());

        const publishRepoSel = document.getElementById('publish-repo-select');
        if (publishRepoSel) publishRepoSel.addEventListener('change', () => this._onPublishRepoSelected());

        const publishTargetSel = document.getElementById('publish-target-select');
        if (publishTargetSel) {
            publishTargetSel.value = (SyncConfigManager.load().publish || {}).target || 'github';
            publishTargetSel.addEventListener('change', () => this._onPublishTargetSelected());
            this._reflectPublishTargetPanels(publishTargetSel.value);
        }

        // basePath ブラウザ
        const browseBtn = document.getElementById('github-basepath-browse-btn');
        if (browseBtn) browseBtn.addEventListener('click', () => this._openBasepathBrowser());

        const upBtn = document.getElementById('basepath-up-btn');
        if (upBtn) upBtn.addEventListener('click', () => {
            const cur = this._basepathCurrentPath || '';
            const parts = cur.split('/').filter(Boolean);
            parts.pop();
            this._loadBasepathBrowser(parts.join('/'));
        });

        const applyBtn = document.getElementById('basepath-apply-btn');
        if (applyBtn) applyBtn.addEventListener('click', () => {
            const input = document.getElementById('github-base-path');
            if (input) input.value = this._basepathCurrentPath || '';
            const browser = document.getElementById('github-basepath-browser');
            if (browser) {
                browser.open = false;
                browser.hidden = true;
            }
        });

        // GitHub App インストールリンク
        const installLink = document.getElementById('github-install-link');
        if (installLink) {
            const appUrl = GitHubDeviceAuth.getAppPublicUrl();
            if (appUrl) installLink.href = appUrl;
            else installLink.removeAttribute('href');

            // install link クリック後にこのタブへ戻ってきたら自動で再取得
            // (反映ラグ対策: GitHub 側の install 反映に少しラグがあるので focus から少し待って実行)
            installLink.addEventListener('click', () => {
                this._pendingInstallReloadAt = Date.now();
                const status = document.getElementById('github-status');
                if (status) status.textContent = 'インストール完了後、このタブに戻ると自動で再取得します';
            });
        }

        // window focus 検知: 直近 10 分以内に install link を押していたら自動再取得
        if (!this._githubFocusBound) {
            this._githubFocusBound = true;
            window.addEventListener('focus', () => {
                const pendingAt = this._pendingInstallReloadAt || 0;
                if (!pendingAt) return;
                if (Date.now() - pendingAt > 10 * 60 * 1000) {
                    this._pendingInstallReloadAt = 0;
                    return;
                }
                const settingsModal = document.getElementById('settings-modal');
                if (!settingsModal || !settingsModal.classList.contains('show')) return;
                this._pendingInstallReloadAt = 0;
                const status = document.getElementById('github-status');
                if (status) status.textContent = '戻りました、3秒後に再取得します...';
                setTimeout(() => {
                    if (status) status.textContent = '再取得中...';
                    this._loadGitHubRepos();
                }, 3000);
            });
        }
    }

    _openBasepathBrowser() {
        const browser = document.getElementById('github-basepath-browser');
        if (!browser) return;
        browser.hidden = false;
        browser.open = true;
        const startPath = (document.getElementById('github-base-path')?.value || '').trim();
        this._loadBasepathBrowser(startPath);
    }

    async _loadBasepathBrowser(path) {
        this._basepathCurrentPath = path || '';
        const curEl = document.getElementById('basepath-current');
        const listEl = document.getElementById('basepath-browser-list');
        if (curEl) curEl.textContent = '/' + (this._basepathCurrentPath || '');
        if (!listEl) return;
        listEl.innerHTML = '<li>(取得中...)</li>';

        const config = SyncConfigManager.load();
        const token = config.github && config.github.token;
        const fullSel = document.getElementById('github-repo-select');
        const fullName = fullSel ? fullSel.value : '';
        if (!fullName || !token) {
            listEl.innerHTML = '<li>(まず repo を選択してください)</li>';
            return;
        }
        const [owner, repo] = fullName.split('/');
        const branchSel = document.getElementById('github-branch-select');
        const branch = (branchSel && branchSel.value) || 'main';
        const segments = (this._basepathCurrentPath || '').split('/').filter(Boolean);
        const encodedPath = segments.map(encodeURIComponent).join('/');
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
        try {
            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (res.status === 404) {
                listEl.innerHTML = '<li>(空)</li>';
                return;
            }
            if (!res.ok) throw new Error(await this._ghErrorDetail(res));
            const items = await res.json();
            if (!Array.isArray(items)) {
                listEl.innerHTML = '<li>(これはディレクトリではなくファイルです)</li>';
                return;
            }
            items.sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'dir' ? -1 : 1;
            });
            listEl.innerHTML = '';
            if (items.length === 0) {
                listEl.innerHTML = '<li>(空)</li>';
                return;
            }
            for (const item of items) {
                const li = document.createElement('li');
                if (item.type === 'dir') {
                    li.classList.add('basepath-dir');
                    const a = document.createElement('a');
                    a.href = '#';
                    a.textContent = `${item.name}`;
                    a.addEventListener('click', (e) => {
                        e.preventDefault();
                        this._loadBasepathBrowser(item.path);
                    });
                    li.appendChild(a);
                } else {
                    li.classList.add('basepath-file');
                    const span = document.createElement('span');
                    span.textContent = `📄 ${item.name}`;
                    li.appendChild(span);
                }
                listEl.appendChild(li);
            }
        } catch (e) {
            listEl.innerHTML = `<li>(取得失敗: ${this._escapeHtml(e.message)})</li>`;
        }
    }

    _escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _renderGitHubAuthState() {
        const disc = document.getElementById('github-auth-disconnected');
        const pend = document.getElementById('github-auth-pending');
        const conn = document.getElementById('github-auth-connected');
        if (!disc || !pend || !conn) return;

        const config = SyncConfigManager.load();
        const token = config.github && config.github.token;
        const login = config.github && config.github.login;

        if (token) {
            disc.hidden = true;
            pend.hidden = true;
            conn.hidden = false;
            const loginEl = document.getElementById('github-connected-login');
            if (loginEl) loginEl.textContent = login || '(ユーザ取得中)';
            const g = config.github || {};
            const basePathEl = document.getElementById('github-base-path');
            if (basePathEl) basePathEl.value = g.basePath || '';
            // repo / branch select はリストを GitHub から取得して詰める
            this._loadGitHubRepos();
        } else {
            disc.hidden = false;
            pend.hidden = true;
            conn.hidden = true;
        }
    }

    async _loadGitHubRepos() {
        const sel = document.getElementById('github-repo-select');
        const branchSel = document.getElementById('github-branch-select');
        const installPrompt = document.getElementById('github-install-prompt');
        if (!sel) return;
        await this._ensureFreshGitHubToken();
        const token = (SyncConfigManager.load().github || {}).token;
        if (!token) return;
        sel.innerHTML = '<option value="">(取得中...)</option>';
        if (branchSel) branchSel.innerHTML = '<option value="">(repo 選択後に取得)</option>';
        try {
            const { installations, repos } = await this._fetchAccessibleRepos(token);
            if (installations.length === 0) {
                sel.innerHTML = '<option value="">(GitHub App 未インストール)</option>';
                if (installPrompt) installPrompt.hidden = false;
                if (this.syncMethod === 'github') {   // GitHub が現在の同期先のときだけ上部バーに反映
                    this._syncError = true;
                    this._syncErrorMsg = 'GitHub App が未インストールです。アプリをインストールしてください。';
                    this._updateStatusBar();
                }
                return;
            }
            if (installPrompt) installPrompt.hidden = true;
            repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            const current = SyncConfigManager.load().github || {};
            const currentFull = current.owner && current.repo ? `${current.owner}/${current.repo}` : '';
            sel.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = repos.length === 0
                ? '— インストール済みだが、選択可能な repo がありません —'
                : '— リポジトリを選択 —';
            sel.appendChild(placeholder);
            for (const r of repos) {
                const opt = document.createElement('option');
                opt.value = r.full_name;
                opt.textContent = `${r.full_name}${r.private ? ' ' : ''}`;
                opt.dataset.defaultBranch = r.default_branch;
                if (r.full_name === currentFull) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.onchange = () => this._onGitHubRepoSelected();
            this._populatePublishRepoSelect(repos);
            if (currentFull && repos.some(r => r.full_name === currentFull)) {
                await this._loadGitHubBranches(currentFull, current.branch);
            }
            if (this.syncMethod === 'github') {       // 取得成功 → 同期エラー解消 (GitHub が同期先のとき)
                this._syncError = false;
                this._syncErrorMsg = '';
                this._updateStatusBar();
            }
        } catch (e) {
            const msg = e.message || String(e);
            sel.innerHTML = `<option value="">(取得失敗: ${msg})</option>`;
            // 権限系エラーは GitHub の反映ラグの可能性が高い
            if (/not accessible|forbidden|permission/i.test(msg) && installPrompt) {
                installPrompt.hidden = false;
            }
            // 取得失敗 (401 Bad credentials 等) は同期エラーとして上部バーに出す (GitHub が同期先のとき)
            if (this.syncMethod === 'github') {
                this._syncError = true;
                this._syncErrorMsg = /401|bad credential|invalid|token|unauthor/i.test(msg)
                    ? 'GitHub のトークンが無効です。再接続してください。'
                    : 'GitHub の保存先を取得できません。';
                this._updateStatusBar();
            }
        }
    }

    async _onGitHubRepoSelected() {
        const sel = document.getElementById('github-repo-select');
        if (!sel || !sel.value) return;
        await this._loadGitHubBranches(sel.value);
    }

    // 公開先リポジトリのセレクタを、同期 repo 一覧と同じ accessible repos で埋める (T09)
    _populatePublishRepoSelect(repos) {
        const sel = document.getElementById('publish-repo-select');
        if (!sel) return;
        const cur = SyncConfigManager.load().publish || {};
        const curFull = cur.owner && cur.repo ? `${cur.owner}/${cur.repo}` : '';
        sel.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— 公開先リポジトリを選択 —';
        sel.appendChild(ph);
        for (const r of repos) {
            const opt = document.createElement('option');
            opt.value = r.full_name;
            opt.textContent = `${r.full_name}${r.private ? ' （非公開・公開不可）' : ''}`;
            opt.dataset.defaultBranch = r.default_branch || 'main';
            opt.dataset.private = r.private ? '1' : '';
            if (r.full_name === curFull) opt.selected = true;
            sel.appendChild(opt);
        }
        // 設定済みだが一覧に無い (App のアクセス対象に未追加) 場合も選択を保持しつつ警告
        if (curFull && !repos.some(r => r.full_name === curFull)) {
            const opt = document.createElement('option');
            opt.value = curFull;
            opt.textContent = `${curFull}（アプリのアクセス対象に未追加？）`;
            opt.selected = true;
            sel.appendChild(opt);
        }
        this._reflectPublishRepoStatus();
    }

    _onPublishRepoSelected() {
        const sel = document.getElementById('publish-repo-select');
        if (!sel) return;
        const full = sel.value;
        const cfg = SyncConfigManager.load();
        if (!full) {
            cfg.publish = { ...(cfg.publish || {}), owner: '', repo: '' };
            SyncConfigManager.save(cfg);
            this._reflectPublishRepoStatus();
            return;
        }
        const [owner, repo] = full.split('/');
        const opt = sel.selectedOptions[0];
        const branch = (opt && opt.dataset.defaultBranch) || 'main';
        cfg.publish = { ...(cfg.publish || {}), owner, repo, branch };
        SyncConfigManager.save(cfg);
        this._reflectPublishRepoStatus();
    }

    // 公開先 (github / hub) の選択を保存し、対応する設定ブロックを出し分ける
    _onPublishTargetSelected() {
        const sel = document.getElementById('publish-target-select');
        if (!sel) return;
        const target = sel.value === 'hub' ? 'hub' : 'github';
        const cfg = SyncConfigManager.load();
        const last = (cfg.publish || {}).lastPublishedTarget;
        cfg.publish = { ...(cfg.publish || {}), target };
        SyncConfigManager.save(cfg);
        this._reflectPublishTargetPanels(target);
        this._reflectAffiliateField(); // 公開先で自分タグ入力の出し分けが変わる (github=プラン不問)
        // 旧公開先にサイトが残っている場合は警告 (自動削除はしない=手動クリーンアップ誘導)
        if (last && last !== target) {
            const name = (t) => t === 'hub' ? '共有（ハブ）' : '自分の GitHub リポジトリ';
            this._publishSwitchWarn = `以前の公開先「${name(last)}」にサイトが残っています。完全に消すには、公開先を「${name(last)}」に戻し、全ページを「公開を取り消す」で取り消してから再公開（空にする）してください。`;
            toast(this._publishSwitchWarn, { type: 'warn' });
        } else {
            this._publishSwitchWarn = '';
        }
        this._reflectPublishSwitchWarn();
    }

    // 公開先切替の残存警告を該当パネルに常設表示 (toast は消えるため)
    _reflectPublishSwitchWarn() {
        const el = document.getElementById('publish-switch-warn');
        if (!el) return;
        el.textContent = this._publishSwitchWarn || '';
        el.hidden = !this._publishSwitchWarn;
    }

    _reflectPublishTargetPanels(target) {
        const ghBlock = document.getElementById('publish-config-github');
        const hubBlock = document.getElementById('publish-config-hub');
        if (ghBlock) ghBlock.hidden = (target !== 'github');
        if (hubBlock) hubBlock.hidden = (target !== 'hub');
        if (target === 'hub') this._reflectPublishHubStatus();
        this._reflectPublishSwitchWarn();
    }

    _reflectPublishHubStatus() {
        const status = document.getElementById('publish-hub-status');
        if (!status) return;
        const hub = (SyncConfigManager.load().hub) || {};
        if (hub.key && hub.apiBase) {
            status.textContent = hub.publicBase ? `公開 URL: ${hub.publicBase}` : 'Asayake ハブに接続済み';
        } else {
            status.textContent = '先に設定の「同期」で Asayake ハブにログインしてください。';
        }
    }

    _reflectPublishRepoStatus() {
        const sel = document.getElementById('publish-repo-select');
        const status = document.getElementById('publish-repo-status');
        if (!sel || !status) return;
        const opt = sel.selectedOptions[0];
        if (!sel.value) { status.textContent = ''; return; }
        if (opt && opt.dataset.private === '1') {
            status.textContent = '非公開リポジトリは公開モードで読めません。public を選んでください';
        } else {
            status.textContent = `公開先: ${sel.value}`;
        }
    }

    async _loadGitHubBranches(fullName, preferBranch) {
        const branchSel = document.getElementById('github-branch-select');
        if (!branchSel) return;
        const token = (SyncConfigManager.load().github || {}).token;
        if (!token) return;
        branchSel.innerHTML = '<option value="">(取得中...)</option>';
        try {
            const [owner, repo] = fullName.split('/');
            const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (!res.ok) throw new Error(await this._ghErrorDetail(res));
            const branches = await res.json();
            const repoSel = document.getElementById('github-repo-select');
            const opt = repoSel ? repoSel.selectedOptions[0] : null;
            const defaultBranch = opt ? (opt.dataset.defaultBranch || null) : null;
            branches.sort((a, b) => {
                if (a.name === defaultBranch) return -1;
                if (b.name === defaultBranch) return 1;
                return a.name.localeCompare(b.name);
            });
            branchSel.innerHTML = '';
            for (const b of branches) {
                const o = document.createElement('option');
                o.value = b.name;
                o.textContent = b.name === defaultBranch ? `${b.name} (default)` : b.name;
                if (b.name === preferBranch) o.selected = true;
                branchSel.appendChild(o);
            }
            if (!preferBranch && defaultBranch) branchSel.value = defaultBranch;
        } catch (e) {
            branchSel.innerHTML = `<option value="">(取得失敗: ${e.message})</option>`;
        }
    }

    // GitHub App 経由でアクセス可能なリポジトリのみ取得 (installation 経由)
    async _fetchAccessibleRepos(token) {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
        const instRes = await fetch('https://api.github.com/user/installations?per_page=100', { headers });
        if (!instRes.ok) {
            throw new Error(`/user/installations: ${await this._ghErrorDetail(instRes)}`);
        }
        const instData = await instRes.json();
        const installations = instData.installations || [];
        const repos = [];
        for (const inst of installations) {
            let page = 1;
            while (page < 10) {
                const url = `https://api.github.com/user/installations/${inst.id}/repositories?per_page=100&page=${page}`;
                const res = await fetch(url, { headers });
                if (!res.ok) {
                    throw new Error(`/user/installations/${inst.id}/repositories: ${await this._ghErrorDetail(res)}`);
                }
                const data = await res.json();
                const batch = data.repositories || [];
                repos.push(...batch);
                if (batch.length < 100) break;
                page++;
            }
        }
        return { installations, repos };
    }

    async _ghErrorDetail(res) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const data = await res.json();
            if (data && data.message) detail += `: ${data.message}`;
        } catch (_) {}
        return detail;
    }

    async _connectToGitHub() {
        const disc = document.getElementById('github-auth-disconnected');
        const pend = document.getElementById('github-auth-pending');
        const codeEl = document.getElementById('github-user-code');
        const linkEl = document.getElementById('github-verification-link');
        const statusEl = document.getElementById('github-auth-pending-status');

        if (!GitHubDeviceAuth.isClientIdConfigured()) {
            toast('GitHub OAuth Client ID が未設定です。\nbookshelf 管理者に問い合わせるか、fork 時は自分の OAuth App を作成して js/github-auth.js の GITHUB_OAUTH_CLIENT_ID を置き換えてください。');
            return;
        }

        try {
            const device = await GitHubDeviceAuth.requestDeviceCode();
            this._currentDeviceAuth = { cancelled: false, device };

            if (disc) disc.hidden = true;
            if (pend) pend.hidden = false;
            if (codeEl) codeEl.textContent = device.user_code;
            if (linkEl) linkEl.href = device.verification_uri;
            if (statusEl) statusEl.textContent = 'GitHub で承認されるのを待っています...';

            const startedAt = Date.now();
            const token = await GitHubDeviceAuth.pollAccessToken(device, {
                shouldCancel: () => this._currentDeviceAuth && this._currentDeviceAuth.cancelled,
                onTick: (state) => {
                    if (!statusEl) return;
                    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                    const base = state === 'slow'
                        ? 'GitHub が混雑中、間隔を伸ばします'
                        : 'GitHub で承認されるのを待っています';
                    statusEl.textContent = `${base} (${elapsedSec}秒経過)`;
                }
            });

            let user = null;
            try {
                user = await GitHubDeviceAuth.fetchUser(token.access_token);
            } catch (_) {
                // ユーザ取得失敗は致命的ではないので続行
            }

            const now = Date.now();
            const merged = SyncConfigManager.load();
            merged.method = 'github';
            merged.github = {
                ...(merged.github || {}),
                token: token.access_token,
                // 「Expire user authorization tokens」有効時のみ返る (8h 失効 + 自動 refresh 用)
                refreshToken: token.refresh_token || '',
                tokenExpiresAt: token.expires_in ? now + token.expires_in * 1000 : null,
                refreshTokenExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : null,
                login: user ? user.login : null
            };
            SyncConfigManager.save(merged);
            this._currentDeviceAuth = null;
            this._renderGitHubAuthState();
            toast(`GitHub に接続しました${user ? ` (${user.login})` : ''}。\n下のリストからリポジトリを選んで「この設定で使う」を押してください。`);
        } catch (e) {
            this._currentDeviceAuth = null;
            if (e.message === 'AUTH_CANCELLED') {
                this._renderGitHubAuthState();
                return;
            }
            if (e.message === 'AUTH_DENIED') {
                toast('GitHub での承認が拒否されました。');
            } else if (e.message === 'AUTH_EXPIRED') {
                toast('コードの有効期限が切れました。もう一度「接続」を押してください。');
            } else {
                toast(`GitHub 接続エラー:\n${e.message}`);
            }
            this._renderGitHubAuthState();
        }
    }

    _cancelGitHubAuth() {
        if (this._currentDeviceAuth) {
            this._currentDeviceAuth.cancelled = true;
        }
        this._renderGitHubAuthState();
    }

    async _copyDeviceCode() {
        const codeEl = document.getElementById('github-user-code');
        if (!codeEl) return;
        const text = codeEl.textContent.trim();
        try {
            await navigator.clipboard.writeText(text);
            const copyBtn = document.getElementById('github-copy-code-btn');
            if (copyBtn) {
                const orig = copyBtn.textContent;
                copyBtn.textContent = 'コピー済';
                setTimeout(() => { copyBtn.textContent = orig; }, 1500);
            }
        } catch (e) {
            console.warn('clipboard write failed:', e);
        }
    }

    _disconnectGitHub() {
        const ok = confirm('GitHub との接続を切断しますか？\n接続情報を削除し、保存先を「この端末のフォルダ」に戻します。');
        if (!ok) return;
        const merged = SyncConfigManager.load();
        merged.method = 'local';
        if (merged.github) {
            merged.github = {
                ...merged.github,
                token: '',
                refreshToken: '',
                tokenExpiresAt: null,
                refreshTokenExpiresAt: null,
                login: null
            };
        }
        SyncConfigManager.save(merged);
        location.reload();
    }

    // ===== Asayake ハブ接続 UI (ADR-032/033) =====

    _renderHubAuthState() {
        const disc = document.getElementById('hub-auth-disconnected');
        const conn = document.getElementById('hub-auth-connected');
        if (!disc || !conn) return;
        const hub = (SyncConfigManager.load().hub) || {};
        const connected = !!(hub.key && hub.apiBase);
        disc.hidden = connected;
        conn.hidden = !connected;
        if (connected) {
            const emailEl = document.getElementById('hub-connected-email');
            if (emailEl) emailEl.textContent = hub.email || '(接続済み)';
            this._renderHubUsageBar(hub);
        }
    }

    // 使用量バー・プランバッジを設定キャッシュ (hub) の値で描画
    _renderHubUsageBar(hub) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        const used = Number(hub.usedBytes) || 0;
        const quota = Number(hub.quotaBytes) || 0;
        const badge = document.getElementById('hub-plan-badge');
        if (badge) {
            const plus = hub.plan === 'plus';
            badge.textContent = plus ? 'Plus' : '無料';
            badge.classList.toggle('is-plus', plus);
        }
        const usedEl = document.getElementById('hub-usage-used');
        const quotaEl = document.getElementById('hub-usage-quota');
        if (usedEl) usedEl.textContent = this._formatBytes(used);
        if (quotaEl) quotaEl.textContent = quota ? this._formatBytes(quota) : '—';
        const fill = document.getElementById('hub-usage-fill');
        if (fill) {
            const ratio = quota > 0 ? Math.min(1, used / quota) : 0;
            fill.style.width = `${(ratio * 100).toFixed(1)}%`;
            fill.classList.toggle('is-warn', ratio >= 0.8 && ratio < 0.98);
            fill.classList.toggle('is-full', ratio >= 0.98);
        }
        // プランが変わればアフィタグ欄の表示可否も追従させる
        this._reflectAffiliateField();
    }

    // アフィタグ入力欄(Plus限定)の表示可否と値を最新化。プラン変化・設定再オープンに追従
    _reflectAffiliateField() {
        const affInput = document.getElementById('setting-affiliate-id');
        const affWrap = document.getElementById('publish-affiliate');
        if (!affInput || !affWrap) return;
        const cfg = SyncConfigManager.load();
        const plan = (cfg.hub || {}).plan || 'free';
        const target = (cfg.publish || {}).target === 'hub' ? 'hub' : 'github';
        // 自前 GitHub Pages はユーザの自己責任サイト → プラン不問で自分のタグ可 (運営タグは入れない)。
        // ハブは運営ホスト → 自分のタグは Plus 特典 (無料は運営タグ)。
        affWrap.hidden = !((target === 'github') || (plan === 'plus'));
        // 入力中はユーザの編集を尊重して上書きしない
        if (document.activeElement !== affInput) {
            affInput.value = (this.userData && this.userData.settings && this.userData.settings.affiliateId) || '';
        }
    }

    // 公開名義フィールドの値と placeholder を最新化 (placeholder はアカウント名由来)
    _reflectPublicNameField() {
        const el = document.getElementById('setting-public-name');
        if (!el) return;
        const s = (this.userData && this.userData.settings) || {};
        if (document.activeElement !== el) el.value = s.publicDisplayName || '';
        let derived = '';
        try {
            const email = (SyncConfigManager.load().hub || {}).email || '';
            derived = email ? email.split('@')[0] : '';
        } catch (_) {}
        el.placeholder = derived ? `例: ${derived}（未入力ならこの名前を使用）` : '例: あなたの名前 / ハンドル';
    }

    _formatBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    _setupHubUI() {
        if (this._hubUIBound) return;
        this._hubUIBound = true;
        const disconnectBtn = document.getElementById('hub-disconnect-btn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => this._disconnectHub());
        const useBtn = document.getElementById('hub-use-btn');
        if (useBtn) useBtn.addEventListener('click', () => this._useHub());
        const refreshBtn = document.getElementById('hub-usage-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this._refreshHubUsage({ notify: true }));
    }

    // Google ログインボタンの描画は「ハブパネルを実際に開いた時」だけ (GIS スクリプトの遅延読込)。
    // ブート時に外部スクリプトを読みに行かない (オフライン/起動コストを避ける)。
    _ensureHubSignInButton() {
        if (this._hubSignInRendered) return;
        const hub = (SyncConfigManager.load().hub) || {};
        if (hub.key && hub.apiBase) return; // 接続済みはボタン不要
        const btnHost = document.getElementById('hub-gsi-button');
        if (!btnHost || typeof HubAuth === 'undefined') return;
        this._hubSignInRendered = true;
        HubAuth.renderSignInButton(btnHost, {
            onConnected: (session) => {
                this._renderHubAuthState();
                toast(`Asayake ハブに接続しました${session && session.email ? ` (${session.email})` : ''}。`, { type: 'success' });
            },
            onError: (e) => toast(`ハブへの接続に失敗しました: ${e.message}`, { type: 'error' })
        });
    }

    // ===== アカウント (ログイン/状態) — 同期方式と独立した第一級のログイン面 (A) =====
    // 設定の「アカウント」セクションとサイドバーのチップに状態を反映する。
    // 「同期=ハブ」を選ばなくてもここからログインできる (= 旧来「同期からしか入れない」の解消)。

    _setupAccountUI() {
        if (this._accountUIBound) return;
        this._accountUIBound = true;
        const logout = document.getElementById('account-logout-btn');
        if (logout) logout.addEventListener('click', () => this._logoutAccount());
        const del = document.getElementById('account-delete-btn');
        if (del) del.addEventListener('click', () => this._deleteAccount());
        const refresh = document.getElementById('account-usage-refresh');
        if (refresh) refresh.addEventListener('click', () => this._refreshHubUsage({ notify: true }));
        // 課金 (Stripe, ADR-035): アップグレード / 支払い管理 (解約)
        const upM = document.getElementById('account-upgrade-monthly');
        if (upM) upM.addEventListener('click', () => this._startCheckout('monthly'));
        const upY = document.getElementById('account-upgrade-yearly');
        if (upY) upY.addEventListener('click', () => this._startCheckout('yearly'));
        const manage = document.getElementById('account-manage-billing');
        if (manage) manage.addEventListener('click', () => this._openBillingPortal());
        // 管理者: プラン手動切替 (ADR-038)。表示は isAdmin のときだけ (_renderAccountUsageBar)
        const admPlus = document.getElementById('account-admin-plus');
        if (admPlus) admPlus.addEventListener('click', () => this._adminSetPlan('plus'));
        const admFree = document.getElementById('account-admin-free');
        if (admFree) admFree.addEventListener('click', () => this._adminSetPlan('free'));
        const admReset = document.getElementById('account-admin-reset');
        if (admReset) admReset.addEventListener('click', () => {
            const email = (document.getElementById('account-admin-email') || {}).value || '';
            if (!email.trim()) { toast('対象のメールを入力してください。', { type: 'warn' }); return; }
            if (confirm(`${email.trim()} の Stripe 課金リンク（customer/subscription）を外して無料に戻します。\n（test→live 切替で詰まった時の復旧用。Stripe 側の課金は止めません）\nよろしいですか？`)) this._adminSetPlan('free', true);
        });
        // 決済からの戻り (?billing=success|cancel) を処理 (1 回だけ)
        this._handleBillingReturn();
        const openAccount = () => {
            const sec = document.getElementById('account-section');
            if (sec) { sec.open = true; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        };
        const goto = document.getElementById('hub-goto-account');
        if (goto) goto.addEventListener('click', openAccount);
        const chip = document.getElementById('sidebar-account');
        if (chip) chip.addEventListener('click', async () => { await this._openSettingsModal(); openAccount(); });
        // 能動同意: 規約/プライバシーへの同意チェックが入って初めて Google ログインボタンを描画する。
        const consent = document.getElementById('account-consent-check');
        if (consent) consent.addEventListener('change', async () => {
            if (consent.checked) {
                try {
                    if (!this.userData.settings) this.userData.settings = {};
                    this.userData.settings.ackTermsPrivacy = { at: new Date().toISOString(), v: 'v1.0' };
                    await this.saveUserData();
                } catch (_) {}
            }
            this._ensureAccountSignInButton();
        });
    }

    // Google ログインボタンを描画 (GIS 遅延読込)。アカウントセクション用。
    // 能動同意: 規約/プライバシーの同意チェックが入るまでボタンを出さない (GIS ボタンはクリックで即認証に進むため)。
    _ensureAccountSignInButton() {
        if (typeof HubAuth === 'undefined') return;
        if (HubAuth.isConnected && HubAuth.isConnected()) return; // 接続済みは不要
        const host = document.getElementById('account-gsi-button');
        if (!host) return;
        const check = document.getElementById('account-consent-check');
        const hint = document.getElementById('account-consent-hint');
        const consented = !!(check && check.checked);
        host.hidden = !consented;
        if (hint) hint.hidden = consented;
        if (!consented) return;          // 未同意: ボタンは描画しない
        if (this._accountSignInRendered) return;
        this._accountSignInRendered = true;
        HubAuth.renderSignInButton(host, {
            onConnected: (session) => {
                this._renderAccountSection();
                this._renderHubAuthState();
                toast(`Asayake アカウントにログインしました${session && session.email ? ` (${session.email})` : ''}。`, { type: 'success' });
            },
            onError: (e) => toast(`ログインに失敗しました: ${e.message}`, { type: 'error' })
        });
    }

    // アカウントセクション本体 + サイドバーチップを現在の接続状態で描画
    _renderAccountSection() {
        const hub = (SyncConfigManager.load().hub) || {};
        const connected = !!(hub.key && hub.apiBase);
        const disc = document.getElementById('account-disconnected');
        const conn = document.getElementById('account-connected');
        if (disc && conn) {
            disc.hidden = connected;
            conn.hidden = !connected;
            if (connected) {
                const emailEl = document.getElementById('account-email');
                if (emailEl) emailEl.textContent = hub.email || '(ログイン済み)';
                this._renderAccountUsageBar(hub);
            } else {
                this._ensureAccountSignInButton();
            }
        }
        this._reflectAccountChip(hub, connected);
    }

    _renderAccountUsageBar(hub) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        const used = Number(hub.usedBytes) || 0;
        const quota = Number(hub.quotaBytes) || 0;
        const badge = document.getElementById('account-plan-badge');
        if (badge) {
            const plus = hub.plan === 'plus';
            badge.textContent = plus ? 'Plus' : '無料';
            badge.classList.toggle('is-plus', plus);
        }
        const usedEl = document.getElementById('account-usage-used');
        const quotaEl = document.getElementById('account-usage-quota');
        if (usedEl) usedEl.textContent = this._formatBytes(used);
        if (quotaEl) quotaEl.textContent = quota ? this._formatBytes(quota) : '—';
        const fill = document.getElementById('account-usage-fill');
        if (fill) {
            const ratio = quota > 0 ? Math.min(1, used / quota) : 0;
            fill.style.width = `${(ratio * 100).toFixed(1)}%`;
            fill.classList.toggle('is-warn', ratio >= 0.8 && ratio < 0.98);
            fill.classList.toggle('is-full', ratio >= 0.98);
        }
        // 課金導線 (ADR-035): Free=アップグレード提示 / Plus=課金状態 + 管理。接続済みのみ
        const plus = hub.plan === 'plus';
        const billing = document.getElementById('account-billing');
        const upgrade = document.getElementById('account-upgrade');
        const manage = document.getElementById('account-manage-billing');
        if (billing) billing.hidden = false;
        if (upgrade) upgrade.hidden = plus;
        // 「プラン変更・支払い・解約」(Stripe Billing Portal) は実際に Stripe サブスクがある時だけ。
        // 管理者付与の Plus (comp) や未払いは Stripe 顧客が無く Portal を開けないので出さない (ADR-039)。
        if (manage) manage.hidden = !(plus && hub.billingManaged);
        this._renderPlanDetail(hub, plus);
        const admin = document.getElementById('account-admin');   // 管理者のみ表示 (ADR-038)
        if (admin) admin.hidden = !hub.isAdmin;
    }

    // Plus の課金状態 (周期・次回更新日・解約予約) を表示する (ADR-035 追補)。
    // データは Worker が Stripe webhook から KV に保存し /usage で返す。古い Worker・未取得なら何も出さない。
    _renderPlanDetail(hub, plus) {
        const wrap = document.getElementById('account-plan-detail');
        const periodEl = document.getElementById('account-plan-period');
        const cancelEl = document.getElementById('account-plan-cancel');
        if (!wrap || !periodEl || !cancelEl) return;
        const end = Number(hub.currentPeriodEnd) || 0;   // unix 秒
        if (!plus || !end) { wrap.hidden = true; return; }
        const cycle = hub.interval === 'year' ? '年額' : hub.interval === 'month' ? '月額' : 'Plus';
        const dateStr = this._formatDate(end * 1000);
        if (hub.cancelAtPeriodEnd) {
            // 解約予約済み: 期間末まで Plus、その後 Free
            periodEl.textContent = `${cycle}（解約予約済み）`;
            cancelEl.textContent = `${dateStr} まで利用可能 ・ その後 無料プランに戻ります`;
            cancelEl.hidden = false;
            wrap.classList.add('is-canceling');
        } else {
            periodEl.textContent = `${cycle} ・ 次回更新 ${dateStr}`;
            cancelEl.textContent = '';
            cancelEl.hidden = true;
            wrap.classList.remove('is-canceling');
        }
        wrap.hidden = false;
    }

    // unix ミリ秒 → YYYY/MM/DD (ローカル)
    _formatDate(ms) {
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
    }

    _reflectAccountChip(hub, connected) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        if (connected === undefined) connected = !!(hub.key && hub.apiBase);
        const label = document.getElementById('sidebar-account-label');
        const plan = document.getElementById('sidebar-account-plan');
        if (label) label.textContent = connected ? (hub.email || 'ログイン中') : 'ログイン';
        if (plan) {
            const plus = hub.plan === 'plus';
            plan.hidden = !connected;
            plan.textContent = plus ? 'Plus' : '無料';
            plan.classList.toggle('is-plus', plus);
        }
        const chip = document.getElementById('sidebar-account');
        if (chip) chip.classList.toggle('is-connected', connected);
    }

    _logoutAccount() {
        if (!confirm('ログアウトしますか？\nこの端末からハブの接続情報を消します（ハブ上のデータは残ります）。\nOK を押すとページを再読み込みします。')) return;
        this._disconnectHub();   // 切断 + 同期=hub なら local に戻す + reload
    }

    // アカウント削除 (E): ハブ上の保存データと公開サイトを消す。Worker の DELETE /account が前提。
    async _deleteAccount() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('ログインしていません。', { type: 'warn' }); return; }
        if (!confirm('アカウントを削除しますか？\n\nハブ上の保存データと、ハブで公開したサイトがすべて削除されます。この操作は取り消せません。\n（GitHub やこの端末に保存したデータは消えません）\n\nOK を押すと削除して再読み込みします。')) return;
        const btn = document.getElementById('account-delete-btn');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`${hub.apiBase}/account`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${hub.key}` }
            });
            if (!res.ok) {
                let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {}
                throw new Error(`${res.status}${d ? ': ' + d : ''}`);
            }
            toast('アカウントを削除しました。', { type: 'success' });
            this._disconnectHub(); // ローカル接続情報も消去して再読み込み
        } catch (e) {
            if (btn) btn.disabled = false;
            toast(`アカウント削除に失敗しました: ${e.message}`, { type: 'error' });
        }
    }

    // 使用量を再取得し、バーを更新 (失敗は黙殺 or notify 時のみ通知)
    async _refreshHubUsage({ notify = false } = {}) {
        if (typeof HubAuth === 'undefined') return;
        try {
            const hub = await HubAuth.refreshUsage();
            if (hub) {
                this._renderHubUsageBar(hub);
                this._renderAccountUsageBar(hub);
                this._reflectAccountChip(hub, true);
                if (notify) toast('使用量を更新しました。', { type: 'success' });
            }
        } catch (e) {
            console.warn('ハブ使用量の取得に失敗:', e);
            if (notify) toast(`使用量を取得できませんでした: ${e.message}`, { type: 'warn' });
        }
    }

    // ===== 課金 (Stripe Checkout / Billing Portal, ADR-035) =====
    // 決済の実体は Stripe ホスト画面。アプリは Worker でセッションを作り、その URL へ遷移するだけ。

    // Plus にアップグレード: Worker に Checkout セッションを作らせ、Stripe へ遷移
    async _startCheckout(plan) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('先にログインしてください。', { type: 'warn' }); return; }
        const btns = ['account-upgrade-monthly', 'account-upgrade-yearly'].map(id => document.getElementById(id));
        btns.forEach(b => { if (b) b.disabled = true; });
        try {
            const res = await fetch(`${hub.apiBase}/billing/checkout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan, returnUrl: location.href.split('?')[0].split('#')[0] })
            });
            if (res.status === 503) { toast('Plus の決済は現在準備中です。もう少しお待ちください。', { type: 'warn' }); return; }
            if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {} throw new Error(`${res.status}${d ? ': ' + d : ''}`); }
            const data = await res.json();
            if (data.url) { location.href = data.url; return; }   // Stripe Checkout へ遷移
            throw new Error('セッション URL が取得できませんでした');
        } catch (e) {
            toast(`アップグレードを開始できませんでした: ${e.message}`, { type: 'error' });
        } finally {
            btns.forEach(b => { if (b) b.disabled = false; });
        }
    }

    // 支払い方法・解約の管理: Stripe Billing Portal へ遷移
    async _openBillingPortal() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('先にログインしてください。', { type: 'warn' }); return; }
        const btn = document.getElementById('account-manage-billing');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`${hub.apiBase}/billing/portal`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ returnUrl: location.href.split('?')[0].split('#')[0] })
            });
            if (res.status === 503) { toast('支払い管理は現在準備中です。', { type: 'warn' }); return; }
            if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {} throw new Error(`${res.status}${d ? ': ' + d : ''}`); }
            const data = await res.json();
            if (data.url) { location.href = data.url; return; }
            throw new Error('管理ページの URL が取得できませんでした');
        } catch (e) {
            toast(`支払い管理を開けませんでした: ${e.message}`, { type: 'error' });
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 決済からの戻り (?billing=success|cancel)。プラン反映は Webhook 経由なので使用量を再取得
    _handleBillingReturn() {
        if (this._billingReturnHandled) return;
        let params;
        try { params = new URLSearchParams(location.search); } catch (_) { return; }
        const billing = params.get('billing');
        if (!billing) return;
        this._billingReturnHandled = true;
        // クエリを URL から除去 (リロードで再通知しない)
        try {
            params.delete('billing');
            const qs = params.toString();
            history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
        } catch (_) {}
        if (billing === 'success') {
            toast('お支払いが完了しました。Plus を反映しています…', { type: 'success' });
            // Webhook 反映に数秒かかることがあるので少し遅らせて使用量を再取得
            setTimeout(() => this._refreshHubUsage({ notify: false }), 2500);
        } else if (billing === 'cancel') {
            toast('アップグレードはキャンセルされました。', { type: 'info' });
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

    _disconnectHub() {
        const wasMethod = SyncConfigManager.load().method;
        HubAuth.disconnect();
        if (wasMethod === 'hub') {
            const after = SyncConfigManager.load();
            after.method = 'local';
            SyncConfigManager.save(after);
        }
        location.reload();
    }

    _useHub() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) {
            toast('先に Asayake ハブにログインしてください。', { type: 'warn' });
            return;
        }
        const merged = SyncConfigManager.load();
        merged.method = 'hub';
        SyncConfigManager.save(merged);
        location.reload();
    }

    _collectGitHubRepoForm() {
        const sel = document.getElementById('github-repo-select');
        const fullName = sel ? sel.value : '';
        let owner = '', repo = '';
        if (fullName && fullName.includes('/')) {
            const parts = fullName.split('/');
            owner = parts[0];
            repo = parts.slice(1).join('/');
        }
        const branchSel = document.getElementById('github-branch-select');
        const branch = (branchSel && branchSel.value) || 'main';
        const val = (id) => (document.getElementById(id)?.value || '').trim();
        return {
            owner,
            repo,
            branch,
            basePath: val('github-base-path')
        };
    }

    async _saveGitHubRepo() {
        const status = document.getElementById('github-status');
        const repo = this._collectGitHubRepoForm();
        const config = SyncConfigManager.load();
        const token = config.github && config.github.token;
        if (!token) {
            if (status) status.textContent = '先に「GitHub に接続」を押してください';
            return;
        }
        if (!repo.owner || !repo.repo) {
            if (status) status.textContent = 'owner / repo は必須';
            return;
        }
        if (status) status.textContent = '接続確認中...';
        try {
            const adapter = new GitHubAdapter({ ...repo, token });
            await adapter.testConnection();
        } catch (e) {
            if (status) status.textContent = `接続失敗: ${e.message}`;
            return;
        }
        const merged = SyncConfigManager.load();
        merged.method = 'github';
        merged.github = {
            ...(merged.github || {}),
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.branch,
            basePath: repo.basePath
        };
        SyncConfigManager.save(merged);
        if (status) status.textContent = '保存しました。ページをリロードします...';
        setTimeout(() => location.reload(), 800);
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

        const currentSettings = this.userData?.settings || {};
        const mergedSettings = { ...currentSettings, ...state.privateSettings };
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

        // 未同期ローカル編集を採用した場合は、読込後に同期先へ再 push して確定させる
        if (_hasPendingLocal && this._isSyncReady()) {
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
                ...(b.updatedAsin ? { updatedAsin: b.updatedAsin } : {})
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
            entries.push({ op: 'put', path: 'private/settings.json', data: {
                version: '2.0',
                ...(this.userData.settings || {})
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
                if (err && err.name === 'GitHubConflictError') {
                    this.updateSyncStatus('reconnect', this._syncLabel());
                    this._handleSyncConflict();
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
                toast('保存フォルダが見つかりません（削除または名前変更された可能性があります）。\n設定 → 「同期」 → 「フォルダを選ぶ」から選び直してください。\nGitHub 保存に切り替える場合は、同じ画面の保存先の選択から変更できます。');
                if (this.storage && this.storage.adapter && typeof this.storage.adapter.setDirHandle === 'function') {
                    this.storage.adapter.setDirHandle(null);
                }
            }
        }
    }

    _handleSyncConflict() {
        if (this._conflictNotified) return;
        this._conflictNotified = true;
        const ok = confirm(
            '同期先 (GitHub) のデータが他の場所から更新されています。\n\n' +
            'このセッションでの直近の編集はまだ GitHub に反映されていません。\n\n' +
            'OK : 最新版を取得するためにページを再読込 (未反映の編集は失われます)\n' +
            'キャンセル: 何もしない (次回保存時にまた衝突する可能性)'
        );
        if (ok) {
            location.reload();
        } else {
            // ユーザがキャンセルしたら一定時間後にもう一度知らせる余地を残す
            setTimeout(() => { this._conflictNotified = false; }, 60000);
        }
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
            pathEl.textContent = `${folderName || ''} (要再接続)`;
            pathEl.title = folderName || '';
            pathEl.style.color = '#f44336';
            status.textContent = '「フォルダを選ぶ」を押してフォルダを選び直してください';
            status.style.color = '#f44336';
        } else {
            pathEl.textContent = '(未接続)';
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
        this.currentBookshelf = bookshelfId;
        this.applyFilters();
        // 本棚ビューに切替
        this._setBodyView('bookshelf');
        this._updateBookshelfViewTitle();
        // PC v2: 左サイドバーツリーのハイライト更新
        this._updateSidebarActive();
        // Router 連携（_applyRoute 由来でない場合のみ URL を更新）
        if (this.router && !this._suppressRouterUpdate) {
            const bs = this.bookshelfManager?.getById?.(bookshelfId);
            const slug = bs?.slug || bookshelfId;
            this.router.navigateBookshelf(slug);
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
        // モバイル: ビュー切替時はドロワーを閉じる
        document.body.classList.remove('drawer-open');
        // ホームに戻ったら右ペインのピン留めも解除
        if (view === 'main') {
            document.body.classList.remove('book-detail-pinned');
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
                if (this.router) this.router.navigateMain();
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
            const goHome = () => { if (this.router) this.router.navigateMain(); else this._setBodyView('main'); };
            brand.addEventListener('click', goHome);
            brand.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
        }

        // モバイル UI (ドロワー / 下部ナビ / 詳細シート) の初期化
        this._initMobileNav();
    }

    // ===== モバイル UI (<=768px): ドロワー + 下部ナビ + 詳細フルシート =====
    _initMobileNav() {
        if (this._mobileNavBound) return;
        this._mobileNavBound = true;
        const body = document.body;

        // スクリム: タップでドロワーを閉じる
        const scrim = document.getElementById('mobile-scrim');
        if (scrim) scrim.addEventListener('click', () => body.classList.remove('drawer-open'));

        // 下部ナビ
        const nav = document.getElementById('mobile-bottom-nav');
        if (nav) nav.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-mobile-nav]');
            if (!btn) return;
            const action = btn.dataset.mobileNav;
            if (action === 'home') {
                body.classList.remove('drawer-open');
                if (this.router) this.router.navigateMain(); else this._setBodyView('main');
            } else if (action === 'shelves') {
                body.classList.toggle('drawer-open');
            } else if (action === 'search') {
                body.classList.remove('drawer-open');
                this._openPalette();
            } else if (action === 'settings') {
                body.classList.remove('drawer-open');
                this._openSettingsModal();
            }
        });

        // 詳細シートの戻る
        const back = document.getElementById('mobile-detail-back');
        if (back) back.addEventListener('click', () => body.classList.remove('book-detail-pinned'));

        // Esc でドロワーを閉じる
        if (!this._mobileEscBound) {
            this._mobileEscBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && body.classList.contains('drawer-open')) {
                    body.classList.remove('drawer-open');
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
        if (this.storage && typeof this.storage.saveSettings === 'function') {
            this.storage.saveSettings(this.userData.settings).catch(err => console.warn('paneState 保存失敗', err));
        }
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
            // ===== D&D: 並び替え (同階層) + 親変更 (Phase H2-2) =====
            if (!bs.isSpecial) {
                node.draggable = true;
                node.addEventListener('dragstart', (e) => {
                    this._treeDragId = nodeKey;
                    node.classList.add('tree-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', nodeKey); } catch (_) {}
                });
                node.addEventListener('dragend', () => {
                    node.classList.remove('tree-dragging');
                    this._treeDragId = null;
                    this._clearTreeDropIndicators();
                });
            }
            // どのノードもドロップ先になれる (ALL は「中に入れる」= ルート直下 用)
            node.addEventListener('dragover', (e) => {
                if (!this._treeDragId || this._treeDragId === nodeKey) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = node.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const zone = bs.isSpecial ? 'inside'
                    : (y < rect.height * 0.3 ? 'before' : (y > rect.height * 0.7 ? 'after' : 'inside'));
                this._clearTreeDropIndicators();
                node.classList.add(`tree-drop-${zone}`);
                node.dataset.dropZone = zone;
            });
            node.addEventListener('dragleave', (e) => {
                if (!node.contains(e.relatedTarget)) {
                    node.classList.remove('tree-drop-before', 'tree-drop-inside', 'tree-drop-after');
                }
            });
            node.addEventListener('drop', (e) => {
                if (!this._treeDragId) return;
                e.preventDefault();
                e.stopPropagation();
                const draggedId = this._treeDragId;
                const zone = node.dataset.dropZone || 'inside';
                this._clearTreeDropIndicators();
                this._onTreeDrop(draggedId, nodeKey, zone);
            });

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
    }

    _clearTreeDropIndicators() {
        document.querySelectorAll('#sidebar-bookshelf-tree .tree-node').forEach(n => {
            n.classList.remove('tree-drop-before', 'tree-drop-inside', 'tree-drop-after');
            delete n.dataset.dropZone;
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
            menu.remove();
            document.removeEventListener('click', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
        };
        const onOutside = (e) => { if (!menu.contains(e.target)) cleanup(); };
        const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
        menu.querySelector('[data-act="edit"]')?.addEventListener('click', () => { cleanup(); this.editBookshelf(bs.id); });
        menu.querySelector('[data-act="add-child"]')?.addEventListener('click', () => { cleanup(); this.showBookshelfForm(null, bs.internalId); });
        menu.querySelector('[data-act="delete"]')?.addEventListener('click', () => { cleanup(); this.deleteBookshelf(bs.id); });
        setTimeout(() => {
            document.addEventListener('click', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    }

    _updateSidebarActive() {
        const tree = document.getElementById('sidebar-bookshelf-tree');
        if (!tree) return;
        tree.querySelectorAll('.tree-node').forEach(node => {
            const id = node.dataset.bookshelfId;
            const internalId = node.dataset.internalId;
            const isMain = document.body.classList.contains('app-view-main');
            const matches = !isMain && (this.currentBookshelf === id || this.currentBookshelf === internalId);
            node.classList.toggle('is-active', !!matches);
        });
        // ホームナビのハイライト
        const homeBtn = document.querySelector('.sidebar-nav-item[data-nav="home"]');
        if (homeBtn) {
            homeBtn.classList.toggle('is-active', document.body.classList.contains('app-view-main'));
        }
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

    _loadHeaderIconOverrides() {
        try {
            const raw = localStorage.getItem(VirtualBookshelf.HEADER_ICON_OVERRIDES_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    _saveHeaderIconOverrides(map) {
        try {
            localStorage.setItem(VirtualBookshelf.HEADER_ICON_OVERRIDES_KEY, JSON.stringify(map));
        } catch (e) { console.warn('header icon overrides 保存失敗', e); }
    }

    /**
     * ヘッダーアイテムに紐づく override を取得 ('' なら未設定)
     * @param {string} key  'back-to-main', 'view-toggle:covers', 'plugin:foo' など
     */
    getHeaderIconOverride(key) {
        if (!key) return '';
        const map = this._loadHeaderIconOverrides();
        return map[key] || '';
    }

    /**
     * ヘッダーアイテムの override を設定。null/'' でクリア。即時にヘッダー再描画。
     */
    setHeaderIconOverride(key, name) {
        const map = this._loadHeaderIconOverrides();
        if (name === null || name === '') {
            delete map[key];
        } else {
            map[key] = name;
        }
        this._saveHeaderIconOverrides(map);
        // ヘッダー全体を再構築 → state-切替も _updateView*Button から override を読むので反映される
        if (typeof this._applyHeaderLayout === 'function') this._applyHeaderLayout();
        // プラグインカードのプレビューも更新 (plugin:<id> の場合)
        if (key.startsWith('plugin:') && typeof this._renderPluginListSection === 'function') {
            this._renderPluginListSection().catch(e => console.warn('plugin list re-render failed', e));
        }
    }

    // ===== 後方互換: plugin-api.js が _getPluginIconOverride を呼ぶので残す =====
    _getPluginIconOverride(pluginId) {
        return this.getHeaderIconOverride(`plugin:${pluginId}`);
    }

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
                <button type="button" class="icon-picker-cell${isSel ? ' is-selected' : ''}" data-icon-value="${this._escapeAttr(value)}" title="${this._escapeAttr(value)}">
                    ${window.renderIcon(value, { size: 22 })}
                    <span class="icon-picker-cell-name">${this._escapeAttr(value)}</span>
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
                textPreview.innerHTML = window.renderTextIcon(v, { size: 28 }) + `<span style="color:#374151;font-size:0.8rem;">${this._escapeAttr(v)}</span>`;
                textUseBtn.disabled = false;
                textUseBtn.dataset.pendingValue = v;
            };

            // ===== イベントハンドラ =====
            const cleanup = () => {
                modal.classList.remove('show');
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

            modal.classList.add('show');
        });
    }

    _escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async _openSettingsModal(targetId) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        modal.classList.add('show');
        // 設定を開くたびにアフィタグ欄の表示可否/値を最新化 (プラン変化・別端末更新に追従)
        this._reflectAffiliateField();
        this._reflectPublicNameField();
        // アカウント状態 (ログイン/プラン/使用量) も最新化
        this._setupAccountUI();
        this._renderAccountSection();
        const urlInput = document.getElementById('plugin-repo-url');
        if (urlInput) urlInput.value = '';
        // 分類マークの凡例を描画
        this._renderPluginCategoryLegend();
        // マーケット (公式カタログ) を非同期で読み込み (公開・認証不要。失敗は黙殺し再試行ボタンを出す)
        this._renderMarketSection().catch(e => console.warn('market render failed', e));
        // プラグイン一覧はインストール済み情報を非同期で取得して描画
        try { await this._renderPluginListSection(); } catch (e) { console.warn(e); }
        // 指定があればその節を開いてスクロール (空状態ボタン・⌘K・公開誘導から共通利用)
        if (targetId) this._scrollSettingsTo(targetId);
    }

    // 設定モーダル内の特定要素/節へジャンプ (details を開いて scrollIntoView)。
    // 引数 targetId は要素 id (details 自身でも、節内の要素でも可)。
    _scrollSettingsTo(targetId) {
        const el = targetId && document.getElementById(targetId);
        if (!el) return;
        const det = (el.tagName === 'DETAILS') ? el : el.closest('details.settings-section');
        if (det) det.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (_) {}
    }

    // ===== Header customization (V6: square icon buttons, linear flow, vertical drag&drop editor) =====
    //
    // レイアウト構造:
    //   { items: [{ id, key }] }
    // - id は placement 単位の一意値
    // - 全アイテム duplicatable: false (1つのボタンに状態が紐づくため)
    // - プラグインボタン (plugin:<id>) は duplicatable: false 扱い (1配置のみ)
    // - needsBookshelf: メインビューでは disabled 表示
    // - required: 取り外せない (open-settings のみ)
    // Phase C: ヘッダーは brand + ⌘K + 設定 に最小化。view-toggle/search/filter は
    // 本棚ツールバー(Phase E)へ、back-to-main/bookshelf-selector/manage/overview は ⌘K へ移設。
    // 下記はカスタマイザで「任意に再配置できる」候補。required は open-settings のみ。
    static HEADER_ITEMS_META = {
        // back-to-main / bookshelf-selector は 3 ペイン化でサイドバーツリーと完全重複のため撤去 (2026-06-07)。
        // overview-display は no-op の renderBookshelfOverview を呼ぶだけで機能しないため撤去 (2026-06-07)。
        'manage-bookshelves':  { label: '本棚管理',     defaultIcon: 'pen-line',          emoji: '', duplicatable: false },
        'open-settings':       { label: '設定',         defaultIcon: 'settings',          emoji: '', duplicatable: false, required: true }
    };
    static HEADER_LAYOUT_STORAGE_KEY = 'headerLayoutV8';

    _defaultHeaderLayout() {
        // Phase C2: コンテナはサイドバー下部ユーティリティへ移設。
        // 既定は 本棚管理 / 設定。有効プラグインの UI ボタンは _currentHeaderLayout で自動追加。
        return {
            items: [
                { id: this._newPlacementId(), key: 'manage-bookshelves' },
                { id: this._newPlacementId(), key: 'open-settings' }
            ]
        };
    }

    _newPlacementId() {
        return 'p_' + Math.random().toString(36).slice(2, 10);
    }

    _loadHeaderLayout() {
        try {
            const raw = localStorage.getItem(VirtualBookshelf.HEADER_LAYOUT_STORAGE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (!p || !Array.isArray(p.items)) return null;
            return {
                items: p.items
                    .filter(it => it && typeof it.key === 'string')
                    .map(it => ({ id: it.id || this._newPlacementId(), key: it.key }))
            };
        } catch (_) { return null; }
    }

    _saveHeaderLayout(layout) {
        try {
            localStorage.setItem(VirtualBookshelf.HEADER_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
        } catch (_) {}
    }

    /**
     * 利用可能なヘッダー項目一覧 (静的 + プラグイン)
     */
    _enumerateHeaderItems() {
        const meta = VirtualBookshelf.HEADER_ITEMS_META;
        const list = Object.keys(meta).map(key => ({
            key,
            label: meta[key].label,
            emoji: meta[key].emoji || '',
            required: !!meta[key].required,
            duplicatable: !!meta[key].duplicatable,
            needsBookshelf: !!meta[key].needsBookshelf,
            isPlugin: false
        }));
        if (this.pluginAPI && Array.isArray(this.pluginAPI._uiButtons)) {
            for (const btn of this.pluginAPI._uiButtons) {
                list.push({
                    key: `plugin:${btn.id}`,
                    label: btn.label,
                    emoji: btn.emoji || '🧩',
                    required: false,
                    duplicatable: false,
                    needsBookshelf: false,
                    isPlugin: true,
                    buttonId: btn.id
                });
            }
        }
        return list;
    }

    _getItemMeta(key) {
        if (key.startsWith('plugin:')) {
            return { duplicatable: false, required: false };
        }
        const m = VirtualBookshelf.HEADER_ITEMS_META[key];
        return m ? { duplicatable: !!m.duplicatable, required: !!m.required } : null;
    }

    /**
     * 現在のレイアウト (検証 + open-settings 自動補完)
     */
    // ===== プラグインボタンの表示/非表示 (有効のままアイコンだけ隠す) =====
    // settings.hiddenPluginButtons = [pluginId, ...]。プラグインは読み込んだまま (機能は有効)、
    // サイドバーの UI ボタンだけ描画しない。
    _isPluginButtonHidden(pluginId) {
        const arr = this.userData?.settings?.hiddenPluginButtons;
        return Array.isArray(arr) && arr.includes(pluginId);
    }

    async _setPluginButtonHidden(pluginId, hidden) {
        if (!this.userData.settings) this.userData.settings = {};
        const set = new Set(this.userData.settings.hiddenPluginButtons || []);
        if (hidden) set.add(pluginId); else set.delete(pluginId);
        this.userData.settings.hiddenPluginButtons = [...set];
        await this.saveUserData();
        this._applyHeaderLayout();
    }

    _currentHeaderLayout() {
        let layout = this._loadHeaderLayout();
        if (!layout) layout = this._defaultHeaderLayout();

        // 未知 key を除去
        const knownKeys = new Set(this._enumerateHeaderItems().map(i => i.key));
        layout.items = layout.items.filter(it => knownKeys.has(it.key));

        // 非 duplicatable の重複を除去 (古い stored 互換)
        const seenNonDup = new Set();
        layout.items = layout.items.filter(it => {
            const m = this._getItemMeta(it.key);
            if (m && !m.duplicatable) {
                if (seenNonDup.has(it.key)) return false;
                seenNonDup.add(it.key);
            }
            return true;
        });

        for (const it of layout.items) if (!it.id) it.id = this._newPlacementId();

        // 有効プラグインの UI ボタンを自動追加 (ヘッダーカスタマイザ廃止後は明示配置しないため)。
        // 既に配置済みのものは位置を保持、新規は末尾へ追加。
        if (this.pluginAPI && Array.isArray(this.pluginAPI._uiButtons)) {
            const placed = new Set(layout.items.map(it => it.key));
            for (const btn of this.pluginAPI._uiButtons) {
                const key = `plugin:${btn.id}`;
                if (placed.has(key)) continue;
                if (this._isPluginButtonHidden(btn.pluginId)) continue; // 非表示設定のプラグインは自動追加しない
                layout.items.push({ id: this._newPlacementId(), key });
            }
        }

        // required アイテム (open-settings) の存在保証
        for (const [key, meta] of Object.entries(VirtualBookshelf.HEADER_ITEMS_META)) {
            if (meta.required && !layout.items.some(it => it.key === key)) {
                layout.items.push({ id: this._newPlacementId(), key });
            }
        }
        // (旧仕様) 「設定」を常に末尾に強制していたが、D&D で動かしても戻ってしまい
        // 「設定だけ並び替えできない」状態になっていたため撤廃。設定も自由に並び替え可能。
        return layout;
    }

    /**
     * 起動時に静的アイテムの DOM テンプレートを記録 (元 DOM は除去)。
     * 全静的アイテムをテンプレ化することで、_applyHeaderLayout は常にクリーンビルドできる。
     */
    _initHeaderTemplates() {
        if (this._headerTemplates) return;
        this._headerTemplates = new Map();
        const staticKeys = Object.keys(VirtualBookshelf.HEADER_ITEMS_META);
        for (const key of staticKeys) {
            const el = document.querySelector(`[data-header-item="${key}"]:not(.plugin-button-item)`);
            if (!el) continue;
            this._headerTemplates.set(key, el);
            el.remove();
        }
    }

    /**
     * placement の DOM 要素を取得 (全アイテム non-duplicatable のためテンプレート実体を返す)。
     * 静的アイテム / プラグイン共通で、override があれば適用する。
     */
    _buildPlacementElement(item) {
        const { key, id: placementId } = item;
        if (key.startsWith('plugin:')) {
            const btnId = key.slice('plugin:'.length);
            const entry = this.pluginAPI?._uiButtons?.find(b => b.id === btnId);
            if (!entry) return null;
            if (this._isPluginButtonHidden(entry.pluginId)) return null; // 「アイコンを表示」OFF → 描画しない
            const span = document.createElement('span');
            span.className = 'header-item plugin-button-item';
            span.dataset.headerItem = key;
            span.dataset.placementId = placementId;
            span.setAttribute('draggable', 'true'); // サイドバーで D&D 並び替え
            const btn = document.createElement('button');
            btn.className = 'btn-icon-square plugin-ui-button';
            if (entry.active) btn.classList.add('is-on'); // ON/OFF 型ボタンの現在状態 (再描画後も復元)
            // pluginAPI 側に icon 適用を委譲 (override 優先, manifest.icon, emoji の順)
            if (typeof this.pluginAPI?._applyIconToButton === 'function') {
                this.pluginAPI._applyIconToButton(btn, entry);
            } else {
                btn.textContent = entry.emoji || '🧩';
            }
            btn.title = entry.title || entry.label;
            btn.addEventListener('click', () => {
                try { entry.onClick(); }
                catch (e) { console.error(`[plugin button "${entry.id}"]`, e); }
            });
            span.appendChild(btn);
            return span;
        }
        const meta = VirtualBookshelf.HEADER_ITEMS_META[key];
        if (!meta) return null;
        const tpl = this._headerTemplates?.get(key);
        if (!tpl) return null;
        tpl.dataset.placementId = placementId;
        tpl.setAttribute('draggable', 'true'); // サイドバーで D&D 並び替え
        // 静的アイテムにも override を適用
        {
            const override = this.getHeaderIconOverride(key);
            const btn = tpl.querySelector('button');
            if (btn) {
                if (override) {
                    btn.innerHTML = window.renderIcon(override, { size: 20 });
                    btn.dataset.iconValue = override;
                    // 後で applyIcons が data-icon を再 inject しないように属性を一旦消す
                    btn.removeAttribute('data-icon');
                } else {
                    // override 解除時: 元の data-icon を復元する必要がある (テンプレ DOM は同一実体なので)
                    if (btn.dataset.iconValue) {
                        delete btn.dataset.iconValue;
                    }
                    // 静的なデフォルトアイコンを HEADER_ITEMS_META から取り戻す
                    const defaultIcon = VirtualBookshelf.HEADER_ITEMS_META[key]?.defaultIcon;
                    if (defaultIcon) {
                        btn.setAttribute('data-icon', defaultIcon);
                        btn.innerHTML = '';
                    }
                }
            }
        }
        return tpl;
    }

    /**
     * ヘッダーレイアウトを DOM に適用 (linear flow)
     */
    _applyHeaderLayout() {
        if (!this._headerTemplates) this._initHeaderTemplates();
        const layout = this._currentHeaderLayout();
        // 正規化済みレイアウト (plugin ボタン自動追加・ID 補完済み) を永続化。
        // これで DOM の data-placement-id が安定し、サイドバー D&D 並び替えが一致する。
        this._saveHeaderLayout(layout);
        const header = document.getElementById('header-controls');
        if (!header) return;

        // ヘッダーから既存要素を全 detach (static は _headerTemplates に保持されているので OK)
        Array.from(header.querySelectorAll('[data-header-item]')).forEach(el => el.remove());

        // 順に追加
        for (const item of layout.items) {
            const el = this._buildPlacementElement(item);
            if (el) header.appendChild(el);
        }

        // clone された data-icon 要素に SVG を inject
        if (typeof window.applyIcons === 'function') window.applyIcons(header);

        // サイドバーユーティリティ上で直接 D&D 並び替え (ヘッダーカスタマイザ画面は廃止)
        this._bindSidebarUtilityDnD(header);
    }

    /**
     * サイドバー下部ユーティリティのボタンを D&D で並び替え。
     * 各 .header-item は data-placement-id を持つ。order は headerLayoutV8 に保存。
     */
    _bindSidebarUtilityDnD(host) {
        if (!host || host._utilityDnDBound) return;
        host._utilityDnDBound = true;
        const drag = { pid: null };

        const computeInsertIndex = (clientX, clientY) => {
            const items = Array.from(host.querySelectorAll('.header-item'));
            for (let i = 0; i < items.length; i++) {
                const r = items[i].getBoundingClientRect();
                if (clientY < r.top) return i;                       // この行より上
                if (clientY <= r.bottom && clientX < r.left + r.width / 2) return i; // 同じ行で左寄り
            }
            return items.length;
        };
        const showIndicator = (index) => {
            host.querySelectorAll('.hdr-utility-drop-indicator').forEach(el => el.remove());
            const items = Array.from(host.querySelectorAll('.header-item'));
            const ind = document.createElement('span');
            ind.className = 'hdr-utility-drop-indicator';
            if (index >= items.length) host.appendChild(ind);
            else host.insertBefore(ind, items[index]);
        };

        host.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.header-item');
            if (!item || !host.contains(item)) return;
            drag.pid = item.dataset.placementId || null;
            if (!drag.pid) return;
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag.pid); } catch (_) {} }
            item.classList.add('hdr-item-dragging');
        });
        host.addEventListener('dragend', () => {
            host.querySelectorAll('.hdr-item-dragging').forEach(el => el.classList.remove('hdr-item-dragging'));
            host.querySelectorAll('.hdr-utility-drop-indicator').forEach(el => el.remove());
            drag.pid = null;
        });
        host.addEventListener('dragover', (e) => {
            if (!drag.pid) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            showIndicator(computeInsertIndex(e.clientX, e.clientY));
        });
        host.addEventListener('drop', (e) => {
            if (!drag.pid) return;
            e.preventDefault();
            const idx = computeInsertIndex(e.clientX, e.clientY);
            host.querySelectorAll('.hdr-utility-drop-indicator').forEach(el => el.remove());
            this._reorderHeaderPlacement(drag.pid, idx);
        });
    }

    /**
     * プラグイン一覧セクションを描画 (#plugin-list-section)
     * 各プラグイン: 名前/version/desc + [有効] チェックボックス + 削除
     */
    static PLUGIN_ORDER_STORAGE_KEY = 'pluginOrderV1';
    // 検索対象 (タイトル + 説明) の最大文字数。長すぎる説明文の中だけマッチするのを避ける。
    static PLUGIN_SEARCH_NAME_LIMIT = 60;
    static PLUGIN_SEARCH_DESC_LIMIT = 140;

    _loadPluginOrder() {
        try {
            const raw = localStorage.getItem(VirtualBookshelf.PLUGIN_ORDER_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) { return []; }
    }

    _savePluginOrder(order) {
        try { localStorage.setItem(VirtualBookshelf.PLUGIN_ORDER_STORAGE_KEY, JSON.stringify(order)); } catch (_) {}
    }

    _applyPluginOrder(plugins) {
        const order = this._loadPluginOrder();
        const orderIdx = new Map(order.map((id, i) => [id, i]));
        return plugins.slice().sort((a, b) => {
            const ai = orderIdx.has(a.id) ? orderIdx.get(a.id) : Infinity;
            const bi = orderIdx.has(b.id) ? orderIdx.get(b.id) : Infinity;
            if (ai !== bi) return ai - bi;
            return (a.id || '').localeCompare(b.id || '');
        });
    }

    async _renderPluginListSection() {
        const host = document.getElementById('plugin-list-section');
        if (!host) return;

        let installedPlugins = [];
        if (this.pluginLoader && this._isSyncReady()) {
            try {
                installedPlugins = await this.pluginLoader.listInstalledPlugins({ refresh: true });
            } catch (e) {
                console.warn('[plugin-list] listInstalledPlugins failed:', e);
            }
        }
        const disabledSet = new Set(this.userData?.settings?.disabledPlugins || []);
        const loadedSet = new Set(this.pluginLoader?.loaded?.keys?.() || []);

        if (!this._isSyncReady()) {
            host.innerHTML = '<p style="color:#888;">先に「同期」で保存先（この端末のフォルダ または GitHub）を設定してください。</p>';
            return;
        }
        if (installedPlugins.length === 0) {
            host.innerHTML = '<p style="color:#888;">インストール済みのプラグインはありません。上の「GitHub からインストール」で追加できます。</p>';
            return;
        }

        // 保存された順序を適用
        installedPlugins = this._applyPluginOrder(installedPlugins);

        host.innerHTML = installedPlugins.map(({ id, manifest }) => {
            const m = manifest || {};
            const enabled = !disabledSet.has(id);
            const loaded = loadedSet.has(id);
            const icoBtn = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
            // 有効/無効はトグルスイッチで切替 (data-toggle-plugin を change で拾う)
            const toggle = `<label class="toggle-switch" title="${enabled ? 'クリックで無効化' : 'クリックで有効化'}">
                <input type="checkbox" class="plugin-toggle-input" data-toggle-plugin="${id}" ${enabled ? 'checked' : ''}>
                <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
            </label>`;
            const settingsBtn = `<button type="button" class="btn btn-small plugin-card-settings" data-settings-plugin="${id}" title="このプラグインの設定（アイコン変更等）">${icoBtn('settings')}設定</button>`;
            const uninstallBtn = `<button type="button" class="btn btn-small btn-icon-only btn-danger plugin-card-uninstall" data-uninstall-plugin="${id}" title="アンインストール">${icoBtn('trash-2')}</button>`;
            // 状態ラベル: 読み込み失敗 / 無効のみ表示。有効はトグル ON で自明なので出さない (情報量を減らす)
            let stateLabel = '';
            if (enabled && !loaded)  stateLabel = `<span class="plugin-state warn">${icoBtn('alert-triangle', 12)}読み込み失敗</span>`;
            else if (!enabled)       stateLabel = `<span class="plugin-state muted">${icoBtn('circle', 12)}無効</span>`;
            // 拡張点カテゴリ (無効でも表示: manifest 宣言 → 実行時推定 → キャッシュ)
            const cats = this._getPluginCategories(id, m, loaded);
            const catBadges = this._renderPluginCategoryBadges(cats);
            const nameForSearch = (m.name || id || '').slice(0, VirtualBookshelf.PLUGIN_SEARCH_NAME_LIMIT);
            const descForSearch = (m.description || '').slice(0, VirtualBookshelf.PLUGIN_SEARCH_DESC_LIMIT);
            const searchText = `${nameForSearch}${descForSearch}`.toLowerCase();
            // 検索文字列の HTML 属性用エスケープ
            const searchAttr = searchText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // アイコン (override 優先 → manifest.icon → 既定 puzzle)。常に chip 表示にして一覧を走査しやすく
            const currentIcon = this._getPluginIconOverride(id) || m.icon || '';
            const iconChip = `<span class="pcard-icon${enabled ? '' : ' is-off'}" data-icon-value="${(currentIcon || '').replace(/"/g, '&quot;')}"${currentIcon ? ` title="現在のアイコン: ${currentIcon}"` : ''}>${window.renderIcon(currentIcon || 'puzzle', { size: 18 })}</span>`;
            const publishableBadge = m.publishable
                ? `<span class="plugin-publishable-badge" title="公開エクスポート対象">${window.renderIcon('globe', { size: 12 })}</span>`
                : '';
            // 縦型カード: 1行目=アイコン+名前+メタ+トグル / 分類バッジ / 説明(2行省略) / 設定・削除
            return `
                <div class="plugin-card-v2 ${enabled ? '' : 'is-disabled'}" data-plugin-id="${id}" data-search-text="${searchAttr}" draggable="true">
                    <div class="pcard-head">
                        ${iconChip}
                        <div class="pcard-headtext">
                            <div class="pcard-name"><strong>${m.name || id}</strong>${publishableBadge}</div>
                            <div class="pcard-meta"><span class="pcard-version">v${m.version || '?'}</span>${stateLabel}</div>
                        </div>
                        <div class="pcard-toggle">${toggle}</div>
                    </div>
                    ${catBadges}
                    ${m.description ? `<div class="plugin-card-desc">${m.description}</div>` : ''}
                    <div class="plugin-card-actions">${settingsBtn}${uninstallBtn}</div>
                </div>
            `;
        }).join('');

        this._bindPluginListEvents();
        this._applyPluginSearchFilter();
    }

    // ===== マーケット (公式カタログ。ADR-040 Phase1) =====
    // ハブの公開レジストリ GET /plugins を読み、カード一覧 + ワンタップ導入 (SHA ピン) を出す。
    // 認証不要 (公開) なのでハブ未接続でも閲覧可。導入は同期先の接続が必要。
    async _renderMarketSection() {
        const host = document.getElementById('plugin-market-section');
        if (!host) return;
        const apiBase = (SyncConfigManager.load().hub?.apiBase) || 'https://hub.asayake.org';
        const icoBtn = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        host.innerHTML = '<p style="color:#888;">マーケットを読み込み中…</p>';
        let plugins = [];
        try {
            const res = await fetch(`${apiBase}/plugins`, { method: 'GET' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            plugins = Array.isArray(data.plugins) ? data.plugins : [];
        } catch (e) {
            host.innerHTML = `<p style="color:#888;">マーケットを読み込めませんでした（${this.escapeHtml(e.message)}）。 <button type="button" class="btn btn-small" id="market-retry">再試行</button></p>`;
            host.querySelector('#market-retry')?.addEventListener('click', () => this._renderMarketSection());
            return;
        }
        if (plugins.length === 0) {
            host.innerHTML = '<p style="color:#888;">公開中のプラグインはまだありません。</p>';
            return;
        }
        let installedIds = new Set();
        if (this.pluginLoader && this._isSyncReady()) {
            try { installedIds = new Set((await this.pluginLoader.listInstalledPlugins()).map(p => p.id)); } catch (_) {}
        }
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));
        host.innerHTML = plugins.map(p => {
            const installed = installedIds.has(p.id);
            const catBadges = this._renderPluginCategoryBadges(Array.isArray(p.categories) ? p.categories : []);
            const action = installed
                ? `<span class="plugin-state muted">${icoBtn('check', 12)}導入済み</span>`
                : `<button type="button" class="btn btn-small btn-primary market-install-btn" data-market-id="${esc(p.id)}">${icoBtn('download')}導入</button>`;
            return `
                <div class="plugin-card-v2" data-market-card="${esc(p.id)}">
                    <div class="pcard-head">
                        <span class="pcard-icon">${window.renderIcon(p.icon || 'puzzle', { size: 18 })}</span>
                        <div class="pcard-headtext">
                            <div class="pcard-name"><strong>${esc(p.name || p.id)}</strong></div>
                            ${p.author ? `<div class="pcard-meta"><span class="pcard-version">${esc(p.author)}</span></div>` : ''}
                        </div>
                    </div>
                    ${catBadges}
                    ${p.description ? `<div class="plugin-card-desc">${esc(p.description)}</div>` : ''}
                    <div class="plugin-card-actions">${action}</div>
                </div>`;
        }).join('');
        host.querySelectorAll('.market-install-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.marketId;
                const entry = plugins.find(p => p.id === id);
                if (!entry) return;
                if (!this._isSyncReady()) { toast('先に「同期」で保存先を接続してください'); return; }
                btn.disabled = true;
                btn.innerHTML = `${icoBtn('loader')}導入中…`;
                try {
                    // SHA ピンで取得 (検証コード = 取得コード)。skipConfirm: マーケットの「導入」が確認の代わり
                    const m = await this.pluginLoader.installFromGitHub(entry.repoUrl, { sha: entry.sha, path: entry.path, skipConfirm: true });
                    if (m) {
                        toast(`「${entry.name || id}」を導入しました`);
                        await this._renderPluginListSection();
                        await this._renderMarketSection();
                    } else {
                        btn.disabled = false;
                        btn.innerHTML = `${icoBtn('download')}導入`;
                    }
                } catch (e) {
                    toast(`導入に失敗: ${e.message}`);
                    btn.disabled = false;
                    btn.innerHTML = `${icoBtn('download')}導入`;
                }
            });
        });
    }

    /** 拡張点カテゴリ → 表示メタ (バッジ + 説明)。一般ユーザ向けに「何をする種類か」を説明。 */
    _pluginCategoryMeta() {
        return {
            command:  { label: 'コマンド',     icon: 'terminal',          desc: 'コマンドパレット（⌘K / Ctrl+K）から呼び出せる操作を追加します。' },
            widget:   { label: 'ウィジェット', icon: 'layout-dashboard',  desc: 'ホーム画面に置けるカード（パネル）を追加します。' },
            detail:   { label: '本の詳細',     icon: 'panel-right',       desc: '本を開いたときの詳細パネルに情報や項目を追加します。' },
            view:     { label: '表示',         icon: 'layout-grid',       desc: '本棚の見せ方（一覧の表示方法）を追加・変更します。' },
            theme:    { label: '見た目',       icon: 'palette',           desc: 'アプリ全体の配色やデザイン（テーマ）を変えます。' },
            button:   { label: 'ボタン',       icon: 'mouse-pointer-click', desc: 'サイドバーにワンタッチで使えるボタンを追加します。' },
            filter:   { label: '絞り込み',     icon: 'filter',            desc: '本の並び替え・絞り込みの条件を追加します。' },
            export:   { label: '書き出し',     icon: 'download',          desc: '蔵書データを別の形式で書き出します。' },
            settings: { label: '設定',         icon: 'sliders-horizontal', desc: 'このプラグイン専用の設定項目を持ちます。' }
        };
    }

    /** 分類マークの凡例 (設定 → プラグインの「?」) を描画 */
    _renderPluginCategoryLegend() {
        const host = document.getElementById('plugin-cat-legend');
        if (!host) return;
        const meta = this._pluginCategoryMeta();
        host.innerHTML = `
            <p class="plugin-cat-legend-intro">プラグインは下のような「分類」マークでどんな機能を足すか示します。1 つのプラグインが複数の分類を持つこともあります。</p>
            <ul class="plugin-cat-legend-list">
            ${Object.values(meta).map(m => `
                <li>
                    <span class="plugin-cat-badge">${window.renderIcon(m.icon, { size: 11 })}${this.escapeHtml(m.label)}</span>
                    <span class="plugin-cat-legend-desc">${this.escapeHtml(m.desc)}</span>
                </li>`).join('')}
            </ul>`;
    }

    _renderPluginCategoryBadges(cats) {
        if (!Array.isArray(cats) || !cats.length) return '';
        const meta = this._pluginCategoryMeta();
        const badges = cats.map(c => {
            const m = meta[c] || { label: c, icon: 'puzzle', desc: '' };
            const tip = m.desc ? `${m.label}: ${m.desc}` : m.label;
            return `<span class="plugin-cat-badge" title="${this.escapeHtml(tip)}">${window.renderIcon(m.icon, { size: 11 })}${this.escapeHtml(m.label)}</span>`;
        }).join('');
        return `<div class="plugin-card-cats">${badges}</div>`;
    }

    // ===== プラグイン分類キャッシュ (無効でも分類バッジを出すため、ロード時の推定を保存) =====
    static PLUGIN_CONTRIB_CACHE_KEY = 'pluginContribCacheV1';

    _loadPluginContribCache() {
        try { return JSON.parse(localStorage.getItem(VirtualBookshelf.PLUGIN_CONTRIB_CACHE_KEY)) || {}; }
        catch (_) { return {}; }
    }
    _setPluginContribCache(id, cats) {
        try {
            const cache = this._loadPluginContribCache();
            cache[id] = cats;
            localStorage.setItem(VirtualBookshelf.PLUGIN_CONTRIB_CACHE_KEY, JSON.stringify(cache));
        } catch (_) {}
    }

    /**
     * プラグインの分類 (categories) を解決。無効状態でも極力表示できるよう多段で求める。
     *  1) manifest.categories (宣言) — 無効でも常に出せる
     *  2) ロード中なら実行時の登録内容から推定 (+キャッシュに保存)
     *  3) 過去にロードしたときのキャッシュ — 今は無効でも出せる
     */
    _getPluginCategories(id, manifest, loaded) {
        if (Array.isArray(manifest?.categories) && manifest.categories.length) {
            this._setPluginContribCache(id, manifest.categories);
            return manifest.categories;
        }
        if (loaded) {
            const c = this.pluginAPI.getPluginContributions(id) || [];
            if (c.length) { this._setPluginContribCache(id, c); return c; }
        }
        const cached = this._loadPluginContribCache()[id];
        return Array.isArray(cached) ? cached : [];
    }

    /** プラグインの manifest を取得 (loaded でも disabled でも) */
    _getPluginManifest(id) {
        const loaded = this.pluginLoader?.getManifest?.(id);
        if (loaded) return loaded;
        const rec = (this.pluginLoader?._installed || []).find(p => p.id === id);
        return (rec && rec.manifest) || {};
    }

    /** プラグインごとの設定モーダルを開く (アイコン変更・有効切替・プラグイン固有設定を集約) */
    _openPluginSettings(id) {
        const manifest = this._getPluginManifest(id);
        const loaded = !!this.pluginLoader?.loaded?.has(id);
        const enabled = !new Set(this.userData?.settings?.disabledPlugins || []).has(id);
        const ico = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        const overrideKey = `plugin:${id}`;

        let modal = document.getElementById('plugin-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'plugin-settings-modal';
            modal.className = 'plugin-settings-modal';
            modal.innerHTML = `
                <div class="psm-backdrop"></div>
                <div class="psm-panel" role="dialog" aria-modal="true">
                    <div class="psm-head">
                        <span class="psm-head-icon"></span>
                        <div class="psm-head-text">
                            <h3 class="psm-title"></h3>
                            <div class="psm-head-sub"></div>
                        </div>
                        <button type="button" class="psm-close" title="閉じる"></button>
                    </div>
                    <div class="psm-body"></div>
                </div>`;
            document.body.appendChild(modal);
            const close = () => modal.classList.remove('show');
            modal.querySelector('.psm-backdrop').addEventListener('click', close);
            modal.querySelector('.psm-close').addEventListener('click', close);
            this._pluginSettingsModalClose = close;
        }
        modal.querySelector('.psm-close').innerHTML = window.renderIcon('x', { size: 18 });

        const cats = this._getPluginCategories(id, manifest, loaded);
        // このプラグインがサイドバーに UI ボタンを持つか (持つ場合のみ「アイコンを表示」トグルを出す)
        const hasButton = !!this.pluginAPI?._uiButtons?.some(b => b.pluginId === id);
        const iconShown = !this._isPluginButtonHidden(id);

        const currentIcon = this.getHeaderIconOverride(overrideKey) || manifest.icon || '';

        // ヘッダー: アイコン + 名前 + (version, カテゴリバッジ)
        const headIcon = modal.querySelector('.psm-head-icon');
        headIcon.className = `psm-head-icon ${enabled ? '' : 'is-off'}`;
        headIcon.innerHTML = currentIcon
            ? window.renderIcon(currentIcon, { size: 22 })
            : window.renderIcon('puzzle', { size: 22 });
        modal.querySelector('.psm-title').textContent = manifest.name || id;
        modal.querySelector('.psm-head-sub').innerHTML =
            `<span class="psm-version">v${this.escapeHtml(manifest.version || '?')}</span>${this._renderPluginCategoryBadges(cats)}`;

        const stateClass = enabled ? (loaded ? 'ok' : 'warn') : 'muted';
        const stateText  = enabled ? (loaded ? '有効' : '読み込み失敗') : '無効';

        const body = modal.querySelector('.psm-body');
        body.innerHTML = `
            ${manifest.description ? `<p class="psm-desc">${this.escapeHtml(manifest.description)}</p>` : ''}

            <div class="psm-enable-card ${enabled ? 'is-on' : 'is-off'}">
                <div class="psm-enable-text">
                    <div class="psm-enable-title">プラグインを有効にする</div>
                    <div class="psm-enable-state ${stateClass}">${ico(enabled ? (loaded ? 'circle-check' : 'alert-triangle') : 'circle', 12)}${stateText}</div>
                </div>
                <label class="toggle-switch toggle-switch-lg" title="${enabled ? 'クリックで無効化' : 'クリックで有効化'}">
                    <input type="checkbox" class="psm-toggle-input" ${enabled ? 'checked' : ''}>
                    <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
                </label>
            </div>

            <div class="psm-section">
                <div class="psm-section-title">外観</div>
                <div class="psm-field">
                    <div class="psm-field-main">
                        <span class="psm-field-label">アイコン</span>
                        <span class="psm-field-hint">ヘッダーボタン・一覧で使われます</span>
                    </div>
                    <span class="psm-icon-preview ${currentIcon ? '' : 'psm-icon-none'}" ${currentIcon ? `data-icon-value="${currentIcon.replace(/"/g, '&quot;')}"` : ''}>${window.renderIcon(currentIcon || 'puzzle', { size: 20 })}</span>
                    <button type="button" class="btn btn-small psm-icon-change">${ico('palette')}変更</button>
                    <button type="button" class="btn btn-small btn-secondary psm-icon-reset">既定</button>
                </div>
                ${hasButton ? `
                <div class="psm-field">
                    <div class="psm-field-main">
                        <span class="psm-field-label">サイドバーにアイコンを表示</span>
                        <span class="psm-field-hint">OFF にしてもプラグインの機能は有効のままです</span>
                    </div>
                    <label class="toggle-switch" title="${iconShown ? 'クリックで非表示' : 'クリックで表示'}">
                        <input type="checkbox" class="psm-show-icon-input" ${iconShown ? 'checked' : ''}>
                        <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
                    </label>
                </div>` : ''}
            </div>

            <div class="psm-section">
                <div class="psm-section-title">プラグイン設定</div>
                <div id="psm-plugin-custom"></div>
            </div>`;

        // アイコン変更
        body.querySelector('.psm-icon-change').addEventListener('click', async () => {
            const picked = await this.openIconPicker({
                title: `プラグイン「${manifest.name || id}」のアイコン`,
                current: this.getHeaderIconOverride(overrideKey) || manifest.icon || ''
            });
            if (picked === null) return;
            this.setHeaderIconOverride(overrideKey, picked || null);
            this._openPluginSettings(id);            // モーダル再描画
            this._renderPluginListSection();         // 一覧のプレビューも更新
            this._applyHeaderLayout();
        });
        body.querySelector('.psm-icon-reset').addEventListener('click', () => {
            this.setHeaderIconOverride(overrideKey, null);
            this._openPluginSettings(id);
            this._renderPluginListSection();
            this._applyHeaderLayout();
        });

        // 「サイドバーにアイコンを表示」トグル (有効のままアイコンだけ隠す)
        const showIconInput = body.querySelector('.psm-show-icon-input');
        if (showIconInput) {
            showIconInput.addEventListener('change', async (e) => {
                await this._setPluginButtonHidden(id, !e.target.checked);
                this._openPluginSettings(id);    // 状態を反映して再描画
            });
        }

        // 有効/無効トグル (スイッチ)
        body.querySelector('.psm-toggle-input').addEventListener('change', async (e) => {
            const next = e.target.checked;
            try {
                await this.togglePlugin(id, next);
                await this._renderPluginListSection();
                this._applyHeaderLayout();
                this._openPluginSettings(id);        // 状態を反映して再描画
            } catch (err) {
                toast((next ? '有効化' : '無効化') + '失敗: ' + err.message);
                this._openPluginSettings(id);
            }
        });

        // プラグイン固有設定 (有効 + registerSettings 済みのみ)
        const host = body.querySelector('#psm-plugin-custom');
        const renderer = loaded ? this.pluginAPI.getPluginSettingsRenderer(id) : null;
        if (renderer) {
            try { renderer(host, this.pluginAPI.forPlugin(id)); }
            catch (e) { host.innerHTML = `<p class="psm-muted">設定の描画に失敗: ${this.escapeHtml(e.message || String(e))}</p>`; }
        } else {
            host.innerHTML = `<p class="psm-muted">このプラグイン固有の設定はありません${enabled ? '' : '（有効化すると表示される場合があります）'}。</p>`;
        }

        if (typeof window.applyIcons === 'function') window.applyIcons(body);
        modal.classList.add('show');
    }

    _applyPluginSearchFilter() {
        const input = document.getElementById('plugin-search');
        if (!input) return;
        const q = (input.value || '').toLowerCase().trim();
        const host = document.getElementById('plugin-list-section');
        if (!host) return;
        host.querySelectorAll('.plugin-card-v2').forEach(card => {
            if (!q) { card.style.display = ''; return; }
            // 検索範囲はカード textContent ではなく data-search-text (= タイトル+説明、各々文字数制限) のみ
            const text = card.dataset.searchText || '';
            card.style.display = text.includes(q) ? '' : 'none';
        });
    }

    /**
     * sourceId のプラグインを index 位置に挿入して順序を保存、再描画
     */
    async _reorderPluginByIndex(sourceId, index) {
        const host = document.getElementById('plugin-list-section');
        if (!host) return;
        const cards = Array.from(host.querySelectorAll('.plugin-card-v2'));
        const ids = cards.map(c => c.dataset.pluginId);
        const fromIdx = ids.indexOf(sourceId);
        if (fromIdx < 0) return;
        ids.splice(fromIdx, 1);
        const insertAt = Math.max(0, Math.min(index > fromIdx ? index - 1 : index, ids.length));
        ids.splice(insertAt, 0, sourceId);
        this._savePluginOrder(ids);
        await this._renderPluginListSection();
    }

    _bindPluginListEvents() {
        const host = document.getElementById('plugin-list-section');
        if (!host) return;
        if (this._pluginListAbort) {
            try { this._pluginListAbort.abort(); } catch (_) {}
        }
        this._pluginListAbort = new AbortController();
        const signal = this._pluginListAbort.signal;

        // 検索バー (host の外側)
        const searchInput = document.getElementById('plugin-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => this._applyPluginSearchFilter(), { signal });
        }

        // ===== D&D による並び替え (ヘッダー設定と同じく行間ハイライト) =====
        const dragState = { id: null };

        const computeInsertIndex = (clientY) => {
            const cards = Array.from(host.querySelectorAll('.plugin-card-v2'));
            for (let i = 0; i < cards.length; i++) {
                const r = cards[i].getBoundingClientRect();
                if (clientY < r.top + r.height / 2) return i;
            }
            return cards.length;
        };
        const showInsertIndicator = (index) => {
            host.querySelectorAll('.plugin-drop-indicator').forEach(el => el.remove());
            const cards = Array.from(host.querySelectorAll('.plugin-card-v2'));
            const indicator = document.createElement('div');
            indicator.className = 'plugin-drop-indicator';
            if (index >= cards.length) host.appendChild(indicator);
            else host.insertBefore(indicator, cards[index]);
        };

        host.addEventListener('dragstart', (e) => {
            // 操作系 (トグル/ボタン/入力) の上ではドラッグ開始しない (誤操作防止)
            if (e.target.closest('.plugin-card-actions, .pcard-toggle, label, button, input, select')) { e.preventDefault(); return; }
            const card = e.target.closest('.plugin-card-v2');
            if (!card) return;
            dragState.id = card.dataset.pluginId;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', dragState.id); } catch (_) {}
            }
            card.classList.add('is-dragging');
        }, { signal });

        host.addEventListener('dragend', () => {
            host.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
            host.querySelectorAll('.plugin-drop-indicator').forEach(el => el.remove());
            dragState.id = null;
        }, { signal });

        host.addEventListener('dragover', (e) => {
            if (!dragState.id) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            showInsertIndicator(computeInsertIndex(e.clientY));
        }, { signal });

        host.addEventListener('drop', (e) => {
            if (!dragState.id) return;
            e.preventDefault();
            const idx = computeInsertIndex(e.clientY);
            host.querySelectorAll('.plugin-drop-indicator').forEach(el => el.remove());
            this._reorderPluginByIndex(dragState.id, idx);
        }, { signal });

        // 有効/無効トグル (checkbox の change)
        host.addEventListener('change', (e) => {
            const toggle = e.target.closest('[data-toggle-plugin]');
            if (!toggle) return;
            const id = toggle.dataset.togglePlugin;
            const next = toggle.checked;
            (async () => {
                try {
                    await this.togglePlugin(id, next);
                    this._applyHeaderLayout();
                    await this._renderPluginListSection();
                } catch (err) {
                    toast((next ? '有効化' : '無効化') + '失敗: ' + err.message);
                    await this._renderPluginListSection();
                }
            })();
        }, { signal });

        host.addEventListener('click', (e) => {
            const uninstall = e.target.closest('[data-uninstall-plugin]');
            if (uninstall) {
                e.stopPropagation();
                const id = uninstall.dataset.uninstallPlugin;
                if (!confirm(`プラグイン "${id}" を削除しますか？同期フォルダから plugins/${id}/ も削除されます。`)) return;
                (async () => {
                    try {
                        await this.uninstallPluginById(id);
                        this._applyHeaderLayout();
                        await this._renderPluginListSection();
                    } catch (err) {
                        toast('アンインストール失敗: ' + err.message);
                    }
                })();
                return;
            }
            const settingsBtn = e.target.closest('[data-settings-plugin]');
            if (settingsBtn) {
                e.stopPropagation();
                this._openPluginSettings(settingsBtn.dataset.settingsPlugin);
                return;
            }
        }, { signal });
    }

    /** サイドバーユーティリティの D&D 並び替えで呼ばれる。placement を index へ移動して保存・再適用。 */
    _reorderHeaderPlacement(placementId, index) {
        const layout = this._currentHeaderLayout();
        const fromIdx = layout.items.findIndex(it => it.id === placementId);
        if (fromIdx < 0) return;
        const [item] = layout.items.splice(fromIdx, 1);
        const insertAt = Math.max(0, Math.min(index > fromIdx ? index - 1 : index, layout.items.length));
        layout.items.splice(insertAt, 0, item);
        this._saveHeaderLayout(layout);
        this._applyHeaderLayout();
    }

    _closeSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.remove('show');
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
        titleEl.textContent = title;
        if (descEl) {
            descEl.textContent = desc;
            descEl.style.display = desc ? '' : 'none';
        }
        this._refreshMarquees();
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

    /** マーキー対象 (1行で省略されがちな箇所) をまとめて再評価。 */
    _refreshMarquees() {
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
    }

    _updateStatusBar() {
        const bar = document.getElementById('app-status-bar');
        if (!bar) return;
        const ico = (n) => `<span class="status-ico">${window.renderIcon(n, { size: 15 })}</span>`;
        const rows = [];
        if (this._pwaUpdateReady) {
            rows.push(`<div class="status-row status-update">${ico('refresh-cw')}<span class="status-msg">新しいバージョンがあります</span><button class="status-btn" data-status-action="update" type="button">更新</button></div>`);
        }
        if (!this._isSyncReady()) {
            rows.push(`<div class="status-row status-warn">${ico('alert-triangle')}<span class="status-msg">同期先が未設定です。変更が保存されません。</span><button class="status-btn" data-status-action="open-sync" type="button">設定</button></div>`);
        } else if (this._syncError) {
            const msg = this._syncErrorMsg || '同期でエラーが発生しました。変更が保存できていない可能性があります。';
            rows.push(`<div class="status-row status-warn">${ico('alert-triangle')}<span class="status-msg">${this._escapeHtml ? this._escapeHtml(msg) : msg}</span><button class="status-btn" data-status-action="open-sync" type="button">確認</button></div>`);
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
        let startY = 0, active = false, dist = 0;
        const scroller = () => document.body.classList.contains('app-view-main')
            ? document.getElementById('view-main') : document.getElementById('view-bookshelf');

        pane.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1 || document.body.classList.contains('drawer-open')
                || document.body.classList.contains('book-detail-pinned')) { active = false; return; }
            const sc = scroller();
            if (sc && sc.scrollTop <= 0) { startY = e.touches[0].clientY; active = true; dist = 0; }
            else active = false;
        }, { passive: true });

        pane.addEventListener('touchmove', (e) => {
            if (!active) return;
            dist = e.touches[0].clientY - startY;
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
                this.showBookDetail(book, false);
            }
        } finally {
            this._suppressRouterUpdate = false;
        }
    }

    /**
     * 本詳細ペインの DOM をクリア（router の都合でナビゲーション無し）
     * PC v2: モーダルではなく右ペイン (#book-detail-pane) を placeholder に戻す
     */
    _closeBookModalDom() {
        const modal = document.getElementById('book-modal');
        if (modal) modal.classList.remove('show');
        const pane = document.getElementById('book-detail-pane');
        if (pane) {
            pane.innerHTML = `
                <div class="detail-placeholder">
                    <p></p>
                    <p>本を選択すると詳細が表示されます</p>
                </div>
            `;
        }
        // 詳細ピン留め解除 (ホームでは右ペインが消える)
        document.body.classList.remove('book-detail-pinned');
        // 旧 modal-body も互換のためクリア
        const oldBody = document.getElementById('modal-body');
        if (oldBody) oldBody.innerHTML = '';
    }

    showBookshelfManager() {
        const modal = document.getElementById('bookshelf-modal');
        modal.classList.add('show');
        this.renderBookshelfList();
    }

    closeBookshelfModal() {
        const modal = document.getElementById('bookshelf-modal');
        modal.classList.remove('show');
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
                <div class="bookshelf-item" data-id="${bookshelf.id}" data-internal-id="${bm._keyOf(bookshelf)}" data-special="${isSpecial ? '1' : '0'}" draggable="${!isSpecial}" style="margin-left:${depth * 1.5}rem;">
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
            .map(b => `<option value="${bm._keyOf(b)}">${this._escapeAttr ? this._escapeAttr(b.name) : b.name}</option>`)
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

        modal.classList.add('show');
        nameInput.focus();
    }

    closeBookshelfForm() {
        const modal = document.getElementById('bookshelf-form-modal');
        modal.classList.remove('show');
        this.currentEditingBookshelf = null;
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

            modal.classList.add('show');

            const cleanup = () => {
                modal.classList.remove('show');
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
            toast('🚫 「全ての本」から本を外すには「all から除外」ボタンを使ってください');
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

        if (!confirm(confirmMsg)) return;

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
                ...(b.updatedAsin ? { updatedAsin: b.updatedAsin } : {})
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
    // 公開などで設定が未完のとき、警告だけで終わらせず confirmDialog から設定の該当箇所へ誘導する。
    async _confirmOpenSettings(message, targetId) {
        const ok = await confirmDialog({ title: '設定が必要です', message, okLabel: '設定を開く', cancelLabel: '閉じる' });
        if (!ok) return;
        // 公開モーダルが開いていれば閉じてから設定を開く (モーダルの積み重なりを避ける)
        document.getElementById('publish-pages-modal')?.classList.remove('show');
        await this._openSettingsModal(targetId);
    }

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
            this._lastPublishUrl = result.siteUrl;
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

    // ページを公開する (published=true にして全公開中ページを push)。更新(republish)もここを通る
    async _ppPublishPage(id) {
        const page = this.publishPageStore.get(id);
        if (!page) return;
        // C2: 無料プランの公開では運営(Asayake)のアフィリエイトタグが付く旨を一度だけ明示・同意取得する。
        // 更新(再公開)も含め published=true にする操作の前で行う。Plus は自分のタグ/広告なしなので不要。
        if (!(await this._ensureFreeAffiliateConsent())) return;
        const wasPublished = !!page.published;   // 元の状態 (更新=true / 新規公開=false)
        try { await this.publishPageStore.update(id, { published: true }); }
        catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); return; }
        const r = await this._runPublishExport();
        if (!r.ok) {
            // 失敗時は「元の状態」へ戻す。更新(元 true=ライブ)を未公開化して次回公開で実サイトから
            // 消してしまう事故を防ぐ。新規公開(元 false)のみ未公開へロールバックする。
            try { await this.publishPageStore.update(id, { published: wasPublished }); } catch (_) {}
            this._renderPublishPagesList();
            return;
        }
        try { await this.publishPageStore.update(id, { lastBuiltAt: Date.now() }); } catch (_) {}
        const errSummary = r.result.errors.length > 0 ? `\n(注意 ${r.result.errors.length} 件)` : '';
        toast(`「${page.title}」を公開しました。\n公開 URL: ${r.result.siteUrl}${errSummary}`, { type: 'success' });
        this._renderPublishPagesList();
    }

    // C2: ハブ無料プランで初めて公開する時、運営アフィリエイトタグが付く旨を明示し同意を取る。
    // 同意は settings.ackFreeAffiliate に記録し、以後は出さない。Plus は不要(true を返す)。
    // 公開先=github (自前 GitHub Pages) は運営タグを入れないので同意不要(true)。
    async _ensureFreeAffiliateConsent() {
        const cfg = SyncConfigManager.load();
        const target = (cfg.publish || {}).target === 'hub' ? 'hub' : 'github';
        if (target !== 'hub') return true; // 自前サイトには運営タグを入れない
        const plan = (cfg.hub || {}).plan || 'free';
        if (plan === 'plus') return true;
        if (this.userData && this.userData.settings && this.userData.settings.ackFreeAffiliate) return true;
        const ok = await confirmDialog({
            title: '無料プランの公開について',
            message: '無料プランでは、公開ページの Amazon 商品リンクに運営（Asayake）のアフィリエイト ID が付き、その収益は運営に入ります。\n\n自分の収益にしたい、または広告を付けたくない場合は Plus プランをご利用ください。\n\n公開ページには「広告（アフィリエイト）を含む」旨が控えめに表示されます。',
            okLabel: '同意して公開', cancelLabel: 'やめる'
        });
        if (!ok) return false;
        try {
            if (!this.userData.settings) this.userData.settings = {};
            this.userData.settings.ackFreeAffiliate = true;
            await this.saveUserData();
        } catch (_) {}
        return true;
    }

    // ページの公開を取り消す (published=false にして再 push → 削除同期で実サイトから消える)
    async _ppUnpublishPage(id) {
        const page = this.publishPageStore.get(id);
        if (!page) return;
        const ok = await confirmDialog({
            title: '公開を取り消す',
            message: `「${page.title}」を公開サイトから削除します。\n(他の公開中ページはそのまま残ります)`,
            okLabel: '公開を取り消す', danger: true
        });
        if (!ok) return;
        try { await this.publishPageStore.update(id, { published: false }); }
        catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); return; }
        const r = await this._runPublishExport();
        if (!r.ok) {
            try { await this.publishPageStore.update(id, { published: true }); } catch (_) {}
            this._renderPublishPagesList();
            return;
        }
        toast(`「${page.title}」の公開を取り消しました。`, { type: 'success' });
        this._renderPublishPagesList();
    }

    // ===== 公開ページ管理 UI (P1 静的SSG, ADR-030) =====

    async openPublishPagesModal() {
        const modal = document.getElementById('publish-pages-modal');
        if (!modal) return;
        if (!this.publishPageStore) { toast('公開システムが未初期化です。リロードしてください。', { type: 'error' }); return; }
        this._setupPublishPagesUI();
        await this.publishPageStore.load();
        this._ppShowList();
        modal.classList.add('show');
        if (typeof window.applyIcons === 'function') window.applyIcons(modal);
    }

    _setupPublishPagesUI() {
        if (this._ppBound) return;
        this._ppBound = true;
        const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
        on('publish-pages-close', 'click', () => document.getElementById('publish-pages-modal').classList.remove('show'));
        on('pp-new', 'click', () => this._openPublishPageEditor(null));
        on('pp-back', 'click', () => this._ppShowList());
        on('pp-save', 'click', () => this._ppSave());
        on('pp-save-publish', 'click', () => this._ppSavePublish());
        on('pp-preview', 'click', () => this._ppPreview());
        on('pp-style', 'change', () => this._ppOnStyleChange());
        on('pp-book-search', 'input', (e) => this._ppRenderBookResults(e.target.value));
        // 一括更新: 公開中ページをまとめて再 push (一括「公開」ではない)
        on('pp-republish-all', 'click', () => this._ppRepublishAll());
        // 詳細設定: ページ操作 (複製/公開取消/削除 はエディタへ集約)。公開パスは自動採番 (UI なし)
        on('pp-dup', 'click', async () => { if (!this._ppEditingId) return; await this._ppDuplicate(this._ppEditingId); this._ppShowList(); });
        on('pp-unpublish', 'click', async () => { if (!this._ppEditingId) return; await this._ppUnpublishPage(this._ppEditingId); this._ppShowList(); });
        on('pp-del', 'click', async () => { if (!this._ppEditingId) return; const did = await this._ppDelete(this._ppEditingId); if (did) this._ppShowList(); });
        // プレビュー別画面
        on('pp-preview-close', 'click', () => this._ppClosePreviewModal());
        on('pp-preview-device', 'click', () => this._ppTogglePreviewDevice());
        const pm = document.getElementById('pp-preview-modal');
        if (pm) pm.addEventListener('click', (e) => { if (e.target === pm) this._ppClosePreviewModal(); });
    }

    _ppShowList() {
        document.getElementById('pp-list-view').hidden = false;
        document.getElementById('pp-edit-view').hidden = true;
        // C2: 無料プランのときだけ、運営アフィリエイトタグが付く旨の注記を出す
        const notice = document.getElementById('pp-free-notice');
        if (notice) {
            const plan = (SyncConfigManager.load().hub || {}).plan || 'free';
            notice.hidden = (plan === 'plus');
        }
        this._renderPublishPagesList();
    }
    _ppShowEditor() {
        document.getElementById('pp-list-view').hidden = true;
        document.getElementById('pp-edit-view').hidden = false;
    }

    _renderPublishPagesList() {
        const ul = document.getElementById('pp-list');
        if (!ul) return;
        const esc = PublishGenerator.esc;
        const pages = this.publishPageStore.pages();
        if (!pages.length) {
            ul.innerHTML = '<li class="pp-empty">まだ公開ページがありません。「新規作成」から作ってください。</li>';
        } else {
            ul.innerHTML = pages.map(p => {
                const style = this.publishStyles && this.publishStyles.get(p.styleId);
                const styleName = style ? style.name : '(スタイル未選択)';
                const cnt = (p.select.shelves.length ? `本棚${p.select.shelves.length}` : '') +
                    (p.select.books.length ? `${p.select.shelves.length ? ' / ' : ''}本${p.select.books.length}` : '');
                const pub = !!p.published;
                const badge = pub
                    ? '<span class="pp-status pp-status-on">● 公開中</span>'
                    : '<span class="pp-status pp-status-off">○ 未公開</span>';
                // 公開はページ単位 (ADR-030)。行はスッキリさせ、主操作だけ置く:
                //   未公開→[公開]  公開中→[更新]  ＋ 共通[編集]。
                //   複製/削除/公開取消 はエディタの「詳細設定」へ集約 (行のボタン過多を解消)
                const publishActions = pub
                    ? `<button class="btn btn-secondary btn-small" data-act="republish"><span class="h-icon" data-icon="refresh-cw" data-icon-size="13"></span>更新</button>`
                    : `<button class="btn btn-primary btn-small" data-act="publish"><span class="h-icon" data-icon="upload-cloud" data-icon-size="13"></span>公開</button>`;
                // 公開中ページは公開 URL を行に出す (開く + コピー)
                const url = pub ? this._ppPageUrl(p) : '';
                const urlRow = url
                    ? `<span class="pp-row-url"><a href="${esc(url)}" target="_blank" rel="noopener"><span class="h-icon" data-icon="external-link" data-icon-size="12"></span>${esc(url)}</a><button type="button" class="pp-url-copy" data-url="${esc(url)}" title="URL をコピー"><span class="h-icon" data-icon="clipboard" data-icon-size="12"></span></button></span>`
                    : '';
                return `<li class="pp-row" data-id="${esc(p.id)}">
                  <div class="pp-row-main">
                    <span class="pp-row-title">${esc(p.title)} ${badge}</span>
                    <span class="pp-row-meta">${esc(styleName)}${cnt ? ' ・ ' + esc(cnt) : ''}</span>
                    ${urlRow}
                  </div>
                  <div class="pp-row-actions">
                    ${publishActions}
                    <button class="btn btn-secondary btn-small" data-act="edit">編集</button>
                  </div>
                </li>`;
            }).join('');
            ul.querySelectorAll('.pp-row').forEach(row => {
                const id = row.dataset.id;
                const bind = (act, fn) => { const b = row.querySelector(`[data-act=${act}]`); if (b) b.addEventListener('click', fn); };
                bind('publish', () => this._ppPublishPage(id));
                bind('republish', () => this._ppPublishPage(id));
                bind('edit', () => this._openPublishPageEditor(id));
                const copyBtn = row.querySelector('.pp-url-copy');
                if (copyBtn) copyBtn.addEventListener('click', async () => {
                    try { await navigator.clipboard.writeText(copyBtn.dataset.url || ''); toast('公開 URL をコピーしました', { type: 'success' }); }
                    catch (_) { toast('コピーできませんでした', { type: 'warn' }); }
                });
            });
            if (typeof window.applyIcons === 'function') window.applyIcons(ul);
        }
        const urlEl = document.getElementById('pp-url');
        if (urlEl) urlEl.textContent = this._lastPublishUrl ? `公開URL: ${this._lastPublishUrl}` : '';
    }

    // 公開先の公開ベース URL (target=hub なら publicBase、github なら Pages URL)。未確定なら ''
    _ppPagePublicBase() {
        const cfg = SyncConfigManager.load();
        const pub = cfg.publish || {};
        if (pub.target === 'hub') {
            return (cfg.hub && cfg.hub.publicBase) || '';
        }
        const gh = cfg.github || {};
        const owner = pub.owner || gh.login || gh.owner || '';
        const repo = pub.repo || '';
        if (!owner || !repo) return '';
        const o = String(owner).toLowerCase();
        if (String(repo).toLowerCase() === `${o}.github.io`) return `https://${o}.github.io/`;
        return `https://${o}.github.io/${repo}/`;
    }

    // 公開ページ 1 つの公開 URL (ベース + slug/)。ベース未確定なら ''
    _ppPageUrl(p) {
        const base = this._ppPagePublicBase();
        if (!base || !p || !p.slug) return '';
        return `${base.replace(/\/?$/, '/')}${p.slug}/`;
    }

    _openPublishPageEditor(id) {
        this._ppEditingId = id;
        const page = id ? this.publishPageStore.get(id) : null;
        document.getElementById('pp-title').value = page ? page.title : '';
        document.getElementById('pp-intro').value = page ? page.intro : '';
        // 詳細設定: 既存ページのみページ操作を出す。公開取消は公開中のときだけ。新規はたたんでおく。
        const ops = document.getElementById('pp-page-ops'); if (ops) ops.hidden = !id;
        const unpub = document.getElementById('pp-unpublish'); if (unpub) unpub.hidden = !(page && page.published);
        const adv = document.getElementById('pp-advanced'); if (adv) adv.open = false;
        this._ppChosenBooks = new Set(page ? page.select.books : []);
        this._ppStyleParams = page ? { ...page.styleParams } : {};
        this._ppRenderStyleSelect(page ? page.styleId : '');
        this._ppRenderShelves(page ? page.select.shelves : []);
        this._ppRenderBookChosen();
        document.getElementById('pp-book-search').value = '';
        document.getElementById('pp-book-results').innerHTML = '';
        this._ppOnStyleChange();
        this._ppSetPreview('');
        this._ppShowEditor();
    }

    _ppRenderStyleSelect(selectedId) {
        const sel = document.getElementById('pp-style');
        const esc = PublishGenerator.esc;
        const styles = this.publishStyles ? this.publishStyles.list() : [];
        sel.innerHTML = '<option value="">— スタイルを選択 —</option>' +
            styles.map(s => `<option value="${esc(s.id)}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    }

    _ppOnStyleChange() {
        const sel = document.getElementById('pp-style');
        const style = this.publishStyles && this.publishStyles.get(sel.value);
        const desc = document.getElementById('pp-style-desc');
        const req = style ? style.declare().requires : { shelves: 'optional', books: 'optional' };
        desc.textContent = style ? style.description : 'スタイルを選ぶと設定項目が表示されます。';
        // スタイル未選択のうちは設定セクションを隠す（スタイル先行フロー）
        document.getElementById('pp-config').hidden = !style;
        document.getElementById('pp-shelves-group').hidden = (req.shelves === 'none');
        document.getElementById('pp-books-group').hidden = (req.books === 'none');
        this._ppRenderStyleParams(style);
    }

    _ppRenderStyleParams(style) {
        const host = document.getElementById('pp-style-params');
        const section = document.getElementById('pp-style-params-section');
        const esc = PublishGenerator.esc;
        const fields = (style && style.declare().fields) || [];
        if (!fields.length) { section.hidden = true; host.innerHTML = ''; return; }
        section.hidden = false;
        host.innerHTML = fields.map(fd => {
            const val = this._ppStyleParams[fd.key] != null ? this._ppStyleParams[fd.key] : (fd.default || '');
            const lbl = fd.label ? `<label class="pp-param-label">${esc(fd.label)}</label>` : '';
            if (fd.type === 'textarea') return `<div class="form-group">${lbl}<textarea data-param="${esc(fd.key)}" rows="2" placeholder="${esc(fd.placeholder || '')}">${esc(val)}</textarea></div>`;
            return `<div class="form-group">${lbl}<input data-param="${esc(fd.key)}" type="text" value="${esc(val)}" placeholder="${esc(fd.placeholder || '')}"></div>`;
        }).join('');
    }

    _ppRenderShelves(selectedIds) {
        const host = document.getElementById('pp-shelves');
        const set = new Set(selectedIds || []);
        const shelves = this.bookshelfManager.getBookshelves();
        // 本棚は**階層を保ったまま**選択させる (サイドバーのツリーと同じ親子・見た目)
        host.innerHTML = window.BookshelfUI.tree(shelves, { selectedSet: set });
        host.querySelectorAll('.bs-pick-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const on = btn.getAttribute('aria-pressed') !== 'true';
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.classList.toggle('is-selected', on);
            });
        });
        if (typeof window.applyIcons === 'function') window.applyIcons(host);
    }

    _ppRenderBookResults(query) {
        const host = document.getElementById('pp-book-results');
        const esc = PublishGenerator.esc;
        const q = (query || '').trim().toLowerCase();
        if (!q) { host.innerHTML = ''; return; }
        const matches = (this.books || []).filter(b =>
            (b.title && b.title.toLowerCase().includes(q)) || (b.authors && String(b.authors).toLowerCase().includes(q))
        ).slice(0, 20);
        host.innerHTML = matches.length
            ? matches.map(b => `<li data-asin="${esc(b.asin)}">${esc(b.title)} <span class="pp-bk-author">${esc(b.authors || '')}</span></li>`).join('')
            : '<li class="pp-empty">該当なし</li>';
        host.querySelectorAll('li[data-asin]').forEach(li => {
            li.addEventListener('click', () => { this._ppChosenBooks.add(li.dataset.asin); this._ppRenderBookChosen(); });
        });
    }

    _ppRenderBookChosen() {
        const host = document.getElementById('pp-book-chosen');
        const esc = PublishGenerator.esc;
        const byAsin = new Map((this.books || []).map(b => [b.asin, b]));
        host.innerHTML = [...this._ppChosenBooks].map(a => {
            const b = byAsin.get(a);
            return `<li data-asin="${esc(a)}"><span>${esc(b ? b.title : a)}</span><button type="button" class="pp-chip-x" title="外す">×</button></li>`;
        }).join('');
        host.querySelectorAll('li[data-asin]').forEach(li => {
            li.querySelector('.pp-chip-x').addEventListener('click', () => { this._ppChosenBooks.delete(li.dataset.asin); this._ppRenderBookChosen(); });
        });
    }

    _ppCollectForm() {
        const shelves = [...document.querySelectorAll('#pp-shelves .bs-pick-row[aria-pressed="true"]')].map(el => el.dataset.value);
        const params = {};
        document.querySelectorAll('#pp-style-params [data-param]').forEach(el => { params[el.dataset.param] = el.value; });
        // 公開項目はスタイル固定 (declare().shows)・公開パスは自動採番のため、ここでは集めない。
        return {
            title: document.getElementById('pp-title').value.trim() || '無題の公開ページ',
            intro: document.getElementById('pp-intro').value.trim(),
            styleId: document.getElementById('pp-style').value,
            styleParams: params,
            select: { shelves, books: [...this._ppChosenBooks] }
        };
    }

    // フォーム値の検証 (保存系で共通)。OK なら data、NG なら null
    _ppValidatedForm() {
        const data = this._ppCollectForm();
        if (!data.styleId) { toast('スタイルを選んでください。', { type: 'warn' }); return null; }
        if (data.select.shelves.length === 0 && data.select.books.length === 0) {
            toast('載せる本棚か本を 1 つ以上選んでください。', { type: 'warn' }); return null;
        }
        // 公開パス (slug) は data に含めない → create はタイトル由来で自動採番 / update は既存 slug を維持。
        return data;
    }

    // 保存して書き込み、ページ ID を返す (新規は作成して _ppEditingId を更新)
    async _ppPersistForm(data) {
        if (this._ppEditingId) { await this.publishPageStore.update(this._ppEditingId, data); return this._ppEditingId; }
        const p = await this.publishPageStore.create(data);
        this._ppEditingId = p.id;
        return p.id;
    }

    async _ppSave() {
        const data = this._ppValidatedForm();
        if (!data) return;
        try {
            await this._ppPersistForm(data);
            toast('公開ページを保存しました。', { type: 'success' });
            this._ppShowList();
        } catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); }
    }

    // 保存して公開: 保存 → published=true → push (エディタから 1 アクションで公開)
    async _ppSavePublish() {
        const data = this._ppValidatedForm();
        if (!data) return;
        let id;
        try { id = await this._ppPersistForm(data); }
        catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); return; }
        await this._ppPublishPage(id);  // published=true + export + toast (失敗時は published を戻す)
        this._ppShowList();
    }

    // 一括更新: 公開中ページをまとめて再 push (公開状態は変えない・一括「公開」ではない)
    async _ppRepublishAll() {
        const published = this.publishPageStore.pages().filter(p => p.published);
        if (!published.length) { toast('公開中のページがありません。各ページの「公開」または「保存して公開」で公開してください。', { type: 'warn' }); return; }
        const r = await this._runPublishExport();
        if (!r.ok) return;
        const errSummary = r.result.errors.length > 0 ? `\n(注意 ${r.result.errors.length} 件)` : '';
        toast(`公開中の ${r.result.published} ページを更新しました。\n公開 URL: ${r.result.siteUrl}${errSummary}`, { type: 'success' });
        this._renderPublishPagesList();
    }

    async _ppDelete(id) {
        const page = this.publishPageStore.get(id);
        const ok = await confirmDialog({ title: '公開ページを削除', message: `「${page ? page.title : ''}」を削除します。\n(次回の公開で実際のサイトからも消えます)`, okLabel: '削除', danger: true });
        if (!ok) return false;
        await this.publishPageStore.remove(id);
        this._renderPublishPagesList();
        return true;
    }

    async _ppDuplicate(id) {
        await this.publishPageStore.duplicate(id);
        this._renderPublishPagesList();
    }

    // プレビュー用の state をメモリ上のデータから組む (未保存編集も反映・未接続でも動く)
    _buildPreviewState() {
        const ud = this.userData || {};
        const shelves = ud.bookshelves || [];
        // メモリ上の本棚は internalId を持たないことがある → key = internalId || id(slug) に統一
        const metas = shelves.map(b => {
            const key = b.internalId || b.id;
            return {
                internalId: key, slug: b.id, name: b.name,
                description: b.description || '', isSpecial: !!b.isSpecial
            };
        });
        const allShelf = shelves.find(b => b.isSpecial);
        const bookshelfFiles = {};
        for (const b of shelves) {
            if (b.isSpecial) continue;
            const key = b.internalId || b.id;
            bookshelfFiles[key] = { books: b.books || [], notes: b.notes || {} };
        }
        return {
            library: { books: this.books || [] },
            bookshelvesMeta: { bookshelves: metas },
            allBookshelf: { books: (allShelf && allShelf.books) || [] },
            bookshelfFiles,
            notes: ud.notes || {},
            privateSettings: ud.settings || {}
        };
    }

    async _ppPreview() {
        const data = this._ppCollectForm();
        if (!data.styleId) { toast('スタイルを選んでください。', { type: 'warn' }); return; }
        if (data.select.shelves.length === 0 && data.select.books.length === 0) {
            toast('載せる本棚か本を 1 つ以上選んでください。', { type: 'warn' }); return;
        }
        this._ppSetPreview('<p style="padding:2rem;color:#888;font-family:sans-serif;text-align:center">生成中…</p>');
        this._ppOpenPreviewModal();
        // slug は固定 'preview' を後勝ちで（...data が slug を持つため順序が重要）。出力パスとルックアップを一致させる
        const tempPage = { ...data, id: '_preview', slug: 'preview' };
        try {
            const result = await this.publishGenerator.build([tempPage], { state: this._buildPreviewState() });
            const file = result.files.find(f => f.path === 'preview/index.html');
            if (file) this._ppSetPreview(file.content);
            else this._ppSetPreview(`<p style="padding:1rem;font-family:sans-serif;color:#a33">プレビューを生成できませんでした。${PublishGenerator.esc(result.errors[0] || '')}</p>`);
        } catch (e) {
            this._ppSetPreview(`<p style="padding:1rem;font-family:sans-serif;color:#a33">プレビュー失敗: ${PublishGenerator.esc(e.message)}</p>`);
        }
    }

    _ppSetPreview(html) {
        const frame = document.getElementById('pp-preview-frame');
        if (frame) frame.srcdoc = html || '<p style="padding:1rem;color:#888;font-family:sans-serif">「プレビュー」を押すと表示されます</p>';
    }

    _ppOpenPreviewModal() {
        const m = document.getElementById('pp-preview-modal');
        if (!m) return;
        // 開くたびに PC 幅へ初期化 (前回のモバイル幅トグルが残らないように)
        const btn = document.getElementById('pp-preview-device');
        const stage = m.querySelector('.pp-preview-stage');
        if (btn) { btn.dataset.mode = 'desktop'; btn.innerHTML = '<span class="h-icon" data-icon="smartphone" data-icon-size="14"></span>モバイル幅'; }
        if (stage) stage.classList.remove('pp-stage-mobile');
        m.classList.add('show');
        if (typeof window.applyIcons === 'function') window.applyIcons(m);
    }
    _ppClosePreviewModal() {
        const m = document.getElementById('pp-preview-modal');
        if (m) m.classList.remove('show');
    }
    _ppTogglePreviewDevice() {
        const btn = document.getElementById('pp-preview-device');
        const stage = document.querySelector('#pp-preview-modal .pp-preview-stage');
        if (!btn || !stage) return;
        const toMobile = btn.dataset.mode === 'desktop';
        btn.dataset.mode = toMobile ? 'mobile' : 'desktop';
        stage.classList.toggle('pp-stage-mobile', toMobile);
        const lbl = btn.querySelector('span:last-child') || btn;
        // ラベルとアイコンを切替（PC幅 ⇄ モバイル幅）
        btn.innerHTML = toMobile
            ? '<span class="h-icon" data-icon="monitor" data-icon-size="14"></span>PC 幅'
            : '<span class="h-icon" data-icon="smartphone" data-icon-size="14"></span>モバイル幅';
        if (typeof window.applyIcons === 'function') window.applyIcons(btn);
    }

    /**
     * 長文メモ books/<ASIN>__<title>.md を作成 / Obsidian で開く
     * 同期フォルダが vault 外の場合があるため、初回に vault 名・サブパスを設定で持つ
     */
    async openOrCreateBookMemo(asin) {
        if (!this._isSyncReady()) {
            toast('先に「同期」で保存先（この端末のフォルダ または GitHub）を設定してください。');
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
                if (confirm(`${created ? '詳細メモを作成しました' : '詳細メモ'}\n\n${fullPath}\n（パスをクリップボードにコピー済）\n\nObsidian vault "${vaultName}" で開きますか？`)) {
                    window.location.href = obsidianUrl;
                }
            } else {
                toast(`${folderName}/${fullPath}\n（パスをクリップボードにコピー済）\n\nvault 名が未設定です。設定 → 長文メモ から「アプリ内エディタ」に切り替えるか、再度この操作で設定してください。`);
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

    // アプリ内 Markdown エディタ (EasyMDE) でメモを開く
    async _openBookMemoInAppEditor(asin, book) {
        const modal = document.getElementById('book-memo-modal');
        const titleEl = document.getElementById('book-memo-modal-title');
        const textareaEl = document.getElementById('book-memo-textarea');
        const statusEl = document.getElementById('book-memo-status');
        if (!modal || !textareaEl) return;

        titleEl.textContent = book.title || asin;
        if (statusEl) statusEl.textContent = '読み込み中...';

        // 旧 EasyMDE インスタンスがあれば破棄
        if (this._bookMemoEditor) {
            try { this._bookMemoEditor.toTextArea(); } catch (_) {}
            this._bookMemoEditor = null;
        }

        let existing = null;
        try {
            existing = await this.storage.readBookMemo(asin, book.title);
        } catch (e) {
            console.warn('長文メモ読み込み失敗:', e);
        }
        if (existing == null) {
            existing = this.storage.buildBookMemoTemplate(book);
        }
        // frontmatter はアプリ内では見せない (ADR-024)。保存時に再結合するため保持
        const { frontmatter, body } = BookshelfStorage.splitFrontmatter(existing);
        this._bookMemoFrontmatter = frontmatter;
        textareaEl.value = body;

        modal.classList.add('show');

        if (typeof EasyMDE === 'undefined') {
            if (statusEl) statusEl.textContent = 'エディタライブラリが読み込まれていません (CDN 接続を確認)';
            return;
        }
        this._bookMemoEditor = new EasyMDE({
            element: textareaEl,
            autoDownloadFontAwesome: true,
            spellChecker: false,
            autosave: { enabled: false },
            status: ['lines', 'words'],
            toolbar: [
                'bold', 'italic', 'heading', '|',
                'unordered-list', 'ordered-list', 'quote', '|',
                'link', 'image', 'table', 'horizontal-rule', '|',
                'preview', 'side-by-side', 'fullscreen', '|',
                'guide'
            ]
        });
        this._bookMemoEditorContext = { asin, title: book.title };
        this._bookMemoInitial = body;   // 閉じる時の破棄確認用 (未保存の変更検出)
        if (statusEl) statusEl.textContent = '';
    }

    async saveBookMemoFromModal() {
        const ctx = this._bookMemoEditorContext;
        const editor = this._bookMemoEditor;
        const statusEl = document.getElementById('book-memo-status');
        if (!ctx || !editor) return;
        if (statusEl) statusEl.textContent = '保存中...';
        try {
            // body のみ編集させ、保持していた frontmatter (updated を自動更新) と再結合 (ADR-024)
            const content = BookshelfStorage.joinFrontmatter(this._bookMemoFrontmatter, editor.value());
            await this.storage.writeBookMemo(ctx.asin, ctx.title, content);
            if (!this.userData.notes[ctx.asin]) this.userData.notes[ctx.asin] = { memo: '', rating: 0 };
            this.userData.notes[ctx.asin].hasDetailMemo = true;
            await this.saveUserData();
            this._bookMemoInitial = editor.value();   // 保存済み = 破棄確認の基準を更新
            if (statusEl) {
                statusEl.textContent = '保存しました';
                setTimeout(() => { if (statusEl.textContent === '保存しました') statusEl.textContent = ''; }, 2500);
            }
        } catch (e) {
            console.error('長文メモ保存失敗:', e);
            if (statusEl) statusEl.textContent = `${e.message}`;
        }
    }

    async closeBookMemoModal() {
        // 未保存の変更があれば破棄確認 (このメモは明示保存・自動保存なしのため、黙って消さない)
        const editor = this._bookMemoEditor;
        if (editor && this._bookMemoInitial != null && editor.value() !== this._bookMemoInitial) {
            const ok = await confirmDialog({
                title: '長文メモを閉じる',
                message: '保存していない変更があります。破棄して閉じますか？',
                okLabel: '破棄して閉じる',
                cancelLabel: '編集に戻る',
                danger: true
            });
            if (!ok) return;
        }
        const modal = document.getElementById('book-memo-modal');
        if (modal) modal.classList.remove('show');
        if (this._bookMemoEditor) {
            try { this._bookMemoEditor.toTextArea(); } catch (_) {}
            this._bookMemoEditor = null;
        }
        this._bookMemoEditorContext = null;
        this._bookMemoFrontmatter = null;
        this._bookMemoInitial = null;
    }

    showExclusionsModal() {
        const modal = document.getElementById('exclusions-modal');
        if (!modal) return;
        modal.classList.add('show');
        this.renderExclusionsList();
    }

    closeExclusionsModal() {
        const modal = document.getElementById('exclusions-modal');
        if (modal) modal.classList.remove('show');
    }

    renderExclusionsList() {
        const listDiv = document.getElementById('exclusions-list');
        if (!listDiv) return;

        if (!this._isSyncReady()) {
            listDiv.innerHTML = '<p style="color: #888;">同期先 (ローカルフォルダ or GitHub) を接続すると除外一覧を管理できます。</p>';
            return;
        }

        const exclusions = (this.userData._storage && this.userData._storage.exclusions) || [];
        if (exclusions.length === 0) {
            listDiv.innerHTML = '<p style="color: #888;">除外中の本はありません。</p>';
            return;
        }

        const libraryBooks = (this.userData._storage && this.userData._storage.libraryBooks) || [];
        const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const items = exclusions.map(asin => {
            const book = libraryBooks.find(b => b.asin === asin) || {};
            const title = escapeHtml(book.title || asin);
            const authors = escapeHtml(book.authors || '');
            const image = book.productImage ? escapeHtml(book.productImage) : '';
            return `
                <div class="exclusion-item" style="display: flex; align-items: center; padding: 0.5rem; border-bottom: 1px solid #eee; gap: 1rem;">
                    ${image ? `<img src="${image}" alt="" style="width: 40px; height: 60px; object-fit: cover;">` : '<div style="width: 40px; height: 60px; background: #eee; display: flex; align-items: center; justify-content: center;"></div>'}
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: bold; overflow: hidden; text-overflow: ellipsis;">${title}</div>
                        <div style="color: #888; font-size: 0.85rem;">${authors}</div>
                        <div style="color: #aaa; font-size: 0.75rem;">${escapeHtml(asin)}</div>
                    </div>
                    <button class="btn btn-small btn-primary unexclude-btn" data-asin="${escapeHtml(asin)}">✓ 解除</button>
                </div>
            `;
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

        if (!confirm(confirmMessage)) {
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
        books.forEach((book, index) => {
            const isExisting = existingASINs.has(book.asin);
            const isExcluded = !isExisting && excludedASINs.has(book.asin);
            if (isExcluded) excludedCount++;
            // 既存・除外はどちらも取り込み不可 (チェックボックス無効)
            const isBlocked = isExisting || isExcluded;

            // フィルター適用: 取り込み済み/除外済みを非表示にする場合はスキップ
            if (hideExisting && isBlocked) {
                return;
            }

            visibleCount++;
            const stateClass = isExisting ? 'existing-book' : (isExcluded ? 'excluded-book' : '');
            const stateLabel = isExisting ? '(既にインポート済み)' : (isExcluded ? '(除外済み・取り込みません)' : '');
            const bookItem = document.createElement('div');
            bookItem.className = `book-selection-item ${stateClass}`;
            bookItem.dataset.bookIndex = index;
            bookItem.innerHTML = `
                <input type="checkbox" id="book-${index}" value="${index}" ${isBlocked ? 'disabled' : ''}>
                <div class="book-selection-info">
                    <div class="book-selection-title">${book.title} ${stateLabel}</div>
                    <div class="book-selection-author">${book.authors}</div>
                    <div class="book-selection-meta">${new Date(book.acquiredTime).toLocaleDateString('ja-JP')}</div>
                </div>
            `;
            bookList.appendChild(bookItem);
        });

        // 表示件数を更新
        this.updateBookListStats(books.length, visibleCount, existingASINs.size, excludedCount);
    }

    updateBookListStats(totalBooks, visibleBooks, existingBooks, excludedBooks = 0) {
        // 統計情報を表示する要素を追加/更新
        let statsElement = document.getElementById('book-list-stats');
        if (!statsElement) {
            statsElement = document.createElement('div');
            statsElement.id = 'book-list-stats';
            statsElement.style.cssText = 'margin-bottom: 1rem; padding: 0.5rem; background: #f8f9fa; border-radius: 4px; font-size: 0.9rem; color: #6c757d;';
            document.getElementById('book-list').parentNode.insertBefore(statsElement, document.getElementById('book-list'));
        }

        const newBooks = totalBooks - existingBooks - excludedBooks;
        const excludedPart = excludedBooks > 0 ? ` | 除外済み: ${excludedBooks}冊` : '';
        statsElement.innerHTML = `
            📊 総数: ${totalBooks}冊 | 新規: ${newBooks}冊 | インポート済み: ${existingBooks}冊${excludedPart} | 表示中: ${visibleBooks}冊
        `;
    }
    
    setupBookSelectionListeners() {
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
        
        const importButton = document.getElementById('import-selected-books');
        importButton.disabled = count === 0;
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

        if (selectedBooks.length === 0) {
            toast('インポートする本を選択してください');
            return;
        }

        try {
            const results = await this.bookManager.importSelectedBooks(selectedBooks);
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

            // 選択UIを非表示
            document.getElementById('book-selection').style.display = 'none';

        } catch (error) {
            console.error('選択インポートエラー:', error);
            toast(`インポートに失敗しました: ${error.message}`);
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

            // 変更後ASINの処理
            if (newUpdatedAsin) {
                updateData.updatedAsin = newUpdatedAsin;
                // 新しいASINで画像URLも更新 (URL 形式は getProductImageUrl が唯一の正)
                updateData.productImage = this.bookManager.getProductImageUrl({ asin: newUpdatedAsin });
            } else {
                // 変更後ASINが削除された場合、プロパティを削除
                updateData.updatedAsin = undefined;
                // 元のASIN（変更された可能性がある）で画像URLを復元
                updateData.productImage = this.bookManager.getProductImageUrl({ asin: newOriginalAsin });
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
        // 星評価とメモを移行
        if (this.userData.notes[oldAsin]) {
            this.userData.notes[newAsin] = this.userData.notes[oldAsin];
            delete this.userData.notes[oldAsin];
        }

        // 非表示設定を移行
        if (this.userData.hiddenBooks && this.userData.hiddenBooks.includes(oldAsin)) {
            const index = this.userData.hiddenBooks.indexOf(oldAsin);
            this.userData.hiddenBooks[index] = newAsin;
        }

        // 本棚情報を移行
        if (this.userData.bookshelves) {
            Object.values(this.userData.bookshelves).forEach(bookshelf => {
                if (bookshelf.books && bookshelf.books.includes(oldAsin)) {
                    const index = bookshelf.books.indexOf(oldAsin);
                    bookshelf.books[index] = newAsin;
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
     * Kindleインポートモーダルを表示
     */
    showImportModal() {
        const modal = document.getElementById('import-modal');
        modal.classList.add('show');
    }

    /**
     * Kindleインポートモーダルを閉じる
     */
    closeImportModal() {
        const modal = document.getElementById('import-modal');
        modal.classList.remove('show');
        // 結果表示をリセット
        const resultsDiv = document.getElementById('import-results');
        resultsDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
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
            toast('JSON として読み取れませんでした。ブックマークレットがコピーした内容をそのまま貼り付けてください。');
            return;
        }
        const books = Array.isArray(parsed) ? parsed
            : (Array.isArray(parsed.items) ? parsed.items
                : (Array.isArray(parsed.books) ? parsed.books : null));
        if (!books) { toast('取込データの形式が不正です (本の配列が見つかりません)。'); return; }
        if (books.length === 0) { toast('取込対象の本がありませんでした。'); return; }
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
            toast('クリップボードを読み取れませんでした。手動で貼り付けてから「貼り付けたデータを取込」を押してください。');
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
        const modal = document.getElementById('plugins-modal');
        modal.classList.add('show');
        document.getElementById('plugin-repo-url').value = '';
        await this._renderPluginsList();
    }

    closePluginsModal() {
        document.getElementById('plugins-modal').classList.remove('show');
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
            toast('先に「同期」で保存先（この端末のフォルダ または GitHub）を設定してください');
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
        if (!confirm(`プラグイン "${id}" を削除しますか？\n同期フォルダの plugins/${id}/ も削除されます。`)) return;
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
     * - 結果は window.opener.postMessage で bookshelf 側に返す
     * - opener が無い場合はクリップボードに JSON コピー（フォールバック）
     */
    _buildKindleBookmarkletCode() {
        const code = `(async()=>{try{var c=window.csrfToken;if(!c){alert('Amazon Kindle一覧ページ (digital-console/contentlist/booksAll) で実行してください');return;}var items=[],s=0,t=Number.MAX_SAFE_INTEGER;while(items.length<t){var p=JSON.stringify({contentType:"Ebook",contentCategoryReference:"booksAll",itemStatusList:["Active"],showSharedContent:true,fetchCriteria:{sortOrder:"DESCENDING",sortIndex:"DATE",startIndex:s,batchSize:100,totalContentCount:-1},surfaceType:"Desktop"});var r=await fetch("https://www.amazon.co.jp/hz/mycd/digital-console/ajax",{headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({activity:"GetContentOwnershipData",activityInput:p,csrfToken:c}),method:"POST",credentials:"include"});var j=await r.json();if(j.success===false)throw new Error(JSON.stringify(j.error));var d=j.GetContentOwnershipData;t=d.numberOfItems;s+=100;items.push.apply(items,d.items);}var pl=items.map(function(i){return{title:i.title,authors:i.authors,acquiredTime:i.acquiredTime,readStatus:i.readStatus,asin:i.asin,productImage:i.productImage};});if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'kindleBookshelfExport',ok:true,items:pl},'*');try{window.close();}catch(_){alert(''+pl.length+'冊を bookshelf に送信しました。このタブは閉じてください。');}}else{await navigator.clipboard.writeText(JSON.stringify(pl));alert(''+pl.length+'冊取得。クリップボードにコピーしました。bookshelf を「Amazon ライブラリページを開く」経由で開いているか確認してください。');}}catch(e){console.error(e);if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'kindleBookshelfExport',ok:false,error:e.message||String(e)},'*');}else{alert('失敗: '+(e.message||e));}}})();`;
        return 'javascript:' + encodeURIComponent(code);
    }

    async copyKindleBookmarklet() {
        const bm = this._buildKindleBookmarkletCode();
        try {
            await navigator.clipboard.writeText(bm);
            toast('ブックマークレットをクリップボードにコピーしました。\n\n手順:\n1. ブラウザのブックマークバーを右クリック → 「ページを追加」\n2. 名前を「Kindle取込」など\n3. URL 欄に Ctrl+V でペースト\n4. 保存\n\n以後はこのブックマークレットを Amazon ライブラリページで1クリックするだけで取込できます。');
        } catch (e) {
            // clipboard 失敗時は textarea で表示
            prompt('クリップボードに自動コピーできませんでした。以下を全選択 (Ctrl+A) → コピー (Ctrl+C) してブックマークの URL に貼り付けてください:', bm);
        }
    }

    openAmazonForBookmarklet() {
        if (this._kindleImportInFlight) {
            toast('既に取込中です。新しいタブの完了を待ってください。');
            return;
        }
        // URL に ?bookshelfImport=1 を付けると拡張 (kindle_bookshelf_exporter v0.9.5+) が
        // 自動 collect → postMessage → close を行う。拡張未インストールでも Amazon ページは
        // 普通に開かれるので、ユーザはブックマークレットを手動でクリックすればフォールバックできる。
        const url = 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/?bookshelfImport=1';
        const win = window.open(url, '_blank');
        if (!win) {
            toast('🚫 ポップアップがブロックされました。\nブラウザのポップアップを許可してから再試行してください。');
            return;
        }
        this._kindleImportInFlight = true;

        const allowedOrigins = new Set([
            'https://www.amazon.co.jp',
            ...((this.userData && this.userData.settings && this.userData.settings.extensionImportOrigins) || [])
        ]);

        let timer = null;
        const cleanup = () => {
            window.removeEventListener('message', handler);
            if (timer) clearTimeout(timer);
            this._kindleImportInFlight = false;
        };

        const handler = (event) => {
            if (!allowedOrigins.has(event.origin)) return;
            const data = event.data;
            if (!data || data.type !== 'kindleBookshelfExport') return;

            cleanup();

            if (!data.ok) {
                toast(`Kindle 取込に失敗しました: ${data.error || '不明なエラー'}`);
                return;
            }
            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) {
                toast('取込対象の本がありませんでした。');
                return;
            }

            this.showImportModal();
            this.showBookSelectionForImport(items, 'bookmarklet');
        };

        window.addEventListener('message', handler);

        // 拡張なら数秒〜数十秒で完了、ブックマークレット手動なら長め必要 → 15 分待機
        timer = setTimeout(() => {
            cleanup();
            toast('Kindle 取込タイムアウト（15分）。\n\n拡張 (kindle_bookshelf_exporter) インストール済みなら自動取込されるはずです。\nインストールしていない場合は Amazon ページでブックマークレットを手動クリックしてください。\nブックマークレット登録は「ブックマークレットをコピー」から行えます。');
        }, 15 * 60 * 1000);
    }

    /**
     * インポート結果を表示
     */
    showImportResults(results) {
        const resultsDiv = document.getElementById('import-results');
        resultsDiv.innerHTML = `
            <div class="import-summary">
                <h3>📊 インポート結果</h3>
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
                    インポートが完了しました。新規追加: ${results.added}冊、更新: ${results.updated}冊
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
        modal.classList.add('show');
    }

    /**
     * 手動追加モーダルを閉じる
     */
    closeAddBookModal() {
        const modal = document.getElementById('add-book-modal');
        modal.classList.remove('show');
        
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

        // カスタム順を適用
        if (this.userData.bookOrder && this.userData.bookOrder[bookshelf.id]) {
            const customOrder = this.userData.bookOrder[bookshelf.id];
            previewAsins.sort((a, b) => {
                const ai = customOrder.indexOf(a);
                const bi = customOrder.indexOf(b);
                if (ai === -1 && bi === -1) return 0;
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            });
        }

        const previewBooks = previewAsins.slice(0, 8);
        const previewHtml = previewBooks.map(asin => {
            const book = (this.books || []).find(b => b.asin === asin);
            if (book && book.productImage) {
                return `<div class="bookshelf-preview-book"><img src="${this.bookManager.getProductImageUrl(book)}" alt="${book.title}"></div>`;
            }
            return `<div class="bookshelf-preview-book bookshelf-preview-placeholder">${window.renderIcon('book-open', { size: 20 })}</div>`;
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
        this.saveUserData();
    }

    /**
     * 評価の星ウィジェット (クリックで編集) を返す。一覧カード・本詳細で共用。
     */
    _starWidgetHtml(asin, rating, size = 18) {
        return `<div class="star-rating" data-asin="${this.escapeHtml(asin)}" data-current-rating="${rating || 0}" data-star-size="${size}" title="クリックで評価">${this.generateStarRating(rating || 0, size)}</div>`;
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

    setupBookshelfDragAndDrop(container) {
        const clearDrop = () => container.querySelectorAll('.bookshelf-item').forEach(i => {
            i.classList.remove('bsm-drop-before', 'bsm-drop-after', 'bsm-drop-inside');
            delete i.dataset.dropZone;
        });

        container.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.bookshelf-item');
            if (!item || item.dataset.special === '1') return;
            this._modalDragKey = item.dataset.internalId;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', this._modalDragKey); } catch (_) {}
        });

        container.addEventListener('dragover', (e) => {
            const item = e.target.closest('.bookshelf-item');
            if (!this._modalDragKey || !item || item.dataset.internalId === this._modalDragKey) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // 左ペインツリーと同じ 3 ゾーン判定 (上=前 / 中=子にする / 下=後)
            const rect = item.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const isSpecial = item.dataset.special === '1';
            const zone = isSpecial ? 'inside'
                : (y < rect.height * 0.3 ? 'before' : (y > rect.height * 0.7 ? 'after' : 'inside'));
            clearDrop();
            item.classList.add(`bsm-drop-${zone}`);
            item.dataset.dropZone = zone;
        });

        container.addEventListener('dragleave', (e) => {
            const item = e.target.closest('.bookshelf-item');
            if (item && !item.contains(e.relatedTarget)) {
                item.classList.remove('bsm-drop-before', 'bsm-drop-after', 'bsm-drop-inside');
            }
        });

        container.addEventListener('drop', (e) => {
            const item = e.target.closest('.bookshelf-item');
            if (!this._modalDragKey || !item) { clearDrop(); return; }
            e.preventDefault();
            const targetKey = item.dataset.internalId;
            const zone = item.dataset.dropZone || 'inside';
            clearDrop();
            // 左ペインと同じ並び替え/親子整合ロジックを共用 (子は親に追従、reparent は確認ダイアログ)
            if (targetKey && targetKey !== this._modalDragKey) {
                this._onTreeDrop(this._modalDragKey, targetKey, zone);
            }
        });

        container.addEventListener('dragend', () => {
            container.querySelectorAll('.dragging').forEach(i => i.classList.remove('dragging'));
            clearDrop();
            this._modalDragKey = null;
        });
    }

}

// Lazy Loading for Images
class LazyLoader {
    constructor() {
        // 既に observe 済みの img を覚えておき、再スキャン時の二重 observe を避ける。
        // content-visibility:auto の画面外カードは交差しないので .lazy のまま残り、
        // observe() が呼ばれるたびに querySelectorAll に再ヒットするため必須。
        this._observed = new WeakSet();
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        this.observer.unobserve(img);
                        this._observed.delete(img);
                    }
                });
            },
            { rootMargin: '200px' }   // 画面手前で先読みしてスクロール時の表紙ポップインを抑える
        );
    }

    observe() {
        const imgs = document.querySelectorAll('img.lazy');
        for (const img of imgs) {
            if (this._observed.has(img)) continue;   // 二重 observe を防ぐ
            this._observed.add(img);
            this.observer.observe(img);
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