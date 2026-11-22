# イシュー#742 スマホの公開パネルを中身の高さで下から出す — 結果（下書き）

## 1 実装（step1・commit 0fe2bac）

- `js/overlay-manager.js`：`open` に `narrow:'fit'`（狭幅 ≤900px で中身の高さのシート・root に `data-ov-narrow="fit"`）。指定しない面は開くたびに属性を消す。使うのは公開パネルだけ（オプトイン）。
- `css/bookshelf.css`：重なりの節の狭幅ブロックの後ろに fit の規則（下寄せ・`max-height: calc(100% - 48px)`・上角丸 14px・縦 flex・本文 `[data-ov-scroll]` だけ送る・×は absolute で右上・`env(safe-area-inset-bottom)`・キーボード中 `data-ov-kb-open` は全画面の形）。
- `js/screens/article-editor.js`：`_artPubSheetOn()`（定数 `ART_PUB_SHEET_DEFAULT = true` と localStorage `bookshelf.flag.pubSheet`：'0'=前の形・'1'=新しい形）。`updateKbBar` でキーボード中かつフォーカスがパネル内の時だけ `data-ov-kb-open`。開く時・閉じる時に印を外す。
- `index.html`：`.art-pub-body` に `data-ov-scroll`。?v= を3本上げた（check:version OK）。

## 2 手元の測定（chromium・公開パネルを開いた所・getBoundingClientRect）

測り方：`_local/742/measure.spec.js.txt`（publish-panel.spec.js の boot を写した一時 spec・PORT=8142）。生の値は `_local/742/742-measure-*.json`。

| 幅 | 形 | パネル top〜bottom（高さ） | × の矩形 | × の position | 上の点が暗い所（root） |
|---|---|---|---|---|---|
| 390×844 | 新（fit） | 294.1〜844（549.9） | top 314.1・right 378（パネル上端+20・右端−12） | absolute | はい |
| 390×844 | 切り替え '0'（前の形） | 0〜844（844） | top 20・right 376（画面の右上） | fixed | いいえ（全画面） |
| 1280×800 | 新 | 125.8〜674.2（548.4）・left 280〜right 1000 | top 145.8・right 988 | absolute | はい |
| 1280×800 | 切り替え '0' | 125.8〜674.2（548.4）・left 280〜right 1000 | top 145.8・right 988 | absolute | はい |

- 390：パネルの下端=画面の下端（844）・上端 294 ≥ 48・× はパネルの中の右上。下の白い空き（前の形で「下のボタンの列の下端 549.9〜844」= 294px）が無くなった。
- 1280：新と前の形で全項目が同じ＝PC 幅の出し方は変わっていない。

## 3 単体

- `npm test`：85 ファイル・1262 通過・0 失敗（2 todo）。`tests/unit/overlay-manager.test.js` に narrow:'fit' の1件を足した（13 件通過）。

## 4 新しい E2E（step2・tests/e2e/art-publish-sheet.spec.js）

保存先・公開先はハブの模擬（gate-hub.js・本物の保存と公開の経路）。利用者と同じ操作（tap/click）で、新しい記事→本棚ブロックに本1冊→公開パネル。

| 幅 | 件 | 確かめる事 |
|---|---|---|
| 390×844（iPhone の UA・タッチ） | 開く | 下端=画面の下端・上端≥48・高さ<画面・上の点が暗い所（root）・×はパネルの中の右上（上端+≤32・右端−≤24・absolute）・「閉じる」「公開する」が画面内 |
| 390×844 | 閉じる | ×（tap）・枠外（パネルより上の暗い所を tap）・戻る（goBack）で、パネルだけ閉じてエディタが残る |
| 390×844 | 公開までの通し | 公開する→同意して公開→公開URLの行が画面内・下端は画面の下端のまま |
| 390×844 | 切り替え | localStorage bookshelf.flag.pubSheet='0' → 全画面・×は fixed（前の形） |
| 390×844 | キーボード | FakeVisualViewport でタグの欄にフォーカス→可視域を55%に→data-ov-kb-open・全画面の高さ・欄の下端が可視域の中。外して戻すと中身の高さに戻る |
| 1280×800 | 開く | 矩形が前の版（origin/main b9d95ec を git archive して配り同じ測り方で実測：top 125.78・height 548.44・left 280・right 1000）と同じ |
| 1280×800 | 閉じる | ×・枠外（mouse 5,5）・戻る |
| 1280×800 | 公開までの通し | 公開URLの行が出る |

結果（PORT=8142）：
- chromium：8 件通過・0 件失敗。--repeat-each=3 で 24 件通過。
- webkit（iPhone 13・BACKNAV_WEBKIT=1・playwright.config.js の webkit の testMatch に足した）：スマホ幅 5 件通過・PC 幅 3 件は skip（iPhone の project のため）。--repeat-each=3 で 15 件通過。
- 検出力：同じ spec を前の版（origin/main を _local/742/main で配信・PORT=8177）で流すと、スマホ幅の 4 件（開く・閉じる・公開の通し・キーボード）が落ち、切り替えと PC の 3 件は通る＝新しい形の違いを捉えている。
- `npm run lint`：12 本中 0 本失敗。
- メモ：8143 は他の木のサーバが LISTEN していた（前の版の配信に使えなかった）。

## 5 ほかの画面に及んでいないことの確かめ（step3・HEAD 723970a）

| 何を | 結果 |
|---|---|
| 既存 spec（chromium と char-390/768/820/1024）：publish-panel・overlay-front・publish-article-editor・gate/j5-*・char/article・char/publish-hub・char/article-ops-count | 150 通過・0 失敗・128 skip（skip は spec 側の端末の選び分け） |
| 既存 spec（webkit＝iPhone 13・BACKNAV_WEBKIT=1）：overlay-front・back-nav-matrix（A27/A28 の公開パネルの戻る/×/Esc を含む） | 136 通過・0 失敗（4.3分） |
| gate/j5-*（gate-webkit・GATE_WEBKIT=1） | 8 通過・0 失敗 |
| `npm run lint`（全 lint:*） | 12 本中 0 本失敗 |
| `npm test` | 85 ファイル・1262 通過・0 失敗 |
| `check:version --range=origin/main..HEAD` | OK |
| 画像比較（`PORT=8742 node scripts/verify/visual-docker.mjs`・公式コンテナ v1.65.1-resolute・--update-snapshots なし） | 54 件とも通過＝差分 0（計画の「66枚」は数え違いで、テストは54件）。公開パネルは対象外なので、本棚トップ・ほかのシート・設定などに見た目の変化が無い根拠 |
| `npm run audit` | layout clip 70・overflow 30（=100）／buttons variants 8／image 0／a11y axe 6・input 2・placeholder 12・select 2（=22）。#713 時点（100・8・0・22）と同じ・上限以内 |

- 落ちた件が無いので、既存の spec の期待は直していない（意図した変化で落ちる件も無かった）。
- 768/820 幅は char の4幅で公開パネルを開く件も通った。形の変化（下から出る）は step5 の画像で「及ぶ画面」として見せる。

## 6 e2e-diff（step4・`node scripts/verify/e2e-diff-main.mjs --port=8142 --no-visual`）

- 流し方：systemd-run --user --unit=e2e-diff-742（--working-directory 付き）。17:00:37 開始・17:08:50 終了（exit 0）。--init-storage なし。画像比較は step3 で公式コンテナで別に流した（54件差分0）ので --no-visual。
- base：origin/main b9d95ec。work：HEAD 868c0c8。
- E2E：base 1215 通過・0 失敗・592 skip／work 1223 通過・0 失敗・592 skip（+8 は新 spec art-publish-sheet の chromium 8件）。flaky 0。除外は CI と同じ sort-perf-budget だけ。
- Vitest：base・work とも失敗 0。

| 表 | E2E | Unit |
|---|---|---|
| work だけ落ちる（新しく落ちた） | 0 件 | 0 件 |
| main だけ落ちる（新しく通った） | 0 件 | 0 件 |
| 両方落ちる（既存の問題） | 0 件 | 0 件 |

- 判定不能 0 件。合格（work だけ落ちる 0 件）。
- 結果一式は `_local/742/e2e-diff/`（report.md・report.json・base/work の json）。

## 7 ハヘロ向けの前後の画像（step5）

- 頁：`~/kuroko/_vault-work/742/hahero/公開パネル20261122/index.html`（ダッシュボード https://homelab.tail83cfaa.ts.net:8444/bookshelf/4/3/公開パネル20261122/ ・頁と画像は curl で 200）。
- 撮り方：新 spec と同じ setup（ハブの模擬・新しい記事「最近読んだ本」→本棚ブロックに本1冊→公開パネル）を一時 spec（`_local/742/shots.spec.js.txt`）で通し、等倍で撮った。前＝origin/main b9d95ec の展開（`_local/742/main`・PORT 8177）、後＝作業ツリー（PORT 8142）。#733 の足場は使わず、E2E と同じ操作の経路で撮った（同じ終わりの状態）。
- 数値（パネルの top〜bottom・高さ）：390 今 0〜844（844・ボタンの下端 534）→新 294〜844（550）・公開後 194〜844（650）・キーボード中 0〜844／768 今 0〜1024→新 494〜1024（530）／1280 今も新も 126〜674（548）・left 280・right 1000。
- 上の暗い所で閉じても、入れたタグ（「小説」）は開き直すと残っていた。
- 撮って見つけた直し（commit c578db5）：キーボード中に全画面へ広げた時、本文（grid）の行が縦に引き伸ばされて「公開前チェック」の枠が大きくなっていた → `[data-ov-scroll]` に `align-content: start`。直した後に新 spec を chromium 8件・webkit 5件で流し直して通過・check:version OK。
