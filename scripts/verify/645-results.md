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

## step3: 書き込み時の衝突の選択に「この端末の内容で保存先を上書き」を出す (2026-11-14 17:31〜)

### 1. 入れたもの (`js/bookshelf.js`)

- `_showConflictDialog` の選択肢を `['remote', 'export']` → **`['remote', 'local', 'export']`** にした。読込時 (`_showLoadConflictDialog`) と同じ3つ。保存先の種類で分けない (ハブ・GitHub 共通)。
- `CONFLICT_DIALOG.message` は、上書きを選べない時の文 (「保存先の内容を読み込むと、この端末の未保存の編集は消えます。」) を使う所が無くなったので、2つ目の引数ごと消した。2つのダイアログの本文はどちらも「どちらの内容を使うか選んでください。選ばなかった方の変更は消えます。」になる。
- `_handleSyncConflict` に `'local'` の道を足した (step2 の probe と同じ順・読込時の上書きと同じ道):
  1. `storage.loadAll()` で保存先を読み直す (GitHub は tree の控えも取り直す・step2)。
  2. 成功した時だけ `SyncConfigManager.clearConflict()`・`_conflictNotified=false`。
  3. `_writeSyncBase(state.library.exportDate, state.syncStamp)` (#612 の版の印も渡す)。
  4. `_keepLocalOverLoaded(state)` (手元を丸ごと採り、送り直しを予約する)。
  - 読み直しに失敗した時: 衝突中の印・未反映の記録を残して何も書かず、知らせ (`CONFLICT_DIALOG.overwriteFailed`「保存先を読み込めなかったので、上書きしていません。通信が戻ったら、もう一度選んでください。」) を出して、同じ選択をもう一度出す (書き出した後と同じ戻り方)。
- `'remote'` (location.reload) と `'cancel'` (#639 の止めている間の表示) は変えていない。
- `?v=`: `bookshelf.js` 2026111710 → **2026111746**。

### 2. E2E (`tests/e2e/sync-conflict-overwrite.spec.js`・3本・利用者の操作だけ)

| テスト | 見ること |
|---|---|
| GitHub: 上書きを選ぶ | 2台で衝突 → 端末Bに3つ出る (最初のフォーカスは書き出す・本文は読込時と同じ) → 「この端末の内容で保存先を上書き」→ リポジトリの notes.json が端末Bの短文メモになり端末Aの分は残らない → 続けて書いた短文メモも届き、ダイアログは出ない → 端末Bを開き直しても続けて書いた短文メモが入る |
| Asayake ハブ: 上書きを選ぶ | 同じ (ハブの模擬) |
| GitHub: 読み直せない時 (d) | 端末Bから api.github.com への通信を落として上書きを押す → 知らせが出て、同じ選択がもう一度出る。衝突中の印・未反映の印が残り、リポジトリの head は変わらず (書き込み0・端末Bから GET 以外の要求0)。通信を戻して選び直すと上書きされる |

- 3本とも通った (`_local/645/s3-new-spec.log`・3 passed)。
- 赤になることの確認: step2 の `loadAll` の入口の `forgetRemoteListing()` 呼び出しだけを一時的に外して「GitHub: 上書きを選ぶ」を流すと、**落ちた** (上書きの後の保存がまた衝突し、リポジトリに端末Bの短文メモが20秒届かない・`_local/645/s3-red-check.log`)。外した行は戻した (`git diff HEAD -- js/storage.js` が空)。

### 3. 一緒に直した spec

| spec | 直したところ |
|---|---|
| `tests/e2e/gate/j6-4-sync-conflict.spec.js` (門) | ボタンの数 2→3、「この端末の内容で保存先を上書き」が見えること、手順の名前「2つの選び方」→「3つの選び方」(ハブ・GitHub の2本) |
| `tests/e2e/sync-conflict.spec.js` | 冒頭の説明、テスト名「2つ」→「3つ」、`.cfm-local` の文言と見た目 (btn-danger)、ボタンの数 2→3 |
| `tests/e2e/char/hub-conflict.spec.js` (E4) | `.cfm-local` が無いこと → 「この端末の内容で保存先を上書き」があること |
| `tests/e2e/load-conflict-unsaved.spec.js` | 書き込み時の選択の説明コメントだけ (判定は変えていない) |

- `standard-ops.spec.js`・`back-nav-matrix.spec.js` D03c・`helpers/sync.js` はボタンの数・文言を見ていないので変えていない (流して確かめる)。

### 4. 確認

| 確認 | 結果 |
|---|---|
| chromium: 新しい spec (3)・J6-4 (2)・sync-conflict (3)・sync-offline-reconnect (13)・standard-ops (28)・J1-4 GitHub (1)・load-conflict-unsaved (3) | **53 passed** |
| gate-webkit: J6-4 | **2 passed** |
| chromium: back-nav-matrix D03c | **1 passed** |
| char: hub-conflict (E4) | **3 passed**・15 skipped |
| vitest (全件) | 78 files・**1180 passed** (2 todo) |
| `npm run lint` | **12本中0本失敗** (lint:copy・lint:terms は新しい知らせの文言込みで通った) |
| 監査 `npm run audit:buttons` (6端末・204本) | 通った。ボタン名の揺れ **variants 8/8** (変わらず)。`check-audit.mjs buttons --update` で書き直しても `tests/audit/findings/buttons.json`・`baseline.json` の差分は0 (増減0)。新しい「この端末の内容で保存先を上書き」は巡回の記録に入っている (std の閉じる・戻る・キャンセルの揺れの対象ではない) |

- E2E・vitest・lint・監査は順番に流した (step2 で、同時に流すと画像の添付が ENOENT で落ちたため)。ログは `_local/645/after3-*.log`・`run-after3.out`。
- `tests/audit/open.js` の書き込み時の衝突ダイアログの開き方 (`showConflictDialogForTest`) は変えていない (ダイアログの組み方は同じ関数のまま)。

## step4: 390px・1280px の比較画像・lint 一式・リポジトリ内 docs (2026-11-14 17:43〜)

### 1. 比較画像 (commit しない)

- 撮り方: `scripts/verify/635-shots.mjs` の出力先だけを `_local/645` にした写し (`_local/645/645-shots.mjs`)。変更前は土台 `16c0a10` (origin/main・書き込み時はボタン2つ) を `git archive` で取り出して 18145 番で配り、変更後は作業ツリー (`96988a8` の上) を 8145 番で配って撮った。ダイアログは内部の関数で直接出す (見た目を撮るためだけ。動きは step3 の E2E が画面の操作から見る)。
- 画像:
  - `_local/645/compare-write-390.png` (左から 変更前の書き込み時・変更後の書き込み時・変更後の読込時)
  - `_local/645/compare-write-1280.png` (同じ並び・全体) と `_local/645/compare-write-1280-crop.png` (ダイアログの周りを原寸で切り出し)
  - 1枚ずつ: `_local/645/{before,after}-{write,load}-{390,1280}.png`
- 座標 (`_local/645/coords.json`・`{before,after}-measure.json`):

| | 場面 | 幅 | 箱 (左〜右) | ボタン (左→右・上→下) | ボタンの右端 | 行数 | 箱からのはみ出し | 最初のフォーカス |
|---|---|---|---|---|---|---|---|---|
| 変更前 | 書き込み時 | 390 | 16〜374 | 読み込む／書き出す | 352・352 | 2 | 0 | 書き出す |
| 変更後 | 書き込み時 | 390 | 16〜374 | 読み込む／上書き／書き出す | 352・352・352 | 3 | 0 | 書き出す |
| 変更後 | 読込時 | 390 | 16〜374 | 読み込む／上書き／書き出す | 352・352・352 | 3 | 0 | 書き出す |
| 変更前 | 書き込み時 | 1280 | 340〜940 | 読み込む／書き出す | 721・918 | 1 | 0 | 書き出す |
| 変更後 | 書き込み時 | 1280 | 340〜940 | 読み込む／上書き／書き出す | 679・918・918 | 2 | 0 | 書き出す |
| 変更後 | 読込時 | 1280 | 340〜940 | 読み込む／上書き／書き出す | 679・918・918 | 2 | 0 | 書き出す |

- 変更後の書き込み時と読込時は、390・1280 とも題・本文・ボタンの位置が同じになった (座標が一致)。390 は1つずつ3行・右端 352 でそろう。1280 は1行目に「読み込む」「上書き」、2行目に「書き出す」で、行の右端 918 がそろう。どのボタンも箱の内側に収まり、390 幅で切れない。
- 本文は2つとも「…どちらの内容を使うか選んでください。選ばなかった方の変更は消えます。迷う時は、先にこの端末の内容を書き出してください。」になった (変更前の書き込み時は「保存先の内容を読み込むと、この端末の未保存の編集は消えます。」)。

### 2. lint・vitest・check:version (docs を直した後)

- `npm run lint`: **12本中0本失敗** (copy・terms・css・e2e-goto・e2e-wait・e2e-external・breakpoint・esc・js-color・internal-refs・e2e-gate・known-red)。`_local/645/after4-lint.log`
- vitest: 78 files・**1180 passed** (2 todo)。`_local/645/after4-vitest.log`
- `check:version --range=origin/main..HEAD`: commit の後に流した (下の §4)。

### 3. リポジトリ内 docs

| ファイル | 直したところ |
|---|---|
| `tests/e2e/gate/README.md` | J6-4 の行のボタンを3つにし、書き込み時の上書きは #645 からと書いた |
| `docs/ui-standards.md` | §1「衝突の選択ダイアログ」の選べる物を「書き込み時・読込時とも3つ」にし、上書きは読み直してから書く・読み直せない時は書かずに知らせることを書いた。§8 更新履歴に1行 |
| `docs/char/u0-77-table.md` | E4 の行の選び方に上書きを足した |
| `docs/char/u0-findings.md` | §8 E4 の確認内容の「`.cfm-local`は出ない」を、上書きのラベルを見ることに直した |

- `docs/char/u5-inventory.md`・`u0-targets.md` の E4 の行は選び方を書いていないので変えていない。`docs/ui-standards.md` §1 の行の名前は変えていないので、`tests/audit/screens.js` の std1 も変えていない。

### 4. tp で見せる物のまとめ

- 比較画像: §1 のパス。座標: §1 の表。
- (a)〜(d): step2 §4 の表 (GitHub・ハブとも通った。変更前の GitHub は (a)(b) が通らなかった)。step3 では同じことを画面の操作で E2E にした (`tests/e2e/sync-conflict-overwrite.spec.js`)。
- API の回数 (GitHub の模擬): 起動1回は変更前後とも ref 2・commit 2・tree 1・contents 13 (増えない)。同じページのまま読み直し1回は、変更前 ref 0・commit 0・tree 0・contents 4 (古い中身)、変更後 ref 1・commit 1・tree 1・変わったファイルの contents (最新)。step2 §3 の表。

## step5: 全件比較・設計書の更新・origin/main へ載せ直し・push 前の確認 (2026-11-14 17:47〜)

### 1. 載せ直し

- origin/main が `16c0a10` から12 commit 進んでいた (`f9468f8`・#622・#654・#656・#662 ほか) ので `git rebase origin/main` した。
- 衝突は `index.html` の `bookshelf.js?v=` の1か所だけ (main は 2026111721)。自分の値 **2026111746** を採った (origin/main の最大値 2026111721 より新しい)。`github-adapter.js`・`storage.js` の 2026111745 は衝突しなかった。
- main 側で `js/bookshelf.js` が変わった (#656 の読込時の自分の書きかけ判定ほか) が、上書きの道で呼ぶ `_writeSyncBase(exportDate, stamp)`・`_keepLocalOverLoaded(state)` の形は変わっていない (載せ直した後の 2916・2969 行)。
- #612 は step1 の時点で main に入っていたので、上書きの道への効き方は step1 §2 のとおり (版の印も `_writeSyncBase` に渡している)。

### 2. GitHub を保存先にした時の書き込み時のダイアログ (変更後・390×844・②の追加指示)

- 画像: `_local/645/after-write-390-github.png` (commit しない)。撮り方は `_local/645/645-shots-github.mjs` (gate-github.js の模擬 taro/bookshelf-data@main に接続して起動し、保存先の名前はアプリの `_syncLabel()` から出す。設定の同期欄が起動時に問い合わせる `/user/installations` も模擬で返す＝返さないと状態バーに「GitHub の保存先を取得できません。」が出て、衝突と関係ない表示が写る)。座標は `_local/645/after-write-390-github.json`。

| 本文の保存先の名前 | 箱 (左〜右) | ボタン (上→下) | ボタンの右端 | 行数 | 箱からのはみ出し | 文字の切れ | 最初のフォーカス |
|---|---|---|---|---|---|---|---|
| taro/bookshelf-data@main | 16〜374 | 読み込む／上書き／書き出す | 352・352・352 | 3 | 0 | 0 | この端末の内容を書き出す |

- 本文: 「保存先（taro/bookshelf-data@main）の内容が、別の端末などで更新されています。この端末にも、まだ保存先に入っていない編集があります。どちらの内容を使うか選んでください。選ばなかった方の変更は消えます。迷う時は、先にこの端末の内容を書き出してください。」
- ハブで撮った変更後 (step4) と、ボタンの位置・右端・行数は同じ。

### 3. 設計書 (obsidian の bookshelf・2026-11-14 更新)

| 文書 | 直したところ |
|---|---|
| 07_残検討事項 | #635 が起こした「書き込みで衝突した時に『この端末の内容で保存先を上書き』が選べない」の行を ➡️ → **✅ 実装 (2026-11-14)** にし、直し方 (3つにした・読み直してから書く・tree の控えの取り直しと ref の no-store・読み直せない時・E2E) を書いた |
| 04_画面設計書 | 衝突の選択ダイアログの節: 上書きのボタンの「読込時だけ」を「書き込み時と読込時の両方」に、本文の後半の出し分けを「2つとも同じ」に直し、上書きを選んだ時の動き (読み直してから書く・読み直せない時の知らせ) を1行足した |
| 03_詳細設計書 | `_showConflictChoiceDialog`/`_showConflictDialog` の行: 書き込み時の選択肢を3つにし、`_handleSyncConflict` の `'local'` を書いた。GitHubAdapter の節: 読み直し (`forgetRemoteListing`・世代・loadAll の入口・ref の no-store・照合の版は触らない) を1項目足した |
| 06_データ仕様書 | `virtualBookshelf_syncConflict` の行: 上書きは保存先を読み直せた時だけ印を消す (読み直せない時は残す) を足した |
| 08_意思決定記録 | **ADR-167** を足した (書き込み時も上書きを出す・GitHub のアダプタは読み直しのたびに tree の控えを取り直し ref は no-store。控えの取り直し方の比較と却下した案を含む)。ADR-164 の決定4 と「分かっている残り」に、ADR-167 で置き換えた印を付けた。08 は CRLF のまま (素の LF 0件) |

- 設計書の commit は obsidian の自動の保存に任せる (vault は別のリポジトリ)。

### 4. 全件比較 (e2e-diff-main)

- `node scripts/verify/e2e-diff-main.mjs --base=origin/main --port=8145` (載せ直した後・base = origin/main `f9468f8`・work = `252a0fa`)。17:49 に始め、**E2E は両側とも全件流れた** (base 17:55・work 18:01)。その後の vitest の段 (base 側) で、自分で付けた13分の上限に当たって止まった＝**vitest と画像比較 (visual) は流れていない**。12分の上限を1分ほど過ぎたが、止める前に work 側の E2E が終わっていたので、その JSON (`_local/645/e2e-diff/{base,work}.e2e.json`) から3表を自分で数えた (`_local/645/diff3.mjs`・結果 `_local/645/e2e-diff-3tables.json`)。

| | 件数 |
|---|---|
| base (origin/main) | expected 1084・unexpected 6・skipped 593 |
| work (このイシュー) | expected 1092・unexpected 1・skipped 593 |
| **新しく落ちた** | **1** |
| **新しく通った** | **6** (base だけで落ちた) |
| **両方落ちた** | **0** |

- 新しく落ちた1本: `book-memo-file-lifecycle.spec.js:234`「題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない」(GitHub)。work 側で単独に `--repeat-each=3` で流すと、同じ名前の6本×3回が **18 passed** (`_local/645/s5-rerun-book-memo.log`)。同じ spec の ASIN を変える方 (:253) は base だけで落ちており、#635 の全件比較でも base・work の両方でこの spec の GitHub の分が負荷で落ちていた (`635-results.md` step3 §4)。今回の変更 (衝突の選択・loadAll の入口で tree の控えを捨てる) は、長文メモの題名を変える道 (loadAll を通らない) に入らないので、負荷による揺れと見ている。
- 新しく通った6本 (base だけで落ちた): book-memo-file-lifecycle:253 (GitHub)・門の J3-5・門の J6-1・list-staged-render:71・reimport-diff:106・save-failure-visible:136 (GitHub)。どれも衝突の選択を通らない。両側を順に流した時の base 側の揺れと見ている。
- 名前・行が変わっただけのもの: 片側にしかない行が work 7・base 4。J6-4 GitHub (106→107行)・sync-conflict の3本 (テスト名の「2つ」→「3つ」と行のずれ)・新しい sync-conflict-overwrite の3本。work 側はすべて expected。

### 5. 載せ直した後の確認

| 確認 (載せ直した後の `252a0fa` の上) | 結果 |
|---|---|
| chromium: J6-4 (2)・新しい sync-conflict-overwrite (3)・sync-offline-reconnect (13)・sync-conflict (3)・load-conflict-unsaved (3)・J1-4 GitHub (1) | 全件比較の work 側の結果ですべて expected (25本) |
| gate-webkit: J6-4 | **2 passed** (`_local/645/s5-webkit-j64.log`) |
| `npm run lint` | **12本中0本失敗** (`_local/645/s5-lint.log`) |
| vitest | 79 files・**1185 passed** (2 todo)。main 側の新しい単体テストの分だけ増えた (`_local/645/s5-vitest.log`) |
| `check:version --range=origin/main..HEAD` | 下の commit の後に流す (§6) |

### 6. 送る commit (載せ直した後)

| sha | 題 |
|---|---|
| `689705d` | docs: 645-results.md に着手条件・#612 の効き方・GitHub の模擬での読み直しの古い中身と要求の数・変更前の合否を記録する |
| `9c1c22c` | fix: GitHub の保存先で同じページのまま読み直しても最新の中身が入るよう、読み直しのたびに tree の控えを取り直し、ref を no-store で取る |
| `8a84db9` | feat: 書き込みで衝突した時も「この端末の内容で保存先を上書き」を選べるようにする (ハブ・GitHub 共通) |
| `252a0fa` | docs: 書き込み時の衝突でも上書きを選べるようにしたのに合わせ、ui-standards・門の手引きの J6-4・char の E4 を直し、645-results.md に比較画像の座標と lint の結果を書く |
| (この記録の commit) | docs: 645-results.md に step5 (載せ直し・全件比較の3表・GitHub の画像の座標) を記録 (設計: 03/04/06/07/08 2026-11-14 更新・ADR-167)。sha は提出に書く |

- 全部 `Issue: #645` 付き。origin/main (`f9468f8`) の上に積んである。

- `_local/645/base-16c0a10` (step4 の変更前の画像に使った取り出し・32MB) は使い終わったので `_trash/645-base-16c0a10` へ移した (消していない)。
