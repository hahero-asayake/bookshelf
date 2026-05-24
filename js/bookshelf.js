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
        this.seriesGroupingEnabled = false;
        this.storage = new BookshelfStorage();
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
            this.updateBookshelfSelector();
            this.updateSortDirectionButton();
            this.renderBookshelfOverview();
            this.updateDisplay();
            this.updateStats();

            // Initialize HighlightsManager after bookshelf is ready
            window.highlightsManager = new HighlightsManager(this);

            // Initialize SeriesManager
            window.seriesManager = new SeriesManager();

            // Obsidian folder sync は private モードのみ
            if (!this.isPublicMode) {
                await this.initObsidianSync();
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

            // プラグイン読み込み（同期フォルダ接続済み + 設定読み込み済みのタイミング）
            if (this.pluginLoader) {
                try {
                    await this.pluginLoader.loadEnabledPlugins();
                } catch (e) {
                    console.warn('プラグイン読み込み中にエラー:', e);
                }
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

        const [main, settings, library, bookshelvesMeta, allBookshelf, notesFile] = await Promise.all([
            fetchJSON('data/main.json').catch(() => ({})),
            fetchJSON('data/settings.json').catch(() => ({})),
            fetchJSON('data/library.json').catch(() => ({ books: [] })),
            fetchJSON('data/bookshelves.json').catch(() => ({ bookshelves: [] })),
            fetchJSON('data/bookshelves/all.json').catch(() => null),
            fetchJSON('data/notes.json').catch(() => ({ notes: {} }))
        ]);

        const bookshelfFiles = {};
        for (const meta of (bookshelvesMeta.bookshelves || [])) {
            if (meta.slug === 'all') continue;
            try {
                const data = await fetchJSON(`data/bookshelves/${meta.slug}.json`);
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

        // 初期化が必要だが Obsidian sync しないので、StaticBookshelfGenerator など
        this.staticGenerator = new StaticBookshelfGenerator(this.bookManager, this.userData);
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

        // Initialize Static Bookshelf Generator after userData is fully loaded
        this.staticGenerator = new StaticBookshelfGenerator(this.bookManager, this.userData);

        this.applyFilters();
    }

    setupEventListeners() {
        // View toggle buttons
        document.getElementById('view-covers').addEventListener('click', () => this.setView('covers'));
        document.getElementById('view-list').addEventListener('click', () => this.setView('list'));

        
        // Search
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.search(e.target.value);
        });
        
        // Filters
        
        
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

        // Bookshelf selector
        document.getElementById('bookshelf-selector').addEventListener('change', (e) => {
            this.switchBookshelf(e.target.value);
            this.updateStaticPageButton(e.target.value);
        });

        // Static page button
        const viewStaticPageBtn = document.getElementById('view-static-page');
        if (viewStaticPageBtn) {
            viewStaticPageBtn.addEventListener('click', () => this.openStaticPage());
        }

        // Export button
        document.getElementById('export-unified').addEventListener('click', () => {
            this.exportUnifiedData();
        });

        // Obsidian folder sync button
        const obsidianSyncBtn = document.getElementById('obsidian-sync-btn');
        if (obsidianSyncBtn) {
            obsidianSyncBtn.addEventListener('click', () => {
                if (this.obsidianDirHandle) {
                    this.reloadFromObsidianFile();
                } else {
                    this.selectObsidianFolder();
                }
            });
        }

        // Series grouping toggle
        const seriesGroupingCheckbox = document.getElementById('series-grouping');
        if (seriesGroupingCheckbox) {
            seriesGroupingCheckbox.addEventListener('change', e => {
                this.seriesGroupingEnabled = e.target.checked;
                this.applyFilters();
                this.updateDisplay();
            });
        }

        // Bookshelf management
        const manageBookshelves = document.getElementById('manage-bookshelves');
        if (manageBookshelves) {
            manageBookshelves.addEventListener('click', () => {
                this.showBookshelfManager();
            });
        }

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

        // Plugin manager
        const managePluginsBtn = document.getElementById('manage-plugins');
        if (managePluginsBtn) {
            managePluginsBtn.addEventListener('click', () => this.showPluginsModal());
        }
        const pluginsClose = document.getElementById('plugins-modal-close');
        if (pluginsClose) {
            pluginsClose.addEventListener('click', () => this.closePluginsModal());
        }
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

        // Bookshelf display toggle
        const toggleBtn = document.getElementById('toggle-bookshelf-display');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggleBookshelfDisplay();
            });
        }

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

        // Clear library button
        document.getElementById('clear-library').addEventListener('click', () => {
            this.clearLibrary();
        });

        // Exclusions modal
        const showExclusionsBtn = document.getElementById('show-exclusions');
        if (showExclusionsBtn) {
            showExclusionsBtn.addEventListener('click', () => this.showExclusionsModal());
        }
        const exclusionsModalClose = document.getElementById('exclusions-modal-close');
        if (exclusionsModalClose) {
            exclusionsModalClose.addEventListener('click', () => this.closeExclusionsModal());
        }

        // Copy to public
        const copyToPublicBtn = document.getElementById('copy-to-public');
        if (copyToPublicBtn) {
            copyToPublicBtn.addEventListener('click', () => this.copyToPublic());
        }
        // Run export
        const runExportBtn = document.getElementById('run-export');
        if (runExportBtn) {
            runExportBtn.addEventListener('click', () => this.runPublicExport());
        }
        // Pick export dir
        const pickExportDirBtn = document.getElementById('pick-export-dir');
        if (pickExportDirBtn) {
            pickExportDirBtn.addEventListener('click', () => this.pickExportDir());
        }

        // Static share modal
        const staticShareModalClose = document.getElementById('static-share-modal-close');
        if (staticShareModalClose) {
            staticShareModalClose.addEventListener('click', () => this.closeStaticShareModal());
        }

        const generateStaticPageBtn = document.getElementById('generate-static-page');
        if (generateStaticPageBtn) {
            generateStaticPageBtn.addEventListener('click', () => this.generateStaticPage());
        }

        const cancelStaticShareBtn = document.getElementById('cancel-static-share');
        if (cancelStaticShareBtn) {
            cancelStaticShareBtn.addEventListener('click', () => this.closeStaticShareModal());
        }

        // Event delegation for modal content
        document.addEventListener('click', (e) => {
            // 編集モード切り替え
            if (e.target.classList.contains('edit-mode-btn')) {
                const asin = e.target.dataset.asin;
                const book = this.books.find(b => b.asin === asin);
                if (book) {
                    this.showBookDetail(book, true);
                }
            }

            // 編集キャンセル
            if (e.target.classList.contains('cancel-edit-btn')) {
                const asin = e.target.dataset.asin;
                const book = this.books.find(b => b.asin === asin);
                if (book) {
                    this.showBookDetail(book, false);
                }
            }
        });
    }

    setView(view) {
        this.currentView = view;
        
        // Update button states
        document.querySelectorAll('.view-toggle .btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`view-${view}`).classList.add('active');
        
        this.updateDisplay();
        this.saveUserData();
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
            // Bookshelf filter
            if (this.currentBookshelf && this.currentBookshelf !== 'all') {
                const bookshelf = this.userData.bookshelves?.find(b => b.id === this.currentBookshelf);
                if (bookshelf && bookshelf.books && !bookshelf.books.includes(book.asin)) {
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
        
        // Series grouping: show only representative book per series
        if (this.seriesGroupingEnabled && window.seriesManager) {
            const { seriesGroups, bookToSeriesMap } = window.seriesManager.detectAndGroupSeries(this.books);
            const representativeAsins = new Set(seriesGroups.map(s => s.representativeBook.asin));
            this.filteredBooks = this.filteredBooks.filter(book => {
                const inSeries = bookToSeriesMap.has(book.asin);
                return !inSeries || representativeAsins.has(book.asin);
            });
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
    
    updateSortDirectionButton() {
        const button = document.getElementById('sort-direction');
        
        if (this.sortOrder === 'custom') {
            button.textContent = '📝 カスタム順';
            button.disabled = true;
            button.style.opacity = '0.5';
        } else {
            button.disabled = false;
            button.style.opacity = '1';
            
            // 並び順の種類に応じてテキストを変更
            if (this.sortOrder === 'acquiredTime') {
                // 時系列・状態の場合
                if (this.sortDirection === 'asc') {
                    button.textContent = '↑ 古い順';
                } else {
                    button.textContent = '↓ 新しい順';
                }
            } else {
                // 文字列（タイトル・著者）の場合
                if (this.sortDirection === 'asc') {
                    button.textContent = '↑ 昇順（A→Z）';
                } else {
                    button.textContent = '↓ 降順（Z→A）';
                }
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
        const currentBookshelfId = document.getElementById('bookshelf-selector').value;
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
        
        if (displayType === 'cover' || displayType === 'covers') {
            const amazonUrl = this.bookManager.getAmazonUrl(book, this.userData.settings.affiliateId);
            bookElement.innerHTML = `
                <div class="book-cover-container">
                    <div class="drag-handle">⋮⋮</div>
                    <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer" class="book-cover-link">
                        ${book.productImage ?
                            `<img class="book-cover lazy" data-src="${this.escapeHtml(this.bookManager.getProductImageUrl(book))}" alt="${this.escapeHtml(book.title)}">` :
                            `<div class="book-cover-placeholder">${this.escapeHtml(book.title)}</div>`
                        }
                    </a>
                </div>
                <div class="book-info">
                    <div class="book-title">${this.escapeHtml(book.title)}</div>
                    <div class="book-author">${this.escapeHtml(book.authors)}</div>
                    <div class="book-links">
                        <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer" class="book-link amazon-link">Amazon</a>
                        <a href="#" class="book-link detail-link" data-asin="${book.asin}">詳細</a>
                    </div>
                    ${userNote && userNote.memo ? `<div class="book-memo">📝 ${this.formatMemoForDisplay(userNote.memo, 300)}</div>` : ''}
                    ${this.displayStarRating(userNote?.rating)}
                </div>
            `;
        } else {
            const amazonUrl = this.bookManager.getAmazonUrl(book, this.userData.settings.affiliateId);
            bookElement.innerHTML = `
                <div class="book-cover-container">
                    <div class="drag-handle">⋮⋮</div>
                    <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer" class="book-cover-link">
                        ${book.productImage ?
                            `<img class="book-cover lazy" data-src="${this.escapeHtml(this.bookManager.getProductImageUrl(book))}" alt="${this.escapeHtml(book.title)}">` :
                            '<div class="book-cover-placeholder">📖</div>'
                        }
                    </a>
                </div>
                <div class="book-info">
                    <div class="book-title">${book.title}</div>
                    <div class="book-author">${book.authors}</div>
                    <div class="book-links">
                        <a href="${amazonUrl}" target="_blank" rel="noopener noreferrer" class="book-link amazon-link">Amazon</a>
                        <a href="#" class="book-link detail-link" data-asin="${book.asin}">詳細</a>
                    </div>
                    ${userNote && userNote.memo ? `<div class="book-memo">📝 ${this.formatMemoForDisplay(userNote.memo, 400)}</div>` : ''}
                    ${this.displayStarRating(userNote?.rating)}

                </div>
            `;
        }
        
        // Add drag event listeners
        bookElement.addEventListener('dragstart', (e) => this.handleDragStart(e));
        bookElement.addEventListener('dragover', (e) => this.handleDragOver(e));
        bookElement.addEventListener('drop', (e) => this.handleDrop(e));
        bookElement.addEventListener('dragend', (e) => this.handleDragEnd(e));
        
        bookElement.addEventListener('click', (e) => {
            // Prevent click when dragging or clicking drag handle
            if (e.target.closest('.drag-handle') || bookElement.classList.contains('dragging')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Only show detail if clicking the detail link
            if (e.target.classList.contains('detail-link')) {
                e.preventDefault();
                e.stopPropagation();
                this.showBookDetail(book);
                return;
            }

            // Prevent default click behavior for other elements
            if (!e.target.closest('a')) {
                e.preventDefault();
                e.stopPropagation();
            }
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
        const currentBookshelfId = document.getElementById('bookshelf-selector').value;
        
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

    _currentBookshelfInternalId() {
        if (!this.currentBookshelf || this.currentBookshelf === 'all') return null;
        const bs = this.bookshelfManager.getBySlug(this.currentBookshelf);
        return bs ? bs.internalId : null;
    }

    showBookDetail(book, isEditMode = false) {
        const modal = document.getElementById('book-modal');
        const modalBody = document.getElementById('modal-body');

        const isHidden = this.userData.hiddenBooks && this.userData.hiddenBooks.includes(book.asin);
        const contextInternalId = this._currentBookshelfInternalId();
        const allRecord = this.userData.notes[book.asin] || {};
        const resolvedMemo = this.bookshelfManager.resolveMemo(book.asin, contextInternalId);
        const userNote = {
            memo: resolvedMemo,
            rating: this.bookshelfManager.resolveRating(book.asin),
            hasDetailMemo: allRecord.hasDetailMemo || false
        };
        const memoIsInherited = contextInternalId && resolvedMemo && (() => {
            const bs = this.bookshelfManager.getById(contextInternalId);
            return !(bs && bs.notes && bs.notes[book.asin] && bs.notes[book.asin].memo);
        })();
        const contextLabel = (() => {
            if (!contextInternalId) return null;
            const bs = this.bookshelfManager.getById(contextInternalId);
            return bs ? `${bs.emoji || '📚'} ${bs.name}` : null;
        })();
        const amazonUrl = this.bookManager.getAmazonUrl(book, this.userData.settings.affiliateId);

        modalBody.innerHTML = `
            <div class="book-detail">
                <div class="book-detail-header">
                    ${book.productImage ?
                        `<img class="book-detail-cover" src="${this.bookManager.getProductImageUrl(book)}" alt="${book.title}">` :
                        '<div class="book-detail-cover-placeholder">📖</div>'
                    }
                    <div class="book-detail-info">
                        <div class="book-info-section" ${isEditMode ? 'style="display: none;"' : ''}>
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                                <h2 style="margin: 0; color: #2c3e50; flex: 1;">${book.title}</h2>
                                <button class="btn btn-primary edit-mode-btn" data-asin="${book.asin}" style="margin-left: 1rem; padding: 0.5rem 1rem; font-size: 0.9rem;">✏️ 編集</button>
                            </div>
                            <p style="margin: 0 0 0.5rem 0; color: #7f8c8d;"><strong>著者:</strong> ${book.authors}</p>
                            <p style="margin: 0 0 0.5rem 0; color: #7f8c8d;"><strong>購入日:</strong> ${new Date(book.acquiredTime).toLocaleDateString('ja-JP')}</p>
                            <p style="margin: 0 0 0.5rem 0; color: #7f8c8d;"><strong>ASIN:</strong> ${book.asin}</p>
                            ${book.updatedAsin ? `<p style="margin: 0 0 0.5rem 0; color: #7f8c8d;"><strong>変更後ASIN:</strong> ${book.updatedAsin}</p>` : ''}
                        </div>
                        <div class="book-edit-section" ${!isEditMode ? 'style="display: none;"' : ''}>
                            <div class="edit-field">
                                <label>📖 タイトル</label>
                                <input type="text" class="edit-title" data-asin="${book.asin}" value="${book.title}" />
                            </div>
                            <div class="edit-field">
                                <label>✍️ 著者</label>
                                <input type="text" class="edit-authors" data-asin="${book.asin}" value="${book.authors}" />
                            </div>
                            <div class="edit-field">
                                <label>📅 購入日</label>
                                <input type="date" class="edit-acquired-time" data-asin="${book.asin}" value="${new Date(book.acquiredTime).toISOString().split('T')[0]}" />
                            </div>
                            <div class="edit-field">
                                <label>🔖 オリジナルASIN</label>
                                <input type="text" class="edit-original-asin" data-asin="${book.asin}" value="${book.asin}" maxlength="10" pattern="[A-Z0-9]{10}" />
                                <small class="field-help">※ 元のASIN（通常は変更不要）</small>
                            </div>
                            <div class="edit-field">
                                <label>🔗 変更後ASIN（オプション）</label>
                                <input type="text" class="edit-updated-asin" data-asin="${book.asin}" value="${book.updatedAsin || ''}" placeholder="新しいASINがある場合のみ入力" maxlength="10" pattern="[A-Z0-9]{10}" />
                                <small class="field-help">※ Amazonで商品のASINが変更された場合の新しいASINを入力</small>
                            </div>
                            <div class="edit-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
                                <button class="btn btn-small save-book-changes" data-asin="${book.asin}">💾 変更を保存</button>
                                <button class="btn btn-small btn-secondary cancel-edit-btn" data-asin="${book.asin}">❌ キャンセル</button>
                            </div>
                        </div>

                        
                        <div class="book-actions">
                            <a class="amazon-link" href="${amazonUrl}" target="_blank" rel="noopener">
                                📚 Amazonで見る
                            </a>
                            <button class="btn btn-secondary memo-file-btn" data-asin="${book.asin}" style="${isEditMode ? '' : 'display: none;'}">
                                📝 ${userNote.hasDetailMemo ? '詳細メモを開く' : '詳細メモを書く'}
                            </button>
                            <button class="btn btn-warning exclude-btn" data-asin="${book.asin}" style="${isEditMode ? '' : 'display: none;'}">
                                🚫 all から除外
                            </button>
                            <button class="btn btn-danger delete-btn" data-asin="${book.asin}" style="${isEditMode ? '' : 'display: none;'}">
                                🗑️ 本を削除
                            </button>
                        </div>
                        
                        <div class="bookshelf-actions" style="margin-top: 1rem; ${isEditMode ? '' : 'display: none;'}">
                            <div style="margin-bottom: 1rem;">
                                <label for="bookshelf-select-${book.asin}">📚 本棚に追加:</label>
                                <select id="bookshelf-select-${book.asin}" class="bookshelf-select">
                                    <option value="">本棚を選択...</option>
                                    ${this.userData.bookshelves ? this.userData.bookshelves.map(bs => 
                                        `<option value="${bs.id}">${bs.emoji || '📚'} ${bs.name}</option>`
                                    ).join('') : ''}
                                </select>
                                <button class="btn btn-secondary add-to-bookshelf" data-asin="${book.asin}">追加</button>
                            </div>
                            
                            <div class="current-bookshelves">
                                <label>📚 現在の本棚:</label>
                                <div id="current-bookshelves-${book.asin}">
                                    ${this.userData.bookshelves ? this.userData.bookshelves
                                        .filter(bs => bs.books && bs.books.includes(book.asin))
                                        .map(bs => `
                                            <div class="bookshelf-item" style="display: inline-flex; align-items: center; margin: 0.25rem; padding: 0.25rem 0.5rem; background-color: #f0f0f0; border-radius: 4px;">
                                                <span>${bs.emoji || '📚'} ${bs.name}</span>
                                                <button class="btn btn-small btn-danger remove-from-bookshelf" 
                                                        data-asin="${book.asin}" 
                                                        data-bookshelf-id="${bs.id}" 
                                                        style="margin-left: 0.5rem; padding: 0.125rem 0.25rem; font-size: 0.75rem;">
                                                    ❌
                                                </button>
                                            </div>
                                        `).join('') : ''}
                                </div>
                                ${this.userData.bookshelves && this.userData.bookshelves.filter(bs => bs.books && bs.books.includes(book.asin)).length === 0 ? 
                                    '<p style="color: #888; font-style: italic; margin: 0.5rem 0;">この本はまだどの本棚にも追加されていません</p>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="book-notes-section" style="${!isEditMode && !userNote.memo ? 'display: none;' : ''}">
                    <h3>📝 個人メモ${contextLabel ? ` <span style="font-size: 0.8rem; color: #888;">（コンテキスト: ${contextLabel}）</span>` : ''}</h3>
                    ${memoIsInherited ? `<p style="margin: 0 0 0.5rem; color: #888; font-size: 0.85rem;">💡 親または all から継承中。編集するとこの本棚専用のメモになります（親には影響しません）。</p>` : ''}
                    ${!isEditMode && userNote.memo ? `
                        <div class="note-display" style="background: #f8f9fa; padding: 1rem; border-radius: 8px; border-left: 4px solid #007bff;">${this.convertMarkdownLinksToHtml(userNote.memo)}</div>
                    ` : ''}
                    <textarea class="note-textarea large-textarea" data-asin="${book.asin}" rows="6" placeholder="この本についてのメモやおすすめポイントを記入...&#10;&#10;改行も使えます。" style="${isEditMode ? '' : 'display: none;'}">${userNote.memo || ''}</textarea>
                    <div class="note-preview" style="${isEditMode ? (userNote.memo ? 'display: block;' : 'display: none;') : 'display: none;'}">
                        <h4>📄 プレビュー</h4>
                        <div class="note-preview-content">${isEditMode && userNote.memo ? this.convertMarkdownLinksToHtml(userNote.memo) : ''}</div>
                    </div>
                    ${isEditMode && (() => {
                        // 子孫がいる本棚 or all コンテキストなら「子孫にも反映」チェック表示
                        if (!contextInternalId) {
                            return this.bookshelfManager.getBookshelves().length > 0;
                        }
                        return this.bookshelfManager.getDescendants(contextInternalId).length > 0;
                    })() ? `
                        <label style="display: block; margin-top: 0.5rem; color: #555;">
                            <input type="checkbox" class="propagate-to-descendants" data-asin="${book.asin}">
                            子孫本棚にも反映する（全子孫の短文メモを上書き）
                        </label>
                    ` : ''}
                    ${isEditMode ? `
                        <span class="save-note-status" data-asin="${book.asin}" style="margin-left: 0.25rem; color: #888; font-size: 0.85rem;"></span>
                    ` : ''}
                    ${isEditMode && contextInternalId ? (() => {
                        const bs = this.bookshelfManager.getById(contextInternalId);
                        const note = (bs && bs.notes && bs.notes[book.asin]) || {};
                        return `
                            <div class="publish-flags" style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: #fff8e1; border-radius: 4px;">
                                <p style="margin: 0 0 0.4rem; font-size: 0.85rem; color: #5d4037;">📤 公開時の挙動（この本棚での設定）</p>
                                <label style="display: block; padding: 0.15rem 0;">
                                    <input type="checkbox" class="publish-hide-check" data-asin="${book.asin}" ${note.publishHide ? 'checked' : ''}>
                                    公開時にこの本棚から除外する
                                </label>
                                <label style="display: block; padding: 0.15rem 0;">
                                    <input type="checkbox" class="hide-detail-memo-check" data-asin="${book.asin}" ${note.hideDetailMemo ? 'checked' : ''}>
                                    公開時に長文メモを非公開
                                </label>
                            </div>
                        `;
                    })() : ''}
                    <p class="note-help" style="${isEditMode ? '' : 'display: none;'}">💡 入力を止めると自動保存されます（同期は背景で実行）</p>

                    <div class="rating-section" style="${isEditMode ? '' : 'display: none;'}">
                        <h4>⭐ 星評価</h4>
                        <div class="star-rating" data-asin="${book.asin}" data-current-rating="${userNote.rating || 0}">
                            ${this.generateStarRating(userNote.rating || 0)}
                        </div>
                        <button class="btn btn-small rating-reset" data-asin="${book.asin}">評価をリセット</button>
                    </div>
                </div>
                
                <div class="book-highlights-section" id="highlights-${book.asin}">
                    <h3>🎯 ハイライト</h3>
                    <div class="highlights-loading">ハイライトを読み込み中...</div>
                </div>
            </div>
        `;
        
        // Setup modal event listeners
        const noteTextarea = modalBody.querySelector('.note-textarea');
        // 自動保存: 入力停止 300ms 後に保存。Obsidian 同期側でも debounce されるので連続入力負荷は低い
        if (isEditMode) {
            noteTextarea.addEventListener('input', (e) => {
                this.updateMemoPreview(e.target);
                this._scheduleNoteAutoSave(e.target.dataset.asin, e.target.value, modalBody);
            });
        }

        const publishHideCheck = modalBody.querySelector('.publish-hide-check');
        if (publishHideCheck) {
            publishHideCheck.addEventListener('change', async (e) => {
                await this._togglePublishFlag(e.currentTarget.dataset.asin, 'publishHide', e.currentTarget.checked);
            });
        }
        const hideDetailMemoCheck = modalBody.querySelector('.hide-detail-memo-check');
        if (hideDetailMemoCheck) {
            hideDetailMemoCheck.addEventListener('change', async (e) => {
                await this._togglePublishFlag(e.currentTarget.dataset.asin, 'hideDetailMemo', e.currentTarget.checked);
            });
        }

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
                const asin = e.target.dataset.asin;
                console.log(`🔄 評価リセット: ASIN: ${asin}`);
                this.saveRating(asin, 0);

                // Update star display in modal
                const starRating = modalBody.querySelector('.star-rating');
                starRating.dataset.currentRating = 0;
                const stars = starRating.querySelectorAll('.star');
                stars.forEach(star => {
                    star.classList.remove('active');
                });

                // Update display in main bookshelf
                this.updateDisplay();
                this.updateStats();
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
        
        
        // Add star rating functionality
        const starRating = modalBody.querySelector('.star-rating');
        if (starRating) {
            // Initialize star display based on current rating
            const currentRating = parseInt(starRating.dataset.currentRating) || 0;
            const stars = starRating.querySelectorAll('.star');
            stars.forEach((star, index) => {
                if (index + 1 <= currentRating) {
                    star.classList.add('active');
                    star.style.color = '#ffa500';
                } else {
                    star.classList.remove('active');
                    star.style.color = '#ddd';
                }
            });
            
            // Add hover effects for better UX
            starRating.addEventListener('mouseover', (e) => {
                if (e.target.classList.contains('star')) {
                    const hoverRating = parseInt(e.target.dataset.rating);
                    const stars = starRating.querySelectorAll('.star');
                    stars.forEach((star, index) => {
                        if (index + 1 <= hoverRating) {
                            star.style.color = '#ffa500';
                        } else {
                            star.style.color = '#ddd';
                        }
                    });
                }
            });
            
            starRating.addEventListener('mouseleave', () => {
                const currentRating = parseInt(starRating.dataset.currentRating) || 0;
                const stars = starRating.querySelectorAll('.star');
                stars.forEach((star, index) => {
                    if (index + 1 <= currentRating) {
                        star.style.color = '#ffa500';
                    } else {
                        star.style.color = '#ddd';
                    }
                });
            });
            
            starRating.addEventListener('click', (e) => {
                if (e.target.classList.contains('star')) {
                    const rating = parseInt(e.target.dataset.rating);
                    const asin = starRating.dataset.asin;
                    console.log(`⭐ 星評価: ${rating}星, ASIN: ${asin}`);
                    this.saveRating(asin, rating);
                    
                    // Update current rating data
                    starRating.dataset.currentRating = rating;
                    
                    // Update star display in modal
                    const stars = starRating.querySelectorAll('.star');
                    stars.forEach((star, index) => {
                        star.classList.toggle('active', (index + 1) <= rating);
                    });
                    
                    // Update display in main bookshelf
                    this.updateDisplay();
                    this.updateStats();
                }
            });
        }
        
        // Load highlights
        this.loadBookHighlights(book);
        
        modal.classList.add('show');
    }

    closeModal() {
        const modal = document.getElementById('book-modal');
        modal.classList.remove('show');
        
        // Clear modal body to prevent event listener conflicts
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = '';
    }




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

    async saveNote(asin, memo) {
        const contextInternalId = this._currentBookshelfInternalId();
        const propagateEl = document.querySelector(`.propagate-to-descendants[data-asin="${asin}"]`);
        const propagateToDescendants = propagateEl ? propagateEl.checked : false;

        this.bookshelfManager.setMemo(asin, memo, {
            scope: contextInternalId || 'all',
            propagateToDescendants
        });

        await this.saveUserData();
        if (this.pluginAPI) this.pluginAPI._emit('note:updated', { asin, note: this.userData.notes?.[asin] || { memo } });
    }

    /**
     * メモ自動保存（textarea の oninput から呼ばれる）
     * 300ms 入力停止で saveNote 実行。さらに saveUserData 側で 800ms debounce されるので
     * 連続入力時の Obsidian I/O は最小化される。
     */
    _scheduleNoteAutoSave(asin, value, modalRoot) {
        if (!this._noteAutoSaveTimers) this._noteAutoSaveTimers = new Map();
        const existing = this._noteAutoSaveTimers.get(asin);
        if (existing) clearTimeout(existing);
        const statusEl = (modalRoot || document).querySelector(`.save-note-status[data-asin="${asin}"]`);
        if (statusEl) statusEl.textContent = '✏️ 入力中…';
        const timer = setTimeout(async () => {
            this._noteAutoSaveTimers.delete(asin);
            try {
                await this.saveNote(asin, value);
                if (statusEl) {
                    statusEl.textContent = '✅ 保存しました';
                    setTimeout(() => { if (statusEl.textContent === '✅ 保存しました') statusEl.textContent = ''; }, 1500);
                }
            } catch (e) {
                console.error('メモ自動保存エラー:', e);
                if (statusEl) statusEl.textContent = `❌ ${e.message || '保存失敗'}`;
            }
        }, 300);
        this._noteAutoSaveTimers.set(asin, timer);
    }


    async loadBookHighlights(book) {
        const highlightsContainer = document.getElementById(`highlights-${book.asin}`);
        const loadingElement = highlightsContainer.querySelector('.highlights-loading');
        
        try {
            // Use HighlightsManager for ASIN-based loading
            if (window.highlightsManager) {
                const highlights = await window.highlightsManager.loadHighlightsForBook(book);
                
                loadingElement.style.display = 'none';
                
                if (highlights.length > 0) {
                    // Use the HighlightsManager's render method
                    const highlightsListContainer = document.createElement('div');
                    window.highlightsManager.renderHighlights(highlights, highlightsListContainer);
                    
                    // Replace loading with rendered highlights
                    highlightsContainer.innerHTML = '<h3>🎯 ハイライト</h3>';
                    highlightsContainer.appendChild(highlightsListContainer);
                } else {
                    // No highlights found
                    highlightsContainer.innerHTML = '<h3>🎯 ハイライト</h3><p class="no-highlights">この本のハイライトはありません</p>';
                }
            } else {
                // Fallback if HighlightsManager not available
                loadingElement.textContent = 'ハイライトマネージャーが利用できません';
            }
        } catch (error) {
            console.error('ハイライト読み込みエラー:', error);
            loadingElement.textContent = 'ハイライトの読み込みに失敗しました';
        }
    }


    updateStats() {
        const totalBooks = this.books.length;
        
        document.getElementById('total-books').textContent = totalBooks.toLocaleString();
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
        if (this.obsidianDirHandle) {
            this._scheduleSync();
        }
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
                ...(meta.color ? { color: meta.color } : {}),
                parent: meta.parent || null,
                appliedPlugins: meta.appliedPlugins || [],
                isPublic: meta.isPublic || false,
                isSpecial: meta.isSpecial || isAll,
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

        if (window.seriesManager) window.seriesManager.clearCache();
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

    // 同期フォルダへの書き出し（新ファイル構造、分散保存）
    async syncToObsidianFolder() {
        if (!this.obsidianDirHandle) return;
        try {
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

            // library.json: 全書誌（除外含む全本）を毎回再構築
            // 表示中の本（this.books）+ 除外で this.books に無い本（_storage.libraryBooks から取り出す）
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
            await this.storage.writeLibrary({
                exportDate: new Date().toISOString(),
                books: libraryBooks
            });

            // exclusions.json
            await this.storage.writeExclusions({
                excludedASINs: (this.userData._storage && this.userData._storage.exclusions) || []
            });

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
            await this.storage.writeNotes({ notes: notesPayload });

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

            // all 本棚の表示メタ（bookshelves 配列にあればそれを優先）
            const allMeta = this.bookshelfManager.getBySlug('all');
            await this.storage.writeAllBookshelf({
                internalId: allInternalId,
                slug: 'all',
                name: (allMeta && allMeta.name) || 'すべての本',
                isSpecial: true,
                isPublic: (allMeta && allMeta.isPublic) || false,
                parent: null,
                defaultBookOrder: this.userData.settings?.defaultBookOrder || 'addedDate-desc',
                appliedPlugins: (allMeta && allMeta.appliedPlugins) || [],
                books: allBooksList
            });

            // bookshelves.json + 各 slug ファイル
            // internalId 未設定なら発行して this.userData.bookshelves[i] に書き戻す（永続化）
            for (const b of (this.userData.bookshelves || [])) {
                if (!b.internalId) b.internalId = generateInternalId();
            }
            // all 本棚が無ければ自動追加（マイグレーション後・初期化後の保険）
            if (!this.userData.bookshelves.some(b => b.id === 'all')) {
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
                parent: b.id === 'all' ? null : (b.parent || allInternalId),
                ...(b.color ? { color: b.color } : {}),
                appliedPlugins: b.appliedPlugins || [],
                isPublic: b.isPublic || false,
                ...(b.isSpecial ? { isSpecial: true } : {})
            }));
            await this.storage.writeBookshelvesMeta({ bookshelves: bookshelvesMetaEntries });
            // all 以外の slug ファイル書き込み（all は writeAllBookshelf で別途）
            for (let i = 0; i < (this.userData.bookshelves || []).length; i++) {
                const b = this.userData.bookshelves[i];
                if (b.id === 'all') continue;
                const meta = bookshelvesMetaEntries[i];
                await this.storage.writeBookshelfFile(meta.slug, {
                    internalId: meta.internalId,
                    slug: meta.slug,
                    name: meta.name,
                    parent: meta.parent,
                    books: b.books || [],
                    notes: b.notes || {}
                });
            }

            // private/settings.json
            await this.storage.writePrivateSettings({
                version: '2.0',
                ...(this.userData.settings || {})
            });

            // private/main.json
            // bookshelvesMetaEntries には all が含まれているのでそのまま使う
            const existingMain = (this.userData._storage && this.userData._storage.main) || {};
            await this.storage.writePrivateMain({
                enabledPlugins: existingMain.enabledPlugins || [],
                appliedPlugins: existingMain.appliedPlugins || [],
                bookshelves: bookshelvesMetaEntries.map(b => b.internalId),
                defaultSort: existingMain.defaultSort || 'addedDate-desc'
            });

            this.updateSyncStatus('synced', this.obsidianDirHandle.name);
        } catch (e) {
            console.error('Obsidian同期エラー:', e);
        }
    }

    updateSyncStatus(state, folderName = '') {
        const btn = document.getElementById('obsidian-sync-btn');
        const status = document.getElementById('obsidian-sync-status');
        if (!btn || !status) return;
        if (state === 'synced') {
            btn.textContent = `📁 ${folderName}`;
            status.textContent = `✅ ${new Date().toLocaleTimeString()} 同期済み（クリックで再読み込み）`;
            status.style.color = '#4caf50';
        } else if (state === 'loading') {
            btn.textContent = `📁 ${folderName}`;
            status.textContent = '⏳ 読み込み中...';
            status.style.color = '#888';
        } else if (state === 'reconnect') {
            btn.textContent = '📁 再接続が必要';
            status.textContent = '⚠️ クリックしてフォルダを再選択';
            status.style.color = '#f44336';
        } else {
            btn.textContent = '📁 Obsidianフォルダを選択';
            status.textContent = '';
        }
    }

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
        const selector = document.getElementById('bookshelf-selector');
        if (!selector) return;

        const allBookshelf = (this.userData.bookshelves || []).find(bs => bs.id === 'all');
        const allEmoji = (allBookshelf && allBookshelf.emoji) || '📚';
        const allName = (allBookshelf && allBookshelf.name) || '全ての本';
        selector.innerHTML = `<option value="all">${allEmoji} ${allName}</option>`;

        (this.userData.bookshelves || [])
            .filter(bs => bs.id !== 'all')
            .forEach(bookshelf => {
                const option = document.createElement('option');
                option.value = bookshelf.id;
                option.textContent = `${bookshelf.emoji || '📚'} ${bookshelf.name}`;
                selector.appendChild(option);
            });
    }

    switchBookshelf(bookshelfId) {
        this.currentBookshelf = bookshelfId;
        this.updateStaticPageButton(bookshelfId);
        this.applyFilters();
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
            const publicBadge = isPublic ? '<span class="public-badge">📤 公開中</span>' : '';
            const specialBadge = isSpecial ? '<span class="special-badge" style="background:#fff3cd;color:#856404;padding:0.1rem 0.4rem;border-radius:3px;font-size:0.75rem;margin-left:0.4rem;">特殊</span>' : '';

            html += `
                <div class="bookshelf-item" data-id="${bookshelf.id}" draggable="${!isSpecial}">
                    <div class="bookshelf-drag-handle">${isSpecial ? '🔒' : '⋮⋮'}</div>
                    <div class="bookshelf-info">
                        <h4>${bookshelf.emoji || '📚'} ${bookshelf.name} ${specialBadge}${publicBadge}</h4>
                        <p>${bookshelf.description || ''}</p>
                        <span class="book-count">${bookCount}冊</span>

                    </div>
                    <div class="bookshelf-actions">
                        <button class="btn btn-secondary edit-bookshelf" data-id="${bookshelf.id}">編集</button>
                        ${isPublic ? `<button class="btn btn-primary share-bookshelf" data-id="${bookshelf.id}">📄 静的ページ生成</button>` : ''}
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
            } else if (e.target.classList.contains('share-bookshelf')) {
                this.showStaticShareModal(e.target.dataset.id);
            }
        });

        // Add drag and drop functionality for bookshelf reordering
        this.setupBookshelfDragAndDrop(oldContainer);
    }

    addBookshelf() {
        this.showBookshelfForm();
    }

    showBookshelfForm(bookshelfToEdit = null) {
        const modal = document.getElementById('bookshelf-form-modal');
        const title = document.getElementById('bookshelf-form-title');
        const nameInput = document.getElementById('bookshelf-name');
        const slugInput = document.getElementById('bookshelf-slug');
        const parentSelect = document.getElementById('bookshelf-parent');
        const emojiInput = document.getElementById('bookshelf-emoji');
        const descriptionInput = document.getElementById('bookshelf-description');
        const isPublicInput = document.getElementById('bookshelf-is-public');

        // 親本棚ドロップダウン構築（編集中は自身と子孫を除外）
        // bookshelves[] には all 本棚も含まれているのでハードコードしない
        const allId = this.bookshelfManager.getAllInternalId();
        const excludedIds = bookshelfToEdit
            ? new Set([bookshelfToEdit.internalId, ...this.bookshelfManager.getDescendants(bookshelfToEdit.internalId).map(b => b.internalId)])
            : new Set();
        const candidates = this.bookshelfManager.getBookshelves().filter(b => !excludedIds.has(b.internalId));
        parentSelect.innerHTML = candidates
            .map(b => `<option value="${b.internalId}">${b.emoji || '📚'} ${b.name}</option>`)
            .join('');

        if (bookshelfToEdit) {
            title.textContent = '📚 本棚を編集';
            nameInput.value = bookshelfToEdit.name;
            slugInput.value = bookshelfToEdit.id || '';
            parentSelect.value = bookshelfToEdit.parent || allId || '';
            emojiInput.value = bookshelfToEdit.emoji || '📚';
            descriptionInput.value = bookshelfToEdit.description || '';
            isPublicInput.checked = bookshelfToEdit.isPublic || false;
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
            title.textContent = '📚 新しい本棚';
            nameInput.value = '';
            slugInput.value = '';
            parentSelect.value = allId || '';
            emojiInput.value = '📚';
            descriptionInput.value = '';
            isPublicInput.checked = false;
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
        const emojiInput = document.getElementById('bookshelf-emoji');
        const descriptionInput = document.getElementById('bookshelf-description');
        const isPublicInput = document.getElementById('bookshelf-is-public');

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
            emoji: emojiInput.value.trim() || '📚',
            description: descriptionInput.value.trim(),
            isPublic: isPublicInput.checked
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
        this.updateBookshelfSelector();
        this.renderBookshelfList();
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
            document.getElementById('bookshelf-selector').value = 'all';
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
                    ${d.emoji || '📚'} ${d.name}
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
    async excludeBook(asin) {
        const book = this.books.find(b => b.asin === asin);
        if (!book) {
            alert('❌ 指定された書籍が見つかりません');
            return;
        }
        if (!confirm(`🚫 「${book.title}」を all から除外しますか？\n\n再Kindle取込でも復活しません。\n除外一覧から解除できます。`)) {
            return;
        }
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
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.bookManager.library));
        this.books = this.bookManager.getAllBooks();

        if (this.userData.bookOrder && Array.isArray(this.userData.bookOrder.all)) {
            this.userData.bookOrder.all = this.userData.bookOrder.all.filter(a => a !== asin);
        }

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
    async copyToPublic() {
        if (!this.obsidianDirHandle) {
            alert('⚠️ 同期フォルダを選択してから操作してください。');
            return;
        }
        this.storage.setDirHandle(this.obsidianDirHandle);
        // 編集中の変更を確実に書き出してから公開コピー
        await this.flushSync();

        const main = (this.userData._storage && this.userData._storage.main) || {};

        // isPublic=true の本棚を集める（all 含む、all も isPublic で制御）
        const publicSet = new Set(
            this.bookshelfManager.getBookshelves()
                .filter(b => b.isPublic)
                .map(b => b.internalId)
        );

        if (publicSet.size === 0) {
            alert('⚠️ 公開対象の本棚が1つもありません。\n本棚編集で「📤 この本棚を公開する」をチェックしてください（all 本棚も含めて選択可能）');
            return;
        }

        const baseOrder = Array.isArray(main.bookshelves)
            ? main.bookshelves
            : this.bookshelfManager.getBookshelves().map(b => b.internalId);
        const filteredBookshelves = baseOrder.filter(id => publicSet.has(id));

        // appliedPlugins / enabledPlugins から publishable=false のものを除外
        const publishableIds = await this._collectPublishablePluginIds();
        const filterPlugins = (arr) => (arr || []).filter(id => publishableIds.has(id));
        const publicMain = {
            enabledPlugins: filterPlugins(main.enabledPlugins),
            appliedPlugins: filterPlugins(main.appliedPlugins),
            bookshelves: filteredBookshelves,
            defaultSort: main.defaultSort || 'addedDate-desc'
        };

        // 既存確認
        const existing = await this.storage.readPublicMain();
        if (existing) {
            if (!confirm('既に public/main.json があります。\n上書きしますか？\n（手動で編集していた場合、変更が失われます）')) {
                return;
            }
        }

        // 公開 settings は private から affiliateId 等の個人情報を除いてコピー
        const privateSettings = this.userData.settings || {};
        const { affiliateId, obsidianVaultName, obsidianSubPath, extensionImportOrigins, ...publicSafe } = privateSettings;
        const publicSettings = {
            version: '2.0',
            ...publicSafe
        };

        try {
            await this.storage.writePublicMain(publicMain);
            await this.storage.writePublicSettings(publicSettings);
            alert(`✅ public/main.json と public/settings.json を更新しました\n\n公開対象本棚: ${filteredBookshelves.length}個\n（all を含む）`);
        } catch (e) {
            console.error('公開にコピーエラー:', e);
            alert(`❌ 失敗しました: ${e.message}`);
        }
    }

    async pickExportDir() {
        try {
            const handle = await this.exporter.pickExportDir();
            alert(`✅ 出力先を「${handle.name}」に設定しました`);
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error('出力先選択エラー:', e);
            alert(`❌ ${e.message}`);
        }
    }

    async runPublicExport() {
        if (!this.obsidianDirHandle) {
            alert('⚠️ 同期フォルダを選択してから操作してください');
            return;
        }
        // 編集中の変更を確実に同期フォルダに反映してからエクスポート
        await this.flushSync();
        if (!this.exporter.exportDirHandle) {
            await this.exporter.loadStoredHandle();
        }
        if (!this.exporter.exportDirHandle) {
            if (!confirm('📦 出力先フォルダが未選択です。\n選択しますか？\n（推奨: 同期フォルダの隣に bookshelf-export/）')) return;
            try {
                await this.exporter.pickExportDir();
            } catch (e) {
                if (e.name === 'AbortError') return;
                alert(`❌ ${e.message}`);
                return;
            }
        }

        try {
            const result = await this.exporter.export();
            const errorMsg = result.errors.length > 0
                ? `\n\n⚠️ エラー ${result.errors.length} 件:\n${result.errors.slice(0, 3).join('\n')}${result.errors.length > 3 ? '\n...' : ''}`
                : '';
            alert(`✅ エクスポート完了\n\n書籍: ${result.exported}冊\n本棚: ${result.bookshelves}個${errorMsg}\n\n※ index.html / css / js のコピーは Phase 3-C で対応予定`);
        } catch (e) {
            console.error('エクスポートエラー:', e);
            alert(`❌ ${e.message}`);
        }
    }

    /**
     * 長文メモ books/<ASIN>__<title>.md を作成 / Obsidian で開く
     * 同期フォルダが vault 外の場合があるため、初回に vault 名・サブパスを設定で持つ
     */
    async openOrCreateBookMemo(asin) {
        if (!this.obsidianDirHandle) {
            alert('⚠️ 同期フォルダを選択してから操作してください。');
            return;
        }
        const book = this.books.find(b => b.asin === asin);
        if (!book) return;

        this.storage.setDirHandle(this.obsidianDirHandle);

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

        const fileName = this.storage.bookMemoFileName(asin, book.title);
        const relativePath = `books/${fileName}`;
        const folderName = this.obsidianDirHandle.name;

        // ファイルパスをクリップボードへコピー（失敗しても続行）
        try {
            await navigator.clipboard.writeText(relativePath);
        } catch (e) { /* permission/non-secure context は無視 */ }

        if (!this.userData.settings) this.userData.settings = {};
        const settings = this.userData.settings;

        // vault 名未設定 → 初回プロンプトで設定
        if (typeof settings.obsidianVaultName === 'undefined') {
            const vaultInput = prompt(
                '📝 Obsidian で開くために vault 名を設定します\n\n' +
                '同期フォルダが vault 自体: vault 名を入力\n' +
                '同期フォルダが vault 外: 空欄でキャンセル（毎回パス表示のみ）\n' +
                '同期フォルダが vault のサブフォルダ: vault 名を入力（後でサブパスも聞きます）',
                folderName
            );
            if (vaultInput && vaultInput.trim()) {
                settings.obsidianVaultName = vaultInput.trim();
                const subInput = prompt(
                    'vault 内のサブパス（同期フォルダが vault のサブフォルダの場合のみ）\n\n例: project/bookshelf\n空欄で vault 直下',
                    ''
                );
                settings.obsidianSubPath = (subInput || '').trim();
            } else {
                settings.obsidianVaultName = '';
                settings.obsidianSubPath = '';
            }
            this.saveUserData();
        }

        const vaultName = settings.obsidianVaultName;
        const action = created ? '✅ 詳細メモを作成しました' : '📝 詳細メモ';

        if (vaultName) {
            const subPath = (settings.obsidianSubPath || '').replace(/^\/+|\/+$/g, '');
            const filePath = subPath ? `${subPath}/${relativePath}` : relativePath;
            const obsidianUrl = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;

            if (confirm(`${action}\n\n📁 ${folderName}/${relativePath}\n（クリップボードにコピー済み）\n\nObsidian vault "${vaultName}" で開きますか？`)) {
                window.location.href = obsidianUrl;
            }
        } else {
            alert(`${action}\n\n📁 ${folderName}/${relativePath}\n（クリップボードにコピー済み）\n\nファイルパスをコピーしてエディタで開いてください。\n（Obsidian で直接開きたい場合は vault 名を設定）`);
        }

        const modal = document.getElementById('book-modal');
        if (modal && modal.classList.contains('show')) {
            this.showBookDetail(book, true);
        }
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

        if (!this.obsidianDirHandle) {
            listDiv.innerHTML = '<p style="color: #888;">同期フォルダを選択すると除外一覧を管理できます。</p>';
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
        if (!this.pluginLoader || !this.obsidianDirHandle) return ids;
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

        if (!this.obsidianDirHandle) {
            container.innerHTML = '<p style="color:#888;">同期フォルダを先に接続してください。</p>';
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

        const enabledSet = new Set(this.userData?.settings?.enabledPlugins || []);
        const loadedSet = new Set(this.pluginLoader.loaded.keys());

        container.innerHTML = installed.map(({ id, manifest }) => {
            const enabled = enabledSet.has(id);
            const loaded = loadedSet.has(id);
            const failure = this.pluginLoader.failedToLoad.get(id);
            return `
                <div class="plugin-card" style="border:1px solid #ddd; border-radius:6px; padding:0.8rem; margin-bottom:0.6rem; display:flex; justify-content:space-between; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                    <div style="flex:1 1 200px; min-width:0;">
                        <div style="font-weight:600;">${manifest.name || id} <span style="color:#888; font-weight:normal; font-size:0.85rem;">v${manifest.version || '?'} ${manifest.publishable ? '🌐' : ''}</span></div>
                        <div style="font-size:0.85rem; color:#666;">${manifest.description || ''}</div>
                        ${failure ? `<div style="font-size:0.8rem; color:#c00;">⚠️ ${failure}</div>` : ''}
                        ${loaded ? '<div style="font-size:0.8rem; color:#0a0;">✓ 読み込み済み（再起動不要で有効）</div>' : ''}
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
    }

    async installPluginFromInput() {
        const input = document.getElementById('plugin-repo-url');
        const url = (input.value || '').trim();
        if (!url) {
            alert('GitHub の repo URL を入力してください');
            return;
        }
        if (!this.obsidianDirHandle) {
            alert('同期フォルダを先に接続してください');
            return;
        }
        try {
            const manifest = await this.pluginLoader.installFromGitHub(url);
            if (manifest) {
                alert(`✅ ${manifest.name || manifest.id} v${manifest.version || '?'} をインストールしました`);
                await this._renderPluginsList();
            }
        } catch (e) {
            alert(`❌ インストール失敗: ${e.message}`);
        }
    }

    async togglePlugin(id, enabled) {
        if (!this.userData.settings) this.userData.settings = {};
        if (!Array.isArray(this.userData.settings.enabledPlugins)) this.userData.settings.enabledPlugins = [];
        const list = this.userData.settings.enabledPlugins;
        if (enabled && !list.includes(id)) list.push(id);
        if (!enabled) this.userData.settings.enabledPlugins = list.filter(x => x !== id);
        await this.saveUserData();
        // 即時反映: 有効化→_loadPlugin, 無効化→unloadPlugin（リロード不要）
        if (enabled && !this.pluginLoader.loaded.has(id)) {
            const installed = await this.pluginLoader.listInstalledPlugins({ refresh: true });
            const target = installed.find(p => p.id === id);
            if (target) await this.pluginLoader._loadPlugin(target);
        } else if (!enabled && this.pluginLoader.loaded.has(id)) {
            await this.pluginLoader.unloadPlugin(id);
        }
        await this._renderPluginsList();
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
        const url = 'https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/';
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

        // ユーザがブックマークレットをクリックするまでの待機なので長め (15分)
        timer = setTimeout(() => {
            cleanup();
            alert('⏱️ Kindle 取込タイムアウト（15分）。\nAmazon ページでブックマークレットをクリックしましたか？\nブックマークレット登録は「📋 ブックマークレットをコピー」から行ってください。');
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
            fetchBtn.textContent = '📥 自動取得';
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

    /**
     * 蔵書を全てクリア
     */
    async clearLibrary() {
        const confirmMessage = `🗑️ 全データを完全にクリアしますか？

この操作により以下のデータが削除されます：
• 全ての書籍データ
• 全ての本棚設定
• 全ての評価・メモ
• 全ての並び順設定

この操作は元に戻せません。`;
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        try {
            this.showLoading();
            
            // BookManagerで蔵書をクリア
            await this.bookManager.clearAllBooks();
            
            // 全てのuserDataを完全にクリア
            if (this.userData) {
                // 本棚データを完全クリア
                this.userData.bookshelves = [];
                
                // 評価・メモを完全クリア  
                this.userData.notes = {};
                
                // 並び順データを完全クリア
                this.userData.bookOrder = {};
                
                // 統計データもリセット
                this.userData.stats = {
                    totalBooks: 0,
                    notesCount: 0
                };
            }
            
            // 本のリストを更新
            this.books = [];
            this.filteredBooks = [];
            
            // UIを更新
            this.saveUserData();
            this.updateDisplay();
            this.updateStats();
            
            alert('✅ 全データを完全にクリアしました');
        } catch (error) {
            console.error('蔵書クリア中にエラーが発生しました:', error);
            alert('❌ 蔵書のクリアに失敗しました: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    renderBookshelfOverview() {
        const overviewSection = document.getElementById('bookshelves-overview');
        const grid = document.getElementById('bookshelves-grid');
        
        if (!this.userData.bookshelves || this.userData.bookshelves.length === 0) {
            overviewSection.style.display = 'none';
            return;
        }

        overviewSection.style.display = 'block';
        
        let html = '';
        this.userData.bookshelves.forEach(bookshelf => {
            const bookCount = bookshelf.books ? bookshelf.books.length : 0;
            
            // Apply custom book order for preview if it exists
            let previewBooks = [];
            if (bookshelf.books && bookshelf.books.length > 0) {
                let orderedBooks = [...bookshelf.books];
                
                // Apply custom order if exists
                if (this.userData.bookOrder && this.userData.bookOrder[bookshelf.id]) {
                    const customOrder = this.userData.bookOrder[bookshelf.id];
                    orderedBooks.sort((a, b) => {
                        const aIndex = customOrder.indexOf(a);
                        const bIndex = customOrder.indexOf(b);
                        
                        if (aIndex === -1 && bIndex === -1) return 0;
                        if (aIndex === -1) return 1;
                        if (bIndex === -1) return -1;
                        return aIndex - bIndex;
                    });
                }
                
                previewBooks = orderedBooks.slice(0, 8);
            }
            
            const textOnlyClass = this.showImagesInOverview ? '' : 'text-only';
            const isPublic = bookshelf.isPublic || false;
            const publicBadge = isPublic ? '<span class="public-badge">📤 公開中</span>' : '';



            html += `
                <div class="bookshelf-preview ${textOnlyClass}" data-bookshelf-id="${bookshelf.id}">
                    <div class="bookshelf-preview-header">
                        <h3>${bookshelf.emoji || '📚'} ${bookshelf.name} ${publicBadge}</h3>
                        <div class="bookshelf-preview-actions">
                            <button class="btn btn-small btn-secondary select-bookshelf" data-bookshelf-id="${bookshelf.id}">📚 表示</button>
                            ${isPublic ? `<button class="btn btn-small btn-primary open-static-page" data-bookshelf-id="${bookshelf.id}">🌐 静的ページ</button>` : ''}
                        </div>
                    </div>
                    <p>${bookshelf.description || ''}</p>

                    <p class="book-count">${bookCount}冊</p>
                    <div class="bookshelf-preview-books">
                        ${previewBooks.map(asin => {
                            const book = this.books.find(b => b.asin === asin);
                            if (book && book.productImage) {
                                return `<div class="bookshelf-preview-book"><img src="${this.bookManager.getProductImageUrl(book)}" alt="${book.title}"></div>`;
                            } else {
                                return '<div class="bookshelf-preview-book bookshelf-preview-placeholder">📖</div>';
                            }
                        }).join('')}
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
        
        // Add click handlers for bookshelf actions
        grid.addEventListener('click', (e) => {
            if (e.target.classList.contains('select-bookshelf')) {
                // 本棚選択ボタン
                const bookshelfId = e.target.dataset.bookshelfId;
                document.getElementById('bookshelf-selector').value = bookshelfId;
                this.switchBookshelf(bookshelfId);

                // 本が表示されているエリアにスムーズスクロール
                setTimeout(() => {
                    const bookshelf = document.getElementById('bookshelf');
                    if (bookshelf) {
                        bookshelf.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                }, 100);
            } else if (e.target.classList.contains('open-static-page')) {
                // 静的ページボタン
                const bookshelfId = e.target.dataset.bookshelfId;
                this.openStaticPageById(bookshelfId);
            } else {
                // 本棚プレビューエリアをクリックした場合は本棚選択
                const bookshelfPreview = e.target.closest('.bookshelf-preview');
                if (bookshelfPreview && !e.target.closest('.bookshelf-preview-actions')) {
                    const bookshelfId = bookshelfPreview.dataset.bookshelfId;
                    document.getElementById('bookshelf-selector').value = bookshelfId;
                    this.switchBookshelf(bookshelfId);

                    // 本が表示されているエリアにスムーズスクロール
                    setTimeout(() => {
                        const bookshelf = document.getElementById('bookshelf');
                        if (bookshelf) {
                            bookshelf.scrollIntoView({
                                behavior: 'smooth',
                                block: 'start'
                            });
                        }
                    }, 100);
                }
            }
        });
    }

    toggleBookshelfDisplay() {
        this.showImagesInOverview = !this.showImagesInOverview;
        this.userData.settings.showImagesInOverview = this.showImagesInOverview;
        this.saveUserData();
        
        const button = document.getElementById('toggle-bookshelf-display');
        button.textContent = this.showImagesInOverview ? '🖼️ 画像表示切替' : '📝 テキストのみ';
        
        this.renderBookshelfOverview();
    }

    showError(message) {
        const bookshelf = document.getElementById('bookshelf');
        bookshelf.innerHTML = `<div class="error-message">❌ ${message}</div>`;
    }
    
    generateStarRating(rating) {
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            const isActive = i <= rating ? 'active' : '';
            const color = i <= rating ? '#ffa500' : '#ddd';
            stars += `<span class="star ${isActive}" data-rating="${i}" style="color: ${color};">⭐</span>`;
        }
        return stars;
    }
    
    displayStarRating(rating) {
        if (!rating || rating === 0) return '';
        let stars = '';
        for (let i = 1; i <= rating; i++) {
            stars += '⭐';
        }
        return `<div class="book-rating"><span class="stars">${stars}</span></div>`;
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

    /**
     * 静的共有モーダルを表示
     */
    showStaticShareModal(bookshelfId) {
        const bookshelf = this.userData.bookshelves.find(b => b.id === bookshelfId);
        if (!bookshelf) return;

        this.currentShareBookshelf = bookshelf;
        const modal = document.getElementById('static-share-modal');
        const form = document.getElementById('share-generation-form');
        const results = document.getElementById('share-results');

        // フォームを非表示、結果を表示
        form.style.display = 'none';
        results.style.display = 'block';

        modal.classList.add('show');
        
        // 自動的に静的ページを生成
        this.generateStaticPage();
    }

    /**
     * 静的共有モーダルを閉じる
     */
    closeStaticShareModal() {
        const modal = document.getElementById('static-share-modal');
        modal.classList.remove('show');
        this.currentShareBookshelf = null;
    }

    /**
     * 静的ページを生成
     */
    async generateStaticPage() {
        if (!this.currentShareBookshelf) return;


        const generateBtn = document.getElementById('generate-static-page');
        const form = document.getElementById('share-generation-form');
        const results = document.getElementById('share-results');
        const resultsContent = results.querySelector('.share-result-content');

        // ローディング状態
        generateBtn.disabled = true;
        generateBtn.textContent = '生成中...';

        try {
            const options = {};

            const result = await this.staticGenerator.generateStaticBookshelf(
                this.currentShareBookshelf.id,
                options
            );

            if (result.success) {
                // 本棚データに公開情報を保存
                this.currentShareBookshelf.staticPageInfo = {
                    filename: result.filename,
                    lastGenerated: new Date().toISOString(),

                    // GitHub Pages URLを生成（リポジトリ名から推測）
                    url: `https://karaage0703.github.io/karaage-virtual-bookshelf/static/${result.filename}`
                };
                this.saveUserData();

                // 成功時の表示
                resultsContent.innerHTML = `
                    <div class="success-message">
                        <h3>✅ 静的ページが生成されました！</h3>
                        <div class="generation-info">
                            <p><strong>本棚:</strong> ${result.bookshelf.emoji} ${result.bookshelf.name}</p>
                            <p><strong>書籍数:</strong> ${result.totalBooks}冊</p>
                            <p><strong>ファイル名:</strong> ${result.filename}</p>
                            <p><strong>公開URL:</strong> <a href="${this.currentShareBookshelf.staticPageInfo.url}" target="_blank">${this.currentShareBookshelf.staticPageInfo.url}</a></p>
                            <p><strong>注意:</strong> GitHubにpushした後にURLが有効になります</p>
                        </div>

                        <div class="form-actions">
                            <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${this.currentShareBookshelf.staticPageInfo.url}')">📋 URLをコピー</button>
                            <button class="btn btn-secondary" onclick="window.bookshelf.closeStaticShareModal()">閉じる</button>
                        </div>
                    </div>
                `;

                // フォームを隠して結果を表示
                form.style.display = 'none';
                results.style.display = 'block';

            } else {
                // エラー時の表示
                resultsContent.innerHTML = `
                    <div class="error-message">
                        <h3>❌ 生成に失敗しました</h3>
                        <p>エラー: ${result.error}</p>
                        <button class="btn btn-secondary" onclick="document.getElementById('static-share-modal').querySelector('#share-generation-form').style.display='block'; document.getElementById('share-results').style.display='none';">再試行</button>
                    </div>
                `;
                form.style.display = 'none';
                results.style.display = 'block';
            }

        } catch (error) {
            console.error('静的ページ生成エラー:', error);
            resultsContent.innerHTML = `
                <div class="error-message">
                    <h3>❌ 生成中にエラーが発生しました</h3>
                    <p>エラー: ${error.message}</p>
                    <button class="btn btn-secondary" onclick="document.getElementById('static-share-modal').querySelector('#share-generation-form').style.display='block'; document.getElementById('share-results').style.display='none';">再試行</button>
                </div>
            `;
            form.style.display = 'none';
            results.style.display = 'block';
        } finally {
            // ボタンを元に戻す
            generateBtn.disabled = false;
            generateBtn.textContent = '📄 静的ページを生成';
        }
    }

    /**
     * 静的ページボタンの表示・非表示を制御
     */
    updateStaticPageButton(bookshelfId) {
        const button = document.getElementById('view-static-page');
        if (!button) return;

        if (bookshelfId === 'all') {
            button.style.display = 'none';
        } else {
            const bookshelf = this.userData.bookshelves?.find(b => b.id === bookshelfId);
            if (bookshelf && bookshelf.isPublic) {
                button.style.display = 'inline-block';
            } else {
                button.style.display = 'none';
            }
        }
    }

    /**
     * 現在選択中の本棚の静的ページを開く
     */
    openStaticPage() {
        const currentBookshelfId = document.getElementById('bookshelf-selector').value;
        if (currentBookshelfId === 'all') return;

        this.openStaticPageById(currentBookshelfId);
    }

    /**
     * 指定IDの本棚の静的ページを開く
     */
    openStaticPageById(bookshelfId) {
        const bookshelf = this.userData.bookshelves?.find(b => b.id === bookshelfId);
        if (!bookshelf || !bookshelf.isPublic) {
            alert('この本棚は公開されていません');
            return;
        }

        const staticUrl = `${window.location.origin}${window.location.pathname.replace('index.html', '')}static/${bookshelfId}.html`;
        window.open(staticUrl, '_blank');
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