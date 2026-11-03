# U6 step3 BookList新設（#523）

## 対象（tmp/523/step2-scope.mdの6個）とBookList関数の対応

| 元の関数 | 画面 | BookList関数 |
|---|---|---|
| bookshelf.js `createBookElement` | 本棚メイン一覧(.book-item) | `BookList.cardInnerHtml(book, opts)` |
| bookshelf.js `renderBookList` | 取込候補一覧(.book-selection-item) | `BookList.selectionItemInnerHtml(book, opts)` |
| bookshelf.js `renderExclusionsList` | 除外一覧(.exclusion-item) | `BookList.exclusionItemHtml(book, asin)` |
| bookshelf.js `_renderPaletteResults`(本の行部分) | ⌘K検索結果 | `BookList.cmdkEntry(book)` |
| bookshelf.js `_duplicateAsinBadgeItem` | 付属バッジ(createBookElementから呼ばれる) | `BookList.duplicateAsinBadgeItem(book, dupGroup)` |
| dashboard.js `_renderRecentBooks` | ホーム「最近追加した本」(.widget-book-cell) | `BookList.recentCellHtml(book, opts)` |

いずれも**出力するHTMLとクラスは変えていない**（既存のテンプレート文字列をそのままBookListへ移植し、`this`依存はopts経由のコールバック/値にした）。

## 付随して統合したもの

- `_kindleBadgesHtml`と`_allBadgesHtml`内の同一ロジック（Revoked/KU/Prime判定）が重複していたため、`BookList.kindleBadgesHtml`/`BookList.allBadgesHtml`に統合。showBookDetail（U8対象・BookList対象外）など他の既存呼び出し元も、このヘルパーを使う形に変えた（表示は変わらない。関数の実装を1か所にしただけ）。

## ui-components.jsの未使用関数確認

- `pickRow`・`tree`（選択可能な本棚ツリー描画）が外部から一度も呼ばれていないことをgrepで確認 → 撤去。
- `rowCore`は`js/bookshelf.js:6245`が使用中のため残す。`esc`/`keyOf`は公開APIとして残す（外部未使用だが、小さい純粋関数で害がないため）。

## grep件数（完了条件：対象6関数がすべてBookList経由）

- 前（step2終了時点）：対象6関数内で`BookList.`呼び出し = **0件**（BookList.js自体が存在しなかった）
- 後（本commit）：対象6関数すべてで`BookList.`呼び出し = **各1件以上・6/6件**

## 検証結果

- `npx vitest run`: 55 files / 848 tests pass
- `node scripts/check-version-bump.mjs --range=origin/main..HEAD`: OK
- E2E（PORT=8123）: smoke / critical-path / dashboard-recent-books / import-paste / ux-quickwins / book-detail-entries = **29 passed**
  - 除外一覧(.exclusion-item)専用のE2Eは見当たらなかった（grep確認済み）。単体テスト・commit前後のロジック比較（旧テンプレート文字列をそのまま移植）で代替。
- commit: `e4022e0 refactor(ui): 本のカード・行の描画を BookList に寄せる(U6 step3)`（Issue: #523・まだpushしていない）

## 次ステップ（step4）への申し送り

- 画像54枚の差分確認（`e2e-diff-main.mjs --visual`）・フルe2e-diff-main・性能前後比較（sort-perf-budgetの前値はtmp/523/step1-survey.md §4に記録済み）をstep4で実施する。
- 除外一覧のE2Eが無いため、step4のe2e-diff-mainや画像比較でここが拾えるか確認する。拾えなければ、目視確認（ブラウザで除外→一覧確認）をstep4で追加する。
