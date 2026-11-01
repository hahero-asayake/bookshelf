# #480 step1: 重複asinの発生経路調査

## (1) #406の状態
- 2026-11-02 05:0x時点、origin/main の最新は `efac02d`（#453）。`git log --all --oneline | grep -i 406` はヒット無し。
- worktree issue-480 の HEAD も `efac02d` で origin/main と一致（未コミット無し）。
- **結論: #406はまだpush/done になっていない。** ②申し送り(1)により、step3(実装)の着手は#406がdoneになり origin/main に入ってからに限る（step1・step2は並行可）。

## (2)+(3) 重複が入りうる経路（コード）と tmp/401 実データでの裏付け

### 確定した発生源: `BookManager.importSelectedBooks`（js/book-manager.js:65-161）
- 72行目 `const existingByAsin = new Map(this.library.books.map(book => [book.asin, book]));` は**ループ開始前の1回限りのスナップショット**。
- ループ内で新規本を `this.library.books.push(bookToAdd)`（123行）しても `existingByAsin` には反映されない。
- そのため、**同一呼び出しに渡す `selectedBooks` 配列自体に同じ asin が複数件含まれていると、全件が `existingByAsin` に無い=新規として判定され、両方とも push される**（重複排除が一切効かない）。
- `addedDate: Date.now()`（120行）をループ内で呼ぶため、2件の addedDate は実行順にわずかにずれる。

### `selectedBooks` の組み立て元（js/bookshelf.js:13720-13743 `importSelectedBooks`）
- `selectedBooks` は `pendingImportBooks[index]`（取込候補データ）から、チェックボックスの index で引く（13726-13728行）。
- フィルタ条件は `!existingASINs.has(b.asin) && !excludedASINs.has(b.asin)`。`existingASINs` は「**既にライブラリに入っている** asin」の集合（13724行）。
- → **`pendingImportBooks` 自身の内部に同じ asin が複数件あっても、このフィルタでは弾かれない**（弾くのは「ライブラリに既存」の場合だけ）。

### 候補データ表示側 (`renderBookList`, js/bookshelf.js:13596-13637)
- `books.forEach((book, index) => ...)` で、`pendingImportBooks` 内の重複 asin もそれぞれ別の index・別のチェックボックス行として表示される（重複排除なし）。
- 「全て選択」ボタン（13674-13678行）を押すと、disabled でない全チェックボックスが選択される＝重複候補が2行あれば両方が自動的に選択される（ユーザーが意図的に2回選ぶ必要はない）。

### 候補データの入口（`showBookSelectionForImport`, js/bookshelf.js:13574以降）
呼び出し元は4経路、いずれも受け取った配列をそのまま `pendingImportBooks` にセットし、重複排除は無い。
- `importFromFile`（14102-14121行、file）: アップロードしたJSONを `JSON.parse` してそのまま渡す。
- `importFromPastedText`（14127-14143行、paste）: 貼り付けテキストを `JSON.parse` してそのまま渡す。
- bookmarklet経路（14627行）、relay経路（14673行）: Amazon画面からのスクレイピング結果をそのまま渡す（本ステップでは中身まで深追いしていない＝未確認）。
- → **取込元データ（ファイル/貼り付け/スクレイピング結果）自体に同じ asin の行が複数含まれていれば、アプリ側のどこにも重複排除フィルタが無いため、そのまま importSelectedBooks まで素通りする。**

### 手動追加 `addBookManually`（js/book-manager.js:373-407, 381行）
- 呼び出しごとに都度 `this.library.books.find(book => book.asin === asin)` で現在の状態を確認し、既存なら `throw` する。
- 単発呼び出しでは重複を防げる。並行して2回呼ばれた場合（race condition）に限り理論上は重複の余地が残るが、UI上は取込とは別のモーダルで単発操作であり、本データの重複2組がこの経路から来たと推測する根拠は無い（`source` が両方 `kindle_import` のため、下記の実データ確認でこの経路は否定できる）。

### tmp/401 実データでの裏付け（`/home/kuroko/GitHub/bookshelf/tmp/401/library.json`）
`jq` で重複2組の全フィールドを確認:

```
B0F2TC5B79 (1件目): acquiredTime=1769953748157, addedDate=1779602493845, source=kindle_import
B0F2TC5B79 (2件目): acquiredTime=1769953748940, addedDate=1779602494628, source=kindle_import
B00I8AT186 (上巻):   acquiredTime=1744365259060, addedDate=1779602494694, source=kindle_import
B00I8AT186 (下巻):   acquiredTime=1744365259061, addedDate=1779602494695, source=kindle_import
```

- 4件とも `source: "kindle_import"`（手動追加ではない）。
- 4件の `addedDate` が 1ms刻みで連続（...493845 → ...494628 → ...494694 → ...494695）＝**同一の `importSelectedBooks` 呼び出し（1回のforループ）内で連続して push された**ことを強く示す。これは上記の `existingByAsin` スナップショットバグの実行結果と一致する。
- **B0F2TC5B79**: 同一タイトル・同一著者・同一画像の本が2件。`acquiredTime` が783ms違う＝Amazon側の取込元データに、ごく近い時刻の2エントリが存在していた（取込元データの重複、または短時間の二重スクレイピング）。
- **B00I8AT186**: タイトル・著者・画像URLが異なる別の本（上巻/下巻）に、同一asinが付いている。`acquiredTime` は1msしか違わない＝取込元データの時点で、既に上巻・下巻の両方に同じASIN値が記録されていた（Amazon側のデータ不整合、またはASIN抽出ロジックの誤りの疑い。**どちらが原因かはこのステップでは未確認（コードレベルでbookmarklet/relayのASIN抽出ロジックまでは読んでいない）**）。

### 結論（経路ごとの「起こりうる／起こりえない」）
| 経路 | 重複の可否 | 根拠 |
|---|---|---|
| Amazon取込（kindle_import、file/paste/bookmarklet/relayいずれも共通の importSelectedBooks を通る） | **起こりうる（確定）** | book-manager.js:72 のスナップショットバグ＋取込候補側に重複排除フィルタが無い。tmp/401の4件全てこの経路の産物と推測（根拠: source一致・addedDate連番） |
| 手動追加 (addBookManually) | 単発では起こりえない（race conditionの理論上の余地のみ、未確認） | 381行で都度 find チェック。tmp/401の実データはどちらも source=kindle_import でこの経路由来ではない |
| 同期マージ（GitHub/ハブ/LocalFS読込） | **未確認** | 本ステップの時間内でコードを読み切れていない。書き込み時の重複排除有無は次ステップ以前に確認が必要なら別途調査 |

## (4) asinをキーにしているデータ構造（キーを変える際に波及する範囲）
- `userData.notes[asin]` = `{ memo, rating, hideMemo, hasDetailMemo, hideDetailMemo }`（短文メモ・評価・公開opt-out。js/bookshelf-manager.js:133,138,427-439）
- `userData.bookOrder[bookshelfId]`（カスタム並び順の asin 配列。js/bookshelf-manager.js:394-395,415、js/bookshelf.js:8892）
- `userData._storage.exclusions` / `excludedASINs`（除外asinの配列。js/bookshelf.js:8886-8887、js/storage.js:229,246,309）
- `userData._storage.libraryBooks`（ライブラリ本体。library.json の books 配列そのもの、asinで検索・フィルタ）
- `bookshelves/<slug>.json` の本棚所属（本棚ごとの所属asin一覧。bookshelf-manager.js 全体で asin ベース）
- `_bibCache`（js/bookshelf.js内、`_bookCardKey` のキャッシュ、asinキー・#397 A1で導入）
- `_renderListDiff` の `old`/`oldIndex` Map（js/bookshelf.js:2078-2081、本題のバグ箇所）
- → **asin は「本の一意な識別子」として全データ層に深く染み込んでいる。** 描画キーだけを別IDに変える案(b)は、notes/bookOrder/exclusions/bookshelves側の整合は保てる（これらは正しい運用なら「本1冊=1asin」を前提にしているため、asinが重複する=2つの本が同じメモ・同じ並び順設定を共有してしまう、という問題が既にそこにある。描画キーの変更だけでは解決しない）。

## 申し送り
- #406の実装（LISベースの判定への変更）はまだ入っていないため、_renderListDiff の行番号はこの後ズレる可能性がある。step3着手前に再度 `grep -n _renderListDiff` で現在行を確認すること。
- bookmarklet/relay経由のASIN抽出ロジック（js/bookshelf.js 14600〜14680行付近）はこのステップで深追いしていない。B00I8AT186がどちらの経路かまでは特定できておらず「不明」とする（②申し送り(2)により先へ進める）。
- 同期マージ（GitHubAdapter/HubStorageAdapter経由でのlibrary.json読込・書込）での重複排除有無は未確認。
