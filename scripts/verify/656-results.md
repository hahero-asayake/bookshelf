# イシュー#656 の記録

book-memo-file-lifecycle.spec.js の残り2件 (ローカルの「長文メモ: 変更してすぐ再読込」の揺れ・#602 の残りの fixme)。

## step1: 直す前の反復測定と、落ちた回の記録 (2026-11-14)

- 起点: worktree の HEAD = origin/main 985e770 (16:52 に fetch して一致を確かめた)。計画の時の 6a698df から、#619・#639 の commit が進んでいた。
  - #614 の 25b9472・#643 の 3f9d05d・#602 の 029bf88 を含む (`git merge-base --is-ancestor`)。
- ポート: 8156 (流す前と後に空いていることを確かめた)。
- spec は変えずに流した:
  `PORT=8156 PLAYWRIGHT_BASE_URL=http://localhost:8156 npx playwright test tests/e2e/book-memo-file-lifecycle.spec.js --project=chromium --retries=0 --grep "変更してすぐ再読込 ローカルフォルダ" --repeat-each=20 --workers=N`

| 実行 | 回数 | 落ちた件数 | かかった時間 |
|---|---|---|---|
| workers=1 | 20 | **0** | 1.3分 |
| workers=3 | 20 | **4** (repeat 8・9・10・13) | 1.4分 |
| 観測の写し (下・workers=3) | 20 | 対象の症状が1件。ほかに1件、起動の途中 (設定を開く所) で10秒を超えて切れた (対象の手順に入る前なので数えない) | 1.2分 |

- 落ち方は4件とも同じ。
  - 再読込の後に、新しい題名は保存先に届いている。
  - 「新しい名前が保存先にある」が false。古い名前のファイルが残っている。
  - 3つ目の確認 (詳細から長文メモを開く) は、押す操作が10秒で切れた。
  - 画面には読込時の3択「保存先とこの端末の両方が変わっています」(load-conflict-dialog) が出ていて、押す操作を遮っていた。4件の error-context.md すべてにこの文言がある。
- 率: 1並列では 0/20、3並列では 4/20。負荷がある時だけ出る (#614 の時の「5回に1回」と同じくらい)。
- 生のログは `_local/656/` (commit しない): base-w1.log・base-w3.log・observe-w3.log・observe/*.json (1回ごとの記録)。

### 落ちた回の記録 (観測の写し・w15-r15)

アプリのコードは変えず、一時の spec で、保存・移す記録・読込の決め方・フォルダへの書き込みを prototype で包んで記録した (sessionStorage に積む＝再読込をまたいで残る)。
時刻は「題名の編集を押す直前」からの ms。

| ms | 出来事 |
|---|---|
| 319 | 移す記録を積む (`queueBookMemoMove`: `B0MEMO5941__メモの本.md` → `B0MEMO5941__題名を変えた本.md`) |
| 401 | テストが再読込を始める |
| 405 | 保存が始まる。`takeBookMemoOps` は keepPaths に新しい名前があり、移動を put と delete の2件にした (記録は捨てていない) |
| 410 | まとめ保存 (`syncBatch`・9件): library.json → exclusions → notes → bookshelves → settings → main → 新しい名前の put → 古い名前の delete。版の印 (sync-stamp.json) は最後 |
| 410〜415 | library.json を書き終える (新しい題名・exportDate 07:57:09.611Z) |
| 415 | exclusions.json を書き始める |
| 423 | pagehide (ページが離れる)。保存はここで切れた。移す記録・未反映の印・syncBase.writing は端末に残っている |
| 1211 | 再読込の後の読込の決め方 = **'ask'**。保存先の exportDate は書きかけの版 (writing) と同じ 07:57:09.611Z。版の印は古いまま (07:57:08.255Z…) で、writing の印とは違う |
| 以後 | 3択が出たまま (`_loadConflictHold` = true)。アプリの保存は1回も走らない (走ったのはプラグインの種の書き込みだけ)。移す記録は端末に残ったまま |

- 最後の保存先 (OPFS) の中身:
  - library.json は新しい題名。
  - sync-stamp.json は古い印。
  - private/books は古い名前の1件だけ。
- 再読込で保存が始まるのは、離れる時の保存 `flushOnLeave` があるから (js/bookshelf.js:403-414)。beforeunload と pagehide の時に、待っている保存があれば `_runPendingSync()` をすぐ呼ぶ。
- ローカルの保存は1ファイルずつ順に書き、版の印は最後に書く (js/storage.js:505-518)。ハブと GitHub は1回で書く。
- 読込の決め方 (js/bookshelf.js:2909-2932): 保存先が「自分の書きかけの版」だと見るのは、exportDate と版の印の両方が writing と同じ時だけ。途中で切れたローカルの保存は exportDate だけが同じになるので 'ask' になる。

### 通った回との比べ (観測の写しの19件・`_local/656/compare.mjs`)

| 件数 | 再読込の時の保存 | 再読込の後の決め方 | 結果 |
|---|---|---|---|
| 16 | 題名の編集の後の保存は、まだ待ちの間だった (再読込の前に始まっていない) | 'local' | 再読込の後の保存1回で移動まで済む |
| 2 (w11・w13) | 離れる時の保存が始まったが、library.json を書き終える前に切れた (保存先は変わっていない) | 'local' | 同上 |
| 1 (w15) | 離れる時の保存が、library.json を書き終えた後・版の印の前に切れた | **'ask'** | 落ちた |

- 落ちるのは「離れる時の保存が、library.json を書き終えてから版の印を書くまでの間に切れた」時だけ。
- 負荷がある時はページが離れるまでの間が長く、library.json まで書けることが増える。1並列 0/20・3並列 4/20 と合う。

### step2 への申し送り

- 原因は計画の候補B (ローカルの順の書き込みが再読込で途中で切れ、読込の決め方が自分の書きかけと見なせない)。
  - 移す記録は捨てられていない (再読込の後も端末に残っていた)。依頼の見込み「js/storage.js の、移す記録を残す側」ではなかった。
- 候補A (記録を積んだ後・題名が入る前の一覧で捨てる)・候補C (readText が null で捨てる) は、落ちた回では起きていない。take:end で記録は put・delete になり、readText は中身を返した。起こりうるかは step2 で、決まった形の再現で確かめる (②の指示1)。
- 症状は長文メモの移動だけではない。自分の再読込で読込時の3択が出て、選ぶまで保存が止まる。保存先には library.json だけが届き、ほかのファイルと版の印は届かない。
- 観測の一時の spec は `_local/656/_tmp656-observe.spec.js` に写しを置き、tests/e2e/ からは `_trash/` へ移した。

## step2: 原因・決まった形の再現・直し方の案 (2026-11-14)

行番号は worktree の HEAD 985e770 のもの。origin/main は 17:00 に 36eba5e (#648) へ進んでいた (step5 で載せ直す)。

### 原因 (計画の候補B)

1. 題名を変えると、`saveUserData` が保存を予約する (800ms 後)。移す記録は `queueBookMemoMove` で端末に積む (js/bookshelf.js:6648)。
2. 再読込すると、離れる時の保存 `flushOnLeave` (js/bookshelf.js:403-414) が、予約中の保存をすぐ走らせる。
3. ローカル (LocalFSAdapter) はまとめ書きに対応していないので、1ファイルずつ順に書く (js/storage.js:499-512)。
   - 順は library.json → exclusions → notes → bookshelves → settings → main → 本棚ファイルの削除 → 長文メモの移動 → 版の印 sync-stamp.json (最後・:509-512)。
   - 書く前に「これから書く版」を syncBase.writing に控える (`_noteSyncBaseWriting`・js/bookshelf.js:2894・呼ぶ所 :3959)。
4. ページが離れて保存が library.json の後で切れると、保存先は「exportDate だけが書きかけの版・版の印は前の版」の形になる。
5. 再読込の後の読込の決め方 `_decideLoadedState` (js/bookshelf.js:2909-2932) が、自分の書きかけと見なすのは次の2つの時だけ。
   - exportDate と版の印の両方が writing と同じ (:2919)。
   - 両方が前の版と同じ (:2931)。
   - この形はどちらでもないので 'ask' になる。読込時の3択が出て、選ぶまで保存しない (`_loadConflictHold`・:2950)。移す記録・未反映の印は残るが、使われない。

- ハブと GitHub は1回で書く (beginBatch/commitBatch・js/storage.js:470-497) ので、この形にならない。
- 依頼の見込み「js/storage.js の、長文メモを移す記録を残す側」ではない。記録は捨てられず、残っていた。直す所は読込の決め方 (js/bookshelf.js)。

### 候補A・C

- A (記録を積んだ後・題名が入る前に保存が割り込み、記録を捨てる): **起こらない**。
  - queueBookMemoMove (js/bookshelf.js:6648) の直後の `bookManager.updateBook` (js/book-manager.js:468-491) は、最初の await より前に題名を書き換える。
  - その await (`saveLibrary`・:533-538) は localStorage に書くだけで、I/O を待たない。
  - 続く `this.books = getAllBooks()` までが同じタスクの中で済む。保存の予約 (setTimeout) や、I/O を待っている保存の続きが、間に入れない。
  - 注入で無理に割り込ませない限り起きないので、決まった形の再現は作っていない。
- C (元のファイルを読んで null だったら捨てる・js/storage.js:620): ローカルが null を返すのは NotFoundError の時だけ (js/local-fs-adapter.js:84-88)。元のファイルが本当に無い時なので、移す物が無く、捨ててよい (正しい動き)。

### 決まった形の再現 (一時の spec `_local/656/_tmp656-repro.spec.js`・commit しない)

- 形:
  - init script で、印 (window.__e2eHangAfterLib) が立っている間、library.json 以外のファイルの createWritable と removeEntry を返さない＝保存が library.json の後で止まる。
  - 長文メモの保存が終わって未反映の印が消えてから印を立て、題名を変える。
  - 保存先の library.json に新しい題名が入り、止めた書き込みがあったのを見てから再読込する (再読込で印は外れる)。
- 期待 (直った時): 再読込の後に3択が出ず、次の保存で新しい名前へ移り、古い名前が残らない。
- 結果 (今の版 985e770・repeat 3): **3/3 赤** (`_local/656/repro-before.log`)。3回とも次のとおり。
  - 決め方は 'ask'。3択が出たまま。
  - 移す記録と未反映の印は残ったまま。
  - 保存先は、exportDate が書きかけの版・版の印は前の版・private/books は古い名前だけ。

### 直し方の案

- **案1 (推奨)**: js/bookshelf.js の `_decideLoadedState` に条件を1つ足す。
  - 中身: exportDate が書きかけの版 (writing.exportDate) と同じで、版の印が前の版 (base.stamp) のままなら、自分の書きかけが library.json の後で切れた形として 'local' を返す。
  - 1ファイルずつ書く保存の切れ目は (exportDate, 版の印) が (前,前)・(新,前)・(新,新) の3つ。(前,前) と (新,新) は今も 'local' になる。(新,前) だけが抜けていた。
  - exportDate は、この端末が書く直前に作る時刻。他の端末が同じ値を書くことは無い。他の端末が書いていれば版の印も変わるので、今までどおり 'ask' になる。
  - ハブと GitHub は1回で書くので (新,前) にならず、挙動は変わらない。
  - 'local' の後の保存は全部のファイルを書き直す。切れて届かなかった notes・本棚・設定・本棚ファイルの削除・長文メモの移動・版の印も、そこで届く。
  - 試した結果 (当てて、元に戻した。差分は `_local/656/fix-a1-experiment.patch`):
    - 再現: **3/3 緑** (`_local/656/repro-a1.log`)。3回とも 'local'・3択なし・移動済み・版の印も新しい。
    - 読込時の3択を扱う spec 6本 (first-run-add-article-drawer・online-resync・sync-conflict・sync-offline-reconnect・load-conflict-unsaved・gate/j6-4-sync-conflict) と book-memo-file-lifecycle.spec.js 全体を workers=3 で1回: **58 passed・1 skipped (#602 の fixme)・0 failed** (`_local/656/a1-related.log`)。
- 案2 (併用しない): 離れる時の保存 (flushOnLeave) を、ローカルでは走らせない。
  - 再読込では切れにくくなる。ただし、保存の途中でタブを閉じた・落ちた時の切れ目は残る。
  - #359 の「離れる時に送る」も、ローカルで効かなくなる。
- 案3 (採らない): ローカルの書き込みを1回にまとめる (一時の名前に書いて入れ替える等)。File System Access API には、複数のファイルをまとめて入れ替える手段が無い。変更も大きくなる。
- コア境界原則との関係:
  - 案1 は、コアの読込の決め方の不具合 (自分の書きかけを他の端末の更新と見誤る) を直すもの。プラグインの差し込み口は触らない。
  - 挙動が変わるのは (新,前) の形の時だけ。今はそこで誤った3択が出ている。
- 回帰テストの案 (step3): 上の再現を book-memo-file-lifecycle.spec.js に入れる (直す前の版で赤・直した後で緑)。

### 横展開 (案と影響の範囲まで・入れるかは②が決める)

- 困るのは長文メモだけではない。ローカルの保存が library.json の後で切れた後に開くと、どの編集の後でも誤った3択が出る。
  - そこで「保存先の内容を読み込む」を選ぶと、切れて届かなかった短文メモ (notes.json)・本棚・設定の編集が消える (残るのは library.json の分だけ)。
  - 案1 で同時に直る。
- 本棚ファイルの削除待ち (#587): 保存が成功した後にだけ外す (js/bookshelf.js:3978) ので、切れても残る。'ask' の間は止まる。案1 の後は、次の保存で消える。
- 記録を捨てる3つの経路 (js/storage.js takeBookMemoOps:617-625): どれも直す必要は見当たらない。
  - 移す先が一覧に無い: 候補A の形。起こらない。
  - 元のファイルが無い: 候補C。正しい動き。
  - 移す先が既にある: 他の端末で書いた内容を守る #594 の決まり。
- 範囲の外とした所: 保存の途中で落ちた後に、別の端末がそのフォルダを読む場合 (library.json だけ新しい形を読む)。ローカルは PC の1台向け (ADR-046) のため。

## step3: 直した所・回帰テスト・直した後の測定 (2026-11-14)

②の判断 (step2 の tp): 案1で直す。js/storage.js は変えない。横展開の (a)・(b) は案1で一緒に直るので追加の作業はせず、(a) は回帰テストで1つ確かめる。(c) は変えない。(d) は範囲の外。

### 直した所

- js/bookshelf.js `_decideLoadedState` (:2919 の次) に1つ足した: 未反映の印があり、保存先の exportDate が書きかけ (writing) の exportDate と同じで、版の印が控え (base.stamp) のままなら 'local'。
  - コメントに理由を書いた: exportDate はこの端末が書く直前に作った時刻で他の端末とは重ならず、他の端末が書けば版の印も前の版から変わる。
- index.html の `js/bookshelf.js?v=` を 2026111692 → 2026111721 (origin/main 36eba5e の index.html は 2026111710。step5 の載せ直しで、その時の origin/main より新しい値か確かめ直す)。
- 設計書 (vault 27a88dc8): 03_詳細設計書の `_decideLoadedState` の行に、自分の書きかけと見る2つの形を書いた。08 の ADR-162 に追補 (イシュー#656) を足した。

### 回帰テスト (直す前＝js/bookshelf.js だけを HEAD に戻した版で赤・直した後で緑)

| テスト | 直す前 | 直した後 |
|---|---|---|
| vitest `tests/unit/decide-loaded-state.test.js` 5本 ((新,前)・(新,新)・(前,前)・他の端末 (exportDate も印も変わる)・他の端末 (印だけ変わる)) | 1 failed・4 passed。赤は (新,前) の1本 (expected 'ask' to be 'local')。残りの4本は直す前から正しい動きで、直した後も変わらないことの見張り | **5 passed** |
| E2E `book-memo-file-lifecycle.spec.js`「ローカルの保存が library.json の後で切れたまま再読込」2本 × repeat 3 (workers=3) | **6 failed** (長文メモ: 新しい名前へ移らない×3・題名だけ: 再読込の後の保存が版の印まで届かない×3) | **6 passed** |

- vitest は、js/bookshelf.js から2つのメソッド (`_sameSyncVersion`・`_decideLoadedState`) の本文を切り出し、最小の stub に付けて呼ぶ (VirtualBookshelf の class は window に出ておらず、import では取り出せないため)。
- E2E は、step2 の決まった形の再現を spec に入れたもの。init script で、印 (window.__e2eStopAfterLibrary) が立っている間、library.json 以外のファイルの createWritable・removeEntry を返さない (保存が library.json の後で止まる)。印は window に置くので再読込で外れる。待ちは全部 expect.poll か locator の expect (waitForFunction は使っていない)。
  - 長文メモ: 3択が出ず (`#load-conflict-dialog` が0件)、再読込の後の保存で新しい名前へ移り、古い名前が残らない。
  - 題名だけ (②の (a) の確かめ): 3択が出ず、再読込の後の保存が版の印まで書け (印が止める前と変わる)、未反映の印が消える。保存先とアプリの題名は新しい題名。
- 生のログ: `_local/656/vitest-before.log`・`vitest-after.log`・`reg-before.log`・`reg-after.log` (commit しない)。

### 直した後の測定 (step1 と同じコマンド・PORT=8156・spec の「変更してすぐ再読込 ローカルフォルダ」)

| 実行 | 直す前 (step1) | 直した後 |
|---|---|---|
| workers=1 × 20 | 0/20 落ちた | **0/20** (1.1分) |
| workers=3 × 20 | 4/20 落ちた | **0/20** (24秒) |

- 直した後は、落ちた件数が両方とも0件。流す前と後に 8156番が空いていることを確かめた。生のログは `_local/656/after-w1.log`・`after-w3.log`。

### ほかに流したもの

- 関係する vitest 4ファイル (decide-loaded-state・book-memo-file-ops・book-memo-move-target-exists・sync-failure): 40 passed。
- lint:internal-refs (上限82以内)・lint:e2e-wait: OK。lint 一式・vitest 全体・e2e-diff-main・check:version は step5 で流す。

## step4: #602 の残りの fixme を外す (2026-11-14)

- #614 の証拠 `_local/614/step4-602fixme.log` は、#614 の worktree ごと無かった (計画の時に確かめた・_artifacts・_trash にも無い)。そのため測り直した。
- book-memo-file-lifecycle.spec.js「長文メモ: フォルダ未接続の間の変更 ローカルフォルダ」の `test.fixme` を `test` にした。コメントは今の状態に直した (#602 の読込の決め方 029bf88 で直った・#656 で外した)。
- 測定 (PORT=8156): `--grep "フォルダ未接続の間の変更" --repeat-each=10 --workers=1` → **10/10 緑** (35.5秒・`_local/656/f602-w1.log`)。
- spec 全体を workers=3 で3回 (fixme が無くなり、skipped は0本になる): **3回とも 32 passed・0 failed・0 skipped** (1.9分・1.8分・1.9分・`_local/656/spec-all-{1,2,3}.log`)。流す前と後に 8156番が空いていることを確かめた。
- lint:known-red: OK (既知の赤 2件・違反0件)。
- 594-results.md の該当行を、古い記述を消さずに「→ 緑 (#656)」の形で更新した。
  - :202 (ローカルの列の fixme)・:216 (ローカルの「未接続の間の変更 → 繋ぎ直し」の行)・:228 (ローカルの列)。
  - ローカルの揺れを「長文メモの移す記録の側・未起票」と書いていた :214・:229 には、原因が読込の決め方の側だったことと、#656 で直したことを足した。
