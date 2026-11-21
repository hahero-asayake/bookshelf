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
