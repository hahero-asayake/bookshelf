# イシュー#659 タッチで並べ替えのドラッグを下へ運ぶと「引っぱって更新」が働き、ページが再読込される

測った版: origin/main 16c0a10（2026-11-14 17:15 JST に fetch・worktree の HEAD も同じ）。spec: `tests/e2e/pull-to-refresh-drag.spec.js`。
端末: chromium（390×844・hasTouch・isMobile）。タッチは CDP の `Input.dispatchTouchEvent`（ブラウザのタッチ→ポインタの変換を通る）。本は3冊・すべての本・並びは custom。
記録: spec が場面ごとに `_local/659/probe.jsonl` へ書く（離す前に並べ替えが始まっていたか・引っぱって更新の印・離してから 1.5 秒の間の load の回数・置いた印が残ったか）。

## §1 再現の確認（step1）

### 結論

- **再現した**。一覧の先頭で本のつまみ（`.drag-handle`）を下へ 120px 運んで離すと、並べ替えのドラッグが動いている最中にもかかわらず「引っぱって更新」が働き、ページが再読込された（3回中3回）。
- **同じ種類のホームのウィジェットの並べ替えでも再現した**（3回中3回）。CDP のタッチで Reorder の並べ替えはふつうに始まった（`.dashboard-widget.is-dragging` が付いた）。touch-reorder.spec.js 冒頭の「CDP では並べ替えが起動しなかった（#337）」は、この形（hasTouch・isMobile の context）では当たらなかった。
- 対照（カード以外の空いた所からの引っぱり）は3回とも再読込された＝この環境で引っぱって更新は効いている。なので (A)・(D) の赤は判定に使える。
- 72px 未満（50px）では再読込されない（3回中3回）。

### 場面ごとの表（3回ずつ・`--repeat-each=3`）

| 場面 | 始める所 | 運ぶ量 | 離す前に並べ替えが始まっていたか | 離す前に「離して更新」の印（is-armed） | 離した直後に「更新中」の印（is-refreshing） | 1.5 秒の間の load | 置いた印 | 結果（いまの main） |
|---|---|---|---|---|---|---|---|---|
| (A) 本のつまみ | 1冊目の `.drag-handle`（x=170, y=144） | 下へ 120px | 3/3 始まっていた（`.book-item.dragging`） | 3/3 付いた | 3/3 付いた | 3/3 で 1回 | 3/3 消えた | **3/3 再読込された＝赤（再現）** |
| (B) 対照: 空いた所 | `header.bookshelf-view-header`（x=20, y=60） | 下へ 120px | — | 3/3 付いた | 3/3 付いた | 3/3 で 1回 | 3/3 消えた | 3/3 再読込された＝緑（期待どおり） |
| (C) 本のつまみ（しきい値の下） | 1冊目の `.drag-handle` | 下へ 50px | 3/3 始まっていた | 3/3 付かない | 3/3 付かない | 3/3 で 0回 | 3/3 残った | 3/3 再読込されない＝緑 |
| (D) ホームのウィジェット（Reorder・長押し 600ms） | 1つ目の `.dashboard-widget` のつまみ（x=41, y=160）・レイアウト編集中 | 下へ 120px | 3/3 始まっていた（`.dashboard-widget.is-dragging`） | 3/3 付いた | 3/3 付いた | 3/3 で 1回 | 3/3 消えた | **3/3 再読込された＝赤（再現）** |

- (A) は、つまみのドラッグ（`_onBookPointerDown`）が pointerdown で始まった後も、引っぱって更新の touchstart・touchmove が同じタッチを「引っぱり」として扱い続けていた。離した 350ms 後に `location.reload()` が走り、並べ替えの結果を見る前にページが作り直された（記録の `orderAfter` は再読込のため取れない）。
- (D) はホームの「レイアウト編集」の最中に再読込され、編集の状態も消える。
- 最初の実行では (B) の始める所を「最後のカードの 60px 下」にしたが、そこは `.app-main-pane` の外（ボタン）だった。始める所を `#view-bookshelf` の中から探す形に直して流し直した（上の表はその実行。(A)・(C) は両方の実行で同じ結果）。

### 同じ種類の箇所（並べ替えのドラッグ）の一覧

引っぱって更新のリスナーは `.app-main-pane`（index.html L168-339）に付く。タッチのイベントは、指を置いた要素から祖先へだけ伝わる。なので、この section の中で始まる並べ替えだけが当たる。

| 並べ替え | 実装 | 始まり方（タッチ） | 置き場所 | 当たるか |
|---|---|---|---|---|
| 本のつまみ | js/bookshelf.js `_onBookPointerDown`（L2491） | pointerdown で即 | `#view-bookshelf`（pane の中） | **当たる（(A) で実測）** |
| ホームのウィジェット | js/dashboard.js L568 `this.app._bindPointerReorder(grid, …)`（レイアウト編集中だけ・`canDrag: () => this.editMode`） | 長押し 450ms | `#view-main`（pane の中） | **当たる（(D) で実測）** |
| 本棚ツリー | js/screens/bookshelf-list.js L118 | 長押し | `aside#app-sidebar`（index.html L114-162・pane の外） | 当たらない（DOM の構造で確認・実測なし） |
| 本棚管理モーダル | js/screens/bookshelf-list.js L451 `setupBookshelfDragAndDrop`（`.bookshelf-drag-handle`） | pointerdown で即 | `#bookshelf-modal`（index.html L797・pane の外） | 当たらない（同上）。計画では「本棚カード」と書いたが、`.bookshelf-drag-handle` は本棚管理モーダルの中だった |
| 本の詳細の bd-section | js/screens/book-detail.js L89 | 長押し | `aside#app-detail`（index.html L345-356・pane の外） | 当たらない（同上） |
| 設定のヘッダー utility 行・プラグイン一覧 | js/screens/settings.js L1967・L2479 | 長押し | `#settings-modal`（index.html L372・pane の外） | 当たらない（同上） |
| 記事エディタのキャンバス | js/screens/article-editor.js L2415 | つまみの pointerdown | `#art-edit-view`（index.html L879・`</main>` L369 の後＝pane の外） | 当たらない（同上） |

### 修正の案（②の tp で決める）

- **案1（推奨）**: 引っぱって更新の側の1か所（js/bookshelf.js `_initPullToRefresh`）で、touchstart・touchmove・touchend の各時点に「並べ替えのドラッグ中か」を見る。ドラッグ中なら働かせない（印を引っ込め・preventDefault せず・再読込しない）。
  - 本のつまみは `this.draggedElement`（`_onBookPointerDown` で立ち、`_cancelBookPointerDrag` で null に戻る）を見る。
  - Reorder（ホームのウィジェット）はドラッグ中の印を見る。ドラッグ中は両方とも body 直下に `.drag-ghost` を置く（js/bookshelf.js L2508・js/ui/reorder.js L244）。または reorder.js に「ドラッグ中か」を返す口を足す。
  - 長押しで始まる並べ替え（(D)）は、touchstart の時点ではまだドラッグ中でない。なので touchmove・touchend でも見る必要がある（(D) で確かめられる）。
  - ドラッグの実装（#654 が触る `_onBookPointerDown`・`_cancelBookPointerDrag`）には手を入れない。
- **案2**: ドラッグする側が共通の印（body のクラス等）を立て、引っぱって更新はそれだけを見る。入口が増えても見る所は1つで済むが、#654 の hunk に隣接し、reorder.js も触る。
- 「touchstart でつまみをセレクタで除く」だけの案は採らない。長押しで始まる (D) を拾えない。カスタム順でない時（つまみが効かない時）の引っぱりまで止めてしまう。

### この時点の lint

- lint:esc: 「js/ 配下に Esc の判定の直書きは無い（例外: js/ui/reorder.js）」＝修正の前の数（0件・例外1）。step3 で修正の後の数と比べる。
- lint:e2e-wait・lint:e2e-external・lint:e2e-goto・lint:internal-refs（上限82以内）・lint:known-red: すべて OK（新しい spec を足した状態）。

### 未測定

- webkit（iPhone）: Playwright の WebKit には本物のタッチを動かす口が無い（#654 の記録）。pointerdown と touchstart のどちらが先に来るかも分からない。
