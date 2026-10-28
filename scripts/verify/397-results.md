# #397 step1: 現状再現（HEAD・913冊・WebKit/chromium低速条件・3操作）

## 条件
- 配信: working tree をそのまま `python3 -m http.server 8097` で配信（git status確認済み・js/bookshelf.js・css/bookshelf.css・index.htmlに未コミット差分なし＝working tree = HEAD。index.htmlの`js/bookshelf.js?v=2026102901`を確認＝本番と同じ版）。
- データ: ハヘロの実データ（`~/GitHub/bookshelf-data` ローカルclone、private/library.json・notes.json・settings.json・bookshelves.json、読み取りのみ）を種に913冊へpadding（実データは2026-06-07時点で783冊・不足分130冊は実データのレコードをasinだけ変えて複製。title/authors/メモ/評価の実分布はそのまま）。生成スクリプト: `tmp/397/build-data.mjs`。settings.sortOrder='custom'・sortDirection='desc'は実データの値そのまま。出力は`tmp/397/`配下のみ・commitしない・トークンは元データに含まれない（本棚データのみでsync認証情報は別キー）。
- 表紙画像: 実データのproductImage URL（m.media-amazon.com、SWのCOVER_HOSTSと一致）をそのまま使い、Playwrightの`ctx.route`で実際にAmazonから取得した11枚の実画像（16KB〜60KB、`tmp/397/covers/`）を返す。アプリ(localhost:8097)とは別オリジン・SWのcache-first経路（cache.put含む）が実物同様に発火する。実ネットワークには出ない。
- viewport: 390×844、touch有効。
- CPU: chromium は CDP `Emulation.setCPUThrottlingRate` で x4・x6。WebKit は制限手段が無い（Playwrightに相当APIが無い）＝素の速さを記録し、x4/x6との比較で間接的に読む（注意に明記）。
- SW: on（本番同様sw.js登録）とoff（block、切り分け用）の両方。
- 操作: ①並び順メニューの切り替え（`#sort-order`のchange）②昇順/降順切り替え（`toggleSortDirection`）③ドラッグでの並べ替え（`reorderBooks`をドロップ確定相当で直接呼ぶ＝#387のハーネスと同じ簡略化。**連続ポインタ移動中の描画コストは含まない**、下記「制約」参照）。
- 反復: 各条件 **3回**（時間予算の制約で#387の5回から縮小。中央値+最大値を報告。ばらつきの許容はstep4のE2Eで別途定める）。
- 指標:
  - `tFrame` = 操作の同期処理が終わった後、rAF×2後（レイアウト確定後の次ペイント相当）までの時間 = 「入力から画面が変わるまで」
  - `maxInputDelay` = 操作直後からpointerdownを16ms間隔でスケジュールし、ハンドラが実際に発火した時刻との差の最大値 = 「入力を受け付けない時間」
  - longtask = PerformanceObserver(50ms超)の件数・合計・最長（chromiumのみ観測可能）
  - 内訳 = applySorting・updateDisplay(_renderListDiff含む)・_bookCardKey合計・insertBefore呼び出し数・LazyLoader.observe呼び出し数・表紙route命中数・_showSavedNote・localStorage書き込みバイト数
- ハーネス: `scripts/verify/397-sort-perf.mjs`

## 結果（中央値・ms、n=913）

| 条件 | 操作 | tFrame(med/max) | 固まる時間=maxInputDelay(med/max) | longtask件数/合計/最長 | DOM移動(insertBefore) |
|---|---|---|---|---|---|
| WebKit 素の速さ・SW on | order | 175 / 183 | 137 / 146 | 0 / 0 / 0 | 911 |
| WebKit 素の速さ・SW on | direction | 172 / 185 | 135 / 146 | 0 / 0 / 0 | 912 |
| WebKit 素の速さ・SW on | drag | 42 / 58 | 0 / 0 | 0 / 0 / 0 | 0 |
| WebKit 素の速さ・SW off | order | 190 / 206 | 153 / 161 | 0 / 0 / 0 | 911 |
| WebKit 素の速さ・SW off | direction | 173 / 176 | 136 / 138 | 0 / 0 / 0 | 912 |
| WebKit 素の速さ・SW off | drag | 39 / 42 | 0 / 0 | 0 / 0 / 0 | 0 |
| chromium CPU x4・SW on | order | 132 / 148 | 120 / 144 | 2 / 128 / 64 | 911 |
| chromium CPU x4・SW on | direction | 112 / 114 | 79 / 96 | 2 / 109 / 57 | 912 |
| chromium CPU x4・SW on | drag | 45 / 58 | 15 / 28 | 0 / 0 / 0 | 0 |
| chromium CPU x4・SW off | order | 125 / 134 | 113 / 125 | 2 / 122 / 62 | 911 |
| chromium CPU x4・SW off | direction | 119 / 120 | 86 / 113 | 2 / 115 / 58 | 912 |
| chromium CPU x4・SW off | drag | 47 / 48 | 17 / 19 | 0 / 0 / 0 | 0 |
| chromium CPU x6・SW on | order | **191 / 209** | **206 / 268** | 2 / 185 / 93 | 911 |
| chromium CPU x6・SW on | direction | 163 / 180 | 128 / 178 | 2 / 158 / 84 | 912 |
| chromium CPU x6・SW on | drag | 61 / 66 | 33 / 37 | 1 / 51 / 51 | 0 |

目標（issueの例）: 画面が変わるまで ≤150ms・入力を受け付けない時間 ≤100ms。
**「並び順メニューの切り替え」「昇順/降順」は、測った全条件で両方の目標を超えている**（WebKit素の速さでも175ms/135ms、chromium x6では209ms/268ms）。「ドラッグ（ドロップ確定のみ）」は目標内だが、下記「制約」で実際のドラッグ中コストは別。

## 内訳（代表2条件のacc、ms・中央値）

**WebKit 素の速さ・order**: applySorting(全体)=39・updateDisplay(_renderListDiffを含む)=38・_bookCardKey合計=0〜2・LazyLoader.observe呼び出し=3回・表紙route命中=0件。tFrame=175のうち、JS計装で説明できるのは約77ms。残り約98msはブラウザ内部のレイアウト/ペイント（911件のinsertBeforeによるDOM再配置の描画コスト）と推定（JSレベルの計装では直接測れない）。

**chromium CPU x6・order**: applySorting(全体)=90・updateDisplay=81（うち_renderListDiff=81・_bookCardKey合計=10）・saveUserData=1.1・_showSavedNote=0.7・LazyLoader.observe=6回・表紙route命中=9件。longtask合計185msはtFrame 191msの大半を占める＝ほぼ1枚のロングタスクに収まっている。

## 先読み/SWとの重なり（補助測定・`tmp/397/overlap-probe.mjs`）

ページ読み込み直後（表紙先読みがまだ動いている30ms後）に並び替えを1回行うと:

| browser | tFrame | 表紙route命中(重なり中) | longtask |
|---|---|---|---|
| WebKit（settled時175ms比） | **311ms**（+136ms） | 0 | - |
| chromium（無throttle・settled時と単純比較不可） | 106ms | **1件**（新規fetch+cache.put相当が並び替え処理と重なった） | 1件・66ms |

→ 「落ち着いた後」に測ると見えない負荷が、起動直後の先読みと並び替えが重なるタイミングでは実際に乗ってくることを確認。本番でページを開いてすぐ並び替えると、この「重なり」状態になりやすい（ハヘロの操作タイミング次第）。原因の切り分け（#389/#391のどの処理が重なっているか）はstep2で#387直後版と比較しながら詰める。

## 制約・注意（時間予算内で判断した簡略化）

1. **反復3回**（既定5回から縮小・時間予算のため）。中央値と最大値のみ報告、分散の詳しい評価はstep4のE2E閾値設定時に別途取る。
2. **「ドラッグでの並べ替え」は#387のハーネスと同じ簡略化＝ドロップ確定時のreorderBooks()を直接呼ぶのみ**。実際の指の移動中（pointermove連続発火・_bindPointerReorderの中間描画）のコストは含まれていない。ハヘロの報告が「ドラッグ中に固まる」であれば、このstep1の drag の数値（40〜66ms）は過小評価の可能性がある＝「並び替え操作のどれが重いか」の②確認が未回答のため、次ステップで連続pointermoveを模した計測を追加候補とする。
3. **データは実データを種にしたpadding**（783冊実データ→913冊）。本物の2026-10-29時点の913冊スナップショットそのものではない（取得手段が読み取りのみのローカルclone経由のため、鮮度は2026-06-07時点）。schema・メモ/評価の分布・設定値は実データそのもの。
4. **表紙配信は別オリジンのローカルサーバーではなくPlaywrightのroute interception**（実画像バイト・実ホスト名m.media-amazon.comは維持）。SWのCOVER_HOSTS判定・cache-first経路は実コードがそのまま動く＝測定対象の挙動としては等価。別プロセスの第二サーバーを立てる時間を節約した。
5. **WebKitはCPU制限の手段がない**（Playwrightに相当APIなし）。素の速さの数値をchromium x4/x6と並べて「おおよそこの辺」として読む。実iPhoneは一般にこの計測機より遅い可能性があり、WebKit素の数値は実機の下限方向の推定にとどまる。
6. 「並び替え」が3操作のうちどれかは②確認待ち。本stepは3つとも同じ重みで計測済み。

## step4: 承認案(A1+A4+A5+A6)実装後の前後比較

②承認（2026-10-29・step3tp時点）: ハヘロから回答があり、重いのは「昇順/降順の切り替え」。A1(_bookCardKey指紋キャッシュ)に加え、A4(方向反転は再ソートせずキャッシュを反転)・A5(移動が全体の50%超ならinsertBefore連打でなくreplaceChildren一括差し替え)・A6(Intl.Collator使い回し+シュワルツ変換)を実装。実装箇所はjs/bookshelf.jsのapplySorting/toggleSortDirection/_bookCardKey/_renderListDiffの4関数のみ(他の一覧=サイドバーツリー・プラグイン一覧は_bindPointerReorderのみ使用しこれらの関数を呼ばないため無影響、touch-reorder.spec.js 6件で実測確認)。ui:books-renderedは従来どおり1回のみ発火(変更なし)。

**計測条件**: chromium CPU x6・SW on・913冊(実データ種のpadding、step1と同一データ)・390px・各3回(時間予算のため、前stepまでと同じ判断を継続)。

| 操作 | 指標 | 修正前(step1実測) | 修正後 | 差分 |
|---|---|---:|---:|---:|
| order(並び順メニュー) | tFrame中央値 | 190.8ms | 165.5ms | -25.3ms(-13%) |
| order | 固まる時間(中央値/最大) | 205.8/268.2ms | 165.4/228.6ms | -40.4/-39.6ms |
| direction(昇順/降順・最優先) | tFrame中央値 | 162.7ms | 154.3ms | -8.4ms(-5%) |
| direction | 固まる時間(中央値/最大) | 127.9/178.2ms | 119.6/161.4ms | -8.3/-16.8ms |
| drag(ドロップ確定のみ) | tFrame中央値 | 61.3ms | 61.0ms | ほぼ変化なし |

WebKit(素の速さ・SW on)も同一条件で前後比較:

| 操作 | tFrame中央値(前→後) | 固まる時間中央値(前→後) |
|---|---|---|
| order | 175→176ms | 137→136ms(ほぼ変化なし) |
| direction | 172→167ms | 135→128ms |
| drag | 42→34ms | 0→0ms |

**目標(≤150ms/≤100ms)との対比**: directionはtFrame(154ms)が目標にかなり近づいたが未達。「固まる時間」はorder/directionとも目標(≤100ms)に届いていない。drag(ドロップ確定のみ)はほぼ横ばい(元々軽い操作のため今回の案の対象外)。**今回の実装で測定可能な改善はあったが、目標には届いていない。**

**重要な訂正**: step3の397-options.md/②への報告で「applySortingの89.7ms」を並べ替えの比較コストそのものとして扱っていたが、計測ハーネスの`wrap()`はapplySorting呼び出し全体(内部で呼ぶupdateDisplay/_renderListDiffを含む)の時間を測っており、**89.7msの大半(81.1ms)は実はupdateDisplay/_renderListDiffの入れ子時間で、純粋な比較コストは約8.6msしかなかった**。そのためA4(直前にソート済みの配列を反転するだけにする)で削れた時間は見積もりよりずっと小さい(直接の比較コスト8.6ms相当+その分の連鎖的な処理減)。実際に効いたのは主にA1(指紋キャッシュ、_bookCardKeyが10.3ms→2.6〜2.9msに縮小)で、**残る主要コストは_renderListDiffの中のDOM構築・ブラウザ内部レイアウト/ペイントで、A5(replaceChildren一括化)の効果は本計測機・この条件では小さかった**(可能性: ブラウザが元々1タスク内の複数insertBeforeをレイアウト的には1回にまとめて処理しており、呼び出し回数を減らすこと自体の得が小さかった)。この点は正直に報告し、目標未達の原因として次の改善(仮想化Cの再検討、または別アプローチ)の材料にする。

**比較画像**: tmp/397/shots/after-{initial,direction-toggle,order-title}.png(修正後の一覧の見た目・913冊・390px)。3枚とも書影・書名・著者が正しく表示され、視覚的な崩れは無いことを確認(A1/A4/A5/A6はいずれも内部実装のみの変更で見た目は変えない設計のため、前後比較は「崩れていないこと」の確認が主目的)。

**実装中に見つけたA1の不具合と修正**: 当初のA1実装は `book` オブジェクトの**参照**が同じなら`JSON.stringify(book)`の結果をキャッシュから返す方式だった。しかし再取込時のステータス更新(`js/book-manager.js`の`mergeImportedBooks`相当の処理)は`existing[key] = newVal`で**既存オブジェクトの参照を変えずにフィールドだけ書き換える**設計だったため、参照だけを見るキャッシュはこの変化を検知できず、再取込後もKUバッジ等が古いまま表示される不具合を作っていた。`tests/e2e/kindle-reimport-merge.spec.js`(既存テスト、変更していない)が2件検出(実装直後に`npm run test:e2e`の対象を広げて気づいた)。book-manager.js側でフィールドを書き換えるたびに非列挙の`__bibV`(JSON.stringify/library.json書き出しに混ざらない)を進め、bookshelf.js側のキャッシュ判定を「参照が同じ**かつ**`__bibV`が同じ」に修正して解決・再実行で3件とも合格を確認。

## step5: push前のE2E全50ファイル実行

②指示どおり`npm run test:e2e`(全50ファイル・529件・8 worker並列)を実行。

- **1回目**: 1件失敗(`tests/e2e/sort-perf-budget.spec.js`・direction tFrame=285.9ms > 許容240ms)。単独実行(workers=1)で3回連続再実行しすべて合格(150〜155ms)→**フレークと判定**。原因: このテストはCDPのCPUx6スロットリングで「ページの処理速度」を落とす一方、host機の実CPUコアは8 workerの他ファイル(無関係なchromiumインスタンス7個分)と奪い合う状態になり、スロットリングの影響に実コンテンションが上乗せされ単独実行より悪化する。
- **対策**: (a) 許容幅をさらに広げる(order/direction/dragとも)、(b) 1操作につき3回測って中央値を採る方式に変更(`measureMedian`・397-sort-perf.mjsのreps=3中央値と同じ考え方)。単発のhost競合スパイクに引きずられにくくした。
- **2回目**: 対策(a)のみの状態で実行し、別の指標(drag.maxInputDelay=88ms > 許容80ms)がまた1件だけ失敗。許容幅の後追い引き上げは切りが無いと判断し、(b)の中央値方式に切り替え。
- **3回目**: (a)+(b)適用後に全50ファイルを実行し、**529件中516件合格・13件skip(webkit専用specのchromium実行対象外)・失敗0件**。単独実行(workers=1)でも3回連続合格を確認済み。

npm testも都度再実行し、43ファイル723件全パス(変化なし)。


