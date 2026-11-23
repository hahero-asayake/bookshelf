# #771 step6 検証結果（2026-11-24 00:49〜01:30 JST・差し戻し後の続きを含む）

## 1. 入口×出方の表（tests/e2e/art-entry-leave.spec.js・commit 66181ea6）

応答が消える注入あり（裏へ回した時の PUT は保存先へ入るが応答が消える＝H1）。見るもの：衝突の文が toast・#art-save-status に出ない／題が届き記事は1件（重複なし）／戻った先／「✓ 保存済み H:MM」。

| 入口＼出方 | ← | × | Esc | history.back | 裏→戻す→← |
|---|---|---|---|---|---|
| 本の詳細（ハブ） | ✓ | 外した※1 | ✓ | ✓ | ✓ |
| 本棚（ハブ） | ✓ | 外した※1 | ✓ | ✓ | ✓ |
| 公開の一覧（ハブ） | ✓ | 外した※1 | ✓※2 | ✓ | ✓ |
| 本の詳細（GitHub） | ✓ | - | - | ✓ | ✓ |
| 公開の一覧（GitHub） | ✓ | - | ✓※2 | - | - |

chromium・webkit（BACKNAV_WEBKIT=1・iPhone 13）とも：46 passed・0 skipped（b174112d 時点）。

※1 ×（#publish-pages-close）はスマホの編集中は見えない＝前からの形（step2 の表で確認）。直さず、表から外した。
※2 公開の一覧の「新規作成」→題を入れて Esc は、公開の一覧ごと閉じる。origin/main 0092226f でも同じ（同じ手順の探りで確認）＝前からの形。今の動きを期待にして fixme を外した（題は届く・衝突の文は出ない）。

## 2. 守ること・切り替え '0'

| 項目 | chromium | webkit |
|---|---|---|
| 他の端末が本当に変えた時は衝突の表示が出る | ✓ | ✓ |
| ownWriteMatch='0'：前の形（衝突の文が出る） | ✓ | ✓ |
| artEntryReturn='0'：本棚から書き始めても←で一覧 | ✓ | ✓ |
| artSwipeExit='0'：戻る1回は編集→閲覧の1段だけ | ✓ | ✓ |
| artSavedStamp='0'・artEntryTitle='0'：「保存しました」・題は空 | ✓ | ✓ |
| ③ 本棚から何も書かずに←：題が本棚名の記事が1件残る | ✓ | ✓ |

## 3. e2e-diff-main

### 1回目（base origin/main 0092226f ／ work 76d0b7c4＋未コミット）

- 結果：**リグレ2件（exit 1）**。画像比較：54件中0件差分。vitest 差分なし。
- リグレ：first-run-drawer-before-first-save.spec.js の2件（chromium・空のハブ／空のフォルダ）。手で流し直しても再現（`#publish-pages-modal` が show にならない・:43）。順番は「公開→新規作成」。#771 の何で落ちたかはまだ見ていない（時間切れ）。
- 判定不能6件：流している途中に書き換えた art-entry-leave の旧版（×・一覧Esc）と、_trash へ移した art-exit-matrix-771（step2 の計測用）。regression には数えていない。
- 報告：/home/kuroko/kuroko/_vault-work/771/e2e-diff/report.md

### リグレの原因と直し（b174112d）

- 原因：step4 で openPublishPagesModal に足した `storage.serialWrite(() => {})`（書き込みの行列全体を待つ）。この1行を外すと2件とも通った（1行の無効化で切り分け）。最初の保存の前は他の書き込みの番待ちで行列が進まず、公開の一覧が開かなかった。
- 直し：BookshelfStorage.writeJSON がパスごとに送っている途中の書き込みを控え、`waitPathWrite(path)` でそのパスの分だけ待つ。openPublishPagesModal は記事のファイル（private/publish/articles.json）の分だけ待つ。無ければすぐ開く。
- 直した後：first-run-drawer-before-first-save・art-own-write-conflict-771・art-entry-leave・article-leave-flush を chromium・webkit で 61 passed。

### 2回目（直した後・work b174112d）

- 結果：**リグレ0件（exit 0）**。E2E の新しく落ちた0件・判定不能0件。vitest の差分0件。画像比較は54件中0件。
- 報告：/home/kuroko/kuroko/_vault-work/771/e2e-diff2/report.md（01:11〜01:20）

## 4. ほか

- npm test：89ファイル・1313 passed・2 todo（0 失敗）。npm run lint：12本中0本失敗。check:version OK（b174112d の後にも流した）。
- BACKNAV_WEBKIT=1 の webkit の列（b174112d・e2e-diff と並べずに単独）：最後まで流し切った。334 passed・20 skipped・失敗0（5.7分）。1回目は330秒で打ち切り（330件通過・失敗0）。
- tests/e2e/art-exit-matrix-771.spec.js（step2 の計測用・未追跡）は worktree の _trash/771/ へ移した。
