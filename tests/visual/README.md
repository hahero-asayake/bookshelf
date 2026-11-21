# 見た目の比較テスト（visual）

`playwright.visual.config.js`（リポジトリ直下）＋ `tests/visual/screens.spec.js` の組。
9画面×6端末(`tests/char-devices.js`)の全画面スクリーンショット比較。`npm run test:e2e`
には入らないスタンドアロン設定。**基準画像は Playwright 公式コンテナ
（`scripts/verify/visual-image.mjs` のイメージ）の中で撮り、手元も CI もそのコンテナの中で比べる**
（イシュー#728。素の環境では日本語の書体が機械ごとに違い、54件とも差分になる）。

push前確認に使う `scripts/verify/e2e-diff-main.mjs` では、イシュー#526 により **既定で
visual も走る**（約8秒・54件、work側単独の基準画像比較。付けない限り外せないので、
UI変更時の付け忘れが構造的に起きない）。外す場合は `--no-visual` を付ける（詳細は下の
「e2e-diff-main.mjs での扱い（#526）」）。

実行例:

```
PORT=8112 node scripts/verify/visual-docker.mjs
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

visual は `ci.yml` には入れず、別のワークフロー `.github/workflows/visual.yml` で流す（イシュー#527・#728）。
差分が出たら Visual が赤になる（#728 で `continue-on-error` を外した。`ci.yml` とブランチ保護には効かない）。

- 走る時：main への push のうち、`js/**`・`css/**`・`index.html`・`tests/visual/**`・
  `playwright.visual.config.js`・`visual.yml` を変えた時。
- 流し方：job の `container` に、手元と同じ公式コンテナを使う（#728 で同じ commit を2本流し、2本とも 0/54 件だった）。
- **UI を変えたら、同じ commit で基準画像を撮り直す**：`PORT=8112 node scripts/verify/visual-docker.mjs -g "<テスト名>" --update-snapshots`
  （忘れると push の後に Visual が赤になる）。
- 件数：run 画面の annotation「visual 集計: 差分N/54件」で読む。
- 閾値の限界：全画面の閾値は 0.1% なので、1文字（約100px）の変化は拾えない（#728 の確かめで 0/54）。
  40×24px の四角でも、拾えたのは 390・768 幅だけ。小さな変化は locator の比較（上）で見る。

push前のローカル確認(`scripts/verify/e2e-diff-main.mjs`)は#526で既定visualオンになったため、
「push前にローカルでvisualを含めて確認する」こと自体はCIが無くても担保される。

## e2e-diff-main.mjs での扱い（#526）

`scripts/verify/e2e-diff-main.mjs`（push前のbase対work比較スクリプト）の画像比較は、
**イシュー#526から既定でオン**。以前は `--visual` を付けないと動かず、#521の見た目の変化が
付け忘れによって検出されないまま push された（下の「UI変更時の基準画像の扱い（#524）」参照）。

- 既定のまま実行すれば visual も含めて走る（work側単独・base比較はしない・実測約8秒/54件）。
- イシュー#728 から、visual は `scripts/verify/visual-docker.mjs` で公式コンテナの中で流す。
  docker かイメージが無い時は、1行の警告（取得のコマンド `docker pull <イメージ>` つき）を出し、
  `report.md` の「画像の差分」節に「スキップ（…）」と書く。イメージは自動では取ってこない（約3.8GB）。
- 外したい時（UI に一切触れない調査中など、速さを優先したい場合）だけ `--no-visual` を付ける。
  外した場合は `report.md` の「画像の差分」節に「スキップ（--no-visual 指定）」と明記される
  （外したこと自体が記録に残る）。
- `--visual` は後方互換で受け付ける（既定で既にオンのため何も変えない）。
- 判定ロジック（「UI系ファイルが差分に含まれる時だけ自動オン」等）は持たない。既定オンの方が、
  「対象パスの配列に新しいUIファイルを追加し忘れる」という#521と同種の見落としが構造的に
  起きないため（比較の詳細・実測は `_vault-work/526/step1-compare.md`）。

## 基準画像の更新手順

見た目を意図して変えたら、リポジトリ直下で、公式コンテナの中で該当テストだけ撮り直す：
`PORT=8112 node scripts/verify/visual-docker.mjs -g "<テスト名>" --update-snapshots`
（イメージが無ければ先に `docker pull mcr.microsoft.com/playwright:v<@playwright/test の版>-resolute`）。
手元の素の `npx playwright test` で撮らないこと（書体が違い、CI と全件が差分になる）。
撮り直したら、差分が意図した変更だけか（`git diff --stat` で枚数を見る）を確かめてから commit する。
Playwright の版を上げた時は、`.github/workflows/visual.yml` の `container.image` を同じ版に書き換え
（ずれは `tests/unit/visual-image.test.js` が落とす）、66枚を全部撮り直して、画像だけの commit にする。

## UI変更時の基準画像の扱い（#524）

#521（ホームの編集モードに「＋ここに追加」の枠・カードの「＋」を追加）は、基準画像を
更新しないまま push された（origin/main 自体が02-home-editの6端末で画像比較落ちになっていた、
イシュー#524で発覚・実測）。見落とした原因：push前確認に使う
`scripts/verify/e2e-diff-main.mjs` の画像比較（`results.visual`）は当時既定オフの
`--visual` フラグを付けないと動かず、#521のpush前確認コマンド（`docs/char/x2-e2ediff.md`）には
付いていなかった。加えて visual は CI にも入っていない（上の「CIの扱い」）ため、
push後も自動では誰も気づけない。

この「付け忘れ」自体は、イシュー#526で `e2e-diff-main.mjs` の visual を既定オンに変えたことで
構造的に起きなくなった（上の「e2e-diff-main.mjs での扱い（#526）」）。ただし次は引き続き徹底する。

- **UI変更時は該当画面の基準を同じcommitで更新する**：挙動だけでなく見た目も変えた画面があれば、
  そのcommit（または同じイシュー内の直後のcommit）で基準画像を撮り直す。「あとで直す」で先送りしない
  （基準画像が古いままだと、既定オンのvisualが毎回「差分あり」で失敗し続けるだけで、見た目の
  正しさは保証されない）。
- 撮り直しは対象テストだけ `-g "<テスト名>"` で絞り、`git diff --stat` で変更枚数が意図した分だけか
  （他画面を巻き込んでいないか）を確認してから commit する。
