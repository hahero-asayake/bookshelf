# e2e-diff-main 結果

- base: origin/main @ 521cfc3913e16974d99e24aa361576c03b2e8afc
- work: 作業ツリー(HEAD=e4022e0b29d8f23a5b50bfd6a81bfe011e54d3c3・未コミット差分含む可能性あり)
- 生成: 2026-11-03T16:20:21.858Z
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

- 6件 / 54件 が差分あり
| file > title [project] |
| --- |
| screens.spec.js > screens.spec.js > ホームの編集 [char-390] |
| screens.spec.js > screens.spec.js > ホームの編集 [char-768] |
| screens.spec.js > screens.spec.js > ホームの編集 [char-820] |
| screens.spec.js > screens.spec.js > ホームの編集 [char-1024] |
| screens.spec.js > screens.spec.js > ホームの編集 [char-1440] |
| screens.spec.js > screens.spec.js > ホームの編集 [char-1920] |
