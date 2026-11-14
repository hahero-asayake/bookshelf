# #675 保存先につないでいない時、除外した本の書誌が再読込で消え、取り消しても蔵書に戻らない — 実測と全数

## §0 着手条件（2026-11-14 19:05・step1）

- `git fetch` の後の origin/main は 9713381（題「docs: 669-results.md §4 に載せ直し…」）。worktree `/home/kuroko/worktrees/bookshelf/issue-675` の HEAD も 9713381。node_modules は最初からあった。
- 題で確かめた land：`--grep='#669'` は 9713381・47505b2・6a5a208…（0a75394 fix を含む）＝入っている。`--grep='#670'`・`--grep='#664'` は 0 件＝まだ入っていない（どちらも running）。
- step1 で足したのは新しいファイル（spec・このファイル・JSONL の記録）だけ。#670・#664 と重ならないので、未着のまま進めた（②の承認どおり）。

## §1 実測：保存先なし（`bookshelf_sync.method=local`・フォルダ未接続＝端末の控えだけ）・chromium・1280 幅

- spec：`tests/e2e/exclude-local-reload-unexclude.spec.js`（675-A〜E は保存先なし、675-G はフォルダ接続の対照）。赤のまま commit した（A〜E は赤、G は緑）。
- 見本：#670 の spec と同じ fixture（`tests/fixtures/fixture-userdata.json`・`fixture-library.json` の5冊）に、親の本棚 `e2e-p`（X・Y・Z）と子の本棚 `e2e-c`（X・Y）を足した。X = B000000001、Y = B000000002、Z = B000000003。C・E・G の取込は `tests/fixtures/gate-kindle-export.json`（3冊・TARGET = B0GATEIMP3）。
- 入口：
  - 1冊ずつの除外は `window.bookshelf.excludeBook` を呼び、確認の窓は画面で押した（#670 と同じ）。一括の除外は画面の操作（「すべての本」→ 選択モード → Y →「すべての本から除外」→ 確認）。
  - **取り消しは除外一覧の画面の「元に戻す」（`#exclusions-list .unexclude-btn`）を押した**。除外一覧を開く所だけ `showExclusionsModal()` を呼んだ。完了は「行が消え、exclusions から外れる」を待つ。
  - C の取込は `showImportModal()` から貼り付けの取込を画面で行った。E・G のフォルダは OPFS の模擬（`stubFolderPickerForTest`・`connectLocalFolderForTest`）。
- 待ち：expect.poll と toBeVisible・toHaveCount だけ。waitForTimeout と waitForFunction(async) は使っていない。
- 実行：同じ spec を3回流した（1回 ＋ `--repeat-each=2`）。値は6本とも3回同じだった（JSONL の各行から回数を除いて比べ、どれも1通り）。1回目は 5 failed・1 passed（23.8 秒）、2・3回目は合わせて 10 failed・2 passed（21.3 秒）＝3回とも A〜E が赤・G が緑。赤はどれも expect.soft の判定で、記録は6本とも最後まで書けた（途中の待ちで落ちた本は無い）。`npm run lint:internal-refs` は「上限(82)以内」。
- 記録：`scripts/verify/675-run1.jsonl`（1回目）・`675-run2-3.jsonl`（2・3回目）。下の表の値はここから書いた。

| # | 項目 | 期待（完了条件・仮） | 実際 | ログ |
|---|---|---|---|---|
| a-1 | 1冊除外した直後の書誌の写し（メモリの `_storage.libraryBooks`） | — | 5冊（X を含む）。`_excludeAsinCore` がこの時に `this.books` から作る | A beforeReload |
| a-2 | 同じ時の端末の控え | — | `virtualBookshelf_userData` の `_storage` のキーは `allInternalId`・`exclusions` だけ（**libraryBooks が無い**）。`virtualBookshelf_library` は4冊（X 無し） | A beforeReload |
| a-3 | 再読込の後の書誌の写し | X の書誌がある | **null**（写しそのものが無い） | A afterReload |
| a-4 | 再読込の後の除外一覧の行の題 | 本の題 | **「B000000001」**（ASIN だけ） | A title |
| a-5 | 「元に戻す」を押した後の蔵書 | X が戻る | **戻らない**（inBooks=false）。exclusions からは外れる（excluded=false）＝除外一覧にも蔵書にも出ない本になる | A after |
| a-6 | 同じ時に子の本棚に並ぶ本 | X・Y | **Y だけ** | A shelf |
| a-7 | 同じ時のツリーの子の本棚の冊数 | — | 「2」。origin/main のツリーは所属の数をそのまま出す（#670 未着）ので、戻ったかの判定には使えない | A tree |
| a-8 | 取り消しの `book:added` | 1回 | **0回** | A added |
| b-1 | 一括の除外（Y）→ 再読込 → 取り消し | Y が蔵書と子の本棚に戻り、book:added 1回 | 1冊ずつと同じ。除外の直後の写しは5冊 → 再読込で null → 題は「B000000002」→ 戻らない（inBooks=false）→ 子の本棚は X だけ → book:added 0回 | B |
| c-1 | （仮説）1冊除外した後に3冊取り込む | 取り込んだ本の書誌が写しに入る | **入らない**。写しは5冊のまま（TARGET 無し）。蔵書と `virtualBookshelf_library`（7冊）には入る | C afterImport |
| c-2 | その後に TARGET を除外して、再読込せずに取り消す | TARGET が戻り、book:added 1回 | **戻らない**（inBooks=false）・book:added 0回。除外一覧の題も「B0GATEIMP3」（ASIN だけ）。**再読込しなくても起きる** | C |
| d-1 | （仮説）X を除外 → 再読込 → Y を除外した後の写し | X の書誌が残る | **X が消える**。写しは4冊＝その時に見えていた本（Y を含み X を含まない）で作り直された | D xAfterY |
| d-2 | その後に X・Y を取り消す | どちらも戻る | X は**戻らない**（題「B000000001」・book:added 0回）。Y は戻る（題「フィクスチャの本 2」・book:added 1回） | D |
| e-1 | （仮説）保存先なしで X を除外 → 再読込 → フォルダにつなぐ → 書き出し | `library.json` は除外を含む全書誌（X あり） | **X が無い**（`library.json` は B000000002〜B000000005 の4冊）。`exclusions.json` には X がある＝書誌の無い除外がフォルダにも残る | E folder |
| e-2 | 同じ時のメモリの写し | X の書誌がある | 4冊（X 無し）。書き出しが「今の蔵書 ＋ 前の写しにある除外の書誌」で作り直したが、前の写しが無かった | E after |
| f-1 | （仮説）#669 の `_artBookState` で除外中の本の題が出るか | 題が出る | **未実測**（§3） | — |
| g-1 | （対照）フォルダ接続で TARGET を除外 → 書き出し → 再読込 | 写しに TARGET の書誌がある | ある（写しは3冊＝`library.json` から作る） | G afterReload |
| g-2 | 同じ時に除外一覧から取り消す | 蔵書に戻り、book:added 1回 | 戻る（inBooks=true）・題は「門の取込の本 3」・book:added 1回（#670 の f-4 と同じ） | G |

### 分かったこと

1. **再現できた（brief の前提）**。保存先なしで除外して再読込すると、書誌の写し（`_storage.libraryBooks`）が null になる。その後に除外一覧から取り消すと、exclusions から外れるだけで、蔵書にも元の自作の本棚にも戻らず、`book:added` も出ない（a-3〜a-8）。一括の除外でも同じ（b-1）。取り消した本は、除外一覧にも蔵書にも出ない本になる＝**黙って消える**。
2. 原因は、端末の控えへ書く3か所がどれも `libraryBooks` を落とすこと（§2 の 1〜3）。保存先なしでは、写しを作り直す元（`library.json`）が無い。フォルダ・GitHub・ハブにつないでいる時は、起動の読込（`_applyLoadedState`・`_keepLocalOverLoaded`）や書き出し（`syncToObsidianFolder`）が作り直すので起きない（g-1・g-2）。GitHub・ハブは未実測。
3. **仮説 C・D・E も実測で当たった**。どれも「写しが除外を含む全書誌になっていない」という同じ欠けから来る。
   - C：`_excludeAsinCore` は写しが無い時だけ作る（:5977〜）。作った後に取り込んだ本は写しに入らない。取込（`bookManager.saveLibrary`）は写しに足さない。足すのは手動追加（`addBookManually`）だけ。そのため**再読込しなくても**、取り込んだ後に除外した本は取り消しで戻らない。
   - D：再読込の後に別の本を除外すると、写しがその時に見えている本（除外を引いた蔵書）から作り直される。前に除外した本の書誌は、メモリからも消える。
   - E：保存先なしで書誌を失った後にフォルダにつなぐと、`library.json` に除外した本の書誌が入らない。#664 の決まり（`library.json` ＝ 除外を含む全書誌）が、フォルダの側でも崩れる。
4. 除外一覧の題も同じ欠けで ASIN だけになる（a-4・c-2・d-2）。#669 の `_artBookState`（記事の除外中の本の題）も同じ写しを引くので、同じく題が出ない見込み（f-1 は未実測）。
5. 読む所（§2 の 11〜14）はどれも「写しが除外を含む全書誌である」ことを前提にしている。直す所は読む所ではなく、写しの保ち方（作る・足す・控えに書く所）。

## §2 全数表（origin/main 9713381・行番号は該当の行・[ ] は関数）

### `_storage.libraryBooks`（書誌の写し＝除外を含む全書誌のつもりで読まれている）

| # | 場所 | 種類 | していること | 保存先なしでの結果 |
|---|---|---|---|---|
| 1 | js/bookshelf.js:2874 [saveUserData] | 控えに書く時に落とす | `const { libraryBooks, ...rest } = persisted._storage` で落として `virtualBookshelf_userData` に書く | 再読込で写しが消える（a-2・a-3） |
| 2 | js/bookshelf.js:3707〜3710 [_applyLoadedState] | 同上 | コメント「libraryBooks は容量大のため localStorage には保存しない」。保存先から読んだ後の控え | 保存先なしでは通らない |
| 3 | js/bookshelf.js:4129〜4133 [_applyMergedRemote] | 同上 | コメント「書誌の写し libraryBooks は端末内に持たない」。読み直しの合流の後の控え | 保存先なしでは通らない |
| 4 | js/bookshelf.js:5606 [_renderFingerprint] | 比べる時に外す | 描き直しの要否の指紋から外す（保存ではない） | 関係しない |
| 5 | js/bookshelf.js:2976 [_keepLocalOverLoaded] | 作る | 読んだ `state.library.books`（全書誌）で作る | 保存先なしでは通らない |
| 6 | js/bookshelf.js:3593・3704 [_applyLoadedState] | 作る | 読んだ `library.json` の全書誌で作る | 保存先なしでは通らない（g-1 はここで3冊） |
| 7 | js/bookshelf.js:3849・3877〜3881 [syncToObsidianFolder] | 作る | 今の蔵書 ＋ 前の写しにある除外の書誌（`excludedCache`）で作り直し、`library.json` に書く | 前の写しが無いと除外の書誌が落ちる（e-1・e-2） |
| 8 | js/bookshelf.js:5977〜5978 [_excludeAsinCore] | 作る | 写しが無い時だけ `this.books`（見える本）から作る | 取込の後の本が入らない（c-1）・再読込の後は前の除外が入らない（d-1） |
| 9 | js/bookshelf.js:7281〜7287 [addBookManually] | 足す | 手動追加の本を足す（写しが無ければ空から） | 足す所はここだけ。取込（book-manager.js:535 [saveLibrary]）は足さない（c-1） |
| 10 | js/bookshelf.js:6790〜6791 [deleteBook] | 外す | 本の削除で写しからも外す | 正しい |
| 11 | js/bookshelf.js:6044〜6045 [unexcludeBook] | 読む | 書誌を探す。無ければ exclusions から外すだけ（`book:added` を出さない） | 黙って消える（a-5・a-8・c-2・d-2） |
| 12 | js/bookshelf.js:6735〜6737 [renderExclusionsList] | 読む | 書誌が無ければ `{}` で `BookList.exclusionItemHtml`（js/ui/book-list.js:136〜）が ASIN を題にする | 題が ASIN だけ（a-4） |
| 13 | js/bookshelf.js:3849 [syncToObsidianFolder] の `excludedCache` | 読む | 除外の書誌を `library.json` へ持ち越す | 7 と同じ（e-1） |
| 14 | js/screens/article-editor.js:437 [_artBookState] | 読む | 除外中の本の書誌（記事の題・書影）を引く（#669） | 題が出ない見込み（f-1・未実測） |

- 他のファイル（js/storage.js:165〜197 [migrateFromLegacy] の `libraryBooks`）はローカル変数で、写しとは別物。

### `virtualBookshelf_library`（端末の控えの蔵書＝見える本 ＝ library − exclusions）

| 場所 | 種類 |
|---|---|
| js/book-manager.js:37・46・49 [initialize] | 起動で読む（形が壊れていれば捨てる）。保存先なしの蔵書の元はこれだけ＝除外した本は入っていない |
| js/book-manager.js:535 [saveLibrary] | 書く（取込など） |
| js/bookshelf.js:1569 [_bulkExclude]・6022 [excludeBook] | 除外の後に書く（除外した本を抜いた蔵書） |
| js/bookshelf.js:6051 [unexcludeBook] | 取り消しで書誌が見つかった時だけ書く |
| js/bookshelf.js:3608 [_applyLoadedState] | 保存先から読んだ見える本を書く |

### 除外中の本の書誌が手元に来るもう1つの所

- js/screens/import.js:71〜95 [取込の選択画面]：取り込むファイルの中に除外中の本があれば `excluded-book` として数えて表示する（既定では取り込まない）。取込の時だけ、除外中の本の書誌が手元に来る。step2 の「既存データの補い (d)」の元になりうる。

## §3 測れなかった項目（代替判定）

- f-1（#669 の `_artBookState` で題が出るか）：**未実測**。画面で測るには、記事の保存先の差し替え・本ブロックの配置・キャンバスの描き直しの待ちが要る（#669 の `exclude-article-publish.spec.js` の作り）。step1 の時間に入らなかった。`_artBookState` を直に読むのは経路を通さないうえ、`lint:internal-refs` の上限（82）にも当たる。コード（:437 は `st.libraryBooks` を引く）と a-3（再読込の後は写しが null）・c-1（取込の後の本は写しに無い）から、題が出ない見込み。step3 で直した後、画面の行を足して確かめる。
- GitHub・ハブにつないでいる時：未実測（§2 の 5・6 で写しを作り直すので、起きない見込み）。
- 390 幅・webkit：測っていない（spec は chromium・1280 幅だけ。データの保ち方の話で、幅やエンジンに依らない見込み）。

## §4 step2 への申し送り

- 直す所は「書誌の写しの保ち方」（§2 の 1〜3 の落とし方・8 の作り方・9 の足し方）。読む所（11〜14）は変えずに済む形が取れるかを比べる。
- 写しを端末の控えに丸ごと残すと容量の理由（§2 の 2 のコメント）に当たる。除外した本の分だけを残す形と比べる。
- C・D は再読込なし・再読込の後の別の除外でも起きるので、控えに残すだけでは閉じない。写しが「蔵書 ＋ 除外した本の書誌」になるよう、作る所（8）と取込（9 の取込版が無い）もそろえる要がある。
- 既存データ（書誌を失って exclusions に ASIN だけが残った端末）は、保存先なしでは元が無い。取込（§2 の最後）で補えるかを比べる。黙って消える (a) は選ばない（②の申し送り）。
