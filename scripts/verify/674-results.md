# イシュー#674 結果：duplicate-asin-notice.spec.js:111 の赤

## §1 赤の再現と bisect（step1・2026-11-14 18:58〜19:03）

### 流し方

- worktree `/home/kuroko/worktrees/bookshelf/issue-674`（origin/main 9713381 へ ff-only で進めてから）。
- `tmp/674/bisect-run.sh`（tmp/ は .gitignore 済み＝commit しない・bisect の checkout で消えない）：
  `npx playwright test tests/e2e/duplicate-asin-notice.spec.js:111 --project=chromium --reporter=line --retries=0`（PORT=8174）。
  終了コードは 緑=0／赤=1／流せなかった=125。
- ログは手元だけ：`tmp/674/run-<sha>-<時刻>.log`・`tmp/674/summary.txt`・`tmp/674/bisect-log.txt`。

### 再現（origin/main 9713381＝#669 の着地の後の最新）

- **3/3 赤**（`--repeat-each=3`・3並列）。3本とも同じ所で落ちる：
  - 150行 `expect(afterMigrate.bookOrderAll.filter((a) => a === NEW_ASIN).length).toBe(1)` → `Expected: 1` / `Received: 2`
  - ＝付け直した新 ASIN が bookOrder.all に2回入っている。
- brief の「c34be0a でも赤」：c34be0a で1回流して赤（同じ150行・Received 2）。

### bisect

- good：492ed66（docs: 634-results.md に e2e-diff の結果…＝#662 の最初の commit db7b138 の直前）で1回流して緑。
- bad：9713381。範囲は40 commit、5点で決着した。

| 点 | 題 | 結果 |
| --- | --- | --- |
| e2dfd44 | chore: bookshelf.js の ?v= を main の最大 (2026111781) より新しくする (#662・#659 と値がぶつかったため) | 赤（150行） |
| 555b513 | test: 本のつまみ・ホームのウィジェットを下へ運ぶと「引っぱって更新」で再読込されるのを E2E で再現する (#659) | 赤（150行） |
| 2f4d112 | docs: 662-results.md §7 に rebase と検証一式の結果を記録する (#662) | 赤（150行） |
| cfcd784 | docs: 662-results.md に原因・データは消えないこと・横展開の表・直し方の案を記録する (#662) | 緑 |
| 77c86ae | test: 保存先につないだまま本を足し・取り込み・除外・削除した直後の再読込で「すべての本」…を確かめる (#662) | 赤（150行） |
| e71239b | fix: …本棚の books をいつも bookOrder.all と同じ配列にする (#662) | 赤（150行） |

### first bad commit

- **#662 の e71239b**「fix: 保存先につないだまま本を足し・取り込み・除外した直後に再読込しても、「すべての本」の冊数と記事の引き出しが古いまま残らないよう、本棚の books をいつも bookOrder.all と同じ配列にする (設計: 03/08 2026-11-14 更新・ADR-166)」（trailer `Issue: #662`・2026-11-14 17:41）。
- 直接の確かめ：
  - 親 cfcd784：1並列（`--workers=1`）で **3/3 緑**。3並列では 1 緑・2 赤だったが、赤の2本は150行ではなく setup（spec 62行の `page.evaluate` の中の `switchBookshelf('all')`）の `TypeError: Cannot read properties of null (reading 'bookshelves')`＝起動の途中で userData がまだ null（下の「別の揺れ」）。150行まで進んだ回は全部緑。
  - e71239b：3並列で **3/3 赤**（3本とも150行・Received 2）。bisect の1回と合わせて 4/4。
  - bisect で赤とした点（e2dfd44・555b513・2f4d112・77c86ae・e71239b）は全部150行で落ちている（setup の揺れで赤にした点は無い）。
- #660 は関わらない：#660 の d7d6924（fix: 面を開いたままでも、保存の失敗・未保存の知らせを面より前の帯に出して押せるようにする）は e71239b より後に積まれており、その前の 77c86ae・2f4d112 で既に赤。

### 計画時の仮説との照合（一致）

- e71239b の差分（js/bookshelf.js）：
  - `_ensureAllShelf()` に `if (shelf) shelf.books = ud.bookOrder.all;` を足し、既にある「すべての本」の books も、呼ばれるたびに bookOrder.all と同じ配列にした（それまでは本棚を新しく作る時だけ同じ配列）。
  - `saveUserData()` と、保存先の値を手元に入れる所（端末の控えへ書く前）にも `_ensureAllShelf()` を通す。
  - `_onLibraryChanged()` の揃え（`allShelf.books = order`）は `_ensureAllShelf()` に寄せた（揃え自体は e71239b より前からあった）。
- `migrateUserData`（origin/main js/bookshelf.js 6943行〜）は、もう一方の本が残る時（oldAsinStillUsed）は本棚ループで `bookshelf.books.push(newAsin)`（コピー）し、その後 bookOrder ループで `order[order.indexOf(oldAsin)] = newAsin`（置き換え）する。「すべての本」の books と bookOrder.all が同じ配列だと、この2つが同じ配列に効き、新 ASIN が push で1回・置き換えで1回＝2回入る。150行の Received 2 と一致する。
- step2 で詰めること：e71239b より前でも `_onLibraryChanged()` が一度でも走った後（取込・手で追加・除外 等の後）は同じ配列になっていた＝その後で付け直すと同じ二重書きが起きていたはず（未実測）。e71239b はそれを起動の直後から常に起きる形にした。

### 別の揺れ（150行の赤とは別・step4 で見る）

- spec の setup（61行）は `window.bookshelf.books.length > 0` だけを待ち、userData を待たない。cfcd784 の3並列で 2/3 がここで落ちた。9713381 の3並列では3本とも setup を通った（150行で落ちた）。今の main でも起きるかは、直した後に step4 で3並列と1並列の両方で見る。
