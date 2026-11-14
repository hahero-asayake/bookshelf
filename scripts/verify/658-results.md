# イシュー#658 lint:e2e-gate の --strict-coverage を package.json に寄せる

手元の `npm run lint` と pre-push は、lint:* を引数なしで流す (scripts/run-lint.mjs)。CI だけが `npm run lint:e2e-gate -- --strict-coverage` で流していたので、観測点が欠けると、手元と pre-push を通って CI で落ちる穴があった。
strict は package.json の `lint:e2e-gate` に置く (`node scripts/check-e2e-gate.mjs --strict-coverage`)。CI は `npm run lint:e2e-gate` だけにする。
scripts/check-e2e-gate.mjs を node で直接起動した時の既定 (未達は警告だけ) は変えない。tests/unit/check-e2e-gate.test.js の「入口を通す」が、この既定に依存しているため。

## step1 検査を先に足して赤 → 直して緑 (2026-11-14・commit 9007251・origin/main 36eba5e の上)

- tests/unit/ci-lint-steps.test.js に「CI の lint の step の run は `npm run <名前>` だけで、引数は package.json に置く」を足した (lint:* ごと・12件)。
- ci.yml を直す前に流した結果: `Tests 1 failed | 25 passed (26)`。落ちたのは lint:e2e-gate の1件だけ (Expected `npm run lint:e2e-gate`・Received `npm run lint:e2e-gate -- --strict-coverage`)。
- 直した後に流した結果:
  - vitest 3本 (ci-lint-steps・check-e2e-gate・gate-report): `Tests 73 passed (73)`。
  - `npm run lint`: `[lint] 12 本中 0 本失敗`。lint:e2e-gate の行は `> node scripts/check-e2e-gate.mjs --strict-coverage` → `OK: @gate 41本・違反0件・観測点の網羅 37/37`。

## step2 観測点を1つ欠けさせた一時変更 (commit していない)

一時変更: `tests/e2e/gate/j1-1-first-run-guide.spec.js` のテスト名から `@gate ` を外した。J1-1 を載せている @gate はこの1本だけで、docs/gate/known-red.json にも入っていない (`--json` の coverage で確認)。
こうすると、違反は増えず、未達だけが1点 (J1-1) 増える。ID だけを消すと違反になり、strict でなくても落ちるので、その形は使っていない。

| 確かめたこと | 結果 |
|---|---|
| (a) `npm run lint` | exit 1。最終行 `[lint] 12 本中 1 本失敗 (lint:e2e-gate)`。lint:e2e-gate は `観測点の未達 1/37点: J1-1` と `NG: @gate 40本・違反0件・観測点の網羅 36/37(--strict-coverage のため未達を失敗にした)`。ほかの11本は exit 0 |
| (b) 対照: `node scripts/check-e2e-gate.mjs` (引数なし・直接起動) | exit 0。`警告: 観測点の未達 1/37点: J1-1`・`OK: @gate 40本・違反0件・観測点の網羅 36/37`。赤になったのは package.json の strict のため |
| (c) `node scripts/gate-report.mjs --collect --dir=/tmp/658/gate-missing` | gate-lint.json は書かれた (`strictCoverage: true`・`missing: ["J1-1"]`・違反0)。checks.json の lint:e2e-gate は `exitCode: 1`。条件2: 不合格 (`@gate が無い 1点: J1-1`)。条件3: 不合格 (根拠 `lint 一式と check:version 緑7/8`・未達 `lint 一式と check:version 失敗: lint:e2e-gate`)。総合は不合格 (条件2だけでも不合格になる) |

元に戻す: `git checkout -- tests/e2e/gate/j1-1-first-run-guide.spec.js` の後、`git status --porcelain --untracked-files=no` は0行だった。

戻した後に `node scripts/gate-report.mjs --collect --dir=/tmp/658/gate-ok` を流した結果:
- gate-lint.json は `strictCoverage: true`・`missing: []`。
- 条件3は `lint 一式と check:version 緑8/8`・`vitest 緑1168・失敗0`。E2E と画像比較の結果は置いていないので、判定は未実施。
- 条件2に「@gate が無い」は出ない (E2E の結果を置いていないので「結果が無い 37点」・未実施)。

## 判断: strict 版と非 strict 版の script は分けない

- gate-report の動きは壊れていない。gate-lint.json は終了コードに関わらず書かれ、条件2は今までどおり coverage から未達を出す。
- 変わるのは、未達がある時に条件3も不合格になることだけ。総合は、もともと条件2で不合格になる。
- 条件3は「CI と同じ自動検査が緑か」を見る条件。gate-report だけを strict なしにすると、条件3が「CI は赤なのに緑」を出せるようになる。これはこのイシューで消したずれと同じ形。
- strict なし版を lint:* の名前で足すと、run-lint と ci-lint-steps.test.js がそれも CI の step として求める。lint 以外の名前にすれば避けられるが、入口が1つ増えるだけで得るものが無い。

証拠の生の出力: worktree の `tmp/658/` (gitignore)。step1-red.txt・step1-green-unit.txt・step1-lint.txt・step2a-lint-missing.txt・step2b-direct-nonstrict.txt・step2c-gate-report-missing.txt・step2c-gate-report-ok.txt。gate-report の入出力は `/tmp/658/gate-missing/`・`/tmp/658/gate-ok/`。
