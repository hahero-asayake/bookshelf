// 本の詳細画面 (js/screens/book-detail.js)
// イシュー#542 (U8b): bookshelf.js の VirtualBookshelf が持っていた本の詳細(右ペイン・モバイルの
// 本モーダル)専用メソッド15個(開く・閉じる・ナビゲーション5 + セクション順序並び替え3 +
// 短文メモ自動保存ハンドラ1 + 長文メモ(アプリ内エディタ)の開閉6 = 15。範囲の確定は
// docs/char/u8b-step1-scope.md §1) を、ここへ移した(移動のみ・本文は1行も書き換えていない)。
//
// 取り付け方 (Plan A・U7(article-editor.js)/U8a(settings.js)と同じ形・docs/char/u7-step1-scope.md §7参照):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (window.bookshelf.showBookDetail(...) などは無変更で動く・テストの直接呼び出し・
// plugin-api.jsからの呼び出しも同様)。
//
// 名前についての注記(②指摘2026-11-13・#542 step2):
//  - closeModal は名前が汎用的だが、中身は本の詳細モーダルを閉じる専用の処理(他画面のモーダルは
//    各画面がそれぞれ別の _closeXxxModal を持つ)。呼び出し元(bookshelf.js側に残る
//    removeFromBookshelf/excludeBook/deleteBook/saveBookChanges等、ドメイン操作完了後の後始末)
//    からthis.closeModal()で呼ばれるが、Plan Aでは定義ファイルに関わらず同じ関数を指すため無変更で動く。
//
// 依存一覧(足場・docs/char/u8b-step1-scope.md §2/§3を参照。次の段=クラス化・注入の材料。今回はしない):
//  - VirtualBookshelf 側に残した、本の詳細専用ではないメソッド:
//    saveNote/_toggleAllNoteFlag/saveRating (notesの読み書き本体・saveNoteはarticle-editor.jsの
//    本棚ブロックの短文メモ欄からも呼ばれる共有の書き込み窓口)
//    generateStarRating/_starWidgetHtml/_applyRatingEverywhere/_getStarVisibility/_getStarOverlay/
//    _getMemoVisibility/_setDisplaySetting (一覧カードの表示設定・描画と共用)
//    _dupAsinInfo (一覧カードの重複ASIN判定と共用)
//    openOrCreateBookMemo (長文メモの入口の本体。アプリ内エディタ/Obsidian/システムの3分岐のうち
//    後者2つはメモファイル書き込み・clipboard書き込み・obsidian://リンク生成というドメイン/
//    ファイルI/O処理そのもので画面描画を伴わないため、U7で一旦bookshelf.js残留とされていた
//    判断をここで確定。本の詳細側のボタンハンドラ(showBookDetail内)からthis.openOrCreateBookMemo()
//    で呼ぶ。アプリ内エディタに分岐した場合に呼ばれる_openBookMemoInAppEditor等6件は、
//    実測で「本の詳細からしか開かない」と確認できたためbook-detail.js側に含めた)
//    _openMdEditor/_mdeToolbarConfig/_mdeApplyToolbarLabels/_mdeToggleHeadingMenu/
//    _mdeCloseHeadingMenu/_mdeCurrentHeadingLevel/_mdeApplyHeadingLevel/_mdeDestroyEditor/
//    _ensureEasyMDELoaded/_mountFsHeader (長文メモの共通Markdownエディタ部品。U7で既に
//    記事の文章ブロック全画面とも共用と確定済み・article-editor.js:1164が_openMdEditorを呼ぶ)
//  - nav/overlay/Surfaceの共通基盤(画面ではない・bookshelf.js側に残る・今回は移さない):
//    setupEventListeners/_isHistMobile/_navMobile/_formSnapOf/_formSnapTake/_formBackGuard/
//    _navReopen/_navOnLanded/_overlays/_modalHistPush/_defineSurfaces/_surface/_modalHistPop/
//    _applyRoute/_savePaneState/_closeOverlayFacesSilently/_navigateFromUi 等。_navReopenのマップに
//    'book-memo-modal': () => this._reopenBookMemo(st.asin) のように、移動後の名前を呼ぶ行があるが、
//    Plan Aではthis.経由なのでファイルを移しても無変更で動く
//  - 本棚・本のドメイン操作(bookshelf.js側に残る・showBookDetailのボタンから呼ぶ):
//    addBookToBookshelf/removeFromBookshelf/deleteBook/excludeBook
//  - VirtualBookshelf 側の状態・入れ物(thisのまま読む): this.userData(notes/bookshelves/settings/
//    hiddenBooks) / this.bookshelfManager(resolveMemo/resolveRating/getById/getBySlug/setMemo) /
//    this.bookManager(getAmazonUrl/isKindleBook/getKindleReadUrl/hasCoverImage/getProductImageUrl) /
//    this.storage(readBookMemo/writeBookMemo) / this.nav / this.router / this._suppressRouterUpdate /
//    this.pluginAPI(_runDetailSections・_emit) / this.saveUserData()
//  - showBookDetailが持つ状態を、bookshelf.js側の共通基盤が逆に読む箇所(実測・docs/char/u8b-step1-scope.md §3):
//    this._lastDetailBook/this._lastDetailEditMode は showBookDetail内で設定されるが、
//    setupEventListeners内(表示設定変更時の再描画)と_applyRoute内(編集モード保持判定)の2箇所から
//    読まれる。Plan Aでは状態はインスタンス(this)に乗るため、定義ファイルが変わっても影響しない
//  - プラグインとの橋: js/plugin-api.js:389がthis._app.showBookDetail(b)を、
//    js/plugin-api.js:283-284がthis._app._currentBookshelfInternalId()を直接呼ぶ。
//    ファイルを分けても呼び方は変わらないため影響なし
//  - js/nav-state.jsが起動時にwrap(app, 'showBookDetail', ...)・wrap(app, '_closeBookModalDom', ...)で
//    インスタンスの同名プロパティを読んでラップする(nav-state.js:120-128のwrap実装を確認済み)。
//    obj[name]はprototypeチェーンをたどる通常のプロパティアクセスのため、定義ファイルが変わっても影響しない
//  - 他画面からこの一覧の名前を直接読み書きする箇所(bookshelf.js側・js/nav-state.js側に残る・無変更で動く):
//    一覧は docs/char/u8b-step1-scope.md §4 参照

class _BookDetailMethods {
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
        await this.saveUserData();
    }

    // 編集モード時のセクション drag&drop 並び替え (Pointer Events化=イシュー#337、②承認で対象に追加)。
    // .bd-grip 上の pointerdown で開始 (本カードと同じ型)。ドロップ確定時に DOM 要素を実際に動かしてから保存する
    // (モーダル全体の再描画は showBookDetail の冪等化ガードに阻まれるため、再描画せず直接反映する)。
    _bindDetailSectionReorder(root, book) {
        const container = root.querySelector('#bd-sections');
        if (!container) return;
        this._bindPointerReorder(container, {
            itemSelector: '.bd-section',
            handleSelector: '.bd-grip',
            dragClass: 'is-dragging',
            zoneMode: 'index',
            indicatorClass: 'bd-section-drop-indicator',
            computeInsertIndex: (c, cx, cy) => this._computeInsertIndexByY(c, '.bd-section', cy),
            getKey: (el) => el.dataset.section,
            onDrop: async (sectionId, idx) => {
                const draggedEl = container.querySelector(`.bd-section[data-section="${sectionId}"]`);
                const items = Array.from(container.querySelectorAll('.bd-section')).filter(el => el !== draggedEl);
                if (draggedEl) {
                    if (idx >= items.length) container.appendChild(draggedEl);
                    else items[idx].before(draggedEl);
                }
                const newOrder = Array.from(container.querySelectorAll('.bd-section'))
                    .map(s => s.dataset.section)
                    .filter(Boolean);
                await this._saveDetailSectionOrder(newOrder);
            },
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
        // イシュー#330: 冪等化(安全策)。既に同じ本が同じモードで開いていれば何もしない
        // (「進む」で開く処理が2回走っても、2回目はここで止まり二重アニメーションにならない)。
        if (book && this._lastDetailBook && this._lastDetailBook.asin === book.asin
            && !!this._lastDetailEditMode === !!isEditMode
            && document.body.classList.contains('book-detail-pinned')) return;
        // Router 連携（_applyRoute 由来でない場合のみ URL を更新）
        if (this.nav) {
            // イシュー#359 段階③: 台帳へ「本を開く」を入力 (URL #book/ と、スマホ幅なら本詳細の段を 1 回の pushState で)。
            // 同じ本の編集モード切替は写しの更新 (replace) になり、進む/戻るで開き直しても編集のまま (R08i)。
            // 着地 (_applyRoute 由来・_suppressRouterUpdate) では台帳が既に正しいので入力しない
            if (!this._suppressRouterUpdate && book && book.asin) {
                this._closeOverlayFacesSilently();
                this.nav.openBook(book.asin, !!isEditMode, this._currentBookshelfInternalId(), { mobile: this._navMobile() }); // イシュー#513 S6
            }
        } else if (this.router && !this._suppressRouterUpdate && book && book.asin) {
            const fromInternalId = this._currentBookshelfInternalId();
            this._navigateFromUi('book', book.asin, fromInternalId);
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
        const esc = BookshelfEscape.escapeHtml;

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

        // 基本情報セクション body (meta-row + メタ編集フィールド)。
        // 案A (イシュー#453・②決裁2026-11-02): 旧 <details class="bd-meta-edit"> の折りたたみ入れ子
        // (ui-standards §7 原則6違反) を撤去し、常時展開のインライン欄にする。専用の「保存」「キャンセル」
        // ボタンも撤去し、保存は topbar の編集終了ボタン (.bd-edit-toggle.cancel-edit-btn) 1つに統合する
        // (下記グローバルクリックハンドラの cancelBtn 分岐が saveBookChanges を呼ぶ)。
        // イシュー#484: 重複ASIN案内。別の本に同じASINが付いた場合(sameTitle=false)は
        // 「編集」→「オリジナルASIN」欄(book.asin自体を書き換える方。「変更後ASIN」欄は表示・
        // リンク用の上書きで移行処理は走らない)での付け直しを案内する。付け直すと、もう一方の本の
        // メモ・並び順・除外・非表示・本棚所属はそのまま残り、新ASIN側へは同じ内容がコピーされる
        // (②差し戻し2026-11-02: 旧実装は「移す」=もう一方の本から消えてしまっていた。既存データは
        // 削除・統合しない方針のため、付け直し後しばらくは両方に同じ内容が残る=不要な方は利用者が
        // 消す、という前提をここで案内する)。同じ本の二重登録(sameTitle=true・実害小)は文言を分け、
        // 削除・統合は促さない(②指示)。
        const dupGroup = this._dupAsinInfo().get(book.asin);
        const dupNoticeHtml = dupGroup ? (dupGroup.sameTitle
            ? `<div class="bd-dup-asin-notice">${ico('info')}<span>同じ本が複数登録されています(ASIN: ${esc(dupGroup.asin)})。統合・削除は必要ありません。</span></div>`
            : `<div class="bd-dup-asin-notice">${ico('alert-triangle')}<span>このASINは他の本と共有されています。メモ・並び順・除外設定が共有される可能性があります。「編集」の「オリジナル ASIN」欄で正しいASINに付け直すことをお勧めします。付け直した直後はメモなどが両方の本に残ります。不要な方は削除してください。</span></div>`
        ) : '';
        const basicInfoBody = `
            <div class="bd-meta">
                <div class="bd-meta-row"><span class="k">購入</span><span>${new Date(book.acquiredTime).toLocaleDateString('ja-JP')}</span></div>
                <div class="bd-meta-row"><span class="k">ASIN</span><span>${esc(book.asin)}${book.updatedAsin ? ` → ${esc(book.updatedAsin)}` : ''}</span></div>
            </div>
            ${dupNoticeHtml}
            ${isEditMode ? `
                <div class="bd-meta-edit-inline">
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
                </div>
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
                <div class="bd-section${def.context ? ' has-context' : ''}" data-section="${id}">
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
                        ${this.bookManager.hasCoverImage(book)
                            ? `<img src="${esc(this.bookManager.getProductImageUrl(book))}" alt="${esc(book.title)}" data-cover-fallback="${esc(book.title)}">`
                            : `<span class="bd-cover-placeholder">${window.renderIcon('book-open', { size: 40 })}</span>`}
                        ${showOverlay ? `<div class="bd-cover-stars stars-overlay">${starWidget}</div>` : ''}
                    </div>
                </div>

                <h3 class="bd-title">${esc(book.title)}</h3>
                <div class="bd-author">${esc(book.authors)}</div>
                ${BookList.kindleBadgesHtml(book)}

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
        // イシュー#359 段階③: × で本を閉じる = 台帳から本詳細を外し、URL を from の本棚かホームへ (旧と同じく replace)。
        // 画面は旧 replace 経路と同じく同期 dispatch で合わせる
        if (this.nav) {
            const cur = this.nav.state.route;
            if (cur && cur.view === 'book') {
                let route = { view: 'main' };
                if (cur.from) {
                    const bs = this.bookshelfManager?.getByInternalId?.(cur.from) || this.bookshelfManager?.getById?.(cur.from);
                    if (bs?.slug) route = { view: 'bookshelf', slug: bs.slug };
                }
                this.nav.closeBook(route);
                if (this.router) this.router._dispatch(route);
            }
            return;
        }
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
        window.SaveStatus.set(statusEl, '入力中…'); // イシュー#518: SaveStatus経由(短文メモ)
        const timer = setTimeout(async () => {
            this._noteAutoSaveTimers.delete(key);
            try {
                await this.saveNote(asin, value);
                window.SaveStatus.set(statusEl, '保存しました', { autoClearMs: 1500 });
            } catch (e) {
                console.error('メモ自動保存エラー:', e);
                window.SaveStatus.set(statusEl, e.message || '保存失敗');
            }
        }, 300);
        this._noteAutoSaveTimers.set(key, timer);
    }

    // 本の詳細を閉じる (手元の資料・×/Esc/スマホ戻るの共通の閉じ手・イシュー#511 X1 P11)。
    // D03: #book/ で開いている時は履歴で戻す (ハッシュの段を残さない)。それ以外 (ホームの右ペイン等) は従来どおり
    _exitBookDetail() {
        if (location.hash.startsWith('#book/')) history.back();
        else document.body.classList.remove('book-detail-pinned');
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

    // ヘッダー2行目に出す行数・文字数 (イシュー#282・②決裁=タイトル下2行目に小さく表示)
    _bookMemoFsSubText(markdown) {
        const v = markdown || '';
        const lines = v.length ? v.split('\n').length : 0;
        return `${lines}行・${v.length}字`;
    }

    // アプリ内 Markdown エディタ (EasyMDE) でメモを開く
    async _openBookMemoInAppEditor(asin, book) {
        const modal = document.getElementById('book-memo-modal');
        const titleEl = document.getElementById('book-memo-fs-title');
        const textareaEl = document.getElementById('book-memo-textarea');
        const statusEl = document.getElementById('book-memo-status');
        if (!modal || !textareaEl) return;

        // ハヘロ追加決裁(2026-10-13 01:22): ヘッダーの「長文メモ: 」接頭辞を外し書名だけ出す
        // (書名を少しでも長く見せるため)。読み上げ用に aria-label/title には接頭辞つきを残す。
        if (titleEl) {
            const plain = book.title || asin;
            titleEl.textContent = plain;
            titleEl.setAttribute('aria-label', `長文メモ: ${plain}`);
            titleEl.setAttribute('title', `長文メモ: ${plain}`);
        }
        window.SaveStatus.set(statusEl, '読み込み中...'); // イシュー#518: SaveStatus経由(長文メモ)

        // 旧 EasyMDE インスタンスがあれば破棄
        if (this._bookMemoEditor) {
            this._mdeDestroyEditor(this._bookMemoEditor);
            this._bookMemoEditor = null;
        }

        let existing = null;
        try {
            existing = await this.storage.readBookMemo(asin, book.title);
        } catch (e) {
            // 読込失敗 (通信/認証/権限エラー等) は「まだ書いていない」と取り違えない。
            // テンプレートで開いて保存すると、既存の長文メモを空/テンプレで上書きしてしまうため、
            // ここで止めてエディタを作らない (保存導線の _bookMemoEditorContext も張らない)。
            // ctx/editorが無い間は完了(_bookMemoFsDone)も保存せず閉じるだけになる(イシュー#282)。
            console.error('長文メモ読み込みに失敗:', e);
            this._bookMemoEditorContext = null;
            textareaEl.value = '';
            this._overlays().open(modal, { kind: 'modal', size: 'full', hist: false }); // 重なり管理役 (イシュー#367): 全画面
            this._surface().open('book-memo-modal', { close: (o) => this._bookMemoFsDone(o), extra: { asin } });
            window.SaveStatus.set(statusEl, '読み込めませんでした。接続を確認して開き直してください。');
            return;
        }
        if (existing == null) {
            existing = this.storage.buildBookMemoTemplate(book);
        }
        // frontmatter はアプリ内では見せない (ADR-024)。保存時に再結合するため保持
        const { frontmatter, body } = BookshelfStorage.splitFrontmatter(existing);
        this._bookMemoFrontmatter = frontmatter;
        textareaEl.value = body;

        // 重なり管理役 (イシュー#367): 全画面 (full・設計案 19 §5「編集に集中する」)。履歴は従来どおり _modalHistPush/Pop
        this._overlays().open(modal, { kind: 'modal', size: 'full', hist: false });
        this._surface().open('book-memo-modal', { close: (o) => this._bookMemoFsDone(o), extra: { asin } });

        try {
            await this._ensureEasyMDELoaded();
        } catch (e) {
            console.error('EasyMDE読み込みに失敗:', e);
            window.SaveStatus.set(statusEl, 'エディタライブラリの読み込みに失敗しました');
            return;
        }
        // モーダルを開いた後の非同期読み込みなので、待っている間にモーダルが閉じられている
        // 可能性がある (閉じた後に旧テキストエリアへエディタを生やさないためのガード)。
        if (!modal.classList.contains('show')) return;
        // イシュー#279: EasyMDE生成は _openMdEditor (文章ブロック全画面と共通)。
        // showStatus:false (EasyMDE内蔵の行数/単語数バーは使わない) + onChange で行数・文字数を
        // ヘッダー2行目(#book-memo-status)へ出す (イシュー#282)。
        const updateSub = (md) => { window.SaveStatus.set(statusEl, this._bookMemoFsSubText(md)); };
        this._bookMemoEditor = this._openMdEditor({ textareaEl, compact: false, showStatus: false, autoFocusIfWide: false, onChange: updateSub });
        this._bookMemoEditorContext = { asin, title: book.title };
        this._bookMemoInitial = body;   // 閉じる時の破棄確認用 (未保存の変更検出)
        updateSub(body);
    }

    // 長文メモ: 完了 (保存して閉じる)。Esc・戻るもこれを呼ぶ (記事エディタの art-fs-done と同じ
    // 規則・イシュー#282・②決裁B)。保存失敗時は閉じずにステータス表示のまま編集を続けさせる。
    // 読込失敗時 (_bookMemoEditorContext/_bookMemoEditor が無い) は保存せず閉じるだけ。
    async _bookMemoFsDone({ fromHistory = false } = {}) {
        const ctx = this._bookMemoEditorContext;
        const editor = this._bookMemoEditor;
        if (!ctx || !editor) return this._bookMemoFsClose({ fromHistory });
        const statusEl = document.getElementById('book-memo-status');
        window.SaveStatus.set(statusEl, '保存中...'); // イシュー#518: SaveStatus経由(長文メモ)
        try {
            // body のみ編集させ、保持していた frontmatter (updated を自動更新) と再結合 (ADR-024)
            const content = BookshelfStorage.joinFrontmatter(this._bookMemoFrontmatter, editor.value());
            await this.storage.writeBookMemo(ctx.asin, ctx.title, content);
            if (!this.userData.notes[ctx.asin]) this.userData.notes[ctx.asin] = { memo: '', rating: 0 };
            this.userData.notes[ctx.asin].hasDetailMemo = true;
            await this.saveUserData();
            this._bookMemoInitial = editor.value();
            return this._bookMemoFsClose({ fromHistory });
        } catch (e) {
            console.error('長文メモ保存失敗:', e);
            window.SaveStatus.set(statusEl, `${e.message}`);
            return false; // 閉じない (保存失敗時は編集を続けさせる・detail指定どおり)
        }
    }

    // 長文メモ: キャンセル (変更があれば破棄確認)。文言は _artCloseBlockFs (本棚/本/文章ブロック)
    // と同じ型に揃える (イシュー#282)
    async _bookMemoFsCancel({ fromHistory = false } = {}) {
        const editor = this._bookMemoEditor;
        if (editor && this._bookMemoInitial != null && editor.value() !== this._bookMemoInitial) {
            const ok = await confirmDialog({
                title: '変更を破棄しますか？',
                message: 'この長文メモで行った変更を取り消します。',
                okLabel: '変更を破棄',
                cancelLabel: '編集を続ける',
                danger: true
            });
            if (!ok) return false; // 閉じなかった (popstate 経由なら履歴が積み直される)
        }
        return this._bookMemoFsClose({ fromHistory });
    }

    // 長文メモ: モーダルを閉じて状態をリセットする共通処理 (完了/キャンセルの両方から呼ぶ)
    _bookMemoFsClose({ fromHistory = false } = {}) {
        this._overlays().close('book-memo-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('book-memo-modal', { fromHistory });
        if (this._bookMemoEditor) {
            this._mdeDestroyEditor(this._bookMemoEditor);
            this._bookMemoEditor = null;
        }
        this._bookMemoEditorContext = null;
        this._bookMemoFrontmatter = null;
        this._bookMemoInitial = null;
        return true;
    }

    // イシュー#291: 「進む」で長文メモを開き直す。state.asin から本を特定する。
    async _reopenBookMemo(asin) {
        if (!asin) return;
        const book = this.bookManager.getAllBooks().find((b) => b.asin === asin);
        if (!book) return;
        await this._openBookMemoInAppEditor(asin, book);
    }

}

const _bookDetailDescriptors = Object.getOwnPropertyDescriptors(_BookDetailMethods.prototype);
delete _bookDetailDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _bookDetailDescriptors);
