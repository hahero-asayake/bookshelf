# U6 step2 対象確定（#523）

②判断（2026-11-04 承認メモ）に基づき、step1の11個から3系統を除外する。

## BookList対象（6個・今回のU6で扱う）

| # | ファイル:行 | 関数名 | 画面 |
|---|---|---|---|
| 1 | bookshelf.js:2423 | `createBookElement` | 本棚メイン一覧 |
| 3 | bookshelf.js:13523 | `renderBookList` | 取込候補一覧 |
| 4 | bookshelf.js:13391 | `renderExclusionsList` | 除外一覧 |
| 5 | bookshelf.js:1292 | `_renderPaletteResults`（本の行部分のみ） | ⌘K検索結果 |
| 10 | bookshelf.js:2401 | `_duplicateAsinBadgeItem` | 複数画面から呼ばれる付属部品（本カードの一部） |
| 11 | dashboard.js:928 | `_renderRecentBooks` | ホーム「最近追加した本」widget |

## 対象外（5個・理由つき）

| # | 関数 | 理由 |
|---|---|---|
| 2 | `showBookDetail`（bookshelf.js:2823） | 本の詳細は画面であり、カードではない。**U8**（残りの画面をモジュールに分ける）で扱う。ヘッダー部分だけ切り出すと作りが2か所に分かれるため見送り |
| 6 | `_artRenderDrawer`（bookshelf.js:11691） | 記事エディタ系。**U7**で記事エディタを画面モジュールへ移し、そのあと**X3**で本の選び方を作り直す。今切り出すと二度手間 |
| 7 | `_artRenderBlock`（bookshelf.js:10688） | 同上（U7→X3） |
| 8 | `_artRenderShelfBlock`（bookshelf.js:10879） | 同上（U7→X3） |
| 9 | `_artRenderShelfFs`（bookshelf.js:10792） | 同上（U7→X3） |

→ U7・X3 側で着手する時は、本の行描画を BookList 利用前提で作ることを引き継ぐ（U7/X3着手時にこのメモを読むこと）。

## HTMLエスケープ統一（U6の範囲＝BookList対象とは別扱い・7つ全部を対象にする）

②承認「エスケープ7つを実測で数えたことともよい」「統一先(5文字・nullは'')でよい」「#520完了済み・publish-article-generator.jsを触ってよい」に基づき、
BookList対象に入らない関数が使うエスケープ（記事エディタ系・本の詳細・公開記事生成）も含めて**7つ全部を1つに統一する**（エスケープの一本化はBookListの対象範囲とは独立した完了条件）。
