# 見た目の比較テスト（visual）

`playwright.visual.config.js`（リポジトリ直下）＋ `tests/visual/screens.spec.js` の組。
9画面×6端末(`tests/char-devices.js`)の全画面スクリーンショット比較。`npm run test:e2e`
や CI には入らない、手動実行のみのスタンドアロン設定（ランナーごとのフォント描画ゆれを
まだ検証していないため・イシュー#512 で CI 投入は見送り）。

実行例:

```
PORT=8112 PLAYWRIGHT_BASE_URL=http://localhost:8112 npx playwright test -c playwright.visual.config.js
```

## 閾値とイシュー#512（見出し帯の小さな変化を拾えない問題）

全画面比較の閾値は `maxDiffPixelRatio: 0.001`・`threshold: 0.2`（`playwright.visual.config.js`）。
#511（設定の一覧の出口ボタンを×→←ホームに変更）では、見出し帯の変化が全画面の0.1〜0.3%
程度にしかならず、端末によって閾値未満でPASSしてしまう検出漏れが実際に発生した
（イシュー#512 実測：768幅の「設定の一覧」が閾値0.1%に対してratio 0.097%でPASS）。

対策として、見出し帯（出口ボタンを含む行）を持つ画面には、全画面比較に加えて
**locator 単位の比較を追加**した（方式＝全画面比較はそのまま維持＋要所だけ別に厳しく見る）。

- 対象：「設定の一覧」「設定の1節」の2テスト。共通ヘッダー `.settings-md-header`
  （両テストとも高さ52px）を `expect(locator).toHaveScreenshot(name, { maxDiffPixels: 30 })`
  で比較。全画面側の `maxDiffPixelRatio` は継承せず、`maxDiffPixels`（絶対px数）で上書きする
  （帯の面積が20,280〜39,936px程度しかなく、ratio指定だと1px単位の揺れでも閾値を超えやすいため）。
- 全画面側の `maxDiffPixelRatio` を一律で下げる案は採らなかった（#512実測：768幅の1ケースしか
  追加で拾えない一方、54枚全体でフォント描画ゆれ等の誤検出リスクが上がるだけで見返りが薄い）。
- 対象を「設定の一覧／設定の1節」の2テストに限定した理由：#511は他に「本の詳細」「ホームの編集」
  「記事の全体編集」にも出口ボタンを足しているが、#511前のコードを#511後の基準画像に当てて
  全画面比較した結果、「ホームの編集」「記事の編集」は見た目の変化なし（挙動変更のみ）、
  「本の詳細」はPC版3端末でdiff比1.3〜2.1%（閾値の13〜21倍）と大きく、全画面比較のままでも
  確実に検出される。どの画面も「全画面比較で埋もれる」ケースは無かったため、locator比較は
  見出し帯を持つこの2テストだけに留めた。詳細・実測値はイシュー#512のメモ
  （`_vault-work/512/step1-findings.md` 〜 `step3-implementation.md`）参照。

## CIの扱い

visual は CI に入れていない（既存CIは壊れないことの確認にとどめる）。完了確認は
**ローカルで3回連続緑**（既存の全画面＋locator比較すべて含む）。CI投入はランナーごとの
フォント描画ゆれを別途調べてから検討する（イシュー#512の範囲外）。

## 基準画像の更新手順

見た目を意図して変えたら、該当テストだけ対象に絞って `--update-snapshots` で再生成する。

```
PORT=8112 PLAYWRIGHT_BASE_URL=http://localhost:8112 \
  npx playwright test -c playwright.visual.config.js -g "<テスト名>" --update-snapshots
```

その後、差分が意図した変更だけか（`git diff --stat` で更新枚数を見る）を必ず確認してから
commit する。
