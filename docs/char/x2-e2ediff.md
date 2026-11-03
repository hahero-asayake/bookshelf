# X2 の e2e-diff-main 結果（イシュー#521 step4）

`PORT=8121 node scripts/verify/e2e-diff-main.mjs --port=8121`（`--grep`・`--init-storage` は付けていない）。2026-11-04 00:06 JST。

- base: origin/main @ 93188cd
- work: HEAD 6cafd33（X2 の commit 3つ：4a5173b・626186c・6cafd33）
- 除外：sort-perf-budget（CI でも別の step で単独実行するもの・既定の除外）

| | E2E 通過 | E2E skip | E2E 失敗 | E2E フレーク |
|---|---|---|---|---|
| base | 732 | 511 | 0 | 0 |
| work | 764 | 515 | 0 | 0 |

- **新しく落ちたテスト：E2E 0件・vitest 0件**。新しく通ったテスト：0件。両方で落ちたテスト：0件。判定不能：0件。
- work の通過が32件多いのは、新しく足した `tests/e2e/char/x2-widgets.spec.js`（char の6端末で計32件が通過。W6 のキーボードはタッチの4端末で skip＝skip が4件増えた）による。
- 書き換えた CHAR の4件（W1・W2・W5・W6）は、テスト名が変わったため base 側には同じ名前のテストが無く、どちらの表にも出ない。work 側では全端末で通過している（一覧は docs/char/x2-char-changes.md）。
- 結果一式：`/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261103-235941-590630/report.md`

## rebase 後の流し直し（push 前・②指示 2026-11-04）

#519 の4 commit（起動時の confirm を confirmDialog へ）を取り込んだ後に、フルで流し直した。2026-11-04 00:18 JST。

- base: origin/main @ 63c2cee（#519 を含む）
- work: HEAD da9c5cf（X2 の5 commit）

| | E2E 通過 | E2E skip | E2E 失敗 | E2E フレーク |
|---|---|---|---|---|
| base | 734 | 511 | 0 | 0 |
| work | 766 | 515 | 0 | 0 |

- **新しく落ちたテスト：E2E 0件・vitest 0件**。新しく通ったテスト：0件。両方で落ちたテスト：0件。判定不能：0件。
- 結果一式：`/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261104-001116-763219/report.md`
