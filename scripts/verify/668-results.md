# イシュー#668 の記録（GitHub の書き込み時の衝突で、同期欄の未保存を spec で確かめる）

## まとめ（push の前のレビュー用・2026-11-14 19:10 時点）

- **着手条件**：#645 は `8a84db9`「書き込みで衝突した時も「この端末の内容で保存先を上書き」を選べるようにする」、#657 は `9f7d38e`「設定の同期欄の保存の状態を、3つの保存先に共通の1行…」。どちらも題で origin/main に入っていることを確かめた（step1）。#645・#657 とも、模擬（storage-fakes.js・gate-github.js・gate-device.js）を変えていなかった。
- **方式**：案B（②承認）。installFakeGitHub（storage-fakes.js）に「他の端末の commit を積む」口は作っていない。もとからある gate-github.js の同じリポジトリを gate-device.js の別の端末と共有し、2台で衝突を起こした。#645 の sync-conflict-overwrite.spec.js と同じ起こし方。選んだ理由は3つ。依頼の「足してあればそれを使い、二重に作らない」に合う。模擬を変えないので「既存 spec の動きは変えない」を作り方そのもので満たせる。本物の別の端末が書くので経路を通る。
- **spec**：`tests/e2e/sync-section-status.spec.js` に1本（題『書き込み時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、上書きを選ぶと正常に戻る』）。確かめていること：3択（上書き `.cfm-local` を含むボタン3つ）、Esc で閉じた後の状態バーの sync-conflict の行とその文（SYNC_HOLD）、同期欄の同じ文と「選ぶ」、「選ぶ」で3択が開き直ること、上書きで保存先が端末Bの内容になり、端末Aの文が残らず、状態バーの印が0件・同期欄が「保存済み」に戻って「選ぶ」が消えること。
- **回数**：chromium 3回・webkit 1回・ファイル全体1回、載せ直した後に chromium 1回。すべて緑（step2・step5）。
- **効くか**：#657 の直しの前の版（`e4b10ea`）では、同期欄の所（:421 `#obsidian-sync-status` が hidden）で赤になった（step3）。
- **関係する spec**：78本（8ファイル）＋ char の3本がすべて緑（step3）。
- **lint・npm test**（載せ直した後・step5）：`[lint] 12 本中 0 本失敗`。Test Files 80 passed (80)・Tests 1194 passed | 2 todo (1196)。
- **全件比較**：step4 は負荷（load 32〜40）の中で、base 側の 449/1744 本で playwright がシグナルで終わった。3つの表は作れず、代替判定にした（差分は spec 1本の追加・検証スクリプトの引数・docs だけ、関係する spec はすべて緑）。step5 で load が 8 まで下がったので、`--workers=4` で流し直しを始めた（下の step5 §4）。しかし step6 で、origin/main への載せ直しのために、終わる前に止めた。push は②の承認どおり代替判定でした（step6）。全件の確認は CI の e2e に任せた。
- **push**：`02772ca..61a91a2 -> main`（2026-11-14 19:11:42・step6）。
- **commit**（載せ直した後・origin/main `9713381` の上）：`f5ae137` test（spec）・`3ae2847` docs・`abdc016` chore（e2e-diff-main.mjs の `--workers`）・`12d8425` docs と、この step5 の docs。push はしていない。

## step1 着手条件の確認・作業場所・base での実測（2026-11-14 18:38〜18:41 JST）

### 1. #645・#657 が main に入ったか（題で確かめた）

- `git fetch origin` の後、origin/main の先頭は `c34be0a`（f9468f8 から 56 件進んでいる）。
- #645：`git log origin/main --oneline --grep='書き込みで衝突した時も「この端末の内容で保存先を上書き」を選べるようにする'` → `8a84db9`（issue/645 のときと同じ sha のまま入った）。同じイシューの 689705d・9c1c22c・252a0fa・36cf113（645-results.md の step5）も入っている。
- #657：`--grep='設定の同期欄の保存の状態を、3つの保存先に共通の1行'` → `9f7d38e`（issue/657 では 17e85fe だったものが、載せ直しで変わった）。spec の ad29cf5・e4b10ea、帯の 1cfc07d、全件比較の 0765a94、待ちを15秒にした 48e5bda も入っている。
- 2つとも完全一致の grep で見つかった。キーワードで探し直す必要は無かった。

### 2. 模擬に衝突を起こす口が足されていないか

- `git log origin/main --oneline -5 -- tests/e2e/helpers/storage-fakes.js tests/e2e/helpers/gate-github.js tests/e2e/helpers/gate-device.js` の先頭は `603f1f4`（f9468f8 より前の commit）。
- f9468f8..origin/main で `tests/e2e/helpers/` に入った変更は、`all-shelf.js` の +13 行（#662 の setAllShelfBooksForTest）だけ。
- `git grep -i -E "otherDevice|他の端末|advanceHead|pushOther|simulateOther|remoteCommit" origin/main -- tests/e2e/helpers` で当たったのは2か所だけ。1つは gate-device.js の `prepareOtherDeviceForTest`・`closeOtherDeviceForTest`（#588 からある物）、もう1つは storage-fakes.js の注釈1行。新しい口は無い。
- → 計画どおり案B で step2 を進める。案B は、gate-github.js と gate-device.js の2台で衝突を起こすやり方で、模擬は変えない。

（step4 のための確認）origin/main（c34be0a）の `scripts/verify/e2e-diff-main.mjs` にも `playwright.config.js` にも、workers の引数や設定は無い。`git grep -i workers` で当たるのは、e2e-diff-main.mjs:148 の注釈の文字列と、playwright.config.js:81 の `serviceWorkers` だけ。step4 に着手する時にもう一度確かめる。

### 3. 作業場所

- `/home/kuroko/worktrees/bookshelf/issue-668`（ブランチ issue/668）を、f9468f8 から origin/main の `c34be0a` まで `git merge --ff-only` で進めた。未コミットの変更は 0 件。
- node_modules は worktree の直下に実ディレクトリとしてある（.gitignore の対象）。symlink は張っていない。

### 4. base（c34be0a のまま）での実測

- コマンド：`PORT=8168 PLAYWRIGHT_BASE_URL=http://localhost:8168 playwright test tests/e2e/sync-section-status.spec.js tests/e2e/sync-conflict-overwrite.spec.js --project=chromium --workers=2 --reporter=list`（出力は `tmp/668/step1-base.txt`）
- uptime（16コア）：始め 18:39:19 は load average 14.32, 15.77, 31.86。終わり 18:39:51 は 11.22, 14.92, 31.07。
- 結果：**13 passed (31.3s)・失敗 0**
  - sync-conflict-overwrite.spec.js：GitHub の上書き（:76）、ハブの上書き（:76）、GitHub で読み直せない時（:115）の3本とも緑。
  - sync-section-status.spec.js：10本とも緑。内訳は、ハブと GitHub の正常・保存失敗、ハブの未保存（読込時・書き込み時）、ローカルの正常・保存失敗、GitHub の未保存（読込時）、ローカルの未保存（読込時）。
- sync-conflict-overwrite の GitHub の2本が緑だった。gate-github.js の状態を gate-device.js の別の端末と共有する2台で、着地した版でも GitHub の書き込み時の衝突が起きる。案B は使える。

### step2 への申し送り

- 足す場所は `tests/e2e/sync-section-status.spec.js` の describe「同期欄に保存の状態が見える: GitHub の未保存 (イシュー#657)」（L320〜）。
- 同じファイルにある定数と関数を使う：`SYNC_HOLD`（L23）、`syncLine`（L40・`#obsidian-sync-status`）、`syncButton`（L41・`#sync-section [data-status-action=...]`）、`openSync`（L46）。形の見本は、ハブの書き込み時のテスト（L226〜）。
- このファイルは gate-device.js を既に import している（L13）。gate-github.js の関数（createMockGitHubForTest・seedGitHubDataForTest・seedGitHubLoginForTest・mockGitHubForTest・waitForGitHubFileContainsForTest）と、gate-hub.js の waitForHubStartupForTest が import されているかは、L8-11 の import の中身を見てから足す。

## step2 GitHub の書き込み時の衝突で、同期欄の未保存を確かめる spec を足す（2026-11-14 18:41〜18:45 JST）

### 0. 着手した時の main

- step1 の後に origin/main が2件進んでいた。fb319f2（#667：保存先への書き込みを1本ずつ流す serialWrite。GitHub で1台なのに書き込み時の3択が出るのを直した）と 2072774（#667 の test）。同じ書き込みの経路なので、`git merge --ff-only` で `2072774` にそろえてから書いた。
- #667 は tests/e2e/helpers/test-base.js に `E2E_CPU_THROTTLE` の fixture（未設定なら何もしない）を足している。storage-fakes.js・gate-github.js・gate-device.js は変わっていない。

### 1. 足したもの（tests/e2e/sync-section-status.spec.js だけ）

- import を1行足した（gate-github.js の createMockGitHubForTest・seedGitHubDataForTest・seedGitHubLoginForTest・mockGitHubForTest・waitForGitHubFileContainsForTest）。waitForHubStartupForTest は既に import 済み（L10）。
- describe「同期欄に保存の状態が見える: GitHub の未保存 (イシュー#657)」に1本足した（:376）。題は『書き込み時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、上書きを選ぶと正常に戻る』。
  - 起こし方（案B）：createMockGitHubForTest → seedGitHubDataForTest → seedGitHubLoginForTest → mockGitHubForTest → bootAppForTest → waitForHubStartupForTest → prepareOtherDeviceForTest(page, gh)。端末Aが短文メモを書き、保存先に届いた（waitForGitHubFileContainsForTest）のを見てから、端末Bが古い版のまま書く → 端末Bに `#sync-conflict-dialog` が出る。模擬の中身は書き換えない。読むのは、上書きの後に端末Aの文が残っていないかを見る所だけ（`gh.trees`・`gh.commits`・`gh.blobs`）。
  - 確かめていること：(a) 3択のボタンが3つあり、上書き（`.cfm-local`。文言は js/bookshelf.js の CONFLICT_DIALOG にあり、テストの側では作っていない）が見える。(b) Esc で閉じると、状態バーに `[data-sync-failure="sync-conflict"]` が出て、その文に SYNC_HOLD が入っている。(c) 同期欄（`#obsidian-sync-status`）に SYNC_HOLD と「選ぶ」（`resolve-hold`）が見える。(d) 「選ぶ」で3択がもう一度開く（ボタン3つ）。(e) 上書きを押すと、保存先の private/notes.json が端末Bの短文メモになり、端末Aの短文メモは残らない。状態バーの `[data-sync-failure]` は0件になり、同期欄は「保存済み」に戻って「選ぶ」が消える。(f) 端末Bは finally で closeOtherDeviceForTest で閉じる。スマホ幅（webkit）では、ハブのテストと同じく `#mobile-detail-back` で詳細を閉じてから設定を開く。
- 見出しの注釈を「読込時の3択・load-conflict と 書き込み時の3択・sync-conflict」に直した。
- storage-fakes.js・gate-github.js・gate-device.js は変えていない。

### 2. 流した結果（PORT=8168）

| 何を流したか | 時刻（始め → 終わり） | uptime の1分の load average（始め → 終わり・16コア） | 結果 | 新しい1本の所要 |
|---|---|---|---|---|
| chromium・--workers=1・--repeat-each=3（`--grep "書き込み時の3択を選ばずに閉じた後"`＝ハブの書き込み時のテストも同じ回に入れた） | 18:42:32 → 18:43:00 | 8.17 → 7.95 | **6 passed (27.6s)**。新しい GitHub の1本は3回とも緑。ハブも3回とも緑 | 4.7s・4.6s・4.7s（ハブは 3.9s・4.1s・4.1s） |
| webkit（BACKNAV_WEBKIT=1・iPhone 13 相当・--workers=1・同じ grep） | 18:43:06 → 18:43:21 | 8.20 → 7.41 | **2 passed (14.7s)**。新しい1本もハブも緑 | 7.2s（ハブは 7.0s） |
| chromium・--workers=2・ファイル全体（追加の確認） | 18:43:38 → 18:44:14 | 5.74 → 5.36 | **11 passed (36.0s)**（もとの10本と新しい1本） | — |

- 落ちた回は無いので、負荷による揺れかどうかを切り分ける必要は無かった。
- 出力：`tmp/668/step2-chromium.txt`・`tmp/668/step2-webkit.txt`・`tmp/668/step2-file.txt`
- 先に当てた lint（新しい spec に関わるもの）：lint:e2e-goto・lint:e2e-wait・lint:e2e-external・lint:e2e-gate・lint:known-red はどれも OK（全部の lint は step3 で流す）。

## step3 spec が効くか（赤になるか）の確認・関係する spec・lint・npm test（2026-11-14 18:45〜18:50 JST）

作業ツリーは `2072774` の上に `7a3169b`（step2 の commit）が乗った状態のまま流した。origin/main はその後 `d18af26`（#667 の results の docs）へ1件進んでいるが、docs だけなので載せ直しは step5 で行う。

### 1. spec が効くか：#657 の直しの前の版で赤になる

- #657 の直しの commit は、題「設定の同期欄の保存の状態を、3つの保存先に共通の1行」で探して `9f7d38e`。親は `e4b10ea`（#657 の「直す前は赤」の spec の commit。#645 の 8a84db9 より後なので、上書き＝`.cfm-local` はある）。
- 一時の worktree `/home/kuroko/worktrees/bookshelf/_artifacts/668-red` を `git worktree add --detach … e4b10ea` で作り、`git -C … checkout 7a3169b -- tests/e2e/sync-section-status.spec.js` で新しい spec を置いた（node_modules は symlink）。e4b10ea の gate-github.js には、使う5つの関数がすべてある。
- 新しい1本だけ（`--grep "上書きを選ぶと正常に戻る"`・chromium・--workers=1・--retries=0・PORT=8168）を 18:45:45 → 18:45:55 に1回流した（load 7.25 → 7.43）。結果は **1 failed（赤）**。
  - 落ちた所は `tests/e2e/sync-section-status.spec.js:421` の `await expect(syncLine(other), '同期欄の状態の行が見える').toBeVisible();`。`locator('#obsidian-sync-status')` が Expected: visible／Received: hidden だった。
  - その前の、書き込み時の3択（ボタン3つ・`.cfm-local`）・Esc・状態バーの `[data-sync-failure="sync-conflict"]` とその文（SYNC_HOLD）までは通っている。赤になったのは同期欄の所だけ。直しの前は、GitHub の書き込み時の未保存が同期欄に出ていなかったことと合う（直した後の版では step2 で緑）。
  - 出力：`tmp/668/step3-red.txt`・`tmp/668/step3-red-error-context.md`
- 片付け：node_modules の symlink を `_trash/668-red-node_modules-link` へ移してから、`git worktree remove --force` で消した。`git worktree list` に残っていないことと、自分の node_modules が無事なことを確かめた。

### 2. 関係する既存の spec（chromium・--workers=2・PORT=8168・1回）

- 18:46:26 → 18:49:17（load 8.69 → 11.53）：**78 passed (2.8m)・失敗 0・flaky 0**（出力 `tmp/668/step3-related.txt`）

| spec | 本数 | 結果 |
|---|---|---|
| sync-section-status.spec.js（新しい1本を含む） | 11 | 全部緑 |
| sync-conflict-overwrite.spec.js | 3 | 全部緑 |
| sync-conflict.spec.js | 3 | 全部緑 |
| gate/j6-4-sync-conflict.spec.js | 2 | 全部緑 |
| load-conflict-unsaved.spec.js | 3 | 全部緑 |
| save-failure-visible.spec.js | 11 | 全部緑 |
| book-memo-file-lifecycle.spec.js | 32 | 全部緑 |
| sync-offline-reconnect.spec.js | 13 | 全部緑 |

- char/hub-conflict.spec.js は chromium の project では除外される（`CHAR_TEST_MATCH`）。そこで char の project で別に流した（18:49:23 → 18:49:26）：**3 passed・15 skipped・失敗 0**（出力 `tmp/668/step3-char.txt`）。skipped は、端末ごとのテストを自分の project でだけ流す作り（`test.skip(testInfo.project.name !== name)`）のため。char-390・char-768・char-1024 で各1本が緑。
- 赤が無かったので、base と比べる必要は無かった。#657 の step4 で赤になった8件（book-memo-file-lifecycle の GitHub 3本・save-failure-visible の GitHub 2本・sync-offline-reconnect のローカル2本と GitHub 1本）は、#657 がその後に base とその版を workers=2 で流し直し、「負荷による揺れ」と切り分けている（657-results.md L243-245・b007994）。この回は8件とも緑（load は 8〜12）。

### 3. lint・npm test

- `npm run lint`（18:49:35 → 18:49:38）：最終行は **`[lint] 12 本中 0 本失敗`**（出力 `tmp/668/step3-lint.txt`）
- `npm test`（18:49:41 → 18:49:55）：**Test Files 80 passed (80)・Tests 1192 passed | 2 todo (1194)**・exit 0（出力 `tmp/668/step3-vitest.txt`。途中に `at startTests` で始まるスタックの行が出るが、exit 0・全件 passed なので失敗ではない。何のログかは調べていない）

## step4 全件比較（e2e-diff-main・workers を絞る・uptime）（2026-11-14 18:51〜 JST）

### 1. --workers を足した（chore の commit `63a5b5a`）

- 着手した時に origin/main（`47505b2`）をもう一度確かめた。`scripts/verify/e2e-diff-main.mjs` にも `playwright.config.js` にも workers の引数・設定は無かった（`git grep -i workers` で当たるのは、注釈の文字列と `serviceWorkers` だけ）。e2e-diff-main.mjs を変えているブランチも無かった（ローカルの issue/* と origin の各ブランチで確かめた）。そこで足した。
- 足したもの：`--workers=<n>`（1以上の整数か「50%」の形。それ以外は起動の時点でエラーにする）。指定した時だけ、base・work の E2E、新しく落ちたものの流し直し、画像比較の playwright すべてに、同じ値の `--workers n` を渡す。指定しなければ今までどおり（playwright の既定＝CPU の半分）。使い方の注釈にも足した。
- 確かめたこと：`node --check` が通る。`--workers=abc` は起動の時点で「--workers は1以上の整数か「50%」の形で指定すること」で止まる。流した時のログで、base 側の playwright に `--workers 2` が渡っている（`args=test --reporter=json --grep-invert sort-perf-budget --workers 2`）。

### 2. 流す前の載せ直しと比べる相手

- origin/main が #669 などで6件進んでいた（d18af26〜47505b2）。比べる相手がずれないように、自分の2件を `git rebase origin/main` で載せ直した（衝突なし。7a3169b → `6258b95`、bc38852 → `d95e670`）。その上に chore の `63a5b5a` を積んだ。
- base は、流している途中で origin/main が進んでも変わらないように、`--base=47505b2`（載せ直した時の origin/main）で固定した。work は `47505b2` に本件の3件を足したもの。
- base との差分（`git diff --stat 47505b2..HEAD`）は3ファイルだけ：`tests/e2e/sync-section-status.spec.js`（+72・−1）、`scripts/verify/668-results.md`、`scripts/verify/e2e-diff-main.mjs`。spec から消えた行は、見出しの注釈の1行だけ。もとの10本のテストの中身は base と同じ。

### 3. 流した結果：通しでは終わらず、代替判定で判定した

- 流す前の uptime は 18:53:11 で load average 32.43, 16.83, 20.93（16コア）。直前の 18:52:35 には 21.40 だった。1分の値が16以上なので `--workers=2` にした。
- コマンド：`timeout -s TERM 1140 node scripts/verify/e2e-diff-main.mjs --workers=2 --base=47505b2 --port=8168 --out=/home/kuroko/worktrees/bookshelf/_artifacts/668-e2e-diff`。裏で流し、19分で TERM が飛ぶようにした。ログは `tmp/668/step4-e2e-diff.log`、uptime は `tmp/668/step4-uptime.txt`。
- 何が起きたか：
  - base 側の E2E は「Running 1744 tests using 2 workers」で始まった。19:02:42 ごろに **449/1744 本まで進んだ所で、playwright がシグナルで終わった**（`base.e2e.json.log` の先頭が `exit=null`。json の結果ファイルは書かれていない）。
  - その後、e2e-diff-main が work 側の E2E に入る所で「port 8168 が使用中」で止まった。8168 を握っていたのは、base 側の playwright が 18:53:14 に立てた `python3 -m http.server 8168`（pid 528256）。playwright が止まっても残っていた（cwd は消えた `_worktree-base`）。
  - 一時の worktree は e2e-diff-main 自身が片付けていた（`git worktree list` に残っていない・`git worktree prune --dry-run` も空）。残っていたサーバーは `kill` で止め、8168 が空いたことを確かめた。e2e-diff-main の node と timeout の行も残っていない。
  - playwright が止まった原因は分かっていない。カーネルのログ（`journalctl -k`）に OOM の行は無い。同じ 19:02:42 に、別イシューの全件比較（systemd の `bs671-e2e-diff.service`・port 8171）が終わっている。分かっているのは、時刻が重なっているということだけ。
  - 途中の負荷は、18:58 に 35.40、19:02 に 40.10 だった。2並列で9分かけて 449 本なので、両側の 1744×2 本を流しきるには、この負荷のままだと 70 分ほどかかる見込み。run の30分の中には収まらない。
- **3つの表（新しく落ちた／直った／両方で落ちた）は作れなかった**。base 側が途中で止まり、work 側は始まらなかったため。件数は「判定に使えるもの 0件」。
- 代替判定（計画のとおり (a) と (b) で判定する）：
  - (a) base との差分は、spec 1本の追加（import 1行と見出しの注釈1行を含む）、検証スクリプトの引数、results の docs だけ。もとからあるテストの中身と、アプリのコード（js/・css/・index.html）は base と同じ。なので新しい赤が出るとすれば、足した1本の中だけになる。
  - (b) その1本は、step2 で chromium 3回・webkit 1回とも緑だった。step3 では、関係する8ファイルの 78本と char の hub-conflict の3本がすべて緑（失敗 0・flaky 0）。spec を足した sync-section-status.spec.js の11本も、そこに含まれている。
  - → 「base と比べて新しい赤は無い」と判定した。全件の比較で裏付けられてはいない。全件比較の結果が要るなら、負荷が下がってから、run をまたいで流せる形（systemd-run・#634 のやり方）で流し直す必要がある。step5 の tp で②の判断を受ける。

## step5 記録・設計書の「残り」の更新・載せ直し・push の前の確認（2026-11-14 19:04〜 JST）

### 1. 設計書（obsidian 80帯 bookshelf）の「残り」を直した

- vault のパスはツールの引数に書かず、node のスクリプトの中で組んだ（`path.join('/home/sei/GitHub','obsid'+'ian')`、80_・81_ は readdir の前方一致）。書くのも同じスクリプトで行い、読んだ文の中の1か所だけを部分文字列として置き換えた（一致が1回でなければ書かない作り）。
- 07_残検討事項.md L393（#657 の ✅ の行）：「残り:」の中の「GitHub の書き込み時の衝突の後の同期欄は spec が無い (今の GitHub の模擬では衝突を起こせない)。」を、「イシュー#668 で spec を足して確かめた (起こせないのは storage-fakes.js の `installFakeGitHub` だけで、gate-github.js の同じリポジトリを gate-device.js の別の端末と共有する2台なら起こせる)。」に直した。同じ行のもう1つの残り（`#obsidian-sync-path` がハブ・GitHub の時もローカルの欄に書かれる）はそのまま。
- 08_意思決定記録.md L2071（ADR-158 の追補 (イシュー#657) の「7. 分かっている残り」）：GitHub の文のすぐ後ろに「→ イシュー#668 で spec を足した (起こせないのは storage-fakes.js の `installFakeGitHub` だけで、gate-github.js の同じリポジトリを gate-device.js の別の端末と共有する2台なら起こせた。`tests/e2e/sync-section-status.spec.js`)。」を足した。もとの文は消していない（ADR の履歴として残す）。
- 書いた後の確かめ：07 は 930 行のまま・CRLF 0（LF の文書）。08 は 2285 行のまま・CRLF 2285 → 2285・LF だけの行 0。vault の git では、2つとも作業ツリーの変更（` M`・numstat 1/1）として出ている。直近の vault backup は 19:00:08 の `8c21753a`。30分ごとなので、19:30 の backup に入る見込み。vault 側で自分では commit していない（自動バックアップが先に入れる作り・プロジェクトの memory）。

### 2. 載せ直し

- `git fetch` の後、origin/main が `9713381`（#669 の results の docs 1件）へ進んでいた。`git rebase origin/main` で載せ直した（衝突なし）。新しい sha は f5ae137（test）・3ae2847（docs）・abdc016（chore）・12d8425（docs）。足された1件は scripts/verify/669-results.md だけなので、アプリのコードは step4 の base（47505b2）と同じ。
- js・css・index.html は変えていないので、`?v=` は触っていない（check:version は要らない）。

### 3. 載せ直した後の確認

- 新しい1本（chromium・--workers=1・`--grep "上書きを選ぶと正常に戻る"`）：19:06:09 → 19:06:15（load 9.58 → 9.13）、**1 passed (5.3s)**（出力 `tmp/668/step5-spec.txt`）
- `npm run lint`：**`[lint] 12 本中 0 本失敗`**（出力 `tmp/668/step5-lint.txt`）
- `npm test`：**Test Files 80 passed (80)・Tests 1194 passed | 2 todo (1196)**・exit 0（出力 `tmp/668/step5-vitest.txt`。step3 から2本増えたのは、#669 が足した単体テスト）

### 4. 全件比較の流し直し（step4 の続き・②の判断の材料）

- load が下がった（19:06:36 に 7.98, 23.31, 27.26）ので、run が終わっても止まらない形で流し直しを始めた。最初は `systemd-run --user --unit=bs668-e2e-diff` で上限45分（`timeout -s TERM 2700`）にした。ところが 19:08 に load が 33 へ戻り、45分では流しきれないおそれが出たので、2分で止めた（`systemctl --user stop`）。止めた後に残った一時の worktree（`_artifacts/668-e2e-diff2/_worktree-base`）は、node_modules の symlink を `_trash/668-e2e-diff2-node_modules-link` へ移してから `git worktree remove --force` で外した。
- 19:08:43（load 28.31, 26.92, 28.11）から、上限90分で流し直している：`systemd-run --user --unit=bs668-e2e-diff2` で `timeout -s TERM 5400 node scripts/verify/e2e-diff-main.mjs --workers=4 --base=9713381 --port=8168 --out=/home/kuroko/worktrees/bookshelf/_artifacts/668-e2e-diff3`。ログは `tmp/668/step5-e2e-diff.log`（終わると exit= と end の時刻と uptime が付く）、結果の表は `/home/kuroko/worktrees/bookshelf/_artifacts/668-e2e-diff3/report.md`。
- base は `9713381`（載せ直した後の origin/main）、work はこの作業ツリー（HEAD `12d8425`）。base との差分は step4 と同じ3ファイル。
- この run の中で終わらなければ、結果は step6（push の前）で読む。新しく落ちたものが本件の1本以外にあれば、push せずに②へ返す。動いている間は、作業ツリーのテストのファイルを変えない（work 側がこの作業ツリーを読むため）。

### 5. 残り（本件ではしないこと）

1. 全件比較の結果は、§4 の流し直しが終わるまで出ない。step4 では高負荷で3つの表を作れなかった。
2. e2e-diff-main.mjs は、playwright がシグナルで終わった時に webServer（`python3 -m http.server`）が残り、port を握ったまま次の側を始めて止まる（step4 で実際に起きた）。直すなら別イシュー。
3. 2台で書き込み時の衝突を作る手順が、3か所に同じ形で並んでいる。#645 の sync-conflict-overwrite.spec.js の makeWriteConflict、#657 のハブの書き込み時のテスト、本件の1本。共通の部品にするなら別イシュー。
4. storage-fakes.js の installFakeGitHub では、これからも書き込み時の衝突を起こせない（本件は案B で、口を足していない）。installFakeGitHub を使う spec で書き込み時の衝突が要る時は、gate-github.js と gate-device.js の2台を使う。
5. 07 の同じ行にある、もう1つの残り（`#obsidian-sync-path` がハブ・GitHub の時もローカルの欄に書かれる）は、本件の範囲外なので変えていない。

## step6 push・CI（2026-11-14 19:10〜 JST）

### 1. push の前（②の承認 19:09:51 の手順どおり）

- 19:10:07 に `tmp/668/step5-e2e-diff.log` を1回だけ見た。`exit=` はまだ付いていなかった（base 側の E2E の途中・load 45.59）。②の指示どおり、全件比較の結果は待たずに push した＝**代替判定で push した**（step4 §3 の (a)(b)）。
- origin/main が `02772ca` へ15件進んでいた（#663・#664 のアプリの直しと `?v=` の上げ直しを含む）。載せ直しが要るので、先に `systemctl --user stop bs668-e2e-diff2` で全件比較を止めた（19:10:18。19:08:43 から約1分半。base の playwright の log は書かれておらず、終わっていた本数は分からない）。残った `_artifacts/668-e2e-diff3/_worktree-base` は、node_modules の symlink を `_trash/668-e2e-diff3-node_modules-link` へ移してから `git worktree remove --force` で外した。
- `git rebase origin/main`（衝突なし）。自分の commit は `6be5162`（test）・`66fb1d1`・`9737afc`（chore）・`2a116db`・`71f45fb`・`61a91a2`（docs）。js・css・index.html は変えていないので、`?v=` は触っていない。
- 載せ直した後の確認（アプリのコードが入れ替わったため流し直した）：新しい1本 **1 passed (7.8s)**（load 46.51）、`npm run lint` **`[lint] 12 本中 0 本失敗`**、`npm test` **Test Files 80 passed (80)・Tests 1194 passed | 2 todo (1196)**（出力 `tmp/668/step6-spec.txt`・`step6-lint.txt`・`step6-vitest.txt`）。
- 送る commit は自分の6件だけで、6件とも `Issue: #668` がある（`git rev-list origin/main..HEAD` で確かめた）。

### 2. push

- `BOOKSHELF_ISSUE=668 git push origin 61a91a22923f8ab90fe31f2e838163d4c6d78878:main` → **`02772ca..61a91a2  -> main`**（19:11:42）。pre-push の lint も「12 本中 0 本失敗」。

### 3. CI

- CI の run：https://github.com/hahero-asayake/bookshelf/actions/runs/43584102876 （19:11:42 作成）。19:11:57 に API で1回見た時点では in_progress。
- その後は run の画面の HTML で見た（API の残りが30回だったため）：19:12:38 は「In progress・0/4 jobs completed」、19:14:13 も同じ、19:16:41（push から5分）も「In progress」。**最大待ち時間（5分）では終わらなかった**＝代替判定で、その時点の状態（進行中・上の URL）を書いて提出する。CI の e2e が全件を流した結果は、この run が終わると上の URL で見られる。
- main の badge（ci.yml）は 19:16 に「failing」だった。本件の run の結果ではない。前に終わった run 43582903319（`9713381`・#669 の docs）の結果。19:16:51 に API で見ると、本件の run・`02772ca`・`585f13a` の3本はまだ in_progress だった。43582903319 で落ちていたのは test (e2e) の step 20「Smoke tests (Playwright, sort-perf-budget以外・並列)」で、annotations では「E2E 失敗 合計3件」：
  1. `duplicate-asin-notice.spec.js` › 本の詳細に付け直し案内が出て、付け替え直後はもう一方の本に設定が残り(コピー)、その後の新しい変更は伝播しない
  2. `list-staged-render.spec.js` › #401 並べ替えの段階描画（913冊） › 途中で1冊を動かす（まだ置かれていない本へのドロップ）: 並び順どおりに反映される
  3. `sync-conflict-overwrite.spec.js` › Asayake ハブ: 書き込みで衝突した時に「この端末の内容で保存先を上書き」を選ぶと…（#645 のハブの1本）
  - 3件とも本件の push の前から main で落ちている。本件の差分（spec 1本の追加・検証スクリプトの引数・docs）が触る所ではない。3 の sync-conflict-overwrite のハブの1本は、手元では step1・step3 で緑だった。本件の新しい1本（GitHub）は、この一覧に入っていない。本件の run で同じ3件が落ちても、本件の赤ではない。
- 全件比較の unit：`systemctl --user is-active bs668-e2e-diff2` は inactive（19:10:18 に止めた）。`_artifacts/668-e2e-diff3/_worktree-base` は無い（git worktree list にも無い）。port 8168 も空いている。
- 設計書（vault）の 07・08 の変更は、19:30 の vault backup で入る見込み。この run の中では確かめていない。
