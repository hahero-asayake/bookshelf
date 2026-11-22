# イシュー#752 の記録（スマホで吹き出しの下端が下のナビに隠れる）

## §1 前の実測（起点＝origin/main 57a59d2・step1）

### 測り方

- 起点は origin/main 57a59d2 です。#749 の直し（9246d98）と記録（57a59d2）を含みます。19:17 に fetch した時点で、57a59d2 の後に「Issue: #749」の commit はありませんでした。`_placeAnchoredMenu` は #749 の版のままです。
- 測るための spec は一時の物で、commit していません。置き場は `_vault-work/752/harness/tmp-752-measure.spec.js` です。
  - 一括の場面の起動は、#749 の tmp-749-measure.spec.js の boot（見本 tests/fixtures/shelves-path.json・local）と同じです。
  - 記事エディタの場面の起動は、ハブの模擬（gate-hub の seed・mock・boot）で行いました。local では「新しい記事」（#art-new）が disabled で押せないためです。
  - spec は流す時だけ tests/e2e/ に写し、流した後は外しました。
- 構成は3つです。
  - スマホ 390×844（iPhone の UA・touch）の chromium
  - スマホ 390×844 の webkit（BACKNAV_WEBKIT=1）
  - PC 1280×800 の chromium
- 「最後の行に当たるか」は、最後の行の中心で elementFromPoint を取って見ました。「押せるか」は、Playwright の `click({ trial: true })`（受け取りの検査だけをする）で見ました。
- 生の数字と画像は `_vault-work/752/measure/before/<構成>/` にあります（measure.json と png）。

### 一括の「本棚に追加」(#bulk-shelf-popover・js/bookshelf.js:1535)

| 構成 | 吹き出しの top / bottom | ボタンの bottom | 下のナビの top（inert） | 末尾まで送った最後の行の top / bottom | 最後の行の中心に当たる物 | trial click |
|---|---|---|---|---|---|---|
| スマホ390 chromium | 204 / **836** | 204 | **794**（いいえ） | 778 / 822 | **#mobile-bottom-nav** | **ナビの「本棚」ボタンが受け取る（押せない）** |
| スマホ390 webkit | 439 / **836** | 439 | **794**（いいえ） | 778 / 822 | **#mobile-bottom-nav** | **ナビが受け取る（押せない）** |
| PC1280 chromium | 169 / 489 | 169 | 箱なし（display:none） | 431 / 475 | 最後の行 | ok |

- スマホでは、吹き出しの下端がナビの上端より **42px** 下にあります（836 − 794）。末尾まで送っても、最後の行（778〜822）の下の28pxがナビの下に入ります。中心（800）はナビに当たり、押せません。#749 の記録と同じ値です。
- 吹き出しの max-height は、chromium で 632px、webkit で 397px です。どちらも、#749 の規則③（下の空きに詰める）で「画面の高さ − 8」まで伸びています。
- 「ボタンを画面の下寄りへ」の場面は作れませんでした。ボタンを scrollIntoView({block:'end'}) で下へ寄せようとしても、位置は変わりませんでした（top 168 のまま・一覧の上の段にあり、ページがそれ以上送れない）。

### 記事エディタの6か所（スマホ390 は編集モード・600px 以下なので #art-edit-bottom-bar が出る）

| # | メニュー（呼び出し） | 構成 | メニューの top / bottom（z） | 下の常設バー | 最後の行に当たる物 | 判定 |
|---|---|---|---|---|---|---|
| 7 | その他 #art-more-menu（article-editor.js:3374） | 390 chromium・webkit | 48 / 194（1300） | ナビ 794＝inert／記事のバー 787＝inert でない | 最後の行 | 隠れない |
| 7 | 同上 | PC1280 | 40 / 186（1300） | ナビ・記事のバーとも箱なし | 最後の行 | 隠れない |
| 3 | ブロックの⋯ #art-blk-menu（1153）・先頭のブロック | 390 両方 | 226 / 387（1300） | 同上（記事のバー 787） | 最後の行・trial ok | 隠れない |
| 3 | 同上・画面で一番下に見える⋯（8ブロック中の idx 7） | 390 両方 | 333 / 494（1300） | 同上 | 最後の行・trial ok | 隠れない |
| 3 | 同上（先頭・一番下） | PC1280 | 207 / 368・347 / 509（1300） | 箱なし | 最後の行・trial ok | 隠れない |
| 2 | 見出しメニュー .mde-heading-menu（bookshelf.js:6630・文章ブロックの全画面エディタ） | 390 両方 | 104 / 228（1300） | ナビ＝inert・記事のバー＝箱なし | 最後の行 | 隠れない |
| 2 | 同上 | PC1280 | 108 / 232 | 箱なし | 最後の行 | 隠れない |
| 6 | 引き出しの本棚の選択 #art-drawer-shelf-popover（2770） | 390 chromium | **922 / 993**（200）・画面の高さ 844 | ナビ＝inert・記事のバー＝箱なし（シートが開いている間） | #art-drawer | **画面の外**（下のバーのせいではない・下に書く） |
| 6 | 同上 | 390 webkit | **926 / 997** | 同上 | #art-drawer-list・trial は時間切れ | 同上 |
| 6 | 同上 | PC1280 | 140 / 211 | 箱なし | 最後の行・trial ok | 隠れない |
| 4 | 吹き出し #art-item-tooltip（2237） | 3構成 | 開けなかった | - | - | 未測（下に書く） |
| 5 | ブロック追加 .art-add-menu（2436） | 3構成 | 開けなかった | - | - | 届かない（下に書く） |

- **#art-edit-bottom-bar に隠れたメニューは0件です。**
  - 編集モードのスマホでは、記事のバーは top 787 にあり、inert ではありません。ただし、測った #art-more-menu と #art-blk-menu は z 1300 で、バー（z 1050）より上に重なります。バーに隠れることはありません。
  - .mde-heading-menu も z 1300 です。しかも全画面エディタが開いている間は、記事のバーに箱がありません。
- 記事エディタが開いている間、#mobile-bottom-nav は inert でした（3構成とも）。計画の「inert の時は数えない」が実際に当たることを確かめました。
- #art-drawer-shelf-popover のスマホの「画面の外」は、#673 の別件です。
  - 狭い幅では、引き出しがシート .art-side として下から出ます。シートは transform（matrix(1,0,0,1,0,0)）を持ち、top は 415（webkit は 417）です。中の position:fixed の基準がシートになるため、_placeAnchoredMenu が画面の座標で書いた top（アンカーの下端 506）に、シートの上端の分が足されて 922 に出ます。
  - 下の常設バーを見る直しでは救えません。**直さず、候補として残します。**
- #art-blk-menu を記事のバーの近くで開く場面は作れませんでした。キャンバスの中を下へ送ろうとしましたが、送れていません。8ブロックで、画面で一番下に見える⋯は top 305 でした。仮にバーの近くで開いても z 1300 なのでバーの上に重なり、隠れません。
- #art-item-tooltip は、本棚ブロックの中身の行の短/長トグル（.art-item-show-toggle）に出ます。足した直後の本棚ブロックには本が無く、トグルが出ないので開けませんでした。z は 30 でバーより下ですが、トグルは引き出しのシートの中にあります。シートが開いている間は記事のバーに箱が無いので、今の画面ではバーに隠れる組み合わせになりません。
- .art-add-menu は、入口のボタン（#art-blocks .art-add-btn）が0個でした。#673 と同じで、今の画面からは届きません。

### 判定

- **隠れている物は、一括の「本棚に追加」のスマホ（chromium・webkit）の1か所だけです。** 原因は、吹き出しの下端がナビ（top 794・inert でない）より 42px 下にあることです。
- step2 の直し（ナビの上端を下限にして、8px 空ける）で救えます。数字の見込みは次のとおりです。
  - chromium：下に詰めて max-height 582 → bottom 786
  - webkit：max-height 347 → bottom 786
- 記事エディタで #art-edit-bottom-bar に隠れる物は見つかりませんでした。②の申し送り（「隠れる物が見つかった時だけ直す範囲に入れる」）に従い、step2 では **#art-edit-bottom-bar に印を付けず、tests/e2e/anchored-menu-floor.spec.js も足しません**。印を付けるのは #mobile-bottom-nav だけです。記事エディタのメニューの位置は変わりません（記事エディタを開いている間、ナビは inert なので数えない）。
- 直さない候補：
  - 引き出しの本棚の選択（#art-drawer-shelf-popover）が、スマホでシートの transform のため画面の外に出る件（#673 の別件・今回の直しでは救えない）

## §2 直し（step2）と後の実測

### 直し（c8a8b23）

- `js/bookshelf.js` の `_placeAnchoredMenu` を次のように直した。
  - 下限 floor を決める。画面の高さと、`[data-anchored-floor]` のバーの top のうち小さい方を使う。
  - バーを数えないのは3つの時：inert の中にある時、getClientRects が空か高さが 0 の時、visibility が visible でない時。
  - 下の空きは floor − アンカーの下端で測る。
  - 挟む時の下限も floor − 高さ − 8 にする。
  - 中をスクロールできる物を詰める時は、下が 120px 以上なら下へ詰める（#749 のまま）。下が足りず上が 120px 以上なら、上へ詰めて is-up にする（今回足した）。詰めた値には、#749 の data-anchored-fit の印を付ける。
- `index.html`：
  - `#mobile-bottom-nav` に `data-anchored-floor` を付けた。
  - js/bookshelf.js の `?v=` を 2026112249 から 2026112252 に上げた。check:version は OK。
- **計画からの変更：`#art-edit-bottom-bar` には印を付けていない。**
  - 理由：§1 で、記事のバーに隠れるメニューが0件だった。測った記事エディタのメニューは z 1300 で、バー（z 1050）より上に重なる。
  - ②の申し送り「隠れる物が見つかった時だけ直す範囲に入れる」に従った。
  - 結果として、記事エディタの中ではメニューの位置は何も変わらない。記事エディタの間はナビが inert なので、ナビも数えない。
- `docs/ui-standards.md` §2-12：下の常設バーの1行と、変更履歴の1行を足した。
- `tests/e2e/shelf-path-label.spec.js`：H2 と「(f) 切り替え off：一括」で使う `expectBulkPopoverInView` に、次の assert を足した。
  - ナビに箱がある時は、吹き出しの下端 ≤ ナビの上端 − 8。
  - H2 では、一覧を末尾まで送り、最後の行に `click({ trial: true })` をかける。force なしで受け取りの検査をし、押した後の処理は走らせない（押すと吹き出しが閉じ、続く H4 の操作ができなくなるため）。
  - 直す前の版（191fd91）では、スマホ390 の2件（H2・off）が赤だった（下端 836 > 786）。PC の2件は緑だった。
  - 直した後は、chromium 12件・webkit（BACKNAV_WEBKIT=1）12件がすべて緑だった。

### 後の実測（同じ足場・`_vault-work/752/measure/after/`）

| 場面 | 構成 | 前：top / bottom（max-height） | 後：top / bottom（max-height） | 下限（ナビの top） | 末尾の最後の行（後） | 当たる物・trial（後） |
|---|---|---|---|---|---|---|
| 一括の本棚に追加 | 390 chromium | 204 / 836（632） | **204 / 786（582）** | 794 | 728 / 772 | 最後の行・ok（前はナビ・押せない） |
| 一括の本棚に追加 | 390 webkit | 439 / 836（397） | **439 / 786（347）** | 794 | 728 / 772 | 最後の行・ok（前はナビ・押せない） |
| 一括の本棚に追加 | PC1280 | 169 / 489（320） | 169 / 489（320） | 箱なし | 431 / 475 | 最後の行・ok（変化なし） |
| その他 #art-more-menu | 390 両方・PC | 48 / 194・40 / 186 | 同じ | ナビ＝inert（数えない） | - | 最後の行（変化なし） |
| ブロックの⋯ #art-blk-menu（先頭・一番下） | 390 両方・PC | 226 / 387・333 / 494・207 / 368・347 / 509 | 同じ | ナビ＝inert | - | 最後の行・ok（変化なし） |
| 見出しメニュー .mde-heading-menu | 390 両方・PC | 104 / 228・108 / 232 | 同じ | ナビ＝inert | - | 最後の行（変化なし） |
| 引き出しの本棚の選択 #art-drawer-shelf-popover | 390 chromium・webkit | 922 / 993・926 / 997（画面の外） | 同じ（直していない・#673 の別件） | ナビ＝inert | - | 前と同じ |
| 引き出しの本棚の選択 | PC1280 | 140 / 211 | 同じ | 箱なし | - | 最後の行・ok |
| 吹き出し #art-item-tooltip・ブロック追加 .art-add-menu | 3構成 | 開けない（§1） | 開けない | - | - | - |

- スマホの一括の吹き出しは、下端がナビの上端の 8px 上（786）で止まった。末尾まで送った最後の行（728〜772）は、中心が最後の行に当たり、force なしで押せる。
- PC と記事エディタの場面は、前と後で座標が1px も変わっていない。

### 検査と関連 E2E

- npm run lint：12本中0本失敗。npm test：1289件緑（86ファイル）。check:version --range=origin/main..HEAD：OK。
- 関連 E2E を chromium で流した。対象は14本：shelf-path-label・book-detail-shelf-add・library-count-refresh・gate/j3-2-create-shelf・char/settings-shelves-nav・art-canvas-tap-edit・exclude-custom-shelf・article-pc-pane・mde-toolbar-icons・publish-panel・status-bar-over-faces・standard-ops・back-nav-matrix・publish-article-editor（project の指定なし）。
  - 結果は 404件緑・210件 skip（char の他の幅）・赤0（3.2分）。ログは `_vault-work/752/related-e2e.log`。
- webkit（BACKNAV_WEBKIT=1）では shelf-path-label を流した。12件すべて緑。

## §3 e2e-diff と前後の画像（step3）

### e2e-diff

- 流し方：`systemd-run --user --unit=e2e-diff-752 --working-directory=/home/kuroko/worktrees/bookshelf/issue-752 --setenv=PATH=<node の bin>:/usr/bin:/bin <node> scripts/verify/e2e-diff-main.mjs --port=8752 --out=_vault-work/752/e2e-diff/out`（--init-storage なし）。
  - 19:34 に始めて 19:42 に終わった（約8分）。
  - 作業ツリーはきれい（未 commit の差分なし・tests/ に一時ファイルなし）。
- 比べた版：base＝origin/main 57a59d2、work＝4d2c078。
- E2E：
  - base 1247件緑・work 1247件緑。どちらも赤0・skip 592。
  - 新しく落ちた物0・新しく通った物0・両方で落ちた物0。除外したのは sort-perf-budget の1件で、CI と同じ。
- Unit：base・work とも 1289件緑・赤0。
- 画像比較（visual・公式コンテナ）：54件中0件が差分。基準画像は撮り直していない。

### 前後の画像

- 足場：`_vault-work/752/harness/shoot.mjs`（#749 の shoot.mjs を写した）。
- 版の出し方：前＝57a59d2、後＝c8a8b23。それぞれを git archive で `_vault-work/752/snap/` に出し、python の http.server（127.0.0.1:8152）で配信した。外への通信は route で止めた。
- 見本と操作：見本は tests/fixtures/shelves-path.json。操作は、すべての本 → 複数選択 → 1冊選ぶ → 本棚に追加。
- 撮った物：開いた所と、一覧の末尾まで送った所。構成は chromium のスマホ390・PC1280 と、webkit（iPhone の UA）のスマホ390 で、それぞれ前後。

| 構成 | 前：吹き出しの top / bottom | 後：top / bottom | ナビの top | 末尾の最後の行（前 → 後） | 最後の行の中心に当たる物（前 → 後） |
|---|---|---|---|---|---|
| スマホ390 chromium | 204 / 836 | 204 / 786 | 794 | 778〜822 → 728〜772 | ナビ → 最後の行 |
| スマホ390 webkit | 498 / 836 | 439 / 786 | 794 | 778〜822 → 728〜772 | ナビ → 最後の行 |
| PC1280 chromium | 169 / 489 | 169 / 489 | 箱なし | 431〜475（同じ） | 最後の行（同じ） |

- webkit の前の top（498）が後（439）と違う理由：前の版の画面には、上に「新しいバージョンがあります」の帯が出て、ボタンが下がっていた（Service Worker の版の違い・今回の直しとは関係ない）。
- ハヘロ向けの頁：`_vault-work/752/hahero/吹き出しと下のナビ前後20261122/index.html`
