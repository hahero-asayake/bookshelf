# イシュー#637 step1：E2E・visual が外へ出す画像の要求の実測（変更前）

- 対象：origin/main 6dc2c04（worktree issue-637・変更なしの状態）・2026-11-14 15:18〜15:22
- 結論：**外へ出た画像の要求は chromium の53件だけ。全部 fixture を通らない context から出ていた**（sort-persist.spec.js 48件・github-sync-resilience.spec.js 5件。どちらも images-na.ssl-images-amazon.com）。fixture の context からは3本とも0件（既存の route＝test-base.js:142-147・#57 が返している）。m.media-amazon.com・images-amazon.com への要求は3本とも0件。

## 測り方

計測一式は `_local/637/`（commit しない）。tracked なファイルは変えていない。

- **要求単位**：`NODE_OPTIONS=--require=_local/637/hook.cjs` を付けて流した。hook は BrowserType.launch → Browser.newContext を包み、**全 context**（fixture の context と、spec が `browser.newContext()` で作る context の両方）に request/response/requestfailed の記録を付ける。
  - `response.serverAddr()` が null なら route で返した（ネットワークに出ていない）。値があれば実通信。
  - spec の割り当ては `test.info()`。
- **接続単位**：launch の proxy で、記録用の中継プロキシ（`_local/637/proxy.mjs`）を通した。全 context に効き、SW の通信も含む。
  - CONNECT 先のホストと、トンネルの上り・下りのバイト数を記録した。記録したらそのまま中継し、計測後に止めた。
  - spec の割り当ては JSON レポートの parallelIndex と時刻による近似で、要求単位より粗い。
- 流した範囲（CI と同じ形・1回ずつ・同時に流した）：
  - chromium：`E2E_SKIP_KNOWN_RED=1 npx playwright test --project=chromium --grep-invert "sort-perf-budget"` → 792 passed・21 skipped（3.7分）
  - gate-webkit：`GATE_WEBKIT=1 E2E_SKIP_KNOWN_RED=1 npx playwright test --project=gate-webkit --workers=1` → 35 passed・5 skipped（2.5分）
  - visual：`npx playwright test -c playwright.visual.config.js` → 54 passed（12秒）
- この機械の注意：NextDNS が広告のドメインを 0.0.0.0 に解決するため、pagead2.googlesyndication.com への接続は ECONNREFUSED になる。CI（ubuntu-latest）では本物に届きうる。

## 画像の要求（resourceType=image または sw.js:29 の COVER_HOSTS）

| run | ホスト | 要求 | route で返した | **実通信** | 失敗 |
|---|---|---:|---:|---:|---|
| chromium | images-na.ssl-images-amazon.com | 10205 | 10097 | **53** | 11（net::ERR_FAILED＝テストの route.abort。外へ出ていない） |
| gate-webkit | images-na.ssl-images-amazon.com | 315 | 314 | **0** | 1（WebKit internal error） |
| visual | images-na.ssl-images-amazon.com | 478 | 478 | **0** | 0 |
| 3本とも | m.media-amazon.com・images-amazon.com | 0 | 0 | 0 | 0 |

実通信53件の内訳（要求単位・spec 別）：

| spec | ホスト | 件数 | 外へ出た経路 |
|---|---|---:|---|
| tests/e2e/sort-persist.spec.js | images-na.ssl-images-amazon.com | 48 | :134-135 の `browser.newContext()` に blockExternalForTest を掛けていない |
| tests/e2e/github-sync-resilience.spec.js | images-na.ssl-images-amazon.com | 5 | :12 で `@playwright/test` を直接 import（fixture を通らない） |

接続単位（プロキシ）でも同じ結果になった。chromium で images-na へ34接続、そのうち下り8KB超が3接続（本物の表紙を受け取った）。下りの合計は 266,874 バイト。残りの接続は TLS の握手だけで、Chromium の先回りの接続とみられる。gate-webkit と visual では images-na への接続は0。

## 画像以外（このイシューの範囲外・参考）

route されずに外へ向かった要求：

| spec | ホスト | 件数 | 結果 |
|---|---|---:|---|
| sort-persist.spec.js | pagead2.googlesyndication.com（AdSense） | 8 | この機械では接続拒否（NextDNS）。CI では本物が読まれうる＝#53 と同じ種類 |
| cover-cache-sw.spec.js | pagead2.googlesyndication.com | 3 | 同上 |
| github-sync-resilience.spec.js | pagead2.googlesyndication.com | 2 | 同上 |
| publish-panel.spec.js | api.github.com | 2 | 実通信（route の外） |
| overlay-front.spec.js | hub.example.test | 8 | 名前解決の失敗 |
| back-nav-matrix.spec.js | hub.example.invalid | 1 | 名前解決の失敗 |

- gate-webkit では、bookshelf.asayake.org への要求は5件とも route で返っていた。一方でプロキシには6接続あり、どれも TLS の握手だけで HTTP の要求は通っていない（WebKit の先回りの接続）。
- billing.mock.test への5接続は名前解決の失敗だった。

## route 案と productImage 案の比較（brief やること2）

| 観点 | route 案（推す） | productImage 案 |
|---|---|---|
| 変更の範囲 | test-base.js の blockExternalForTest にホストを2つ足す（予防）。fixture の外で漏れていた2 spec は数行で直す | fixture のデータ十数か所（tests/fixtures/*.json・各 spec のインライン fixture・gate-setup.js:100 など）。漏れていた2 spec のインライン fixture も結局触る |
| visual の絵 | 変わらない。visual は478件とも既存の route（透明PNG）で返っている。足すホストへの要求は0件 | `<img>` の出し分け（hasCoverImage・`book.productImage ? <img> : タイトル`）が変わる。基準画像の撮り直しになる見込み |
| 本番と同じ経路 | 保つ（productImage が空 → ASIN から組み立てる経路を試し続ける） | https の値だと保存 URL の経路しか試さなくなる。https 以外（ローカルの http）の値は getProductImageUrl（book-manager.js:315 は `^https://` だけを採る）で ASIN の組み立てに落ちるため、外へ出るのは止まらない |

→ route 案を推す。ただし今回の53件は fixture の外から出ているので、**共通の fixture の route を増やしても0にはならない**（下の②に諮ること）。

## ②に諮ること（step1 の tp）

1. **漏れていた2 spec を直すか**。ここは brief の「共通の fixture だけ」の外になる。
   - sort-persist.spec.js：:134-135 で作る2つの context に `blockExternalForTest` を掛ける（gate-device.js:29 と同じ形）。
   - github-sync-resilience.spec.js：:12 の import を `./helpers/test-base.js` に替える。
   - どちらでも AdSense の漏れ（8件と2件）が同時に止まる。
   - 重なりの確認：全 issue/* ブランチの commit 差分と、全 worktree の未 commit 差分を確かめた（15:20）。test-base.js・この2 spec・cover-cache-sw.spec.js を触っているイシューは0件。#617（J8）・#628（j3-4 phone）とも重ならない。
   - cover-cache-sw.spec.js は画像の漏れが無いので触らない（申し送りどおり）。
2. **共通の fixture に足すホスト**：m.media-amazon.com・images-amazon.com（sw.js:29 の COVER_HOSTS と揃える）。今回は要求0件なので予防で、visual の絵は変わらない。
3. **計測の口**：fixture の中に置く計測では、今回の漏れ（fixture の外）を見つけられない。案は2つ。
   - (a) 今回の hook＋集計を scripts/verify/ に opt-in の道具として残す（既定の実行には影響しない）。
   - (b) 静的検査（spec が `@playwright/test` を直接 import していない・`browser.newContext()` の後に blockExternalForTest がある）を lint に足す。
   - 推すのは (a)：実際に出た要求を数えられ、SW・fixture の外も覆える。
4. 画像以外の外部通信（AdSense・api.github.com・hub.example.test など）は範囲外。別のイシューにするかは②の判断。

②の結論（15:35）：1 は直す。2 は足す。3 は lint の静的検査を正とし、hook と集計は opt-in の道具として残してよい。4 はこのイシューでは触らず、別件として起票する。

## step2：直したこと・確かめたこと

- `tests/e2e/helpers/test-base.js`：blockExternalForTest で返す表紙のホストを、sw.js の COVER_HOSTS と同じ3つにした（COVER_IMAGE_HOSTS）。固定画像は既存と同じ透明PNG、パターンはホスト単位。
- `tests/e2e/github-sync-resilience.spec.js:12`：import を `./helpers/test-base.js` に替えた。
- `tests/e2e/sort-persist.spec.js:134-140`：2つの context を変数に受け、それぞれに blockExternalForTest を掛けた（gate-device.js と同じ形）。
- lint `npm run lint:e2e-external`（`scripts/check-e2e-external.mjs`・単体テスト `tests/unit/check-e2e-external.test.js` 11件）。ci.yml の lint の一式にもつないだ。
  - 検査すること：A＝@playwright/test から test を import しない、B＝newContext の戻り値を変数に受けて blockExternalForTest を掛ける、C＝browser.newPage を使わない。
  - 例外は理由つきの ALLOW に書く（cover-cache-sw.spec.js の A・B）。該当が無くなった例外も失敗にする。
  - **直す前の main（origin/main 4f1a19b を git archive で出した木・`--root`）では赤**：3件・2ファイル（github-sync-resilience.spec.js:12 [A]・sort-persist.spec.js:134 [B]・:135 [B]）。**直した後は緑**（138ファイル・例外2件）。
- 2つの spec を単独で流した結果（chromium・14件）：14 passed。
  - この2つからの外部要求は全部 route で返った（images-na 264件・pagead2 34件・api.github.com 1件）。実通信0件で、AdSense も外へ出ていない。
- 計測の道具：`scripts/verify/external-requests-hook.cjs`（NODE_OPTIONS で読み込み、EXTREQ_DIR を付けた時だけ動く）と `scripts/verify/external-requests-report.mjs`（表と合計）。
  - step1 の記録に掛けると「外へ出た画像の要求53件」を再現する。直した後の2 spec では0件。

## step3：再計測と確認一式（origin/main 4f1a19b の上に載せ直した cffe616）

### 外へ出た画像の要求（要求単位・変更前と並べる）

同じ方法（全 context の要求単位の記録・`scripts/verify/external-requests-hook.cjs`）で、同じ3本を流した。

| run | 変更前（step1・6dc2c04）画像の要求 / 実通信 | 変更後（cffe616）画像の要求 / route で返した / **実通信** |
|---|---|---|
| chromium | 10205 / **53**（sort-persist 48・github-sync-resilience 5） | 9020 / 8972 / **0**（テストが止めた12・応答前に閉じた36） |
| gate-webkit | 315 / **0** | 360 / 359 / **0** |
| visual | 478 / **0** | 400 / 400 / **0** |

- 2つの spec からの AdSense：変更前は10件（sort-persist 8・github-sync-resilience 2）、変更後は **0件**（spec 別の表に出ない）。
- 画像以外で残っている外への要求（範囲外・別件）：overlay-front 8・cover-cache-sw の AdSense 3（許可リストの spec）・publish-panel の api.github.com 2・back-nav-matrix 1。step1 と同じものだけ。
- 今回はプロキシを通していない。そのため失敗の理由は ERR_NAME_NOT_RESOLVED・ERR_CONNECTION_REFUSED（直接の名前解決・接続）で出ている。

### visual（画像比較）

`npx playwright test -c playwright.visual.config.js` → **54 passed（差分0）**。基準画像は撮り直さない。足したホストへの要求は0件で、既存の images-na は前と同じ透明PNGで返しているため。

### 赤・lint・単体

- chromium（CI と同じ `E2E_SKIP_KNOWN_RED=1 --project=chromium --grep-invert "sort-perf-budget"`）：802 passed・21 skipped・**3 failed**。3本と vitest を同時に流した高負荷の中での結果。
  - duplicate-asin-notice.spec.js:90：`bookshelf.js applyFilters` の null 参照（`reading 'bookshelves'`）。
  - gate/j3-5-many-books.spec.js:29：CPU を6倍遅くした計測で 684ms が基準を超えた。
  - gate/j6-1-local-restart.spec.js:18：60秒の時間切れ。
  - どれも表紙・AdSense の route とは関係しない経路。判定は下の e2e-diff-main による。
- gate-webkit（`GATE_WEBKIT=1 E2E_SKIP_KNOWN_RED=1 --project=gate-webkit --workers=1`）：39 passed・5 skipped・**0 failed**。
- lint 一式（ci.yml の lint:css・e2e-goto・e2e-wait・e2e-external・breakpoint・esc・js-color・internal-refs・e2e-gate・copy・terms・known-red）と `check:version`（range origin/main..HEAD）：**全部 exit 0**。lint:e2e-gate は @gate 41本・違反0・観測点 37/37。
- npm test（vitest）：**75 files・1110 passed・2 todo・0 failed**。
- gate:report（`--dir` に上の結果を置いて集計）：条件2・3が「不合格」と出た。理由は上の J3-5・J6-1・duplicate-asin の3件と、門のE2E が1回しか流れていないこと（3回に満たない）。条件1・4〜8は入力が無く「未実施」（本番URL・人の実機・問題の一覧など。このイシューの範囲外）。

### e2e-diff-main（origin/main と比べた新規落ち）

`node scripts/verify/e2e-diff-main.mjs --port=8137`（15:51〜15:59・visual は既定オン）。1回目は前の run の打ち切りで、main 側の E2E の途中で止まったため、流し直した。

- 比べた相手：base＝origin/main b62b45b（流している間に main が #630 の4 commit 分進んでいた）、work＝作業ツリー（4f1a19b＋このイシューの commit）。
- **E2E：新しく落ちた0件・新しく通った0件・両方で落ちた0件**。base 1012 passed・0 failed、work 1006 passed・0 failed（skipped は両方594）。差の6件は、main に新しく入った sync-github-disconnect.spec.js の分で、work 側には無いテスト。
- **vitest：新しく落ちた0件・新しく通った0件・両方で落ちた0件**。
- **画像の差分：0件 / 54件**。
- 上の chromium の3件（duplicate-asin-notice:90・J3-5・J6-1）は、この流し直しでは work 側で全部通った。判定は、3本と vitest を同時に流した高負荷（負荷平均 約40）による揺れ。表紙の route とは関係しない経路（null 参照・計測時間・時間切れ）でもある。
- main に新しく入った spec（sync-github-disconnect.spec.js）は test-base から import し、newContext も使っていない。step4 で載せ直した後も lint:e2e-external には掛からない。

### まとめ（step3 の完了条件）

| 条件 | 結果 |
|---|---|
| 外へ出た画像の要求（要求単位・chromium・gate-webkit・visual） | 3本とも **0件**（変更前は chromium で53件） |
| 2つの spec からの AdSense | **0件**（変更前は10件） |
| visual の差分 | **0件 / 54件**。撮り直さない |
| chromium・gate-webkit の赤 | gate-webkit 0件。chromium は高負荷の1回目で3件 → e2e-diff-main の流し直しで work 側 0 failed＝揺れ |
| e2e-diff-main の新規落ち | **0件**（E2E・vitest とも） |
| lint 一式（ci.yml の12本）・check:version | **全部 exit 0** |
| npm test（vitest） | **1110 passed・0 failed** |
| 門（lint:e2e-gate・gate:report） | lint:e2e-gate は違反0・観測点 37/37。gate:report の条件2・3は1回目の高負荷の3件のため「不合格」と出た（上の流し直しで揺れと判定）。1・4〜8は入力が無く「未実施」（範囲外） |
