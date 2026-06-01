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
        // 公開モード判定: URL クエリ ?mode=public または body[data-public-mode="true"]
        const queryPublic = new URLSearchParams(window.location.search).get('mode') === 'public';
        const bodyPublic = document.body.dataset.publicMode === 'true';
        this.isPublicMode = queryPublic || bodyPublic;

        if (this.isPublicMode) {
            document.body.classList.add('public-mode');
        }

        // モバイル案内バナー（編集モード、かつ showDirectoryPicker 非対応端末で表示）
        if (!this.isPublicMode) {
            this._setupMobileBanner();
        }

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
                msg.innerHTML = '📱 <strong>iOS Safari</strong> でローカル vault を編集するには、無料の Safari 拡張「<strong>File Picker</strong>」が必要です。インストール後にこのページを再読み込みしてください。';
                actions.innerHTML = `
                    <a href="https://apps.apple.com/jp/app/file-picker/id1595132894" target="_blank" rel="noopener">📥 App Store で入手</a>
                    <a href="https://filepicker.app/" target="_blank" rel="noopener">ℹ️ 詳細</a>
                `;
            } else if (isAndroid) {
                msg.innerHTML = '📱 <strong>Android Chrome</strong> ではローカル vault に直接アクセスできません。<strong>Android アプリ版</strong>（Capacitor ラップ APK）のインストールが必要です。';
                actions.innerHTML = `
                    <a href="https://github.com/hahero-asayake/bookshelf/releases/latest" target="_blank" rel="noopener">📥 最新 APK をダウンロード</a>
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
            if (this.isPublicMode) {
                await this.loadDataPublicMode();
            } else {
                await this.loadData();
            }
            this.setupEventListeners();
            this._initHeaderTemplates();
            this._applyHeaderLayout();
            if (typeof window.applyIcons === 'function') window.applyIcons();
            this._renderStarFilterStars();
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


            // 同期は private モードのみ (LocalFS / GitHub / 将来 Drive・Dropbox)
            if (!this.isPublicMode) {
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
            }

            // 公開エクスポート先 handle の復元は廃止 (出力先は同期先 public/ に統合)

            // プラグイン読み込み（同期フォルダ接続済み + 設定読み込み済みのタイミング）
            if (this.pluginLoader) {
                try {
                    await this.pluginLoader.loadEnabledPlugins();
                } catch (e) {
                    console.warn('プラグイン読み込み中にエラー:', e);
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

    // 公開モード: data/ 配下を fetch で読み込み
    async loadDataPublicMode() {
        this.bookManager = new BookManager();

        const fetchJSON = async (path) => {
            const r = await fetch(path);
            if (!r.ok) throw new Error(`${path} の取得に失敗 (${r.status})`);
            return r.json();
        };

        // 公開モードのアプリは public/ 配下に index.html とデータが配置される想定。
        // fetch は同階層の相対パス (data/ プレフィックスは廃止)。
        const [main, settings, library, bookshelvesMeta, allBookshelf, notesFile] = await Promise.all([
            fetchJSON('main.json').catch(() => ({})),
            fetchJSON('settings.json').catch(() => ({})),
            fetchJSON('library.json').catch(() => ({ books: [] })),
            fetchJSON('bookshelves.json').catch(() => ({ bookshelves: [] })),
            fetchJSON('bookshelves/all.json').catch(() => null),
            fetchJSON('notes.json').catch(() => ({ notes: {} }))
        ]);

        const bookshelfFiles = {};
        for (const meta of (bookshelvesMeta.bookshelves || [])) {
            if (meta.isSpecial) continue;
            try {
                const data = await fetchJSON(`bookshelves/${meta.slug}.json`);
                bookshelfFiles[meta.internalId] = data;
            } catch (e) {
                console.warn(`本棚ファイル取得失敗: ${meta.slug}`, e);
            }
        }

        this._applyLoadedState({
            library,
            exclusions: { excludedASINs: [] },
            notes: notesFile.notes || {},
            bookshelvesMeta,
            allBookshelf: allBookshelf || { internalId: 'public-all', slug: 'all', name: 'すべての本', isSpecial: true, books: [] },
            bookshelfFiles,
            privateSettings: settings,
            privateMain: main
        });

        this.applyFilters();
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
        
        // ハイブリッド表示は使わない、代わりにcoversを使用
        if (this.currentView === 'hybrid') {
            this.currentView = 'covers';
        }
        
        // Load books per page setting
        if (this.userData.settings.booksPerPage) {
            if (this.userData.settings.booksPerPage === 'all') {
                this.booksPerPage = 999999;
            } else {
                this.booksPerPage = this.userData.settings.booksPerPage;
            }
            document.getElementById('books-per-page').value = this.userData.settings.booksPerPage;
        }
        this.showImagesInOverview = this.userData.settings.showImagesInOverview !== false; // Default true

        this.applyFilters();
    }

    setupEventListeners() {
        // View toggle (1ボタンでトグル)
        const viewToggleBtn = document.getElementById('view-toggle');
        if (viewToggleBtn) {
            viewToggleBtn.addEventListener('click', () => {
                this.setView(this.currentView === 'covers' ? 'list' : 'covers');
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

        // Star rating filters
        ['star-0', 'star-1', 'star-2', 'star-3', 'star-4', 'star-5'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.applyFilters());
        });

        // Sort
        document.getElementById('sort-order').addEventListener('change', (e) => {
            this.sortOrder = e.target.value;
            this.updateSortDirectionButton();
            this.applySorting();
        });

        document.getElementById('sort-direction').addEventListener('click', () => {
            this.toggleSortDirection();
        });

        // Books per page
        document.getElementById('books-per-page').addEventListener('change', (e) => {
            this.setBooksPerPage(e.target.value);
        });

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
                    case 'back-to-main':
                        if (this.router) this.router.navigateMain();
                        else this._setBodyView('main');
                        break;
                    case 'manage-bookshelves':
                        this.showBookshelfManager();
                        break;
                    case 'overview-display':
                        this.toggleBookshelfDisplay();
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

        // 公開する (旧 copyToPublic + runPublicExport の統合版)
        const publishBtn = document.getElementById('publish-to-public');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => this.publishToPublic());
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
        this.currentView = view;
        this._updateViewToggleButton();
        this.updateDisplay();
        this.saveUserData();
    }

    _updateViewToggleButton() {
        // 状態切替アイコン: covers/list それぞれを override 可能
        const buttons = document.querySelectorAll('[data-header-item="view-toggle"] button, #view-toggle');
        buttons.forEach(btn => {
            const stateKey = this.currentView === 'covers' ? 'view-toggle:covers' : 'view-toggle:list';
            const fallback = this.currentView === 'covers' ? 'image' : 'list';
            const override = this.getHeaderIconOverride(stateKey);
            const effectiveIcon = override || fallback;
            btn.innerHTML = window.renderIcon(effectiveIcon, { size: 20 });
            btn.dataset.iconValue = effectiveIcon;
            btn.removeAttribute('data-icon'); // 二重 inject 防止
            btn.title = this.currentView === 'covers' ? 'リスト表示に切替' : '表紙表示に切替';
        });
    }

    /**
     * ヘッダー全 popover の共通制御 (toggle / 外側クリック / Esc)
     * data-popover-toggle 属性を持つボタンと、それに対応する popover をペアで処理。
     */
    _setupPopovers() {
        const pairs = [
            { btnId: 'toggle-filter',           popId: 'filter-popover',     onOpen: null },
            { btnId: 'toggle-search',           popId: 'search-popover',     onOpen: () => {
                const input = document.getElementById('search-input');
                if (input) setTimeout(() => input.focus(), 0);
            }},
            { btnId: 'bookshelf-selector-btn',  popId: 'bookshelf-popover',  onOpen: () => this._renderBookshelfPopover() }
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

    _renderBookshelfPopover() {
        const host = document.getElementById('bookshelf-popover-list');
        if (!host) return;
        const all = (this.userData.bookshelves || []).find(bs => bs.isSpecial);
        const current = this.currentBookshelf || (all && all.id) || 'all';

        const items = [];
        if (all) items.push({ id: all.id, iconName: all.iconName || 'library', name: all.name || '全ての本' });
        for (const bs of (this.userData.bookshelves || [])) {
            if (bs.isSpecial) continue;
            items.push({ id: bs.id, iconName: bs.iconName || 'library', name: bs.name });
        }

        host.innerHTML = items.map(it => `
            <button type="button" class="bookshelf-popover-item ${it.id === current ? 'is-current' : ''}" data-bs-id="${it.id}">
                <span class="bs-popover-icon" data-icon-value="${(it.iconName || '').replace(/"/g,'&quot;')}">${window.renderIcon(it.iconName || 'library', { size: 16 })}</span>
                <span>${it.name}</span>
            </button>
        `).join('');

        host.querySelectorAll('[data-bs-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.bsId;
                this.switchBookshelf(id);
                const pop = document.getElementById('bookshelf-popover');
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
        return [
            { icon: 'home',              title: 'ホーム / 本棚一覧へ',            keywords: 'home ホーム main 戻る top', run: navMain },
            { icon: 'list',              title: '表紙 / リスト表示を切替',        keywords: 'view 表示 表紙 リスト cover list ひょうじ', run: () => this.setView(this.currentView === 'covers' ? 'list' : 'covers') },
            { icon: 'image',             title: '本棚一覧の画像 / テキスト表示を切替', keywords: 'overview 一覧 画像 テキスト display', run: () => this.toggleBookshelfDisplay() },
            { icon: 'pen-line',          title: '本棚を管理',                     keywords: '本棚 管理 manage bookshelf へんしゅう', run: () => this.showBookshelfManager() },
            { icon: 'plus',              title: '本棚を新規作成',                 keywords: '本棚 新規 作成 add new create', run: () => this.showBookshelfForm() },
            { icon: 'download',          title: 'Kindle インポート',             keywords: 'import kindle 取込 取り込み インポート', run: () => this.showImportModal() },
            { icon: 'plus',              title: '本を手動追加',                   keywords: '手動 追加 add book マニュアル', run: () => this.showAddBookModal() },
            { icon: 'ban',               title: '除外一覧を開く',                 keywords: '除外 exclusion じょがい', run: () => this.showExclusionsModal() },
            { icon: 'settings',          title: '設定を開く',                     keywords: 'settings 設定 config せってい', run: () => this._openSettingsModal() },
            { icon: 'panel-left',        title: '左サイドバーを開閉',             keywords: 'sidebar pane left ペイン 折りたたみ', run: () => this._togglePane('left') },
            { icon: 'panel-right',       title: '右の本詳細ペインを開閉',         keywords: 'detail pane right ペイン 折りたたみ', run: () => this._togglePane('right') },
        ];
    }

    _renderPaletteResults(query) {
        const results = document.getElementById('cmdk-results');
        if (!results) return;
        const q = (query || '').trim().toLowerCase();
        const items = [];

        const matches = (text) => !q || (text || '').toLowerCase().includes(q);

        // 1) コマンド
        for (const cmd of this._paletteCommands()) {
            if (matches(cmd.title) || matches(cmd.keywords)) {
                items.push({ group: 'コマンド', icon: cmd.icon, title: cmd.title, sub: '', run: cmd.run });
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

        // 3) 本 (query があるときのみ、上位 30 件)
        if (q) {
            let count = 0;
            for (const book of (this.books || [])) {
                if (count >= 30) break;
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
        if (!asins.length) { alert('📚 本を選択してください'); return; }
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
        alert(`✅ ${added} 冊を「${shelf.name}」に追加しました${ancMsg}`);
    }

    async _bulkExclude() {
        const asins = [...(this.selectedAsins || [])];
        if (!asins.length) { alert('📚 本を選択してください'); return; }
        if (!confirm(`🚫 選択した ${asins.length} 冊を all から除外しますか？\n\n再Kindle取込でも復活しません。除外一覧から解除できます。`)) return;
        asins.forEach(a => this._excludeAsinCore(a));
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
        this.books = this.bookManager.getAllBooks();
        await this.saveUserData();
        this._clearSelection();
        this.applyFilters();
        this.updateDisplay();
        this.updateStats();
        alert(`✅ ${asins.length} 冊を除外しました`);
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
            
            
            // Star rating filter
            const enabledRatings = [];
            for (let i = 0; i <= 5; i++) {
                if (document.getElementById(`star-${i}`).checked) {
                    enabledRatings.push(i);
                }
            }
            const bookRating = this.userData.notes[book.asin]?.rating || 0;
            if (!enabledRatings.includes(bookRating)) {
                return false;
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
        
        // プラグイン由来のフィルタを適用
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
    
    // フィルター popover の星評価チェックボックス: 星アイコンを Lucide で描画
    _renderStarFilterStars() {
        document.querySelectorAll('.star-filter-stars').forEach(el => {
            const count = Number(el.dataset.count) || 0;
            if (count === 0) {
                el.innerHTML = `${window.renderIcon('star', { size: 14, class: 'lucide-star is-empty' })}<span class="star-filter-label">未評価</span>`;
                return;
            }
            let html = '';
            for (let i = 0; i < count; i++) {
                html += window.renderIcon('star', { size: 14, class: 'lucide-star is-filled' });
            }
            for (let i = count; i < 5; i++) {
                html += window.renderIcon('star', { size: 14, class: 'lucide-star is-empty' });
            }
            el.innerHTML = html;
        });
    }

    updateSortDirectionButton() {
        const button = document.getElementById('sort-direction');
        const renderArrow = (dir) => window.renderIcon(dir === 'asc' ? 'arrow-up' : 'arrow-down', { size: 14 });

        if (this.sortOrder === 'custom') {
            button.innerHTML = `<span class="h-icon">${window.renderIcon('list-ordered', { size: 14 })}</span>カスタム順`;
            button.disabled = true;
            button.style.opacity = '0.5';
        } else {
            button.disabled = false;
            button.style.opacity = '1';
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
        bookshelf.className = `bookshelf view-${this.currentView} size-${coverSize}`;
        
        this.renderStandardView(bookshelf);
        
        this.setupPagination();
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
        
        // Handle pagination - 値を一度に取得して固定
        const booksPerPage = parseInt(this.booksPerPage) || 50;  // 安全な値として取得
        const currentPage = parseInt(this.currentPage) || 1;
        
        let booksToShow;
        if (booksPerPage >= this.filteredBooks.length) {
            // Show all books
            booksToShow = booksToRender;
        } else {
            // Show paginated books
            const startIndex = (currentPage - 1) * booksPerPage;
            const endIndex = startIndex + booksPerPage;
            booksToShow = booksToRender.slice(startIndex, endIndex);
        }
        
        booksToShow.forEach(book => {
            container.appendChild(this.createBookElement(book, this.currentView));
        });
    }

    createBookElement(book, displayType) {
        const bookElement = document.createElement('div');
        bookElement.className = 'book-item';
        bookElement.dataset.asin = book.asin;
        
        // Add drag-and-drop attributes
        bookElement.draggable = true;
        bookElement.setAttribute('data-book-asin', book.asin);
        
        const userNote = this.userData.notes[book.asin];
        // 一覧表示用メモ: 本棚 override → ALL の解決値を使う (Phase B-2)
        const listMemo = this.bookshelfManager.resolveMemo(book.asin, this._currentBookshelfInternalId());
        const listRating = userNote?.rating || 0;

        // 一覧カードの星・メモ表示は全体設定で制御。
        //  星: visibility (always/hover/hidden) + overlay (表紙に重ねる) boolean
        //  メモ: visibility (always/hover/hidden)
        //  hover は「表紙に重なるポップアップ」で表示し、行のスペースを取らず位置もずらさない。
        // リスト表示は表紙が小さいので overlay でも below 配置にフォールバック。
        const isCoverView = (displayType === 'cover' || displayType === 'covers');
        const starVis = this._getStarVisibility();
        const overlayOn = this._getStarOverlay() && isCoverView;
        let starSize;
        if (starVis === 'hover') starSize = 16;             // ホバーポップアップ
        else if (overlayOn) starSize = 18;                  // 常に表示 + 表紙に重ねる (大きめ)
        else starSize = isCoverView ? 15 : 16;              // 常に表示 + 独立
        const starWidget = (starVis === 'hidden') ? '' : this._starWidgetHtml(book.asin, listRating, starSize);
        const memoVis = this._getMemoVisibility();

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

        const placeholderHtml = isCoverView
            ? `<div class="book-cover-placeholder">${this.escapeHtml(book.title)}</div>`
            : `<div class="book-cover-placeholder">${window.renderIcon('book-open', { size: 24 })}</div>`;

        bookElement.classList.add('clickable');
        // 複数選択モード中は選択状態を維持
        if (this.selectMode && this.selectedAsins && this.selectedAsins.has(book.asin)) {
            bookElement.classList.add('selected');
        }
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
                    ${hoverPop}
                </div>
                <div class="book-info">
                    <div class="book-title">${this.escapeHtml(book.title)}</div>
                    <div class="book-author">${this.escapeHtml(book.authors)}</div>
                    ${belowAlwaysStars}
                    ${alwaysMemo}
                </div>
            `;
        
        // Add drag event listeners
        bookElement.addEventListener('dragstart', (e) => this.handleDragStart(e));
        bookElement.addEventListener('dragover', (e) => this.handleDragOver(e));
        bookElement.addEventListener('drop', (e) => this.handleDrop(e));
        bookElement.addEventListener('dragend', (e) => this.handleDragEnd(e));
        
        bookElement.addEventListener('click', (e) => {
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
        console.log('🎯 Drag started:', this.draggedASIN, bookItem);
    }

    handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        
        // Visual feedback
        const target = e.target.closest('.book-item');
        if (target && target !== this.draggedElement) {
            target.style.borderLeft = '3px solid #3498db';
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
        
        // Clear all visual feedback
        document.querySelectorAll('.book-item').forEach(item => {
            item.style.borderLeft = '';
        });
        console.log('🎯 Drag ended');
    }

    reorderBooks(draggedASIN, targetASIN) {
        const currentBookshelfId = this.currentBookshelf || 'all';
        
        // Initialize bookOrder if it doesn't exist
        if (!this.userData.bookOrder) {
            this.userData.bookOrder = {};
        }
        if (!this.userData.bookOrder[currentBookshelfId]) {
            this.userData.bookOrder[currentBookshelfId] = [];
        }

        let bookOrder = this.userData.bookOrder[currentBookshelfId];
        
        // If this is the first time ordering for this bookshelf, initialize with current filtered order
        if (bookOrder.length === 0) {
            bookOrder = this.filteredBooks.map(book => book.asin);
            this.userData.bookOrder[currentBookshelfId] = bookOrder;
        }

        // Add dragged item if not in order yet
        if (!bookOrder.includes(draggedASIN)) {
            bookOrder.push(draggedASIN);
        }

        // Remove dragged item from current position
        const draggedIndex = bookOrder.indexOf(draggedASIN);
        if (draggedIndex !== -1) {
            bookOrder.splice(draggedIndex, 1);
        }

        // Insert at new position (before target)
        const targetIndex = bookOrder.indexOf(targetASIN);
        if (targetIndex !== -1) {
            bookOrder.splice(targetIndex, 0, draggedASIN);
        } else {
            // If target not found, add to end
            bookOrder.push(draggedASIN);
        }

        // Switch to custom order automatically when manually reordering
        this.sortOrder = 'custom';
        document.getElementById('sort-order').value = 'custom';
        
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
        const resolvedMemo = this.bookshelfManager.resolveMemo(book.asin, contextInternalId);
        const hasBookshelfOverride = this.bookshelfManager.hasMemoOverride(book.asin, contextInternalId);
        const userNote = {
            memo: resolvedMemo,
            rating: this.bookshelfManager.resolveRating(book.asin),
            hasDetailMemo: allRecord.hasDetailMemo || false,
            hideMemo: !!allRecord.hideMemo,
            hideDetailMemo: !!allRecord.hideDetailMemo
        };
        // 公開時 publishHide フラグは本棚 override 側にあり (本棚スコープ)
        const contextBookshelf = contextInternalId ? this.bookshelfManager.getById(contextInternalId) : null;
        const contextNote = (contextBookshelf && contextBookshelf.notes && contextBookshelf.notes[book.asin]) || {};
        const amazonUrl = this.bookManager.getAmazonUrl(book, this.userData.settings.affiliateId);
        const ico = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        const esc = (s) => this.escapeHtml(String(s == null ? '' : s));

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

        // 短文メモ section (Phase B-7: ALL + 全本棚 override をどこからでも表示・編集)
        // - ALL.notes[asin].memo = デフォルト (常に表示・編集可)
        // - 各本棚の notes[asin].memo = 任意の override (該当本棚に override があれば一覧)
        // - 編集モード: 全項目を個別 textarea で編集、本棚ごと × で override 削除、
        //              member 本棚から override を新規追加可
        const allMemoValue = (allRecord && allRecord.memo) || '';
        const overrides = this.bookshelfManager.getAllMemoOverrides(book.asin);
        const overrideBookshelfIds = new Set(overrides.map(o => o.bookshelf.id));
        const memberBookshelvesNoOverride = memberBookshelves.filter(bs => !overrideBookshelfIds.has(bs.id));

        const memoSectionHeader = `<div class="bd-h5">${ico('notebook-pen')}短文メモ</div>`;

        // ALL メモ
        const allMemoBlock = (() => {
            if (isEditMode) {
                return `
                    <div class="bd-memo-block">
                        <div class="bd-memo-block-head">
                            <span class="bd-memo-scope bd-memo-scope-all">${ico('library', 12)}ALL (デフォルト)</span>
                            <span class="save-note-status bd-save-status" data-asin="${esc(book.asin)}" data-scope="all"></span>
                        </div>
                        <textarea class="note-textarea bd-textarea" data-asin="${esc(book.asin)}" data-scope="all" rows="4" placeholder="どこから開いても表示される基本メモ">${esc(allMemoValue)}</textarea>
                        <label class="bd-flag-label">
                            <input type="checkbox" class="hide-memo-check" data-asin="${esc(book.asin)}" ${userNote.hideMemo ? 'checked' : ''}>
                            公開時にこの ALL メモを非公開
                        </label>
                    </div>
                `;
            }
            if (!allMemoValue) {
                return '<p class="bd-empty-note">ALL メモはまだありません</p>';
            }
            return `
                <div class="bd-memo-block">
                    <div class="bd-memo-block-head"><span class="bd-memo-scope bd-memo-scope-all">${ico('library', 12)}ALL</span></div>
                    <div class="bd-note-display">${this.convertMarkdownLinksToHtml(allMemoValue)}</div>
                </div>
            `;
        })();

        // 各本棚 override — 開いている本棚 (context) の override は色を強調
        const overrideBlocks = overrides.map(({ bookshelf, memo }) => {
            const bsIcon = bookshelf.iconName || 'library';
            const bsNote = (bookshelf.notes && bookshelf.notes[book.asin]) || {};
            const isCtx = contextSlug && bookshelf.id === contextSlug;
            const chip = `<span class="bd-memo-scope bd-memo-scope-bs"><span class="bd-chip-icon">${window.renderIcon(bsIcon, { size: 12 })}</span>${esc(bookshelf.name)}</span>`;
            if (isEditMode) {
                return `
                    <div class="bd-memo-block${isCtx ? ' is-context' : ''}" data-bookshelf-id="${esc(bookshelf.id)}">
                        <div class="bd-memo-block-head">
                            ${chip}
                            <span class="save-note-status bd-save-status" data-asin="${esc(book.asin)}" data-scope="${esc(bookshelf.id)}"></span>
                            <button class="bd-memo-block-remove memo-override-remove" type="button" data-asin="${esc(book.asin)}" data-bookshelf-id="${esc(bookshelf.id)}" title="この本棚専用メモを削除 (ALL に戻る)">×</button>
                        </div>
                        <textarea class="note-textarea bd-textarea" data-asin="${esc(book.asin)}" data-scope="${esc(bookshelf.id)}" rows="3" placeholder="この本棚専用メモ">${esc(memo)}</textarea>
                        <label class="bd-flag-label">
                            <input type="checkbox" class="publish-hide-check" data-asin="${esc(book.asin)}" data-bookshelf-id="${esc(bookshelf.id)}" ${bsNote.publishHide ? 'checked' : ''}>
                            公開時にこの本棚から除外
                        </label>
                    </div>
                `;
            }
            return `
                <div class="bd-memo-block${isCtx ? ' is-context' : ''}">
                    <div class="bd-memo-block-head">${chip}</div>
                    <div class="bd-note-display">${this.convertMarkdownLinksToHtml(memo)}</div>
                </div>
            `;
        }).join('');

        // override 追加 (member 本棚から、まだ override がないもの)
        const addOverrideHtml = (isEditMode && memberBookshelvesNoOverride.length > 0) ? `
            <div class="bd-add-override">
                <select class="bd-add-override-select" data-asin="${esc(book.asin)}">
                    <option value="">本棚専用メモを追加...</option>
                    ${memberBookshelvesNoOverride.map(bs => `<option value="${esc(bs.id)}">${esc(bs.name)}</option>`).join('')}
                </select>
                <button class="btn btn-secondary btn-small bd-add-override-btn" data-asin="${esc(book.asin)}" type="button">${ico('plus')}追加</button>
            </div>
        ` : '';

        // ===== セクション本体 (順序は設定で並び替え可、デフォルト: 本棚→短文→長文→基本情報) =====
        const grip = window.renderIcon('grip-vertical', { size: 12 });

        // 本棚セクション body
        const bookshelvesBody = `
            <div class="bd-chips-row" id="current-bookshelves-${esc(book.asin)}">
                ${chipsHtml || '<span class="bd-empty-note">どの本棚にも追加されていません</span>'}
            </div>
            ${addBookshelfHtml}
        `;

        // 短文メモセクション body
        const shortMemoBody = `
            ${allMemoBlock}
            ${overrideBlocks}
            ${addOverrideHtml}
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
        const resetBtn = (isEditMode && userNote.rating)
            ? `<button class="bd-stars-reset rating-reset" type="button" data-asin="${esc(book.asin)}">リセット</button>`
            : '';
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

                ${showBelow ? `<div class="bd-stars">${starWidget}${resetBtn}</div>` : (resetBtn ? `<div class="bd-stars-reset-row">${resetBtn}</div>` : '')}

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
        // 全 textarea (ALL + 各本棚 override) に自動保存ハンドラを bind
        if (isEditMode) {
            modalBody.querySelectorAll('.note-textarea').forEach(ta => {
                ta.addEventListener('input', (e) => {
                    this._scheduleNoteAutoSave(e.target.dataset.asin, e.target.value, modalBody, e.target.dataset.scope || 'all');
                });
            });
        }

        // 本棚 publishHide (本棚 override に紐づく)
        modalBody.querySelectorAll('.publish-hide-check').forEach(cb => {
            cb.addEventListener('change', async (e) => {
                const asin = e.currentTarget.dataset.asin;
                const bookshelfId = e.currentTarget.dataset.bookshelfId;
                await this._toggleBookshelfNoteFlag(asin, bookshelfId, 'publishHide', e.currentTarget.checked);
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
        // 本棚専用メモを追加
        const addOverrideBtn = modalBody.querySelector('.bd-add-override-btn');
        if (addOverrideBtn) {
            addOverrideBtn.addEventListener('click', async (e) => {
                const asin = e.currentTarget.dataset.asin;
                const select = modalBody.querySelector('.bd-add-override-select');
                const bookshelfId = select?.value;
                if (!bookshelfId) return;
                const bs = this.bookshelfManager.getBySlug(bookshelfId);
                if (!bs) return;
                // 空 override エントリを作って再描画 (textarea が出る)
                if (!bs.notes) bs.notes = {};
                if (!bs.notes[asin]) bs.notes[asin] = {};
                bs.notes[asin].memo = ' '; // 1 文字 placeholder で override 成立 (即削除可能)
                await this.saveUserData();
                this.showBookDetail(book, true);
            });
        }
        // 本棚専用メモを削除 (override 撤去 → ALL に戻る)
        modalBody.querySelectorAll('.memo-override-remove').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const asin = e.currentTarget.dataset.asin;
                const bookshelfId = e.currentTarget.dataset.bookshelfId;
                const bs = this.bookshelfManager.getBySlug(bookshelfId);
                if (!bs || !bs.notes || !bs.notes[asin]) return;
                delete bs.notes[asin].memo;
                if (Object.keys(bs.notes[asin]).length === 0) delete bs.notes[asin];
                await this.saveUserData();
                this.showBookDetail(book, true);
            });
        });

        // 旧「💾 メモを保存」ボタンは廃止。自動保存に切り替わったため不要。
        
        const addToBookshelfBtn = modalBody.querySelector('.add-to-bookshelf');
        if (addToBookshelfBtn) {
            addToBookshelfBtn.addEventListener('click', (e) => {
                this.addBookToBookshelf(e.target.dataset.asin);
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
        
        // Rating reset button
        const ratingResetBtn = modalBody.querySelector('.rating-reset');
        if (ratingResetBtn) {
            ratingResetBtn.addEventListener('click', (e) => {
                const asin = e.currentTarget.dataset.asin;
                this.saveRating(asin, 0);
                this._applyRatingEverywhere(asin, 0);
            });
        }

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
        if (this.pluginAPI) this.pluginAPI._emit('ui:book-modal-opened', { asin: book.asin });
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




    // 本棚スコープのフラグ (publishHide のみ)
    async _togglePublishFlag(asin, flag, value) {
        const internalId = this._currentBookshelfInternalId();
        if (!internalId) return;
        const bs = this.bookshelfManager.getById(internalId);
        if (!bs) return;
        if (!bs.notes) bs.notes = {};
        if (!bs.notes[asin]) bs.notes[asin] = {};
        if (value) {
            bs.notes[asin][flag] = true;
        } else {
            delete bs.notes[asin][flag];
            if (Object.keys(bs.notes[asin]).length === 0) delete bs.notes[asin];
        }
        await this.saveUserData();
    }

    // 任意の本棚 (slug 指定) のフラグ
    async _toggleBookshelfNoteFlag(asin, bookshelfId, flag, value) {
        if (!bookshelfId) return;
        const bs = this.bookshelfManager.getBySlug(bookshelfId);
        if (!bs || bs.isSpecial) return;
        if (!bs.notes) bs.notes = {};
        if (!bs.notes[asin]) bs.notes[asin] = {};
        if (value) {
            bs.notes[asin][flag] = true;
        } else {
            delete bs.notes[asin][flag];
            if (Object.keys(bs.notes[asin]).length === 0) delete bs.notes[asin];
        }
        await this.saveUserData();
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

    // saveNote(asin, memo, scope) — scope: 'all' or bookshelf slug
    async saveNote(asin, memo, scope = 'all') {
        if (scope === 'all') {
            this.bookshelfManager.setMemo(asin, memo, { scope: null });
        } else {
            // scope は本棚 slug — internalId に変換
            const bs = this.bookshelfManager.getBySlug(scope);
            if (!bs) return;
            this.bookshelfManager.setMemo(asin, memo, { scope: bs.internalId });
        }
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
                await this.saveNote(asin, value, scope);
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
        const pagination = document.getElementById('pagination');
        const totalPages = Math.ceil(this.filteredBooks.length / this.booksPerPage);
        
        // Hide pagination if showing all books or only one page
        if (totalPages <= 1 || this.booksPerPage >= this.filteredBooks.length) {
            pagination.innerHTML = '';
            return;
        }
        
        let paginationHTML = `
            <button ${this.currentPage === 1 ? 'disabled' : ''} onclick="bookshelf.goToPage(${this.currentPage - 1})">前へ</button>
        `;
        
        for (let i = Math.max(1, this.currentPage - 2); i <= Math.min(totalPages, this.currentPage + 2); i++) {
            paginationHTML += `
                <button class="${i === this.currentPage ? 'current-page' : ''}" onclick="bookshelf.goToPage(${i})">${i}</button>
            `;
        }
        
        paginationHTML += `
            <button ${this.currentPage === totalPages ? 'disabled' : ''} onclick="bookshelf.goToPage(${this.currentPage + 1})">次へ</button>
        `;
        
        pagination.innerHTML = paginationHTML;
    }

    goToPage(page) {
        this.currentPage = page;
        this.updateDisplay();
        
        // 本棚エリアまでスクロール
        const bookshelf = document.getElementById('bookshelf');
        if (bookshelf) {
            bookshelf.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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

    /** 同期方式に応じて「書き込み可能か」を返す (LocalFS=handle 有り / GitHub=adapter 接続済み) */
    _isSyncReady() {
        if (this.syncMethod === 'github') {
            return this.storage && this.storage.adapter && this.storage.adapter.isConnected && this.storage.adapter.isConnected();
        }
        return !!this.obsidianDirHandle;
    }

    /**
     * Obsidian 同期をスケジュール（debounce）
     */
    _scheduleSync() {
        this._pendingSync = true;
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
            await this.syncToObsidianFolder();
        } catch (e) {
            console.error('Obsidian同期エラー:', e);
        } finally {
            this._syncInProgress = false;
            // 進行中に再要求されていれば再度実行
            if (this._pendingSync) {
                this._scheduleSync();
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
        } else {
            await this.initObsidianSync();
        }
    }

    async initGitHubSync() {
        const adapter = this.storage.adapter;
        if (!(adapter instanceof GitHubAdapter)) {
            console.warn('initGitHubSync: storage adapter is not GitHubAdapter');
            return;
        }
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
                alert('❌ GitHub 認証に失敗しました。\nPAT を再確認してください。');
            } else {
                alert(`❌ GitHub からの読み込みに失敗しました:\n${e.message}`);
            }
        }
    }

    _setupSyncMethodUI() {
        const selector = document.getElementById('sync-method-select');
        const localPanel = document.getElementById('sync-config-local');
        const githubPanel = document.getElementById('sync-config-github');
        if (!selector || !localPanel || !githubPanel) return;

        const showPanel = (method) => {
            localPanel.hidden = (method !== 'local');
            githubPanel.hidden = (method !== 'github');
        };

        const config = this.syncConfig || SyncConfigManager.load();
        selector.value = config.method || 'local';
        showPanel(selector.value);

        this._renderGitHubAuthState();

        selector.addEventListener('change', () => {
            const newMethod = selector.value;
            showPanel(newMethod);
            const current = (this.syncConfig && this.syncConfig.method) || 'local';
            if (newMethod === 'local' && current !== 'local') {
                const ok = confirm('同期方式を「ローカルファイル」に切替えますか？\nGitHub OAuth トークン等は保持されます。\nOK でページをリロードします。');
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
                if (status) status.textContent = '⏳ インストール完了後、このタブに戻ると自動で再取得します';
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
                if (status) status.textContent = '🔄 戻りました、3秒後に再取得します...';
                setTimeout(() => {
                    if (status) status.textContent = '🔄 再取得中...';
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
                    a.textContent = `📁 ${item.name}`;
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
        const token = (SyncConfigManager.load().github || {}).token;
        if (!token) return;
        sel.innerHTML = '<option value="">(取得中...)</option>';
        if (branchSel) branchSel.innerHTML = '<option value="">(repo 選択後に取得)</option>';
        try {
            const { installations, repos } = await this._fetchAccessibleRepos(token);
            if (installations.length === 0) {
                sel.innerHTML = '<option value="">(GitHub App 未インストール)</option>';
                if (installPrompt) installPrompt.hidden = false;
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
                opt.textContent = `${r.full_name}${r.private ? ' 🔒' : ''}`;
                opt.dataset.defaultBranch = r.default_branch;
                if (r.full_name === currentFull) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.onchange = () => this._onGitHubRepoSelected();
            if (currentFull && repos.some(r => r.full_name === currentFull)) {
                await this._loadGitHubBranches(currentFull, current.branch);
            }
        } catch (e) {
            const msg = e.message || String(e);
            sel.innerHTML = `<option value="">(取得失敗: ${msg})</option>`;
            // 権限系エラーは GitHub の反映ラグの可能性が高い
            if (/not accessible|forbidden|permission/i.test(msg) && installPrompt) {
                installPrompt.hidden = false;
            }
        }
    }

    async _onGitHubRepoSelected() {
        const sel = document.getElementById('github-repo-select');
        if (!sel || !sel.value) return;
        await this._loadGitHubBranches(sel.value);
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
            alert('GitHub OAuth Client ID が未設定です。\nbookshelf 管理者に問い合わせるか、fork 時は自分の OAuth App を作成して js/github-auth.js の GITHUB_OAUTH_CLIENT_ID を置き換えてください。');
            return;
        }

        try {
            const device = await GitHubDeviceAuth.requestDeviceCode();
            this._currentDeviceAuth = { cancelled: false, device };

            if (disc) disc.hidden = true;
            if (pend) pend.hidden = false;
            if (codeEl) codeEl.textContent = device.user_code;
            if (linkEl) linkEl.href = device.verification_uri;
            if (statusEl) statusEl.textContent = '⏳ GitHub で承認されるのを待っています...';

            const startedAt = Date.now();
            const token = await GitHubDeviceAuth.pollAccessToken(device, {
                shouldCancel: () => this._currentDeviceAuth && this._currentDeviceAuth.cancelled,
                onTick: (state) => {
                    if (!statusEl) return;
                    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                    const base = state === 'slow'
                        ? '⏳ GitHub が混雑中、間隔を伸ばします'
                        : '⏳ GitHub で承認されるのを待っています';
                    statusEl.textContent = `${base} (${elapsedSec}秒経過)`;
                }
            });

            let user = null;
            try {
                user = await GitHubDeviceAuth.fetchUser(token.access_token);
            } catch (_) {
                // ユーザ取得失敗は致命的ではないので続行
            }

            const merged = SyncConfigManager.load();
            merged.method = 'github';
            merged.github = {
                ...(merged.github || {}),
                token: token.access_token,
                login: user ? user.login : null
            };
            SyncConfigManager.save(merged);
            this._currentDeviceAuth = null;
            this._renderGitHubAuthState();
            alert(`✅ GitHub に接続しました${user ? ` (${user.login})` : ''}。\n下のリストからリポジトリを選んで「この設定で使う」を押してください。`);
        } catch (e) {
            this._currentDeviceAuth = null;
            if (e.message === 'AUTH_CANCELLED') {
                this._renderGitHubAuthState();
                return;
            }
            if (e.message === 'AUTH_DENIED') {
                alert('❌ GitHub での承認が拒否されました。');
            } else if (e.message === 'AUTH_EXPIRED') {
                alert('❌ コードの有効期限が切れました。もう一度「接続」を押してください。');
            } else {
                alert(`❌ GitHub 接続エラー:\n${e.message}`);
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
                copyBtn.textContent = '✅ コピー済';
                setTimeout(() => { copyBtn.textContent = orig; }, 1500);
            }
        } catch (e) {
            console.warn('clipboard write failed:', e);
        }
    }

    _disconnectGitHub() {
        const ok = confirm('GitHub 接続を切断しますか?\nOAuth トークンを削除し、同期方式をローカルファイルに戻します。');
        if (!ok) return;
        const merged = SyncConfigManager.load();
        merged.method = 'local';
        if (merged.github) {
            merged.github = { ...merged.github, token: '', login: null };
        }
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
            if (status) status.textContent = '⚠️ 先に「GitHub に接続」を押してください';
            return;
        }
        if (!repo.owner || !repo.repo) {
            if (status) status.textContent = '⚠️ owner / repo は必須';
            return;
        }
        if (status) status.textContent = '⏳ 接続確認中...';
        try {
            const adapter = new GitHubAdapter({ ...repo, token });
            await adapter.testConnection();
        } catch (e) {
            if (status) status.textContent = `❌ 接続失敗: ${e.message}`;
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
        if (status) status.textContent = '✅ 保存しました。ページをリロードします...';
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
            alert('このブラウザはフォルダ選択に対応していません。\nChrome または Edge をご利用ください。');
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
                    alert(`✅ 「${handle.name}」に新ファイル構造で初期化しました。`);
                } else {
                    alert(`✅ 「${handle.name}」から ${this.books.length} 冊を読み込みました。`);
                }
            } else {
                // load 失敗時は同期フォルダの既存データを上書きしないため、ここでは何もしない
                this.updateSyncStatus('reconnect', handle.name);
                alert(`⚠️ 「${handle.name}」のデータ読み込みに失敗しました。\nlibrary.json / bookshelves/all.json の存在を確認してください。\n（既存ファイルを保護するため、自動初期化は行いませんでした）`);
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('フォルダ選択エラー:', e);
            if (e.name === 'SecurityError') {
                alert('フォルダへのアクセスが拒否されました。\nHTTPS環境（GitHub Pages）またはlocalhost上で実行してください。');
            } else {
                alert(`フォルダ選択エラー: ${e.message}`);
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
                ...(meta.color ? { color: meta.color } : {}),
                parent: meta.parent || null,
                appliedPlugins: meta.appliedPlugins || [],
                isPublic: meta.isPublic || false,
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
        const persisted = { ...this.userData };
        const { libraryBooks: _omit, ...storageRest } = persisted._storage;
        persisted._storage = storageRest;
        try {
            localStorage.setItem('virtualBookshelf_userData', JSON.stringify(persisted));
        } catch (e) {
            console.error('localStorage 保存失敗:', e);
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
            alert('library.json が見つかりません。');
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
                isPublic: (allMeta && allMeta.isPublic) || false,
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
                    isPublic: false,
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
                ...(b.color ? { color: b.color } : {}),
                appliedPlugins: b.appliedPlugins || [],
                isPublic: b.isPublic || false,
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

            this.updateSyncStatus('synced', this._syncLabel());
        } catch (e) {
            console.error('同期エラー:', e);
            this.updateSyncStatus('reconnect', this._syncLabel());
            // dirHandle が dangling (フォルダ削除/リネーム) なら明示的に再選択を促す
            const isHandleStale = e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError');
            if (isHandleStale && this.syncMethod === 'local' && !this._syncReconnectNotified) {
                this._syncReconnectNotified = true;
                alert('同期フォルダが見つかりません (削除/リネームされた可能性)。\n設定 → 同期 → 「📁 変更」で再選択してください。\n別方式 (GitHub) に切替える場合は 同期方式 select から行ってください。');
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
            '⚠️ 同期先 (GitHub) のデータが他の場所から更新されています。\n\n' +
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
            status.textContent = `✅ ${new Date().toLocaleTimeString()} 同期済み（「変更」で再読み込み）`;
            status.style.color = '#4caf50';
        } else if (state === 'loading') {
            pathEl.textContent = folderName;
            pathEl.title = folderName;
            pathEl.style.color = '';
            status.textContent = '⏳ 読み込み中...';
            status.style.color = '#888';
        } else if (state === 'reconnect') {
            pathEl.textContent = `${folderName || ''} (要再接続)`;
            pathEl.title = folderName || '';
            pathEl.style.color = '#f44336';
            status.textContent = '⚠️ 「変更」を押してフォルダを再選択';
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
        
        console.log('📁 library.jsonファイルを自動生成しました');
    }

    updateBookshelfSelector() {
        // V6 では popover ベース。popover が開かれた時に _renderBookshelfPopover が呼ばれる。
        // 開いていない場合でも、開いている時の中身を最新化しておく。
        const pop = document.getElementById('bookshelf-popover');
        if (pop && !pop.hidden) this._renderBookshelfPopover();
        // PC v2: 左サイドバーツリーも更新
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
    }

    /**
     * ビュー切替: body クラスを app-view-{main|bookshelf} に
     */
    _setBodyView(view) {
        document.body.classList.remove('app-view-main', 'app-view-bookshelf');
        document.body.classList.add(`app-view-${view}`);
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
            const children = byParent.get(bs.internalId) || [];
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(bs.internalId);
            const bookCount = (bs.books && bs.books.length) || 0;
            const effectiveIcon = bs.iconName || 'library';
            const iconSvg = window.renderIcon(effectiveIcon, { size: 16 });
            const isActive = this.currentBookshelf && (bs.id === this.currentBookshelf || bs.internalId === this.currentBookshelf);

            const node = document.createElement('div');
            node.className = `tree-node lv${Math.min(depth, 4)}${isActive ? ' is-active' : ''}`;
            node.dataset.bookshelfId = bs.id;
            node.dataset.internalId = bs.internalId;
            const toggleIconName = isExpanded ? 'chevron-down' : 'chevron-right';
            node.innerHTML = `
                <span class="tree-indent"></span>
                <span class="tree-icon" data-icon-value="${effectiveIcon.replace(/"/g,'&quot;')}">${iconSvg}</span>
                <span class="tree-label" title="${bs.name}">${bs.name}</span>
                <span class="tree-count">${bookCount}</span>
                ${!bs.isSpecial ? `<button class="tree-more" type="button" title="本棚の操作 (編集 / 子追加 / 削除)">${window.renderIcon('more-horizontal', { size: 14 })}</button>` : ''}
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
                    if (expanded.has(bs.internalId)) expanded.delete(bs.internalId);
                    else expanded.add(bs.internalId);
                    try { localStorage.setItem(expandedKey, JSON.stringify([...expanded])); } catch {}
                    this._renderSidebarTree();
                });
            }
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
        this._renderSidebarPinned();
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
        menu.innerHTML = `
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
        menu.querySelector('[data-act="edit"]').addEventListener('click', () => { cleanup(); this.editBookshelf(bs.id); });
        menu.querySelector('[data-act="add-child"]').addEventListener('click', () => { cleanup(); this.showBookshelfForm(null, bs.internalId); });
        menu.querySelector('[data-act="delete"]').addEventListener('click', () => { cleanup(); this.deleteBookshelf(bs.id); });
        setTimeout(() => {
            document.addEventListener('click', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    }

    // 折りたたみ strip にホーム + ピン留め本棚アイコンを描画
    _renderSidebarPinned() {
        const host = document.getElementById('sidebar-pinned');
        if (!host) return;
        const bookshelves = this.bookshelfManager?.getBookshelves?.() || [];
        const pinned = bookshelves.filter(b => b.pinned && !b.isSpecial);
        const isMain = document.body.classList.contains('app-view-main');

        const escapeAttr = (s) => String(s || '').replace(/"/g, '&quot;');
        const homeBtn = `
            <button class="strip-pin-item strip-pin-home${isMain ? ' is-active' : ''}" type="button" data-nav="home" title="ホーム">
                ${window.renderIcon('library', { size: 18 })}
            </button>
        `;
        const pinnedHtml = pinned.map(bs => {
            const icon = bs.iconName || 'library';
            const isActive = !isMain && (this.currentBookshelf === bs.id || this.currentBookshelf === bs.internalId);
            return `
                <button class="strip-pin-item${isActive ? ' is-active' : ''}" type="button"
                        data-bookshelf-id="${escapeAttr(bs.id)}"
                        title="${escapeAttr(bs.name)}">
                    ${window.renderIcon(icon, { size: 18 })}
                </button>
            `;
        }).join('');
        host.innerHTML = homeBtn + (pinned.length > 0 ? '<div class="strip-divider"></div>' : '') + pinnedHtml;

        host.querySelectorAll('.strip-pin-item').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.nav === 'home') {
                    if (this.router) this.router.navigateMain();
                    else this._setBodyView('main');
                    return;
                }
                const id = btn.dataset.bookshelfId;
                if (id) this.switchBookshelf(id);
            });
        });
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
        // 折りたたみ strip のハイライト同期
        this._renderSidebarPinned();
    }

    // ===== Header Icon Override (localStorage、全ヘッダーアイテム共通) =====
    //
    // ヘッダーボタンのアイコンをユーザが自由に変更できる。プラグインも静的アイテムも全て同じ
    // 体系で扱う。
    //
    // key 体系:
    //   - 静的: 'back-to-main', 'bookshelf-selector', 'manage-bookshelves', ...
    //   - 状態切替: 'view-toggle:covers', 'view-toggle:list',
    //               'overview-display:images', 'overview-display:text'
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
        // 設定モーダルのヘッダーカスタマイザも再描画 (プレビュー更新)
        if (typeof this._renderHeaderCustomizer === 'function') {
            this._renderHeaderCustomizer().catch(e => console.warn('header customizer re-render failed', e));
        }
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

    async _openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        modal.classList.add('show');
        const urlInput = document.getElementById('plugin-repo-url');
        if (urlInput) urlInput.value = '';
        // ヘッダーカスタマイザはインストール済みプラグイン情報を非同期で取得して描画
        try { await this._renderHeaderCustomizer(); } catch (e) { console.warn(e); }
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
        'back-to-main':        { label: '← 一覧',       defaultIcon: 'arrow-left',        emoji: '←',  duplicatable: false, needsBookshelf: true },
        'bookshelf-selector':  { label: '本棚切替',     defaultIcon: 'library',           emoji: '📚', duplicatable: false },
        'manage-bookshelves':  { label: '本棚管理',     defaultIcon: 'pen-line',          emoji: '📝', duplicatable: false },
        'overview-display':    { label: '一覧画像表示', defaultIcon: 'image',             emoji: '🖼️', duplicatable: false, stateful: true },
        'open-settings':       { label: '設定',         defaultIcon: 'settings',          emoji: '⚙️', duplicatable: false, required: true }
    };
    static HEADER_LAYOUT_STORAGE_KEY = 'headerLayoutV8';

    _defaultHeaderLayout() {
        // Phase C2: コンテナはサイドバー下部ユーティリティへ移設。
        // 既定は 本棚管理 / 一覧表示切替 / 設定。back-to-main / bookshelf-selector は
        // サイドバーツリーと重複するため既定では出さない (カスタマイザで任意追加可)。
        return {
            items: [
                { id: this._newPlacementId(), key: 'manage-bookshelves' },
                { id: this._newPlacementId(), key: 'overview-display' },
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

        // required アイテム (open-settings, back-to-main) の存在保証
        for (const [key, meta] of Object.entries(VirtualBookshelf.HEADER_ITEMS_META)) {
            if (meta.required && !layout.items.some(it => it.key === key)) {
                layout.items.push({ id: this._newPlacementId(), key });
            }
        }
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
            const span = document.createElement('span');
            span.className = 'header-item plugin-button-item';
            span.dataset.headerItem = key;
            span.dataset.placementId = placementId;
            const btn = document.createElement('button');
            btn.className = 'btn-icon-square plugin-ui-button';
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
        // 静的アイテムにも override を適用 (view-toggle / overview-display は除く: 状態切替なので別関数で扱う)
        if (key !== 'view-toggle' && key !== 'overview-display') {
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

        // 状態依存のアイコン表示を反映 (clone 含む)
        this._updateViewToggleButton();
        this._updateOverviewDisplayButton();
    }

    // ===== ヘッダー編集 UI (V6: 縦リスト 2 ゾーン + プラグイン統合) =====

    async _renderHeaderCustomizer() {
        const host = document.getElementById('header-customizer');
        if (!host) return;

        const layout = this._currentHeaderLayout();
        const all = this._enumerateHeaderItems();
        const allByKey = new Map(all.map(i => [i.key, i]));

        const placedKeys = new Set(layout.items.map(it => it.key));
        const unplacedItems = all.filter(i => !placedKeys.has(i.key));

        const renderRow = (item, opts = {}) => {
            const { source, placementId } = opts;
            const required = !!VirtualBookshelf.HEADER_ITEMS_META[item.key]?.required;
            const isPlugin = item.isPlugin;
            const isStateful = !!VirtualBookshelf.HEADER_ITEMS_META[item.key]?.stateful;
            const badge = isPlugin
                ? '<span class="hdr-row-badge plugin">🧩 プラグイン</span>'
                : required ? '<span class="hdr-row-badge muted">必須</span>' : '';
            const needsBs = item.needsBookshelf ? '<span class="hdr-row-badge muted">本棚画面のみ</span>' : '';
            // 必須項目は配置中で ↓ ボタンを出さない (外せない)
            let moveBtn = '';
            if (source === 'placed' && !required) {
                moveBtn = `<button type="button" class="hdr-row-move-btn" data-move-pid="${placementId}" data-direction="down" title="未配置に移す">↓</button>`;
            } else if (source === 'unplaced') {
                moveBtn = `<button type="button" class="hdr-row-move-btn" data-move-key="${item.key}" data-direction="up" title="配置中に移す">↑</button>`;
            }
            // 「▶ 操作」ボタンは配置中/未配置どちらでも表示（必須項目は除く）
            let invokeBtn = '';
            if (!required) {
                if (isPlugin && item.buttonId) {
                    invokeBtn = `<button type="button" class="hdr-row-invoke-btn" data-invoke-plugin="${item.buttonId}" title="このボタンを実行">▶ 操作</button>`;
                } else {
                    invokeBtn = `<button type="button" class="hdr-row-invoke-btn" data-invoke-key="${item.key}" title="このボタンを実行">▶ 操作</button>`;
                }
            }
            // 🎨 アイコン変更ボタン (全アイテム共通)
            // state-持ち (view-toggle / overview-display) は 2 state 分の選択肢が出る
            let iconBtnHtml = '';
            if (isStateful) {
                // 2 つの状態を別々に変更可能
                const stateLabels = item.key === 'view-toggle'
                    ? [['view-toggle:covers', '表紙時'], ['view-toggle:list', 'リスト時']]
                    : [['overview-display:images', '画像時'], ['overview-display:text', 'テキスト時']];
                iconBtnHtml = stateLabels.map(([k, lbl]) => {
                    const cur = this.getHeaderIconOverride(k);
                    const preview = window.renderIcon(cur || VirtualBookshelf.HEADER_ITEMS_META[item.key].defaultIcon, { size: 14 });
                    return `<button type="button" class="hdr-row-icon-btn" data-icon-key="${k}" title="${lbl}のアイコンを変更">${preview}<span style="font-size:0.7rem;color:#6b7280;">${lbl}</span></button>`;
                }).join('');
            } else {
                const stateKey = isPlugin && item.buttonId ? `plugin:${item.buttonId}` : item.key;
                const cur = this.getHeaderIconOverride(stateKey);
                const defaultIcon = isPlugin
                    ? (this.pluginLoader?.getManifest?.(item.buttonId)?.icon || '')
                    : VirtualBookshelf.HEADER_ITEMS_META[item.key]?.defaultIcon || '';
                const previewIcon = cur || defaultIcon;
                const preview = previewIcon ? window.renderIcon(previewIcon, { size: 14 }) : window.renderIcon('palette', { size: 14 });
                iconBtnHtml = `<button type="button" class="hdr-row-icon-btn" data-icon-key="${stateKey}" title="アイコンを変更">${preview}<span style="font-size:0.7rem;color:#6b7280;">アイコン</span></button>`;
            }
            // プレビュー (row 内のアイコン): 現在の override or default を表示
            const rowPreviewIcon = isPlugin
                ? (this.getHeaderIconOverride(`plugin:${item.buttonId}`) || this.pluginLoader?.getManifest?.(item.buttonId)?.icon || 'puzzle')
                : (isStateful
                    ? VirtualBookshelf.HEADER_ITEMS_META[item.key].defaultIcon
                    : (this.getHeaderIconOverride(item.key) || VirtualBookshelf.HEADER_ITEMS_META[item.key]?.defaultIcon || 'puzzle'));
            const rowPreviewHtml = window.renderIcon(rowPreviewIcon, { size: 18 });
            return `
                <div class="hdr-row" draggable="true"
                     data-source="${source}"
                     data-key="${item.key}"
                     ${placementId ? `data-placement-id="${placementId}"` : ''}>
                    <span class="hdr-row-grip" aria-hidden="true">≡</span>
                    <span class="hdr-row-icon" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;color:#4338ca;">${rowPreviewHtml}</span>
                    <span class="hdr-row-label">${item.label}</span>
                    <span class="hdr-row-badges">${badge}${needsBs}</span>
                    <span class="hdr-row-actions">${iconBtnHtml}${moveBtn}${invokeBtn}</span>
                </div>`;
        };

        const placedHtml = layout.items.length === 0
            ? '<div class="hdr-empty">配置中の項目はありません。下から ↑ ボタンかドラッグで追加してください。</div>'
            : layout.items.map(it => {
                const meta = allByKey.get(it.key) || { key: it.key, label: it.key, emoji: '', isPlugin: false };
                return renderRow(meta, {
                    source: 'placed',
                    placementId: it.id
                });
            }).join('');

        const unplacedHtml = unplacedItems.length === 0
            ? `<div class="hdr-empty">未配置のヘッダー項目はありません。</div>`
            : unplacedItems.map(i => renderRow(i, { source: 'unplaced' })).join('');

        host.innerHTML = `
            <div class="hdr-editor-v6">
                <div class="hdr-zone hdr-zone-placed">
                    <div class="hdr-zone-title">配置中 <small>左→右の順にヘッダーへ表示</small></div>
                    <div class="hdr-zone-list" id="hdr-zone-placed">${placedHtml}</div>
                </div>
                <div class="hdr-zone hdr-zone-unplaced">
                    <div class="hdr-zone-title">未配置 <small>使わないボタン / 有効プラグインの未配置 UI ボタン</small></div>
                    <div class="hdr-zone-list" id="hdr-zone-unplaced">${unplacedHtml}</div>
                </div>
                <div class="hdr-editor-hint">
                    ドラッグ&ドロップ または ↑↓ ボタンで移動 / 「外す」で取り外し
                    <button type="button" id="hdr-reset" class="btn btn-small btn-secondary">デフォルトに戻す</button>
                </div>
            </div>
        `;

        this._bindHeaderEditorEvents();
        await this._renderPluginListSection();
    }

    /**
     * プラグイン一覧セクションを描画 (#plugin-list-section)
     * 各プラグイン: 名前/version/desc + [有効] チェックボックス + 🗑️ 削除
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
            host.innerHTML = '<p style="color:#888;">同期先 (ローカルフォルダ or GitHub) を先に接続してください。</p>';
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
            const iconChangeBtn = `<button type="button" class="btn btn-small plugin-card-icon" data-icon-plugin="${id}" title="ボタンアイコンを変更">${icoBtn('palette')}アイコン</button>`;
            const uninstallBtn = `<button type="button" class="btn btn-small btn-danger plugin-card-uninstall" data-uninstall-plugin="${id}" title="アンインストール">${icoBtn('trash-2')}削除</button>`;
            const disableBtn = `<button type="button" class="btn btn-small plugin-card-disable" data-disable-plugin="${id}" title="プラグインを無効化">${icoBtn('pause')}無効化</button>`;
            let stateLabel, actionBtns;
            if (enabled && loaded) {
                stateLabel = `<span class="plugin-state ok">${icoBtn('circle-check', 12)}有効</span>`;
                actionBtns = `${iconChangeBtn}${disableBtn}${uninstallBtn}`;
            } else if (enabled && !loaded) {
                stateLabel = `<span class="plugin-state warn">${icoBtn('alert-triangle', 12)}読み込み失敗</span>`;
                actionBtns = `${disableBtn}${uninstallBtn}`;
            } else {
                stateLabel = `<span class="plugin-state muted">${icoBtn('circle', 12)}無効</span>`;
                actionBtns = `<button type="button" class="btn btn-small btn-primary plugin-card-enable" data-enable-plugin="${id}" title="プラグインを有効化">${icoBtn('play')}有効化</button>${uninstallBtn}`;
            }
            const nameForSearch = (m.name || id || '').slice(0, VirtualBookshelf.PLUGIN_SEARCH_NAME_LIMIT);
            const descForSearch = (m.description || '').slice(0, VirtualBookshelf.PLUGIN_SEARCH_DESC_LIMIT);
            const searchText = `${nameForSearch}${descForSearch}`.toLowerCase();
            // 検索文字列の HTML 属性用エスケープ
            const searchAttr = searchText.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            // 現在使用中のアイコン (override 優先, fallback は manifest.icon)
            const currentIcon = this._getPluginIconOverride(id) || m.icon || '';
            const iconPreviewHtml = currentIcon
                ? `<span class="plugin-card-icon-preview" data-icon-value="${currentIcon.replace(/"/g,'&quot;')}" title="現在のアイコン: ${currentIcon}">${window.renderIcon(currentIcon, { size: 16 })}</span>`
                : '';
            const publishableBadge = m.publishable
                ? `<span class="plugin-publishable-badge" title="公開エクスポート対象">${window.renderIcon('globe', { size: 12 })}</span>`
                : '';
            return `
                <div class="plugin-card-v2" data-plugin-id="${id}" data-search-text="${searchAttr}" draggable="true">
                    <div class="plugin-card-info">
                        <div class="plugin-card-title">
                            ${iconPreviewHtml}<strong>${m.name || id}</strong>
                            <small>v${m.version || '?'} ${publishableBadge}</small>
                        </div>
                        <div class="plugin-card-desc">${m.description || ''}</div>
                        ${stateLabel}
                    </div>
                    <div class="plugin-card-actions">${actionBtns}</div>
                </div>
            `;
        }).join('');

        this._bindPluginListEvents();
        this._applyPluginSearchFilter();
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

        host.addEventListener('click', (e) => {
            const enable = e.target.closest('[data-enable-plugin]');
            if (enable) {
                e.stopPropagation();
                const id = enable.dataset.enablePlugin;
                (async () => {
                    try {
                        await this.togglePlugin(id, true);
                        await this._renderHeaderCustomizer();
                        this._applyHeaderLayout();
                    } catch (err) {
                        alert('有効化失敗: ' + err.message);
                    }
                })();
                return;
            }
            const disable = e.target.closest('[data-disable-plugin]');
            if (disable) {
                e.stopPropagation();
                const id = disable.dataset.disablePlugin;
                (async () => {
                    try {
                        await this.togglePlugin(id, false);
                        await this._renderHeaderCustomizer();
                        this._applyHeaderLayout();
                    } catch (err) {
                        alert('無効化失敗: ' + err.message);
                    }
                })();
                return;
            }
            const uninstall = e.target.closest('[data-uninstall-plugin]');
            if (uninstall) {
                e.stopPropagation();
                const id = uninstall.dataset.uninstallPlugin;
                if (!confirm(`プラグイン "${id}" を削除しますか？同期フォルダから plugins/${id}/ も削除されます。`)) return;
                (async () => {
                    try {
                        await this.uninstallPluginById(id);
                        await this._renderHeaderCustomizer();
                        this._applyHeaderLayout();
                    } catch (err) {
                        alert('アンインストール失敗: ' + err.message);
                    }
                })();
                return;
            }
            const iconBtn = e.target.closest('[data-icon-plugin]');
            if (iconBtn) {
                e.stopPropagation();
                const id = iconBtn.dataset.iconPlugin;
                const manifest = this.pluginLoader?.getManifest?.(id) || {};
                const overrideKey = `plugin:${id}`;
                const current = this.getHeaderIconOverride(overrideKey) || manifest.icon || '';
                (async () => {
                    const picked = await this.openIconPicker({
                        title: `プラグイン「${manifest.name || id}」のアイコン`,
                        current
                    });
                    if (picked === null) return; // キャンセル
                    this.setHeaderIconOverride(overrideKey, picked || null);
                })();
                return;
            }
        }, { signal });
    }

    _bindHeaderEditorEvents() {
        const host = document.getElementById('header-customizer');
        if (!host) {
            console.warn('[hdr-editor] host #header-customizer not found at bind time');
            return;
        }
        // 前回のリスナを abort して、新規 AbortController で再バインド
        if (this._hdrAbort) {
            try { this._hdrAbort.abort(); } catch (_) {}
        }
        this._hdrAbort = new AbortController();
        const signal = this._hdrAbort.signal;

        // ===== クリック系: イベント委譲 =====
        host.addEventListener('click', (e) => {
            const reset = e.target.closest('#hdr-reset');
            if (reset) { this._resetHeaderLayout(); return; }

            const moveDown = e.target.closest('[data-move-pid][data-direction="down"]');
            if (moveDown) {
                e.stopPropagation();
                this._removePlacementByPid(moveDown.dataset.movePid);
                return;
            }
            const moveUp = e.target.closest('[data-move-key][data-direction="up"]');
            if (moveUp) {
                e.stopPropagation();
                this._insertHeaderItem(moveUp.dataset.moveKey, Number.MAX_SAFE_INTEGER);
                return;
            }
            const invoke = e.target.closest('[data-invoke-plugin], [data-invoke-key]');
            if (invoke) {
                e.stopPropagation();
                if (invoke.dataset.invokePlugin) {
                    const id = invoke.dataset.invokePlugin;
                    const entry = this.pluginAPI?._uiButtons?.find(b => b.id === id);
                    if (entry && typeof entry.onClick === 'function') {
                        try { entry.onClick(); }
                        catch (err) { console.error(`[plugin "${id}"] onClick`, err); }
                    }
                } else {
                    // 静的ボタン: テンプレ DOM の button.click() を呼ぶ (未配置でも handler は生存)
                    const key = invoke.dataset.invokeKey;
                    const tpl = this._headerTemplates?.get(key);
                    const btn = tpl?.querySelector('button');
                    if (btn) {
                        try { btn.click(); }
                        catch (err) { console.error(`[static "${key}"] click`, err); }
                    }
                }
                return;
            }
            // 🎨 アイコン変更ボタン (全アイテム共通)
            const iconChange = e.target.closest('[data-icon-key]');
            if (iconChange) {
                e.stopPropagation();
                const key = iconChange.dataset.iconKey;
                const current = this.getHeaderIconOverride(key) || '';
                (async () => {
                    const picked = await this.openIconPicker({
                        title: `アイコンを選択 (${key})`,
                        current
                    });
                    if (picked === null) return; // キャンセル
                    // 空文字 → デフォルトに戻す
                    this.setHeaderIconOverride(key, picked || null);
                })();
                return;
            }
        }, { signal });

        // ===== ドラッグ&ドロップ: イベント委譲 =====
        const dragState = { source: null, key: null, placementId: null };

        host.addEventListener('dragstart', (e) => {
            const row = e.target.closest('.hdr-row');
            if (!row || !host.contains(row)) return;
            dragState.source = row.dataset.source;
            dragState.key = row.dataset.key;
            dragState.placementId = row.dataset.placementId || null;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', row.dataset.key || ''); } catch (_) {}
            }
            row.classList.add('hdr-row-dragging');
        }, { signal });

        host.addEventListener('dragend', (e) => {
            const row = e.target.closest('.hdr-row');
            if (row) row.classList.remove('hdr-row-dragging');
            host.querySelectorAll('.hdr-drop-indicator').forEach(el => el.remove());
            host.querySelectorAll('.hdr-drop-target').forEach(el => el.classList.remove('hdr-drop-target'));
            dragState.source = null;
            dragState.key = null;
            dragState.placementId = null;
        }, { signal });

        const computeInsertIndex = (zoneEl, clientY) => {
            const rows = Array.from(zoneEl.querySelectorAll('.hdr-row'));
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i].getBoundingClientRect();
                if (clientY < r.top + r.height / 2) return i;
            }
            return rows.length;
        };
        const showInsertIndicator = (zoneEl, index) => {
            zoneEl.querySelectorAll('.hdr-drop-indicator').forEach(el => el.remove());
            const rows = Array.from(zoneEl.querySelectorAll('.hdr-row'));
            const indicator = document.createElement('div');
            indicator.className = 'hdr-drop-indicator';
            if (index >= rows.length) zoneEl.appendChild(indicator);
            else zoneEl.insertBefore(indicator, rows[index]);
        };

        host.addEventListener('dragover', (e) => {
            if (!dragState.source) return;
            const zone = e.target.closest('.hdr-zone-list');
            if (!zone) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            host.querySelectorAll('.hdr-drop-target').forEach(el => {
                if (el !== zone) el.classList.remove('hdr-drop-target');
            });
            zone.classList.add('hdr-drop-target');
            if (zone.id === 'hdr-zone-placed') {
                showInsertIndicator(zone, computeInsertIndex(zone, e.clientY));
            } else {
                host.querySelectorAll('.hdr-drop-indicator').forEach(el => el.remove());
            }
        }, { signal });

        host.addEventListener('drop', (e) => {
            const zone = e.target.closest('.hdr-zone-list');
            if (!zone || !dragState.source) return;
            e.preventDefault();
            host.querySelectorAll('.hdr-drop-target').forEach(el => el.classList.remove('hdr-drop-target'));
            host.querySelectorAll('.hdr-drop-indicator').forEach(el => el.remove());

            if (zone.id === 'hdr-zone-placed') {
                const idx = computeInsertIndex(zone, e.clientY);
                if (dragState.source === 'unplaced') {
                    this._insertHeaderItem(dragState.key, idx);
                } else if (dragState.source === 'placed' && dragState.placementId) {
                    this._reorderHeaderPlacement(dragState.placementId, idx);
                }
            } else if (zone.id === 'hdr-zone-unplaced') {
                if (dragState.source === 'placed' && dragState.placementId) {
                    this._removePlacementByPid(dragState.placementId);
                }
            }
            dragState.source = null;
            dragState.key = null;
            dragState.placementId = null;
        }, { signal });
    }

    _insertHeaderItem(key, index) {
        const layout = this._currentHeaderLayout();
        // 全アイテム non-duplicatable: 既存があれば削除
        layout.items = layout.items.filter(it => it.key !== key);
        const insertAt = Math.max(0, Math.min(index, layout.items.length));
        layout.items.splice(insertAt, 0, { id: this._newPlacementId(), key });
        this._saveHeaderLayout(layout);
        this._applyHeaderLayout();
        this._renderHeaderCustomizer();
    }

    _reorderHeaderPlacement(placementId, index) {
        const layout = this._currentHeaderLayout();
        const fromIdx = layout.items.findIndex(it => it.id === placementId);
        if (fromIdx < 0) return;
        const [item] = layout.items.splice(fromIdx, 1);
        const insertAt = Math.max(0, Math.min(index > fromIdx ? index - 1 : index, layout.items.length));
        layout.items.splice(insertAt, 0, item);
        this._saveHeaderLayout(layout);
        this._applyHeaderLayout();
        this._renderHeaderCustomizer();
    }

    _removePlacementByPid(placementId) {
        const layout = this._currentHeaderLayout();
        const target = layout.items.find(it => it.id === placementId);
        if (!target) return;
        const required = !!VirtualBookshelf.HEADER_ITEMS_META[target.key]?.required;
        if (required && layout.items.filter(it => it.key === target.key).length <= 1) return;
        layout.items = layout.items.filter(it => it.id !== placementId);
        this._saveHeaderLayout(layout);
        this._applyHeaderLayout();
        this._renderHeaderCustomizer();
    }

    _resetHeaderLayout() {
        localStorage.removeItem(VirtualBookshelf.HEADER_LAYOUT_STORAGE_KEY);
        this._applyHeaderLayout();
        this._renderHeaderCustomizer();
    }

    _closeSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.remove('show');
    }

    /**
     * 本棚ビューのタイトル・説明を更新
     */
    _updateBookshelfViewTitle() {
        const titleEl = document.getElementById('current-bookshelf-title');
        const descEl = document.getElementById('current-bookshelf-desc');
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
            desc = bs.description || '';
        } else if (id === 'all') {
            title = '全ての本';
            desc = '除外していない全ての蔵書';
        }
        const effectiveTitleIcon = (bs && bs.iconName) || 'library';
        const iconSvg = window.renderIcon(effectiveTitleIcon, { size: 22 });
        const safeTitle = this._escapeAttr(title);
        const safeIconAttr = this._escapeAttr(effectiveTitleIcon);
        // section-title 内に icon + text。span ではなく flex 親で揃える
        titleEl.innerHTML = `<span class="bs-title-icon" data-icon-value="${safeIconAttr}" style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:0.5rem;color:#4338ca;">${iconSvg}</span><span class="bs-title-text">${safeTitle}</span>`;
        if (descEl) {
            descEl.textContent = desc;
            descEl.style.display = desc ? '' : 'none';
        }
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
                    <p>📖</p>
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

        let html = '';
        this.userData.bookshelves.forEach(bookshelf => {
            const bookCount = bookshelf.books ? bookshelf.books.length : 0;
            const isPublic = bookshelf.isPublic || false;
            const isSpecial = bookshelf.isSpecial || false;
            const publicBadge = isPublic
                ? `<span class="public-badge"><span class="h-icon">${window.renderIcon('upload-cloud', { size: 12 })}</span>公開中</span>`
                : '';
            const specialBadge = isSpecial
                ? `<span class="special-badge"><span class="h-icon">${window.renderIcon('lock', { size: 12 })}</span>特殊</span>`
                : '';
            const dragHandle = isSpecial
                ? window.renderIcon('lock', { size: 14 })
                : window.renderIcon('grip-vertical', { size: 14 });
            const bsEffectiveIcon = bookshelf.iconName || 'library';
            const bsIconSvg = window.renderIcon(bsEffectiveIcon, { size: 16 });
            html += `
                <div class="bookshelf-item" data-id="${bookshelf.id}" draggable="${!isSpecial}">
                    <div class="bookshelf-drag-handle">${dragHandle}</div>
                    <div class="bookshelf-info">
                        <h4><span class="bookshelf-list-icon" data-icon-value="${bsEffectiveIcon.replace(/"/g,'&quot;')}">${bsIconSvg}</span>${bookshelf.name} ${specialBadge}${publicBadge}</h4>
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
        const slugInput = document.getElementById('bookshelf-slug');
        const parentSelect = document.getElementById('bookshelf-parent');
        const iconNameInput = document.getElementById('bookshelf-icon-name');
        const iconLabel = document.getElementById('bookshelf-icon-label');
        const iconPreview = document.getElementById('bookshelf-icon-preview');
        const iconTrigger = document.getElementById('bookshelf-icon-trigger');
        const descriptionInput = document.getElementById('bookshelf-description');
        const isPublicInput = document.getElementById('bookshelf-is-public');
        const pinnedInput = document.getElementById('bookshelf-pinned');

        // 親本棚ドロップダウン構築（編集中は自身と子孫を除外）
        // bookshelves[] には all 本棚も含まれているのでハードコードしない
        const allId = this.bookshelfManager.getAllInternalId();
        const excludedIds = bookshelfToEdit
            ? new Set([bookshelfToEdit.internalId, ...this.bookshelfManager.getDescendants(bookshelfToEdit.internalId).map(b => b.internalId)])
            : new Set();
        const candidates = this.bookshelfManager.getBookshelves().filter(b => !excludedIds.has(b.internalId));
        parentSelect.innerHTML = candidates
            .map(b => `<option value="${b.internalId}">${b.name}</option>`)
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
            slugInput.value = bookshelfToEdit.id || '';
            parentSelect.value = bookshelfToEdit.parent || allId || '';
            setIcon(bookshelfToEdit.iconName);
            descriptionInput.value = bookshelfToEdit.description || '';
            isPublicInput.checked = bookshelfToEdit.isPublic || false;
            if (pinnedInput) pinnedInput.checked = bookshelfToEdit.pinned || false;
            // 特殊本棚（all）は slug / 親変更不可
            if (bookshelfToEdit.isSpecial) {
                slugInput.readOnly = true;
                slugInput.title = '特殊本棚の slug は変更できません';
                parentSelect.disabled = true;
                parentSelect.title = '特殊本棚は親を持てません';
            } else {
                slugInput.readOnly = false;
                slugInput.title = '';
                parentSelect.disabled = false;
                parentSelect.title = '';
            }
        } else {
            title.innerHTML = `${titleIcon}新しい本棚`;
            if (typeof window.applyIcons === 'function') window.applyIcons(title);
            nameInput.value = '';
            slugInput.value = '';
            // Phase G: ツリーから「子本棚を追加」した場合は親を事前選択
            parentSelect.value = presetParentInternalId || allId || '';
            setIcon('library');
            descriptionInput.value = '';
            isPublicInput.checked = false;
            if (pinnedInput) pinnedInput.checked = false;
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
        const slugInput = document.getElementById('bookshelf-slug');
        const parentSelect = document.getElementById('bookshelf-parent');
        const iconNameInput = document.getElementById('bookshelf-icon-name');
        const descriptionInput = document.getElementById('bookshelf-description');
        const isPublicInput = document.getElementById('bookshelf-is-public');
        const pinnedInput = document.getElementById('bookshelf-pinned');

        const name = nameInput.value.trim();
        if (!name) {
            alert('本棚の名前を入力してください');
            nameInput.focus();
            return;
        }

        const slugRaw = slugInput.value.trim();
        const slug = slugRaw || this._generateDefaultSlug();
        if (!/^[a-z0-9_-]+$/.test(slug)) {
            alert('slug は英小文字・数字・ハイフン・アンダースコアのみ使えます');
            slugInput.focus();
            return;
        }

        const parentId = parentSelect.value || this.bookshelfManager.getAllInternalId();
        const meta = {
            name,
            slug,
            parent: parentId,
            iconName: iconNameInput.value.trim() || 'library',
            description: descriptionInput.value.trim(),
            isPublic: isPublicInput.checked,
            pinned: pinnedInput ? pinnedInput.checked : false
        };

        try {
            if (this.currentEditingBookshelf) {
                this.bookshelfManager.update(this.currentEditingBookshelf.internalId, meta);
                // slug 変更があれば rename（ファイル削除も走る）
                if (slug !== this.currentEditingBookshelf.id) {
                    await this.bookshelfManager.rename(this.currentEditingBookshelf.internalId, slug);
                }
            } else {
                this.bookshelfManager.create(meta);
            }
        } catch (e) {
            alert(`❌ ${e.message}`);
            return;
        }

        await this.saveUserData();
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

        const result = await this.bookshelfManager.remove(bookshelf.internalId, {
            confirmCallback: async (targets) => {
                if (targets.length === 1) {
                    return confirm(`📚 本棚「${bookshelf.name}」を削除しますか？\n\n⚠️ この操作は取り消せません。`);
                }
                const names = targets.map(t => `・${t.name}`).join('\n');
                return confirm(`📚 本棚「${bookshelf.name}」を削除しますか？\n\n⚠️ 子孫本棚もカスケード削除されます:\n${names}\n\nこの操作は取り消せません。`);
            }
        });

        if (!result) return;

        await this.saveUserData();
        this.updateBookshelfSelector();
        this.renderBookshelfList();

        if (this.currentBookshelf === bookshelfId) {
            this.currentBookshelf = 'all';
            this.applyFilters();
        }
    }

    async addBookToBookshelf(asin) {
        const bookshelfSelect = document.getElementById(`bookshelf-select-${asin}`);
        const bookshelfId = bookshelfSelect.value;

        if (!bookshelfId) {
            alert('📚 本棚を選択してください');
            return;
        }

        const bookshelf = this.bookshelfManager.getBySlug(bookshelfId);
        if (!bookshelf) {
            alert('❌ 本棚が見つかりません');
            return;
        }

        if ((bookshelf.books || []).includes(asin)) {
            alert(`📚 この本は既に「${bookshelf.name}」に追加済みです`);
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
        alert(`✅ 「${bookshelf.name}」に追加しました${ancestorMsg}${descendantMsg}`);
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
            alert('❌ 本棚が見つかりません');
            return;
        }
        // 特殊本棚（all）からの削除は permanent でないため excludeBook を案内
        if (bookshelf.isSpecial) {
            alert('🚫 「全ての本」から本を外すには「all から除外」ボタンを使ってください');
            return;
        }

        const book = this.books.find(b => b.asin === asin);
        const bookTitle = book ? book.title : 'この本';

        if (!bookshelf.books.includes(asin)) {
            alert(`📚 この本は「${bookshelf.name}」にありません`);
            return;
        }

        const descendants = this.bookshelfManager.getDescendants(bookshelf.internalId);
        const descendantsWithBook = descendants.filter(d => (d.books || []).includes(asin));

        let confirmMsg = `📚 「${bookTitle}」を「${bookshelf.name}」から除外しますか？\n\n⚠️ 本自体は削除されず、この本棚からのみ削除されます。`;
        if (descendantsWithBook.length > 0) {
            const names = descendantsWithBook.map(d => `・${d.name}`).join('\n');
            confirmMsg += `\n\n⚠️ 子孫本棚にも含まれているため、自動カスケード削除されます:\n${names}`;
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

        alert(`✅ 「${bookTitle}」を「${bookshelf.name}」から除外しました`);
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
            alert('❌ 指定された書籍が見つかりません');
            return;
        }
        if (!confirm(`🚫 「${book.title}」を all から除外しますか？\n\n再Kindle取込でも復活しません。\n除外一覧から解除できます。`)) {
            return;
        }
        this._excludeAsinCore(asin);
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
        this.books = this.bookManager.getAllBooks();

        await this.saveUserData();
        this.applyFilters();
        this.updateDisplay();
        this.updateStats();
        this.closeModal();
        alert(`✅ 「${book.title}」を除外しました`);
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
        this.applyFilters();
        this.updateDisplay();
        this.updateStats();
        this.renderExclusionsList();
    }

    /**
     * private/main.json + bookshelves.json の isPublic を元に public/main.json と public/settings.json を生成
     * 公開対象本棚のリストだけが含まれた main.json になる。手動で編集していた場合は上書き確認。
     */
    /**
     * 公開する: private/ のスナップショットを加工して同期先の public/ に書き出す。
     * 旧 copyToPublic + runPublicExport を統合した新仕様 (2026-05-31〜)。
     * - 別 picker での出力先選択は不要 (同期先内に書く)
     * - GitHub Adapter なら storage.syncBatch で 1 commit にまとまる
     */
    async publishToPublic() {
        if (!this._isSyncReady()) {
            alert('⚠️ 同期先 (ローカルフォルダ or GitHub) を選択してから操作してください');
            return;
        }
        if (this.syncMethod !== 'github' && this.obsidianDirHandle) {
            this.storage.setDirHandle(this.obsidianDirHandle);
        }

        // 公開対象本棚が 1 つ以上あるか軽くチェック
        const publicBookshelves = this.bookshelfManager.getBookshelves()
            .filter(b => b.isSpecial || b.isPublic);
        if (publicBookshelves.length === 0) {
            alert('⚠️ 公開対象の本棚が1つもありません。\n本棚編集で「📤 この本棚を公開する」をチェックしてください');
            return;
        }
        if (!confirm(`同期先の public/ 配下にスナップショットを書き出します。\n\n公開対象本棚: ${publicBookshelves.length} 個\n\nOK で実行 (GitHub モードなら 1 commit にまとまります)`)) {
            return;
        }

        // 編集中の変更を確実に書き出してから export
        await this.flushSync();

        try {
            const result = await this.exporter.export();
            const errSummary = result.errors.length > 0
                ? `\n\n⚠️ エラー ${result.errors.length} 件:\n${result.errors.slice(0, 3).join('\n')}${result.errors.length > 3 ? '\n...' : ''}`
                : '';
            alert(`✅ 公開スナップショット書き出し完了\n\n書籍: ${result.exported}冊\n本棚: ${result.bookshelves}個\n長文メモ: ${result.longMemos}件\nプラグイン: ${result.plugins.length}個\nファイル合計: ${result.entries}${errSummary}`);
        } catch (e) {
            console.error('公開エクスポートエラー:', e);
            alert(`❌ ${e.message}`);
        }
    }

    /**
     * 長文メモ books/<ASIN>__<title>.md を作成 / Obsidian で開く
     * 同期フォルダが vault 外の場合があるため、初回に vault 名・サブパスを設定で持つ
     */
    async openOrCreateBookMemo(asin) {
        if (!this._isSyncReady()) {
            alert('⚠️ 同期先 (ローカルフォルダ or GitHub) を選択してから操作してください。');
            return;
        }
        const book = this.books.find(b => b.asin === asin);
        if (!book) return;

        if (this.syncMethod !== 'github' && this.obsidianDirHandle) {
            this.storage.setDirHandle(this.obsidianDirHandle);
        }

        const settings = this.userData.settings || (this.userData.settings = {});
        const requestedOpenWith = settings.bookMemoOpenWith || 'app-editor';
        // GitHub モードでは外部リンクは動かない (ローカルファイル不在のため強制 app-editor)
        const openWith = (this.syncMethod === 'github') ? 'app-editor' : requestedOpenWith;

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
            alert(`❌ ファイル操作に失敗しました: ${e.message}`);
            return;
        }

        const fullPath = this.storage.bookMemoFullPath(asin, book.title); // private/books/...
        const folderName = (this.obsidianDirHandle && this.obsidianDirHandle.name) || '(同期先)';
        try { await navigator.clipboard.writeText(fullPath); } catch (_) {}

        if (openWith === 'obsidian') {
            // vault 名未設定なら初回プロンプト
            if (typeof settings.obsidianVaultName === 'undefined') {
                const vaultInput = prompt(
                    '📝 Obsidian で開くために vault 名を設定します\n\n同期フォルダが vault 自体: vault 名を入力\n同期フォルダが vault のサブフォルダ: vault 名を入力 (後でサブパスも聞きます)',
                    folderName
                );
                if (vaultInput && vaultInput.trim()) {
                    settings.obsidianVaultName = vaultInput.trim();
                    const subInput = prompt('vault 内のサブパス (例: 40_📖reading)\n空欄で vault 直下', '');
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
                if (confirm(`${created ? '✅ 詳細メモを作成しました' : '📝 詳細メモ'}\n\n📁 ${fullPath}\n（パスをクリップボードにコピー済）\n\nObsidian vault "${vaultName}" で開きますか？`)) {
                    window.location.href = obsidianUrl;
                }
            } else {
                alert(`📁 ${folderName}/${fullPath}\n（パスをクリップボードにコピー済）\n\nvault 名が未設定です。設定 → 長文メモ から「アプリ内エディタ」に切り替えるか、再度この操作で設定してください。`);
            }
        } else if (openWith === 'system') {
            alert(`📂 同期フォルダの ${fullPath} を OS のエクスプローラ等で開いてください。\n（パスはクリップボードにコピー済み）`);
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
        textareaEl.value = existing;

        modal.classList.add('show');

        if (typeof EasyMDE === 'undefined') {
            if (statusEl) statusEl.textContent = '❌ エディタライブラリが読み込まれていません (CDN 接続を確認)';
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
        if (statusEl) statusEl.textContent = '';
    }

    async saveBookMemoFromModal() {
        const ctx = this._bookMemoEditorContext;
        const editor = this._bookMemoEditor;
        const statusEl = document.getElementById('book-memo-status');
        if (!ctx || !editor) return;
        if (statusEl) statusEl.textContent = '💾 保存中...';
        try {
            const content = editor.value();
            await this.storage.writeBookMemo(ctx.asin, ctx.title, content);
            if (!this.userData.notes[ctx.asin]) this.userData.notes[ctx.asin] = { memo: '', rating: 0 };
            this.userData.notes[ctx.asin].hasDetailMemo = true;
            await this.saveUserData();
            if (statusEl) {
                statusEl.textContent = '✅ 保存しました';
                setTimeout(() => { if (statusEl.textContent.startsWith('✅')) statusEl.textContent = ''; }, 2500);
            }
        } catch (e) {
            console.error('長文メモ保存失敗:', e);
            if (statusEl) statusEl.textContent = `❌ ${e.message}`;
        }
    }

    closeBookMemoModal() {
        const modal = document.getElementById('book-memo-modal');
        if (modal) modal.classList.remove('show');
        if (this._bookMemoEditor) {
            try { this._bookMemoEditor.toTextArea(); } catch (_) {}
            this._bookMemoEditor = null;
        }
        this._bookMemoEditorContext = null;
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
                    ${image ? `<img src="${image}" alt="" style="width: 40px; height: 60px; object-fit: cover;">` : '<div style="width: 40px; height: 60px; background: #eee; display: flex; align-items: center; justify-content: center;">📖</div>'}
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
            alert('❌ 指定された書籍が見つかりません');
            return;
        }

        const confirmMessage = `🗑️ 書籍「${book.title}」を完全削除しますか？

⚠️ この操作は取り消せません。
📝 お気に入り、メモ、本棚からも削除されます。`;

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

            // 表示を更新
            this.books = this.bookManager.getAllBooks();
            this.applyFilters();
            this.updateStats();
            this.renderBookshelfOverview();

            // モーダルを閉じる
            this.closeModal();

            alert(`✅ 「${book.title}」を削除しました`);
        } catch (error) {
            console.error('削除エラー:', error);
            alert(`❌ 削除に失敗しました: ${error.message}`);
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

        // 本のリストを生成（フィルター機能付き）
        this.renderBookList(books, existingASINs);

        // イベントリスナーを追加
        this.setupBookSelectionListeners();
        this.updateSelectedCount();
    }

    renderBookList(books, existingASINs) {
        const bookList = document.getElementById('book-list');
        bookList.innerHTML = '';

        // フィルター設定を取得
        const hideExisting = document.getElementById('hide-existing-books').checked;

        let visibleCount = 0;
        books.forEach((book, index) => {
            const isExisting = existingASINs.has(book.asin);

            // フィルター適用: インポート済みを非表示にする場合はスキップ
            if (hideExisting && isExisting) {
                return;
            }

            visibleCount++;
            const bookItem = document.createElement('div');
            bookItem.className = `book-selection-item ${isExisting ? 'existing-book' : ''}`;
            bookItem.dataset.bookIndex = index;
            bookItem.innerHTML = `
                <input type="checkbox" id="book-${index}" value="${index}" ${isExisting ? 'disabled' : ''}>
                <div class="book-selection-info">
                    <div class="book-selection-title">${book.title} ${isExisting ? '(既にインポート済み)' : ''}</div>
                    <div class="book-selection-author">${book.authors}</div>
                    <div class="book-selection-meta">${new Date(book.acquiredTime).toLocaleDateString('ja-JP')}</div>
                </div>
            `;
            bookList.appendChild(bookItem);
        });

        // 表示件数を更新
        this.updateBookListStats(books.length, visibleCount, existingASINs.size);
    }

    updateBookListStats(totalBooks, visibleBooks, existingBooks) {
        // 統計情報を表示する要素を追加/更新
        let statsElement = document.getElementById('book-list-stats');
        if (!statsElement) {
            statsElement = document.createElement('div');
            statsElement.id = 'book-list-stats';
            statsElement.style.cssText = 'margin-bottom: 1rem; padding: 0.5rem; background: #f8f9fa; border-radius: 4px; font-size: 0.9rem; color: #6c757d;';
            document.getElementById('book-list').parentNode.insertBefore(statsElement, document.getElementById('book-list'));
        }

        const newBooks = totalBooks - existingBooks;
        statsElement.innerHTML = `
            📊 総数: ${totalBooks}冊 | 新規: ${newBooks}冊 | インポート済み: ${existingBooks}冊 | 表示中: ${visibleBooks}冊
        `;
    }
    
    setupBookSelectionListeners() {
        // フィルター変更時にリストを再描画
        document.getElementById('hide-existing-books').addEventListener('change', () => {
            const existingASINs = new Set(this.bookManager.getAllBooks().map(book => book.asin));
            this.renderBookList(this.pendingImportBooks, existingASINs);
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
        const selectedBooks = selectedIndices.map(index => this.pendingImportBooks[index]);
        
        if (selectedBooks.length === 0) {
            alert('📚 インポートする本を選択してください');
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
            alert(`❌ インポートに失敗しました: ${error.message}`);
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
            alert('📖 タイトルは必須です');
            return;
        }

        // オリジナルASINの妥当性チェック
        if (!newOriginalAsin || !this.bookManager.isValidASIN(newOriginalAsin)) {
            alert('🔖 オリジナルASINは10桁の英数字で入力してください（例: B07ABC1234）');
            return;
        }

        // 変更後ASINの妥当性チェック
        if (newUpdatedAsin && !this.bookManager.isValidASIN(newUpdatedAsin)) {
            alert('🔗 変更後ASINは10桁の英数字で入力してください（例: B07ABC1234）');
            return;
        }

        // オリジナルASINが変更された場合の重複チェック
        if (newOriginalAsin !== asin) {
            const existingBook = this.books.find(book => book.asin === newOriginalAsin);
            if (existingBook) {
                alert('🔖 このオリジナルASINは既に使用されています');
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
                // 新しいASINで画像URLも更新
                updateData.productImage = `https://images-na.ssl-images-amazon.com/images/P/${newUpdatedAsin}.01.L.jpg`;
            } else {
                // 変更後ASINが削除された場合、プロパティを削除
                updateData.updatedAsin = undefined;
                // 元のASIN（変更された可能性がある）で画像URLを復元
                updateData.productImage = `https://images-na.ssl-images-amazon.com/images/P/${newOriginalAsin}.01.L.jpg`;
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

                alert('✅ 本の情報を更新しました');

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
            alert(`❌ 更新に失敗しました: ${error.message}`);
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
            alert('📁 ファイルを選択してください');
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
            alert(`❌ ファイルの読み込みに失敗しました: ${error.message}`);
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
                        <div style="font-weight:600;">${manifest.name || id} <span style="color:#888; font-weight:normal; font-size:0.85rem;">v${manifest.version || '?'} ${manifest.publishable ? '🌐' : ''}</span></div>
                        <div style="font-size:0.85rem; color:#666;">${manifest.description || ''}</div>
                        <div class="plugin-status"></div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                        <label style="display:flex; gap:0.3rem; align-items:center; font-size:0.85rem;">
                            <input type="checkbox" data-toggle-plugin="${id}" ${enabled ? 'checked' : ''}> 有効
                        </label>
                        <button class="btn btn-secondary btn-small" data-uninstall-plugin="${id}">🗑️ 削除</button>
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
        if (failure) html += `<div style="font-size:0.8rem; color:#c00;">⚠️ ${failure}</div>`;
        if (loaded) html += '<div style="font-size:0.8rem; color:#0a0;">✓ 読み込み済み（リロード不要で有効）</div>';
        statusEl.innerHTML = html;
    }

    async installPluginFromInput() {
        const input = document.getElementById('plugin-repo-url');
        const url = (input.value || '').trim();
        if (!url) {
            alert('GitHub の repo URL を入力してください');
            return;
        }
        if (!this._isSyncReady()) {
            alert('同期先 (ローカルフォルダ or GitHub) を先に接続してください');
            return;
        }
        try {
            const manifest = await this.pluginLoader.installFromGitHub(url);
            if (manifest) {
                alert(`✅ ${manifest.name || manifest.id} v${manifest.version || '?'} をインストールしました`);
                await this._renderPluginsList();
                // ヘッダーカスタマイザに新規プラグインを反映
                this._renderHeaderCustomizer();
                this._applyHeaderLayout();
                input.value = '';
            }
        } catch (e) {
            alert(`❌ インストール失敗: ${e.message}`);
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
            alert(`❌ 削除失敗: ${e.message}`);
        }
    }

    /**
     * Amazon Kindle ライブラリページで実行されるブックマークレットのコードを生成
     * - window.csrfToken と認証 cookie を使って Amazon の内部 API を叩く
     * - 結果は window.opener.postMessage で bookshelf 側に返す
     * - opener が無い場合はクリップボードに JSON コピー（フォールバック）
     */
    _buildKindleBookmarkletCode() {
        const code = `(async()=>{try{var c=window.csrfToken;if(!c){alert('Amazon Kindle一覧ページ (digital-console/contentlist/booksAll) で実行してください');return;}var items=[],s=0,t=Number.MAX_SAFE_INTEGER;while(items.length<t){var p=JSON.stringify({contentType:"Ebook",contentCategoryReference:"booksAll",itemStatusList:["Active"],showSharedContent:true,fetchCriteria:{sortOrder:"DESCENDING",sortIndex:"DATE",startIndex:s,batchSize:100,totalContentCount:-1},surfaceType:"Desktop"});var r=await fetch("https://www.amazon.co.jp/hz/mycd/digital-console/ajax",{headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({activity:"GetContentOwnershipData",activityInput:p,csrfToken:c}),method:"POST",credentials:"include"});var j=await r.json();if(j.success===false)throw new Error(JSON.stringify(j.error));var d=j.GetContentOwnershipData;t=d.numberOfItems;s+=100;items.push.apply(items,d.items);}var pl=items.map(function(i){return{title:i.title,authors:i.authors,acquiredTime:i.acquiredTime,readStatus:i.readStatus,asin:i.asin,productImage:i.productImage};});if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'kindleBookshelfExport',ok:true,items:pl},'*');try{window.close();}catch(_){alert('✅ '+pl.length+'冊を bookshelf に送信しました。このタブは閉じてください。');}}else{await navigator.clipboard.writeText(JSON.stringify(pl));alert('✅ '+pl.length+'冊取得。クリップボードにコピーしました。bookshelf を「Amazon ライブラリページを開く」経由で開いているか確認してください。');}}catch(e){console.error(e);if(window.opener&&!window.opener.closed){window.opener.postMessage({type:'kindleBookshelfExport',ok:false,error:e.message||String(e)},'*');}else{alert('❌ 失敗: '+(e.message||e));}}})();`;
        return 'javascript:' + encodeURIComponent(code);
    }

    async copyKindleBookmarklet() {
        const bm = this._buildKindleBookmarkletCode();
        try {
            await navigator.clipboard.writeText(bm);
            alert('📋 ブックマークレットをクリップボードにコピーしました。\n\n手順:\n1. ブラウザのブックマークバーを右クリック → 「ページを追加」\n2. 名前を「Kindle取込」など\n3. URL 欄に Ctrl+V でペースト\n4. 保存\n\n以後はこのブックマークレットを Amazon ライブラリページで1クリックするだけで取込できます。');
        } catch (e) {
            // clipboard 失敗時は textarea で表示
            prompt('クリップボードに自動コピーできませんでした。以下を全選択 (Ctrl+A) → コピー (Ctrl+C) してブックマークの URL に貼り付けてください:', bm);
        }
    }

    openAmazonForBookmarklet() {
        if (this._kindleImportInFlight) {
            alert('⏳ 既に取込中です。新しいタブの完了を待ってください。');
            return;
        }
        // URL に ?bookshelfImport=1 を付けると拡張 (kindle_bookshelf_exporter v0.9.5+) が
        // 自動 collect → postMessage → close を行う。拡張未インストールでも Amazon ページは
        // 普通に開かれるので、ユーザはブックマークレットを手動でクリックすればフォールバックできる。
        const url = 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/?bookshelfImport=1';
        const win = window.open(url, '_blank');
        if (!win) {
            alert('🚫 ポップアップがブロックされました。\nブラウザのポップアップを許可してから再試行してください。');
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
                alert(`❌ Kindle 取込に失敗しました: ${data.error || '不明なエラー'}`);
                return;
            }
            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) {
                alert('⚠️ 取込対象の本がありませんでした。');
                return;
            }

            this.showImportModal();
            this.showBookSelectionForImport(items, 'bookmarklet');
        };

        window.addEventListener('message', handler);

        // 拡張なら数秒〜数十秒で完了、ブックマークレット手動なら長め必要 → 15 分待機
        timer = setTimeout(() => {
            cleanup();
            alert('⏱️ Kindle 取込タイムアウト（15分）。\n\n拡張 (kindle_bookshelf_exporter) インストール済みなら自動取込されるはずです。\nインストールしていない場合は Amazon ページでブックマークレットを手動クリックしてください。\nブックマークレット登録は「📋 ブックマークレットをコピー」から行えます。');
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
                    ✅ インポートが完了しました。新規追加: ${results.added}冊、更新: ${results.updated}冊
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
        
        alert(`⚠️ 書籍情報の自動取得に失敗しました。\nASIN: ${asin}\n\n手動でタイトルと著者を入力してください。`);
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
        this.showASINStatus('loading', '📥 書籍情報を取得中...');
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
                this.showASINStatus('success', `✅ 自動取得成功: ${bookData.title}`);
            } else {
                this.showASINStatus('error', '❌ 情報取得できませんでした。手動で入力してください。');
                // 自動取得失敗の場合、タイトルフィールドにフォーカス
                titleInput.focus();
            }

        } catch (error) {
            console.error('書籍情報取得エラー:', error);
            this.showASINStatus('error', '❌ 取得に失敗しました。手動で入力してください。');
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
            alert('📝 ASINを入力してください');
            return;
        }

        if (!title) {
            alert('📝 タイトルを入力してください');
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
            this.applyFilters();
            this.updateStats();

        } catch (error) {
            console.error('追加エラー:', error);
            alert(`❌ 追加に失敗しました: ${error.message}`);
        }
    }

    /**
     * 書籍追加成功を表示
     */
    showAddBookSuccess(book) {
        const resultsDiv = document.getElementById('add-book-results');
        resultsDiv.innerHTML = `
            <div class="add-success">
                <h3>✅ 書籍を追加しました</h3>
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
        const exportData = this.buildExportData();
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'library.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('📦 library.json をエクスポートしました！');
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

    toggleBookshelfDisplay() {
        this.showImagesInOverview = !this.showImagesInOverview;
        this.userData.settings.showImagesInOverview = this.showImagesInOverview;
        this.saveUserData();
        this._updateOverviewDisplayButton();
        this.renderBookshelfOverview();
    }

    _updateOverviewDisplayButton() {
        const buttons = document.querySelectorAll('[data-header-item="overview-display"] button, #overview-display-toggle');
        buttons.forEach(btn => {
            const stateKey = this.showImagesInOverview ? 'overview-display:images' : 'overview-display:text';
            const fallback = this.showImagesInOverview ? 'list' : 'image';
            const override = this.getHeaderIconOverride(stateKey);
            const effectiveIcon = override || fallback;
            btn.innerHTML = window.renderIcon(effectiveIcon, { size: 20 });
            btn.dataset.iconValue = effectiveIcon;
            btn.removeAttribute('data-icon');
            btn.title = this.showImagesInOverview ? 'テキストのみ表示に切替' : '画像表示に切替';
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
        const description = bookshelf.description || (isSpecial ? '除外していない全ての蔵書' : '');
        const isPublic = bookshelf.isPublic || false;
        const publicBadge = isPublic
            ? `<span class="public-badge"><span class="h-icon">${window.renderIcon('upload-cloud', { size: 12 })}</span>公開中</span>`
            : '';

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
                    <h3><span class="bs-card-icon" data-icon-value="${cardEffectiveIcon.replace(/"/g,'&quot;')}">${iconSvg}</span>${name} ${publicBadge}</h3>
                </div>
                <p class="bs-card-desc">${description}</p>
                <p class="book-count">${bookCount}冊</p>
                <div class="bookshelf-preview-books">${previewHtml}</div>
            </div>
        `;
    }

    showError(message) {
        const bookshelf = document.getElementById('bookshelf');
        bookshelf.innerHTML = `<div class="error-message">❌ ${message}</div>`;
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
            loading.style.display = 'block';
        }
    }

    hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = 'none';
        }
    }

    setupBookshelfDragAndDrop(container) {
        let draggedBookshelf = null;

        container.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('bookshelf-item')) {
                draggedBookshelf = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', e.target.dataset.id);
            }
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const target = e.target.closest('.bookshelf-item');
            if (target && target !== draggedBookshelf) {
                target.style.borderTop = '2px solid #3498db';
            }
        });

        container.addEventListener('dragleave', (e) => {
            const target = e.target.closest('.bookshelf-item');
            if (target) {
                target.style.borderTop = '';
            }
        });

        container.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const target = e.target.closest('.bookshelf-item');
            if (target && target !== draggedBookshelf) {
                const draggedId = draggedBookshelf.dataset.id;
                const targetId = target.dataset.id;
                this.reorderBookshelves(draggedId, targetId);
            }

            // Clear all visual feedback
            container.querySelectorAll('.bookshelf-item').forEach(item => {
                item.style.borderTop = '';
            });
        });

        container.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('bookshelf-item')) {
                e.target.classList.remove('dragging');
                draggedBookshelf = null;
            }
            
            // Clear all visual feedback
            container.querySelectorAll('.bookshelf-item').forEach(item => {
                item.style.borderTop = '';
            });
        });
    }

    reorderBookshelves(draggedId, targetId) {
        const draggedIndex = this.userData.bookshelves.findIndex(b => b.id === draggedId);
        const targetIndex = this.userData.bookshelves.findIndex(b => b.id === targetId);

        if (draggedIndex !== -1 && targetIndex !== -1) {
            // Remove the dragged bookshelf from its current position
            const draggedBookshelf = this.userData.bookshelves.splice(draggedIndex, 1)[0];
            
            // Insert it at the new position
            this.userData.bookshelves.splice(targetIndex, 0, draggedBookshelf);
            
            // Save the changes
            this.saveUserData();
            this.updateBookshelfSelector();
            this.renderBookshelfList();
            
            console.log(`📚 本棚「${draggedBookshelf.name}」を移動しました`);
        }
    }

}

// Lazy Loading for Images
class LazyLoader {
    constructor() {
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        this.observer.unobserve(img);
                    }
                });
            },
            { rootMargin: '50px' }
        );
    }

    observe() {
        document.querySelectorAll('.lazy').forEach(img => {
            this.observer.observe(img);
        });
    }
}

// Global utility functions
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            alert('URLをクリップボードにコピーしました！');
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
        alert('URLをクリップボードにコピーしました！');
    } catch (err) {
        console.error('Failed to copy: ', err);
        alert('コピーに失敗しました。手動でURLを選択してコピーしてください。');
    }
    document.body.removeChild(textArea);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.bookshelf = new VirtualBookshelf();
    window.lazyLoader = new LazyLoader();

    // Bookshelf management event listeners are handled in setupEventListeners

    // Set up mutation observer to handle dynamically added images
    const mutationObserver = new MutationObserver(() => {
        window.lazyLoader.observe();
    });

    mutationObserver.observe(document.getElementById('bookshelf'), {
        childList: true,
        subtree: true
    });
});