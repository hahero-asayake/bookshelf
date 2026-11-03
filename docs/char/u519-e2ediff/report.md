# e2e-diff-main 結果

- base: origin/main @ 93188cd2cbdac74ee546bbfcf33b5218ace1b735
- work: 作業ツリー(HEAD=7552602fe7a26a821da6ab4fd76de429dfc0bd0e・未コミット差分含む可能性あり)
- 生成: 2026-11-03T15:04:43.620Z
- 判定不能（流し直しで実行0件・regressionに含めない・イシュー#510）: 0件

### 除外したテスト (E2E・playwright)

| パターン | 出どころ | 理由 |
| --- | --- | --- |
| sort-perf-budget | .github/workflows/ci.yml:96 | 負荷で揺れる・CIでは別stepで単独実行(workers=1)(#405/#476/#492) |

_(vitestはCI設定(ci.yml)に除外が無いため対象外。上記はE2E(playwright)にのみ適用)_

### E2E (playwright)

**新しく落ちた (0件)**

_(0件)_

**新しく通った (0件)**

_(0件)_

**両方で落ちた/既存の問題 (0件)**

_(0件)_


### Unit (vitest)

**新しく落ちた (0件)**

_(0件)_

**新しく通った (0件)**

_(0件)_

**両方で落ちた/既存の問題 (0件)**

_(0件)_


### 画像の差分 (playwright.visual.config.js・work側のみ)

(skip)

### 件数サマリ (このファイルへの追記)

| | base (origin/main) | work (HEAD=7552602) |
|---|---|---|
| E2E expected(pass) | 732 | 734 (+2 = tests/e2e/boot-confirm-dialog.spec.js新規2件) |
| E2E unexpected(fail) | 0 | 0 |
| E2E flaky | 0 | 0 |
| E2E skipped | 511 | 511 |

新しく落ちたテスト・新しく通ったテスト・両方で落ちたテストのいずれも0件(E2E・Unit(vitest)とも)。
流し直しは発生しなかった(1回目の本実行で新規落ちが無かったため)。
実行: `PORT=8119 node scripts/verify/e2e-diff-main.mjs --port=8119 --out=/tmp/u519-e2ediff`(2026-11-04 00:00〜00:04、約4分半)。
