# #484 step1: asinをキーにする保存項目の洗い出しと実データでの共有の実測

## 0. 実データでの重複asin件数（②申し送り(1)）

`/home/kuroko/GitHub/bookshelf/tmp/401/library.json`（913冊、#480調査で使われた実データと同じ固定パス）を
`/home/sei/.nvm/versions/node/v24.18.0/bin/node` で集計:

| asin | 件数 | タイトルが同じか | 型 |
|---|---|---|---|
| B0F2TC5B79 | 2 | 同じ | 同じ本の二重登録（実害小） |
| B00I8AT186 | 2 | **違う**（上巻／下巻） | **別の本に同じasin（本イシューの対象）** |

→ **「別の本に同じasin」型は実データ913冊中 1組（B00I8AT186）。**
tmp/401配下にnotes.json・exclusions.json等は無く（library.jsonのみ）、実データに対する直接のnotes/bookOrder/exclusions実測はできなかった。
下記「2. 項目ごとの実測」は、この2冊（上巻・下巻、asin=B00I8AT186）を模したデータで、実際のコード（window公開クラスのメソッド・実装と同一のロジック）を動かして確認した。

## 1. asinをキー・要素にする保存項目の一覧（洗い出し）

| 保存項目 | 実体・キー | 主な参照箇所（ファイル:行） |
|---|---|---|
| 短文メモ・評価・opt-out | `userData.notes[asin] = { memo, rating, hideMemo, hasDetailMemo, hideDetailMemo }` | `bookshelf-manager.js:132-139`(resolveMemo/resolveRating)・`:425-439`(setMemo/setRating)・`bookshelf.js:2068,2305,2952,3290,10798,11017`・`dashboard.js:634,743`（評価集計）・`plugin-api.js:325-328`(`updateNote`、プラグインも同じキーを書く) |
| 並び順 | `userData.bookOrder[本棚id]` = asinの**配列**（重複可・区別なし） | `bookshelf.js:1543-1564,2030-2031,2797-2818`(`reorderBooks`)・`bookshelf-manager.js:170-172,311-314,389-395,414-415`（棚のrename/削除/手動追加時の追従） |
| 除外設定 | ファイル`private/exclusions.json` = `{ excludedASINs: string[] }`／メモリ`userData._storage.exclusions`（同じ配列） | `storage.js:229,246,299-309,339`（読込・既定値・書出）・`bookshelf.js:1321,5432,5567,5684-5687,5716-5718,8864-8931,13451-13725`（判定・追加・解除・一覧表示） |
| ライブラリ本体 | `library.json`の`books`配列（asinで検索・フィルタ、重複排除なし） | `book-manager.js:72`(`existingByAsin`、#480の本題)・`bookshelf.js`各所 |
| 本棚メンバー | `bookshelves/<slug>.json`の`books`（asin配列）／all棚は`library.books`を`map(b=>b.asin)`でそのまま列挙 | `bookshelf.js:1541`・`bookshelf-manager.js`全体 |
| 長文メモ | ファイル名 `private/books/${asin}__${sanitizeFileName(title)}.md` | `storage.js:409-437` |
| 公開記事ブロック内参照 | `libMap = new Map(library.books.map(b => [b.asin, b]))` でasin→本を解決 | `publish-article-generator.js:457-458,930` |
| プラグイン保存領域 | `updateNote(asin, partial)` が `userData.notes[asin]` を直接マージ（コアと同じキー） | `plugin-api.js:322-330` |
| 描画キャッシュ（#397/#480関連） | `_bibCache`／`_renderListDiff`の`old`/`oldIndex`（asinキー、#480で描画のみ`${asin}#${n}`へ変更予定） | `bookshelf.js`（#480 step2-decisionと同じ） |

→ `userData.hiddenBooks`（配列）・`bookshelves.<id>.books`（配列）も同様にasinを要素に持つ（後述のmigrateUserDataが参照）。

**既存の部分対応（重要な発見）**: 本詳細モーダルに「オリジナルASIN」を編集するUIが既にあり（`bookshelf.js:13791-13928`）、変更時に

1. 新ASINが既存の別本と重複していれば保存をブロックする（`bookshelf.js:13822-13828`）
2. `migrateUserData(oldAsin, newAsin)`（`bookshelf.js:13901-13926`）が呼ばれ、**notes・hiddenBooks・bookshelves[].books を新ASINへ移行する**

という、案A（asin付け直しの案内）の土台にできる既存コードが存在する。
ただし`migrateUserData`は**exclusionsとbookOrderを移行していない**（抜け漏れ）。これは「別asin問題」とは別に、この既存機能自体の既知のバグとして記録しておく（対処の実装範囲に含めるかはstep2で検討）。

## 2. 項目ごとの実測結果

実際のコード（`BookshelfManager`クラス＝window公開済みでテスト可能・他は実コードと同一ロジックを動かして確認）を使い、asin=`B00I8AT186`の「上巻」「下巻」2冊を模したデータで検証した（vitest・jsdom環境、`tests/unit/`に一時テストを置いて実行→結果確認後に`_trash/`へ退避、commit対象には含めない）。

| 項目 | 共有する/しない | 実測結果・根拠 |
|---|---|---|
| notes（短文メモ） | **共有する** | `BookshelfManager.setMemo('B00I8AT186','上巻の感想')` の後、同じasinで`resolveMemo`を呼ぶと常に`'上巻の感想'`が返る（`notes[asin]`が1個のオブジェクトである以上、2冊側は区別不能）。実行ログ: `[notes] 上巻へのメモが下巻の resolveMemo にも出た: 上巻の感想` |
| notes.rating（評価） | **共有する** | `setRating('B00I8AT186',5)`→`resolveRating`はどちらの「本」から呼んでも5。実行ログ: `[notes.rating] 上巻の評価が下巻にも出た: 5` |
| exclusions（除外） | **共有する** | 上巻のasinを`exclusions`配列に1件追加し、`excludedASINs.has(b.asin)`で2冊をフィルタすると**両方**が除外対象に一致する。実行ログ: `[exclusions] 上巻だけ除外したつもりが一致した本: [ '上巻', '下巻' ]` |
| bookOrder（並び順） | **共有する（かつ区別そのものが不可能＝最も重い）** | all棚の`books`配列は`library.books.map(b=>b.asin)`で作られるため、`bookOrder.all`には同じasinが2回入る（`['A0','B00I8AT186','B00I8AT186','A3']`のような配列）。`reorderBooks`（`bookshelf.js:2809-2814`）と同一の`order.indexOf(draggedASIN)` → `splice` ロジックを動かすと、**「下巻」だけを動かすつもりの操作が、常に配列中で先に見つかった方（=実体としては上巻か下巻か区別できない片方）を動かす**。実行ログ: `[bookOrder] 下巻だけ動かしたつもりの結果: [ 'B00I8AT186', 'A0', 'B00I8AT186', 'A3' ]`。2冊を別々の位置に並べるという表現自体がasin配列では不可能（notes/exclusionsの「値が同じになる」よりさらに重い＝「操作対象を選べない」）。 |
| 長文メモ | **共有しない（タイトルが違えば）** | ファイル名が`${asin}__${sanitizeFileName(title)}.md`（`storage.js:419`）で、titleも使われる。上巻/下巻はtitleが異なるため別ファイルになる。※タイトルが完全一致する場合（B0F2TC5B79型）は衝突するが、これは実害小の型として元々許容されている。 |
| hiddenBooks（非表示） | **共有する** | `migrateUserData`が配列の`indexOf`で1箇所だけ書き換える実装（`bookshelf.js:13909-13912`）＝bookOrderと同種の「配列に同じasinが複数あると区別不能」の構造。非表示設定も同様に両方へ作用する。 |
| プラグインのnote保存（`updateNote`） | **共有する** | `plugin-api.js:322-330`はコアの`notes[asin]`を直接読み書きするため、コアのnotesと同じ共有が起きる。プラグイン独自の保存領域は確認できなかった（確認した3プラグイン相当のAPIはコアのnotesを経由するのみ）。 |
| 公開記事のasin参照 | **共有する（本文には現れないが解決時に取り違える）** | `publish-article-generator.js:930`の`libMap`は`asin→book`の1対1マップなので、`library.books`に同じasinが2件あれば**後に処理された方で上書きされる**（Map構築時に先の要素が消える）。記事ブロックがどちらの本を指していたかによらず、常に同じ1件が解決される。 |

## 3. #480の調査結果との整合

- `scripts/verify/480-step1-investigation.md`（issue-480のworktree）の「(4) asinをキーにしているデータ構造」節（58-66行）は、今回の洗い出しと一致する（notes/bookOrder/exclusions/libraryBooks/bookshelves/`_bibCache`/`_renderListDiff`）。同メモも「描画キーだけを別IDに変える案(b)は…notes/bookOrder/exclusions側の整合は保てる（これらは正しい運用なら『本1冊=1asin』を前提にしているため…問題が既にそこにある）」と結論しており、本イシューの前提（#480では解決しない）と矛盾しない。
- ②申し送りの訂正どおり、#480の決定は「保存するuidの新設を見送り、描画の中だけで`${asin}#${n}`をキーにする」であり、保存データ側（notes/bookOrder/exclusions等）には触れていない。本イシューの対処範囲と#480は非重複。
- `tmp/401`は#480調査時点では存在した一時データ（gitignore対象）だが、本ステップ実行時点で`/home/kuroko/worktrees/bookshelf/issue-480/tmp/401`は消失していた（worktree再作成のため）。代わりに固定パス`/home/kuroko/GitHub/bookshelf/tmp/401/library.json`が残っており、こちらを使用した。

## 4. 未確認・申し送り

- プラグインが独自のストレージ領域（`plugins/<id>/data/`）にasinをキーにしたデータを持つケースは、サンプルプラグイン群までは確認していない（時間都合で見送り）。コアAPI経由（`updateNote`）以外の経路は未確認。
- 同期マージ（GitHub/ハブ/LocalFSの読込時）でnotes/exclusions/bookOrderのキーが重複asinに対してどう振る舞うかは未確認（#480 step1でも同種の「同期マージでの重複排除有無は未確認」と記録されている）。
- `migrateUserData`のexclusions/bookOrder移行漏れは、対処範囲に含めるかをstep2で判断する（含めないなら07_残検討事項への別記録を検討）。
