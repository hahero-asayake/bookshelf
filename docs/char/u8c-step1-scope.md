# U8c step1: 棚卸しと移し方の決定（イシュー#543）

対象: 取込画面（Kindle 等の取込モーダル・取込の手順画面・取込結果の表示）を `js/bookshelf.js` から `js/screens/import.js` へ移す。
計測は worktree `issue-543`（**HEAD f3ae2d3**・U8b完了済み・`js/screens/book-detail.js` が既にある版。未コミット差分なし）で実施。`js/bookshelf.js` は **8547行**（移す前）。
移し方はU7（#525・article-editor.js）・U8a（#537・settings.js）・U8b（#542・book-detail.js）と同じ **Plan A**（匿名class の prototype 記述子を `VirtualBookshelf.prototype` へ合成・本文無変更）。

## 0. 移動前スナップショット（機械的検証の基準値）

U8a/U8bと同じ方式：`python3 -m http.server 8143`で配信→Playwright(MCP)で`index.html`を開き、`window.bookshelf.constructor`の`Object.getOwnPropertyNames`を静的側・prototype側それぞれ取得（組み込みの`length`/`name`/`prototype`(static側)と`constructor`(prototype側)は除外・u8bと同じ数え方）。結果は `docs/char/u8c-baseline-members.json` に保存済み。

- static側：**9件**（U8bと完全一致。全部5114〜5385行付近の設定領域内で、今回の移動範囲の外）。
- prototype側：**527件**（U8bの移動後と完全一致。getter `_modalHistStack` 1件を含む。今回の移動範囲の外）。
- 起動時のconsoleエラー：**1件**（`ERR_CONNECTION_REFUSED @ pagead2.googlesyndication.com`＝サンドボックス環境のネットワーク遮断による既定ノイズで、本変更と無関係）。pageerrorは0件。
- テストの`bookshelf._`参照数：**355件**（②指摘で数え方を統一・詳細は§5末尾参照。u8b-step1-scope.md §5と同じ対象範囲=`tests/e2e/` + `tests/visual/`に揃えると355件で、完了条件の基準値と一致する。step1時点の報告366件は対象範囲に`tests/perf/*.mjs`(プロファイリング用スクリプト・spec/testファイルではない)を誤って含めていたことが原因＝実測で確認済み、参照数自体は増えていなかった）。
- step2で移動した後、同じ手順（`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l`）で static=9・proto=527（名前集合も完全一致）・console既定ノイズ1件・`bookshelf._`参照355件以下のままであることを確認する。

## 1. 移す対象（責務で判定・行番号は現状=移す前）

判定基準はU7/U8a/U8bと同じ：名前の接頭辞ではなく責務で決める。「画面の描画とハンドラ」かどうかで判定し、データ・ドメインの読み書き本体（§2参照）は移さない。終了行は括弧対応（文字列・テンプレートリテラル・コメントを除外する状態機械）で機械的に特定した（#542の作法）。実測の結果、**26メソッド**を移す。

### A. 取込モーダルの開閉・端末判定・レーン表示（6件）
`showImportModal`(7170-7190) `closeImportModal`(7196-7205) `_detectImportDevice`(7208-7213) `_importSetupFlags`(7216-7218) `_renderImportLanes`(7225-7273) `_cancelKindleImportWait`(7279-7287)

- `showImportModal`：取込モーダルを開く本体（状態リセット・レーン再描画・`_overlays().open`/`_surface().open`）。
- `closeImportModal`：取込モーダルを閉じる（結果表示リセット・`_overlays().close`/`_surface().close`）。
- `_detectImportDevice`：UAからPC/iOS/Androidを判定するだけの純粋関数（取込レーン表示専用）。
- `_importSetupFlags`：レーン別初回準備フラグをlocalStorageから読むだけ（取込モーダルの表示分岐専用、userData同期には載らない端末固有値）。
- `_renderImportLanes`：取込モーダルの端末タブ・レーン・準備状態・GIFスロットの表示を一括反映するDOM描画。
- `_cancelKindleImportWait`：「受信待ちを中止」ボタンのハンドラ（`_kindleImportCleanup`/`_stopKindleRelayPoll`呼び出し＋toast）。

### B. 本選択UI（取込モーダル内「取り込む本を選ぶ」ステップ・6件）
`showBookSelectionForImport`(6717-6737) `renderBookList`(6739-6776) `updateBookListStats`(6778-6793) `setupBookSelectionListeners`(6795-6836) `updateSelectedCount`(6838-6853) `cancelImport`(6928-6936)

- `showBookSelectionForImport`：選択UIを表示し`renderBookList`/`setupBookSelectionListeners`/`updateSelectedCount`を呼ぶ入口。
- `renderBookList`：取り込み候補の本一覧をDOMに描画（既存/除外判定・フィルタ適用）。
- `updateBookListStats`：一覧の件数統計表示。
- `setupBookSelectionListeners`：選択UI内のチェックボックス・全選択/解除・取込/キャンセルボタンの配線（初回のみ、二重登録防止ガード`_bookSelectionBound`つき）。
- `updateSelectedCount`：選択数とボタンのdisabled状態を更新。
- `cancelImport`：選択UIを非表示にしてインポートオプションに戻す。一時データ(`pendingImportBooks`/`importSource`)をクリア。

### C. 選択本の取込実行（1件・②確認事項）
`importSelectedBooks`(6855-6926)

- 中身：チェックボックス選択の収集→既存/除外ASINのフィルタ→重複ASIN検出でtoast警告→**`this.bookManager.importSelectedBooks(...)`を呼んで実データの登録を依頼**(6890行)→結果を`showImportResults`で画面表示→`this.books`更新・`bookOrder.all`へ反映・`saveUserData`/`applyFilters`/`updateStats`→選択UIを隠す。
- 判断：このメソッド自身は「選択UIのボタンハンドラ＋取込結果を画面に出すオーケストレーション」であり、実際のデータ登録本体(パース・重複マージ・プロパティ書き込み)は**別クラス**`js/book-manager.js`の`BookManager.importSelectedBooks`(65行、全く別ファイル)が担う。本メソッドは`this.bookManager.importSelectedBooks()`という1行の委任呼び出しをするだけで、登録ロジックそのものはVirtualBookshelf側に存在しない。画面のハンドラとして移す。

### D. ファイル/貼り付け/クリップボードからの取込入力（4件）
`importFromFile`(7292-7311) `importFromPastedText`(7317-7333) `importFromPasteInput`(7336-7339) `readClipboardForImport`(7342-7356)

- いずれも「入力ソースからJSON文字列を取得→`JSON.parse`→`showBookSelectionForImport`へ渡す」薄いハンドラ。`JSON.parse`は既に取込用に構造化済みのデータ（ブックマークレット/ファイル/貼り付け由来）をそのまま読むだけで、HTML解析や複雑な変換を伴う「ファイル解析の本体」には当たらない（該当する解析本体はAmazonページ上で動くブックマークレット/ショートカットのコード文字列(§E)の中にあり、ブラウザ外の別コンテキストで実行されるためVirtualBookshelf側のロジックではない）。画面の入力ハンドラとして移す。

### E. ブックマークレット・ショートカットのコード生成とコピー（5件）
`_buildKindleBookmarkletPanelCode`(7536-7538) `_buildKindleBookmarkletCode`(7540-7549) `copyKindleBookmarklet`(7551-7560) `_buildKindleShortcutCode`(7572-7708) `copyKindleShortcutCode`(7711-7719)

- いずれも「Amazon側で実行するコード文字列(JS)をテンプレートリテラルで組み立てて返すだけ」の関数と、それを`navigator.clipboard.writeText`でコピーしてtoastを出すだけの関数。文字列の中身（Amazon API呼び出し・パース・リレー送信）は**このアプリの実行コンテキストでは動かない**（Amazonのページ上でブックマークレット/ショートカットとして実行される別コンテキストのソースコード）。②承認の判断基準どおり「ブックマークレットのコードを画面に表示する部分」に該当＝画面側として移す。

### F. Amazon連携の起動とリレー受信待ち（3件・②確認事項＝混在メソッド）
`openAmazonForBookmarklet`(7721-7824) `_startKindleRelayPoll`(7826-7867) `_stopKindleRelayPoll`(7869-7877)

**実測した内容（混在の中身）**：
- `openAmazonForBookmarklet`：Amazon取込ページのURLを組み立てて新規タブを開く（画面操作）→スマホ分岐ではリレーURLのコピー・`#import-relay-status`のDOM表示切替（画面）→PC分岐では`window.addEventListener('message', handler)`でpostMessageプロトコルを待ち受け、15分タイムアウトの`setTimeout`を張る（通信・プロトコル・タイマー本体）→受信時は`this.showImportModal()`/`this.showBookSelectionForImport()`を呼ぶ（画面遷移）。
- `_startKindleRelayPoll`：`setInterval`でリレーAPIへ`fetch`するポーリング本体（通信・タイマー）だが、同時に`#import-relay-status`のDOM表示切替（画面）と、データ到着時の`this.showImportModal()`/`this.showBookSelectionForImport()`呼び出し（画面遷移）を直接含む。
- `_stopKindleRelayPoll`：`clearInterval`（通信・タイマーの後始末）と`#import-relay-status`のDOM非表示（画面）が同じ関数内。

**判断（②承認済みの基準を適用）**：3件とも「通信・タイマーの本体」と「取込画面のDOM更新・画面遷移」が1メソッド内に混在しており、分離すると`window.open`/`postMessage`ハンドラ/`setInterval`のクロージャが画面側とデータ側に割れてしまい本文無変更の原則を保てない。②承認の基準＝「1つのメソッドに両方が混ざっている場合は、本文を無変更で移すことを優先し、画面側として扱ってよい」に従い、3件とも画面側(import.js)としてそのまま移す。本文の書き換え・分割は行わない。

### G. 取込結果の表示（1件）
`showImportResults`(7882-7911)

- 取込結果（総数・新規・更新・スキップ）を`#import-results`にHTMLとして描画するだけ。実データの集計(`results`オブジェクト)は`BookManager.importSelectedBooks`が返す戻り値をそのまま使う。

### 合計：26メソッド（約722行、行数の確定値はstep2のdiff報告で出す）

## 2. 移さない（bookshelf.jsに残す・理由つき）

| 区分 | 対象 | 理由（実測） |
|---|---|---|
| 取込データの実登録本体 | `BookManager.importSelectedBooks`(js/book-manager.js:65) | **別ファイル・別クラス**。VirtualBookshelfのメソッドではないため、そもそも今回の移動対象に入らない。`importSelectedBooks`(§1-C)から`this.bookManager.importSelectedBooks(...)`の1行で呼ばれるだけ。依頼文の「BookManager への登録・ファイル解析の本体は移さない」に直接該当する実体はここだけで、VirtualBookshelf側には存在しなかった |
| 蔵書一覧の重複チェック用データ取得 | `this.bookManager.getAllBooks()` 呼び出し自体（§1-B/Cの各メソッド内） | 一覧全体の正本データへの参照で、取込画面専用ではない（他画面からも同じ経路で読まれる） |
| Kindle区分フィルタ（本棚一覧側） | `_kindleCategoriesOf`(1654) `_updateKindleFilterUI`(1958) | 名前は似るが**取込画面ではない**。本棚一覧のツールバーで「購入/KU・Prime/利用終了」で絞り込む機能（`applyFilters`から呼ばれる）。取込モーダルとは無関係の別画面 |
| 本の詳細保存・ASIN移行 | `saveBookChanges`(6938) `migrateUserData`(7048) | 取込直後の行範囲に隣接するが、取込ではなく本の詳細の保存・ASIN変更時のデータ移行。既存のまま |
| 一覧カードのメモ表示ヘルパー | `updateMemoPreview`(7118) `convertMarkdownLinksToHtml`(7133) `formatMemoForDisplay`(7140) | 取込の直後に位置するが、一覧カード(`createBookElement`)のメモ表示専用。U8bで既に「一覧カードのメモ表示」として残留判定済み（本イシューでは再確認のみ・変更なし） |
| プラグイン管理画面（別画面・U8a見落とし＝②指摘で実測確認） | `showPluginsModal`(7375) `closePluginsModal`(7381) `_renderPluginsList`(7385) `_refreshPluginCardStatus`(7448) `installPluginFromInput`(7461) `togglePlugin`(7486) `uninstallPluginById`(7509) | **U8aの見落とし**。実測（grep）：`#install-plugin-btn`(index.html:645)・`#plugin-repo-url`(644)・`#plugins-list`(662)は`#settings-modal`(367開始)の内側のDOMで、`installPluginFromInput`/`_renderPluginsList`/`togglePlugin`/`uninstallPluginById`/`_refreshPluginCardStatus`はこれらを操作する＝設定モーダルの「プラグイン」タブの一部(U8aが移した`_renderPluginListSection`/`_renderMarketSection`等16件とは別の、インストール済み一覧のインストール/有効無効/削除UI)。u8a-step1-scope.mdに`showPluginsModal`/`plugins-modal`の文字列は0件(grep実測)＝U8aの棚卸しがこのサブ領域を見ていない。なお`showPluginsModal`/`closePluginsModal`自身は`this._surface().open('plugins-modal')`を呼ぶが、Surfaceキー`'plugins-modal'`に対応するDOM要素はindex.htmlに存在せず、呼び出し元も全コード0件(grep実測)＝**現状デッドコード**(呼ばれていない)。本イシューでは移動せず、設定画面側(settings.js)への切り出しを次の起票候補として残す |
| プラグイン公開可否の収集（データ層） | `_collectPublishablePluginIds`(7359) | 画面ではない。実測（grep）：呼び出し元は`js/exporter.js:291-292`(`this.app._collectPublishablePluginIds()`)のみ＝公開処理(エクスポート)側が使うデータ取得ヘルパーで、DOM操作を一切含まない。設定画面からも呼ばれていない |
| 手動追加モーダル（別画面） | `showAddBookModal`(7916) | 取込の直後だが、ASIN手動入力の別モーダル。取込画面ではない |

## 3. 画面をまたぐ this.*（Plan Aで無変更に動くことの確認・実測）

移す26メソッドの中からbookshelf.js側に残るものを呼ぶ this.*：

- `this._overlays()` / `this._surface()` — nav/overlay基盤（showImportModal/closeImportModalが開閉で使う。§2 U8b表の最終行と同じ基盤）
- `this.bookManager.getAllBooks()` / `this.bookManager.importSelectedBooks()` — 蔵書データの読み取りと実登録依頼（§2参照）
- `this.userData`（`._storage.exclusions`・`.bookOrder`・`.settings` 等の読み書き、既存どおりの共用データ）
- `this.books`（importSelectedBooks内で`this.bookManager.getAllBooks()`の結果を再代入）
- `this.applyFilters()` / `this.updateStats()` / `this.saveUserData()`（importSelectedBooks内、取込後の全体更新）

逆に、**bookshelf.js側に残るコードが、移した側の名前・状態を呼ぶ/読む**箇所（実測・要注意点）：

- `setupEventListeners`(556行台、全画面共通の初期化・残留)内の複数バインドが、移動した画面メソッドをthis経由で呼ぶ：`showImportModal`(740)・`importFromFile`(752)・`importFromPasteInput`(771)・`readClipboardForImport`(773)・`openAmazonForBookmarklet`(785)・`copyKindleBookmarklet`(802)・`_cancelKindleImportWait`(812)・`closeImportModal`(835)。Plan Aでは`this.`経由なので定義ファイルが変わっても無変更で動く
- `setupEventListeners`内の`visibilitychange`リスナー(816行)が、`_startKindleRelayPoll`(移動側)が設定するインスタンスプロパティ`this._kindleRelayTick`を読む（「画面復帰時にポーリングを即1回実行」）。プロパティはthis上に乗るため、メソッドの定義ファイルに関係なく動作する
- コマンドパレット定義(1277行、`_setupCommandPalette`内)：`run: () => this.showImportModal()`
- 本棚一覧の空状態アクション(`_buildBookshelfEmptyState`内・2357行)：`action('本を取り込む', true, () => this.showImportModal())`
- `_navReopen`マップ(6398行、nav基盤・U8a/U8bと同じ仕組み)：`'import-modal': () => this.showImportModal()`（リロード後の面の復元）

インスタンスプロパティ（`this._kindleImportInFlight`・`this._kindleImportCleanup`・`this._kindleRelayPollId`・`this._kindleRelayTick`・`this.pendingImportBooks`・`this.importSource`・`this._bookSelectionBound`）は、`_kindleRelayTick`(上記)以外は全て移動する26メソッドの内部だけで読み書きされており、残留コードとの直接の交差はない。

## 4. 画面外から直接触っている箇所（plugin-api.js・index.html）

- `js/plugin-api.js`：移す26メソッドへの参照は**0件**（grep実測）。
- `index.html`：onclick属性等からの直接参照は0件。コメント内に`showBookSelectionForImport`/`cancelImport`の名前が1箇所（1141行、`.import-options`というクラス名を変えないよう注記するコメント。クラス名自体は変更しないため影響なし）。

**Plan Aであれば、これらは一切変更不要**：上の名前がどのファイルで定義されていても、`VirtualBookshelf.prototype`上に乗る限り同じ関数を指す。

## 5. テストが直接触っている名前（委譲の対象）・bookshelf._総数の基準値

grep実測（`window.bookshelf.<name>()`形式で直接呼んでいるものだけを対象。`bm.importSelectedBooks`等、別クラス(BookManager)への呼び出しは除外）：

| 名前 | ファイル数 | 箇所数 |
|---|---|---|
| `showImportModal` | 9 | 16 |
| `closeImportModal` | 2 | 7 |

他24件（showBookSelectionForImport/renderBookList/updateBookListStats/setupBookSelectionListeners/updateSelectedCount/importSelectedBooks/cancelImport/_detectImportDevice/_importSetupFlags/_renderImportLanes/_cancelKindleImportWait/importFromFile/importFromPastedText/importFromPasteInput/readClipboardForImport/_buildKindleBookmarkletPanelCode/_buildKindleBookmarkletCode/copyKindleBookmarklet/_buildKindleShortcutCode/copyKindleShortcutCode/openAmazonForBookmarklet/_startKindleRelayPoll/_stopKindleRelayPoll/showImportResults）はtests/からの`window.bookshelf.X()`直接呼び出し0件（UI操作経由のみ）。

**注記**：`importSelectedBooks`という名前はtests/配下に18箇所出現する（`tests/e2e/kindle-reimport-merge.spec.js`等）が、実測した呼び出し先は全て`bm.importSelectedBooks(...)`＝`new BookManager()`インスタンス（`tests/unit/kindle-status-import.test.js`で確認）への呼び出しで、`window.bookshelf.importSelectedBooks()`という形の直接呼び出しは0件。VirtualBookshelf側の`importSelectedBooks`（§1-C）はUI操作（ボタンクリック）経由でのみテストされている。

plugin-api.jsからの直接参照：0件（§4参照）。

**「委譲」の数（②承認済みの解釈＝U8a/U8bと同じ）**：Plan Aでは委譲ラッパーを新規に書かない。「テスト・プラグインが直接触れていて、移動後も同じ名前で動くことを確認した対象」の数＝**2種（showImportModal・closeImportModal、計23箇所）**。

**tests/配下の`bookshelf._`参照の総数（基準値・全体・②指摘で数え方を統一）**＝**355件**。

**数え方の食い違いの原因（②指摘・実測で解消）**：step1では`grep -ron "bookshelf\._[A-Za-z]" tests/`（`tests/`配下を再帰的に全部）を実行し366件と報告したが、u8b-step1-scope.md §5が実際に使っていた対象範囲は`tests/`全体ではなく**`tests/e2e/` + `tests/visual/`のみ**だった（u8b文書の「355件」という値自体から逆算して確認：`tests/e2e/`352件+`tests/visual/`3件=355件で一致）。差分11件は`tests/perf/`配下の4つの`.mjs`ファイル（`profile-analyze.mjs`・`profile-analyze2.mjs`・`home-return-perf.mjs`・`home-return-perf-real.mjs`＝パフォーマンス計測スクリプトで、`.spec.js`/`.test.js`ではない＝Playwrightテストではない）に含まれる`bookshelf._`文字列で、u8bの対象範囲には元々入っていなかった。`tests/unit/`・`tests/fixtures/`は両方とも0件で数え方に影響しない。
U8bの後にorigin/mainは進んでいない（f3ae2d3が本worktreeのHEADと一致・`git diff --stat 199ce88 f3ae2d3 -- tests/`も差分0）ことを確認済みなので、②の推測どおり「増えたのではなく数え方が違うだけ」だった。

**今後の計測コマンド（u8bと同じ対象範囲に統一・step3以降もこれを使う）**：
```
grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l
```

移す26メソッドのうち`_`接頭の9件（`_detectImportDevice`/`_importSetupFlags`/`_renderImportLanes`/`_cancelKindleImportWait`/`_buildKindleBookmarkletPanelCode`/`_buildKindleBookmarkletCode`/`_buildKindleShortcutCode`/`_startKindleRelayPoll`/`_stopKindleRelayPoll`）はいずれも、この355件の内訳に出現しない（`bookshelf._`形式でテストから直接呼ばれていない＝0件、§5冒頭の表と同じ実測）。この計測・移動作業はテストファイルを一切編集しないため、step3の再計測でも355件（またはそれ以下）であることを確認する。

## 6. 範囲内のstatic/getter/setter/クラスフィールドの grep 全数検査（#537の落とし穴対応）

移す26メソッドの行範囲（6717-6936, 7170-7356, 7536-7914の3ブロック・間の非対象メソッドも含めて包含的に検査）に対し、`^    (static |get |set )`と`^    [A-Za-z_][A-Za-z0-9_]*\s*=\s*[^(]`（bare class field）の正規表現で機械的に検査：**全範囲でヒット0件**。static群(9件・5114-5385行)とgetter`_modalHistStack`(6982行・U8bの移動範囲内で既に移動済み)は、いずれも今回の移動範囲の外側にあることを確認済み（§0のベーススナップショットとも整合）。

## 7. ②への確認事項（tp・2026-11-13 05:45 承認済み）

1. §1-Cの`importSelectedBooks`（選択UIのハンドラ＋取込結果表示のオーケストレーション。実データ登録は別クラスBookManagerへの1行委任）を画面側として移す判断でよいか。
   → **②回答**：画面側として移してよい。中身は登録の本体（BookManager）を呼んでUIを更新するだけで、画面側の処理と言えるため。
2. §1-Fの3件（`openAmazonForBookmarklet`・`_startKindleRelayPoll`・`_stopKindleRelayPoll`）を、通信・タイマー本体と画面DOM更新が1メソッド内に混在しているため、②の承認基準（「混在時は本文無変更を優先し画面側として扱ってよい」）どおり画面側として丸ごと移す判断でよいか。
   → **②回答**：承認済みの基準どおり、まとめて画面側へ移してよい。本文は変えずに移すことを優先する。
3. §0で測った`bookshelf._`参照数366件（完了条件に書かれた基準355件から11件増加）について、本イシューでは原因調査・対処をせず、現状値を基準に「増やさない」ことだけを確認する方針でよいか。
   → **②回答**：U8bの後にorigin/mainは進んでいないため、増えたのではなく数え方が違うだけと考えられる。u8b-step1-scope.md §5の数え方（コマンドと対象範囲）で数え直し、基準を1つに揃える。
   → **③対応（本ステップで実測・解消）**：u8bの対象範囲は`tests/`全体ではなく`tests/e2e/`+`tests/visual/`のみだった（`tests/e2e/`352件+`tests/visual/`3件=355件で一致）。差分11件は`tests/perf/`配下の計測用`.mjs`4ファイル（spec/testではない）に含まれていた。origin/mainがU8bの後に進んでいないことも`git diff --stat 199ce88 f3ae2d3 -- tests/`で確認（差分0）。②の推測どおり数え方の違いで、参照数自体は増えていなかった。以後は§5末尾のコマンド（`tests/e2e/ tests/visual/`限定）に統一する。
4. §2のプラグイン管理画面8件・手動追加モーダル1件は、取込メソッド群の行範囲に挟まっているだけで取込画面ではないため、今回は一切移動しない（将来別イシューで切り出す）という理解でよいか。
   → **②回答**：今回は動かさない。ただしプラグイン管理画面は、U8aでsettings.jsへ移した「プラグイン一覧/マーケット」と同じ画面の残りかもしれない。なぜU8aで残ったのかを§2に1行書くこと（見落としだったのか、意図して残したのか）。見落としだった場合は、別のイシューでsettings.jsへ移す。次の起票候補として残しておくこと。
   → **③対応（本ステップで実測・§2に反映）**：**見落とし**と判明。`showPluginsModal`/`closePluginsModal`/`_renderPluginsList`/`_refreshPluginCardStatus`/`installPluginFromInput`/`togglePlugin`/`uninstallPluginById`の7件は`#settings-modal`内のDOM（`#install-plugin-btn`等）を操作する設定画面の一部で、u8a-step1-scope.mdには`showPluginsModal`/`plugins-modal`の文字列が0件（grep実測）＝U8aの棚卸しがこのサブ領域を見落としていた。さらに実測で、`showPluginsModal`/`closePluginsModal`自身は呼び出し元が全コード0件（現状デッドコード）という追加発見もあった。`_collectPublishablePluginIds`(1件)は別件で、画面ではなく`js/exporter.js`（公開処理）が使うデータ取得ヘルパー（§2参照）。**次の起票候補**：7件（デッドコード2件含む）をsettings.jsへ移す別イシュー（②へ報告・本イシューでは起票しない）。

承認後、step2でPlan Aの移動を実施した（本commit）。
