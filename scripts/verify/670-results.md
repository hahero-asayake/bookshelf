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
