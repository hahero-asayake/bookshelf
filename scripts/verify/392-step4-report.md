# #392 step4: #391完了確認・基準値再測定・共通部品化の判定

## 1. #391完了確認

- git log: `origin/main`(fetch済み)に #391 の6本すべてが入っている。全て `Issue: #391` trailer確認済み。
  - `668c454` GitHubAdapterにR(tree一括sha取得+差分のみ)とTO(5秒タイムアウト+再試行)を実装
  - `9c64926` GitHub読み込み失敗時の表示を「手元のデータで表示中・再試行」に変更
  - `59f8882` Rを既定で有効化し、モック/専用テストで動作を固定する
  - `480e18b` PAR(loadAllの並列化・同時数上限4)を実装
  - `1132b65` 正式なE2E2本を追加(GitHub読み込みの耐性・SW画像キャッシュの要求0件)
  - `dcd17a0` index.htmlの?v=バンプとE2Eの一時ディレクトリ片付け(local HEAD = origin/main = `dcd17a0`)
- 台帳(`/home/kuroko/kuroko/ledger/events/2026-10.jsonl`): seq617(05:27:12)で②が「step4の5項目を承認する…step5に進むこと」「#392の3本(25d55de・f75f4e6・8c5e5d8)は含めてpushしてよい」と裁定し、push済み。
- → **#391は完了(done)。origin/mainに入っている。**

## 2. 基準値の再測定(#391後・#392クライアント側はまだ未着手)

step1と同条件(wrangler dev --local・R2に12本相当のダミーデータ・Playwright 5ラウンド)で再測定。結果: `scripts/verify/392-after391-raw.json`。

| round | GET+HEAD本数 | 総時間(ms) | 直列/並列 |
|---|---|---|---|
| 1 | 15 | 441 | **並列** |
| 2 | 15 | 399 | 並列 |
| 3 | 15 | 413 | 並列 |
| 4 | 15 | 416 | 並列 |
| 5 | 15 | 398 | 並列 |

**重要な実測結果**: 本数(15本)はstep1と同じだが、**取得パターンが直列→並列に変わった**。round1の内訳(`library/exclusions/notes/bookshelves.json`が全て `startMs=10` でほぼ同時発火、本棚5本も4本ずつ同時発火)が示すとおり、#391 の **PAR(`runLimited`、同時数4)は storage.js 側(adapter非依存の共通コード)に実装されており、クライアント側(hub-adapter.js)を一切変更していないのに、ハブ接続時の `loadAll()` にもそのまま効いている**。

所要時間(398〜441ms)はstep1(419〜440ms)とほぼ同じ範囲で、今回のローカル環境(wrangler dev、レイテンシ実質0ms)では並列化の時間的な効果は見えていない。GET本数が変わらない(=R相当のキャッシュはまだハブ側に無い)のは想定どおり。本番相当のレイテンシがある環境でPARの時間短縮効果が出るはずだが、それはstep6の本番実測で確認する。

## 3. #391の実装を読んだ共通部品化の判定

対象: `js/github-adapter.js`(R+TOの実装) / `js/storage.js`(PARの実装)。

### PAR(並列化) — **すでに完全共通。そのまま使える。変更不要。**

`js/storage.js:26` の `runLimited(tasks, limit=4)` はモジュールレベルの汎用関数で、adapterを一切知らない(`() => this.adapter.readJSON(path)` という関数の配列を受け取るだけ)。`loadAll()`(`js/storage.js:291`)はadapterがGitHubAdapterでもHubStorageAdapterでも同じコードパスを通る。**今回の実測(§2)で、何も変更していないハブ接続でも並列化が効くことを直接確認済み。** hub-adapter.js側の実装(step5)は、この並列化に乗るだけでよく、何もしなくても良い部分。

### R(一覧sha一括確認+キャッシュ) — **GitHub専用の作り。ハブ側は未実装。抽出が必要。**

`js/github-adapter.js` 内にベタ書きされている:
- `_ensureRemoteShaMap()`(118行目): GitHub専用の3段API(`git/refs`→`git/commits`→`git/trees?recursive=1`)で `{fullPath: sha}` を1回取得。
- `_tryReadFromShaCache(path)`(188行目): 上記のshaとlocalStorage(`_loadLocalCache`/`_saveLocalCache`、キー`virtualBookshelf_ghShaCache_<owner>/<repo>/<branch>`)に保存した `{sha, text}` を比較し、一致ならネットワーク取得をスキップしてキャッシュのtextを返す。不一致/キャッシュ無しなら `undefined` を返し、呼び出し元の `readJSON()` が通常の個別取得(`_getContent`)にフォールバックする。
- `readJSON(path)`(215行目): 先頭で `_tryReadFromShaCache` を呼ぶ形。**loadAll() 側はこのキャッシュの存在を一切知らない**(adapter.readJSON を呼ぶだけ)。

この設計自体は良い抽象化(`StorageAdapter` 契約=`readJSON(path)`を保ったまま、adapter内部でキャッシュを透過的に効かせている)だが、「一覧+版情報取得」と「版キャッシュの差分判定・読み書き」のロジックそのものがGitHubAdapterクラスのプライベートメソッドとして実体化しており、ハブ側(`HubStorageAdapter`)には同じコードが無い。このままハブ側に同種のRを入れると、ロジック(ローカルキャッシュの保存形式・比較・ヒット時の分岐)を**コピーして書く二重実装**になってしまう。

### TO(タイムアウト短縮)+D(1回リトライ) — 半分共通・半分GitHub専用

- タイムアウトの基盤(`StorageAdapter.fetchJSON(url, init, timeoutMs, hooks)`)は `js/storage-adapter.js:143` の静的メソッドで、GitHubAdapter・HubStorageAdapter両方が既に使っている(hub-adapter.js:448)。**timeoutMs を渡すだけなら共通で既に使える。**
- ただし「失敗したら2秒待って1回だけ再試行する」というD(リトライ)のロジックは `js/github-adapter.js:470-474` に `_getContent()` 内でベタ書き(try/catch+setTimeout+再呼び出し)。HubStorageAdapterの `_fetch()` には再試行が無い。これも共通ヘルパー化しないと二重実装になる。

### 抽出案(②に諮る)

`js/storage-adapter.js`(既存の `StorageAdapter` 基底クラス、全adapter共通の置き場)に以下を追加する:

1. **`StorageAdapter.withRetry(fn, { retries=1, delayMs=2000 } = {})`**: `fn`(1回分の試行・Promiseを返す関数)を実行し、失敗したら `delayMs` 待って `retries` 回まで再試行する汎用ヘルパー。GitHubAdapter `_getContent` の469-474行目(TO+Dの再試行部分)をこれに置き換える(振る舞いは変えない・行数だけ移動)。HubStorageAdapterの `_fetch` も同じヘルパーで同様の再試行を追加できる(今回は#392のスコープ外・必要になればstep5で足せる)。

2. **`VersionCache`** (localStorage版キャッシュの共通化。`js/storage-adapter.js` に小さな静的クラスとして追加):
   - `VersionCache.load(ns)` / `VersionCache.save(ns, data)`: GitHubAdapterの `_loadLocalCache`/`_saveLocalCache` と同じI/O(ns=名前空間文字列、adapter側が自分の識別子で生成する。GitHub例: `virtualBookshelf_ghShaCache_<owner>/<repo>/<branch>`、Hub例: `virtualBookshelf_hubEtagCache_<apiBase>`)
   - `VersionCache.read(ns, fullPath, remoteVersion)`: 「`remoteVersion===undefined`(一覧取得失敗)なら`undefined`を返す・ローカルの`version`が一致すれば`{hit:true, text}`・不一致/未保存なら`{hit:false}`」という差分判定を1箇所に持つ
   - `VersionCache.remember(ns, fullPath, version, text)`: 保存

3. **GitHub側の変更点**: `_tryReadFromShaCache`・`_rememberShaCache`・`_loadLocalCache`/`_saveLocalCache` を削除し、`VersionCache.read`/`VersionCache.remember` の呼び出しに置き換える(ロジックの移動のみ、振る舞い不変)。`_ensureRemoteShaMap`(tree APIでの一覧+版情報取得)はバックエンド固有なのでGitHubAdapterに残す。

4. **ハブ側(step5で実装)**: `HubStorageAdapter._ensureRemoteEtagMap(dir)` を新設し、#392 step2で追加した `listDir` の `entries`(ETag/size/uploaded)を使って `{fullPath: etag}` を1回取得する(`truncated:true` か `entries` が無い時は `undefined` を返しフォールバック=②申し送り1の契約)。`readJSON()` 先頭で `VersionCache.read(ns, fullPath, (await this._ensureRemoteEtagMap(dir))[fullPath])` を呼ぶだけで、GitHubAdapterと全く同じ型のRが手に入る。**loadAll()(PAR含む)・VersionCacheは1行も変更不要。**

この形なら「ハブ専用の二重実装をしない」を満たせる: 一覧+版情報の取得手段(tree API vs listDir)だけがバックエンドごとに異なり、差分判定・キャッシュ保存・並列取得は完全に共通コードになる。

## 4. step3(本番deploy)の結果(再掲・1行)

deploy前version id `05c13b61-600f-46cf-8b63-b157e58f8d09` → deploy後 `8c2c255f-d9aa-4c10-8935-837672c16ec9`(rollback: `wr(['rollback','05c13b61-600f-46cf-8b63-b157e58f8d09','-c','cf-worker/wrangler.hub.toml','-m','<理由>'])`)、異常なし・rollback未実施。詳細は `scripts/verify/392-step3-deploy-report.md`。
