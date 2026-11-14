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
