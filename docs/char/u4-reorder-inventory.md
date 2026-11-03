# U4 step1：_bindPointerReorder 共用6か所・独自ドラッグの一覧（実コード調査）

実コード（origin/main e2a408b、js/bookshelf.js・js/dashboard.js）を grep して確定した。
499-step3-arch.md §4-3（87行）・499-step4-plan.md §4 U4（51行）は「独自のドラッグ5つ」と
数のみ言及しているが、両ファイルとも5つの内訳を列挙していない（87行は代表例を1件挙げる
のみ・§2-2g という見出しは499のどのファイルにも実在しない＝正本側の記載ミスの可能性）。
下記は実コードの grep で確認できた範囲＝**4つ**。差の1件は見つからなかった
（調査範囲・方法は末尾「探索範囲」に記録。U7/U8着手時に再確認が必要）。

## 1. `_bindPointerReorder` を共用する6か所（このイシューで reorder.js へ移す対象）

| # | 呼び出し元メソッド | ファイル:行 | 画面・用途 |
|---|---|---|---|
| 1 | `_bindDetailSectionReorder` | js/bookshelf.js:2990 | 本の詳細パネルのセクション（bd-section）並べ替え |
| 2 | `_renderSidebarTree` | js/bookshelf.js:6592 | サイドバーの本棚ツリー（L3） |
| 3 | `_bindSidebarUtilityDnD` | js/bookshelf.js:7509 | サイドバーのヘッダーutility行 |
| 4 | `_bindPluginListEvents` | js/bookshelf.js:8027 | プラグイン一覧 |
| 5 | `setupBookshelfDragAndDrop` | js/bookshelf.js:15387 | 本棚管理モーダル（L5） |
| 6 | （ウィジェットグリッド） | js/dashboard.js:448（`this.app._bindPointerReorder`） | ホームダッシュボードのウィジェット（W3） |

定義本体：`js/bookshelf.js:2711`（コメント2688-2690行に「サイドバーツリー・ヘッダーutility行・
プラグインカード・本棚管理モーダル・bd-sectionの5箇所で共有」と明記、+ dashboard.js 側を
加えて6か所。briefの「6か所」と一致）。

## 2. 独自のドラッグ（`_bindPointerReorder` を使っていない）：確認できた4つ

| # | 実装 | ファイル:行 | 画面・用途 | 移す予定 |
|---|---|---|---|---|
| A | `_onBookPointerDown`/`_onBookPointerMove`/`_onBookPointerUp`（ハンドル`.drag-handle`、`reorderBooks`） | js/bookshelf.js:2515（起動）, 2562-2690（本体） | 本棚ビューの本カード並べ替え（カスタム順） | U8（本棚の一覧とツリー、と一緒） |
| B | キャンバスビューのブロックつまみ（`.art-cv-grip`、`doc.addEventListener('pointerdown', …)`→`_artMoveBlock`） | js/bookshelf.js:10097-10140 | 記事エディタ：キャンバスビューのブロック並べ替え | U7（記事エディタ、と一緒） |
| C | `_artBindDrag` 呼び出し①（`.art-shelf-item-grip`→`_artReorderShelfItems`） | js/bookshelf.js:11383（呼び出し）, 11441（`_artBindDrag`本体） | 記事エディタ：本棚ブロック内の本リスト項目の並べ替え | U7 |
| D | `_artBindDrag` 呼び出し②（`.art-block-grip`→`_artReorderBlocks`） | js/bookshelf.js:11388（呼び出し）, 11441（`_artBindDrag`本体） | 記事エディタ：ブロック全体の並べ替え | U7 |

`_artBindDrag`（js/bookshelf.js:11441 定義）はC・Dの2用途で共有される記事エディタ専用の
汎用D&Dヘルパーで、`_bindPointerReorder`とは別実装（コメント11434-11440行に明記）。

## 3. 数が合わない点（5つ中4つ）

- 探索方法：`grep -n "pointerdown\|pointermove\|mousedown\|mousemove"` を `js/*.js` 全体に実行
  （pointerdown/moveを使うのは bookshelf.js のみ）。`setPointerCapture`/`elementFromPoint`
  （本カード・_artBindDragの特徴的API）、`draggable=`/`dragstart`/`dragover`/`drop`
  （HTML5 DnD、index.html の Kindleブックマークレット1件のみ＝ブラウザネイティブの
  ブックマーク登録用でJS実装の並べ替えではないため対象外）も確認した。
- 見つかったのはA〜Dの4つのみ。5つ目は見つからなかった。
- 499-step3-arch.md 87行は「記事のブロックのつまみが独自のドラッグ（11330〜11377付近。
  §2-2g）」と1件のみ名指し（§2-2gという見出しは499-step1〜4のどのファイルにも実在しない）。
  499-step4-plan.md 51行（U4節）は数字「5つ」のみで内訳を書いていない。
- この差分はU4の完了条件（6か所の振る舞い確認・touch-reorder 11件・widgets W1〜W3）には
  影響しない（独自ドラッグはこのイシューでは移さない方針のため）。U7着手時に記事エディタ
  131メソッドを棚卸しする過程で、5つ目が見つかるか再確認が必要（見つからなければ正本の
  「5つ」が誤りだったとして報告する）。
