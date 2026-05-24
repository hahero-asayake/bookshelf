# bookshelf プラグインサンプル

このディレクトリは bookshelf アプリ用プラグインのサンプル集です。
本体に組み込まれるわけではなく、参考実装として配置しています。

## 収録プラグイン一覧

| id | 種別 | 説明 |
|---|---|---|
| [hello-bookshelf](hello-bookshelf/) | 基礎 | API 利用例。UI ボタン追加 + イベント購読 |
| [highlights-builtin](highlights-builtin/) | 表示 | 本詳細モーダルに Kindle ハイライトを表示 |
| [series-grouping](series-grouping/) | フィルタ | 漫画シリーズを第1巻だけ代表表示に折りたたむ |
| [dark-theme](dark-theme/) | テーマ | 暗色テーマに切替（トグルボタン付） |
| [reading-stats](reading-stats/) | 統計 | 蔵書総数 / 年別取得 / 評価分布 / 本棚別 Top5 |
| [random-pick](random-pick/) | 操作 | ランダムに1冊選んで開く（右クリックで未読のみ） |
| [csv-export](csv-export/) | エクスポート | 蔵書を CSV (UTF-8 BOM 付) でダウンロード |
| [export-markdown](export-markdown/) | エクスポート | 本棚別セクション付きの Markdown でダウンロード |
| [duplicate-detector](duplicate-detector/) | 分析 | 同タイトル+著者の重複候補を検出（シリーズ除外） |
| [author-grouping](author-grouping/) | 表示 | 本詳細に「この著者の他の蔵書」を表示 |
| [acquisition-heatmap](acquisition-heatmap/) | 統計 | 年×月の取得数ヒートマップ |
| [unrated-list](unrated-list/) | 操作 | 未評価本の一覧 + クイック評価ボタン |
| [reading-goal](reading-goal/) | 統計 | 年間読書目標と進捗バー（★4以上を読了とみなす） |
| [quick-switcher](quick-switcher/) | 操作 | Ctrl/Cmd+K で本・本棚をインクリメンタル検索 |
| [last-acquired](last-acquired/) | 統計 | 直近 N 日に取得した本を一覧 |
| [memo-templates](memo-templates/) | 編集 | 本モーダルのメモ欄にテンプレ挿入ボタン |

## ローカルにインストールして試す

1. 同期フォルダ (Obsidian vault 等) に `plugins/<id>/` を作成
2. このディレクトリの `manifest.json` と `index.js` をコピー
3. bookshelf アプリで「🧩 プラグイン管理」を開く
4. 「有効」チェックを入れる → その場で activate

例: `hello-bookshelf` の場合
```
<同期フォルダ>/
  plugins/
    hello-bookshelf/
      manifest.json
      index.js
```

## GitHub から bookshelf にインストールしてもらう場合

manifest.json + index.js を含む GitHub リポジトリを作り、その URL を
bookshelf の「プラグイン管理」→「GitHub からインストール」に貼る。

受け付ける URL 形式:
- `https://github.com/owner/repo` (main / repo ルートを想定)
- `https://github.com/owner/repo/tree/branch` (branch / repo ルート)
- `https://github.com/owner/repo/tree/branch/sub/path` (branch / sub/path)

## manifest.json の最低スキーマ

```json
{
    "id": "your-plugin-id",
    "name": "表示名",
    "version": "0.1.0",
    "description": "短い説明",
    "publishable": false,
    "files": ["index.js"],
    "dependencies": []
}
```

| key | 説明 |
|---|---|
| `id` | 必須。同期フォルダ `plugins/<id>/` のディレクトリ名と一致させる |
| `name` | 管理画面で表示される名前 |
| `version` | セマンティックバージョン推奨 |
| `description` | 1〜2行の説明 |
| `publishable` | true なら公開エクスポートに含める。閲覧者にも適用されるプラグインだけ true |
| `files` | manifest 以外でコピーする追加ファイル。少なくとも `index.js` |
| `dependencies` | 他のプラグイン id を列挙。未インストール / 無効ならスキップ |

## index.js の構造

ES Module。`activate(api, manifest)` を export する。

```js
export function activate(api, manifest) {
    // api = window.bookshelfAPI
    // 詳細は js/plugin-api.js を参照
}
```

## API 主要メソッド

| 種別 | メソッド |
|---|---|
| イベント | `api.on(event, handler)`, `api.off(...)` |
| 読み取り | `api.getBooks()`, `api.getBook(asin)`, `api.getBookshelves()`, `api.getBookshelf(internalId)`, `api.getBookshelfBySlug(slug)`, `api.getNotes()`, `api.getNote(asin)` |
| 書き込み | `api.updateNote(asin, partial)`, `api.refreshUI()` |
| UI 拡張 | `api.addUIButton({ id, where, label, onClick, emoji, title })`, `api.removeUIButton(id)` |
| 蔵書フィルタ | `api.registerBookFilter(fn)` — `fn(books) => books` を applyFilters の末尾で適用 |
| エクスポート | `api.registerExportTransform(fn)` |
| ストレージ | `api.writePluginFile(pluginId, relPath, text)`, `api.readPluginFile(pluginId, relPath)` |

詳細は [js/plugin-api.js](../js/plugin-api.js) を参照。

## イベント一覧

| event | data |
|---|---|
| `book:added` | `{ book }` |
| `book:updated` | `{ book, prev }` |
| `book:removed` | `{ asin }` |
| `books:changed` | `{}` — 同期完了などで蔵書配列が差し替わったタイミング |
| `bookshelf:created` | `{ meta }` |
| `bookshelf:updated` | `{ meta, prev }` |
| `bookshelf:removed` | `{ internalId }` |
| `note:updated` | `{ asin, note }` |
| `export:before` | `{ state }` |
| `export:after` | `{ result }` |
| `sync:completed` | `{}` |
| `ui:book-modal-opened` | `{ asin }` — 本詳細モーダル表示直後 |
