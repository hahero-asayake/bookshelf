# イシュー#614 本の題名などの編集が、保存前に再読込すると古い値に戻る

## step1: 前提の確認と実測 (2026-11-14・origin/main 4f1a19b)

### 前提

| 前提 | commit | origin/main に入っているか |
|---|---|---|
| #594 の fixme (book-memo-file-lifecycle.spec.js「題名を変えてすぐ再読込」) | eba3dbd | 入っている (`git merge-base --is-ancestor`) |
| #602 の修正 (読込の決め方・ADR-162) | 029bf88 | 入っている |

#602 は計画どおり案C の形で入っている。

- 未反映の印 L は `virtualBookshelf_pendingSync`。保存先が前回から変わったか R は、library.json の exportDate と控え `virtualBookshelf_syncBase` を比べて決める。
- 決め方は `_decideLoadedState` (js/bookshelf.js:2878-2902)。手元を丸ごと採る処理は `_keepLocalOverLoaded` (:2905-2915)。
- 印を立てる共通の入口は `saveUserData` (:2828-2835)。書ける時は `_scheduleSync`、書けない時は `_markPendingLocal` を呼ぶ。

### 計画の時の原因の記述を main に合わせ直す

- 計画の時の原因は「印があっても蔵書を保存先から作り直す」だった。これは #602 で直っている。印がある時は `_decideLoadedState` が 'local' を返し、手元を丸ごと採る。
- 残差1 (離脱時の書きかけを「他の端末の更新」と見誤り、3択が出る) も #602 で手当て済み。
  - 書く前に、これから書く版を控えの `writing` に残す (`_noteSyncBaseWriting` :2869-2876)。
  - 保存先にあるのがその版なら 'local' と判定する (:2889)。

### 実測1: fixme 3本を外して流す (`--grep "すぐ再読込" --repeat-each=3`・PORT=8114)

| 保存先 | 結果 | 衝突の3択 |
|---|---|---|
| Asayake ハブ | 3/3 緑 | 出ない |
| GitHub | 3/3 緑 | 出ない |
| ローカルフォルダ | 3/3 緑 | 出ない |

9 passed (27.9s)。ログは `_local/614/run1-reload.log`。

記録用の test で再読込の後の値も見た (MEASURE-B、3保存先とも同じ結果)。

- アプリの題名は新しい題名、保存先の題名も新しい題名になった。
- 印は消えていた (保存の成功で外れる)。
- 控えは、保存先の exportDate に揃っていた。

### 実測2: 残差2 (題名の編集で、誰が印を立てるか)

`Storage.prototype.setItem` を見張り、`virtualBookshelf_pendingSync` と `virtualBookshelf_library` を書いた呼び出し元を記録した。記録用の test は commit しない (`_local/614/zz614-measure.spec.js`)。

**結論: 題名の編集の経路は、印を立てず、保存も予約しない。**

- 「編集を終える」の経路は `saveBookChanges` (js/bookshelf.js:6411) → `bookManager.updateBook` (:6496) → `BookManager.saveLibrary` (js/book-manager.js:533-535)。
- この経路が書くのは端末の `virtualBookshelf_library` だけ。`saveUserData`・`_scheduleSync`・`_markPendingLocal` のどれも呼ばない。
- ASIN を変えた時だけ、`migrateUserData` (:6533) の最後 (:6600) で `saveUserData` を通る。題名・著者・取得日だけの編集は通らない。

fixme 3本が緑だったのは、直前の長文メモの保存の印がまだ立っていたからだった。編集はその保存にたまたま相乗りしていた (MEASURE-A/B)。

- 編集の前から印は `'1'` だった。
- 編集の間に記録された書き込みは `virtualBookshelf_library` の1件だけだった。

印が消えてから (前の保存が終わってから) 題名を変えると、次のようになった (MEASURE-C/D)。

| 場面 | ハブ | GitHub | ローカル |
|---|---|---|---|
| C: 題名を変えて、再読込せずに 3+8秒待つ | 印は立たない。保存先は古い題名のまま (送られない) | 同左 | 同左 |
| D: 題名を変えて、すぐ再読込する | 端末には新しい題名が入っていた (印は無い)。再読込の後は、アプリも保存先も古い題名 (編集が消えた)。3択は出ない | 同左 | 同左 |

ログは `_local/614/run2-measure.log` と `_local/614/run3-measure.log`。

- D は「印が無い → 保存先を採る」(#602 の決め方 :2900) どおりの動き。読込の決め方の穴ではない。
- 原因は、編集の経路が #602 の共通の入口 `saveUserData` を通っていないこと。
- 「すぐ」でなくても、他の編集が後に続かない限り、題名の編集は保存先へ送られない。次に開いた時に消える (C)。

### ついでに見つけたこと (テストの側)

`book-memo-file-lifecycle.spec.js` は `attachDiag` を4か所 (:119・:197・:276・:352) で呼んでいる。しかし main では定義されていない。

- 落ちた時の記録のつもりの catch で ReferenceError になり、元の失敗が見えなくなる。
- 実測2で、前提づくり (`addBook`) が1回だけ届かずに落ちた時にこれを踏んだ (ReferenceError)。

## step2: 直したこと (2026-11-14・origin/main 18ede16 の上)

### 本体

`saveBookChanges` (js/bookshelf.js:6486) で、`updateBook` が成功した後に `saveUserData()` を1回だけ通す (:6573-6581)。

- ASIN を変えた時は、今どおり `migrateUserData` の最後 (:6679) で `saveUserData` を通る。それ以外の時は `saveUserData()` を直接呼ぶ。どちらの時も呼ぶのは1回。
- `BookManager.saveLibrary` には手を入れていない (コア境界 ADR-041/042・②の指示)。
- `saveUserData` は最初の await より前に、印 (`_scheduleSync`/`_markPendingLocal`) を立てる (:2810-2835)。`updateBook` の続きと同じ処理の中で印が立つので、印より先に再読込が割り込むことはない。
- `index.html` の `js/bookshelf.js?v=` を上げた。step3 で origin/main 98de66d の上に載せ直した時に、main 側の値 2026111660 と衝突したので、それより新しい 2026111661 にした (main の最大値 2026111660 より新しい値)。
- 設計書 03 (`saveUserData(opts)` の行) に1文を足した。「本の詳細の編集 (`saveBookChanges`) もこの入口を通す」。

### library を書く箇所の全数確認

`js/book-manager.js` と `js/bookshelf.js`。`_applyLoadedState` は保存先から読んだ内容を書くだけで編集ではないので、表から外した。

| library を書く箇所 (file:行) | 呼び出し元 | saveUserData を通るか | 直したか |
|---|---|---|---|
| `BookManager.importSelectedBooks` (book-manager.js:65 → saveLibrary :146) | 取込 `importSelectedBooks` (js/screens/import.js:232) | 通る (import.js:248) | 不要 |
| `BookManager.addBookManually` (book-manager.js:373 → :405) | 手動追加 `addBookManually` (bookshelf.js:6940) | 通る (bookshelf.js:6962) | 不要 |
| `BookManager.deleteBook` (book-manager.js:426 → :444) | 本の削除 `deleteBook` (bookshelf.js:6437) | 通る (bookshelf.js:6466) | 不要 |
| `BookManager.clearAllBooks` (book-manager.js:451 → :461) | 呼び出し元なし (js/・index.html・tests/・plugins-sample/ を grep して0件) | — | 不要 (使われていない) |
| `BookManager.updateBook` (book-manager.js:468 → :491) | 本の詳細の編集 `saveBookChanges` (bookshelf.js:6571) | **通らなかった** (ASIN を変えた時だけ `migrateUserData` 経由で通る) | **直した** (:6573-6581) |
| `AutoSaveManager.setupAutoSave` (book-manager.js:613 → :616・:621) | 呼び出し元なし (`new AutoSaveManager`・`setupAutoSave` を同じ範囲で grep して0件。定義と `window.AutoSaveManager` への公開 :627 だけ) | — | 不要 (使われていない・消さない) |
| `_bulkExclude` (bookshelf.js:1534 → localStorage :1545) | まとめて除外 | 通る (:1547) | 不要 |
| `excludeBook` (bookshelf.js:5678 → :5694) | 除外 | 通る (:5697) | 不要 |
| `unexcludeBook` (bookshelf.js:5710 → :5723) | 除外の取り消し | 通る (:5733) | 不要 |

### テスト (book-memo-file-lifecycle.spec.js)

足したもの・直したもの:

- 新しい回帰の E2E を6本足した。「本の編集: 前の保存が終わってから題名を変える」で、3保存先それぞれに (a) と (b) がある。
  - 前提づくりの後、未反映の印が消えるまで `expect.poll` で待つ (上限15秒)。そのうえで詳細の編集モードで題名を入れ、「編集を終える」を押す。
  - (a) 再読込しなくても、保存先に新しい題名が届く。
  - (b) 押した直後に再読込しても、保存先とアプリの題名が新しい題名のまま。(b) が本来の回帰。
  - 待ちは全部 `expect.poll` (上限15秒)。`waitForFunction` は使っていない。
- 既存の「題名を変えてすぐ再読込」3本の fixme を外し、コメントを「直前の長文メモの保存の印への相乗りで緑だった」に直した。
- `attachDiag` (と `consoleLines`・`beforeEach`) の定義を戻した。8b6dab5 で定義だけが消え、4か所の呼び出しが ReferenceError になっていた。アプリ内部の `_` 参照は入れていない (lint:internal-refs 上限82以内)。

実行の結果 (PORT=8114):

| 実行 | 結果 |
|---|---|
| 修正後: `--grep "すぐ再読込\|前の保存が終わってから" --repeat-each=3` (9本×3) | 26 passed・1 failed (`_local/614/step2-run.log`) |
| 　うち新しい6本×3 | **18/18 緑** |
| 　うち既存の「すぐ再読込」3本×3 | ハブ 3/3・GitHub 3/3・ローカル 2/3 |
| 修正前 (`js/bookshelf.js` だけ HEAD に戻した): 新しい6本 | **6/6 赤** (「新しい題名が保存先に届く」×3・「再読込の後に新しい題名が保存先に届く」×3。`_local/614/prefix-new.log`) |
| 修正前: 既存の「すぐ再読込 ローカル」×5 | 4 passed・1 failed (`_local/614/prefix-local5.log`) |
| 修正後: 既存の「すぐ再読込 ローカル」×5 | 5/5 緑 (`_local/614/postfix-local5.log`) |

既存の「すぐ再読込 ローカル」が落ちるのは、修正の前からある揺れ (修正前も5回に1回)。

- 落ち方は修正の前後で同じ。題名は保存先に届いているが、長文メモの移動だけが起きていない (「新しい名前が保存先にある」が false、「古い名前が保存先に残っていない」が true)。
- 長文メモの移す記録は `storage.takeBookMemoOps` (js/storage.js:605-633) で扱う。#594 の仕組みで、②の指示で直してよい範囲 (js/bookshelf.js・js/book-manager.js) の外。

ほかの検査:

- lint: e2e-goto・e2e-wait・internal-refs (上限82以内)・e2e-gate・esc・js-color・breakpoint・known-red が全部 OK。
- vitest: 75 files・1114 passed・2 todo。
- check:version は未コミットの差分を見ないので、step3 で commit してから `--range=origin/main..HEAD` で流す。

## step3: 全体の確認 (2026-11-14・origin/main 98de66d の上に載せ直した後)

- 載せ直し: rebase で `index.html` の `js/bookshelf.js?v=` が main 側 (2026111660) と衝突した。2026111661 にして解いた。
- `check:version --range=origin/main..HEAD`: OK (変更した js はすべて ?v= が上がっている)。
- lint:
  - 載せ直す前に11種がすべて OK: copy・terms・css・e2e-goto・e2e-wait・internal-refs・e2e-gate・esc・js-color・breakpoint・known-red。
  - 載せ直した後に、うち5種を流し直して OK: internal-refs・e2e-wait・e2e-gate・known-red・copy。
- `e2e-diff-main.mjs --port=8114` (base 98de66d・work 1b4a662) の判定は「新しく落ちたテストは0件 (フレーク判定のみ)」。
  - 1回目の全体実行で work 側だけ落ちた7件は、work 側で3回流し直すと全部通った (判定 flake)。
    - `book-memo-file-lifecycle` ローカル・使えない文字の題名「題名を変える」(既存)
    - `book-memo-file-lifecycle` 「変更してすぐ再読込 GitHub」(この修正で fixme を外した。base では fixme で流れない)
    - `gate/j3-5-many-books`
    - `list-staged-render` 2件
    - `reimport-diff` 2件
  - 新しく通ったもの: 1件 (`reimport-diff` direction)。両方で落ちたもの: 0件。
  - vitest: work 側 1125 passed・0 failed・2 todo (新しく落ちた0件)。
  - 画像比較: 54件中0件に差分。
  - 結果一式は `_local/614/e2e-diff2/report.md` (commit しない)。
- 本の編集の E2E を repeat 3 で流した結果は step2 の表のとおり: 新しい6本は 18/18、fixme を外した3本はローカルが 2/3。
