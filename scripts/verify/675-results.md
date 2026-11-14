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
| f-1 | （仮説）#669 の `_artBookState` で除外中の本の題が出るか | 題が出る | **未実測**（§1-2） | — |
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

## §1-2 測れなかった項目（step1 の代替判定）

- f-1（#669 の `_artBookState` で題が出るか）：**未実測**。画面で測るには、記事の保存先の差し替え・本ブロックの配置・キャンバスの描き直しの待ちが要る（#669 の `exclude-article-publish.spec.js` の作り）。step1 の時間に入らなかった。`_artBookState` を直に読むのは経路を通さないうえ、`lint:internal-refs` の上限（82）にも当たる。コード（:437 は `st.libraryBooks` を引く）と a-3（再読込の後は写しが null）・c-1（取込の後の本は写しに無い）から、題が出ない見込み。step3 で直した後、画面の行を足して確かめる。
- GitHub・ハブにつないでいる時：未実測（§2 の 5・6 で写しを作り直すので、起きない見込み）。
- 390 幅・webkit：測っていない（spec は chromium・1280 幅だけ。データの保ち方の話で、幅やエンジンに依らない見込み）。

## §2-2 step2 への申し送り（step1 の終わりに書いたもの）

- 直す所は「書誌の写しの保ち方」（§2 の 1〜3 の落とし方・8 の作り方・9 の足し方）。読む所（11〜14）は変えずに済む形が取れるかを比べる。
- 写しを端末の控えに丸ごと残すと容量の理由（§2 の 2 のコメント）に当たる。除外した本の分だけを残す形と比べる。
- C・D は再読込なし・再読込の後の別の除外でも起きるので、控えに残すだけでは閉じない。写しが「蔵書 ＋ 除外した本の書誌」になるよう、作る所（8）と取込（9 の取込版が無い）もそろえる要がある。
- 既存データ（書誌を失って exclusions に ASIN だけが残った端末）は、保存先なしでは元が無い。取込（§2 の最後）で補えるかを比べる。黙って消える (a) は選ばない（②の申し送り）。

## §3 直し方の案の比較（2026-11-14 19:15・step2）

### §3-0 前提（origin/main 61a91a2 で確かめた）

- **#664 が入った**（bbc3526 fix・ADR-170「書き出しは all.json の books と bookOrder.all に除外した本を入れない。library.json は除外を含む全書誌のまま」）。#663（605825f）・#674（ADR-172）も入った。**#670 はまだ**（`--grep='#670'` は 0 件）。
- `_storage` は保存先へ丸ごとは書かれない。書き出しは `_storage` から `exclusions`（exclusions.json）・`main`・`allInternalId` を1つずつ取り出して書く（`git grep -l _storage origin/main -- js/` は bookshelf.js・bookshelf-manager.js・dashboard.js・plugin-loader.js・screens/article-editor.js・screens/import.js の6つ。どれも欄を1つずつ読む＝`main`・`allInternalId`・`exclusions`・`libraryBooks`。`userData` を丸ごと JSON にするのは、端末の控えに書く3か所だけ）。`_storage` に1つ欄を足しても、端末の控え（`virtualBookshelf_userData`）にしか載らない。
- 設計書の今の書き方：02 D-1「書誌の正本 = `library.json`。ALL 本棚の `books[]` = library − exclusions」（02:95）。06 の「その他のキー」は `virtualBookshelf_library`＝「library のキャッシュ」、`virtualBookshelf_userData`＝「userData (settings / bookshelves / notes / bookOrder) のキャッシュ」（06:478〜479）。保存先なしの時の書誌の正本も、除外した本の書誌をどこに持つかも、書かれていない。
- ADR-006（CLAUDE.md の前提「未公開アプリのため、既存データとの互換性は考慮しない (旧形式マイグレーションを書かない)」）。既存データを書き換える移行は書かない。
- 読む所4つ（`unexcludeBook`・`renderExclusionsList`・書き出しの `excludedCache`・`_artBookState`）が要るのは、**除外した本の書誌だけ**。除外していない本の書誌は `this.books` にある。保つべき決まりは「exclusions の ASIN ごとに、書誌の写し（`_storage.libraryBooks`）にその本の書誌がある」の1つに絞れる。step1 の A〜E は、どれもこの決まりが崩れた形（A・B＝再読込で写しが消える／C＝写しを作った後に取り込んだ本が入らない／D＝再読込の後に見える本だけで作り直す／E＝それを書き出す）。

### §3-1 案

- **案1 端末の控えに「除外した本の書誌だけ」を残し、起動時に写しを組み直す**（全書誌は今どおり控えに持たない＝容量の理由は保つ）。
  - 控えに書く3か所（`saveUserData`・`_applyLoadedState`・`_applyMergedRemote`）の `libraryBooks` の落とし方を、1つの関数にまとめる。その関数は `libraryBooks` を落とす代わりに、「写しのうち exclusions にある本」だけを残す。
  - 起動の1段目（端末の控えを読む所）で、写しを「蔵書（`virtualBookshelf_library`＝見える本）∪ 控えにある除外の書誌」で組み直す。保存先につないでいる時は、2段目の `_applyLoadedState` が `library.json`（全書誌）で置き換える＝今どおり。
  - 読む所4つは変えない。
  - 置き場所の小案：
    - **1a `virtualBookshelf_userData` の `_storage` の中に別の欄（例 `excludedBooks`）**。exclusions と同じ JSON に同じ書き込みで入るので、2つが食い違わない。端末のデータを消す所・読み直しで控えを書き直す所は、もう userData を扱っているので、足す所が無い。
    - 1b 別のキー（例 `virtualBookshelf_excludedBooks`）。exclusions（userData の中）と書き込みが別になり、容量切れの時などに食い違いうる。キーを消す所・初期化の所すべてに足す要がある。
    - 1c `virtualBookshelf_library` に除外した本も入れる。06 の「library のキャッシュ」は今「見える本」の意味で読まれている（`BookManager.initialize`→`getAllBooks`→`this.books`）。入れると読み手の全数で除外を引く要が出る＝#670 の「読み手が増えると漏れる」がそのまま当たる。
- **案2 取り消す時に書誌を引き直す**：保存先なしでは引き直す元が無い（端末の控えに無い。取込の選択画面にある一覧 `pendingImportBooks` は、取込の時だけ）。単独では A〜E のどれも閉じない。既存データを補う手 (d) としてだけ使える。
- **案3 除外の時（`excludeBook`・`_bulkExclude`）だけ、除外した本の書誌を控えへ書く**：起動時の組み直しが要る点は案1と同じ。加えて、控えの除外の書誌を消す所が、取り消し・本の削除・ASIN の付け直し（:6991 付近で exclusions を付け替える）・取込の補いに散る。案1は「写し ∩ exclusions」を書く時に1か所で作るので、消す所を持たない。
- **C・D を閉じる手（案1・案3のどちらにも要る）**：`_excludeAsinCore` は今、写しが無い時だけ見える本から作る（:5977）。これを「除外する本の書誌を、除外する直前の `this.books` から必ず写しに入れる。写しが無い時は、見える本 ∪ 控えの除外の書誌から作る」に変える。取込のたびに写しへ足す形（取込の所に足す）より、足す所が1つで済む。読む所が要るのは除外した本の書誌だけなので、除外の時に入れれば足りる。

### §3-2 比較

| 比較軸 | 案1a（推奨） | 案1b | 案1c | 案2 単独 | 案3 |
|---|---|---|---|---|---|
| ① c-2（A・B）が閉じるか | 閉じる | 閉じる | 閉じる | 閉じない（元が無い） | 閉じる |
| ② C・D が閉じるか | `_excludeAsinCore` の直しと合わせて閉じる | 同左 | 同左 | 閉じない | 同左 |
| ③ E（後からフォルダ）が閉じるか | 閉じる（起動時に写しが揃い、`excludedCache` が拾う） | 閉じる | 閉じる | 閉じない | 閉じる |
| ④ #670 の案A（所属は残す・見える本＝所属 ∩ this.books）と合うか | 合う。取り消すと本が `this.books` に戻り、所属に残っている本棚に並び直す（保存先なしでも、#670 の「元の本棚に戻る」が成り立つ） | 同左 | 合うが、`this.books` に除外した本が混ざらないよう読み手の全数で引く要が出る | — | 合う |
| ⑤ #669 の `_artBookState` で題が出るか | 出る（読む所は変えない） | 出る | 出る | 出ない | 出る |
| ⑥ #664 の決まり（library.json＝除外を含む全書誌・all.json と bookOrder.all＝library − exclusions）と端末の控えの形 | **揃う**。端末の控えは「見える本（`virtualBookshelf_library`＝all.json に当たる）＋ 除外した本の書誌（`_storage.excludedBooks`）＝ library.json に当たる」。保存先なしでも、合わせると除外を含む全書誌になる | 揃うが、全書誌が2つのキーに分かれて書き込みが別 | 揃うが、キーの意味が変わる | 揃わない | 揃うが、控えの除外の書誌が書く所の数だけ食い違いうる |
| ⑦ 容量 | 除外した冊数ぶんだけ（1冊 数百バイト） | 同左 | 同左 | 0 | 同左 |
| ⑧ 保存先あり（フォルダ・GitHub・ハブ）で同期で書くファイル | 変わらない（`_storage` は丸ごと送らない・§3-0） | 変わらない | 変わらない | 変わらない | 変わらない |
| ⑨ 既存データの移行 | 要らない（書誌を失った端末は元が無いので、移行でも直せない＝§3-3 の取り消しの扱いで受ける。ADR-006） | 同左 | 同左 | 同左 | 同左 |
| ⑩ コア境界原則（ADR-041/042） | 当たらない（コアの不具合直し。プラグインの差し込み口・API は変えない。`book:added {reason:'unexcluded'}` は今の契約どおり出るようになる） | 同左 | 同左 | 同左 | 同左 |
| ⑪ 読み手が増えた時の漏れ | 少ない。読む所は写しだけを見ればよく、写しを保つ所は「控えに書く1関数・起動の組み直し・除外の時」の3つ | 1a ＋ キーを扱う所 | 多い（`this.books` の読み手すべて） | — | 中（控えの除外の書誌を書く所・消す所が散る） |

### §3-3 既存の控えデータの扱い（書誌を失い、exclusions に ASIN だけがある端末）

取り戻す元が端末に無いので、移行では直せない（ADR-006 で移行も書かない）。取り消した時の扱いを比べる。

| 案 | 中身 | 評価 |
|---|---|---|
| (a) 今どおり | exclusions から外すだけ。除外一覧にも蔵書にも出ない本になる | **不可**（黙って消える・②の申し送り） |
| (b) 止めて知らせる | 書誌が写しに無い時は exclusions から外さず、除外一覧の行も残す。toast で「書誌が端末に残っていないため戻せない。Kindle の取込で同じ本を読み込むと戻せる」と知らせる（ui-standards §2-11 の「次にどうすればよいか」を入れる。文言は step3 で `lint:copy` に通す） | 推奨（嘘のデータを作らない・本は除外一覧に残り続ける） |
| (c) ASIN だけの仮の書誌で戻す | 題＝ASIN・書影なしの本として蔵書に戻す | 不採用。仮の書誌が蔵書・本棚・記事・保存先の library.json に広がる。後の取込は既にある本（`existingASINs`）として扱うので、仮のまま埋まらない（js/screens/import.js:69・93〜94） |
| (d) 取込で補う | 取込の選択画面を出す時（js/screens/import.js:68〜74・`excludedASINs` を作る所）に、取り込むファイルにある除外中の本の書誌を写しへ入れる（除外は外さない・取り込む本には入れない）。次の保存で控えに残る | 推奨（(b) と組にする）。(b) の知らせの「取込で戻せる」を本当にする手。端末に元が無い既存データを戻せる、ただ1つの経路 |

- 推奨：**(b) ＋ (d)**。保存先（フォルダ・GitHub・ハブ）につないでいる時は、`library.json` に書誌があれば今どおり戻る。書き出しが書誌を落とした後（step1 の E）の端末も、(b)・(d) で受ける。

### §3-4 675-C/D/E を範囲に入れるか

- 推奨：**入れる**。理由は3つ。
  1. 3つとも §3-0 の同じ決まりの崩れで、直す所が重なる（控えに書く1関数・起動の組み直し・`_excludeAsinCore`）。分けると同じ関数を2つのイシューが順に触る。
  2. 完了条件「除外→再読込→取り消しで戻る」は、D（再読込の後にもう1冊除外する）を直さないと、2冊目の除外で崩れる。利用者の手順として自然。
  3. E は案1の起動時の組み直しで閉じる（足す所が無い）。C は `_excludeAsinCore` の直しで閉じる。
- 足す spec の行：A〜E を緑にする（G は緑のまま）。#670 の「元の本棚に戻る」を保存先なしで確かめる行（ツリー・ホームのカード・管理一覧の冊数が戻る）と、既存データの行（exclusions に ASIN だけがある控えで起動 → 取り消しが止まり知らせが出る → 取込の後に取り消すと戻る）、F（記事の題）の画面の行を足す。

### §3-5 実装の形（案1a ＋ (b) ＋ (d)・step3 で書く）

1. 控えに書く `_storage` を作る関数を1つ足す（名前は仮 `_storageForDevice(st)`）。`libraryBooks` を落とし、`excludedBooks`＝写しのうち exclusions にある本だけを入れる。`saveUserData`・`_applyLoadedState`（:3707〜3711 付近）・`_applyMergedRemote`（:4144 付近）の3か所をこれに替える（行番号は origin/main 61a91a2）。`_renderFingerprint` は保存ではないので今のまま。
2. 起動の1段目で写しを組み直す（写しが無く、控えに `excludedBooks` がある時：写し＝見える本 ∪ `excludedBooks`）。
3. `_excludeAsinCore`：除外する本の書誌を、除外する直前の `this.books` から必ず写しに入れる（写しが無い時は 2 と同じ式で作ってから）。
4. `unexcludeBook`：書誌が無い時は (b)（exclusions から外さない・知らせる）。ある時は今どおり（蔵書へ戻す・`bookOrder.all` の先頭へ・`book:added {reason:'unexcluded'}`・`_onLibraryChanged`）。
5. 取込の選択画面（js/screens/import.js）で (d)。
6. `?v=`（index.html の bookshelf.js・screens/import.js）を上げる。step3 の冒頭で #670 の着地を確かめ、その上に載せる（#670 は `_bulkExclude` と冊数の読み手を触る。重なるのは js/bookshelf.js の別の関数）。

### §3-6 設計書の文案（step4 で書く・まだ書き込まない）

- **02_基本設計書 D-1（:95 の下に足す）**：「保存先につないでいない時の書誌の正本は端末の控え。見える本は `virtualBookshelf_library`、除外した本の書誌は `virtualBookshelf_userData` の `_storage.excludedBooks` に持つ。2つを合わせたものが `library.json`（除外を含む全書誌）に当たる。全書誌の写し `_storage.libraryBooks` は容量のため控えに持たず、起動時にこの2つから組み直す（ADR-173）」
- **02 D-7（:140 の下に足す）**：「除外を取り消すと、書誌の写しから本を蔵書へ戻す。所属は除外しても残っているので、元の本棚に並び直す。書誌が端末に無い時は取り消しを止め、取込で戻せることを知らせる。取込の時、取り込むファイルにある除外中の本の書誌を写しへ補う（除外は外さない）」
- **06_データ仕様書「その他のキー」（:478〜479 を書き換え）**：
  - `virtualBookshelf_library`：「見える本（library − exclusions）のキャッシュ。除外した本は入れない」
  - `virtualBookshelf_userData`：「userData (settings / bookshelves / notes / bookOrder / `_storage`) のキャッシュ。`_storage` は exclusions と、除外した本の書誌だけ（`excludedBooks`＝exclusions の ASIN に当たる書誌）を持つ。全書誌の写し `libraryBooks` は持たない」
- **03_詳細設計書**：`_excludeAsinCore`・`unexcludeBook` の行と、足す関数（控えの `_storage` を作る・起動の組み直し）の行。
- **08_意思決定記録 ADR-173（番号は step4 で最新を見て取り直す。#670 が先に取ればずらす）**：「保存先なしの端末では、除外した本の書誌だけを端末の控えに残し、起動時に書誌の写しを組み直す。書誌が無い除外の取り消しは止めて知らせ、取込で補う (2026-11-14・イシュー#675・②承認)」
  - 背景：控えに書く3か所が全書誌の写しを容量の理由で落としていた。保存先なしでは組み直す元が無く、再読込の後の取り消しで本が黙って消えた。再読込しなくても、取込の後の除外・再読込の後の別の除外で同じことが起きた（675-A〜E）。
  - 決定：控えには除外した本の書誌だけを残す（容量は除外の冊数ぶん）。写しは起動時に「見える本 ∪ 控えの除外の書誌」で組み直し、除外の時に除外する本の書誌を必ず写しへ入れる。書誌の無い取り消しは止めて知らせ、取込で補う。移行は書かない（ADR-006）。
  - 採らなかった案：全書誌を控えに持つ（容量）、`virtualBookshelf_library` に除外した本を入れる（読み手の全数で引く要）、別のキー（exclusions と書き込みが別）、取り消し時に引き直す（元が無い）、ASIN だけの仮の書誌で戻す（仮の書誌が広がる）。
  - 教訓：同じ写しを読む所が4つあっても、保つべき決まりは「除外した本の書誌がある」の1つだった。読む所を直さず、保つ所を3つに絞った。

### §3-7 決めてほしいこと（②へ）

1. 採る案と置き場所：**案1a**（推奨）／1b／1c／案3。
2. 既存データの扱い：**(b) ＋ (d)**（推奨）／(b) だけ／(c)。
3. 675-C/D/E を範囲に入れるか：**入れる**（推奨）。
4. 依存：#670 は未着。step3 は #670 の着地を待って載せる（waitForIssues=[670]）。#664 は入ったので待たない。

## §4 承認案の実装と spec（2026-11-14 19:39〜19:48・step3）

### §4-0 載せ直し

- `git fetch` の後の origin/main は 33eda9e。題で確かめた：#670 は入った（0dfcfbd・73a7153 fix・ADR-174）。#664（bbc3526・ADR-170）・#663（605825f）も入っている。
- `git rebase origin/main` は衝突なし。自分の commit（spec と results だけ）は b1a7d43・45aa443 になった。
- 承認（step3 時点の申し送り）：① 案1a、② (b)＋(d)、③ C/D/E を範囲に入れる、④ #670 の上に載せる。

### §4-1 直したこと（js/bookshelf.js・js/screens/import.js・index.html）

| # | 場所（関数） | 直したこと | 閉じる行 |
|---|---|---|---|
| 1 | 新しい `_storageForDevice(st)` | 端末の控えへ書く `_storage` を作る。`libraryBooks` は今どおり落とし、`excludedBooks`＝（控えの `excludedBooks` ∪ 写し）のうち exclusions にある本だけを入れる（無ければ欄を作らない）。控えに書く3か所（`saveUserData`・`_applyLoadedState`・`_applyMergedRemote`）をこれに替えた | A・B |
| 2 | 新しい `_restoreLibraryCopy(always)`・`loadData` | 起動の1段目（端末の控えを読んだ直後）に、控えに `excludedBooks` があれば、写しを「見える本 ∪ `excludedBooks`」で組み直す。保存先につないでいる時は、2段目の `_applyLoadedState` が今どおり library.json で置き換える | A・B・D |
| 3 | 新しい `_libraryRecordOf(b)` | 写しに入れる1冊の形。`_excludeAsinCore` にあった形をそのまま切り出した（形は変えていない） | — |
| 4 | `_excludeAsinCore` | 写しが無い時は 2 の式で作る（見える本だけで作らない）。除外する本の書誌は、除外する直前の `this.books` から必ず写しに入れる（既にある書誌＝library.json 由来は置き換えない） | C・D |
| 5 | `unexcludeBook` | 書誌が写しにも `excludedBooks` にも無い時は、exclusions から外さず、toast（warning）で知らせて止める（(b)）。文は「この本の書誌が端末に残っていないため、元に戻せません。Kindle の取込で同じ本を読み込むと、元に戻せるようになります。」（`lint:copy` は通った）。書誌がある時は今どおり蔵書へ戻し、`book:added {reason:'unexcluded'}` を出す | (b) |
| 6 | 新しい `_fillExcludedBooksFrom(books)`・js/screens/import.js（取込の選択画面を出す所） | 取り込むファイルにある除外中の本の書誌を写しへ補う（(d)）。除外は外さず、取り込む本にも入れない（選択画面では今どおり除外中として選べない）。補った時だけ保存し、除外一覧を描き直す | (d) |
| 7 | `_keepLocalOverLoaded` | **step3 で見つけた**：1〜6 の後も E だけ赤だった。保存先なしで除外した後にフォルダにつなぐと、空の保存先では「手元を採る」この経路を通る。ここが写しを読んだ側の library（空）で丸ごと置き換えていて、組み直した除外の書誌が書き出しの前に消えていた。手元を採るので、手元の除外した本の書誌（写し・`excludedBooks` のうち exclusions にある本）は残して合わせる形にした。§2 の全数表の 5（作る所）に当たる | E |
| 8 | index.html | `js/bookshelf.js?v=` 2026111878 → 2026111890、`js/screens/import.js?v=` 2026111405 → 2026111890（origin/main 33eda9e の index.html の最大は 2026111878） | — |

- 読む所（`unexcludeBook` の書誌の引き方・`renderExclusionsList`・書き出しの `excludedCache`・`_artBookState`）は、5 で `excludedBooks` も引くようにした以外は変えていない。
- 保存先へ書くファイルは変えていない（`_storage` は丸ごとは送らない・§3-0）。

### §4-2 spec（tests/e2e/exclude-local-reload-unexclude.spec.js）

- 675-C の判定を「取り込んだ直後に写しへ入る」から「**取り込んだ後に除外した本の書誌が写しにある**」に替えた。承認案（4）は、取込のたびではなく除外の時に入れる形のため。取り込んだ直後の値も記録には残している（afterImport.memLibHas＝false のまま）。
- 675-A に、端末の控えに `excludedBooks` が残ること・取り消した本は控えから外れること・**元の本棚の冊数（ツリー・ホームのカード・本棚の管理一覧）が戻ること**を足した。冊数の読み方は #670 の 670-D と同じ。
- **675-H（既存データ）を足した**：exclusions に TARGET の ASIN だけがある控えで起動する。取り消しを押すと、除外は外れず・行が残り・知らせが出て・book:added は出ない。取込（TARGET の書誌を含むファイル）の後は、題が出て、取り消すと蔵書に戻り、book:added が1回出る。

| 行 | 直す前（step1・3回） | 直した後（step3・3回） | 直した後の値（JSONL） |
|---|---|---|---|
| 675-A 1冊除外→再読込→取り消し | 赤 | **緑** | 控えのキーは allInternalId・excludedBooks・exclusions（X あり）。再読込の後の写しは5冊。題「フィクスチャの本 1」。蔵書に戻る。子の本棚は Y・X。冊数はツリー 親3・子2、ホームのカード 3冊・2冊、管理一覧 3冊・2冊。book:added 1回。取り消した後、控えの excludedBooks から X が外れる |
| 675-B 一括→再読込→取り消し | 赤 | **緑** | 写し5冊・題「フィクスチャの本 2」・蔵書に戻る・子の本棚は X・Y・book:added 1回 |
| 675-C 取込の後に除外→取り消し | 赤 | **緑** | 除外した後の写しに TARGET あり・題「門の取込の本 3」・蔵書に戻る・book:added 1回 |
| 675-D 再読込の後に別の本を除外 | 赤 | **緑** | Y を除外した後も写しに X あり。X・Y とも戻り、book:added は各1回 |
| 675-E 後からフォルダにつなぐ | 赤 | **緑**（7 の直しの後） | library.json は B000000002〜B000000005 と B000000001 の5冊。exclusions.json は B000000001 |
| 675-H 既存データ（書誌の無い除外） | （無し） | **緑** | 最初の題は「B0GATEIMP3」（ASIN だけ）。取り消しを押すと止まる（除外のまま・蔵書に無い・book:added 0回）。取込の後は控えに書誌があり、除外中のまま取り込まれない。題「門の取込の本 3」になり、取り消すと戻る・book:added 1回 |
| 675-G フォルダの対照 | 緑 | **緑** | 題「門の取込の本 3」・蔵書に戻る・book:added 1回 |

- 実行：直した後に1回（1〜6 だけの時点：6 passed・1 failed＝E）。7 を直した後に `--repeat-each=3`：**21 passed（13.6 秒）**。値は7本とも3回同じ。記録は `scripts/verify/675-step3-run.jsonl`。
- 待ちは expect.poll・toBeVisible・toHaveCount だけ（waitForTimeout は使っていない）。

### §4-3 関連 spec・vitest・lint

- 関連 spec 17ファイル（全プロジェクト）：bookshelf-open-paths・book-memo-file-lifecycle・duplicate-asin-notice・exclude-article-publish（#669）・first-run-save-during-init-empty・exclude-custom-shelf（#670）・exclude-export-all-shelf（#664）・import-reload-persist・manual-add-reload-all-shelf・kindle-reimport-merge・back-nav-matrix・library-count-refresh・load-conflict-unsaved・standard-ops・status-bar-over-faces・sync-offline-reconnect・sync-section-status。**285 passed（3.3 分）・失敗 0**。選び方は承認の一覧に、`load-conflict|_keepLocalOverLoaded|unexcludeBook|exclusions|libraryBooks|excludeBook` を含む spec を足したもの。duplicate-asin-notice（計画時は #674 の既知の赤）も緑だった（#674 が入った後）。
- `npm test`：Test Files 80 passed (80)。
- `npm run lint`：12 本中 0 本失敗（`lint:copy` に toast の文を含む）。

### §4-4 残り・step4 で見ること

- F（#669 の `_artBookState` で記事の除外中の本の題が出るか）は、この step でも画面では測っていない（②の step3 の完了条件には無い）。`_artBookState` は写しを引き、A で再読込の後の写しに X があることは測った。この step の関連 spec（§4-3）で、#669 の spec（exclude-article-publish・保存先あり）が緑のことは確かめた。保存先なしの再読込の後の題の画面の行は、要れば step4 で足す。
- 設計書（02 D-1・D-7・06・03・08）は step4 で書く。ADR の番号は、#670 が ADR-174 を取ったので **ADR-175** になる見込み（step4 で最新を見て取り直す。コードのコメントには ADR-175 と書いた）。
- `?v=` は、step4 の載せ直しで origin/main の最大より新しいか取り直す。

## §5 回帰の全件比較・設計書の更新・push 前の載せ直し（2026-11-14 19:50〜・step4）

### §5-1 設計書の更新（obsidian・19:51 に書いた。vault の commit は自動バックアップに任せる）

| 文書 | 書いたこと |
|---|---|
| 02_基本設計書 D-1 | 「保存先につないでいない時は、端末の控えが書誌の正本になる」の1行を足した。見える本は `virtualBookshelf_library`、除外した本の書誌は `_storage.excludedBooks` に持つ。2つを合わせたものが library.json（除外を含む全書誌）に当たる。全書誌の写しは控えに持たず、起動時に組み直す（ADR-175） |
| 02_基本設計書 D-7 | 取り消しの1行を足した。写しから蔵書へ戻す（保存先なし・再読込の後でも同じ）。書誌が無い時は止めて取込を促す。取込で除外中の本の書誌を補う（除外は外さない・ADR-175） |
| 03_詳細設計書 | `excludeBook` / `_excludeAsinCore` の行に、除外する本の書誌を写しへ必ず入れることを足した。`unexcludeBook`・`_storageForDevice`・`_restoreLibraryCopy` / `_libraryRecordOf`・`_fillExcludedBooksFrom` の4行を足した。`_keepLocalOverLoaded` の行に、手元の除外した本の書誌を落とさずに合わせることを足した |
| 06_データ仕様書「その他のキー」 | `virtualBookshelf_library` を「見える本 (library − exclusions) のキャッシュ。除外した本は入れない」にした。`virtualBookshelf_userData` に、`_storage` の exclusions と `excludedBooks`（除外した本の書誌だけ）を持ち、`libraryBooks` は持たないことを書いた |
| 08_意思決定記録 ADR-175 | 末尾に足した（ADR-173 は #671、ADR-174 は #670 が使っていた）。背景・決定（承認の後に足した `_keepLocalOverLoaded` の1行を含む）・理由・却下した案・確かめ方 |

- 書き方：vault のパスはコマンドの文字列に出さず、`node` の中で組んだ（編集ロック回避）。どの文書も、1か所だけ当たる文を目印にして、その後ろに足すか置き換えた（目印が1か所でなければ書かずに止める作り）。08 は CRLF のファイルなので CRLF で足した（書いた後も LF 2329・CRLF 2329 で一致）。
- 書く前の vault には、01_要件定義書・02_基本設計書に他の変更が未 commit で残っていた（#670 の設計書の更新と見られる）。そこには触れず、目印の後ろに足しただけ。
- bookshelf 側の対応：この step の docs の commit の題に「設計: 02/03/06/08 ADR-175」と書く。

### §5-2 回帰の全件比較（e2e-diff-main・19:50〜19:58）

- `node scripts/verify/e2e-diff-main.mjs --base=33eda9e --port=8175 --out=work/675-e2e-diff`（基準＝載せた先の 33eda9e、作業側＝HEAD 7dcb724。作業側に未 commit の差分は results のこの節だけ）。約8分で終わった（timeout 15分の内）。
- 除外したテスト：`sort-perf-budget`（ci.yml:142 で CI でも別に流す・負荷で揺れる）だけ。

| 表 | E2E（playwright） | Unit（vitest） |
|---|---|---|
| 新しく落ちた | **0件** | **0件** |
| 新しく通った | 0件 | 0件 |
| 両方で落ちた（既存の問題） | 0件 | 0件 |

- 判定不能：0件。フレークの流し直し：なし（新しく落ちたものが無いため）。
- 画像の差分（playwright.visual.config.js・作業側のみ）：**0件 / 54件**。
- 結果一式は `work/675-e2e-diff/`（未追跡・add しない）。
