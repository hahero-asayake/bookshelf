# イシュー#594 検証記録（長文メモのファイルが本の削除・題名変更・ASIN 変更で取り残される）

## step1: 修正前の再現（2026-11-14）

- 土台: origin/main 66d9ac4 ＋ #587 のテスト commit bb39989 の cherry-pick（保存先の模擬 `tests/e2e/helpers/storage-fakes.js` を使うため。#587 は修正本体が未着地＝`git log origin/main --grep="Issue: #587"` が0件）。
- テスト: `tests/e2e/book-memo-file-lifecycle.spec.js`（新規・3操作×3保存先＝9本）。
  - 長文メモは画面の操作で書く（本の一覧をクリック → 詳細の「長文メモを書く」→ 本文を入れて Esc＝完了で保存）。
  - 題名・ASIN の変更も画面の操作で行う（詳細の編集モード → 題名/オリジナル ASIN を書き換え →「編集を終える」＝保存）。
  - 例外が2つある。1つ目は本の追加（前提づくり）で、`addBookManually` を呼ぶ。2つ目は本の削除で、`deleteBook` を呼ぶ。**origin/main の画面には本の削除ボタンが無い**（`js/screens/book-detail.js:393-396` が `.delete-btn` にクリックを付けるが、そのボタンを描く箇所が js/ のどこにも無い＝`grep -rn "delete-btn" js/` で確認）。削除ボタンが画面から消えているのは別の不具合の候補なので、②へ報告する。
- 観測点: 保存先（模擬の中身）に新しい名前・古い名前のファイルがあるか／変更後に詳細から長文メモを開いた時、書いた本文が出るか。
- 実行: `PORT=8194 npx playwright test tests/e2e/book-memo-file-lifecycle.spec.js --project=chromium --retries=0`

### 結果（実行2・04:05〜04:09・workers=5）

| 操作 | Asayake ハブ | GitHub | ローカルフォルダ |
|---|---|---|---|
| ① 本の削除 | 判定できず（`deleteBook` を待つ `page.evaluate` が60秒戻らず） | 判定できず（前提づくりで本が5秒以内に保存先へ届かず） | 判定できず（ハブと同じく `page.evaluate` が60秒戻らず） |
| ② 題名の変更 | 判定できず（前提づくりで本が5秒以内に保存先へ届かず） | **再現**：新しい名前が無い・古い名前が残る・開くと本文が出ない | **再現**：同左 |
| ③ ASIN の変更 | **再現**：新しい名前が無い・古い名前が残る・開くと本文が出ない | **再現**：同左 | **再現**：同左 |

- 「判定できず」の4本はテストの組み方の問題（待ち時間が短い、削除の処理の完了を待っていた）。実行3で直して流した結果を下に書く。
- 再現した5本の出力の要点（どれも同じ形）:
  - `新しい名前 private/books/B0MEMO5941__題名を変えた本.md が保存先にある` → Expected: true / Received: false
  - `古い名前 private/books/B0MEMO5941__メモの本.md が保存先に残っていない` → Expected: false / Received: true
  - `題名を変えた後に詳細から長文メモを開くと、書いた本文が出る` → 本文 `MEMO-BODY-594 …` を含まない（新しい名前で探して見つからず、雛形が出る）
  - ASIN の変更も同じ形（新しい名前 `B0MEMO5942__メモの本.md` が無く、古い `B0MEMO5941__メモの本.md` が残る）。

### 結果（実行3・04:10〜04:13・workers=3）

実行2から直した点: 前提づくりの待ちを5秒→20秒にした。`deleteBook` の完了は待たないことにし、結果は保存先で見るようにした。

| 操作 | Asayake ハブ | GitHub | ローカルフォルダ |
|---|---|---|---|
| ① 本の削除 | 判定できず（20秒待っても、削除後の library.json に本が残ったまま＝削除そのものが保存先へ届かない） | 判定できず（前提づくりで本が20秒以内に保存先へ届かず） | 判定できず（ハブと同じ） |
| ② 題名の変更 | **再現**：新しい名前が無い・古い名前が残る・開くと本文が出ない | **再現**：同左 | **再現**：同左 |
| ③ ASIN の変更 | 判定できず（前提づくりで本が20秒以内に保存先へ届かず。実行2では再現） | **再現**：同左 | **再現**：同左 |

### 実行2と実行3を合わせた判定

| 操作 | Asayake ハブ | GitHub | ローカルフォルダ |
|---|---|---|---|
| ① 本の削除 | 未判定 | 未判定 | 未判定 |
| ② 題名の変更 | 再現（実行3） | 再現（実行2・3） | 再現（実行2・3） |
| ③ ASIN の変更 | 再現（実行2） | 再現（実行2・3） | 再現（実行2・3） |

- 題名の変更と ASIN の変更は、3つの保存先すべてで再現した（6/6）。3つの観測点（新しい名前が無い・古い名前が残る・開くと雛形が出て本文が無い）が、毎回そろって落ちた。
- 本の削除は、3つの保存先とも判定できていない。原因はテストの側にある。
  - 実行2: `deleteBook` を待つ `page.evaluate` が60秒戻らなかった。
  - 実行3: 削除の保存が保存先に届かなかった。
  - `deleteBook` は native の `confirm()` を使う。`page.once('dialog', accept)` で受けているが、効いていない疑いがある。
  - step3 では、確認ダイアログの扱いを実測して直してから判定する。コード上は消す処理が無い（`js/bookshelf.js:5940-` に private/books を触る行が無い）ので、残る見込みは変わらない。
- 前提づくり（本の追加→保存先へ届く）が、9本中1〜2本で間に合わないことがある。実行2は5秒、実行3は20秒の待ちで、どちらも起きた。step3 では、追加後の保存が走る条件を確かめて直す（並列 workers の数とも関係するかもしれない）。

### 分かったこと・報告

- 依頼文の前提「3つの保存先すべてで起きる」は、題名の変更と ASIN の変更について実測で確かめた。本の削除は未判定（上記）。
- 本の削除ボタンが origin/main の画面に無い（上記）。画面から本を削除できない状態。
- 範囲外の報告（②決裁どおり、記録だけ残す）: `deleteBook`（`js/bookshelf.js:5940-`）は `notes[asin]` をまるごと消す。同じ ASIN の別の本（#484 型）が残っている場合、その本の `hasDetailMemo` や短文メモも一緒に消える。
- 過去に取り残された実データのファイルは数えていない（やらないことの範囲）。

## step2: 直し方の設計（#587 の仕組みとの突き合わせ）

### #587 の着地の確認

- 1回目（04:14）: `git log origin/main --grep="Issue: #587"` は0件＝未着地。その時点で、#587 の作業場所（`/home/kuroko/worktrees/bookshelf/issue-587`）の修正 commit **a1e88b9**（04:05・テストの commit bb39989 を1本にまとめ直したもの）を読んで、設計を書いた。
- 2回目（04:17）: **a1e88b9 が origin/main に着地していた**（origin/main = a1e88b9）。読んだ実装がそのまま main に入ったので、設計はそのまま有効。
- 着地に合わせて、こちらの branch を `git rebase --onto origin/main ef39baf` で載せ直した。cherry-pick した ef39baf（=bb39989）は外し、storage-fakes.js・shelf-file-delete.spec.js・587-results.md は #587 側（main）を正とした＝②の申し送りどおり。
- 以下の行番号は、断りが無ければ origin/main a1e88b9 のもの。

### #587 の仕組み（a1e88b9 で読んだもの）

| 部品 | 場所（a1e88b9） | 中身 |
|---|---|---|
| 削除待ちの記録 | `js/storage.js` 冒頭 `PENDING_SHELF_DELETES_KEY = 'virtualBookshelf_pendingShelfDeletes'` | localStorage に slug の文字列の配列を置く。読み手（`readPendingShelfDeletes`）は**文字列以外を捨てる**。書き手（`writePendingShelfDeletes`）は配列を丸ごと書き換える |
| 積む | `storage.queueBookshelfFileDelete(slug)` | 本棚の削除・slug 変更で呼ぶ（`bookshelf-manager.js` の rename・delete）。'all' と空は積まない |
| 取り出す | `storage.takeBookshelfFileDeletes(keepSlugs)` → `{slugs, entries}` | **保存時点で一覧にある slug は削除待ちから外す**（同じ slug での作り直し・読み込み直しを守る） |
| 保存に載せる | `js/bookshelf.js:3646-3647`（syncToObsidianFolder の `syncBatch`（:3651）の直前） | `entries.push(...shelfDeletes.entries)` → まとめ保存1回に削除として載る |
| 済んだ分を外す | `storage.clearBookshelfFileDeletes(slugs)` | `syncBatch` が成功した後だけ呼ぶ。失敗・未接続なら次の保存で再試行。保存中に新しく積まれた分は残す |
| GitHub の事前絞り込み | `GitHubAdapter.commitBatch` の 2'（`_existingPaths`） | 削除がある時だけ土台の tree（recursive）を読み、**土台に無いパスの削除を外す**。tree が truncated なら1件ずつ確かめる。全部外れたら commit しない |

### 方針: #587 の記録に「種類」を足す（案1・推奨）

- 案1（推奨）: 同じキー・同じ配列に、長文メモの記録を**種類つきのオブジェクト**で入れる。
  - 本棚: 今までどおり文字列 = slug。
  - メモの削除: `{ kind: 'memo-delete', path }`
  - メモの移動: `{ kind: 'memo-move', from, to }`（path・from・to は `private/books/<ASIN>__<題名>.md`）
  - #587 の読み手は文字列以外を捨てるので、そのままだと、#587 の関数が書き戻すたびにメモの記録が消える。#587 の内部の読み書き（`readPendingShelfDeletes`/`writePendingShelfDeletes`）は、**他の種類を残したまま本棚の分だけ足し引きする**形に直す。#587 の3つの関数の引数と戻り値は変えない（#587 の単体テストは関数経由なので、そのまま通る見込み。E2E の生キー読み出しは添付用で、判定には使っていない）。
  - キー名に Shelf が入っているが変えない。互換の手当て（ADR-006 で不要）と、#587 の E2E の添付を壊さないため。名前と中身のずれは、ADR とコメントに書く。
- 案2（不採用）: メモ用に別のキーを足し、同じ形の関数を3つ並べる。#587 のコードに触らずに済むが、「記録が2つ」になり、依頼の「新しく別の仕組みは作らない」に合わない。

### 長文メモの扱い（規則）

記号: K = 保存の時点で一覧にある全ての本の「今のメモのパス」（`private/books/` + `bookMemoFileName(asin, title)`）の集合。

1. **(a) 本の削除**（`deleteBook`・`js/bookshelf.js:5945`）
   - 削除の前に、その本の (asin, 削除前の題名) からメモのパス P を作り、`memo-delete P` を積む。
   - P を to とする移動の記録が残っていれば、その記録は `memo-delete from` に置き換える。さらに `memo-delete P` も積む。
2. **(b) 題名・ASIN の変更**（`saveBookChanges`・`js/bookshelf.js:6011`。`updateBook` の成功後）
   - 変更前の (asin, 題名) と変更後の (asin, 題名) から from・to を作る。from ≠ to なら `memo-move {from, to}` を積む。
   - 変更前の題名は、`updateBook` の前に `currentBook.title` で取っておく。
3. **(e) まとめ方**（積む時に行う）
   - X→A の記録があるところに A→B を積むと、X→B にまとめる。結果が X→X なら記録ごと消す（A→B→A は取り消し）。
   - ファイル名にすると同じになる変更は積まない。ファイル名の作り方は `sanitizeFileName`（`js/storage.js:454`）で、`\ / : * ? " < > |` と空白を `_` にし、50字で切る。
   - 同じ記録は重ねて積まない。
4. **保存時の処理**（syncToObsidianFolder の、#587 の `shelfDeletes` のすぐ後・`syncBatch` の前）
   - `memo-delete P`: P ∈ K なら消さずに記録を外す（(c) 一覧にある本の今のメモは消さない）。そうでなければ `{op:'delete', path:P}` を載せる。
   - `memo-move {from, to}`:
     - to ∉ K なら、何もせず記録を外す。変更が取り消された・読み込み直しで古い題名に戻った場合に、どの本のものでもない to を作らないため。
     - to が今アプリ内エディタで開いているメモ（`_bookMemoEditorContext` の asin・title から作ったパス）なら、今回は飛ばして次の保存へ回す。後述の「エディタとの競合」を避けるため。
     - from を読む（`adapter.readText`）。無ければ（メモが無い本）記録を外す。
     - **(f)** to が保存先に既にあれば、上書きもせず from も消さず、記録を外す（console.warn を残す）。
     - そうでなければ `{op:'put', kind:'text', path: to, data: 中身}` を載せる。さらに from ∉ K、かつ「ローカルで大文字・小文字だけの違い」でなければ（**(g)**）、`{op:'delete', path: from}` も載せる。
   - 載せた記録は `syncBatch` が成功した後に外す（#587 の clear と同じ。失敗・未接続・再読込をまたいで残る）。
   - GitHub は1 commit、ハブは1リクエストに入る。ローカルは entries の順に「書く→消す」になる（`js/storage.js:418-` syncBatch の、まとめ保存に対応しない場合の順次書き込み）。
5. **(d) 保存前に開いても見えなくならないようにする**（storage の中で解決し、呼び出し元は変えない）
   - `readBookMemo` / `bookMemoExists` / `bookMemoFullPath`（`js/storage.js:467-484`）は、まだ済んでいない `memo-move` の to と一致したら、from を読む・from の有無を返す・from のパスを返す。
   - 呼び出し元は3つ: 本の詳細のアプリ内エディタ（`js/screens/book-detail.js:578`）、外部エディタで開く（`js/bookshelf.js:5414-5429`。無ければ雛形を書くので、ここで new 側に雛形を書かせないことが特に要る）、記事の公開（`js/publish-article-generator.js:535`）。
   - `writeBookMemo` で to に書いたら（`js/screens/book-detail.js:636`）、その `memo-move` は `memo-delete from` に変える。エディタは from の中身を読んで開いているので、書いた to が新しい正になる。
6. **(c)・(h) 同じ ASIN の別の本（#484）**
   - `deleteBook` は、`books.find` も `bookManager.deleteBook` の `findIndex` も最初の1冊を指すので、メモのパスも同じ本の題名から作れる。
   - ASIN の変更で `migrateUserData`（`js/bookshelf.js:6121-`）が旧 ASIN の本を残してコピーする場合、動かすのは変えた本の題名のファイルだけ。もう一方の本のメモは、題名が違えば別のファイルなので触らない。題名も同じ（sameTitle の二重登録）なら from ∈ K となって消えず、コピーと同じ結果になる。
7. **(g) 大文字・小文字だけの違い**（②決裁: ローカルでは消さない・ハブと GitHub は通常どおり移す）
   - 判定は `from.toLowerCase() === to.toLowerCase()` かつ保存先がローカル（`syncMethod === 'local'`）。
   - 大文字小文字を区別しないファイルシステムでは、書いた to が from と同じファイルなので、中身は新しく、名前は古い大文字小文字のまま残る。区別する Linux では古い名前のファイルが残る。ローカルは PC の Chrome・Edge 前提なので、受け入れる。
8. **(i) 保存先ごとの、無いファイル・既にあるファイルの扱い**（コード読み＋実測）
   - 実測（04:18・origin/main a1e88b9 の上で、模擬のハブと GitHub に対し `storage.syncBatch` を直接呼んだ。測るための一時 spec は commit していない）:

     | 保存先 | 無いメモの削除だけを載せる | 既にあるメモ（別経路で書いたもの）へ put を載せる |
     |---|---|---|
     | ハブ | 成功・削除要求は0件（HEAD 404 で外れる） | 成功・**上書きされた**（中身が "FROM-BATCH" に変わった） |
     | GitHub | 成功・削除要求は0件（#587 の事前絞り込みで外れる） | 成功・**上書きされた** |

   - つまり、どの保存先も「to が既にある」ことを自分では止めない。(f) を守るには、規則4の **保存前の有無の確認（`adapter.fileExists(to)`）が必須**。ハブの `ifNoneMatch:'*'` が効くのは、送る直前の HEAD で 404 だった時（確認と送る間に他の端末が作った場合）だけ。
   - ハブ: メモのパスは `ETAG_DIRS`（`js/hub-adapter.js:28`）に無いので、ETag のキャッシュに無い。そのため `_resolveBatchEntry`（`:242`）が1件ずつ HEAD を投げる。
     - 404 の削除は外れる（`:251`）。
     - 404 の put は `ifNoneMatch:'*'`（`:252`）になる。保存時の確認と送る間に他の端末が to を作っていれば 412 → `HubConflictError` → 衝突ダイアログ（`js/bookshelf.js:3655-3658`）。記録は残って、次の保存で再試行される。
   - GitHub: 削除は #587 の事前絞り込みで、土台に無いパスが外れる。put にはファイルごとの前提条件が無い。ref の更新が先に進められない時は、`GitHubConflictError` で同じ衝突ダイアログに入る。
   - ローカル: `deleteFile` は NotFound を無視する（`js/local-fs-adapter.js:122-130`）。

### エディタとの競合（残る危険と手当て）

- アプリ内エディタの保存は、まとめ保存を通らず直接書く（`book-detail.js:636`）。
- 保存時の確認（to が無い）から送るまでの間にエディタが to を書くと、ハブでは HEAD が 200 になり、ifMatch つきの put で古い中身が上書きされうる。ローカルも同じ。GitHub は ref の競合で止まる。
- 手当て: to のメモをエディタで開いている間は、その移動を次の保存に回す（規則4）。エディタを閉じて書いた後は、5 により `memo-delete from` に変わっているので、上書きは起きない。残る窓は「エディタを閉じる処理」と「保存」が数ミリ秒で重なる場合だけ。

### step3 のテスト（予定）

- 単体（vitest）:
  - 積み方とまとめ方（A→B→C、A→B→A、ファイル名にすると同じになる場合、移動の後の削除）
  - #587 の記録と混ぜても互いに消さないこと
  - K による保護（sameTitle の二重登録・題名を戻した場合）
  - to ∉ K で捨てること
  - (f) to が既にある場合
  - (g) 大文字・小文字の違いをローカルとそれ以外で分けること
  - (d) 読む・有無・パスの付け替えと、書いた後の切り替え
- E2E（step1 の spec に足す・3保存先）:
  - 3操作×3保存先の9本を緑にする（本の削除は確認ダイアログの扱いを直して判定する）
  - 未接続の間に変えて繋ぎ直す（#587 の E2E の「queryPermission を prompt にする」形を使う）
  - 変えてすぐ再読込する
  - #484 型の同じ ASIN・別の題名の2冊
  - 使えない文字・空白を含む題名
  - (f) ハブで to が既にある場合（衝突ダイアログに入るか、上書きしないか）
  - 保存前に開いても本文が出ること
- 触る予定のファイル: `js/storage.js`、`js/bookshelf.js`（deleteBook・saveBookChanges・syncToObsidianFolder）、`index.html`（?v=）、テスト、594-results.md、設計書（03・06・08）。`js/screens/book-detail.js` と `js/publish-article-generator.js` は変えない見込み（5 を storage の中で解決するため）。

## step3: 実装と単体テスト・E2E

### 毎回の手順（E2E を流す前後）

1. 流す前: `ss -ltnp | grep ':8194 '` で検証サーバ（8194番）が残っていないか見る。残っていれば、その pid（`python3 -m http.server 8194`）を止める。
2. `PORT=8194 PLAYWRIGHT_BASE_URL=http://localhost:8194 npx playwright test <spec> --project=chromium --retries=0 --workers=1`
3. 流した後: もう一度 8194番を見て、残っていれば止める。
- 途中で止まった（timeout で切った）実行の結果は数えない。1回目の step3 で workers=3 の実行が2回止まったのは、切った実行が 8194番に壊れたサーバを残し、次の実行が ERR_EMPTY_RESPONSE になったため。

### 実装

- `js/storage.js`: #587 の記録（`virtualBookshelf_pendingShelfDeletes`）に、種類つきの長文メモの記録を足した。
  - 記録は2種類。`{kind:'memo-delete',path}` と `{kind:'memo-move',from,to}`。
  - 本棚の slug（文字列）の読み書きは、他の種類の記録を残したまま行う。
  - 保存時の処理は `takeBookMemoOps`、成功後の片づけは `clearBookMemoOps`。
  - 読む・有無・パスを返す関数は、移動待ちの to を from に読み替える。
- `js/bookshelf.js`:
  - deleteBook でメモの削除を積む。
  - saveBookChanges で、更新の前に移動を積む。
  - syncToObsidianFolder で、#587 の削除のすぐ後に載せる。

### 分かったこと（E2E の切り分け）

- **deleteBook が60秒戻らなかった件は、テストの作りが原因だった**。`deleteBook` の確認は native の confirm ではなく、アプリ独自の確認画面（`.cfm-overlay`「書籍「…」を完全削除しますか？」）。実測では dialog イベントが0件で、確認画面が出たまま `deleteBook` が待っていた。#587 の E2E と同じ `confirmOk`（`.cfm-ok` を押す）にしたら、3保存先とも通った。
- **前提づくり（本の追加が保存先に届かない）とハブの click が10秒で終わらない件**: 1回目の step3 で自分で足した待ち方（`flushSyncNow`・「保存中でないこと」の確認）をやめ、#587 の E2E と同じ「操作 → 保存先を `expect.poll` で見る」にした。前の止まった実行が 8194番に壊れたサーバを残す件も、毎回の手順で除いた。この2つの後は、9本とも前提づくりで落ちていない（届かなかった回は0回。落ちた時の記録＝アプリの保存の状態・出ている画面・console・保存先の library.json を残す処理は spec に入れてある）。

### 結果（2026-11-14 04:55〜04:57・chromium・workers=1・実行の前後とも 8194番は空き）

`tests/e2e/book-memo-file-lifecycle.spec.js` と #587 の `tests/e2e/shelf-file-delete.spec.js` を一緒に流した: **36 passed・3 skipped（fixme）・0 failed**。

| 項目 | ハブ | GitHub | ローカル |
|---|---|---|---|
| ① 本の削除（ふつうの題名） | 緑 | 緑 | 緑 |
| ② 題名の変更（ふつうの題名） | 緑 | 緑 | 緑 |
| ③ ASIN の変更（ふつうの題名） | 緑 | 緑 | 緑 |
| ①②③ 使えない文字と空白を含む題名（`メモ: 本/特殊?"<>\|*\\ 題` → `題名 を/変えた:本?`） | 緑×3 | 緑×3 | 緑×3 |
| 書けない間に題名を変える → 次の保存で移る（模擬の `failNextWrites` で保存を1回失敗させる＝#587 と同じ手段） | 緑 | 緑 | 未着手（下表） |
| 題名を変えてすぐ再読込 | fixme（下表） | fixme | fixme |
| #484 型（同じ ASIN・題名違いの2冊） | E2E は作れない（下表）・単体で確認 | 同左 | 同左 |
| #587 の E2E（shelf-file-delete・16本） | 緑のまま | | |

単体: `book-memo-file-ops.test.js` 18本、`shelf-file-delete.test.js` 11本、`github-adapter.test.js` 21本、`hub-batch.test.js` 13本がすべて緑。

### 通らない・作れない・未着手のもの

| 名前 | 状態 | 原因 | アプリ側か模擬側か |
|---|---|---|---|
| 題名を変えてすぐ再読込（3保存先） | fixme | 題名を変えてすぐ再読込すると、**題名の変更そのものが古い題名に戻る**。「未保存あり」の印（`virtualBookshelf_pendingSync`）が立っている間に読み直しても同じだった（実測: 再読込後のアプリの題名は古いまま・印は無し・保存先も古い題名）。長文メモではなく、本の編集の保存の既存の動き。この時、移す記録は「移す先がどの本のものでもない」として捨てられ、メモは古い題名のまま読める（食い違わない） | アプリ側（既存・範囲外。別に起票が要る） |
| #484 型の2冊の E2E | 作れない | syncToObsidianFolder が library.json を作る時に、本を ASIN をキーにした Map にまとめる（`currentBooksByAsin`）。同じ ASIN の2冊は保存先に1冊しか届かない。そのため保存先を見る E2E では2冊を作れない。保存先の記録の規則は単体テスト（同じ ASIN・同じ題名＝コピー、題名違い＝もう一方に触らない）で確かめた | アプリ側（既存・#484 の「データ構造は変えない」の範囲） |
| ローカルの「未接続の間の変更 → 繋ぎ直し」 | 未着手 | 時間切れ。ハブ・GitHub は「書けない間の変更 → 次の保存」で確かめた。ローカルは #587 の E2E の「queryPermission を prompt にして再読込 → 設定から繋ぎ直す」形で書く予定 | — |
| (f) 移す先が既にある時の、保存先ごとの単体テスト（GitHubAdapter・HubAdapter・LocalFSAdapter） | 未着手 | 時間切れ。今は中身を Map に持つ模擬の adapter での単体テストだけ | — |
