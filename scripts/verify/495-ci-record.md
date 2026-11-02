# イシュー#495 push後のCI実測記録

## 1回目 (37bb9f3)

- push: 2026-11-02 09:04頃 (`BOOKSHELF_ISSUE=495 git push origin 37bb9f3:main`)
- CI run: `41365147599` / testジョブ `125023620120`
- 結果: `test`ジョブ全体 **success**(09:15:07 completed)。同コミットの`build`/`deploy`/`report-build-status`ジョブも全てsuccess。
- CHK6・`#495-pub`/`#495-set`/`#495-race`(back-nav-matrix.spec.js)に失敗なし。
- annotationsに「E2E 1回目失敗 合計14件」が出たが、全件`bookshelf-clip-373.spec.js`・`bookshelf-clip-385.spec.js`(既知のWebKit系フレーク)・`ux-p2-settings.spec.js`のP2スクロール1件で、本イシューの変更(js/nav-state.js・back-nav-matrix.spec.js)とは無関係。最終的にリトライで通り全体successになっている。
- sort-perf-budget: 1 passed(2.6m)。`[sort-perf-ratio]`(基準タグ`perf-base`との比較、ADR-149の判定本体)のannotationは出力されなかった(51ed59cの時と同じ既知の欠落・annotation件数上限の罠)。出力された値のみ記録:
  - `[sort-perf-aa]`(同一commit内のA/A・測定ノイズの参考値): order ratio=1.103・direction ratio=0.899・drag ratio=1.055 (いずれも1.0近傍・#492実測の揺れ±7.5%の範囲内)
  - `[sort-perf-absolute]`: direction tFrame中央値=160.5ms(BUDGET340ms・記録のみ) / direction inputDelay中央値=345.1ms(BUDGET320ms・記録のみ) / order tFrame中央値=198ms(BUDGET380ms・記録のみ) / order inputDelay中央値=419.7ms(BUDGET420ms・記録のみ)
  - `[sort-perf-rate]`: T_measured=31ms T_ref=32ms rate=6.00
  - 判定方式(基準タグとの比1.3倍)自体は本イシューで変更していない(並び替え処理は未修正)。テスト自体がsuccessのため、実際の比はRATIO_LIMIT(1.3)以下だったと判断する。実数値は本記録には無い(annotation欠落)。
