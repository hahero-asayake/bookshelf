// 取込画面 (js/screens/import.js)
// イシュー#543 (U8c): bookshelf.js の VirtualBookshelf が持っていた取込画面(Kindle 等の取込モーダル・
// 取込の手順画面・取込結果の表示)専用メソッド26個(モーダルの開閉/端末判定/レーン表示6 + 本選択UI6 +
// 選択本の取込実行1 + ファイル/貼付/クリップボード入力4 + ブックマークレット/ショートカットのコード
// 生成とコピー5 + Amazon連携の起動とリレー受信待ち3 + 取込結果表示1 = 26。範囲の確定は
// docs/char/u8c-step1-scope.md §1) を、ここへ移した(移動のみ・本文は1行も書き換えていない)。
//
// 取り付け方 (Plan A・U7(article-editor.js)/U8a(settings.js)/U8b(book-detail.js)と同じ形・
// docs/char/u7-step1-scope.md §7参照):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (window.bookshelf.showImportModal(...) などは無変更で動く・テストの直接呼び出し・
// plugin-api.jsからの呼び出しも同様。今回はplugin-api.jsからの直接参照は0件・§4参照)。
//
// 混在メソッドについての注記(②承認2026-11-13・#543 step1 §7-2):
//  - openAmazonForBookmarklet・_startKindleRelayPoll・_stopKindleRelayPoll の3件は、通信/タイマー本体
//    (fetch・setInterval・postMessageリスナー・setTimeout)と画面DOM更新/画面遷移(#import-relay-statusの
//    表示切替・showImportModal/showBookSelectionForImport呼び出し)が1メソッド内に混在している。
//    ②承認基準「混在時は本文無変更を優先し画面側として扱ってよい」に従い、3件とも分割せず丸ごと
//    画面側(ここ)へ移した。
//  - importSelectedBooks も、実データ登録は別クラス(js/book-manager.js BookManager.importSelectedBooks、
//    65行)への1行委任(this.bookManager.importSelectedBooks(...))のみで、本体は選択UIのハンドラ+
//    取込結果表示のオーケストレーション。画面側の処理として移した(②承認)。
//
// JSDocコメントの帰属についての注記(実測・#543 step1 §1-E):
//  - _buildKindleBookmarkletPanelCode の直前には2つのJSDocブロックが連続している。1つ目
//    (「Amazon Kindle ライブラリページで実行されるブックマークレットのコードを生成...」)は実際には
//    _buildKindleBookmarkletCode(このファイルの少し下)の説明で、2つ目(「Amazon 蔵書一覧ページに
//    一意id...」)が_buildKindleBookmarkletPanelCode自身の説明(U8a/U8bで見つかった同種のJSDoc
//    帰属ズレと同じパターン)。両方とも本イシューの移動対象メソッドを説明しているため、並び替えずに
//    元のbookshelf.jsにあった連続したテキストのまま、ひと塊で移した(本文無変更の原則を優先)。
//
// 依存一覧(足場・docs/char/u8c-step1-scope.md §2/§3を参照。次の段=クラス化・注入の材料。今回はしない):
//  - 実データの登録本体(画面ではない・別クラス): js/book-manager.js BookManager.importSelectedBooks
//    (importSelectedBooks内でthis.bookManager.importSelectedBooks(...)として1行委任)
//  - VirtualBookshelf 側に残した、取込専用ではないメソッド/状態:
//    this.bookManager.getAllBooks()(蔵書一覧の正本・重複チェック用)/ this.userData(._storage.exclusions・
//    .bookOrder・.settings)/ this.books / this.applyFilters() / this.updateStats() / this.saveUserData()
//  - nav/overlay/Surfaceの共通基盤(画面ではない・bookshelf.js側に残る・今回は移さない):
//    setupEventListeners/_overlays/_surface 等。setupEventListeners内の複数バインドが、ここへ移した
//    画面メソッドをthis経由で呼ぶ(showImportModal/importFromFile/importFromPasteInput/
//    readClipboardForImport/openAmazonForBookmarklet/copyKindleBookmarklet/_cancelKindleImportWait/
//    closeImportModal)。visibilitychangeリスナー(bookshelf.js側)が_startKindleRelayPollが設定する
//    this._kindleRelayTickを読む。コマンドパレット定義・本棚一覧の空状態アクション・_navReopenマップも
//    showImportModalをthis経由で呼ぶ。いずれもPlan Aではthis.経由のため、ファイルを移しても無変更で動く
//  - 取込メソッド群の行範囲に挟まっているが取込画面ではない(今回は動かさない・別画面/別領域):
//    本棚一覧のKindle区分フィルタ(_kindleCategoriesOf/_updateKindleFilterUI)・本の詳細保存/ASIN移行
//    (saveBookChanges/migrateUserData)・一覧カードのメモ表示ヘルパー(updateMemoPreview等)・
//    プラグイン管理画面(showPluginsModal等7件、U8aの見落とし)は、U8a補完(イシュー#544)で
//    settings.jsへ移動済み(show/closePluginsModalはデッドコードとして削除)・
//    プラグイン公開可否の収集(_collectPublishablePluginIds、js/exporter.jsが使うデータ層)・
//    手動追加モーダル(showAddBookModal)。詳細はdocs/char/u8c-step1-scope.md §2
//  - 他画面からこの一覧の名前を直接読み書きする箇所(bookshelf.js側に残る・無変更で動く):
//    一覧は docs/char/u8c-step1-scope.md §3/§4 参照

class _ImportMethods {
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
            // 左ツリーの冊数・ホームの蔵書数を描き直す (新規分も再取込のマージも・イシュー#605)
            this._onLibraryChanged();

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
}

const _importDescriptors = Object.getOwnPropertyDescriptors(_ImportMethods.prototype);
delete _importDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _importDescriptors);
