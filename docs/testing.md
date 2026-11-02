# テストの手引き

bookshelf の検証コマンドの一覧と、本番(origin/main)との比較の仕組みの使い方。

- 単体: `npm test`（vitest run）
- E2E: `npm run test:e2e`（playwright・`playwright.config.js`）
- 画像の見た目の基準: 下記「画像の差分」節（`playwright.visual.config.js`・通常の `npm run test:e2e` や CI には入らない）

## origin/main との比較（新しく落ちたテスト0・画像の差分）

これから先のすべての改善単位（U2 以降）で使う、本番との比較の仕組み（イシュー#502）。確かめるのは2つ:

1. **origin/main と比べて、新しく落ちたテストが0件であること**（`scripts/verify/e2e-diff-main.mjs`）。
2. **画面の見た目に、意図しない差が出ていないこと**（`playwright.visual.config.js` の画像比較）。

### 1. 新しく落ちたテストが0件であることの確かめ方

`scripts/verify/e2e-diff-main.mjs` は、origin/main を作業ツリーの外に一時 worktree として取り出し、同じ port 規則で作業側(work)と origin/main 側(base)の E2E 全件・vitest 全件を順番に流し、失敗の集合を3つに分けて報告する。

```bash
# 既定（base=origin/main・work=今の作業ツリー・E2E全件+vitest全件）
node scripts/verify/e2e-diff-main.mjs

# 自分自身との比較（誤検知が無いことの確認。base/workとも一時worktreeのorigin/main）
node scripts/verify/e2e-diff-main.mjs --self

# 画像の差分もあわせて流す（work側のみ。下の2節を参照）
node scripts/verify/e2e-diff-main.mjs --visual

# 重い処理を分けて流す（1 runの時間制約に収めるため。vitestだけ先に・E2Eは一部だけ試走）
node scripts/verify/e2e-diff-main.mjs --skip-e2e
node scripts/verify/e2e-diff-main.mjs --skip-vitest --grep="ホーム"
```

**引数**

| 引数 | 既定 | 意味 |
|---|---|---|
| `--base=<ref>` | `origin/main` | 比較の基準にする ref |
| `--self` | off | work 側も base と同じ ref の別の一時 worktree にする（自分自身との比較＝誤検知の確認用） |
| `--skip-e2e` | off | E2E を流さない |
| `--skip-vitest` | off | vitest を流さない |
| `--visual` | off | `playwright.visual.config.js` があれば、work 側の画像比較も流す |
| `--grep=<pattern>` | なし | 両側・試走用の絞り込み（playwright の `--grep`・vitest の `-t` にそのまま渡す） |
| `--out=<dir>` | 作業ツリーの外・恒久的な場所（`<親dir>/_artifacts/e2e-diff-<時刻>-<pid>/`。`/tmp` ではなく、run をまたいで結果が残る） | 結果の置き場 |
| `--port=<n>` | `$PORT` または `8000` | E2E のサーバー port（`playwright.config.js` と同じ規則） |
| `--retries=<n>` | `3` | 新しく落ちたテストだけを work 側で流し直す回数 |
| `--keep` | off | デバッグ用。一時 worktree を片付けずに残す（通常は使わない） |

一時 worktree は、正常終了・異常終了・SIGINT/SIGTERM いずれでも必ず片付ける。**作業ツリー自体へは checkout・stash・reset を一切行わない。**

### 2. 3つに分けた表の読み方

結果は `<out>/report.md`（人間向け）と `<out>/report.json`（機械可読）に出る。E2E・Unit(vitest) それぞれに、次の3つの表が出る:

- **新しく落ちた**: base(origin/main) では通っていたか無かったのに、work では落ちているテスト。**ここが0件であることが完了の条件。**
- **新しく通った**: base では落ちていたのに、work では通っているテスト（直した・削除した等）。
- **両方で落ちた（既存の問題）**: base・work どちらでも落ちているテスト。今回の変更とは無関係の、既存の問題。

「振る舞いを変えない」単位では、新しく落ちた・新しく通ったのどちらも0件であることが期待値。「振る舞いを変える」単位（X系）では、期待をわざと書き換えたテストの一覧を名前つきで報告する。

### 3. リグレとフレークの判定

新しく落ちたテストが1件以上あると、そのテストだけを work 側で `--retries` 回（既定3回）流し直す。

- **3回とも落ちれば「リグレ」**: `report.md` の「判定」列に `regression` と出る。これが1件以上あると、スクリプトは exit code 1 で終わる。
- **1回でも通れば「フレーク」**: 「判定」列に `flake` と出る。exit code には影響しない（比較の誤検知ではなく、既存の揺れとして件数・名前つきで記録する）。

### 4. 画像の差分（画面の見た目の基準）

`playwright.visual.config.js`（testDir: `tests/visual`）が、画面の見た目の基準（9画面 × 6端末 ≒ 54枚）を持つ。通常の `npm run test:e2e` や CI には一切入らない、完全に別の設定。6端末の定義は `tests/char-devices.js` に1本化してあり、`playwright.config.js`（キャラクタリゼーションテスト用・イシュー#501）もここから同じ定義を使う。

```bash
# 比較（基準と今のレンダリングを比べる。差があれば失敗する）
PORT=8102 PLAYWRIGHT_BASE_URL=http://localhost:8102 \
  node node_modules/.bin/playwright test --config=playwright.visual.config.js

# 基準の撮り直し（★ origin/main の版でだけ行う。作業中の変更を含んだ版で撮り直さない）
PORT=8102 PLAYWRIGHT_BASE_URL=http://localhost:8102 \
  node node_modules/.bin/playwright test --config=playwright.visual.config.js --update-snapshots=all
```

`toHaveScreenshot` の設定（`playwright.visual.config.js` の `expect.toHaveScreenshot`）:

- `maxDiffPixelRatio: 0.001`（許す差の大きさ＝0.1%。計画 §3-3 の閾値をそのまま使う）
- `threshold: 0.2`（Playwright 既定のピクセル単位の色差許容。アンチエイリアスの揺れを吸収する）

**この数値は最初に超えたとき（閾値を超える差分が実際に出たとき）に見直す前提で、今は計画書の値のまま据え置いている。**

「変えない」単位では差分0（上の閾値以内）であること。「変える」単位（X系）では、差分が出た画像を左右比較にして報告する。

スナップショットは `tests/visual/__screenshots__/` に固定のファイル名（OS接尾辞込み）で置く。本の書影は、E2E 用のフィクスチャ（`tests/fixtures/fixture-library.json`）が `productImage` を空文字にしているため `<img>` 自体が描画されず、かつ `tests/e2e/helpers/test-base.js` が Amazon の書影ドメイン（`images-na.ssl-images-amazon.com`）への通信を固定の透明PNGで代替するため、外部読み込みで絵が揺れることはない。

### 5. port の規則

E2E・画像比較とも、`playwright.config.js` と同じ規則を使う:

- `PORT` 環境変数があればそれを使う。無ければ `PLAYWRIGHT_BASE_URL` の port。どちらも無ければ既定の `8000`。
- `webServer` は `reuseExistingServer: true`（その port に既にサーバーが立っていれば使い回す）。`e2e-diff-main.mjs` は、この罠（別の版のサーバーが残ったまま試験してしまう）を避けるため、各側を流す前に port が空いているか確認し、塞がっていれば中止する。
- worktree 分離（イシュー#413）の下では、各イシューに割り当てられた port（例: `PORT=8100+イシュー番号の下2桁`）を使う。他イシューと同じ port を使わない。
