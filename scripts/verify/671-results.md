# イシュー#671：ホームのウィジェット選択（popover）を、保存の失敗・未保存の帯の分だけ下げる

## §1 直す前の再現（step1・2026-11-14）

- base：origin/main d18af26（#660 は d7d6924〜2946a43 で入り済み＝`git log origin/main --grep='#660'`）
- spec：`tests/e2e/status-bar-over-faces.spec.js` の (e)。describe の中で `test.use({ viewport: { width: 390, height: 664 } })` を当てる（iPhone 13 の高さ）。webkit は playwright.config の gate-webkit（testMatch に入り済み）が流す。
- 手順：
  - 保存の失敗は `setupSaveFailure`（#660 と同じ）で出す。
  - ホームの編集 →「ここにウィジェットを追加」(`#add-widget-card`) で開く。止まった状態（「確認」が出る）まで待つ。
  - 帯の文（`.status-msg`）だけを置き換えて、1〜4行にする（「文言を長くして再現」）。2行以上は、n 行目が半分ほど埋まる長さにする。
  - `--status-urgent-h` が帯の実高に追いつくまで待つ。
  - focus の再評価で状態バーが作り直されず、置き換えた文が残ることを確かめる（#660 の `_statusHtml` の控え）。
- 判定：
  - panel の上端 ≥ 帯の下端（soft）。
  - × の中心で一番上が × 自身（soft）。
  - 「再試行」の中心で一番上が「再試行」自身。click trial が通る。
  - 実際に押すと行が消え、短文メモがハブへ届く。
- 流し方：`PORT=8171 PLAYWRIGHT_BASE_URL=http://localhost:8171 GATE_WEBKIT=1 node node_modules/@playwright/test/cli.js test tests/e2e/status-bar-over-faces.spec.js --grep "ウィジェット選択の panel" --project=chromium --project=gate-webkit --workers=4`
- 画像と数値：`tmp/671/<project>/<行数>line-before.png`・`.json`（gitignore 済み）。

### 結果（18:48・8件で22.2秒・負荷の平均 約11）

- **6件通過・2件失敗**。失敗した2件は、どちらのブラウザも4行の case。失敗したのは panel の上端の soft assert だけで、「再試行」を押す所から先は4行でも通った。

| project/帯の行数 | --status-urgent-h | 帯の下端 | panel の上端 | panel の下端 | 隙間（panel 上端 − 帯 下端） | × が一番上 | 「再試行」が一番上 | panel が画面内 |
|---|---|---|---|---|---|---|---|---|
| chromium/1行 | 60px | 59.4 | 79.7 | 544.5 | 20.3 | ○ | ○ | ○ |
| chromium/2行 | 60px | 59.4 | 79.7 | 544.5 | 20.3 | ○ | ○ | ○ |
| chromium/3行 | 79px | 78.4 | 79.7 | 544.5 | 1.3 | ○ | ○ | ○ |
| **chromium/4行** | 100px | 99.4 | 79.7 | 544.5 | **−19.7** | ○ | ○ | ○ |
| gate-webkit/1行 | 60px | 59.4 | 79.7 | 544.5 | 20.3 | ○ | ○ | ○ |
| gate-webkit/2行 | 60px | 59.4 | 79.7 | 544.5 | 20.3 | ○ | ○ | ○ |
| gate-webkit/3行 | 79px | 78.3 | 79.7 | 544.5 | 1.4 | ○ | ○ | ○ |
| **gate-webkit/4行** | 100px | 99.3 | 79.7 | 544.5 | **−19.6** | ○ | ○ | ○ |

- 画像：`tmp/671/chromium/4line-before.png` で、panel の上の約20px（角丸と見出しの上の余白）が帯の下に隠れている。「ウィジェットを追加」の文字と × は、まだ見えている。
- 分かったこと：
  1. **1行と2行は同じ高さ（60px）**。「再試行」「確認」のボタン（min-height 44px）が行の高さを決めるため。
  2. **3行は 79px で、隙間は 1.3〜1.4px**。#660 で測った「78px・2px」と同じ形で、#660 の既定の文言は 390 幅で3行だった。3行では、直す前でも重ならない。
  3. **4行で重なり始める**（隙間 −19.7）。panel の上端は `margin-top: 12vh`（664 の 12% ＝ 79.7px）に固定で、帯の高さを見ていないため。→ 計画どおり、重なり始める4行の case を足した。これが直す前の赤で、直したことが検査に効く。
  4. **「再試行」は何行でも押せる**。帯（z 1700）が popover（1000＋n）より手前にあり、popover は trap ではない（inert が付かない）ため。実害は「popover の上端が帯の下に入る」ことの方で、4行では見出しの上の余白まで、5行を超えると見出しと × に届く見込み（未測定）。
  5. 置き換えた文は、focus の再評価の後も残った（状態バーは作り直されない）。
  6. panel の下端は 544.5 で、画面内（664）に収まっている。直した後は、帯の高さだけ下がる見込み（4行で約644）。
- 直した後の期待（step2）：panel の上端＝帯の高さ＋79.7 になり、1〜4行のすべてで隙間は 79.7 前後になる。画像は `<行数>line-after.png`（印の有無で before/after を自動で分ける）。

## 同種の洗い出し（全画面の fixed の重ね・計画時の note を転記）

| 面 | 扱い | 理由 |
|---|---|---|
| .modal・.cmdk（コマンドパレット・kind modal）・.plugin-settings-modal | #660 で対応済み | kind modal |
| .app-sidebar | #660 で対応済み | kind sheet |
| 狭幅の .app-detail | #660 で対応済み | 媒体条件付きの規則 |
| **.widget-picker-overlay** | **この件の対象（唯一の漏れ）** | kind 'popover' なので規則に当たらない。.cmdk と同じ作り（12vh・70vh）なのに、kind が違うので漏れた |
| .cfm-overlay | 対象外 | 確認ダイアログ。帯より上（1800）にあるのが仕様 |
| .mobile-scrim | 対象外 | 955 で、ただのスクリム |
| .art-side | 対象外 | 下から出るシートで max-height min(70vh,100vh-3.5rem)＝664 では上端 199 で届かない |
| .art-add-sheet・.art-sheet-scrim | 対象外 | 下に出る panel で、z も帯より下 |
| import.js の bs-import-panel・ドラッグのゴースト | 対象外 | アプリ外のページ用・一時要素 |

- 別の型：アンカー付きのメニュー（`_placeAnchoredMenu` が上端を画面の 8px で留め、帯の下端を見ない）。②の判断で、この件では直さない（②が別に扱う）。

## §2 直した後（step2・2026-11-14）

### 実装

- **js/overlay-manager.js**：open() の spec に `belowNotice` を足した。
  - 既定は「kind が modal か sheet で、layer≠false」。#660 の規則 `[data-layer][data-ov-kind=modal|sheet]` と同じ集合なので、既存の面の挙動は変わらない。
  - `_applyLayers` で、data-layer と一緒に `data-ov-below-notice` を書く。close() で、data-layer と一緒に消す。
  - layer:false の面（記事の面など）には、belowNotice:true でも書かない（data-layer を持たない面は対象外。#660 と同じ）。
- **css/bookshelf.css**：#660 の2つの kind セレクタを `body.has-status-urgent [data-ov-below-notice]` の1つに置き換えた。宣言（top・bottom:0・height:auto）は同じ。
  - 狭幅の `.app-detail` の規則は、そのまま残した。重なり管理役のスタックの外（940）にあり、PC では列（fixed ではない）のため。理由はコメントに書いた。
- **js/dashboard.js** `_openWidgetPicker`：overlays.open に `belowNotice: true` を足した。kind 'popover' のままなので、closeOthers・背後の inert なし・背面を押すと閉じる、は変わらない。
- **tests/unit/overlay-manager.test.js**：3件を足した。
  - 既定で modal・sheet にだけ付く。
  - popover＋belowNotice:true には付く。layer:false の面と、modal＋belowNotice:false には付かない。
  - close で消え、開き直すと付く。
- **index.html の ?v=**：bookshelf.css・overlay-manager.js・dashboard.js を 2026111798 にした。origin/main 47505b2 と作業中の worktree の最大値（2026111797）の次。

### (e) の座標（直した後・18:51〜18:54）

| project/帯の行数 | --status-urgent-h | 帯の下端 | 重ねの上端 | panel の上端 | panel の下端 | 隙間 | × が一番上 | 「再試行」が一番上 | panel が画面内 | 印 |
|---|---|---|---|---|---|---|---|---|---|---|
| chromium/1行 | 60px | 59.4 | 60 | 139.7 | 604.5 | 80.3 | ○ | ○ | ○ | あり |
| chromium/2行 | 60px | 59.4 | 60 | 139.7 | 604.5 | 80.3 | ○ | ○ | ○ | あり |
| chromium/3行 | 79px | 78.4 | 79 | 158.7 | 623.5 | 80.3 | ○ | ○ | ○ | あり |
| chromium/4行 | 100px | 99.4 | 100 | 179.7 | 644.5 | 80.3 | ○ | ○ | ○ | あり |
| gate-webkit/1行 | 60px | 59.4 | 60 | 139.7 | 604.5 | 80.3 | ○ | ○ | ○ | あり |
| gate-webkit/2行 | 60px | 59.4 | 60 | 139.7 | 604.5 | 80.3 | ○ | ○ | ○ | あり |
| gate-webkit/3行 | 79px | 78.3 | 79 | 158.7 | 623.5 | 80.4 | ○ | ○ | ○ | あり |
| gate-webkit/4行 | 100px | 99.3 | 100 | 179.7 | 644.5 | 80.4 | ○ | ○ | ○ | あり |

- 重ねの上端が帯の高さ（--status-urgent-h）に一致する。panel の上端は、帯の高さ＋79.7（12vh）になった。
- 隙間は、1〜4行のすべてで +80.3〜80.4。直す前は 3行で +1.3、4行で −19.7 だった。
- **panel の下端**：4行でも 644.5 で、画面（664）に収まる。そのため、panel の高さ（.cmdk と揃えた 70vh）は変えていない。
- 「再試行」は、どの行数でも押せる。click trial と実際の click の後、行が消えて短文メモがハブへ届いた。
- 画像：`tmp/671/<chromium|gate-webkit>/<1〜4>line-after.png`（直す前は `-before.png`）。
  - webkit の 3行の画像：帯・iOS の「ホーム画面に追加」の案内（帯の下・重ねの背面で暗くなる）・panel が、この順に並ぶ。panel の見出しと × は帯から離れて見える。

### 流したもの（すべて PORT=8171）

- **status-bar-over-faces.spec.js と load-conflict-unsaved.spec.js**：chromium と gate-webkit で **47件すべて通過**（2.8分）。
  - 内訳は、status-bar-over-faces が project ごとに22件（#660 の (a)〜(d) の18件＋(e) の4件）×2、load-conflict-unsaved が chromium の3件。
  - (e) の4行（直す前の赤）も通った。
- **char の widgets.spec.js と x2-widgets.spec.js**：6端末で **74件通過・10件 skipped**（34.3秒・CI の test (char) と同じ project）。
- **vitest 全件**：80ファイル・1195件通過（2件は todo）。overlay-manager は12件。
- **npm run lint**：12本中0本失敗。

## §3 回帰の確認：e2e-diff-main（step3・2026-11-14）

- **載せ直し**：流す前に、origin/main 9713381 へ `git rebase` した（#669 の5件が先に入っていたため）。
  - 衝突は無し。commit は 3c60f16（test）・470e632（fix）になった。
  - ?v= の 2026111798 は、origin/main と他の worktree の最大値（2026111797）より新しいまま。`check:version --range=origin/main..HEAD` は OK。
- **流し方**：`node scripts/verify/e2e-diff-main.mjs --port=8171 --out=tmp/671/e2e-diff` を、`systemd-run --user` で run の外に出して流した（#634 の作法）。visual は既定でオン。--init-storage と --grep は使っていない。
- **走らせる前の状態**：PORT 8171 は空き（`ss -ltn`）。負荷の平均は 36.5／34.7／28.0（18:57）。
- **1回目（18:57〜19:02）は失敗**：
  - base 側の playwright（1744件・8 workers）が、途中で外から止められた（`exit=null`＝シグナル）。
  - その時に残った webServer（python3）が 8171 を塞ぎ、work 側の開始時のポートの確認（2.5秒）で落ちた。
  - 止めたものは分かっていない（未確認。負荷は 40 前後）。8171 は自分のシェルからも systemd の unit からも listen できることを確かめ、同じ条件で流し直した。
- **2回目（19:03:20〜19:15:07・約12分）は完走**（exit 0）：
  - base（origin/main 9713381）の E2E：1744件のうち、通過 1149・skipped 593・失敗 2（4.2分）。
  - work（470e632）の E2E：1748件のうち、通過 1152・skipped 593・失敗 3（6.0分）。
    - base より4件多いのは、(e) の chromium 分の4件（gate-webkit は e2e-diff の既定では流れない）。4件とも通った。
    - 通過の差が +3 なのは、j3-5 が work 側で落ちたため（下の flake）。

### 3表（E2E）

| 区分 | 件数 | 中身 |
|---|---|---|
| 新しく落ちた | 1件（**flake**） | gate/j3-5-many-books（chromium）「913冊・CPU 6倍遅くでも、並び順と昇順・降順の切替と直後の本の詳細が、基準時間内に出る」。work 側で3回流し直し、1回目は通り、2・3回目は落ちた。時間を測る門で、#660 の記録でも負荷で揺れていた。並び順の切替の描画時間を測るもので、この件の変更（帯の下げ規則・ウィジェット選択の印）は通らない。 |
| 新しく通った | 0件 | |
| 両方で落ちた | 2件 | duplicate-asin-notice（本の詳細の付け直し案内）と list-staged-render（913冊の段階描画で途中で1冊を動かす）。base でも落ちる既存の問題。 |

- **単体（vitest）**：新しく落ちた0・新しく通った0・両方で落ちた0。
- **画像の差分（visual・playwright.visual.config.js）**：**0件／54件**。基準画像の更新は無し。帯は保存の失敗・未保存の時だけ出て、基準画像にその状態は無いため。
- **判定**：新しく落ちたものは flake の1件だけで、回帰は0件。#660 の既存 spec は step2 で全件通った（status-bar-over-faces 44件・load-conflict-unsaved 3件・char ウィジェット 74件）。
- 結果一式：`tmp/671/e2e-diff/`（report.md・report.json・各 json と log）。
