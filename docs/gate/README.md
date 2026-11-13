# 公開前品質の門：正本の置き場

公開前最終テスト設計（obsidian `60_🐙claude/63_🐙project/bookshelf/公開前最終テスト設計.md`）の §6「合格の基準」を、`npm run gate:report`（`scripts/gate-report.mjs`）が集計する。このフォルダには、結果ではなく**正本**（人と AI が書き足していく一覧）を置く。検査の結果ファイルは `_local/gate/`（git に入れない）に置く。

| ファイル | 中身 | 使う条件 |
|---|---|---|
| `issues.json` | 見つかった問題の一覧 | 条件1（致命0・高0）・条件6（中0） |
| `audit-list.json` | 監査の「直すべき所の一覧」 | 条件8（全件が「直した」か「承認」） |

どちらも、**ファイルが無い間は「未実施」**として扱う。空の一覧を置くと「調べて0件だった」の意味になるので、調べる前に空のファイルを置かない。

## issues.json

```json
{
  "issues": [
    { "id": "P-001", "severity": "高", "status": "未対応", "title": "iPhone で公開ボタンが押せない", "found": "2026-11-20 門(b) H1-3", "issue": "#600" }
  ]
}
```

- `severity`（重さ）：`致命`・`高`・`中`・`低`。定義は設計書 §6 の表。
- `status`（状態）：`未対応`・`直した`。
- 合格は、`直した` 以外の 致命・高・中 が0件（2026-11-14 ハヘロ決裁）。`低` は残っていても合格で、「既知の問題」として件数を出す。
- `id`・`severity`・`status` は必須。ほかの欄は自由。値が決まりと違う行があると不合格になる。

## audit-list.json

```json
{
  "items": [
    { "id": "A-001", "severity": "中", "status": "未判断", "where": "設定 › 保存先", "text": "同期フォルダ", "problem": "ほかの画面では「保存先」", "suggestion": "保存先" }
  ]
}
```

- `status`：`未判断`（ハヘロがまだ見ていない）・`直す`（直すと決めたがまだ）・`直した`・`承認`（ハヘロが「そのまま」と決めた）。
- 合格は、全件が `直した` か `承認`。

## 結果ファイルの形（`_local/gate/`）

検査を作る側（監査の機械検査 #585・本番URL の検査・門のE2E）は、次の名前と形で結果を書く。`gate-report` はこの形だけを読む。**必須の名前が1つでも無いと、その条件は「未実施」になる**（合格に数えない）。名前の正本は `scripts/gate-report.mjs` の定数（`REQUIRED_PROD`・`REQUIRED_AUDIT`・`AUTO_CHECKS`）。変える時は定数とこの表を一緒に直す。

| 条件 | ファイル | 形 | 誰が書くか |
|---|---|---|---|
| 2 | `gate-lint.json` | `npm run lint:e2e-gate -- --json=<path>` の出力 | `--collect` |
| 2 | `gate-e2e*.json` | Playwright の JSON（`--reporter=json`）。`--repeat-each=3` の1本でも、1回ずつの3本でもよい | 門のE2E を流した人 |
| 3 | `e2e*.json` | Playwright の JSON（E2E 全件。CI の `e2e-parallel.json` 等） | E2E を流した人 |
| 3 | `visual*.json` | Playwright の JSON（`playwright.visual.config.js`） | 画像比較を流した人 |
| 3 | `vitest.json` | vitest の JSON（`--reporter=json`） | `--collect` |
| 3・7 | `checks.json` | `{ "checks": [{ "name", "group": "auto"｜"audit", "exitCode" }] }` | `--collect` |
| 4 | `prod-url.json` | `{ "checks": [{ "name", "ok": true｜false, "detail" }] }` | 本番URL の検査 |
| 7 | `audit.json` | `{ "checks": [{ "name", "detected": 件数, "detail" }] }` | 監査の機械検査（#585） |

**条件3の E2E は、流した結果を全部渡す**。`gate-report` は渡された結果だけで判定するので、渡していない分は確かめないまま「合格」と出る。CI は E2E を3つに分けて流している：`e2e-results/e2e-parallel.json`（sort-perf-budget 以外の全件）・`test-results/e2e.json`（sort-perf-budget の単独実行）・char レグの `test-results/e2e.json`（char 6端末）。最終の門では、この全部を `e2e*.json` の名前で置く（`scripts/verify/e2e-diff-main.mjs` の `work.e2e.json` も sort-perf-budget を除いているので、それだけでは足りない）。

**`prod-url.json` の必須の名前**（設計書 §4 の表と §6 の4）：`CSP`・`OGP`・`PWA`・`SEO`・`301`・`Lighthouse性能`・`Lighthouse a11y`・`axe`。

- 閾値の判定は検査の側で済ませ、`ok` に結果だけを入れる（性能はスマホ・温まった状態で90以上、a11y はスマホ100、axe は serious 以上0）。`detail` には測った値を書く。
- `ok` が `false` のものが1つでもあれば不合格。

**`audit.json` の必須の名前**（設計書 §5 の表と §6 の7）：`lint:copy`・`用語表`・`aria・alt`・`表示崩れ`。

- `detected` は検出の件数。0 で合格、1以上で不合格。
- `lint:copy` は `--collect` が流して `checks.json`（`group: "audit"`）に書くので、`audit.json` に無くてもよい。両方にある時は `audit.json` を使う。
- 必須の名前のほかに検査を足してよい（例：`ボタン名の揺れ`）。足した検査も、`detected` が1以上なら不合格になる。

**条件5（人の実機）**は結果ファイルではなく、`--human=<md>` で手順書（obsidian の「公開前最終テスト_人の手順書.md」）を直接読む。`## H1`〜`## H4` の表の「記録」欄を、`OK` で始まれば OK、`NG` で始まれば NG、空なら未記入として数える。

## 集計の流し方

```bash
npm run gate:report -- --collect --human=<公開前最終テスト_人の手順書.md>
```

- `--collect` は軽い検査（lint 一式・check:version・lint:copy・vitest）をその場で流して `_local/gate/` に記録する。
- 重い検査（E2E・画像比較・本番URL）は流さない。結果の JSON を `_local/gate/` に置くと読む。ファイル名の決まりは `scripts/gate-report.mjs` の冒頭。
- 無い結果は「未実施」と出て、合格には数えない。終了コードは総合が合格の時だけ 0。
