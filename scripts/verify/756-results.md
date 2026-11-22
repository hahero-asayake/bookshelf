# イシュー#756 の記録（スマホの記事エディタで、引き出しの「本棚の選択」の吹き出しが画面の外に出る）

## §1 前の実測と同じ種類の洗い出し（起点＝origin/main af721b2・step1）

### 測り方

- 起点は origin/main af721b2 です。#752 の commit（191fd91・c8a8b23・4d2c078・af721b2）は、題で origin/main に入っていることを確かめました。
- 測るための spec は一時の物で、commit していません。置き場は `_vault-work/756/harness/tmp-756-measure.spec.js` です。webkit の project の testMatch に合わせ、流す時だけ `tests/e2e/tmp756-shelf-path-label.spec.js` という名前で写しました。
  - 起動はハブの模擬（gate-hub の seed・mock・boot）です。#752 の足場と同じです。
  - 起動の後、本棚を10個足しました（1つは子の本棚）。吹き出しの項目は「すべて」を含めて11です。
- 構成は3つです。
  - スマホ 390×844（iPhone の UA・touch）の chromium
  - スマホ 390×844 の webkit（BACKNAV_WEBKIT=1）
  - PC 1280×800 の chromium
- 「押せるか」は、吹き出しの中だけを scrollTop で送ってから、各項目の中心で elementFromPoint を取って見ました。祖先は送っていません。
- 生の数字と画像は `_vault-work/756/measure/before/<構成>/` にあります（measure.json と png）。

### 引き出しの本棚の選択（#art-drawer-shelf-popover・article-editor.js:2770）

| 構成 | 吹き出しの top / bottom | style.top | ボタンの bottom | シートの top・transform | 画面の高さ | 項目の中心に当たる物（11項目） |
|---|---|---|---|---|---|---|
| 390 chromium | **922 / 1252** | 505.7px | 506 | 415・matrix(1, 0, 0, 1, 0, 0) | 844 | **11とも画面の外** |
| 390 webkit | **926 / 1254** | 507.7px | 508 | 417・matrix(1, 0, 0, 1, 0, 0) | 844 | **11とも画面の外** |
| PC1280 chromium | 140 / 620 | 139.75px | 140 | 61・none | 800 | 11とも項目 |

- スマホの top は「style.top ＋ シートの top」です（505.7 ＋ 415 ≒ 922、507.7 ＋ 417 ≒ 926）。#752 の §1 の値（922・926）と同じでした。
  - 開いたシートの transform は none ではありません。そのため、中の fixed の吹き出しの位置の基準がシートになっています。
- **Playwright の `click({ trial: true })` は、この不具合を見つけられません。** chromium では11とも ok でした。webkit では11とも時間切れでした。
  - chromium で ok になったのは、Playwright が押す前に scrollIntoView をするからです。overflow:hidden のシートの中身ごと送るので、項目が画面に入ってしまいます。
  - 最初の測り方でも同じことが起きました。項目に scrollIntoView を掛けて測ったところ、シートが 407px 送られ、11とも「押せる」と出ました。
  - 再発防止の spec では、trial click だけで判定しません。次の3つを見ます。
    - 押す前の吹き出しの rect
    - 吹き出しの中だけを送った時の elementFromPoint
    - シートの scrollTop が 0 のままであること

### 開く途中の押下（シートの transition 0.25s の途中）

| 構成 | 押した時のシートの transform | 押した時のボタンの bottom | transition の後のボタンの bottom | 後の吹き出しの top | ずれ（吹き出しの top − ボタンの bottom） |
|---|---|---|---|---|---|
| 390 chromium | translateY(407.5) | 913 | 506 | 746 | **240** |
| 390 webkit | translateY(366.2) | 874 | 508 | 748 | **240** |

- 押した時のアンカーの rect（滑っている途中の位置）で置くので、止まった後のボタンから離れます。
- B2 で基準が画面に戻っても、このずれは消えません。そのため step2 で、シートの transitionend で置き直す処理を足します（計画の判定基準の 2px を超えている）。

### 同じ種類の洗い出し（fixed の要素のうち、祖先に基準を作る物がある物）

- 全ての要素を走査しました。computed の position が fixed の要素について、祖先に次のどれかがあるかを見ました。
  - transform・translate・scale・rotate・filter・backdrop-filter・perspective
  - will-change（transform・perspective・filter）
  - contain（paint・layout・strict・content）
  - container-type

| 状態 | 構成 | 当たった数 | 当たった物 |
|---|---|---|---|
| (a) 記事エディタで、引き出しのシートを開いた所 | 390 chromium・webkit | 2 | #art-drawer-shelf-popover（基準 #art-drawer・ずれ 415 / 417・overflow hidden）、#bulk-shelf-popover（隠れている・下に書く） |
| (d) 記事エディタ | PC1280 | 1 | #bulk-shelf-popover（同上） |
| 本棚の画面（すべての本・#view-bookshelf を 300px 送った所） | 390 両方・PC1280 | **0** | - |
| (b) 左のドロワーを開いた所（body.drawer-open） | 390 両方 | 1 | #bulk-shelf-popover（同上） |
| (c) 本の詳細を開いた所（body.book-detail-pinned） | 390 両方 | 1 | #bulk-shelf-popover（同上） |

- #bulk-shelf-popover の基準は #view-bookshelf です。本棚の画面が隠れて横へ送られている間だけ、transform が matrix(1, 0, 0, 1, -390, 0) になります。
  - 本棚の画面が出ている間は transform が none で、当たりません。走査で0件でした。
  - 吹き出しを開けるのは本棚の画面が出ている時だけなので、実害はありません。#752 の実測でも、吹き出しの top はボタンの bottom（204）と一致していました。
- 左のドロワー（.app-sidebar）と本の詳細（.app-detail）の中に、fixed の要素はありません。開いた状態は translateX(0) ですが、当たりは0件です。

_placeAnchoredMenu の呼び出し7か所（行は af721b2）の結果は次のとおりです。

| 呼び出し | メニュー | 基準 | 判定 |
|---|---|---|---|
| js/bookshelf.js:1535 | #bulk-shelf-popover | 開ける時は画面（上記） | ずれない |
| js/bookshelf.js:6641 | .mde-heading-menu（開いた時に作る） | 走査の時は DOM に無い | #752 の実測で位置が一致（ずれない） |
| js/screens/article-editor.js:1153 | #art-blk-menu | 画面（(a)(d) とも当たり0） | ずれない |
| js/screens/article-editor.js:2237 | #art-item-tooltip | 画面（(a)(d) とも当たり0。シートの外の兄弟） | 位置はずれない。z 30 でシートの下に入る件は、開けなかったので**未確認** |
| js/screens/article-editor.js:2436 | .art-add-menu（テンプレートから作る） | 入口のボタンが0個で開けない | **未確認**（#752・#673 と同じ） |
| js/screens/article-editor.js:2770 | #art-drawer-shelf-popover | **#art-drawer（シート）** | **ずれる（本件）** |
| js/screens/article-editor.js:3374 | #art-more-menu | 画面（(a)(d) とも当たり0） | ずれない |

### 判定

- 基準がずれて画面の外に出るのは、#art-drawer-shelf-popover のスマホ（chromium・webkit）の1か所だけです。
- 他に同じ仕組みで直す所はありません。左のドロワーと本の詳細の translateX(0) も、中に fixed の要素が無いので直しません。
- step2 の直しは次の3つです。
  - B2：`.art-side.is-open { transform: none; }`
  - シートの transitionend（transform）で、吹き出しが開いていれば置き直す
  - 再発防止の spec を足す（trial click だけに頼らない）

## §2 直し（step2）と後の実測

### 直し

- `css/bookshelf.css`（900px 以下）の `.art-side.is-open { transform: translateY(0); }` を `transform: none` にしました。
  - 開閉の動きは translateY(100%)⇄none の補間なので、見た目は同じです。
  - z・DOM の場所・inert・Tab の順・外側クリックは触っていません。
- `js/screens/article-editor.js` の `_artSetupDrawerShelfPicker` に、置き直しの処理を足しました。
  - #art-drawer の transitionend（propertyName が transform）の時に、吹き出しが開いていてシートが is-open なら `_placeAnchoredMenu(btn, pop)` で置き直します。
  - 吹き出しが閉じている時と、シートを閉じる transition の時は何もしません。
- `index.html`：`css/bookshelf.css` と `js/screens/article-editor.js` の `?v=` を 2026112256 にしました。
- `docs/ui-standards.md` §2-12：「開閉に transform を使う面」の行と、更新履歴の1行を足しました。
- `playwright.config.js`：新しい spec を webkit の2つの project に足しました。
  - BACKNAV_WEBKIT の webkit と、GATE_WEBKIT の gate-webkit（CI の webkit レグ）です。

### 再発防止の spec（tests/e2e/art-drawer-shelf-popover-sheet.spec.js・4件）

1. スマホ390：次の判定は expect.soft で並べ、どれが赤を出すかを全部見えるようにしています。
   - 開いたシートの transform が none
   - 吹き出しの rect が画面の中
   - 吹き出しがボタンに付いている
   - 吹き出しの中だけを送った時、11項目の中心の elementFromPoint がその項目
   - シートの scrollTop が 0
   - 補助として trial click、最後に実際に押して本棚が変わるか
2. スマホ390：シートの開く途中（openArtSheetInternal の直後で、transform が none でない時）に押しても、止まった後に吹き出しがボタンに付き、画面の中に出る。
3. スマホ390：吹き出しが閉じている時は、シートを閉じる transition と開く transition の後も、吹き出しは hidden のままで、style の top・left・max-height が変わらない（置き直しが動かない）。
4. PC1280（chromium だけ）：吹き出しがボタンに付き、画面の中に出て、全項目の中心がその項目に当たる。

| 版 | chromium | webkit（BACKNAV_WEBKIT=1） | gate-webkit（GATE_WEBKIT=1） |
|---|---|---|---|
| 直す前（af721b2） | 1・2 が赤、3・4 が緑 | 1・2 が赤、3 が緑、4 は skip | - |
| CSS だけ直した版（JS の置き直しなし） | 2 が赤（-g で 2 だけ流した） | - | - |
| 直した後 | 4 件とも緑 | 3 件緑・1 skip | 3 件緑・1 skip |

- 直す前の 1 で赤になった判定は、chromium・webkit とも同じ4つでした（trial click の代わりの判定が、実際に赤を出しています）。
  - transform が matrix(1, 0, 0, 1, 0, 0)
  - bottom 1252（webkit 1254）が画面の高さ 844 を超える
  - ボタンに付いていない（top 922・926 に対し、ボタンの bottom は 506・508）
  - 11項目の elementFromPoint がすべて false
- シートの scrollTop は直す前も 0 でした（赤にならない）。この判定は、trial click の時に Playwright が中身を送った場合を捕まえるためのものです。

### 後の実測（step1 と同じ足場・`_vault-work/756/measure/after/`）

| 構成 | 前：吹き出しの top / bottom | 後：吹き出しの top / bottom | ボタンの bottom | シートの transform | 11項目の中心に当たる物（後） |
|---|---|---|---|---|---|
| 390 chromium | 922 / 1252 | **506 / 836** | 506 | none | 11 とも項目 |
| 390 webkit | 926 / 1254 | **508 / 836** | 508 | none | 11 とも項目 |
| PC1280 chromium | 140 / 620 | 140 / 620（変化なし） | 140 | none | 11 とも項目 |

- 開く途中の押下：後は、止まった後の吹き出しの top がボタンの bottom と一致しました（ずれ 0）。前は 240 でした。
- 洗い出しの走査：後は (a) の #art-drawer-shelf-popover が消え、#bulk-shelf-popover（本棚の画面が隠れている間だけ）の1件だけになりました。

### 検査と関連 E2E

- npm run lint：初回は 12本中1本失敗（lint:internal-refs）でした。新しい spec に `bookshelf._` が7件あり、上限82に対して89件になったためです。
  - helpers/art-editor.js の setArtBlocks・openArtSheetInternal・closeArtSheetInternal に置き換えて、82件（上限以内）にしました。
- npm test：86ファイル・1289件緑。
- check:version --range=origin/main..HEAD：OK。
- npm run audit:layout：OK（上限以内・tests/audit/findings/layout.json の変更なし）。
- 関連 E2E（chromium・project の指定なし）：314件緑・赤0（3.2分）。
  - 流した spec：publish-article-editor・exclude-custom-shelf・art-canvas-tap-edit・article-pc-pane・back-nav-matrix・status-bar-over-faces・shelf-path-label・art-publish-sheet・新しい spec
  - anchored-menu-floor.spec.js は #752 で足されていないので、流していない。
- webkit（BACKNAV_WEBKIT=1）：back-nav-matrix・art-canvas-tap-edit・art-publish-sheet・新しい spec を流し、140件緑・9 skip・赤0（4.8分）。
  - 1回目は chromium の実行と同じ PORT のサーバーを借りていた。chromium が先に終わってサーバーが落ち、92件が Connection refused になったので、単独で流し直した。

## §3 e2e-diff と前後の画像（step3）

### e2e-diff（scripts/verify/e2e-diff-main.mjs・systemd-run・PORT 8156）

- base は origin/main af721b2、work は 24fe3b0 です。結果一式は `_vault-work/756/e2e-diff/`（report.md・各 json）にあります。
- E2E：
  - base は 1247件緑・592 skip・赤0、work は 1251件緑・592 skip・赤0 でした。
  - work が4件多いのは、新しい spec の chromium 4件です。
  - 新しく落ちた物・新しく通った物・両方で落ちた物は、いずれも0件でした。
- vitest：base・work とも 1289件緑・2 todo・赤0 で、3表とも0件でした。
- 画像の比較（visual・work 側だけ）：54件中、差分ありは0件でした。

### 前後の画像

- 撮り方：本棚の選択のボタンを、JS の click で押して（祖先を送らない押し方）、0.5秒後に撮りました。
  - 前の版は、作業ツリーに `git checkout HEAD~1 -- css/bookshelf.css js/screens/article-editor.js index.html` で一時的に戻して撮りました。撮った後は HEAD に戻しています。
  - 撮る台本は `_vault-work/756/harness/shoot756.spec.js` です（commit しない）。
  - 置き場は `_vault-work/756/measure/{before,after}/<構成>/0-popover-open.png` です。
- 前（390 chromium・webkit）：シートの中に一覧が出ず、何も起きていないように見えます。
- 後（390 chromium・webkit）：ボタンのすぐ下に一覧が出ます。
- PC1280：前後とも同じで、画像のバイト数も同じでした。
- ハヘロ向けの頁は `_vault-work/756/hahero/前後20261122/index.html` です（画像は img/ に6枚）。
- §1・§2 の実測の時の png（`1-drawer-shelf-popover.png`）は、trial click で Playwright がシートの中身を送った後に撮っています。見た目の比較には使わないでください。
