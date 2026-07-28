# プラグイン開発者向けガイド

bookshelf はプラグインで機能を追加できます。コマンドパレット（⌘K）のコマンド、ホーム画面のウィジェット、本詳細パネルのセクション、CSS テーマ、蔵書の絞り込みや書き出しの変換などを、コア本体に手を入れずに足せます。

**実行モデル**: プラグインは同期フォルダの `plugins/<id>/` に置いた `index.js` を、起動時にアプリが ES Module として dynamic import し、そのままユーザーのブラウザ内で実行します。サンドボックスはありません。

> **セキュリティ上の注意**: プラグインは外部のコードとしてアプリと同じページ内で実行され、DOM・localStorage・同期データのすべてに触れられます。利用者には「信頼できる配布元のものだけを導入する」よう案内されます。開発者もこの前提でコードを公開してください。

## 最小プラグイン

`manifest.json` と `index.js` の 2 ファイルだけで動きます。

**manifest.json**

```json
{
    "id": "my-first-plugin",
    "name": "My First Plugin",
    "version": "0.1.0",
    "description": "はじめてのプラグイン。⌘K に蔵書サマリコマンドを足します。",
    "icon": "hand",
    "files": ["index.js"],
    "dependencies": []
}
```

**index.js**

```js
// activate(api, manifest) を export する ES Module。
// api = window.bookshelfAPI.forPlugin(id) が渡される（スコープ付き API）。
export function activate(api, manifest) {
    api.registerCommand({
        id: 'my-first-summary',
        title: 'My First: 蔵書サマリを表示',
        icon: 'hand',
        keywords: 'summary サマリ',
        run: () => {
            alert(`蔵書 ${api.getBooks().length} 冊 / 本棚 ${api.getBookshelves().length} 個`);
        }
    });

    // 任意: deactivate を返すと無効化時に呼ばれる。
    // scoped API 経由の登録物（コマンド・ボタン・CSS 等）は自動解除されるため、
    // API 外で作った副作用の後始末だけを書く。
    return { deactivate() {} };
}
```

**設置場所**: 同期フォルダ（アプリの設定で接続した保存先）の `plugins/my-first-plugin/` に 2 ファイルを置きます。

```
<同期フォルダ>/plugins/my-first-plugin/
├── manifest.json
├── index.js
└── data/          # 任意: プラグイン固有データ（writePluginFile で生成される）
```

**読み込まれるタイミング**: アプリ起動時（同期先の接続後）に `plugins/` 配下を走査し、`settings.disabledPlugins` に載っていないプラグインをすべて読み込みます（オプトアウト方式）。manifest と index.js の取得は並列、`activate` は列挙順に逐次実行され、起動画面に「プラグインを読み込み中… (n/total)」と進捗が出ます。手動で設置した場合はページを再読み込みすると認識されます。

`activate` は同期関数でも `async` でもかまいません。`export function activate` の代わりに default export でも動きます。`deactivate` は戻り値 `{ deactivate }` か、named export `export function deactivate()` のどちらでも登録されます。

## manifest.json リファレンス

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | 一意な識別子（kebab-case 推奨）。フォルダ名と一致させる。GitHub URL からのインストールは `id` が無いとエラーになる |
| `name` | string | | 表示名。プラグイン管理画面とインストール確認ダイアログに出る |
| `version` | string | | バージョン（semver 推奨）。表示用 |
| `description` | string | | 説明文。管理画面の一覧に表示され、絞り込み検索の対象になる |
| `files` | string[] | | インストール時に取得するファイル一覧（既定: `["index.js"]`）。`manifest.json` は常に取得されるので書かなくてよい |
| `dependencies` | string[] | | 依存する他プラグインの id 配列。すべて有効でないと読み込みがスキップされる（自動取得はしない） |
| `publishable` | boolean | | 公開エクスポートにデータを反映するか（既定: false）。`data/publish.json` の純データのみが対象で、コードは公開側で実行されない |
| `icon` | string | | ボタン等に使う [Lucide](https://lucide.dev/icons/) アイコン名（例: `"hand"`, `"target"`）。`addUIButton` で `iconName` を指定しなければこれが使われる |
| `categories` | string[] | | このプラグインが使う拡張点の種別。管理画面にバッジ表示される（無効時でも分かる）。値: `command` / `widget` / `detail` / `view` / `theme` / `button` / `filter` / `export` / `settings`。未指定でも有効化時の登録内容から自動推定される |

manifest.json が JSON として読めない場合、そのプラグインは一覧に載らず読み込まれません。

## API リファレンス

`activate(api, manifest)` に渡される `api` は `window.bookshelfAPI.forPlugin(id)` が返すスコープ付き API です。ここで登録したものはプラグイン無効化時に**すべて自動解除**されます。

### 読み取り

| メソッド | 返り値 | 説明 |
|---|---|---|
| `getBooks()` | Book[] | 全蔵書のコピー |
| `getBook(asin)` | Book \| null | ASIN で 1 冊取得 |
| `getNotes()` | { asin: Note } | 短文メモ・評価（notes）のコピー |
| `getNote(asin)` | Note \| null | 1 冊分の Note（`rating` / `memo`） |
| `getBookshelves()` | Bookshelf[] | 全本棚（浅コピー） |
| `getBookshelf(internalId)` | Bookshelf \| null | internalId で取得（slug フォールバックあり） |
| `getBookshelfBySlug(slug)` | Bookshelf \| null | slug で取得 |
| `getCurrentBookshelf()` | Bookshelf \| null | 現在表示中の本棚。ホーム・検索時は null |
| `getAmazonUrl(bookOrAsin, affiliateId?)` | string \| null | Amazon 商品 URL。`affiliateId` 省略時はユーザー設定を自動付与、`null` 明示で無タグ |
| `getProductImageUrl(bookOrAsin)` | string \| null | 表紙画像 URL |
| `effectiveAsin(bookOrAsin)` | string \| null | 表示・リンク用の有効 ASIN（`updatedAsin` 優先） |

`bookOrAsin` は book オブジェクトでも ASIN 文字列でもかまいません（未所蔵の ASIN も渡せます）。

### 書き込み・ナビゲーション

| メソッド | 説明 |
|---|---|
| `updateNote(asin, partial)` | Note をマージ保存（Promise）。保存・`note:updated` 発火・再描画まで行う |
| `openBook(asin)` | 本詳細パネルを開く |
| `openBookshelf(slug)` | 本棚を開く |
| `refreshUI()` | フィルタ再適用 → 再ソート → 再描画。フィルタ系プラグインのトグル後に呼ぶ |

### 拡張点の登録

| メソッド | 説明 |
|---|---|
| `registerCommand({ id, title, icon?, keywords?, run })` | ⌘K パレットにコマンド追加。`run()` はパレットを閉じてから呼ばれる |
| `removeCommand(id)` | コマンド解除 |
| `registerWidget({ id, label, icon?, defaultSpan?, allowedSpans?, render })` | ホームのウィジェット追加。`render(host, app, config)`。`defaultSpan` 既定 6、`allowedSpans` 既定 `[3,4,6,8,12]` |
| `removeWidget(id)` | ウィジェット解除 |
| `registerDetailSection({ id, render })` | 本詳細パネル末尾にセクション追加。`render(host, book, ctx)`、`ctx = { app, asin, bookshelf }`（`bookshelf` は開いた文脈の本棚、ホーム・検索から開くと null） |
| `removeDetailSection(id)` | セクション解除 |
| `addUIButton({ id, label, title?, iconName?, emoji?, onClick })` | サイドバーにアイコンボタン追加。`iconName` 未指定なら manifest の `icon` |
| `removeUIButton(id)` | ボタン解除 |
| `setUIButtonActive(id, isActive)` | ON/OFF 型ボタンの点灯状態を設定 |
| `injectCSS(id, css)` | `<style id="plugin-style-<pluginId>-<id>">` を注入・更新。無効化時に自動除去 |
| `removeCSS(id)` | 注入 CSS を除去 |
| `registerBookFilter(fn)` | 蔵書一覧のフィルタ。`fn(books) => books`、フィルタ処理の末尾でチェーン適用 |
| `registerExportTransform(fn)` | 書き出しデータの変換。`fn(state) => state`、チェーン適用 |
| `registerActiveFilter({ isActive, reset? })` | 「いま絞り込み中」をコアに申告する属性プロバイダ。0 件時の空状態文言と「絞り込みを解除」導線が正しくなる。`reset()` は状態クリアのみ行い再描画しない・冪等にする契約 |
| `removeActiveFilter(entry)` | `registerActiveFilter` の返り値を渡して解除 |
| `registerSettings(render)` | プラグイン設定画面。`render(host, api)` が設定モーダルの「プラグイン設定」枠に呼ばれる（有効時のみ） |

### 設定・ストレージ・イベント

| メソッド | 説明 |
|---|---|
| `getConfig()` | このプラグインの永続設定のコピー（`userData.settings.pluginConfig[<id>]`） |
| `setConfig(partial)` | 設定をマージ保存（Promise）。同期先にも保存される |
| `writePluginFile(rel, text)` | `plugins/<id>/data/<rel>` へ書き込み（Promise）。同期先未接続だと例外。パスに `..` は不可 |
| `readPluginFile(rel)` | 同パスから読み込み（Promise\<string \| null>）。ローカルフォルダでも GitHub 同期でも動く |
| `on(event, handler)` | イベント購読。解除関数を返す。無効化時に自動解除 |
| `off(event, handler)` | 手動解除 |

### 使い方の例

ウィジェット（ホームのカード）:

```js
api.registerWidget({
    id: 'unrated-count',
    label: '未評価の本',
    icon: 'star',
    defaultSpan: 4,
    render(host) {
        const notes = api.getNotes();
        const n = api.getBooks().filter(b => !notes[b.asin]?.rating).length;
        host.innerHTML = `<strong>${n}</strong> 冊が未評価です`;
    }
});
```

本詳細セクション（同じ著者の本を並べる）:

```js
api.registerDetailSection({
    id: 'same-author',
    render(host, book, ctx) {
        const others = api.getBooks()
            .filter(b => b.author === book.author && b.asin !== book.asin);
        host.textContent = `この著者の他の蔵書: ${others.length} 冊`;
        // ctx.bookshelf で「どの本棚から開いたか」も分かる（null = ホーム・検索）
    }
});
```

プラグイン設定の永続化:

```js
api.registerSettings((host) => {
    host.innerHTML = `<input type="number" class="goal" value="${api.getConfig().goal || 50}">
        <button type="button" class="btn btn-small btn-primary save">保存</button>`;
    host.querySelector('.save').addEventListener('click', async () => {
        await api.setConfig({ goal: Number(host.querySelector('.goal').value) });
        api.refreshUI();
    });
});
```

## イベント一覧

`api.on(event, handler)` で購読します。ハンドラ内の例外はコアが捕捉するのでアプリは止まりません。

| イベント | payload | 発火タイミング |
|---|---|---|
| `book:added` | `{ book, reason? }` | 手動追加（reason なし）/ 除外解除（`reason: 'unexcluded'`） |
| `book:removed` | `{ asin, reason }` | 削除（`'deleted'`）/ 除外（`'excluded'`） |
| `book:updated` | `{ book, prev }` | 予約済み。現在は発火しない（評価・メモは `note:updated` を使う） |
| `books:changed` | `{}` | 同期完了などで蔵書配列が差し替わったとき |
| `bookshelf:created` | `{ meta }` | 本棚の作成（保存確定後） |
| `bookshelf:updated` | `{ meta, prev }` | 本棚の編集 |
| `bookshelf:removed` | `{ internalId, meta }` | 本棚の削除（カスケード削除分も個別に発火） |
| `note:updated` | `{ asin, note }` | 短文メモ・評価の更新 |
| `export:before` | `{ state }` | 全データ書き出しで変換を適用する直前 |
| `export:after` | `{ result }` | 同・適用後 |
| `sync:completed` | `{}` | 同期先への書き込み成功時 |
| `ui:books-rendered` | `{ view }` | 本一覧の描画完了（ビュー系プラグイン向け） |
| `ui:book-detail-rendered` | `{ asin, book, container }` | 本詳細パネルの描画完了（推奨） |
| `ui:book-modal-opened` | `{ asin }` | 非推奨。`ui:book-detail-rendered` の直後に発火する旧名エイリアス |

## 配布とインストール

利用者に使ってもらう経路は 2 つです。

### 1. GitHub リポジトリに置いて URL でインストール

`manifest.json` と `index.js` を GitHub の公開リポジトリに置き、その場所の URL を利用者に案内します。利用者はアプリの **設定 → プラグイン → 「新しいプラグインを追加」→ リポジトリURLからインストール** に URL を貼り付けます。

受け付ける URL の形式:

```
https://github.com/owner/repo                        # main ブランチのルート
https://github.com/owner/repo/tree/branch            # 指定ブランチのルート
https://github.com/owner/repo/tree/branch/sub/path   # リポジトリ内のサブフォルダ
```

インストールの流れ: `manifest.json` を取得 → 確認ダイアログ（id / name / version / publishable と警告文を表示）→ `files` のファイルを取得 → 同期フォルダの `plugins/<id>/` へ保存 → 即時有効化（再読み込み不要）。

このリポジトリの `plugins-sample/` も同じ方法でインストールできます。例:

```
https://github.com/hahero-asayake/bookshelf/tree/main/plugins-sample/hello-bookshelf
```

### 2. 同期フォルダへ手動設置

同期フォルダの `plugins/<id>/` に `manifest.json` と `index.js` を直接置き、ページを再読み込みします。開発中はこちらが手軽です（編集 → リロードの繰り返し）。

## デバッグのコツ

- **DevTools のコンソールが基本**。読み込みの成否は `[pluginLoader] <id> v<version> 読み込み完了` / `読み込み失敗:` のログで分かります。イベントハンドラ・ウィジェット・セクションの `render` 内の例外もコアが捕捉して `console.error` に出します（アプリ本体は落ちません）。
- **読み込み失敗時の挙動**: 失敗したプラグインはスキップされ、他のプラグインとアプリ本体は動き続けます。失敗理由は設定 → プラグインの該当カードに「読み込み失敗」として表示されるほか、コンソールから `window.bookshelf.pluginLoader.failedToLoad` でも確認できます（`id → エラーメッセージ` の Map）。依存不足の場合は「依存プラグイン不足: <id>」になります。
- **`activate` が見つからない**: `index.js` に `activate` の named export も default export も無い場合は警告が出て何も登録されません。ES Module として書けているか（`export function activate` があるか）を確認してください。
- **disabledPlugins**: 有効・無効は `settings.disabledPlugins`（載っている id だけ無効）で管理されます。設定 → プラグインのトグルで切り替えると、無効化時に登録物（コマンド・ボタン・CSS・イベント等）が一括解除されます。動作検証では「無効化 → 有効化」で登録・解除が対で動くかも確認してください。
- **コンソールからの動作確認**: `window.bookshelfAPI` がグローバルにあるので、`window.bookshelfAPI.getBooks().length` のように読み取り API をその場で試せます。
- **`writePluginFile` が失敗する**: 同期先が未接続だと例外になります。先に設定で保存先（ローカルフォルダ / GitHub / ハブ）を接続してください。
- **CSS の後始末**: `injectCSS` を使っていれば無効化時に自動で剥がれます。`<style>` を自前で `document.head` に足した場合や MutationObserver を使った場合は、`deactivate` で自分で除去・`disconnect()` してください。
