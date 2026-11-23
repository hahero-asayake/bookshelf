# #771 step6 検証結果（2026-11-24 00:49〜01:08 JST）

## 1. 入口×出方の表（tests/e2e/art-entry-leave.spec.js・commit 66181ea6）

応答が消える注入あり（裏へ回した時の PUT は保存先へ入るが応答が消える＝H1）。見るもの：衝突の文が toast・#art-save-status に出ない／題が届き記事は1件（重複なし）／戻った先／「✓ 保存済み H:MM」。

| 入口＼出方 | ← | × | Esc | history.back | 裏→戻す→← |
|---|---|---|---|---|---|
| 本の詳細（ハブ） | ✓ | 外した※1 | ✓ | ✓ | ✓ |
| 本棚（ハブ） | ✓ | 外した※1 | ✓ | ✓ | ✓ |
| 公開の一覧（ハブ） | ✓ | 外した※1 | fixme※2 | ✓ | ✓ |
| 本の詳細（GitHub） | ✓ | - | - | ✓ | ✓ |
| 公開の一覧（GitHub） | ✓ | - | fixme※2 | - | - |

chromium・webkit（BACKNAV_WEBKIT=1・iPhone 13）とも：42 passed・4 skipped（fixme）。

※1 ×（#publish-pages-close）は iPhone 13 の編集画面で押せずに90秒で時間切れ（原因は未確認。編集画面では×が隠れている見込み）。表から外した。
※2 公開の一覧の「新規作成」→題を入れて Esc で、一覧が出ない（chromium・webkit／ハブ・GitHub で同じ）。新規作成は閲覧状態で開くため、Esc が効かないのかもしれない（未確認）。今のままにするか直すかは②の判断待ち＝test.fixme で残した。

## 2. 守ること・切り替え '0'

| 項目 | chromium | webkit |
|---|---|---|
| 他の端末が本当に変えた時は衝突の表示が出る | ✓ | ✓ |
| ownWriteMatch='0'：前の形（衝突の文が出る） | ✓ | ✓ |
| artEntryReturn='0'：本棚から書き始めても←で一覧 | ✓ | ✓ |
| artSwipeExit='0'：戻る1回は編集→閲覧の1段だけ | ✓ | ✓ |
| artSavedStamp='0'・artEntryTitle='0'：「保存しました」・題は空 | ✓ | ✓ |
| ③ 本棚から何も書かずに←：題が本棚名の記事が1件残る | ✓ | ✓ |

## 3. e2e-diff-main（base origin/main 0092226f ／ work 76d0b7c4＋未コミット）

- 結果：**リグレ2件（exit 1）**。画像比較：54件中0件差分。vitest 差分なし。
- リグレ：first-run-drawer-before-first-save.spec.js の2件（chromium・空のハブ／空のフォルダ）。手で流し直しても再現（`#publish-pages-modal` が show にならない・:43）。順番は「公開→新規作成」。#771 の何で落ちたかはまだ見ていない（時間切れ）。
- 判定不能6件：流している途中に書き換えた art-entry-leave の旧版（×・一覧Esc）と、_trash へ移した art-exit-matrix-771（step2 の計測用）。regression には数えていない。
- 報告：/home/kuroko/kuroko/_vault-work/771/e2e-diff/report.md

## 4. ほか

- npm test：89ファイル・1313 passed・2 todo（0 失敗）。npm run lint：12本中0本失敗。
- BACKNAV_WEBKIT=1 の webkit の列：330秒で打ち切った（330件通過・失敗0）。全件は流し切れていない。
- tests/e2e/art-exit-matrix-771.spec.js（step2 の計測用・未追跡）は worktree の _trash/771/ へ移した。
