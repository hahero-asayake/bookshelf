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
