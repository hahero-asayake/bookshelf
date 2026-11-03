# U6 step4 検証（#523）

## (3) 描画性能の前後比較（sort-perf-budget・PORT=8123）

step1(BookList化前)とstep4(BookList化後)で同じテスト(`tests/e2e/sort-perf-budget.spec.js`・#397 913冊・390px・chromium CPUx6)を実行。いずれも1 passed。

| 操作 | 前(step1・3回計測) | 後(step4・3回計測) | 前の中央値 | 後の中央値 |
|---|---|---|---|---|
| order(並び順切替) | [91,90,85]ms (ratio 1.029) | [91,91,86]ms (ratio 1.03) | 90ms | 91ms |
| direction(昇順降順) | [87,83,81]ms (ratio 0.976) | [88,81,81]ms (ratio 0.994) | 83ms | 81ms |
| drag(ドラッグ) | [65,62,56]ms (ratio 0.969) | [62,57,57]ms (ratio 0.986) | 62ms | 57ms |

中央値の差は最大1ms（order）で、他2項目は後の方が速い。**描画性能の劣化は無い**。

## (4) テストの期待変更0件

`git diff origin/main -- tests/`（--shortstatではなく全文diffで確認）：
- 変更ファイル7件：`app-version-check.test.js`・`art-preview-stage-label.test.js`・`empty-state.test.js`・`publish-article-generator.test.js`・`publish-og-meta.test.js`・`publish-ogp-image.test.js`（いずれも`await import('../../js/ui/escape.js');`の追加1行のみ）・新規`escape.test.js`
- 削除行（`-`で始まる実内容の行）：**0件**。既存の`expect(...)`・テストタイトルの変更は無い。
- 追加のみ＝**テストの期待の書き換えは0件**を確認。

## (2) e2e-diff-main.mjs（新規落ち0件）

`PORT=8123 node scripts/verify/e2e-diff-main.mjs --visual --out=/tmp/e2e-diff-523` を実行（フル実行・E2E全件+vitest+画像54枚比較。既定除外はsort-perf-budgetのみ・`--init-storage`は使わず・`--grep`も指定していない）。

- E2E (playwright): 新しく落ちた**0件**・新しく通った0件・両方で落ちた(既存の問題)0件
- Unit (vitest): 新しく落ちた**0件**・新しく通った0件・両方で落ちた0件
- 判定不能(流し直し0件): 0件

→ **origin/mainと比べて新しく落ちたテストは0件**（完了条件を満たす）。

## (1) 画像の基準54枚との差分

`e2e-diff-main.mjs --visual`のwork側単独比較（`playwright.visual.config.js`・`tests/visual/screens.spec.js` 9テスト×6端末=54件）で**6件が差分あり**（いずれも「ホームの編集」char-390/768/820/1024/1440/1920）。

**原因調査**：差分画像(`test-results-visual/screens-ホームの編集-char-*/02-home-edit-diff.png`)を見ると、差分は本の表紙カードの中身ではなく、**編集モードの「+ ここに追加」ホール（空きウィジェット挿入口の穴の枠）と、各統計カードの「+」ボタンの有無**。これはBookList(本のカード/行)とは無関係な、ホームの編集モードのUI要素。

**既存の問題と確認**：`origin/main`（521cfc3・U6着手前）を一時worktree(`/tmp/base-check-523`、検証後に`git worktree remove`で片付け済み)で直接チェックアウトし、同じ`playwright.visual.config.js --grep "ホームの編集"`を実行した結果、**6端末すべてで同じく失敗**。char-1440のピクセル差分数は work側 2792px / base側 2792px で**完全一致**。

→ **この6件はU6(本イシュー)による新規差分ではなく、origin/mainの時点で既に存在する基準画像の既存ズレ**（おそらくイシュー#521 X2で追加された「穴の枠」機能の後、`tests/visual/__screenshots__/`の基準画像が更新されていない）。完了条件の文言「画像の基準54枚との差分が0件」を字義通りには満たせていないが、U6の変更が原因ではないことを実測で確認した。基準画像の更新はU6のスコープ外と判断し、別イシューでの対応を②に相談したい。
