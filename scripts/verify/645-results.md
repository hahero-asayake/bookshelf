# イシュー#645 GitHub保存先でも書き込み時の衝突に「この端末の内容で保存先を上書き」を出す — 確かめた結果

## step1: 着手条件・土台・変更前の実測 (2026-11-14 17:17〜)

### 1. 着手条件

- `git fetch origin` の後の origin/main は `16c0a10` (17:07)。
- #635 の commit 7つ (`5c6eef2`〜`51f29dd`・ADR-164) が origin/main に入っていることを `git log origin/main --grep='Issue: #635'` で確かめた。DB (`discord/core/kuroko.db` を readOnly で開いた) でも #635 は done (16:21)。
- #612 も main に入っている (`1b89422`・`4dd7933` ほか・ADR-163)。DB でも done (16:03)。
- worktree `issue-645` を `4f1a19b` から origin/main `16c0a10` へ早送りした (手元の変更は0件)。

### 2. #612 (版の印・ハブの変えたファイルだけ送る・項目ごとの合わせ) が上書きの道に効くところ

上書きの道 = `storage.loadAll()` → 衝突中の印を消す → `_writeSyncBase` → `_keepLocalOverLoaded`。コードを読んだだけで、実測はしていない。

- `_writeSyncBase(exportDate, stamp)` が版の印を2つ目の引数に取るようになった。読込時の「上書き」(`js/bookshelf.js` `_askLoadConflict` の `'local'`) は `state.syncStamp` を渡している。書き込み時の上書きの道でも、読み直した `state.syncStamp` を渡す。渡さないと `_sameSyncVersion` (exportDate と印の両方を見る) が次の起動で「他の端末が変えた」と見誤る。
- `syncBatch` は印 (`private/sync-stamp.json`) を同じ書き込みに入れる。GitHub は `addBatchStamp` で入れ、`_assertBatchNotStale` の照合から外す (後勝ち)。上書きの後の保存で印が照合に引っかかることは無い。
- ハブは `_dropUnchanged` で、最後に読んだ・書いた中身 (`_lastKnownContent`) と同じファイルを送らない。上書きの道は直前に読み直す (ハブの一覧の控えは3秒で切れる・`ETAG_MAP_TTL_MS`) ので `_lastKnownContent` は保存先の最新になり、送るのは手元と保存先で違うファイルだけになる。送らないファイルは保存先と手元が同じなので、結果は手元の内容になる (混ざらない)。
- ハブの項目ごとの合わせ (`StorageAdapter.mergeRemoteChange`・notes.json と settings.json だけ) は、送った時に 412 が返った時だけ動く。読み直してから送るまでの間に別の端末がさらに書いた時だけで、その時は相手の項目が手元に入る (`_applyMergedRemote`)。上書きを選んだ後に起きた新しい変更なので、#612 の決まりのまま扱う。
- GitHub のアダプタは変えたファイルだけ送る形になっていない (毎回全部送る)。tree の控えを取り直せば、照合は最新の sha で通る見込み (step2 で確かめる)。

### 3. #635 step3 の「書き込み時の『保存先の内容を読み込む』に古い控えが効くか」

- `scripts/verify/635-results.md` step3 §2: GitHub の模擬で、端末Bに最新 (端末Aの短文メモ) が入った。「読み込む」は `location.reload()` でページごと作り直すので、tree の控えも取り直される。
- 下の §4 (iii) でも同じ結果になった。

### 4. 変更前の実測 (GitHub の模擬・probe)

使い捨ての probe `tests/e2e/zz-probe-645.spec.js` (commit せず `_local/645/` に移した)。結果の JSON は `_local/645/probe-github.json`、ログは `_local/645/probe-github.log`。

手順: 模擬のリポジトリ (`gate-github.js`) に蔵書を置き、端末Aで開く → 端末Bを開いて短文メモを書き、リポジトリに届くのを待つ → 端末Aで同じページのまま `window.bookshelf.storage.loadAll()` を2回呼ぶ → 端末Aで同じ本に短文メモを書いて衝突させる → 「保存先の内容を読み込む」を押す。api.github.com への要求は `page.on('request')` で数えた (模擬に向けた要求も数えられる)。

**(i) 同じページのまま読み直した中身**

| | 端末Bの短文メモ | 要求 |
|---|---|---|
| 1回目の読み直し | **無い (起動した時の古い中身)** | contents 4本だけ (ref・commit・tree は0) |
| 2回目の読み直し | 無い | contents 4本 |

- contents の4本は exclusions.json・settings.json・main.json・sync-stamp.json。起動した時の tree に無かった (起動の後のまとめ保存で初めて作られた) ので、控えに sha が無く、contents API で最新を取っている。
- つまり今は、**控えにあるファイル (notes.json・library.json など) は起動時の中身、控えに無いファイル (sync-stamp.json など) は最新** が返り、1回の読み直しの中で新旧が混ざる。`_decideLoadedState` が見る exportDate (library.json) と版の印 (sync-stamp.json) の新旧がずれる組み合わせがある。

**(ii) 要求の数**

| 場面 | ref | commit | tree | contents | その他 |
|---|---|---|---|---|---|
| 起動1回 (端末A) | 2 | 2 | 1 | 13 | /user/installations 1・まとめ保存 (blobs 15・trees 1・commits 1・PATCH ref 1) |
| うち tree の控え (`_ensureRemoteShaMap`) | 1 | 1 | 1 | — | |
| うちまとめ保存 (`commitBatch`) | 1 | 1 | 0 | — | |
| 同じページのまま読み直し1回 | 0 | 0 | 0 | 4 | |
| 「読み込む」の後の起動 | 2 | 2 | 1 | 9 | /user/installations 1・まとめ保存 (blobs 15 ほか) |

- 模擬では起動のたびにまとめ保存が1回走っている (blobs 15)。理由は調べていない。step2 の「起動の回数が増えないこと」は、この表と同じ数え方 (ref・commit・tree・contents を分ける) で比べる。
- 要求の頭 (request header) では no-store を見分けられない。まとめ保存の ref の GET は no-store を付けている (tests/unit/github-adapter.test.js:212) が、`allHeaders()` の cache-control は2本とも null だった。ref の GET に no-store が付くかは単体テストで見る。

**(iii) 書き込みの衝突から「保存先の内容を読み込む」**

- 端末Aのダイアログのボタンは「保存先の内容を読み込む」「この端末の内容を書き出す」の2つ (#635 の案2)。リポジトリの短文メモは端末Bのまま (上書きされていない)。
- 「読み込む」の後、端末Aの短文メモ欄は **端末Bの短文メモ (最新)** になった。

**(iv) 本物の GitHub でだけ起きる古い ref (模擬では再現しない)**

- GitHub の refs API の GET の応答を1回だけ見た (`curl -sI https://api.github.com/repos/octocat/Hello-World/git/refs/heads/master`・未認証): `cache-control: public, max-age=60, s-maxage=60`。ref も60秒ブラウザに置かれる。token 付き (アプリの要求) の値は見ていない (private になる見込み)。
- `_ensureRemoteShaMap` の ref の GET (`js/github-adapter.js:111`) は no-store を付けていない。開いてから60秒以内に同じページを開き直す・「読み込む」を押すと、ブラウザに残った古い ref から古い tree を作り、VersionCache の古い中身が返りうる。
- Playwright は route を張るとブラウザの HTTP キャッシュを切る (公式の page.route の注記「Enabling routing disables http cache」) ので、模擬の E2E ではこの古い ref は起きない。(iii) が最新になったのはそのため。step2 の単体テスト (no-store でない GET に古い ref を返す模擬) で確かめる。
- この1回で、この端末の未認証の残り回数は5だった (CI を API で見ている他のイシューと共有)。

### 5. 同じ原因 (tree の控えを持ち続ける・ref を古いまま使う) の不具合 = 本イシューの対象

1. 同じページのまま `storage.loadAll()` で読み直すと、控えにあるファイルは起動時の中身が返る (§4 (i))。書き込み時の「上書き」の道が通らない直接の原因 (#635 step1 の (a)(b))。
2. 1回の読み直しの中で、控えにあるファイル (古い) と無いファイル (新しい) が混ざる (§4 (i))。
3. 本物の GitHub では、ref の GET が60秒ブラウザに置かれるので、開き直し・「読み込む」(location.reload) でも古い中身が入りうる (§4 (iv)・模擬では再現しない)。
4. 同じ loadAll を通る他の道も古い中身を読む: GitHub の読み込みに失敗した時の「再試行」(`initGitHubSync`)、公開の生成 (`js/publish-article-generator.js` の `loadAll()`・`opts.state` が無い時)。

step2 (読み直しのたびに控えを捨てる＋ref の GET に no-store) で 1〜4 を塞ぐ。

### 6. 変更前の合否 (origin/main `16c0a10`・PORT=8145)

| spec | project | 結果 |
|---|---|---|
| `tests/e2e/gate/j6-4-sync-conflict.spec.js` | chromium | 2 passed |
| 同上 | gate-webkit | 2 passed |
| `tests/e2e/sync-conflict.spec.js` | chromium | 3 passed |
| `tests/e2e/sync-offline-reconnect.spec.js` | chromium | 13 passed |
| `tests/e2e/standard-ops.spec.js` | chromium | 28 passed |
| `tests/e2e/gate/j1-4-github-save-reload.spec.js` (門の J1-4 GitHub) | chromium | 1 passed (gate-webkit は playwright.config の GATE_WEBKIT_IGNORE で対象外) |
| `tests/e2e/back-nav-matrix.spec.js` D03c | chromium | 1 passed |
| `tests/e2e/char/hub-conflict.spec.js` | char の6端末 | 3 passed・15 skipped |
| `tests/e2e/load-conflict-unsaved.spec.js` (#639・書き込み時の衝突を2台で起こす分を含む) | chromium | 3 passed |
| `tests/unit/github-adapter.test.js` | vitest | 28 passed |

落ちは0件。ログは `_local/645/before-*.log`。`load-conflict-unsaved.spec.js` は計画の一覧に無かったが、#639 で書き込み時の衝突ダイアログを使う spec が足されていたので加えた (step3 で一緒に直す spec に入る)。

## step2: 読み直しのたびに tree の控えを取り直す (案A) (2026-11-14 17:23〜)

### 1. 入れたもの

- `js/github-adapter.js`
  - 控えを捨てる口 `forgetRemoteListing()` を足した。`_remoteShaMap`・`_treeFetchPromise` を捨て、世代 (`_remoteListingGen`) を1つ進める。`_shaCache`・`_lastKnownContent` (書き込みの照合の版) は触らない。
  - `_ensureRemoteShaMap` の ref の GET に `cache: 'no-store'` を付けた (step1 §4 (iv): ref は max-age=60 でブラウザに残る)。commit・tree は sha で指すので今のまま。
  - 取得の途中で控えを捨てられた時は、その結果を控えに入れない (世代を比べる)。取得に失敗した時に `{}` を置いて contents API に落ちる動きは変えていない。
- `js/storage.js`: `BookshelfStorage.loadAll()` の先頭で、adapter に `forgetRemoteListing` があれば呼ぶ (コアは adapter を名指ししない。ハブは一覧の控えを3秒で切っているので口を持たない)。
- `?v=`: `github-adapter.js`・`storage.js` を 2026111651 → **2026111745** (origin/main の最大値 2026111711 より新しい)。
- 変えていないもの: `clearShaCache()`、`_assertBatchNotStale` (照合で最新を見つけても `_shaCache`・`_lastKnownContent` を更新しない・#616)、loadAll の外の個別の読み (長文メモ等は控えを使い回す)。

### 2. 単体テスト (`tests/unit/github-adapter.test.js` に4本・BookshelfStorage の loadAll を通す)

中身が変わるリポジトリの模擬を置いた。ref の GET は no-store でない時は最初に返した ref を返し続ける (ブラウザに残った ref の模擬)。

1. 他の端末が書いた後に loadAll で読み直すと最新の中身が返る。ref・tree は1本ずつ、本文を取るのは変わった notes.json だけ (library.json は取らない)。書き込みの照合の版 (`getCachedSha`) も最新になる。
2. ref の GET は2回とも no-store。古い ref (c1) を使うと「最初」が返る状況で「別の端末」が返る。
3. loadAll の外の読み (`readJSON`) は tree を取り直さない (要求を増やさない)。
4. 控えを捨てても書き込みの照合の版は残る。

### 3. 要求の数 (変更前後・GitHub の模擬・step1 と同じ数え方)

| 場面 | 変更前 | 変更後 |
|---|---|---|
| 起動1回 | ref 2・commit 2・tree 1・contents 13 (+ /user/installations 1・まとめ保存 blobs 15 ほか) | **同じ** (ref 2・commit 2・tree 1・contents 13・installations 1・blobs 15 ほか) |
| 同じページのまま読み直し1回 | ref 0・commit 0・tree 0・contents 4 (古い中身) | ref 1・commit 1・tree 1・contents 9 (最新・下の (a) の時) |

- 起動では tree を2回取らない: 起動の読込は loadAll の1回だけで、その前に tree を取る読みが無い (起動の最初の要求は `contents/private/bookshelves/all.json` と `/user/installations`)。
- 読み直しの contents 9本は、前に読んだ時から sha が変わったファイル (端末Aの起動のまとめ保存・端末Bの保存で書かれた分) と、リポジトリに無いファイル (404)。sha が同じファイルは本文を取らない。
- 読み直し1回あたり +3本 (ref・commit・tree)。計画の比較 (案A) どおり。

### 4. (a)〜(d) (使い捨ての probe `_local/645/zz-probe-645b.spec.js`・結果 `_local/645/probe-{github,hub}-abcd.json`)

手順: 模擬の保存先に蔵書を置き、端末Aで開く → 端末Bで短文メモを書いて届くのを待つ → 端末Aで同じ本に短文メモを書いて書き込みの衝突を起こし、Esc で閉じる (衝突中の印・未反映の印が残る) → (d) 保存先への通信を落として上書きの道 (`storage.loadAll()` → `SyncConfigManager.clearConflict()` → `_writeSyncBase(exportDate, syncStamp)` → `_keepLocalOverLoaded`) を通す → 通信を戻してもう一度通す → 続けて短文メモを書く → 端末Aを開き直す。

| | GitHub (変更前・#635 step1) | GitHub (変更後) | ハブ (変更後) |
|---|---|---|---|
| (d) 読み直しの失敗 | ✓ | Failed to fetch。衝突中の印・未反映の印が残り、書き込み0 ✓ | 同じ ✓ |
| (a) 次のまとめ保存 | また衝突する ✗ | 衝突せずに通る。印が消え、ダイアログは出ない ✓ | 同じ ✓ |
| (b) 保存先が手元の内容になる | notes.json は端末Bのまま ✗ | notes.json が端末Aの短文メモ ✓ | ✓ |
| (c) 混ざらない | — | 端末Bの短文メモは残らない。commit 1つ ✓ | 端末Bの短文メモは残らない。batch 1回 ✓ |
| 続けて書く | 届かない ✗ | 届く・衝突しない ✓ | ✓ |
| 端末Aを開き直す | — | 続けて書いた短文メモが入る ✓ | ✓ |

- 上書きの道の `_writeSyncBase` には、#612 で足された版の印 (`state.syncStamp`) も渡した (読込時の上書きと同じ)。step3 の `_handleSyncConflict` の 'local' も同じにする。

### 5. 確認 (変更後・PORT=8145)

| 確認 | 結果 |
|---|---|
| vitest (全件) | 78 files・**1180 passed** (2 todo)。`github-adapter.test.js` は 28→32 |
| chromium: J6-4 (2)・sync-conflict (3)・sync-offline-reconnect (13)・J1-4 GitHub (1)・load-conflict-unsaved (3) | 21 passed・1 failed → 落ちた1本を単独で流し直して **3 passed** (下) |
| gate-webkit: J6-4 | **2 passed** |
| `npm run lint` | 12本中11本 OK。`lint:internal-refs` だけ 84/82 で落ちたが、probe (`app._` 2件) を作業ツリーに置いたままだったため。probe を `_local/645/` へ移すと 82/82 で OK |

- 落ちた1本は `load-conflict-unsaved.spec.js:178` (ローカルフォルダ・読込時の選択を閉じた後)。中身の判定ではなく、画像の添付のコピーが ENOENT (`test.info().attach` の時に `test-results/` の画像が無かった)。同じ時刻に vitest 全件と lint 一式を同じ作業ツリーで流していた。ローカルフォルダの adapter は `forgetRemoteListing` を持たないので、今回の変更が通らない道。単独で流し直すと3本とも通った (`_local/645/after2-A2-load-conflict-unsaved-rerun.log`)。
- ログ: `_local/645/after2-A-chromium.log`・`after2-B-webkit.log`・`after2-lint.log`・`probe-abcd.log`。
