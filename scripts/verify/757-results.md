# イシュー#757 検証の結果（本の詳細の所属本棚を折り畳める字下げの木にする）

## step5 e2e-diff-main と audit（前後の全件比較）

- 版：base＝origin/main **af721b2**／work＝issue/757 **1a2d487**（未コミットの差分なし）。
- 流し方：systemd-run --user --unit=bs757-e2ediff（--working-directory＝worktree・--setenv=PATH=…node v24.18.0…）で `node scripts/verify/e2e-diff-main.mjs --port=8157 --out=~/kuroko/_vault-work/757/e2e-diff`。--init-storage・--grep は使っていない。流している間は tests/ に一時の spec を置いていない。
- 所要：base の E2E 335 秒・work の E2E 250 秒。全体は約10分で、20分の上限より短い。

### 3表（E2E・playwright）

| 表 | 件数 |
|---|---|
| 新しく落ちた | **0** |
| 新しく通った | 1（book-memo-file-lifecycle.spec.js「題名を変えてすぐ再読込しても…」。base で1件だけ落ちた揺れ。このイシューは長文メモに触れていない） |
| 両方で落ちた／既存の問題 | 0 |

- 合計：base は expected 1246・skipped 592・unexpected 1。work は expected 1263・skipped 592・unexpected 0。
  - 通った件が17件増えた内訳は、新しい book-detail-shelf-tree.spec.js の16件（chromium のスマホ8・PC8）と、base で揺れて落ちた1件が work では通った分。
- vitest：新しく落ちた 0・新しく通った 0・両方で落ちた 0。base は 1291 件中 1289 passed、work は 1300 件中 1298 passed。どちらも残りの2件は todo。
- 画像比較（work 側・公式コンテナ）：54 件中、差分は 0 件（step4 で 04-book-detail の6枚を撮り直した後の状態）。
- 除外：sort-perf-budget（ci.yml:143 と同じ）だけ。

### audit（npm run audit・前後）

- 前：snap/before/head（git archive af721b2）で流した。node_modules は worktree の物を一時的に symlink して使い、終わった後に _trash へ退避した。後：worktree（1a2d487）で流した。どちらも PORT=8257。

| 検査 | 前 | 後 |
|---|---|---|
| a11y | axe 6・button 0・link 0・image 0・input 2・inputPlaceholderOnly 12・select 2・other 0 | 同じ |
| buttons | variants 8（未分類 363） | 同じ |
| layout | clip 70・overflow 30・pageX 0・overlap 0 | 同じ |

- 3検査とも exit 0。件数は増えていない。tests/audit/findings/layout.json は変わっていない（git status で差分なし）。
- 気づき：audit が巡回する見本の本は、所属本棚が1つ（子なし）。そのため▸のボタンは巡回の中に出てこない。
  - ▸のボタンの名前（aria-label「「小説」の下の3つを開く／畳む」）と aria-expanded は、book-detail-shelf-tree.spec.js の (1)(2) と単体テストで確かめている。
