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
