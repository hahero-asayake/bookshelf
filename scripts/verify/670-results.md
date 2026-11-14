# #670 自作の本棚が、除外した本を books に持ったまま — 実測と方針

## §0 着手条件（2026-11-14 18:31・step1）

- `git fetch` の後の origin/main は ab34c16（題「docs: 659-results.md §5 に push の直前の載せ直し…」）。
- `git log origin/main --oneline --grep='#669'` は 0 件、`--grep='#664'` も 0 件。どちらもまだ入っていない（#664 は tp_review、#669 は running。計画時点と同じ）。
- step1 で足したのは新しいファイル（`tests/e2e/exclude-custom-shelf.spec.js` とこのファイル）だけ。2つと重ならないので、未着のまま進めた。
- worktree は `/home/kuroko/worktrees/bookshelf/issue-670`（HEAD = origin/main ab34c16）。node_modules は最初からあった。

## §1 実測①：ローカル保存（フォルダ未接続＝端末の控えだけ）・chromium・1280 幅

- spec：`tests/e2e/exclude-custom-shelf.spec.js`（670-A・670-B・670-C・670-D）。赤のまま commit した（A・B・D は赤、C は緑）。
- 見本：fixture に、親の本棚 `e2e-p`（X・Y・Z）と、その子の本棚 `e2e-c`（X・Y）を足した。X = B000000001（1冊ずつ除外する本）、Y = B000000002（一括で除外する本）、Z = B000000003（除外しない本）。
- 入口：
  - 1冊ずつの除外は `window.bookshelf.excludeBook` を呼び、確認の窓は画面で押した（除外ボタンは、編集モードの本の詳細にしか無い。#622 の 662-H と同じ入口の取り方）。
  - 一括の除外は画面から行った（「すべての本」→ 選択モード → Y を選ぶ →「すべての本から除外」→ 確認）。初めは `_bulkExclude` を直に呼んだが、`lint:internal-refs` が上限を超えた（83 件、上限 82）ので画面の操作に替えた。替えた後も値は同じ。
  - 取り消しは `window.bookshelf.unexcludeBook` を呼んだ（除外一覧の画面は通していない）。
- 実行：同じ spec を4回流し、値は4回とも同じだった。最後の回は 2 failed・1 passed（4.9 秒）。`npm run lint` は、替えた後に 12 本中 0 本失敗。
- 冊数の「並ぶ冊数」は、本棚を開いた時に見えている `.book-item[data-asin]` の数。ツリーの冊数は `.bsr-count`（`js/screens/bookshelf-list.js` のツリー描画で `bs.books.length` をそのまま出す）。

| # | 項目 | 期待（方針が決まるまでの仮） | 実際 | ログ |
|---|---|---|---|---|
| a-1 | 1冊除外した後の子の本棚の books（メモリ） | — | X を持ったまま `[X, Y]`。親も `[X, Y, Z]` のまま | A1 |
| a-2 | 同じ時の端末の控え（`virtualBookshelf_userData` の bookshelves） | — | 同じく X が残る | A1 |
| a-3 | 再読込の後 | — | 残る（メモリも端末の控えも `[X, Y]`） | A2 |
| a-4 | 一括で除外した後 | — | Y が残る（`[X, Y]`） | B1 |
| b-1 | 1冊除外した後のツリーの子の本棚の冊数 | 並ぶ冊数と合う | ツリーは「2」、並ぶのは1冊（Y だけ）＝**除外した本を数えている** | A1 |
| b-2 | 同じ時のツリーの親の本棚 | — | 「3」（親を開いて並ぶ冊数は測っていない） | A1 |
| b-3 | 再読込の後のツリーの子の本棚 | 並ぶ冊数と合う | 「2」と並ぶ1冊で、食い違ったまま | A2 |
| b-4 | 一括で除外した後のツリーの子の本棚 | 並ぶ冊数と合う | 「2」と並ぶ1冊 | B1 |
| b-5 | ツリーの「すべての本」 | — | 5 → 4（除外を引いている） | A0・A1 |
| b-6 | 1冊除外した後のホームのカードの冊数 | 並ぶ冊数と合う | 子「2冊」・親「3冊」＝**除外した本を数えている**。数え方は `js/ui/bookshelf-card.js` のカードの描画で、`bookshelf.books.slice()` の長さ | D1 |
| b-7 | 同じ時の本棚の管理一覧（`#bookshelves-list` の `.book-count`）の冊数 | 並ぶ冊数と合う | 子「2冊」・親「3冊」＝**除外した本を数えている**。数え方は `bookshelf-list.js` の `renderBookshelfList` で、`bookshelf.books.length` | D1 |
| b-8 | 本棚の見出しの冊数 | — | 見出しには冊数の表示が見当たらない（`bvh-count` などで grep して 0 件）。測る対象が無いとみなし、実測はしていない | — |
| c-1 | 再読込せずに取り消す | 子の本棚に並び直す | 並び直す（`[Y, X]`）。`book:added {reason:'unexcluded'}` が1回 | C1 |
| c-2 | 再読込した後に取り消す | 子の本棚に並び直す | **戻らない**。除外の一覧からは消えるが、蔵書（`bookshelf.books`）に X が戻らず、本棚にも並ばない。`book:added` も出ない。子の本棚の books には X が残ったまま | A3 |
| d-1 | 1冊除外した時の `book:removed` | 1回 | 1回（`{asin: X, reason: 'excluded'}`） | A1 |
| d-2 | 同じ時の本棚側のイベント（`bookshelf:updated`） | — | 出ない（`books:changed` も出ない） | A1 |
| d-3 | 一括で除外した時の `book:removed` | 1回 | **0回**（4つのイベントのどれも出ない） | B1 |
| d-4 | 取り消した時の `book:added` | 1回 | 再読込なしは1回（c-1）。再読込の後は0回（c-2） | C1・A3 |

### 分かったこと

1. 除外しても、自作の本棚の books には除外した本が残る。メモリでも、端末の控えでも、再読込の後でも残る。brief の前提を実測で確かめた。
2. 本棚を開くと除外した本は並ばない（表示する側で除外を引いている）。一方、冊数を出す3か所（ツリー・ホームのカード・本棚の管理一覧）は、どれも残った分も数える（「2」と並ぶ1冊）。
3. 一括の除外は `book:removed` を出さない。②の申し送り1により、このイシューの範囲で直す（比較軸⑥）。
4. 除外しても本棚側のイベントは出ない。プラグインが除外を知る手段は、1冊ずつの除外の `book:removed` だけ。
5. **brief に無い新しい点**：フォルダにつないでいない時、再読込の後に除外を取り消すと、本が蔵書に戻らない。除外の一覧からは消えるので、除外一覧にも蔵書にも出ない本になる。原因はコードで確かめた：
   - `saveUserData` は端末の控えへ書く時に `_storage.libraryBooks` を落とす（js/bookshelf.js:2870-2873）。
   - そのため再読込の後は `_storage.libraryBooks` が null になる（A3 で null を確認）。
   - `unexcludeBook` は書誌を `_storage.libraryBooks` から探すので、見つからない。
   
   フォルダにつないだ時は `syncToObsidianFolder` が `libraryBooks` を作り直す（:3872）ので、戻る見込みがある（未実測）。step2 の書き出しの実測で、フォルダにつないだ時も測る。#670 の範囲に入れるかは、step3 の tp で②に諮る。
   → **step2 で実測した（f-4）**：フォルダにつないだ時は、再読込の後でも `libraryBooks` が3冊あり、取り消すと蔵書に戻る。戻らないのはフォルダ未接続（端末の控えだけ）の時に限る。

## §1-2 実測②：記事の本の引き出し・フォルダへの書き出し（2026-11-14 18:39〜18:43・step2）

- 着手条件をもう一度確かめた：origin/main は c34be0a（#653 の記録）。`--grep='#669'`・`--grep='#664'` はどちらも 0 件で、まだ入っていない。
- spec に 670-E（引き出し）と 670-F（フォルダ）を足した。どちらも chromium・1280 幅。
- E の見本は step1 と同じ（親 `e2e-p` > 子 `e2e-c`、X を1冊ずつ除外）。記事の保存先だけメモリに差し替え、接続済み相当にした（`tests/e2e/publish-article-editor.spec.js` の `bootApp` と同じやり方）。記事の新規 → 本棚ブロック → 引き出しの本棚を子の本棚に切り替えた。
- F の見本は #664 の `exclude-export-all-shelf.spec.js` と同じ（OPFS のフォルダにつなぎ、gate-kindle-export.json の3冊を取り込む）。自作の本棚 `e670f`（TARGET＝B0GATEIMP3 だけ）を足して保存した。その後、除外 → 書き出しの完了を待つ → 再読込 → 取り消し → 書き出しの完了を待つ、の順に進めた。自作の本棚を足す所だけは、`userData.bookshelves` に直に足して `saveUserData` を呼んだ（入口の作り）。

| # | 項目 | 期待（方針が決まるまでの仮） | 実際 | ログ |
|---|---|---|---|---|
| e-1 | 引き出しで子の本棚を選んだ時の X の行 | 並ばない（または除外中と分かる） | **並ぶ**。題の代わりに ASIN「B000000001 B000000001」が出る。除外中の印は無い（origin/main には印が無い） | E1 |
| e-2 | 「表示中のN冊を追加」の N | 1（Y だけ） | **2**＝X も数える | E1 |
| e-3 | 「表示中のN冊を追加」を押した後の記事のブロック | Y だけが入る | **X も入る**（items が B000000001・B000000002 の2件） | E1 |
| f-1 | 書き出した自作の本棚のファイル `private/bookshelves/e670f.json` の books | — | **X（TARGET）が残る** `["B0GATEIMP3"]` | F1 |
| f-2 | 同じ時の `library.json` | 除外した本も含む全書誌（02 の「書誌の正本＝library.json」・06） | 3冊とも入っている（決まりどおり） | F1 |
| f-3 | 同じ時の `all.json` の books | 除外を引いた2冊（06 の「all.json の books = library − exclusions」） | **3冊で TARGET を含む**（#664 が直す件。#664 は未着） | F1 |
| f-4 | 再読込の後に取り消す（フォルダ接続） | 蔵書に戻る | 戻る。再読込の後も `_storage.libraryBooks` は3冊ある。取り消した後は `exclusions.json` が空になり、蔵書に戻る（inBooks=true） | F2・F3 |
| f-5 | 取り消して書き出した後の `e670f.json` | `[TARGET]` | `[TARGET]` のまま（除外の間も残っていたので、そのまま） | F3 |

### §1-2 で分かったこと

1. 記事の引き出しで自作の本棚を選ぶと、除外した本が ASIN の題で並ぶ。「表示中のN冊を追加」の N に数えられ、押すと記事に入る（e-1〜e-3）。#664 §2-0（664-results.md 72〜76行）が「すべて」の本棚について「コードで確認・E2E は未実測」とした経路は、自作の本棚では今も開いている。これを実測で確かめた。
2. 書き出したファイルでも、自作の本棚のファイルに除外した本が残る（f-1）。`all.json` に残る（f-3）のは #664 の件で、自作の本棚のファイルとは別のファイル・別の配列。
3. 「再読込の後の取り消しで本が戻らない」（step1 の c-2）は、フォルダ未接続の時だけ起きる（f-4）。

## §4 #669・#664 との重なり（2026-11-14 18:42 時点。どちらも origin/main には未着）

### #664（フォルダの書き出しで、除外した本が all.json に残る）

- 状態は tp_review。branch issue/664 の先頭は 4c8c0af（results.md と spec だけで、直しの commit はまだ無い）。
- 推奨の直し方 A は「書き出しで除外を外す・1か所」。場所は `syncToObsidianFolder` の `allBooksList` で、直す対象は `all.json` と `bookOrder.all`（664-results.md §2-3）。
- **自作の本棚のファイル（`bookshelves/<slug>.json`）の books には触らない**。664-results.md に自作の本棚への言及は無い（grep で0件）。f-1 の「e670f.json に残る」は #664 では閉じない。
- 引き出しの経路（664-results §2-0）は、A で「すべて」の本棚の books から除外が消えれば閉じる、とある。自作の本棚を選んだ時の経路（e-1〜e-3）は閉じない。
- 重なるファイル：#664 の直しは `js/bookshelf.js` の `syncToObsidianFolder`。#670 がそこを触るかは方針しだいで、案A（読む側で引く）なら触らない見込み。案B・C でも、本棚の books を書き出す箇所は `syncToObsidianFolder` の中にある。step4 の冒頭で着地を確かめ、着地していれば載せ直してから触る。

### #669（除外を記事に効かせる・「除外中」の印）

- 状態は running。branch issue/669 の直しは 84ed3cc（fix: 除外した本は記事に置いたままでも公開に出さず、エディタは「除外中」の印を出す）。その後に 06fcdaa（results §3）がある。
- 84ed3cc が閉じるもの（差分を読んで確かめた）：
  - 公開・キャンバス・プレビューの生成で、除外中の本を出さない（publish-article-generator.js）。
  - エディタの本ブロック・本棚の全画面・引き出しの行に「除外中・公開されません」の印を付ける（article-editor.js の `_artBookState`・`_artExcludedMark`）。題は `_storage.libraryBooks` から引く（ASIN だけの行をやめる）。
  - 除外の確認文に「公開中の記事に入っている本」の件数を足す（bookshelf.js の `excludeBook`・`_bulkExclude` の確認文）。
- 84ed3cc が閉じないもの（＝#670 に残る）：
  - 引き出しの一覧そのもの。除外中の本は印つきで並び続け、「表示中のN冊を追加」の N に数えられ、押すと記事に入る。#669 では、入っても公開に出ないだけ。差分では `_artDrawerFilteredAsins` と追加ボタンの件数を変えていない（grep で確認）。
  - 自作の本棚の books に残ること自体（データ）、ツリー・ホームのカード・管理一覧の冊数（b-1〜b-7）、一括の除外の `book:removed`（d-3）、書き出しの `bookshelves/<slug>.json`（f-1）。
  - フォルダ未接続で再読込した後は `_storage.libraryBooks` が null になる（c-2）。そのため #669 の `_artBookState` も題を引けず、印だけ付いて題が出ない見込み（未実測）。
- #669 の考え方：記事のデータは書き換えない。除外を取り消すと、記事にも公開にも戻る（669-results §2 の案1）。②の申し送り2により、step3 の推奨案はこれにそろっているかを比較軸に入れる。
- 重なるファイル：
  - `js/screens/article-editor.js`：引き出し。方針で引き出しの一覧から除外中を外すなら重なる。
  - `js/bookshelf.js`：`excludeBook`・`_bulkExclude` の確認文の行。#670 が `_bulkExclude` に `book:removed` を足すと、同じ関数の近い行になる。
  - step4 では #669 の着地を待ってから、その上に載せるのが安全。

## §2 コードの出典（origin/main ab34c16・行番号は関数の先頭）

- `_excludeAsinCore`（js/bookshelf.js:5926〜）：
  - `_storage.exclusions` に足す。`_storage.libraryBooks` が無ければ `this.books` から作る。
  - `library.books` から外し、`bookOrder.all` から外す。
  - `userData.bookshelves[].books` には触らない。
- `excludeBook`（:5956〜）：確認 → `_excludeAsinCore` → 端末の控え（library）→ `saveUserData` → `book:removed {asin, reason:'excluded'}` → 描き直し → `_onLibraryChanged`。
- `_bulkExclude`（:1556〜）：確認 → `asins.forEach(_excludeAsinCore)` → 端末の控え → `saveUserData` → 描き直し → `_onLibraryChanged`。`book:removed` を出さない（d-3 で実測）。
- `unexcludeBook`（:5988〜）：
  - `exclusions` から外す。
  - `_storage.libraryBooks` から書誌を探す。あれば `library.books` に戻し、`bookOrder.all` の先頭にも入れて、`book:added {reason:'unexcluded'}` を出す。書誌が無い時は exclusions から外すだけ（c-2）。
  - 本棚には触らない。今のところ、取り消すと本棚に戻るのは「books に残しているから」という結果にすぎない。
- 本の削除 `deleteBook`（:6702〜。「全ての本棚から削除」の箇所は :6729）：
  - 全ての本棚の books から外す。`_storage.libraryBooks`・`exclusions`・`bookOrder.all` からも外す。
  - 最後に `book:removed {reason:'deleted'}` を出す。
  - 本棚の books から本を外すのは、この経路だけ。
- `saveUserData` が端末の控えを書く所（:2870-2873）：`_storage.libraryBooks` を落として書く。
- `_applyLoadedState`（:3570〜）の「すべて」以外の本棚（:3678 の `memberSet`）：手元のほうが新しく並べ替えた本棚の並び順を採るだけ。除外した本を本棚から外すことはしない（コードで確認）。

## §3 測れなかった項目（step1 の代替判定）

- 親の本棚を開いた時に並ぶ冊数：1件。親のツリー・カード・管理一覧はどれも「3」で、並ぶのは2冊のはず（未実測）。
- 本棚の見出しの冊数（b-8）：表示が見当たらないので、測っていない。
- 390 幅・webkit：測っていない（spec を chromium だけにしている）。
- 冊数を出す3か所（ツリー・ホームのカード・管理一覧）は、どれも本棚の `books` の長さをそのまま数える。並べる側（本棚を開いた一覧）だけが、除外を引いた後の蔵書と突き合わせている。

step2 で測れなかった項目（代替判定）：

- #669 の 84ed3cc を当てた状態の引き出し（印つきで並ぶか・N に数えるか）：#669 が未着で、worktree へ当てるのは書き換えになるため測っていない。差分を読んで判定した（§4）。
- フォルダ未接続で再読込した後の引き出しの題（#669 の `_artBookState` が `libraryBooks` を引けない時）：測っていない（#669 が未着）。
- 親の本棚を開いた時に並ぶ冊数（step1 から持ち越し）：まだ測っていない。

step2 の終わりに spec 全件（670-A〜F）を1回流した（chromium・約1分）：4 failed（A・B・D・E＝赤のまま測るもの）・2 passed（C・F）。値は、テストごとに流した時と同じ。`lint:internal-refs` は 82 件（上限 82）。

## §5 方針の案と設計書の文案（step3・2026-11-14 18:44〜。計画で「§2」と書いた中身。§2 はコードの出典に使ったので §5 に置く）

- 基準：コードは worktree c64e144（origin/main ab34c16 に、#670 の spec と results を足したもの）。設計書は vault を 18:44 に読んだ（ADR は 169 まで）。#664・#669 はまだ origin/main に無い。

### 5-0 決まりの出典

- 02 D-1：95行「書誌の正本＝library.json。ALL 本棚の books[]＝library − exclusions」。96行「本→所属本棚の**順引きが正本**（各 `bookshelves/<slug>.json` の `books[]`）」。
  - つまり、自作の本棚の books は**利用者が決めた所属の正本**。
  - 「すべての本」の books は library − exclusions から作る派生の配列（ADR-166 で bookOrder.all と同じ配列）。この2つは性格が違う。
- 除外の決まり：02 D-7 の138行、01 F-03-6（75行）、01 の182行の表、06 の83行。どれも「ALL から外れ、再取込でも復活しない。除外一覧で解除できる」だけで、自作の本棚との関係はどこにも書かれていない。
- 除外の確認文：「除外一覧から解除できます」（`excludeBook`・`_bulkExclude`）。
- 08 ADR-006（47〜50行）：未公開のため、旧形式のマイグレーションは書かない。
- #669 の案1（669-results §2-5 の ADR 案）：記事のデータは書き換えない。解決する時に library − exclusions を効かせ、除外を取り消すと戻る。
- #664 の案A（664-results §2-3・§2-4）：派生の all.json と bookOrder.all は、書き手（書き出し）で除外を入れない。次の2案は採らなかった：
  - 「読む側で引く」：読み手が増えると漏れる。
  - 「起動時の片付け」：移行に当たる（ADR-006）。

### 5-1 同じ種類の箇所（全数）

- grep の範囲：`js/` の中で `(bs|shelf|bookshelf|sh|parent|child|target|s|b).books` に当たる所（library.books・bookManager・this.books は除く）。8 ファイル・60 か所。dashboard.js は別の書き方で1か所。これを関数ごとに分けた。
- 「今」の列は、除外した本の扱い。

| # | 箇所（関数） | 種類 | 今 | 案A | 案B・C |
|---|---|---|---|---|---|
| 1 | bookshelf-list.js `_renderSidebarTree`（ツリーの冊数） | 数える | **数える**（b-1） | 判定の関数を通す | 除外した時点から外れる（既存の残りは数え続ける） |
| 2 | bookshelf-list.js `renderBookshelfList`（管理一覧の冊数） | 数える | **数える**（b-7） | 同上 | 同上 |
| 3 | ui/bookshelf-card.js `_renderBookshelfCard`（ホームのカードの冊数と書影） | 数える・並べる | **冊数に数える**（b-6）。書影は蔵書から引くので出ない見込み（未実測） | 同上 | 同上 |
| 4 | dashboard.js `_renderReadingStats`（本棚別 Top5 の冊数） | 数える | **数える**（コードで確認・未実測） | 同上 | 同上 |
| 5 | article-editor.js `_artDrawerFilteredAsins`・`_artRenderDrawer`（引き出しの一覧・N・追加） | 並べる・数える・入れる | **並ぶ・数える・入る**（e-1〜e-3） | 同上（一覧から外す） | 同上 |
| 6 | plugin-api.js `getBookshelves`・`getBookshelf`（プラグインへ渡す本棚の写し） | 渡す | **books に入る**（コードで確認）。`getBooks()` は除外を引く＝プラグインから見て食い違う | 見える本だけを渡す | 同上 |
| 7 | bookshelf.js `applyFilters`（本棚を開いた一覧） | 並べる | 出ない（`this.books` から選ぶ） | 変えない（判定は同じ式） | 変えない |
| 8 | bookshelf.js `_shelfOrderedAsins`・`reorderBooks`（並び順。並べ替えで shelf.books を書き直す） | 所属を書く | 除外した本も位置を保つ（`shelf.books` から作る） | 変えない（所属を保つ） | 外した後の books を書く |
| 9 | bookshelf-manager.js `create`（子は親の books を受け継ぐ）・`update`・`previewReparent`・`reparent`（子 ⊆ 親の制約） | 所属を書く | 除外した本も受け継ぐ・制約に数える | 変えない（取り消すと子にも出る） | 外した後なので受け継がない |
| 10 | bookshelf-manager.js `rebuildReverseIndex`（本→本棚の逆引き） | 引く | 除外した本も引ける | 変えない | 外れた本は引けない |
| 11 | bookshelf.js `syncToObsidianFolder`（:3955 `books: b.books`＝`bookshelves/<slug>.json` を書く） | 保存先へ書く | **除外した本も書く**（f-1） | 変えない（所属の正本として書く。読む側が exclusions.json と合わせて読む） | 外した後を書く |
| 12 | bookshelf.js `_excludeAsinCore`・`excludeBook`・`_bulkExclude`・`unexcludeBook`（除外の入口） | 所属・イベント | 所属に触らない。**一括は book:removed を出さない**（d-3） | `_bulkExclude` に book:removed を足すだけ | B：全本棚から外す。C：外して控えに書き、取り消しで戻す |
| 13 | bookshelf.js `deleteBook`（全本棚から外す） | 所属を書く | 本の削除＝除外とは別の決まり | 変えない | 変えない |
| 14 | bookshelf.js `addBookToBookshelf`・`removeFromBookshelf`・`_bulkAddToShelf`、bookshelf-manager.js の同名 | 所属を書く | 除外した本は画面から選べない＝通らない | 変えない | 変えない |
| 15 | bookshelf.js `_applyLoadedState`（読込：`bookOrder[slug] = books`、手元の並びを採る時の memberSet） | 読む | 所属をそのまま読む | 変えない | 変えない |
| 16 | bookshelf.js `_ensureAllShelf`（「すべての本」） | 派生 | #662・#664 の領分 | 触らない | 触らない |
| 17 | article-editor.js `_artBuildPreviewState`・generator `_shelfBooks` | 解決 | 記事の本は #669 の生成器の判定で除外を引く。`_shelfBooks` は呼び出し元が無い（grep で定義だけ） | 触らない（#669 の領分） | 触らない |
| 18 | bookshelf.js `init` の旧 pages.json 移行・storage.js `migrateFromLegacy`・bookshelf.js `migrateUserData`（ASIN の付け替え）・book-detail.js `_detailShelvesBodyHtml` | 旧形式・詳細 | 一回きりの変換、または除外した本では開けない画面 | 対象外 | 対象外 |

- 今、除外を引いて見せているのは 7 だけ。漏れているのは 1〜6 の6か所（うち5か所は実測、4 はコードで確認）。
- 書き手の 8・9・11 は、所属をそのまま保っている。

### 5-2 案の比較

| 比較軸 | 案A：所属は残し、見せる側で引く（判定は1か所） | 案B：除外する時に全ての本棚から外す。取り消しても戻さない | 案C：外して、どの本棚にいたかを控えに残し、取り消しで戻す |
|---|---|---|---|
| ① 取り消すと元の本棚に戻るか | **戻る**（所属を消さない。今でも戻ることを c-1 で実測） | **戻らない**（蔵書には戻るが、本棚には戻らない） | 戻る。ただし控えの後に本棚を消した時・子 ⊆ 親の制約・元の並びの位置について、別に決まりが要る |
| ② データの整合 | 画面・冊数・引き出し・プラグインは1つの判定で一致する。保存と書き出しの books には除外した本が残るが、これは所属の正本として残す（exclusions.json と合わせて読む決まりにする） | 除外した時点から、books と画面が一致する。既存の残りは、移行しない限り食い違ったまま | 一致する。控えと本棚の削除・改名・付け替え・別端末の編集を合わせる処理が新しく要る |
| ③ 既存データの移行 | **要らない**（今のデータが既に案A の形）。**既存の利用者データを書き換えない** | 残りを片付けるなら起動時の片付け＝移行（#664 が ADR-006 で採らなかった形）。片付けないなら、案A と同じ読む側の直しも要る | B と同じ（残りを控えへ移すのは移行） |
| ④ 取り消せるか | 書き換えないので、取り消す対象が無い（コードを戻せば元どおり） | 外した所属は戻せない（控えが無い） | 控えがある間は戻せる。控えが壊れた時の戻し方も要る |
| ⑤ #669・#664 との重なり | #664：触らない（書き出しの `all.json` には触れない）。#669：引き出し（article-editor.js）だけ重なる。#669 が入れる「除外中」の印のうち、引き出しの行の印は、自作の本棚の経路ではそもそも並ばなくなるので出なくなる（「すべて」の経路は #664 で閉じる）。キャンバス・全画面の印は、すでに置いた本のために残る＝食い違わない | 引き出しは、新しい除外では並ばなくなるが、既存の残りは並ぶ。`_excludeAsinCore` は #669 の確認文の行に近い | B と同じ。加えて exclusions.json の形を変えるので、#664 の書き出しと同じ所に近づく |
| ⑥ プラグインのイベント | 除外は1冊ずつ・一括とも、1冊ごとに `book:removed {reason:'excluded'}` を出す（一括の漏れを直す）。所属は変わらないので `bookshelf:updated` は出さない。`getBookshelves` は見える本だけを渡す。取り消しは `book:added {reason:'unexcluded'}` で、本棚にも戻ったと読める | `book:removed` に加え、外した本棚ごとに `bookshelf:updated` を出す。本の削除（`deleteBook`）は今それを出していないので、そろえるなら削除も直す | B と同じ。取り消しの時も `bookshelf:updated` を出す |
| ⑦ 確認文「除外一覧から解除できます」 | 合う（解除すると本棚も元どおり） | 半分だけ合う（本棚には戻らない。文を変える必要がある） | 合う |
| ⑧ 触るファイル | 6〜7 個（bookshelf.js・bookshelf-list.js・ui/bookshelf-card.js・dashboard.js・article-editor.js・plugin-api.js と index.html の ?v=）＋spec | 2〜3 個（bookshelf.js・plugin-api.js のコメント）。既存の残りを移行しないなら、案A の6か所も要る | 4〜6 個（bookshelf.js・storage.js（exclusions.json の形）・`_applyLoadedState` の合わせ・06）＋既存の残りの扱い |
| ⑨ #669 の考え方にそろうか（申し送り2） | **そろう**（データを書き換えず、解決する時に引き、取り消すと戻る） | そろわない（データを書き換え、取り消しても戻らない） | 半分（取り消すと戻るが、データを書き換える） |
| ⑩ 漏れの危険（#664 §2-3 の理屈） | **当たる**＝読み手が増えると漏れる。今まさに6か所で漏れている。手当て：判定を1つの関数に寄せ、6か所を全てそこへ通す。spec で読み手ごとに1行ずつ持つ | データが正しければ当たらない。ただし起動時の片付けを書かないなら、既存の残りに読む側の手当てが要り、案A と同じ危険が残る（#664 の「起動時の片付け＝移行」もそのまま当たる） | B と同じ。加えて、控えと所属の整合が要る |

**#664 の理屈が、案A・案B にどう当たるか**

- #664 で「書き手を直す」が正しかったのは、`all.json` の books が library − exclusions から作る**派生**の配列だからで、書き手で除外を入れなくても失う情報が無い。
- 自作の本棚の books は**所属の正本**（02 D-1:96）。書き手で外すと、解除で戻すための情報を失う（＝案B）。失わないようにするには、新しい控えが要る（＝案C）。
- このため、「書き手を直す」は自作の本棚では只では済まない。#669 と同じ「データは残して、解決する時に引く」を取るなら、案A になる。
- 案A には「読み手が増えると漏れる」がそのまま当たる。これは、判定を1つの関数に寄せ、6か所を全部そこへ通し、読み手ごとの spec で塞ぐ。

### 5-3 推奨：案A

- ①④⑦⑨：取り消すと元の本棚に戻り、確認文と合い、#669 と同じ考え方。取り消す対象（書き換えたデータ）が無い。
- ③：移行が要らず、**既存の利用者データを書き換えない**（step4 の tp でもこの1行を書く）。
- ⑤：#664 とは触る所が重ならない。#669 とは引き出しだけ重なるので、step4 は #669 の着地を待って、その上に載せる。
- ⑩：判定の関数を1つにし、6か所全部を通す。spec の 670-A・B・D・E を緑にして、読み手ごとに持つ。
- **判定の関数の形（案）**：
  - 置き場所：`VirtualBookshelf` に `shelfVisibleAsins(shelf)` を置く。名前に `_` を付けないので、spec とプラグイン API から呼んでも `lint:internal-refs` に数えられない。
  - 中身：「自作の本棚の books のうち、蔵書（`this.books`＝library − exclusions）にある ASIN」を、books の並びのまま返す。「すべての本」は今どおり（ADR-166）。
  - 冊数はこの長さを使う。
- **入れる直し**：
  - 1〜6 を `shelfVisibleAsins` に通す。
  - `_bulkExclude` が1冊ごとに `book:removed {reason:'excluded'}` を出すようにする（申し送り1・⑥）。
  - `getBookshelves`・`getBookshelf` の books を見える本に絞る（写しを返すだけで、プラグイン API に本棚へ書く口は無い＝grep で確認。絞っても書き戻しで所属が消えることは無い）。
- **このイシューに入れないもの**：
  - c-2（フォルダ未接続で再読込した後の取り消しで本が消える）。別のイシューを勧める。
    - 理由：直す所は `saveUserData` の端末の控え（除外した本の書誌を `libraryBooks` に残すか）で、所属ではなく書誌の保ち方の話。#669 の `_artBookState` の題の引き方にも効く。
    - 題の案：「bookshelf：保存先につないでいない時、除外した本の書誌が再読込で消え、除外を取り消しても蔵書に戻らない（#670 で発見）」。

### 5-4 設計書の文案（vault にはまだ書かない）

**02_基本設計書**

- D-1 の96行の次に足す：
  > - 自作の本棚の `books[]` は、除外した本も含む（除外しても所属は消さない・D-7）。画面・冊数・記事の本の引き出し・プラグインに見せる本は、所属のうち library − exclusions にある本だけで、求めるのは `shelfVisibleAsins` の1か所
- D-7 の138行の次に足す：
  > - 除外しても自作の本棚の所属は残し、本棚の一覧・冊数・記事の本の引き出しには出さない。除外を解除すると、元の本棚にそのまま戻る
  > - 除外は1冊ずつ・一括とも、1冊ごとに `book:removed {reason:'excluded'}` で知らせる。所属は変わらないので `bookshelf:updated` は出さない。解除は `book:added {reason:'unexcluded'}`

**01_要件定義書**（F-03-6 の75行と182行の表は、今の文のままで矛盾しない。足すなら1句だけ）

- F-03-6：
  > 「すべての本から除外」(`exclusions.json` に追加、再取込でも復活しない。自作の本棚にも出なくなり、解除すると元の本棚に戻る)

**06_データ仕様書**

- `bookshelves/<slug>.json` の `books[]` の説明に足す：
  > 除外した本も含む（所属の正本。見せる時に exclusions.json で引く・D-7）

**05_プラグイン仕様書**

- イベント一覧の `book:removed`：
  > `reason:'excluded'` は1冊ずつ・一括とも出る。除外した本はどの本棚の `books` にも見えなくなる（所属は残り、解除の `book:added {reason:'unexcluded'}` で戻る）
- `getBookshelves()`・`getBookshelf()`：
  > `books` は見える本だけ（除外した本を含まない）

**03_詳細設計書**

- VirtualBookshelf の主要メソッド表に `shelfVisibleAsins(shelf)` を足す（CLAUDE.md の「メソッド追加は 03」）。

**08_意思決定記録**（番号は書く時の次の番号。今なら 170）

> ### ADR-xxx 除外しても自作の本棚の所属は消さない。見せる本は「所属 ∩ (library − exclusions)」を1つの関数で求め、解除すると元の本棚に戻る (2026-11-14・イシュー#670)
> - **背景**：除外 (D-7) の決まりは ALL・再取込・⌘K だけで、自作の本棚との関係が無かった。除外は本棚の books に触らず、本棚を開いた一覧だけが除外を引いていた。冊数 (ツリー・管理一覧・ホームのカード・読書統計)・記事の本の引き出し・プラグインの `getBookshelves` は、除外した本を数え・出していた。一括の除外は `book:removed` を出していなかった (#670 の実測)。
> - **決定**：
>   - 自作の本棚の books (所属の正本・D-1) は、除外で書き換えない。書き出しの `bookshelves/<slug>.json` も所属をそのまま書く。
>   - 画面・冊数・引き出し・プラグインに見せる本は、`shelfVisibleAsins(shelf)` (所属 ∩ library − exclusions) の1か所で求める。
>   - 解除すると、元の本棚にそのまま戻る。
>   - 除外は1冊ずつ・一括とも、1冊ごとに `book:removed {reason:'excluded'}` を出す。所属は変わらないので `bookshelf:updated` は出さない。
> - **「すべての本」との違い**：all.json の books は library − exclusions から作る派生の配列 (ADR-166・#664) なので、書き手で除外を入れない。自作の本棚の books は利用者が決めた所属の正本なので、書き手で外すと解除で戻せない。記事のデータを書き換えない #669 と同じ考え方。
> - **採らなかった案**：
>   - 除外する時に本棚から外す：解除で戻らず、確認文の「解除できます」と食い違う。#669 と考え方が割れる。既存の残りに移行 (ADR-006) か読む側の手当てが要る。
>   - 外して控えに残す：データの形が増える。控えと、本棚の削除・付け替え・別端末の編集との整合が要る。既存の残りの扱いは上と同じ。
> - **漏れの手当て**：読む側で引く形は、読み手が増えると漏れる (#664 が「すべての本」で採らなかった理由)。見せる本を数える・並べる所は `shelfVisibleAsins` を通し、`tests/e2e/exclude-custom-shelf.spec.js` で読み手ごとに1行持つ。
> - **確かめ方**：`tests/e2e/exclude-custom-shelf.spec.js`。実測と比較は bookshelf の `scripts/verify/670-results.md`。

- ADR-166（「すべての本」は bookOrder.all と同じ配列）・#664 の ADR 案（書き出しは all.json に除外を入れない）・#669 の ADR 案（記事のデータは書き換えず、取り消すと戻る）とは、対象の配列が違う。考え方は #669 と同じで、矛盾しない。

### 5-5 既存の利用者データ

- 案A は**既存の利用者データを書き換えない**（移行なし・控えも要らない）。
- 自作の本棚に除外した本が残っているデータは、そのまま案A の正しい形として読まれる。

### 5-6 ②に決めてほしいこと

1. 推奨の案A でよいか。
2. 「見える本」の定義：所属 ∩ 蔵書（`this.books`＝library − exclusions。本棚を開いた一覧と同じ式）でよいか。exclusions だけで引く案だと、蔵書にも除外にも無い ASIN（ぶら下がり）を数え続ける。
3. プラグインの `getBookshelves` の books を見える本に絞るか（推奨：絞って、05 に書く）。それとも所属のまま渡し、見える本を返す関数を別に足すか。
4. c-2 を別のイシューにするか（推奨：別にする。題の案は 5-3）。
5. 漏れ止めの lint（本棚の books の長さを直に数える書き方を禁じる検査）を足すか（推奨：今回は spec で持ち、lint は足さない）。

## §6 実装と検証（step4・2026-11-14 18:49〜。計画で「§3」と書いた中身。§3 は step1 の測れなかった項目に使ったので §6 に置く）

### 6-0 着手条件

- 18:49 に origin/main は d18af26。`--grep='#669'`・`--grep='#664'` はどちらも 0 件で、まだ入っていなかった。②の指示（引き出し以外を先に実装する）に従い、d18af26 へ rebase した（9 commit・衝突なし）。そこから実装した。
- **18:53 に #669 が origin/main に入った**（0a75394「fix: 除外した本は記事に置いたままでも公開に出さず…」、47505b2 まで）。#664 はまだ入っていない（0 件）。
- 引き出しの部分は、#669 の上に載せ直してから実装する（6-3）。

### 6-1 実装（feca5cb・d18af26 の上）

- `js/bookshelf.js`：
  - `shelfVisibleAsins(shelf)` を足した。見える本＝所属 ∩ 蔵書（`this.books`）を、所属の並びのまま返す。「すべての本」は books をそのまま返す。蔵書の ASIN の集合は、蔵書の配列が替わった時だけ作り直す。
  - `_bulkExclude`：`saveUserData` の後で、1冊ごとに `book:removed {asin, reason:'excluded'}` を出す（`excludeBook` と同じ順）。
- 判定を通した読み手（§5-1 の 1〜4・6）：
  - `js/screens/bookshelf-list.js` の `_renderSidebarTree`（ツリーの冊数）と `renderBookshelfList`（管理一覧の冊数）。
  - `js/ui/bookshelf-card.js` の `_renderBookshelfCard`（ホームのカードの冊数と書影の並び）。
  - `js/dashboard.js` の `_renderReadingStats`（本棚別 Top5）。
  - `js/plugin-api.js` の `getBookshelves`・`getBookshelf`・`getBookshelfBySlug`。写しの books を `_shelfCopy` で見える本に絞る。プラグインには本棚へ書く口が無いので、所属は消えない。
- イベントの説明：`js/plugin-api.js` 冒頭のイベント一覧と、`docs/plugin-dev.md`（`getBookshelves`・`getBookshelf`・`book:removed` の行）を直した。
- `index.html` の ?v=：上の5ファイルを 2026111797 にした。`check:version --range=origin/main..HEAD` は OK。
- **既存の利用者データは書き換えない**（所属・端末の控え・`bookshelves/<slug>.json` に触らない。移行なし）。670-A の再読込の行と 670-F で確かめた。

### 6-2 spec（`tests/e2e/exclude-custom-shelf.spec.js`・読み手ごとに1行）

| テスト | 確かめる読み手・経路 | 結果 |
|---|---|---|
| 670-A | 1冊ずつの除外：所属は残る（メモリ・端末の控え）。本棚を開いた一覧とツリーの冊数（子 1・親 2）。`book:removed` 1回・`bookshelf:updated` 0回。**既存データ**＝再読込した後も所属は書き換えずに、見える本だけを数える | 緑 |
| 670-B | 一括の除外（画面の選択モード）：`book:removed` が1冊ごとに1回・`bookshelf:updated` 0回。所属は残る。ツリーの冊数 1 | 緑 |
| 670-C | 解除：元の本棚にそのまま戻る（並ぶのは2冊）。ツリーの冊数 2。`book:added {reason:'unexcluded'}` が1回。プラグインの `getBookshelf` も2冊 | 緑 |
| 670-D | ホームのカード（子「1冊」・親「2冊」）・読書統計の本棚別 Top5（子 1・親 2）・本棚の管理一覧（子「1冊」・親「2冊」） | 緑 |
| 670-G | プラグインの `getBookshelves`・`getBookshelf` の books は見える本だけ。本体の所属は `[X, Y]` のまま | 緑 |
| 670-F | フォルダ（OPFS）：除外して書き出しても `bookshelves/e670f.json` は `[TARGET]` のまま（所属の正本）。library.json は全書誌のまま。ツリーの冊数は 0。再読込の後も 0。解除すると蔵書に戻り、冊数は 1 | 緑 |
| 670-E | 記事の本の引き出し（一覧・「表示中のN冊を追加」） | **test.fixme**（#669 の上に載せ直してから緑にする・6-3） |

- 計測用の `waitForTimeout` は 0 か所にした（全て `expect.poll`・`toHaveCount`・`toHaveText` の待ちに替えた）。
- `lint:internal-refs` は 82 件（上限 82）。
- フォルダ未接続で再読込した後の解除（c-2）は、②の判断どおり #670 では扱わない（別のイシュー）。spec にも入れていない。

### 6-3 まだ載せていない部分（push の前に必要）

- **記事の本の引き出し**：`js/screens/article-editor.js` の `_artDrawerFilteredAsins`・`_artRenderDrawer`（一覧・「表示中のN冊を追加」の N と追加）を `shelfVisibleAsins` に通し、670-E を緑にする。
  - #669 が 18:53 に入ったので、次は origin/main（47505b2 以降）へ rebase してから載せる。
  - #669 の「除外中」の印は、引き出しの行では出なくなる（並ばないため）。キャンバス・全画面の印は残る。
- rebase で衝突しそうな所：
  - `index.html` の ?v=：#669 は 2026111783 を使った。#670 は 2026111797 なので、より新しい値を取り直す。
  - `js/bookshelf.js` の `_bulkExclude`：#669 が確認文に `pubNote` を足した行の近く。

### 6-4 検証

- `npm run lint`：12 本中 0 本失敗。
- `npm test`（vitest）：80 files・1192 passed・2 todo。
- spec（chromium）：6 passed・1 fixme（E）。
