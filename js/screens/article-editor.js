// 記事エディタ (js/screens/article-editor.js)
// イシュー#525 (U7): bookshelf.js の VirtualBookshelf が持っていた記事エディタ専用メソッド138個
// (_art* 132個 + openPublishPagesModal/closePublishPagesModal/openPublishSettingsModal/
// closePublishSettingsModal/_ensureFreeAffiliateConsent/_handleAdapterWriteStatus の6個=
// 中身は記事専用だが _art を名乗っていないもの。②判断=責務で決める。docs/char/u7-step1-scope.md §2/§7)
// を、ここへ移した(移動のみ・本文は1行も書き換えていない)。
//
// 取り付け方 (Plan A・docs/char/u7-step1-scope.md §7):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (window.bookshelf._artXxx(...) などは無変更で動く・テストの直接呼び出し・上書きも同様)。
//
// 依存一覧(足場・docs/char/u7-step1-scope.md §3を参照。次の段=クラス化・注入の材料。今回はしない):
//  - VirtualBookshelf 側に残した、記事専用ではないメソッド:
//    _placeAnchoredMenu (汎用のメニュー位置決め・どの画面からも使う)
//    _openMdEditor/_ensureEasyMDELoaded/_mdeToolbarConfig/_mdeApplyToolbarLabels/
//    _mdeToggleHeadingMenu/_mdeCloseHeadingMenu/_mdeCurrentHeadingLevel/_mdeApplyHeadingLevel/
//    _mdeDestroyEditor/_mountFsHeader/openOrCreateBookMemo
//    (本の長文メモの編集でも同じMarkdown部品を使うため共有。記事専用ではない＝U8かそのあとの
//    共通部品の単位で扱う。呼び出し元を実測して確認済み・docs/char/u7-step1-scope.md §2)
//  - VirtualBookshelf 側の状態・入れ物(thisのまま読む): this.storage / this.publishArticleStore /
//    this.publishArticleGenerator / this.bookManager / this.bookshelfManager / this._surface() /
//    this.userData / SyncConfigManager(static import) / confirmDialog / BookshelfEscape.escapeHtml /
//    window.renderIcon / window.applyIcons
//  - プラグインとの橋: window.bookshelfAPI.getArticleThemes(kind) (globalの window.bookshelfAPI 経由。
//    this. ではないため、このファイルを分けても呼び方は変わらない)
//  - VirtualBookshelf のコンストラクタ(bookshelf.js 190〜280行)に this._art* の初期代入は無い
//    (実測・2026-11-04)。_artDraft/_artMode 等 約40種の状態は、下の各メソッドが初回に自分で作る
//    (例: _artSetupUI が this._artBound を代入)。状態の持ち主は今もVirtualBookshelf自身であり、
//    このファイルは別のインスタンスを持たない。コンストラクタ側の変更は無い。
//  - 他画面からこの一覧の名前を直接読み書きする箇所(bookshelf.js側に残る・無変更で動く):
//    js/nav-state.js:201(_artHistHandOver をwrap)。bookshelf.js 内の可視性変化ハンドラ・
//    URLルート表など。一覧は docs/char/u7-step1-scope.md §4 参照。

class _ArticleEditorMethods {
    async _artRunExclusive(id, task) {
        if (!this._artOpInFlight) this._artOpInFlight = new Set();
        if (this._artOpInFlight.has(id)) return;
        this._artOpInFlight.add(id);
        try {
            return await task();
        } finally {
            this._artOpInFlight.delete(id);
        }
    }

    /**
     * export → 失敗時ロールバック、の共通パターン (_artPublishArticle/_artUnpublish/_artDelete の
     * 3箇所重複を解消・イシュー#374・案D)。published の update 自体は呼び出し元が行う (update成功
     * 直後に draft/badge へ即時反映するタイミングが関数ごとに異なるため、update はここに含めない)。
     * ユーザーに見える文言・toast・URL 案内は呼び出し元が組み立てる (ここでは出さない・
     * 設計書20番ノート§3制約・ADR-041/042＝コアの挙動は変えない)。
     * @param {string} id
     * @param {boolean} wasPublished ロールバック先の状態 (呼び出し元が変更前の値を渡す)
     * @returns {Promise<{ok:true, result:object} | {ok:false, reason:string, error?:Error, rollbackFailed?:boolean}>}
     */
    async _artExportOrRollback(id, wasPublished) {
        const r = await this._runPublishExport();
        if (r.ok) return { ok: true, result: r.result };
        let rollbackFailed = false;
        try {
            await this.publishArticleStore.update(id, { published: wasPublished });
        } catch (e) {
            rollbackFailed = true;
            console.error('公開状態のロールバックに失敗:', e);
        }
        return { ok: false, reason: r.reason, error: r.error, rollbackFailed };
    }

    // C2: ハブ無料プランで初めて公開する時、運営アフィリエイトタグが付く旨を明示し同意を取る。
    // 同意は settings.ackFreeAffiliate に記録し、以後は出さない。Plus は不要(true を返す)。
    // 公開先=github (自前 GitHub Pages) は運営タグを入れないので同意不要(true)。
    async _ensureFreeAffiliateConsent() {
        const cfg = SyncConfigManager.load();
        const target = (cfg.publish || {}).target === 'github' ? 'github' : 'hub';   // 既定=ハブに追随
        if (target !== 'hub') return true; // 自前サイトには運営タグを入れない
        const plan = (cfg.hub || {}).plan || 'free';
        if (plan === 'plus') return true;
        if (this.userData && this.userData.settings && this.userData.settings.ackFreeAffiliate) return true;
        const ok = await confirmDialog({
            title: '無料プランの公開について',
            message: '無料プランでは、公開ページの Amazon 商品リンクに運営（Asayake）のアフィリエイト ID が付き、その収益は運営に入ります。\n\n自分の収益にしたい、または広告を付けたくない場合は Plus プランをご利用ください。',
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

    // ===== 記事エディタ (公開v2 S3, ADR-058 §11) =====

    async openPublishPagesModal() {
        const modal = document.getElementById('publish-pages-modal');
        if (!modal) return;
        if (!this.publishArticleStore) { toast('公開システムが未初期化です。リロードしてください。', { type: 'error' }); return; }
        this._artSetupUI();
        // 未接続なら読込を試みない (dirHandle 未設定等の内部エラーをそのまま出さず、
        // 「未接続」の専用通知に任せる。§#art-store-notice)。接続済みでの読込失敗は
        // 「0件」と区別するため _artLoadError に保持し、一覧側でエラー行として出す。
        this._artLoadError = null;
        // イシュー#595: 閉じてすぐ開き直した時、まだ送っていない記事があれば読み直す前に送る。
        // 送れなければ読み直さない(読み直すとメモリにある未送信の記事を捨ててしまう)
        await this._artSettlePendingSave();
        let unsent = false;
        if (this._isSyncReady() && this.publishArticleStore.hasUnsavedChanges()) {
            unsent = !(await this._artFlushRemoteNow({ silent: true })).ok;
        }
        if (this._isSyncReady() && !unsent) {
            try {
                await this.publishArticleStore.load();
            } catch (e) {
                this._artLoadError = e;
                console.error('公開記事の読込に失敗:', e);
            }
        }
        this._artShowList();
        // 重なり管理役 (イシュー#367): 一覧は大 (lg)・編集に入ると全画面 (full・_artOpenEditor で setSize)。履歴は従来どおり _modalHistPush/Pop (hist:false)
        this._overlays().open(modal, { kind: 'modal', size: this._artMode === 'edit' || this._artMode === 'form' ? 'full' : 'lg', hist: false });
        if (typeof window.applyIcons === 'function') window.applyIcons(modal);
        // イシュー#468: #/publish を持たせる。閉じた時に戻す route (開く前にいた画面) を控える
        this._artPublishReturnRoute = (this.router && this.router.current) || { view: 'main' };
        this._surface().open('publish-pages-modal', { close: (o) => this.closePublishPagesModal(o), route: { view: 'publish' } });
    }

    closePublishPagesModal({ fromHistory = false } = {}) {
        // イシュー#511 X1 A-d: 編集画面(edit/form)を×・Escで出る時は、←(#art-back)と同じ行き先
        // (公開の一覧)にする。_artExitEditToListが保存のflushと段の畳み(_artShowList)を行う。
        // 戻る(fromHistory)はここに来ない(art-edit-mode/art-viewingの個別closerが先に段を1つずつ畳む・
        // イシュー#279の多段chainのまま=行き先は「開いた場所」で変えない)
        if (!fromHistory && (this._artMode === 'edit' || this._artMode === 'form')) {
            this._artExitEditToList();
            return;
        }
        // イシュー#595: 閲覧状態で題名などを打ってすぐ閉じた時も、保留中の保存を確定してすぐ送る
        // (閉じるのはawaitしない=行き先は変えない。送れなかった時の知らせは_artFlushRemoteが出す)
        // (イシュー#609: 本のメモの予約だけが残っている時も確定する=予約の有無は _artHasPendingSave で見る)
        if (this._artHasPendingSave()) this._artSettlePendingSave().then(() => this._artFlushRemoteNow()).catch(() => {});
        // イシュー#279: ×ボタンは閲覧状態からでも押せるため、残っている履歴段を先に畳む
        // (段を残したまま閉じると、次に開いた時や次回の戻る操作で不整合になる・②指示「段を残さない」)。
        this._artMode = 'view';
        this._overlays().close('publish-pages-modal', { reason: fromHistory ? 'history' : 'button' });
        // × / ESC は台帳が go(-1)・戻る由来 (fromHistory) は台帳が既に外している (旧 _modalHistPop と同じ規則)
        if (fromHistory) return;
        // イシュー#468: 記事サブ状態(art-edit-mode/art-viewing/publish-settings-modal)と
        // publish-pages-modal自体を1 applyでまとめて外しつつ route を戻す(旧実装は個別 _modalHistPop を
        // 複数回=別々の apply 呼び出しに分離していた・#442 step3で広範囲が崩れた原因)
        this.nav.closePublish(this._artPublishReturnRoute || { view: 'main' });
    }

    // イシュー#442: 公開の設定(旧 #publish-section を撤去し統合・ADR-145)。既存ID・保存処理は変更しない。
    // (イシュー#468: #/publish/settings のURLルートを持たせ、公開一覧と同じ closePublish3 の規則で閉じる)
    openPublishSettingsModal() {
        const modal = document.getElementById('publish-settings-modal');
        if (!modal) return;
        this._artSetupUI();
        this._reflectAffiliateField();
        this._reflectPublicNameField();
        // ハヘロ指摘①: 本棚トップの見た目をここに統合(共有ハブ公開時のみ・ADR-144 と同じ条件)
        const isHubTarget = (SyncConfigManager.load().publish || {}).target === 'hub';
        const siteThemeBlock = document.getElementById('art-site-theme');
        if (siteThemeBlock) {
            siteThemeBlock.hidden = !isHubTarget;
            if (isHubTarget) this._artRenderSiteThemeBlock();
        }
        this._overlays().open(modal, { kind: 'modal', size: 'lg', hist: false });
        if (typeof window.applyIcons === 'function') window.applyIcons(modal);
        this._surface().open('publish-settings-modal', { close: (o) => this.closePublishSettingsModal(o), route: { view: 'publish-settings' } });
    }

    closePublishSettingsModal({ fromHistory = false } = {}) {
        this._overlays().close('publish-settings-modal', { reason: fromHistory ? 'history' : 'button' });
        if (fromHistory) return; // 旧 _modalHistPop と同じ規則
        // イシュー#468: 公開一覧と同じ closePublish3 を使う(単独faceのみ除去される・②指示「同じ規則で揃える」)。
        // イシュー#511 X1 (②判断§4-3): 親は常に公開の一覧に固定 (Surfaceのdefineで決める)。開いた場所(router.current)
        // には戻さない=←/×と戻る(ブラウザの戻る)を別の動きにする。開いた場所に戻る動きは戻るが受け持つ
        this.nav.closePublish(this._surface().parent('publish-settings-modal') || { view: 'publish' });
    }

    _artSetupUI() {
        if (this._artBound) return;
        this._artBound = true;
        const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
        on('publish-pages-close', 'click', () => this.closePublishPagesModal());
        on('art-settings-open', 'click', () => this.openPublishSettingsModal()); // イシュー#442
        on('publish-settings-close', 'click', () => this.closePublishSettingsModal()); // イシュー#442
        on('art-new', 'click', () => this._artOpenEditor(null));
        on('art-back', 'click', () => this._artExitEditToList());
        // イシュー#595: タブを閉じる・裏に回る時も保留中の保存を確定する(js/bookshelf.js の記事のリモート flush と重なっても、
        // 予約が無ければ何もしない・送信中は publishArticleStore 側で1本にまとまる)
        const settleOnLeave = () => this._artSettleOnLeave();
        window.addEventListener('pagehide', settleOnLeave);
        window.addEventListener('beforeunload', settleOnLeave);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') settleOnLeave(); });
        this._artSetupDrawerShelfPicker();
        this._artBindViewportScroll(); // K-B (イシュー#276)
        // capture フェーズ + stopImmediatePropagation: 全モーダル共通の Esc ハンドラ (502行, bubbling
        // フェーズ) がモーダル自体を閉じてしまう前に、ツールチップだけを閉じて消費する。ツールチップが
        // 非表示のときは何もしないため、通常の Esc→モーダルを閉じる動作は妨げない。
        window.Surface.onEsc(document, (e) => {
            const tip = document.getElementById('art-item-tooltip');
            if (!tip || tip.hidden) return;
            this._artHideItemTooltip();
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);
        // イシュー#268: ＋シート/ブロックの⋯メニューが開いていれば、Esc はそれだけを閉じる (エディタ本体は閉じない)
        window.Surface.onEsc(document, (e) => {
            const sheet = document.getElementById('art-add-sheet');
            const menu = document.getElementById('art-blk-menu');
            const lk = document.getElementById('art-look-sheet');
            if (sheet && !sheet.hidden) this._artCloseAddSheet();
            else if (lk && !lk.hidden) this._artCloseLookSheet();
            else if (menu && !menu.hidden) this._artCloseBlkMenu();
            else if (this._artMode === 'form' && !document.querySelector('.cfm-overlay') && !document.querySelector('.mde-heading-menu') && !document.getElementById('art-drawer').classList.contains('is-open')) this._artCloseBlockFs(true);
            else return;
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);
        on('art-drawer-search', 'input', (e) => {
            this._artDrawerQuery = e.target.value.trim().toLowerCase();
            this._artRenderDrawer();
        });
        on('art-drawer-add-all', 'click', () => this._artOnDrawerAddAllClick());
        // イシュー#430 (②承認): 本棚トップの見た目は既定で選択中の1行だけ・押すと選択肢を開閉する。
        on('art-site-theme-toggle', 'click', () => {
            const list = document.getElementById('art-site-theme-list');
            const toggle = document.getElementById('art-site-theme-toggle');
            if (!list || !toggle) return;
            const open = list.hidden;
            list.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            toggle.classList.toggle('is-open', open);
        });
        // 900px以下のボトムシート (イシュー#165・案C): スクリム/×/Esc で閉じる。
        // イシュー#166: 開く入口だった FAB は廃止・ブロック内の追加ボタン(art-book-pick/art-shelf-add)に一本化。
        on('art-sheet-scrim', 'click', () => this._artCloseSheet());
        on('art-sheet-close', 'click', () => this._artCloseSheet());
        // 900px超限定: 本の引き出しを畳む (イシュー#168)。開くのは本エリア常駐ボタン (_artOpenSheet 経由)。
        on('art-drawer-collapse-btn', 'click', () => this._artSetDrawerUserCollapsed(true));
        on('art-publish-header', 'click', () => this._artOpenPublishPanel());
        on('art-pub-close', 'click', () => this._artClosePublishPanel());
        on('art-pub-cancel', 'click', () => this._artClosePublishPanel());
        on('art-pub-go', 'click', () => this._artPublishFromPanel());
        on('art-pub-copy', 'click', () => this._artCopyPublishUrl());
        const pubModal = document.getElementById('art-publish-modal');
        if (pubModal) pubModal.addEventListener('click', (e) => { if (window.Surface.isBackdrop(e, pubModal)) this._artClosePublishPanel(); });
        // ⋯ メニュー (複製・公開の取消・削除)。ESC と枠外クリックはメニューだけを閉じる (エディタは閉じない)
        on('art-more-btn', 'click', (e) => { e.stopPropagation(); this._artToggleMoreMenu(); });
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('art-more-menu');
            const btn = document.getElementById('art-more-btn');
            if (!menu || menu.hidden) return;
            if (btn && btn.contains(e.target)) return;
            this._artToggleMoreMenu(false);
        });
        window.Surface.onEsc(document, (e) => {
            const menu = document.getElementById('art-more-menu');
            if (!menu || menu.hidden) return;
            this._artToggleMoreMenu(false);
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);
        window.Surface.onEsc(document, (e) => {
            const side = document.getElementById('art-drawer');
            if (!side || !side.classList.contains('is-open')) return;
            // capture + stopImmediatePropagation: 全モーダル共通の Esc ハンドラ (594行, bubbling
            // フェーズ) が `.art-drawer` は `.modal` クラスを持たないため巻き込めず、モーダル自体を
            // 閉じてしまう (art-item-tooltip と同型の対処・ui-standards §1「モーダル内モーダルは
            // 最前面だけ閉じる」)。シートが開いていなければ何もせず通常の Esc→モーダル閉じを妨げない。
            this._artCloseSheet();
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);
        on('art-save-retry', 'click', () => this._artFlushSave().then(() => this._artFlushRemoteNow()));
        on('art-title', 'input', () => this._artOnTitleInput());
        on('art-preview', 'click', () => this._artPreview());
        // イシュー#268: 閲覧⇄編集トグル・＋シート・ブロックの⋯メニュー
        on('art-mode-edit', 'click', () => this._artSetMode('edit'));
        on('art-mode-done', 'click', () => this._artSetMode('view'));
        on('art-fs-done', 'click', () => this._artCloseBlockFs(true));
        on('art-look-btn', 'click', () => this._artOpenLookSheet());
        // 構成A (イシュー#276): 下部アクションバー (600px以下・編集状態)。見た目・公開・完了はヘッダーの
        // ハンドラをそのまま呼ぶ (同じ処理・置き場所だけ違う)。
        // イシュー#279: 「追加」ボタンはブロック間/末尾の「＋ここに追加」(.art-cv-ins-btn) と役割が
        // 重なるため撤去 (3ボタンに削減)。
        on('art-bar-look', 'click', () => this._artOpenLookSheet());
        on('art-bar-publish', 'click', () => this._artOpenPublishPanel());
        on('art-bar-done', 'click', () => this._artSetMode('view'));
        const lookSheet = document.getElementById('art-look-sheet');
        if (lookSheet) lookSheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this._artCloseLookSheet(); });
        on('art-width-preview', 'click', () => { this._artToggleMoreMenu(false); this._artPreview(); }); // 履歴の段も畳む (イシュー#284)
        on('art-fs-cancel', 'click', () => this._artCloseBlockFs(false));
        const addSheet = document.getElementById('art-add-sheet');
        if (addSheet) {
            addSheet.addEventListener('click', (e) => {
                if (e.target.closest('[data-close]')) { this._artCloseAddSheet(); return; }
                const item = e.target.closest('.art-add-sheet-item');
                if (!item || item.disabled) return;
                // イシュー#276 step3: 文章も本棚・本と同じ全画面 (form モード) に入るため、
                // どの型でも追加シートの履歴1段をそのまま _artEditBlock の全画面へ引き継ぐ
                this._artCloseAddSheet({ keepHistory: true });
                const at = this._artAddIndex == null ? (this._artDraft.blocks || []).length : this._artAddIndex;
                this._artInsertBlock(item.dataset.blockType, at);
                const added = (this._artDraft.blocks || [])[at];
                if (added) this._artEditBlock(added.id);
                // X3(イシュー#529・A-c): 本棚ブロックを足したら引き出しを開く(完了まで閉じない)。
                // handover(_artEditBlock内の_artHistHandOver・art-add-sheet→art-fsのrename)が終わった
                // 後に開くことで、段の積み順を常に art-fs(renameされた段)→art-sheet(新規push) に固定する
                // (#528で一度入れたaf26d73は逆順だったため、完了のgo(-1)が古い段へ戻りart-add-sheetが
                // 開き直る退行があった。back1回でart-sheetだけ畳めることを#529 step2で実測済み)。
                // 完了/キャンセル側はart-fs+art-sheetを1 applyで畳む(_artCloseBlockFs参照)
                if (added && added.type === 'shelf') this._artOpenSheet();
            });
        }
        const blkMenu = document.getElementById('art-blk-menu');
        if (blkMenu) blkMenu.addEventListener('click', (e) => {
            const b = e.target.closest('[data-blk-act]');
            if (b && !b.disabled) this._artBlkMenuAction(b.dataset.blkAct);
        });
        // モーダル内の要素がクリックの伝播を止めることがあるため、キャプチャ段階で枠外クリックを拾う
        document.addEventListener('click', (e) => {
            if (blkMenu && !blkMenu.hidden && window.Surface.isOutside(e, blkMenu)) this._artCloseBlkMenu();
        }, true);
        on('art-republish-all', 'click', () => this._artRepublishAll());
        on('art-dup', 'click', async () => { if (!this._artEditingId) return; await this._artDuplicate(this._artEditingId); this._artShowList(); });
        on('art-unpublish', 'click', async () => { if (!this._artEditingId) return; await this._artUnpublish(this._artEditingId); });
        on('art-del', 'click', async () => { if (!this._artEditingId) return; const did = await this._artDelete(this._artEditingId); if (did) this._artShowList({ skipSave: true }); });
        // タグ入力: サジェスト表示・Enter で確定・外側クリックで閉じる
        on('art-tag-input', 'input', () => this._artRenderTagSuggest());
        on('art-tag-input', 'focus', () => this._artRenderTagSuggest());
        on('art-tag-input', 'keydown', (e) => this._artOnTagInputKeydown(e));
        document.addEventListener('click', (e) => {
            const wrap = document.querySelector('.art-tag-input-wrap');
            if (wrap && window.Surface.isOutside(e, wrap)) this._artHideTagSuggest();
            document.querySelectorAll('.art-add-menu').forEach(m => { if (window.Surface.isOutside(e, m.parentElement)) m.hidden = true; });
        });
        // プレビュー別画面 (開閉のみ。生成本体はプレビュー機能のステップで実装)
        on('pp-preview-close', 'click', () => this._artClosePreviewModal());
        on('pp-preview-device', 'click', () => this._artTogglePreviewDevice());
        on('pp-preview-retry', 'click', () => this._artRetryPreview());
        const pm = document.getElementById('pp-preview-modal');
        if (pm) pm.addEventListener('click', (e) => { if (window.Surface.isBackdrop(e, pm)) this._artClosePreviewModal(); });
    }

    // 編集画面を←・×・Escのどれで出ても同じ行き先・同じ保存にする(イシュー#511 X1 A-d・#497 D1に合わせ
    // 確認ダイアログは出さない)。出る前に保存をflushしきり(ローカル反映→リモートへ即送信)、成功した時だけ
    // 公開の一覧へ(_artShowListが編集/閲覧の段を畳む)。失敗した時はその場にとどまる(状態表示は
    // _artFlushSave/_artFlushRemoteが既に出す。ブラウザの戻るはここを通らない=行き先は変えない)
    async _artExitEditToList() {
        // イシュー#595: 閲覧状態でも同じにする(新規作成は閲覧状態で開き、題名はそのまま打てる。
        // 旧実装は編集/フォーム状態の時だけ確定したため、題名を入れて600ms以内に←で戻ると、
        // 記事がまだ作られていない一覧を描いていた)。失敗した時にとどまるのも編集状態と同じ。
        await this._artSettlePendingSave();
        const r = await this._artFlushRemoteNow();
        if (!r || !r.ok) return false; // 保存できなかった=その場にとどまる
        this._artShowList({ skipSave: true });
        return true;
    }

    // イシュー#279 (②承認4段構造の3→4): 一覧へ戻る唯一の経路。←ボタン・複製後・削除後・戻る操作
    // (popstate 経由の art-viewing close) のいずれから呼ばれても、まだ畳んでいない「編集状態」
    // 「閲覧状態」の履歴段をここで一括して畳む (history.back相当・②指示「段を残さない」)。
    // 編集中の変更はここで保存してから一覧へ戻す (②指示「編集中に一覧へ戻る時は保存してから戻る」)。
    // skipSave: 削除直後 (_artEditingId が既に削除済みの記事を指す) は保存するとエラーになるため呼び出し元が true を渡す。
    _artShowList({ skipSave = false } = {}) {
        this._artCloseSheet(); // ビュー切替でボトムシートも畳む (開いていなければ no-op)
        // イシュー#595: 戻る操作など await できない経路でも、保留中の保存を確定してから一覧を描き直す
        // (確定はawaitできないので、下の同期の描画のあとで、確定が済んだら一覧をもう一度描く)
        if (!skipSave && (this._artSaveTimer || this._artMode === 'edit' || this._artMode === 'form')) {
            this._artFlushSave().then(() => {
                const lv = document.getElementById('art-list-view');
                if (lv && !lv.hidden) this._artRenderList();
            }).catch(() => {});
        }
        // イシュー#513 S6: 記事のサブ状態(art-viewing/art-edit-mode/art-publish-modal、将来増える
        // ものも含む)は1回のunwind操作でまとめて畳む(「一覧を出す=これらの段は残さない」という
        // 1つの決まりをSurface/NavState側に置く)。全幅化でPCでもこれらの面が段を積むように
        // なった結果、個別にSurface.closeを並べて閉じ忘れが1つでもあると、go(-n)の段数が実際の
        // 段数より少なくなり、着地点がずれてpopstateのreopenで古い面(art-viewing)が開き直って
        // しまう競合があった(実測・#513 step4：公開パネル(art-publish-modal)を開いたまま一覧に
        // 戻る経路で発生)。個別closeの数え漏れという問題のクラス自体をここで無くす。
        const st = this._modalHistStack;
        const ART_SUB_FACE_IDS = ['art-publish-modal', 'art-edit-mode', 'art-viewing'];
        const openArtSubFaces = st ? ART_SUB_FACE_IDS.filter((id) => st.some((e) => e.id === id)) : [];
        for (const id of openArtSubFaces) this._overlays().close(id, { reason: 'program' }); // 重なり(見た目)を先に外す
        if (this.nav && openArtSubFaces.length) this.nav.closeArtSubStates();
        this._artMode = 'view'; // 次に記事を開いた時の _artSetMode 判定のため状態を正規化
        document.getElementById('art-list-view').hidden = false;
        document.getElementById('art-edit-view').hidden = true;
        const content = document.querySelector('.art-modal-content');
        if (content) content.classList.remove('art-editing');
        this._overlays().setSize('publish-pages-modal', 'lg'); // 一覧 = 大 (イシュー#367)
        // C2: ハブ公開かつ無料プランのときだけ、運営アフィリエイトタグが付く旨の注記を出す
        const notice = document.getElementById('art-free-notice');
        if (notice) {
            const cfg = SyncConfigManager.load();
            const target = (cfg.publish || {}).target === 'github' ? 'github' : 'hub';
            const plan = (cfg.hub || {}).plan || 'free';
            notice.hidden = !(target === 'hub' && plan !== 'plus');
        }
        this._artRenderList();
    }

    // イシュー#279 (②承認4段構造の3): 個別記事 (閲覧/編集) を履歴の1段にする。戻る=一覧に戻る
    // (_artShowList が保存・段の後始末まで一括で行う)。
    _artShowEditor() {
        document.getElementById('art-list-view').hidden = true;
        document.getElementById('art-edit-view').hidden = false;
        const content = document.querySelector('.art-modal-content');
        if (content) content.classList.add('art-editing');
        // 編集 = 全画面 (full・イシュー#367)。PC の幅は .art-modal-content.art-editing の専用ルール (min(1240px, 100vw-40px)) が優先、≤600px は元から全画面
        this._overlays().setSize('publish-pages-modal', 'full');
        // イシュー#468: 記事個別ページを開く操作そのものに #/publish/<id> への route 変化を1 applyで乗せる
        // (新規記事は _artOpenEditor が確定した仮id・既存記事は実id。編集/閲覧のサブ状態はURLで区別しない、ADR-147)
        this._surface().open('art-viewing', { close: (o) => this._artShowList(o), extra: { articleId: this._artEditingId }, route: { view: 'publish', id: this._artEditingId } });
    }

    _artCountBooks(blocks) {
        return (blocks || []).reduce((n, b) => {
            if (b.type === 'book') return n + (b.asin ? 1 : 0);
            if (b.type === 'shelf') return n + (b.items || []).length;
            return n;
        }, 0);
    }

    _artRenderList() {
        const ul = document.getElementById('art-list');
        if (!ul) return;
        const esc = BookshelfEscape.escapeHtml;

        this._artRenderStoreNotice();

        const notConnected = !this._isSyncReady();
        const newBtn = document.getElementById('art-new');
        if (newBtn) newBtn.disabled = notConnected;

        // 保存先には接続しているが articles.json の読込自体に失敗した (通信/認証/権限エラー)。
        // 「0件」と取り違えないよう、空一覧ではなくエラー行に差し替える。
        if (!notConnected && this._artLoadError) {
            const isAuthErr = this._artLoadError.name === 'HubAuthError';
            const msg = isAuthErr
                ? 'Asayake ハブの認証が切れました。設定から再ログインしてください。'
                : '保存先から記事を読み込めませんでした。接続を確認して開き直してください。';
            const actionBtn = isAuthErr
                ? `<button class="btn btn-secondary btn-small" data-act="open-settings" type="button">設定を開く</button>`
                : '';
            ul.innerHTML = `<li class="pp-empty pp-error"><span class="h-icon" data-icon="alert-triangle" data-icon-size="14"></span>${esc(msg)}${actionBtn}</li>`;
            const openBtn = ul.querySelector('[data-act="open-settings"]');
            if (openBtn) openBtn.addEventListener('click', () => this._openSettingsModal('sync-method-select'));
            const foot = document.getElementById('art-list-foot'); if (foot) foot.hidden = true;
            if (newBtn) newBtn.disabled = true;
            if (typeof window.applyIcons === 'function') window.applyIcons(ul);
            return;
        }

        const articles = this.publishArticleStore.articles();
        const foot = document.getElementById('art-list-foot');
        if (foot) foot.hidden = !articles.some(a => a.published);
        // 自分のハブ本棚トップ (イシュー#345 C案)。共有ハブ公開中のときだけ存在する＝記事ごとではなく
        // サイト単位で1つ (_artPublicBase() は target=hub なら publicId を含まないユーザートップ URL)。
        // 自前公開 (github) はハブに存在しないため出さない。ボタン列には入れず、URL表示の下に新しい行
        // として足す (差し戻し指摘7: ボタン列に入れると.pp-row-actions圧迫でタイトルが狭幅で潰れるため)。
        const isHubTarget = (SyncConfigManager.load().publish || {}).target === 'hub';
        const hubTopUrl = isHubTarget ? this._artPublicBase() : '';
        // 本棚トップの配色 (ADR-144・イシュー#408 案A)。共有ハブ公開時だけ (/top は無対象のためgithubでは出さない、
        // hubTopUrlと同じ条件)。読込は非同期なので描画自体は fire-and-forget で呼ぶ (一覧描画をブロックしない)。
        const siteThemeBlock = document.getElementById('art-site-theme');
        if (siteThemeBlock) {
            siteThemeBlock.hidden = !isHubTarget;
            if (isHubTarget) this._artRenderSiteThemeBlock();
        }
        if (!articles.length) {
            ul.innerHTML = '<li class="pp-empty">まだ公開記事がありません。「新規作成」から作ってください。</li>';
        } else {
            ul.innerHTML = articles.map(a => {
                const pub = !!a.published;
                // イシュー#430 (②承認): 状態を3つにする(公開済み／未公開の変更あり／未公開)。判定は
                // 既存の stale 判定(_artRefreshPublishBadge・エディタヘッダーで使用中)と同じ式
                // updatedAt > lastBuiltAt を一覧側にも適用する(新しい判定基準は作らない)。
                const stale = pub && (a.updatedAt || 0) > (a.lastBuiltAt || 0);
                const badge = pub
                    ? (stale
                        ? '<span class="pp-status pp-status-stale">● 未公開の変更あり</span>'
                        : '<span class="pp-status pp-status-on">● 公開済み</span>')
                    : '<span class="pp-status pp-status-off">○ 未公開</span>';
                const bookCount = this._artCountBooks(a.blocks);
                const tagsMeta = (a.tags || []).length ? ' ・ ' + a.tags.map(esc).join(', ') : '';
                // data-act="republish" のセレクタ・クリックハンドラは変更なし(既存E2E互換)。
                // stale の時だけ強調(btn-primary)+文言「変更を公開」にする(②指摘⑤「更新/完了が曖昧」への対応)。
                const publishActions = pub
                    ? (stale
                        ? `<button class="btn btn-primary btn-small" data-act="republish"><span class="h-icon" data-icon="upload-cloud" data-icon-size="13"></span>変更を公開</button>`
                        : `<button class="btn btn-secondary btn-small" data-act="republish"><span class="h-icon" data-icon="refresh-cw" data-icon-size="13"></span>再公開</button>`)
                    : `<button class="btn btn-primary btn-small" data-act="publish"><span class="h-icon" data-icon="upload-cloud" data-icon-size="13"></span>公開</button>`;
                const url = pub ? this._artPageUrl(a) : '';
                // 公開済みなのに publicId 未発番 (旧 pages.json からの移行データ等、イシュー#154) だと
                // url が空文字になり urlRow が消え「公開したはずなのにリンクが出ない」と映る。
                // 「更新」ボタン (republish→_artPublishArticle) を押せば自動発番されるため、その旨を出す。
                // イシュー#442・ハヘロ指摘②: リンクは記事URLの1本のみ(.pp-row-url)。サイトトップURL(旧.pp-row-hub)は
                // 撤去し、記事ページ(公開パネル)から辿る形に統合(_artRenderPublishPanel・07項目3)。
                const urlRow = url
                    ? `<span class="pp-row-url"><a href="${esc(url)}" target="_blank" rel="noopener"><span class="h-icon" data-icon="external-link" data-icon-size="12"></span>${esc(url)}</a></span>`
                    : (pub && !a.publicId ? '<span class="pp-row-url pp-row-url-pending">公開URLを準備中です。「更新」を押すと発行されます。</span>' : '');
                // ハヘロ指摘②: タイトルが長い時に状態表示と同居すると読めなくなるため、タイトル行と状態行を分離する。
                // タイトルは2行までの折返し(-webkit-line-clamp:2・css/bookshelf.cssの.pp-row-title)で、それを超えたら…。
                return `<li class="pp-row" data-id="${esc(a.id)}">
                  <div class="pp-row-main">
                    <span class="pp-row-title">${esc(a.title)}</span>
                    <div class="pp-row-status-line">
                      ${badge}
                      <span class="pp-row-meta">本 ${bookCount} 冊${tagsMeta}</span>
                    </div>
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
                // 連打で同じ記事の公開処理が多重に走らないよう実行中 disabled にする (一次防御・
                // ui-standards §2-6・イシュー#374案D)。_artRunExclusive (記事単位 in-flight ガード)
                // は連打以外の経路 (エディタ内の公開等) も含めた最後の防波堤。
                // 成功/失敗いずれでも _artPublishArticle が最後に _artRenderList() を呼び行ごと
                // DOM が再生成されるため、通常は disabled=false への戻しも不要 (新しい行は初期状態)。
                // _ensureFreeAffiliateConsent のキャンセル等、再描画なしで return する早期終了経路の
                // ためだけに finally で戻す (要素が再生成されていれば isConnected===false で no-op)。
                const publishBtn = row.querySelector('[data-act="publish"],[data-act="republish"]');
                const runPublishFromList = async () => {
                    if (publishBtn) publishBtn.disabled = true;
                    try {
                        await this._artPublishFromList(id);
                    } finally {
                        if (publishBtn && publishBtn.isConnected) publishBtn.disabled = false;
                    }
                };
                bind('publish', runPublishFromList);
                bind('republish', runPublishFromList);
                bind('edit', () => this._artOpenEditor(id));
                if (notConnected) row.querySelectorAll('button').forEach(b => { b.disabled = true; });
            });
            if (typeof window.applyIcons === 'function') window.applyIcons(ul);
        }
    }

    // 一覧上部の状態通知 (#art-store-notice)。未接続 (最優先・編集不可) ／ 保存できていない変更あり ／
    // 同期エラーの併記、の優先度で1つにまとめる。ui-standards §3 (です・ます、専門用語なし)。
    _artRenderStoreNotice() {
        const el = document.getElementById('art-store-notice');
        if (!el) return;
        const textEl = document.getElementById('art-store-notice-text');
        const btn = document.getElementById('art-store-notice-btn');
        const lines = [];
        let btnLabel = '';
        let onClick = null;

        if (!this._isSyncReady()) {
            lines.push(this._syncFallbackFrom === 'hub'
                ? 'Asayake ハブにログインしていません。設定からログインしてください。'
                : '保存先に接続していないため、記事を作成・編集できません。');
            btnLabel = '保存先を選ぶ';
            onClick = () => this._openSettingsModal('sync-method-select');
        } else if (this.publishArticleStore && this.publishArticleStore.hasUnsavedChanges()) {
            lines.push('保存できていない変更があります。');
            btnLabel = 'もう一度保存';
            onClick = () => this._artRetryStorePersist();
        }
        if (this._syncError && this._syncErrorMsg) lines.push(this._syncErrorMsg);

        if (!lines.length) { el.hidden = true; return; }
        el.hidden = false;
        if (textEl) textEl.textContent = lines.join(' ');
        if (btn) {
            btn.hidden = !btnLabel;
            btn.textContent = btnLabel;
            btn.onclick = onClick;
        }
    }

    // 一覧側の「もう一度保存」: どの記事の persist が失敗したか (編集中の記事とは限らない) を
    // 気にせず、ストアがメモリ上に保持している未反映の変更をそのまま書き直す。
    async _artRetryStorePersist() {
        try {
            await this.publishArticleStore.retryPersist();
            toast('保存しました。', { type: 'success' });
        } catch (e) {
            toast('保存できませんでした: ' + (e && e.message ? e.message : ''), { type: 'error' });
        }
        this._artRenderList();
    }

    // 公開先の公開ベース URL (target=hub なら bookshelfBase(新)優先/publicBase(旧)、github なら Pages URL)。
    // 未確定なら '' (S6・ADR-076: username 未設定ユーザは bookshelfBase が null のため publicBase へ落ちる)
    _artPublicBase() {
        const cfg = SyncConfigManager.load();
        const pub = cfg.publish || {};
        if (pub.target === 'hub') {
            const hub = cfg.hub || {};
            return hub.bookshelfBase || hub.publicBase || '';
        }
        const gh = cfg.github || {};
        const owner = pub.owner || gh.login || gh.owner || '';
        const repo = pub.repo || '';
        if (!owner || !repo) return '';
        const o = String(owner).toLowerCase();
        if (String(repo).toLowerCase() === `${o}.github.io`) return `https://${o}.github.io/`;
        return `https://${o}.github.io/${repo}/`;
    }

    // 記事 1 つの公開 URL (ベース + publicId/)。URL に slug (タイトル由来) を出さないのが S6・ADR-076
    // (イシュー#154: 旧実装は a.slug を使っており「.../無題の記事/」のような日本語 URL になっていた)。
    // ベース未確定、または publicId 未発番 (公開直後の安全網が未実行の旧データ等) なら ''
    _artPageUrl(a) {
        const base = this._artPublicBase();
        if (!base || !a || !a.publicId) return '';
        return `${base.replace(/\/?$/, '/')}${a.publicId}/`;
    }

    _artFindBlock(id) {
        return (this._artDraft.blocks || []).find(b => b.id === id) || null;
    }

    _artUsedAsins() {
        const set = new Set();
        for (const b of (this._artDraft.blocks || [])) {
            if (b.type === 'book' && b.asin) set.add(b.asin);
            if (b.type === 'shelf') for (const it of (b.items || [])) set.add(it.asin);
        }
        return set;
    }

    // K-B (イシュー#276): visualViewport (キーボード表示でビューポートが縮む) に合わせて、
    // フォーカス中の入力欄が隠れていれば隠れない位置までスクロールする。記事エディタ本体と
    // 公開パネル (タグ入力) のみが対象＝app全体の全inputへは広げない (影響範囲を絞る)。
    // visualViewport 非対応環境 (旧ブラウザ・PC) では何もしない no-op。
    _artBindViewportScroll() {
        if (this._artViewportBound) return;
        this._artViewportBound = true;
        const vv = window.visualViewport;
        if (!vv) return;
        const inScope = (el) => !!(el && el.matches && el.matches('input, textarea')
            && el.closest('#art-edit-view, #art-publish-modal'));
        const findScrollParent = (el) => {
            let node = el && el.parentElement;
            while (node && node !== document.body) {
                const cs = getComputedStyle(node);
                if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight) return node;
                node = node.parentElement;
            }
            return document.scrollingElement || document.documentElement;
        };
        // 構成A (イシュー#276 step3): キーボード表示中はキーボード直上に補助バーを出し、下部アクションバーを隠す。
        // visualViewport がこれだけ縮んだらキーボード表示とみなす (モックのキーボード近似336pxより十分小さい値)。
        const KB_SHRINK_PX = 150;
        const updateKbBar = () => {
            const view = document.getElementById('art-edit-view');
            if (!view) return;
            const shrink = window.innerHeight - vv.height;
            const open = shrink > KB_SHRINK_PX && inScope(document.activeElement);
            view.classList.toggle('is-kb-open', open);
            if (open) {
                const bar = document.getElementById('art-kb-bar');
                // ②差し戻し2回目 (2026-10-12・実測): top を可視域の下端にすると、バー自身の高さの分だけ
                // 可視域からはみ出し (=キーボードに隠れた位置に描かれ)、赤枠が空白を囲む見た目になっていた。
                // バーの「下端」を可視域の下端に合わせる (= top は可視域下端 - バー自身の高さ)。
                if (bar) {
                    const barHeight = bar.offsetHeight || 56;
                    bar.style.top = `${Math.round(vv.height + vv.offsetTop - barHeight)}px`;
                }
            }
        };
        // ②差し戻し (2026-10-12・#277実測): 入力欄の下端を可視域 (visualViewport.height) より
        // 8px以上内側に入れる。MARGINは要求の8pxに安全margin分を足した値。
        // 実測した根本原因 (#277): スクロールコンテナ (.art-col 等) はウィンドウ全体の高さを基準に
        // レイアウトされており、visualViewport が縮んでもそれ自体の clientHeight は変わらない。
        // そのため scrollHeight-clientHeight (可動域) がもともと小さい場合、scrollTop をいくら
        // 増やしても可動域の上限 (実測63px) で頭打ちになり、キーボードの下に隠れたままになっていた。
        // 対策: キーボード表示中はスクロールコンテナの max-height を可視域の下端に合わせて縮め、
        // 可動域そのものを広げてからスクロールする (キーボードが閉じたら元に戻す)。
        const KB_REVEAL_MARGIN = 16;
        let kbShrunkScroller = null;
        const reveal = () => {
            updateKbBar();
            const el = document.activeElement;
            if (!inScope(el)) return;
            const visibleBottom = vv.height + vv.offsetTop;
            const scroller = findScrollParent(el);
            if (scroller && scroller !== document.scrollingElement && scroller !== document.documentElement) {
                const top = scroller.getBoundingClientRect().top;
                const maxH = Math.max(80, Math.round(visibleBottom - top));
                scroller.style.maxHeight = `${maxH}px`;
                kbShrunkScroller = scroller;
            }
            const rect = el.getBoundingClientRect();
            const overlap = rect.bottom - visibleBottom + KB_REVEAL_MARGIN;
            if (overlap > 0) {
                const current = scroller.scrollTop || 0;
                const target = Math.round(current + overlap);
                if (scroller.scrollTo) scroller.scrollTo({ top: target });
                else scroller.scrollTop = target;
            }
        };
        const restoreScrollerHeight = () => {
            if (kbShrunkScroller) { kbShrunkScroller.style.maxHeight = ''; kbShrunkScroller = null; }
        };
        vv.addEventListener('resize', reveal);
        document.addEventListener('focusin', (e) => {
            if (!inScope(e.target)) return;
            // キーボードのアニメーション/visualViewport のリサイズ確定を待つ (環境差があるため複数回試行)
            setTimeout(reveal, 50);
            setTimeout(reveal, 250);
            setTimeout(reveal, 450);
        });
        document.addEventListener('focusout', (e) => {
            if (!inScope(e.target)) return;
            // フォーカスが外れてキーボードが閉じるのを少し待ってから判定し直す。
            // スクロールコンテナの高さ縮小 (上記) も元に戻す (閉じたままだと通常時にコンテンツが切れる)
            setTimeout(() => { updateKbBar(); restoreScrollerHeight(); }, 250);
        });
        const kbDone = document.getElementById('art-kb-bar-done');
        if (kbDone) kbDone.addEventListener('click', () => { if (document.activeElement) document.activeElement.blur(); });
    }

    // ===== イシュー#268: 見たまま編集 (案1・閲覧⇄編集トグル) =====
    // 記事は公開生成器の出力を iframe srcdoc でそのまま描く (閲覧=公開ページと1px一致)。
    // 編集状態では iframe 内へ枠・⋯・＋ (.art-cv-ui) を注入する。注入物は閲覧状態では全部取り除く。
    // mode: 'view' | 'edit' | 'form' ('form' は step3 でブロック別編集に置き換えるまでの旧フォーム表示)
    // イシュー#279 (②承認4段構造の2): view→edit の遷移だけを履歴の1段にする (form は art-fs 側 (_artEditBlock/
    // _artHistHandOver) が別途管理するので対象外・prevMode==='form' の時は push/pop どちらの条件にも
    // 合致しない)。edit→view の能動遷移 (#art-mode-done/#art-bar-done) は積んだ段を history.back 相当で畳む。
    _artSetMode(mode) {
        const newMode = (mode === 'edit' || mode === 'form') ? mode : 'view';
        const prevMode = this._artMode;
        if (prevMode === 'view' && newMode === 'edit') {
            this._surface().open('art-edit-mode', { close: (o) => this._artCompleteEdit(o), extra: { articleId: this._artEditingId } });
        } else if (prevMode === 'edit' && newMode === 'view') {
            this._surface().close('art-edit-mode', {});
        }
        this._artMode = newMode;
        const view = document.getElementById('art-edit-view');
        if (view) view.dataset.artMode = this._artMode;
        this._artCloseBlkMenu();
        this._artCloseAddSheet();
        this._artCloseLookSheet();
        if (this._artMode !== 'form') this._artQueueCanvas();
    }

    // イシュー#279: 戻る操作 (popstate 経由) で「編集状態」の段が閉じられた時の後始末。
    // ②指示どおり「完了扱いで保存し、閲覧状態に戻る」。_artSetMode('view') を能動的に呼ぶ経路とは
    // 別口 (popstate ハンドラは _modalHistStack から既に pop 済みのエントリの close を呼ぶだけなので、
    // ここで再度 _modalHistPop は呼ばない・呼ぶと二重popになる)。
    async _artCompleteEdit({ fromHistory = false } = {}) {
        if (this._artMode !== 'edit') return; // 既に別モードへ遷移済みなら何もしない (二重発火ガード)
        await this._artFlushSave().catch(() => {});
        this._artMode = 'view';
        const view = document.getElementById('art-edit-view');
        if (view) view.dataset.artMode = 'view';
        this._artCloseBlkMenu();
        this._artCloseAddSheet();
        this._artCloseLookSheet();
        this._artQueueCanvas();
    }

    _artQueueCanvas() {
        if (this._artCanvasTimer) clearTimeout(this._artCanvasTimer);
        this._artCanvasTimer = setTimeout(() => { this._artCanvasTimer = null; this._artRenderCanvas(); }, 80);
    }

    async _artRenderCanvas() {
        const frame = document.getElementById('art-canvas-frame');
        if (!frame || !this._artDraft || !this.publishArticleGenerator) return;
        if (this._artInlineBlockId) return; // 文章をその場で入力中 (blur で描き直す)
        const gen = (this._artCanvasGen || 0) + 1;
        this._artCanvasGen = gen;
        const tempArticle = { ...this._artDraft, id: this._artDraft.id || '_preview', slug: 'preview', publicId: 'preview' };
        let html = '';
        try {
            const result = await this.publishArticleGenerator.build([tempArticle], { state: this._artBuildPreviewState(), markBlocks: true });
            const file = result.files.find(f => f.path === 'preview/index.html');
            // 生成できなかった時は白紙にせず理由を出す (プレビューの失敗表示と同じ文言の型)
            html = file ? file.content : `<p style="padding:1rem;font-family:sans-serif;color:#a33">記事を表示できませんでした。<br>${BookshelfEscape.escapeHtml((result.errors || []).join(' / '))}</p>`;
        } catch (e) {
            console.warn('[art-canvas] build failed:', e);
            return;
        }
        if (gen !== this._artCanvasGen) return; // 後から始まった描画がある＝この結果は古い
        // イシュー#284/#279: WebKit は同じ iframe への srcdoc 再代入をセッション履歴に積むため、スマホの
        // 「戻る」が iframe 側の履歴で消費され、アプリの段が1回おきに空振りする問題があった。
        // イシュー#377: その対策として「iframe要素ごと新しいものに差し替える」実装にしていたが、要素を
        // DOM から外す瞬間に外側 document の activeElement が <body> へ戻り、その「無フォーカスの窓」
        // (計測で60〜90ms、負荷下はさらに伸びる) に届いたキー入力がどこにも処理されず消える不具合と、
        // 同じ差し替えの非同期往復(onload待ち)が負荷下で積み重なり.article要素の取得が収束しない不具合の
        // 両方の根になっていた。document.open/write/close は同じ iframe 要素・同じ Document オブジェクトの
        // ままで中身だけを置き換えられる(=WebKitでもnavigation履歴を積まない・back-nav-matrix.spec.js
        // A17-A22で確認済み)うえに同期的に完了する(onload待ちが無くなる)ため、要素差し替えをやめてこちらに
        // 統一する。
        const doc = frame.contentDocument;
        doc.open();
        doc.write(html);
        doc.close();
        if (doc.body && window.ResizeObserver) {
            if (this._artCanvasRO) this._artCanvasRO.disconnect();
            this._artCanvasRO = new ResizeObserver(() => this._artFitCanvas());
            this._artCanvasRO.observe(doc.body);
        }
        this._artApplyCanvasChrome();
    }

    // iframe を中身の高さまで伸ばす＝スクロールは外側1本 (二重スクロールにしない)
    _artFitCanvas() {
        const frame = document.getElementById('art-canvas-frame');
        const doc = frame && frame.contentDocument;
        if (!doc || !doc.documentElement) return;
        frame.style.height = `${doc.documentElement.scrollHeight}px`;
    }

    _artApplyCanvasChrome() {
        const frame = document.getElementById('art-canvas-frame');
        const doc = frame && frame.contentDocument;
        if (!doc || !doc.body) return;
        doc.querySelectorAll('.art-cv-ui').forEach(el => el.remove());
        doc.querySelectorAll('.art-cv-blk').forEach(el => el.classList.remove('art-cv-blk'));
        // イシュー#278: PCの文章ブロック右ペイン編集中は、左の記事で対象ブロックを枠で示し、開いた直後だけその位置へ送る
        // (入力のたびには送らない=読んでいる位置が飛ばない)。枠は .art-cv-ui で次の描画時に外れる。
        if (this._artMode === 'form' && this._artFsBlockId) {
            const i = (this._artDraft.blocks || []).findIndex(x => x.id === this._artFsBlockId);
            const sec = i >= 0 ? doc.querySelector(`section[data-art-idx="${i}"]`) : null;
            if (sec) {
                const style = doc.createElement('style');
                style.className = 'art-cv-ui';
                style.textContent = '.art-cv-fs-target{outline:2px solid #3d52ff;outline-offset:6px;border-radius:4px}';
                doc.head.appendChild(style);
                sec.classList.add('art-cv-blk', 'art-cv-fs-target');
                // 左の記事をクリックした後 (フォーカスが iframe 内) でも Esc=完了 が効くよう親へ中継する (スマホ全画面と同じ規則)
                if (!doc.body.dataset.artFsEscBound) {
                    doc.body.dataset.artFsEscBound = '1';
                    doc.addEventListener('keydown', (e) => {
                        if (window.Surface.isEsc(e) && this._artMode === 'form') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                    });
                }
                if (this._artFsScrollPending) {
                    this._artFsScrollPending = false;
                    const col = document.querySelector('#art-edit-view .art-col');
                    if (col) col.scrollTop = Math.max(0, frame.offsetTop - col.offsetTop + sec.offsetTop - 16);
                }
            }
        }
        if (this._artMode === 'edit') {
            const style = doc.createElement('style');
            style.className = 'art-cv-ui';
            style.textContent = ART_CANVAS_CHROME_CSS;
            doc.head.appendChild(style);
            const article = doc.querySelector('.article');
            const blocks = this._artDraft.blocks || [];
            // タイトル空の記事は生成器が空の<h1>を出す (高さ0pxでタップ不可、イシュー#275)。
            // 編集状態でだけ ::before でプレースホルダを足して、その場入力 (_artEditTitleInline) への入口を作る。
            // 閲覧状態 (このブロックの外) はこの処理を通らないため、公開ページとの1px一致は崩れない。
            const h1 = article && article.querySelector(':scope > h1');
            if (h1) {
                if (!String(this._artDraft.title || '').trim()) { h1.classList.add('art-cv-h1-ph'); h1.setAttribute('data-ph', 'タイトルを入力'); }
                else { h1.classList.remove('art-cv-h1-ph'); h1.removeAttribute('data-ph'); }
            }
            const sections = new Map([...doc.querySelectorAll('section[data-art-idx]')].map(el => [Number(el.dataset.artIdx), el]));
            const pcReorder = window.viewport.isWide(); // 境目はjs/ui/viewport.js(900px)に一本化(イシュー#505)
            // PC はつまみと⋯をブロック枠の上辺の線の上に乗せる (下端=枠線・左右対称)。先頭の見出しの文字と重ならない (イシュー#278 ②指摘)
            doc.body.classList.toggle('art-cv-pc', pcReorder);
            const svg = (name) => (typeof icon === 'function' ? icon(name, { size: 16 }) : '');
            const mkInserter = (index) => {
                const row = doc.createElement('div');
                row.className = 'art-cv-ui art-cv-ins';
                row.innerHTML = `<button type="button" class="art-cv-ins-btn" data-ins-index="${index}" aria-label="ここに追加">${svg('plus')}<span>ここに追加</span></button>`;
                return row;
            };
            // イシュー#288(ハヘロ2026-10-19 03:51決裁で作り直し): ブロック種別は種類名だけ(空/未選択の接尾辞は出さない。
            // 空であることは案内文言 EMPTY_GUIDE 側で伝える)。アイコンはLucide(#262で使用のfile-text/book/library)。
            // 左上の独立チップはやめ、右上の⋯ボタンと1つのピルに統合する(mkOps 参照)。
            const CHIP_ICON = { text: 'file-text', book: 'book', shelf: 'library' };
            const chipLabel = (b) => {
                if (b.type === 'text') return '文章';
                if (b.type === 'book') return '本';
                const n = (b.items || []).length;
                return n ? `本棚・${n}冊` : '本棚';
            };
            const EMPTY_GUIDE = { text: 'タップして文章を書く', book: 'タップして本を選ぶ', shelf: 'タップして本を追加' };
            // 挿入の基準点: ブロックが1つも描かれていない時はタイトル (とタグ) の直後
            let last = null;
            if (article) last = article.querySelector(':scope > .tags') || article.querySelector(':scope > h1');
            // イシュー#288 ②指摘: 本棚ブロックは0冊でも生成器が(ほぼ高さ0の)sectionを出すため、
            // 「sectionが無い」だけでなく「ブロックが論理的に空」かどうかで判定する(3種とも同じ扱いに揃える)。
            const isEmptyBlock = (b) => (b.type === 'text' && !(b.markdown || '').trim())
                || (b.type === 'book' && !b.asin)
                || (b.type === 'shelf' && !(b.items || []).length);
            blocks.forEach((b, i) => {
                let sec = sections.get(i);
                if (!sec) {
                    // 生成器が何も出さないブロック (空の文章・本未選択) は公開ページには出ない。編集状態でだけ仮の枠を出す
                    sec = doc.createElement('section');
                    sec.className = 'blk art-cv-ui';
                    sec.dataset.artIdx = String(i);
                    if (last && last.parentNode) last.after(sec); else if (article) article.appendChild(sec);
                }
                if (isEmptyBlock(b)) {
                    // 生成器が仮に何か出していても(例: 0冊の本棚)、編集状態では案内1つに統一して上書きする
                    sec.classList.add('art-cv-empty');
                    sec.innerHTML = `<button type="button" class="art-cv-empty-guide" data-blk-idx="${i}">${BookshelfEscape.escapeHtml(EMPTY_GUIDE[b.type] || 'タップして編集')}</button>`;
                } else {
                    sec.classList.remove('art-cv-empty');
                }
                sec.classList.add('art-cv-blk');
                // イシュー#580: iOS WebKit は要素自身か祖先に click リスナーが無いとタップから click を合成しない
                // (document の委譲だけでは数えられず、ブロックの余白タップが無反応になる)。空の受け口を付けて
                // 「クリックできる要素」にする。処理の本体は下の doc の click 委譲のまま (ここでは何もしない)
                if (!sec._artTapBound) { sec.addEventListener('click', () => {}); sec._artTapBound = true; }
                sec.before(mkInserter(i));
                // イシュー#288: 種別アイコン+文言+⋯を1つのピルボタンに統合(ハヘロ2026-10-19決裁「右で3点メニューと統合」)。
                // 押すと従来どおりブロック操作メニュー(編集/上へ/下へ/削除)を開く(.art-cv-more のクリック委譲をそのまま使う)。
                const ops = doc.createElement('div');
                ops.className = 'art-cv-ui art-cv-ops';
                const label = chipLabel(b);
                ops.innerHTML = `<button type="button" class="art-cv-more" data-blk-idx="${i}" aria-label="${BookshelfEscape.escapeHtml(label)}ブロックの操作" aria-haspopup="menu">${svg(CHIP_ICON[b.type] || 'file-text')}<span>${BookshelfEscape.escapeHtml(label)}</span>${svg('more-horizontal')}</button>`;
                sec.appendChild(ops);
                // イシュー#278: PC (900px超) だけブロック左につまみ。マウスでドラッグ・Alt+↑↓で並べ替え (スマホは⋯→上へ/下へのまま)
                if (pcReorder) {
                    const grip = doc.createElement('button');
                    grip.type = 'button';
                    grip.className = 'art-cv-ui art-cv-grip';
                    grip.dataset.blkIdx = String(i);
                    grip.dataset.blkId = b.id; // 描き直し前の古いキャンバスで続けて押されても、同じブロックを動かす
                    grip.title = 'ドラッグで並べ替え（Alt+↑↓でも移動）';
                    grip.setAttribute('aria-label', `${i + 1}番目のブロックを並べ替え（Alt+上下矢印で移動）`);
                    grip.innerHTML = svg('grip-vertical');
                    sec.appendChild(grip);
                }
                last = sec;
            });
            const endIns = mkInserter(blocks.length);
            if (last && last.parentNode) last.after(endIns); else if (article) article.appendChild(endIns);
            // キーボードで動かした直後は、移動先ブロックのつまみへフォーカスを追従させる
            if (this._artGripFocusIdx != null) {
                const idx = this._artGripFocusIdx;
                const g = doc.querySelector(`.art-cv-grip[data-blk-idx="${idx}"]`);
                this._artGripFocusIdx = null;
                if (g) g.focus();
            }
            if (!doc.body.dataset.artCvBound) {
                doc.body.dataset.artCvBound = '1';
                // iframe 内にフォーカスがある時の Esc は親文書へ届かない。シート/メニューを閉じる処理へ中継する
                window.Surface.onEsc(doc, (e) => {
                    // 開いている面がある時だけ中継する (何も開いていない時に中継すると記事エディタごと閉じてしまう)
                    const open = ['art-add-sheet', 'art-look-sheet', 'art-blk-menu'].some(id => { const el = document.getElementById(id); return el && !el.hidden; });
                    if (open) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                });
                // イシュー#278: つまみの Alt+↑↓ (1つ移動)
                doc.addEventListener('keydown', (e) => {
                    const g = e.target.closest && e.target.closest('.art-cv-grip');
                    if (!g || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    const from = (this._artDraft.blocks || []).findIndex(x => x.id === g.dataset.blkId);
                    if (from < 0) return;
                    this._artMoveBlock(from, e.key === 'ArrowUp' ? from - 1 : from + 1, { undo: true, announce: true, focusGrip: true });
                });
                // イシュー#278: つまみのドラッグ。挿入位置＝ブロック間の「ここに追加」行の縦中央 (ブロック間の中央) に線を出す
                // イシュー#580: ドラッグ終わりの pointerup に続く click (共通祖先= section 等に届く) でブロック編集が開かないよう、終わった時刻を控える
                let dragEndAt = 0;
                doc.addEventListener('pointerdown', (e) => {
                    const g = e.target.closest && e.target.closest('.art-cv-grip');
                    if (!g || e.button !== 0) return;
                    e.preventDefault();
                    const from = Number(g.dataset.blkIdx);
                    const sec = g.closest('section');
                    const art = doc.querySelector('.article');
                    const gaps = [...doc.querySelectorAll('.art-cv-ins')].map(row => { const r = row.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
                    if (!sec || !art || !gaps.length) return;
                    const sr = sec.getBoundingClientRect();
                    const line = doc.createElement('div');
                    line.className = 'art-cv-ui art-cv-dropline';
                    line.style.left = `${sr.left + doc.defaultView.scrollX}px`;
                    line.style.width = `${sr.width}px`;
                    line.hidden = true;
                    doc.body.appendChild(line);
                    sec.classList.add('art-cv-dragging');
                    let target = null;
                    const onMove = (ev) => {
                        let best = 0;
                        gaps.forEach((y, k) => { if (Math.abs(y - ev.clientY) < Math.abs(gaps[best] - ev.clientY)) best = k; });
                        target = best;
                        line.hidden = best === from || best === from + 1; // 元の位置と同じ所には線を出さない
                        line.style.top = `${gaps[best] - 1 + doc.defaultView.scrollY}px`;
                        line.dataset.gap = String(best);
                        // 記事の外側 (.art-col) が縦スクロールの本体。上下端40px以内に来たら少しずつ送る (長い記事で画面外へ運べるように)
                        const col = document.querySelector('#art-edit-view .art-col');
                        const fr = document.getElementById('art-canvas-frame').getBoundingClientRect();
                        if (col) {
                            const y = fr.top + ev.clientY, cr = col.getBoundingClientRect();
                            if (y > cr.bottom - 40) col.scrollTop += 16;
                            else if (y < cr.top + 40) col.scrollTop -= 16;
                        }
                    };
                    const onUp = () => {
                        dragEndAt = Date.now();
                        doc.removeEventListener('pointermove', onMove);
                        doc.removeEventListener('pointerup', onUp);
                        line.remove();
                        sec.classList.remove('art-cv-dragging');
                        if (target == null || target === from || target === from + 1) return;
                        this._artMoveBlock(from, target > from ? target - 1 : target, { undo: true, announce: true });
                    };
                    doc.addEventListener('pointermove', onMove);
                    doc.addEventListener('pointerup', onUp);
                });
                doc.addEventListener('click', (e) => {
                    const ins = e.target.closest('.art-cv-ins-btn');
                    if (ins) { e.preventDefault(); this._artOpenAddSheet(Number(ins.dataset.insIndex)); return; }
                    const more = e.target.closest('.art-cv-more');
                    if (more) { e.preventDefault(); this._artOpenBlkMenu(Number(more.dataset.blkIdx), more); return; }
                    const h1 = this._artMode === 'edit' && !e.target.closest('.art-cv-title') ? e.target.closest('.article > h1') : null;
                    if (h1) { e.preventDefault(); this._artEditTitleInline(h1); return; }
                    // イシュー#288: 空ブロックの案内 (文章/本/本棚いずれも) をタップしたら、そのブロックの編集を開く
                    const guide = e.target.closest('.art-cv-empty-guide');
                    if (guide) { e.preventDefault(); this._artCloseBlkMenu(); const gb = (this._artDraft.blocks || [])[Number(guide.dataset.blkIdx)]; if (gb) this._artEditBlock(gb.id); return; }
                    // 編集状態でブロックの本文をタップしたら、そのブロックの編集 (文章=全画面EasyMDE・本棚/本=全画面フォーム) を開く。
                    // イシュー#580: 以前は文章だけだった (#276 step3) ため、本の入った本棚/本ブロックはタップしても何も起きず、
                    // 空の案内 (.art-cv-empty-guide) が消えた途端に本を足す入口が「⋯→編集」だけになっていた。種類に依らず同じ規則にする。
                    // ブロック内の操作部品 (つまみ・⋯ピル等の .art-cv-ui。仮枠の section 自身は除く) はそれぞれの操作を優先し、ドラッグ直後の click は捨てる。
                    // 書影・書名リンクは編集中は外へ出さない (下の preventDefault) だけで操作が無かったため、ブロックの編集を開く側に含める
                    const sec = this._artMode === 'edit' && !e.target.closest('.art-cv-ui:not(section)') && Date.now() - dragEndAt > 400 ? e.target.closest('section.art-cv-blk') : null;
                    const tb = sec ? (this._artDraft.blocks || [])[Number(sec.dataset.artIdx)] : null;
                    if (tb) { e.preventDefault(); this._artCloseBlkMenu(); this._artEditBlock(tb.id); return; }
                    if (this._artMode === 'edit' && e.target.closest('a')) e.preventDefault(); // 編集中は書影・書名のリンクで外へ出ない
                    this._artCloseBlkMenu();
                });
            }
        }
        this._artFitCanvas();
    }

    _artOpenAddSheet(index) {
        const sheet = document.getElementById('art-add-sheet');
        if (!sheet) return;
        this._artCloseBlkMenu();
        this._artAddIndex = index;
        const hasAnyShelf = this.bookshelfManager.getBookshelves().length > 0;
        const shelfItem = sheet.querySelector('[data-block-type="shelf"]');
        if (shelfItem) {
            shelfItem.disabled = !hasAnyShelf;
            shelfItem.title = hasAnyShelf ? '' : '本棚がまだ1つもありません。先に本棚を作成してから追加できます。';
        }
        sheet.hidden = false;
        const first = sheet.querySelector('.art-add-sheet-item:not([disabled])');
        if (first) first.focus();
        this._surface().open('art-add-sheet', { close: (o) => this._artCloseAddSheet(o), extra: { articleId: this._artEditingId, menuIndex: index } });
    }

    // keepHistory: 続けて全画面を開く時は、積んだ履歴1段をそのまま全画面へ引き継ぐ (_artHistHandOver)。
    // history.back() の直後に pushState すると、非同期の back が新しい段を消してしまう (イシュー#259 と同じ罠)
    _artCloseAddSheet({ fromHistory = false, keepHistory = false } = {}) {
        const sheet = document.getElementById('art-add-sheet');
        if (!sheet || sheet.hidden) return;
        sheet.hidden = true;
        this._surface().close('art-add-sheet', { fromHistory, hist: !keepHistory });
    }

    // スマホの「戻る」履歴: from の段を消さずに to の閉じ処理へ付け替える (積み直さない＝history を動かさない)
    _artHistHandOver(fromId, toId, close) {
        if (this.nav) { // 段階③: 段の付け替えは台帳 (rename → 写しを replace)
            if (!this.nav.hasFace(fromId)) return false;
            this.nav.rename(fromId, toId, close);
            return true;
        }
        const st = this._modalHistStack;
        const e = st && st.find((x) => x.id === fromId);
        if (!e) return false;
        e.id = toId;
        e.close = close;
        return true;
    }

    _artOpenBlkMenu(idx, btnInFrame) {
        const menu = document.getElementById('art-blk-menu');
        const anchor = document.getElementById('art-blk-menu-anchor');
        const frame = document.getElementById('art-canvas-frame');
        if (!menu || !anchor || !frame) return;
        const blocks = this._artDraft.blocks || [];
        this._artMenuBlkIdx = idx;
        // ⋯は iframe の中にある。親文書の座標へ写した透明なアンカーを置いて _placeAnchoredMenu に渡す
        const fr = frame.getBoundingClientRect();
        const br = btnInFrame.getBoundingClientRect();
        Object.assign(anchor.style, { top: `${fr.top + br.top}px`, left: `${fr.left + br.left}px`, width: `${br.width}px`, height: `${br.height}px` });
        menu.querySelector('[data-blk-act="up"]').disabled = idx <= 0;
        menu.querySelector('[data-blk-act="down"]').disabled = idx >= blocks.length - 1;
        menu.hidden = false;
        this._placeAnchoredMenu(anchor, menu);
        // ⋯は iframe 内のボタン＝押した直後のフォーカスは iframe の中。Esc/キーボード操作が親へ届くよう項目へ移す
        const first = menu.querySelector('.art-more-item:not([disabled])');
        if (first) first.focus();
        this._surface().open('art-blk-menu', { close: (o) => this._artCloseBlkMenu(o), extra: { articleId: this._artEditingId } });
    }

    _artCloseBlkMenu({ fromHistory = false, keepHistory = false } = {}) {
        const menu = document.getElementById('art-blk-menu');
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        this._surface().close('art-blk-menu', { fromHistory, hist: !keepHistory });
    }

    _artBlkMenuAction(act) {
        const idx = this._artMenuBlkIdx;
        const blocks = this._artDraft.blocks || [];
        const b = blocks[idx];
        // 本棚/本の「編集」は全画面へ移る＝⋯メニューの履歴1段をそのまま全画面へ引き継ぐ
        const toFs = act === 'edit' && b && b.type !== 'text';
        this._artCloseBlkMenu({ keepHistory: toFs });
        if (!b) return;
        if (act === 'up' || act === 'down') {
            this._artMoveBlock(idx, act === 'up' ? idx - 1 : idx + 1);
        } else if (act === 'delete') {
            this._artRemoveBlock(b.id);
        } else if (act === 'edit') {
            this._artEditBlock(b.id);
        }
    }

    // ブロックの編集: 文章・本棚・本のいずれも全画面で一括確定 (キャンセル/完了・イシュー#276 step3で統一)。
    // 全画面の中身は既存の部品 (本の行・短文メモ・チップ・本の引き出し/リストピッカー・文章はEasyMDE) をそのまま使う＝
    // 旧フォーム (#art-blocks) を対象ブロック1つだけに絞って出す ('form' モード)。
    _artEditBlock(blockId) {
        const blocks = this._artDraft.blocks || [];
        const b = blocks.find(x => x.id === blockId);
        if (!b) return;
        this._artFsBlockId = blockId;
        this._artFsSnapshot = JSON.stringify(b);
        if (b.type === 'shelf') this._artActiveShelfBlockId = blockId;
        if (b.type === 'book' && !b.asin) this._artPendingBookBlockId = blockId;
        const t = document.getElementById('art-fs-title');
        if (t) t.textContent = b.type === 'shelf' ? '本棚を編集' : b.type === 'book' ? '本を編集' : '文章を編集';
        // イシュー#278: ブロック種別を data-art-fs-type に出す (900px超の文章は CSS で右ペイン表示＋左に記事)
        const ev = document.getElementById('art-edit-view');
        if (ev) ev.dataset.artFsType = b.type;
        this._artFsScrollPending = b.type === 'text';
        this._artSetMode('form');
        if (b.type === 'text') this._artQueueCanvas();
        this._artRenderBlocks();
        this._artRenderDrawer();
        // スマホの「戻る」= 完了 (Esc と同じ・②決裁)。直前のシート/⋯メニューの段があれば引き継ぐ
        const closeFs = (o) => this._artCloseBlockFs(true, o);
        if (!this._artHistHandOver('art-add-sheet', 'art-fs', closeFs) && !this._artHistHandOver('art-blk-menu', 'art-fs', closeFs)) {
            this._surface().open('art-fs', { close: closeFs, extra: { articleId: this._artEditingId, blockId } });
        } else if (this._navMobile()) { // イシュー#513 S6: 段を積む判定(_isHistMobile()の全幅化版)に揃える
            // イシュー#291: handover(段を引き継ぐ)経路は _modalHistPush を通らず history も触らない
            // ため、state に blockId が入らない。進むで開き直せるよう、現在の段を blockId 付きで
            // replaceState しておく(段数・位置は変えない)。
            if (this.nav) this.nav.setExtra('art-fs', { blockId });
            else history.replaceState(Object.assign({}, history.state, { blockId }), '', location.href);
        }
        const col = document.querySelector('#art-edit-view .art-col');
        if (col) col.scrollTop = 0;
        // イシュー#276 step3: 文章ブロックは長文メモと同じ EasyMDE を全画面で開く (#247の遅延読込を流用)
        if (b.type === 'text') this._artOpenTextFsEditor(b);
    }

    // 文章ブロックの全画面編集 (EasyMDE)。長文メモの _openBookMemoInAppEditor と同型。
    // 変更は codemirror の change イベントで都度 b.markdown へ反映 (_artScheduleSave のみ・
    // _artRenderBlocks は呼ばない=呼ぶとエディタが作り直されてカーソル位置が飛ぶため、
    // shelfの短文メモ入力と同じ方針)。
    async _artOpenTextFsEditor(b) {
        try {
            await this._ensureEasyMDELoaded();
        } catch (e) {
            console.error('EasyMDE読み込みに失敗:', e);
            const host = document.querySelector('.art-fs-text-editor');
            if (host) host.insertAdjacentHTML('afterbegin', '<p class="art-fs-note">エディタの読み込みに失敗しました。接続を確認してもう一度開いてください。</p>');
            return;
        }
        // 読込中に閉じられた/別ブロックへ切り替わっていたら何もしない
        if (this._artFsBlockId !== b.id || this._artMode !== 'form') return;
        const ta = document.getElementById('art-text-fs-textarea');
        if (!ta) return;
        if (this._artTextFsEditor) { this._mdeDestroyEditor(this._artTextFsEditor); this._artTextFsEditor = null; }
        ta.value = b.markdown || '';
        // 右ペインで開いているか = 文章ブロックの form で #art-blocks がペイン配置 (position:absolute) になっているか
        const blocksHost = document.getElementById('art-blocks');
        const inPane = !!blocksHost && getComputedStyle(blocksHost).position === 'absolute';
        // イシュー#279: EasyMDE生成は _openMdEditor (長文メモと共通)。保存方式は自動保存のまま
        // (onChange で都度 markdown へ反映)・フォーカスは PC (900px超・右ペイン) のみ (イシュー#278踏襲)。
        this._artTextFsEditor = this._openMdEditor({
            textareaEl: ta, compact: inPane, showStatus: false, autoFocusIfWide: true,
            onChange: (md) => {
                const blocks = this._artDraft.blocks || [];
                const idx = blocks.findIndex(x => x.id === b.id);
                if (idx < 0) return;
                blocks[idx].markdown = md;
                this._artScheduleSave();
                this._artQueueCanvas();
            },
        });
    }

    // commit=false (キャンセル) は全画面を開いた時点のブロックへ戻す。変更があれば確認を出す
    // (C・イシュー#276: P21 対応)。「編集に戻る」を選んだら閉じず false を返す (popstate 経由の
    // 呼び出しなら汎用モーダル履歴ハンドラ (6210行台) が history を積み直す)。短文メモ (.art-fs-memo)
    // はこのスナップショットに含まれず、300ms の予約で saveNote() する別経路 (画面を離れる時は
    // _artSettlePendingSave が確定する・イシュー#609) のため、確認の対象外
    // (ここで戻すのはブロック自体の並び・追加・削除・表示トグルのみ・決めたルールは04へ記載)。
    async _artCloseBlockFs(commit, { fromHistory = false } = {}) {
        if (this._artMode !== 'form') return;
        const id = this._artFsBlockId;
        const blocks = this._artDraft.blocks || [];
        const i = id ? blocks.findIndex(x => x.id === id) : -1;
        if (!commit && i >= 0 && this._artFsSnapshot) {
            const changed = JSON.stringify(blocks[i]) !== this._artFsSnapshot;
            if (changed) {
                const type = blocks[i].type;
                const message = type === 'shelf'
                    ? 'この本棚で行った変更（並び替え・追加・削除）を取り消します。\n短文メモは本ごとに保存済みのため残ります。'
                    : type === 'book'
                        ? 'この本で行った変更を取り消します。'
                        : 'この文章で行った変更を取り消します。'; // イシュー#276 step3: 文章ブロック (EasyMDE) も同じ確認に揃える
                const ok = await confirmDialog({
                    title: '変更を破棄しますか？',
                    message,
                    okLabel: '変更を破棄',
                    cancelLabel: '編集を続ける',
                    danger: true
                });
                if (!ok) return false; // 閉じなかった
            }
        }
        // X3(イシュー#529・A-c): art-sheet(本棚ブロックの引き出し)も一緒に積まれていれば、1回の
        // applyで両方を畳む(nav.closeArtFsSheet・unwind:true)。個別closeを2回呼ぶとgoが重ねがけに
        // なり画面が壊れる副作用があった(#528 step4で実測)ため避ける。戻る由来(fromHistory)は
        // 台帳が既に外しているのでhistory操作はしない(DOM/overlayの後始末だけ)
        const sheetAlsoOpen = this.nav && this.nav.hasFace('art-sheet');
        if (sheetAlsoOpen) {
            const ov = window.overlays;
            if (ov) { ov.close('art-fs', { reason: 'program' }); ov.close('art-sheet', { reason: 'program' }); }
            const side = document.getElementById('art-drawer');
            if (side) side.classList.remove('is-open');
            const scrim = document.getElementById('art-sheet-scrim');
            if (scrim) scrim.classList.remove('is-open');
            if (!fromHistory) this.nav.closeArtFsSheet();
        } else {
            this._surface().close('art-fs', { fromHistory });
        }
        if (!commit && i >= 0 && this._artFsSnapshot) {
            blocks[i] = JSON.parse(this._artFsSnapshot);
            this._artScheduleSave();
        }
        this._artFsBlockId = null;
        this._artFsSnapshot = null;
        this._artFsScrollPending = false;
        this._artPendingBookBlockId = null;
        const ev = document.getElementById('art-edit-view');
        if (ev) delete ev.dataset.artFsType;
        if (this._artTextFsEditor) { this._mdeDestroyEditor(this._artTextFsEditor); this._artTextFsEditor = null; }
        this._artSetMode('edit');
        this._artRenderBlocks();
    }

    // 記事タイトルのその場入力 (②決裁 step4: タイトルは記事の上で直接打つ)。値はヘッダーの #art-title に流し、
    // 既存の input ハンドラ (下書き反映・自動保存) をそのまま通す
    _artEditTitleInline(h1) {
        const doc = h1.ownerDocument;
        const src = document.getElementById('art-title');
        if (!src) return;
        const inp = doc.createElement('input');
        inp.type = 'text';
        inp.className = 'art-cv-ui art-cv-title';
        inp.value = src.value;
        inp.placeholder = 'タイトルを入力';
        inp.setAttribute('aria-label', '記事タイトル');
        h1.style.display = 'none';
        h1.after(inp);
        this._artInlineBlockId = '__title';
        inp.addEventListener('input', () => { src.value = inp.value; src.dispatchEvent(new Event('input', { bubbles: true })); });
        inp.addEventListener('blur', () => { this._artInlineBlockId = null; this._artQueueCanvas(); });
        inp.focus();
    }

    _artOpenEditor(id) {
        // イシュー#595: 前の記事の保存予約が残っていれば、下書きを差し替える前に確定する
        // (残したままだと、予約が次に開いた記事の下書きで発火し、前の記事の入力が消える)
        this._artSettlePendingSave().catch(() => {});
        this._artCloseSheet(); // 前回の編集セッションのシート開閉状態を持ち越さない (開いていなければ no-op)
        // 900px超の畳み状態だけは記憶を復元する (900px以下は上の _artCloseSheet() で毎回閉じた状態から
        // 始まる・イシュー#168)。_artRenderDrawer() が wrap へクラス適用する。
        try { this._artDrawerUserCollapsed = localStorage.getItem(ART_DRAWER_COLLAPSE_KEY) === '1'; } catch (_) { this._artDrawerUserCollapsed = false; }
        // イシュー#468: 新規記事は開いた直後に仮idを確定する(②承認・案2=クライアントでuuid採番、
        // ストアには登録しない)。これにより #/publish/<仮id> へ即座に遷移できる(brief「作成直後」の要求)。
        // 既存記事(id指定あり)は this._artPendingId=null のまま(ストアに実在するidを使う)。
        this._artPendingId = id ? null : PublishArticleStore._newId('art');
        const effectiveId = id || this._artPendingId;
        this._artEditingId = effectiveId;
        this._artPendingBookBlockId = null;
        this._artActiveShelfBlockId = null;
        this._artShelfSel = {};
        this._artBulkUndo = null;
        this._artBlockUndo = null; // D (イシュー#276): ブロック削除の Undo トースト。エディタを開き直したら破棄する
        this._artCollapsed = new Set(); // 畳み状態はエディタを開いている間だけのUI状態 (保存しない・イシュー#230)
        this._artLookQuery = '';
        this._artDrawerQuery = '';
        const drawerSearch = document.getElementById('art-drawer-search'); if (drawerSearch) drawerSearch.value = '';
        if (id) {
            const a = this.publishArticleStore.get(id);
            this._artDraft = JSON.parse(JSON.stringify(a));
        } else {
            const shelves = this.bookshelfManager.getBookshelves();
            const allShelf = shelves.find(s => s.isSpecial) || shelves[0] || null;
            this._artDraft = {
                id: effectiveId, // イシュー#468: 仮id (ストア未登録。_artFlushSave の最初の保存でこのidのまま create する)
                title: '', tags: [], blocks: [],
                theme: { layout: 'book-a-shelf-a', color: 'white' }, // イシュー#251: 3テンプレ既定は「書影を大きく」
                sourceShelfId: allShelf ? (allShelf.internalId || allShelf.id) : null,
                published: false
            };
        }
        const restoredFromDraft = this._artRestoreLocalDraftIfNewer(id);
        // 見た目は一度決めればあまり触らないため、既存記事 (ブロック2個以上) を開いた時は畳んで始める。
        // 新規記事 (ブロック0〜1個) は開いて始める。畳み状態は保存しない UI 状態 (イシュー#230・②差し戻し)
        if (id && (this._artDraft.blocks || []).length >= 2) this._artCollapsed.add('look');
        // X3(イシュー#528): ⋯は編集中も出す。旧仕様(id=既存記事のみ)は新規作成直後に隠れていた。
        const ops = document.getElementById('art-page-ops'); if (ops) ops.hidden = false;
        const unpub = document.getElementById('art-unpublish'); if (unpub) unpub.hidden = !this._artDraft.published;
        document.getElementById('art-title').value = this._artDraft.title || '';
        this._artRenderTags();
        this._artRenderBlocks();
        this._artRenderDrawerShelfSelect();
        this._artRenderDrawer();
        this._artSetSaveStatus('');
        this._artRefreshPublishBadge(); // U1 (イシュー#276): 公開中・未反映の変更ありなら開いた直後から出す
        this._artSetMode('view'); // イシュー#268: 開いた直後は閲覧状態 (公開ページと同じ見た目)
        this._artShowEditor();
        if (restoredFromDraft) {
            // 拾った下書きをリロードなしで確実に残す: メモリ反映→即リモートへフラッシュして
            // localStorage の下書きを消す (喪失窓を塞ぐ対策として必須、イシュー#142)
            this._artFlushSave().then(() => this._artFlushRemoteNow());
        }
    }

    // ===== 記事下書きの localStorage バックアップ (イシュー#142) =====
    //
    // リモートPUTを ART_REMOTE_FLUSH_DEBOUNCE_MS だけデバウンスする分、タブを閉じる等での
    // 喪失窓が広がる。その対策として、編集のたびデバウンス無しで localStorage に下書きを
    // 同期書き込みし、次回このエディタを開いた時にリモートより新しければ復元する。

    _artLocalDraftKey(id) {
        return `${ART_LOCAL_DRAFT_PREFIX}${id || 'new'}`;
    }

    _artSaveDraftToLocalStorage() {
        try {
            const payload = {
                id: this._artEditingId || null,
                updatedAt: Date.now(),
                draft: {
                    title: this._artDraft.title || '',
                    tags: this._artDraft.tags || [],
                    blocks: this._artDraft.blocks || [],
                    theme: this._artDraft.theme,
                    sourceShelfId: this._artDraft.sourceShelfId,
                    adTag: this._artDraft.adTag || null
                }
            };
            localStorage.setItem(this._artLocalDraftKey(this._artEditingId), JSON.stringify(payload));
        } catch (e) {
            console.error('記事下書きの localStorage 保存に失敗:', e);
        }
    }

    _artClearLocalDraft() {
        try { localStorage.removeItem(this._artLocalDraftKey(this._artEditingId)); } catch (_) { /* noop */ }
    }

    // localStorage の下書きがリモートより新しければ this._artDraft へ反映して true を返す。
    // 古い下書きは掃除する。新規記事 (id=null) は比較対象が無いため下書きがあれば無条件で拾う。
    _artRestoreLocalDraftIfNewer(id) {
        const key = this._artLocalDraftKey(id);
        let saved;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            saved = JSON.parse(raw);
        } catch (e) {
            console.error('記事下書きの復元チェックに失敗:', e);
            return false;
        }
        if (!saved || !saved.draft) { try { localStorage.removeItem(key); } catch (_) {} return false; }
        const remoteUpdatedAt = id ? (this.publishArticleStore.get(id) || {}).updatedAt || 0 : 0;
        if (!id || saved.updatedAt > remoteUpdatedAt) {
            this._artDraft = {
                ...this._artDraft,
                title: saved.draft.title,
                tags: saved.draft.tags,
                blocks: saved.draft.blocks,
                theme: saved.draft.theme,
                sourceShelfId: saved.draft.sourceShelfId
            };
            // 拾った下書きの所有権はメモリ(_artDraft)に移った。新規記事は create() 後に
            // 新しい id のキーで再保存されるため、古いキー ("new" 固定 or 旧 id) をここで消さないと
            // 永久にゴミとして残る (イシュー#142 実装中に E2E で実測)。
            try { localStorage.removeItem(key); } catch (_) { /* noop */ }
            return true;
        }
        try { localStorage.removeItem(key); } catch (_) { /* noop */ }
        return false;
    }

    // ===== 見た目 (レイアウト × 配色) = キャンバス先頭の固定ブロック・縦リスト (イシュー#230) =====
    // 標準項目＋プラグインが registerArticleLayout/Color で加算した項目 (加算スロット)。公開側の描画は
    // 標準項目のみ対応のため、プラグイン項目は一覧に出すが選べない (07 に積み残し)。
    _artThemeItems(kind) {
        // イシュー#251: 3テンプレ(本A×棚A・本C×棚C・本C×棚D)。表示名は平易な日本語(②承認2026-09-29)
        const LAYOUT_LABELS = { 'book-a-shelf-a': '書影を大きく', 'book-c-shelf-c': '文章に書影を添える', 'book-c-shelf-d': '番号つきで並べる' };
        const LAYOUT_ICONS = { 'book-a-shelf-a': 'layout-grid', 'book-c-shelf-c': 'layout-list', 'book-c-shelf-d': 'list-ordered' };
        // イシュー#260: 「系統・地」の短い名前に簡素化 (和名は廃止、②承認2026-09-29)。
        // *-dark→黒地・*-white→白地・*-comp→色地。キー名・値(色)は変えない。
        const COLOR_LABELS = {
            'gold-dark': '金・黒地', 'gold-white': '金・白地', 'gold-comp': '金・色地',
            'aqua-dark': '水色・黒地', 'aqua-white': '水色・白地', 'aqua-comp': '水色・色地',
            'lime-dark': 'ライム・黒地', 'lime-white': 'ライム・白地', 'lime-comp': 'ライム・色地',
            'rose-dark': 'ローズ・黒地', 'rose-white': 'ローズ・白地', 'rose-comp': 'ローズ・色地'
        };
        const std = kind === 'layout'
            ? ARTICLE_LAYOUTS.map(id => ({ id, label: LAYOUT_LABELS[id] || id, icon: LAYOUT_ICONS[id] || 'layout-template', provider: '標準', selectable: true }))
            : ARTICLE_COLORS.map(id => ({ id, label: COLOR_LABELS[id] || id, provider: '標準', selectable: true }));
        const api = window.bookshelfAPI;
        const plug = (api && typeof api.getArticleThemes === 'function') ? api.getArticleThemes(kind) : [];
        return std.concat(plug.map(e => ({ id: e.id, label: e.label, description: e.description, icon: e.icon || 'layout-template', swatch: e.swatch, provider: e.pluginId, selectable: false, plugin: true })));
    }

    _artThemeSummary() {
        const theme = PublishArticleStore.normalizeTheme(this._artDraft.theme);
        const l = this._artThemeItems('layout').find(x => x.id === theme.layout);
        const c = this._artThemeItems('color').find(x => x.id === theme.color);
        return `${l ? l.label : theme.layout}／${c ? c.label : theme.color}`;
    }

    // 本棚トップ(/<username>/)の配色 (ADR-144・イシュー#408 案A)。記事の「見た目」ブロック
    // (_artRenderLookBlock) と同じ部品(_artThemeItems('color')・.art-look-row)・同じ操作で選べるように
    // する(「同じ操作は同じ見た目」方針)。サイト単位で1つなので役割違いの別セクション・別保存先
    // (PublishArticleStore.saveSiteTheme→private/publish/site.json)。即時反映ではなく次の公開で反映。
    async _artRenderSiteThemeBlock() {
        const esc = BookshelfEscape.escapeHtml;
        const list = document.getElementById('art-site-theme-list');
        const cur = document.getElementById('art-site-theme-current');
        if (!list) return;
        let color;
        try { color = await this.publishArticleStore.loadSiteTheme(); }
        catch (e) { list.innerHTML = '<p class="muted-hint" style="padding:.6rem">配色の読み込みに失敗しました。</p>'; return; }
        const items = this._artThemeItems('color');
        const row = (it) => {
            const checked = color === it.id;
            const t = (typeof ARTICLE_COLOR_TOKENS !== 'undefined' && ARTICLE_COLOR_TOKENS[it.id]) || null;
            const bg = t ? t.bg : (it.swatch || 'transparent');
            const acc = t ? t.acc : (it.swatch || 'transparent');
            const txt = t ? t.txt : 'inherit';
            const th = `<span class="art-look-th is-color" style="background:${esc(bg)};color:${esc(txt)}"><i>Aa</i><span class="art-look-th-bar" style="background:${esc(acc)}"></span></span>`;
            return `<button type="button" class="art-look-row" role="radio" aria-checked="${checked}" data-site-theme-color="${esc(it.id)}"${it.selectable ? '' : ' disabled'}>
                ${th}
                <span class="art-look-nm"><b>${esc(it.label)}</b></span>
                <span class="art-look-pv${it.plugin ? ' is-plugin' : ''}">${esc(it.provider)}</span>
                <span class="art-look-mk" aria-hidden="true"></span>
            </button>`;
        };
        const label = (items.find(it => it.id === color) || {}).label || color;
        if (cur) cur.textContent = label;
        list.innerHTML = items.map(row).join('');
        if (typeof window.applyIcons === 'function') window.applyIcons(list);
        list.querySelectorAll('[data-site-theme-color]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const picked = btn.getAttribute('data-site-theme-color');
                if (picked === color) return;
                btn.disabled = true;
                try {
                    await this.publishArticleStore.saveSiteTheme(picked);
                    await this._artRenderSiteThemeBlock();
                    const hint = document.getElementById('art-site-theme-hint');
                    if (hint) { hint.hidden = false; }
                } catch (e) {
                    toast('配色の保存に失敗しました。もう一度お試しください。', { type: 'error' });
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }

    _artRenderLookBlock() {
        const esc = BookshelfEscape.escapeHtml;
        const theme = PublishArticleStore.normalizeTheme(this._artDraft.theme);
        const collapsed = this._artCollapsedSet().has('look');
        const row = (kind, it) => {
            const checked = (kind === 'layout' ? theme.layout : theme.color) === it.id;
            let th;
            if (kind === 'layout') th = `<span class="art-look-th"><span class="h-icon" data-icon="${esc(it.icon)}" data-icon-size="20"></span></span>`;
            else {
                const t = (typeof ARTICLE_COLOR_TOKENS !== 'undefined' && ARTICLE_COLOR_TOKENS[it.id]) || null;
                const bg = t ? t.bg : (it.swatch || 'transparent');
                const acc = t ? t.acc : (it.swatch || 'transparent');
                const txt = t ? t.txt : 'inherit';
                th = `<span class="art-look-th is-color" style="background:${esc(bg)};color:${esc(txt)}"><i>Aa</i><span class="art-look-th-bar" style="background:${esc(acc)}"></span></span>`;
            }
            return `<button type="button" class="art-look-row" role="radio" aria-checked="${checked}" data-look-kind="${kind}" data-look-id="${esc(it.id)}" data-look-name="${esc(it.label)}"${it.selectable ? '' : ' disabled'}>
                ${th}
                <span class="art-look-nm"><b>${esc(it.label)}</b>${it.description ? `<small>${esc(it.description)}</small>` : ''}</span>
                <span class="art-look-pv${it.plugin ? ' is-plugin' : ''}">${esc(it.provider)}</span>
                <span class="art-look-mk" aria-hidden="true"></span>
            </button>`;
        };
        const layouts = this._artThemeItems('layout');
        const colors = this._artThemeItems('color');
        const q = (this._artLookQuery || '').trim();
        const search = colors.length >= 7
            ? `<input type="search" class="art-look-search" placeholder="配色を検索" aria-label="配色を検索" value="${esc(q)}">`
            : '';
        const body = collapsed ? '' : `<div class="art-block-body art-look-body">
                <section class="art-look-sec">
                    <div class="art-look-hd"><h4>レイアウト</h4><span class="art-look-cnt">${layouts.length}件</span></div>
                    <div class="art-look-list" role="radiogroup" aria-label="レイアウト">${layouts.map(it => row('layout', it)).join('')}</div>
                </section>
                <section class="art-look-sec">
                    <div class="art-look-hd"><h4>配色</h4><span class="art-look-cnt">${colors.length}件</span>${search}</div>
                    <div class="art-look-list" role="radiogroup" aria-label="配色">${colors.map(it => row('color', it)).join('')}</div>
                </section>
            </div>`;
        return `<div class="art-look-block${collapsed ? ' is-collapsed' : ''}" data-look-block="1">
            ${this._artBlockBar({ id: 'look', kind: '見た目', icon: 'palette', summary: this._artThemeSummary(), fixed: true })}
            ${body}
        </div>`;
    }

    _artBindLookEvents(host) {
        const el = host.querySelector('.art-look-block');
        if (!el) return;
        el.querySelectorAll('.art-look-row').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                const theme = PublishArticleStore.normalizeTheme(this._artDraft.theme);
                theme[btn.dataset.lookKind] = btn.dataset.lookId;
                this._artDraft.theme = PublishArticleStore.normalizeTheme(theme);
                this._artRenderBlocks();
                this._artScheduleSave();
            });
        });
        const search = el.querySelector('.art-look-search');
        const applyFilter = () => {
            const q = (this._artLookQuery || '').trim().toLowerCase();
            el.querySelectorAll('.art-look-row[data-look-kind="color"]').forEach(r => {
                const hit = !q || r.dataset.lookName.toLowerCase().includes(q) || r.dataset.lookId.toLowerCase().includes(q);
                r.hidden = !hit;
            });
        };
        if (search) search.addEventListener('input', () => { this._artLookQuery = search.value; applyFilter(); });
        applyFilter();
    }

    _artOnTitleInput() {
        this._artDraft.title = document.getElementById('art-title').value;
        this._artScheduleSave();
    }

    // ===== タグ (入力サジェスト + 使用数表示・新規作成は候補の最下段, §11.6) =====

    _artRenderTags() {
        const ul = document.getElementById('art-tags');
        if (!ul) return;
        const esc = BookshelfEscape.escapeHtml;
        ul.innerHTML = (this._artDraft.tags || []).map((t, i) =>
            `<li class="art-tag" data-idx="${i}">${esc(t)}<button type="button" class="art-tag-x" title="削除">×</button></li>`
        ).join('');
        ul.querySelectorAll('.art-tag').forEach(li => {
            li.querySelector('.art-tag-x').addEventListener('click', () => {
                this._artDraft.tags.splice(Number(li.dataset.idx), 1);
                this._artRenderTags();
                this._artScheduleSave();
            });
        });
    }

    _artRenderTagSuggest() {
        const input = document.getElementById('art-tag-input');
        const box = document.getElementById('art-tag-sugg');
        if (!input || !box) return;
        const q = input.value.trim();
        const qKey = PublishArticleStore.normalizeTagKey(q);
        const existingKeys = new Set((this._artDraft.tags || []).map(t => PublishArticleStore.normalizeTagKey(t)));
        const all = this.publishArticleStore.allTags().filter(t => !existingKeys.has(t.key));
        const matched = q ? all.filter(t => PublishArticleStore.normalizeTagKey(t.label).includes(qKey)) : all;
        const esc = BookshelfEscape.escapeHtml;
        const items = matched.slice(0, 8).map(t =>
            `<div class="art-sugg-item" data-label="${esc(t.label)}"><span>${esc(t.label)}</span><span class="art-sugg-count">使用 ${t.count}</span></div>`
        ).join('');
        const canCreate = q && !existingKeys.has(qKey) && !all.some(t => t.key === qKey);
        const newItem = canCreate ? `<div class="art-sugg-item art-sugg-new" data-label="${esc(q)}">＋「${esc(q)}」を新しいタグにする</div>` : '';
        if (!items && !newItem) { box.hidden = true; box.innerHTML = ''; return; }
        box.innerHTML = items + newItem;
        box.hidden = false;
        box.querySelectorAll('.art-sugg-item').forEach(el => {
            el.addEventListener('mousedown', (e) => { e.preventDefault(); this._artAddTag(el.dataset.label); });
        });
    }

    _artHideTagSuggest() {
        const box = document.getElementById('art-tag-sugg');
        if (box) { box.hidden = true; box.innerHTML = ''; }
        const input = document.getElementById('art-tag-input');
        if (input) input.value = '';
    }

    _artAddTag(label) {
        const l = String(label || '').trim();
        if (!l) return;
        const key = PublishArticleStore.normalizeTagKey(l);
        if (!this._artDraft.tags) this._artDraft.tags = [];
        if (this._artDraft.tags.some(t => PublishArticleStore.normalizeTagKey(t) === key)) { this._artHideTagSuggest(); return; }
        this._artDraft.tags.push(l);
        this._artRenderTags();
        this._artHideTagSuggest();
        this._artScheduleSave();
    }

    _artOnTagInputKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const input = document.getElementById('art-tag-input');
            const box = document.getElementById('art-tag-sugg');
            const first = box && !box.hidden && box.querySelector('.art-sugg-item');
            if (first) { this._artAddTag(first.dataset.label); return; }
            if (input.value.trim()) this._artAddTag(input.value.trim());
        } else if (window.Surface.isEsc(e)) {
            this._artHideTagSuggest();
        }
    }

    // ===== ブロック列 (文章/本/本棚の3種のみ, §11.2) =====

    _artCollapsedSet() {
        if (!this._artCollapsed) this._artCollapsed = new Set();
        return this._artCollapsed;
    }

    // 全ブロック共通の見出し行 (イシュー#230): ハンドル | ▸▾＋種別＋要約 | 付加操作 | 複製 | 削除。
    // ハンドル・複製・削除は畳んでも常に出す。fixed (見た目ブロック) は並べ替え・複製・削除できないため空セルで列だけ保つ。
    _artBlockBar({ id, kind, icon, summary = '', extra = '', fixed = false }) {
        const esc = BookshelfEscape.escapeHtml;
        const collapsed = this._artCollapsedSet().has(id);
        const cell = '<span class="art-block-cell" aria-hidden="true"></span>';
        return `<div class="art-block-bar">
            ${fixed ? cell : '<span class="art-block-grip h-icon" data-icon="grip-vertical" data-icon-size="14" title="ドラッグで並べ替え"></span>'}
            <button type="button" class="art-block-tg" aria-expanded="${!collapsed}" title="${collapsed ? '開く' : '畳む'}">
                <span class="art-block-chev h-icon" data-icon="${collapsed ? 'chevron-right' : 'chevron-down'}" data-icon-size="14"></span>
                <span class="art-block-kind">${icon ? `<span class="h-icon" data-icon="${icon}" data-icon-size="13"></span>` : ''}${esc(kind)}</span>
                <span class="art-block-sum">${esc(summary)}</span>
            </button>
            <span class="art-block-extra">${extra}</span>
            ${fixed ? cell + cell : `<button type="button" class="art-block-ic art-block-dup" title="複製"><span class="h-icon" data-icon="copy" data-icon-size="14"></span></button>
            <button type="button" class="art-block-ic art-block-del" title="削除"><span class="h-icon" data-icon="trash-2" data-icon-size="14"></span></button>`}
        </div>`;
    }

    _artBlockSummary(b) {
        if (b.type === 'text') {
            const line = String(b.markdown || '').split('\n').map(x => x.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
            return line || '（空の文章）';
        }
        const titleOf = (asin) => { const bk = this.books.find(x => x.asin === asin); return bk ? bk.title : asin; };
        if (b.type === 'book') return b.asin ? titleOf(b.asin) : '本が未選択';
        if (b.type === 'shelf') {
            const items = (b.items || []).slice().sort((x, y) => x.order - y.order);
            return items.length ? `${items.length}冊・${titleOf(items[0].asin)}…` : '0冊';
        }
        return '';
    }

    _artRenderBlocks() {
        this._artQueueCanvas(); // イシュー#268: 下書きが変わるたびにキャンバス (公開ページと同じ見た目) を描き直す
        const host = document.getElementById('art-blocks');
        if (!host) return;
        const tpl = document.getElementById('art-add-menu-tpl');
        const addHtml = tpl ? tpl.innerHTML : '';
        const blocks = this._artDraft.blocks || [];
        const col = this._artCollapsedSet();
        const allIds = ['look', ...blocks.map(b => b.id)];
        const allCollapsed = allIds.every(id => col.has(id));
        let html = `<div class="art-canvas-head">
            <span class="art-canvas-count">${blocks.length}ブロック</span>
            <button type="button" class="btn btn-secondary btn-small art-collapse-all" data-mode="${allCollapsed ? 'open' : 'close'}">${allCollapsed ? 'すべて開く' : 'すべて畳む'}</button>
        </div>`;
        html += this._artRenderLookBlock();
        html += addHtml;
        if (!blocks.length) {
            html += '<p class="pp-empty art-empty">まだブロックがありません。「＋ ブロックを追加」から文章・本棚・本を選んで積み上げ、本は「本の引き出し」から配置できます。</p>';
        }
        blocks.forEach((b, i) => { html += this._artRenderBlock(b, i); html += addHtml; });
        host.innerHTML = html;
        if (this._artFsBlockId) {
            const t = host.querySelector(`.art-block[data-block-id="${CSS.escape(this._artFsBlockId)}"]`);
            if (t) t.classList.add('is-fs-target');
            this._artFsBindPending = true; // イベント結線 (_artBindBlocksEvents) の後で全画面専用の結線をする
        }
        const allBtn = host.querySelector('.art-collapse-all');
        if (allBtn) allBtn.addEventListener('click', () => {
            if (allBtn.dataset.mode === 'open') col.clear();
            else allIds.forEach(id => col.add(id));
            this._artRenderBlocks();
        });
        // 見た目ブロックは並べ替え・複製・削除の対象外なので .art-block を名乗らない (ドラッグ先・件数に混ざらない)
        host.querySelectorAll('.art-block, .art-look-block').forEach(el => {
            const id = el.dataset.lookBlock ? 'look' : el.dataset.blockId;
            const tg = el.querySelector(':scope > .art-block-bar .art-block-tg');
            if (tg && id) tg.addEventListener('click', (e) => {
                e.stopPropagation();
                if (col.has(id)) col.delete(id); else col.add(id);
                this._artRenderBlocks();
            });
        });
        this._artBindLookEvents(host);
        this._artBindBlocksEvents();
        if (this._artFsBindPending) { this._artFsBindPending = false; this._artBindShelfFs(host); }
        if (typeof window.applyIcons === 'function') window.applyIcons(host);
    }

    // ===== イシュー#268 step4: 見た目シート (テンプレ3種=縦一列・配色12案=4列グリッド)。名前と色は _artThemeItems の実値 =====
    _artOpenLookSheet() {
        const sheet = document.getElementById('art-look-sheet');
        if (!sheet) return;
        this._artRenderLookSheet();
        sheet.hidden = false;
        this._surface().open('art-look-sheet', { close: (o) => this._artCloseLookSheet(o), extra: { articleId: this._artEditingId } });
    }

    _artCloseLookSheet({ fromHistory = false } = {}) {
        const sheet = document.getElementById('art-look-sheet');
        if (!sheet || sheet.hidden) return;
        sheet.hidden = true;
        this._surface().close('art-look-sheet', { fromHistory });
    }

    _artRenderLookSheet() {
        const host = document.getElementById('art-look-sheet-body');
        if (!host) return;
        const esc = BookshelfEscape.escapeHtml;
        const theme = PublishArticleStore.normalizeTheme(this._artDraft.theme);
        const lay = this._artThemeItems('layout').filter(it => it.selectable).map(it => `<button type="button" class="art-lk-lay" role="radio" aria-checked="${theme.layout === it.id}" data-look-kind="layout" data-look-id="${esc(it.id)}"><span class="h-icon" data-icon="${esc(it.icon)}" data-icon-size="20"></span><span>${esc(it.label)}</span></button>`).join('');
        const col = this._artThemeItems('color').filter(it => it.selectable).map(it => {
            const t = (typeof ARTICLE_COLOR_TOKENS !== 'undefined' && ARTICLE_COLOR_TOKENS[it.id]) || {};
            return `<button type="button" class="art-lk-col" role="radio" aria-checked="${theme.color === it.id}" data-look-kind="color" data-look-id="${esc(it.id)}" title="${esc(it.label)}"><span class="art-lk-th" style="background:${esc(t.bg || '#fff')};color:${esc(t.txt || '#222')}"><i>Aa</i><b style="background:${esc(t.acc || '#888')}"></b></span><span>${esc(it.label)}</span></button>`;
        }).join('');
        host.innerHTML = `<div class="art-lk-sec">テンプレート</div><div class="art-lk-lays" role="radiogroup" aria-label="テンプレート">${lay}</div>
            <div class="art-lk-sec">配色</div><div class="art-lk-cols" role="radiogroup" aria-label="配色">${col}</div>`;
        host.querySelectorAll('[data-look-kind]').forEach(btn => btn.addEventListener('click', () => {
            const th = PublishArticleStore.normalizeTheme(this._artDraft.theme);
            th[btn.dataset.lookKind] = btn.dataset.lookId;
            this._artDraft.theme = PublishArticleStore.normalizeTheme(th);
            this._artScheduleSave();
            this._artRenderLookSheet();
            this._artRenderBlocks(); // 背後のキャンバスへ即反映
        }));
        if (typeof window.applyIcons === 'function') window.applyIcons(host);
    }

    // full=true (既定): 本ブロック(1冊)用の3チップ。full=false: 本棚(各行)用の2チップ (長文メモを選べない, イシュー#238)。
    // 本ブロックのチップ順を「短文メモ→評価→長文メモ」にしているのは、本棚の2チップ(短文メモ/評価)が
    // 本ブロックの先頭2チップと同じ列位置(left)に揃うようにするため(②承認 2026-09-28・列トラック
    // --art-cols 自体は変えず .art-chips 側だけ2列に絞る。実測は tmp/verify-shots/238)。
    _artChips(show, cls, extraAttrs = '', full = true) {
        const one = (key, label) => `<button type="button" class="art-chip-toggle ${cls}${show[key] ? ' is-on' : ''}" data-show-key="${key}"${extraAttrs} aria-pressed="${show[key] ? 'true' : 'false'}">${label}</button>`;
        return `<div class="art-chips art-shelf-item-toggles">${one('shortMemo', '短文メモ')}${one('rating', '評価')}${full ? one('longMemo', '長文メモ') : ''}</div>`;
    }

    _artRenderBlock(b, index) {
        const esc = BookshelfEscape.escapeHtml;
        const collapsed = this._artCollapsedSet().has(b.id);
        const summary = this._artBlockSummary(b);
        if (b.type === 'text') {
            // イシュー#276 step3: 編集対象 (全画面) は EasyMDE。それ以外 (畳んだ一覧表示等) は旧表示のまま
            if (this._artFsBlockId === b.id) return this._artRenderTextFs(b, index);
            return `<div class="art-block${collapsed ? ' is-collapsed' : ''}" data-block-id="${esc(b.id)}" data-index="${index}">
                ${this._artBlockBar({ id: b.id, kind: '文章', summary })}
                ${collapsed ? '' : `<div class="art-block-body art-block-text">
                    <textarea class="art-text-input" placeholder="見出しや本文をMarkdownで書く…">${esc(b.markdown || '')}</textarea>
                </div>`}
            </div>`;
        }
        if (b.type === 'book') {
            // イシュー#166: 対象が常に明確な「本を選ぶ/差し替え」の入口をブロック内に置く (FAB廃止に伴う代替)。
            // 押したブロックへ入るよう _artPendingBookBlockId をここでセットしてからシートを開く (900px超は右パネル常時表示)。
            const pickBtn = `<button type="button" class="art-block-ic art-book-pick" title="${b.asin ? 'この本を選び直す' : 'この本を選ぶ'}"><span class="h-icon" data-icon="${b.asin ? 'refresh-cw' : 'book-plus'}" data-icon-size="14"></span></button>`;
            const bar = this._artBlockBar({ id: b.id, kind: '本', summary, extra: pickBtn });
            if (!b.asin) {
                return `<div class="art-block${collapsed ? ' is-collapsed' : ''}" data-block-id="${esc(b.id)}" data-index="${index}">
                    ${bar}
                    ${collapsed ? '' : '<div class="art-block-body"><button type="button" class="pp-empty pp-empty-btn art-book-pick" title="この本を選ぶ">+ 本を選ぶ</button></div>'}
                </div>`;
            }
            const book = this.books.find(x => x.asin === b.asin);
            const title = book ? book.title : b.asin;
            const author = book ? (book.authors || '') : '';
            const cover = book && book.productImage ? `<img src="${esc(book.productImage)}" alt="">` : esc(title);
            const show = b.show || { shortMemo: false, longMemo: false, rating: false };
            return `<div class="art-block${collapsed ? ' is-collapsed' : ''}" data-block-id="${esc(b.id)}" data-index="${index}">
                ${bar}
                ${collapsed ? '' : `<div class="art-block-body art-block-book-body art-gx">
                    <div class="art-cover">${cover}</div>
                    <div class="art-block-book-info">
                        <div class="art-item-title">${esc(title)}</div>
                        <div class="art-item-author">${esc(author)}</div>
                    </div>
                    ${this._artChips(show, 'art-book-show-toggle')}
                </div>`}
            </div>`;
        }
        if (b.type === 'shelf') return this._artRenderShelfBlock(b, index);
        return '';
    }

    // 選択中アイテム id の集合 (draft には保存しない・エディタ開いている間だけのUI状態)
    _artShelfSelSet(blockId) {
        if (!this._artShelfSel) this._artShelfSel = {};
        if (!this._artShelfSel[blockId]) this._artShelfSel[blockId] = new Set();
        return this._artShelfSel[blockId];
    }

    // 一括適用 (選択式メモ表示・選択式並び順) の直前の状態を1段だけ保持する (イシュー#55: Undo は確認ダイアログに勝る、Nielsen #3)。
    // 次の一括適用が来ると上書きされる (多段 Undo はスコープ外)。
    _artSnapshotBulk(blockId, block) {
        this._artBulkUndo = {
            blockId,
            items: (block.items || []).map(it => ({ id: it.id, order: it.order, show: { ...(it.show || { shortMemo: false, rating: false }) } }))
        };
    }

    _artToastBulkApplied(count) {
        window.toast(`${count}冊に適用しました`, {
            type: 'success',
            action: { label: '元に戻す', onClick: () => this._artUndoBulk() },
            duration: 8000
        });
    }

    _artUndoBulk() {
        const undo = this._artBulkUndo;
        if (!undo) return;
        const block = this._artFindBlock(undo.blockId);
        if (block) {
            const snapById = new Map(undo.items.map(it => [it.id, it]));
            (block.items || []).forEach(it => {
                const snap = snapById.get(it.id);
                if (!snap) return;
                it.order = snap.order;
                it.show = { ...snap.show };
            });
            this._artRenderBlocks();
            this._artScheduleSave();
        }
        this._artBulkUndo = null;
    }

    // イシュー#276 step3: 文章ブロックの全画面 (EasyMDE)。中身は _artOpenTextFsEditor が
    // #art-text-fs-textarea に対して生やす (非同期・遅延読込のため、ここでは空の textarea だけ置く)。
    _artRenderTextFs(b, index) {
        const esc = BookshelfEscape.escapeHtml;
        return `<div class="art-block art-fs-block is-fs-target" data-block-id="${esc(b.id)}" data-index="${index}">
            <div class="art-fs-text-editor">
                <textarea id="art-text-fs-textarea"></textarea>
            </div>
        </div>`;
    }

    // 表示は1行1冊のリストのみ (密度トグルはチップ固定幅と両立しないため撤去・イシュー#230)。
    // 一括操作 (短文/長文メモの表示・並び順) は選択式 (イシュー#55): 1件以上選択したときだけ選択バーを出す。
    // イシュー#268 step4: 本棚の全画面 (承認モック shot-2-shelf-sp-390 の並び)。
    // 行 = 書影サムネ・書名・著者・短文メモ入力 (その場で入力)・チップ「短文メモ/評価」、右端に ↑ ↓ ×。
    // チェックボックス一括操作と grip ドラッグは出さない (上へ・下へに一本化・②決裁)。
    _artRenderShelfFs(b, index) {
        const esc = BookshelfEscape.escapeHtml;
        const items = (b.items || []).slice().sort((x, y) => x.order - y.order);
        const ic = (name, size) => `<span class="h-icon" data-icon="${name}" data-icon-size="${size}"></span>`;
        const rows = items.map((it, i) => {
            const book = this.books.find(x => x.asin === it.asin);
            const title = book ? book.title : it.asin;
            const author = book ? (book.authors || book.author || '') : '';
            const cover = book && book.productImage ? `<img src="${esc(book.productImage)}" alt="">` : `<span>${esc(title)}</span>`;
            const memo = this.bookshelfManager.resolveMemo(it.asin) || '';
            const show = it.show || { shortMemo: false, rating: false };
            return `<div class="art-shelf-item art-fs-row" data-item-id="${esc(it.id)}">
                <div class="art-fs-cover">${cover}</div>
                <div class="art-fs-body">
                    <div class="art-fs-ttl">${esc(title)}</div>
                    ${author ? `<div class="art-fs-au">${esc(Array.isArray(author) ? author.join('、') : author)}</div>` : ''}
                    <input type="text" class="art-fs-memo" data-asin="${esc(it.asin)}" value="${esc(memo)}" placeholder="短文メモを書く" aria-label="${esc(title)}の短文メモ">
                    ${this._artChips(show, 'art-item-show-toggle', ` data-asin="${esc(it.asin)}" aria-describedby="art-item-tooltip"`, false)}
                </div>
                <div class="art-fs-ops">
                    <button type="button" class="art-fs-ic art-fs-up" title="上へ" aria-label="上へ"${i === 0 ? ' disabled' : ''}>${ic('chevron-up', 16)}</button>
                    <button type="button" class="art-fs-ic art-fs-down" title="下へ" aria-label="下へ"${i === items.length - 1 ? ' disabled' : ''}>${ic('chevron-down', 16)}</button>
                    <button type="button" class="art-fs-ic art-shelf-item-remove" title="外す" aria-label="外す">${ic('x', 16)}</button>
                </div>
            </div>`;
        }).join('');
        // イシュー#530(1)でのis-single(1冊だけを旧「本」ブロックと同じ大きさで見せるCSS分岐)撤去は残す
        // (公開ページの_renderShelfBlockが常に小さいタイル並びなのに編集画面だけ大きく見える食い違いの
        // 解消)。ただし#530で足した本棚⇄本の切替ボタンはイシュー#539でハヘロ判断により撤去した
        // (「本」単体ブロックは不満が無く、追加シートの入口を#528前の形に戻したため不要)。
        return `<div class="art-block art-fs-block is-fs-target is-add-target" data-block-id="${esc(b.id)}" data-index="${index}">
            <div class="art-fs-sec">本（${items.length}冊）</div>
            <div class="art-shelf-list art-fs-list">${rows}</div>
            <div class="art-fs-actions">
                <button type="button" class="art-shelf-add art-fs-add">${ic('plus', 16)}本を追加（本棚・リストから選ぶ）</button>
                <button type="button" class="art-fs-sort-btn" aria-expanded="false"${items.length < 2 ? ' disabled' : ''}>並び順を揃える</button>
            </div>
            <div class="art-fs-sort-opts" hidden>
                <button type="button" class="art-fs-sort-opt" data-sort="added">追加順</button>
                <button type="button" class="art-fs-sort-opt" data-sort="rating">評価順</button>
                <button type="button" class="art-fs-sort-opt" data-sort="title">タイトル順</button>
            </div>
            <p class="art-fs-note">長文メモは本棚では選べません。1冊を詳しく紹介するときは「本」ブロックを使います。</p>
        </div>`;
    }

    // 全画面の行の ↑↓ と短文メモ入力。短文メモは本ごとの1つ (ALL 1段・ADR-007) なので saveNote で保存する
    _artBindShelfFs(host) {
        const el = host.querySelector('.art-fs-block');
        if (!el) return;
        const block = (this._artDraft.blocks || []).find(x => x.id === el.dataset.blockId);
        if (!block) return;
        const move = (itemId, dir) => {
            const items = (block.items || []).slice().sort((x, y) => x.order - y.order);
            const i = items.findIndex(it => it.id === itemId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= items.length) return;
            [items[i], items[j]] = [items[j], items[i]];
            items.forEach((it, k) => { it.order = k; });
            block.items = items;
            this._artRenderBlocks();
            this._artScheduleSave();
        };
        el.querySelectorAll('.art-fs-row').forEach(row => {
            const id = row.dataset.itemId;
            row.querySelector('.art-fs-up')?.addEventListener('click', () => move(id, -1));
            row.querySelector('.art-fs-down')?.addEventListener('click', () => move(id, 1));
        });
        // 並び順を揃える (旧: チェックボックス一括バーのセレクト)。全画面では本棚の全冊が対象
        const sortBtn = el.querySelector('.art-fs-sort-btn');
        const sortOpts = el.querySelector('.art-fs-sort-opts');
        if (sortBtn && sortOpts) {
            sortBtn.addEventListener('click', () => {
                sortOpts.hidden = !sortOpts.hidden;
                sortBtn.setAttribute('aria-expanded', String(!sortOpts.hidden));
            });
            sortOpts.querySelectorAll('.art-fs-sort-opt').forEach(b => b.addEventListener('click', () => {
                this._artSortShelfItems(block, b.dataset.sort, null);
                this._artRenderBlocks();
                this._artScheduleSave();
            }));
        }
        el.querySelectorAll('.art-fs-memo').forEach(inp => {
            inp.addEventListener('input', () => this._artScheduleMemoSave(inp.dataset.asin, inp.value));
        });
    }

    _artRenderShelfBlock(b, index) {
        if (this._artFsBlockId === b.id) return this._artRenderShelfFs(b, index);
        const esc = BookshelfEscape.escapeHtml;
        const collapsed = this._artCollapsedSet().has(b.id);
        const items = (b.items || []).slice().sort((x, y) => x.order - y.order);
        // #133: どの本棚から作ったブロックか判定する (イシュー#170でアイコン/テキストは撤去、
        // shelf不在時の警告表示にのみ使う)。棚が削除済みなら明示する。
        const shelf = this.bookshelfManager.getById(b.shelfId);
        // イシュー#155: shelfId が最初から無い (未選択のまま保存された旧データ) 場合と、
        // 一度は設定されたが本棚が削除された場合とで文言を分ける (前者を「削除済み」と言うのは誤り)。
        const shelfLabel = shelf ? (shelf.isSpecial ? shelf.name : this.bookshelfManager.getPathLabel(b.shelfId)) : (b.shelfId ? '削除済みの本棚' : '未選択の本棚');
        // イシュー#168で本棚名のテキスト表示を撤去(ハヘロ「名前出るのいらなくない？」)、
        // イシュー#170でアイコンも撤去(ハヘロ「本棚アイコンを持つ必要あるだろうか」)。対象ブロックの
        // 明示は .is-add-target ハイライト (下) と引き出し側ヒント _artRenderDrawerTargetHint が
        // 独立して担っており、アイコン/テキストの有無に依存しないことを実測で確認済み (#168/#170 step1)。
        // shelf 不在 (削除済み/未選択) はデータ異常の警告のため、識別用装飾とは別物として例外的に
        // テキストのまま残す (ADR-095 の異常表示を維持)。
        const shelfHtml = shelf
            ? `<span class="art-block-shelf"></span>`
            : `<span class="art-block-shelf is-shelf-missing">
                <span class="art-block-shelf-path">${esc(shelfLabel)}</span>
            </span>`;
        const sel = this._artShelfSelSet(b.id);
        for (const id of [...sel]) { if (!items.some(it => it.id === id)) sel.delete(id); }
        const itemsHtml = items.map((it, i) => {
            const book = this.books.find(x => x.asin === it.asin);
            const title = book ? book.title : it.asin;
            const cover = book && book.productImage ? `<img src="${esc(book.productImage)}" alt="">` : esc(title);
            const show = it.show || { shortMemo: false, rating: false };
            const checked = sel.has(it.id);
            return `<div class="art-shelf-item${checked ? ' is-selected' : ''}" data-item-id="${esc(it.id)}">
                <input type="checkbox" class="art-item-check" aria-label="${esc(title)}を選択"${checked ? ' checked' : ''}>
                <span class="art-shelf-item-grip h-icon" data-icon="grip-vertical" data-icon-size="12"></span>
                <div class="art-cover">${cover}</div>
                <div class="art-shelf-item-title">${esc(title)}</div>
                ${this._artChips(show, 'art-item-show-toggle', ` data-asin="${esc(it.asin)}" aria-describedby="art-item-tooltip"`, false)}
                <div class="art-shelf-item-order-btns">
                    <button type="button" class="art-shelf-item-ic art-item-to-first" title="先頭へ"${i === 0 ? ' disabled' : ''}><span class="h-icon" data-icon="chevron-up" data-icon-size="12"></span></button>
                    <button type="button" class="art-shelf-item-ic art-item-to-last" title="末尾へ"${i === items.length - 1 ? ' disabled' : ''}><span class="h-icon" data-icon="chevron-down" data-icon-size="12"></span></button>
                </div>
                <button type="button" class="art-shelf-item-remove" title="外す">×</button>
            </div>`;
        }).join('');
        const selCount = sel.size;
        const allSelected = items.length > 0 && selCount === items.length;
        // 一括バーのチップ: 選択中の本すべてで ON なら押下表示・一部だけ ON なら混在表示。押すと全部 ON (全部 ON なら全部 OFF)。
        const selItems = items.filter(it => sel.has(it.id));
        const selChip = (key, label) => {
            const on = selItems.filter(it => it.show && it.show[key]).length;
            const all = selItems.length > 0 && on === selItems.length;
            const mixed = on > 0 && !all;
            return `<button type="button" class="art-chip-toggle art-sel-chip${all ? ' is-on' : ''}${mixed ? ' is-mixed' : ''}" data-show-key="${key}" aria-pressed="${all ? 'true' : (mixed ? 'mixed' : 'false')}">${label}</button>`;
        };
        const selbarHtml = (selCount > 0 && !collapsed) ? `
            <div class="art-shelf-selbar art-gx">
                <label class="checkbox-label art-shelf-selbar-master">
                    <input type="checkbox" class="art-shelf-select-all"${allSelected ? ' checked' : ''} aria-label="すべて選択">
                    <span>${selCount}冊を選択中</span>
                </label>
                <div class="art-chips">${selChip('shortMemo', '短文メモ')}${selChip('rating', '評価')}</div>
                <div class="art-shelf-selbar-ops">
                    <select class="art-shelf-sort-sel" title="選択した本の並び順を揃える">
                        <option value="">並び順で揃える…</option>
                        <option value="added">追加順</option>
                        <option value="rating">評価順</option>
                        <option value="title">タイトル順</option>
                    </select>
                    <span class="art-block-bar-sp"></span>
                    <button type="button" class="art-sel-all-btn">すべて選択</button>
                    <button type="button" class="art-sel-clear-btn">選択解除</button>
                </div>
            </div>` : '';
        // #133 項目3: 引き出しからの追加先ブロックを視覚的に示す (Nielsen #1 システム状態の可視性)。
        const isAddTarget = b.id === this._artActiveShelfBlockId;
        // イシュー#168: 「このブロックに追加」の入口をバー(操作アイコン列)から本一覧そのものへ移設。
        // #166 時点はバー内 (.art-block-ic・複製/削除と同一視覚言語) に置いたため見つけにくいという
        // 実機フィードバックが出た (step1 設計レポート参照)。本があれば一覧末尾の+タイル、無ければ
        // 大型の破線ボタンにして、本が並ぶ領域そのものに常駐させる。クリックハンドラは既存の
        // .art-shelf-add クラスに依存するクエリのまま (querySelector で1個だけ拾う設計・イベント側は無変更)。
        const addTileHtml = items.length
            ? `<button type="button" class="art-shelf-add art-shelf-add-tile" title="このブロックに本を追加">
                <span class="h-icon" data-icon="book-plus" data-icon-size="18"></span>
                <span class="art-shelf-add-tile-label">本を追加</span>
            </button>`
            : '';
        // イシュー#530(1): is-single(#528)は撤去済み(1875行のコメント参照)。
        const bodyHtml = items.length
            ? `<div class="art-shelf-list">${itemsHtml}${addTileHtml}</div>`
            : `<button type="button" class="art-shelf-add art-shelf-add-empty pp-empty pp-empty-btn" title="このブロックに本を追加">
                <span class="h-icon" data-icon="book-plus" data-icon-size="20"></span>
                <span>このボタンから本を追加してください</span>
            </button>`;
        return `<div class="art-block${collapsed ? ' is-collapsed' : ''}${isAddTarget ? ' is-add-target' : ''}" data-block-id="${esc(b.id)}" data-index="${index}">
            ${this._artBlockBar({ id: b.id, kind: '本棚', summary: this._artBlockSummary(b), extra: shelf ? '' : shelfHtml })}
            ${selbarHtml}
            ${collapsed ? '' : `<div class="art-block-body">${bodyHtml}</div>`}
        </div>`;
    }
    // #133 項目6: 短/長トグルの説明+メモ内容 (title 属性だけで済ませない・hover/focus/タッチ共通到達)。
    // 短文=resolveMemo() の内容そのもの、長文=本文が長くなり得るため有無のみ (detail 指示どおり)。
    _artShowItemTooltip(btn) {
        const tip = document.getElementById('art-item-tooltip');
        if (!tip || !btn) return;
        const key = btn.dataset.showKey;
        const asin = btn.dataset.asin;
        const isOn = btn.classList.contains('is-on');
        const esc = BookshelfEscape.escapeHtml;
        let title, body;
        // このツールチップは本棚の各行 (.art-item-show-toggle) だけが呼ぶ。本棚は長文メモを選べない
        // (イシュー#238) ため key は shortMemo/rating のみ・longMemo 分岐は持たない (本ブロックの
        // 長文メモチップ (.art-book-show-toggle) はこのツールチップを使わない)。
        if (key === 'shortMemo') {
            title = `短文メモを${isOn ? '非表示にする' : '表示する'}`;
            const memo = this.bookshelfManager.resolveMemo(asin);
            body = memo ? memo : '短文メモなし';
        } else {
            title = `評価を${isOn ? '非表示にする' : '表示する'}`;
            const rating = this.bookshelfManager.resolveRating(asin);
            body = rating ? `評価: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}` : '評価なし';
        }
        tip.innerHTML = `<div class="art-item-tooltip-title">${esc(title)}</div><div class="art-item-tooltip-body">${esc(body)}</div>`;
        tip.hidden = false;
        this._placeAnchoredMenu(btn, tip);
    }

    _artHideItemTooltip() {
        const tip = document.getElementById('art-item-tooltip');
        if (tip) tip.hidden = true;
        if (this._artItemTooltipTouchTimer) { clearTimeout(this._artItemTooltipTouchTimer); this._artItemTooltipTouchTimer = null; }
    }

    _artBindBlocksEvents() {
        const host = document.getElementById('art-blocks');
        if (!host) return;

        host.querySelectorAll('.art-block').forEach(el => {
            const blockId = el.dataset.blockId;
            const block = this._artFindBlock(blockId);
            if (!block) return;

            const ta = el.querySelector('.art-text-input');
            if (ta) ta.addEventListener('input', () => { block.markdown = ta.value; this._artScheduleSave(); });

            const dup = el.querySelector('.art-block-dup');
            if (dup) dup.addEventListener('click', () => this._artDuplicateBlock(blockId));
            const del = el.querySelector('.art-block-del');
            if (del) del.addEventListener('click', () => this._artRemoveBlock(blockId));

            // イシュー#166: 本ブロックの「選ぶ/差し替え」入口 (asin無しは空状態ボタン+バーアイコンの2箇所に同じクラスが乗る)。
            el.querySelectorAll('.art-book-pick').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._artPendingBookBlockId = blockId;
                    this._artRenderDrawer();
                    this._artOpenSheet();
                });
            });
            // イシュー#166: 本棚ブロックの「このブロックに追加」入口。バー内クリックは既存の
            // ブロック全体クリック (アクティブ化のみ) とバブリングするため stopPropagation で二重実行を防ぐ。
            const shelfAddBtn = el.querySelector('.art-shelf-add');
            if (shelfAddBtn) shelfAddBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 直前に「本を選ぶ」を開いてキャンセルした場合の差し替え待ちが残っていると
                // ヒント表示・クリック時の追加先解決の両方が誤るため、ここで明示的に解除する。
                this._artPendingBookBlockId = null;
                this._artActiveShelfBlockId = blockId;
                this._artRenderBlocks();
                this._artRenderDrawer();
                this._artOpenSheet();
            });

            const sortSel = el.querySelector('.art-shelf-sort-sel');
            if (sortSel) sortSel.addEventListener('change', () => {
                const mode = sortSel.value;
                if (!mode) return;
                const ids = this._artShelfSelSet(blockId);
                const count = ids.size;
                this._artSnapshotBulk(blockId, block);
                this._artSortShelfItems(block, mode, ids);
                this._artToastBulkApplied(count);
            });

            el.querySelectorAll('.art-book-show-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const key = btn.dataset.showKey;
                    block.show = block.show || { shortMemo: false, longMemo: false, rating: false };
                    block.show[key] = !block.show[key];
                    this._artRenderBlocks();
                    this._artScheduleSave();
                });
            });

            // 選択バー (1件以上選択したときだけ描画される、イシュー#55)
            const selMaster = el.querySelector('.art-shelf-select-all');
            if (selMaster) {
                const selSize = this._artShelfSelSet(blockId).size;
                const mixed = selSize > 0 && selSize < (block.items || []).length;
                selMaster.indeterminate = mixed;
                // :indeterminate 疑似クラスは el.indeterminate の動的変更で再描画されないことがある (実測)。
                // 見た目は明示クラスで決める (indeterminate プロパティ自体はスクリーンリーダー等のため残す)。
                selMaster.classList.toggle('is-mixed', mixed);
                selMaster.addEventListener('change', () => {
                    const set = this._artShelfSelSet(blockId);
                    if (selMaster.checked) (block.items || []).forEach(it => set.add(it.id));
                    else set.clear();
                    this._artRenderBlocks();
                });
            }
            const selAllBtn = el.querySelector('.art-sel-all-btn');
            if (selAllBtn) selAllBtn.addEventListener('click', () => {
                const set = this._artShelfSelSet(blockId);
                (block.items || []).forEach(it => set.add(it.id));
                this._artRenderBlocks();
            });
            const selClearBtn = el.querySelector('.art-sel-clear-btn');
            if (selClearBtn) selClearBtn.addEventListener('click', () => {
                this._artShelfSelSet(blockId).clear();
                this._artRenderBlocks();
            });
            el.querySelectorAll('.art-sel-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const key = chip.dataset.showKey;
                    const ids = this._artShelfSelSet(blockId);
                    const targets = (block.items || []).filter(it => ids.has(it.id));
                    const next = chip.getAttribute('aria-pressed') !== 'true';
                    this._artSnapshotBulk(blockId, block);
                    targets.forEach(it => {
                        it.show = it.show || { shortMemo: false, rating: false };
                        it.show[key] = next;
                    });
                    this._artRenderBlocks();
                    this._artScheduleSave();
                    this._artToastBulkApplied(targets.length);
                });
            });

            el.querySelectorAll('.art-shelf-item').forEach(itemEl => {
                const itemId = itemEl.dataset.itemId;
                const item = (block.items || []).find(it => it.id === itemId);
                if (!item) return;
                const check = itemEl.querySelector('.art-item-check');
                if (check) check.addEventListener('change', () => {
                    const set = this._artShelfSelSet(blockId);
                    if (check.checked) set.add(itemId); else set.delete(itemId);
                    this._artRenderBlocks();
                });
                itemEl.querySelectorAll('.art-item-show-toggle').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = btn.dataset.showKey;
                        item.show = item.show || { shortMemo: false, rating: false };
                        item.show[key] = !item.show[key];
                        // タッチ操作 (touchstart→click) はツールチップをタイマーで併表示し続ける設計のため、
                        // click 側では即座に消さない (即座に消すと PC でクリック直後にツールチップだけ消え、
                        // タッチでは touchstart で表示した直後に click が発火してタイマーより先に消えてしまう)。
                        if (!this._artItemTooltipTouchTimer) this._artHideItemTooltip();
                        this._artRenderBlocks();
                        this._artScheduleSave();
                    });
                    // #133 項目6: 短/長が何の話か分からない (本人指摘) への説明+メモ内容。hover/focus 両方から
                    // 同じ内容に到達する (ui-standards/ux-heuristics: hover-only はモバイル/キーボードで使えない)。
                    btn.addEventListener('mouseenter', () => this._artShowItemTooltip(btn));
                    btn.addEventListener('mouseleave', () => this._artHideItemTooltip());
                    btn.addEventListener('focus', () => this._artShowItemTooltip(btn));
                    // タッチの tap は touchstart 後に focus→blur を合成発火することがあり (実測)、
                    // blur を無条件で処理するとタッチ用タイマーより先にツールチップが消えてしまう。
                    // タッチタイマー動作中は blur を無視し、タイマー満了に任せる。
                    btn.addEventListener('blur', () => { if (!this._artItemTooltipTouchTimer) this._artHideItemTooltip(); });
                    // タッチ: tap すると表示が切り替わるボタンなので、long-press 判定は複雑度に見合わず見送り、
                    // tap で一定時間ツールチップを併表示してからトグルも実行される形にする (理由は結果に記録)。
                    btn.addEventListener('touchstart', () => {
                        this._artShowItemTooltip(btn);
                        if (this._artItemTooltipTouchTimer) clearTimeout(this._artItemTooltipTouchTimer);
                        this._artItemTooltipTouchTimer = setTimeout(() => this._artHideItemTooltip(), 2500);
                    }, { passive: true });
                });
                const rm = itemEl.querySelector('.art-shelf-item-remove');
                if (rm) rm.addEventListener('click', () => {
                    block.items = (block.items || []).filter(it => it.id !== itemId);
                    this._artShelfSelSet(blockId).delete(itemId);
                    this._artRenderBlocks();
                    this._artRenderDrawer();
                    this._artScheduleSave();
                });
                const toFirst = itemEl.querySelector('.art-item-to-first');
                if (toFirst) toFirst.addEventListener('click', (e) => { e.stopPropagation(); this._artMoveShelfItem(block, itemId, 'first'); });
                const toLast = itemEl.querySelector('.art-item-to-last');
                if (toLast) toLast.addEventListener('click', (e) => { e.stopPropagation(); this._artMoveShelfItem(block, itemId, 'last'); });
                if (!itemEl.classList.contains('art-fs-row')) this._artBindDrag(itemEl.querySelector('.art-shelf-item-grip'), itemEl, '.art-shelf-item', (fromEl, toEl) => {
                    this._artReorderShelfItems(block, fromEl.dataset.itemId, toEl.dataset.itemId);
                });
            });

            this._artBindDrag(el.querySelector('.art-block-grip'), el, '.art-block', (fromEl, toEl) => {
                this._artReorderBlocks(fromEl.dataset.blockId, toEl.dataset.blockId);
            });
            if (block.type === 'shelf') {
                el.addEventListener('click', () => {
                    if (this._artActiveShelfBlockId === blockId) return;
                    this._artActiveShelfBlockId = blockId;
                    this._artRenderBlocks();
                    this._artRenderDrawer();
                });
            }
        });

        // イシュー#155: 本棚が1つも無い状態では、本棚ブロックを作っても「どの本棚を指すか」を
        // 解決しようがなく shelfId:null のまま保存されてしまう。_artResolveSourceShelfId() の
        // 自己修復が効かない唯一のケースなので、その手前で追加自体を止める (無効化+理由表示)。
        // all(isSpecial) 本棚に限定しない (isSpecial 本棚は同期書き出し時に無ければ生成されるだけで
        // 常設が保証されておらず、「真の初回」= 通常本棚を1つ作った直後でも isSpecial は無いままの
        // ケースがある。critical-path.spec.js で実測・_artResolveSourceShelfId() と同じ基準に揃える)。
        const hasAnyShelf = this.bookshelfManager.getBookshelves().length > 0;
        host.querySelectorAll('.art-add').forEach(addEl => {
            const btn = addEl.querySelector('.art-add-btn');
            const menu = addEl.querySelector('.art-add-menu');
            if (!btn || !menu) return;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasHidden = menu.hidden;
                host.querySelectorAll('.art-add-menu').forEach(m => { m.hidden = true; m.classList.remove('is-up'); });
                menu.hidden = !wasHidden;
                if (!menu.hidden) this._placeAnchoredMenu(addEl, menu);
            });
            menu.querySelectorAll('.art-add-menu-item').forEach(item => {
                if (item.dataset.blockType === 'shelf' && !hasAnyShelf) {
                    item.disabled = true;
                    item.title = '本棚がまだ1つもありません。先に本棚を作成してから追加できます。';
                    return;
                }
                item.addEventListener('click', () => {
                    const type = item.dataset.blockType;
                    const index = [...host.querySelectorAll('.art-add')].indexOf(addEl);
                    this._artInsertBlock(type, index);
                    menu.hidden = true;
                });
            });
        });
    }

    // ドラッグハンドルからの簡易 D&D (Pointer Events, ADR-011 のポインタ方式を踏襲)。
    // itemSelector に一致する祖先へドロップすると onDrop(fromEl, toEl) を呼ぶ。
    // pointermove/pointerup は handle ではなく document へ登録する (C-293系の教訓: 数px の
    // グリップ要素だけに登録すると、setPointerCapture が効かない環境でドラッグが即終了する)。
    // is-dragging 中は CSS 側で pointer-events:none にし、elementFromPoint が自分自身ではなく
    // 真下の要素を返すようにする (A-1 回帰修正)。
    _artBindDrag(handle, itemEl, itemSelector, onDrop) {
        if (!handle) { console.warn('[_artBindDrag] handle 要素が見つからないため D&D を無効化しました:', itemSelector, itemEl); return; }
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            try { handle.setPointerCapture(e.pointerId); } catch (_) {}
            itemEl.classList.add('is-dragging');
            const clearOver = () => document.querySelectorAll(itemSelector + '.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
            const onMove = (ev) => {
                const under = document.elementFromPoint(ev.clientX, ev.clientY);
                const target = under && under.closest(itemSelector);
                clearOver();
                if (target && target !== itemEl) target.classList.add('is-drag-over');
            };
            const onUp = (ev) => {
                itemEl.classList.remove('is-dragging');
                clearOver();
                const under = document.elementFromPoint(ev.clientX, ev.clientY);
                const target = under && under.closest(itemSelector);
                if (target && target !== itemEl) onDrop(itemEl, target);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    }

    _artInsertBlock(type, index) {
        let newBlock;
        if (type === 'text') newBlock = { id: PublishArticleStore._newId('blk'), type: 'text', markdown: '' };
        else if (type === 'book') {
            newBlock = { id: PublishArticleStore._newId('blk'), type: 'book', asin: null, show: { shortMemo: false, longMemo: false, rating: false } };
            this._artPendingBookBlockId = newBlock.id;
        } else if (type === 'shelf') {
            // sourceShelfId が未設定/削除済みでも _artResolveSourceShelfId() が all 本棚へ自動補正する
            // (イシュー#155: 補正前は shelfId:null のまま保存され「どの本棚か分からないブロック」になっていた)。
            // 本棚が1つも無い場合のみ null が残るが、その状態ではメニュー側で本棚ブロックの追加自体を無効化している。
            newBlock = { id: PublishArticleStore._newId('blk'), type: 'shelf', shelfId: this._artResolveSourceShelfId(), items: [] };
            // 追加直後は「本の引き出し」からの追加先として即アクティブにする (ブロックをクリックしなくても使える)
            this._artActiveShelfBlockId = newBlock.id;
        } else return;
        if (!this._artDraft.blocks) this._artDraft.blocks = [];
        this._artDraft.blocks.splice(index, 0, newBlock);
        this._artRenderBlocks();
        if (type === 'shelf') this._artRenderDrawer();
        // 本ブロックは asin 確定まで保存しない (normalizeBlocks が asin 無しを捨てるため)
        if (type !== 'book') this._artScheduleSave();
    }

    _artDuplicateBlock(blockId) {
        const blocks = this._artDraft.blocks || [];
        const i = blocks.findIndex(b => b.id === blockId);
        if (i < 0) return;
        const copy = JSON.parse(JSON.stringify(blocks[i]));
        copy.id = PublishArticleStore._newId('blk');
        if (copy.type === 'shelf') {
            copy.items = (copy.items || []).map(it => ({ ...it, id: PublishArticleStore._newId('pl'), blockId: copy.id }));
        }
        blocks.splice(i + 1, 0, copy);
        this._artRenderBlocks();
        this._artScheduleSave();
    }

    // D (イシュー#276): 削除直後に Undo トースト (約5秒) を出す。1段だけ保持 (_artBulkUndo と同型・イシュー#55)。
    _artRemoveBlock(blockId) {
        const blocks = this._artDraft.blocks || [];
        const i = blocks.findIndex(b => b.id === blockId);
        if (i < 0) return;
        const [removed] = blocks.splice(i, 1);
        if (this._artActiveShelfBlockId === blockId) this._artActiveShelfBlockId = null;
        if (this._artShelfSel) delete this._artShelfSel[blockId];
        this._artRenderBlocks();
        this._artRenderDrawer();
        this._artScheduleSave();
        this._artBlockUndo = { block: removed, index: i };
        window.toast('ブロックを削除しました', {
            type: 'success',
            action: { label: '元に戻す', onClick: () => this._artUndoRemoveBlock() },
            duration: 5000
        });
    }

    // ブロックを from→to へ1回で移す (⋯の上へ/下へ・PCのドラッグ・Alt+↑↓ の共通経路・イシュー#278)。
    // undo: #276 の Undo トースト (削除と同じ1段保持の _artBlockUndo) を出す。⋯の上へ/下へは従来どおり出さない。
    // announce: 結果を aria-live で読み上げる。focusGrip: 描き直し後に移動先のつまみへフォーカスを戻す。
    _artMoveBlock(from, to, { undo = false, announce = false, focusGrip = false } = {}) {
        const blocks = this._artDraft.blocks || [];
        if (from < 0 || from >= blocks.length || to < 0 || to >= blocks.length || from === to) return false;
        const before = blocks.map(b => b.id);
        const [b] = blocks.splice(from, 1);
        blocks.splice(to, 0, b);
        if (focusGrip) this._artGripFocusIdx = to;
        this._artRenderBlocks();
        this._artScheduleSave();
        if (announce) {
            const name = b.type === 'shelf' ? '本棚ブロック' : b.type === 'book' ? '本ブロック' : '文章ブロック';
            this._artAnnounce(`${name}を${to + 1}番目に移動しました（全${blocks.length}ブロック）`);
        }
        if (undo) {
            this._artBlockUndo = { order: before };
            window.toast('ブロックを移動しました', {
                type: 'success',
                action: { label: '元に戻す', onClick: () => this._artUndoRemoveBlock() },
                duration: 5000
            });
        }
        return true;
    }

    // スクリーンリーダー向けの読み上げ (aria-live=polite)。キャンバスは描き直しで中身が消えるため親文書側に1つ置く
    _artAnnounce(text) {
        let el = document.getElementById('art-live');
        if (!el) {
            el = document.createElement('div');
            el.id = 'art-live';
            el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
            el.setAttribute('aria-live', 'polite');
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = '';
        requestAnimationFrame(() => { el.textContent = text; });
    }

    _artUndoRemoveBlock() {
        const undo = this._artBlockUndo;
        if (!undo) return;
        this._artBlockUndo = null;
        if (undo.order) { // 並べ替えの取り消し (イシュー#278): 移動前の並びへ戻す
            const blocks = this._artDraft.blocks || [];
            const byId = new Map(blocks.map(b => [b.id, b]));
            this._artDraft.blocks = [...undo.order.map(id => byId.get(id)).filter(Boolean), ...blocks.filter(b => !undo.order.includes(b.id))];
            this._artRenderBlocks();
            this._artScheduleSave();
            return;
        }
        if (!this._artDraft.blocks) this._artDraft.blocks = [];
        const blocks = this._artDraft.blocks;
        const at = Math.min(undo.index, blocks.length);
        blocks.splice(at, 0, undo.block);
        this._artRenderBlocks();
        this._artRenderDrawer();
        this._artScheduleSave();
    }

    _artReorderBlocks(fromId, toId) {
        const blocks = this._artDraft.blocks || [];
        const fromI = blocks.findIndex(b => b.id === fromId);
        const toI = blocks.findIndex(b => b.id === toId);
        if (fromI < 0 || toI < 0 || fromI === toI) return;
        const [moved] = blocks.splice(fromI, 1);
        blocks.splice(toI, 0, moved);
        this._artRenderBlocks();
        this._artScheduleSave();
    }

    _artReorderShelfItems(block, fromId, toId) {
        const items = block.items || [];
        const fromI = items.findIndex(it => it.id === fromId);
        const toI = items.findIndex(it => it.id === toId);
        if (fromI < 0 || toI < 0 || fromI === toI) return;
        const [moved] = items.splice(fromI, 1);
        items.splice(toI, 0, moved);
        items.forEach((it, i) => { it.order = i; });
        this._artRenderBlocks();
        this._artScheduleSave();
    }

    // 並び替え支援 (B): 個別アイテムを先頭/末尾へ即移動。
    _artMoveShelfItem(block, itemId, toEdge) {
        const items = block.items || [];
        const i = items.findIndex(it => it.id === itemId);
        if (i < 0) return;
        const [moved] = items.splice(i, 1);
        if (toEdge === 'first') items.unshift(moved); else items.push(moved);
        items.forEach((it, idx) => { it.order = idx; });
        this._artRenderBlocks();
        this._artScheduleSave();
    }

    _artSortComparatorFor(mode) {
        if (mode === 'added') return (a, b) => (a.addedAt || 0) - (b.addedAt || 0);
        if (mode === 'rating') return (a, b) => (this.userData.notes[b.asin]?.rating || 0) - (this.userData.notes[a.asin]?.rating || 0);
        if (mode === 'title') {
            const titleOf = (it) => (this.books.find(x => x.asin === it.asin) || {}).title || '';
            return (a, b) => titleOf(a).localeCompare(titleOf(b), 'ja');
        }
        return null;
    }

    // 並び替え支援 (B): 追加順(addedAt)/評価順(高い順)/タイトル順(50音)で並べ直してから手で微調整できる。
    // ids を渡すと、それらの本が今占めている位置の中だけで並べ替える (イシュー#55: 選択した本だけを対象にした一括ソート)。
    // ids 省略時は全体を並べ替える (従来挙動、= 選択バーの「すべて選択」後と等価)。
    _artSortShelfItems(block, mode, ids) {
        const comparator = this._artSortComparatorFor(mode);
        if (!comparator) return;
        const ordered = (block.items || []).slice().sort((a, b) => a.order - b.order);
        if (ids && ids.size) {
            const slots = [];
            ordered.forEach((it, i) => { if (ids.has(it.id)) slots.push(i); });
            const subset = slots.map(i => ordered[i]).sort(comparator);
            slots.forEach((slot, k) => { ordered[slot] = subset[k]; });
        } else {
            ordered.sort(comparator);
        }
        ordered.forEach((it, i) => { it.order = i; });
        block.items = ordered;
        this._artRenderBlocks();
        this._artScheduleSave();
    }

    // ===== 右ペイン: 本の引き出し (この本棚の全部の本・多重配置可・新規バッジ・0件で畳む, §11.1) =====

    // 選択中の引き出し元本棚IDを解決する。削除済み等で参照先が無ければ all 本棚へフォールバックし、
    // ドラフトの sourceShelfId 自体もその場で補正する (次回保存時に自然と永続化される)。
    _artResolveSourceShelfId() {
        const bm = this.bookshelfManager;
        if (bm.getById(this._artDraft.sourceShelfId)) return this._artDraft.sourceShelfId;
        // イシュー#155: all(isSpecial) 本棚は同期書き出し時に無ければ生成される (_prepareSyncEntries)
        // だけで、userData.bookshelves の初期値としては保証されていない。実機の「真の初回」
        // (本棚をまだ1つも作っていない状態) では isSpecial 本棚が存在しないことがある
        // (critical-path.spec.js で実測)。_artOpenEditor の新規記事初期化 (8100行付近) と同じ
        // フォールバック順 (all → 先頭の本棚 → null) に揃える。
        const shelves = bm.getBookshelves();
        const allShelf = shelves.find(s => s.isSpecial) || shelves[0] || null;
        const fallback = allShelf ? bm._keyOf(allShelf) : null;
        this._artDraft.sourceShelfId = fallback;
        return fallback;
    }

    // 引き出し上部の本棚セレクタを構築する。既存の #bookshelf-parent と同じ「フラットな <select>」の型
    // (index.html:733-738) を踏襲し、左ペインツリーと同じ深さ優先順 (renderBookshelfList と同じロジック)
    // で並べる。ALL は特殊本棚として先頭固定・既定値のまま (仕様どおり既存挙動を変えない)。
    // #99 で <select> として追加。#133: 別階層に同名本棚を作れる (ADR-008) ため名前だけでは
    // 区別できず、パス表記+アイコンが要る。<option> には要素を入れられないため、_renderBulkShelfList
    // (1188行) の .bookshelf-popover-item + .bs-popover-icon 型を流用したボタン+ポップオーバーへ
    // 置換 (新しい見た目を発明しない・E2E 追随は #art-drawer-shelf 系3箇所のみで済んだ)。
    _artRenderDrawerShelfSelect() {
        const btn = document.getElementById('art-drawer-shelf-btn');
        const iconEl = document.getElementById('art-drawer-shelf-icon');
        const labelEl = document.getElementById('art-drawer-shelf-label');
        const listHost = document.getElementById('art-drawer-shelf-list');
        if (!btn || !listHost) return;
        const bm = this.bookshelfManager;
        const shelves = bm.getBookshelves();
        const allShelf = shelves.find(s => s.isSpecial);
        // renderBookshelfList (7026行) と同じグルーピング: ALL も byParent に含めておかないと、
        // ALL 直下 (=実質トップ階層) の本棚が「parent===ALLのinternalId」で拾えなくなる。
        const byParent = new Map();
        shelves.forEach(bs => {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        });
        const rows = [];
        const walk = (bs) => {
            if (!bs.isSpecial) rows.push(bs);
            (byParent.get(bm._keyOf(bs)) || []).forEach(c => walk(c));
        };
        (byParent.get(null) || []).forEach(r => walk(r));
        const esc = BookshelfEscape.escapeHtml;
        const currentId = this._artResolveSourceShelfId();

        const itemHtml = (bs, isAll) => {
            const key = esc(bm._keyOf(bs));
            const label = isAll ? bs.name : bm.getPathLabel(bm._keyOf(bs));
            const iconName = bs.iconName || 'library';
            const isCurrent = bm._keyOf(bs) === currentId;
            return `<button type="button" class="art-drawer-shelf-item bookshelf-popover-item${isCurrent ? ' is-current' : ''}" data-shelf-internal="${key}" role="option" aria-selected="${isCurrent ? 'true' : 'false'}" title="${esc(label)}">
                <span class="bs-popover-icon" data-icon-value="${esc(iconName)}">${window.renderIcon(iconName, { size: 16 })}</span>
                <span class="art-drawer-shelf-item-label">${esc(label)}</span>
            </button>`;
        };
        listHost.innerHTML = (allShelf ? itemHtml(allShelf, true) : '') + rows.map(bs => itemHtml(bs, false)).join('');
        listHost.querySelectorAll('[data-shelf-internal]').forEach(item => {
            item.addEventListener('click', () => {
                this._artOnDrawerShelfChange(item.dataset.shelfInternal);
                const pop = document.getElementById('art-drawer-shelf-popover');
                if (pop) pop.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                btn.focus();
            });
        });

        // トリガーボタンの表示 (現在選択中の棚のアイコン+パス)
        const current = bm.getById(currentId);
        if (current) {
            const iconName = current.iconName || 'library';
            if (iconEl) { iconEl.innerHTML = window.renderIcon(iconName, { size: 14 }); iconEl.dataset.iconValue = iconName; }
            if (labelEl) labelEl.textContent = current.isSpecial ? current.name : bm.getPathLabel(currentId);
        } else if (labelEl) {
            // _artResolveSourceShelfId() は本棚が1つも無い場合のみ null を返す (全て解決失敗)。
            labelEl.textContent = '(本棚がありません)';
            if (iconEl) iconEl.innerHTML = '';
        }
    }

    // ポップオーバーの開閉・キーボード操作 (Esc で閉じてトリガーへフォーカス返却・_artSetupUI から1回だけ bind)。
    // 位置決めは _placeAnchoredMenu を再利用しビューポート内に収める (ui-standards §2-12)。
    _artSetupDrawerShelfPicker() {
        const btn = document.getElementById('art-drawer-shelf-btn');
        const pop = document.getElementById('art-drawer-shelf-popover');
        if (!btn || !pop) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willShow = pop.hidden;
            pop.hidden = !willShow;
            btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
            if (willShow) this._placeAnchoredMenu(btn, pop);
        });
        document.addEventListener('click', (e) => {
            if (!pop.hidden && window.Surface.isOutside(e, pop, btn)) {
                pop.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
            }
        });
        // capture フェーズ + stopImmediatePropagation: 全モーダル共通の Esc ハンドラ (502行, bubbling
        // フェーズ・アプリ起動時に1回だけ登録され必ずこれより先に存在する) がモーダル自体を閉じてしまう
        // 前に、ポップオーバーだけを閉じて消費する (#art-item-tooltip の Esc ハンドラと同じ理由・CI実行で
        // 実際に競合し `btn.focus()` が効かない回帰を検出・修正した)。
        window.Surface.onEsc(document, (e) => {
            if (pop.hidden) return;
            pop.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            btn.focus();
            e.stopImmediatePropagation();
            e.preventDefault();
        }, true);
    }

    _artOnDrawerShelfChange(shelfInternalId) {
        this._artDraft.sourceShelfId = shelfInternalId || null;
        this._artScheduleSave();
        this._artRenderDrawerShelfSelect();
        this._artRenderDrawer();
    }

    // #133 項目3: 引き出し側にも「どこに追加されるか」の手掛かりを出す (Nielsen #1)。
    // 本棚ブロックのうち何番目か (同名の棚から複数ブロックを作った場合も番号で区別できる)。
    // X3(イシュー#528・A-a/A-b): 入れ先は「いま選んでいるブロック」(_artActiveShelfBlockId)に固定済み
    // (2207〜2214行のブロッククリック・2076行の「本を追加」タイル・2298行の新規作成で切り替わる)。
    // ここでは固定された入れ先に「このブロックにN冊」を加えて出す(今までは冊数が無かった)。
    _artRenderDrawerTargetHint() {
        const hintEl = document.getElementById('art-drawer-target-hint');
        if (!hintEl) return;
        const esc = BookshelfEscape.escapeHtml;
        // イシュー#166: 本ブロックの「選ぶ/差し替え」待ちのときは、本棚ブロックの追加先より優先して対象を明示する。
        if (this._artPendingBookBlockId) {
            const pending = this._artFindBlock(this._artPendingBookBlockId);
            if (pending && pending.type === 'book') {
                const pendingBook = pending.asin ? this.books.find(x => x.asin === pending.asin) : null;
                const pendingLabel = pendingBook ? pendingBook.title : (pending.asin || '未選択');
                hintEl.innerHTML = `<span class="art-drawer-target-label">差し替え対象:</span> <span class="art-drawer-target-name">${esc(pendingLabel)}（本ブロック）</span>`;
                return;
            }
        }
        const block = this._artFindBlock(this._artActiveShelfBlockId);
        if (!block || block.type !== 'shelf') {
            hintEl.innerHTML = '<span class="art-drawer-target-label">追加先:</span> <span class="art-drawer-target-name">新しい本棚ブロックを作成</span>';
            return;
        }
        const count = (block.items || []).length;
        // イシュー#530(2・案i): 全画面で1ブロックを編集している間は、元本棚名+「本棚ブロックN」の行を
        // 消し、冊数だけにする。直上の絞り込み「すべての本」ボタン(art-drawer-shelf-btn)と文字列が
        // 重複して紛らわしい(②指摘)件の解消。ブロック未選択時/本ブロック差し替え中は元本棚名を使わず
        // 混同が起きないため現状維持(上の2分岐)。
        if (this._artFsBlockId === block.id) {
            hintEl.innerHTML = `<span class="art-drawer-target-count">このブロックに${count}冊</span>`;
            return;
        }
        const shelfBlocks = (this._artDraft.blocks || []).filter(b => b.type === 'shelf');
        const orderIndex = shelfBlocks.findIndex(b => b.id === block.id);
        const shelf = this.bookshelfManager.getById(block.shelfId);
        const iconName = shelf ? (shelf.iconName || 'library') : null;
        const label = shelf ? (shelf.isSpecial ? shelf.name : this.bookshelfManager.getPathLabel(block.shelfId)) : (block.shelfId ? '削除済みの本棚' : '未選択の本棚');
        hintEl.innerHTML = `<span class="art-drawer-target-label">追加先:</span>
            ${iconName ? `<span class="art-drawer-target-icon" data-icon-value="${esc(iconName)}">${window.renderIcon(iconName, { size: 12 })}</span>` : ''}
            <span class="art-drawer-target-name">${esc(label)}（本棚ブロック${orderIndex + 1}）</span>
            <span class="art-drawer-target-count">このブロックに${count}冊</span>`;
    }

    // #133 項目5: 棚選択+検索絞り込み後に実際に表示されている asin のみを対象にする
    // (783冊の "all" を検索無しで全追加しようとしても、ここでは絞り込み結果しか返らない)。
    _artDrawerFilteredAsins() {
        const shelf = this.bookshelfManager.getById(this._artResolveSourceShelfId());
        const asins = (shelf && shelf.books) || [];
        const query = this._artDrawerQuery || '';
        if (!query) return asins;
        return asins.filter(asin => {
            const book = this.books.find(b => b.asin === asin);
            const searchText = `${book ? book.title : asin} ${book ? book.authors : ''}`.toLowerCase();
            return searchText.includes(query);
        });
    }

    // ===== 本の引き出しのボトムシート化 (900px以下限定・イシュー#165・案C) =====
    // 履歴統合 (物理戻る/スワイプバックでシートを閉じる) はイシュー#170で対応した。
    // シートは publish-pages-modal というモーダルの「中」で開く入れ子構造のため、汎用の
    // _modalHistPush/_modalHistPop (_modalHistStack) で2段積むと、シートを能動的に閉じた際
    // (fromHistory:false→history.back()) に発生する popstate を汎用ハンドラ (5923行台。スタック末尾を
    // 無条件 pop する設計) が処理し、既に自分で splice 済みの次の要素 (publish-pages-modal) を誤って
    // 閉じてしまう実測バグがあった (二重 pop・#165で発見・実機のE2Eで再現確認済み)。既存21箇所の
    // 履歴統合ロジックを無変更で通すため、当時は抑制カウンタで二重popを解消した。イシュー#284 で
    // 段に深さを持たせて数え合わせる方式 (_onModalHistPopstate) に置き換え、カウンタは廃止した。
    // イシュー#168: 900px超では本の引き出しが「畳める」ようになったため、本エリアの常駐ボタン
    // (art-shelf-add/art-book-pick) から共通で呼べるよう、ここで「開く」意味に幅で分岐させる。
    // _artCloseSheet() 側は分岐させない (ビュー切替時の自動クローズ等・900px以下専用の複数箇所から
    // 呼ばれており、900px超に広げるとユーザーが畳んだ状態を意図せず上書きしてしまうため)。
    _artOpenSheet() {
        if (!this._artIsDrawerNarrow()) { this._artSetDrawerUserCollapsed(false); return; }
        const side = document.getElementById('art-drawer');
        const scrim = document.getElementById('art-sheet-scrim');
        if (!side) return;
        // イシュー#330: 冪等化(安全策)。既に開いていれば何もしない。
        if (side.classList.contains('is-open')) return;
        side.classList.add('is-open');
        if (scrim) scrim.classList.add('is-open');
        this._surface().open('art-sheet', { close: (o) => this._artCloseSheet(o), isMobile: () => this._artIsDrawerNarrow(), extra: { articleId: this._artEditingId, menuBlockId: this._artActiveShelfBlockId } });
    }

    _artCloseSheet({ fromHistory = false } = {}) {
        const side = document.getElementById('art-drawer');
        if (!side || !side.classList.contains('is-open')) return;
        // イシュー#330: 「戻る」で閉じ直す時だけ閉じるtransitionを無効化する(②決裁2026-10-23)。
        if (fromHistory) this._histNoAnimOnce(side);
        side.classList.remove('is-open');
        const scrim = document.getElementById('art-sheet-scrim');
        if (scrim) scrim.classList.remove('is-open');
        this._surface().close('art-sheet', { fromHistory });
    }

    _artIsDrawerNarrow() {
        return window.viewport.isNarrow(); // 境目はjs/ui/viewport.js(900px)に一本化(イシュー#505)
    }

    // 900px超限定のユーザー操作による畳み (イシュー#168)。棚が空のとき自動で隠す
    // .art-drawer-collapsed (_artRenderDrawer 内) とは別クラス・別状態で管理する
    // (自動判定とユーザー操作を混ぜると、畳みを開いたつもりでも棚が空だと隠れたままになる等の
    // 事故を招くため、意図的に分離した設計・step1 で承認済み)。
    _artSetDrawerUserCollapsed(collapsed) {
        this._artDrawerUserCollapsed = !!collapsed;
        try { localStorage.setItem(ART_DRAWER_COLLAPSE_KEY, this._artDrawerUserCollapsed ? '1' : '0'); } catch (_) { /* noop */ }
        const wrap = document.querySelector('.art-wrap');
        if (wrap) wrap.classList.toggle('art-drawer-user-collapsed', this._artDrawerUserCollapsed);
    }

    _artToggleDrawerCollapsed() {
        this._artSetDrawerUserCollapsed(!this._artDrawerUserCollapsed);
    }

    _artRenderDrawer() {
        const wrap = document.querySelector('.art-wrap');
        const listHost = document.getElementById('art-drawer-list');
        const badgeEl = document.getElementById('art-drawer-badge');
        const addAllBtn = document.getElementById('art-drawer-add-all');
        if (!listHost) return;
        // イシュー#168: ユーザー操作の畳み (art-drawer-user-collapsed) を毎回の再描画で反映する。
        // 棚が空のときの自動 art-drawer-collapsed (この直後) とは別クラスなので独立して付け外しできる。
        if (wrap) wrap.classList.toggle('art-drawer-user-collapsed', !!this._artDrawerUserCollapsed);
        this._artRenderDrawerTargetHint();
        const shelf = this.bookshelfManager.getById(this._artResolveSourceShelfId());
        const asins = (shelf && shelf.books) || [];
        if (!asins.length) {
            if (wrap) wrap.classList.add('art-drawer-collapsed');
            listHost.innerHTML = '';
            if (badgeEl) badgeEl.hidden = true;
            if (addAllBtn) addAllBtn.hidden = true;
            return;
        }
        if (wrap) wrap.classList.remove('art-drawer-collapsed');
        const usedAsins = this._artUsedAsins();
        const addedToTarget = this._artDrawerAddedToTargetAsins(); // K (イシュー#276)
        const esc = BookshelfEscape.escapeHtml;
        // X3(イシュー#528・②判断4): 「新着N」バッジは、NEWバッジ撤去(#430)の一部として外す。
        // #art-drawer-badge自体は常に隠す(HTML側の要素は残すが、JSからは出さない)。
        if (badgeEl) badgeEl.hidden = true;
        const filteredAsins = this._artDrawerFilteredAsins();
        if (!filteredAsins.length) {
            listHost.innerHTML = '<div class="art-drawer-empty">条件に合う本がありません</div>';
            if (addAllBtn) addAllBtn.hidden = true;
            return;
        }
        if (addAllBtn) {
            addAllBtn.hidden = false;
            addAllBtn.textContent = `表示中の${filteredAsins.length}冊を追加`;
        }
        // X3(イシュー#528・U6統合): 1件の中身はBookList.drawerItemInnerHtmlへ寄せた(#430のNEWバッジ撤去を反映)。
        // 外側のdiv・data-asin・titleとクリックハンドラの結線はここに残す。
        listHost.innerHTML = filteredAsins.map(asin => {
            const book = this.books.find(b => b.asin === asin) || { asin, title: asin };
            // K (イシュー#276): 追加先のブロックに既に入っている本は「追加済み」を出す。
            // 同じ本を複数回配置する多重配置 (ADR-058 §11.1) は既存仕様のため、印を付けるだけでクリックは禁じない。
            const inTarget = addedToTarget.has(asin);
            // X3(イシュー#528・A-b): 入れ先ブロックに限らず、記事のどこかに既に入っている本すべてに印を付ける。
            const inArticle = usedAsins.has(asin);
            const inner = window.BookList.drawerItemInnerHtml(book, { inTarget, inArticle });
            const cls = inTarget ? ' is-added' : (inArticle ? ' is-used' : '');
            return `<div class="art-drawer-item${cls}" data-asin="${esc(asin)}" title="${inTarget ? 'クリックでもう一度追加' : 'クリックで記事に追加'}">${inner}</div>`;
        }).join('');
        listHost.querySelectorAll('.art-drawer-item').forEach(el => {
            el.addEventListener('click', () => this._artOnDrawerBookClick(el.dataset.asin));
        });
        if (typeof window.applyIcons === 'function') window.applyIcons(listHost);
    }

    // K (イシュー#276): 現在の追加先ブロック (_artActiveShelfBlockId の本棚ブロック / _artPendingBookBlockId
    // の本ブロック) に既に入っている asin の集合。追加先がまだ無い (新規本棚ブロックを作る) ときは空集合。
    _artDrawerAddedToTargetAsins() {
        if (this._artPendingBookBlockId) {
            const pending = this._artFindBlock(this._artPendingBookBlockId);
            return new Set(pending && pending.type === 'book' && pending.asin ? [pending.asin] : []);
        }
        const block = this._artFindBlock(this._artActiveShelfBlockId);
        if (block && block.type === 'shelf') return new Set((block.items || []).map(it => it.asin));
        return new Set();
    }

    // 閾値超は confirmDialog で件数を明示して確認 (783冊の "all" 誤爆防止)。
    // 対象は _artDrawerFilteredAsins() = 棚選択+検索絞り込み後に表示中の本のみ。
    async _artOnDrawerAddAllClick() {
        const asins = this._artDrawerFilteredAsins();
        if (!asins.length) return;
        const ADD_ALL_CONFIRM_THRESHOLD = 50;
        if (asins.length > ADD_ALL_CONFIRM_THRESHOLD) {
            const ok = await confirmDialog({
                title: 'まとめて追加',
                message: `表示中の${asins.length}冊をまとめて追加します。よろしいですか？`,
                okLabel: '追加する'
            });
            if (!ok) return;
        }
        this._artAddBooksToShelf(asins);
        // X3(イシュー#529・A-c): 本棚ブロックへの追加は「完了」を押すまで引き出しを閉じない。
        // 旧イシュー#165の自動クローズ(900px以下)はここで廃止する(単発クリック追加は元々閉じない経路のまま)。
    }

    _artOnDrawerBookClick(asin) {
        if (this._artPendingBookBlockId) {
            const block = this._artFindBlock(this._artPendingBookBlockId);
            this._artPendingBookBlockId = null;
            if (block && block.type === 'book') {
                block.asin = asin;
                this._artRenderBlocks();
                this._artRenderDrawer();
                this._artScheduleSave();
                // イシュー#165: 本単体ブロックは1冊選べば操作完結。900px以下ではシートを開いたままにすると
                // スクリムが本文を覆い続け「選んだら画面が触れなくなる」体験になるため自動で閉じる
                // (900px超・シート未オープン時は _artCloseSheet が no-op なので無害)。
                this._artCloseSheet();
                return;
            }
        }
        this._artAddBookToShelf(asin);
    }

    _artAddBookToShelf(asin) {
        this._artAddBooksToShelf([asin]);
    }

    // #133 項目5: まとめて追加も1冊クリックと同じ追加先解決経路 (_artActiveShelfBlockId) を通す。
    _artAddBooksToShelf(asins) {
        if (!asins.length) return;
        let block = this._artFindBlock(this._artActiveShelfBlockId);
        if (!block || block.type !== 'shelf') {
            // イシュー#155: _artInsertBlock と同じ理由で _artResolveSourceShelfId() を通す。
            block = { id: PublishArticleStore._newId('blk'), type: 'shelf', shelfId: this._artResolveSourceShelfId(), items: [] };
            if (!this._artDraft.blocks) this._artDraft.blocks = [];
            this._artDraft.blocks.push(block);
            this._artActiveShelfBlockId = block.id;
        }
        block.items = block.items || [];
        let order = block.items.length;
        asins.forEach(asin => {
            block.items.push({ id: PublishArticleStore._newId('pl'), blockId: block.id, asin, order: order++, show: { shortMemo: false, rating: false }, addedAt: Date.now() });
        });
        this._artRenderBlocks();
        this._artRenderDrawer();
        this._artScheduleSave();
    }

    // ===== 保存 (autosave, debounce) / 公開 =====

    _artScheduleSave() {
        this._artSetSaveStatus('編集中…');
        if (this._artSaveTimer) clearTimeout(this._artSaveTimer);
        this._artSaveTimer = setTimeout(() => this._artFlushSave(), 600);
    }

    // イシュー#609: 本棚の全画面の短文メモ(.art-fs-memo)の保存予約(300ms)。本ごとに1つ持ち、確定に要る値も持つ
    // (本の詳細の _noteAutoSaveTimers と同じ形)。画面を離れる時は _artSettlePendingSave がまとめて確定する
    _artScheduleMemoSave(asin, value) {
        if (!this._artMemoTimers) this._artMemoTimers = new Map();
        const pending = this._artMemoTimers.get(asin);
        if (pending) clearTimeout(pending.timer);
        const timer = setTimeout(() => this._artSettlePendingMemos(asin), 300);
        this._artMemoTimers.set(asin, { timer, value });
    }

    // イシュー#609: 本のメモの保存予約を今すぐ確定する(asin を渡すとその本だけ=予約の発火・渡さなければ全部)。
    // saveNote は最初の await より前にメモリと localStorage へ書くので、タブを閉じる時に呼んでも端末に残る。
    // 予約が無い時は何もしない=無変更で saveNote を呼ばない
    _artSettlePendingMemos(onlyAsin) {
        const timers = this._artMemoTimers;
        if (!timers || !timers.size) return;
        const asins = onlyAsin === undefined ? [...timers.keys()] : [onlyAsin].filter(a => timers.has(a));
        if (!asins.length) return;
        asins.forEach(asin => {
            const { timer, value } = timers.get(asin);
            clearTimeout(timer);
            timers.delete(asin);
            this.saveNote(asin, value);
        });
        this._artQueueCanvas();
    }

    // イシュー#609: 確定が要る保存予約(記事の _artSaveTimer・本のメモの _artMemoTimers)が残っているか
    _artHasPendingSave() {
        return !!this._artSaveTimer || !!(this._artMemoTimers && this._artMemoTimers.size);
    }

    // イシュー#595: 保留中の保存予約(_artSaveTimer)を今すぐ確定する。画面を離れる経路(←・×/Esc・戻る・
    // 別の記事を開く・タブを閉じる)はここを通す。予約が無い時は何もしない=無変更で update() を呼ばない
    // (呼ぶと updatedAt が進み、公開済みの記事が「公開中・未反映の変更あり」に化ける。#384/#511 A-d の罠)
    // イシュー#609: 本のメモの予約も同じ決まりでここで確定する(await の前に同期で行う)
    async _artSettlePendingSave() {
        this._artSettlePendingMemos();
        if (!this._artSaveTimer) return;
        await this._artFlushSave();
    }

    // イシュー#595: タブを閉じる・裏に回る時(pagehide/beforeunload/visibilitychange=hidden)。await できないので、
    // 先に localStorage へ下書きを同期で書いてから、メモリ反映とリモート送信を走らせる(届けば下書きは消える)
    _artSettleOnLeave() {
        if (this._artHasPendingSave()) {
            const memoPending = !!(this._artMemoTimers && this._artMemoTimers.size);
            if (this._artSaveTimer) this._artSaveDraftToLocalStorage(); // 記事の下書きは、記事の予約がある時だけ書く
            this._artSettlePendingSave().then(() => this._artFlushRemoteNow()).catch(() => {});
            // イシュー#609: 本のメモは利用者データの同期で送る。同期の予約(800ms)を待たずに、すぐ送る
            if (memoPending) this.flushSync().catch(() => {});
        } else if (this._artRemoteFlushTimer) {
            this._artFlushRemoteNow();
        }
    }

    // メモリへの反映のみ (persist:false)。GitHub への実書込は _artScheduleRemoteFlush() が
    // ART_REMOTE_FLUSH_DEBOUNCE_MS だけデバウンスして行う (編集のたび即コミットしていたのを解消、
    // イシュー#142)。データを失わないよう、反映のたび localStorage にも下書きを同期保存する。
    async _artFlushSave() {
        if (this._artSaveTimer) { clearTimeout(this._artSaveTimer); this._artSaveTimer = null; }
        // イシュー#595: 確定の途中で別の記事が開かれても、この下書きだけを確定する(開いた記事の状態を書き換えない)
        const draft = this._artDraft;
        const editingId = this._artEditingId;
        const pendingId = this._artPendingId;
        const patch = {
            title: draft.title || '無題の記事',
            tags: draft.tags || [],
            blocks: draft.blocks || [],
            theme: draft.theme,
            sourceShelfId: draft.sourceShelfId,
            adTag: draft.adTag || null
        };
        try {
            if (editingId && !pendingId) {
                await this.publishArticleStore.update(editingId, patch, { persist: false });
            } else {
                // イシュー#468: _artPendingId(仮id)があればそのidのまま create する。URLの#/publish/<id>と
                // ストアの実idが一致する(採番し直さない)。無ければ従来どおりストア側で新規発行する。
                const created = await this.publishArticleStore.create(patch, { persist: false, id: pendingId || undefined });
                draft.id = created.id;
                draft.slug = created.slug;
                if (this._artDraft === draft) {
                    this._artEditingId = created.id;
                    this._artPendingId = null; // 確定した
                    const ops = document.getElementById('art-page-ops'); if (ops) ops.hidden = false;
                }
            }
            if (this._artDraft === draft) this._artSaveDraftToLocalStorage();
            this._artScheduleRemoteFlush();
        } catch (e) {
            // メモリ反映自体の失敗 (未読込状態での書込等、稀)。リモートエラーと同じ表示にする。
            const isAuthErr = e && e.name === 'HubAuthError';
            this._artSetSaveStatus(
                isAuthErr
                    ? '保存できませんでした。ハブの認証が切れています。設定から再ログインしてください。'
                    : '保存できませんでした。保存先への接続を確認してください。',
                { error: true, retry: true }
            );
            console.error('記事のメモリ反映に失敗:', e);
        }
    }

    _artScheduleRemoteFlush() {
        if (this._artRemoteFlushTimer) clearTimeout(this._artRemoteFlushTimer);
        this._artRemoteFlushTimer = setTimeout(() => this._artFlushRemote(), ART_REMOTE_FLUSH_DEBOUNCE_MS);
    }

    // 保留中のリモートフラッシュがあれば即座に実行する。エディタを閉じる/公開実行/
    // visibilitychange=hidden/手動再試行のいずれからも呼ばれる (イシュー#142)。
    // E2E からも window.bookshelf._artFlushRemoteNow() で明示的に呼べる。
    async _artFlushRemoteNow(opts) {
        if (this._artRemoteFlushTimer) { clearTimeout(this._artRemoteFlushTimer); this._artRemoteFlushTimer = null; }
        if (!this.publishArticleStore || !this.publishArticleStore.hasUnsavedChanges()) return { ok: true };
        return this._artFlushRemote(opts);
    }

    // silent: true の場合、失敗してもエラー toast は出さずステータス欄のみ更新し、呼び出し元に
    // { ok:false, error } を返す。公開フロー (_artPublish) 内から呼ぶときに使う (イシュー#150) ——
    // 公開自体が成功した後に付随する下書き反映の失敗は、公開成功 toast と別の「保存できませんでした」
    // エラー toast を独立に出さず、呼び出し元 (_artPublishArticle) の成功表示へ 1 本化して伝える。
    async _artFlushRemote({ silent = false } = {}) {
        if (this._artRemoteFlushTimer) { clearTimeout(this._artRemoteFlushTimer); this._artRemoteFlushTimer = null; }
        try {
            await this.publishArticleStore.retryPersist();
            this._artSetSaveStatus('保存しました');
            this._artRefreshPublishBadge(); // U1: 公開中・未反映のままなら「保存しました」をこの表示で上書きする
            this._artClearLocalDraft();
            return { ok: true };
        } catch (e) {
            // create() の書込 (persist) が失敗しても、記事オブジェクト自体は id/slug 確定済みで
            // メモリ上の store には既に積まれている (store.create() は persist 前に push するため)。
            // ここで id を拾っておかないと、次の保存 (「もう一度保存」や継続入力での再試行) が
            // create() をもう一度呼んでしまい、同じ記事が重複作成される。
            if (!this._artEditingId && this.publishArticleStore.hasUnsavedChanges()) {
                const pending = this.publishArticleStore.articles().slice(-1)[0];
                if (pending) {
                    this._artEditingId = pending.id;
                    this._artDraft.id = pending.id;
                    this._artDraft.slug = pending.slug;
                    const ops = document.getElementById('art-page-ops'); if (ops) ops.hidden = false;
                }
            }
            // ui-standards §2-11: リトライ中/回復/最終失敗を区別する。GitHubRemoteChangedError /
            // HubRemoteChangedError は 409/412 リトライがリモート側の実変更を検知して上書きを
            // 中止したケース (他タブ/他デバイスの編集と衝突) で、通信エラーとは原因が違うため
            // 専用文言にする (イシュー#142。下のConflictError分岐=L5427と同じくGitHub/ハブ両対応・
            // イシュー#381で判定漏れを修正=以前はHub経由だとこの分岐に入らず汎用の接続エラー文言になっていた)。
            const isAuthErr = e && e.name === 'HubAuthError';
            const isRemoteChanged = StorageAdapter.isRemoteChanged(e); // 判定は1か所 (イシュー#616)
            const message = isRemoteChanged
                ? 'この記事は他の場所で更新されています。内容を確認してから、もう一度保存してください。'
                : isAuthErr
                    ? '保存できませんでした。ハブの認証が切れています。設定から再ログインしてください。'
                    : '保存できませんでした。保存先への接続を確認してください。';
            this._artSetSaveStatus(message, { error: true, retry: true });
            if (!silent) {
                // エディタを閉じた後の即時フラッシュ失敗はステータス表示が見えなくなるため toast でも通知する
                toast(message, { type: 'error' });
            }
            console.error('記事の保存に失敗:', e);
            return { ok: false, error: e };
        }
    }

    // GitHubAdapter からの 409 リトライ通知 (path, status) を受けてステータス表示に反映する。
    // 記事保存 (PUBLISH_ARTICLES_PATH) 以外は今回のスコープ外。
    _handleAdapterWriteStatus(path, status) {
        if (path !== (window.PUBLISH_ARTICLES_PATH || 'private/publish/articles.json')) return;
        if (status === 'retrying') {
            this._artSetSaveStatus('保存を再試行しています…');
        }
    }

    _artSetSaveStatus(text, { error = false, retry = false, stale = false } = {}) {
        const el = document.getElementById('art-save-status');
        window.SaveStatus.set(el, text); // イシュー#518: SaveStatus経由(記事)。state未指定=テキストのみ変更
        if (el) {
            el.classList.toggle('is-error', error);
            el.classList.toggle('is-stale', stale);
        }
        const retryBtn = document.getElementById('art-save-retry');
        if (retryBtn) retryBtn.hidden = !retry;
    }

    // U1 (イシュー#276): updatedAt > lastBuiltAt (公開中かつ未反映の変更あり) のときだけヘッダーに
    // 「公開中・未反映の変更あり」を出し、公開ボタンの表記を「更新」にする (条件は分析 15_…L222 のとおり
    // 厳密に updatedAt > lastBuiltAt のときだけ＝公開済みでも反映済みなら「公開する」のまま)。
    // 保存成功後 (_artFlushRemote) ・公開成功後 (_artPublishArticle) ・エディタを開いた直後 (_artOpenEditor)
    // の3箇所から呼ぶ。公開パネルの見出し/ボタン文言は _artRenderPublishPanel が別途同じ条件で出す。
    _artRefreshPublishBadge() {
        const article = this._artEditingId ? this.publishArticleStore.get(this._artEditingId) : null;
        const stale = !!(article && article.published && (article.updatedAt || 0) > (article.lastBuiltAt || 0));
        this._artPublishStale = stale;
        const btn = document.getElementById('art-publish-header');
        if (btn) {
            const lbl = btn.querySelector('.art-hd-lbl');
            if (lbl) lbl.textContent = stale ? '更新' : '公開する';
            btn.title = stale ? '更新' : '公開';
            btn.setAttribute('aria-label', stale ? '更新' : '公開');
        }
        // 構成A (イシュー#276・②指示): 下部バーの公開/更新ボタンにも同じ判定を反映する
        const barBtn = document.getElementById('art-bar-publish');
        if (barBtn) {
            const lbl = barBtn.querySelector('.art-bar-lbl');
            if (lbl) lbl.textContent = stale ? '更新' : '公開';
            barBtn.classList.toggle('is-stale', stale);
            barBtn.title = stale ? '更新' : '公開';
            barBtn.setAttribute('aria-label', stale ? '更新' : '公開');
        }
        if (stale) {
            this._artSetSaveStatus('● 公開中・未反映の変更あり', { stale: true });
        } else {
            const el = document.getElementById('art-save-status');
            if (el && el.classList.contains('is-stale')) this._artSetSaveStatus('');
        }
        return stale;
    }

    // 記事 1 つの公開 URL (siteUrl + publicId/)。siteUrl の末尾スラッシュ有無を問わない (イシュー#152:
    // result.siteUrl はサイトのトップであり、案内すべきは記事個別の URL のため呼び出し側で組み立てる)。
    _artArticleUrl(siteUrl, publicId) {
        return `${String(siteUrl || '').replace(/\/?$/, '/')}${publicId}/`;
    }

    // 記事を公開する (published=true にして全公開中記事を push)。更新(republish)もここを通る。
    // エディタ内「公開する」・一覧の「公開/更新」の共通実体 (旧 _ppPublishPage と同じ役割分担)。
    // opts.draftFlushFailed: 公開直前の下書きリモート反映 (_artFlushRemoteNow) が失敗していた場合に
    // _artPublish から渡される。公開自体の成否とは別に、成功 toast への付記に使う (イシュー#150)。
    async _artPublishArticle(id, { draftFlushFailed = false } = {}) {
        return this._artRunExclusive(id, async () => {
            const article = this.publishArticleStore.get(id);
            if (!article) return;
            // C2: 無料プランの公開では運営(Asayake)のアフィリエイトタグが付く旨を一度だけ明示・同意取得する。
            if (!(await this._ensureFreeAffiliateConsent())) return;
            // S6 (ADR-076): 共有ハブ公開は username が無いと公開URLが確定しない (旧 siteId ベースのまま
            // 配信され続ける) ため、公開前にブロックして設定を促す。username はハブの概念なので、この
            // ゲートはハブ公開時のみ (自分の GitHub repo / ローカル書き出しには適用しない)。
            const pub = this.exporter._resolvePublishConfig();
            if (pub.target === 'hub') {
                const hub = (SyncConfigManager.load().hub) || {};
                if (!hub.username) {
                    await this._confirmOpenSettings('本棚を公開するには、まずユーザー名を設定してください（公開URLに使われます）。設定の「アカウント」で設定できます。', 'account-section');
                    return;
                }
            }
            // 公開 URL の publicId は初回公開時に1回だけ発番し以後不変 (S6・ADR-076)
            if (!article.publicId) {
                try { await this.publishArticleStore.ensurePublicId(id); }
                catch (e) { toast('公開IDの発行に失敗しました: ' + e.message, { type: 'error' }); return; }
            }
            const wasPublished = !!article.published;   // 元の状態 (更新=true / 新規公開=false)
            try { await this.publishArticleStore.update(id, { published: true }); }
            catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); return; }
            if (this._artEditingId === id) {
                this._artDraft.published = true;
                const unpub = document.getElementById('art-unpublish'); if (unpub) unpub.hidden = false;
            }
            // export→失敗時ロールバックの共通実体 (_artUnpublish/_artDelete と共通化・イシュー#374案D)
            const r = await this._artExportOrRollback(id, wasPublished);
            if (!r.ok) {
                // 失敗時は「元の状態」へ戻す (更新の取り消しで実サイトからの誤消去を防ぐ)
                if (r.rollbackFailed) {
                    toast('公開状態の復元に失敗しました。記事一覧の表示と実際の公開状態が食い違っている可能性があります。', { type: 'error' });
                }
                if (this._artEditingId === id) {
                    this._artDraft.published = wasPublished;
                    const unpub = document.getElementById('art-unpublish'); if (unpub) unpub.hidden = !wasPublished;
                }
                this._artRenderList();
                return;
            }
            // lastBuiltAt 更新は _runPublishExport → _exportToGitHub/_exportToHub 内で対象記事も含め
            // 全公開記事分まとめて1回だけ行う (イシュー#150: ここで再度 update() していたのは exporter 側
            // と同じ書き込みの二重実行=公開1回でarticles.jsonへの書込が連続することが409の発生確率を
            // 上げていたため一本化して削除。#104 の console.error は exporter.js 側に残っている)。
            const lastBuiltAtFailed = !!r.result.lastBuiltAtFailed;
            // ui-standards §2-11: 公開自体が成功した以上、付随する記録の失敗は独立したエラー toast に
            // せず、成功 toast に「何が起きたか」を付記して 1 本化する (イシュー#150。公開成功なのに
            // 「保存できませんでした」エラー toast が後から出て上書きし、公開失敗と誤認させていた再発)。
            const notes = [];
            if (draftFlushFailed) notes.push('直前の編集内容の保存に失敗しました。もう一度保存し直してください。');
            if (lastBuiltAtFailed) notes.push('公開日時の記録に失敗しました（表示には影響ありません。しばらくしてからもう一度保存すると解消します）。');
            const noteSummary = notes.length > 0 ? `\n（${notes.join(' ')}）` : '';
            const errSummary = r.result.errors.length > 0 ? `\n(注意 ${r.result.errors.length} 件)` : '';
            // この記事自身の URL を案内する (イシュー#152: siteUrl はサイトのトップで記事へ直接飛べなかった)。
            // 長文メモ読込失敗等でこの記事が生成対象から除外されていた場合は articles に含まれないため、
            // その時だけサイトのトップへフォールバックする (errSummary の注意件数で気づける)。
            const published = (r.result.articles || []).find(a => a.id === id);
            const publishUrl = published ? this._artArticleUrl(r.result.siteUrl, published.publicId) : r.result.siteUrl;
            toast(`「${article.title}」を公開しました。\n公開 URL: ${publishUrl}${errSummary}${noteSummary}`, { type: 'success' });
            this._artRenderList();
            if (this._artEditingId === id) this._artRefreshPublishBadge(); // U1: lastBuiltAt 更新を受けて「未反映の変更あり」を消す
            return publishUrl;
        });
    }

    async _artPublish() {
        if (this._artSaveTimer) await this._artFlushSave();
        if (!this._artEditingId) await this._artFlushSave();
        if (!this._artEditingId) { toast('保存に失敗したため公開できません。', { type: 'error' }); return; }
        // 公開前に保留中の下書きを確実にリモートへ反映する (イシュー#142)。silent: true にし、
        // 失敗しても独立したエラー toast は出さず _artPublishArticle の成功表示へ集約する (イシュー#150)。
        const flushResult = await this._artFlushRemoteNow({ silent: true });
        return this._artPublishArticle(this._artEditingId, { draftFlushFailed: !flushResult.ok });
    }

    _artToggleMoreMenu(force) {
        const menu = document.getElementById('art-more-menu');
        const btn = document.getElementById('art-more-btn');
        if (!menu || !btn) return;
        const open = typeof force === 'boolean' ? force : menu.hidden;
        const wasOpen = !menu.hidden;
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) this._placeAnchoredMenu(btn, menu);
        // 戻る=メニューだけ閉じる (D01)。開いた時だけ1段積み、閉じたら畳む
        if (open && !wasOpen) this._surface().open('art-more-menu', { close: (o) => this._artToggleMoreMenu(false, o), extra: { articleId: this._artEditingId } });
        else if (!open && wasOpen) this._surface().close('art-more-menu', { fromHistory: !!(arguments[1] && arguments[1].fromHistory) });
    }

    // ===== 公開パネル (イシュー#230): 公開前チェック / 公開先 / タグ / 広告 =====
    _artPublishCheck() {
        const d = this._artDraft || {};
        const blocks = d.blocks || [];
        const asins = [];
        blocks.forEach(b => {
            if (b.type === 'book' && b.asin) asins.push(b.asin);
            if (b.type === 'shelf') (b.items || []).forEach(it => it.asin && asins.push(it.asin));
        });
        const noCover = asins.filter(a => { const bk = this.books.find(x => x.asin === a); return !(bk && bk.productImage); }).length;
        const rows = [
            { key: 'title', label: 'タイトル', required: true, ok: !!String(d.title || '').trim(), ng: 'タイトルを入れてください' },
            { key: 'books', label: '本', required: true, ok: asins.length > 0, ng: '本を1冊以上置いてください', okText: `${asins.length}冊` },
            { key: 'cover', label: '書影', required: false, ok: noCover === 0, ng: `書影の無い本が${noCover}冊あります` },
            { key: 'tags', label: 'タグ', required: false, ok: (d.tags || []).length > 0, ng: 'タグを付けると見つけてもらいやすくなります' },
        ];
        return { rows, blocked: rows.some(r => r.required && !r.ok), warns: rows.filter(r => !r.required && !r.ok).length };
    }

    _artPublishContext() {
        const cfg = SyncConfigManager.load();
        const hub = cfg.hub || {};
        const target = ((cfg.publish || {}).target) === 'github' ? 'github' : 'hub';
        const settings = (this.userData && this.userData.settings) || {};
        return {
            target,
            plan: hub.plan === 'plus' ? 'plus' : 'free',
            githubLinked: !!(cfg.github && cfg.github.token),
            ownTag: String(settings.affiliateId || '').trim(),
            name: String(settings.publicDisplayName || hub.username || '').trim(),
        };
    }

    // 記事ごとの広告タグの実効値。ハブ×Free は運営タグ固定 ('operator')。Plus/GitHub は own/none で、
    // 未選択なら「自分のタグが登録済みなら own、未登録なら none」(タグ未登録で own は選べない)。
    _artEffectiveAdTag(ctx) {
        if (ctx.target === 'hub' && ctx.plan === 'free') return 'operator';
        const v = this._artDraft && this._artDraft.adTag;
        if (v === 'own' && ctx.ownTag) return 'own';
        if (v === 'none') return 'none';
        return ctx.ownTag ? 'own' : 'none';
    }

    _artRenderPublishPanel() {
        const esc = BookshelfEscape.escapeHtml;
        // U1 (イシュー#276): 公開中・updatedAt > lastBuiltAt のときだけ見出し/ボタンを更新表記にする
        const stale = this._artRefreshPublishBadge();
        const titleText = document.getElementById('art-pub-title-text');
        if (titleText) titleText.textContent = stale ? '公開中の記事を更新' : '公開';
        const goLabel = document.getElementById('art-pub-go-label');
        if (goLabel) goLabel.textContent = stale ? '更新する' : '公開する';
        const check = this._artPublishCheck();
        const det = document.getElementById('art-pub-check');
        const sum = document.getElementById('art-pub-check-sum');
        const list = document.getElementById('art-pub-check-list');
        if (det && sum && list) {
            const reqNg = check.rows.filter(r => r.required && !r.ok).length;
            sum.innerHTML = `<span class="h-icon" data-icon="${reqNg ? 'circle-alert' : 'circle-check'}" data-icon-size="15"></span>公開前チェック：${reqNg ? `公開できません（${reqNg}件）` : (check.warns ? `公開できます（確認${check.warns}件）` : '問題ありません')}`;
            det.classList.toggle('is-ng', reqNg > 0);
            // NG (必須の欠け) の時だけ自動で開く
            det.open = reqNg > 0;
            list.innerHTML = check.rows.map(r => `<li class="art-pub-check-row ${r.ok ? 'is-ok' : (r.required ? 'is-ng' : 'is-warn')}" data-check="${r.key}">
                <span class="h-icon" data-icon="${r.ok ? 'check' : (r.required ? 'x' : 'triangle-alert')}" data-icon-size="14"></span>
                <span class="art-pub-check-k">${esc(r.label)}</span>
                <span class="art-pub-check-v">${esc(r.ok ? (r.okText || 'OK') : r.ng)}</span>
                <span class="art-pub-check-rq">${r.required ? '必須' : '推奨'}</span>
            </li>`).join('');
        }
        const go = document.getElementById('art-pub-go');
        if (go) go.disabled = check.blocked;

        const ctx = this._artPublishContext();
        const tgt = document.getElementById('art-pub-target');
        if (tgt) {
            const label = ctx.target === 'github' ? '自分の GitHub' : 'Asayake ハブ';
            // イシュー#442: サイトトップ(ハブ)URLは記事カード(.pp-row-hub)から撤去し、記事ページ(公開パネル)から辿る形に統合(07項目3)
            const hubTopUrl = (ctx.target === 'hub' && this._artDraft && this._artDraft.published) ? this._artPublicBase() : '';
            tgt.innerHTML = `<p class="art-pub-line"><span>公開先：<b>${label}</b>（いつもの）</span><a href="#" class="art-pub-link" data-settings="publish-section">設定で変更</a></p>
                ${hubTopUrl ? `<p class="art-pub-note"><a href="${esc(hubTopUrl)}" target="_blank" rel="noopener" title="${esc(hubTopUrl)}" class="art-pub-link art-pub-hub-link"><span class="h-icon" data-icon="external-link" data-icon-size="12"></span>${esc(ART_PP_HUB_LINK_TEXT)}</a></p>` : ''}
                ${ctx.target === 'github' ? '<p class="art-pub-note">この公開先の記事は、ハブの索引（タグ検索・/top・マイページ）には載りません。</p>' : ''}
                ${(!ctx.githubLinked && ctx.target === 'hub') ? '<p class="art-pub-note"><a href="#" class="art-pub-link" data-settings="sync-section">GitHub に公開するには設定で連携</a></p>' : ''}
                <p class="art-pub-note">${ctx.name ? `${esc(ctx.name)} として公開します（名義は設定で変更）。` : '名義が未設定です（設定の「公開」で決められます）。'}</p>`;
        }
        const ad = document.getElementById('art-pub-ad');
        if (ad) {
            const eff = this._artEffectiveAdTag(ctx);
            let html;
            if (eff === 'operator') {
                html = `<p class="art-pub-lock"><span class="h-icon" data-icon="lock" data-icon-size="14"></span>運営のタグが付きます（Free プランでは外せません）</p>
                    <p class="art-pub-note"><a href="#" class="art-pub-link" data-settings="account-section">Plus を見る</a></p>`;
            } else {
                const radio = (v, label, disabled) => `<label class="art-pub-radio${disabled ? ' is-disabled' : ''}"><input type="radio" name="art-pub-adtag" value="${v}"${eff === v ? ' checked' : ''}${disabled ? ' disabled' : ''}><span>${label}</span></label>`;
                html = `<div class="art-pub-radios" role="radiogroup" aria-label="この記事の Amazon リンク">
                        ${radio('own', ctx.ownTag ? `自分のタグ（${esc(ctx.ownTag)}）` : '自分のタグ（未登録）', !ctx.ownTag)}
                        ${radio('none', '付けない', false)}
                    </div>
                    ${ctx.ownTag ? '' : '<p class="art-pub-note"><a href="#" class="art-pub-link" data-settings="publish-section">設定で登録</a></p>'}
                    ${ctx.target === 'github' ? '<p class="art-pub-note">自分の GitHub に公開する記事には、運営のタグは付きません。</p>' : ''}`;
            }
            html += (eff === 'none')
                ? '<p class="art-pub-note">リンクにタグが付かないため、「広告」ラベルは出ません。</p>'
                : '<p class="art-pub-note">タグ付きリンクがある時は、記事の冒頭に「広告」ラベルを自動で表示します。</p>';
            ad.innerHTML = html;
            ad.querySelectorAll('input[name="art-pub-adtag"]').forEach(r => r.addEventListener('change', () => {
                this._artDraft.adTag = r.value;
                this._artScheduleSave();
                this._artRenderPublishPanel();
            }));
        }
        document.querySelectorAll('#art-publish-modal .art-pub-link[data-settings]').forEach(a => a.addEventListener('click', (e) => {
            e.preventDefault();
            const id = a.dataset.settings;
            // イシュー#442: 公開先・発行者名・アフィリエイトは「公開の設定」モーダルへ移設済み
            if (id === 'publish-section') { this.openPublishSettingsModal(); return; }
            // パネルを閉じる処理は _openSettingsModal 側で段の引き継ぎと一緒に行う (D05)
            this._openSettingsModal(id);
        }));
        const m = document.getElementById('art-publish-modal');
        if (m && typeof window.applyIcons === 'function') window.applyIcons(m);
    }

    async _artOpenPublishPanel() {
        const m = document.getElementById('art-publish-modal');
        if (!m) return;
        const done = document.getElementById('art-pub-done'); if (done) done.hidden = true;
        this._artRenderTags();
        this._artRenderPublishPanel();
        // 重なり管理役 (イシュー#367): 中 (md)。記事エディタ (publish-pages-modal) の上に data-layer で積まれる (旧 CSS の z-index 1150 は撤去)
        this._overlays().open(m, { kind: 'modal', size: 'md', hist: false });
        this._surface().open('art-publish-modal', { close: (o) => this._artClosePublishPanel(o), extra: { articleId: this._artEditingId } });
    }

    _artClosePublishPanel({ fromHistory = false } = {}) {
        const m = document.getElementById('art-publish-modal');
        if (!m || !m.classList.contains('show')) return;
        this._overlays().close('art-publish-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('art-publish-modal', { fromHistory });
    }

    async _artPublishFromPanel() {
        const go = document.getElementById('art-pub-go');
        if (this._artPublishCheck().blocked) { this._artRenderPublishPanel(); return; }
        if (go) go.disabled = true;
        try {
            const url = await this._artPublish();
            if (url) {
                const done = document.getElementById('art-pub-done');
                const a = document.getElementById('art-pub-url');
                if (a) { a.textContent = url; a.href = url; }
                if (done) done.hidden = false;
            }
        } finally {
            this._artRenderPublishPanel();
        }
    }

    async _artCopyPublishUrl() {
        const a = document.getElementById('art-pub-url');
        const url = a ? a.textContent : '';
        if (!url) return;
        try { await navigator.clipboard.writeText(url); toast('公開URLをコピーしました。', { type: 'success' }); }
        catch (_) { toast('コピーできませんでした。URLを選んでコピーしてください。', { type: 'error' }); }
    }

    async _artPublishFromList(id) {
        await this._artPublishArticle(id);
    }

    // 記事の公開を取り消す (published=false にして再 push → 削除同期で実サイトから消える)
    async _artUnpublish(id) {
        return this._artRunExclusive(id, async () => {
            const article = this.publishArticleStore.get(id);
            if (!article) return;
            const ok = await confirmDialog({
                title: '公開を取り消す',
                message: `「${article.title}」を公開サイトから削除します。\n（他の公開中記事はそのまま残ります）`,
                okLabel: '公開を取り消す', danger: true
            });
            if (!ok) return;
            try { await this.publishArticleStore.update(id, { published: false }); }
            catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); return; }
            // export→失敗時ロールバックの共通実体 (_artPublishArticle/_artDelete と共通化・イシュー#374案D)
            const r = await this._artExportOrRollback(id, true);
            if (!r.ok) {
                if (r.rollbackFailed) {
                    toast('公開状態の復元に失敗しました。記事一覧の表示と実際の公開状態が食い違っている可能性があります。', { type: 'error' });
                }
                this._artRenderList();
                return;
            }
            if (this._artEditingId === id) {
                this._artDraft.published = false;
                const unpub = document.getElementById('art-unpublish'); if (unpub) unpub.hidden = true;
            }
            toast(`「${article.title}」の公開を取り消しました。`, { type: 'success' });
            this._artRenderList();
        });
    }

    async _artDelete(id) {
        return this._artRunExclusive(id, async () => {
            const a = this.publishArticleStore.get(id);
            // 公開中の記事の削除 (ADR-099): ハブ公開なら公開を取り消して再 push してから削除する (R2 と索引から即座に消える)。
            // 自前公開 (GitHub) は従来どおり記事だけ削除し、公開先のページは次回公開まで残る (ハブは自前公開を管理しない)。
            const wasPublished = !!(a && a.published);
            const viaHub = wasPublished && this.exporter._resolvePublishConfig().target === 'hub';
            const note = viaHub ? '\n公開中のページも公開サイトから取り下げます。'
                : (wasPublished ? '\n公開先のページは次回公開まで残ります。' : '');
            const ok = await confirmDialog({ title: '記事を削除', message: `「${a ? a.title : ''}」を削除します。${note}`, okLabel: '削除', danger: true });
            if (!ok) return false;
            if (viaHub) {
                // _artUnpublish と同じ順序: published=false にして再 push。失敗したら公開状態を戻し、記事は削除しない。
                try { await this.publishArticleStore.update(id, { published: false }); }
                catch (e) { toast('保存に失敗: ' + e.message, { type: 'error' }); return false; }
                // export→失敗時ロールバックの共通実体 (_artPublishArticle/_artUnpublish と共通化・イシュー#374案D)
                const r = await this._artExportOrRollback(id, true);
                if (!r.ok) {
                    if (r.rollbackFailed) {
                        toast('公開状態の復元に失敗しました。記事一覧の表示と実際の公開状態が食い違っている可能性があります。', { type: 'error' });
                    }
                    this._artRenderList();
                    return false;
                }
            }
            try {
                await this.publishArticleStore.remove(id);
            } catch (e) {
                toast('削除できませんでした。保存先への接続を確認してください。', { type: 'error' });
                console.error('記事の削除に失敗:', e);
                return false;
            }
            return true;
        });
    }

    async _artDuplicate(id) {
        try {
            await this.publishArticleStore.duplicate(id);
        } catch (e) {
            toast('複製できませんでした。保存先への接続を確認してください。', { type: 'error' });
            console.error('記事の複製に失敗:', e);
        }
    }

    // 一括更新: 公開中記事をまとめて再 push (公開状態は変えない・一括「公開」ではない)
    async _artRepublishAll() {
        const published = this.publishArticleStore.articles().filter(a => a.published);
        if (!published.length) { toast('公開中の記事がありません。各記事の「公開」で公開してください。', { type: 'warn' }); return; }
        // 進行表示 (ui-standards §2-5: 1秒以上かかる操作は必ず合図を出す)
        const btn = document.getElementById('art-republish-all');
        const orig = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = `<span class="h-icon" data-icon="loader" data-icon-size="13"></span>更新中…`; if (window.applyIcons) window.applyIcons(btn); }
        try {
            const r = await this._runPublishExport();
            if (!r.ok) return;
            const errSummary = r.result.errors.length > 0 ? `\n(注意 ${r.result.errors.length} 件)` : '';
            // 更新記事が1件ならその記事の URL、複数ならどれか1つに決められないためサイトのトップ
            // (全記事への入口として妥当) を案内する (イシュー#152)。
            const updatedArticles = r.result.articles || [];
            const publishUrl = updatedArticles.length === 1
                ? this._artArticleUrl(r.result.siteUrl, updatedArticles[0].publicId)
                : r.result.siteUrl;
            toast(`公開中の ${r.result.published} 記事を更新しました。\n公開 URL: ${publishUrl}${errSummary}`, { type: 'success' });
            this._artRenderList();
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; if (window.applyIcons) window.applyIcons(btn); }
        }
    }

    // ===== プレビュー (ボタン式・ステップ1の判断: PublishArticleGenerator.build() の readBookMemo IO が
    // 本の冊数に比例するため、キー入力ごとのリアルタイム反映は避ける。旧 _ppPreview/_buildPreviewState と
    // 同じパターンで、メモリ上データ (未保存の編集も含む) から state を組み IO を最小化する) =====

    // プレビュー用の state をメモリ上のデータから組む (未保存編集も反映・未接続でも動く)。
    // 旧 _buildPreviewState (公開ページ管理 UI) と同一ロジック。
    _artBuildPreviewState() {
        const ud = this.userData || {};
        const shelves = ud.bookshelves || [];
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

    async _artPreview() {
        if (!this._artDraft || !(this._artDraft.blocks || []).length) {
            toast('ブロックを1つ以上追加してください。', { type: 'warn' });
            return;
        }
        this._artHidePreviewStall();
        // イシュー#156: 起動ハンドラ発火の計測点(1)。「起動処理」のまま秒数付き表示 (_artRunPreviewBuild
        // 側の1秒ティック) に切り替わらない＝容疑者①(_artRunPreviewBuild未到達)が濃厚、と実機1回で
        // 切り分けられるようにするため、_artRunPreviewBuild側の文言とあえて区別する。
        this._artSetPreviewProgress('生成中…（起動処理）');
        this._artOpenPreviewModal();
        await this._artRunPreviewBuild();
    }

    /** ストール表示の「再試行」ボタンから呼ばれる。新しい試行として _artPreview と同じ経路を再実行する。 */
    _artRetryPreview() {
        this._artHidePreviewStall();
        this._artSetPreviewProgress('生成中…（起動処理）');
        this._artRunPreviewBuild();
    }

    /**
     * generator.build() を実行し、進捗表示＋ストール検知を伴って結果をプレビューへ反映する (イシュー#143)。
     * 世代カウンタ (_artPreviewGeneration) で「このビルドが最新の試行か」を判定し、再試行で新しい
     * ビルドが始まった後に古いビルドの結果が遅れて到着しても表示を上書きしない。
     */
    async _artRunPreviewBuild() {
        const generation = (this._artPreviewGeneration || 0) + 1;
        this._artPreviewGeneration = generation;
        const isCurrent = () => this._artPreviewGeneration === generation;

        // イシュー#156: 段階トレース(世代単位)。ストール発火時に「最後に通過した段階名＋その段階に
        // 入ってからの経過ms」を画面へ必ず出すための記録。console.warnにも全trace配列を出す
        // (#153の「console.warnに段階名+経過msを残す」作法を踏襲・devtoolsを開かせない設計は画面表示側)。
        const trace = [];
        this._artPreviewTrace = trace;

        const tempArticle = { ...this._artDraft, id: this._artDraft.id || '_preview', slug: 'preview', publicId: 'preview' };
        const startedAt = Date.now();
        // (2) _artRunPreviewBuild 冒頭到達の計測点。容疑者①(未到達)は、この行に来ない限り
        // lastProgress/trace が更新されず、_artPreview側の「生成中…（起動処理）」表示のまま
        // 1秒ティックの秒数表示にも切り替わらないことで実機から判別できる。
        let lastProgress = { stage: 'build-entered' };
        let stageEnteredAt = startedAt;
        let stalled = false;
        let stallTimer = null;
        const stallMs = this._artPreviewStallMs || ART_PREVIEW_STALL_MS;
        const hardDeadlineMs = this._artPreviewHardDeadlineMs || ART_PREVIEW_HARD_DEADLINE_MS;

        // イシュー#163: timer-lag/timer-lag-summary は上の pushTrace(onProgress経路)を通さず、
        // trace への直接追記だけを行う専用経路にする。pushTrace は stageEnteredAt/lastProgress を
        // 更新し画面の段階表示(「この段階N秒」)に使われる副作用を持つため、タイマー凍結から復帰した
        // 瞬間に溜まった通知が一括発火すると、まさに診断したい場面で段階経過秒がリセットされ・
        // lastProgress が上書きされて段階表示が巻き戻る事故になる(実測前に静的解析で発見・②指摘)。
        // build完了後に遅延発火する通知もありうるが、その場合もここは trace への追記のみ＝
        // 画面文言・stall判定には一切影響しない。
        const pushTimerLagTrace = (info) => {
            trace.push({ ts: Date.now(), ...info });
            if (info.phase !== 'timer-lag-summary') return;
            const warnMs = this._artTimerLagWarnMs || ART_TIMER_LAG_WARN_MS;
            if (info.pending > 0 || info.maxLagMs >= warnMs) {
                console.warn(`[記事プレビュー] タイマー遅延を検知しました(生成自体は完了・診断用の記録): 発行${info.yields}件中${info.overCount}件が閾値超過・最大遅延${info.maxLagMs}ms・build完了時点で未発火${info.pending}件`, info);
            }
        };

        const pushTrace = (progress) => {
            stageEnteredAt = Date.now();
            trace.push({ ts: stageEnteredAt, ...progress });
        };
        pushTrace(lastProgress);

        const renderGenerating = () => {
            const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            const stageElapsedSec = Math.max(0, Math.round((Date.now() - stageEnteredAt) / 1000));
            const progressText = ART_PREVIEW_STAGE_LABEL(lastProgress);
            this._artSetPreviewProgress(`生成中…（${progressText}この段階${stageElapsedSec}秒・全体${elapsed}秒経過）`);
        };
        const tickTimer = setInterval(() => {
            if (!isCurrent()) { clearInterval(tickTimer); return; }
            if (!stalled) renderGenerating();
        }, 1000);
        const triggerStall = () => {
            if (!isCurrent() || stalled) return;
            stalled = true;
            const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            const stageElapsedMs = Date.now() - stageEnteredAt;
            this._artShowPreviewStall(lastProgress, elapsed, stageElapsedMs, trace);
        };
        // 個々の読込/変換ステップが返るたびにリセットされる検知 (連続する読込の谷間が長い場合に早期発見)。
        const scheduleStall = () => { clearTimeout(stallTimer); stallTimer = setTimeout(triggerStall, stallMs); };
        scheduleStall();
        // イシュー#160: tickTimer(setInterval)・stallTimer/hardDeadlineTimer(setTimeout)は、いずれも
        // メインスレッドが同期占有されている間はコールバック自体が発火しない(#153/#156の構造そのもの)。
        // onProgressは各同期ブロックの境界(reading/rendering各ステップ)で必ず呼ばれるため、そのたびに
        // (1)tickTimerの1秒待ちに依存せず画面文言を即時更新し、(2)hardDeadlineを既に過ぎていればタイマーの
        // 発火を待たずその場でstallを起こす、という自己回復を行う。「占有中はタイマーが発火しない」構造を
        // 前提に、次にJSが動く瞬間(=onProgress呼び出し時)を検知の代替トリガーにする設計。
        const onProgressTick = () => {
            if (!isCurrent()) return;
            if (stalled) return;
            if (Date.now() - startedAt >= hardDeadlineMs) { triggerStall(); return; }
            renderGenerating();
        };
        // ビルド開始からの絶対経過時間で発火する上限 (onProgressが何度呼ばれても消えない)。
        // イシュー#153: onProgressのたびにscheduleStallをリセットするだけでは、個々のステップが
        // stallMs未満で返り続ける限りビルド全体が何分かかっても検知されない欠陥があったため、
        // 個別リセット式のscheduleStallとは独立に、開始時刻を基準とする固定タイマーを併設する。
        // stallMsと同じ値にすると「遅いだけの正常系を誤検知しない」という個別検知の設計意図と
        // 矛盾する(実測に基づきstallMsの5倍=100秒を既定にした、ART_PREVIEW_HARD_DEADLINE_MS参照)。
        const hardDeadlineTimer = setTimeout(triggerStall, hardDeadlineMs);

        const finish = () => { clearTimeout(stallTimer); clearTimeout(hardDeadlineTimer); clearInterval(tickTimer); };

        try {
            const result = await this.publishArticleGenerator.build([tempArticle], {
                state: this._artBuildPreviewState(),
                onProgress: (p) => { lastProgress = p; pushTrace(p); if (isCurrent() && !stalled) scheduleStall(); onProgressTick(); },
                onTimerLag: pushTimerLagTrace
            });
            finish();
            if (!isCurrent()) return; // 再試行で新しい世代が始まっている＝この結果は古い
            this._artHidePreviewStall();
            this._artHidePreviewProgress();
            const file = result.files.find(f => f.path === 'preview/index.html');
            if (file) {
                this._artSetPreview(file.content);
                pushTrace({ stage: 'dom' }); // (6) DOM反映完了の計測点
                // 長文メモの読み込みに失敗があっても生成は続行する (haltOnReadFailure を渡していない)。
                // 公開HTMLの中身は変えず、アプリ側の通知だけで気づけるようにする (イシュー#134)。
                if (result.articles[0] && result.articles[0].memoReadFailed) {
                    toast('一部の長文メモを読み込めませんでした（通信が不安定な可能性があります）。プレビューにはその本のメモが空欄で表示されています。', { type: 'warn' });
                }
                // 強調記号の解析が上限を超えた場合、一部が装飾なしで表示される (イシュー#153)。
                // console.warnだけでは本人が気づけないため、memoReadFailedと同じ作法でtoastも出す
                // (公開HTMLの中身は変えず通知だけ)。
                if (result.articles[0] && result.articles[0].markdownDegraded) {
                    toast('長文の一部で強調・コード記号が特殊なパターンだったため、装飾なしで表示されています。内容は失われていません。', { type: 'warn' });
                }
            } else {
                // ui-standards §2-11: 何が起きたか (errors 全件、無ければその事実自体) ＋ 次の一手を必ず出す。
                // result.errors[0] || '' で理由が空欄のまま出ていた設計が原因究明を遅らせた反省 (イシュー#152)。
                const reason = result.errors.length > 0
                    ? result.errors.map(e => BookshelfEscape.escapeHtml(e)).join('<br>')
                    : '生成結果にプレビュー用のページが含まれていませんでした（原因不明）。';
                this._artHidePreviewProgress();
                this._artSetPreview(`<p style="padding:1rem;font-family:sans-serif;color:#a33">プレビューを生成できませんでした。<br>${reason}<br>もう一度プレビューを開き直してください。改善しない場合は通信環境をご確認ください。</p>`);
            }
        } catch (e) {
            finish();
            if (!isCurrent()) return;
            this._artHidePreviewStall();
            this._artHidePreviewProgress();
            this._artSetPreview(`<p style="padding:1rem;font-family:sans-serif;color:#a33">プレビューに失敗しました。<br>${BookshelfEscape.escapeHtml(e.message)}<br>もう一度プレビューを開き直してください。改善しない場合は通信環境をご確認ください。</p>`);
        }
    }

    /**
     * ストール検知の発火時表示 (ui-standards §2-11: 何が起きたか＋次にどうすればよいか)。
     * イシュー#156: 「最後に通過した段階名＋その段階に入ってからの経過ms」を画面メッセージに必ず出す
     * (console だけに出す設計にしない＝devtools を開かせずに実機1回で読める形にするのが本計装の核)。
     * stageElapsedMs/trace は省略可 (既定 undefined/[]) — 呼び出し元を増やさず既存動作も壊さない。
     */
    _artShowPreviewStall(lastProgress, elapsedSec, stageElapsedMs, trace) {
        // イシュー#153/#156: 段階名 (reading/rendering/assembling 等) と経過ms・全trace配列を
        // console にも必ず残す。本人が実機で1回試すだけで「どの段階で何ms掛かったか」を後から拾える最後の砦。
        console.warn(`[記事プレビュー] 生成が停止しています。最終段階=${lastProgress.stage || '不明'} 全体経過=${elapsedSec}秒 この段階の経過=${stageElapsedMs ?? '不明'}ms`, { lastProgress, trace });
        this._artHidePreviewProgress();
        const el = document.getElementById('pp-preview-stall');
        const msgEl = document.getElementById('pp-preview-stall-msg');
        if (!el || !msgEl) return;
        const stageText = ART_PREVIEW_STAGE_LABEL(lastProgress);
        const stageLabel = stageText ? stageText.replace(/・$/, '') : (lastProgress && lastProgress.stage) || '不明';
        const progressText = stageElapsedMs != null
            ? `（最後に通過した段階「${stageLabel}」に入ってから${stageElapsedMs}ms経過）`
            : (stageText ? `（最後の進捗: ${stageLabel}）` : '');
        msgEl.textContent = `プレビューの生成が止まっているようです（全体${elapsedSec}秒経過${progressText}）。\n通信が不安定な可能性があります。`;
        el.hidden = false;
    }

    _artHidePreviewStall() {
        const el = document.getElementById('pp-preview-stall');
        if (el) el.hidden = true;
    }

    _artSetPreview(html) {
        const old = document.getElementById('pp-preview-frame');
        if (!old) return;
        // WebKit は同じ iframe への srcdoc 再代入をセッション履歴に積み、スマホの「戻る」が iframe 側で消費されて
        // プレビューが閉じなかった (イシュー#284 A30)。キャンバスと同じく新しい要素へ差し替える
        const frame = old.cloneNode(false);
        frame.removeAttribute('srcdoc');
        frame.srcdoc = html || '<p style="padding:1rem;color:#5b6270;font-family:sans-serif">「プレビュー」を押すと表示されます</p>';
        old.replaceWith(frame);
    }

    // イシュー#161: #160でブロック境界ごとに進捗表示を更新するようにしたため、進捗のたびに
    // frame.srcdoc(iframe再パースを伴う)へ代入する回数が実測で5倍(2回→10回)に増えていた
    // (②見立て4)。進捗の「文言更新」は親DOM(#pp-preview-progress)への同期textContent書き換えに
    // 変え、iframeの破棄・再生成は generator の最終結果反映(_artSetPreview)時の1回だけに戻す。
    _artSetPreviewProgress(text) {
        const el = document.getElementById('pp-preview-progress');
        const msgEl = document.getElementById('pp-preview-progress-msg');
        if (!el || !msgEl) return;
        msgEl.textContent = text;
        el.hidden = false;
    }

    _artHidePreviewProgress() {
        const el = document.getElementById('pp-preview-progress');
        if (el) el.hidden = true;
    }

    _artOpenPreviewModal() {
        const m = document.getElementById('pp-preview-modal');
        if (!m) return;
        const btn = document.getElementById('pp-preview-device');
        const stage = m.querySelector('.pp-preview-stage');
        if (btn) { btn.dataset.mode = 'desktop'; btn.innerHTML = '<span class="h-icon" data-icon="smartphone" data-icon-size="14"></span>モバイル幅'; }
        if (stage) stage.classList.remove('pp-stage-mobile');
        // 重なり管理役 (イシュー#367): 全画面 (full)。公開パネル/記事エディタの上に data-layer で積まれる (旧 CSS の z-index 1200 は撤去)
        this._overlays().open(m, { kind: 'modal', size: 'full', hist: false, sizeTarget: '.pp-preview-dialog' });
        if (typeof window.applyIcons === 'function') window.applyIcons(m);
        this._surface().open('pp-preview-modal', { close: (o) => this._artClosePreviewModal(o), extra: { articleId: this._artEditingId } });
    }
    _artClosePreviewModal({ fromHistory = false } = {}) {
        this._overlays().close('pp-preview-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('pp-preview-modal', { fromHistory });
        // 進行中のビルド (進捗表示/ストール検知タイマー) を無効化する。build() 自体は裏で続いてよいが、
        // 結果が来ても閉じた後のプレビューへは反映しない (イシュー#143)。
        this._artPreviewGeneration = (this._artPreviewGeneration || 0) + 1;
    }
    _artTogglePreviewDevice() {
        const btn = document.getElementById('pp-preview-device');
        const stage = document.querySelector('#pp-preview-modal .pp-preview-stage');
        if (!btn || !stage) return;
        const toMobile = btn.dataset.mode === 'desktop';
        btn.dataset.mode = toMobile ? 'mobile' : 'desktop';
        stage.classList.toggle('pp-stage-mobile', toMobile);
        btn.innerHTML = toMobile
            ? '<span class="h-icon" data-icon="monitor" data-icon-size="14"></span>PC 幅'
            : '<span class="h-icon" data-icon="smartphone" data-icon-size="14"></span>モバイル幅';
        if (typeof window.applyIcons === 'function') window.applyIcons(btn);
    }

    // ===== U7の移し残し(イシュー#291「進む」で記事側の面を開き直す10メソッド)をU8fでここへ移動 =====
    // イシュー#547 (U8f・②指示): U7(#525)の_art*138メソッド移動の対象に入っていなかった
    // _reopenArt*クラスタ(「進む」での記事エディタ面の開き直し)を、U8を移し残しなしで閉じるために
    // ここへ追加した(移動のみ・本文は1行も書き換えていない・既存のメソッドは1つも変更していない)。
    // 呼び出し元(bookshelf.js側の_navReopen。this.xxxのまま無変更)はdocs/char/u8f-step1-scope.md §2参照。

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
}

const _artEditorDescriptors = Object.getOwnPropertyDescriptors(_ArticleEditorMethods.prototype);
delete _artEditorDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _artEditorDescriptors);
