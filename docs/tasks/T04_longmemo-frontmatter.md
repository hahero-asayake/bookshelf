# T04: 長文メモの frontmatter 非表示

状態: 未着手 / 依存: なし

## 目的

長文メモ (`private/books/<ASIN>__<title>.md`) の YAML frontmatter は Obsidian 用メタであり、アプリ内エディタ (EasyMDE) でユーザに見せる必要がない。**アプリ内では隠し、ファイルには維持する** (ADR-024)。

- ファイル形式は変えない (Obsidian のプロパティ表示・dataview 互換を維持)
- 新規作成テンプレート (`buildBookMemoTemplate`) も frontmatter 付きのまま変更しない
- 保存時に frontmatter の `updated:` を現在時刻に自動更新する

## 変更対象

- `js/bookshelf.js`: `_openBookMemoInAppEditor(asin, book)` / `saveBookMemoFromModal()`
- (必要なら) `js/storage.js`: frontmatter の分離・結合ヘルパを置く場合

## 実装手順

1. **分離ヘルパ** `splitFrontmatter(text)` を追加:
   - テキストが `---\n` で始まり、次の `\n---\n` (または `\n---` + 行末) までを frontmatter ブロックとして分離 → `{ frontmatter: string|null, body: string }`
   - 先頭が `---` でなければ `{ frontmatter: null, body: text }` (frontmatter を**勝手に追加しない**)
   - 正規表現は最小マッチで。本文中の `---` (水平線) を誤検出しないよう「先頭一致 + 最初の終端のみ」とする
2. **結合ヘルパ** `joinFrontmatter(frontmatter, body)`:
   - frontmatter が null なら body をそのまま返す
   - frontmatter 内の `updated:` 行を現在時刻 (ISO 8601) に置換。`updated:` 行が無ければ末尾 (閉じ `---` の直前) に追加。他の行 (asin/title/created/ユーザが足した任意キー) は**一切変更しない**
3. `_openBookMemoInAppEditor`:
   - 読み込んだ内容 (既存ファイル or テンプレート) を `splitFrontmatter` に通し、**body だけを EasyMDE に渡す**
   - frontmatter はモーダル開閉の間インスタンス変数 (例: `this._bookMemoFrontmatter`) に保持
4. `saveBookMemoFromModal`:
   - EasyMDE の値 (body) を `joinFrontmatter(this._bookMemoFrontmatter, body)` で結合して `storage.writeBookMemo`
   - 保持変数はモーダル close でクリア
5. `obsidian` / `system` で開く経路は**変更しない** (外部エディタではファイル全体が見えるのが正)

## 受け入れ基準

1. frontmatter 付きの既存メモを開く → エディタに**本文のみ**表示される
2. 編集して保存 → ファイルに frontmatter が維持され、`updated:` が更新され、他の frontmatter 行と本文が正確に保存される (前後比較で frontmatter の差分が updated 行のみであること)
3. frontmatter の無いファイル → そのまま開けて、保存しても frontmatter が**追加されない**
4. 新規作成 → テンプレートの frontmatter はファイルに書かれるが、エディタには本文 (見出し以下) のみ表示
5. 本文先頭に `---` (水平線) があるメモで誤分離しない
6. console エラー 0

⚠️ 検証はテスト用の一時 md (`_trash` に作るか、検証後に元へ戻せる新規本) で行い、実メモを壊さない。読み込みテストに実メモを使うのは可 (書き込まない限り)。

## 設計書同期

- 03_詳細設計書: VirtualBookshelf の長文メモ系メソッドにヘルパを追記
- 06_データ仕様書: books/*.md 節に「frontmatter はアプリ内エディタでは非表示・保存時 updated 自動更新」を反映し、07 への課題リンクを削除
- 07_残検討事項: T5 の frontmatter 行を削除

## コミット

`feat: 長文メモのfrontmatterをアプリ内エディタで非表示に (updated自動更新) (設計: 03/06 更新)`
