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
