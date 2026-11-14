# イシュー#622 実測の記録

フォルダにつないで取り込んだ直後に再読込すると、本が消える (#605 J2-2)。

## step1：前提の確認と、今の main での実測 (2026-11-14 16:57〜17:07)

### 前提

- origin/main = `36eba5e`。#602 の修正 `029bf88`（ADR-162）と #614 の修正 `25b9472` は入っている（`git log origin/main --grep "Issue: #602"` と `--grep "Issue: #614"`）。#612 の修正 `1b89422`（ADR-163・版の印を `private/sync-stamp.json` に持つ）も入っている。
- #602・#614・#612 はどれも done。下の残差 R1 を受け持つ open のイシューは無い（DB の題名を検索。似た題名は #639・#645 だけで、どちらも別件）。

### 測り方

- chromium。PORT=8122。workers は 3〜4。
- フォルダは門の helper（`stubFolderPickerForTest`・`connectLocalFolderForTest`）でつないだ。中身は OPFS で、アプリ本物の LocalFSAdapter が読み書きする。
- 取込は、利用者と同じ貼り付け取込の画面で行った（見本は `tests/fixtures/gate-kindle-export.json` の3冊）。
- 記録用の spec は commit していない（`tests/e2e/zz-622-measure*.spec.js` に置いて流し、終わった後に外した。写しは worktree の `_trash/622-measure/` に退避した (commit しない)）。
- 再読込の後に記録したもの：
  - 「すべての本」の冊数（250ms ごとに4秒間）
  - 読込時の3択（`#load-conflict-dialog`）が出たか
  - フォルダの中身：`private/library.json` の冊数と exportDate、`private/bookshelves/all.json` の冊数、`private/sync-stamp.json` の stamp
  - localStorage：`virtualBookshelf_pendingSync`・`virtualBookshelf_syncBase`
  - 再読込の後8秒以内に、フォルダの冊数が期待の値になったか

### 結果

| 筋書き | 回数 | 再読込の後の冊数（期待どおり） | 衝突の3択が出た | フォルダの蔵書（8秒以内に期待どおり） |
|---|---|---|---|---|
| A ローカル：取込の直後、待たずに再読込 | 10 | 10/10（3冊） | **6/10** | 10/10 |
| B ローカル：取込の直後にタブを閉じ（`runBeforeUnload`）、同じ context で開き直す | 5 | 5/5 | 0/5 | 5/5 |
| C ローカル（対照）：フォルダに3冊入るのを待ってから再読込 | 5 | 5/5 | 0/5 | 5/5 |
| D ローカル：取込し、保存を待ってから同じデータを再取込し、待たずに再読込 | 5 | 5/5 | 0/5 | 5/5 |
| 既存 `gate/j2-2-import-paste`（取込の後、待たずに再読込） | 5 | 5/5 緑 | 0/5 | − |
| 既存 `gate/j2-5-import-no-duplicate`（二度押し→再取込→待たずに再読込） | 5 | 1/5 緑 | **4/5**（3択がクリックを遮って時間切れ） | − |
| E ローカル：手動追加（設定→蔵書→手動で追加）の直後、待たずに再読込 | 8 | **0/8**（4冊のはずが3冊のまま） | **5/8** | 蔵書 8/8（4冊） |
| F ローカル（対照）：手動追加の後、フォルダに4冊入るのを待ってから再読込 | 3 | 3/3（4冊） | 0/3 | 3/3 |
| 題名の編集の後、すぐ再読込（#614 の `book-memo-file-lifecycle.spec.js --grep すぐ再読込`・3保存先） | 18 | 18/18 緑 | − | − |
| ハブ（模擬）：取込の直後、待たずに再読込。見本の library.json に exportDate を足した | 3 | 3/3（5→8冊） | 0/3 | 3/3 |
| GitHub（模擬）：同上 | 3 | 3/3 | 0/3 | 3/3 |
| ハブ・GitHub（模擬）：見本のまま（library.json に exportDate が無い） | 6 | 6/6 | 6/6 | 0/6（3択が出て送らない） |

注記：
- ハブ・GitHub の模擬は route の差し替えなので、実際の通信で「離れる時に送信が切れる」のとは違う。
- 見本の `tests/fixtures/fixture-library.json` には exportDate が無い。そのため控えも空になり、`_decideLoadedState` の「控えが無い」分岐で、未反映の編集があれば毎回3択になる。アプリが自分で書く library.json には必ず exportDate が入るので、これは模擬の見本の都合とみる。ただし、ハブ・GitHub の見本で「編集→すぐ再読込」を書く spec は、見本に exportDate を足すか、空の保存先から始める必要がある。
- 除外（削除）は時間内に測れていない（未実測）。

### 分かったこと

1. **本が消える穴（#622 の元の症状）は、今の main では起きない。** A・B・J2-2 の計20回すべてで、再読込の後に3冊が見え、フォルダにも3冊が入った。#602 の修正（`_decideLoadedState` で、未反映の印があれば手元を採る）で塞がっている。
2. **残差 R1：1台で使っていても、読込時の3択が出る**（A は6/10、J2-5 は4/5、E は5/8）。
   - 3択が出た回は、フォルダが毎回同じ形だった。library.json は書き換わっていて、exportDate は控えの `writing.exportDate` と一致する。一方で `sync-stamp.json` はまだ書かれていない（A は stamp 無し、E は stamp が古い控えのまま。E は all.json も古い3冊のまま）。つまり、ローカルの保存が書きかけのまま止まっている。
   - 原因（コードの読み。行番号は 36eba5e）：`js/bookshelf.js:2902-2932` の `_sameSyncVersion`・`_decideLoadedState` は、保存先の版を exportDate と stamp の**組**で、`writing`（書きかけの版）と `base`（控え）にそれぞれ照らす。どちらかの組と完全に一致しなければ 'ask' を返す。ローカルの保存はファイルを順番に書き、stamp は最後に書く（`js/storage.js:510`）。だから途中で止まると「exportDate は新しく、stamp は古い」状態になり、どちらの組とも一致しない。
   - 起きる場面は、library.json の exportDate が進む保存（本の一覧が変わる時）に限られる。取込と手動追加では実測で確かめた。除外・削除も同じとみるが、未実測。メモ・題名の編集では起きなかった（題名は 18/18 緑）。
   - **取込だけの穴ではない。** また #614 の直し漏れでもない。`writing` の組の照合（#602・ADR-162）と、印を別のファイルに置いたこと（#612・ADR-163）の組み合わせで生じている。
   - ハブはまとめて1回で送り、同じまとめに印も入れる（`js/storage.js:484`）。GitHub は1回の commit で書く。どちらも書きかけの状態が残らないので、測った範囲では起きなかった（各 0/3）。
   - 直し方の候補：`_decideLoadedState` の照合を「印ごと」にする。exportDate が {控え, 書きかけ} のどちらかと一致し、かつ stamp も {控え, 書きかけ} のどちらかと一致すれば「自分の書き込み」とみなす（数行の変更）。保存先は変わっていないものとして手元を採り、書き直す。
3. **残差 R2：手動追加の直後に再読込すると、「すべての本」が3冊のまま**（E は 0/8。待ってから再読込した F は 3/3 で問題なし）。
   - 3択が出なかった回（E#1）の状態：フォルダは library.json が4冊・all.json が4冊・印は無し。手元の localStorage は library が4冊・`bookOrder.all` が4件。ただし、`virtualBookshelf_userData` の「すべて」本棚の `books` は3冊で、画面も4秒間3冊のままだった。
   - 取込（A）では起きないので、手動追加の経路に固有の問題。手動追加は `bookOrder.all` には足すが（`js/bookshelf.js:7041-7046`）、ほかの更新が抜けているとみる。原因は特定できていない（要追加調査）。

### ②への分かれ道（(ii)：#602 が入っていて、残差がある）

- R1：取込の経路だけの穴ではない。ただし、#622 の既知の赤（`docs/gate/known-red.json` の J2-2・J2-5。どちらも issue=622）を外せないのは R1 のため（J2-5 は 4/5 で R1 の3択に遮られて赤）。#602・#612・#614 はどれも done で、受け持つ open のイシューは無い。
  - 案α（推奨）：#622 の step2 で直す。`_decideLoadedState` の照合を印ごとにして、回帰 spec（取込・手動追加の直後にすぐ再読込し、3択が0回・冊数・フォルダの中身を確かめる）を置き、J2-2・J2-5 を既知の赤から外す。
  - 案β：R1 は新しいイシューに出す。#622 は回帰 spec だけを置き、既知の赤は R1 のイシューが外す。
- R2（手動追加の直後の再読込で冊数が3のまま）：取込ではないので #622 の範囲の外。新しいイシューを推奨する（原因は未特定）。

## step2：R1 の修正と回帰 spec（2026-11-14 17:10〜17:21・origin/main 16c0a10 の上）

### 直したところ

- `js/bookshelf.js` の `_sameSyncVersion` を `_ownSyncVersion(base, state)` に置き換えた。保存先の exportDate と stamp を1つずつ、控え（base）と書きかけ（base.writing）のどちらかに照らし、両方とも一致すれば「この端末が書いた版」とみなす。`_decideLoadedState` の2か所（書きかけの照合と、最後の照合）はこれを呼ぶ。
- 他の端末の書き込みを自分のものと取り違えない理由（差分の注記と同じ）：他の端末は保存のたびに、その端末で作った stamp（時刻＋乱数・`js/storage.js` newSyncStamp）を書く。そのため、どちらの控えの stamp とも一致せず、今までどおり 'ask' になる。
- 今回あらたに「自分の版」と認めるようになった組み合わせは、「exportDate は書きかけ・stamp は控え」（ローカルの保存が library.json の後、印の前で切れた形）だけ。設計書 03 の `_decideLoadedState` の行は、もともとこの形を「自分の書きかけ」と書いていたが、コードが組で照らしていたので、ここが食い違っていた。
- `index.html` の `js/bookshelf.js?v=` を 2026111710 から 2026111722 に上げた。
- `docs/gate/known-red.json` から J2-2・J2-5（issue=622）を外して0件にした。`tests/e2e/gate/README.md` の J2 の行を「投入済み・緑」に直した。
- 見本の helper（`seedHubDataForTest`・`seedGitHubDataForTest`）に、省略できる引数 `{ exportDate }` を足した（既定の動きは変えていない）。
- 設計書 `03_詳細設計書.md` の `_decideLoadedState` の行を、`_ownSyncVersion` と照らし方の説明に直した（obsidian・未コミット）。

### 回帰 spec（tests/e2e/import-reload-persist.spec.js・chromium）

| テスト | 直す前（3回） | 直した後（5回） |
|---|---|---|
| ローカル：取込の直後、待たずに再読込 | 1/3（2回は3択） | 5/5 |
| ローカル：取込の直後にタブを閉じて開き直す | 3/3 | 5/5 |
| ローカル：手動追加の直後に再読込（冊数はホームの「蔵書数」とフォルダで確かめる） | 1/3（2回は3択） | 5/5 |
| ローカル：除外の直後に再読込（冊数はホームの「蔵書数」とフォルダの exclusions.json で確かめる） | 3択は 0/3。ただし「すべての本」が3冊のまま（R2） | 5/5 |
| ハブ：取込の直後に再読込（見本に exportDate あり） | 3/3 | 5/5 |
| GitHub：同上 | 3/3 | 5/5 |
| fixme 2本：手動追加・除外の直後の再読込で「すべての本」の冊数（R2・別イシュー） | − | skip |

- 3択が出ないことは、`#load-conflict-dialog`・`#sync-conflict-dialog` が見えないことで確かめる。その前に、同期欄（`#obsidian-sync-status`）が「同期済み」になり、フォルダに期待の本が入ること（expect.poll・最大10秒）を待つ。

### ほかの確認（直した後）

- `gate/j2-2-import-paste`：5/5 緑。`gate/j2-5-import-no-duplicate`：5/5 緑（直す前は 1/5）。
- `gate/j6-4-sync-conflict`（2台で本当に衝突、ハブと GitHub）：3回×2本＝6/6 緑。3択は今までどおり出る。
- 読込・保存先に関わる既存 spec：j6-1・j6-2・j6-3・j6-5・j4-1・j4-3、load-conflict-unsaved・sync-conflict・sync-offline-reconnect・publish-conflict-hub・book-memo-file-lifecycle・first-run-save-during-init-empty を1回ずつ流し、60本緑・1本 skip（もとからある skip）。
- `npm run lint`：12本中0本失敗（lint:internal-refs・lint:known-red「既知の赤 0件」を含む）。`npx vitest run`：78ファイル・1176本緑（todo 2）。
- `check:version --range=origin/main..HEAD` は commit の後（step3）に流す（未コミットの差分は見ないため）。

### R2 について（#622 では直さない）

- 手動追加でも除外でも、直後に再読込すると「すべての本」の冊数が前のまま残る（手動追加は4冊のはずが3冊、除外は2冊のはずが3冊）。ホームの「蔵書数」とフォルダの中身は正しい。取込では起きない。
- 別のイシューとして起票してほしい。spec では fixme 2本で残してある。

## step3：検証一式・commit・rebase（2026-11-14 17:21〜17:35）

- commit `6b52501` を作り、origin/main が #654 の6件で `1234cf4` に進んでいたので rebase した → `b718955`。衝突は `index.html` の `js/bookshelf.js?v=` の1行だけ（#654 は 2026111711、こちらは 2026111722）。新しい方の 2026111722 を残した（origin/main の最大値 2026111711 より新しい）。`js/bookshelf.js` は自動で合わさり、#654 の変更は残っている（差分は自分の3か所だけ）。
- origin/main..HEAD は `b718955` の1件だけ（他のイシューの commit は無い）。

| 検証 | 結果 |
|---|---|
| 回帰 spec ＋ J2-2・J2-5 を `--repeat-each=5`（chromium・rebase 前の 6b52501） | 40/40 緑（fixme 2本×5回は skip） |
| `npm run lint`（12本・lint:internal-refs・lint:known-red を含む） | 12本中0本失敗 |
| `npm run check:version -- --range=origin/main..HEAD`（rebase 前・後） | OK（2回とも） |
| `npx vitest run`（rebase 後） | 78ファイル・1176本緑（todo 2） |
| `scripts/verify/e2e-diff-main.mjs --port=8122`（base＝origin/main 1234cf4、work＝rebase 後の b718955・17:27 開始） | 新規落ち **0**・新規通過 2・両方落ち 0。base は通過 1080・落ち 2、work は通過 1088・落ち 0 |

- e2e-diff-main は、E2E を両側とも流し終えた後、vitest の段階で、裏で動かす時の上限（10分）に当たって止められた（3表の report は出ていない）。表の数字は、出力された `base.e2e.json`・`work.e2e.json` を突き合わせて自分で数えた。vitest は上の行で別に流している。
- 新規通過2本のうち、`gate/j2-2-import-paste` は base で既知の赤のまま流れて落ちたもの（この修正で緑）。`save-failure-visible`「GitHub: トークンを更新しても 401 なら…」は base 側だけの落ちで、この修正とは関係しない（両方で見ると揺れ）。

## step4：push の前の載せ直しで、R1 の直しを #656 のものに合わせた（2026-11-14 17:38〜）

- push の直前に fetch すると、origin/main が `1c99d78` に進んでいた。その中の #656（`1ec581d` fix：ローカルの保存が library.json の後で切れたまま再読込しても、自分の書きかけと見て3択を出さない）が、step2 で直した R1 と同じ穴を、先に main で直していた。#656 は、`_decideLoadedState` に「exportDate は書きかけ・印は控え」の時に 'local' を返す1か所を足している。単体テスト `tests/unit/decide-loaded-state.test.js` も付いている。
- 二重に直さないため、載せ直しの衝突（`js/bookshelf.js`・`index.html`）は main 側を採った。step2 の `_ownSyncVersion` への置き換えと `?v=` の上げは取り下げた（`js/bookshelf.js`・`index.html` は main と差分0行）。設計書 03 の行も #656 の書いた文に戻した（obsidian で 31d82c59 を revert）。
- #622 に残すのは次のとおり：回帰 spec `tests/e2e/import-reload-persist.spec.js`、門の J2-2・J2-5 を既知の赤から外すこと、見本の helper の `{ exportDate }`、この記録。fixme 2本には R2 のイシュー #662 を書いた。
- 回帰 spec と J2-2・J2-5 は、#656 の直しの上で流し直して確かめた（結果は下の追記）。

### 載せ直した後の確認（#656 の直しの上・17:39〜17:45・マシンのロード 75〜82）

- 回帰 spec ＋ J2-2・J2-5 を5回ずつ：ローカル4本（取込・タブを閉じて開き直す・手動追加・除外）は 20/20、ハブは 5/5、J2-2 は 5/5、J2-5 は 5/5。GitHub は 9/10。
- GitHub だけを5回流し直すと 2/5（3回は3択が出た）。記録用の spec で、3択が出た時の状態を見た（3回）。保存先は見本のまま（5冊・印なし）で、控えの exportDate・stamp と一致していた。書きかけ（writing）は新しい版、未反映の印は 1。この組み合わせでは、`_decideLoadedState` は #656 の前でも後でも（step2 の `_ownSyncVersion` でも）'local' を返すので、読込時の3択ではない。再読込の後、GitHub へのまとめ保存が2本並んで走っていた（tree・commit・ref の PATCH が2組）。重なった保存で、書き込み時の3択が出たとみられる。
- これを R3 と呼ぶ。R1 とも #656 とも別の穴で、GitHub だけで起きる（ハブは 5/5＋5/5 緑）。step2・3 の軽い時には 10/10 緑だったので、重い時ほど出やすい。#622 では直さない。回帰 spec の GitHub の行は fixme にし、理由を書いた。別のイシューとして起票してほしい（再現：重い時に `--grep GitHub --repeat-each=5`）。
