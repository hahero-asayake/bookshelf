# #405 step1: 直近3回のCI test失敗内訳と切り分け（2026-10-29実測）

## 取得方法・制約

- `gh` 未インストール＝GitHub REST（未認証）の `commits/{sha}/check-runs` と `check-runs/{id}/annotations` で取得（projectノート#349の型）。
- 未認証のためレート制限60/h。本ステップで30消費・remaining 30（全件取得済み、未取得分なし）。
- ログ本文（Actionsの生ログ）はREST未認証では取れないため、**annotations（PlaywrightのgithubレポーターがE2E失敗を書き出したもの）のみ**で判定した。annotationsにはfail時のエラーメッセージ・該当行まで含まれており、今回の判定に必要な情報は揃っている。

## 3回分の内訳

| commit | 1回目失敗 | retryで回復 | 最終残り（test job結果） |
|---|---|---|---|
| 1b61b06 | 15件 | 13件 | ① sort-perf-budget（order tFrame中央値 548.4ms > 380ms） ② publish-conflict-hub「連打防止」（60000msクリックタイムアウト） |
| f01c257 | 14件 | 13件 | ① sort-perf-budget（drag tFrame中央値 166.3ms > 120ms） |
| 03a64d5 | 15件 | 13件 | ① sort-perf-budget（order tFrame中央値 429.8ms > 380ms） ② publish-article-editor「生成中…進捗反映」（`#pp-preview-progress`非表示待ちpoll 5000msタイムアウト） |

**brief未記載の追加発見**：1b61b06では `publish-conflict-hub.spec.js`（#374案D・公開ボタン連打防止）も最終的に失敗していた。依頼brief文面は03a64d5時点の観測（sort-perf-budget + publish-article-editorの2件）のみを書いているが、1b61b06ではこの3つ目が最終残りだった。f01c257・03a64d5では同テストは通過している。

## 直前の緑commitとの差分

- 直前の緑commit（test success）= `d05470c`（2026-10-28 21:21:22完了）。9f6ef31・7b74b17は同一push内の中間commitでCIが走っていない（GitHub Actionsは各pushの先頭commitのみ実行）。
- `d05470c..1b61b06`（js/・tests/のみ）:
  - `js/book-manager.js` +7 / `js/bookshelf.js` +158-45（9f6ef31: 並び替え処理A1/A4/A5/A6軽減）
  - `tests/e2e/sort-perf-budget.spec.js` +153（1b61b06: フレーク対策）
  - `js/bookshelf.js`の該当diffに `pp-preview-progress`/`生成中`/`PublishArticleGenerator` は**含まれない**（grep確認済み・進捗表示ロジックとは無関係）。
- `1b61b06..03a64d5`（tests/のみ、全46ファイル）: 内容は`page.goto('/index.html')`→`page.goto('index.html')`の相対化（#399）のみ。`publish-article-editor.spec.js`・`publish-conflict-hub.spec.js`の該当差分もgoto行2箇所・1箇所のみで、**テストロジック自体は無変更**。

## 切り分け結論

1. **sort-perf-budget**：3/3回で最終的に失敗。毎回超過する指標が違う（order×2, drag×1）、超過幅も380→548ms/120→166ms/380→429msとばらつく＝**CI負荷依存**。9f6ef31時点のコメント通り元々「CI全並列実行下の負荷を厳密に再現しない回帰ガード」であり、1b61b06のフレーク対策後もなお単独実行想定のBUDGETでは足りていない。アプリ側の退行を示す差分はない。
2. **publish-article-editor**：1/3回のみ失敗（03a64d5）。該当テスト・該当アプリコードはd05470c以降無変更（goto相対化のみ）＝**退行ではなくCI負荷依存のflakyの可能性が高い**（5000ms pollタイムアウト）。ただしstep3で#384の再現条件により実際に反復確認する。
3. **publish-conflict-hub（brief未記載）**：1/3回のみ失敗（1b61b06）。同様に該当テスト・アプリコード無変更＝**負荷依存のflakyと推定**（60000msクリックタイムアウト）。f01c257・03a64d5では通過。依頼の対象外だが、②へ報告が必要（直すかどうかは②判断）。

## 追記（step2・2026-10-29 07:14〜07:23実測）：#401/#402（仮想化）commitの影響

step1完了時点（07:08承認）はorigin/main..HEADがdocsのみ2件だったが、step2着手時にはahead 3件に増え、`441cd65`「並び順の変更・昇順/降順の切替で一覧を段階描画し、固まる時間を約130ms→約20msに」（#401/#402の実装commit・まだpush前）が追加されていた。`tests/e2e/sort-perf-budget.spec.js`自体への差分は無い（`git log origin/main..HEAD -- tests/e2e/sort-perf-budget.spec.js`は空）が、計測対象の並び替え処理自体が大きく変わっている。

- **441cd65を含まない状態**（このファイル冒頭の「CI実測」＝本ファイル上の表、1b61b06/f01c257/03a64d5、reps=3中央値）：order 429.8〜548.4ms、drag 166.3ms（いずれもBUDGET超過）
- **441cd65を含む状態**（今回ローカル実測、reps=3）：
  - 単独実行×3回：tFrame 60〜93ms（order/direction/dragとも）
  - 全50ファイル8 worker並列実行×1回：tFrame 93〜140ms（dragのみ1回だけ最大131.7ms > BUDGET.drag.tFrame=120msだが中央値96.6msはBUDGET以下）

441cd65が無い状態の3〜6倍の余裕がある。つまり**#401/#402がmainにpushされればBUDGET超過問題はほぼ解消する見込み**。ただし441cd65を含めてpushするかどうかは本イシュー(#405)の管轄を超える判断のため、push前のtp(step4)で②に報告・判断を求める（#405は「spec側の変更にとどめる」依頼のため、spec側は441cd65の有無どちらでも通る形＝reps=5＋最大値は記録のみ＋BUDGET維持、にして対応した）。

※step4追記: 441cd65は#401/#402側が自分のcommitとして既にorigin/mainへpush済みと確認した（②指示により#405では441cd65をpushしない）。

## 追記（step3・2026-10-29 07:26〜07:41実測）：publish-article-editorの原因特定

着手前チェック：`tests/e2e/publish-article-editor.spec.js`・関連アプリjs（js/exporter.js・js/publish-article-store.js・js/bookshelf.js）はいずれも#401/#402の未push・未コミット変更と重ならない（`git log origin/main..HEAD -- tests/e2e/publish-article-editor.spec.js`は空、未コミット差分にも同ファイル・関連jsは含まれない）。

診断：#384の再現条件（CPU0専有burner4本+CDP CPUスロットリング10倍、`--trace`無し）で該当テスト（`長文メモ読込中は「生成中…」に進捗(N/M)が反映される`）を反復：
- 修正前：単独10回反復→0件失敗／ファイル全体95テスト1パス（同条件）→0件失敗
- アプリ側（js/）への該当差分は無い（step1で確認済み、1b61b06..03a64d5はgoto相対化のみ）

結論：アプリ側の決定的バグの証拠なし。CI実機（コア数が少ない）での全50ファイル8 worker並列実行下の「ホスト側コンテンション」が、ローカルのburner+CDP throttling再現条件よりも質的に厳しいと判断（sort-perf-budgetの切り分けと同じ構造）。#384で見つかったU1（stale先回り、既に修正済み）とは別件で、今回は該当しない。

対処：656行目の完了待ち`expect.poll`のtimeoutを5000ms→15000msへ延長（#372/article-pc-pane.spec.jsと同じ対処パターン）。アプリ(js/)は変更していない。修正後、同じ再現条件で12回反復し0件失敗を確認。

**②への確認事項**：#384では「timeout延長方針(案C)は不採用」と決まった経緯があるが、それは当時「唯一の不具合がアプリのバグ(U1)だった」ため。今回はアプリ側に不具合の証拠が無い点が異なるため、timeout延長で対応した。この判断に異論があれば差し戻しを。

### ②承認（step4着手前）: この延長は1か所だけの例外

②から以下の条件つきで承認を得た（2026-10-29 07:42）：待ち時間の延長は656行目の完了待ち（5秒→15秒）**この1か所だけに限る**。#384で不採用にしたのは「全体を一括で延ばすこと」と「アプリのバグを隠すこと」であり、今回は(a)アプリ側に不具合の証拠がなく(b)1か所だけの延長なので矛盾しない、という判断。

- **根拠（再掲）**：#384の再現条件下で、修正前の反復（単独10回・ファイル全体95テスト）とも0件失敗、アプリ側(js/)に該当差分なし。
- **限界の明記**：この検証はCI実機相当の条件（全50ファイル8 worker並列実行下・コア数が少ないホスト）そのものを再現したものではない。ローカルのburner4本+CDP CPUx10は「ページ内JS実行の遅さ」の近似であり、「ホストOS全体のプロセススケジューリング競合」という質的に異なる負荷を完全には再現していない。
- **今後の合図**：このテストが15秒のtimeoutでも落ちるようになったら、それは「CI負荷の揺れ」では説明がつかない域に入ったという合図であり、timeoutの再延長ではなく**アプリ側（生成処理・pp-preview-progressの開閉ロジック）を疑うべき**。

## 追記（step4・2026-10-29 08:05〜08:08実測）：push後のCI結果・スコープ外の新規failure

waitForIssues([398,402])の待機から復帰後、`git fetch`→`git log --oneline origin/main..HEAD`を確認した結果、ahead/behindとも0件（HEAD=origin/main=`69d5c4f`）。つまり**自分のcommit(d331fb9)は#398/#402側のpushに含まれて既にpush済み**だった(push操作自体は実行していない)。`d331fb9`時点と`origin/main`時点で`tests/e2e/sort-perf-budget.spec.js`・`tests/e2e/publish-article-editor.spec.js`の内容はmd5一致＝自分の変更は壊れず残っている。

`69d5c4f`に対するCI(test job)は**failure**（23:04:11開始〜23:04:35完了、24秒で終了）。annotationsで確認した失敗は以下で、**#405の対象(sort-perf-budget / publish-article-editor)ではない**:

```
tests/unit/publish-article-generator.test.js > opts.onProgress (...) >
  長文メモ表示ブロックが無くても rendering/assembling は通知される (読込対象が無いだけ)
  AssertionError: resumedBy: expected "messageChannel", received "timeout"
```

E2Eは実行されていない（`test-results/e2e.json`が無い＝unit test(`npm test`相当)がexit code 1で落ち、ジョブ全体がそこで終わった）。

切り分け：
- 自分のcommit(d331fb9)はtests/e2e/のみ変更＝このunit testファイル・関連jsには無関係（確認済み）。
- `d05470c..69d5c4f`で`tests/unit/publish-article-generator.test.js`・`js/publish-article-generator.js`への変更は無い（`git log -S"resumedBy"`も無変更）。つまり**コード変更が無くてもこの現象が起きる**。
- ローカルでCPU負荷再現(taskset -c0,1 + burner4本)下でこのテストを10回反復 → **3/10件(30%)failで再現**。コード変更なしで再現する＝MessageChannelのpostMessage到達とsetTimeoutフォールバックの競合という、実装(`js/publish-article-generator.js`のyield機構)の既存のタイミング依存バグと推定。CI負荷がこれを誘発した可能性が高い。

結論：**このCI failureは#405のスコープ外**（sort-perf-budget・publish-article-editorの不安定ではなく、別の既存flaky unit test）。#405の変更が原因でないことは確認済みだが、「mainのCI testジョブが2回連続success」という完了条件そのものがこの別件によって阻まれている。この先の進め方（別イシュー化するか、#405で巻き取るか、2本目のpushで様子を見るか）は②の判断を求める（tp）。

## 追記（step4やり直し・2026-10-29 08:10〜08:13実測）：原因特定＝テストの前提誤り（アプリは直さない）

②差し戻し（案b）を受けて原因を特定。`js/publish-article-generator.js` 24-55行目のコメント（イシュー#160/#161/#163）に、この`resumedBy`(`timeout`または`messageChannel`)の仕組みが明記されている：

- `_yieldToEventLoop()`は`setTimeout(0)`と`MessageChannel`の`Promise.race`で二重化されている（#161: タイマースロットリング対策）。
- #163で実ブラウザ(Chromium)実測したところ「健全時は`timeout`が優勢(3/3・18/20・20/20回)」で、Node.js/vitest実測の「常に`messageChannel`」とは**逆転**することを確認済み。
- コード中の結論（36-44行目）: 「**resumedByの値そのもの(どちらが多いか)は環境依存で当てにならない**」「判別は`timer-lag`/`timer-lag-summary`に委ねる設計にした」。

つまりこれは**アプリ側が意図的に選んだ設計**（#163で確定済み）であり、バグではない。実際、同じテストファイル922行目の別テスト（`_renderBlocks はブロックごとにマクロタスクへ yield する`）は、この設計を正しく反映して`expect(order[1]).toMatch(/^yield-done:(timeout|messageChannel)$/)`という形でどちらの値も許容している。

一方、`opts.onProgress`のテスト2件（776行目・797行目、CIで落ちたのは797行目）は、`expect(calls).toEqual([...])`の配列内で`resumedBy: 'messageChannel'`と**厳密固定**していた＝#163の設計方針を反映し忘れていた、テスト側の前提の誤り。横展開確認：リポジトリ全体で`resumedBy`を厳密値比較している箇所は上記2箇所のみ（`tests/unit/art-preview-stage-label.test.js`は固定文字列を入力として渡すラベル生成テストで、race条件に依存しないため対象外）。

対処：`tests/unit/publish-article-generator.test.js`の792行目・810行目を`resumedBy: expect.stringMatching(/^(timeout|messageChannel)$/)`に変更（922行目と同じ考え方に統一）。**アプリ(`js/`)は変更していない**（#377方針：アプリ側に問題が無いことを確認済みの上でテストの前提を直した。問題を隠す緩和ではない）。

検証：修正後、`npx vitest run tests/unit/publish-article-generator.test.js`で76件全てpass。CPU負荷再現(taskset -c0,1 + burner4本)下で、797行目テストを30回・776行目テストを30回、それぞれ単独反復 → **いずれも0/30件失敗**。
