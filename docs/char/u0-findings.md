# U0：step2 の案を変えるべき点（実測による発見）

## 1. P9（PCでも、ウィジェット経由の本の詳細オープンは履歴が積まれる）

- **step2/step3の前提**：「PCは段を積まない」ため、本の詳細をPCで開いて戻るとアプリの外に出る（P9）。
- **実測**：ホームのウィジェット（`.widget-book-cell`）をクリックして本の詳細を開くと、PC幅（1440px）でも `history.length` が2→3に増えた（積まれている）。
- **原因をgrepで特定**：`js/dashboard.js` の `_renderRecentBooks`/`_renderTodayPick` は `app.showBookDetail(book, false)` を呼ぶ（657〜662行・689行）。`showBookDetail`（`js/bookshelf.js:3014`）は `this.nav.openBook(book.asin, …, { mobile: this._isHistMobile() })` を呼ぶ（3027行）。これは `NavState` の `reduce` 内の `openBook3` 分岐（`js/nav-state.js:277-279`）で `faces` を変えるかどうかだけを `mobile` で判定する。しかし **履歴を実際に push するかどうかを決めているのは `historyOp()`（`js/nav-state.js:334-348`）であり、`faces` の増減（`dFaces`）が0でも `routeChanged`（343〜345行）だけで `push` を返す**。本を開く操作は必ず `route.view` を `'book'` に変えるため、`mobile` の値に関わらずルート変化だけで履歴が積まれる。
- **結論・変えるべき点**：「PCは段を積まない」という前提は、**本の詳細（ルートが変わる遷移）には当てはまらない**。実際に段を積まないのは、ルートを変えない「面」（設定・公開ページ管理・記事エディタ・add-book等、`_modalHistPush`/`NavState.open()` 経由で開く汎用モーダル）だけである（`pc-back.spec.js`・`article.spec.js` A-eで確認済み）。
- **S6（全幅で履歴の段を積む）の設計への影響**：S6は「P9・P10（全幅で履歴の段を積む）」が対象だが、本の詳細は**すでにPCでも履歴が積まれている**ため、S6で新たに対処が必要なのは「ルートを変えない面」側（settings-modal等）だけになる可能性がある。X1/S6の設計時に、本の詳細の実際の挙動（ルート変化による自動push）を前提にしてよい。

## 2. 820px：原因はアプリ側のCSS重なり（isMobileフラグの影響ではない）

- **②の指示**：820でクリックが通らない件（W5）と選択肢数の揺れが、Playwrightの`isMobile:true`によるviewportの実効幅変化が原因かどうかを、`isMobile:false`・`hasTouch:true`の820で同じ操作をして切り分ける。
- **実測結果**：`isMobile:false`に変えても、`innerWidth`は正しく820、`matchMedia('(max-width:768px)')`はfalse（＝CSSはPC側と判定）のまま、**W5のクリック不能（2番目のカードが1番目のカードのクリックを奪う`intercepts pointer events`）が同一に再現した**。選択肢数が2だった件は、**原因を取り違えていた**：最初に調べたウィジェット（`counter-total`）は`allowedSizes: ['sm','md']`で、そもそも設計上2択しかない（`js/dashboard.js`の`_buildRegistry`）。モバイル判定とは無関係。
- **結論**：W5のクリック不能は**テストの設定(isMobile)の問題ではなく、アプリ側のCSSの重なりが原因**。820px幅で`.dashboard-widget`カードどうしが重なる(おそらく`span-3 m-half`のクラス組み合わせの計算か、12列PCグリッドと`m-half`スマホレイアウトの両方のCSSルールが同時に当たっている)。**U2（幅の境目を1つに）で、この重なりも合わせて直すべき**。選択肢数の揺れは誤報（原因はウィジェットごとのallowedSizesの違いであり、直す必要はない）。

## 3. B4の対象幅（77件表の記載ミスの可能性）

- **77件表**：B4は390・768・1024が対象。
- **実測**：390・768では本の詳細が全画面オーバーレイになり、背後の2冊目をクリックできず測定不可能。1024のみ測れた。
- **②の回答**：1024だけを測れる幅として受け取る（表の記載は直してよい）、との回答済み。本ファイルはその根拠の記録。

## 4. 記事エディタの公開フロー（A1・A7）がタッチ3端末でハングする（U0c #506 で解消・原因確定）

- A1/A7の「新規作成→本棚ブロック→本を3冊→公開」の一連の操作を、タッチ端末（390/768/1024）で実行すると60秒のテストタイムアウトを超えてハングした。PC幅（1440/1920）では実行していない（A1/A7はタッチ3端末のみが対象のため）。
- 切り分けの途中経過：`#sidebar-publish`がモバイルではドロワーに隠れている問題は特定・修正した（`[data-mobile-nav="shelves"]`で開く）。しかしその後も別の場所でハングが続き、このstepの時間内に根本原因を特定できなかった。
- 推定（未確認）：`addBlock`ヘルパーの`toPass`リトライ（最大15秒）が、モバイル幅の引き出し（drawer sheet）の開閉と絡んで繰り返し失敗し続けている可能性がある。
- **提案**：U0bの続き、または別の調査イシューで、`addBlock`のtoPassリトライをモバイル幅で単体実行し、リトライが実際に何を待っているか（スクリーンショット・トレース）を確認するとよい。

### 4-1. 原因確定（イシュー#506 step1、`--trace=on`での1手ずつの切り分け）

- `addBlock`ヘルパー自体（`toPass`リトライ）はシートを開く部分であり、1.4秒で完了していた＝ハングとは無関係だった（推定は外れ）。
- 真因：`addBlock(page, 'shelf', 'last')`完了直後、`#art-drawer`は`is-open`クラスが付かない（A-cの既知の振る舞い＝本棚ブロック追加では引き出しは自動で開かない）。この状態で既存のA1/A7骨組みコードが`#art-drawer-list .art-drawer-item`を直接クリックしようとしていた。`.art-drawer-item`は`isVisible()`ではtrue判定になるが、実際のboundingClientRectは`{x:0, y:844, width:390, height:426}`（390幅のビューポート`844`の真下＝オフキャンバス）だった。Playwrightのclickはactionability待ち（`element is outside of the viewport`）を満たせないまま30秒リトライを続け、タイムアウトしていた。
- `js/bookshelf.js`で引き出しを開くトリガーを特定：本棚ブロックは`.art-shelf-add`、本ブロックは`.art-book-pick`のクリック（11745-11767行目、`.is-open`クラスの付与/除去を実装）。既存の骨組みコードは、本棚ブロック追加後に引き出しを開くクリックを一切していなかった。
- さらに、900pxの画面幅境界で引き出しの実装方式自体が変わることも判明した：**390/768（900px以下）はボトムシート方式**で、`window.bookshelf._artOpenSheet()`/`_artCloseSheet()`を明示的に呼んで開閉する必要がある（イシュー#165）。**1024（900px超）は常駐の畳める引き出し**（イシュー#168の仕様）で、開閉関数を呼ばずに直接選択できる＝390/768とは別の経路。この分岐を知らずに同じ手順を3端末に当てはめると1024だけ不要な操作で失敗する落とし穴がある。
- **対処（`tests/e2e/char/publish-hub.spec.js`に実装済み）**：`ensureDrawerPickable()`で`window.matchMedia('(max-width: 900px)').matches`により分岐し、900px以下は`_artOpenSheet()`呼び出し後に`#art-drawer`の`is-open`クラスで開いたことを確認、900px超は`getBoundingClientRect().x >= 0`で確認する（`isVisible()`は使わない・#502の知見どおり）。
- 副次的に見つかった前提漏れ：`_artPublishCheck()`（js/bookshelf.js:12203）はタイトル必須。u0-targets.mdの手順文には明記が無いが、タイトルを入れないと`#art-pub-go`がdisabledのまま（今の振る舞い）だったため、テスト側でタイトル入力を補った。

## 8. E4（ハブの412衝突→O27）の固定（イシュー#506 U0c）

- `tests/e2e/sync-conflict.spec.js`は`window.bookshelf._handleSyncConflict()`を直接呼ぶ単体テストだったため、`tests/e2e/char/hub-conflict.spec.js`では実際のHTTP応答経路を通して固定した。
- 経路：`sync.method='hub'`で起動→`_scheduleSync()`→`_runPendingSync()`→`_syncWithAuthRetry()`→`syncToObsidianFolder()`→`storage.syncBatch()`→`hub-adapter.commitBatch()`（HEAD→POST `/data/batch`）→412応答→`_recoverBatchConflictAndRetry()`（`conflicts`詳細が応答に無い＝js/hub-adapter.js:291-296の「個別判定できないので安全側に倒す」経路）→即座に`HubConflictError`→js/bookshelf.js:5936-5938でキャッチ→`_handleSyncConflict('Asayake ハブ')`→`#sync-conflict-dialog`（O27）表示。
- `_handleSyncConflict`はダイアログで選択されるまでPromiseが解決しない設計のため、トリガー呼び出し（`page.evaluate`）自体はawaitせず、ダイアログの出現をPlaywrightのlocator自動待ちで確認する形にした。
- 確認内容：ダイアログの`.cfm-message`に同期元名（「Asayake ハブ」）が入ること、3択（`.cfm-cancel`「何もしない」/`.cfm-export`「編集内容をJSONで書き出す」/`.cfm-ok`「再読込して最新版を取得」）のラベル、「何もしない」でダイアログが閉じることを確認した（今の振る舞い）。

## 5. このstepで測れなかったものの全体像

- S・L・N・I・Eの14項目（59セル）は、テストファイル自体は作成したが、個別の実行確認がこのstepの時間内に完了しなかったため、`test.skip(true, …)`で安全側に倒した（`docs/char/u0-77-table.md`の該当表に明記）。無理に期待を固定せず、原因不明のまま「測れた」と報告することは避けた。

## 6. (U0b追記) テストコードの重要な教訓：addInitScriptのクロージャ

`page.addInitScript(([u, l]) => {...})`のコールバックはブラウザ側で評価される。Node側のローカル変数(例：`const MB = 1024*1024`)をこの中で直接参照すると`ReferenceError`になり、**例外より後ろの行が実行されない**(E5のテストで実際に発生：`bookshelf_sync`のsetItemだけが実行されず、hub関連の画面が正しく起動しなかった)。使う値は必ず`addInitScript`の第2引数(配列)に含めて渡すこと。
②差し戻しで指摘された「ハングの多くはhttp.serverのorphan化が原因」という推測は、調査の結果**一部は当たっていたが(実際に1回orphan化を確認し`pkill`で復旧)、大半は別の原因（1）誤ったセレクタによる30~60秒の actionability タイムアウト、（2）このクロージャの罠、だった**。`scripts/verify/501-free-port.mjs`と短いper-testタイムアウト(15〜20秒)での1本ずつの切り分けは、原因の特定に有効だった。

## 7. U0bで直したセレクタの誤り一覧(次段のテスト作成で再利用できる実測値)

- 本棚管理モーダルを開く入口はサイドバーに静的ボタンが無く、コマンドパレット「本棚を管理」経由のみ(js/bookshelf.js:1265)。
- サイドバーのツリー項目は`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="..."]`(`#app-sidebar`自体ではない)。
- fixshelf("テスト本棚")は"all"の子で、既定では折りたたまれて非表示。`.tree-node[data-bookshelf-id="all"] .tree-toggle`を押して展開する必要がある。
- 表示形式の切替は`#toggle-display`→`#display-popover`内の`#view-seg .rseg[data-view="..."]`。activeクラスは`is-active`ではなく`on`。
- 設定の「表示」節(`display-section`)にテーマ(配色)の設定は無い。実在するのは起動時表示形式・星評価・短文メモ・Kindleの開き方(index.html 677-712行)。
- `openReportModal()`はhub未ログインだとログイン案内に分岐する。hubログイン済み相当の`bookshelf_sync.hub`注入が必要。
- "all"本棚を空にするには、`userData.bookshelves`の"all"の`books`配列だけでなく、`library.books`も空にする必要がある("all"はlibraryをそのまま映す特殊本棚)。
- モバイル幅で左ペイン(`#sidebar-publish`等)を触るには、先に`[data-mobile-nav="shelves"]`でドロワーを開く必要がある(オフキャンバスの引き出しは`isVisible()`が効かないため、`#app-sidebar`の`getBoundingClientRect().x`で開閉を判定する)。設定(`[data-mobile-nav="settings"]`)と検索(`[data-mobile-nav="search"]`)は直接開く専用ボタンがあり、ドロワーを経由しない。
