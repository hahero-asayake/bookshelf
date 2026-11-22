# イシュー#748 結果：art-publish-sheet.spec.js:207（PC 幅のパネルの高さが 0.9px ずれる）

## §1 原因：見た目の変化ではなく spec の作り

### CI で落ちていた物
- run #439（b5b174a・https://github.com/hahero-asayake/bookshelf/actions/runs/45004045616）の run 画面の annotation：test (e2e) の失敗は合計1件。
  - `[chromium] › art-publish-sheet.spec.js:198:5 › PC 幅 (1280×800) › 開く: パネルの矩形が前の版 (origin/main b9d95ec) と同じ`
  - `expect(g.panel.height).toBeCloseTo(548.44, 0)`。Received 547.515625・差 0.924（精度0＝差0.5未満が条件）。
- char・webkit・audit のジョブは「E2E 失敗 0件」。

### 4通りで測った（PC 1280×800・spec と同じ setup/geom）
台本は `~/kuroko/_vault-work/748/probe.mjs`。origin/main と b9d95ec（#742 の前）を git archive して配り、spec の写しに測りの1行を足した。出力は probe2.out（計画run）と probe3.out（このステップで流し直した物）で、同じ値だった。

| 環境（日本語の書体） | 版 | narrow | top | bottom | height | left〜right |
|---|---|---|---|---|---|---|
| 手元 chromium（Takao Pゴシック） | b9d95ec（前） | null | 125.78125 | 674.21875 | 548.4375 | 280〜1000 |
| 手元 chromium（Takao Pゴシック） | origin/main（今） | 'fit' | 125.78125 | 674.21875 | 548.4375 | 280〜1000 |
| 公式コンテナ v1.65.1-resolute（WenQuanYi Zen Hei） | b9d95ec（前） | null | 126.234375 | 673.75 | 547.515625 | 280〜1000 |
| 公式コンテナ v1.65.1-resolute（WenQuanYi Zen Hei） | origin/main（今） | 'fit' | 126.234375 | 673.75 | 547.515625 | 280〜1000 |

- 同じ環境なら、前と今は 1/64px まで同じ。#742 は PC 幅の見た目を変えていない。
- 前と今で narrow の値が違う（null／'fit'）。違う版を測れている。
- コンテナの値 547.515625 は CI の Received と同じ。
- 書体は `fc-match sans-serif:lang=ja` で調べた。CI のランナーと公式コンテナが WenQuanYi になることは #728 で分かっている（projects/detail の #728 の節）。

### #742 の差分が PC 幅に効かない根拠（b9d95ec..bee101c）
- css の足し分は全部 `@media (max-width: 900px)` の中にある（css/bookshelf.css 8451-8469）。
- `data-ov-scroll` を読むのはその中の1行だけで、js には無い（git grep）。
- `data-ov-narrow`・`data-ov-kb-open` も、その中の規則だけが読む。

### 結論
spec の期待値 `PC_BEFORE={top:125.78,height:548.44}` は、homelab（Takao）で測った絶対値だった。差が0.5未満かどうかで比べていたため、書体の違う CI で 0.92px ずれて落ちた。top も差 0.46 で、際どく通っていただけ。

## §2 直し方：許容幅にせず、同じ実行の中で前の形と比べる

- PC 幅の「開く」の件を次の形に書き換えた。
  1. 切り替え `localStorage 'bookshelf.flag.pubSheet'='0'`（前の形）で開いて測る。`_artPubSheetOn` は開くたびにこの値を読む。
  2. ×で閉じ、既定に戻して開き直して測る。
  3. panel の top・bottom・left・right・height と、× の top・right を差0.05未満で比べる。
- 書体に依らない形の検査は残した：left 280・right 1000（ov-md 720px）、上下の中央寄せ（|top − (vh − bottom)| ≤ 1）、× が absolute、パネルの上が暗い所。
- 測りは `stableGeom` で取る。150ms ごとに読み、2回続けて同じになったら返す。
- `PC_BEFORE` の定数は消した。spec に残したコメントは2つ：書体の差の数値と理由／切り替えを撤去する時の置き換え方（形の検査だけにするか、コンテナの画像比較へ移す）。
- 許容幅（±1px）にしない理由：
  - 差の大きさは書体の行の高さで決まり、上限が無い。書体で折り返しが変われば1行分＝20px級ずれる。
  - CI は既に 0.92px で、±1px の際にいる。
  - 許容幅は、どの環境で測った絶対値と比べるかの問題を残す。
- PC 幅では、'0' の形は b9d95ec と同じ出し方になる（§1 の表と差分の根拠）。だからこの比べ方で「前の版と同じ」を確かめられる。

## §3 確かめ

| 何を | どこで | 結果 |
|---|---|---|
| spec 全件 | 手元 chromium（PORT 8148） | 8 件通過 |
| 「前の形」の2件 ×5（PC の件と、スマホの切り替えの件） | 手元 chromium | 10 件通過 |
| spec 全件 | 公式コンテナ resolute（`_vault-work/748/e2e-docker.mjs`・-c playwright.config.js） | 8 件通過 |
| PC の件 ×5 | 公式コンテナ | 5 件通過 |
| spec 全件 | 手元 webkit（BACKNAV_WEBKIT=1・iPhone 13） | 5 件通過・PC の 3 件は skip |
| 検出力 | 手元 chromium | 落ちた（下に詳細） |
| npm run lint | 手元 | 12 本中 0 本失敗 |
| npm test | 手元 | Test Files 85 passed・Tests 1273 passed・2 todo |

- 検出力の確かめ方：git archive HEAD を /tmp/748-mut に展開し、#742 の fit の塊の `@media (max-width: 900px)` だけを 4000px に変えて配った。PC 幅でシートの規則が効く状態になる。
- その版では新しい PC の件が落ちた：panel.top が前の形 125.78125 に対して 219.5625（差 93.78）。PC の見た目が変われば、この件が捉える。

横展開：tests/ の toBeCloseTo はこの spec の4か所だけだった。ほかの spec の「実測」の注記は、振る舞いの記録で、px の定数と比べてはいない。書体に依る絶対値の比べ方は、ほかには見つからなかった。
