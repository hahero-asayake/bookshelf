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

## §2 修正（step2・案1）

### 直したこと

- 直したのは js/bookshelf.js の `_initPullToRefresh()` の中だけ。ドラッグの実装（#654 が触る `_onBookPointerDown`・`_cancelBookPointerDrag`・カードの click・長押しの口）と js/ui/reorder.js には触っていない。
- 「並べ替えのドラッグ中か」＝ `this.draggedElement`（本のつまみ）か、body 直下の `.drag-ghost`（Reorder。ドラッグの開始 `beginDrag` で置き、終わり `finishDrag` で外す。本のつまみも同じ名前のゴーストを置く）。
  - .drag-ghost は、両方の実装で「ドラッグが始まった時に必ず置き、終わった時に必ず外す」ことを確かめた（js/ui/reorder.js の `beginDrag`・`finishDrag`、js/bookshelf.js の `_onBookPointerDown`・`_cancelBookPointerDrag`）。なので reorder.js に口は足していない。
- touchstart でドラッグ中なら、そのタッチは引っぱりとして扱わない。touchmove・touchend でドラッグ中（またはそのタッチの途中でドラッグ中だった）なら、印を出さず、離しても再読込しない。
- 空いた所からの引っぱり（しきい値 72px・離して 350ms 後の再読込・横の移動が大きい時は扱わない）は変えていない。

### 計画と変えた所: preventDefault は続ける

- 計画では「ドラッグ中は preventDefault もしない」としていた。最初はその形で直したが、(D) ホームのウィジェットが3回とも「離す前に並べ替えが終わっていた」（`.is-dragging` が無い）になった（`_local/659/probe-step2-v1.jsonl`）。
- 原因: Reorder は長押しの後に `touch-action: none` を付けるが、ブラウザはタッチの始まりで決めた扱いを変えない。下へ動かした touchmove を誰も止めないと、ブラウザのスクロールが始まり、ポインタが pointercancel で終わる。これまでは引っぱって更新の preventDefault が、たまたまそれを止めていた。
- そこで、下へ動かす touchmove の preventDefault は今までどおり続け、印と再読込だけを止める形にした。並べ替えの動きはこれまでと同じで、離した後に再読込されないことだけが変わる。
- 別に分かったこと（このイシューの外）: ページの先頭以外・上へ動かす時は、この preventDefault が無い。なので、ホームのウィジェットのタッチの並べ替えは、ブラウザのスクロールに取られて途中で終わる見込み（未測定）。本のつまみは CSS で `touch-action: none` なので当たらない。

### (A) に足した確かめ

- (A) は「離す前に `.dragging` が付き、その後 1.5 秒の間に再読込されない・置いた印が残る」を確かめる（120px 先は1冊目のカードの中なので、並びは変わらない）。
- 並びの確かめは (A2) として足した。1冊目のつまみを、下の段の3冊目の上まで運んで離す（390幅では2列に並ぶ。2冊目の前へ入れても並びは変わらないので2冊目は選ばない）。並びは [1,2,3] から [2,1,3] に変わり、再読込されない。

### 結果（`--repeat-each=3`・修正の後）

| 場面 | 修正の前（step1） | 修正の後 |
|---|---|---|
| (A) つまみを下へ 120px | 3/3 赤（再読込された） | 3/3 緑（`.dragging` が付いたまま・印が出ない・load 0回・置いた印が残る） |
| (A2) つまみを下の段の本の上まで | （step2 で足した） | 3/3 緑（並びが [2,1,3] に変わり、load 0回） |
| (B) 対照：空いた所から下へ 120px | 3/3 緑 | 3/3 緑（再読込される） |
| (C) つまみを下へ 50px | 3/3 緑 | 3/3 緑 |
| (D) ホームのウィジェットを長押しして下へ 120px | 3/3 赤（再読込された） | 3/3 緑（`.is-dragging` が付いたまま・load 0回） |

### その他

- index.html の bookshelf.js の `?v=` を 2026111730 にした（origin/main 16c0a10 は 2026111710。作業中の他の worktree の最大は #622 の 2026111722）。
- 設計書: 04_画面設計書 の PWA の行（pull-to-refresh の決まり・「横の移動が縦より大きい touchmove は引っ張り更新にしない」の続き）に、「並べ替えのドラッグ中 (本のつまみ・ホームのウィジェット) も引っ張り更新にしない＝印を出さず、離しても再読込しない」を足した。03_詳細設計書 は `_initPullToRefresh()` の名前があるだけなので、変えていない。
