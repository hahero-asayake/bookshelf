# #476 step1: 直近CI runの失敗内訳（2026-11-02 04:0x〜04:10実測）

## 取得方法・制約

- `gh`未インストール＝GitHub REST（未認証）の `commits/{sha}/check-runs` → `check-runs/{id}/annotations` で取得（#349の型・405-ci-breakdown.mdと同じ手順）。
- レート制限内（60/h）で3run分を取得。すべて取得できた＝「未取得」なし。
- annotationsのうち「E2E 1回目失敗テスト一覧」1本のmessageはGitHub Actions workflow commandの長さ制限でtruncateされる場合がある（a1814ccで実測：4097文字で`[FAIL] [chromium] › sort-perf`の途中で切れた）。ただし「合計N件」annotationの件数と、実際に数えた行数が一致していたため（下記参照）、3runとも**全件が読めている**と判断した。

## 対象run

| commit | run | testジョブ結果 | annotations_count |
|---|---|---|---|
| `5c003f5`（#405のCI・初回報告） | 123158989000 | failure | 7 |
| `a1814cc`（②差し戻し後） | 124890673077 | failure | 8 |
| `18bebfc`（#442・直近） | 124944742931 | failure | 8 |

直近runはこの2本（`18bebfc`/`a1814cc`）で、依頼文にある「他に2〜3本」はこれ以上origin/main直系のtest失敗runが無く（両方の直前commit`e68d2e5`はdocsのみでCIはスキップ対象外だが確認上は同じ2件失敗、という程度まで遡及する価値は薄いと判断し）、`5c003f5`を比較対象として追加した3本で十分と判断した。

## 1回目失敗の内訳（3run比較）

| commit | 1回目失敗合計 | 内訳 | 最終残り（test job結果） |
|---|---|---|---|
| `5c003f5` | 14件 | bookshelf-clip-373×1・bookshelf-clip-385×12・cover-cache-sw×1 | ① cover-cache-sw（`reqCount` expected 0, received 8） |
| `a1814cc` | 17件 | bookshelf-clip-373×1・bookshelf-clip-385×12・cover-cache-sw×1・publish-article-editor(#430 skip対象)×2・sort-perf-budget×1 | ① sort-perf-budget（direction inputDelay中央値374.9ms > 320ms） ② cover-cache-sw（`reqCount` expected 0, received 8） |
| `18bebfc` | 16件 | bookshelf-clip-373×1・bookshelf-clip-385×12・cover-cache-sw×1・sort-perf-budget×1・ux-p2-settings×1(#430 skip対象) | ① sort-perf-budget（direction inputDelay中央値509.5ms > 320ms） ② cover-cache-sw（`reqCount` expected 0, received 8） |

- **bookshelf-clip-373／bookshelf-clip-385（13件）**：3runすべてで1回目失敗するが、最終的には毎回retryで回復（「最終残り」に出てこない）＝webkit実機再現系で1回目だけ不安定になる既知の揺れ（projectノート記載のWebKit系の既知フレーク）。退行の証拠なし。
- **publish-article-editor×2／ux-p2-settings×1**：07_残検討事項#430由来節に「test.skip中」と明記済みの既知項目（1920x1080幅テストは#442でunskip済みのはずが一覧に出たのは差し戻し前のa1814cc時点のスナップショットのため。ux-p2-settingsは現在もtest.skip中）。今回のスコープ外。

## 「最終残り」＝CI test jobを赤くしている直接原因（2件・3run共通）

| commit | spec:line | メッセージ要旨 | retryで回復したか | 分類 |
|---|---|---|---|---|
| 5c003f5/a1814cc/18bebfc | `tests/e2e/cover-cache-sw.spec.js:71`（1行目のtest宣言位置） / 失敗箇所は118行目 | `expect(reqCount).toBe(0)` → `Expected: 0, Received: 8`（2回目ロードでも別オリジン表紙リクエストが8件発生） | 3run連続で最終失敗（retry後も残る） | **未確定＝要調査（step2）**。brief記載の2系統（テストのタイミング／アプリのキャッシュ）のどちらかは本ステップでは未特定。 |
| a1814cc/18bebfc | `tests/e2e/sort-perf-budget.spec.js:151`（test宣言）/ 失敗箇所は170行目 | `direction`操作の`maxInputDelay`中央値がBUDGET.direction.inputDelay=320msを超過。a1814cc=374.9ms／18bebfc=509.5ms（**超過幅が増えている**） | 2run連続で最終失敗 | **未確定＝要調査（step3）**。失敗指標が405-ci-breakdown.md時点の`tFrame`ではなく`maxInputDelay`（別の列）である点に注意。 |
| 5c003f5 | 同上 | このrunでは`sort-perf-budget`は1回目から失敗一覧に出ていない＝**この時点ではsort-perf-budgetは落ちていない**。cover-cache-swのみ最終失敗。 | - | - |

## 405-ci-breakdown.mdとの比較（新規／既知の切り分け）

- **cover-cache-sw**：405-ci-breakdown.mdには記載が無い＝`5c003f5`（#405のCI）で**新規に出た**。brief記載の経緯「retryで13/14件が回復した後に最後まで残った」と`5c003f5`の実測（14件→最終1件）が一致。以後`a1814cc`・`18bebfc`でも継続＝一度も緑に戻っていない。
- **sort-perf-budget**：405-ci-breakdown.mdの1b61b06/f01c257/03a64d5では`tFrame`列（order/drag）の超過で3/3失敗、#405のd331fb9で対策（reps 3→5・中央値判定は維持・最大値は記録のみ）後、`5c003f5`では一旦解消（1回目失敗一覧に出ない）。ところが`a1814cc`・`18bebfc`では**別の列（`direction`のmaxInputDelay）**で再発＝「#405の対策が効いていない」のではなく「#405が対策した指標とは別の指標で新たに閾値を超えた」という状態。これは数値・原因ともにstep3で深掘りが必要。
- **critical-path.spec.js／import-bookmarklet-progress.spec.js**：07_残検討事項.md #430由来節に記載あり（`critical-path.spec.js:37`1件・`import-bookmarklet-progress.spec.js:94/117/171`3件、origin/main(a1814cc)の一時worktreeで確認済みと記載）。**ただし今回取得した3run（5c003f5/a1814cc/18bebfc）いずれの「1回目失敗テスト一覧」にもこの4件は出現していない**（件数内訳が「合計N件」の数値と1件単位まで一致するため、truncateで見えなくなっているのではなく実際に無い）。つまりCI実行では現在このテストは失敗条件を満たしていない可能性がある＝07の「origin/main時点から失敗」という記述と、直近3回のCI実測は一致しない。ローカル/本番での再現性・CIとの環境差（ヘッドレス条件・ネットワーク・ハブAPIモック等）をstep4で確認する必要がある（**未確認**として引き渡す）。

## 分類まとめ（1〜2行報告用の下書き）

1. cover-cache-sw：3run連続で最終失敗・一度も回復していない＝**退行の可能性が高い**（アプリ側キャッシュかテストタイミングかは未特定、step2へ）。
2. sort-perf-budget：`5c003f5`では一旦解消したが`a1814cc`以降`direction`のinputDelayで再発・超過幅が374.9ms→509.5msと増加傾向＝**負荷依存とは言い切れず、数値での深掘りが必要**（step3へ）。
3. critical-path／import-bookmarklet-progress：直近3回のCI testジョブの失敗一覧には出現していない＝CI上は「落ちていない」ように見える。07の記載（origin/main時点から失敗）と矛盾するため、再現条件の違いをstep4で特定する（**未確認**）。
4. bookshelf-clip-373/385・publish-article-editor(#430 skip)・ux-p2-settings(#430 skip)：3runとも既知・スコープ外（前者はretryで回復するフレーク、後者2つは07に記載済みのtest.skip対象）。

## step3追記（2026-11-02 04:22〜04:27実測）：sort-perf-budgetの再発原因を数値で示す

### 判定方式は#405のまま変更されていない

`git show d331fb9`（#405のcommit）で確認：reps=3→5の中央値判定に強化、最大値は記録のみ（判定しない）、BUDGET自体は不変（#377方針）。`git diff origin/main -- tests/e2e/sort-perf-budget.spec.js`は空＝現在のHEAD(18bebfc)もこの方式のまま。**#405の対策は今も有効に効いている**。#406（本棚仮想化・step0 tp_reviewで止まったまま）の変更は`git diff origin/main..HEAD -- tests/e2e/sort-perf-budget.spec.js`に出ない＝競合なし。

### アプリ側(js/css)にa1814cc→18bebfc間で並び替え処理への変更は無い

`git diff a1814cc..18bebfc --stat -- js/ css/ index.html sw.js`：変更は`css/bookshelf.css`(17行)・`index.html`(140行、大半は?v=バンプ)・`js/bookshelf.js`(71行)のみ。全て#442（記事カード3行化・公開の設定モーダル集約）関連で、`.pp-*`(公開パネル)・`.art-cv-*`(記事エディタ)・`SETTINGS_CATEGORIES`・`openPublishSettingsModal`等に限られる。本棚一覧の並び替え(`applySorting`/`_bookCardKey`/`#bookshelf`/`.book-item`/`reorderBooks`)に触れる行は1件も無い（grep確認済み）。→**アプリの退行ではない**。

### 数値比較：無負荷ローカル vs CI実測 vs 負荷再現ローカル

BUDGET: `order{tFrame:380,inputDelay:420}` `direction{tFrame:340,inputDelay:320}` `drag{tFrame:120,inputDelay:80}`（いずれも中央値で判定、ms）

| 条件 | 操作 | tFrame中央値 | inputDelay中央値 | 判定 |
|---|---|---|---|---|
| ローカル単体実行(1 worker・CPUx6のみ・無追加負荷) | order | 80 | 50 | pass(余裕大) |
| ローカル単体実行(同上) | direction | 76 | 46 | pass(余裕大) |
| CI `a1814cc`(全50ファイル8worker並列) | direction | - | **374.9**(>320) | **fail** |
| CI `18bebfc`(同上) | direction | - | **509.5**(>320) | **fail** |
| ローカル+host CPU競合再現1(14個burnerプロセスでload average 17〜19) | order | **397.7**(>380) | 314 | **fail**(tFrame超過) |
| ローカル+host CPU競合再現2(load average 19〜22) | order | - | **685.6**(>420) | **fail**(inputDelay超過) |
| ローカル+host CPU競合再現3(load average 22〜23) | order | - | **566.2**(>420) | **fail**(inputDelay超過) |

再現方法：16コアのこの環境で`while true; do :; done`を14プロセス起動し、host CPUを専有させてから（単体のCDP CPUx6スロットリングに加えて、ホスト自体のスケジューリング競合を作る）同テストを実行。CIランナー(2コア想定の`ubuntu-latest`で8 worker分のchromiumを並列実行)のホスト側コンテンションを粗く模している。

### 結論

sort-perf-budgetの再発は**アプリの退行ではなく、CI環境のホストCPU競合（全50ファイルを8 worker並列実行する際の、ランナーの実コア数を超えるchromiumインスタンス間の奪い合い）が原因**。無負荷のローカル実行ではBUDGETに対して3〜8倍の余裕があるが、host競合が強い状態を人為的に再現すると、CIで観測された超過と同じ性質（中央値そのものが数百ms単位で悪化）が3回連続で再現した。失敗する指標（order/direction、tFrame/inputDelay）は実行ごとに変わり一貫しない＝単発の外れ値ではなく、競合の強さに応じて全指標が広く悪化する系統的な現象。

反復数を増やす対策（#405のreps=3→5と同種の緩和）について：今回の再現では中央値そのものが持続的に悪化しており、外れ値ではないため、reps数をさらに増やしても中央値自体は下がらない可能性が高い＝**reps増加だけでは今回の再発を防げない**と判断。#377の方針（上限の削除・警告化はしない）に従い、ここではBUDGET値もreps数も変更しない。上限値を緩和する判断が必要であれば、この数値（無負荷との差3〜8倍）を根拠にstep5のtpで②に諮る。

## step4追記（2026-11-02 04:28〜04:35実測）：critical-path・import-bookmarklet-progressの原因特定と修正

### 07_残検討事項の#430由来節で件数・名前を確認（出典確認済み）

`07_残検討事項.md:885`：「`critical-path.spec.js`(1件)・`import-bookmarklet-progress.spec.js`(3件)がorigin/main時点から失敗。#442のnpm run test:e2e全件実行で発見、origin/main(a1814cc)の一時worktreeでも同じ理由で失敗することを確認済み(#442の変更由来ではない)。`critical-path.spec.js:37` 初回→取込→公開→課金→退会の通し、`import-bookmarklet-progress.spec.js:94/117/171` hub relay/postMessage/clipboard経由の進捗表示検証。根本原因は未調査」。

### ローカル単独実行で再現・失敗メッセージ取得

- `critical-path.spec.js`（PORT=8176のworktreeで単独実行）：`課金: アップグレード→決済戻り→Plus反映`のstepで`#sidebar-account-plan`が10秒待っても「無料」のまま（期待値「Plus」）。
- `import-bookmarklet-progress.spec.js`（同条件）：94/117/171行目の3件とも失敗（4件目のcsrfToken不在ケースのみpass）。`waitForMidProgress`が30秒timeoutで中間表示(n<total)を一度も検知できない。

### 原因確定：アプリの退行ではなく、テストのモックにポート番号がハードコードされていた（テスト側の前提の誤り）

- `tests/e2e/critical-path.spec.js:56`：Stripe checkoutモックの戻りURLが`'http://localhost:8000/index.html?billing=success'`に固定されていた。worktree環境(PORT=8176)では実際のサーバーと一致せず、`location.href`遷移後のページ再初期化(`_handleBillingReturn`→`_pollPlusActivation`)が働かなかった。
- `tests/e2e/import-bookmarklet-progress.spec.js:58,75`：Amazon ajax・hub relayモックの`Access-Control-Allow-Origin`ヘッダーが`'http://localhost:8000'`に固定されていた。アプリ側のbookmarkletコード(`js/bookshelf.js:14361`)は`fetch(...,{credentials:"include"})`で呼んでいるため、実際のオリジン(PORT=8176)と不一致だとブラウザがCORSで拒否し、進捗が一度も更新されなかった(`Access-Control-Allow-Origin:'*'`は`credentials:"include"`とは併用できないため、動的化が必須)。
- アプリ側(js/bookshelf.js)にポートのハードコードは無い。`_startCheckout`はhub APIが返したURLへ`location.href`で遷移するだけ、bookmarkletのfetchも相対/絶対URLをそのまま使うだけで、いずれもテスト環境のポートに依存するロジックは持たない。→**アプリの退行の証拠なし**。

### 出典：なぜ今まで問題にならなかったか

両ファイルの最古commit（`critical-path.spec.js`=`df4d4bb`、`import-bookmarklet-progress.spec.js`=`f1c2433`、いずれも2026-08時点）は、2026-11-01の**イシュー#413（worktree分離の有効化・projectノート記載）以前**に書かれている。#413以前は全イシューが同一ポート(既定8000)で動いていたため、ハードコードは無害だった。#413でworktree分離が有効化され`PORT=8100+番号下2桁`という規則(例: #476→8176)が導入されたことで、このハードコードが初めて問題として表面化した。つまり**仕様変更でもアプリの変更でもなく、テスト実行環境（ポート割り当て方式）の変化にテストのモックが追従していなかった**。CI（`ubuntu-latest`、`PORT`環境変数を設定していない=既定の8000のまま）ではポートが一致するため問題が起きず、これがstep1で見つけた「直近3回のCI test jobの1回目失敗一覧にこの4件が一度も出現しない」という観測と整合する。07の「origin/main(a1814cc)の一時worktreeでも失敗」という記述は、#442調査時に一時worktree（恐らくPORT≠8000）で検証したために同じ罠にかかった結果と考えられる。

→ **判断：テスト側を修正（アプリ側js/は無変更）**。出典：#413（projectノート記載・worktree分離有効化日2026-11-01）とテストファイルの最古commit日時（2026-08、#413より前）。

### 修正内容

- `tests/e2e/critical-path.spec.js`：checkoutモックの戻りURLを`` `${new URL(page.url()).origin}/index.html?billing=success` ``へ変更（実行中のページのoriginを動的に使う）。
- `tests/e2e/import-bookmarklet-progress.spec.js`：両モックの`Access-Control-Allow-Origin`を`route.request().headers()['origin'] || '*'`へ変更（リクエストのOriginヘッダーをそのまま返す、CORSモックの一般的な型）。

### 検証

修正後、PORT=8176のworktreeで`critical-path.spec.js`・`import-bookmarklet-progress.spec.js`を単独実行→**5件全てpass**（6.0秒）。`npm test`（vitest）も実行→**44 test files / 746 tests / 2 todo、全てpass**。`npm run test:e2e`フルスイートはバックグラウンドで実行中（結果は次に回す）。

### フルスイート実行結果（2026-11-02 04:34〜04:38実測・PORT=8176）

- `npm test`（vitest）：**44 test files / 746 tests passed / 2 todo**、失敗0件。
- `npm run test:e2e`（playwright、retries=1）：**553 passed / 14 skipped / 0 failed**（3.0分）。retry・flakyの記録なし＝全テストが1回目で通過。cover-cache-sw・sort-perf-budget（本ステップ時点では無負荷のため中央値が余裕内）・critical-path・import-bookmarklet-progressいずれも含めて赤なし。

他に新規の赤は無いことを確認した。
