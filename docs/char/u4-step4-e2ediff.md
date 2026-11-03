# U4 step4：回帰確認の結果（e2e-diff-main.mjs・画像差・テスト期待の変更）

## 実行コマンド

```
node scripts/verify/e2e-diff-main.mjs --visual --port=8117
```

`--init-storage` は使っていない（依頼の指示どおり）。base=origin/main(e2a408b)、
work=作業ツリー(HEAD=1e9e06f・commit1 5ef58f6 + commit2 1e9e06f)。
実行時間：2026-11-03 20:44:19〜20:51:05（約7分、既定除外のsort-perf-budgetは1件除外）。

## 結果（新しく落ちたテスト0件）

- **E2E (playwright)**：新しく落ちた0件・新しく通った0件・両方で落ちた0件。
  base/work ともに 1243 specs（件数の増減なし＝touch-reorder等の既存E2Eは1件も追加/削除していない）。
- **Unit (vitest)**：新しく落ちた0件・新しく通った0件・両方で落ちた0件。
  base 789件(787 passed/2 todo) → work 799件(797 passed/2 todo)。差の10件は
  `tests/unit/reorder.test.js`（commit2で新規追加、口と取り消しの単体テスト）のみ。
- **画像の差分 (playwright.visual.config.js・work側のみ)**：0件 / 54件。
- 判定不能（流し直しで実行0件）：0件。流し直し自体も発生しなかった（新規落ちが無かったため）。

結果一式（report.md・各JSON）: `/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261103-204419-23915/`
（恒久的な置き場・このworktree外）。

## テスト期待の変更（git diff origin/main..HEAD -- tests）

```
tests/unit/reorder.test.js | 234 +++++++++++++++++++++++++++++++++++++++++++++
1 file changed, 234 insertions(+)
```

新規ファイルの追加のみ（234行追加・既存ファイルへの変更0行）。既存テストの期待の
書き換えは0件。完了の条件「テストの期待の書き換えは0件」を満たす。

## 結論

- `_bindPointerReorder` 使用6か所の振る舞いは変わっていない（E2E新規落ち0件・画像差0件）。
- touch-reorder 9件（brief記載の11件とは実測差があることをstep1で報告済み）・char
  widgets W1〜W3 は、このe2e-diff-main実行にも1243 specsの一部として含まれ、新規落ちに
  入っていない＝通っている。
- 足した口（穴を落とす先にする・取り消し）は単体テスト10件で確認済み（commit2）。
