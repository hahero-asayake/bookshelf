# アプリの戻し方の練習記録 (イシュー#584)

日付: 2026-11-14 (03:08〜03:12 JST)。本番には触れていない。push も配信の切替もしていない。

## やったこと (要約)

origin/main の直近の commit を `git revert` で戻し、index.html の `?v=` を新しい値に上げて commit した。
検査とテストを流して、一時作業ツリーを片付けた。fetch 開始から片付け終了まで **約122秒**。

- 戻した commit: `126ca98` fix: iOS WebKitでキャンバスのブロック余白タップが無反応になるのを直す (イシュー#580)
  - 変えていたファイル: `js/screens/article-editor.js` (+4行)、`index.html` (`?v=` 1か所)、`playwright.config.js`、`tests/e2e/art-canvas-tap-edit.spec.js`
  - 選んだ理由: origin/main の先頭で js/ を変えた commit。先頭なので衝突しない。
- 練習ブランチ: `drill/app-rollback-584` (push していない・残してある)
  - `b56029c` Revert "fix: iOS WebKitでキャンバスのブロック余白タップが無反応になるのを直す"
  - `92e858e` fix: 戻した article-editor.js の ?v= を新しい値に上げる (戻し方の練習)
- `?v=` の動き (article-editor.js): origin/main `2026111402` → revert 直後 `2026111401` (古い値に戻る) → 手で `2026111403` に上げた

## 手順と所要時間

時刻は `date '+%H:%M:%S'` で控えた。コマンドは cwd (issue-584 の作業ツリー) から打った。
一時作業ツリーの中では `env -C tmp/drill-app-rollback ...` で実行した (node は PATH に無いので `PATH=/home/sei/.nvm/versions/node/v24.18.0/bin:/usr/bin:/bin` を付けた)。

| 手順 | 開始 | 終了 | 秒 | コマンド |
|---|---|---|---|---|
| 1. fetch | 03:08:35 | 03:08:38 | 3 | `git fetch origin` |
| 2. 一時作業ツリー作成 | 03:08:41 | 03:08:41 | 1未満 | `git worktree add -b drill/app-rollback-584 tmp/drill-app-rollback origin/main` と `ln -s /home/sei/GitHub/bookshelf/node_modules node_modules` |
| 2'. 上流を外す (追加) | 03:08:47 | 03:08:47 | 1未満 | `git branch --unset-upstream drill/app-rollback-584` |
| 3. commit 選び + revert | 03:08:47 | 03:09:08 | 21 | `git log origin/main -n 8 --stat -- js css` で候補を見て、`git revert --no-edit 126ca98` (revert 自体は1秒未満) |
| 4. `?v=` を上げて commit | 03:09:12 | 03:09:35 | 23 | index.html の `article-editor.js?v=2026111401` を `2026111403` に変更 → `git add index.html` → `git diff --cached --stat` で確認 → `git commit` (本文の最後に `Issue: #584` と `Co-Authored-By: Claude <noreply@anthropic.com>` を続けて置く) |
| 5. 版の検査 | 03:09:38 | 03:09:44 | 6 | `node scripts/check-version-bump.mjs --range=origin/main..HEAD` (1回目は終了コードの取り方を誤りやり直し。検査そのものは1秒未満) |
| 6a. 単体テスト | 03:09:53 | 03:10:04 | 11 | `npm test` |
| 6b. E2E 1ファイル | 03:10:10 | 03:10:19 | 9 | `PORT=8184 PLAYWRIGHT_BROWSERS_PATH=/home/sei/.cache/ms-playwright npx playwright test tests/e2e/art-canvas-tap-edit.spec.js --project=chromium --reporter=line` |
| 8. 片付け | 03:10:27 | 03:10:37 | 10 | node_modules のリンク・`test-results/`・自分が出したログを `_trash/drill-app-rollback-584/` へ `mv` → `git worktree remove tmp/drill-app-rollback` (`--force` 不要) |
| 確認 | 03:10:41 | 03:10:43 | 2 | `git ls-remote origin drill/app-rollback-584` / `git log origin/main..drill/app-rollback-584 --oneline` / `git status --short` |
| 追加確認: push 前ゲートの空打ち | 03:11:40 | 03:11:40 | 1未満 | `BOOKSHELF_ISSUE=584 node scripts/git/push-gate.mjs <練習の先頭sha> <origin/mainのsha>` (push はしない。判定だけ) |

## 検査とテストの結果

- `check-version-bump` (`--range=origin/main..HEAD`)
  - `?v=` を上げた後: **OK** (exit 0)。
  - 参考: revert 直後 (`?v=` が古い `2026111401` のまま) でも **OK** になった。下の「つまずいた点 1」。
  - 「index.html から参照されていない js/css」の警告が出るが、もとからある警告で exit code に影響しない。
- `npm test` (vitest): **成功**。56 ファイル、860 件成功 + 2 件 todo (10.83 秒)。
- E2E `tests/e2e/art-canvas-tap-edit.spec.js` (chromium): **7 件成功** (8.4 秒)。サーバーのログで、ブラウザが `article-editor.js?v=2026111403` を取得したことを確認。
- push 前ゲート (`push-gate.mjs`) の空打ち: **止まる** (exit 1)。revert の commit に `Issue:` が無いため。下の「つまずいた点 2」。

## つまずいた点

1. **revert は `?v=` も古い値に戻す。検査はそれを見逃す。**
   revert で `?v=` が `2026111402` → `2026111401` に下がった。`check-version-bump` は「起点と値が違うか」しか見ないので OK を出した。
   sw.js は `?v=` 付きのファイルをキャッシュ優先で返す。古い値に戻すと、その値で昔キャッシュした中身が使われうる。
   今回はたまたま同じ中身だが、値の使い回しは事故のもと。新しい値に上げるのは人の手でやる。
2. **revert の commit には `Issue:` が付かない。push 前ゲートで止まる。**
   commit 時のフック (trailer-gate) は通った。でも push 前のフックが呼ぶ `push-gate.mjs` は、`Issue:` の無い commit を止める (空打ちで確認)。
   本番では次の形がよい: `git revert --no-commit <sha>` → `?v=` を上げる → `Issue: #N` を付けて1つの commit にする。
3. **`git worktree add -b ... origin/main` は、新しいブランチの上流を origin/main にする。**
   うっかり push を防ぐため、`git branch --unset-upstream` で外した。
4. **revert はテストと playwright.config.js も戻す。**
   通った E2E は「戻す前の古いテスト」。機能が戻ったことの証明ではなく、ほかが壊れていないことの確認にとどまる。
   webkit の project 登録も一緒に消えた。
5. **E2E のサーバーは使い回される (`reuseExistingServer: true`)。**
   8184 番で別のサーバーが動いていると、別の作業ツリーを試験してしまう。流す前に `ss -ltn` で空きを確かめた。
6. **node_modules のリンクは git から「未追跡」に見える。**
   .gitignore の `node_modules/` はディレクトリにだけ一致し、リンクには一致しない。残すと `git worktree remove` が止まる。
   ignore 済みの `test-results/` と `*.log` は止めないが、作業ツリーと一緒に消える。消さない決まりなので3つとも `_trash/drill-app-rollback-584/` へ移した。
7. **自分のミス: 終了コードの取り方。**
   `echo` やパイプの後ろで終了コードを読んでしまい、2回やり直した。`コマンド >/dev/null 2>&1 && echo PASS || echo FAIL` の形で取る。

## 本番で本当に戻す時との違い

- **push していない。** 本番では main へ push する。その時に push 前フック (`push-gate.mjs` と `check-version-bump.mjs`) が走る。上の 2 のとおり、revert の commit に `Issue:` が無いと止まる。
- **配信の切替をしていない。** 公開先への反映と、利用者の端末に新しい `?v=` が届いたかの確認をしていない。
- **直近の commit を選んだので衝突しなかった。** 古い commit を戻すと、後の commit も index.html の同じ `?v=` 行を変えていて衝突しうる (今回は試していない)。
- **E2E は1ファイル (chromium) だけ。** 全件と webkit は流していない。
- **設計書は触っていない。** 本番で機能を戻すなら、設計書 (obsidian) も同じ作業の中で直す (CLAUDE.md の決まり)。
- **戻す commit を探す時間が入っていない。** 本番では不具合から原因の commit を特定する時間がかかる。

## 後始末の状態

- `git ls-remote origin drill/app-rollback-584`: 空 (origin へは何も送っていない)。
- `git log origin/main..drill/app-rollback-584 --oneline`: `92e858e` と `b56029c` が見える。
- 一時作業ツリー `tmp/drill-app-rollback` は外した。ブランチ `drill/app-rollback-584` は残した (上流は未設定)。
- cwd (issue/584) の HEAD は `6556b0e` のまま。cwd では commit していない。
- 退避先: `_trash/drill-app-rollback-584/` (node_modules のリンク、`test-results/`、検査ログ)。
