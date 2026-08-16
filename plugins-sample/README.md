# bookshelf プラグインサンプル

標準同梱の5機能と、ウィジェットパッケージの核となる `reading-goal` の実装（本体コアには組み込まれず、プラグイン機構の上で動く）。
プラットフォーム化されたプラグインAPI (registerCommand / registerWidget /
registerDetailSection / injectCSS / registerBookFilter / イベント) の実例でもある。

## 収録プラグイン一覧

| id | 使う拡張点 | 説明 |
|---|---|---|
| [author-grouping](author-grouping/) | **registerDetailSection** | 本詳細に「この著者の他の蔵書」 |
| [dark-theme](dark-theme/) | **injectCSS** + command | CSS 変数を上書きして暗色テーマに |
| [highlights-builtin](highlights-builtin/) | **registerDetailSection** | 本詳細ペインに Kindle ハイライトを表示 |
| [series-grouping](series-grouping/) | **registerBookFilter** + **registerActiveFilter** | シリーズの第2巻以降を折りたたむ。属性プロバイダで「フィルタ中」を申告し、0件時の空状態・解除導線を正す |
| [memo-templates](memo-templates/) | **registerDetailSection** | メモ欄にテンプレ挿入ボタン |
| [reading-goal](reading-goal/) | **registerWidget** | 年間読書目標と進捗バー（★4以上・今年取得を読了とみなす） |

> `author-grouping` / `dark-theme` / `highlights-builtin` / `series-grouping` / `memo-templates` の5個は
> 標準機能として同期フォルダ初期化時に自動配置され、消しても次回起動で復元される（無効化は可能）。
> `reading-goal` はウィジェットパッケージの核として同梱。
>
> 旧 `quick-switcher` は本体の ⌘K コマンドパレットに置き換わったため廃止。
> `view-coverflow / view-mosaic / view-compact / view-timeline`（ビュー系の派生）と
> `acquisition-heatmap / last-acquired / unrated-list / duplicate-detector` は整理のため
> リポジトリ外（`_trash/`）に退避。必要なら新APIで復活可能。
> `csv-export` / `export-markdown` / `hello-bookshelf` / `random-pick` / `view-spines` /
> `per-shelf-memo` / `publish-credit` は標準機能5個への絞り込みに伴い repo から削除
> （git 履歴から復元可）。`hello-bookshelf` の最小例は [docs/plugin-dev.md](../docs/plugin-dev.md) に直書き。

## インストールして試す

1. 同期フォルダ (Obsidian vault / GitHub repo 等) に `plugins/<id>/` を作成
2. このディレクトリの `manifest.json` と `index.js` をコピー
3. 設定 → プラグイン管理（オプトアウト方式: インストール済みは自動有効）
4. `disabledPlugins` から外れていればその場で activate

GitHub からインストールする場合は manifest.json + index.js を含む repo の URL を
「プラグイン管理 → GitHub からインストール」に貼る:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/branch`
- `https://github.com/owner/repo/tree/branch/sub/path`

## manifest.json スキーマ

```json
{
    "id": "your-plugin-id",
    "name": "表示名",
    "version": "0.1.0",
    "description": "短い説明",
    "icon": "puzzle",
    "publishable": false,
    "files": ["index.js"],
    "dependencies": []
}
```

| key | 説明 |
|---|---|
| `id` | 必須。`plugins/<id>/` のディレクトリ名と一致 |
| `name` | 管理画面の表示名 |
| `version` | セマンティックバージョン推奨 |
| `description` | 1〜2行 |
| `icon` | Lucide アイコン名（ヘッダーボタン等の既定アイコン）。ユーザが override 可 |
| `publishable` | true なら公開ビルドが `data/publish.json`（公開スナップショット・純データ）を収集する。公開ページに自分の貢献を出すプラグインだけ true にする (ADR-042) |
| `files` | manifest 以外でコピーするファイル。最低 `index.js` |
| `dependencies` | 依存プラグイン id。未インストール/無効ならスキップ |

## index.js の構造

ES Module。`activate(api, manifest)` を export する。`api = window.bookshelfAPI`
のプラグインスコープ版で、ここで登録した拡張点は無効化時に**自動で一括解除**される。

```js
export function activate(api, manifest) {
    api.registerCommand({ id: 'x', title: '…', icon: 'rocket', run: () => {} });
    // 任意で deactivate を返す（追加の後始末用。登録解除は自動）
    return { deactivate() {} };
}
```

## API 主要メソッド

| 種別 | メソッド |
|---|---|
| イベント | `api.on(event, handler)` / `api.off(...)` |
| 読み取り | `getBooks()` `getBook(asin)` `getBookshelves()` `getBookshelf(internalId)` `getBookshelfBySlug(slug)` `getNotes()` `getNote(asin)` |
| 書き込み | `updateNote(asin, partial)` `refreshUI()` |
| ナビゲーション | `openBook(asin)` `openBookshelf(slug)` |
| コマンド | `registerCommand({ id, title, icon, keywords, run })` / `removeCommand(id)` |
| ウィジェット | `registerWidget({ id, label, icon, defaultSpan, allowedSpans, render(host, app, config) })` / `removeWidget(id)` |
| 本詳細セクション | `registerDetailSection({ id, render(host, book, ctx) })` / `removeDetailSection(id)` |
| CSS 注入 | `injectCSS(id, css)` / `removeCSS(id)` |
| ヘッダーボタン | `addUIButton({ id, label, title, iconName, onClick })` / `removeUIButton(id)` |
| 蔵書フィルタ | `registerBookFilter(fn)` — `fn(books) => books` を applyFilters 末尾で適用 |
| フィルタ申告 | `registerActiveFilter({ isActive, reset? })` — 「今フィルタ中」を申告。プラグインが畳んで0件にした時の空状態文言と「絞り込みを解除」導線をコアが正す (属性プロバイダ) |
| エクスポート変換 | `registerExportTransform(fn)` — `fn(state) => state`（※ローカル JSON バックアップDL専用。公開SSGには効かない） |
| 公開スナップショット | `data/publish.json` に純データ（`{ footerNote }`）を保存 → 公開ビルドが収集し全ページ＋トップのフッターへ。**公開時にコードは実行されない**・コアが必ず esc・`publishable:true` 必須 (ADR-042) |
| ストレージ | `writePluginFile(rel, text)` / `readPluginFile(rel)` — `plugins/<id>/data/` 配下 (adapter経由でGitHubでも動く) |

詳細は [js/plugin-api.js](../js/plugin-api.js) を参照。

## イベント一覧

| event | data |
|---|---|
| `book:added` | `{ book, reason? }` |
| `book:removed` | `{ asin, reason? }` |
| `book:updated` | `{ book, prev }` |
| `books:changed` | `{}` 蔵書配列が差し替わった（同期完了など） |
| `bookshelf:created` | `{ meta }` |
| `bookshelf:updated` | `{ meta, prev }` |
| `bookshelf:removed` | `{ internalId, meta }` |
| `note:updated` | `{ asin, note }` |
| `export:before` / `export:after` | `{ state }` / `{ result }` |
| `sync:completed` | `{}` |
| `ui:books-rendered` | `{ view }` 本一覧の描画完了 |
| `ui:book-detail-rendered` | `{ asin, book, container }` 本詳細ペイン描画完了 |
| `ui:book-modal-opened` | `{ asin }` ※非推奨（ui:book-detail-rendered の別名） |
