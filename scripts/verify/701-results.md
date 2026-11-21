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

### 確かめていないこと（step1 の時点）

- CI（node 22）での実行。step2 の push の後に確かめる。
- E2E の全件。版上げは E2E の依存（playwright 1.60.0）を変えていない。全件の比較は step7。

### push と CI（step2・2026-11-22）

- push：`BOOKSHELF_ISSUE=701 git push origin cf0655e:main`（6942583..cf0655e）。05:08:27〜05:08:32 JST。push の直前に `npm run lint`（12本中0本失敗）と `npm test`（80ファイル・1,203本・失敗0）。
- CI：run 44944677099（ci.yml）。4ジョブとも赤。

| ジョブ | 単体テスト（Vitest 5.1.1・node 22） | Install Playwright browser | E2E | 結論 |
|---|---|---|---|---|
| test (e2e) | 成功（30秒） | 失敗（0秒） | 1,014件が `browserType.launch: Executable doesn't exist`（ブラウザが入っていない） | 赤 |
| test (char) | （このジョブでは流さない） | 失敗（1秒） | 同じ理由で失敗 | 赤 |
| test (audit) | （流さない） | 失敗（0秒） | 流れない | 赤 |
| test (webkit) | （流さない） | 失敗（0秒） | 流れない | 赤 |

- 直前の main（6942583・2026-11-14）の CI は4ジョブとも成功。
- **原因は版上げではなく、CI の実行環境の切り替え**：
  - GitHub は `ubuntu-latest` を Ubuntu 26.04 へ切り替えた（actions/runner-images の告知 #14748「2026-10-19 から数週間かけて切り替え、2026-11-19 までに終える」）。ci.yml は `runs-on: ubuntu-latest`。6942583 の CI（11-14）は切り替えの途中、cf0655e の CI（11-21 20:08 UTC）は終わった後。
  - Playwright 1.60.0 は Ubuntu 26 以降を `ubuntu26.04-x64` と判定し、その OS 向けのブラウザも依存の一覧も持っていない（node_modules/playwright-core/lib/coreBundle.js の calculatePlatform：`major < 26` までが 24.04 扱い）。
  - 手元で `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu26.04-x64 npx playwright install chromium` を流すと、即座に `Failed to install browsers / Error: ERROR: Playwright does not support chromium on ubuntu26.04-x64`（exit 1）。CI の0秒の失敗と一致する。`ubuntu24.04-x64` に替えると導入先の URL が出る（記録 `~/kuroko/_vault-work/701/40-pw-ubuntu26-repro.log`）。
  - 版上げの差分は playwright・playwright-core・@playwright/test の版を変えていない（1.60.0 のまま）。手元の `npx playwright --version` は 1.60.0。
  - ＝版上げを戻しても直らない。版上げ由来の赤は0件。
- CI の単体テスト（Vitest 5.1.1）は node 22 で通った。使われた node の正確な版（22.x）は、ジョブのログが未認証では読めない（API が 403「Must have admin rights」）ので未確認。ci.yml の指定は `node-version: 22`。
- 直すには ci.yml（と visual.yml）の `runs-on` を `ubuntu-24.04` に固定するか、Ubuntu 26.04 に対応した Playwright へ上げる必要がある。どちらもこのイシューの計画の外なので、②の判断に回した。

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

## §3 10番（単体テストが本物の GitHub へ接続する）

commit：a4b6849

### 外へ出ていた口

- tests/unit/book-memo-move-target-exists.test.js は、GitHubAdapter の `_getContent` だけを差し替えていた。
- `readText`（js/github-adapter.js L233）は先に `_tryReadFromShaCache`（L197）→ `_ensureRemoteShaMap`（L109）を呼び、tree の一覧を取りに `https://api.github.com/repos/o/r/git/refs/heads/main` へ fetch する。失敗は `catch` で握りつぶされ（L132〜134）、個別の取得（差し替え済みの `_getContent`）へ落ちるので、テストは通っていた。
- 直し：このテストで `_ensureRemoteShaMap` も差し替える（一覧は空＝控え無し）。本体は変えていない。

### 共通の準備

- tests/unit/helpers/no-network.setup.js を新設し、vitest.config.js の `setupFiles` に足した。
- 差し替えていない fetch を必ず失敗させる。呼ばれた URL を控えて、テストの終わり（afterEach）で落とす。本体が通信の失敗を握りつぶす経路（上の `_ensureRemoteShaMap` など）でも気づける。
- テストが自分で差し替えた fetch（`globalThis.fetch = …`・`vi.stubGlobal`）はそのまま効く（全80ファイルが通る）。

### 前後（strace -f -qq -e trace=connect で接続の呼び出しを数えた）

| 流したもの | 外向きの接続 | 名前解決 | 結果 |
|---|---|---|---|
| このテスト単独・直す前（準備なし・テスト未修正） | 2（20.27.177.116:443） | 2 | 6本通過 |
| このテスト単独・直した後 | 0 | 0 | 6本通過 |
| 全80ファイル・#690 の時点（`13-strace-vitest-run-control`） | 2 | 2 | 1,203本 |
| 全80ファイル・直した後 | 0 | 0 | 1,203本（1201 passed・2 todo）・失敗0 |

- 準備が効くことの確認：準備だけを入れてテストを直さずに流すと、このファイルの GitHubAdapter の2本だけが、URL つきの文（`単体テストが差し替えていない fetch を呼んだ … https://api.github.com/repos/o/r/git/refs/heads/main`）で落ちた。ほかの79ファイルは通った。
- `npm run lint`：12本中0本失敗。

## §4 測定の準備と「前」の数

### mutator

- `npm install --no-save --ignore-scripts @mizchi/mutator@0.5.3`。package.json・package-lock.json は無変更（git diff で確認）。`.mutator/` は add しない。
- 流し方：`~/kuroko/_vault-work/701/tools/run-only.mjs`（対象関数の見逃し id だけを `--only` で渡す。`--include` は対象の6ファイル・`--config vitest.config.js`・`-j 4`）。
- id の拾い方：#690 の `gaps-by-function.mjs` を mutation/A・B・C-full-mutation.json に流して関数ごとの見逃し（not detected・not infected）を出し、対象12関数の id を `~/kuroko/_vault-work/701/ids-before.json` に保存（`tools/ids-before.mjs`）。

### 前の数（今の木＝cf0655e＋10番・Vitest 5.1.1 で流した）

| 番号 | ファイル:関数 | #690 の見逃し | 今の木で落ちない | 気づいた |
|---|---|---|---|---|
| 5 | js/storage.js:_initEmptyNow (L320) | 50 | 50 | 0 |
| 6 | js/storage.js:_syncBatchNow (L500) | 14 | 14 | 0 |
| 6 | js/storage.js:generateInternalId (L733) | 9 | 9 | 0 |
| 2 | cf-worker/asayake-hub.js:safeReturnUrl (L1317) | 20 | 20 | 0 |
| 4 | cf-worker/asayake-hub.js:putObject (L557) | 17 | 17 | 0 |
| 4 | js/hub-adapter.js:_recoverBatchConflictAndRetry (L347) | 45 | 45 | 0 |
| 4 | js/github-adapter.js:_assertBatchNotStale (L442) | 22 | 22 | 0 |
| 8 | js/github-adapter.js:_headers (L521) | 5 | 5 | 0 |
| 8 | js/github-adapter.js:commitBatch (L330) | 39 | 39 | 0 |
| 8 | js/hub-auth.js:_exchange (L90) | 36 | 36 | 0 |
| 7 | js/book-manager.js:importSelectedBooks (L65) | 35 | 35 | 0 |
| 7 | js/book-manager.js:addBookManually (L373) | 33 | 33 | 0 |
| 合計 | | 325 | 325 | 0 |

- #690 の数と全部一致した。10番の準備を入れても、見逃しは変わらない。
- 所要：44.0秒（dry run 11.0秒・80ファイル）。load average は3前後で流した。
- 記録：`~/kuroko/_vault-work/701/mutation/before-only/`（mutation.json・summary-by-function.json）。

### 5・6番の「足す前に E2E で気づくか」

- 選び方（結果を見る前に 05:13 に固定・`~/kuroko/_vault-work/701/e2e-precheck-56-selection.json`）：名指しの id（1663h14dmpl・j6sjbtxa2x）＋関数ごとに id の昇順で先頭（文字列だけの書き換えを除く・選んだ行と別の行）。5番の 65yxgvfkex（本体を空にする）は #690 が確かめ済み（E2E が気づいた）なので選び直していない。合計6件。
- 流し方：#690 の e2e-one.mjs を PORT 8101 に写したもの（`tools/e2e-one-8101.mjs`）で1件ずつファイルへ入れ、配られる js に入ったことを確かめてから chromium・4並列で流す。落ちたら戻して、落ちた spec を単独で流し直して緑を確かめる。
- 先に書き換えなしで13ファイル（85本）を流し、全部緑（105秒）。
- spec の組：初期化＝boot-confirm-dialog・first-run-init-status・first-run-add-article-drawer・first-run-drawer-before-first-save・first-run-save-during-init-empty。保存＝memo-leave-flush・sort-persist・hub-save-changed-only・gate/j4-memo・gate/j3-2-create-shelf。消す＝shelf-file-delete・book-memo-file-lifecycle・shelf-reload-removed。

| 番号 | 関数 | id | 書き換え | 流した spec | E2E |
|---|---|---|---|---|---|
| 5 | _initEmptyNow | 10sk24htgiz | L333 `bookshelves.json` の「すべての本」の `appliedPlugins: []` → 空でない配列 | 初期化（5ファイル・27.5秒） | 気づかなかった |
| 5 | _initEmptyNow | 12l6febj7vw | L345 `bookshelves/all.json` の `books: []` → 空でない配列（存在しない本が1冊入る） | 初期化（5ファイル・27.5秒） | 気づかなかった |
| 5 | _initEmptyNow | 65yxgvfkex（#690） | 本体を空にする（何も書かない） | #690 の組（5ファイル） | 気づいた |
| 6 | _syncBatchNow | 1663h14dmpl | L507 `e.op === 'delete'` → false（消す指示を出さず、書く側へ回す） | 保存＋消す（8ファイル・12秒） | 気づいた（book-memo-file-lifecycle「本を削除すると、保存先からその本の長文メモのファイルが消える」。戻すと緑） |
| 6 | _syncBatchNow | 1bl8t0bamt1 | L530 `typeof a.discardBatch === 'function'` → false（失敗した時にまとめ保存の中身を捨てない） | 保存＋消す（8ファイル・101.4秒） | 気づかなかった |
| 6 | generateInternalId | j6sjbtxa2x | L733 本体を空にする（ID が undefined） | 保存＋初期化（10ファイル・28.7秒） | 気づいた（first-run-save-during-init-empty。戻すと緑） |
| 6 | generateInternalId | 14ne0jl2b00 | L736 `i < 8` → `i >= 8`（ID が空の文字列） | 保存＋初期化（10ファイル・33.9秒） | 気づいた（first-run-drawer-before-first-save。戻すと緑） |

- 6件の全部で、配られた js に書き換えが入っていたことと、戻した後に `git diff -- js cf-worker` が空であることを確かめた。
- 読み方：E2E は「書かない」「ID が壊れる」のような大きな壊れ方には気づく。「書いた中身が少し違う」（初期化の中身・失敗した時の後始末）には気づかない。

### step3 への判断の材料（単体を足すか）

| 番号 | 足すか | 理由 |
|---|---|---|
| 5（初期化の中身） | 足す | E2E は本体を空にする書き換えには気づくが、書いた中身の違い（存在しない本が「すべての本」に入る等）には気づかない（2件中0件）。単体なら書かれた4ファイルの名前と中身を直接確かめられ、mutator で前後を測れる |
| 6（まとめ保存の「消す」） | 足す | E2E は気づく（1663h14dmpl）。ただし消したはずのファイルが残る＝データの食い違いで、単体なら保存先へ届いた指示を数行で確かめられる。後始末（1bl8t0bamt1）は E2E が気づかないので、失敗時に中身を捨てることも一緒に確かめる |
| 6（ID の生成） | 足す（軽く） | E2E は気づく（2件中2件）。単体は「8文字・英小文字と数字・呼ぶたびに違う」の3点を確かめるだけで済み、mutator の前後の数に入れられる。E2E と重複する分は数行に留める |

## §5 step3：CI の実行環境の固定と、1・2・5・6番の単体テスト

### CI の実行環境を ubuntu-24.04 に固定（②の案A）

- origin/main の ci.yml・visual.yml は `runs-on: ubuntu-latest` のままだった（他イシューは先に直していない）。
- commit dd0ccd9：ci.yml と visual.yml の `runs-on` だけを `ubuntu-24.04` にした（2行）。手元の未 push の commit（10番・記録）を混ぜないように、origin/main（cf0655e）の上に直接作って push した（05:30:53〜05:30:58 JST・cf0655e..dd0ccd9）。push の前に `npm run lint`（12本中0本失敗）と `npm test`（80ファイル・1,203本・失敗0）。手元の commit は dd0ccd9 の上へ載せ直した。
- CI run 44946684995（05:38 の時点）：

| ジョブ | Install Playwright browser | 単体テスト | その後 | 結論 |
|---|---|---|---|---|
| test (char) | 成功（23秒） | （流さない） | char 6端末 成功 | 緑 |
| test (e2e) | 成功（22秒） | **失敗**（34秒） | E2E 実行中 | 未確定（赤になる） |
| test (webkit) | 成功（69秒） | （流さない） | 門の E2E（webkit）実行中 | 未確定 |
| test (audit) | 成功（22秒） | （流さない） | 監査の機械検査 実行中 | 未確定 |
| Visual（visual.yml） | — | — | — | 緑 |

- ブラウザの導入は4ジョブとも通った（runs-on の固定で直った）。
- 単体テストの step の失敗は、まだ原因が分からない。
  - dd0ccd9 の単体テストのコードは cf0655e と同じで、違うのは yml の2行だけ。cf0655e の CI（Ubuntu 26.04・Vitest 5.1.1）では同じ step が成功（30秒）、6942583（Vitest 2.1.9）でも成功していた。
  - 落ちたテストの名前は分からない。注記は0件（05:35・05:38）で、ジョブのログは未認証では読めない。
  - 手元（Ubuntu 24.04・node 24）では、全件を3回流して3回とも失敗0。今日の手元の実行は全部緑。
  - 揺れか、Vitest 5 と ubuntu-24.04 の組み合わせ（node 22 の版など）かは、まだ分けられていない。step4 の冒頭で run の最終の結論と注記を読み、分からなければ②へ出す。

### 足したテスト

| 番号 | commit | 置き場 | 中身 |
|---|---|---|---|
| 2 | 51fa720 | tests/unit/hub-billing.test.js（5本） | 支払いの開始・管理画面の入口から、Stripe へ送る success_url・cancel_url・return_url を確かめる。許可した場所はそのまま（クエリとハッシュは落とす）／許可していない場所（別のホスト・同じホストの http・別の番号・前方一致の偽ホスト）・壊れた URL・空・指定なしは先頭の場所の /bookshelf/／APP_ORIGIN が複数・空白入り・空の項目入り・未設定 |
| 5・6 | 032c18a・7d47bc6 | tests/unit/storage-init-empty-batch.test.js（新設・9本） | 初期化で書く7ファイルの名前・順番・中身と、読込で本0冊になること・id が毎回新しいこと／まとめ保存の「消す」が、まとめ保存を持つ保存先では消す指示、持たない保存先では deleteFile で届くこと・送信の失敗で組み立てた中身を捨てること・捨てる口や印の口が無い保存先／id は8文字の英小文字と数字で呼ぶたびに違う |
| 1 | 8e4bb45 | tests/unit/decide-loaded-state.test.js（6本） | 版の控えが無い時：手元に本があり保存先が空→local／手元が空→remote（保存先が空でもデータありでも）／自作の本棚だけ→local・「すべての本」だけ→remote／短文メモだけ→local／両方にデータ＋未反映の印→ask・印なし→remote |

- 5番と6番は同じ新しいファイルに書いたので、commit は番号ごとに分けず1つにした（032c18a）。7d47bc6 は、mutator で残った6番の2件を確かめる追加。
- 1番の期待は、#602 の決まりから決めた（手元のデータを黙って捨てない。保存先が空なら手元を採る。両方にデータがあり未反映の印があれば聞く。印が無ければ保存先を採る）。今のコードと食い違いは無かった。06_データ仕様書の本文は今回は読んでいない。
- 1番の確認：書き換えを js/bookshelf.js へ手で入れて流した。104wi5mgfxz（手元に本があるかの判定を `<= 0` に）では足した6本のうち5本、109nrkzzlw2（自作の本棚の判定を `every` に）では2本が落ちた。戻した後に `git diff -- js` が空であることを確かめた。
- 単体テストの数：80ファイル・1,203本 → 81ファイル・1,223本（1,221 passed・2 todo）。全件・失敗0。

### 見逃しの前後（mutator の --only・対象の見逃し id だけ）

| 番号 | 関数 | 前（落ちない） | 後（落ちない） |
|---|---|---|---|
| 5 | js/storage.js:_initEmptyNow | 50 | 3 |
| 6 | js/storage.js:_syncBatchNow | 14 | 3 |
| 6 | js/storage.js:generateInternalId | 9 | 0 |
| 2 | cf-worker/asayake-hub.js:safeReturnUrl | 20 | 1 |
| 合計 | | 93 | 7 |

残った7件（どれも「挙動が変わらない書き換え」と判断した）：

| id | 書き換え | 判断 |
|---|---|---|
| 1txgc0xk92z・jqe2ojlk7y・9qz03f9xxe | 初期化の settings.json の `showHighlights`・`showImagesInOverview`（true→false）、`memoOverrideDefault`（→空） | 挙動が変わらない。06_データ仕様書が「実ファイルに残るが現行コードは未使用」と書く legacy の項目 |
| lu69qa3k4・3s805yyd7b・fcwbdk7t16 | まとめ保存の入口の `typeof a.beginBatch === 'function' && typeof a.commitBatch === 'function'` の片方を常に真に・`&&` を `||` に | 挙動が変わらない（実在の保存先は、まとめ保存の口を両方持つ（GitHub・ハブ）か、両方持たない（ローカル）） |
| lh6xxem06y | safeReturnUrl の `if (!url)` を常に偽に | 挙動が変わらない（空・未指定は次の `new URL` が投げて、同じ既定の場所に落ちる） |

- 1番は js/bookshelf.js なので mutator では測れない（上の手で入れた確認で代えた）。

### js/storage.js のファイル単位（878件・-j 4・59秒）

| | 気づいた（Killed） | Timeout | not detected | not infected | not reached |
|---|---|---|---|---|---|
| #690（前） | 340 | 2 | 177 | 4 | 352 |
| step3 の後 | 432 | 1 | 114 | 6 | 322 |

- 記録：`~/kuroko/_vault-work/701/mutation/after-step3b/`（関数ごと）・`mutation/storage-file-after/`（ファイル単位）。

## §6 step4：4番（衝突と版の確認）

### CI（step3 の続き・05:40 の時点）

- run 44946684995（dd0ccd9）：test (char)・test (webkit) は緑で完了。test (audit) と test (e2e) の E2E は実行中。test (e2e) の単体テストの step は失敗のまま。原因はまだ不明（注記0件・ログは未認証で読めない）。
- その後 #699 が dd0ccd9 の上に8 commit を push した（c0e99c2・05:39）。その CI（run 44947390608）でも、test (e2e) の単体テストの step が失敗した（05:49 の時点。char・webkit・audit は緑）。
- ＝Vitest 5.1.1 と ubuntu-24.04 の組み合わせで2回とも赤、ubuntu-26.04（cf0655e）では緑、手元（Ubuntu 24.04・node 24）では何度流しても緑。
- node の版は違いではない：runner image の告知（ubuntu24/20261116・ubuntu26/20261116）では、どちらも Node.js 22.23.5 を持っている（ci.yml は `node-version: 22`）。
- 落ちたテストの名前は、まだ分からない（注記0件・ログは未認証で読めない）。②へ判断を回した（request_review・05:50）。

### 足す前に E2E で気づくか

- 選び方（結果を見る前に 05:40 に固定・`~/kuroko/_vault-work/701/tools/e2e-precheck-4.mjs`）：端末側の名指しの id 3件（29pmjcy6a95・6sx0agb0ps・5ou40sh0in）＋ _assertBatchNotStale の標本1件（id の昇順・文字列だけの書き換えを除く・別の行＝130xx9h3vus）。f891gnahod はハブ側（putObject）で、E2E のハブは全部模擬なので E2E では確かめられない（監査 §4）。
- spec の組（衝突・他の端末・同期の10ファイル）：sync-conflict・sync-conflict-overwrite・github-sync-resilience・load-conflict-unsaved・publish-conflict-hub・hub-save-changed-only・gate/j6-2-github-other-device・gate/j6-3-hub-other-device・gate/j6-4-sync-conflict・gate/j1-4-github-save-reload。
- 先に書き換えなしで流して、全部緑（26本・48.6秒）。

| id | 書き換え | E2E |
|---|---|---|
| 29pmjcy6a95 | hub-adapter L357 `!conflictPaths.has(e.path)` → false（衝突していないファイルも読み直す） | 気づかなかった |
| 6sx0agb0ps | hub-adapter L359 `this._etagCache.delete(e.path)` を消す（衝突したファイルの古い ETag を残す） | 気づかなかった |
| 5ou40sh0in | github-adapter L443 確かめる対象の絞り込みを常に真に（読んだことの無いファイル・印・base64 も確かめる） | 気づかなかった |
| 130xx9h3vus | github-adapter L457 `latest !== null && knownContent !== undefined` の `&&` を `||` に | 気づかなかった |
| f891gnahod | asayake-hub L561 版の確認を常に偽に | E2E では確かめられない（ハブは模擬） |

- 4件とも、配られた js に書き換えが入っていたことと、戻した後に差分が無いことを確かめた。
- 判断：4番は4件とも E2E が気づかないので、単体を足す（データの食い違い・上書きの類で、単体なら送った中身で直接確かめられる）。

### 足したテスト（commit 3aec818・ほか1件）

| 置き場 | 本数 | 中身 |
|---|---|---|
| tests/unit/hub-adapter.test.js | 3 | まとめ保存の 412 の回復：衝突したファイルだけを読み直し、他は1回目と同じ条件のままやり直しに入れる。衝突したファイルの ETag の控えを捨て、他の端末の変更で止まった後の単発の書き込みは古い ETag を使わず取り直す。既に消えている削除はやり直さない |
| tests/unit/hub-batch.test.js | 3 | 単発 PUT /data：If-Match が今の版なら書いて新しい ETag と使った量を返す。古い版・まだ無いファイルなら 412 で書かない。容量が上限でも、容量の判定（413）より先に版で断る |
| tests/unit/storage-serial-write.test.js | 4 | GitHub のまとめ保存：読んだ後に他の端末が変えたファイルは上書きせず止め、保存先は他の端末の中身のまま。変わっていなければ書く。読んだことの無いファイルは確かめずに書く（js/github-adapter.js の注の決まり）。他の端末が同じ中身を先に書いていれば止めない |

- 追加の commit 808ea49：「読んだことの無いファイル」の場合を、sha の控え（localStorage）を消した別の端末として作り直した。版の印（sync-stamp.json）は他の端末が書き換えていても止めずに書く場合を足した（5ou40sh0in を手で入れると、この1本が落ちることを確かめた）。
- 単体テストの数：81ファイル・1,234本（1,232 passed・2 todo）・失敗0。

### 見逃しの前後（mutator の --only）

| 関数 | 前（落ちない） | 後（落ちない） | 名指しの id |
|---|---|---|---|
| cf-worker/asayake-hub.js:putObject | 17 | 12 | f891gnahod 気づいた |
| js/hub-adapter.js:_recoverBatchConflictAndRetry | 45 | 40 | 29pmjcy6a95・6sx0agb0ps 気づいた |
| js/github-adapter.js:_assertBatchNotStale | 22 | 16 | 5ou40sh0in 気づいた |
| 合計 | 84 | 68 | 4件とも気づいた |

残った68件（関数ごとの判断）：

| 関数 | 残り | 判断 |
|---|---|---|
| putObject | 12 | テストが足りない：容量の計算（使った量の足し引き・上限ちょうど）と、R2 の onlyIf が失敗した時（TOCTOU）の2つ。版の確認とは別の性質（監査の次点「ハブの容量と書き込み回数の制限の境目」） |
| _recoverBatchConflictAndRetry | 40 | テストが足りない：項目ごとに合わせて送り直す経路（#612）・取り直しの GET の失敗・新規作成（ifNoneMatch）の衝突・やり直しの失敗（409/412）の分かれ道。文字列だけの書き換え9件（ログ・エラーの文） |
| _assertBatchNotStale | 16 | テストが足りない：tree の取得の失敗・一覧が切れた時（truncated）・base64 の項目・削除の項目。130xx9h3vus（`&&` を `||` に）は挙動が変わらない（`latest === knownContent` の判定が同じ結果になる） |

- 4番の目的（名指しの4件＝衝突したファイルだけを読み直す・控えを捨てる・版が違えば書かない・版の確認）は、全部気づくようになった。残りは、step6 のファイル単位の数と合わせて、次に足す候補として記録に残す。

### ファイル単位（js/hub-adapter.js・js/github-adapter.js・-j 4・126.7秒）

| ファイル | | 気づいた | Timeout | not detected | not infected | not reached |
|---|---|---|---|---|---|---|
| js/hub-adapter.js（693件） | #690（前） | 433 | 2 | 169 | 15 | 65 |
| | step4 の後 | 450 | 2 | 166 | 14 | 52 |
| js/github-adapter.js（694件） | #690（前） | 354 | 1 | 155 | 12 | 167 |
| | step4 の後 | 356 | 1 | 152 | 12 | 168 |

- ファイル単位は 808ea49 の前の木で流した（版の印の1本は入っていない）。cf-worker/asayake-hub.js（3,470件）のファイル単位は、時間が足りず step6 で取る。

### 3番（読み直しの並び順の E2E）：step4 では手を付けていない

- run の時間（30分）が、4番の E2E の確認と単体テストで尽きた。3番は次のステップ（step5）の前半で行う。やること：sort-persist の「PC と交互に変更」が 10hv83ghzyg で落ちなかった理由を調べる → spec を1本足す → 10hv83ghzyg を手で入れて落ち、戻して通る → chromium で3回続けて通る。

## §7 step5：CI の単体テストの赤の確かめと、7番・8番

### CI の単体テストの赤（②の申し送りの順に確かめた）

1. `git log cf0655e..dd0ccd9`：dd0ccd9 の1件だけで、差分は ci.yml・visual.yml の `runs-on` の2行。10番の準備（no-network.setup.js・setupFiles）は main に入っていない（origin/main の vitest.config.js に setupFiles は無い）。dd0ccd9 は、手元の未 push の commit を混ぜないよう origin/main の上に直接作って push したため。②の見立て（準備が CI で落としている）は当たらない。
2. 手元で `CI=true GITHUB_ACTIONS=true npm test`：81ファイル・1,234本・失敗0（10番の準備を入れた木）。#699 も同じ条件（`TZ=UTC`・HEAD 8604cf1）で0失敗を記録している。
3. 案Aの1 commit を push した：bd4aa3b（vitest.config.js に、GITHUB_ACTIONS の時だけ `reporters: ['default', 'github-actions']`。05:56:58 JST・eaa470c..bd4aa3b）。push の前に、Vitest 5.1.1 で github-actions の報告が動くことを手元で確かめた。
4. その CI（run 44948945585）の単体テストの step は成功（24秒）。#699 の記録では、8604cf1 の run 422 でも成功していた。

| run | commit | 単体テストの step |
|---|---|---|
| 420 | dd0ccd9 | 失敗 |
| 421 | c0e99c2（#699） | 失敗 |
| 422 | 8604cf1（#699 の記録） | 成功 |
| 44948945585 | bd4aa3b（注記の追加） | 成功 |

- 同じテストの中身で成功と失敗が分かれる＝揺れる単体テストがある見込み。Vitest 2.1.9 の時の CI では見ていない。落ちたテストの名前は、まだ分からない（落ちた2回は注記を出す前）。次に落ちた時は、check-run の注記に名前と行が出る。
- 今の main の単体テストは緑（直近2回）。②の(5)の「Vitest 5 と ubuntu-24.04 の組み合わせ」とは示せていないので、request_review はしていない。

### 7番：足す前に E2E で気づくか

- 選び方（結果を見る前に 05:57 に固定・`tools/e2e-precheck-7.mjs`）：名指しの3件＋importSelectedBooks の標本1件（id の昇順・文字列だけの書き換えを除く・別の行＝13pdkts28nm）。
- spec の組（取り込み・手動追加の11ファイル）：gate/j2-1〜j2-5・import-paste・import-reload-persist・kindle-reimport-merge・reimport-diff・manual-add-reload-all-shelf・dashboard-stats-after-manual-add。書き換えなしで36本緑（26.1秒）。
- 途中で run が切れ、js/book-manager.js に 17af71tmlqw が入ったまま残っていた。次の run の最初に見つけて戻し（`git checkout`）、続きから流し直した。

| id | 書き換え | E2E |
|---|---|---|
| 17af71tmlqw | addBookManually L376 `!asin \|\| !this.isValidASIN(asin)` → false（番号を確かめない） | 気づかなかった |
| q0ocbfsjkb | addBookManually L381 重複の確認 → false（重複を断らない） | 気づかなかった |
| 1y9tcf6hu48 | importSelectedBooks L88 `!(key in book)` → false（項目そのものが無い時も消す） | 気づいた（kindle-reimport-merge「ステータス系フィールドを持たない取込ソース」。戻すと緑） |
| 13pdkts28nm | importSelectedBooks L139 手動追加の件数の数え方を逆に | 気づかなかった |

- 判断：番号の検査・重複の検査・件数は E2E が気づかないので、単体を足す。1y9tcf6hu48 は E2E が気づくが、単体なら再取込の項目ごとの扱い（空なら消す・無ければ触らない）を数行で直接確かめられるので、step3 の物差しどおり足す。

### 7番：足したテスト（commit bbcb58b・tests/unit/kindle-status-import.test.js・6本）

- addBookManually：ASIN が無い・10桁の英大文字と数字でない（9桁・11桁・小文字・記号・空白）時は断り、蔵書を変えない。同じ ASIN が既にあれば断り、1冊のまま。足した本は manual_add として既定の値（題名・著者・既読の状態・表紙の URL）で埋め、件数（全体・手動）を数え直す。
- importSelectedBooks：再取込はステータス系だけを更新し、値が空なら消し、項目そのものが無ければ触らず、書誌は変えない。同じなら既に在るとして飛ばす（理由つき）。新しい本は kindle_import として足し、全体・手動・取り込みの件数を数え直す。

### 8番：模擬の通信が受け取った中身を確かめる（commit 8712074）

- 比べた結果：見逃しの時に通っていたテストの模擬は、ファイルごとに作りが違い（storage-serial-write の GitHub の模擬・github-adapter の mockFetch・hub-auth の vi.fn）、共通の部品へ寄せるとその3ファイルの書き換えになる。(a) 各ファイルの模擬に確認を足す方が小さいので (a) を採った（2ファイル・15行）。
- storage-serial-write.test.js の模擬の GitHub：本物と同じく、Authorization（Bearer）・Accept・X-GitHub-Api-Version の無い要求は 401、本文のある要求で Content-Type が JSON でなければ 415 を返す。このファイルの全テスト（まとめ保存・単発の書き込み・版の確認）に一度に効く。
- hub-auth.test.js：/session への交換が POST で、`Content-Type: application/json` を付け、1回だけ呼ぶこと。
- 単体テストの数：81ファイル・1,240本（1,238 passed・2 todo）・失敗0（06:00 の npm test）。
