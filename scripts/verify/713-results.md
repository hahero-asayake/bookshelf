# イシュー#713: Playwright を Ubuntu 26.04 対応の版へ上げ、CI の runs-on の固定を外す

## §1 step1：前提・#651 の保留の理由への答え・版と runs-on の案（2026-11-22 05:49〜05:55 JST・コードは変えていない）

### 1-1 前提：#701 の runs-on の固定は main に入っている

- worktree は origin/main eaa470c へ ff した（作られた時は 8604cf1）。
- `git merge-base --is-ancestor dd0ccd9 origin/main` は真。`git log --oneline --grep='ubuntu-24.04' origin/main` に当たるのは dd0ccd9「ci: CI の実行環境を ubuntu-24.04 に固定する (ubuntu-latest の Ubuntu 26.04 化で Playwright 1.60.0 のブラウザが入らない)」の1件だけ。本文の末尾は `Issue: #701`。
- 変更は2行だけ：`.github/workflows/ci.yml:10` と `.github/workflows/visual.yml:23` の `runs-on: ubuntu-24.04`。eaa470c でも行番号は同じ。
- Playwright の今の版：package.json:33 は `"@playwright/test": "^1.49.0"`。lock の `node_modules/@playwright/test`（:620）・`playwright`（:4749）・`playwright-core`（:4768）は 1.60.0。

### 1-2 CI の今の状態（24.04 の上での基準）

GitHub API（未認証）で読んだ。同じ IP の残りは 05:52 の時点で 19 回。このステップでは6回呼んだ（runs×2・jobs×2・annotations×1・runner-images #14748×1）。計画で決めた上限の5回を1回超えた。

| run | commit | 中身 | 結論 | test (e2e) | test (char) | test (audit) | test (webkit) |
|---|---|---|---|---|---|---|---|
| 419 | cf0655e | #701 Vitest 5.1.1（ubuntu-latest） | failure | 失敗 | 失敗 | 失敗 | 失敗 |
| 420 | dd0ccd9 | 24.04 に固定（#701） | **failure**（05:31〜05:51 JST・20分） | **失敗（Unit tests だけ）** | 成功（2分51秒） | 成功（10分1秒） | 成功（7分51秒） |
| 421 | c0e99c2 | #699 | 05:52 の時点で実行中 | | | | |
| 422 | 8604cf1 | #699 の記録 | 05:52 の時点で実行中 | | | | |
| 423 | eaa470c | #699 の記録 | 05:52 の時点で実行中 | | | | |

- 419 の4ジョブの失敗は「Install Playwright browser」の「ERROR: Playwright does not support chromium on ubuntu26.04-x64」による。出典は dd0ccd9 の本文。ジョブのログは認証が要るので、自分では読んでいない。
- **420（24.04）の test (e2e) が赤なのは、単体テスト1本の時間切れだけ。** ジョブの中で success でない step は「Unit tests (Vitest)」の1つだけ。annotation によると：
  - 落ちたのは `tests/unit/publish-article-generator.test.js:110`。題は「markdownToHtml: 閉じない強調記号のO(n^2)劣化ガード (回帰テスト・イシュー#153) > (主・時間を使わない) 重い探索(emStrongの対応デリミタ探索)への実dispatch回数は、安全弁が効いて…」。中身は `TestTimeoutError: Test timed out in 5000ms.`
  - E2E は「🎭 Playwright Run Summary 17 skipped / 1013 passed (16.2m)」。失敗の一覧は「E2E 失敗 0件」。sort-perf-budget も「1 passed (2.5m)」。
- この単体テストの赤は、OS とも Playwright の版とも関係のない揺れと読む。理由は次の3つ。
  - Vitest の単体テストで、ブラウザを使わない。
  - 421 でも同じ step が落ちた。一方、同じ中身の 422 では通った（#699 の記録：origin/main scripts/verify/699-results.md §5-2）。
  - #701 で Vitest を 5.1.1 に上げた後から出ている（419 はブラウザの取得で先に落ち、単体テストまで届いていない）。
- **step4 以降の比較の基準**：
  - 24.04＋1.60.0 で、char・audit・webkit は緑。
  - e2e の E2E は 1013 件通過・0件失敗。
  - 単体テスト `publish-article-generator.test.js:110` の時間切れが、前からの揺れとして1本ある。
  - 完了条件の「main の CI が緑」は、この揺れに邪魔される見込みがある。直すのは #701（Vitest 5）か別のイシューの範囲と考える（②の判断）。
- Visual（visual.yml・run 3・dd0ccd9・24.04・1.60.0）：
  - ワークフローの結論は Success。ただし job が `continue-on-error: true`（visual.yml:25）なので、合否の意味は無い。
  - run 画面の annotation（HTML で読んだ）は「visual 差分一覧 (54件)」。比べた 54 件の全部が、手元の基準画像と違う。例：[char-390] ホーム 2.000%、ホームの編集 11.000%、記事の一覧 4.000%。
  - つまり 24.04 の上でも、CI の画像は手元の基準画像（手元の Linux で撮った66枚）と合っていない（#527 の試験の段階のまま）。

### 1-3 #651 で保留にした理由への答え

出典：
- #651 の理由：origin/main scripts/verify/651-results.md の「判断（推奨）：保留」節（L272-289）と、projects/detail/bookshelf.md の #651 節（L4109-4135）。
- ②の判断：2026-11-14 18:27 の承認メモ。

| # | #651 で保留にした理由 | 今の状態 | 根拠 |
|---|---|---|---|
| 1 | 今の E2E では効き目が見えない（全件の時間は B/A＝1.07。直るのは「すぐ通る形」だけで、それは #640 の lint がもう禁じている） | **状況が変わった**。上げる理由が別にできた。ubuntu-latest（26.04）では 1.60.0 のブラウザが入らない。26.04 に対応したのは 1.61.0 から。#651 の「上げ直す条件2（新しい Playwright にしか無い直しや機能が要る）」に当たる | 公式の release-notes-js.md L613「Version 1.61 › Other improvements: Playwright now supports Ubuntu 26.04.」（05:50 に raw.githubusercontent.com から取得）／dd0ccd9 の本文／actions/runner-images #14748「[Ubuntu] `ubuntu-latest` label will use Ubuntu 26.04 in November 2026」（open・2026-10-19 から順に切り替え・11-19 までに終える） |
| 2a | webkit 27.2 は、この機械に無い libavif16・libgav1・libyuv を要る。入れるにはシステムの変更（sudo apt）が要る | **手元では未解消**。CI は `npx playwright install --with-deps`（ci.yml:117-121）で入るので、CI では問題ない | `/etc/os-release` は Ubuntu 24.04.5 LTS。`/sbin/ldconfig -p` に libavif.so.16・libgav1.so.1・libyuv.so.0 は0件。`apt-cache policy libavif16` は「インストールされているバージョン: (なし)・候補 1.0.4-1ubuntu3」 |
| 2b | 手元で webkit の新しい版を確かめていない（#651 では起動できなかった） | **未解消**。CI の test (webkit) が、全件を確かめる初めての場になる（24.04＋1.60.0 の run 420 では緑）。step3 で、#651 の未検証の手（3つの .so を私用のブラウザ置き場の lib/ に写す）を試す | 651-results.md L213-215 |
| 2c | 共有の node_modules を切り替えると、走っている③の画像比較がずれる | **前提が変わった**。11/14 以降の worktree は共有の node_modules を使っていない。core の worktree.mjs（L92-162・#428）は、worktree の lock が共有ツリーの lock とバイト一致の時だけ共有へ symlink し、違えば worktree の中で `npm ci` する。共有ツリーは 27f90ec のままで lock が違う。このイシューの worktree も、05:46 に core が npm ci した実体の node_modules（1.60.0）を持つ。このイシューは共有には触れない。**ただし別の形の影響が残る**（1-6 に書く）：push1 の後に npm ci した worktree は、既定のブラウザ置き場に新しい版のブラウザが無いと E2E が全部落ちる | /home/kuroko/kuroko/discord/core/worktree.mjs L92-162／#714 の計画 note（DB issues.plan・05:50）／`ls -ld node_modules`（実ディレクトリ・05:46） |
| 3 | 優先度は低い | **状況が変わった**。今は ubuntu-latest へ戻すのを塞いでいる。24.04 の image もいずれ廃止される | 依頼文 |

→ 2a・2b は手元に限って未解消。依頼文の注意どおり、上げる前のこの tp で②の判断を仰ぐ。

### 1-4 版の案

`npm view @playwright/test dist-tags`（05:50）の結果：
- latest：1.65.1
- next：1.66.0-alpha-2026-11-21
- beta：1.65.0-beta-1794598453000

計画時より新しい latest は出ていない。

| 案 | 版 | ブラウザ（browsers.json） | engines | 測った結果 |
|---|---|---|---|---|
| **A（推奨）** | 1.65.1 | chromium 159.0.8154.6（r1255）・webkit 27.2（r2388） | node>=20（CI は node 22） | #651 の A/B（11/14 の main）で測ってある。chromium・char・audit に版による赤は0件。画像の差は4枚（06-settings-section-char-{390,768,820,1024}-linux.png）。webkit は手元で起動できず、確かめていない |
| B | 1.61.1 | chromium 149.0.7827.55（r1228）・webkit 26.5（r2311） | node>=18 | 測っていない。chromium の上がり幅が小さい（148→149）ので、画像の差は A より少ない見込み。ただし後でもう一度上げ直しが要る |

- libavif16 について：playwright-core の native deps の一覧（coreBundle.js の ubuntu24.04-x64 の webkit。npm pack で取った 1.61.1・1.65.1 と、worktree の 1.60.0 を読んだ）には、3つの版のどれにも libavif16 が入っている。つまり一覧では区別できない。#651 の ldd では、26.4（1.60.0）は不要で、27.2（1.65.1）は要った。26.5（1.61.1）が要るかは**未確認**。B を選んでも 2a を避けられるかは分からない。
- 推奨は A。理由は3つ。
  - #651 で測った結果があり、手順と道具（/home/kuroko/kuroko/work/651-tools/）がそのまま使える。
  - 最新なので、次に上げ直すまでの間が長い。
  - B でも libavif16 を避けられるかは分からない。

1.61〜1.65 の Breaking changes のうち、bookshelf に効きうるもの（eaa470c で git grep）：

| 版 | 変わったこと | bookshelf で当たる所 |
|---|---|---|
| 1.65 | click・fill・selectOption などが、要素が inert でなくなるまで待つ | tests/e2e で inert を含むファイルは5本（bookshelf-clip-373・bookshelf-clip-385・esc-focus・focus-trap-deeplink・status-bar-over-faces）。#651 では、esc-focus:31 が B でだけ1回赤だったが、流し直すと A でも赤になった＝揺れ |
| 1.65 | 描画されない文字が accessible name と aria snapshot から外れる | `getByRole(…name…)` は 32 ファイル・87 行。toMatchAriaSnapshot・ariaSnapshot() は0件 |
| 1.64 | devices の screen が引き継がれる | `devices['iPhone 13']` を使うのは playwright.config.js:7（webkit）と :30（gate-webkit）の2つの project。char の6端末は tests/char-devices.js の viewport と hasTouch・isMobile で作るので、当たらない。`screen:` の指定は0件 |
| 1.64 | 見えない iframe の中の要素は hidden になる | frameLocator・contentFrame を使う E2E は13ファイル |
| 1.64 | `--update-snapshots=missing` で通るようになった | 使っている所は0件 |
| 1.65 | TS の class field・.css の import・shard・APIRequestContext・cookie・blob reporter | どれも0件（TS のテストが無い・css の import が無い・--shard が無い・request fixture が無い・cookies() が無い） |
| 1.62・1.63 | Debian 11・Ubuntu 20.04 のサポートを外した | 当たらない（CI は 24.04 か 26.04、手元は 24.04） |

→ 当たりうるのは上の4つ（inert・accessible name・devices の screen・iframe）。step2・3 で実際に流して確かめる。

### 1-5 runs-on の案

- `ubuntu-26.04` のラベルは使える。actions/runner-images の README L23 に「Ubuntu 26.04 | x64 | `ubuntu-26.04`」とある（05:50 に取得）。
- 同じ README の L25 には、まだ 24.04 の行に「`ubuntu-latest` or `ubuntu-24.04`」と書かれている（表の書き換えが後回しになっている）。一方 #14748（open）は 10/19〜11/19 に切り替えると書き、cf0655e の run 419 では実際に 26.04 で落ちた。
- README L96 には「-latest の移行は1〜2か月かけて少しずつ行う。その間 `-latest` のワークフローは OS の版が変わりうる。望まない移行を避けるには版を指定する」とある。

| 軸 | A `ubuntu-latest` | B `ubuntu-26.04` 固定 |
|---|---|---|
| ①次の LTS へ自動で切り替わる時に、今回と同じ壊れ方が起きるか | 起きうる。今回は cf0655e で4ジョブとも赤になった。Playwright をいつも新しく保てていれば避けられるが、#651 のように版を留めることがある | 起きない。切り替えは自分で行う commit になる |
| ②何の上で走っているかが commit から分かるか | 分からない。移行の1〜2か月の間は、同じ commit でも OS が違いうる（README L96）。「手元は緑で CI は赤」を追う時の手がかりが減る | ci.yml を見れば分かる |
| ③保守の手間 | 壊れるまでは何もしなくてよい | 26.04 の廃止の予告が出たら、1行を上げる（数年に1回。予告の後に一時停止の期間がある） |
| ④visual.yml への効き方 | 今はどちらでも同じ。24.04 でも 54/54 件が手元の基準画像と違う（run 3）。試験ジョブで、合否には効かない | 同じ。visual の試験を再開する時に、環境が動かない分だけ比べやすい |

**推奨は B（`ubuntu-26.04` に固定）。**
- 理由：今回の赤は「latest が知らないうちに替わった」ことから起きた。移行の期間に OS が混ざると、赤の原因の切り分けが難しくなる。B の手間は数年に1行で済む。
- 依頼文の「ubuntu-latest に戻す（または 26.04 固定のどちらが良いかを案として示す）」の案として出す。どちらを選んでも、完了条件の「24.04 固定が外れる」は満たす。

### 1-6 libavif16・共有 node_modules・#714 との順序

**#714 の計画の要点**（DB issues.plan を readOnly で読んだ。05:50 の時点で await_approve）：
- 共有の node_modules の入れ替えは「#713 より前の今」に行う。
- 再発防止は案3。npm test・npm run test:e2e の前に、lock と実際に読まれる node_modules の版を照合し（scripts/check-node-modules.mjs と pretest）、ずれていれば止める。
- #713 とは package.json の別の行を触る（#714 は scripts、#713 は devDependencies）。waitForIssues は要らない、と書いている。

**②の承認メモとの食い違い**：②の承認メモ（step1 への補足）は「#713 の push1 の後に #714 が共有を1回で揃える」を前提にしていた。#714 の計画はそれと逆の順序。

**私の答え**：
- **順序はどちらでもよい**。1-3 の 2c のとおり、今の worktree は共有の node_modules を使っていない。どちらが先でも、走っている③は巻き込まれない。
- #714 が先（今）に揃えた場合、#713 の push1 の後に共有はまた 1.60.0 に遅れる。ただし #714 の照合がそれを拾うので、揃え直すのは任意。
- 推奨案（push1 の後に1回で揃える）にこだわる理由は無くなった。#714 の計画のまま進めてよい、と考える。

**代わりに新しく見つけた影響（push1 の時に決める必要がある）**：

1. **ブラウザの置き場**
   - core の worktree.mjs は `npm ci` だけで、`playwright install` をしない。
   - 既定の置き場 /home/kuroko/.cache/ms-playwright には、1.60.0 のブラウザ（chromium-1223・chromium_headless_shell-1223・webkit-2287・ffmpeg-1011）しか無い。`.links` は1件で、指す先は /home/sei/GitHub/bookshelf/node_modules/playwright-core。
   - push1 の後に lock が 1.65.1 になった worktree（新しく作るもの、#714 の照合で npm ci し直したもの）は、chromium-1255・webkit-2388 が無いので、E2E が「Executable doesn't exist」で全部落ちる。
2. **古い版のブラウザの掃除**
   - `playwright install` は、`.links` に自分を書いた後に `_validateInstallationCache` を呼ぶ（1.65.1 の coreBundle.js。`PLAYWRIGHT_SKIP_BROWSER_GC` で止められる）。そこで、生きている link から参照されないブラウザを消す。
   - このイシューの worktree から既定の置き場に入れると、worktree を片付けた後の誰かの install で、1.65.1 のブラウザが消える。
   - 共有の node_modules を 1.65.1 にしてそこから入れると、1.60.0 のブラウザが消える。まだ 1.60.0 の worktree の E2E が落ちる。
3. **libavif16**
   - 1.65.1 に上がった worktree が手元で gate-webkit を流すと、システムに libavif16 が無い限り起動しない（2a）。CI は関係ない。

**案**（step3 の tp で②に決めてもらう）：
- (a) ブラウザ：push1 の直後に、worktree の外の消さない場所に 1.65.1 を入れた「錨」のディレクトリを作る（例：/home/kuroko/kuroko/work/playwright-anchor/1.65.1）。そこから `npx playwright install chromium webkit` を打って、既定の置き場に入れる（--with-deps なし）。`.links` に2件目の消えない link ができ、1.60.0 と 1.65.1 の両方が残る。1.60.0 の worktree が無くなったら、共有側を揃えるか、1.60.0 の link を外す。
- (b) libavif16：②が `sudo apt install libavif16`（libgav1-1・libyuv0 も付いて入る。1.60.0 の webkit 26.4 には影響しない＝#651）を認めるなら、push1 の前に入れる。認めないなら、「1.65.1 では手元の webkit は起動しない。webkit は CI で見る」をプロジェクトノートに書く。
- (c) #714 には、照合で npm ci を促す時に「新しい版のブラウザは (a) の置き場にある」と伝える（②から一言）。

### 1-7 ②に決めてほしいこと

1. **上げるかどうか**。推奨は上げる（理由 1・3 は状況が変わり、2c は前提が変わった。2a・2b は手元に限って残るが、CI では問題ない）。
2. **版**。推奨は A 1.65.1。
3. **runs-on**。推奨は B `ubuntu-26.04` に固定（代案は A `ubuntu-latest`）。
4. **libavif16 を入れるか・いつ入れるか**。推奨は push1 の前に入れる（入れない場合は、手元の webkit をあきらめて CI で見る）。
5. **#714 との順序**。推奨は、#714 の計画のまま（先に共有を揃える）でよい。代わりに、push1 の時にブラウザの「錨」（1-6 の (a)）を作る。
6. **完了条件の「main の CI が緑」**。24.04 でも単体テスト `publish-article-generator.test.js:110` の時間切れの揺れ（run 420・421）がある。#713 の範囲の外として扱ってよいか。#701 か別のイシューで直すか。

### 1-8 生の記録（_local/713/・commit しない）

- runs.json・runs2.json：runs の一覧
- jobs-420.json・jobs-420b.json：run 420 のジョブ
- ann-420-e2e.json：run 420 の e2e の annotation
- visual-run3.html：Visual の run 画面
- issue-14748.json：runner-images #14748
- release-notes-js.md：Playwright のリリースノート
- runner-images-README.md：runner-images の README
- pack/：npm pack で取った playwright-core 1.61.1・1.65.1。中身は読むだけで、実行していない

## §2 step2：worktree で 1.65.1 に上げ、lint・単体・chromium 全件を流した（2026-11-22 05:56〜06:16 JST・commit 30958ac・push していない）

②の決定（05:56）：上げる・版は 1.65.1・runs-on は ubuntu-26.04 に固定（step5 で）・libavif16 は入れない。

### 2-1 版上げ

- worktree の node_modules は、core が npm ci した実ディレクトリだった（symlink ではない）。共有の node_modules（/home/sei/GitHub/bookshelf/node_modules）の中では npm を打っていない。
- `npm install -D @playwright/test@1.65.1`。package.json の差分は `"@playwright/test": "^1.49.0"` → `"^1.65.1"` の1行だけ。
- lock の差分は、@playwright/test・playwright・playwright-core の 1.60.0 → 1.65.1（engines は node>=18 → >=20）と、playwright 1.65.1 が持たなくなった optional の fsevents 2.3.2（darwin 専用）の削除だけ（+16・−34 行）。その後の `npm ci` は通った（474 packages）。vitest は 5.1.1 のまま。
- ブラウザは `PLAYWRIGHT_BROWSERS_PATH=/home/kuroko/.cache/ms-playwright-713` に入れた（--with-deps なし）。browsers.json では chromium 159.0.8154.6（r1255）・chromium-headless-shell r1255・webkit 27.2（r2388）・ffmpeg r1013。install の最後に「libavif16 が無い」という依存の検査の警告が出た（webkit 用・予想どおり）。既定の置き場 ~/.cache/ms-playwright は chromium-1223・chromium_headless_shell-1223・ffmpeg-1011・webkit-2287 のまま（06:10 に ls で確認）。

### 2-2 lint・単体

| 検査 | 結果 |
|---|---|
| `npm run lint` | 「12 本中 0 本失敗」 |
| `npm test`（Vitest 5.1.1） | 81 ファイル・1210 件通過・todo 2・0 件失敗 |

### 2-3 chromium 全件（CI の e2e レグと同じ形・B＝1.65.1）

`E2E_SKIP_KNOWN_RED=1 npx playwright test --project=chromium --grep-invert "sort-perf-budget"`（PORT 8113）。core の再起動で2回止められた（05:59・06:01 の回は exit 137）ので、3回目は `systemd-run --user` の別スコープで流した（#634 の作法）。

| 回 | 時刻 | 負荷（前→後） | 通過 | 失敗 | 揺れ | skip | 壁時計 | duration の合計 |
|---|---|---|---|---|---|---|---|---|
| B3 | 06:03:54〜06:08:22 | 5.40 → 22.68 | 1014 | **0** | 0 | 17 | 268.0 秒（8 workers） | 1945.4 秒 |

- 基準（24.04＋1.60.0 の CI run 420）は 1013 件通過・17 skip・0 件失敗。1件多いのは、その後に #699 が足した J5-7 の chromium の分。
- **chromium 全件に、版による赤は無い。**1.61〜1.65 の Breaking changes（inert を待つ click・accessible name・hidden な iframe）に当たる赤も出なかった。

### 2-4 sort-perf-budget（workers=1 の単独）と、赤の分け方

B1 が赤だったので、(6) のとおり B→A→B→A で流した（`_local/713/step2/run-perf-ab.sh`。A は worktree の node_modules を node_modules.713 へ退け、共有の 1.60.0 へ symlink。trap で戻す。戻った後の版は 1.65.1 で、実ディレクトリであることを確かめた）。

| 回 | 版 | 時刻 | 負荷（前→後） | 結果 | 落ちた所 |
|---|---|---|---|---|---|
| B1 | 1.65.1 | 06:08:34〜06:09:33 | 22.12 → 22.11 | 赤 | direction の inputDelay 中央値 382.3ms ＞ 予算 320ms（ローカル判定） |
| B2 | 1.65.1 | 06:10:03〜06:10:07 | 20.32 → 19.49 | 赤 | 2.9 秒で `AssertionError: assert(!this.paused)`。予算の判定に届く前。Playwright の lib にも spec にもこの文は無く、出どころは未確認 |
| A1 | 1.60.0 | 06:10:07〜06:11:06 | 19.49 → 14.96 | 赤 | drag の tFrame 中央値 152.6ms ＞ 予算 120ms（ローカル判定） |
| B3 | 1.65.1 | 06:11:06〜06:13:14 | 14.96 → 7.61 | 通過 | |
| A2 | 1.60.0 | 06:13:14〜06:15:24 | 7.61 → 3.46 | 通過 | |

- 分類：**両方赤**（負荷が 15〜22 の時は 1.60.0 も 1.65.1 も予算を超え、負荷が下がると両方通る）。版による赤（B だけ赤）ではない。
- CI では絶対の予算は「CI記録のみ」で、合否には使っていない（run 420 の annotation では 1.60.0 の direction inputDelay 中央値 353.1ms でも通過）。
- B2 の `assert(!this.paused)` は1回だけで、同じ版の B3 は通った。出どころを確かめる時間が無かったので、揺れとして扱い、step3 以降と CI で同じものが出ないかを見る。

### 2-5 計画との違い

- port は②の指示どおり 8113（計画の 8713 ではない）。使う前に毎回 `ss -ltn` で空きを確かめた。
- このステップの run は、core の再起動で4回打ち切られた。2回は流している E2E ごと止められた（exit 137）。長い E2E は `systemd-run --user --unit=issue713-*` で流した。
- main の CI（24.04・1.60.0）：run 422（8604cf1）は success（4ジョブとも緑）、run 421（c0e99c2）は failure（単体テストの時間切れ・#699 の記録）。424・425 は 06:04 の時点で実行中。

## §3 step3：char・audit・webkit・画像比較を新しい版で流し、基準画像の差分を分けた（2026-11-22 06:16〜06:23 JST・push していない）

core の再起動に巻き込まれないよう、全部 `systemd-run --user` の別スコープから流した（`_local/713/step3/lanes.sh`）。
- レーン1（PORT 8113）：char → 画像比較 B1 → B2 → webkit
- レーン2（PORT 8713）：audit → 画像比較 A1

A（1.60.0）は、worktree の node_modules を付け替えずに行った。HEAD を `git archive` で `_local/713/A-tree` に書き出し、そこから共有の node_modules（1.60.0）へ symlink した。こうすると、B のレーンと同時に流せる。

### 3-1 結果の表

| 組 | 版 | 時刻 | 負荷（前→後） | 通過 | 失敗 | 揺れ | skip | 時間 |
|---|---|---|---|---|---|---|---|---|
| char（6端末・CI の char レグと同じ） | 1.65.1 | 06:17:51〜06:18:42 | 3.32 → 23.34 | 199 | **0** | 0 | 575 | 50.7 秒 |
| audit（`npm run audit -- --workers=4`・CI と同じ） | 1.65.1 | 06:17:51〜06:21:07 | 3.32 → 11.60 | 巡回・a11y・buttons・layout とも exit 0 | **0** | — | — | 巡回 195 秒 |
| webkit（`GATE_WEBKIT=1 --project=gate-webkit --workers=1`） | 1.65.1（webkit 27.2） | 06:19:09〜06:23:08 | 24.54 → 7.14 | 76 | **0** | 0 | 12 | 238.7 秒 |
| 画像比較 B1 | 1.65.1 | 06:18:42〜06:18:56 | 23.34 → 22.51 | 50 | 4 | 0 | 0 | 13.2 秒 |
| 画像比較 B2 | 1.65.1 | 06:18:56〜06:19:09 | 22.51 → 24.54 | 50 | 4 | 0 | 0 | 12.2 秒 |
| 画像比較 A1 | 1.60.0 | 06:21:07〜06:21:19 | 11.60 → 11.77 | 54 | **0** | 0 | 0 | 11.2 秒 |
| 画像比較 B3（基準画像を撮り直した後） | 1.65.1 | 06:21:39〜06:21:48 | — | 54 | **0** | 0 | 0 | 8.1 秒 |

- char の 199 通過・575 skip は、#651 の A（1.60.0）と同じ数。
- audit の件数（`_local/gate/audit.json`）：lint:copy 119・用語表 1・aria 22・alt 0・ボタン名 8・表示崩れ 100（clip 70・overflow 30・pageX 0・overlap 0）。「OK: 上限以内」で、赤は0件。赤が無いので、計画どおり A では流していない。
- webkit の 76 通過・12 skip は、#699 が 1.60.0（webkit 26.4）で gate-webkit を流した時の数（88 件中 76 通過・12 skip・0 失敗）と同じ。

### 3-2 webkit 27.2 は、システムを変えずに起動した

- システムの libavif16 などは無いまま（sudo apt はしていない）。
- `apt-get download libavif16 libgav1-1 libyuv0` で .deb を取った（Ubuntu 24.04 の 1.0.4-1ubuntu3・0.18.0-1build3・0.0~git202401110.af6ac82-1）。`dpkg-deb -x` で `_local/713/avif/root/` に展開した。
- 3つの .so（libavif.so.16・libgav1.so.1・libyuv.so.0）を、私用のブラウザ置き場の `/home/kuroko/.cache/ms-playwright-713/webkit-2388/minibrowser-wpe/lib/` に写した。これで MiniBrowser が起動し、gate-webkit が全件通った。
- #651 で効かなかった LD_LIBRARY_PATH と違い、ラッパー（pw_run.sh）が自分で読む lib/ に置けば読まれる。
- ldd では、この lib/ だけを見ると libbacktrace.so.0・libjxl.so.0.8 も「not found」と出た。ただし起動と全件の通過には差し支えなかった（ラッパーが他の場所も足すため、と考えられる。確かめていない）。
- **他の③への意味**：push1 の後、新しい版のブラウザを既定の置き場（錨）に入れる時も、同じ3つの .so を `webkit-2388/minibrowser-wpe/lib/` に写せば、システムを変えずに手元の webkit が動く見込み。

### 3-3 画像比較の差分：4枚とも版によるもの

| 基準画像 | B1 の差の画素 | B2 の差の画素 | A1（1.60.0） | 判定 |
|---|---|---|---|---|
| 06-settings-section-char-390-linux.png | 1368 | 1368 | 差なし | 版によるもの |
| 06-settings-section-char-768-linux.png | 2880 | 2880 | 差なし | 版によるもの |
| 06-settings-section-char-820-linux.png | 4021 | 4021 | 差なし | 版によるもの |
| 06-settings-section-char-1024-linux.png | 1892 | 1892 | 差なし | 版によるもの |

- B1 と B2 の実際の画像は、sha256 で4枚とも同じ。画素数は #651 の測定（11/14）とも同じ。揺れは0件。
- 比較の画像（左から期待＝1.60.0 の基準画像・実際＝1.65.1・差分）：
  - 1件ずつ：`/home/kuroko/kuroko/work/713-visual/01-06-settings-section-char-390-linux.png`〜`04-06-settings-section-char-1024-linux.png`
  - 縦につないだ1枚：`/home/kuroko/kuroko/work/713-visual/all.png`
- 違いの中身：
  1. **4幅とも、保存先の `<select>` のフォーカスの枠**。1.60.0 は橙の枠（フォーカスが当たったまま）、1.65.1 は通常の枠。
  2. **820 の見出し**。1.60.0 は「← ［同期］ … ×」、1.65.1 は「← 設定 ［同期］」で、× が無い。1.65.1 の形は、同じ狭い画面の 390・768 と同じ。
     - 幅の判定は版で変わらない。index.html と同じ meta viewport のページで 820×1180・hasTouch・isMobile を測った結果は、両方の版で同じだった（innerWidth 820・`(max-width: 900px)` 一致・hover none・pointer coarse。`_local/713/step3/probe-820.mjs`）。
     - つまり、境目（js/ui/viewport.js の 900px・#505）の判定が変わったのではない。撮る時点の画面の状態が版で変わった。
     - 1.65.1 の形の方が、「900px 以下は狭い画面」の決まり（#505）に沿っている。#651 は「820・1024 のアイコン」と書いていたが、820 の差は見出しの形だった。
  3. **1024 の左の一覧の「アカウント」「ログイン」のアイコン**。1.60.0 の基準画像は点だけで、1.65.1 では描かれる（#651 と同じ）。
- 文字の描き方の差は無い。
- 820 の形が版で変わった原因は突き止めていない（幅の判定が同じことだけを確かめた）。
- 新しい形（← 設定・× なし）は #505 の「900px 以下は狭い画面」の決まりに合う（②が 06:26 に確かめ、前の基準画像の方が決まりから外れていたと判断）。
- **基準画像の更新**：この4枚だけを、B2 の実際の画像で撮り直した（da0e000・package.json・lock の commit 30958ac とは別）。古い4枚は `_local/713/step3/old-baselines/` に残した。撮り直した後の B3 は 54 件とも通った。ほかの 50 枚は触っていない。

### 3-4 ②に決めてほしいこと（step3 の tp）

1. 基準画像の更新の範囲：4枚（da0e000）でよいか。特に 820 は、見出しが × の形から「← 設定」の形に変わる（狭い画面の決まりには合う）。
2. push1（30958ac・da0e000・713-results.md。runs-on は 24.04 のまま）をしてよいか。
3. 錨のブラウザ置き場に、3つの .so を写してよいか（3-2。システムは変えない）。
