# #672 起動の読込が失敗した後、状態バーの「最新のデータを確認しています…」がいつ消えるか — 記録

## step1 実測・原因・直し方の案（2026-11-14 18:53〜19:05・コードは変えていない）

### 土台と流し方

- 18:53 に `git fetch` し、worktree を d18af26 から 47505b2（origin/main）へ `git merge --ff-only` で早送りした。行番号は 47505b2 のもの（計画時の d18af26 から js/bookshelf.js の `_updateStatusBar` の行だけ2行ずれた）。
- probe：`tmp/672/probe-672.spec.mjs`、config は `tmp/672/probe.config.mjs`（tmp/ は commit しない）。流し方は `PORT=8172 npx playwright test --config tmp/672/probe.config.mjs --workers=4 --global-timeout=300000`。chromium だけ、幅390。2回流し、2回とも 7 passed（42.6s・42.7s）。元の記録は `tmp/672/runs/<場面>-0.json`。1回目の json は2回目で上書きされたので、1回目の時刻は上書きの前に読んだ値。出力は1回目が `tmp/672/run1.txt`、2回目が `tmp/672/run2-raw.txt`。
- 作り方は tests/e2e/boot-load-failure-status.spec.js（#653）と同じ。1回ふつうに起動してから、模擬より手前の `context.route` で切って `page.reload()` する。
  - 通信の失敗は `route.abort('internetdisconnected')`。
  - GitHub の401は `route.fulfill({ status: 401 })`。
  - ハブの401は `hub.deleted = true`（模擬が401を返す）。
- 時刻はすべて reload を起点にした ms。画面の変化は、addInitScript で入れた MutationObserver で取った（`#app-status-bar` の行・toast・`#obsidian-sync-status`。bookshelf._* は読まない）。要求の時刻は、Node 側の `page.on('request'/'requestfinished'/'requestfailed')` の時計で取った。そのため、画面の時刻と数 ms ずれることがある。
- 観測の上限は30秒。30秒まで残った場面は無かったので、計画にあった「30秒で通信を戻して 'online' を送る」きっかけは、どの場面でも使っていない。

### 実測の表（4場面＋参考）

「失敗の表示」は、ハブでは状態バーの失敗の行、GitHub では toast。参考の「成功」の行は、同期欄が「保存済み」になった時刻を代わりに入れた。

| 場面 | 回 | 確認中の行が出た | 失敗の表示（成功は「保存済み」） | 確認中の行が消えた | 失敗の表示から消えるまで |
|---|---|---|---|---|---|
| ハブ・通信の失敗 | 1 | 560 | 630 | 1051 | **0.42 秒** |
| ハブ・通信の失敗 | 2 | 282 | 316 | 447 | **0.13 秒** |
| ハブ・401 | 1 | 436 | 489 | 751 | **0.26 秒** |
| ハブ・401 | 2 | 719 | 747 | 1168 | **0.42 秒** |
| GitHub・通信の失敗 | 1 | 731 | 2803 | 9029 | **6.23 秒** |
| GitHub・通信の失敗 | 2 | 377 | 2403 | 8491 | **6.09 秒** |
| GitHub・401 | 1 | 178 | 200 | 311 | **0.11 秒** |
| GitHub・401 | 2 | 709 | 839 | 1065 | **0.23 秒** |
| 参考：ハブ・成功 | 1 | 481 | 825 | 1938 | 1.11 秒 |
| 参考：ハブ・成功 | 2 | 413 | 542 | 1074 | 0.53 秒 |
| 参考：GitHub・成功 | 1 | 296 | 418 | 1159 | 0.74 秒 |
| 参考：GitHub・成功 | 2 | 412 | 640 | 1276 | 0.64 秒 |
| 参考：GitHub・通信の失敗で、toast の「再試行」を押す（通信を戻してから） | 1 | 231 | 2278（押したのは 2724・保存済みは 2975） | 4660 | 2.38 秒（押してから 1.94 秒） |
| 同上 | 2 | 396 | 2489（押したのは 2873・保存済みは 3140） | 4643 | 2.15 秒（押してから 1.77 秒） |

- 2回の差はどの場面も1秒未満だったので、3回目は流していない。
- 消えなかった場面は無い。どの場面でも、行は起動の後半（finishStartup）が終わった時に消えた。消えるきっかけは、それ以外に無い（下の「原因」）。
- **残る場面は「GitHub・通信の失敗」の1つ**。toast が出た後、約6秒残る。ほかの3場面は、失敗の表示から0.11〜0.42秒で消えた。成功の起動でも、「保存済み」から0.53〜1.11秒は行が残る。ここはプラグインの読み込みの間で、今の作りのまま。
- toast の「再試行」は、行を直接は下ろさない。通信を戻してから押すと、残りの読み込みが通って finishStartup が早く終わるので、行も早く消える（押してから1.8〜1.9秒）。

### 原因（GitHub・通信の失敗）

- **出す所**：js/bookshelf.js L5353-5354。`_updateStatusBar` の中で、`this._syncChecking` が立っている間だけ行を足す。
- **立てる所・下ろす所**：L490-493。端末にデータがある起動で、ハブか GitHub の時に立てる。下ろすのは `finishStartup().finally()` の1か所だけ。`git grep -n _syncChecking -- js` は3件（491・493・5353）で、ほかに下ろす所は無い。
- **finishStartup の中で待っているもの**（1回目の記録。要求はすべて api.github.com で、`net::ERR_INTERNET_DISCONNECTED`）。2回目の json でも並びは同じだった：console の時刻は、initGitHubSync の失敗 2.41 → 公開記事の移行の失敗 4.44 → 列挙の失敗 6.44 → シードの失敗 6.47 → 列挙の失敗 8.50 秒、行が消えたのは 8.49 秒。

| 時刻 | 起きたこと |
|---|---|
| 0.73 秒 | 確認中の行が出る。0.79・0.81 秒に読込の要求が失敗し、2秒待って再試行する |
| 2.80 秒 | 再試行も失敗する。toast と、同期欄の失敗の文が出る（initSync L435 が返る） |
| 2.85 → 4.88 秒 | 公開記事の移行（L446-455）が `private/publish/articles.json` を読む。失敗して2秒待ち、再試行も失敗する（console「公開記事モデルへの移行に失敗」） |
| 4.90 → 6.92 秒 | プラグイン（L457-475）の ensureStandardPlugins が `contents/plugins` を読む。失敗して2秒待ち、再試行も失敗する（「plugins ディレクトリ列挙失敗」）。手元の plugins-sample に切り替え、7.02 秒に標準機能を書き込もうとして失敗する（「標準機能シードの書き込みに失敗」） |
| 7.02 → 9.03 秒 | loadEnabledPlugins がもう一度 `contents/plugins` を読む。失敗して2秒待ち、再試行も失敗する |
| 9.03 秒 | finishStartup が終わり、`finally` で行が消える |

- 2秒待つのは、GitHub の読み込みの共通の口 `GitHubAdapter._getContent`（js/github-adapter.js L540-556）にある再試行のせい。`StorageAdapter.withRetry({ retries: 1, delayMs: 2000 })` で、1回の試行の上限は5秒。読込が通信で失敗したと分かった後も、後ろの3つの読み込み（公開記事の移行・プラグインの列挙2回）が、それぞれ同じ失敗を2秒待って繰り返す。足して約6秒になる。
- ハブの読み込み（js/hub-adapter.js）には、この再試行が無い。なので、同じ順番で進んでも0.1〜0.4秒で終わる。401 は応答が返る（例外にならない）ので再試行しない。GitHub・401 が速いのはこのため。
- **アプリの作りのせいで、テスト環境だけの事情ではない**。待ちの間に、終わっていない要求は無かった。模擬が答えない要求を待ったのではなく、全部が「すぐ失敗 → 2秒待つ → 再試行」の繰り返しだった。切ったのは模擬より手前の本物の api.github.com の宛先なので、本物の電波なしでも同じになる。
- 見積もり（コードから・未実測）：電波なしで要求がすぐ失敗せず、止まったままになる時は、1回の試行が5秒まで待つ。そうなると、1つの読み込みが最大12秒（5＋2＋5）、後ろの3つで最大約36秒、行が残りうる。

### 同じ種類の洗い出し（状態バー・同期欄の「進行中」の表示）

| 表示 | 出す所 | 失敗した時に下ろす所 | 見立て |
|---|---|---|---|
| 状態バーの確認中の行 | L491（端末にデータがある起動・ハブ/GitHub） | L493 の `finishStartup().finally` だけ。initSync・公開記事の移行・プラグインが全部終わった後 | **GitHub・通信の失敗で約6秒残る（実測）** |
| 状態バーの保存の失敗の行の 'retrying'（L5341 で確認中と同じ見た目） | `_onSyncFailed`（L5212。保存の自動の再試行の途中） | 再試行が尽きると phase が変わり、ふつうの失敗の行（status-warn）になる。保存できれば消える | 失敗そのものを見て下ろしている。保存の経路なので、この件の対象外 |
| #loading の覆いと `_setLoadingSub`（端末にデータが無い起動） | L496 `await finishStartup()` の後で hideLoading | 確認中の行と同じく、finishStartup が全部終わった後 | **同じ作り**。GitHub・通信の失敗では、覆いも同じだけ（約6秒）長く残るはず（**未実測**） |
| 同期欄の 'loading'（読み込み中...） | `_initCloudSyncLoad`・`_initGitHubSyncLoad` の始め | 2つの catch で 'failed'/'reconnect' に置き換える | 下ろしている（実測で、toast と同じ 2.80 秒に失敗の文へ変わった） |
| `_retryInitLoad` の読み直し（電波が戻った時・#617） | L5329 付近 `_initLoadRetrying = true` | finally で下ろす。確認中の行は立てない | 見える進行中の表示は、同期欄の 'loading' だけ。下ろしている |

### 直し方の案

| 比べる点 | (a) initSync が終わったら下ろす（成功・失敗とも） | (b) initSync が失敗した時だけ、その直後に下ろす | (c) `_updateStatusBar` で、失敗の印がある間は出さない | (d) 2つの catch の中で下ろす | (e) 参考：通信の失敗が分かった後の、後ろの読み込みの再試行を省く |
|---|---|---|---|---|---|
| 事実と合うか | 合う（行＝保存先のデータの確認。全場面で、確認が終わったら消える） | 失敗の場面で合う。成功はプラグインの読み込みの間（0.5〜1.1秒）残るが、今と同じ | 見た目だけ合う（`_syncChecking` は立ったまま） | (b) と同じ | 約6秒がほぼ0になる。#loading の覆いも一緒に縮む |
| 成功の起動の見え方 | 変わる（0.5〜1.1秒早く消える） | 変わらない | 変わらない | 変わらない | 変わらない |
| `waitForHubStartupForTest`（gate-hub.js L162・30 の spec で使う）の待ち | 成功でも「プラグインまで終わった」合図でなくなる。30 spec の待ちの意味が変わるので、道具を直す必要がある | 成功では変わらない。通信の失敗の後にこの道具で待つ spec だけ、待ちがプラグインより前に終わる（step2 で該当を洗う） | 失敗の時だけ、(b) と同じ | (b) と同じ | 変わらない |
| #666 と同じ箇所か | 別（L433-497 だけ） | 別。失敗の印は、もうある `_initLoadFailed`（#617。通信の失敗の時に2つの catch が立てる）を finishStartup で見るだけなので、catch は触らない | **同じ**（#666 は状態バーの失敗の行に「再試行」を足す） | **同じ**（#666 は2つの catch の文を変える） | 別（plugin-loader.js・publish-article-store.js か github-adapter.js） |
| ADR-041/042 | コアの起動の表示の直し。差し込み口には関わらない | 同じ | 同じ | 同じ | 失敗した時にプラグインの読み込みの挙動（保存先を読みに行くか）が変わる。プラグインから見える挙動を変えるので、別に決める |

- (b) で認証切れを見ない理由：認証切れでは `_initLoadFailed` が立たない。ただ、認証切れは再試行しないので、実測で0.11〜0.42秒で消えている。
- **推奨は (b)**。
  1. 残るのは通信の失敗の時だけ（実測）。(b) なら、その場面だけを直せる。
  2. 成功の起動の見え方と、30 spec が合図にしている「行が消える＝起動の後半が終わった」の意味が変わらない。
  3. #666 と同じ箇所を触らない（finishStartup の中だけ）。
  - (a) のほうが事実には素直だが、30 spec の待ちの道具を一緒に直す必要があり、割に合わない。
- 直す前に赤になる E2E の見込み（step2）：GitHub・通信の失敗で、toast が出た後1.5秒のうちに確認中の行が消えること（今は約6秒なので赤）。守りとして、ハブ・通信の失敗（今も緑）と、成功の起動で行が出て「保存済み」の後に消えることを入れる。
- 別に回す候補（この件では直さない・②の判断）→ ②の決定（19:00）で、(e) はこのイシューでは触らず、別に起票する。(e) の中身：端末にデータが無い起動の #loading の覆いも、同じ作りで約6秒長く残るはず（未実測）。通信の失敗が分かった後も、公開記事の移行とプラグインの列挙が保存先を2秒ずつ待って読み直すこと自体を直すなら、プラグインの読み込みの決まりに関わるので別イシューにする。

### ②の決定（2026-11-14 19:00）

- 直す。案は (b)：initSync の後に、finishStartup の中で `_initLoadFailed` を見て、確認中の行を下ろす。#666 の catch と `_updateStatusBar` には触らない。
- E2E の基準：失敗の表示（ハブは状態バーの失敗の行、GitHub は toast）が出てから2秒のうちに、確認中の行が消える（`toHaveCount(0, { timeout: 2000 })`）。
- (e) はこのイシューでは触らず、別に起票する。

## step2 直す前に赤になる E2E を足す（2026-11-14 19:01〜19:04・アプリのコードは変えていない）

### 通信の失敗の後に waitForHubStartupForTest で待つ spec の洗い出し

(b) で変わるのは、起動の読込が通信の失敗で終わった時（`_initLoadFailed` が立った時）だけ。その時は、確認中の行がプラグインの読み込みより前に消える。そのため、読込が失敗した起動の後でこの道具を呼び、その後の確かめがプラグインの読み込みの完了に頼っている spec があるかを見た。

- 道具を使う spec は30ファイル（`grep -rl "waitForHubStartupForTest(" tests/e2e`）。
- そのうち、通信を落とす作り（`abort(`・401・`hub.deleted`・`setOffline(true)`・5xx の fulfill）も持つものは6ファイル。下の表で、道具をどの起動の後に呼んでいるかを1か所ずつ読んだ。

| spec | 道具を呼ぶ所 | その起動の読込 | 落とすのはいつ・何を | (b) で待ちが変わるか |
|---|---|---|---|---|
| boot-load-failure-status.spec.js | L43・L56（bootHub・bootGitHub の中） | 成功（切る前） | 呼んだ後に cut.mode を立てて reload。reload の後は文で待つ（道具は呼ばない） | 変わらない |
| online-resync.spec.js | L52・L93・L125・L202・L220・L244・L272 | どれも成功（cut は off のまま起動） | 呼んだ後に電波を切って書く。穴1（L64 など）は切ったまま reload し、その後は「読み込みに失敗しました」の文と `statusBar toBeHidden` で待つ（道具は呼ばない） | 変わらない（reload の後の `toBeHidden` は、行が早く消える分だけ早く通る向き） |
| sync-conflict-overwrite.spec.js | L57 | 成功 | L124 の offline は、起動した後の保存の経路 | 変わらない |
| sync-section-status.spec.js | L236 | 成功 | L160-164 の 503 は書き込みだけ（GET・HEAD・OPTIONS は通す）＝起動の読込は失敗しない | 変わらない |
| status-bar-over-faces.spec.js | L112（setupSaveFailure の中） | 成功 | L184 の 503 は保存の失敗を作る口（起動の後） | 変わらない |
| load-conflict-unsaved.spec.js | L433 | 成功 | L290 の 503 は保存の失敗を作る口（起動の後） | 変わらない |

- 結論：**読込が失敗した起動の後に道具を呼ぶ spec は0件**。(b) で待ちの意味が変わる spec は無い。step3 で道具（gate-hub.js）を合わせる必要は無い。
- 確認中の行そのものを待つ spec（startup-background-sync L45・L57、gate/j1-3-connect-hub L30、gate/j6-4-sync-conflict L91・L176、sync-conflict-overwrite L105）も、どれも読込が成功する起動。成功の起動は (b) で変わらない。

### 足した spec：tests/e2e/boot-load-checking-row.spec.js（6本）

作り方は step1 の probe と同じ。1回ふつうに起動してから、模擬より手前の `context.route` で切って開き直す。

- 失敗の表示は、文ではなく出る場所で見る（ハブ＝状態バーの `.status-row.status-warn`、GitHub＝`.toast-message` のうち「GitHub」を含むもの）。失敗の文は #666 で変わりうるため。#666 が GitHub の toast をやめて別の場所に出すことにしたら、後から入る側がこの spec の「失敗の表示」をその場所に合わせる。
- 失敗の4本も、開き直した後に確認中の行が一度は出たことを見る（addInitScript の MutationObserver で画面の側に覚える・`expect.poll`）。行が出ないまま通ってしまうのを防ぐため。
- 待つのは `expect(locator)` と `expect.poll` だけ。bookshelf._* は読まない。

| # | 場面 | 確かめること | 直す前（2回） |
|---|---|---|---|
| 1 | GitHub・通信の失敗 | toast が出てから2秒のうちに行が消える | **赤・赤** |
| 2 | ハブ・通信の失敗 | 失敗の行が出てから2秒のうちに行が消える | 緑・緑 |
| 3 | ハブ・認証切れ（hub.deleted） | 同上 | 緑・緑 |
| 4 | GitHub・認証切れ（401） | toast が出てから2秒のうちに行が消える | 緑・緑 |
| 5 | 守り：GitHub・成功 | 行が出て、「保存済み」の後に消える | 緑・緑 |
| 6 | 守り：ハブ・成功 | 同上 | 緑・緑 |

### 直す前の出力（47505b2＋spec だけ・アプリのコードは変えていない）

流し方：`PORT=8172 npx playwright test tests/e2e/boot-load-checking-row.spec.js --project=chromium --workers=4 --global-timeout=300000`。2回流して同じ赤になった（1回目 `tmp/672/step2-before-run1.txt`、2回目 `tmp/672/step2-before.txt`。commit しない）。

- 1回目：`1 failed / 5 passed (7.8s)`。落ちたのは #1 だけ（4.8s）。
- 2回目：`1 failed / 5 passed (8.4s)`。落ちたのは同じ #1。
- #1 のメッセージ（2回とも同じ）：

```
Error: toast が出た後も「確認しています」が残っている
expect(locator).toHaveCount(expected) failed
Expected: 0
Received: 1
  - toast が出た後も「確認しています」が残っている with timeout 2000ms
> 80 |     await expect(checkingRow(page), 'toast が出た後も「確認しています」が残っている').toHaveCount(0, { timeout: LEAVE_MS });
```

- E2E にかかわる lint を流して、どれも OK（`npm run -s lint:<名前>`、出力は `tmp/672/step2-lint:*.txt`）。
  - lint:e2e-goto（167 ファイル・0件）
  - lint:e2e-wait（168 ファイル・0件）
  - lint:e2e-external（169 ファイル・0件）
  - lint:internal-refs（上限 82 以内）
  - lint:e2e-gate（@gate 41本・違反0件）
  - lint:known-red（0件）

## step3 直して緑にする（2026-11-14 19:05〜19:08・push はしていない）

### 直したもの（案 (b)）

- js/bookshelf.js の finishStartup（L433-）：`await this.initSync()` の直後に1行足した。`this._initLoadFailed && this._syncChecking` の時、`_syncChecking` を下ろして `_updateStatusBar()` を呼ぶ。
  - `_initLoadFailed` は #617 の印。起動の読込が通信で失敗した時に、2つの catch が `_markInitLoadFailed` で立てる。
  - 端末にデータが無い起動では `_syncChecking` を立てないので、何もしない。
  - L497 の `finishStartup().finally` はそのまま残した。成功の起動は、今までどおりそこで下ろす。
- 触っていないもの：2つの catch（#666）、`_updateStatusBar`、読込の失敗の文言、gate-hub.js の `waitForHubStartupForTest`（step2 の洗い出しで、合わせる必要なし）。
- index.html：bookshelf.js の `?v=` を 2026111796 → **2026111799** にした。origin/main の最大は 2026111796。開いている他のイシューの worktree では、最大が 2026111798（issue-671）、#666 は 2026111795。
- docs/char/boot-flow.md L24「データ有り」の行に、通信の失敗の時は `initSync()` が返った直後に下ろすことを書き足した。

### 直した後の出力

- tests/e2e/boot-load-checking-row.spec.js：2回とも **6 passed**（5.6s・5.4s。`tmp/672/step3-after.txt`・`step3-after-run2.txt`）。直す前に赤だった #1（GitHub・通信の失敗）も緑。
- 関連する spec 6ファイル（boot-load-failure-status・online-resync・startup-background-sync・gate/j1-3-connect-hub・gate/j6-4-sync-conflict・sync-conflict-overwrite）：**21 passed**（45.9s。`tmp/672/step3-related.txt`）。
- `npm test`：Test Files 80 passed (80)・Tests 1194 passed | 2 todo（`tmp/672/step3-npm-test.txt`）。
- step1 の probe を、直した版でもう1回流した（7 passed・24.8s。`tmp/672/step3-probe.txt`）。直す前の json は `tmp/672/runs-before/` に写してから流した。

| 場面 | 失敗の表示（成功は「保存済み」） | 確認中の行が消えた | 失敗の表示から消えるまで（直す前の2回） |
|---|---|---|---|
| GitHub・通信の失敗 | 2750 | 2751 | **0.00 秒**（6.23・6.09 秒） |
| ハブ・通信の失敗 | 342 | 342 | 0.00 秒（0.42・0.13 秒） |
| ハブ・401 | 227 | 295 | 0.07 秒（0.26・0.42 秒） |
| GitHub・401 | 224 | 302 | 0.08 秒（0.11・0.23 秒） |
| 参考：ハブ・成功 | 108 | 171 | 0.06 秒（1.11・0.53 秒） |
| 参考：GitHub・成功 | 397 | 805 | 0.41 秒（0.74・0.64 秒） |
| 参考：GitHub・通信の失敗で toast の「再試行」 | 2146 | 2146 | 0.00 秒（2.38・2.15 秒） |

- 通信の失敗の2場面は、失敗の表示と同時に消えるようになった。401 と成功の起動は、今までどおり finally で下ろしている（1回だけの値なので、直す前との差は揺れの範囲）。
