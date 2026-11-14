# イシュー#676 結果：list-staged-render.spec.js:109（#401 段階描画913冊・途中で1冊を動かす）が main の CI で赤

## §1 再現・赤くした commit・#674 との関係（step1・2026-11-14 19:01〜19:04）

### 流し方

- worktree `/home/kuroko/worktrees/bookshelf/issue-676`（issue/676 = origin/main 9713381）。chromium・workers=1・PORT=8176。
- `playwright test tests/e2e/list-staged-render.spec.js:109 --project=chromium --workers=1 --repeat-each=3`
- 負荷：load average 43.7（19:02）〜 25.6（19:03）・16 CPU。

### 再現（origin/main 9713381・3回）

| 回 | 結果 | 落ちた所 |
|---|---|---|
| 1〜3 | 3回とも失敗 | spec 67行 `expect(r.dom).toEqual(want)`（124行の `expectDomMatchesOrder` から） |

- 3回とも差は同じ：Expected −871行／Received +871行。
- 期待（`_orderedBooksToRender()`）の先頭は B000000001, B000000002, …（見本の「すべての本」の並び）。
- 実際の DOM の先頭は B000000786, B000000659, …（取得日の昇順＝画面の並びから1冊を抜いたもの）。
- 揺れではなく、決まって起きる退行と判定した。1回あたり約7秒で終わり、待ちの時間切れでもない。

### 赤くした commit

| commit | 題 | 3回の結果 |
|---|---|---|
| cfcd784（e71239b の親） | docs: 662-results.md に原因 …（#662） | 3 passed |
| e71239b | fix: 保存先につないだまま本を足し・取り込み・除外した直後に再読込しても、「すべての本」の冊数と記事の引き出しが古いまま残らないよう、本棚の books をいつも bookOrder.all と同じ配列にする（#662） | 3 failed（67行・差は同じ） |

- 赤くしたのは #662 の e71239b。親で緑・この commit で赤なので、bisect は要らなかった。

### 仕組み（probe・`tmp/676/zz-676-probe.spec.js`・commit しない）

| | cfcd784 | e71239b | origin/main 9713381 |
|---|---|---|---|
| 起動直後の bookOrder.all の長さ | 0 | 913 | 913 |
| 「すべての本」の books と同じ配列か | いいえ | はい | はい |
| 並べ替えの直前の sortOrder | acquiredTime | acquiredTime | acquiredTime |
| 並べ替えの直前に DOM に置かれた冊数 | 48 | 48 | 48 |
| 画面の並びの先頭 | B…913, B…786, B…659 | 同じ | 同じ |
| bookOrder.all の先頭 | （空） | B…001, B…002, B…003 | 同じ |
| 並べ替えの後、DOM と `_orderedBooksToRender()` が最初に食い違う位置 | なし | 0 | 0 |
| 動かした本の位置（DOM／描くべき並び） | 907／907 | 907／634 | 907／634 |

- e71239b で、`_ensureAllShelf`（js/bookshelf.js:4333〜）が「bookOrder.all が無い時は『すべての本』の books から作る」ようになった（前は `[]`）。起動の時に呼ばれる（js/bookshelf.js:538）。
- `reorderBooks`（js/bookshelf.js:2668〜）の起点は、「bookOrder[slug] に1冊以上あればそれ、無ければ filteredBooks（いま画面に出ている並び）」。
  - e71239b の後は、起点が見本の並び（B…001 から）になる。そこから1冊動かした並びが bookOrder.all に入る。
- 一方 `_moveBookElement`（js/bookshelf.js:5613〜）は、残りを置き切ってから、DOM の上で1冊だけ動かす。DOM は画面の並び（取得日の順）のまま。
- そのため、DOM（画面の並び＋1冊移動）と保存される並び（見本の並び＋1冊移動）が食い違う。
  - 並べ替えの後は custom に切り替わる。そのため、次に全件を描いた時（再読込など）に、画面が見本の並びへ跳ぶ。

### 「同じ配列か」ではなく「bookOrder.all が埋まっているか」で決まる（probe2・origin/main 9713381）

| 並べ替えの直前に差し替えたもの | bookOrder.all の長さ | 同じ配列か | DOM と描くべき並びが食い違う冊数 |
|---|---|---|---|
| 中身が同じ別の配列にする（同じ配列をやめた場合） | 913 | いいえ | 913（全部） |
| `[]` にする（#662 より前の起動直後と同じ） | 0 | いいえ | 0 |

### #674 との関係

- 19:02 の時点で、#674 は step1（再現と bisect）を実行中だった。
  - issue/674 ブランチには origin/main より先の commit が無い。直しの commit がまだ無いので、cherry-pick での実測はできなかった（未実測）。
  - 19:04 に見直すと、issue/674 に f2b9e70（docs: 674-results.md §1・first bad commit は #662 e71239b）が入っていた。赤くした commit はこの件と同じ e71239b。ただし results だけの commit で、直しはまだ無い。
- #674 の計画（DB の issues.plan）：
  - 原因の見立ては migrateUserData（js/bookshelf.js:6943〜）。付け直しの時に、本棚の books へ新しい ASIN を足す。その後で、同じ配列になった bookOrder.all の古い ASIN を置き換える。そのため新しい ASIN が2回入る。
  - 直し方の案は3つ。A＝migrateUserData で同じ配列を二度書かない／B＝処理済みの配列を Set で持つ／C＝spec の期待を直す。
  - **`_ensureAllShelf` そのものを変える方針ではない。**
- この件は付け直しの経路を通らない（並べ替えの起点の問題）。probe2 では、同じ配列をやめても食い違いが残った。そのため、#674 のどの案で直しても、この件は直らない見込み。
- 判定：**(b) 別に直す → step2 へ進む。**

### step2 への申し送り

- 起点の決め方（「bookOrder[slug] があれば使う」）は、#662 より前からある。
  - 自作の本棚は、読込の時に bookOrder[slug]=shelf.books になる（reorderBooks のコメント）。そのため、取得日の順などで見ている時に1冊動かすと、同じ食い違いが起きる見込み（未実測）。
  - 保存先から読んで bookOrder.all がある「すべての本」も同じ（未実測）。
- #674 と同じく js/bookshelf.js を触るが、関数が別（#674＝migrateUserData、この件＝reorderBooks のまわり）。

## §2 同じ種類の箇所の洗い出しと直し方の案（step2・2026-11-14 19:07〜19:13）

### 設計書の決まり（出典）

- 08_意思決定記録 **ADR-010「手動並び替えは『カスタム順』のときだけ」（2026-06-10・70〜72行）**。
  - 理由は「並び替えの起点が保存済み bookOrder のため、項目ソート中に動かすと見た目と反する結果になる」。
- 02_基本設計書 114〜115行：本の表示順（カスタム順）は、reorderBooks が現在の表示順を起点に動かす。手動 D&D は、並び替えが「カスタム順」のときだけ許す。
- 04_画面設計書 169行：カスタム順のときだけ `.drag-handle` が出る（`bookshelf.is-custom-order` の中だけ opacity:1）。`pointerdown` で始まる。
- 03_詳細設計書 121行：`reorderBooks` は「表示順起点で移動し books[] と bookOrder[] 両方へ書き戻し（D-4）」。
- コード：
  - `_onBookPointerDown`（js/bookshelf.js:2497〜）の先頭に `if (this.sortOrder !== 'custom') return;` がある（1ee835d・2026-06-28・P4）。
  - `_bulkMoveToFront`（:1595〜）も、カスタム順でなければ toast を出して止まる。ボタンもカスタム順のときだけ出す（:1511）。

### step1 の見立ての訂正

- step1 では「アプリの食い違いが表に出た」と書いた。これは誤り。**利用者の操作（ドラッグ）では、この食い違いは起きない**（下の P1）。
- list-staged-render.spec.js は 441cd65（2026-10-29・#401）で足された。上のガード（6月）より後。
- 109行のテストは、取得日の順のまま `reorderBooks` を直に呼んでいる。これは UI では作れない状態で、ADR-010 の外にある。
- #662 の前は bookOrder.all が空だったので、起点がたまたま画面の並びになり、通っていた。#662（ADR-166・bookOrder.all は順序の正）で bookOrder.all がいつも埋まるようになり、ADR-010 の理由に書かれたとおりの「見た目と反する結果」が出た。

### 洗い出し：並べ替えの起点を決める所

| 経路 | 場所 | 並び順の切替 | 起点 | 取得日の順などで動かせるか | 保存＝画面か |
|---|---|---|---|---|---|
| 本カードのドラッグ | `_onBookPointerDown` → `_onBookPointerUp` → `reorderBooks`（js/bookshelf.js:2497・:2571・:2668） | ある | bookOrder[slug]（空なら filteredBooks） | 動かせない（:2498 のガード・P1 で実測） | カスタム順では一致（P2・P3b で実測） |
| 先頭に移動（一括） | `_bulkMoveToFront`（:1595）→ `_shelfOrderedAsins`（:1581） | ある | bookOrder[key]＋残り（カスタム順の表示と同じ作り） | 動かせない（toast で止まる・ボタンも隠す） | 一致（コード読み） |
| 本の詳細の節 | screens/book-detail.js:77・:89（`_bindPointerReorder`・`.bd-section`） | ない | 画面の並び | 切替が無い | 一致（コード読み） |
| ホームのウィジェット | dashboard.js:568（`.dashboard-widget`） | ない | 画面の並び | 切替が無い | 一致（コード読み） |
| 本棚のツリー・一覧 | screens/bookshelf-list.js:118（`.tree-node`）・:451（`.bookshelf-item`） | ない（本棚の順は bookshelves 配列の順） | 画面の並び | 切替が無い | 一致（コード読み） |
| 設定のヘッダー項目・プラグイン | screens/settings.js:1969（`.header-item`）・:2481（`.plugin-card-v2`） | ない | 画面の並び | 切替が無い | 一致（コード読み） |

- 取込・手で追加（import.js:238〜・bookshelf.js:7292）は、bookOrder.all の先頭へ足すだけ。並べ替えではないので対象外。
- 並び順を切り替えられるのは本の一覧だけ。そこで動かす経路は2つとも、カスタム順のときだけに絞られている。

### 場面ごとの実測（probe3・`tmp/676/zz-676-probe3.spec.js`・commit しない）

| 場面 | origin/main（9713381） | cfcd784（#662 の前） |
|---|---|---|
| P1 すべての本・取得日の順・つまみを押して5冊目の上で離す（実マウス・1280幅） | ドラッグが始まらない。画面の先頭5冊・保存される並び・sortOrder（acquiredTime）は、どれも変わらない | 同じ |
| P1 自作の本棚（100冊）・同上 | 同じ | 同じ |
| P2 すべての本・カスタム順へ切り替えた直後に1冊動かす（390幅） | 切り替えた直後は48冊だけが置かれ（段階描画の途中）、ドロップ先はまだ置かれていない。置き終えた時の食い違いは0。動かした本はドロップ先の直前。bookOrder.all は913冊で重複なし | 切り替えても並びが変わらないので、段階描画にならない（913冊が置かれたまま）。食い違いは0 |
| P3b すべての本・カスタム順・検索「第1」で111冊に絞った最中に1冊動かす | 食い違いは0。動かした本はドロップ先の直前。bookOrder.all は913冊のまま（絞り込みで外れた802冊も残る・重複なし） | 流していない |
| P4 自作の本棚・取得日の順のまま `reorderBooks` を直に呼ぶ（UI では作れない） | 100冊すべてが食い違う | 100冊すべてが食い違う（#662 より前から同じ） |
| P4 すべての本（bookOrder.all あり＝保存先から読んだ形）・同上 | 913冊中911冊が食い違う | 913冊中911冊が食い違う（#662 より前から同じ） |

- P3（`page.fill` で検索欄に入れる形）は、検索欄が popover の中にあって見えず、60秒で時間切れになった。input イベントで入れる形（P3b・`tmp/676/zz-676-probe3b.spec.js`）に直して流し直した。
- まとめ：
  - 食い違いが起きるのは、「取得日の順のまま reorderBooks を直に呼んだ時」だけ。これは #662 より前からある。利用者の操作では、そこへ入れない（P1）。
  - #662 の後に変わったのは、「すべての本」で bookOrder.all が空の時（見本の形）も、保存先から読んだ形と同じになったことだけ。

### 直し方の案

#662 の決まり（bookOrder.all は順序の正で、冊数を減らす正ではない）を崩さないことを、必須の条件にした。

| 案 | 何を変えるか | 取得日の順で見ている時に1冊動かすと（期待の1行） | #662 の決まり | 絞り込みで外れた本 | 作り直しのコスト | 横展開 |
|---|---|---|---|---|---|---|
| **C'（推奨）** spec を ADR-010 の範囲に直す | list-staged-render.spec.js:109 を「カスタム順へ切り替えた直後（段階描画の途中）に、まだ置かれていない本へ1冊動かす」に直す。アプリは変えない | つまみを押して別の本の上で離しても、ドラッグが始まらない。画面の並びも保存される並び（bookOrder）も変わらず、取得日の順のまま | 崩さない（アプリを変えない） | 影響なし | 1冊だけ動かす（#359）のまま | 要らない（切替のある2経路は、もうカスタム順だけ） |
| D：C' ＋ reorderBooks の入口にもガード | C' に加えて、`reorderBooks` の先頭で「カスタム順でなければ何もしない」 | C' と同じ。直に呼んでも何も変わらない | 崩さない | 影響なし | 同じ | 同じ。ただし :2706〜 の「カスタム順へ自動で切り替える」行が使われなくなる |
| A：取得日の順でも動かせるようにする | ADR-010 を変える。つまみを常に出し、起点を画面の並びにする共通の口を作る | いま見えている取得日の順を起点にカスタム順へ切り替わり、その1冊だけが動く（画面と保存が一致） | 起点を画面の並びにする時、絞り込みで外れた本を bookOrder.all から落とさない作りが要る（崩すおそれがある） | 置き場所の決まりを新たに作る | 1冊だけ動かすのまま | 本カードと先頭に移動の2経路・設計書4つ（02・03・04・08） |
| B：起点はそのまま、食い違う時は全件を描き直す | `reorderBooks` | UI ではガードがあり起きない。直に呼ぶと、保存済みのカスタム順へ画面が跳び、その上で1冊動く（ADR-010 の「見た目と反する結果」そのもの） | 崩さない | 影響なし | 全件の作り直し（約365ms・#359） | なし |
| C：見本の bookOrder.all を画面の並びで書く | spec の見本だけ | 取得日の順のまま直に呼ぶ、UI では作れない状態のテストが残る | 崩さない | 影響なし | 同じ | なし（ADR-010 の外を試すまま） |

### 推奨と直す範囲（②が決める）

- **推奨は C'**。
  - 設計（ADR-010）は、動かせるのをカスタム順のときだけにしている。UI もそれを守っている（P1）。
  - 109行は、その外の状態を直に作っていた。#401 で確かめたいこと（段階描画の途中に1冊移動が来ても壊れない）は、カスタム順へ切り替えた直後の段階描画で同じように試せる（P2：途中の48冊の時点・ドロップ先はまだ置かれていない）。
  - アプリを変えないので、#662・#674 と重ならない。
- D は、ADR-010 を関数の側でも守る守りの足し。今の呼び出し元は本カードのドラッグ1か所だけで、プラグインからは呼ばれない（plugins-sample に無い）。足すかどうかは②に任せる。
- A は ADR-010 を変える方針転換で、このイシューの範囲を超える。やるなら別イシュー。
- 直す範囲の案（C'）：
  - list-staged-render.spec.js の109行のテストだけを直す。
  - 新しいテストを1本足す：「取得日の順でつまみを押して別の本の上で離しても、ドラッグが始まらず、画面の並びも保存される並びも変わらない」（P1 の形・実マウス）。既存の custom-order-switch.spec.js は切替の描画（#402）を見るもの。tests/e2e の spec を「カスタム順でない・カスタム順以外・ドラッグできない・動かせない・sortOrder !== 'custom'・ADR-010」で grep して0件だったので、ADR-010 のガードを見るテストは無いと見ている（中身を1本ずつ読んではいない）。
  - 109行の見本は、#662 の決まり（見本で「すべての本」の books を書く時は bookOrder.all も同じ並びで書く・2efb45c の setAllShelfBooksForTest）に揃える。
    - 今の見本は `bookOrder: {}` で、bookOrder.all は `_ensureAllShelf` が埋めている。
    - cfcd784 の P2 のように bookOrder.all が空だと、カスタム順へ切り替えても段階描画にならず、「途中」を作れない。そのため bookOrder.all を見本に書いておく。
  - js・index.html は触らない（?v= も変えない）。

### step3 の新しい spec の期待値（C' の場合）

- 109行（直した後）：カスタム順へ切り替えた直後、DOM の冊数が913より少ない時に、まだ置かれていない本の前へ1冊動かす。置き終えた時に、DOM＝`_orderedBooksToRender()`、動かした本はドロップ先の直前、bookOrder.all は913冊で重複が無い。
- 新しいテスト：取得日の順で `.drag-handle` を押して5冊目の上で離す。ドラッグが始まらず（`draggedElement` が空）、DOM の並び・bookOrder・sortOrder（acquiredTime）が変わらない。すべての本と自作の本棚の2つで見る。

## §3 承認された案 C' で直す・検証（step3・2026-11-14 19:15〜）

### ②の決定（step3 の承認）

- 案は C'。D（reorderBooks の入口のガード）は採らず、アプリは変えない。js・index.html（?v=）・設計書は触らない（ADR-010 のまま・08 の追補なし）。
- 109行は「カスタム順へ切り替えた直後の段階描画の途中に、まだ置かれていない本へ1冊動かす」に直す。見本には bookOrder.all を書く。
- 新しいテストは、別のファイル tests/e2e/custom-order-only-drag.spec.js に置く。

### 変えたもの

| ファイル | 変更 |
|---|---|
| tests/e2e/list-staged-render.spec.js | 見本を `setAllShelfBooksForTest`（tests/e2e/helpers/all-shelf.js・#662）で書く（「すべての本」の books と bookOrder.all が同じ並び）。109行のテストを、`#sort-order` をカスタム順へ切り替えた直後（段階描画の途中）に、まだ置かれていない本の前へ1冊動かす形に直す。<br>見るもの：切り替えた直後の冊数が913より少ない・ドロップ先がまだ置かれていない・置き終えた DOM＝`_orderedBooksToRender()`・動かした本はドロップ先の直前・bookOrder.all は913冊で重複が無い（#662）・例外が無い。<br>コメントに ADR-010・イシュー#676 と、#401 で確かめたいことが残ることを書いた |
| tests/e2e/custom-order-only-drag.spec.js（新しい） | ADR-010 のガードを確かめる。60冊の見本（取得日の順が見本の並びと違う）。すべての本・自作の本棚（30冊）で、取得日の順のまま実マウスで1冊目のつまみを押し、5冊目の上で離す。<br>離す前に、ドラッグの印（`draggedElement`・`.dragging`）が無いことを見る。離した後に、画面の並び・bookOrder・sortOrder（acquiredTime）・並び順の選択が変わらないことを見る |

### 先に取った赤・陰性対照

- 直す前の109行（旧版）は、origin/main 9713381 で 3/3 赤（§1）。
- 新しいテストの陰性対照：`_onBookPointerDown` の先頭の `if (this.sortOrder !== 'custom') return;` を一時的に外して流した。
  - 2本とも赤：「カスタム順でないのにドラッグが始まった (ADR-010)」（dragStarted true・dragging 1）。
  - ガードは流した後にすぐ元へ戻した（`git diff js/bookshelf.js` は0行）。外した変更は commit していない。
- 直した後の109行は、origin/main と同じアプリで緑（下）。ガードを外すと赤になるのは新しいテストの側（上）で、109行は、カスタム順で動かすのでガードに関係しない。

### 検証（chromium・PORT=8176）

| 何を | 結果 |
|---|---|
| list-staged-render.spec.js 全4件 ×3（`--repeat-each=3`・workers=1） | 12 passed（11.1秒）。109行（直した後）も3回とも緑 |
| custom-order-only-drag.spec.js 2件 ×3 | 6 passed（8.7秒）。内部参照を直した後（下）にも流し直して 6 passed（8.4秒） |
| 陰性対照（ガードを外して1回） | 2 failed（上のとおり）。直した後にも流し直して 2 failed |
| 並べ替えに関係する spec 14ファイル・108件（workers=2） | 107 passed・1 failed（下の sort-perf-budget:390） |
| `npm run lint` | 1回目は「12 本中 1 本失敗 (lint:internal-refs)」。新しい spec の `window.bookshelf._listTail` 1件で、テストの内部参照が上限82を超えた（83件）。既にある `waitForListStaged`（helpers/app-misc.js）に置き換えて amend した後、「12 本中 0 本失敗」 |
| `npm test` | Test Files 80 passed・Tests 1194 passed・2 todo |

- 並べ替えに関係する spec の選び方：tests/e2e の spec を、`reorderBooks`・`sort-order`・`drag-handle`・`is-custom-order`・`_bindPointerReorder`・`reorder` で grep した。
  - 流したのは chromium の14ファイル：book-card-tap-after-touch-drag・book-detail-shelf-meta・custom-order-switch・gate/j3-3-sort-persist・gate/j3-5-many-books・home-highlight-sort・onboarding-and-prefs・pull-to-refresh-drag・reimport-diff・shelf-structure-home-refresh・sort-perf-budget・sort-persist・touch-reorder・tree-drop-stays-home。
  - char の2本（char/settings-shelves-nav・char/widgets）は chromium の対象外なので流していない。
- **sort-perf-budget.spec.js:390（#397 並び替えの時間上限・913冊・390px・CPU×6）の赤は、このイシューと関係しない。**
  - 関係する spec をまとめて流した時は、Playwright の中の `assert(!this.paused)` で落ちた。
  - 単独で流し直すと、予算の判定で落ちた：中央値 583ms（最大 719.5ms）・予算 420ms。
  - origin/main 9713381 で同じく単独で流しても落ちた：中央値 502ms（最大 1066.6ms）・予算 420ms。
  - このイシューの commit は js・css・index.html・sw.js を変えていない（`git diff 9713381 HEAD` は0行）。負荷（load average 42〜57・16 CPU）による時間超過と判定した。
- 全件比較（e2e-diff-main）は流していない。
  - 理由：load average が 29〜57（16 CPU）と高い。#634・#668 では、この負荷だと run に収まらなかった。
  - 変えたのは spec 2本だけで、アプリは origin/main と同じ。そのため他の spec の結果は変わらない。
  - step4 の rebase の後に、当該 spec 2本と lint・npm test を流し直す。

### step4 への申し送り

- origin/main は 9713381 から進んでいる（19:17 に見た時点で、#663・#664・#668 の commit が入っていた）。js/bookshelf.js の変更は 3730行付近と 3910行付近だけで、reorderBooks・`_ensureAllShelf`・`_onBookPointerDown` には触れていない。
- このイシューの変更は spec 2本と results だけなので、rebase で js/bookshelf.js・index.html と衝突しない見込み。?v= も上げない（アプリを変えていない）。
- push の前に、#674 の着地を題で確かめる。#674 が入っていれば、duplicate-asin-notice.spec.js:111 も1回流して状態を書く。

## §4 載せ直し・push・CI（step4・2026-11-14 19:24〜）

### 載せ直し

- fetch した origin/main は 4fa0d72（19:24）。9713381 の後に入った commit を題で見ると、#663（7件）・#664（8件）・#668（7件）・#671（5件）・#674（7件）。
  - #674 の直しは df58981「fix: 重複ASINの本を付け直す時、本棚の books と bookOrder が同じ配列でも2回書かず…」（migrateUserData）。
  - js/bookshelf.js の変更は、3730行付近（#663）・3910行付近（#664）・6973〜7003行付近（#674）だけ。reorderBooks・`_ensureAllShelf`・`_onBookPointerDown` には触れていない。
- `git rebase origin/main` は衝突なしで終わった（5件）。
  - reorderBooks まわりの衝突の解き方：このイシューの変更は spec 2本と results だけで、js・index.html を変えていないので、衝突は起きなかった。
  - ?v= も変えていない（`git diff origin/main HEAD -- js css index.html sw.js` は0行）。

### rebase の後の流し直し（origin/main 4fa0d72 ＋ 自分の5件・chromium・PORT=8176）

| 何を | 結果 |
|---|---|
| list-staged-render.spec.js 全4件 ×3 | 12 passed（10.8秒） |
| custom-order-only-drag.spec.js 2件 ×3 | 6 passed（4.9秒） |
| duplicate-asin-notice.spec.js:111（#674 の着地の後） | 1 passed |
| `npm run lint` | 12 本中 0 本失敗 |
| `npm test` | Test Files 80 passed・Tests 1197 passed・2 todo |

- load average は 25〜29（16 CPU）。
- sort-perf-budget.spec.js:390 の手元の値（§3）：この版は中央値 583ms、origin/main 9713381 は中央値 502ms。予算は 420ms で、どちらも超えた。アプリの差分は0行なので、このイシューとは関係しない。
