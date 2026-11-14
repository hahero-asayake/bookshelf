# イシュー#654 本のカードをタッチでドラッグした後、次の正しいタップが1回捨てられるか（実測）

測った版: origin/main 6a698df（2026-11-14 16:43 JST に fetch）。spec: `tests/e2e/book-card-tap-after-touch-drag.spec.js`。
端末: chromium（390×844・hasTouch・isMobile）と webkit（iPhone 13・`GATE_WEBKIT=1 --project=gate-webkit`）。本は3冊・すべての本・並びは custom（つまみが効く）。
記録: spec が場面ごとに `_local/654/probe-<browser>.jsonl` へ書く（ドラッグの終わりのイベント・タップのイベント・1回目/2回目で開いたか）。下の表は step2 の実行（17:00 JST）。

## 結論（step2）

- **本物のタッチで再現したか: 再現した（chromium の CDP）**。(c) 別の本の上で離す・(d) 行き先の無い所で離す・(e) pointercancel で終わる・(g) 長押ししてから動かす。どれもドラッグの終わりに click が出ず、印 `_suppressClick` が残った。ドラッグの後にカードへ届いた最初の click が捨てられた。webkit の本物のタッチは測れない（Playwright の WebKit にタッチを動かす口・長く押す口が無い）＝未測定。
- **直送の時だけ再現したもの**: (b) つまみを押してすぐ離す・(f) 長押し（pop 有り）・(f-星) 長押しの後の星のタップ。本物のタッチ（CDP）では、離した時に click が出て印がそこで消費されるので再現しない。直送では chromium・webkit とも再現した。
- **マウス**: chromium は再現した（別の本の上で離すと click が出ない→次のクリックが捨てられた）。webkit は再現しない（離した時に click@handle が出て印が消費された）。
- **再現しなかった**: (a) 普通のタップ（両ブラウザ）。
- **別に見つかったこと（このイシューの外）**: タッチでつまみを下へ 72px 以上運ぶと、一覧の先頭にいる時は「引っぱって更新」（js/bookshelf.js:5174-5223 `_initPullToRefresh`・`THRESHOLD = 72`・離して 350ms 後に `location.reload()`）が働き、ページが再読込される。step1 で (c)・(g) の本物のタッチが揺れたのはこのため。600ms 後にカードが別の要素になっていた（印ごと作り直し）ことを一時的な記録で確かめた。spec の (c)・(g) は、再読込で印の確かめが隠れないよう、2冊目を1冊目の上へ（横へ）運ぶ形に変えた。

## 場面ごとの表

「1回目」「2回目」はドラッグの後の本物のタップ（locator.tap 相当・click はブラウザが作る）。「捨てられた」＝click はカードに届いたのに詳細が開かなかった。

| 場面 | ブラウザ | 作り方 | ドラッグの終わりに click | 1回目のタップ | 2回目のタップ | 判定 |
|---|---|---|---|---|---|---|
| (a) 普通のタップ | chromium / webkit | 本物 | — | 開いた / 開いた | — | 再現しない |
| (b) つまみを押してすぐ離す | chromium | CDP | 出た（click@handle） | 開いた | — | 再現しない（印は click@handle で消費） |
| (b) | chromium / webkit | 直送 | 出ない | 捨てられた / 捨てられた | 開いた / 開いた | 直送の時だけ再現 |
| (c) 別の本の上で離す（横へ運ぶ） | chromium | CDP | 出ない | click が出ない | 捨てられた | **本物のタッチで再現** |
| (c) | chromium / webkit | 直送 | 出ない | 捨てられた / 捨てられた | 開いた / 開いた | 再現 |
| (d) 行き先の無い所で離す | chromium | CDP | 出ない | 捨てられた | 開いた | **本物のタッチで再現** |
| (d) | chromium / webkit | 直送 | 出ない | 捨てられた / 捨てられた | 開いた / 開いた | 再現 |
| (e) pointercancel で終わる | chromium | CDP | 出ない（pointercancel） | 捨てられた | 開いた | **本物のタッチで再現** |
| (e) | chromium / webkit | 直送 | 出ない | 捨てられた / 捨てられた | 開いた / 開いた | 再現 |
| (f) 長押し 600ms（pop 有り） | chromium | CDP | 出た（click@card・長押しの印で捨てる＝意図どおり） | 開いた | — | 再現しない |
| (f) | chromium / webkit | 直送（touchstart/touchend） | 出ない | 捨てられた / 捨てられた | 開いた / 開いた | 直送の時だけ再現 |
| (f-星) 長押しの後に pop の星 | chromium | CDP | — | 評価が変わった | — | 再現しない |
| (f-星) | chromium / webkit | 直送 | — | 評価が変わらない / 変わらない | — | 直送の時だけ再現 |
| (g) つまみを 550ms 長押ししてから動かす | chromium | CDP | 出ない | click が出ない | 捨てられた | **本物のタッチで再現** |
| (g) | chromium / webkit | 直送 | 出ない | 捨てられた / 捨てられた | 開いた / 開いた | 再現 |
| 対照: マウスで別の本の上へ | chromium | マウス | 出ない | 捨てられた | — | 再現 |
| 対照: マウスで別の本の上へ | webkit | マウス | 出た（click@handle） | 開いた | — | 再現しない |

- 「click が出ない」(CDP の (c)・(g)、step1 の (d)): CDP でドラッグした直後の1回目のタップで、ブラウザが click 自体を作らないことがある。600ms 置いても同じ。ブラウザのジェスチャの判定が残るためと見ている（原因未特定）。その場合も、カードに届いた最初の click（2回目のタップ）は捨てられた。
- webkit の余白のタップでは click が出た（本のカードに click リスナーがある＝#580 の穴には当たらない）。
- webkit では `new Touch()` が作れない（Illegal constructor）。長押しの口は `e.touches[0]` の座標しか読まないので、ふつうの Event に touches を持たせて送った。

## 根拠のコード（origin/main 6a698df）

- 印を付ける: js/bookshelf.js:2501（`_onBookPointerDown`。つまみの pointerdown の時点で付く）
- 印を外す: js/bookshelf.js:2447-2452（カードの click で1回だけ）。後始末 `_cancelBookPointerDrag` は外さない
- 長押しの口: js/bookshelf.js:4502（touchstart で外す。対象は `.card-hover-pop` を持つカードだけ。pop を出したカードの中のタップは手前の早期 return で外さない）・4508（450ms で付ける）
- 並べ替えは同じ要素を動かす: js/bookshelf.js:5353（`target.before(dragged)`）
- 引っぱって更新: js/bookshelf.js:5174-5223

## 直し方と検証（step3・commit d8223b3）

js/bookshelf.js の本のカードの印を、js/ui/reorder.js の口（イシュー#649・`CLICK_SWALLOW_MS = 400`）と同じ決まりにした。#649 は 17:03 JST の時点で main に入っていない。#649 の差分は js/ui/reorder.js だけで、js/bookshelf.js には無い（重なりなし）。
- 付ける: つまみのドラッグが終わった時（`_cancelBookPointerDrag`＝pointerup・pointercancel の後始末）。押した時点（旧 2501 行）では付けない。長押しで pop を出した時は今のまま付け、400ms は離した時（touchend・touchcancel）から数える。
- 捨てる: そのカードの click を1回だけ（今のまま）。
- 外す: 1回捨てた時・次の pointerdown（カードの capture）・400ms の一番早い時。
- 足したメソッド: `_armCardClickSwallow(el, released)`・`_startCardClickSwallowTimer(el)`・`_disarmCardClickSwallow(el)`。Esc・blur の経路は足していない（②の決め・'Escape' の数は変わらない）。
- E2E の CDP の場面は「ドラッグの後、カードに届いた最初の click で開く」を見る（タップは最大2回）。1回目で click が届いたのに開かなければ赤にする。直送とマウスは「1回目で開く」のまま（②の決め）。CDP で click 自体が出ない件の原因は未特定。

検証（17:05〜17:11 JST）:
- 新しい spec: chromium は16本すべて緑。webkit は9本緑・7本 skip（CDP の場面）。
- 変異検査（js/bookshelf.js だけ 76e7240 に戻す）: chromium は16本中12本赤、webkit は直送の7本が赤（緑は2本）。戻した後は修正後の版に戻した。
- 関連 E2E（chromium）: touch-reorder・book-detail-shelf-meta・list-staged-render・sort-perf-budget・sort-persist の46本がすべて緑。
- `npm test`: 76ファイル・1137本が緑（todo 2本）。
- lint: esc・internal-refs（上限82以内）・e2e-wait・e2e-external・js-color は OK。`check:version --range=origin/main..HEAD` も OK（`js/bookshelf.js?v=2026111700`）。

## main へ載せる前の確認（step4・origin/main 16c0a10 に rebase）

- #649（894ed54・js/ui/reorder.js の口）は、この時点で main に入っていた。js/bookshelf.js は重ならず、index.html の `?v=` だけがぶつかった。`js/bookshelf.js?v=2026111711` にした（origin/main は 2026111710）。
- 新しい spec: chromium は16本緑。webkit は9本緑・7本 skip（CDP の場面）。`npm run lint`（12本中0本失敗）・`npm test`（78ファイル・1176本）・`check:version --range=origin/main..HEAD` は OK。
- `scripts/verify/e2e-diff-main.mjs --port=8154`（17:14〜17:22 JST）: 新しく落ちたのは0件（フレーク判定の duplicate-asin-notice.spec.js の1件だけ・この変更と関係しない）。vitest も0件。画像の差分は54件中0件。

## 経過（step1）

- step1 では (c)・(g) を下の本へ運んでいた。本物のタッチで揺れたのは、上の「引っぱって更新」の再読込のためだった。
- 計画では記録用のスクリプト（scripts/verify/654-touch-click-probe.mjs）を別に作る予定だった。記録は spec の中で `_local/654/` に書く形にした。表はその記録から作った。
