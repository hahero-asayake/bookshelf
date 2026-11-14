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
| S4 参考：GitHub・**止まったまま**・データ無し | 0 | 12088 | （出ない） | **45秒の上限まで消えず** | #loading **32.9 秒より長い**（見積もり約51秒） | 上限の時点で 41129 の要求が待ち中 |
| 同上 | 1 | 12071 | （出ない） | **45秒の上限まで消えず** | #loading **32.9 秒より長い**（見積もり約51秒） | 上限の時点で 41090 の要求が待ち中 |

- **#672 の後に残るのは、データ無しの起動の #loading**。GitHub・通信の失敗で、toast の後 6.03〜6.04 秒は覆いが残り、その間は画面を触れない。
- データありの起動では、確認中の行は toast と同時に消える（#672 の直し）。ただ、起動の後半は裏で 8.1 秒まで続く。この間の読込は、どれも同じ失敗を2秒待って繰り返している。
- 止まったまま答えない時（S4）は、読込の失敗の toast まで12.1秒かかる。その後の #loading は、45秒の上限でもまだ残っていた。
  - 見積もり（S4 の並びから・上限の後は未実測）：残りはシードの ref の読み（syncBatch は上限を渡さないので fetchJSON の既定の10秒・js/storage-adapter.js L143）と列挙（5＋2＋5秒）。#loading が消えるのは約63秒、toast からは約51秒。672-results の見積もり（最大約36秒）より長い。ref の読み2回（再試行なし・5秒と10秒）を数えていなかったため。

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
- ref の読み2回（`_ensureRemoteShaMap` と syncBatch）は `_getContent` を通らないので、再試行しない。すぐ失敗する時は数 ms で済む。止まったままの時は、`_ensureRemoteShaMap` は5秒（S4 の 12089→17089）、syncBatch の ref は fetchJSON の既定の10秒まで待つ（コードから・未実測）。
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

## §2 案の比較（2026-11-14 19:49〜20:00・直していない・probe は流していない）

### 前提（step1 の実測とコードから）

- 起動の読込が通信で失敗した後も、起動の後半（finishStartup の公開記事の移行・プラグイン）は流れる。そして全部失敗する。
  - 有効になるプラグインは0個（実測）。シードの書き込みは試みて失敗し、移行も失敗する。
  - かかる時間は、すぐ失敗する時で toast の後 6.0 秒（実測）、止まったままなら約51秒（見積もり）。端末にデータが無い起動では、この間ずっと #loading の覆いで画面を触れない。
- 通信が戻っても、起動の後半は流し直されない（実測：0個のまま）。開き直すまで、標準機能（dark-theme など）は効かないまま。
- 読み直しの入口は2つ。どちらも initSync 側だけを流す。
  - 'online'・タブに戻った時の `_retryInitLoad`（js/bookshelf.js L5359-5368）
  - GitHub の toast の「再試行」（L3437 `onClick: () => this.initGitHubSync()`）
  - ハブの状態バーの「再試行」（`retry-sync`・L5290/L5374）は、保存の再試行で別物。
- 印 `_initLoadFailed` を立てるのは、認証切れ以外の失敗の catch の2か所（ハブ L3299・GitHub L3441）。5xx でも立つ。
- `window.bookshelfAPI` は起動の初め（L249）に作る。設定からプラグインを入れる installFromGitHub（js/plugin-loader.js L270-）は、書いた後に `_loadPlugin`→`_activatePlugin`（L195-198）でその場で有効にする。起動の後半には頼らない。
- 二重の activate を防ぐ守りは無い。`_activatePlugin`（L201-）にも loadEnabledPlugins（L80-125）にも、`this.loaded.has(id)` で飛ばす所が無い。`grep -n 'loaded.has' js/plugin-loader.js` は uninstall の L353 の1件だけ。

### 案

- **(i) 飛ばす**：finishStartup で initSync が返った後、`_initLoadFailed` が立っていたら、移行とプラグインを流さずに返す。
- **(ii) 再試行しない**：印が立っている間は、`GitHubAdapter._getContent`（js/github-adapter.js L540-556）の withRetry を retries:0 にする（adapter に口を足し、印と一緒に上げ下げする）。
- **(iii) 起動の後半は、読込が通った後に1回だけ流す**＝(i)＋「飛ばした起動の後半を、後で読込が通った時に1回だけ流す」。
  - 入口は読込の成功の側に置く（`_initGitHubSyncLoad`・`_initCloudSyncLoad` の成功の終わり）。こうすると、'online' の `_retryInitLoad` と toast の「再試行」（`initGitHubSync` を直接呼ぶ）の両方を拾える。
  - 「飛ばした」印（例 `_startupTailPending`）が立っている時だけ流す。起動で成功した時は印が立たないので、2回は流れない。
  - loadEnabledPlugins に「`loaded` にある id は activate しない」守りを足す。失敗の間に設定から入れたプラグインを、後の読み直しで2回 activate しないため。
- **(iv) 参考：回路遮断**：GitHubAdapter が、通信で落ちた後の一定時間はすぐ失敗にする。書き込みの409の回復の読込（`_getContent` の L640/674）、toast の「再試行」、設定のプラグイン一覧の読み込みにも効く。窓の長さを決める必要があり、範囲が広すぎる。

### 比較表

「見込み」はコードから読んだ値で、未実測。

| 比べる点 | 今（実測） | (i) 飛ばす | (ii) 再試行しない | (iii) (i)＋読込が通った時に1回流す | (iv) 回路遮断 |
|---|---|---|---|---|---|
| toast → #loading が消えるまで（すぐ失敗・データ無し） | **6.03〜6.04 秒** | ≈0 秒（見込み：initSync が返った直後に hideLoading） | ≈0.01 秒（見込み：5本が1回ずつすぐ失敗） | (i) と同じ | ≈0 秒 |
| 同（止まったまま） | **45秒の上限でも残った**（見積もり約51秒） | ≈0 秒（見込み） | **約30秒**（見込み：ref 5秒・移行 5秒・列挙 5秒・シードの ref 10秒・列挙 5秒。ref の2本はもともと再試行しない） | (i) と同じ | ≈0 秒（窓の中なら） |
| 読込そのもの（toast まで） | 2.1 秒／止まったまま 12.1 秒 | 変わらない | 変わらない（印は読込の後に立つ） | 変わらない | 前の失敗から窓の中なら、読込もすぐ失敗する |
| 失敗の起動で有効になるプラグイン | **0個** | 0個 | 0個 | 0個 | 0個 |
| シードの書き込みを試みるか | **試みて失敗する** | 試みない | 試みる（すぐ失敗） | 起動では試みない。読込が通った後に1回試みる | 試みる（すぐ失敗） |
| 公開記事の移行 | 試みて失敗する | 試みない | 試みる（すぐ失敗） | 読込が通った後に1回 | 試みる（すぐ失敗） |
| 通信が戻った時にプラグインが読み直されるか | **されない**（0個のまま） | されない（今と同じ） | されない（今と同じ） | **される**（見込み：ハブなら5個） | されない |
| 失敗の後に設定から入れたプラグイン | その場で有効（コード・未実測） | 同じ | 同じ | 同じ。後の読み直しでは、loaded の守りで2回 activate しない | 同じ |
| ハブにも効くか | — | 効く（印はハブでも立つ・L3299。時間の差は0.03秒以下） | 効かない（ハブに再試行は無い） | 効く | 効かない（ハブの adapter は別） |
| 既存 spec への影響 | — | 小さい（下） | 小さい | 中（下。戻った後に要求が増える） | 大きい（github-sync-resilience の「再試行で回復」・409 の回復の spec） |
| ADR・設計書 | — | ADR 1件（失敗の起動では後半を流さない）・05 L19・boot-flow.md | ADR・03（adapter の口） | ADR 1件（プラグインが起動の後で有効になりうる・ADR-057/059 の補足）・05 L19・03（新しいメソッド）・boot-flow.md | ADR・03 |
| #666 と同じ箇所を触るか | — | 触らない（finishStartup の中だけ。#666 は L3299/L3425-3441 の catch の文） | 触らない（adapter） | 同じ関数の別の行（成功の側の終わり）。載せ直しで衝突を見る | 触らない |
| ADR-041/042 | — | コアの起動の順番だけ。差し込み口・plugin API は変えない | 同じ | 同じ。activate の時機が「起動の後」になりうるが、ADR-057（2段化）で、手元にデータがある起動はもともと画面を出した後に activate している | 同じ |

### 既存 spec への影響（`git grep` で取り直した）

- 通信を切る・401/5xx を返す所があり、`waitForHubStartupForTest` も使う spec は7本（grep の条件は「起動の時」に限らない）：boot-load-checking-row・boot-load-failure-status・load-conflict-unsaved・online-resync・status-bar-over-faces・sync-conflict-overwrite・sync-section-status。gate/j8-4-online-resync は gate-network.js で切る作り。
  - 手元にデータがある起動では、#672 の直しで、待ちはもう失敗の直後に返っている。(i)・(iii) で変わるのは、裏で流れていた起動の後半の要求（すぐ失敗するもの）が無くなることだけ。
  - データが無い起動で失敗させる spec では、待ちが約6秒短くなる。
- 起動の後半の結果（「列挙失敗」「シードの書き込み」「移行に失敗」）を見る spec は plugin-seed.spec.js と boot-confirm-dialog.spec.js だけ。どちらも成功の起動なので、(i)・(iii) では変わらない見込み。
- github-sync-resilience.spec.js は2本。
  - 「15秒遅延の後に 500」：手元のデータの本棚を見るだけ。
  - 「503 の後、toast の再試行で回復」：(iii) では、再試行が通った後に起動の後半が1回流れる。GitHub の模擬は列挙が空なので（step1）、シードの書き込みの commit が1回増える。再試行の後に repo の中身を見ているかを step4 で流して確かめる。
- (iii) で戻った後に要求が増えるもの：online-resync（GitHub）の「電波が戻ると書いた短文メモが届く」。シードの書き込み（blobs 15本＋tree・commit・ref）が、保存待ちの送り直しと serialWrite（ADR-169）で1本ずつ並ぶ。メモが届く時刻が少し遅れうるので、step4 で3回流す。

### 推奨：(iii)「起動の後半は、読込が通った後に1回だけ流す」

1. 6秒（止まったままなら約51秒）の待ちを、すぐ失敗する時も止まったままの時も、両方ほぼ0にする。ハブにも同じ決まりで効く。(ii) は止まったままの時に約30秒残り、ハブには効かない。
2. 「失敗と分かった後に、失敗する読込を続けない」と「通ったら1回流す」を1つの決まりにできる。個別の読込ごとに再試行を外す（(ii)・(iv)）より範囲が狭く、adapter に起動の状態を持ち込まない。
3. 今ある欠け（通信が戻っても、開き直すまでプラグインが0個のまま＝dark-theme などが効かない）を、同じ直しで埋める。ADR-059「欠けたら起動時に復元」も、読込が通った時に果たせる。
4. 新しい挙動は「activate が、戻った時（起動より後）になりうる」こと。ADR-057 の2段化で、手元にデータがある起動では、もともと画面を出した後に activate している。だから新しい種類の時機ではない。二重の activate は loaded の守りで防ぐ（上の出典）。
- **②が (iii) を重いとみるなら (i) だけにする**。その場合、戻った時の読み直しは 07_残検討事項 に起票する。(i) だけでも時間の直しは (iii) と同じになる。

### 赤を取る E2E の形（step3・新しい spec `tests/e2e/boot-load-failure-tail.spec.js`）

作りは boot-load-checking-row.spec.js と同じ（模擬より手前の `context.route`・bookshelf._* は読まない）。

| # | 場面 | 基準 | 直す前 | 直した後の見込み |
|---|---|---|---|---|
| 1 | GitHub・通信の失敗・**データ無し** | toast が出てから **2秒**のうちに #loading が消える | 6.03〜6.04 秒＝**赤** | ≈0 秒＝緑 |
| 2 | ハブ・通信の失敗・データ無し（守り） | 失敗の行が出てから2秒のうちに #loading が消える | 0.03 秒＝緑 | 緑 |
| 3 | 成功の起動の守り（ハブ・データ無し） | #loading が消えた時に、標準機能5個が有効で本棚が出る | 緑 | 緑 |
| 4 | (iii) の挙動（ハブ・データあり） | 通信の失敗で開き直した後に通信を戻して 'online' を送ると、**5秒**のうちに標準機能5個が有効になる | 0個のまま＝**赤** | 5個＝緑 |

- 基準の2秒は #672 と同じ（`LEAVE_MS`）。直す前の6秒と直した後の見込み（≈0秒）の間に、両側とも十分な幅がある。
- データありの GitHub の確認中の行は、boot-load-checking-row.spec.js（#672）がもう見ているので足さない。
- プラグインの数は**ハブの模擬で見る**。GitHub の模擬はフォルダの一覧を返さない（gate-github.js L114）ので、成功でも0個になる。
- 「有効」の見方は step3 で決める。候補は、標準機能が足す画面の印か、`bookshelfAPI` 側の見える一覧。lint:internal-refs に掛からない読み方にする。
- (i) だけにする場合は #4 を外す。

### 実装で触るファイル（(iii) の場合）

- js/bookshelf.js
  - finishStartup の後半を1つのメソッド（例 `_runStartupTail()`）に出す。
  - initSync の後に `_initLoadFailed` なら、印（`_startupTailPending`）を立てて返す。
  - `_initGitHubSyncLoad`・`_initCloudSyncLoad` の成功の終わりで、印が立っていれば1回流す（await しない・`_setLoadingSub` は出さない）。
- js/plugin-loader.js：loadEnabledPlugins で、`this.loaded` にある id を activate しない。
- index.html：bookshelf.js・plugin-loader.js の `?v=`。
- tests/e2e/boot-load-failure-tail.spec.js（新規）。
- docs/char/boot-flow.md：§1-3 の表・§1-4 の時系列。
- 設計書（obsidian 80帯）
  - 05_プラグイン仕様書 L19 に「起動の読込が通信で失敗した時は読み込まず、読込が通った時に1回読む」。
  - 03_詳細設計書：新しいメソッド。
  - 08_意思決定記録：新しい ADR（ADR-057・ADR-059 の補足）。

## §3 直す前に赤になる E2E（2026-11-14 19:55〜19:58・案 (iii)・直していない）

- 新しい spec：`tests/e2e/boot-load-failure-tail.spec.js`（7本・幅390・chromium）。作りは boot-load-checking-row.spec.js（#672）と同じで、模擬より手前の `context.route` で落とす。bookshelf._* は読まない。プラグインの数は plugin-seed.spec.js と同じく `bookshelf.pluginLoader.loaded` を読む。
- 流し方：`PORT=8177 npx playwright test tests/e2e/boot-load-failure-tail.spec.js --project=chromium --repeat-each=3 --workers=4 --global-timeout=300000`（33eda9e＋docs・js は main のまま）。

| 行 | 何を見るか | 基準 | 直す前（3回） |
|---|---|---|---|
| L66 | GitHub・通信の失敗・**データ無し** | toast が出てから2秒のうちに #loading が消える | **✘✘✘ 赤**（2秒の時点で覆いが visible のまま） |
| L73 | ハブ・通信の失敗・データ無し（守り） | 失敗の行が出てから2秒のうちに #loading が消える | ✓✓✓ |
| L80 | GitHub・通信の失敗・データあり（守り） | toast が出てから2秒のうちに確認中の行が消える | ✓✓✓（#672 の直しで緑） |
| L93 | ハブ・成功・データ無し（成功の起動の守り） | #loading が消えた時に、標準機能5個が有効。同期欄が「保存済み」 | ✓✓✓ |
| L102 | ハブ・成功（②の指示 2 の守り） | プラグインの一覧の要求（`GET /data/plugins`）が2本だけ（ensureStandardPlugins と loadEnabledPlugins の1回ずつ。2回流れると4本） | ✓✓✓ |
| L113 | GitHub・成功（同上） | `contents/plugins` の要求が2本だけ | ✓✓✓ |
| L125 | ハブ・通信の失敗で開き直した後に通信を戻す（案 (iii) の挙動） | 'online' の後、5秒のうちに標準機能5個が有効 | **✘✘✘ 赤**（5秒の時点で `[]`） |

- 結果：6 failed（L66・L125 ×3）／15 passed（20.8秒）。赤になるべき2本が3回とも赤で、守りの5本が3回とも緑。
- `npm run lint`：12本中0本失敗（lint:internal-refs・lint:e2e-wait を含む）。
- 計画からの変更
  - 成功の起動の守り（L93）は、計画の「GitHub・成功」ではなくハブで見る。GitHub の模擬はフォルダの一覧を返さず、成功でも0個になるため（§1・step2 で②に伝えた）。
  - ②の指示 2 の守り（L102・L113）は、ハブと GitHub の両方で要求の本数を数える。GitHub の一覧は模擬では空だが、本数は数えられる。
- 1回目の流しでは、L125 が3回とも緑になった（0.4〜0.5秒）。原因は直しではなく競り合い。
  - ハブでは、失敗した起動の後半が失敗の行から約50msで終わる（§1）。その途中で通信を戻したので、後半の残りの列挙が通ってしまい、直す前でも5個が有効になった。
  - そこで「ハブへの要求が800ms静まるまで待ってから通信を戻す」（`expect.poll`）を足した。2回目の流しで上の表のとおり赤になった。
  - 同じ待ちは、直した後（後半を飛ばすので要求がすぐ静まる）でもそのまま通る見込み。
- step4 で直した後に同じ spec を3回流し、L66・L125 が緑、守りの5本が緑のままかを見る。

## §4 案 (iii) の実装と前後比較（2026-11-14 19:58〜20:07）

### 直したこと（fix 89fe888）

- js/bookshelf.js
  - finishStartup の後半（公開記事の移行・標準機能のシード・プラグインの読み込み）を `_runStartupTail()` に出した。
  - `initSync()` の後に `_initLoadFailed` が立っていたら、印 `_startupTailPending` を立てて返す（後半を流さない）。
  - 読込の成功の終わり（`_initCloudSyncLoad`・`_initGitHubSyncLoad` の `updateSyncStatus('synced')` の直後）に `_runStartupTailIfPending()` を置いた。印がある時だけ、印を下ろしてから後半を1回流す（await しない）。
- js/plugin-loader.js
  - `listInstalledPlugins` が、一覧が読めたかを `lastListFailed` に残す。
  - `loadEnabledPlugins` は `this.loaded` にある id を activate しない。依存の判定は今までどおり、有効なもの全部で見る。
- index.html：bookshelf.js・plugin-loader.js の `?v=` を 2026111880 にした（`check:version --range=origin/main..HEAD` は OK）。
- docs/char/boot-flow.md §1-3：データ無しの行と、起動の後半の決まりの段落を足した（docs commit）。

### ②の指示の守り方

1. 流す口は読込の成功の終わりの2か所で、印がある時だけ流し、流す前に印を下ろす。普通に成功した起動では印が立たないので、後半は finishStartup の中の1回だけ。spec の L102・L113 で、一覧の要求が2本のまま（3回とも）。
2. 成功の起動で一覧の要求が2本だけの守り：spec の L102（ハブ）・L113（GitHub）。
3. `loadEnabledPlugins` の `loaded.has(p.id)` で飛ばす（js/plugin-loader.js）。
4. 後から流した後半で一覧が読めなかった時（`lastListFailed`）は、`_runStartupTail` の終わりで印を立て直す。次に読込が通った時に、もう1回だけ流す。後半から読込や後半を呼ぶ所は無いので、自分では繰り返さない。
   - 印を消費するのは読込の成功（電波が戻った時の読み直し・toast の「再試行」）だけ。読込は通ったのに後半の一覧だけ読めなかった時は、`_initLoadFailed` が立たないので 'online' の読み直しは起きない。印は、次に読込が通るまで残る。
5. **公開記事の移行も、プラグインと同じく後から流す**。移行は冪等・非破壊（articles.json に記事があれば何もしない・ADR-058 §11）なので、起動の後半として1つのメソッドにまとめた。失敗した起動で飛ばしても、読込が通った時に1回流れる。

### 前後比較（probe は step1 と同じ tmp/677/probe-677.spec.mjs・各2回。直す前は tmp/677/runs-before/、直した後は tmp/677/runs/）

| 場面 | 直す前 | 直した後 |
|---|---|---|
| GitHub・通信の失敗・**データ無し**：toast → #loading が消えるまで | **6.04 秒・6.03 秒**（toast 2093/2095 → 8131/8122） | **0.001 秒・0.001 秒**（2086→2087・2083→2084） |
| GitHub・**止まったまま**・データ無し：toast → #loading が消えるまで | **45秒の上限でも消えず**（toast 12088/12071・見積もり約51秒） | **0.002 秒・0.002 秒**（12079→12081・12078→12080） |
| GitHub・通信の失敗・データあり：toast → 確認中の行が消えるまで | 0.00 秒（#672） | 0.00〜0.001 秒 |
| 同上：toast の後に起動の後半が出す要求 | 移行2本・列挙4本・ref 2本（8.1秒まで） | **0本**（最後の要求が toast と同時） |
| 同上：失敗の後の console の警告（移行・列挙・シード） | 4件 | 0件 |
| ハブ・通信の失敗・データ無し：失敗の行 → #loading | 0.03 秒・0.03 秒 | 0.002 秒・0.002 秒 |
| GitHub・成功・データ無し：#loading が消えた時刻 | 382・201 ms | 146・175 ms |
| GitHub・成功・データあり：確認中の行 | 72→184・83→204 ms | 83→164・69→173 ms |
| ハブ：最初の起動で有効なプラグイン | 5個 | 5個 |
| ハブ：通信の失敗で開き直した時 | 0個（シードの書き込みを試みて失敗） | 0個（シードの書き込みを試みない・警告0件） |
| ハブ：その後に通信を戻して 'online' | **0個のまま**（列挙の要求0本） | **5個**（列挙の要求2本＝1回ずつ・シードの書き込み0本＝もうあるため） |
| GitHub：通信を戻した後の要求 | 列挙0本 | 列挙2本＋シードの書き込み（POST・PATCH 18本。GitHub の模擬は一覧を返さないので毎回シードする・§1） |

### spec・lint・単体

- 新しい spec（7本）を直した後に3回：**21 passed**（14.2秒）。L66・L125 も緑になり、守りの5本も緑のまま。
- 関係する spec（17ファイル）：**84 passed・1 failed**（1.6分・`tmp/677/step4-related.txt`）。対象は boot-*・first-run-*・plugin-*・online-resync・github-sync-resilience・load-conflict-unsaved・status-bar-over-faces・sync-conflict-overwrite・sync-section-status・gate/j8-4・gate/j6-5。
  - online-resync（GitHub の「電波が戻ると書いた短文メモが届く」を含む）と github-sync-resilience（「503 → toast の再試行で回復」）は緑だった。シードの書き込みが1回増えても、待ちの基準は緩めていない。
  - 落ちた1本は sync-conflict-overwrite.spec.js L76 のハブの上書き（「private/notes.json に「#645 端末Bが古い版のまま書いた短文メモ」が 20000ms 以内に届かなかった」）。この1本だけを3回ずつ流して比べた。
    - 直した版：ハブ ✘✘✘・GitHub ✓✓✓（`tmp/677/step4-sco.txt`）。
    - 直す前のファイルに一時的に戻した版（446afe8 の js・index.html）：ハブ ✘✘✘・GitHub ✓✓✓。同じ文で落ちた（`tmp/677/step4-sco-base.txt`）。
    - → 直しのせいではない。#672 でも、直しが無い main で3回中2回落ちていた（672-results.md の載せ直しの表）。この件では触らない。
- `npm run lint`：12本中0本失敗。`npm test`：Test Files 80 passed・Tests 1197 passed（2 todo）。

### 設計書の文案（step5 で書く）

- **05_プラグイン仕様書 L19**（読み込み）に足す：「保存先の読込が通った後に1回だけ読み込む。起動の読込が通信で失敗した時は読み込まず、後で読込が通った時（電波が戻った時・「再試行」）に1回読み込む＝activate が起動より後になりうる。既に有効なプラグインは2回 activate しない。」
- **03_詳細設計書**
  - VirtualBookshelf の主要メソッドに `_runStartupTail()`（起動の後半）と `_runStartupTailIfPending()`（読込の成功の後に、飛ばした後半を1回流す）を足す。
  - BookshelfPluginLoader に `lastListFailed` と「loadEnabledPlugins は loaded の id を飛ばす」を足す。
- **08_意思決定記録**（番号は step5 で最新の 08 を見て決める）
  - 見出し：「起動の後半（公開記事の移行・プラグインの読み込み）は、起動の読込が通った後に1回だけ流す (2026-11-14・イシュー#677・②承認)」
  - 背景：起動の読込が通信で失敗した後も後半が流れ、GitHub の読み込みの再試行（2秒）で同じ失敗を3回待っていた。端末にデータが無い起動では、toast の後 6.0 秒（止まったままなら約51秒）#loading が残った。後半は全部失敗し、プラグインは0個のまま。通信が戻っても、開き直すまで0個だった。
  - 決定：失敗した起動では後半を流さない（印 `_startupTailPending`）。読込の成功の終わりで、印がある時だけ1回流す。一覧が読めなかった時は印を立て直し、次に読込が通った時にもう1回だけ流す。loadEnabledPlugins は loaded の id を飛ばす。公開記事の移行も後半に含める（冪等・非破壊）。
  - 却下した案：
    - 再試行しない：止まったままの時に約30秒残り、ハブには効かない。
    - 回路遮断：範囲が広い。
    - 飛ばすだけ：通信が戻っても0個のまま。
  - 補足：ADR-057（2段化）で、手元にデータがある起動は画面を出した後に activate している。activate が起動より後になるのは、新しい種類の時機ではない。ADR-059 の「欠けたら起動時に復元」は、読込が通った時に果たす。

## §5 最新の main への載せ直し・全件比較・設計書（2026-11-14 20:07〜）

### 載せ直し（2回）

- **1回目（20:07・origin/main 95d6f9d）**：#666（起動の読込の失敗の文と「再試行」・GitHub の toast をやめた）・#675・#673 の docs が入っていた。衝突は2か所。
  - index.html：sync-failure.js は main の値（2026111886）を残した。bookshelf.js の `?v=` は main（2026111890）より新しい **2026111892** にした。
  - js/bookshelf.js：#666 の `_clearInitLoadFailed()` と新しい `_retryInitLoad()` をそのまま残し、その前に `_runStartupTail()`・`_runStartupTailIfPending()` を入れた（`tmp/677/resolve.mjs`）。
  - #666 で GitHub の toast が無くなったので、コメントの「toast の「再試行」」を「状態バーと同期欄の「再試行」」に直した（fix の commit に含めた）。
  - **#666 に合わせた spec の直し**（test 37cae7a）：新しい spec は、ハブ・GitHub とも状態バーの読込の失敗の行 `#app-status-bar [data-load-failure]` で待つ形にした。#666 が boot-load-checking-row.spec.js に入れた待ち方と同じ。基準（失敗の行が出てから2秒・戻った後5秒）は変えていない。
  - この時点の確認（95d6f9d の上）：
    - 新しい spec を3回：21 passed。
    - #666 が触った関係 spec 7ファイル（boot-load-checking-row・boot-load-failure-status・boot-load-failure-message・online-resync・github-sync-resilience・plugin-seed・gate/j8-4）：32 passed。
    - `npm run lint` 12本中0本失敗・`npm test` 1199 passed。
  - online-resync.spec.js・boot-load-failure-status.spec.js は、この件では書き換えていないので衝突は無い（②の申し送りの確認）。
- **2回目（20:12・origin/main fb3f3b9）**：1回目の後に #679 が入った。#679 は、ハブの一覧の控え（ETag の表）を読み直しのたびに取り直す直しで、§4 の sync-conflict-overwrite L76 のハブの上書きの赤の原因を直している。
  - 全件比較を1回目の base（95d6f9d）の上で流し始めたら、比較の base が fb3f3b9 になった。work だけ #679 が無いと比べ方がずれるので、比較を止めて載せ直した（衝突なし）。
  - `?v=`：bookshelf.js 2026111892（main の最大 2026111891 より新しい）・plugin-loader.js 2026111880（main は 2026110300）。`check:version --range=origin/main..HEAD` は OK。
  - `npm run lint` 12本中0本失敗・`npm test` Tests 1201 passed（2 todo）。
- 載せ直した後の commit（古い順）：253d802（§1）・f828444（§2）・de40638（test）・1cf6e4d（§3）・f6889f2（fix）・4179d77（§4・boot-flow.md）・37cae7a（test・#666 に合わせた待ち方）。

### 設計書（obsidian 80帯・vault commit d1464a21・20:12）

- 05_プラグイン仕様書：読み込みの時機の行を足した（保存先の読込が通った後に1回だけ。失敗した起動では読み込まず、後で読込が通った時に1回。既に有効なものは2回 activate しない・ADR-176）。
- 03_詳細設計書：VirtualBookshelf の主要メソッドに `_runStartupTail()` / `_runStartupTailIfPending()` の行を足した。BookshelfPluginLoader の要点に `lastListFailed` と `loaded` を飛ばすことを足した。
- 08_意思決定記録：**ADR-176** を足した（背景・決定・理由・却下した案・確かめ方）。番号は、20:10 の時点で最後だった ADR-175（#675）の次。08 は CRLF のまま書いた。
- 書き方は #671 と同じで、3ファイルだけを add して commit した（他の staged が無いことを確かめた）。push の後に bookshelf 側の sha が決まるので、vault の commit の題には sha を書かず、イシュー番号で対応させた。

### 全件比較（e2e-diff-main）と代替判定

- `node scripts/verify/e2e-diff-main.mjs --port=8177 --workers=4 --out=tmp/677/e2e-diff` を 20:12 に始めた（8177 は空き・load 1.2）。
  - **base（origin/main fb3f3b9）の E2E は終わった**：expected 1199・unexpected 0・flaky 0・skipped 592（435秒・`tmp/677/e2e-diff/base.e2e.json`）。
  - **work 側（fb3f3b9＋この件の7本）の E2E は 20:23 に始まったところで、このステップの待ちの上限（20:32 の5分前）までに終わらない**。20:24 に止めた。仮の worktree は残っていない（`git worktree list` で0件）。
  - 1回目（95d6f9d の上・20:10）の比較は、base が先に進んだ fb3f3b9 になったので、20:11 に止めた（上の「載せ直し」）。
- **代替判定**（detail の「その時点の表と、新しい spec・関係する spec の結果で判定」）
  - base は1199本すべて緑で、落ちるものは無い。
  - 載せ直した後の tree（fb3f3b9＋この件）で、新しい spec と関係する spec 9ファイルを流した：**43 passed・0 failed**（52秒・`tmp/677/step5-final.txt`）。
    - 対象は boot-load-failure-tail・boot-load-checking-row・boot-load-failure-status・boot-load-failure-message・online-resync・github-sync-resilience・plugin-seed・gate/j8-4-online-resync・sync-conflict-overwrite。
    - §4 で赤だった sync-conflict-overwrite L76 のハブの上書きは、#679 の直しが入った後は緑だった。
  - step4（95d6f9d の前）の関係 spec 17ファイルは、84 passed・1 failed（上の1本・#679 で直った）だった。
  - **全件の work 側は流せていない**。新しく落ちたものが0件かは、全件では確かめていない。step6 の push の前に、work 側だけの全件（`npm run test:e2e` か e2e-diff の再実行）を流すか、CI の test (e2e) で見るかを②に決めてほしい。
