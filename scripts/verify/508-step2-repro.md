# #508 step2: char有無比較 → ②の方針転換を受けて3項目対応

②の06:33承認で、step1の発見(「429件失敗」のほぼ全部はcharのdevice別test.skip()で、実際の失敗ではない)を受けて
本題が組み替えられた。元のstep2(char有無をCI相当条件でローカル比較)は優先度を下げ、代わりに次の3項目に対応した。

## 環境の前提修正(重要・再現作業中に発覚)

worktree(`issue-508`)に`node_modules`が無かったため、`/home/kuroko/worktrees/bookshelf/node_modules`への
symlinkで補った(過去イシュー#435/#480と同じ対処・詳細はprojects/detail/bookshelf.md参照)。

**`taskset -c 0-3`だけでは、PlaywrightのCPU数依存の既定値は変わらない**ことが実測で判明した。
このマシン(`nproc`=16)で`taskset -c 0-3 ... playwright test`を実行すると、`os.cpus().length`は
taskset後も16を返す(taskset=「どのCPUで動けるか」の制約であり、OSが見かけ上のCPU数情報自体を
書き換えるわけではない)。そのためPlaywright既定(`"50%"`)は`floor(16/2)=8`に解決され、
「Running 1182 tests using **8** workers」という、CIの実コア数(4)とは無関係なworker数になった
(1回目の再現runで実測)。CI相当にするには`taskset`だけでなく**`--workers=2`をCLIで明示する必要がある**
(2回目の再現runで修正・以降「run2」と呼ぶ)。この気づき自体を今後のCI相当ローカル再現の手順として
残す価値がある(#476当時の「8 worker」という値も、このマシン固有のos.cpus()起因である可能性がある)。

## 項目1: ci-annotate-failures.mjs の数え方修正 + ci.yml コメント修正

`scripts/ci-annotate-failures.mjs`を書き換えた。変更点:
- 旧実装は`test.results[0].status`(1回目の結果)だけを見ており、`status==='skipped'`を除外していなかった
  ため、charのdevice別test.skip()が丸ごと「失敗」annotationに混入していた(step1実測の根本原因)。
- 新実装は`test.status`(test-level outcome: `expected`|`unexpected`|`flaky`|`skipped`)で分類し、
  `skipped`は失敗から完全に除外。`unexpected`(最後まで失敗)と`flaky`(リトライで通った)を別集計・別annotation
  にした。
- 「リトライで通ったFLAKY含む」の固定文言は削除。FLAKYのannotationは`flakyTests.length > 0`の時だけ出す。
- skip件数は参考情報として別の`notice`annotationで出す(失敗扱いはしない)。
- 検証: 合成JSON(expected/skipped/unexpected/flakyの4パターンを含む)を読ませ、`failed=1`
  `flaky=1`(リトライで通った)`skip=1`(除外)の期待どおりの出力になることを確認した。0件ケース
  (全passed+skipped)でも`失敗0件`のnoticeのみが出ることを確認した。

`.github/workflows/ci.yml`のコメント修正: 59〜65行目の「8 worker」という記述は、#476当時の
host競合再現実験で使われた仮定値であり(`scripts/verify/476-ci-breakdown.md`を確認すると
「2コア想定のubuntu-latestで8 worker」という、2コア/8workerという矛盾した仮定のまま書かれていた=
実測ではなく推定)、実測ではなかった。#508で実際に確定した値(playwright.config.jsに`workers`指定
なし→既定`"50%"`、CIランナーの実コア数=4(annotationの`[sort-perf-gpu]` hardwareConcurrency=4で実測)
→既定`workers=2`)に置き換えるコメントを追加した。

## 項目2: publish-article-editor.spec.js:619 の再現と対処

worktree内でPLAYWRIGHT_BASE_URL=http://localhost:8108、CI=1、`taskset -c 0-3`で2回実行した。

| run | 条件 | 結果 | 所要時間(playwright test部分) |
|---|---|---|---|
| run1 | taskset -c 0-3のみ(workers未指定→上記の罠で実際は**8 workers**・CI非忠実) | 619行は**pass**(1.9s)。別のテストが1件failed: `publish-article-editor.spec.js:979`「公開中記事の一括更新(イシュー#152)」が`.toast-success`の`.last()`テキストで期待と不一致 | 3.6m |
| run2 | taskset -c 0-3 + `--workers=2`明示(CI忠実: 4コア・workers=2) | **0 failed**(619行含め全テストpass)。478skipped・704passed | 5.5m |

結論: **2回のローカル再現では、対象テスト(619行)の失敗を再現できなかった**。run1(8workerで過負荷)では
619行とは別のテスト(979行)が落ち、ホスト競合下で複数のテストが時々揺れること自体は裏付けられたが、
「同じ失敗」の再現には至っていない。

一方、実際のCIでは52f713c・b06fdd5の2回、同一エラー(`Timeout 15000ms exceeded`、同じpredicate、同じ行)
が発生している(step1で確認済み)。619行の直前のコメント(#405 step3)によれば、この種のタイムアウトは
過去にも一度(5000ms→15000ms)発生し、CPU burner+CDP10倍スロットリングでの反復(単独10回・ファイル全体
95テスト1パス・いずれも0件失敗)によってアプリ側の退行ではないと確認済みだった。

**対処**: #405と同じ考え方(アプリ側に不具合の証拠が無い・テストが待っている状態の条件自体は変えない)で、
`expect.poll`のtimeoutを15000ms→30000msへ再延長した(`tests/e2e/publish-article-editor.spec.js`)。
charの追加でジョブ全体の所要時間が+2〜3分増えている(step1実測)ことに対する安全マージンとして、
前回(3倍)より控えめだが十分な倍率(2倍)にした。

**留意点(②への申し送り)**: この修正は、ローカルで「再現→修正で直る」のサイクルを確認できたものではなく、
実CIでの2回の実測＋#405の先例に基づく判断。アプリ側の不具合の証拠は無い(#405の先例を踏襲)ため、
②への指示(「アプリ側に本当の遅延の不具合があるならtpで返す」)には該当しないと判断し、このstepで
直接修正した。ただし未検証のまま直しているため、次のpush後のCI実測(step5)で、この延長が十分かどうかを
実際に確認する必要がある。

## 項目3: charのtest.skip()を減らせないか(step3のtpで②に聞く・ここでは調査のみ)

着手はしていない。ci-annotate-failures.mjsの修正で「見え方」は直ったが、428件のtest.skip()評価自体は
依然毎回発生し、ジョブの所要時間+2〜3分は残っている。tests/e2e/char/の全10ファイルが
`test.skip(testInfo.project.name !== '<対象>', ...)`パターンを使っており、これをproject単位の
`testMatch`/`grep`で「最初から対象に入れない」方式に変える場合、6 project全てのtestMatch定義を
個別テスト単位(describe/test粒度)で書き直す必要があり、#501/#506のchar構造にまとまった変更が入る。
この規模の変更をこのイシューで続けるか、別イシューに分けるかをstep3のtpで②に確認する。
