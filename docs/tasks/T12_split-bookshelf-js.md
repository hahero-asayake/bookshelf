# T12: bookshelf.js モジュール分割 ＋ 描画重複排除

状態: 一部着手 (描画重複排除を先行開始, 2026-06-14) / 依存: **T05 必須 (テスト green が前提)・ファイル分割本体は他全タスク完了後**

## 目的

2 軸ある:

1. **モジュール分割**: `js/bookshelf.js` (約 7,600 行) を責務別ファイルに分割し、変更コストと AI のコンテキスト負荷を下げる。**挙動変更ゼロの移動リファクタ**。
2. **描画重複排除** (2026-06-14 追加): 同一ドメインオブジェクト (本棚・本) の描画が複数箇所でバラバラに実装されていた問題を、**単一の描画コンポーネントに集約**する。第一歩として本棚行を `js/ui-components.js` の `BookshelfUI` に集約済み (サイドバーツリー + 公開ページの本棚選択が共有)。

### 描画重複排除の進捗・残

- [x] `js/ui-components.js` (`BookshelfUI.rowCore` / `pickItem`) — 本棚行の正実装。サイドバーツリーと公開ピッカーが共有 (commit `e0e0f36` / `e9e91e2`)。
- [ ] ホームカード `_renderBookshelfCard`、本棚ポップオーバー、本詳細 chip 等の本棚アイコン+名前の描画も BookshelfUI へ寄せる (見た目は icon-frame グループで概ね統一済み)。
- [ ] **本アイテム** (一覧の `createBookElement` / 公開の本 chip / ホームの表紙) も `BookshelfUI.bookChip` 等に集約。
- 分割表 (下記) の `app-sidebar.js` / `app-sync-ui.js` へ移すメソッドは **BookshelfUI を使う形** で移す。

## 方針 — mixin 方式 (ビルドレス維持)

ES modules 化はせず、`<script>` 順次読込のまま **prototype mixin** で分割する:

```js
// js/app-palette.js (例)
window.BookshelfPaletteMixin = {
    _setupCommandPalette() { … },   // bookshelf.js から純粋移動
    _openPalette() { … },
    …
};
// js/bookshelf.js 側 (クラス定義直後)
Object.assign(VirtualBookshelf.prototype, window.BookshelfPaletteMixin);
```

- メソッド名・this 構造・呼び出し関係は**一切変更しない** (純粋移動のみ)
- `static` メンバ・constructor・init はコアに残す
- index.html の script 順: mixin ファイル群 → bookshelf.js (Object.assign がクラス定義後に走るよう、assign は bookshelf.js 末尾に置く)

## 分割計画 (1 ファイル = 1 コミット、毎回テスト green を確認)

| 新ファイル | 移すメソッド群 (目安) | 規模感 |
|---|---|---|
| `js/app-palette.js` | ⌘K 系 (`_setupCommandPalette` / `_openPalette` / `_paletteCommands` / キー操作) | 小 |
| `js/app-detail-pane.js` | 本詳細 (`showBookDetail` / `saveNote` / 星 widget / セクション並べ替え / 長文メモモーダル) | 大 |
| `js/app-list-view.js` | 一覧 (`createBookElement` / `applyFilters` / `applySorting` / `updateDisplay` / D&D / 選択・一括 / 評価フィルタ UI) | 大 |
| `js/app-sidebar.js` | ツリー (`_renderSidebarTree` / `_onTreeDrop` / reparent 確認 / ノードメニュー / ユーティリティ DnD) | 中 |
| `js/app-settings-ui.js` | 設定モーダル (プラグイン管理カード / IconPicker / 表示設定 / 取込 UI) | 大 |
| `js/app-sync-ui.js` | 同期 UI (GitHub/Drive/Dropbox 接続フォーム / ステータスバー / 公開 UI) | 中 |
| `js/app-mobile.js` | モバイル (`_initMobileNav` / 長押し / pull-to-refresh / マーキー) | 小 |
| `js/app-publish-ui.js` | 公開ページ管理 UI (`openPublishPagesModal` / `_pp*` / `_runPublishExport`) | 中 |
| `js/ui-components.js` ✅ | ドメインオブジェクトの共通描画 (`BookshelfUI`)。**mixin ではなく独立した stateless ヘルパ**。既に新設済み | 小 |

残る `bookshelf.js` コア: constructor / init / 状態 / 保存系 (saveUserData / sync) / ルーティング連携。目標 1,500 行以下。
※ `app-sidebar.js` / `app-publish-ui.js` のツリー・本棚選択描画は `BookshelfUI` を呼ぶ (重複を作らない)。

## 手順 (各ファイルごとに繰り返し)

1. 対象メソッド群を grep で特定し、**コメント含め完全一致で移動** (編集しない)
2. index.html に script タグ追加 (`?v=` 付き)、bookshelf.js 末尾に `Object.assign`
3. `npm test` + `npm run test:e2e` green を確認
4. Playwright で該当機能を 1 操作ずつ目視確認 (例: palette 移動後は ⌘K 開閉と検索)
5. commit (このコミットでは他ファイルの変更を混ぜない)

## 禁止事項

- メソッドのリネーム・引数変更・ロジック「改善」(気づいた問題は 07 へメモ。直さない)
- 2 ファイル分を 1 コミットにまとめること
- テスト red のまま次へ進むこと

## 受け入れ基準

1. 全 7 ファイル分割後、`bookshelf.js` が目標行数以下
2. `npm test` / `npm run test:e2e` green
3. 手動スポット確認: 起動 / 本棚切替 / 詳細編集 / ⌘K / 設定 / 同期保存 / モバイル 390px — すべて従来挙動
4. `git diff` ベースで「移動のみ」であること (移動前後でメソッド本体のテキストが一致)
5. console エラー 0

## 設計書同期

- 03_詳細設計書: モジュール構成図を新ファイル構成に書き換え (mixin 方式の説明 3 行)
- 02_基本設計書: 主要コンポーネント表の VirtualBookshelf 行に「+ mixin 7 ファイル」を注記
- 07_残検討事項: 分割行を削除
- 08_意思決定記録: 「ADR: 分割は ES modules ではなく prototype mixin (ビルドレス維持)」を追記

## コミット (例)

`refactor: ⌘K系を app-palette.js に分離 (挙動変更なし) (設計: 03 更新)` × 7 本
