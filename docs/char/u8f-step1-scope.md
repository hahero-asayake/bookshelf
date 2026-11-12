# U8f step1: 棚卸しと置き場所の決定（イシュー#547）

対象: ①公開の一覧（記事・公開ページの一覧画面＝公開ハブ・公開ページのモーダルなど、記事エディタの外にある公開系の一覧画面）を `js/bookshelf.js` から `js/screens/` へ移す。②U8e で持ち越した `renderBookshelfOverview`（ホームの概観・no-op）の置き場所を決める。③U8 完了時の委譲まとめ表の準備（本体は step4）。

計測は worktree `issue-547`（**origin/main 3bcdcb8 へ一致**＝#546(U8e)完了後）。`js/bookshelf.js` は**7012行**（移す前・現在値。U8e棚卸し時点は7144行＝U8eのbookshelf-card.js移動130行分減）。移し方はU7(#525)〜U8e(#546)と同じ**Plan A**（匿名class の prototype 記述子を `VirtualBookshelf.prototype` へ合成・本文無変更）。

## 0. 移動前スナップショット（機械的検証の基準値）

`node`製の簡易static server(PORT 8147)で配信→Playwright(MCP)で`window.bookshelf.constructor`の`Object.getOwnPropertyNames`を静的側・prototype側それぞれ取得。結果は `docs/char/u8f-baseline-members.json` に保存済み。

- static側：**9件**（U8e完了後と完全一致：`HEADER_ICON_OVERRIDES_KEY`等）。
- prototype側：**525件**（U8e完了後の値と完全一致）。
- 起動時のconsoleエラー：**1件**（`ERR_CONNECTION_REFUSED @ pagead2.googlesyndication.com`＝サンドボックス環境のネットワーク遮断による既定ノイズで、本変更と無関係）。pageerrorは0件。
- テストの`bookshelf._`参照数：`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l` = **355件**（完了条件の基準値と一致）。
- step2で移動した後、同じ手順で static=9・proto=525（名前集合も完全一致）・console既定ノイズ1件（pagead2除く0件）・`bookshelf._`参照355件以下のままであることを確認する。

## 1. 「公開の一覧」の棚卸し：実体はすでに article-editor.js 側にある

依頼が例示する「公開ハブ・公開ページのモーダル」を実測した結果：

| 項目 | 実測箇所 | 判定 |
|---|---|---|
| `openPublishPagesModal`・`closePublishPagesModal`（公開ページ一覧モーダルの開閉） | `js/screens/article-editor.js` 98-171行（U7・#525で既に移動済み。同ファイル冒頭コメント「`_art* 132個 + openPublishPagesModal/closePublishPagesModal/openPublishSettingsModal/closePublishSettingsModal/_ensureFreeAffiliateConsent/_handleAdapterWriteStatus の6個`」に明記） | **対象外**（既に移動済み・article-editor.js は触らない） |
| `openPublishSettingsModal`・`closePublishSettingsModal`（公開設定モーダル） | 同上 147-171行 | **対象外**（同上） |

実測の結果、**「公開の一覧」画面の実体は、bookshelf.js にはもう残っていない**。U7（#525）の時点で article-editor.js 側へ既に移動済みだった。bookshelf.js 側で「公開」に関係する残存メンバーは以下のとおりで、いずれも「一覧画面」ではない：

| 名前 | 行範囲・行数 | 呼び出し元 | 画面か共通基盤/データか | 判定 |
|---|---|---|---|---|
| `_runPublishExport` | 5455-5535・**81行** | `js/screens/article-editor.js`（60行目・3387行目の2箇所）＋ bookshelf.js内（公開実行系ハンドラ） | **画面ではない**＝接続確認→flushSync→`exporter.export()`の公開実行共通処理（ADR-030、JSDoc明記）。article-editor.js からも呼ばれる共通ロジック | 移さない（画面ではなく公開実行の共通処理＝bookshelf.jsの基盤として残す） |
| `_collectPublishablePluginIds` | 6491-6502・**17行** | `js/exporter.js:291-292`（`this.app._collectPublishablePluginIds()`。exporter.jsは触らない対象） | **画面ではない**＝インストール済みプラグインの`manifest.publishable`集合を返すデータ取得のみ | 移さない（exporter.jsが依存するデータ提供口。U8c(#543)の棚卸しでも既に同趣旨の言及あり） |
| `exportUnifiedData`・`buildExportData` | 6761-6780・3623-3657 | `js/screens/settings.js:1153`（設定の「エクスポート」ボタン）＋bookshelf.js内（同期コンフリクト時の退避） | **画面ではない**＝蔵書データのバックアップ用`library.json`ダウンロード機能。「公開」ではなく設定/バックアップ機能で無関係 | 対象外（公開の一覧でもホームの概観でもない。残る責務としてstep4の表に記載） |
| `_reopenArtFs`〜`_reopenDescendantsPick`（10メソッド） | 6054-6150・**約100行** | `js/nav-state.js`の「進む」復元ディスパッチ | **画面ではない**が、article-editor.js の内部（公開パネル`_artOpenPublishPanel`等）を開き直す記事エディタ専用の復元処理。article-editor.js側にまだ移っていない（U7の移動対象138個には含まれていなかった） | **対象外**（article-editor.js は触らない指示のため、これを移す/触るとarticle-editor.js側の対応変更が要る。U9への申し送り候補として記録） |

**結論**：依頼の範囲1「公開の一覧を js/screens/ へ移す」について、移せる実体は無い（U7で先行済み）。②の事前の想定どおり、実測は100行未満（0行）だった。

## 2. 通報モーダル群の判定（②申し送りに基づく比較）

U8a(#537)で「別の機能」として残された、記事通報(ADR-099)のモーダル群を実測した。

### 対象範囲

| 項目 | 行範囲 | 行数 |
|---|---|---|
| ヘッダーコメント＋11メソッド（`_handleReportParam`・`_pendingReportSet`・`_pendingReportGet`・`_pendingReportClear`・`openReportModal`・`closeReportModal`・`_setReportError`・`_submitReport`・`_loadReportReview`・`_renderReportReview`・`_reportReviewAct`） | 3110-3294 | **185行** |

### 呼び出し元（実測・grep確認済み）

- `js/screens/settings.js:917`（`this._handleReportParam()`）・`:1044`（`this._loadReportReview()`）＝管理者設定パネルから。
- `js/bookshelf.js:901-914`（`setupEventListeners()`内のイベント配線。`this.closeReportModal()`・`this._submitReport()`・`this._loadReportReview()`・`this._reportReviewAct(btn)`）＝Plan Aで`this.xxx`呼び出しのため移動後も無変更で動く。
- `js/bookshelf.js:5952`（`'report-modal': () => this.openReportModal(st.url)` ＝ 画面の開き直しディスパッチテーブル）。
- E2E: `tests/e2e/report-moderation.spec.js`・`tests/e2e/back-nav-matrix.spec.js`・`tests/e2e/char/settings-shelves-nav.spec.js` は全て `window.bookshelf.openReportModal(...)`（アンダースコア無し＝完了条件の`bookshelf._`参照数の対象外。grep実測：`bookshelf\._.*[Rr]eport`は0件）。

### 判定

これは**記事エディタの外にある公開系の一覧画面ではない**（通報は「公開記事に対する報告・審査」であり、公開一覧とは別機能）が、②申し送りの通り、**まだどの画面ファイルにも属していない独立画面**（185行・static/getter/setter無し・下記§4で確認済み）。grep実測の結果、依存は全て`this.xxx`/グローバル（`document`・`location`・`history`・`sessionStorage`・`fetch`・`SyncConfigManager`・`toast`）で、既存の `js/screens/*.js` と同じ Plan A の条件（本文無変更で移せる）を満たす。

**推奨：移す**。②申し送りの指示どおり、公開一覧とは混ぜず、新規ファイル `js/screens/report.js` に分離する。

## 3. renderBookshelfOverview の置き場所

`renderBookshelfOverview()`（bookshelf.js 6781-6795・**15行**）は U8e で判断が持ち越されていた。実測を追加：

- `#bookshelves-grid` は **index.html・js/ 配下のどこにも存在しない**（grep実測：ヒットは本関数自身のコメント/`document.getElementById`呼び出しのみ）。つまり現行UIでは必ず`if (!grid) return`で即終了するno-op経路のみが実行される（U8eの実測を再確認・変化なし）。
- 呼び出し元はbookshelf.js内8箇所＋`js/plugin-api.js:343`（`typeof this._app.renderBookshelfOverview === 'function'`で動的呼び出し）。

### 比較

| 案 | 内容 | 評価 |
|---|---|---|
| (a) `js/screens/report.js` に同乗 | report.js作成のタイミングに便乗（U8eが見込んだ「新規ファイル作成時にまとめる」の対象） | 行数コストは小さいが、**通報（モデレーション）とホーム概観は無関係な機能**。同じファイルに混在させると、report.js の責務が「通報画面」から「通報画面＋ホームの残骸」へ曖昧になる |
| (b) bookshelf.jsに残す | 現状維持 | 呼び出し元8箇所は全て`this.xxx`のまま変化なし。plugin-api.js側の動的チェックも無変更で動く。**no-op・死んでいるコードという性質上、どちらの置き場所でも実害は無い**が、移動の実益も無い |

### 推奨：(b) bookshelf.jsに残す

- 本関数は「ホームの概観」という名目だが、実体は**到達不能なno-op**（`#bookshelves-grid`がDOMに存在しないため）。実質的な処理（`_renderBookshelfCard`・`_bindBookshelfOverviewEvents`）はU8eで既に`js/ui/bookshelf-card.js`へ移動済みで、残っているのはこの15行の「呼び出された時に何もしない」ガード部分のみ。
- report.js は通報（モデレーション）専用の画面として作るため、無関係な15行を混ぜることは避ける（①の指示「公開一覧とは混ぜない」と同じ精神で、通報と無関係な機能も混ぜない）。
- **削除の起票候補として記録する**（依頼範囲2の指示どおり、削除の判断自体はしない）：`renderBookshelfOverview`は`#bookshelves-grid`の消滅により恒久的に到達不能。削除すればbookshelf.js側8箇所の呼び出しと`plugin-api.js`の動的チェックも一緒に外せる。07_残検討事項への追記候補として起票する。

## 4. static/getter/setter/クラスフィールドの grep 全数検査

ファイル全体：static群**9件**（4438行・4669-4709行付近、U8e基準と一致）。getter**1件**（`_modalHistStack`・5933行）。setterは0件。bare class field は0件。

移動候補の行範囲（§2の通報モーダル群 3110-3294）に対し同じ検査：**static/getter/setter/class field 0件**（grep実測、上記レンジ内でヒット無し）。renderBookshelfOverview（6781-6795）も残す判断のため対象外だが、同様に0件を確認済み。

## 5. 移す先ファイル・index.html・?v=

- 新規ファイル：`js/screens/report.js`（通報モーダル群11メソッド・185行をPlan Aで移動）。
- index.html：`js/bookshelf.js`（1504行目）より後、他の`js/screens/*.js`タグ群（1513-1527行目）と並べて追加。VirtualBookshelfクラス定義後にprototype合成するため、順序はbookshelf.jsの後であれば他screens/*.jsとの前後関係は無関係。
- `?v=`：既存の書式（`2026111XXX`のタイムスタンプ型）に合わせ、作業時点の日時で新規に振る。

## 6. 推奨・②判断ポイント（tp）

②申し送りで示された通り、「公開一覧の実体がbookshelf.jsにほとんど残っていない（実測：0行）」ことが確定した。これに基づき、U8fの実質的な作業内容を次の2つに整理することを推奨する（申し送りの案そのまま）：

1. **通報モーダル群（185行）を `js/screens/report.js` へ移す**（renderBookshelfOverviewはbookshelf.jsに残し、削除は起票候補にとどめる＝§3推奨）。
2. **U8完了報告**（委譲まとめ表・残責務一覧・「約2,500行」との差）を行う（step4で実施）。

この整理は既存の計画ステップ構成（step2=移動、step4=報告）を変更するものではなく、「何を移すか」の内容を実測で確定させたものである。②の確認を仰ぐのは主に次の2点：

- **renderBookshelfOverviewをbookshelf.jsに残す判断（§3(b)）でよいか**（report.jsに混ぜない）。
- 削除の起票候補（renderBookshelfOverview・到達不能no-op）をこのまま07_残検討事項へ追記してよいか。
