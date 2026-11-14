# イシュー#667 実測の記録

GitHub の保存先で、取込の直後に再読込すると、書き込み時の3択 (`#sync-conflict-dialog`) が出る (#622 の R3)。

## step1：2組目のまとめ保存の出どころ (2026-11-14 18:04〜18:07・origin/main f9468f8 の上)

### 測り方

- chromium。PORT=8167。workers 5。`--repeat-each=5`。
- 記録用の spec は commit しない。`tests/e2e/zz-667-measure.spec.js` に置いて流し、終わった後に `_trash/667-measure/` へ退避した。手順は、回帰 spec `tests/e2e/import-reload-persist.spec.js` の GitHub の行 (:144-169) と同じ。手順は次のとおり。
  1. 見本に exportDate を足した模擬 GitHub につなぐ。
  2. 設定の取込から3冊を取り込む。
  3. 待たずに `page.reload()` する。
- 記録したもの：
  - 模擬 GitHub が受けた `POST git/commits` の message (同期は `chore(bookshelf): sync N file(s)`、標準機能の補充は `chore(plugin): seed standard plugins`)。
  - `PATCH git/refs` の状態。
  - 要求を出した文書。`page.addInitScript` で fetch を包み、文書ごとの乱数を `X-Doc-Id` に付けた。再読込の前の文書を OLD、後の文書を NEW と呼ぶ。
  - 再読込の後の `bookshelf._lastLoadDecision`。`#sync-conflict-dialog`・`#load-conflict-dialog` が見えるか。
  - 保存先の `private/library.json` に3冊が入ったか (20秒まで待つ)。
- 条件：
  - 軽い条件＝throttling 無し。
  - 重い条件＝CDP の `Emulation.setCPUThrottlingRate` で rate 6。ページだけを重くし、共有マシンには負荷をかけない。
- 判定の手段：実際の実行で判定した。模擬の応答に遅れは入れていない (再現したため不要だった)。1回の実行は、軽い条件 1.2分・重い条件 25秒で、5分の上限に収まった。

### 結果

| 条件 | 回数 | 書き込み時の3択 | 読込時の3択 | 読込の決め方 | NEW の中のまとめ保存 | 保存先に3冊 |
|---|---|---|---|---|---|---|
| 軽い | 5 | **4/5** | 0/5 | 5/5 'local' | **5/5 で2組 (同期＋補充)**。後から PATCH した方が 422 | 1/5 (3択の4回は入らない) |
| 重い (rate 6) | 5 | 0/5 | 0/5 | 5/5 'local' | **5/5 で2組 (同期＋補充)**。5回とも補充の方が 422 | 5/5 |

回ごとの NEW の順。C は commit を作ったこと、P は PATCH ref の状態を表す。

| 回 | NEW の順 | 3択 |
|---|---|---|
| 軽い-0 | 補充 C → P 200 → 同期 C → P **422** | 出た |
| 軽い-1 | 補充 C → 同期 C → P 200 → P **422** (2組とも commit を作った後に PATCH) | 出た |
| 軽い-2 | 補充 C → P 200 → 同期 C → P **422** | 出た |
| 軽い-3 | 同期 C → P 200 → 補充 C → P 422 (補充の失敗は console.warn だけ) | 出ない |
| 軽い-4 | 補充 C → P 200 → 同期 C → P **422** | 出た |
| 重い-0〜4 | 同期 C → P 200 → 補充 C → P 422 (重い-3 は 同期 C → 補充 C → P 200 → P 422) | 出ない |

OLD (再読込の前の文書) の要求で、取込の後に出たものは次のとおり。
- 10回とも、書き込み (commit・PATCH) は模擬に届いていない。
- 9回は、GET が1本出て `net::ERR_ABORTED` になった。
- 重い-4 は、GET ref 200 の後に POST blobs が `net::ERR_ABORTED` になった。離れる時の保存 (flushOnLeave・bookshelf.js:403-410) が、blob を作るところまで進んで切れたということ。

### 分かったこと

1. **2組目の出どころは、標準機能の補充 (`js/plugin-loader.js:181` ensureStandardPlugins) だった。**
   - 補充は、再読込の後の新しいページの中で、同期と並んで走る。同期の経路は `_keepLocalOverLoaded` (bookshelf.js:2969-2978) → `_scheduleSync` (800ms) → `_runPendingSync` → syncToObsidianFolder → `storage.syncBatch` (bookshelf.js:3996)。
   - 補充は、起動の後段 (bookshelf.js:457-462) で initSync の直後に呼ばれる。`_runPendingSync` の `_syncInProgress` の守り (bookshelf.js:3125-3160) を通らない。
   - 前のページ (flushOnLeave) から来た要求ではない (X-Doc-Id で区別した)。ただし、重い-4 では blob の作成まで進んでいたので、ページを離れるのがもっと遅ければ、3つ目の重なりになりうる (未観測)。
2. **GitHub のまとめ保存は、ref を force:false で動かす (github-adapter.js:393-399)。** 同じ土台の ref を読んだ2組のうち、後から PATCH した方が 422 を受け、GitHubConflictError になる。
   - 同期が負けた場合：書き込み時の3択が出る。取り込んだ本は保存先に入らない。
   - 補充が負けた場合：plugin-loader.js:183 の catch が console.warn で飲むので、3択は出ない。補充は次の起動に持ち越される。
   - どちらが先に ref を進めるかは、その時の速さで決まる。これが、#622 で軽い時は緑・重い時は5回中3回、今回は軽い時が4/5・rate 6 が0/5、という揺れの元になっている。重い・軽いの向きは測り方で入れ替わるので、負荷の条件で再現を当てにする回帰は組めない。
3. **補充が再読込のたびに走るのは、模擬の都合が大きい。**
   - 模擬は、ディレクトリの `GET /contents/<dir>` に 404 を返す (tests/e2e/helpers/gate-github.js:109-113。木にはファイルしか無い)。そのため `listDirs('plugins')` (plugin-loader.js:56) が [] になり、起動のたびに5個とも「欠けている」として補充する。
   - 本物の GitHub は、ディレクトリには配列を返す (github-adapter.js:254 listDirs)。補充が走るのは欠けている時だけ。欠けるのは、次の場合。
     - 新しい保存先につないだ最初の起動
     - 標準機能が増えた版に上がった時
     - 利用者が plugins/ を消した時
   - ただし、穴そのもの (保存先への書き込みが1本に絞られていない) は本番にもある。上のような起動では、手元に未反映の編集があれば同じ重なりになる。また、下の表の守られていない経路のどれでも、同期と重なれば同じ 422 になる。

### 書き込みの経路 (コードの読み・行番号は f9468f8)

| 経路 | 呼び方 | `_syncInProgress` の守り |
|---|---|---|
| 同期 | bookshelf.js:3996 `storage.syncBatch` (syncToObsidianFolder・`_runPendingSync` から) | 通る (:3125-3160) |
| 標準機能の補充 | plugin-loader.js:181 `storage.syncBatch` (起動の後段 bookshelf.js:460-462) | **通らない** (今回の実測) |
| プラグインの導入 | plugin-loader.js:305 `storage.syncBatch` | 通らない |
| プラグインの削除 | plugin-loader.js:376 `storage.syncBatch` | 通らない |
| プラグインのデータ | plugin-api.js:776 writePluginFile → `storage.syncBatch` | 通らない |
| 公開の書き出し | exporter.js:143 で公開先の GitHubAdapter を**別に作る** (storage.adapter とは別のインスタンス)。:181-190 commitBatch | 通らない。同じ ref を取り合うのは、公開先が保存先と同じ repo・branch の時だけ。:191-193 は 422 を「公開中に公開 repo が更新されました」にする (3択にはしない) |
| 長文メモ | storage.js:551 writeBookMemo → adapter.writeText。呼び出しは bookshelf.js:6041 と screens/book-detail.js:686 | 通らない |
| 公開記事・サイト設定 | publish-article-store.js:235・:249 `storage.writeJSON` | 通らない |
| 本棚ファイルの削除 | storage.js:416 adapter.deleteFile | 呼び出し元による (未確認) |

- GitHub の1件ずつの書き込み (writeText・writeJSON・deleteFile) は Contents API を使う。1件ごとに commit を作り、ref を動かす。そのファイルの sha で照らす (409) が、まとめ保存とは別のファイルなので PUT 自体は通る。ただし ref が進むので、同時に走っていたまとめ保存の PATCH は 422 になる。同じ形の「ありもしない衝突」が出うる (未実測)。

### ハブでも起きうるか (コードの読み)

- **ありもしない3択は起きない。**
  - hub-adapter.js の commitBatch (:224-236 → `_commitBatchOnce` :301〜) は、ファイルごとに If-Match (ETag) で照らす。補充 (plugins/…) と同期 (private/…) は別のファイルなので、412 にならない。#622 の実測 (ハブ 5/5＋5/5 緑) と合う。
- **ただし、重なりの穴は別の形で残る (未実測・窓は狭い)。**
  - 次の3つはインスタンスの欄で、重なった呼び出しが共有する：adapter の `lastBatchWroteStamp`・`lastBatchMerged`、storage の `lastMerged`。
  - 書かれる時点：hub-adapter.js:228-229 は、commitBatch の入口でこれらを下ろす。:397 は、まとめの途中 (相手の変更と項目ごとに合わせた時) に `lastBatchMerged` を立てる。:235 は、最後に `lastBatchWroteStamp` を立てる。
  - 読まれる時点：storage.js:490・:492 は、`await a.commitBatch` の後にこれらを読む。
  - 同期の途中で補充などのまとめ保存が始まると、同期が項目ごとに合わせた結果 (#612) が null で上書きされ、手元に入らない恐れがある。印を書いたかどうかを、別のまとめの値で読む恐れもある。
  - GitHub 側には last* の欄が無い (grep で0件) ので、この穴は無い。

### #645 との関係 (issue-645 の 8a84db9・9c1c22c の差分を読んだ)

- **#645 では直らない。同じ原因でもない。**
  - #645 は、書き込み時の3択に「この端末の内容で保存先を上書き」を足す (bookshelf.js の `_handleSyncConflict` に 'local' を足し、`_keepLocalOverLoaded` で送り直す)。読み直しのたびに tree の控えを取り直す変更 (github-adapter.js の :95-160 付近・`forgetRemoteListing`・ref の no-store) も入る。
  - ありもしない3択が出ること自体は消えない。#645 の後は、選択肢が3つになった3択が出る。
- **触る関数**：#645 は、commitBatch・syncBatch の本体を触らない。github-adapter.js の hunk は :95 の1か所 (tree の取得) だけ、storage.js は loadAll の4行だけ。
  - 案A (syncBatch に待ち行列)：storage.js の別の関数を触る。文の衝突は起きにくい。github-adapter.js は触らない。
  - 案B (commitBatch のやり直し)：関数は別だが、やり直しで使う `_existingPaths`・`_assertBatchNotStale` の tree 取得と、#645 が変える tree の控え (`_treeFetchPromise`・`forgetRemoteListing`) が、意味の上で絡む。

### 直し方の比較

| 軸 | 案A：書き込みの入口に1本の待ち行列 | 案B：commitBatch が 422 の時に1回だけやり直す | 案C：起動の後の順番だけ変える |
|---|---|---|---|
| 中身 | `BookshelfStorage.syncBatch` を1本の列に並べ、どこから呼んでも1本ずつ流す。last* は列の中で読む (他のまとめに上書きされない) | GET ref からやり直し、新しい土台の tree で `_assertBatchNotStale` をかけ直してから commit・PATCH する | 補充を、起動時の同期の後に回す (またはその逆) |
| 同じページの中の重なり | 防げる (今回の形は全部) | 防げる | 補充と同期の組だけ防げる |
| 前のページから来る要求 | 防げない (列はページごと。今回は観測されていない) | 防げる | 防げない |
| 1件ずつの書き込み (長文メモ・公開記事) | storage の writeText/writeJSON/deleteFile も同じ列に並べれば防げる | 防げる | 防げない |
| 他の端末・別のタブ | 今までどおり3択 | 別のファイルだけを書いた時は3択を出さずに重ねて書く (挙動の変更) | 今までどおり |
| 本当の衝突の見落とし | 増えない (照合の決まりは変えない) | 下の注記の分だけ増える | 増えない |
| ハブの last* の取り違え | 消える | 残る | 残る |
| 変える量 | storage.js の数十行 (呼び出し元は変えない) | github-adapter.js の commitBatch を切り出して2回呼ぶ (blob は作り直さない) | bookshelf.js の起動の後段 |
| #645 との重なり | 同じファイルの別の関数・github-adapter.js は触らない | tree の控えと意味の上で絡む | 無い |

案B が、本当の衝突 (2台) を自分の書き込みと取り違えない根拠と、その限界は次のとおり。

- **見るもの**：やり直しでは、新しい土台の tree で、書こうとする各ファイルを照らす (github-adapter.js の `_assertBatchNotStale`)。
  - 土台の sha が、自分が最後に読んだ・書いた sha (`_shaCache`) と同じなら、そのまま書く。
  - 違う時は、最新の中身を取って比べる。「書きたい中身」か「自分が知っている中身」と同じなら、そのまま書く。どちらとも違えば GitHubRemoteChangedError にし、3択を出す。
  - 他の端末が library.json などの同じファイルを変えていれば、sha も中身も合わないので、今までどおり3択になる。
- **限界**：
  - 照らすのは、sha を覚えているパスだけ。読んだことも書いたこともないパス (2台が同時に作った新しいファイル) は、後から書いた方が勝つ。
  - ファイルをまたぐ整合は見ない。たとえば、他の端末が bookshelves/all.json だけを変え、こちらが library.json だけを書くと、黙って合わさる。今の ref のロックなら3択になっていた場面が通るようになる＝何を衝突とみなすかの変更で、ADR が要る。

**推奨：案A。** 書き込みの入口 (`BookshelfStorage`) に1本の待ち行列を置き、次の2つを同じ列に並べる。

- syncBatch
- storage を通る1件ずつの書き込み (writeText・writeJSON・deleteFile。長文メモ・公開記事・本棚ファイルの削除)

理由は次のとおり。

- 実測した形 (同じページの中の syncBatch どうし) を確実に塞げる。ハブの last* の取り違えも一緒に消える。
- 何を衝突とみなすかの決まりを変えないので、本当の衝突の見落としが増えない。
- #645 が触る関数 (tree の控え・`_handleSyncConflict`) とは別。
- 呼び出し元を変えないので、今ある経路も後から足す経路も、storage を通れば守られる (共通の仕組み)。

案A の残りの穴の扱いは次のとおり。

- 前のページから来る要求：今回は観測されていない。
- 2つのタブ・他の端末：今までどおり3択になる＝本当の衝突として扱う。
- exporter の公開先 (別の adapter)：公開先が保存先と同じ repo の時だけ、同じ ref を取り合う。直さない。07 に1行書くかは step2 で判断する。

案B (別のファイルだけの書き込みは重ねて書く) を入れるかは、挙動の変更なので、別に ADR とともに決めることを勧める。

### step2 の進め方の推奨 (②が決める点)

- **#645 を待つか**：案A なら待たなくてよい。触るのは storage.js の syncBatch と1件ずつの書き込みの入口で、#645 の loadAll の4行とは別の関数。github-adapter.js は触らない。載せ直しで衝突しうるのは index.html の `?v=` の行くらい。案B を選ぶ場合は、#645 が main に入ってから始めるのを勧める (tree の控えが絡むため)。
- **回帰 spec**：負荷で再現を当てにしない (重い・軽いで向きが入れ替わった)。次の2本を置く。
  - 補充と同期が必ず重なる形の spec：模擬に plugins/ が無い状態で始める。必要なら補充の PATCH の応答を、同期の commit が来るまで止める。
  - 単体テスト：2本の syncBatch を同時に呼び、本物の GitHubAdapter・HubStorageAdapter の経路で1本ずつ流れ、422 にならないことを確かめる。
  - そのうえで、回帰 spec の GitHub の行 (import-reload-persist.spec.js:147 の fixme) を外し、軽い条件と rate 6 で `--repeat-each=5` 全回緑にする。
- **模擬のディレクトリ一覧 (404)**：直すと補充が最初の起動だけになり、R3 の回帰が穴を塞がないまま緑になる (覆い隠す) 恐れがある。今回は直さず、spec 側で補充が走る条件を明示して作ることを勧める。

## step2：直しと回帰 (2026-11-14 18:12〜18:20・origin/main f9468f8 の上・未コミット)

### 直したところ (案A・②の承認どおり)

- `js/storage.js`
  - `serialWrite(fn)` (:103-112) を足した。保存先への書き込みを1本の待ち行列で流す。前の書き込みが失敗しても、行列は止めない (`_writeTail` は成否を問わず次へ進む。失敗は呼び出し元へそのまま返る)。
  - 行列を通すようにした書き込みは次のとおり。
    - まとめ保存：`syncBatch` (:487-493。本体は `_syncBatchNow`)
    - 1件ずつの書き込み：`writeJSON` (:472)。`writeLibrary`〜`writeNotes`・`writePublicMain`/`writePublicSettings` は `writeJSON` を通す形に変えた。ほかに `deleteBookshelfFile` (:437)、`writeBookMemo` の adapter.writeText (:585)。
    - 複数ファイルをまとめて書く処理：`initEmpty` (:316-318。本体は `_initEmptyNow`)、`migrateFromLegacy` の一斉書き込み (:298)。これらは全体を1回の順番で書く。
  - 入れ子で止まらないこと：行列の中で走る本体 (`_syncBatchNow`・`_initEmptyNow`・移行の書き込み・各 adapter 呼び出し) は adapter を直接使う。行列を通る storage の書き込みは呼ばない (読んで確かめた。単体テストでも、4本を重ねて止まらないことを確かめた)。
  - 呼び出しごとの戻り値：`syncBatch(entries, { withMerged: true })` は `{ result, merged }` を返す。
    - adapter の `lastBatchWroteStamp`・`lastBatchMerged` は、行列の中で commitBatch の直後に読む。そのため、他のまとめ保存に上書きされない。
    - `this.lastMerged` は互換のために残した (既存の単体テストが読む)。
    - `withMerged` を付けない呼び出しは、今までどおり result だけを返す (hub-two-devices の `toBe(true)` などはそのまま)。
- `js/bookshelf.js`：syncToObsidianFolder (:3994-4018) は、`withMerged: true` の戻り値の `merged` を `_applyMergedRemote` に渡す (以前は `this.storage.lastMerged` を読んでいた)。
- `js/exporter.js` (:190-192)：公開の commit。公開先の adapter は `new GitHubAdapter` で別のインスタンスとして作られる (:143) ので、`this.app.storage.serialWrite` を通して同じ行列に並べた。
- `index.html`：`js/storage.js`・`js/exporter.js`・`js/bookshelf.js` の `?v=` を 2026111780 にした。origin/main の最大値 (fetch 時点で 2026111746) より新しい。
- 特定のプラグインは名指ししていない。補充・導入・削除・プラグインのデータは、どれも `storage.syncBatch` を通るので、呼び出し元を変えずに行列に入る。

### 回帰

- `tests/e2e/import-reload-persist.spec.js`
  - GitHub の行の fixme と、その理由の注記を外し、ハブと同じく `test` にした。
  - 新しいテストを1本足した (:179〜)：「GitHub: 再読込の後の同期と標準機能の補充のまとめ保存が重なっても、1本ずつ流れて3択が出ず、両方が保存先に入る」。
    - 再読込の後、同期のまとめ保存 (library.json を変える commit) の ref の PATCH を止める。止めるのは、補充のまとめ保存 (plugins/ を変える commit) が ref を進めるまで (最大3秒)。こうして、負荷に頼らず重なりを作る。
    - 確かめることは次のとおり。
      - 保存先の library.json に3冊が入る。
      - head の木に plugins/ が入る。
      - 再読込の後の PATCH が2本以上あり、422 が0本。
      - 3択が出ない。
    - **直す前の storage.js (HEAD のもの) では 2/2 赤になった** (library.json に本が届かない＝同期の PATCH が 422)。直した後は緑。
- `tests/unit/storage-serial-write.test.js` (新しい・6本)：本物の GitHubAdapter と、ref・commit・tree・blob・Contents API を持つ模擬の GitHub (応答を2msずつ遅らせる) で確かめた。
  1. 前提：行列を通さずに `_syncBatchNow` を2本同時に流すと、1本が GitHubConflictError (422) になる＝模擬が重なりを見分ける。
  2. `syncBatch` を2本同時に呼ぶと、1本ずつ流れる (PATCH 200 が sync→seed の順・422 は0本)。保存先に両方の中身が入る。
  3. `withMerged` の戻り値は `{ result, merged:null }`。
  4. まとめ保存と `writeJSON` (Contents API) を同時に呼んでも、まとめ保存の PATCH の後に PUT が来る (422 は0本)。
  5. 1本目のまとめ保存の commit 作成を 500 で失敗させる。1本目は失敗を返し、2本目のまとめ保存と3本目の writeJSON は流れて保存先に入る。
  6. `initEmpty`・`syncBatch`・`writeJSON`・`syncBatch` の4本を重ねても、5秒以内に全部終わる (入れ子で止まらない)。422 は0本。
- `tests/unit/hub-two-devices.test.js` に1本を足した：同じ端末で2本の syncBatch を同時に呼ぶ。
  - 本物の HubStorageAdapter と cf-worker で、1本は 412→項目ごとに合わせる形、もう1本は設定だけの形にした。
  - 合わせた分 (merged) が、呼び出しごとに正しく返ることを確かめた (前者は notes.json の合わせた中身、後者は null)。
- `tests/e2e/helpers/test-base.js`：`E2E_CPU_THROTTLE=<倍率>` の時だけ、chromium のページの CPU を CDP で遅くする口を足した (既定は何もしない)。重い条件で流すために使った。

### 確かめた結果

| 検証 | 結果 |
|---|---|
| `import-reload-persist.spec.js --grep GitHub --repeat-each=5` 軽い条件 (GitHub の行＋新しいテスト) | **10/10 緑** (25秒) |
| 同上・`E2E_CPU_THROTTLE=6` | **10/10 緑** (35秒) |
| 新しい E2E を直す前の storage.js で (`--repeat-each=2`) | 2/2 赤 (期待どおり) |
| `npx vitest run` (全件) | 80ファイル・1188本緑 (todo 2) |
| 本当の衝突と保存の経路の既存 spec (chromium・1回ずつ)：gate/j6-4-sync-conflict・sync-conflict・load-conflict-unsaved・plugin-seed・publish-panel・publish-conflict-hub・sync-offline-reconnect・import-reload-persist (全行) | **46本緑・2本 skip** (skip はもとからある #662 の fixme 2本)・失敗0 (2.0分) |
| プラグインのデータ書き込み・公開の書き出し：per-shelf-memo・publish-article-theme・publish-target-demotion | 22本緑 (12.8秒) |
| `npm run lint` (lint:internal-refs を含む) | 12本中0本失敗 |

- 本当の衝突 (2台) は、今までどおり3択になる。j6-4-sync-conflict・sync-conflict・load-conflict-unsaved が緑。照合の決まり (ref の楽観ロック・`_assertBatchNotStale`・ハブの If-Match) は変えていない。
- プラグインの導入・削除 (plugin-loader.js の :305・:376) を通す E2E・単体テストは、もとから無い (grep で0件)。どちらも `storage.syncBatch` を通るので、行列に入ることは storage-serial-write.test.js の syncBatch の検査で代える。
- 1回の実行は、どれも5分以内に終わった (最長 2.0分)。step3 の e2e-diff-main に回す残りは無い。
- 設計書 (03_詳細設計書 の BookshelfStorage の節：`serialWrite` の追加と、`syncBatch` の `withMerged`) の更新は、step3 の commit と同じ作業で行う (未着手)。

## step3：commit・載せ直し・検証一式 (2026-11-14 18:22〜18:36)

- commit を作り、origin/main に rebase した。origin/main は #645 (5件) と #657 (2件) で `48e5bda` に進んでいた。
  - 衝突は `index.html` の `js/storage.js`・`js/bookshelf.js` の `?v=` の2行だけ (#645 は 2026111745、main は 2026111750、こちらは 2026111780)。こちらの 2026111780 を残した。origin/main の最大値 2026111750 より新しい。
  - `js/storage.js` は自動で合わさった。#645 の `loadAll` の `forgetRemoteListing` と、こちらの `serialWrite` の両方が残っている。`js/bookshelf.js`・`js/github-adapter.js` (こちらは触っていない) も、#645 の変更が残っている。
- 設計書を直した (obsidian・自動バックアップで commit される)。
  - 03_詳細設計書 の BookshelfStorage の表：`serialWrite` の行を足し、`syncBatch` の行に `withMerged` と行列を書いた。`_applyMergedRemote` の行は、`withMerged` の戻り値を受け取る形に直した。
  - 08_意思決定記録 に ADR-169 を足した (ADR-168 は #660 が使っていた)。
  - commit の題は「(設計: 03/08 2026-11-14 更新・ADR-169)」に直した (amend。HEAD が自分の commit であることを確かめてから)。
- origin/main..HEAD は自分の1件だけ。

| 検証 | 結果 |
|---|---|
| `npm run lint` (rebase の後・lint:internal-refs を含む) | 12本中0本失敗 |
| `npx vitest run` (rebase の後) | 80ファイル・1192本緑 (todo 2) |
| `npm run check:version -- --range=origin/main..HEAD` | OK |
| `scripts/verify/e2e-diff-main.mjs --port=8167` (base＝origin/main 48e5bda、work＝rebase の後・18:22〜18:34) | 新しく落ちた **1件 (フレーク判定)**・新しく通った 0・両方落ち 0。base は通過 1103・落ち 0、work は通過 1104・落ち 1。Unit (vitest) の新しく落ちた 0。画像の差分 0/54 |

### フレーク判定の1件 (②に判断を仰ぐ)

- 該当のテスト：`shelf-file-delete.spec.js:220`「本棚ファイルの削除待ち: GitHub (イシュー#587) > 保存先にまだ無い本棚ファイルの削除が混ざっても、保存は失敗しない」。
  - work 側では、一度 3.7秒で落ちた。落ちたのは `:232` の前提の確かめ「保存先にはまだ無い」(期待 false・実際 true)。
  - 落ちた1件だけを work で3回流し直すと、3/3 緑 (expected 2・unexpected 0)。
- 見立て (未実測)：このテストは `remote.failNextWrites(1)` で「次の書き込み1回」を失敗させ、作った本棚が保存先に届かない形を作る。
  - 模擬は起動のたびに標準機能の補充を書く (step1 の 3.)。そのため、この1回の失敗を補充の書き込みが受け取ると、本棚の保存が通り、前提が崩れる。
  - 今回の行列で、補充が起動時の同期の後ろに並ぶようになった。その分、補充の書き込みが `failNextWrites` の後に来る形が起きやすくなった可能性がある。
  - 直す前も、補充と同期は並んで走っていたので、同じ形は起こりえた (前提がもとから順番に頼っている)。
- 案：push の前に、このテストの前提を順番に頼らない形にする。次のどちらか。
  - `failNextWrites` を、本棚のファイルのパスを含む書き込みだけに当てる。
  - 起動時の補充が済むのを待ってから `failNextWrites` を立てる。
  - どちらにするか・このイシューで行うか、別イシューにするかは②が決める。
