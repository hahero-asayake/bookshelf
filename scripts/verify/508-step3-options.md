# #508 step3: 案A/B/C比較 → 推奨

## 前提の更新(重要): #507はすでにmerge済み

このstepの冒頭で`git fetch origin main`したところ、**#507はworktree内の未コミット変更ではなく、
すでにorigin/mainにcommit済み**だった(`ae2f891 fix(test): e2e-diff-main.mjsの既定除外を
CI(ci.yml)と同じにし表に明記する`、このworktreeの基準b7e2a9aの1つ先)。step1/2時点の
「#507はworktree issue-507で未コミット変更中」という前提は**古くなっている**(06:26に#507が
先にpushしたため)。

ae2f891の内容を読んだ結果、**この変更の中身自体がstep3の判断に直結する**:
`scripts/verify/e2e-diff-main.mjs`は起動時に`.github/workflows/ci.yml`を読み、
`playwright test`を含み かつ `--grep-invert "..."`にマッチする行を**ちょうど1件**だけ期待する
(0件または2件以上ならエラーで止まる仕様、二重管理を避けるため)。現在ci.ymlには
`playwright test`の行が2つあるが、`--grep-invert`を持つのは1行目(72行目、`"sort-perf-budget"`)
だけなので、今はヒット1件で整合している。

→ **案を選ぶ時は、ci.ymlの`playwright test`行を増やす・変える場合に、この「ちょうど1件」制約を
壊さないことが必須条件**になる。各案でこの観点を明記する。

## 案の比較

### 案A: ci.ymlでcharを別ジョブに分けて並列実行

実装イメージ: 既存の`test`ジョブのE2E stepに`--project=chromium`を足して(72行目を
`npx playwright test --project=chromium --grep-invert "sort-perf-budget"`に変更)、
charを明示的に除外する。別に新設する`test-char`ジョブで
`npx playwright test --project=char-390 --project=char-768 --project=char-820 --project=char-1024 --project=char-1440 --project=char-1920`
(または同等の6回`--project`指定)を実行する。

- **所要時間**: 既存E2Eジョブはcharの負荷が乗らなくなるため、元の水準(~9分)に戻る見込み。
  charジョブは別のGitHub Actions runner(別マシン)で並列に走るため、CI全体のwall時間は
  「既存E2Eジョブ」と「charジョブ」の長い方で決まる(直列加算にならない)。charジョブは
  npm ci・playwright installを別途行う必要があるぶん固定オーバーヘッド(+1〜2分程度)が乗るが、
  既存E2Eの時間には影響しない。public repoの標準ランナーは複数jobを並列実行できるため、
  追加コストは実質無い。
- **安定性**: 既存E2E(`publish-article-editor.spec.js:619`等の時間依存テスト)がcharの負荷から
  完全に分離される。**3案の中で最も安定性改善効果が大きい**。
- **リグレを見つける力**: push毎にCIで両方のジョブが強制実行される。現状と同じ網羅性を保ったまま、
  安定性だけ改善する。
- **#507との整合性**: 既存72行目の`--grep-invert "sort-perf-budget"`はそのまま残す(パターン文字列も
  変えない)。新設するcharジョブの行は`--project`指定のみで`--grep-invert`を使わない設計にすれば、
  #507のreadDefaultExcludesFromCi()が期待する「ちょうど1件ヒット」を壊さない(実際に`grep`で確認済み・
  現在ヒットする行は72行目の1件のみ)。**#507とのコード競合・同時変更は不要**。
- **既存テストの意味**: 変えない(実行対象・assertionは同じ、ジョブの割り方だけが変わる)。

### 案B: charをCIでは流さず、push前にローカルのe2e-diff-main.mjsで実行

実装イメージ: ci.ymlからcharを除外する(72行目に`--project=chromium`を足す、または
charのtestMatchをCIでは無効化)。代わりに`e2e-diff-main.mjs`(#507で直近に97行変更された
ばかりのファイル)に、charの6端末を流すstepを追加する。

- **所要時間**: CI側は速くなる(~9分に戻る)。ただしpush前のローカル実行コストは消えず、
  e2e-diff-main.mjs側に移るだけ(③がpush前に毎回charも流す前提になる)。
- **安定性**: CIの安定性はA同様改善する。charの実行自体の安定性(ローカルでの揺れ)は変わらない。
- **リグレを見つける力**: **3案の中で最も弱い**。CIという強制実行の仕組みから外れ、
  「push前に必ず実行する」運用に依存する。このリポジトリはworktreeを複数イシューが並行して使い、
  pushのタイミング・担当が流動的(project noteに既述の#409/#430等の実例)なため、
  「誰かがe2e-diff-main.mjsを実行し忘れたままpush」された場合、charの退行はCIでは一切検出されず
  main に乗ってしまう。push-gate(`.githooks/pre-push`)にe2e-diff-main.mjs実行を必須化する手も
  あるが、そのための追加実装(フックの変更)がさらに必要になり、スコープが広がる。
- **#507との関係**: #507はこのファイルに起票済みの機能(sort-perf-budgetの既定除外)を入れたばかりで、
  直接のコード競合は無い(まだ自分は未着手のため)が、**同じファイルに続けて別の目的(charの実行)の
  変更を積む**ことになり、このスクリプトの責務(originmainとの差分による新規regression検出)に
  「6端末の特性テストを流す」という別種の責務を混ぜることになる。実装規模は3案の中で最大。
- **既存テストの意味**: 変えない。

### 案C: workersを減らす(2→1)

- **所要時間**: **3案の中で唯一、悪化する**。並列度が半分になるため、既存601テスト+char582テスト
  (nominal、実際の実行は一部)の処理に要する時間が増える。既にCPU4コアの50%という最小構成に近いので、
  1に下げると実質的に並列実行をほぼ放棄することになる。
- **安定性**: ホスト競合(複数chromiumインスタンスの奪い合い)は無くなるため、個々のテストの安定性は
  上がるはず。ただし**根本原因(charによるテストの絶対量増加)は解決しない**。workersを減らしても
  「処理すべき総量」は変わらないため、ジョブの所要時間が伸びた分、別の形で不安定要因(ジョブ全体の
  実行時間が長くなることによるタイムアウト等)が増える可能性もある。
- **リグレを見つける力**: 変化なし(実行対象は変わらない)。
- **#507との関係**: ci.ymlの`playwright test`行自体は変えずに済む(オプション追加だけ)ので、
  #507の「ちょうど1件ヒット」制約には影響しない。
- **既存テストの意味**: 変えない。

## 比較表

| 軸 | 案A(ジョブ分割) | 案B(CIから除外・ローカルのみ) | 案C(workers減) |
|---|---|---|---|
| 所要時間 | ◎ 既存E2Eは元の水準に復帰・charは並列なので全体wallは悪化しない | △ CI側は速くなるが③の作業に移るだけ(総量は減らない) | ✕ 並列度半減で悪化 |
| 安定性(既存E2Eの揺れ) | ◎ charの負荷から完全分離 | ◎ CIの安定性はA同様改善 | ○ 競合は無くなるが根本原因は残る |
| リグレを見つける力 | ◎ push毎にCIで強制実行・現状維持 | ✕ ローカル実行依存・やり忘れで検出漏れ | ◎ 変化なし |
| #507との整合性 | ○ 既存行は不変・新設行はgrep-invert不使用で衝突しない | △ 同じファイルに別責務を積む・実装規模大 | ○ ci.yml変更不要 |
| 実装コスト | 中(ジョブ追加・char用install追加) | 大(e2e-diff-main.mjs拡張・pre-push必須化の検討も要る) | 小(--workers=1を足すだけ) |

## 推奨: 案A

所要時間・安定性・リグレを見つける力の3軸すべてで最も良く、#507(すでにmerge済み)とも
コード競合・設計混在なしに両立できる。案Bはリグレ検出力の後退(CIという強制力を失う)が
このプロジェクトの運用実態(worktree共有・push担当の流動性)に対して許容しづらく不採用。
案Cは所要時間が唯一悪化し、根本原因(charのテスト絶対量)を解決しないため不採用。

## 完了条件の確定(②06:33の言い直しを踏襲)

「main の CI の test が2回続けて success であり、その2回とも、Playwright の Run Summary の
failed(skipは含めない)が0件であること」。案Aにより既存E2Eジョブがcharの負荷から分離されれば、
step2で入れたpublish-article-editor.spec.js:619のtimeout延長(15000→30000ms)と合わせて、
この条件を満たせる可能性が高い。

## step4への申し送り

- ci.ymlの72行目に`--project=chromium`を追加(既存の`--grep-invert "sort-perf-budget"`はそのまま)。
- 新設する`test-char`ジョブは、既存`test`ジョブと同じ`checkout`→`setup-node`→`npm ci`→
  `playwright install --with-deps chromium`の手順を複製し、charの6 projectを実行する。
  結果はcharジョブ独自のannotation(ci-annotate-failures.mjsを使い回せる・step2で直したfailed/
  skipped/flaky分離がここでも活きる)で出す。
- 既存`test`ジョブの名前(`test`)はpush-gate等が参照していないか確認してから変更する(現状維持なら
  問題ないはず・`test-char`は新規ジョブ名なので既存の参照には影響しない想定だが要確認)。
- rebase: このworktreeのHEAD(b7e2a9a)はorigin/mainより1つ古い(ae2f891=#507が先にmerge済み)。
  push前にrebaseが必要(project noteの「push前のrebaseで?v=重複」の教訓どおり、rebase後に
  index.htmlの?v=値をorigin/main最新と比べて確認すること)。
