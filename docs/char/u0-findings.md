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

## 4. 記事エディタの公開フロー（A1・A7）がタッチ3端末でハングする

- A1/A7の「新規作成→本棚ブロック→本を3冊→公開」の一連の操作を、タッチ端末（390/768/1024）で実行すると60秒のテストタイムアウトを超えてハングした。PC幅（1440/1920）では実行していない（A1/A7はタッチ3端末のみが対象のため）。
- 切り分けの途中経過：`#sidebar-publish`がモバイルではドロワーに隠れている問題は特定・修正した（`[data-mobile-nav="shelves"]`で開く）。しかしその後も別の場所でハングが続き、このstepの時間内に根本原因を特定できなかった。
- 推定（未確認）：`addBlock`ヘルパーの`toPass`リトライ（最大15秒）が、モバイル幅の引き出し（drawer sheet）の開閉と絡んで繰り返し失敗し続けている可能性がある。
- **提案**：U0bの続き、または別の調査イシューで、`addBlock`のtoPassリトライをモバイル幅で単体実行し、リトライが実際に何を待っているか（スクリーンショット・トレース）を確認するとよい。

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
