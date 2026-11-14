# #677 起動の読込が通信で失敗した後も、公開記事の移行とプラグインの列挙が2秒ずつ再試行する — 記録

## §1 着手確認と直す前の実測（2026-11-14 19:40〜19:47・コードは変えていない）

### 着手確認

- 19:40 に `git fetch` した。`git log origin/main --grep='Issue: #672'` で #672 の commit が6件見えた。うち fix は 9944d6b「起動の読込が通信で失敗した時は、その時点で状態バーの「最新のデータを確認しています…」を下ろす」、test は 7397d15。worktree は 585f13a から 33eda9e（origin/main）へ `git merge --ff-only` で早送りした。行番号は 33eda9e のもの。
- #672 の最終の差分は計画どおりだった（違いは無い）。
  - (1) (b) の形：finishStartup の中、`await this.initSync()` の直後に `if (this._initLoadFailed && this._syncChecking) { this._syncChecking = false; this._updateStatusBar(); }` がある（js/bookshelf.js L436-439）。docs/char/boot-flow.md §1-3 の表も同じ commit で直っている。
  - (2) `waitForHubStartupForTest`（tests/e2e/helpers/gate-hub.js）は変わっていない。#672 の差分に tests/e2e/helpers は無い。#loading と `.status-row.status-checking` の2つで判定する作りのまま。
- #666 は未着。`git log origin/main --grep='Issue: #666'` は0件（19:40）。

### 流し方

- probe は `tmp/677/probe-677.spec.mjs`、config は `tmp/677/probe.config.mjs`（tmp/ は commit しない）。
  - 1回目：`PORT=8177 npx playwright test --config tmp/677/probe.config.mjs --workers=4 --repeat-each=2 --global-timeout=300000`。12 passed（1.5分）。
  - 2回目：S5 だけを `--workers=2 --grep S5` で流した。2 passed（11.9秒）。
  - 元の記録は `tmp/677/runs/<場面>-<0|1>.json`。集計は `tmp/677/sum.mjs`。
- 作り方は tests/e2e/boot-load-checking-row.spec.js（#672）と同じ。模擬より手前の `context.route` で落とす（GitHub は api.github.com、ハブは HUB_BASE）。
  - 通信の失敗は `route.abort('internetdisconnected')`。
  - 「止まったまま」は route の handler が答えない形（`new Promise(() => {})`）。
  - 「端末にデータあり」は、1回ふつうに起動してから切って `page.reload()` する。
  - 「端末にデータ無し」は、最初の起動から切って開く。localStorage に virtualBookshelf_userData が無い＝`_hasLocalUserData` が偽（js/bookshelf.js L532）。
- 時刻は、reload または goto の直前を起点にした ms。
  - 画面（#app-status-bar の行・toast・#loading の display・#obsidian-sync-status）は addInitScript の MutationObserver で取り、`performance.now()` で記録した。
  - 要求と console は Node 側の時計で取った。そのため両者が数 ms ずれることがある。
- 「通信を戻す」は、route を通す形に戻してから `context.setOffline(true)` → 200ms → `setOffline(false)` で 'online' を起こす。その後の要求・画面・プラグインの数を、最大20秒取った。
- プラグインの数は `bookshelf.pluginLoader.loaded` の key（probe だけで読む。spec には書かない）。
- 観測の上限は場面ごとに30秒（S4 だけ45秒）。上限まで残ったのは S4 の #loading だけだった（下の表）。

### 実測の表（各2回）

「失敗の表示」は、GitHub では toast、ハブでは状態バーの失敗の行。

| 場面 | 回 | 失敗の表示 | 確認中の行が消えた | #loading が消えた | 失敗の表示から消えるまで | 起動の後半が終わった（最後の要求） |
|---|---|---|---|---|---|---|
| S1 GitHub・通信の失敗・データあり | 0 | 2100 | 2100 | 84（すぐ） | 確認中の行 **0.00 秒**（#672 の直し） | 8132 |
| 同上 | 1 | 2070 | 2070 | 61（すぐ） | 確認中の行 **0.00 秒** | 8101 |
| S2 GitHub・通信の失敗・**データ無し** | 0 | 2093 | （出ない） | **8131** | #loading **6.04 秒** | 8130 |
| 同上 | 1 | 2095 | （出ない） | **8122** | #loading **6.03 秒** | 8120 |
| S3a 参考：ハブ・通信の失敗・データ無し | 0 | 96 | （出ない） | 125 | #loading 0.03 秒 | 123 |
| 同上 | 1 | 75 | （出ない） | 101 | #loading 0.03 秒 | 100 |
| S3b 参考：GitHub・成功・データ無し | 0 | （「保存済み」239） | （出ない） | 382 | — | 377 |
| 同上 | 1 | （「保存済み」128） | （出ない） | 201 | — | 198 |
| S3c 参考：GitHub・成功・データあり | 0 | （「保存済み」91） | 184 | 72（すぐ） | — | 185 |
| 同上 | 1 | （「保存済み」103） | 204 | 83（すぐ） | — | 204 |
| S4 参考：GitHub・**止まったまま**・データ無し | 0 | 12088 | （出ない） | **45秒の上限まで消えず** | #loading **32.9 秒より長い**（見積もり約46秒） | 上限の時点で 41129 の要求が待ち中 |
| 同上 | 1 | 12071 | （出ない） | **45秒の上限まで消えず** | #loading **32.9 秒より長い**（見積もり約46秒） | 上限の時点で 41090 の要求が待ち中 |

- **#672 の後に残るのは、データ無しの起動の #loading**。GitHub・通信の失敗で、toast の後 6.03〜6.04 秒は覆いが残り、その間は画面を触れない。
- データありの起動では、確認中の行は toast と同時に消える（#672 の直し）。ただ、起動の後半は裏で 8.1 秒まで続く。この間の読込は、どれも同じ失敗を2秒待って繰り返している。
- 止まったまま答えない時（S4）は、読込の失敗の toast まで12.1秒かかる。その後の #loading は、45秒の上限でもまだ残っていた。
  - 見積もり（S4 の並びから・上限の後は未実測）：残りはシードの ref の読み（約5秒）と列挙（5＋2＋5秒）。#loading が消えるのは約58秒、toast からは約46秒。672-results の見積もり（最大約36秒）より長い。ref の読み（再試行なし・1回5秒）が2回入るのを数えていなかったため。

### 起動の後半で、どの読込がいつ何回待つか（GitHub・通信の失敗。S1 の0回目・ms）

S1 の1回目・S2 の2回も、並びは同じで、時刻の差は ±30ms 以内。

| 時刻 | 要求（すべて `net::ERR_INTERNET_DISCONNECTED` ですぐ失敗） | 起きたこと |
|---|---|---|
| 88 → 99 | `contents/private/bookshelves/all.json`・`user/installations` | 読込の1回目が失敗する。2秒待つ |
| 2099 → 2100 | `contents/private/bookshelves/all.json`（再試行） | 失敗する。toast と同期欄の失敗の文が出る。確認中の行が下りる（#672） |
| 2102 | `git/refs/heads/main`（1回・再試行なし） | tree の控え `_ensureRemoteShaMap`（js/github-adapter.js L109-）の読み。readJSON から呼ばれる |
| 2103 → 4106 | `contents/private/publish/articles.json` ×2（2秒あけて） | 公開記事の移行が失敗する（console「公開記事モデルへの移行に失敗」4106） |
| 4107 → 6110 | `contents/plugins` ×2（2秒あけて） | ensureStandardPlugins の列挙が失敗する（「plugins ディレクトリ列挙失敗」6110）。列挙が空なので5個とも欠けているとみて、手元の plugins-sample/ を取る（成功） |
| 6122 → 6123 | `git/refs/heads/main`（1回・再試行なし） | シードの書き込み（syncBatch の最初の ref の読み・js/github-adapter.js L343-345）が失敗する（「標準機能シードの書き込みに失敗」6123） |
| 6124 → 8132 | `contents/plugins` ×2（2秒あけて） | loadEnabledPlugins の列挙が失敗する（「plugins ディレクトリ列挙失敗」8132） |
| 8132 | — | finishStartup が終わる（データ無しなら、ここで #loading が消える＝S2 の 8122〜8131） |

- 2秒待つのは `GitHubAdapter._getContent`（js/github-adapter.js L540-556）の `StorageAdapter.withRetry({ retries: 1, delayMs: 2000 })`。toast の後に3回（移行1・列挙2）待つので、2秒×3＝約6秒になる。
- ref の読み2回（`_ensureRemoteShaMap` と syncBatch）は `_getContent` を通らないので、再試行しない。すぐ失敗する時は数 ms で済む。止まったままの時は、1回ずつ5秒の上限まで待つ（S4 の 12089→17089）。
- ハブ（S3a）も同じ順番で進む（移行の失敗 101・列挙の失敗 103・シードの書き込みの失敗 122・列挙の失敗 123）。hub-adapter には再試行が無いので、0.03秒で終わる。

### プラグインの今の挙動

**GitHub の模擬ではプラグインの数を測れない**。tests/e2e/helpers/gate-github.js の contents の模擬（L114）は、1つのファイルだけを `type: 'file'` で返し、フォルダの一覧（`type: 'dir'`）を返さない。そのため listDirs('plugins') が空になる。
- 結果として、成功の起動（S3b・S3c）でもプラグインは0件で、毎回の起動でシードを書き直していた（S3c でも `git/blobs` の POST が15本・tree・commit・ref の更新）。
- 本物の GitHub はフォルダの一覧を返すので、これは模擬の制約。
- そこでプラグインの数はハブの模擬で取った（S5・2回とも同じ結果）。

| 場面（S5・ハブ） | 有効になったプラグイン | シードの書き込み |
|---|---|---|
| 成功の起動（最初・データ無し） | **5個**（author-grouping・dark-theme・highlights-builtin・series-grouping・memo-templates） | 試みて成功した（`POST data/batch` 1本） |
| 通信の失敗で開き直す（データあり） | **0個**（列挙が2回とも失敗＝listInstalledPlugins の catch が [] を返す・js/plugin-loader.js L55-59） | **試みて失敗した**（console「標準機能シードの書き込みに失敗」126・1143ms）。GitHub（S1・S2）でも同じく試みて失敗した（6123ms） |
| その後に通信を戻して 'online' | **0個のまま**（20秒まで見た） | 試みない。戻った後の要求は initSync の読み直し（private/ の各ファイル・usage）だけで、`data/plugins` の列挙は1本も出ない。GitHub（S1・S2 の戻した後）でも `contents/plugins` は0本 |

- **通信が戻っても、プラグインは読み直されない（実測）**。`_retryInitLoad`（js/bookshelf.js L5359-5368）は initSync だけを流すので、移行・シード・列挙・activate は流し直さない。同じタブで有効になるには、開き直すしかない。
- **失敗の後に設定からプラグインを入れた時（未実測・コードから）**：
  - installFromGitHub（js/plugin-loader.js L270-）は、raw の GitHub からプラグインの manifest.json・index.js を取る（`fetch(raw + …)`）。それを保存先へ `storage.syncBatch` で書き、`_loadPlugin` → `_activatePlugin`（L195-198）で、その場で有効にする。起動の時のプラグインの読み込みには頼らない。
  - だから、保存先に届かない間は syncBatch が失敗して入らない。通信が戻った後なら入って、その場で出る見込み。起動時の読み込みを飛ばしても、この経路は変わらない見込み。
- **二重の activate を防ぐ守り（案 (iii) の前提・コードから）**：
  - `_activatePlugin`（js/plugin-loader.js L201-）にも loadEnabledPlugins（L80-125）にも、`this.loaded.has(id)` で既にある id を飛ばす所が無い。`git grep -n "loaded.has" -- js/plugin-loader.js` は L353（uninstall）の1件だけ。
  - そのため、起動で一部が有効になった後に loadEnabledPlugins をもう一度流すと、同じプラグインを2回 activate しうる。(iii) にするなら守りを足す必要がある。

### 揃わなかったもの・注意

- 全場面が揃った（12＋2本・失敗0）。S4 の #loading だけは、45秒の上限まで消えなかった（上限の後は見積もり）。
- GitHub の場面のプラグインの数は、模擬の制約で測れない（上）。step3 の E2E で「プラグインが有効」を見るなら、ハブの模擬を使うか、GitHub の模擬にフォルダの一覧を足す必要がある。
- 失敗の後に設定からプラグインを入れる経路は、未実測（コードの出典だけ）。
