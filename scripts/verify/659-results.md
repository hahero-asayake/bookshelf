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

### 場所（e798de8 の js/bookshelf.js）

- `_initPullToRefresh()`（L5252）の中だけ。
  - L5263-5269: 「並べ替えのドラッグ中か」を見る `reordering()`（L5267）、印を引っ込める `hide()`・`retract()`。
  - L5273: touchstart でドラッグ中なら、そのタッチは扱わない。
  - L5286-5288: touchmove で、下へ動かす preventDefault の後、ドラッグ中（またはそのタッチの途中でドラッグ中だった＝`byReorder`）なら印を出さずに返す。
  - L5298: touchend・touchcancel で、ドラッグ中だったタッチは再読込しない。
- 既存の2か所（横の移動が大きい時・上へ動かした時）の「引っ込める」は、同じ中身の `retract()` に置き換えただけ（動きは同じ）。

### その他

- index.html の bookshelf.js の `?v=` を 2026111730 にした（origin/main 16c0a10 は 2026111710。作業中の他の worktree の最大は #622 の 2026111722）。
- 設計書: 04_画面設計書 の PWA の行（pull-to-refresh の決まり・「横の移動が縦より大きい touchmove は引っ張り更新にしない」の続き）に、「並べ替えのドラッグ中 (本のつまみ・ホームのウィジェット) も引っ張り更新にしない＝印を出さず、離しても再読込しない」を足した。03_詳細設計書 は `_initPullToRefresh()` の名前があるだけなので、変えていない。

## §3 変異検査・関係する spec・lint・vitest（step3）

測った版: e798de8（1a1b3ee の上・origin/main 16c0a10 の上）。2026-11-14 17:27〜17:29 JST。chromium（390×844・hasTouch・isMobile・CDP のタッチ）。

### 変異検査（js/bookshelf.js だけを 1a1b3ee の版＝直す前に戻す・index.html と spec はそのまま）

| 場面 | 直す前に戻した時（`--repeat-each=3`） | 修正に戻した後（`git checkout -- js/bookshelf.js`・`--repeat-each=3`） |
|---|---|---|
| (A) つまみを下へ 120px | 3/3 赤（load 1回） | 3/3 緑（load 0回・並び [1,2,3] のまま・`.dragging` が付いた） |
| (A2) つまみを下の段の本の上まで | 3/3 赤（load 1回） | 3/3 緑（load 0回・並び [2,1,3]） |
| (B) 対照：空いた所から下へ 120px | 3/3 緑（load 1回＝再読込される） | 3/3 緑（load 1回） |
| (C) つまみを下へ 50px | 3/3 緑（load 0回） | 3/3 緑（load 0回） |
| (D) ホームのウィジェットを長押しして下へ 120px | 3/3 赤（load 1回） | 3/3 緑（load 0回・`.is-dragging` が付いた） |

- 合計: 戻した時は 9 failed・6 passed、修正に戻した後は 15 passed。修正だけで赤と緑が入れ替わる（記録は `_local/659/probe-mutation.jsonl`・`probe-restored.jsonl`）。

### 関係する spec（修正の版・`--workers=4`）

- 流したもの: tests/e2e/touch-reorder.spec.js・tree-drop-stays-home.spec.js・book-detail-shelf-meta.spec.js・smoke.spec.js・dashboard-stats-after-manual-add.spec.js・ux-u4-contrast.spec.js（chromium）と、ホームのウィジェットの並べ替えを含む tests/e2e/char/widgets.spec.js・char/x2-widgets.spec.js（char の6端末＝390/768/820/1024 はタッチ・1440/1920 はマウス）。
  - 探し方: `git grep -l -E "dashboard-widget|widget-grip|bookshelf-drag-handle|setupBookshelfDragAndDrop|drag-handle|_bindPointerReorder|is-dragging" -- tests/e2e/`。
- 結果: **129 passed・0 failed**（1.2分）。
- 既存の引っぱって更新の spec: もう一度 `git grep -i -E "ptr-indicator|pull-to-refresh|PullToRefresh|下に引いて更新|離して更新" -- tests/` で探した。当たったのは新しい spec だけ（既存は0件）。なので「空いた所からの引っぱりは今までどおり効く」は、新しい spec の (B) が見張る。

### lint・vitest・check:version（修正の版）

- `npm run lint`: **12 本中 0 本失敗**。
- lint:esc: 修正の前（1a1b3ee・step1）も後（e798de8）も「js/ 配下に Esc の判定の直書きは無い（例外: js/ui/reorder.js）」＝直書き0件・例外1件で同じ。
- `npm test`（vitest）: Test Files 78 passed・Tests 1176 passed / 2 todo（失敗0）。
- `npm run check:version -- --range=origin/main..HEAD`: OK（変更された js/css はすべて `?v=` がバンプ済み。vendor の未参照の警告は前からある・exit code に影響しない）。

## §4 全体の回帰と仕上げ（step4）

### 載せ直し（rebase）

- origin/main 1234cf4（#654 が入った版）へ載せ直した（d55a774 test・a91d2bb fix・443fdfb docs）。
- ぶつかったのは index.html の bookshelf.js の `?v=` の1行だけだった。js/bookshelf.js は自動で合わさった（#654 の hunk と離れている）。
- `?v=` は 2026111740 に取り直した（1234cf4 の値は 2026111711。作業中の他の worktree の最大は 2026111734）。
- 載せ直した後、新しい spec は 15 passed（5場面×3回）。`check:version -- --range=origin/main..HEAD` も OK。

### origin/main との全件比較（e2e-diff-main）: 2回とも完走しなかった

- 1回目（17:31 開始・base は origin/main 1234cf4）: base 側の E2E を流している途中で、前の run の終わりと一緒に止まった。3表は出ていない。
- 2回目（17:36:37 開始・`--port=8159 --out=_local/659/e2e-diff2`・base は origin/main 1c99d78。その間に #656 が入った）: 9分たっても base 側の E2E 全件の途中だった。
  - この時、マシンの負荷は load average 100（16コア）で、playwright のプロセスが 271 あった。
  - work 側（この修正の版）まで、この run の締切（18:05）に終わらない。なので 17:46 に止めた（最大待ち時間 15 分の手前）。
- 3表（新しく落ちた・新しく通った・両方落ちた）は出ていない。流せなかったものは、work 側の E2E 全件と vitest の比較のすべて（base 側も途中）。
- 代わりに確かめたもの（この修正の版）:
  - 新しい spec: 15 passed（載せ直した後）
  - 関係する spec: 129 passed（§3・載せ直す前の版）
  - `npm run lint`: 12 本中 0 本失敗（§3）
  - vitest: 1176 passed（§3）
- 止めた後の後始末:
  - 残っていた http.server（8159・この run が起こしたもの）を止めた。
  - 一時の worktree 2つ（`_local/659/e2e-diff`・`e2e-diff2` の `_worktree-base`）は `_trash/659-e2e-diff-run1`・`run2` へ移し、`git worktree prune` で登録を外した。

### この後に要ること

- push はしていない（brief の指示）。
- origin/main は、さらに fa4f41f（#656 が入った版・bookshelf.js の `?v=` は 2026111721）まで進んでいる。push する時は、もう一度載せ直し、`?v=` が origin/main と作業中の値より新しいかを確かめる。
- 全件比較は、負荷の低い時に流し直す必要がある。

## §5 #665 での載せ直し・全件比較・push の前の確認

イシュー#665 で、§4 の「この後に要ること」を片付けた。

### 載せ直し（cherry-pick）

- origin/main f9468f8（#622 が入った版）を base にした。issue/665 に `git cherry-pick 1234cf4..b2cc7ad` で4つを載せた（issue/659 の rebase と同じ結果。issue/659 は b2cc7ad のまま残した）。
  - 142542c test（元 d55a774）・762dce1 fix（元 a91d2bb）・6db37ee docs（元 443fdfb）・e73326e docs（元 b2cc7ad）。trailer はどれも `Issue: #659` のまま。
- ぶつかったのは、762dce1 の index.html の bookshelf.js の `?v=` の1行だけだった。js/bookshelf.js は自動で合わさった（main 側の #656 の +4行は `_decideLoadedState` の中で、離れている）。
- `?v=` は 2026111763 に取り直した。解く直前（18:02）に集めた値は次のとおり。
  - origin/main: 2026111721
  - 作業中の worktree: issue-660 2026111762（未コミット）・653 2026111753・645 2026111746・634 2026111734・657 2026111730・662 2026111722・651/664/666/667/668 2026111721・663 2026111711
- 載せ直した後の差分は4ファイルだけ（index.html・js/bookshelf.js・659-results.md・pull-to-refresh-drag.spec.js）。js/bookshelf.js の差分は L5298〜5336 で、どれも `_initPullToRefresh`（L5290〜5355）の中にある。元の差分（1234cf4..b2cc7ad）と1行も違わない。#654 の spec と hunk には触れていない。

### 手元の検査（載せ直した版・PORT=8165）

- 新しい spec（`--repeat-each=3`）: 15 passed（16.3 秒）
- `npm run lint`: 12 本中 0 本失敗。lint:esc は「直書き無し（例外: js/ui/reorder.js）」で、数は変わっていない
- `npm test`（vitest）: 79 ファイル・1181 passed・2 todo
- `npm run check:version -- --range=origin/main..HEAD`: OK

### 負荷の待ち

- §4 で完走しなかったのは負荷のためだった。そこで、1分値が 32（16 コアの2倍）以下を2回続けて見てから流した。

| 時刻 | 1分値 | playwright のプロセス数 |
| --- | --- | --- |
| 18:04:59 | 61.94 | 334 |
| 18:05:59 | 76.35 | 309 |
| 18:06:59 | 68.56 | 287 |
| 18:07:59 | 69.99 | 260 |
| 18:08:59 | 58.05 | 265 |
| 18:09:59 | 53.22 | 176 |
| 18:10:59 | 42.66 | 142 |
| 18:11:59 | 29.09 | 205 |
| 18:13:00 | 18.96 | 117 |

- 待ったのは約8分（最大 30 分のうち）。流し始めた 18:13:17 の1分値は 14.40 だった。

### origin/main との全件比較（e2e-diff-main）: 完走した

- 流したもの: `node scripts/verify/e2e-diff-main.mjs --base=f9468f8 --port=8165 --out=_local/665/e2e-diff`（18:13〜18:27:47）。
  - base は既定の origin/main にせず、載せ直しの base の f9468f8 にした。流す直前に origin/main が 36cf113（#645 が入った版）へ進んでいたため。既定のままだと、#645 の差分まで比べることになる。
- 件数: base は 1081 passed・9 failed・593 skipped（約 7.7 分）。work は 1095 passed・0 failed・593 skipped（約 5.4 分）。work が5件多いのは、新しい spec の5場面の分。

| 区分 | 新しく落ちた | 新しく通った | 両方で落ちた |
| --- | --- | --- | --- |
| E2E（playwright・sort-perf-budget は既定の除外） | 0 | 9 | 0 |
| Unit（vitest） | 0 | 0 | 0 |

- 画像の差分（playwright.visual.config.js・work 側だけ）: 54 件中 0 件。判定不能: 0 件。
- 新しく通った9件は、base 側だけで落ちたもの。base を流した 18:13〜18:21 は、まだ1分値が 40〜50 台だった。この修正と関係しない負荷の揺れと見た。
  - book-memo-file-lifecycle×2・gate/j3-5-many-books・icons-vendor・list-staged-render×2・no-external-icons・save-failure-visible・sync-offline-reconnect
- 新しく落ちたものが0件だったので、単独で3回流す切り分けは要らなかった。

### push の判断

- 新しく落ちたもの 0 件・vitest 0 件・画像の差分 0 件なので、push してよいと判断した。②の確認を取ってから push する。
- push の直前に、もう一度 fetch する。main が 36cf113 より先へ進んでいたら、進んだ分が `_initPullToRefresh` に触れていないかを確かめる。index.html は、bookshelf.js の `?v=` の行の外でぶつかっていないかを確かめる。触れていなければ、載せ直して lint・check:version・新しい spec だけを流し直す。

### push の直前の載せ直し

- push の直前（18:29）に fetch すると、origin/main は 72d31cb まで進んでいた（#657・#634・#645・#662・#651 の34 commit）。進んだ分は `_initPullToRefresh`（main 側の L5383〜5437）に触れておらず、index.html は bookshelf.js の `?v=` の行だけがぶつかった。そこで載せ直し、`?v=` は main がもう 2026111764 を使っていたため、作業中の worktree の最大（issue-667 の 2026111780）の次の 2026111781 に上げた（5d755ba・`Issue: #665`）。
- 載せ直した版での流し直し: lint は 12 本中 0 本失敗（lint:esc は変わらず）。`check:version -- --range=origin/main..HEAD` は OK。新しい spec（`--repeat-each=3`）は 15 passed。
