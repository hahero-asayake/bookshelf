# #670 自作の本棚が、除外した本を books に持ったまま — 実測と方針

## §0 着手条件（2026-11-14 18:31・step1）

- `git fetch` の後の origin/main は ab34c16（題「docs: 659-results.md §5 に push の直前の載せ直し…」）。
- `git log origin/main --oneline --grep='#669'` は 0 件、`--grep='#664'` も 0 件。どちらもまだ入っていない（#664 は tp_review、#669 は running。計画時点と同じ）。
- step1 で足したのは新しいファイル（`tests/e2e/exclude-custom-shelf.spec.js` とこのファイル）だけ。2つと重ならないので、未着のまま進めた。
- worktree は `/home/kuroko/worktrees/bookshelf/issue-670`（HEAD = origin/main ab34c16）。node_modules は最初からあった。

## §1 実測①：ローカル保存（フォルダ未接続＝端末の控えだけ）・chromium・1280 幅

- spec：`tests/e2e/exclude-custom-shelf.spec.js`（670-A・670-B・670-C）。赤のまま commit した。
- 見本：fixture に、親の本棚 `e2e-p`（X・Y・Z）と、その子の本棚 `e2e-c`（X・Y）を足した。X = B000000001（1冊ずつ除外する本）、Y = B000000002（一括で除外する本）、Z = B000000003（除外しない本）。
- 入口：`window.bookshelf.excludeBook` と `_bulkExclude` を呼び、確認の窓は画面で押した（除外ボタンは、編集モードの本の詳細にしか無い。#622 の 662-H と同じ入口の取り方）。取り消しは `window.bookshelf.unexcludeBook` を呼んだ（除外一覧の画面は通していない）。
- 実行：同じ spec を3回流し、値は3回とも同じだった。最後の回は 2 failed・1 passed（4.6 秒）。
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
| b-6 | 本棚の管理一覧（`.book-count`）・ホームのカード・本棚の見出しの冊数 | — | **測っていない**（step1 の時間内に入れられなかった）。コードでは、管理一覧も `bookshelf.books.length` を数える（`bookshelf-list.js` の管理一覧の描画）ので、同じく「2」になるはず（未実測）。step2 で測る | — |
| c-1 | 再読込せずに取り消す | 子の本棚に並び直す | 並び直す（`[Y, X]`）。`book:added {reason:'unexcluded'}` が1回 | C1 |
| c-2 | 再読込した後に取り消す | 子の本棚に並び直す | **戻らない**。除外の一覧からは消えるが、蔵書（`bookshelf.books`）に X が戻らず、本棚にも並ばない。`book:added` も出ない。子の本棚の books には X が残ったまま | A3 |
| d-1 | 1冊除外した時の `book:removed` | 1回 | 1回（`{asin: X, reason: 'excluded'}`） | A1 |
| d-2 | 同じ時の本棚側のイベント（`bookshelf:updated`） | — | 出ない（`books:changed` も出ない） | A1 |
| d-3 | 一括で除外した時の `book:removed` | 1回 | **0回**（4つのイベントのどれも出ない） | B1 |
| d-4 | 取り消した時の `book:added` | 1回 | 再読込なしは1回（c-1）。再読込の後は0回（c-2） | C1・A3 |

### 分かったこと

1. 除外しても、自作の本棚の books には除外した本が残る。メモリでも、端末の控えでも、再読込の後でも残る。brief の前提を実測で確かめた。
2. 本棚を開くと除外した本は並ばない（表示する側で除外を引いている）。一方、ツリーの冊数は残った分も数える（「2」と並ぶ1冊）。
3. 一括の除外は `book:removed` を出さない。②の申し送り1により、このイシューの範囲で直す（比較軸⑥）。
4. 除外しても本棚側のイベントは出ない。プラグインが除外を知る手段は、1冊ずつの除外の `book:removed` だけ。
5. **brief に無い新しい点**：フォルダにつないでいない時、再読込の後に除外を取り消すと、本が蔵書に戻らない。除外の一覧からは消えるので、除外一覧にも蔵書にも出ない本になる。原因はコードで確かめた：
   - `saveUserData` は端末の控えへ書く時に `_storage.libraryBooks` を落とす（js/bookshelf.js:2870-2873）。
   - そのため再読込の後は `_storage.libraryBooks` が null になる（A3 で null を確認）。
   - `unexcludeBook` は書誌を `_storage.libraryBooks` から探すので、見つからない。
   
   フォルダにつないだ時は `syncToObsidianFolder` が `libraryBooks` を作り直す（:3872）ので、戻る見込みがある（未実測）。step2 の書き出しの実測で、フォルダにつないだ時も測る。#670 の範囲に入れるかは、step3 の tp で②に諮る。

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

- 管理一覧・ホームのカード・本棚の見出しの冊数（b-6）、親の本棚を開いた時に並ぶ冊数：3件。理由は時間。step2 で測る。
- 390 幅・webkit：測っていない（spec を chromium だけにしている）。
