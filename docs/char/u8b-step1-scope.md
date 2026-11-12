# U8b step1: 棚卸しと移し方の決定（イシュー#542）

対象: 本の詳細画面（右ペイン・モバイルの本モーダル）を `js/bookshelf.js` から `js/screens/book-detail.js` へ移す。
計測は origin/main（**199ce88**・U8a完了済み・`js/screens/settings.js` が既にある版）で実施。worktreeは起票時点でこのコミットと一致（未コミット差分なし）。`js/bookshelf.js` は **9155行**（移す前）。
移し方はU7（#525・article-editor.js）・U8a（#537・settings.js）と同じ **Plan A**（匿名class の prototype 記述子を `VirtualBookshelf.prototype` へ合成・本文無変更）。

## 0. 移動前スナップショット（機械的検証の基準値）

U8aと同じ方式（`docs/char/u8a-step1-scope.md` §末尾）：`python`簡易サーバでPORT 8142配信→Playwright(MCP)で`index.html`を開き、`window.bookshelf.constructor`の`Object.getOwnPropertyNames`を静的側・prototype側それぞれ取得。結果は `docs/char/u8b-baseline-members.json` に保存済み。

- static側：**9件**（`HEADER_ICON_OVERRIDES_KEY` `HEADER_ITEMS_META` `HEADER_LAYOUT_STORAGE_KEY` `PLUGIN_CONTRIB_CACHE_KEY` `PLUGIN_ORDER_STORAGE_KEY` `PLUGIN_SEARCH_DESC_LIMIT` `PLUGIN_SEARCH_NAME_LIMIT` `SETTINGS_CATEGORIES` `usageAlertLevel`）＝全部5114〜5385行の設定領域内で、今回の移動範囲の外（§6でも再確認）。
- prototype側：**527件**（getter `_modalHistStack` 1件を含む。6982行、今回の移動範囲の外）。
- 起動時のconsoleエラー：**1件**（`ERR_CONNECTION_REFUSED @ pagead2.googlesyndication.com`＝サンドボックス環境のネットワーク遮断による既定ノイズで、本変更と無関係）。pageerrorは0件。
- step2で移動した後、同じ手順で static=9・proto=527（名前集合も完全一致）・console既定ノイズ1件のままであることを確認する。

## 1. 移す対象（責務で判定・行番号は現状=移す前）

判定基準はU7/U8aと同じ：名前の接頭辞ではなく責務で決める。「画面の描画とハンドラ」かどうかで判定し、データ・ドメインの読み書き本体（§2参照）は移さない。実測の結果、**15メソッド**を移す。

### A. 開く・閉じる・ナビゲーション（5件）
`showBookDetail`(2722) `closeModal`(3055) `_exitBookDetail`(5774) `_closeBookModalDom`(5783) `_currentBookshelfInternalId`(2711)

- `showBookDetail`：本の詳細の本体（右ペインへの描画・短文メモ/評価/長文メモ入口/所属本棚chips/基本情報の構築・各ハンドラのbind・プラグイン本詳細セクション呼び出し）。
- `closeModal`：×/ルーティング連携で本詳細を閉じる（`_closeBookModalDom`呼び出し＋nav/router都合の戻し先決定）。純粋に画面のナビゲーション。
- `_exitBookDetail`：×/Esc/スマホ戻るの共通の閉じ手（#511 X1 P11）。
- `_closeBookModalDom`：本詳細ペインのDOMをplaceholderへ戻す。
- `_currentBookshelfInternalId`：showBookDetail内でのみ呼ばれる（2735/2738/2757行）。「いま開いている本棚コンテキスト」の算出で、本詳細の文脈判定専用。plugin-api.js:283-284も参照（§4）。

### B. セクション順序の並び替え（本詳細専用の設定値・3件）
`_getDetailSectionOrder`(2666) `_saveDetailSectionOrder`(2676) `_bindDetailSectionReorder`(2685)

実測（grep）：3つとも呼び出し元は showBookDetail(2893/2951) と自分自身（_bindDetailSectionReorderのonDropが_saveDetailSectionOrderを呼ぶ、2706）だけ＝本棚一覧側の`_getStarVisibility`等（§2参照・一覧とも共用）とは違い、**本詳細専用**の設定値。settingsへの書き込みはあるが、読み書き先も用途も本詳細の並び替えUIに閉じているため、画面側として移す（②判断を仰ぐ点）。

### C. 短文メモの自動保存ハンドラ（1件）
`_scheduleNoteAutoSave`(3121)

実測：呼び出し元はshowBookDetail内(2957)のみ。中身はdebounce+`.save-note-status`のUI表示更新で、実際の書き込みは`saveNote`(§2・共用のため残す)に委譲する。U7の記事エディタ側の対になる処理（`js/screens/article-editor.js:1935`、textarea inputのdebounce→`this.saveNote()`呼び出し）が既にarticle-editor.js側に置かれている前例に合わせ、画面側のハンドラとして移す。

### D. 長文メモ（アプリ内エディタ）の開閉（本詳細からしか開かない・6件）
`_bookMemoFsSubText`(6781) `_openBookMemoInAppEditor`(6788) `_bookMemoFsDone`(6862) `_bookMemoFsCancel`(6886) `_bookMemoFsClose`(6902) `_reopenBookMemo`(7101)

**②確認事項への回答（実測）**：この6件を開く経路は `showBookDetail`内の`.memo-file-btn`ハンドラ(3006-3009)→`openOrCreateBookMemo`(§2・bookshelf.js残留)→`_openBookMemoInAppEditor` の1本だけで、呼び出し元は`js/bookshelf.js`自身（起動時バインド＝setupEventListeners内のdone/cancelボタン配線、`_navReopen`のリロード復元マップ）とE2Eテスト直呼びのみ。記事エディタ・一覧からは開かれない（grep実測・他ファイル参照なし）＝「本の詳細からしか開かない」に該当するため、**book-detail.js に入れる**。
U7の対の実装（記事の文章ブロック全画面＝`_artCloseBlockFs`、article-editor.js:1182）も、保存(`_artScheduleSave`)を呼ぶ画面側の完了/キャンセル/クローズ処理として既にarticle-editor.js側にある。この6件もその前例と同型（DOM操作＋保存呼び出しのオーケストレーションは画面側、実際の保存I/Oは共有ヘルパー側）。

**`openOrCreateBookMemo`自体は移さない**（§2参照）。this.経由で呼ぶため、どちらのファイルに置いても呼び方は変わらない（Plan A）。

### 合計：15メソッド（約600行、行数の確定値はstep2のdiff報告で出す）

## 2. 移さない（bookshelf.jsに残す・理由つき）

| 区分 | 対象 | 理由（実測） |
|---|---|---|
| 短文メモ・評価の読み書き本体 | `saveNote`(3110) `_toggleAllNoteFlag`(3093) `saveRating`(8985) | `userData.notes`への直接書き込み＝ノートの読み書き本体。`saveNote`は`js/screens/article-editor.js:1935`からも呼ばれる共用の書き込み窓口（本の詳細専用ではない）。`_toggleAllNoteFlag`は呼び出し元がshowBookDetail内のみだが、書き込み内容自体が「notesの読み書き本体」そのものであり、②指示の「データやドメインのロジックは移さない」に直接該当 |
| 評価ウィジェットの共有部品 | `generateStarRating`(8920) `_starWidgetHtml`(8963) `_applyRatingEverywhere`(8970) | コメントに明記：「一覧カード・本詳細で共用」(8961/8967)。showBookDetailから呼ぶが定義自体は一覧カード(createBookElement)とも共有 |
| 表示設定のgetter/setter | `_getStarVisibility`(8936) `_getStarOverlay`(8942) `_getMemoVisibility`(8948) `_setDisplaySetting`(8953) | 一覧カードの表示制御と共用（499計画書・既存決定どおり）。showBookDetailは`_getStarOverlay`だけ使うが、定義自体は一覧側にも読まれる |
| 重複ASIN判定 | `_dupAsinInfo`(2368) | showBookDetailと一覧側(`_bookCardKey`2088・`createBookElement`2406)の両方から呼ばれる共有部品 |
| 長文メモの入口の本体 (openOrCreateBookMemo) | `openOrCreateBookMemo`(6481) | 3方式分岐（アプリ内エディタ/Obsidian/システム）のうちアプリ内エディタ以外の2方式は、メモファイルの直接書き込み・clipboard書き込み・obsidian://リンク生成という**ドメイン/ファイルI/O処理そのもの**で画面描画を伴わない。U7(article-editor.js:11-23のコメント)でも「記事専用ではない＝共通部品」として一旦bookshelf.js残留に分類され、最終判断をU8へ委ねられていた項目。今回実測した上で、画面系(D)とは異質な分岐の多さを理由に残留と判断（②確認事項） |
| 長文メモの共通エディタ部品 | `_openMdEditor`(6574) `_mdeToolbarConfig`(6596) `_mdeApplyToolbarLabels`(6608) `_mdeToggleHeadingMenu`(6644) `_mdeCloseHeadingMenu`(6678) `_mdeCurrentHeadingLevel`(6686) `_mdeApplyHeadingLevel`(6698) `_mdeDestroyEditor`(6719) `_ensureEasyMDELoaded`(6727) `_mountFsHeader`(6756) | U7で既に「記事専用ではない・本の長文メモでも使う共有部品」として確定済み（article-editor.js:16-23）。今回の実測でも、`_mountFsHeader`は`#art-fs-hd`という文章ブロック/本棚/本の全画面で共有する静的DOM型の動的生成版（6748-6755のコメント）で、`_openMdEditor`は記事の文章ブロック全画面(article-editor.js:1164)からも呼ばれる＝2画面以上で共用。変更なし |
| 一覧カードのメモ表示 | `updateMemoPreview`(7726) `convertMarkdownLinksToHtml`(7741) `formatMemoForDisplay`(7748) | 呼び出し元は一覧カード側`createBookElement`(2404)。本詳細では使っていない（`updateMemoPreview`は現在どこからも呼ばれていない旧コードの可能性があるが、挙動を変えないため判定だけ記録し動かさない）。本詳細の範囲外 |
| ナビゲーション・重なり管理の共通基盤 | `setupEventListeners`(556) `_isHistMobile`(6927) `_navMobile`(6936) `_formSnapOf/_formSnapTake/_formBackGuard`(6957/6965/6970) `_navReopen`(6985) `_navOnLanded`(7021) `_overlays`(7034) `_modalHistPush`(7048) `_defineSurfaces`(7053) `_surface`(7087) `_modalHistPop`(7096) `_applyRoute`(5636) `_savePaneState`(4791) | 全画面共通のnav/overlay/Surfaceディスパッチ層。`_navReopen`のマップに`'book-memo-modal': () => this._reopenBookMemo(st.asin)`のように移動後の名前を呼ぶ行があるが、Plan Aでは`this.`経由なのでファイルを移しても無変更で動く（U7/U8aと同じ理由） |
| 本棚・本の削除/除外/追加などドメイン操作 | `addBookToBookshelf`(6106) `removeFromBookshelf`(6223) `deleteBook`(7258) `excludeBook`(6306) | BookshelfManager/BookManager相当のドメイン操作。showBookDetailのボタンから呼ばれるが定義は別領域で、他画面(本棚一覧等)からも呼ばれる |

## 3. 画面をまたぐ this.*（Plan Aで無変更に動くことの確認・実測）

移す15メソッドの中からbookshelf.js側に残るものを呼ぶ this.*：

- `this.nav` / `this.router` / `this._suppressRouterUpdate` / `this._navMobile()` / `this._navigateFromUi()` / `this._closeOverlayFacesSilently()` / `this._savePaneState()` / `this._overlays()` / `this._surface()` — nav/overlay基盤（§2表の最終行）
- `this.userData`（notes/bookshelves/settings/hiddenBooks）・`this.bookshelfManager`（resolveMemo/resolveRating/getById/getBySlug/setMemo）・`this.bookManager`（getAmazonUrl/isKindleBook/getKindleReadUrl/hasCoverImage/getProductImageUrl）・`this.storage`（readBookMemo/writeBookMemo・_openBookMemoInAppEditor/_bookMemoFsDone内）
- `this._dupAsinInfo()` / `this._getStarOverlay()` / `this._starWidgetHtml()` / `this.generateStarRating()`（_starWidgetHtml経由）/ `this.saveRating()` / `this._applyRatingEverywhere()` / `this.saveNote()` / `this._toggleAllNoteFlag()`
- `this.addBookToBookshelf()` / `this.removeFromBookshelf()` / `this.deleteBook()` / `this.excludeBook()` / `this.openOrCreateBookMemo()`
- `this.saveUserData()` / `this.pluginAPI`（`_runDetailSections`・`_emit`）
- `this._ensureEasyMDELoaded()` / `this._openMdEditor()` / `this._mdeDestroyEditor()`（_openBookMemoInAppEditor内）

逆に、**bookshelf.js側に残るコードが、移した側が持つ状態を読む**箇所（実測・要注意点）：

- `this._lastDetailBook` / `this._lastDetailEditMode`：`showBookDetail`内(2753-2754)で設定される状態だが、`setupEventListeners`内(993-994・表示設定変更時の再描画)と`_applyRoute`内(5687・編集モード保持判定)の2箇所から読まれる。Plan Aでは状態はインスタンス(`this`)に乗るため、定義ファイルが変わっても影響しない
- `app._modalHistStack`（`_modalHistStack`はgetter・bookshelf.js残留）・`app[name]`形式の monkey patch：`js/nav-state.js`が`wrap(app, 'showBookDetail', ...)`と`wrap(app, '_closeBookModalDom', ...)`で起動時にインスタンスの同名プロパティを読み→ラップして上書きする(nav-state.js:120-128の`wrap`実装を確認済み)。`obj[name]`は prototype チェーンをたどる通常のプロパティアクセスなので、showBookDetail/_closeBookModalDomの定義ファイルが変わっても影響しない（実測で確認済み）

## 4. 画面外から直接触っている箇所（plugin-api.js・nav-state.js）

| 箇所 | 内容 |
|---|---|
| `js/plugin-api.js:389` | `this._app.showBookDetail(b)`（プラグインAPIの「本を開く」コマンド） |
| `js/plugin-api.js:283-284` | `this._app._currentBookshelfInternalId()`（いま開いている本棚のinternalId取得） |
| `js/plugin-api.js:596/612` | コメントのみ（「showBookDetailのたびに呼ばれる」の説明）。コード参照は上記389と、showBookDetail本体内の`this.pluginAPI._runDetailSections(...)`呼び出し（移動後も本体に含まれて一緒に動く） |
| `js/nav-state.js:209-210` | `wrap(app, 'showBookDetail', ...)` / `wrap(app, '_closeBookModalDom', ...)`（§3末尾で安全性確認済み） |

**Plan Aであれば、これらは一切変更不要**：上の名前がどのファイルで定義されていても、`VirtualBookshelf.prototype`上に乗る限り同じ関数を指す。

## 5. テストが直接触っている名前（委譲の対象）・bookshelf._総数の基準値

grep実測（移す15件のうち、tests/配下から直接呼ばれているもの）：

| 名前 | ファイル数 | 箇所数 |
|---|---|---|
| `showBookDetail` | 3 | 7 |
| `_openBookMemoInAppEditor` | 5 | 9 |

他13件（closeModal/_exitBookDetail/_closeBookModalDom/_getDetailSectionOrder/_saveDetailSectionOrder/_bindDetailSectionReorder/_currentBookshelfInternalId/_scheduleNoteAutoSave/_bookMemoFsDone/_bookMemoFsCancel/_bookMemoFsClose/_bookMemoFsSubText/_reopenBookMemo）はtests/からの直接呼び出し0件（UI操作経由のみ）。

plugin-api.jsからの直接参照（§4）：`showBookDetail`(1箇所)・`_currentBookshelfInternalId`(2箇所)。

**「委譲」の数（②承認済みの解釈＝U8aと同じ）**：Plan Aでは委譲ラッパーを新規に書かない。「テスト・プラグインが直接触れていて、移動後も同じ名前で動くことを確認した対象」の数＝**3種（showBookDetail・_openBookMemoInAppEditor・_currentBookshelfInternalId、計19箇所）**。

**tests/配下の`bookshelf._`参照の総数（基準値・全体、U8a時点320件から今回実測で355件に増加＝#513〜#539の新規E2Eスイート追加分）**＝**355件**（文字列`bookshelf._`の出現数、`grep -ron "bookshelf\._[A-Za-z]"`）。この計測・移動作業はテストファイルを一切編集しないため、step3の再計測でも355件（またはそれ以下）であることを確認する。

## 6. 範囲内のstatic/getter/setter/クラスフィールドの grep 全数検査（#537の落とし穴対応）

移す15メソッドの行範囲（2666-2721, 2722-3139, 5774-5801, 6781-6926, 7101-7109）それぞれに対し、`^    (static |get |set )`と`^    [A-Za-z_][A-Za-z0-9_]*\s*=\s*[^(]`（bare class field）の正規表現で機械的に検査：**全範囲でヒット0件**。static群(9件・5114-5385行)とgetter`_modalHistStack`(6982行)は、いずれも移動範囲の外側にあることを確認済み（§0のベーススナップショットとも整合）。

## 7. ②への確認事項（tp）

1. §1-Bのセクション順序並び替え3件（`_getDetailSectionOrder`/`_saveDetailSectionOrder`/`_bindDetailSectionReorder`）を画面側として移す判断でよいか。
2. §1-Cの`_scheduleNoteAutoSave`（画面側のdebounceハンドラ、実際の保存は共用の`saveNote`に委譲）を画面側として移す判断でよいか。
3. §1-Dの長文メモ開閉6件を book-detail.js に入れる判断（実測で「本の詳細からしか開かない」に該当）でよいか。
4. §2で`openOrCreateBookMemo`自体はbookshelf.js残留とした判断（3分岐のうち2つがファイルI/O・ドメイン処理で画面描画を伴わないため）でよいか。

承認後、step2でPlan Aの移動を実施する。
