# イシュー#701 の記録：Vitest 5 へ版上げ＋テスト監査 (#690) の上位の穴を埋める

- 基準：origin/main 6942583（2026-11-22 05:00 JST に fetch。監査 #690 の基準と同じ）
- 生の記録（ログ・JSON）：`~/kuroko/_vault-work/701/`
- 監査の本文：vault `60_🐙claude/63_🐙project/bookshelf/テスト監査_20261122.md`

## §1 版上げ（Vitest 2.1.9 → 5.1.1）

commit：ec3bdf4（package.json の1行と package-lock.json だけ。設定とテストは無変更。push はまだ）

### 前後の表

| 項目 | 前 | 後 |
|---|---|---|
| package.json の vitest | `^2.1.0` | `^5.1.1` |
| lock の vitest | 2.1.9 | 5.1.1（npm の latest も 5.1.1） |
| 単体テスト（npm test） | 80ファイル・1,203本（1201 passed・2 todo）・失敗0 | 同じ（80ファイル・1,203本・1201 passed・2 todo）・失敗0 |
| 所要 | 11.06秒 | 10.97秒 |
| npm run lint | — | 12本中0本失敗 |
| npm audit 合計 | 26 | 17 |
| 　critical | 3 | 1 |
| 　high | 12 | 8 |
| 　moderate | 11 | 8 |
| 　low・info | 0 | 0 |

### lock の差分

| 確かめたこと | 結果 |
|---|---|
| package.json の差分 | vitest の1行だけ |
| 直接依存（9個）で版が動いたもの | vitest だけ（2.1.9 → 5.1.1）。残り8個は前後同じ（@axe-core/playwright 4.13.0・@babel/parser 7.29.7・@playwright/test 1.60.0・@textlint-ja/textlint-rule-preset-ai-writing 1.7.0・jsdom 25.0.1・stylelint 16.26.1・textlint 15.7.1・textlint-rule-preset-jtf-style 3.0.3） |
| playwright・playwright-core | 1.60.0 のまま（#651 の保留どおり） |
| @mizchi/mutator | lock に無い（0件） |
| パッケージの数 | 527 → 508（増えた48・消えた67・版が変わった17） |
| `npm ci --ignore-scripts` のやり直し | 通った（CI の npm ci と同じ条件） |
| vitest の解決先 | worktree の中の node_modules（実体。symlink ではない）の 5.1.1 |

- 版が変わった17個：vitest・vite（5.4.21 → 8.3.8）・@vitest/mocker・@vitest/spy・chai・es-module-lexer・expect-type・magic-string・std-env・tinybench・tinyexec・why-is-node-running・@jridgewell/sourcemap-codec・@types/estree・source-map-js・postcss（8.5.15 → 8.5.33）・nanoid（3.3.12 → 3.3.20）。
- 消えたもの：esbuild と @esbuild の23個、rollup と @rollup の25個、vite-node、@vitest の5個など。増えたもの：rolldown と @rolldown の17個、lightningcss の12個、tinyglobby など（vite 8 の部品）。
- **直接依存ではないが、他の道具も使う部品が2つ動いた**：postcss と nanoid。どちらも stylelint が同じものを読む（`npm ls postcss` で確認）。stylelint の指定の範囲内の版で、`lint:css` は通った。

### vitest の結果を読む2本を実際に流した

| スクリプト | 流し方 | 結果 |
|---|---|---|
| scripts/gate-report.mjs | `npm run gate:report -- --collect --dir=<記録の置き場>` | 条件3の行に「vitest 緑1201・失敗0／lint 一式と check:version 緑8/8」。読んだ vitest.json は、全1,203本・通過1,201・失敗0・todo 2・80ファイル。総合は「不合格（未実施8）」で、E2E などの結果を置いていないための表示 |
| scripts/verify/e2e-diff-main.mjs | `--skip-e2e --no-visual`（vitest だけを base と work の両方で流す） | 「新しく落ちた0件・新しく通った0件・両方で落ちた0件」。exit 0 |

- 計画では `--grep` で門の1本に絞るとしていた。`--grep` は vitest にも `-t` として渡り、vitest が全件にならない。目的は「vitest の結果の読み取りの確認」なので、`--skip-e2e` に変えた。
- e2e-diff-main の base 側（origin/main 6942583）は、作業側の node_modules を共有する作り（スクリプトの既知の制約。警告が出る）。そのため両側とも Vitest 5.1.1 で流れた。

### 確かめていないこと

- CI（node 22）での実行。step2 の push の後に確かめる。
- E2E の全件。版上げは E2E の依存（playwright 1.60.0）を変えていない。全件の比較は step7。

## §2 9番（旧い形式からの移行のコード）の調査

**結論：分からない**（3択＝残りうる／分からない／確かに残らない、のうち）。消さずに、step6 で単体テストを足す。

### 旧形式とは

`detectFormat`（js/storage.js L136）の判定と、起動時の扱い（js/bookshelf.js L3249〜3252・L3390〜3393・L3570〜3575）。

| 判定 | 条件 | 起動時の扱い |
|---|---|---|
| new | `private/bookshelves/all.json` が在る | そのまま読む |
| flat | 直下に `bookshelves/all.json` と `notes.json` が在る | 分岐が無い（移行しない。読込 `loadAll` は `private/` 配下だけを読むので、直下のファイルは読まれない） |
| pre-notes-split | 直下に `bookshelves/all.json` が在り、`notes.json` が無い | `migrateNotesSplit`＝警告を出すだけ |
| legacy | 直下の `library.json` で、books が配列でなく object | `migrateFromLegacy`（js/storage.js L159）＝`private/` 配下へ書き直す |
| empty | どれも無い | 確認してから初期化 |

### 調べたこと

**① 新構造がいつ入ったか（git log -S）**

| 日付 | commit | 中身 |
|---|---|---|
| 2025-11-24 | 5883100 | 最初の commit |
| 2026-05-24 | ad7f393 | 「新ファイル構造への分散保存に切替」。`detectFormat` と `migrateFromLegacy` が入った |
| 2026-05-30 | — | ADR-006「旧形式マイグレーションは書かない」 |
| 2026-06-01 | 594c21f | `private/` 配下の構造、GitHub とローカルの保存先の部品が入った |
| 2026-06-14 | fc0bb58 | ハブが入った |

- legacy の形（単一の library.json）で保存していた期間は、2025-11-24〜2026-05-24 の約6か月（`migrateFromLegacy` の注と ad7f393 の題から。最初の版の保存のコードまでは読んでいない）。flat の期間は 2026-05-24〜06-01 の約1週間。
- その期間に利用者が居たか：ADR-006（2026-05-30）は「未公開アプリで既存ユーザがいない」と書いている。それを裏づける記録（配信先へのアクセスの記録など）は見ていない。

**② 保存先3種ごとに、全数を確かめる手段が在るか**

| 保存先 | 手段 | 今回 |
|---|---|---|
| ハブ | 在る（運営側で、保存場所の一覧から直下の library.json を数える）。本番の鍵が要る | 実施していない（本番へ問い合わせない決まり）。作りの上では、ハブが入ったのは新構造の後（2026-06-14）で、アプリが旧形式をハブへ書いた版は無い |
| 各自の GitHub repo | 無い（利用者ごとの repo で、運営側から中身を読めない） | — |
| ローカルフォルダ | 無い（利用者の PC の中） | — |

手段が無い保存先が2つ在る。

**③ ハヘロの保存先が新形式か**

- `/home/sei/GitHub/bookshelf-data`（remote は hahero-asayake/bookshelf-data）を、ファイルの有無と履歴だけで見た（中身は表示していない）。
  - 在る：`private/bookshelves/all.json`・`private/library.json`・`private/bookshelves.json`・`private/notes.json`
  - 無い：直下の `library.json`・`bookshelves/all.json`・`notes.json`
  - 履歴189 commit（2026-05-31〜2026-06-07）の中で、直下の3ファイルに触れた commit は0件。最初の commit から `private/` 配下。
  - ＝新形式で、旧形式だった時期は履歴に無い。
- ただし、この写しの最後の commit は 2026-06-07 で古い。ハヘロが今どの保存先（ハブ／GitHub／ローカル）を使っているかは、端末の設定を見ないと分からない。確かめていない。
- 計画で当てにした vault の 41_bookshelf-data は、今の vault には無かった（40帯は `x_40_🧊xxx` に変わっている）。

**④ legacy 以外の旧形式の扱い**

- 上の表のとおり、flat は分岐が無く、pre-notes-split は警告だけ。js/storage.js L152 の注が言う `migrateFlatToNew()` は存在しない（grep で当たるのは注の1か所だけ）。
- flat の保存先を開くと、直下のファイルは読まれない（読込 `loadAll`・js/storage.js L372〜 は `private/` 配下だけを読む）。その後に画面がどう見えるかまでは、動かして確かめていない。ADR-006 の方針どおりの作りなので、本体のバグとしては扱っていない。移行するのは legacy の1種類だけ、というのが今の姿。

**⑤ ADR-006 の文面**

- vault `08_意思決定記録.md` L47〜50：「決定：データ形式変更時に旧→新の自動変換は実装しない。理由：未公開アプリで既存ユーザがいない。正しい形に書き直す自由度を優先。注意：公開後はこの前提が崩れる。公開時に本 ADR を失効させること。」
- 同 L167：「一般ユーザが付き始めた時点で ADR-006 (マイグレーション不要) は失効する」
- CLAUDE.md L288：「未公開アプリのため、既存データとの互換性は考慮しない (旧形式マイグレーションを書かない、ADR-006)」
- `migrateFromLegacy` は ADR-006 の6日前（2026-05-24）に入ったもので、ADR の後も残っている。

### 結論の理由と、次にやること

- 「分からない」とした理由
  1. GitHub とローカルフォルダは、全数を確かめる手段が無い。
  2. legacy の形で保存していた期間が約6か月在り、その間の利用者が0だったことを示す記録を持っていない。
  3. ハヘロのデータ用 repo は新形式だが、1人分で、写しも古い。
- 次：消さない。step6 で単体テストを足す（`detectFormat` の5つの判定と、legacy の見本 → `migrateFromLegacy` → 読込で新形式になること）。
- 消す判断をする場合に要るもの（今回は出していない）：ハブは保存場所の一覧で直下の library.json を数えること。GitHub とローカルは、2026-05-24 より前の版を使った人がハヘロ以外に居ないと言い切れること。
