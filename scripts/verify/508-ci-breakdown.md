# #508 step1: CI 5コミット分の実測表

API呼び出し: 計15回使用（内5回はnode未検出で出力を読めずに捨てた失敗試行・残りの10回=check-runs 5 + annotations 5 で有効取得）。残り枠は十分にある。

## 1. 結論・所要時間・failed/skipped の内訳

| commit | 結論 | test job 所要時間 | 1回目失敗(annotation表記の件数) | うち実failed | うちskip(実行時test.skip) | 実failedのテスト名 |
|---|---|---|---|---|---|---|
| a0d90b3 | success | 8m58s (16:37:21→16:46:19) | 14件 | 0 | 14 | (無し) |
| 52f713c (#501・char追加) | **failure** | 11m56s (20:16:37→20:28:33) | 430件 | 2 | 428 | `publish-article-editor.spec.js:619`（長文メモ読込中の進捗N/M・15秒timeout）／`publish-conflict-hub.spec.js:194 (b)`（#502の原因・#504修正前のため再現） |
| b06fdd5 (#504) | **failure** | 11m07s (20:45:51→20:56:58) | 429件 | 1 | 428 | `publish-article-editor.spec.js:619`（同上。#504で(b)は直った後なので1件に減った） |
| 52a1d33 (#506) | success | 11m10s (20:56:28→21:07:38) | 473件 | 0 | 473 | (無し) |
| b7e2a9a (#505, run 41526386211) | success（06:28時点で完了済み・待ち無し） | 11m43s (21:13:58→21:25:41) | 478件 | 0 | 478 | (無し) |

実failed の内訳:
- 52f713c: `publish-article-editor.spec.js:619`（長文メモ読込中の進捗N/M表示・15秒timeout） + `publish-conflict-hub.spec.js:194 (b)`（#502の原因・#504で修正済み、52f713cはその修正前なので再現）
- b06fdd5: `publish-article-editor.spec.js:619` のみ（#504で(b)は直った後なので1件に減っている＝#504の修正は効いている）
- 52a1d33・b7e2a9a: 0件（619も含め全テスト成功）

workers数: 未認証ではジョブのログ本文（"Running N tests using M workers"）を取れないため、**設定からの導出**で確定させた（API呼び出しはしていない）:
- `playwright.config.js` に `workers`/`retries` の指定は無い（全コミットで同じ、`git log -p -- playwright.config.js` で履歴確認済み）。
- 共有 node_modules (`/home/kuroko/worktrees/bookshelf/node_modules/playwright/lib/common/index.js:587`) を直接読んだ。`workers` 未指定時の既定値は `"50%"`（`resolveWorkers("50%")` → `Math.max(1, Math.floor(cpus/2))`）。
- CI ランナーのCPU数は `hardwareConcurrency=4`（各annotationの `[sort-perf-gpu]` 行で実測済み・5コミット共通）。
- → **workers=2（floor(4/2)）が既定で全5コミット共通**。ci.yml:60 のコメント「8 worker」は現行の設定・実機CPU数と食い違う（過去の値が残っているか誤記）。

retries数: `node_modules/playwright/lib/common/index.js:641` `retries: takeFirst(..., 0)` ＝未指定時は **0**。リポジトリ内に `retries` を設定している箇所は無い（`grep -rn retries` で確認、`scripts/verify/e2e-diff-main.mjs` の `--retries`はこのスクリプト独自のCLI引数で playwright.config.js とは無関係）。**→ CIのplaywrightには実際のリトライは1回も発生していない。**

## 2. annotationの「1回目の実行で N 件が失敗（リトライで通ったFLAKY含む）」の正体（最重要の発見）

`scripts/ci-annotate-failures.mjs:74-75` を読むと:
```js
const firstResult = test.results?.[0];
if (!firstResult || firstResult.status === 'passed') continue;
```
これは「1回目の結果が passed 以外なら『1回目失敗』として数える」実装。しかし **retries=0 なのでFLAKY（リトライで通った）は原理的に発生しない**（test.statusが'flaky'になるのは複数回実行されて最後が通った場合のみ）。実際、annotationの文面「リトライで通ったFLAKY含む」は`ci-annotate-failures.mjs:91`の**固定文言**であり、実際にFLAKYが1件もない回でも無条件に出る。

さらに重要なのは、この判定が **`status === 'skipped'`（実行時に `test.skip()` で意図的にスキップされたテスト）を除外していない**こと。`tests/e2e/char/*.spec.js` の全10ファイルは `test.skip(testInfo.project.name !== '<対象device>', ...)` のパターンで、6 projectのうち対象外の5 projectでは意図的にskipする設計（例: `bp-820.spec.js:34` `test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用')`）。このため char を追加した#501以降、「対象外device分のskip」が数百件単位で発生し、それが丸ごと「1回目失敗」としてカウントされている。

Playwright公式の `🎭 Run Summary` と annotation 件数を突き合わせると完全に一致する:
- a0d90b3: `14 skipped / 586 passed` ＋ failed無し → annotation「14件」＝14skip+0fail
- 52f713c: `2 failed / 428 skipped / 692 passed` → annotation「430件」＝428skip+2fail
- b06fdd5: `1 failed / 428 skipped / 693 passed` → annotation「429件」＝428skip+1fail
- 52a1d33: `473 skipped / 703 passed`(failed無し) → annotation「473件」＝473skip+0fail
- b7e2a9a: `478 skipped / 704 passed`(failed無し) → annotation「478件」＝478skip+0fail

→ **全5コミットで成立**。つまりイシューの前提「1回目に大量に落ちて、リトライで通っている」は実態と異なる。リトライは一度も起きていない。「429件」のほぼ全部(428件)は、char の6端末マトリクスが設計どおりに意図的スキップしているだけで、実際の失敗ではない。annotationの件数表記と文言が、スキップと失敗を混同して不安定に見せている（`ci-annotate-failures.mjs` 側の表記バグ）。

実際に起きている不安定さは、`publish-article-editor.spec.js:619` が52f713c・b06fdd5の2回だけ落ち（15秒timeout）、52a1d33・b7e2a9aでは落ちていない、という**char追加後4回中2回**の局所的な事象のみ。a0d90b3（char追加前）はこの1サンプルだけでは落ちていないが、比較するにはサンプルが少ない。job所要時間は char追加前(約9分)→追加後(約11〜12分)で+2〜3分増えており、これは5コミット共通で再現している（成功・失敗問わず）。

## 3. 完了条件の言い直し（②申し送り4番）

②の申し送りで「数件以内」は「1回目失敗が5件以下」と仮置きされていたが、上記の分析で**「1回目失敗」という指標自体がchar由来のskipを含むため、char を足した状態では本質的に数百件になる指標**だとわかった。a0d90b3の水準(14件)に戻すには「charのskip分を含めない集計」に直す必要がある。完了条件は、次のいずれかに言い直すのが妥当（step3で案と合わせて決める）:
- 「実failed件数が0〜1件以下」（指標をci-annotate-failures.mjs側でskip除外に直す前提）
- または「char projectを除いた既存project分の1回目失敗件数が5件以下」（既存指標のまま、char分を母数から外す）

## 次ステップ(step2)への申し送り

- 「char混在で既存テストの1回目失敗が増える」という仮説を検証する際は、**ci-annotate-failures.mjsのskipカウントに引っ張られないよう、`[FAIL]`タグ（実failed）の件数だけを見る**こと。skip件数は常に数百件出る（design通り）ので母数にしない。
- 実際に負荷の影響を疑うべき対象は `publish-article-editor.spec.js:619` のような時間依存テストの実failed発生率。char追加後4回中2回失敗はサンプルが少なすぎるため、step2のローカル比較（char有/無×複数回）で実測値を増やす。
