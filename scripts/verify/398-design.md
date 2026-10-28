# #398 step1: #397との重なり確認と並び替え共有化の設計

## #397との重なり（結論：重ならない。着手可）

- `git status -sb` → `## main...origin/main`（ahead/behind無し）。`git log -10` の HEAD は
  `f01c257 docs: #397 step5 push・本番確認・CI(進行中)の結果を397-results.mdに追記`。
  #397の実装commit（`9f6ef31` perf: 並び替え(特に昇順/降順)の重さをA1/A4/A5/A6で軽減）は
  既にorigin/mainにpush済み・**#397は完了済み**。
- 未コミットは `scripts/verify/*.mjs`等の調査スクリプトのみ（`git status`参照）。
  `js/bookshelf.js`・`js/dashboard.js` に未コミット変更は無い。
- `applySorting()`（js/bookshelf.js:1687-1724）は#397 A4/A6を含んだ最新形。これを前提に設計する。

## 現状の実装（確認済み・行番号は現HEAD基準）

- `applySorting()` js/bookshelf.js:1687-1724: `sortOrder==='acquiredTime'` は数値parse比較、それ以外は
  `this._sortCollator`（Intl.Collatorのシングルトン・#397 A6）でシュワルツ変換ソート。`sortOrder==='custom'`
  の時はkeyが全件空文字になり順序を変えない（custom自体の並べ替えは別経路）。
  `_sortedCacheKey`/`_sortedCacheRef`（配列参照一致）で`toggleSortDirection()`のreverse()高速化に使う。
- `_orderedBooksToRender()` js/bookshelf.js:1960-1976: `sortOrder==='custom'`の時だけ現在開いている本棚の
  `userData.bookOrder[currentBookshelfId]`で`filteredBooks`（現在の本棚に絞った配列）を並べ替える。
  一覧表示（`renderStandardView`/`_renderListDiff`）専用。
- `_renderBookshelfCard()` js/bookshelf.js:14780〜（旧行番号14712、#397でシフト）: `userData.bookOrder[bookshelf.id]`
  **のみ**見る。`sortOrder`/`sortDirection`は一切見ない＝今回のバグの実体。
- `BookManager.getAllBooks()` js/book-manager.js:513-515: `this.library.books`の**参照をそのまま返す**。
  push（追加: :109, :385）・splice（削除: :419）・`library.books=[]`（全消去: :435）は参照を変えるが、
  `updateBook()`（:450-472、フィールド書き換えのみ）は**参照を変えない**（in-place）。
  `this.books = this.bookManager.getAllBooks()`を呼び直しても同じ参照が返る箇所がある（例: js/bookshelf.js:13605、
  `updateBook`直後）＝**`this.books`の参照一致だけでは蔵書変更を検知できない**。これは#397 A1が
  `_bookCardKey`で参照一致を使えず`book.__bibV`を導入した理由と同根（js/bookshelf.js:1982-1995のコメント参照）。
- custom順の`userData.bookOrder[shelfId]`は保存のたびに**配列を再代入**している（js/bookshelf.js:1548, :2681等＝
  `this.userData.bookOrder[key] = newOrder`）＝こちらは参照一致で安全に使える。

## 設計（step2で実装する形）

### A. 比較ロジックの共有（1か所）
`applySorting()`内の比較分岐（acquiredTime数値比較／Intl.Collator比較、両方とも`sortDirection`で反転）を
`_sortComparator(sortOrder, sortDirection)`という1つのメソッドに切り出し、`(a,b)=>number`の比較関数を返す。
`applySorting()`はこの関数を使ってシュワルツ変換ソートする（配列参照維持・キャッシュ更新は現状のまま変えない）。
ハイライト側（C）も同じ`_sortComparator`を使う＝依頼の「1か所で共有」を満たす。custom順はこの関数の対象外
（従来通りbookOrder経由）。

### B. 全蔵書の並び順キャッシュ（913冊でも軽く）
- `BookManager`に蔵書変更の版数カウンタを追加: `_rev`を増やす小さいヘルパーを追加し、既存の5箇所
  （import時の既存本更新=約:90付近の`__bibV`加算の隣、新規push=:109・:385、削除splice=:419、
  全消去=:435、`updateBook`のフィールド書換=:450-472）の最後で呼ぶ。`getRev()`で公開。
  参照一致が使えない理由は上記の通り確認済み。
- `VirtualBookshelf._getLibrarySortedAsins()`を新設: キャッシュキー=`` `${sortOrder}|${sortDirection}|${bookManager.getRev()}` ``。
  キー不一致時だけ`this.books`全体を`_sortComparator`で1回ソートし、`{ asins:[...], rank: Map(asin→index) }`を
  保存して返す。`sortOrder==='custom'`の時はこの関数を使わない（CでbookOrder分岐）。

### C. `_renderBookshelfCard`の変更
- `sortOrder==='custom'`: 現状のbookOrder分岐を変えない。
- それ以外: Bのキャッシュを使う。特殊本棚「all」は`asins.slice(0,8)`で直接取れる（ソート済み配列の先頭）。
  通常本棚は`bookshelf.books`（その本棚サイズ＝小さい）だけを`rank`で並べ替えて`slice(0,8)`
  （本棚ごとに913冊を並べ直さない＝Bの全体ソートを使い回す）。

### D. 変更の反映（ホームに戻った時／ホーム表示中）
- `_saveSortPrefs()`（js/bookshelf.js:~1744）の末尾に、`updateBookshelfSelector()`が既に使っている同じガード
  （`if (this.dashboard && document.body.classList.contains('app-view-main')) this.dashboard.render();`）を追加。
  「ホームを表示中に変えた場合」の反映用（**現状の画面構成では並び順popoverはホーム表示中は`.view-bookshelf`が
  画面外＋`pointer-events:none`で開けない＝到達は未確認。将来到達可能になった場合の保険としても安全・コストは
  低いので実装する）。
- ホームへ戻るナビゲーション（`_applyRoute`のview==='main'分岐、js/bookshelf.js:8077-8080）が呼ぶ
  `renderBookshelfOverview()`は**現在は死んだno-op**（`#bookshelves-grid`がDOMに無く`if(!grid)return`、
  js/bookshelf.js:14732-14745のコメント「ホーム=ダッシュボードに置換されたため使わない」）。
  `reorderBooks()`（bookOrder変更）や`toggleSortDirection()`もdashboard.render()を呼んでいない。
  → **「ホームに戻ると最新のsortOrderで出るか」は未確認（コード読みでは怪しい＝no-op経由で再描画されない
  可能性がある）**。step2の最初にE2Eで現状を固定（赤になるはず）し、`_applyRoute`の該当分岐に
  `if (this.dashboard) this.dashboard.render();`を足して直す。bookOrder（custom）側のドラッグ直後の反映は
  依頼の前提「ドラッグで決めた順があればその順」が既に成立している記述を信じ、今回はsortOrder/sortDirection
  専用の2箇所（_saveSortPrefsとhome遷移）だけ直す（reorderBooksの反映タイミングは依頼の前提が正しければ
  既存動作のはずで、今回のスコープ外として触らない）。

## 未確認（②へ：E2E前に実機/コード読みのみで判断した点）

- 「ホームに戻ったら最新sortOrderで出るか」は上記の通りコード読みでは怪しいが未実測。step2で最初にE2Eを書いて
  現状の挙動を固定してから直す。
- 並び順popoverがホーム表示中に到達可能かは未確認（CSSでは`.view-bookshelf`はホーム表示中オフスクリーン＋
  pointer-events:noneに見えるが、⌘Kコマンドパレット等の別経路は洗っていない）。Dの対応はどちらでも安全。
