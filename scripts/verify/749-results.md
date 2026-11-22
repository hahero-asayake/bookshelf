# イシュー#749 の記録（一括「本棚に追加」の吹き出しが画面の外へ出る）

## §1 原因の実測（前＝origin/main e2c920b・step1）

- 測り方：一時の spec（commit しない・`_vault-work/749/harness/tmp-749-measure.spec.js`）を chromium で流した。見本は tests/fixtures/shelves-path.json（#743 の写し）。起動は shelf-path-label.spec.js の boot と同じ。スマホは 390×844（iPhone の UA・touch）、PC は 1280×800。生の数字と画像は `_vault-work/749/measure/`。
- 場面：「すべての本」で複数選択 → 1冊選ぶ → 「本棚に追加」。

### H2（一括の吹き出し）の数字

| 場面 | 吹き出しの left / right / 幅 | 見出し「追加先の本棚」の left | 行 | 行の最大 scrollWidth | T1 で省いた行 |
|---|---|---|---|---|---|
| スマホ390・パスあり | **-172 / 350 / 522** | -158 | 14 | 436 | 0 |
| スマホ390・切り替え off | -16 / 194 / 210 | -2 | （.shelf-path なし） | - | - |
| PC1280・パスあり | 129 / 651 / 522 | 142 | 14 | 436 | 0 |
| PC1280・切り替え off | 285 / 495 / 210 | 298 | - | - | - |

- computed：position:absolute・left 61.7px（ホストの 50%）・transform translateX(-261px)（パスあり）/ translateX(-105px)（off）・min-width 210px・max-width none。ボタンは x=27・幅123（スマホ）。
- 見立てどおり：幅の上限が無く、nowrap のパスで箱が 522px まで広がる → 行ははみ出さない（scrollWidth ≤ clientWidth）ので T1 は1行も省かない → ボタンの真ん中から左右へ広げるので左へ 172px 出る。
- 切り替え off（前の形）でもスマホは左へ 16px 出ていた（見出しが -2px から始まる）。
- #bulk-bar の祖先に transform / filter / contain / will-change / backdrop-filter が付いた物は **0件**＝position:fixed の基準は画面のまま。step2 の直し方（fixed＋_placeAnchoredMenu）はそのまま使える。
- 縦：スマホの吹き出しは top 210・高さ 658（78vh）・bottom 868 で、画面の高さ 844 を超え、下のナビ（top 794）に 74px 隠れる。切り替え off でも同じ＝前からの物（直さない・候補）。

### 同じ種類の洗い出し（.shelf-path ごとに画面の中か・収まっているか）

| 場面 | スマホ390 | PC1280 |
|---|---|---|
| M4・M5 ホームのカード・冊数 | 16行・崩れ0 | 16行・崩れ0 |
| M2 パレット（2026 / SF） | 17・18行・崩れ0 | 17・18行・崩れ0 |
| M3 題の下の行（s18） | 1行・崩れ0 | 1行・崩れ0 |
| M1 チップ | 4行・崩れ0 | 4行・崩れ0 |
| H8 子孫の選択 | 6行・崩れ0 | 6行・崩れ0 |

- 機械の判定で「崩れ」と出た物は、どれも祖先の箱が全画面の面（#command-palette・#app-detail・#descendants-pick-modal＝left 0・right 画面幅）だった。吹き出しではないので、8px の余白の判定は当たらない（誤検知）。行はどれも画面の中で、scrollWidth ≤ clientWidth+1。
- **崩れているのは H2 だけ**。
- H8：最後の行の下端とボタンの上端の間が 0px（スマホ・PC とも）。#746 の前の画像（pb/H8）でも同じく接している＝前からの物（直さない・候補）。

### 測るだけの物（#746 と無関係・直さない）

| 吹き出し | スマホ390 left / right | PC1280 left / right |
|---|---|---|
| 検索 #search-popover | 103 / 383（右の余白 7px） | 669 / 949 |
| 絞り込み #filter-popover | 36 / 296 | 601 / 861 |
| 表示 #display-popover | 73 / 333 | 638 / 898 |

- どれも画面の中。検索だけスマホで右の余白が 7px（8px に 1px 足りない）。

## §2 直し（step2）

- css：`.popover.popover-bulk-shelf { position: fixed; left: auto; top: auto; transform: none; max-width: min(360px, calc(100vw - 16px)); }`（先例 `.popover.art-drawer-shelf-popover`）。min-width・max-height・overflow は変えていない。
- js `_placeAnchoredMenu`（共通の口）：
  - 横：画面の幅 − 16px より広いメニューは、その幅（inline の max-width）に詰めてから置く。
  - 縦（計画に足した物）：上下どちらにも入らず、中をスクロールできるメニューは、下の空きに高さを詰めてアンカーの下に出す。詰めないと、スマホでは高さ 658（78vh）の吹き出しが下端で挟まれて top 178 になり、ボタン（下端 204）を 26px 覆った。スクロールしないメニューは今までどおり。
  - inline の値は、ここで詰めた時だけ印（`data-anchored-fit`）を付け、次に呼んだ時にその印の物だけ戻す（他が書いた inline は触らない）。
- js 一括：開く時と、T1 の後（rAF）に `_placeBulkShelfPopover()`（中で `_placeAnchoredMenu` を呼ぶだけ・開いていなければ何もしない）。開いている間は window の resize と外側のスクロール（capture・passive・吹き出しの中は除く・rAF でまとめる）で置き直す。
- 見た目の変化：ボタンと吹き出しの間の 6px の隙間は無くなる（記事エディタの本棚の選択と同じ）。切り替え off の時の幅は 210 → 237px（fixed になって、名前が折り返さずに収まる幅になった）。

### 直した後の数字（chromium・step1 と同じ測り方・`_vault-work/749/measure-after/`）

| 場面 | left / right / 幅 | top / bottom（ボタンの下端） | 見出しの left | T1 で省いた行 | はみ出した行 |
|---|---|---|---|---|---|
| スマホ390・パスあり | 8 / 367 / 359 | 204 / 836（204） | 22 | 1（s18） | 0 |
| スマホ390・切り替え off | 8 / 245 / 237 | 204 / 836（204） | 22 | - | 0 |
| PC1280・パスあり | 210 / 569 / 359 | 169 / 489（169） | 224 | 1 | 0 |
| PC1280・切り替え off | 271 / 508 / 237 | 169 / 489（169） | 285 | - | 0 |

- スマホの下端 836 は、下のナビ（top 794）にまだ 42px 隠れる（前は 74px＋画面の外）。ナビを見ていないのは前からの物＝直していない（step3 の tp で候補として出す）。

### E2E と検査

- tests/e2e/shelf-path-label.spec.js：H2 に「吹き出しが画面の内側（左右 8px 以上）・ボタンを覆わずその下・画面の下端を越えない・見出しが画面の中・各行が収まり吹き出しの中・スマホは s18 が T1」を足した。切り替え off の一括の吹き出しのテストを1つ足した。T1 は次のフレームで効くので、行の fits は expect.poll で待つ形にした。
- 直す前の版で：スマホ390 の H2 と off の2件が赤（矩形の assert）。PC は前も画面の中だったので緑。
- 直した版で：shelf-path-label chromium 12件緑・webkit（BACKNAV_WEBKIT=1）12件緑。
- 関係する spec（一括の吹き出し：book-detail-shelf-add・library-count-refresh・gate/j3-2-create-shelf・char/settings-shelves-nav ／ `_placeAnchoredMenu` を使う記事エディタ：art-canvas-tap-edit・exclude-custom-shelf・article-pc-pane・mde-toolbar-icons・publish-panel・status-bar-over-faces・standard-ops）：155件緑・210件 skip（char の他の幅）・赤0。
- npm run lint：12本中0本失敗。npm test：1289件緑。
