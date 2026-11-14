# #648 空の保存先の初期化中、状態の欄が「保存できませんでした」のまま — 記録

## step1 再現と記録（2026-11-14 16:15〜16:18・コードは変えていない）

アプリの版：origin/main 98de66d（worktree を早送りした版）。行番号はこの版のもの（計画時の 18ede16 から L3126→L3154、L3253→L3281、L4069→L4057 にずれた）。
流し方：`PORT=8148 npx playwright test --config tmp/648/probe.config.mjs`（probe は `tmp/648/probe-648.spec.mjs`。tmp/ は commit しない）。6本すべて最後まで届いた（2.1分）。届かなかった回は0。
表への直し：`node tmp/648/summarize.mjs [回の名前,…]`。

### 記録の取り方

- `page.addInitScript` で MutationObserver を文書全体に付け、変化のたびに次を読んで、前と違う時だけ `performance.now()` 付きで残した（100ms ごとの読み取りではない）。
  - 状態の欄 `#obsidian-sync-status` の文字・色・`checkVisibility()`、`#obsidian-sync-path` の文字・色
  - ローカルのフォルダの欄 `#sync-config-local` の hidden、設定 `#settings-modal` の開閉、保存先セレクトの値
  - 上部の状態バー `#app-status-bar` の文字と見えているか、読み込み中の覆い `#loading` の文字、確認の幕 `.cfm-overlay` の文字
- `updateSyncStatus` を、ページの中で包んで（アプリのファイルは変えない）、引数と呼び出し元の stack を残した。
- 時刻は OK（ローカルは「フォルダを選ぶ」）を押した時を 0 にした ms。
- 書き込みの遅らせ方：ハブ＝`page.route('https://mockhub.test/data/**')` で GET 以外を1件 1900ms（#633 の本番の実測）。GitHub＝`page.route('https://api.github.com/**')` で GET 以外を1件 1000ms（書き込みの要求が25件あり、90秒に収めるため短くした）。ローカル＝`FileSystemFileHandle.prototype.createWritable` を1件 1900ms 遅らせる（7件）。
- 場面：(a) 設定を開かない (b) OK の直後に 設定→同期 を開く (c) (b) の後、保存先セレクトを「この端末のフォルダに保存」に切り替える。GitHub は (a)(c)、ローカルは初めての人の流れ（gate/j1-3 と同じ：案内の「保存先を選ぶ」→「この端末のフォルダ」→「フォルダを選ぶ」）。

### 結論（step1）

| 保存先・場面 | 状態の欄の文字 | 画面に見えたか | 上部の状態バー | 失敗に見える表示が画面に出たか |
|---|---|---|---|---|
| ハブ (a) 設定を開かない | 確認が出る直前（-191ms）から読込の終わり（+13,403ms）まで「保存できませんでした」（赤） | **見えない**（ローカルの欄が hidden・`checkVisibility()`=false のまま） | 空・隠れたまま | **出ない**。見えていたのは上の細い表示「本棚を準備中…」（#loading）だけ（`hub-a/5-mid-init.png`） |
| ハブ (b) 設定→同期を開く | 同上（+13,754ms まで） | **見えない**（ハブを選んでいるので、ローカルの欄は hidden のまま） | 空 | **出ない**（`hub-b/3-settings-sync.png`） |
| ハブ (c) セレクトを「この端末のフォルダ」へ | 同上（+13,549ms まで） | **見える**（+404ms でローカルの欄が出る。`checkVisibility()`=true） | 空 | **出る**。赤の「Asayake ハブ (空)（要再接続）」と「保存できませんでした」。同時に出る切替の確認の幕の後ろに、一部が見える（`hub-c/4-select-local.png`） |
| GitHub (a) | -172ms〜+7,296ms「保存できませんでした」（赤） | 見えない | 「GitHub の保存先を取得できません。確認」が -212ms から最後まで出ている（下の注1：模擬の不足） | 状態の欄は出ない。状態バーの表示は模擬の不足によるもの |
| GitHub (c) | -173ms〜+7,232ms 同上 | **見える**（+458ms から） | 同上（注1） | **出る**（ハブ (c) と同じ形。`github-c/4-select-local.png`） |
| ローカル（初めての人） | +18ms「読み込み中...」（灰）→ +13,429ms「同期済み（「フォルダを選ぶ」で再読み込み）」（緑） | 見える | 「保存先が未設定です。…保存先を選ぶ」が +1,226ms で消えた | **出ない**。「保存できませんでした」は1回も無い。ローカルには「初期化しますか」の確認が無い |

- 依頼文の「初めての利用者が最初に目にする画面で、失敗したように見える」は、**ふつうの流れ（a）(b) では当たらない**。状態の欄は「この端末のフォルダ」の欄の中にあり（index.html L459・L470）、ハブ・GitHub を選んでいる間はその欄ごと hidden（js/screens/settings.js `_showSyncPanel`）。
- **見えるのは (c) だけ**＝初期化が終わる前に、設定の保存先セレクトを「この端末のフォルダ」に切り替えた時。読込が終わるまで（ハブで約13秒）、赤の「保存できませんでした」と「(空)（要再接続）」が見える。
- 読込が終わると、ハブ・GitHub とも「HH:MM:SS 保存済み」（緑）に変わる。この後に「保存できませんでした」へ戻った回は無い。

### updateSyncStatus の呼び出し（全6回の stack から）

| 保存先 | 時刻（OK から） | 引数 | 呼び出し元（98de66d） |
|---|---|---|---|
| ハブ | -259 / -266 / -386 | `('loading', 'Asayake ハブ')` → 「読み込み中...」（灰） | initCloudSync js/bookshelf.js:3146 |
| ハブ | -194 / -206 / -214 | `('reconnect', 'Asayake ハブ (空)')` → **「保存できませんでした」（赤）・path「Asayake ハブ (空)（要再接続）」** | initCloudSync js/bookshelf.js:3154（空と分かって確認を出す直前） |
| ハブ | +13,400 / +13,745 / +13,542 | `('synced', 'Asayake ハブ')` → 「HH:MM:SS 保存済み」（緑） | initCloudSync js/bookshelf.js:3182（loadAll と反映の後） |
| GitHub | -229 / -303 | `('loading', 'fake-owner/fake-bookshelf-data@main')` | initGitHubSync js/bookshelf.js:3275 |
| GitHub | -177 / -181 | `('reconnect', '… (空)')` → **「保存できませんでした」（赤）** | initGitHubSync js/bookshelf.js:3281 |
| GitHub | +7,293 / +7,223 | `('synced', …)` | initGitHubSync js/bookshelf.js:3302 |
| ローカル | +11 | `('loading', 'probe-648')` → 「読み込み中...」 | selectObsidianFolder js/bookshelf.js:3414 |
| ローカル | +13,411 | `('synced', 'probe-648')` → 「同期済み…」 | selectObsidianFolder js/bookshelf.js:3428 |

- OK を押してから 'synced' までの間（ハブ 約13.4秒・GitHub 約7.3秒）、updateSyncStatus は**1回も呼ばれていない**＝確認の前に出した「保存できませんでした」がそのまま残る。
- 'reconnect' を「保存できませんでした」に変えるのは updateSyncStatus のハブ・GitHub の分岐（js/bookshelf.js:4046-4059。L4057 `failed ? (detail || '保存できませんでした') : …`）。空の時の呼び出しは detail を渡していないので既定の文言になる。原因の裏づけと同じ種類の洗い出しは step2 で行う。
- 全6回で、初期化の途中に保存の経路（保存の失敗）からの updateSyncStatus は無かった（本を足す操作はしていない）。

### 書き込みの数

- ハブ：遅らせた書き込み 8件。初期化の PUT 7件（private/library.json・exclusions.json・notes.json・bookshelves.json・bookshelves/all.json・settings.json・main.json）が1件ずつ順に走り、OK から 'synced' まで約13.4〜13.8秒。残りの1件（POST /data/batch）は 'synced' の後の最初の保存。
- GitHub：遅らせた書き込み 25件。初期化の Contents API の PUT 7件が1件ずつ順に走り、OK から 'synced' まで約7.2〜7.3秒。残りの18件（POST /git/blobs 15件・/git/trees・/git/commits・PATCH /git/refs/heads/main）は 'synced' の後の最初の保存。その間も状態の欄は「保存済み」のまま。
- ローカル：createWritable 7件（+24ms〜+11,491ms・1件 1900ms）。

### 注

1. GitHub の回の上部の状態バー「GitHub の保存先を取得できません。確認」は、設定の GitHub の欄がリポジトリの一覧を取りに行き（`GET /user/installations`）、模擬（tests/e2e/helpers/storage-fakes.js installFakeGitHub）がそれに答えないために出た（js/screens/settings.js L385-399 の catch）。初期化の経路とは別で、本物の GitHub では出ない見込み（未確認）。step3 の GitHub の E2E は、状態バーではなく状態の欄だけを見る。
2. (c) の切替の確認の幕の文言が、ハブから切り替える時も「GitHub の接続情報はそのまま残ります。」になっている（`hub-c/4-select-local.png`）。このイシューの範囲外。step2 の洗い出しに載せて扱いを②に委ねる。
3. 確認の幕（「初期化しますか」）が出ている間（-191ms〜0）は、状態の欄はすでに「保存できませんでした」。ただし (a)(b) では隠れていて、幕の後ろも「本棚を準備中…」だけ（`hub-a/1-confirm.png`）。

### 画像の場所（tmp/648/runs/<回の名前>/・commit しない）

| 回の名前 | 画像 |
|---|---|
| hub-a・hub-b・hub-c・github-a・github-c | 1-confirm（確認が出た時）・2-after-ok（OK の直後）・3-settings-sync（設定→同期を開いた所。b・c）・4-select-local（セレクトを切り替えた所。c）・5-mid-init（初期化中・OK の約4秒後）・6-after-load（読込の後） |
| local-first | 1-before-pick（「フォルダを選ぶ」の前）・2-after-pick（押した直後）・5-mid-init・6-after-load |

各回の記録の元：`tmp/648/runs/<回の名前>/probe.json`（rec＝変化の列・calls＝updateSyncStatus の呼び出し・reqs/localWrites＝書き込み）。
