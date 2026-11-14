# イシュー#668 の記録（GitHub の書き込み時の衝突で、同期欄の未保存を spec で確かめる）

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
