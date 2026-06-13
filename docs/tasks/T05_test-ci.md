# T05: テスト基盤 + GitHub Actions CI

状態: ✅ 完了 (2026-06-13) / 依存: なし (T07 以降の前提)

## 目的

リグレッション検知を Playwright 手動検証だけに頼っている。**Vitest (ドメインロジック) + Playwright smoke (起動・基本操作) + GitHub Actions** を整備し、以降の大型タスク (アダプタ・公開・分割) の安全網にする。

## 方針

- アプリ本体はビルドレスのまま (テスト用 devDependencies のみ追加。アプリの `<script>` 構成は変えない)
- クラスは `window.<Class>` 公開のため、Vitest は **environment: jsdom** でスクリプトを import し `window` から取得する
- CI は実データに依存しない (フィクスチャ同梱)

## 実装手順

### Step 1: パッケージ初期化

1. `package.json` 新規作成 (`private: true`)。devDependencies: `vitest`, `jsdom`, `@playwright/test`。scripts: `test` (vitest run), `test:e2e` (playwright test)
2. `package-lock.json` を commit に含める。`node_modules/` を `.gitignore` に追加 (無ければ作成)

### Step 2: ユニットテスト (tests/unit/)

`vitest.config.js`: `environment: 'jsdom'`。各テストは対象スクリプトを `import '../../js/bookshelf-manager.js'` のように読み込み、`window.BookshelfManager` を取得。`generateInternalId` 等のグローバル依存は先にスタブを `window` に生やす (依存は実行して特定する)。

**bookshelf-manager.test.js** — fake app (`{ userData: { bookshelves: […], notes: {}, bookOrder: {} } }`) を組み立てて:
- `_keyOf`: internalId 有り/無し (slug フォールバック)
- `getDescendants`: 階層 + 循環データでも無限ループしない
- `canSetParent`: 自分自身 / 子孫 → false
- `create`: 親の books コピー + bookOrder コピー
- `reparent`: サブセット補充 (部分木の本が新親チェーンに追加される) / 特殊本棚は throw
- `previewReparent`: mutate しない・addedToNewParent が正しい
- `reorderSibling`: 配列内移動 (先頭へ / 末尾へ / before 指定)
- `removeBookFromBookshelf`: 子孫カスケード + bookOrder 同期
- `resolveMemo` / `hasMemoOverride`: override → ALL の 2 段解決
- `setMemo`: 空文字で override 削除 / ALL スコープの空エントリ削除

**book-manager.test.js**:
- `isKindleBook`: `B`+9 桁 → true、ISBN → false、updatedAsin 優先
- `getKindleReadUrl`: web / app の URL 形式

(T04 完了済みなら) **frontmatter ヘルパのテスト**: 分離・結合・updated 更新・水平線誤検出なし

### Step 3: Playwright smoke (tests/e2e/)

1. フィクスチャ: `tests/fixtures/` に最小データ (library 5 冊・本棚 2 つ・notes 数件)。テストは `localStorage` に `virtualBookshelf_library` / `virtualBookshelf_userData` をフィクスチャで注入してから読み込む方式にする (同期フォルダ不要で起動するアプリの localStorage フォールバック経路を利用)
2. `playwright.config.js`: `webServer: { command: 'python -m http.server 8000', port: 8000 }`、project は chromium のみ
3. smoke シナリオ (各テストで console error 0 をアサート):
   - 起動してホーム (ダッシュボード) が描画される
   - 本棚へ切替 → フィクスチャの本が描画される
   - ⌘K が開いて本棚名で検索 → 遷移
   - 本クリック → 右ペインに詳細
   - 評価フィルタで件数が変わる
4. ⚠️ 大量冊数の描画テストは書かない (ヘッドレス + content-visibility の制約。COMMON 参照)

### Step 4: GitHub Actions

`.github/workflows/ci.yml`: push / PR で実行。
- `actions/setup-node` → `npm ci` → `npx playwright install --with-deps chromium` → `npm test` → `npm run test:e2e`
- Python はランナー標準のものを使用

## 受け入れ基準

1. `npm test` がローカルで green (ユニット 15 ケース以上)
2. `npm run test:e2e` がローカルで green (smoke 5 シナリオ)
3. push 後、GitHub Actions が green (Actions タブの URL を報告に含める)
4. アプリ本体の挙動が無変更 (`index.html` に変更なし、または `?v=` のみ)

## 設計書同期

- 02_基本設計書: 「テスト」節を新設 (構成: Vitest/jsdom + Playwright smoke + Actions、フィクスチャ方式)
- 07_残検討事項: T7 のテスト/CI 行を削除

## コミット

`test: Vitest+Playwright smoke+GitHub Actions CI を導入 (設計: 02 更新)`
