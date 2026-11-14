# イシュー#647 step1：E2E の画像以外の外部通信の実測（変更前）・棚卸し・止め方

- 対象：origin/main 98de66d（#637 の反映後・worktree issue-647・変更なし）・2026-11-14 16:10〜16:18
- 結論：**変更前の漏れは #637 の修正後の計測と同じ4 spec・14件**（下の (3)）。②が承認時に決めた方針（a＝案B・b＝401 を返す）と、(5) で読んだアプリの分岐は矛盾しない。spec の中の route は fulfill ではなく `route.abort('namenotresolved')`（今と同じ失敗）を推す。

## (1) #637 の反映

- 16:10 の時点では未反映だった（origin/main 51f29dd・issue/637 は bb118e9）。待たずに（最大待ち時間0分）、issue/637 の計測の道具を `_local/647/` へ出して計測を始めた。
- **16:13 に再確認したら反映済み**：origin/main 98de66d「fix: E2E・画像比較が表紙の画像を本物の Amazon へ取りに行かないようにする」。scripts/check-e2e-external.mjs・scripts/verify/external-requests-hook.cjs・external-requests-report.mjs が main にある。
- worktree を 98de66d へ fast-forward した。計測は main に入った道具で流し直した（hook はブランチから出した物と `cmp` で同一）。
- → step2 は、#637 に依存する分（cover-cache-sw.spec.js への blockExternalForTest・ALLOW の B・unit test・受け皿）も含めて進められる。main 上の位置：
  - ALLOW は scripts/check-e2e-external.mjs:29（A）・:33（B）。
  - unit test は tests/unit/check-e2e-external.test.js:53-72 が cover-cache-sw を前提にしている。

## (2) 重なり（16:17・#637 の反映後）

- 全 issue/* ブランチの差分、全 worktree と本体の checkout の未 commit 差分で、対象ファイル（publish-panel・overlay-front・back-nav-matrix・cover-cache-sw・test-base.js・check-e2e-external の lint と unit test）を触っているのは0件。
- #635 は main に入った（99b5c97 ほか）。#637 も main に入った（98de66d）。#645 は差分0。

## (3) 変更前の実測（要求単位・chromium・対象の4 spec だけ）

`EXTREQ_DIR=_local/647/extreq-before EXTREQ_RUN=chromium NODE_OPTIONS=--require=./scripts/verify/external-requests-hook.cjs E2E_SKIP_KNOWN_RED=1 PORT=8147 npx playwright test --project=chromium --workers=4 <4 spec>` → **146 passed（3.8分）**。集計は `node scripts/verify/external-requests-report.mjs _local/647/extreq-before chromium`。

| ホスト | 要求 | route で返した | 実通信 | 外へ向かって失敗 |
|---|---:|---:|---:|---:|
| images-na.ssl-images-amazon.com（画像） | 1534 | 1534 | 0 | 0 |
| pagead2.googlesyndication.com | 160 | 157 | 0 | **3** |
| hub.example.test | 17 | 9 | 0 | **8** |
| api.github.com | 2 | 0 | **2** | 0 |
| hub.example.invalid | 1 | 0 | 0 | **1** |

外へ出た要求（spec 別）は14件で、#637 の修正後の計測（issue-637/_local/637/extreq-after-report.md）と一致した。

| spec | ホスト・URL | 結果 | 件数 |
|---|---|---|---:|
| overlay-front.spec.js（4テスト×2幅） | https://hub.example.test/usage | 外へ向かって失敗（ERR_NAME_NOT_RESOLVED） | 8 |
| cover-cache-sw.spec.js | https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=… | 外へ向かって失敗（ERR_CONNECTION_REFUSED＝この機械の NextDNS。CI では本物に届きうる） | 3 |
| publish-panel.spec.js（:144・:172 の github:true） | https://api.github.com/user/installations?per_page=100 | **実通信**（401・serverAddr 20.27.177.116＝#637 の記録） | 2 |
| back-nav-matrix.spec.js（R13） | https://hub.example.invalid/usage | 外へ向かって失敗（ERR_NAME_NOT_RESOLVED） | 1 |

- 中断した1回目（51f29dd・77/146 で止まった）の記録も、同じ14件を含んでいた（`_local/647/extreq-before-partial`）。
- gate-webkit と visual は、#637 の修正後の計測で0件だった（同じレポート）。step3 で3本とも流し直す。

## (4) 静的な棚卸し（同じ種類を全部洗う）

tests/e2e・tests/visual を grep した（URL の形で書かれた所。helpers を含む）。動的計測は #637 の修正後の chromium・gate-webkit の記録（issue-637/_local/637/extreq-after-report.md）。

| ホスト | 使う所（grep） | 動的計測（#637 の修正後） |
|---|---|---|
| hub.example.test | account-billing・account-username・overlay-front・publish-panel・ux-h-series | chromium 31要求・route 23・**外へ向かって失敗8（overlay-front の /usage）** |
| hub.example.invalid | back-nav-matrix（R13 :738・:1347） | chromium 1要求・**外へ向かって失敗1（R13 の /usage）** |
| hub.example | char/settings-shelves-nav・char/states・onboarding-and-prefs・plugin-seed・startup-background-sync・usage-alert | chromium 254・全部 route |
| mock-hub.example | import-bookmarklet-progress | chromium 1・route |
| mockhub.test | char の3本・critical-path・first-run-add-article-drawer・publish-article-editor・publish-conflict-hub・publish-target-demotion・report-moderation・settings-admin-section・username-publish-gate・helpers/gate-hub.js・helpers/gate-network.js | chromium 4486・gate-webkit 1811・全部 route かテストが止めた |
| billing.mock.test | helpers/gate-hub.js | chromium 11・gate-webkit 11・全部 route かテストが止めた |
| api.github.com | boot-confirm-dialog・github-sync-resilience・online-resync・preview-real-adapter・sync-chosen-mark・sync-offline-reconnect・username-publish-gate・helpers/gate-github.js・helpers/storage-fakes.js。publish-panel は token だけを置き、URL はアプリ（js/screens/settings.js:568）が組む | chromium 2689・route 2673・テストが止めた8・**実通信2（publish-panel）**。gate-webkit 213・全部 route |
| pagead2.googlesyndication.com | index.html の静的な script（全 spec） | chromium 930・route 927・**外へ向かって失敗3（cover-cache-sw）**。gate-webkit 68・visual 54・全部 route |
| example.org・example.com | back-nav-matrix（?report= の値）・char/settings-shelves-nav（メールと通報の URL の値） | 要求先ではない（引数の値） |

動的計測で見えない所：

- E2E_SKIP_KNOWN_RED で飛ぶ2本（docs/gate/known-red.json の @gate J2-6・J2-5・#622）：取込（フォルダ）の門。tests/e2e/gate/*.spec.js には偽のホストも api.github.com も直接は書かれていない（ハブ・GitHub は helpers/gate-*.js が route する）。
- env で飛ぶテスト：上の表の spec に env による skip は無い。env を読むのは back-nav-matrix:111・publish-target-demotion:14・report-moderation:80 だけで、どれも撮影の出し分け。
- BACKNAV_WEBKIT=1 の webkit project（playwright.config.js:5-7・CI の外）：対象の7 spec のうち偽のホストを使うのは overlay-front と back-nav-matrix だけ。spec の中の route で同時に止まる。

## (5) アプリ側の分岐

- **api.github.com/user/installations**：
  - 設定の同期欄で GitHub の token がある時（js/screens/settings.js:318-326 の「接続済み」の表示）に `_loadGitHubRepos`（:334）が呼ばれる。そこから `_fetchAccessibleRepos`（:568）が照会する。
  - 401 だと throw され、:385 の catch で repo の select に「取得失敗」を出す。上部バーに出すのは同期先が GitHub の時だけ。
  - 200（installations が空）だと「GitHub App 未インストール」と install の案内を出す。
  - 「接続済み」の表示は token の有無で決まり、API の成否では変わらない。publish-panel の :144・:172 は同期先が local（:44）で、公開パネルを見るテスト＝401 でも 200 でも判定は同じ。
  - → ②の決定 b)（実測と同じ 401 を route で返す）と矛盾しない。200 の案は要らない。
- **/usage**：
  - `HubAuth.refreshUsage`（js/hub-auth.js:134）が成功すると、cfg.hub に plan・quotaBytes・usedBytes・isAdmin・username など13項目を書き戻す（:143-160）。設定の `_refreshHubUsage`（js/screens/settings.js:1263）は、使用量バー・アカウントの印・使用量の注意（`_renderUsageAlert`）を描き直す。
  - 失敗（名前解決の失敗＝TypeError）は console.warn だけで、何も描かない（:1274-1277）。exporter.js:57・:262 は握りつぶす。
  - overlay-front は「設定モーダルの中心で、いちばん手前にある要素」を見るテスト。/usage を成功で返すと設定モーダルの中身（使用量バー・注意）が変わり、判定に効きうる。「ハブ認証切れ」のテスト（:148-152）は publishArticleStore.load が HubAuthError を投げる形で作っていて、/usage とは別。
  - R13 の hub には plan・username が無い（:738）。成功で返すと username などが入り、ログインの見え方が変わりうる（テストは、通報と確認のどちらでも1段なら通る）。
  - → spec の中の route は、fulfill ではなく `route.abort('namenotresolved')`（今と同じ失敗）にするのが「テストの意図を変えない」。publish-panel.spec.js:50 の /usage の fulfill は、既存のまま変えない。

## (6) 方針（②の承認時の決定との突き合わせ）

- a) 案B：矛盾なし。
  - spec の中の route（overlay-front の boot の /usage と、R13 の hub.example.invalid）は `route.abort('namenotresolved')` にする（(5) の理由）。
  - 受け皿は test-base.js の blockExternalForTest へ足す（#637 は 98de66d で反映済み＝step2 でやる）。予約済みの名前（.test・.invalid・.example）を RegExp で狭く書く（localhost・127.0.0.1 には当たらない）。関数での照合にしない＝全要求の横取りにならないようにする（Playwright の照合の場所は未確認なので、step3 の時間で確かめる）。
  - 実行時間は step3 の chromium の全体を、#637 の修正後（4.9分・802 passed）と比べる。10%以上延びたら案A に戻す。
- b) 401：矛盾なし。200 は要らない。

## step2：直したこと・確かめたこと（2026-11-14 16:21〜16:30・origin/main 3a0d720 の上・未 commit）

### 直したこと

- tests/e2e/publish-panel.spec.js（boot）：github:true の時、`https://api.github.com/**` を route して、本物と同じ 401（`{"message":"Bad credentials",...}`）を返す。:33-34 のコメントを「外へは出さず route で返す」に直した。console の除外は残した。
- tests/e2e/overlay-front.spec.js（boot）：`https://hub.example.test/usage` を `route.abort('blockedbyclient')` で止める。
- tests/e2e/back-nav-matrix.spec.js（R13）：`https://hub.example.invalid/**` を `route.abort('blockedbyclient')` で止める。
- tests/e2e/cover-cache-sw.spec.js：自前の context（serviceWorkers:'allow'）に blockExternalForTest を掛けた。関数だけを ./helpers/test-base.js から import し、test 本体の import（ALLOW の A）は変えていない。
- scripts/check-e2e-external.mjs：ALLOW から cover-cache-sw の B を外し、A の理由に「B は例外にしない」と書き足した。
- tests/unit/check-e2e-external.test.js：違反の木で `cover-cache-sw.spec.js:2 [B]` が出ることを1行足した。
- tests/e2e/helpers/test-base.js：blockExternalForTest に予約済みの名前の受け皿を足した。
  - `RESERVED_TEST_HOSTS`＝`/^https?:\/\/[^/?#]*\.(?:test|invalid|example)(?::\d+)?(?:[/?#]|$)/` に当たる要求を `route.abort('blockedbyclient')` で止める。
  - 冒頭のコメント（#637 の段の後）に、なぜ足したかを書いた。

### 止め方を 'namenotresolved' でなく 'blockedbyclient' にした理由（②の決定からの変更）

- 計測の道具（scripts/verify/external-requests-report.mjs:16 の NET_FAIL）は、ERR_NAME_NOT_RESOLVED を「外へ向かって失敗」に数える。'namenotresolved' で止めると、外へ出た要求と見分けられない（②の申し送りの懸念どおり）。
- hook 側で route.abort を記録する案も見た。しかし playwright-core 1.60 は内部の Route クラスを取り出せない（`lib/client/network` は exports の外で、ファイルとしても無い）。
- 'blockedbyclient' でもアプリから見た失敗は同じ（fetch が TypeError で落ちる・失敗の時の分岐は同じ）。違うのは console の文言だけ。
  - overlay-front・back-nav-matrix は console の文言を見ていない（back-nav-matrix:26 は pageerror だけ）。
  - tests・scripts に ERR_NAME_NOT_RESOLVED を見る所は0件（grep）。
- 1件ずつの比較（overlay-front「公開パネルの設定リンク」PC1280・https://hub.example.test/usage）：
  - 変更前は `"error":"net::ERR_NAME_NOT_RESOLVED"` → 外へ向かって失敗。
  - 変更後は `"error":"net::ERR_BLOCKED_BY_CLIENT.Inspector"` → テストが止めた。

### 確かめたこと

- `npm run lint:e2e-external`：OK（151ファイル・例外は cover-cache-sw の A の1件だけ）。`npx vitest run tests/unit/check-e2e-external.test.js`：11 passed。
- 変えた spec を単独で3回ずつ流した（chromium・`--repeat-each=3`・hook 付き）：
  - publish-panel・overlay-front・cover-cache-sw：54 passed。
  - back-nav-matrix の R13（`--grep "R13 URL"`）：3 passed。
  - cover-cache-sw の「3回目のロードで表紙の要求0件」も3回とも通った。
- 同じ run の要求単位の記録（`_local/647/extreq-step2-report.md`）：**外へ出た要求は0件**。

| ホスト | 要求 | route で返した | 実通信 | 外へ向かって失敗 | テストが止めた |
|---|---:|---:|---:|---:|---:|
| images-na.ssl-images-amazon.com（表紙の fulfill） | 400 | 400 | 0 | 0 | 0 |
| pagead2.googlesyndication.com | 66 | 66 | 0 | 0 | 0 |
| hub.example.test | 51 | 27（publish-panel の /usage） | 0 | 0 | 24（overlay-front 8×3） |
| api.github.com | 6 | 6（401） | 0 | 0 | 0 |
| hub.example.invalid | 3 | 0 | 0 | 0 | 3（R13×3） |

- 受け皿の当たる範囲：
  - RegExp の当たり外れを node で確かめた。当たるのは hub.example.test・hub.example.invalid・mockhub.test・billing.mock.test・hub.example・mock-hub.example。
  - 当たらないのは localhost:8147・127.0.0.1（表紙の画像サーバの任意ポートも）・表紙のホスト3つ・pagead2・api.github.com・example.org・foo.test.evil.com。
  - 上の run でも、表紙の fulfill は400件とも route で返っている。
- 受け皿が効くこと：overlay-front の複製から spec の route を消して1件流した（`-g "公開パネルの設定リンク"`・2幅で2 passed）。hub.example.test/usage は受け皿で `ERR_BLOCKED_BY_CLIENT` になり、外へは出なかった（2件）。複製は流した後 `_trash/647/` へ退避した。
- back-nav-matrix の全件を1回（test-base.js を変えたため）：128 passed（3.3分）。外へ出た要求は0件（R13 の1件は「テストが止めた」）。

## step3：3本の再計測（要求単位・2026-11-14 16:33〜16:44・origin/main 3a0d720＋step2 の変更・未 commit）

- #637 依存の項：#637 は 98de66d で反映済み（step2 で全部入れた）＝未実施の項は無い。
- 流し方：#637 と同じ hook（`NODE_OPTIONS=--require=./scripts/verify/external-requests-hook.cjs`・`EXTREQ_DIR=_local/647/extreq-after`）で、3本を同時に流した。
  - `reuseExistingServer:true` なので、ポートを分けた（chromium 8147・gate-webkit 18147・visual 28147）。
  - 機械の負荷は load average 約29（他のイシューの E2E と同時）。
  - 16:31 の1回目は run ごと止められた（visual だけ完走）。記録は `_local/647/extreq-after-killed` に退避し、全部流し直した。
- 集計：`node scripts/verify/external-requests-report.mjs _local/647/extreq-after`（全文は `_local/647/extreq-after-report.md`）。

| run | 結果 | 時間 | 外へ出た要求（実通信＋外へ向かって失敗） |
|---|---|---|---:|
| chromium（`E2E_SKIP_KNOWN_RED=1 --project=chromium --grep-invert "sort-perf-budget"`） | 829 passed・21 skipped・**1 failed** | **4.0分**（851件・8 workers） | **0** |
| gate-webkit（`GATE_WEBKIT=1 E2E_SKIP_KNOWN_RED=1 --project=gate-webkit --workers=1`） | 39 passed・5 skipped | 3.0分 | **0** |
| visual（`-c playwright.visual.config.js`） | 54 passed | 14.5秒 | **0** |

判定の対象のホスト（変更前＝step1 は対象の4 spec だけ・変更後は3本の全体）：

| run | ホスト | 要求 | route で返した | 実通信 | 外へ向かって失敗 | テストが止めた | 変更前の漏れ（step1） |
|---|---|---:|---:|---:|---:|---:|---|
| chromium | api.github.com | 2874 | 2860 | 0 | 0 | 8 | 実通信2（publish-panel） |
| chromium | pagead2.googlesyndication.com | 967 | 967 | 0 | 0 | 0 | 外へ向かって失敗3（cover-cache-sw） |
| chromium | hub.example.test | 31 | 23 | 0 | 0 | 8（overlay-front） | 外へ向かって失敗8（overlay-front） |
| chromium | hub.example.invalid | 1 | 0 | 0 | 0 | 1（R13） | 外へ向かって失敗1（R13） |
| chromium | hub.example・mock-hub.example | 260 | 260 | 0 | 0 | 1 | — |
| gate-webkit | api.github.com | 220 | 220 | 0 | 0 | 0 | 0 |
| gate-webkit | pagead2.googlesyndication.com | 68 | 68 | 0 | 0 | 0 | 0 |
| visual | pagead2.googlesyndication.com | 54 | 54 | 0 | 0 | 0 | 0 |

- **3本とも、全ホストで「外へ出た要求（spec 別）0件」**。表紙の画像も0件（#637 の範囲が保たれている）。
- 「テストが止めた」の内訳：
  - hub.example.test の8件と hub.example.invalid の1件は、step2 の spec の中の route（`ERR_BLOCKED_BY_CLIENT`）。
  - api.github.com の8件は、既存のテストが自分で止めた分（#637 の修正後の計測でも8件）。
- 受け皿が拾った要求：spec の route が優先されるため、この3本では受け皿まで落ちた要求は無い。受け皿が効くことは step2 の複製で確かめた。

### chromium の1件の赤

- `save-failure-visible.spec.js:256`「GitHub: トークンを更新しても 401 なら、再試行を待たずに『接続し直す』の案内がすぐ出る (イシュー#603)」。:263 の `warnRow` の toBeVisible（10秒）で時間切れになった。
- 今回の変更とは関係ないと判断した：
  - このテストが出した外への要求は104件。すべて route で返っている（api.github.com・oauth proxy・pagead2・serverAddr は全部 null）。失敗した要求（受け皿を含む）は0件。
  - 予約済みの名前は使っていない（:39 の example.com はメールの値）。
- 同じ変更のまま単独で3回流すと 3 passed（4.7秒）＝高負荷（load 29・8 workers・gate-webkit と同時）での揺れと見る。step4 の e2e-diff（base との比較）で、新規落ちかどうかをもう一度確かめる。

### 実行時間（案B の受け皿・10%の基準）

- chromium の全体は **4.0分**（851件）。#637 の修正後は 4.9分（802 passed・21 skipped）。件数は増えたのに短い＝10%以上は延びていない。受け皿は残す（案A に戻さない）。
- どちらも他の run と同時に流した時間で、負荷の条件は揃っていない。比べたのは「延びていないこと」だけ。

### 補助：BACKNAV_WEBKIT=1 --project=webkit（overlay-front・back-nav-matrix・CI の外・判定には入れない）

- 5.5分の上限で打ち切った（exit 124・136件を2 workers・hook の記録でテスト名84種まで到達）。到達した分の合否は数えていない。
- 到達した分の要求（`_local/647/extreq-after-webkit-report.md`）：
  - hub.example.test 8件（overlay-front）と hub.example.invalid 1件（R13）は、すべて「テストが止めた」。
  - pagead2 は133件とも route で返した。
  - **外へ出た要求は0件**。

## step4：回帰の確認（2026-11-14 16:45〜16:57・origin/main 4aada0f＋この変更）

- `node scripts/verify/e2e-diff-main.mjs --port=8147`（visual は既定オン）：**新しく落ちたテストは0件**（またはフレーク判定のみ・判定不能0件）。
  - E2E「新しく落ちた」1件は gate/j2-5-import-no-duplicate.spec.js（@gate J2-5）。e2e-diff が流し直して **flake** と判定した。
    - J2-5 は docs/gate/known-red.json に載っている既知の赤（#622・取込の二度押し）。e2e-diff は E2E_SKIP_KNOWN_RED を付けずに流す。
    - 取込（フォルダ）の門で、予約済みの名前も api.github.com も使わない。
  - E2E「新しく通った」4件（book-memo-file-lifecycle・gate/j3-5・gate/j4-memo・reimport-diff）は、base 側の揺れ（load 約30）。
  - step3 で赤だった save-failure-visible.spec.js:256 は、work 側でも base 側でも落ちていない。
  - vitest：新しく落ちた0件。画像の差分：0件 / 54件。
- `npm run lint`（#619 の集約・ci.yml の lint と同じ12本）：12本中0本失敗。lint:e2e-external は152ファイル・例外1件（cover-cache-sw の A）。lint:known-red は2件・違反0件。
- `npm test`：77ファイル・1151 passed（2 todo）。
- 設計書：01〜06 は変えない（テストだけ・アプリは無変更なので ?v= も不要）。07_残検討事項に、E2E の外部通信に当たる行は無かった（「外部」は別の話題、AdSense の行は本番 Lighthouse の console の件）。
