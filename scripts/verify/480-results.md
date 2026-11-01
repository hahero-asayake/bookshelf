# #480: 同じasinの重複が一覧の差分描画を壊しうる件 — 調査と対処の結果

## 1. 重複の侵入経路（特定できた）

tmp/401の重複2組（B0F2TC5B79・B00I8AT186）を調べた結果、**侵入経路は特定できた**。詳細は
`scripts/verify/480-step1-investigation.md` にまとめた。要点:

- `js/book-manager.js:72` `importSelectedBooks` の `existingByAsin` は、ループ開始前の1回限りの
  スナップショット。ループ内で新規 push した本はこのMapに反映されないため、**同一の取込バッチ
  (`selectedBooks`)自体に同じasinが複数件含まれていると、全件が「既存なし」と判定されて重複登録
  される**。
- `pendingImportBooks`（取込候補一覧、`js/bookshelf.js` の file/paste/bookmarklet/relay 4経路のいずれ
  も重複排除なしでそのままセットする）→ `renderBookList`（重複候補も別チェックボックス行として表示、
  「全て選択」でまとめて選択される）→ `importSelectedBooks` の `selectedBooks` フィルタ（「ライブラリに
  既存」の asin だけを弾き、**バッチ内部の重複は弾かない**）という経路で、上記バグに到達する。
- tmp/401実データ(`/home/kuroko/GitHub/bookshelf/tmp/401/library.json`)の重複4件は全て
  `source: "kindle_import"`・`addedDate` が1ms刻みの連番で、同一の `importSelectedBooks` 呼び出し内
  で発生したことと一致する。
  - `B0F2TC5B79`（同じ本の二重登録）: 取込元データ(Amazon側)に、ごく近い時刻の2エントリが存在していた。
  - `B00I8AT186`（上巻/下巻という別の本に同じasin）: 取込元データの時点で、既に両方に同じASIN値が
    記録されていた（Amazon側のデータ不整合、またはASIN抽出ロジックの誤り。**どちらが原因かまでは
    未確認**）。
- 手動追加(`addBookManually`、book-manager.js:381)は呼び出しごとに都度 `find` で確認するため、単発では
  重複しない。tmp/401の4件は全て `source: kindle_import` でこの経路由来ではない。

## 2. 対処方針（決定・承認済み）

比較と推奨は `scripts/verify/480-step2-decision.md` にまとめ、②承認（2026-11-02 05:18:46）を得た。

- **(b)** 描画の差分で使うキーを asin から「asin＋出現番号」(`${asin}` または重複時 `${asin}#${n}`、
  `_orderedBooksToRender()` の順で数える)に変更。本ごとの uid を新しく発行・保存する案は不採用
  （②指示: データ構造の変更・同期マージ/hub/GitHub/LocalFSへの波及・#406が既に孤立防止済みで得るものが
  小さい・描画の中だけに留めればいつでも戻せる、の3点）。
- **(a)** は「取込バッチ内に重複があれば警告するだけ（ブロックしない）」に限定。既存の再取込ロジック
  (book-manager.js:72)自体は変更しない。
- 既存データ（tmp/401の重複2組）は**統合も削除もせず、そのまま残す**。(b)の実装により表示上の実害が
  無くなるため、不可逆な操作は行わない。

## 3. 実装

### (b) 描画キーの変更（js/bookshelf.js）

- 新規ヘルパー `_dedupKeysFor(books)`（`_orderedBooksToRender()` の直後に追加）: 渡された配列を
  asin の出現順に数え、重複が無い本は asin のまま、2回目以降の出現は `${asin}#${n}` を返す。保存は
  しない（呼ぶたびに計算するだけ）。
- `_renderListDiff`: `old`/`oldIndex` の Map キーを asin から `dedupKeys[idx]` に変更。DOM走査時は
  `el.dataset.dedupKey`（無ければ `el.dataset.asin` にフォールバック）を読む。
- `createBookElement` の呼び出し元（`_renderListDiff` の2箇所・`renderStandardView`）で、新規作成した
  要素に `el.dataset.dedupKey = dk` を付与する。
- **#406(c5a466d)が入れた「DOM走査で2枚目以降の重複asin要素を即removeする」対症療法(`dupAsins`)、
  および `lisSeq` 計算の `dupAsins` 分岐は撤去した**。dedupKeyが別なら同じMapキーを奪い合わないため、
  孤立要素そのものが発生せず、この対症療法は不要になったため（②指示(iii)を満たす形で決定）。
  - DOM走査時の `if (old.has(dk)) { el.remove(); continue; }` は保険として残したが、dedupKey方式では
    理論上発生しない。

### (a) 取込バッチ内重複の警告（js/bookshelf.js `importSelectedBooks`）

- `selectedBooks`（新規取込予定、既存ライブラリとの重複は既にフィルタ済み）の中で asin の出現数を数え、
  2件以上あれば `toast(...,{type:'warn'})` で警告する。既存チェックのロジック自体は変更しない。

## 4. テスト（経路を通す形）

`tests/e2e/reimport-diff.spec.js` を拡張（#406のテストと重なるため新規作成せず拡張・②指示(5)）。
データに重複asin2組を仕込む: `books[10]`=B0F2TC5B79型（同じ本の二重登録・内容ほぼ同一でacquiredTime/
addedDateのみ僅差）、`books[40]`=B00I8AT186型（別内容の本に同じasin）。

追加したテスト:
- 「手動追加は枚数・並びが正しい、既存の重複asinも保たれる」: 追加後も枚数が `books.length` と一致し、
  DOM順序が `_orderedBooksToRender()` と一致する。
- 「削除は枚数・並びが正しい、重複asinの片方だけ消しても残る方は壊れない」: `deleteBook` で重複asinの
  一方を消し、もう一方が正しく残ること・枚数・順序を確認。
- 「重複asinは2回目の描画でカードが作り直されない」(②合格条件(iii)): 重複asinを持つ各カードに印を付け、
  内容・並び順を変えない2回目の `_renderListDiff` 呼び出し後も**同じDOM要素インスタンス**であることを
  確認（4件すべて一致）。

既存の「再取込(asin重複を含む)」「order/direction/custom切替」テストは、`measureDiff` 内のキー計算を
asin→dedupKeyに追従させた上でそのまま再利用し、`_computeLisKeepSet` の呼び方や `moved===wouldMove` の
検証内容は変えていない。

実行結果:
- `tests/e2e/reimport-diff.spec.js`: 8 passed（既存4件+新規4件）。
- `tests/e2e/kindle-reimport-merge.spec.js`・`tests/e2e/sort-perf-budget.spec.js`: 4 passed。
- `tests/e2e/import-bookmarklet-progress.spec.js`・`import-bookmarklet.spec.js`・
  `import-method-data-ui.spec.js`・`import-paste.spec.js`: 17 passed（取込系への影響なし確認）。
- `npm test`(vitest run): 745 passed / 1 failed（`markdownToHtml` のO(n^2)劣化ガードの比率テスト、
  本変更と無関係なタイミング依存。単独再実行で pass を確認済み＝フレーク）。
- `?v=` バンプ: `index.html` の `js/bookshelf.js?v=2026110205→2026110206`。
  `node scripts/check-version-bump.mjs --range efac02d..HEAD` で `OK: 変更された js/css はすべて
  ?v= がバンプ済み。`

(i)(ii)(iii)(iv)はすべて満たした。

## 5. 対象外として別起票を検討

notes・bookOrder・exclusions等がasinをキーにしているため、別の本に同じasinが付いている
(B00I8AT186)場合、片方に書いたメモ・並び順・除外設定がもう片方にも反映される問題は、本イシューでは
扱わない（②指示）。起票候補:

> 本棚：同じasinの2冊がメモ・並び順・除外設定を共有してしまう／notes・bookOrder・exclusions 等が
> asin をキーにしているため、別の本に同じ asin が付いていると（tmp/401 の B00I8AT186＝上巻と下巻）、
> 片方に書いたメモがもう片方にも出る／まず実際に共有が起きているかを実データで確かめ、起きていれば
> asin の付け直しを案内するか、キーを見直すかを比べる。#480 の 480-step2-decision.md を参照
