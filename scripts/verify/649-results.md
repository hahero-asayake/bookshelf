# イシュー#649 の記録

ツリーで本棚を別の本棚の真ん中へドロップすると、ドラッグした本棚の一覧が開いてホームを離れる（#642 で発見）。

## §1 原因の切り分け（step1・2026-11-14）

### 結論

- 原因は click。ドロップの後に、ブラウザが作った click が「掴んだ行」に届き、行の click の処理（js/screens/bookshelf-list.js:75-78）が `switchBookshelf(掴んだ本棚)` を呼んで、ホームを離れる。
- click が掴んだ行へ届くのは、ドラッグの部品が掴んだ行に pointer capture を付けるため（js/ui/reorder.js:181 `itemEl.setPointerCapture`）。capture があると pointerup・mouseup が掴んだ行へ行き、click は「mousedown と mouseup の的の共通の祖先」＝掴んだ行に出る。capture を外すと、click はツリーの入れ物（click の処理が無い）に出て、ホームのまま（場面 i）。
- 「真ん中」の時だけ見つかった理由: 同じ親の中の並べ替え（場面 b）は、pointerup の中でツリーをその場で描き直し（bookshelf-list.js:170-172・188）、掴んだ行が DOM から外れる。そのため click が出ない。親が変わる時（場面 a・c）は、確認ダイアログを await してから描き直す（bookshelf-list.js:174）ので、click の時点で行がまだ DOM にあり、click が届く。
- 真ん中以外でも起きる: 別の親の端へ落とす（c）・ツリーの外へ落とす（d）・Esc で取り消してから離す（e）・循環の toast（f）でも、同じくホームを離れる。d・e・f は本棚が動かないのに一覧が開く。
- E2E の作り物ではない: 合成した pointer イベントだけで運ぶと（場面 g）、mouseup も click も出ず、ホームのまま親が付け替わる。click を作っているのはブラウザの入力の経路で、テストのコードではない。

### 実機のマウスで起きるかの見立て

- 起きる見込みが高い（PC の Chrome/Edge・Mac の Safari）。
  - 根拠1: page.mouse は、chromium では CDP の Input.dispatchMouseEvent、webkit では WebKit の自動操作の口を通る。どちらも OS のマウスと同じ入力の処理（isTrusted=true のイベント）に入り、mousedown/mouseup から click を作るのはブラウザ自身。合成イベント（g・isTrusted=false）では click は出ない。
  - 根拠2: 2つのエンジン（chromium-1223・webkit-2287）で、同じ場面が同じ結果になった（20件中20件一致）。
  - 根拠3: 仕組みは pointer capture と click の的の決まり（ブラウザの標準の動き）で、マウスの動かし方の細部（速さ・歩数）に依らない。
- 未確認: firefox（入っていない）。タッチの長押しドラッグ（タップでないので click は出ないと見るが、測っていない）。実機での打鍵（ハヘロへの依頼に回す）。
- ハヘロへの依頼の案（最終報告で送る・任意）: 「PC の Chrome で、左のツリーの本棚を、別の本棚の行の真ん中へマウスでドラッグして離し、確認で『移動する』を押した時、ホームのままか、ドラッグした本棚の一覧が開くかを1回だけ見てほしい」

### 場面ごとの結果

probe: `scripts/verify/649-click-probe.mjs`（`node scripts/verify/649-click-probe.mjs all <出力JSON>`・PORT=8149 で自分で http.server を起こす）。ツリーは all / fixshelf / p649 / c649（p649 の子）/ s649a / s649b / s649c（all と p649 を展開）。ドラッグは #623 (j)・#642 と同じ mouseDrag（落とす先は隣の行）。d・e は元の行の中で横へ 10px 動かして始めてから運ぶ。

「ホーム」は落とした直後の `body.app-view-main`。「親」は確認ダイアログで「移動する」を押した後の parent（確認が出ない場面はそのまま）。chromium と webkit で click の的・switchBookshelf・ホーム・親はすべて同じだった。

| 場面 | 操作 | click の的 | switchBookshelf | ホーム | 親（前→後） | 確認 |
|---|---|---|---|---|---|---|
| a | s649b を s649c の真ん中へ（依頼の場面） | s649b（掴んだ行） | s649b | 離れた（#/bookshelf/s649b） | fixall001→s649ciid01 | 出た |
| b1 | s649b を s649a の上の端へ（同じ親） | 出ない | 呼ばれない | 残った | 変わらない（並びは s649b,s649a に） | 出ない |
| b2 | s649b を s649c の下の端へ（同じ親） | 出ない | 呼ばれない | 残った | 変わらない（並びは s649c,s649b に） | 出ない |
| c | s649a を c649 の下の端へ（別の親） | s649a（掴んだ行） | s649a | 離れた | fixall001→p649iid01 | 出た |
| d | s649b をツリーの外（800,450）へ | s649b（掴んだ行） | s649b | 離れた | 変わらない | 出ない |
| e | s649b を s649c の上へ運び Esc の後に離す | s649b（掴んだ行） | s649b | 離れた | 変わらない | 出ない |
| f | p649 を子の c649 の真ん中へ（循環） | p649（掴んだ行） | p649 | 離れた（toast「循環参照になるため移動できません」も出る） | 変わらない | 出ない |
| g | 対照1: 合成の pointer イベントで a と同じ所へ | 出ない（mouseup も出ない） | 呼ばれない | 残った | fixall001→s649ciid01 | 出た |
| h | 対照2: s649a の行を普通にクリック | s649a | s649a | 離れた（正しい動き） | 変わらない | 出ない |
| i | 対照3: setPointerCapture を空にして a と同じ操作 | ツリーの入れ物（#sidebar-bookshelf-tree） | 呼ばれない | 残った | fixall001→s649ciid01 | 出た |

イベントの順（window の capture で記録・chromium）:

- a: pointerdown@s649b → pointerup@s649b → mouseup@s649b → click@s649b
- b1・b2: pointerdown@s649b → pointerup@s649b → mouseup@#sidebar-bookshelf-tree（click 無し）。webkit は mouseup も出ない。
- c: pointerdown@s649a → pointerup@s649a → mouseup@s649a → click@s649a
- d・e: pointerdown@s649b → pointerup@s649b → mouseup@s649b → click@s649b
- f: pointerdown@p649 → pointerup@p649 → mouseup@p649 → click@p649
- g: pointerdown@s649b[合成] → pointerup@s649c[合成]（mouseup・click 無し）
- i: pointerdown@s649b → pointerup@s649c → mouseup@s649c → click@#sidebar-bookshelf-tree

pointerup から click までの時間（click が出た場面）: chromium 0〜14ms、webkit 0〜10ms。click から switchBookshelf までは 0〜1ms。step2 で「捨てる時間の長さ」を決める時の材料にする。

### 取れなかったもの

- なし（予定した10場面 × 2ブラウザ＝20件すべて取れた。pageerror 0件）。
- firefox は入っていないので流していない（未確認）。

## §2 横展開の洗い出しと直し方の案（step2・2026-11-14）

同じ種類＝「ドラッグの後にブラウザが出す click が、掴んだ要素かその祖先の click の処理に届く」箇所。

測り方: `scripts/verify/649-click-probe-sites.mjs`（step1 の probe と同じ記録の仕方・chromium と webkit）。click の的は「mousedown（pointerdown）の的と、pointer capture を付けた要素の共通の祖先」になる（§1 の場面 a・i）。だから、処理が「掴んだ要素そのもの」か「その祖先」に付いていれば届き、掴んだ要素の「中のボタン」だけに付いていれば届かない。

### 表: Reorder.bindPointerReorder の呼び出し元6か所

| # | 場所 | capture を付ける要素 | click の処理 | ドラッグの後の click が届くか | すでにある抑止 |
|---|---|---|---|---|---|
| 1 | ツリー（bookshelf-list.js:118） | 行 `.tree-node` | 行そのものに `switchBookshelf`（bookshelf-list.js:75-78） | **届く＝不具合**（§1: a・c・d・e・f でホームを離れる。b は描き直しで行が外れて届かない） | 無し |
| 2 | 本棚管理モーダル（bookshelf-list.js:450） | 行 `.bookshelf-item`（つまみ `.bookshelf-drag-handle`） | 入れ物に委譲。反応するのは `.edit-bookshelf`・`.delete-bookshelf` の的だけ（bookshelf-list.js:339-345） | click は行 `.bookshelf-item` に出る（実測 M1・M2、両ブラウザ）。ボタンではないので**何も起きない**。モーダルは開いたまま・switchBookshelf も呼ばれない | 無し（要らない形） |
| 3 | 本の詳細のセクション（book-detail.js:86） | セクション `.bd-section`（つまみ `.bd-grip`） | セクションの中のボタン（本棚に追加・除外・長文メモ・星）にだけ付いている（book-detail.js:170・178・432・439・464） | コード上は**届かない**（click の的はセクションで、処理は子のボタンに付いている）。未実測 | 無し |
| 4 | サイドバーのユーティリティ（settings.js:1964） | 項目の包み `.header-item`（span・つまみ無し） | 包みの中の button に付いている（settings.js:1872-1925 の組み立て） | コード上は**届かない**（的は包みの span）。未実測: 既定のデータでは `#header-controls` に項目が1つも無く、probe の U1〜U3 は要素が見つからず取れなかった（2ブラウザ×3場面＝6件） | 無し |
| 5 | プラグイン一覧（settings.js:2461） | カード `.plugin-card-v2`（ボタン・入力の上からは始まらない） | 入れ物に委譲。反応するのは `[data-uninstall-plugin]`・`[data-settings-plugin]`（ボタン）の的だけ | コード上は**届かない**（的はカード）。未実測（プラグインの用意が要る） | 無し |
| 6 | ホームの部品（dashboard.js:568） | 部品 `.dashboard-widget`（つまみ `.widget-grip` からも本体からも始まる） | grid に委譲（dashboard.js:485-492 のつまみ→_startPicking、519- の削除・穴の枠） | click は部品 `.dashboard-widget` に出る（実測 W1・W2、両ブラウザ）。つまみ・削除・穴ではないので**何も起きない**（`_picking` は null のまま） | 無し（要らない形） |

### 表: 独自のドラッグ4つ（docs/char/u4-reorder-inventory.md）と setPointerCapture

| # | 場所 | capture を付ける要素 | click の処理 | 届くか | すでにある抑止 |
|---|---|---|---|---|---|
| A | 本のカード（bookshelf.js `_onBookPointerDown`・つまみ `.drag-handle`） | つまみ | カードそのもの（詳細を開く） | 届く | あり: 始めた時に `_suppressClick = true`、カードの click で1回捨てる（bookshelf.js:2427-2431・2481）。ただし click が来ない時（タッチ）は印が残り、次の正しいタップを1回捨てる心配がある（未確認） |
| — | 本のカードの長押し（タッチ・bookshelf.js:4469-4475） | 無し | カード | 届く | あり: `_suppressClick`（長押しで pop を出した直後の click を捨てる） |
| B | 記事エディタのキャンバスのつまみ（`.art-cv-grip`） | （キャンバスの委譲） | キャンバスの click 委譲（ブロックの編集を開く） | 届く | あり: `dragEndAt` から 400ms 以内の click を捨てる（article-editor.js:978・1014・1040） |
| C | 記事エディタの本棚ブロックの本の並べ替え（`_artBindDrag`・`.art-shelf-item-grip`） | つまみ（article-editor.js:2415） | 項目の中のボタン（外す・先頭へ・末尾へ）と、外側の本棚ブロックの click（選択中にする） | 外側のブロックへ届く見込み。ただし並べ替えはふつう選択中のブロックの中で行うので、ブロックの click は「選択中なら何もしない」で終わる（article-editor.js:2362-2363）。未実測 | 無し |
| D | 記事エディタのブロックの並べ替え（`_artBindDrag`・`.art-block-grip`） | つまみ | 本棚ブロックそのものの click（選択中にして描き直す・article-editor.js:2361-2367） | 届く見込み。落とす先が無い・自分の上へ落とした時（描き直しが起きない時）に、掴んだ本棚ブロックが選択中に切り替わる。効き目は軽い。未実測 | 無し |

まとめ:
- はっきり困るのは #1 ツリーだけ（ホームを離れる・一覧が開く）。
- #2・#6 は click が掴んだ要素に届くが、処理がボタンの的だけに反応するので、何も起きない（実測）。#3・#4・#5 はコード上同じ形（未実測）。
- 独自のドラッグは、A・B に個別の抑止がある。D は届く見込みで、効き目は軽い（選択中の切り替え）。

### 直し方の案

| 案 | 中身 | 良い所 | 悪い所 |
|---|---|---|---|
| A（推奨） | 共通の部品 `js/ui/reorder.js` で抑える。ドラッグが始まった時だけ、終わる時（落とす・Esc・blur・visibilitychange・pointercancel の全経路＝`finishDrag`）に「次の click を1回だけ捨てる口」を window の capture に付ける | 6か所が同じ決まりになる（#2〜#6 は今は何も起きないが、後で click の処理を足しても同じ穴が開かない）。ドラッグしていない click には何もしない。ハヘロの「共通の仕組みで」に合う | 共通の部品の挙動が変わる＝6か所の既存 spec を流し直す必要がある（step4・5） |
| B | ツリーの行の click の処理だけで、ドロップの直後を無視する | 範囲が狭い | 個別の対処。#2〜#6 や今後の呼び出し元に同じ穴が残る |
| C | E2E の作り物として扱う | — | §1 の場面 g・i で、作り物ではないと分かった＝当てはまらない |

案A の口の決まり（推奨）:
- 付ける時: `beginDrag` が呼ばれた（ドラッグが本当に始まった）ドラッグの `finishDrag` の時だけ。6px 未満で離した普通のクリックや、長押しが成立する前に離したタップには付けない。
- 捨てる click: 口を付けた後の最初の click で、的が container の中（または掴んだ要素の中）のものだけ。preventDefault・stopPropagation・stopImmediatePropagation する。
- 外す時（どれか早いもの）: (1) 1回捨てた時。(2) 次の pointerdown が来た時（新しい操作が始まった＝前のドラッグの click はもう出ないので、正しいクリックを捨てない）。(3) 400ms 経った時。
- 時間の長さ 400ms の根拠:
  - 実測では、ドラッグの click は pointerup から 0〜14ms（chromium）、0〜10ms（webkit）で、mouseup と同じ入力の処理の中ですぐ出る（§1）。どの長さでも足りる。
  - 既存の記事エディタの `dragEndAt` 400ms（article-editor.js:1040）に揃えると、アプリの中で「ドラッグの後に click を捨てる時間」が1つになる。
  - 正しいクリックは必ず pointerdown から始まり、(2) で先に口が外れる。だから 400ms の中でも、ユーザーの次のクリックは捨てない。400ms は、click が出ない時（タッチの長押しドラッグ）に口を残しっぱなしにしないための上限としてだけ効く。
- 案A の外の4つ（A〜D）は、このイシューでは触らない案を推奨する。A・B は個別の抑止で困りごとが無い。D は効き目が軽い。共通の口を `Reorder` から出して（例: `Reorder.swallowNextClick(scope)`）、A・B・D も同じ口へ寄せるかは、②が決める（寄せない場合は 07 に1行）。

### step3 で書く E2E の場面の案

新しい spec（仮の名前 tests/e2e/tree-drop-stays-home.spec.js・PC 幅・ホームを表示したまま）。assert は `body.app-view-main`・`location.hash` が変わらないこと・userData の parent（expect.poll）。

1. 真ん中へ落とす → 確認で「移動する」→ ホームのまま・hash は変わらない・親が付け替わる（依頼の場面・§1 a）
2. 別の親の本棚の下の端へ落とす → 確認 → ホームのまま・親が付け替わる（§1 c）
3. ツリーの外へ落とす → ホームのまま・親も並びも変わらない（§1 d）
4. ドラッグ中に Esc → 離す → ホームのまま（§1 e）
5. 親を自分の子の真ん中へ → 循環の toast が出る・ホームのまま（§1 f）
6. 正しいクリックを捨てない: 3 の直後（400ms 以内）に別の行を普通にクリック → その本棚の一覧が開く（口が pointerdown で外れること）
7. 他の呼び出し元の見張り（案A で共通の部品を変えるため）: 本棚管理モーダルでつまみを運んだ後もモーダルが開いたまま・何も開かない（M1）。ホームの部品をつまみから運んだ後も「選んで置く」にならない（W1）

ドラッグは #623 (j)・#642 と同じ mouseDrag（隣の行へ落とす）。遠くへ運ぶ場面（3・4）は、元の行の中で 6px を超えて始めてから運ぶ（#638 の落とし穴）。spec を先に赤のまま commit する（1〜5 が赤・6・7 は緑の見込み）。
