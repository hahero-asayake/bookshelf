# イシュー#673 結果：アンカー付きメニュー（_placeAnchoredMenu）と保存の失敗・未保存の帯

## §1 着手確認・同種の洗い出し・直す前の実測（step1・2026-11-14）

### 1-0 着手確認

- #671 は main に入っている（題で確認・`git log origin/main --grep='#671'`）：3e06338 test（赤のまま）・eceadfb fix（印 data-ov-below-notice）・63e38de / d0a3552 docs・201da60 chore。
- #671 の最終の名前は計画と同じ（違いなし）。
  - 帯の高さ：`--status-urgent-h`（`_syncStatusUrgent` が documentElement に書く）。帯が出ている間は `body.has-status-urgent`。
  - 印：`data-ov-below-notice`（overlay-manager の open の `belowNotice`、既定は modal・sheet かつ layer≠false）。css は `body.has-status-urgent [data-ov-below-notice] { top: var(--status-urgent-h); bottom: 0; height: auto }`。
- worktree issue/673 を origin/main 33eda9e へ早送りして実測した。

### 1-1 同種の洗い出し（origin/main 33eda9e）

| 場所 | メニュー | 項目 | z | 今回の実測 |
|---|---|---|---|---|
| js/bookshelf.js:6202 | `_placeAnchoredMenu` の定義（margin 8・上向きは `spaceAbove = anchorRect.top`・帯を見ない） | - | - | - |
| js/bookshelf.js:6424 | 見出しメニュー .mde-heading-menu | 3 | 1300 | 測っていない（アンカーは編集欄の上のツールバー＝下向き） |
| js/screens/article-editor.js:1149 | ブロックの⋯ #art-blk-menu | 4（編集・上へ・下へ・削除） | 未実測 | 測っていない。4項目で、同じ作りの #art-more-menu（4項目）は 146px |
| js/screens/article-editor.js:2233 | 短文メモ・評価の吹き出し .art-item-tooltip | 文2行 | - | 測っていない（小さい） |
| js/screens/article-editor.js:2432 | ブロックの追加 .art-add-menu | 3（index.html の #art-add-menu-tpl） | 20 | **開けない**：`#art-blocks .art-add-btn` が PC・狭幅とも見えない（今の追加の入口はキャンバスの＋と #art-add-sheet） |
| js/screens/article-editor.js:2766 | 引き出しの本棚の選択 #art-drawer-shelf-popover | 本棚の数（max-height 60vh） | 200 | 測った（下の表） |
| js/screens/article-editor.js:3370 | その他 #art-more-menu | 4 | 1300 | 測った（下の表） |
| js/screens/bookshelf-list.js:222 | 本棚ツリーの…（`_openTreeNodeMenu`・_placeAnchoredMenu を使わない） | 1〜3 | - | 対象外：常にアンカーの下（r.bottom+4）に開き、上向きにならない |

- `getBoundingClientRect` の残り（js 全体で25か所）は、メニューの位置決めではない（キーボードの上のバー・iframe の中の差し込み線・計測など）。

### 1-2 実測（帯あり＝ハブへの書き込みを失敗させ「再試行」の行を出した状態・本棚24個）

- spec：`tests/e2e/status-bar-over-faces.spec.js` の「(f) アンカー付きメニューと帯 (イシュー#673)」（測るだけ・4件 passed）。
- 流し方：`GATE_WEBKIT=1 PORT=8173 npx playwright test tests/e2e/status-bar-over-faces.spec.js --project=chromium --project=gate-webkit --grep 673`。
- 入口は利用者と同じ：記事一覧→新規→編集→キャンバスの＋→本棚ブロック（引き出しが開く）→各ボタン。押せない時だけネイティブの click で呼んで測りを続け、押せなかったことを記録した（1-4）。
- 値は chromium と gate-webkit（iPhone 13 の UA）で同じ（差は 1〜2px）。下の表は chromium の値。

| 幅 | メニュー | アンカー top–bottom | メニュー top–bottom（高さ） | 向き | 帯の下端（--status-urgent-h） | 最初の項目の中心 | 帯と重なるか |
|---|---|---|---|---|---|---|---|
| 1280×800 | その他 #art-more-menu | 34–70 | 70–216（146） | 下 | 59（60px） | 項目 | 重ならない（ただしアンカー自体が帯の下＝1-4） |
| 1280×800 | 本棚の選択（24個） | 143–170 | 170–650（480＝60vh） | 下 | 59（60px） | 項目 | 重ならない |
| 390×664 | その他 #art-more-menu | 91–127 | 127–273（146） | 下 | 78（79px） | 項目 | 重ならない |
| 390×664 | 本棚の選択（24個・シートを開いた状態） | 299–326 | 計算 257.6 → 実際 494–892（398） | 上下とも入らない→クランプ | 78（79px） | 項目 | 重ならない（ただし位置が計算とずれる＝1-4） |

- 帯の高さの変数は、帯の実高を切り上げた値（78.x → 79px・59.x → 60px）。

### 1-3 判定：(a) 利用者の操作で届く位置では、帯と重ならない（直さずに終える提案）

- 上向きに開いたメニューが帯に重なるのは、メニューの高さ h が (画面の高さ − アンカーの高さ − 帯の高さ − 8) / 2 を超える時だけ。
  - 390×664・帯 78・アンカー 27〜36：約 271〜275px。1280×800・帯 59・アンカー 27〜36：約 349〜353px。
  - 帯が4行（約 150px）になっても、390×664 で約 235px。
- 上向きに開きうるメニュー（アンカーが画面の下の方に来る）は、どれもこれより低い。
  - ⋯ #art-blk-menu は4項目（同じ作りの #art-more-menu が 146px）。
  - .art-add-menu は3項目で、今の画面ではボタンが見えず開けない。
  - 吹き出しは小さい。
- 高いメニューは本棚の選択（60vh＝398 / 480px）だけ。ただしアンカーは引き出しの見出しにある（PC は y=143、狭幅はシートを開くと y=299）ので、上向きには開かない。PC は下向き、狭幅は上にも下にも入らずクランプになった。
- 帯の下端より上に来たメニューは0件（4ブラウザ・幅の組み合わせ×開けたメニュー全部）。最初の項目の中心は、すべて項目に当たった。
- (c)（帯と画面の下端の間に収まらないほど高いメニュー）にも当たらない：本棚の選択の 60vh（398 / 480px）は、画面の高さ − 帯の高さ − 16（570 / 725px）より低い。
- **残る弱さ（直していない）**：`_placeAnchoredMenu` が帯を見ないこと自体は変わらない。上の閾値を超えるメニューを画面の下に足した時に初めて重なる。

### 1-4 範囲外の発見（別件の候補・②の判断）

1. **PC 幅では、帯が記事エディタの見出しのボタンを覆う**（chromium・gate-webkit とも）。
   - 1280×800 で、「編集」#art-mode-edit・「その他」#art-more-btn の上端 34 が、帯の下端 59 より上にある。
   - Playwright の click は `<div data-sync-failure="network" class="status-row …">` が受け取って届かない（`… subtree intercepts pointer events`）。帯が出ている間は、PC 幅の記事エディタの見出し（公開・編集・その他）が押せない。
   - 画像：`tmp/673/chromium/pc-art-more-menu-before.png`（帯の下に見出しのボタンの下端だけが見える）。
   - #660/#671 の「帯の分だけ面を下げる」が、PC 幅の記事エディタに効いていない見込み（原因は未確認）。
2. **狭幅で、シートの中の本棚の選択が、計算した位置より下に出て切れる**（chromium・gate-webkit とも）。
   - 引き出しのシート .art-side は、開いている間も transform（translateY(0)）を持つので、中の position:fixed の基準が画面でなくシートになる。overflow は hidden。
   - `_placeAnchoredMenu` は画面の座標で top=257.6 を書くが、実際の上端はシートの上端 235 の分だけ下の 494。下端は 892 で、画面（664）とシートの外になる。24個のうち見えるのは上の一部だけ。
   - 帯とは関係しないが、同じ `_placeAnchoredMenu` の「基準は画面」という前提が崩れる所。
- 計画どおり別件の候補：メニューを開いた後で帯が出入りすると、外枠の padding-top でアンカーだけが動いてずれる（今回は測っていない）。

### 1-5 画像（tmp は gitignore・worktree の中）

- `tmp/673/<chromium|gate-webkit>/<pc|narrow>-art-more-menu-before.png`（2回目の実測。3回目は本棚ブロックを置いた後で「その他」が見えなくなったので、測った値は2回目）
- `tmp/673/<chromium|gate-webkit>/<pc|narrow>-art-drawer-shelf-popover-before.png`（3回目＝狭幅はシートを開いた状態）
- 測った値の JSON：`tmp/673/<project>/measure-<pc|narrow>.json`（3回目）
