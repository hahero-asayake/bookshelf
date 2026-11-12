# U8d step1: 棚卸しと移し方の決定（イシュー#545）

対象: 本棚の一覧とツリー（サイドバーの本棚ツリー・本棚の一覧画面・本棚の作成・編集フォームのうち画面の部分）を `js/bookshelf.js` から `js/screens/bookshelf-list.js` へ移す。

計測は worktree `issue-545`（**origin/main 61f8b79 へ `git merge --ff-only` 済み**＝#544(U8a補完)完了後。`js/bookshelf.js` は **7594行**（移す前・#544後の値）。移し方はU7(#525)・U8a(#537)・U8a補完(#544)・U8b(#542)・U8c(#543)と同じ **Plan A**（匿名class の prototype 記述子を `VirtualBookshelf.prototype` へ合成・本文無変更）。

移動先ファイル名は依頼どおり **`js/screens/bookshelf-list.js`**（サイドバーツリー＋本棚一覧＋作成編集フォームの画面部分を1ファイルにまとめる。量が後述§1の通り約427行とU8cの約722行より少なく、2イシューへの分割提案は不要と判断）。

## 0. 移動前スナップショット（機械的検証の基準値）

`python3 -m http.server 8145`で配信→Playwright(MCP)で`index.html`を開き、`window.bookshelf.constructor`の`Object.getOwnPropertyNames`を静的側・prototype側それぞれ取得（組み込みの`length`/`name`/`prototype`(static側)と`constructor`(prototype側)は除外）。結果は `docs/char/u8d-baseline-members.json` に保存済み。

- static側：**9件**（U8bと完全一致＝199ce88の修正後から変化なし）。
- prototype側：**525件**（U8c完了後+#544完了後の値。移す13メソッドは全て含まれていることを確認済み）。
- 起動時のconsoleエラー：**1件**（`ERR_CONNECTION_REFUSED @ pagead2.googlesyndication.com`＝サンドボックス環境のネットワーク遮断による既定ノイズで、本変更と無関係）。pageerrorは0件。
- テストの`bookshelf._`参照数：`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l` = **355件**（完了条件の基準値と一致）。
- step2で移動した後、同じ手順で static=9・proto=525（名前集合も完全一致）・console既定ノイズ1件（pagead2除く0件）・`bookshelf._`参照355件以下のままであることを確認する。

## 1. 移す対象（責務で判定・行番号は現状=移す前）

判定基準はU7/U8a/U8b/U8cと同じ：名前の接頭辞ではなく責務で決める。「画面の描画とハンドラ」かどうかで判定し、データ・ドメインの読み書き本体（§2参照）は移さない。終了行は括弧対応の状態機械で機械的に特定（#542の作法）。実測の結果、**13メソッド・約427行**を移す。

**依存の前提（②指示）**：`setupBookshelfDragAndDrop`は`this._bindPointerReorder`（U4・イシュー#517でjs/ui/reorder.jsへ抽出済み。bookshelf.js側に1行委譲のメソッドが残る＝2593行）に依存する。`_renderSidebarTree`も同じ`_bindPointerReorder`を使う。Plan Aでは全メソッドが同じ`VirtualBookshelf.prototype`に乗るため、移動先ファイルが分かれても`this._bindPointerReorder(...)`の呼び出しは無変更で動く（book-detail.js・dashboard.js・settings.jsの既存3箇所も同じ形で動いている）。

### A. サイドバーの本棚ツリー（4件）
`_renderSidebarTree`(4389-4494) `_onTreeDrop`(4499-4558) `_openTreeNodeMenu`(4602-4640) `_updateSidebarActive`(4642-4659)

- `_renderSidebarTree`：サイドバーの本棚ツリーをDOMに描画（展開状態の復元・ノード生成・クリック/トグル/D&Dの配線）。末尾で`_bindPointerReorder`を呼ぶ。
- `_onTreeDrop`：ツリーD&Dのドロップ処理（並び替え/親子変更の判定とUI更新呼び出し）。実際の親変更は`_applyReparentWithConfirm`（§2・移さない）に委任。
- `_openTreeNodeMenu`：ツリーノードの「編集/子追加/削除」メニューの表示・配線。
- `_updateSidebarActive`：サイドバーツリーと下部モバイルナビの現在地ハイライト更新。

### B. 本棚の一覧画面（8件）
`showBookshelfManager`(5331-5336) `closeBookshelfModal`(5338-5342) `renderBookshelfList`(5344-5416) `addBookshelf`(5418-5420) `showBookshelfForm`(5422-5499) `closeBookshelfForm`(5501-5506) `editBookshelf`(5589-5594) `setupBookshelfDragAndDrop`(7457-7477)

- `showBookshelfManager`/`closeBookshelfModal`：本棚管理モーダルの開閉。
- `renderBookshelfList`：モーダル内の本棚一覧（階層構造でインデント表示）の描画＋編集/削除ボタンの配線＋D&D配線（`setupBookshelfDragAndDrop`呼び出し）。
- `addBookshelf`：「本棚を追加」ボタンのハンドラ（`showBookshelfForm()`を呼ぶだけ）。
- `showBookshelfForm`/`closeBookshelfForm`：作成・編集フォームモーダルの開閉（画面部分＝フォームの値のセット・親ドロップダウン構築・アイコン選択UI配線）。実際の保存は`saveBookshelfForm`（§2・移さない）。
- `editBookshelf`：一覧の「編集」ボタンのハンドラ。`this.userData.bookshelves.find(...)`で対象を探して`showBookshelfForm(bookshelf)`を呼ぶだけの薄い入口（データ変更は行わない・読み取りのみ）。
- `setupBookshelfDragAndDrop`：本棚一覧モーダル内のD&D設定（`_bindPointerReorder`呼び出し＋`_onTreeDrop`への委任）。

**②確認事項（step2・実測で解消）**：`addBookshelf`/`editBookshelf`は本文を実測した結果、どちらも`BookshelfManager`の呼び出しを一切含まない。`addBookshelf`は`this.showBookshelfForm()`を呼ぶだけ（5419行）。`editBookshelf`は`this.userData.bookshelves.find(...)`という配列の読み取り（データ変更なし）で対象を探し`this.showBookshelfForm(bookshelf)`を呼ぶだけ（5590-5593行）。2件ともフォームを開くだけの画面入口＝データ操作が主ではないため、§1の移す対象のまま変更なし。

### C. 本棚の作成・編集フォームの画面部分（1件・リロード対応）
`_reopenBookshelfForm`(6587-6592)

- `_navReopen`マップ（6384行、nav基盤・U8a〜U8cと同じ仕組み）からリロード後にフォームを開き直すための1メソッド。`this.showBookshelfForm(...)`を呼ぶだけ。

### 合計：13メソッド（約427行、行数の確定値はstep2のdiff報告で出す）

## 2. 移さない（bookshelf.jsに残す・理由つき）

依頼の「BookshelfManager の操作、ソート・フィルタの計算本体は移さない」に加え、**実測の結果、当初想定（ステップ指示の例示名）と異なり移さないと判断したものが複数ある**。②の承認基準（複数画面から呼ばれる関数は共通部品として残す＝BookListと同じ扱い）を適用した結果。

| 区分 | 対象 | 理由（実測） |
|---|---|---|
| 本棚データの保存・削除・追加（依頼で明示） | `saveBookshelfForm`(5508-5587)・`_generateDefaultSlug`(5582-5587)・`deleteBookshelf`(5596-5633)・`addBookToBookshelf`(5635-5690)・`_chooseDescendantsToAddTo`(5692-5750)・`removeFromBookshelf`(5752-5796)・`_excludeAsinCore`(5805-) | 依頼本文が名指しで「移さない」とした3件（saveBookshelfForm/deleteBookshelf/addBookToBookshelf）＋その直接の付随処理。`bookshelfManager.update/create/rename/remove/addBookToBookshelf/removeBookFromBookshelf`の呼び出しとconfirmDialog・saveUserDataが主体＝データ操作が主 |
| 本棚の親子関係の計算・適用 | `_bookshelvesInTreeOrder`(4364-4387)・`_normalizeParentKey`(4563-4572)・`_applyReparentWithConfirm`(4575-4597) | `_bookshelvesInTreeOrder`は**js/dashboard.js:980-981でHomeウィジェットから直接呼ばれている**（grep実測・ツリー専用ではない共通計算）。`_normalizeParentKey`/`_applyReparentWithConfirm`は`bm.reparent`/`bm.previewReparent`呼び出しが主体のデータ操作（呼び出し元は`_onTreeDrop`(移動)と`saveBookshelfForm`(残留)の2箇所のみだが、Plan Aでは`this.X()`はファイルを跨いでも無変更で動くため分離に問題はない） |
| 本の一覧の描画（依頼の想定に反し共通部品と判明） | `updateDisplay`(2002-2029)・`_orderedBooksToRender`(2032-2052)・`_dedupKeysFor`(2058-2065)・`_bookCardKey`(2068-)・`_renderListDiff`・`renderStandardView`(2291-)・`createBookElement`(2377-) | **grep実測：`updateDisplay`はbookshelf.js内20箇所から呼ばれ、フィルタ変更・ソート変更・取込・除外・本棚切替等あらゆる操作後の再描画フックで、本棚一覧画面専用ではない**。さらに`js/plugin-api.js:330,335,340`が`this._app.updateDisplay()`を直接呼ぶプラグイン契約の窓口。②指示どおり「複数の画面から呼ばれている関数は移さない」＝`js/ui/book-list.js`(U6・#523)と同じ「共通部品」扱い。`createBookElement`はカードDOM生成の入口で、HTML本体のテンプレートは既に`js/ui/book-list.js`の`cardInnerHtml`へ分離済み（#523）、呼び出し元である一覧描画エンジン自体も画面専用ではないため残す |
| 本棚カードの描画・本棚概観（依頼の想定に反し共通部品と判明） | `renderBookshelfOverview`(7236-7249)・`_bindBookshelfOverviewEvents`(7255-7279)・`_renderBookshelfCard`(7284-7352) | **grep実測：`_renderBookshelfCard`と`_bindBookshelfOverviewEvents`はjs/dashboard.js:990,996,1001-1002からHomeの「本棚ハイライト」ウィジェットが直接呼んでいる**（`_bindBookshelfOverviewEvents`のJSDoc自身が「renderBookshelfOverview / dashboard 本棚ハイライトウィジェット 共通」と明記）。`renderBookshelfOverview`自身は`renderBookshelfOverview`冒頭のコメント「ホーム=ダッシュボードに置換されたため、旧#bookshelves-gridは使わない...互換のため呼出は受け付けるが何もしない」のとおり、DOM対象(`#bookshelves-grid`)が存在せず**実質no-op**（旧Home画面の名残で、本棚の一覧画面(モーダル)とは別物）。3件とも「本棚の一覧画面」固有ではなくHome(ダッシュボード・対象外)と共有/依存するため残す |

**呼び出し元一覧（②指示・U8e「ホームの概観」での共通部品の置き場所を決める材料）**：

| 関数 | bookshelf.js側の呼び出し元 | dashboard.js側の呼び出し元 |
|---|---|---|
| `_renderBookshelfCard` | 7247行（`renderBookshelfOverview`内・实質no-op経路） | 990行（`synthAll`の合成カード）・996行（`ordered`を回すループ） |
| `_bindBookshelfOverviewEvents` | 7248行（`renderBookshelfOverview`内・实質no-op経路） | 1002行（`gridHost`へバインド。コメント「既存の_bindBookshelfOverviewEventsを流用」） |

→ 実際に生きている呼び出し元はdashboard.js側の2関数4箇所のみ（bookshelf.js側は到達しないno-op経路）。U8eで本棚カードの共通部品を切り出す際は、**現状の定義元(bookshelf.js)をどこに置くかよりも、dashboard.jsとの依存関係（dashboard.js→bookshelf.jsのthis.appへの呼び出し）をどう解消するかが論点**になる。
| 本棚ビューのヘッダー・ナビゲーション本体 | `_bookshelfDescription`(4958-4961)・`_updateBookshelfViewTitle`(4966-5000前後)・`updateBookshelfSelector`(4014-4022)・`switchBookshelf`(4024-) | `_bookshelfDescription`は上記`_renderBookshelfCard`(残留)が使う共通ヘルパー。`_updateBookshelfViewTitle`は本棚一覧画面でも本棚ツリーでもなく「現在表示中の本棚」の見出し(メイン画面側)の更新で依頼の4分類に無い。`updateBookshelfSelector`は`_renderSidebarTree()`呼び出し後に`this.dashboard.render()`も呼ぶ横断フック。`switchBookshelf`は**`js/plugin-api.js:393`の`this._app.switchBookshelf`という正式なプラグイン契約窓口**かつコマンドパレット・空状態アクション・ツリー・ダッシュボードカード等多数の画面から呼ばれる中核ナビゲーション |
| ソート・フィルタの計算本体（依頼で明示） | `applyFilters`等 | 依頼本文で明示 |

## 3. 委譲の対象（テストが直接触っている名前）

grep実測（`window.bookshelf.<name>()`または`bookshelf.<name>()`形式でテストから直接呼んでいるものだけを対象）：

| 名前 | 箇所数 |
|---|---|
| `showBookshelfManager` | 4 |
| `addBookshelf` | 1 |
| `showBookshelfForm` | 6 |

他10件（`closeBookshelfModal`/`renderBookshelfList`/`closeBookshelfForm`/`editBookshelf`/`_reopenBookshelfForm`/`setupBookshelfDragAndDrop`/`_renderSidebarTree`/`_onTreeDrop`/`_openTreeNodeMenu`/`_updateSidebarActive`）はテストからの直接呼び出し0件（UI操作経由のみ）。

**「委譲」の数（②承認済みの解釈＝U8a〜U8cと同じ）**：Plan Aでは委譲ラッパーを新規に書かない。「テスト・プラグインが直接触れていて、移動後も同じ名前で動くことを確認した対象」の数＝**3種（showBookshelfManager・addBookshelf・showBookshelfForm、計11箇所）**。

## 4. 画面外から直接触っている箇所（plugin-api.js・index.html）

- `js/plugin-api.js`：移す13メソッドへの参照は**0件**（grep実測）。
- `index.html`：移す13メソッドの参照は**0件**（grep実測）。

**Plan Aであれば、これらは一切変更不要**。

## 5. tests/配下の`bookshelf._`参照の総数（基準値）

**355件**（§0と同じ・基準値と一致）。移す13メソッドのうち`_`接頭の4件（`_renderSidebarTree`/`_onTreeDrop`/`_openTreeNodeMenu`/`_updateSidebarActive`/`_reopenBookshelfForm`）はテストから`bookshelf._`形式で直接呼ばれていない（§3で実測済み・0件）。この計測・移動作業はテストファイルを一切編集しないため、step3の再計測でも355件以下であることを確認する。

今後の計測コマンド（U8b/U8cと同じ対象範囲）：
```
grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l
```

## 6. 範囲内のstatic/getter/setter/クラスフィールドの grep 全数検査（#537の落とし穴対応）

ファイル全体に対し`^ {4}(static |get |set )`と`^ {4}[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^(]`（bare class field）の正規表現で機械的に検査：

- static群9件（4671-4942行）・getter`_modalHistStack`(6381行）がヒット。bare class fieldは0件（ファイル全体）。
- 移す13メソッドの行範囲（4389-4494, 4499-4558, 4602-4659, 5331-5420, 5422-5506, 5589-5594, 6587-6592, 7457-7477）に対し同じ正規表現で検査：**全範囲でヒット0件**。static群(4671-4942)とgetter(6381)は、いずれも移動範囲の外側にあることを確認済み（§0のベーススナップショットとも整合）。

## 7. まとめ

- 移す：13メソッド・約427行（js/screens/bookshelf-list.js へ）
- 移さない：本棚データの保存・削除・追加・親子関係計算（依頼で明示 or BookshelfManager操作）、本の一覧描画エンジン・本棚カード描画（実測でHome/ダッシュボードと共有と判明）、本棚ビューのヘッダー・ナビゲーション中核（switchBookshelf等・プラグイン契約窓口）
- 2イシューへの分割：不要（U8cの約722行より少ない約427行）
- static/getter/setter/クラスフィールドの範囲内混入：0件
