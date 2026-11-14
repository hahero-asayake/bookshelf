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

## §2 原因の見極め・横展開・直し方（step2・2026-11-14 19:03〜）

### 判定：アプリの不具合（spec の前提は古くない）

- 物差し1（#484 の約束・spec 冒頭コメント）：付け替えた直後も、もう一方の本（旧ASINのまま）にメモ・除外・非表示・本棚所属が残る。bookOrder は重複2件のうち1件だけが新ASINに置き換わる。
- 物差し2（ADR-166）：bookOrder.all は順序の正で、「すべての本」の books は bookOrder.all と同じ配列。
- 今の main（9713381）で付け直すと、bookOrder.all（＝「すべての本」の books）が `[NEW, DUP, SELF, SELF, SOLO, NEW]` になる。新ASINの本が並び順に2回入り、蔵書は5冊なのに並びは6件。物差し1の「1件だけ置き換わる」に反し、データが崩れる。spec の150行はこの崩れを正しく捕まえている＝spec を緩める理由は無い。
- 原因：migrateUserData（js/bookshelf.js 6947行〜）は「本棚の books」と「bookOrder の配列」が別の配列だと決めてかかっている。本棚ループで push（コピー）、bookOrder ループ（7005行）で置き換えを、それぞれその場で書き換える。#662 e71239b で「すべての本」が起動の直後から同じ配列になったので、端末の控えから読む起動でも、付け直すたびに起きるようになった。

### 保存先から読んだ本棚でも起きる（ハブで E2E 実測・#662 より前から）

- 確かめ方：確かめ用の spec を書いて流した（commit しない・`tmp/674/zz-674-probe.spec.js` へ移した・ログは `tmp/674/probe-hub*.log`）。
  - ハブの模擬（tests/e2e/helpers/gate-hub.js）に、上巻・下巻（同じ DUP）・単独の本（SOLO）と、自作の本棚「フィクション」（DUP と SOLO）を置く。
  - ハブから読む起動（method: 'hub'・端末の控え無し）の後、spec と同じ画面操作で上巻を NEW に付け直す。
- 結果（9713381 と、#662 の前の cfcd784 で同じ）：
  - 読んだ直後：「フィクション」の books === bookOrder.fiction、「すべての本」の books === bookOrder.all（どちらも true）。
  - 付け直した後：「フィクション」＝`[NEW, SOLO, NEW]`＝**下巻（DUPのまま）が「フィクション」から外れ**、NEW が2回入る。「すべての本」＝`[NEW, DUP, SOLO, NEW]`（NEW が2回）。
- 保存先から読む起動の読込（js/bookshelf.js 3657〜3658行 `bookshelves.forEach(b => { bookOrder[b.id] = b.books; })`・ad7f393・2026-05-24）は、全部の本棚で books と bookOrder[id] を同じ配列にしている。そのため #484 で付け直しを「コピー」にした 53b1e1a（2026-11-02）の時から、この崩れは起きていた。#484 の spec は端末の控えから読む起動（別々の配列）だけを見ていたので捕まらなかった。
- #662 の前の親 cfcd784 でも同じ結果＝#662 が作った崩れではない。#662 は「すべての本」の分を端末の控えからの起動にも広げ、spec に見えるようにした。
- フォルダ・GitHub も同じ読込の関数を通る（コードの読み・未実測）。

### 横展開の表

同じ配列になる所：

| # | 所 | 場所 | 何が同じ配列になるか |
| --- | --- | --- | --- |
| S1 | `_ensureAllShelf()` | js/bookshelf.js 4333〜（`if (shelf) shelf.books = ud.bookOrder.all;`） | 「すべての本」の books と bookOrder.all（#662 e71239b から、既にある本棚も呼ばれるたびに。起動・saveUserData・_onLibraryChanged から呼ぶ） |
| S2 | 保存先からの読込 | js/bookshelf.js 3657〜3660行 | 全部の本棚の books と bookOrder[b.id]（ad7f393・2026-05-24） |
| S3 | 読込の並び順のマージ | js/bookshelf.js 3689〜3690行 | 手元の並びが新しい本棚は、作り直した shelf.books を bookOrder[shelf.id] にも入れる（5f6f05f・2026-10-28） |

両方を同じ流れで書き換える経路（同じ配列の時に二重に効くか）：

| # | 経路 | 場所 | 書き方 | 判定 |
| --- | --- | --- | --- | --- |
| W1 | ASIN の付け直し `migrateUserData` | js/bookshelf.js 6947〜（本棚ループ・bookOrder ループ 7005〜） | 本棚：push（コピー）か置き換え／bookOrder：indexOf で置き換え。どちらもその場で書き換える | **二重に効く**（すべての本：新ASINが2回／保存先から読んだ自作の本棚：もう一方の本が外れ、新ASINが2回・実測） |
| W2 | 本棚へ足す `addBookToBookshelf` | js/bookshelf-manager.js 362〜384 | books.push の後、bookOrder[id] に無い時だけ unshift | 効かない（push の後は includes が真＝1回だけ） |
| W3 | 本棚から外す `removeBookFromBookshelf` | js/bookshelf-manager.js 389〜405 | books も bookOrder[id] も filter で新しい配列にする | 効かない（冪等。以後は別の配列になるだけ） |
| W4 | 本の削除 | js/bookshelf.js 6783・6798行付近 | 各本棚の books と bookOrder.all を filter | 効かない（冪等） |
| W5 | 除外 | js/bookshelf.js 5997〜6000行 | 蔵書と bookOrder.all を filter（本棚の books は書かない） | 効かない |
| W6 | 除外の取り消し | js/bookshelf.js 6054〜6057行 | bookOrder.all に無い時だけ unshift | 効かない |
| W7 | 手で追加 | js/bookshelf.js 7291〜7294行 | bookOrder.all.unshift | 効かない（1回だけ） |
| W8 | 取込 | js/screens/import.js 239〜244行 | bookOrder.all.unshift | 効かない（1回だけ） |
| W9 | 並べ替えの保存 | js/bookshelf.js 1607〜1608行 | bookOrder[key] に新しい配列を入れる | 効かない（置き換え） |
| W10 | 並べ替え（ドラッグ） | js/bookshelf.js 2703〜2704行 | shelf.books と bookOrder[id] に別々の写しを入れる | 効かない |
| W11 | 子の本棚を作る | js/bookshelf-manager.js 169〜172行 | 親の books の写し・bookOrder[slug] も写し | 効かない |
| W12 | slug を変える | js/bookshelf-manager.js 313行 | bookOrder[newSlug] = bookOrder[oldSlug]（参照を移すだけ） | 効かない |
| W13 | 書き出し（#664 が触る所） | js/bookshelf.js 3922〜3923行 | bookOrder.all に新しい配列を入れる（後で S1 が揃え直す） | 効かない |

- 二重に効くのは W1 だけ。ほかの経路は「includes で守る」か「filter・写しで新しい配列にする」のどちらか。
- W1 は e71239b より前でも、端末の控えから読む起動で `_onLibraryChanged()`（取込・手で追加・除外 等の後）が一度走った後なら、「すべての本」が同じ配列になっていた＝同じ崩れが起きていたはず（コードの読み・未実測）。

### 直し方の案

| | A：本棚の種類を見て1回だけ書く（推奨） | B：書いた配列を Set で覚えて2回目を飛ばす | C：spec の期待を直す |
| --- | --- | --- | --- |
| やり方 | migrateUserData の本棚ループで「すべての本」（isSpecial）を飛ばす（中身は蔵書そのもの＝並びは bookOrder.all の置き換えで足り、最後の saveUserData で S1 が揃える）。bookOrder ループでは、本棚ループで書いた自作の本棚の books と同じ配列（===）を飛ばす（所属のコピーを優先） | 本棚ループで書いた配列を Set に入れ、bookOrder ループで同じ配列を飛ばす（本棚の種類は見ない） | 150・151行の期待を「新ASINが2件」に変える |
| #484 の約束 | 守る（すべての本は NEW 1・DUP 1。自作の本棚は DUP と NEW の両方が残る） | すべての本で破る（コピーが勝って DUP が2件残り、5冊なのに並びは6件）。順を逆にすると、今度は自作の本棚で置き換えが勝ち、下巻が外れる | 破る（新ASINの2件を認める） |
| ADR-166 | 整合（bookOrder.all が正・本棚の books は同じ配列のまま） | 同じ配列のままだが、中身が崩れる | 崩れたまま |
| 保存先から読んだ自作の本棚（実測した崩れ） | 直る（`[DUP, SOLO, NEW]`） | 直る | 直らない |
| 差分の大きさ | js/bookshelf.js の migrateUserData だけ（10行前後）＋index.html の ?v=＋E2E 1本（ハブから読んで付け直す） | 同じくらい | spec 2行 |
| 横展開 | 要らない（二重に効く経路は W1 だけ） | 同じ | — |

- **推奨は A**。B は、本棚の種類を見ないので「すべての本」か自作の本棚のどちらかで約束を破る。C は実測で崩れが確かめられた＝「データが崩れない」と言える根拠が無いので採らない。
- 範囲の推奨：**保存先から読んだ自作の本棚も今回直す**。同じ関数の同じ所（bookOrder ループの1条件）で直り、足す差分は数行。別イシューに切ると、同じ関数を2回直すことになる。
- 端末の控えから読む起動で、自作の本棚が別々の配列の時の A の動き：今と同じ（books はコピー・bookOrder[id] は置き換え）。spec の他の期待は変えない。
- あわせて A-2（spec の待ち）：spec の setup（61行）の待ちに `window.bookshelf.userData` を足す。cfcd784 の3並列で 2/3 が setup で落ちた揺れ（§1）を消すため。期待は緩めない。

### ②に仰ぐこと

1. 直す方：アプリ（案A）でよいか。
2. 範囲：保存先（ハブ・フォルダ・GitHub）から読んだ自作の本棚の崩れも今回直すか（推奨：直す。E2E はハブで1本）。
3. A-2（spec の setup の待ちに userData を足す）を入れてよいか。

## §3 直したこと（step3・2026-11-14 19:09〜19:14）

- 起点：origin/main 02772ca（#663・#664 の着地の後）。§1・§2 の docs 2本を rebase した（衝突なし）。

### 直す前の赤（test の commit 22e8adc の時点＝fix の前）

- `tests/e2e/duplicate-asin-repoint-hub.spec.js:50`（新規）：赤。79行 `expect(after.fictionBooks).toContain(DUP_ASIN)` で、受け取った値は `["BNEWASIN01","B0SOLO0001","BNEWASIN01"]`（下巻が「フィクション」から外れ、NEW が2回）。
- `tests/e2e/duplicate-asin-notice.spec.js:111`：赤。150行で Expected 1 / Received 2。
- 同じファイルのほかの2本（:90・:187）は緑。ログは `tmp/674/before-fix.log`（手元だけ）。

### 足した・変えた test（22e8adc）

- 新規 `tests/e2e/duplicate-asin-repoint-hub.spec.js`：
  - ハブの模擬（tests/e2e/helpers/gate-hub.js）に、蔵書（上巻・下巻＝同じ DUP・単独の本）と本棚2つ（「すべての本」・自作の「フィクション」＝DUP と SOLO）を置き、ハブから読む起動（method: 'hub'・端末の控え無し）にする。
  - 前提として、「フィクション」と「すべての本」が books === bookOrder[本棚] であることを確かめる。そのうえで、duplicate-asin-notice.spec.js と同じ画面操作で上巻を付け直す。
  - 確かめる数：「フィクション」に DUP が残り、NEW は1件、全部で3件。bookOrder.fiction の NEW は1件。bookOrder.all は蔵書と同じ3件で、NEW 1件・DUP 1件。「すべての本」の books は bookOrder.all と同じ配列のまま。メモは両方に残る。pageerror は0件。
- `tests/e2e/duplicate-asin-notice.spec.js`：
  - 61行（setup の待ち）に `window.bookshelf.userData` を足した（A-2）。同じ行の中で直したので、:111 の行番号は変わらない。
  - :111 のテストに `expect(afterMigrate.bookOrderAll.length).toBe(books.length)`（並びは蔵書と同じ5件）を足した（②の「数で確かめる」）。期待は緩めていない。

### 直したこと（fix の commit 4fbbc7d）

- `js/bookshelf.js` の `migrateUserData`：
  - 本棚ループで「すべての本」（isSpecial）を書かない。並びは bookOrder.all の置き換え（重複の1件だけ）で足り、最後の saveUserData で _ensureAllShelf が books を揃える。
  - 本棚ループで書いた本棚の配列を `shelfArraysWritten`（Set）に覚え、bookOrder ループで同じ配列を書き直さない（所属のコピーを優先する）。
  - 本棚の books と bookOrder が別の配列の時（端末の控えから読む起動の自作の本棚）の動きは変えない。
- `index.html`：bookshelf.js の ?v= を 2026111798 → 2026111799（origin/main 02772ca の最大 2026111798 の次）。`check:version --range=origin/main..HEAD` は OK。

### 直した後

- 2つの spec（4本）を1回流して 4 passed（`tmp/674/after-fix.log`）。3回・3並列は step4。
- `npm run lint`：12本中0本失敗（`tmp/674/lint-step3.log`）。

### 設計書（vault・スクリプトで編集した＝パスをツールの引数に書かない）

- 03_詳細設計書：VirtualBookshelf の主要メソッド表で、`saveUserData(opts)` の行の直後に `migrateUserData(oldAsin, newAsin)` の行を足した（これまで行が無かった）。
- 08_意思決定記録：ADR-166 に追補を1行（両方を続けて書き換える経路は1回だけ書く・ADR-172）。末尾に ADR-172（背景・決定・却下した案・教訓・確かめ方）。08 の最後は ADR-171（#669）だった。08 は CRLF の行に合わせて入れた。
- vault の commit は自動バックアップ（30分ごと）に任せる。vault の差分にある 08 の2071行の書き換えは #668 の編集で、このイシューのものではない。
- フォルダ・GitHub：同じ読込の関数（js/bookshelf.js `_applyLoadedState` の `bookshelves.forEach(b => { bookOrder[b.id] = b.books; })`・3658行）を通るので、コードの読みで同じ・未実測（②の指示どおり spec は増やさない）。

## §4 検証（step4・2026-11-14 19:14〜19:21・HEAD 21439a9＝origin/main 02772ca の上に自分の5本）

- PORT=8174・`--project=chromium`・`--retries=0`。ログは手元だけ（`tmp/674/s4-*.log`）。
- 計った時の負荷は高かった（19:19 に load average 57／16CPU。他イシューの全件比較などが同時に走っていた）。

### 当該の spec（3回）

| 流し方 | 対象 | 結果 |
| --- | --- | --- |
| `--repeat-each=3`（6並列） | duplicate-asin-notice.spec.js の3本＋duplicate-asin-repoint-hub.spec.js の1本 | **12/12 緑**（:111 も3/3） |
| `--repeat-each=3 --workers=1` | 同じ | **12/12 緑** |

- §1 の setup の揺れ（cfcd784 の3並列で 2/3 が `TypeError … reading 'bookshelves'`）は、6並列の3回で0件。A-2（setup の待ちに userData）で消えたと見る。

### lint・単体

- `npm run lint`：**12本中0本失敗**。
- `npm test`（vitest）：Test Files 80 passed・Tests **1194 passed**・2 todo（失敗0）。

### 関連 E2E（1回・8並列）

- 対象24ファイル：`git grep -l -e bookOrder -e setAllShelfBooksForTest -- tests/e2e` と `git grep -l -e edit-original-asin -- tests/e2e`（helpers と duplicate-asin の2本を除く）。#662 の spec（manual-add-reload-all-shelf.spec.js）はこの中に入っている。
- 結果：283本中 **268 緑・13 skip・2 赤**。
- 赤の2本は、このイシューの差分の前（origin/main 02772ca）でも同じく赤＝このイシューの変更によるものではない：

| テスト | 自分の HEAD（1並列で流し直し） | origin/main 02772ca（1並列） | 見立て |
| --- | --- | --- | --- |
| list-staged-render.spec.js:109 #401 並べ替えの段階描画（913冊）› 途中で1冊を動かす | 赤（DOM の並びの食い違い） | 赤 | main の既存の赤。#668 の 668-results.md §4 でも、CI の main の run 43582903319（9713381）で落ちた3件の1つとして記録されている（ほかの2件は duplicate-asin-notice＝本件で直したもの、sync-conflict-overwrite のハブの1本） |
| sort-perf-budget.spec.js:390 #397 並び替えの時間上限（913冊・CPUx6） | 赤（許容幅を超えた） | 赤 | 時間の上限の検査で、高負荷（load 57）の下では両方で超える。負荷のせいか main の赤かは切り分けていない |

- ASIN の付け直し（migrateUserData）は、この2本の経路（並べ替え・段階描画）を通らない。

### 全件比較（e2e-diff-main）

- 流していない。負荷が高く（load 57）約8分では終わらない見込みで、run の残り時間にも収まらないため。代わりに上の絞った比較（関連24ファイル・赤の2本は base と並べて流し直し）で判定した。

### push の前に見直したこと

- ADR 番号：08 の ADR-172 はこのイシューの1件だけ。その後ろに他イシューが ADR-173 を足していて、ぶつかっていない。
- ?v=：origin/main 80e2cc8 の index.html では bookshelf.js が 2026111798（全体の最大も 2026111798）。こちらの 2026111799 の方が新しい。step5 の rebase の後でもう一度見る。

### 判定

- 当該の spec は3回とも全部緑（並列・1並列とも）。lint・vitest も失敗0。関連 E2E の赤2本は、base でも赤＝このイシュー由来ではない。push へ進んでよいと判断する（②の確認の後）。

## §5 push と CI（step5・2026-11-14 19:22〜19:31）

### push まで

- 1回目の rebase：origin/main 80e2cc8（#668 の着地の後）へ6本を載せ直した（衝突なし）。bookshelf.js の ?v= 2026111799 は main の最大 2026111798 より新しく、check:version は OK。lint 12本中0本失敗・vitest 1194 passed・当該 spec 4 passed。
- 1回目の push は拒否された。pre-push の lint の間に #671 が着地し、origin/main が d0a3552 へ進んだため（`cannot lock ref 'refs/heads/main': is at d0a3552… but expected 80e2cc8…`）。
- 2回目の rebase：d0a3552 へ載せ直した（衝突なし）。#671 が bookshelf.css・overlay-manager.js・dashboard.js の ?v= を 2026111867 に上げていて、こちらの 2026111799 が main の最大より古くなった。bookshelf.js の ?v= を 2026111868 に上げる chore を足した（#665 の罠＝衝突なしで古いまま残る、を避ける）。
- その後：check:version OK・vitest 1197 passed（#671 の分を含む）・当該 spec 4 passed・pre-push の lint 12本中0本失敗。`git log origin/main..HEAD` の7本は全部 `Issue: #674`。
- push：`BOOKSHELF_ISSUE=674 git push origin 4fa0d72…:main` → `d0a3552..4fa0d72`（19:24:37）。

| 題 | push した sha |
| --- | --- |
| docs: 674-results.md §1（赤の再現・bisect・first bad commit） | 6db770d |
| docs: 674-results.md §2（判定・ハブの実測・横展開・案） | dab6889 |
| test: ハブから読んだ本棚で重複ASINの本を付け直すと…を E2E で再現する (赤のまま)・… | 91d6e41 |
| fix: 重複ASINの本を付け直す時、本棚の books と bookOrder が同じ配列でも2回書かず、… (設計: 03/08 2026-11-14 更新・ADR-172) | df58981 |
| docs: 674-results.md §3 | a1b28a8 |
| docs: 674-results.md §4 | be12c1d |
| chore: bookshelf.js の ?v= を main の最大 (2026111867) より新しくする (#671 …) | 4fa0d72 |

### CI（run 43585146179・ci.yml・push 4fa0d72）

- GitHub API は残り0回（他のイシューが使い切っていた）だったので、run の画面の HTML を45秒おきに見た（`tmp/674/ci-poll.log`）。
- 19:26:26〜19:29:27：In progress・0/4 jobs completed。19:30:13：In progress・**1/4 job completed**（完了したのは test (char)。注記は warning 1・notice 4 で、失敗の注記は無い）。test (e2e)・test (audit)・test (webkit) は進行中。
- **最大待ち時間（push から5分）では結論が出なかった**。代替判定＝手元の結果で判定する：当該 spec は 3回×2本で12/12（6並列・1並列とも）、push 直前の rebase の後も 4 passed。lint 12本中0本失敗。vitest 1197 passed。→ duplicate-asin-notice.spec.js:111 は、この直しを入れた main で緑と判定する。
- CI の e2e で落ちるものがあれば、§4 のとおり list-staged-render.spec.js:109（#401）と sort-perf-budget.spec.js:390 は直す前の main でも赤（このイシュー由来ではない）。それ以外が落ちていないかは、この run の中では見届けていない。

### 設計書（vault）

- 03・08 の変更（03 の `migrateUserData(oldAsin, newAsin)` の行・08 の ADR-166 追補と ADR-172）は、#671 が 19:18:08 に手で入れた vault の commit 12cf8ca0「bookshelf: 03/04/08 帯の下げ対象を印 data-ov-below-notice にまとめ、ホームのウィジェット選択も下げる (ADR-173・実装: bookshelf@bf569f6・イシュー#671)」に一緒に入った。その commit の中に ADR-172 と migrateUserData の行があることを確かめた。03・08 に未 commit の差分は無い。
