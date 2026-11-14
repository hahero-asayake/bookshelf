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

## step2 原因の裏づけ・同じ種類の洗い出し・表示の案（2026-11-14 16:20〜・コードは変えていない）

行番号は 98de66d（origin/main d92709f でも js/bookshelf.js・js/screens/settings.js は同じ）。

### 原因（step1 の stack で裏づけた）

1. 起動の読込（ハブ initCloudSync・GitHub initGitHubSync）は、始めに `updateSyncStatus('loading', label)`（L3146・L3275）で「読み込み中...」（灰）を出す。
2. `detectFormat()` が `'empty'` を返すと、**確認（confirmDialog）を出す前に** `updateSyncStatus('reconnect', \`${label} (空)\`)`（L3154・L3281）を呼ぶ。
3. updateSyncStatus（L4046-）は、ハブ・GitHub の時に `'reconnect'` を失敗として扱う（`failed = state !== 'synced'`）。detail が無いので既定の文言 `'保存できませんでした'`（L4057）を赤で出し、path に「（要再接続）」を付ける。この既定の文言とクラウドの分岐は 260b22f（#603）で入った（260b22f^ の updateSyncStatus にクラウドの分岐は無い）。
4. OK の後の initEmpty→loadAll→反映の間、updateSyncStatus は1回も呼ばれない（step1 の6本すべてで0回）。そのため L3182・L3302 の `'synced'`（「HH:MM:SS 保存済み」）まで、確認の前に出した文字が残る。
5. キャンセルの後（ハブ L3156-3163・GitHub L3283 `if (!ok) return;`）も呼ばれない。2 で出した文字がそのまま残る（ハブは状態バーに「Asayake ハブ は空です。初期化していません。…」も出る）。

### 同じ種類の洗い出し（updateSyncStatus の呼び出し 全22か所）

「保存できませんでした」（詳しい理由なしの既定の文言 L4057）に届くのは、ハブ・GitHub の時に detail なしで `'reconnect'`/`'failed'` を渡す6か所だけ。本当の保存の失敗（L3936）は必ず `failure.message`（js/sync-failure.js の文。例「Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。」）を渡すので、既定の文言には届かない。

| 行 | 関数 | 場面 | 渡す状態 | ハブ・GitHub の時の表示 | ローカルの時の表示 | 事実と合うか | 扱い |
|---|---|---|---|---|---|---|---|
| 3146 / 3275 | initCloudSync / initGitHubSync | 起動の読込の始め | loading | 読み込み中...（灰） | – | 合う | そのまま |
| **3154 / 3281** | 同上 | **空と分かった・確認の前** | reconnect（`… (空)`・detail なし） | **保存できませんでした（赤）・「… (空)（要再接続）」** | – | **合わない**（何も保存していない・利用者の答えを待っているだけ） | **このイシューで直す** |
| 3182 / 3302 | 同上 | 読込の後 | synced | HH:MM:SS 保存済み（緑） | – | 合う | そのまま |
| 3187 / 3305 | 同上 | 読込の失敗（catch） | reconnect（detail なし） | 保存できませんでした（赤） | – | **合わない**（失敗したのは読込。ハブは状態バーに「…からの読み込みに失敗しました。」、GitHub は toast「…GitHub からの読み込みに失敗しました。」） | 別に回す候補1 |
| （呼び出し無し） | 同上 | 確認でキャンセルした後 | – | 確認の前の「保存できませんでした」が残る | – | おおむね合う（初期化していない＝保存先へ書いていない） | 直す時に表示を保つ |
| 3386 / 3388 | initObsidianSync | ローカル・起動・許可あり | loading → synced | – | 読み込み中... → 同期済み | 合う | そのまま |
| 3396 | initObsidianSync | ローカル・許可なし | reconnect | – | 「フォルダを選ぶ」を押して…（赤） | 合う | そのまま |
| 3414 / 3428 | selectObsidianFolder | フォルダを選んだ（空なら確認なしで初期化） | loading → synced | – | 読み込み中... → 同期済み（step1 local-first で実測） | 合う | 確かめるだけ |
| 3439 | selectObsidianFolder | 読込の失敗 | reconnect | – | 「フォルダを選ぶ」を押して…＋toast | 合う | そのまま |
| 3637 / 3644 / 3646 | reloadFromObsidianFile | ローカルの読み直し | loading → synced | – | 読み込み中... → 同期済み（読めない時は toast） | 合う | そのまま |
| 3700 | syncToObsidianFolder | 衝突中（3択の前）に保存しようとした | reconnect（detail なし） | 保存できませんでした（赤） | – | 合う（送っていない） | 触らない（#635・#639 が衝突の表示を触っている） |
| 3713 | syncToObsidianFolder | ローカルの書き込みの許可が無い | disconnected | – | （未接続） | 合う | そのまま |
| 3917 | syncToObsidianFolder | まとめ保存で衝突 | reconnect（detail なし） | 保存できませんでした（赤） | – | 合う（送れていない） | 触らない（同上） |
| 3931 | syncToObsidianFolder | 保存の後 | synced | 保存済み（緑） | 同期済み | 合う | そのまま |
| 3936 | syncToObsidianFolder | **本当の保存の失敗** | reconnect / failed＋`failure.message` | 失敗の種類ごとの文（赤） | 「フォルダを選ぶ」を押して…（赤） | 合う | **変えない**（完了条件2。状態バーの文言は save-failure-visible.spec.js・門の J6-5 が見ている） |

updateSyncStatus 以外で見つけたもの：

- js/screens/settings.js L118：保存先セレクトを「この端末のフォルダ」に切り替えた時の確認が、ハブから切り替える時も「GitHub の接続情報はそのまま残ります。」になる（step1 `hub-c/4-select-local.png`）。ハブの人が切り替えるたびに見える＝ふつうの流れで見える。
- 状態の欄と path はローカルの「保存フォルダ」の欄の中にあるのに、ハブ・GitHub の状態を書いている（index.html L459・L470）。そのため (c) の切替の確認の後ろで、「保存フォルダ」の欄に「Asayake ハブ (空)（要再接続）」が出る。

### 見える場面（step1 の結論から）

- (a) 設定を開かない・(b) 設定→同期を開く・上部の状態バー：**見えない**。
- (c) 初期化が終わる前に、保存先セレクトを「この端末のフォルダ」に切り替えた時：**見える**。ただし切替の確認の幕の後ろだけ。確認で OK→再読込、キャンセル→セレクトとハブの欄に戻る（js/screens/settings.js L110-126）ので、見えるのは確認が開いている間だけ。

### 表示の案（確認の待ち・初期化中・終わった後・キャンセルの後）

| | 案A（推奨・最小） | 案B（場面ごとの文言を足す） | 案C（状態の欄をローカル専用にする） |
|---|---|---|---|
| やること | 空と分かった時の `updateSyncStatus('reconnect', … (空))` を、確認の前からキャンセルの分岐へ移す（ハブ・GitHub の2か所） | updateSyncStatus に「確認待ち」「初期化中」の状態と文言を足し、初期化の経路から呼ぶ | ハブ・GitHub の時は、ローカルの欄の状態の欄と path に書かない（または欄を出す時に消す） |
| 確認の待ち | 読み込み中...（灰・L3146 の表示のまま） | 例「保存先が空です。初期化するか確認しています」（灰） | ローカルの欄の文字（例「（まだ選んでいません）」） |
| 初期化中 | 読み込み中...（灰） | 例「初期化しています...」（灰） | 同上 |
| 終わった後 | HH:MM:SS 保存済み（緑・今と同じ） | 今と同じ | 同上 |
| キャンセルの後 | 保存できませんでした（赤）＋「… (空)（要再接続）」＝**今と同じ**（ハブは状態バーの文も今と同じ） | 例「初期化していません」（赤） | 同上 |
| 失敗に見えないか | 確認〜読込の終わりで ○。キャンセル後は今と同じ | ○（事実にいちばん近い） | ○（クラウドの状態がローカルの欄に出ること自体が無くなる） |
| 既にある文言との揃い | 新しい文言なし。クラウドの読込の始め（L3146）・ローカルの初期化中（実測）と同じ「読み込み中...」 | 新しい文言が2〜3つ（lint:copy・lint:terms・04_画面設計書の状態の表の更新が要る） | 新しい文言なし |
| #639 の 'held' との衝突 | なし（updateSyncStatus に触らない。'held' は読込時の3択を選ばずに閉じた時だけで、空の初期化では3択は出ない＝step1 の6本で0回） | 同じ関数に分岐を足す（頭の 'held' を避けて 'loading' の並びに置けば文面は避けられる。載せ直しの手間は増える） | 大きい（#603 のクラウドの分岐と、#639 が同期欄に出す 'held' を変えることになる） |
| 変える行数 | js/bookshelf.js 2か所で1行ずつ移す（±4〜6行）＋ ?v= | ±25〜35行＋文言・設計書 | 中〜大＋クラウドで同期欄を見ている spec（save-failure-visible.spec.js L280 ほか）の書き換え |
| 欠点 | 確認を待っている間も「読み込み中...」（厳密には「答えを待っている」）。見えるのは (c) の確認の後ろだけ | 見える場面が (c) の確認の後ろだけなのに、表示を作り直す | このイシューの範囲（初期化の経路）を超える |

**推奨は案A。** ②の指示「見える場面が無い時は、事実と違う文言を正すだけの小さな修正」に合う。見える場面は (c) の確認の幕の後ろだけなので、表示の作り直し（案B）までは広げない。案C は食い違いの元を断てるが、#603・#639 の決まりに触るので別に扱う。

### このイシューの範囲（案A の場合）

- 直す：空の確認の前の呼び出し（L3154・L3281）を、キャンセルの分岐（ハブ L3156-3163・GitHub L3283）へ移す。ローカルは確かめるだけ（直さない）。
- E2E（step3・新しい spec）：
  - ハブ：確認が出てから読込が終わるまで、状態の欄に「保存できませんでした」が1回も出ない。「読み込み中...」の後に「保存済み」になる。キャンセルした後は今と同じ「保存できませんでした」が出る（「読み込み中...」のまま残らない）。
  - GitHub：同じ（状態バーは模擬の不足で別の文が出るので見ない＝step1 注1）。
  - ローカル：初めての人の流れで「保存できませんでした」が1回も出ない（守り。直す前も緑の見込み）。
  - (c) の場面（切替の確認の後ろで見える文字）も1本入れるかは②の判断（入れるなら、ハブで「保存できませんでした」が見えないこと）。
- 完了条件2（本当の保存の失敗）：L3936 と状態バーには触らない。save-failure-visible.spec.js と門の J6-5 で確かめる。

### 別に回す候補（このイシューでは直さない）

1. **読込の失敗で状態の欄が「保存できませんでした」**（L3187・L3305）。推奨：**別イシュー（小）**。見えるのは (c) 型の切替の時だけで、利用者には状態バー（ハブ）・toast（GitHub）で「読み込みに失敗しました」と別に出ている。直し方は detail を渡す2行の見込みだが、E2E に読込の失敗の注入が要り、初期化の E2E と型が違う。#617（電波が戻ったら読み直す）と同じ catch の中にある。
2. **切替の確認の文言**（js/screens/settings.js L118）：ハブから切り替える時も「GitHub の接続情報はそのまま残ります。」。推奨：**別イシュー（小）**。ふつうの流れで見える（ハブの人が「この端末のフォルダ」を選ぶたび）。元の保存先で文を出し分ける。
3. **クラウドの状態がローカルの「保存フォルダ」の欄に書かれる**（案C の中身）。推奨：**07_残検討事項に1行**。見えるのは切替の確認の後ろだけで急がない。#603・#639 の同期欄の決まりと一緒に考える。
4. 衝突（L3700・L3917）の「保存できませんでした」は事実と合う（送っていない）。触らない。

### ②の決定（2026-11-14 16:25）

- 表示は案A（空の確認の前の呼び出しを、キャンセルの分岐へ移す。updateSyncStatus には触らない）。
- (c) の場面の E2E を足す（直す前の版で赤になることも確かめる）。
- 「クラウドの状態がローカルの欄に書かれる食い違い」は、このイシューの step4 で 07_残検討事項に1行足す。「読込の失敗の文言」と「切替の確認文」は②が別に起票する（このイシューでは触らない）。

## step3 E2E を足し、直す前の版で赤を取る（2026-11-14 16:27〜16:30）

新しい spec：`tests/e2e/first-run-init-status.spec.js`（6本）。

- 状態の欄の文字は、`page.addInitScript` の MutationObserver で、アプリを開いてから読込が終わるまで全部集める（確認が出た時の文字も入る）。集めた並びで「保存できませんでした」が0回で、「読み込み中...」の後に「保存済み」（ローカルは「同期済み」）が出たことを確かめる。待つ所は `expect.poll`・`expect(locator)` だけで、`waitForFunction(async)` は使っていない。
- 時機の作り方：初期化の書き込みを、確かめ終わるまで止める。ハブ・GitHub は `page.route` で GET 以外を止め、先に取り付けた模擬へ `route.fallback()` で回す。ローカルは `FileSystemFileHandle.prototype.createWritable` を spec の中で包む（tests/e2e/helpers/storage-fakes.js は変えていない）。止めている間に「初期化中」の文字を見る。
- アプリの内部（`bookshelf._*`）は読まない。読むのは画面（`#obsidian-sync-status`・`#obsidian-sync-path`・`#app-status-bar`）と、spec が自分で置いた記録だけ。

| # | テスト | 確かめること | 直す前（98de66d＋docs のみ） |
|---|---|---|---|
| 1 | ハブ：初期化の間 | 確認の待ち・初期化中が「読み込み中...」、並びに「保存できませんでした」0回、「読み込み中...」→「保存済み」 | **赤** |
| 2 | ハブ：キャンセルの後 | 今までどおり「保存できませんでした」・「Asayake ハブ (空)（要再接続）」・状態バー「Asayake ハブ は空です。初期化していません。」 | 緑（今の表示を保つ確かめ） |
| 3 | GitHub：初期化の間 | 1 と同じ | **赤** |
| 4 | GitHub：キャンセルの後 | 今までどおり「保存できませんでした」・「fake-owner/fake-bookshelf-data@main (空)（要再接続）」（状態バーは模擬の不足で別の文が出るので見ない＝step1 注1） | 緑 |
| 5 | ハブ：(c) 初期化の途中で保存先を「この端末のフォルダ」に切り替える | 切替の確認の幕の後ろに見えている状態の欄（`toBeVisible`）に「保存できませんでした」が無く、「読み込み中...」 | **赤** |
| 6 | ローカルのフォルダ：初めての人の流れ | 初期化中が「読み込み中...」、並びに「保存できませんでした」0回、「読み込み中...」→「同期済み」 | 緑（守り） |

### 直す前の出力（2回流して同じ。2回目を `tmp/648/step3-before.txt` に保存）

```
✘ 1 ハブ: 空の保存先を初期化する間、…「保存できませんでした」は出ない
✓ 2 ハブ: 初期化の確認でキャンセルした後は、今までどおり…を出す (503ms)
✘ 3 GitHub: 空の保存先を初期化する間、…「保存できませんでした」は出ない
✓ 4 GitHub: 初期化の確認でキャンセルした後は、今までどおり…を出す (765ms)
✘ 5 ハブ: 初期化の途中で保存先を「この端末のフォルダ」に切り替えた時、…「保存できませんでした」が出ない
✓ 6 ローカルのフォルダ: 空のフォルダを選んで初期化する間、…「保存できませんでした」は出ない
3 failed / 3 passed (31.5s)
```

赤の理由（集めた文字の並びと、受け取った値）：

- 1 ハブ：確認を待っている間・初期化中とも `toHaveText("読み込み中...")` が `Received: "保存できませんでした"`。並び `["","読み込み中...","保存できませんでした","4:28:51 PM 保存済み"]`。
- 3 GitHub：同じ。並び `["","読み込み中...","保存できませんでした","4:29:02 PM 保存済み"]`。
- 5 ハブ (c)：確認の幕の後ろに見えている状態の欄が `not.toContainText("保存できませんでした")` に対して `Received string: "保存できませんでした"`。

### 直した後に緑になるかの下見（step4 の前に、テストの側の誤りが無いかを見るため）

案A の直し（ハブ・GitHub とも、空の確認の前の `updateSyncStatus('reconnect', … (空))` を、キャンセルの分岐へ移す。+5/-3行）を作業ツリーに一時的に当てて流した結果、**6本とも緑**（6 passed・5.1s・`tmp/648/step3-trial-fix.txt`）。流した後に `git checkout -- js/bookshelf.js` で戻し、退避した写し（`tmp/648/bookshelf.js.before-trial`）と同じであることを `cmp` で確かめた。この commit には直しを入れていない（直しは step4）。

### lint（新しい spec を足した後）

lint:e2e-goto・lint:e2e-wait・lint:e2e-external・lint:internal-refs（上限 82 以内）・lint:e2e-gate、すべて OK。

## step4 直して緑にし、既存の spec・lint・設計の記述を揃える（2026-11-14 16:31〜16:35）

### 直したこと（commit ba91959）

- js/bookshelf.js（+8/-3）：ハブ（initCloudSync）・GitHub（initGitHubSync）とも、空と分かった時の `this.updateSyncStatus('reconnect', \`${label} (空)\`)` を、確認の前からキャンセルの分岐へ移した（ハブは `if (!ok) {` の先頭、GitHub は `if (!ok) return;` を `{ …; return; }` に）。updateSyncStatus・本当の保存の失敗（`_onSyncFailed`・L3936 の呼び出し）は変えていない。
- index.html：`js/bookshelf.js?v=2026111660` → `2026111681`。origin/main（3a0d720）の最大は 2026111660。開いている他イシューの値（#614 2026111661・#636/#639 2026111672・#643 2026111674）とも重ならない値にした。`npm run check:version -- --range=origin/main..HEAD` は OK。
- docs/char/boot-flow.md §1-5：同期欄は、確認を待つ間と initEmpty→loadAll の間も「読み込み中...」で、失敗の表示はキャンセルした時だけ、と書いた。
- 設計書（vault）：
  - 04_画面設計書：「保存の失敗」の段の「設定の同期欄」の次に、起動の読込の間の同期欄（読み込み中... → 保存済み／同期済み、空の確認の待ちと初期化の間も読み込み中...、キャンセルした時だけ「保存できませんでした」と「(空)（要再接続）」、ハブ・GitHub の間は欄が隠れていること）を1項目足した。
  - 07_残検討事項「クラウド同期」の表に1行（💡 ハブ・GitHub の同期の状態が、ローカルの「保存フォルダ」の欄に書かれる・イシュー#648 で発見）。
  - vault の commit は自動バックアップに任せた（自分では commit していない）。対応づけは bookshelf の commit の題「設計: 04_画面設計書・07_残検討事項 2026-11-14 更新」。

### 直した後の出力（新しい spec＝直す前と同じ6本）

```
✓ 1 ハブ: 空の保存先を初期化する間、状態の欄は「読み込み中...」で、読込の後に「保存済み」になり、「保存できませんでした」は出ない
✓ 6 ハブ: 初期化の確認でキャンセルした後は、今までどおり「保存できませんでした」と「(空)（要再接続）」を出す
✓ 7 GitHub: 空の保存先を初期化する間、…「保存できませんでした」は出ない
✓ 9 GitHub: 初期化の確認でキャンセルした後は、今までどおり…を出す
✓ 10 ハブ: 初期化の途中で保存先を「この端末のフォルダ」に切り替えた時、確認の幕の後ろに見える状態の欄に「保存できませんでした」が出ない
✓ 13 ローカルのフォルダ: 空のフォルダを選んで初期化する間、…「保存できませんでした」は出ない
```

### ②の完了条件の数え方に合わせた、直す前と直した後

| 条件 | 直す前（step3・98de66d＋docs） | 直した後（ba91959） |
|---|---|---|
| ハブ・GitHub：確認から読込の終わりまで「保存できませんでした」0回、「読み込み中...」→「保存済み」 | **赤**（並び `["","読み込み中...","保存できませんでした","… 保存済み"]`・ハブ/GitHub とも） | **緑**（2本） |
| ハブ (c)：切替の確認の幕の後ろに見える状態の欄 | **赤**（見えている文字が「保存できませんでした」） | **緑**（「読み込み中...」） |
| キャンセルした後は今と同じ表示（ハブ・GitHub） | 緑 | 緑（2本） |
| ローカルは守りとして緑 | 緑 | 緑 |

### 既存の spec・vitest・lint（直した後）

- spec 9ファイル（新しい spec と、save-failure-visible・sync-first-connect・first-run-add-article-drawer・gate/j1-3-connect-local・gate/j6-1-local-restart・sync-offline-reconnect・book-memo-file-lifecycle・shelf-file-delete）を chromium・4並列で流した：**78本中 74 passed・4 skipped・失敗0**（1.5分・`tmp/648/step4-specs-run2.txt`）。
  - skipped の4本は book-memo-file-lifecycle.spec.js の既存の `test.fixme`（L259 の3保存先・L321＝#594 の fixme）。今回の直しとは関係ない。
  - 完了条件2（本当の保存の失敗では今までどおり「保存できませんでした」）：save-failure-visible.spec.js が全部緑（状態バーの「Asayake ハブに保存できませんでした。…」「GitHub の接続が切れたため、保存できませんでした。…」「保存先のフォルダが見つからないため、保存できませんでした。」ほか）。
  - 1回目（前の run）は、run の終わりで49本まで（すべて緑）流れたところで止まっていた。まとめの行が無いので数えず、全部を流し直した。
- `npm test`（vitest）：**Test Files 76 passed (76)**。
- lint 一式（直しを作業ツリーに入れた後の 16:32 に流した）：lint:copy（119/119）・lint:terms・lint:esc・lint:js-color・lint:breakpoint・lint:internal-refs（上限82以内）・lint:e2e-goto・lint:e2e-wait・lint:e2e-external・lint:e2e-gate・lint:known-red、すべて OK。

## step5 載せ直し・main との全件比較（2026-11-14 16:36〜・push の前に止まる）

### 載せ直し

- origin/main 25b9472 の上に載せ直した（`git rebase origin/main`）。前の土台 98de66d から入っていたのは #614（25b9472・js/bookshelf.js と index.html）・#640・#642。**#643・#636・#639 はまだ main に入っていない**（initCloudSync/initGitHubSync を包む #643 の変更は無いので、直した行は元の関数のまま）。
- 衝突は index.html の `js/bookshelf.js?v=` の1行だけ（#614 が 2026111661 にしていた）。こちらの 2026111681 を残した（main の最大 2026111661 より新しく、#636/#639 の 2026111672・#643 の 2026111674 とも重ならない）。js/bookshelf.js は自動で合わさった（直した行は L3158・L3286）。
- 載せ直した後の自分の commit：c089e3d（step1）・8adb681（step2）・3b905a9（test）・7cb621e（fix）・72e40f9（step4 の記録）。`git diff --stat origin/main..HEAD` は自分の5ファイルだけ（docs/char/boot-flow.md・index.html・js/bookshelf.js・scripts/verify/648-results.md・tests/e2e/first-run-init-status.spec.js）。

### 載せ直した後の確かめ

- 新しい spec（6本）：**6 passed**（4.0s・`tmp/648/step5-newspec.txt`）。
- `npm run check:version -- --range=origin/main..HEAD`：OK。
- lint 一式：lint:copy（119/119）・lint:terms・lint:esc・lint:js-color・lint:breakpoint・lint:internal-refs（上限82以内）・lint:e2e-goto・lint:e2e-wait（#640 で足された「ページ全体を写す待ち」も0件）・lint:e2e-external・lint:e2e-gate・lint:known-red、すべて OK。

### origin/main との全件比較（scripts/verify/e2e-diff-main.mjs）

- 1回目の載せ直しの後（base＝origin/main 25b9472・work＝作業ツリー HEAD 72e40f9）、`node scripts/verify/e2e-diff-main.mjs --port=8148 --out=tmp/648/e2e-diff` を流した（16:37〜16:47・9分45秒・`tmp/648/e2e-diff/report.md`）。
  - E2E（playwright・sort-perf-budget を除く全件）：**新しく落ちた 0件・新しく通った 0件・両方で落ちた 0件**。判定不能 0件。
  - Unit（vitest）：新しく落ちた 0件・新しく通った 0件・両方で落ちた 0件。
  - 画像の差分（work 側）：0件 / 54件。
  - 終了の文：「新しく落ちたテストは0件」（exit=0）。webkit は同時に流していない。

### 全件比較の間に main が進んだので、2回載せ直した

比べている間に、.git を共有する他の作業が fetch し、origin/main が2回進んだ。どちらの上にも載せ直した。

1. **4aada0f の上**（16:47）：#643（initEmpty を2回呼ばない・`_beginBootLoad` で initCloudSync/initGitHubSync を包む）と #619（`npm run lint` の集約・pre-push で lint）が入っていた。
   - 衝突：index.html の ?v=（#643 が 2026111682 にしていた）と、docs/char/boot-flow.md §1-5（#643 と同じ所に段落を足していた）。boot-flow.md は両方の段落を残した（#643 の「読込の間は保存が待つ」が先、次に同期欄の移り変わり）。直した行は #643 が作った中の関数（`_initCloudSyncLoad`・`_initGitHubSyncLoad`）の中へ自動で移った。
   - 流し直し（10ファイル・85本・4並列）：**83 passed・1 skipped・1 failed**（2.6分・`tmp/648/step5-specs-on643.txt`）。新しい spec 6本と #643 の first-run-save-during-init-empty.spec.js は緑。
   - 落ちた1本は book-memo-file-lifecycle.spec.js:253「長文メモのファイルが取り残されない: GitHub」（「本 B0MEMO5941 が保存先に届く」の5秒の待ちが切れた）。この1本を単独（1並列）で `--repeat-each=3` で流すと、6種×3回＝**18本すべて緑**（1.2分・`tmp/648/step5-bookmemo-rerun.txt`）。4並列の負荷による揺れと判定した。直した初期化の経路の同期欄の文字とは別の所（長文メモの保存）。
   - skipped が4本→1本になったのは、#614 が book-memo-file-lifecycle の fixme（#594）を3本外したため。
   - `npm run lint`（#619 の集約）：exit=0。
2. **985e770 の上**（16:53・いまの土台）：#639（読込時・書き込み時の3択を選ばずに閉じた後の「未保存」・updateSyncStatus の頭に 'held'）が入っていた。
   - 衝突：index.html の ?v= だけ（#639 が sync-failure.js を 2026111691、js/bookshelf.js を 2026111692 にしていた）。sync-failure.js は main の値のまま、js/bookshelf.js を **2026111699** にした（main の最大 2026111693 より新しい）。js/bookshelf.js は自動で合わさった（直した行は L3192・L3330。updateSyncStatus には触っていないので #639 の 'held' と文面の衝突は無い）。
   - 流し直し（新しい spec・#643 の first-run-save-during-init-empty・#639 の load-conflict-unsaved・save-failure-visible・first-run-add-article-drawer）：**22 passed・失敗0**（57秒・`tmp/648/step5-specs-on639.txt`）。
   - `npm run check:version -- --range=origin/main..HEAD`：OK。`git diff --stat` は自分の5ファイルだけ（+475/-4）。
3. いまの土台（985e770）の上では、全件比較（e2e-diff）は流し直していない（1回目に約10分かかり、この run の時間に入らないため）。push の前に main がさらに進んでいれば、step6 でもう一度載せ直しが要る。

### ②の判断（2026-11-14 16:55）

全件比較は 985e770 の上で流し直さなくてよい（push の後の CI を最後の確認とする）。push の前に book-memo-file-lifecycle:253（GitHub）を単独で1回流して緑を確かめる。main が進んでいたら載せ直す。

## step6 push・CI の確認（2026-11-14 16:55〜）

### push の前の確かめ（土台 985e770 のまま・main は進んでいなかった）

- book-memo-file-lifecycle.spec.js:253 の GitHub を単独（1並列）で1回：**2 passed**（GitHub・GitHub の使えない時の2種・10.2s・`tmp/648/step6-bookmemo-github.txt`）。
- `npm run lint`（全 lint:* の集約・#619）：**12 本中 0 本失敗**。`npm test`（vitest）：**Test Files 77 passed・Tests 1156 passed / 2 todo**。`npm run check:version -- --range=origin/main..HEAD`：OK。
- push の直前に fetch し直して、origin/main が 985e770 のまま（早送りで送れる）こと、送る6つの commit すべてに `Issue: #648` があることを確かめた。

### push

- `BOOKSHELF_ISSUE=648 git push origin 36eba5e:main` → `985e770..36eba5e`（16:57:24）。pre-push の lint は 12 本中 0 本失敗。
- main に入った commit：711ab46（step1 の記録）・b6a9490（step2 の記録）・04c0055（E2E）・2a06379（直し）・d8eb4b4（step4 の記録）・36eba5e（step5 の記録）。

### CI（push した 36eba5e・check-runs を50秒おきに読んだ・`tmp/648/step6-ci.txt`）

| 時刻 | test (char) | test (e2e) | test (webkit) | test (audit) | build | deploy | report-build-status |
|---|---|---|---|---|---|---|---|
| 16:58:13 | 実行中 | 実行中 | 実行中 | 実行中 | 実行中 | – | – |
| 16:59:03 | 実行中 | 実行中 | 実行中 | 実行中 | 成功 | 成功 | 成功 |
| 17:00:44 | **成功** | 実行中 | 実行中 | 実行中 | 成功 | 成功 | 成功 |
| 17:01:34（push から約4分10秒・最後の読み） | 成功 | 実行中 | 実行中 | 実行中 | 成功 | 成功 | 成功 |

- 判定（最大5分の代替判定）：**失敗0件**。成功4件（test (char)・build・deploy・report-build-status）。**終わっていない job は3件**（test (e2e)・test (webkit)・test (audit)）。次の読みは5分の上限（17:02:24）を越えるので、ここで止めた。
- 赤が無いので、自分の push より前の commit との比べ（②の指示4）は要らなかった。
- run：https://github.com/hahero-asayake/bookshelf/actions/runs/43573488028（test 系）・43573487054（build）。
