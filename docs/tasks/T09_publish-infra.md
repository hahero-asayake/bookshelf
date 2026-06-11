# T09: 公開基盤 (bookshelf-public repo)

状態: 未着手 / 依存: T01 (GitHub 認証基盤)

## 目的

準備中 (disabled) の公開機能を解禁する。構成は **ADR-022**:

```
bookshelf (public repo)        — アプリ本体。既存 Pages (hahero-asayake.github.io/bookshelf)
bookshelf-data (private repo)  — 編集データ。非公開のまま
bookshelf-public (public repo) — 公開スナップショット。アプリが API で push
```

- 公開ページ = **既存アプリ URL + `?mode=public`**。データは `https://raw.githubusercontent.com/hahero-asayake/bookshelf-public/main/…` から fetch (raw は CORS `*` 対応、Pages 設定不要)
- 旧設計の「public/ にアプリシェルもコピー」は**廃止** (アプリは 1 箇所で配信されるため)。エクスポート対象は**データのみ**

## 事前手作業 (ユーザ)

1. GitHub で public repo **`bookshelf-public`** を新規作成 (README だけの空で可、branch: main)
2. GitHub App `bookshelf-sync` のインストール設定で **bookshelf-public を対象リポジトリに追加** (Settings → Applications → bookshelf-sync → Repository access)

## 実装手順

### Step 1: エクスポート先の付け替え (`js/exporter.js` + 設定)

1. `sync-config` に `publish: { owner, repo: 'bookshelf-public', branch: 'main' }` を追加 (既定値は owner=GitHub 接続の owner)
2. `BookshelfExporter.export()` を改修:
   - 出力先を「同期先の `public/` 配下」から「**publish 設定の repo へ GitHubAdapter (第 2 インスタンス) で syncBatch (1 コミット)**」に変更。token は既存 GitHub 接続のものを共用 (`_ensureFreshGitHubToken` を通す)
   - **アプリシェルのコピー処理 (`_collectAppShell`) を削除**
   - データエントリは従来のフィルタを踏襲: library (公開 ASIN のみ) / bookshelves.json (`isSpecial || isPublic`) / 公開本棚 JSON / notes (hideMemo 反映・hideMemo/hideDetailMemo フラグ除去) / books md (hideDetailMemo=false のみ) / main / settings (`affiliateId`・`obsidianVaultName`・`obsidianSubPath`・`extensionImportOrigins` 除去) / publishable プラグイン
   - **削除同期**: 前回公開して今回非公開になったファイルが残ると非公開化が効かない。`listFiles`/`listDirs` で現リモートを列挙し、今回エントリに無いものへ delete エントリを出す (`_test` 等は対象外、ルートの README.md は残す)
3. ローカル同期 (LocalFS) ユーザの場合: GitHub 未接続なら公開ボタンに「公開には GitHub 接続が必要」と案内 (disabled 継続)

### Step 2: 公開ボタンの解禁 (UI)

- 設定モーダルの公開セクション: disabled + 準備中バッジを撤去。公開先 (owner/repo) 表示 + 「公開する」ボタン → 確認 (公開される本棚名の一覧を表示) → 実行 → 成功で公開 URL を表示 (コピー可)

### Step 3: 公開モードのデータ読込

1. `IS_PUBLIC` 判定: `?mode=public` (既存判定を確認して踏襲)
2. `loadDataPublicMode()`: 定数 `PUBLIC_DATA_BASE` (例: `https://raw.githubusercontent.com/hahero-asayake/bookshelf-public/main`) から library / bookshelves / notes / main / settings / 公開本棚 JSON を fetch して `_applyLoadedState` 相当を通す。フォークユーザ向けに定数は 1 箇所に集約しコメントを書く
3. 公開モードでの**編集系完全非表示**を点検: 設定 / 同期 / 取込 / 一括 / D&D / 評価クリック / メモ編集 / ツリーの ⋯ メニュー。既存の `body.public-mode` CSS と初期化スキップを実態確認し、漏れを塞ぐ
4. ⌘K は**検索のみ** (コマンド群を出さない)

## 受け入れ基準

1. 「公開する」→ bookshelf-public に 1 コミットで全公開データが push され、private 情報 (affiliateId / obsidian* / extensionImportOrigins / hideMemo・hideDetailMemo フラグ / 非公開本棚 / hideMemo 付きメモ / 除外本) が**一切含まれない** (push 後の repo 内容を grep で確認)
2. 非公開化の伝播: 一度公開した本棚を isPublic=false にして再公開 → bookshelf-public から該当ファイルが消える
3. `?mode=public` で開く → 公開本棚だけが閲覧でき、編集 UI が一切出ない (PC / モバイル両方)
4. 公開モードの ⌘K が検索のみ
5. 通常モード (編集) が無影響 (T05 smoke green)
6. console エラー 0

⚠️ このタスクは実データの公開を伴う。**実行前にユーザへ「どの本棚が isPublic か」を提示して確認**してから公開を実行する。

## 設計書同期

- 02_基本設計書: 公開エクスポートのフロー図を新構成に書き換え。全体像図の公開系も更新
- 03_詳細設計書: BookshelfExporter 節を書き換え (`_collectAppShell` 削除・削除同期)
- 06_データ仕様書: public/ 節を bookshelf-public repo 構成に書き換え。`bookshelf_sync.publish` 追加
- 01_要件定義書: F-06-5/6 の 💤 を解除
- 07_残検討事項: T2 の基盤系の行を削除 (デザイン行は T10 へ残す)
- 08_意思決定記録: ADR-022 は記録済み。「raw.githubusercontent 配信・アプリシェル同梱廃止」を ADR-022 に 1 行追記

## コミット

`feat: 公開機能を解禁 (bookshelf-public へ1コミットpush + 公開モードfetch) (設計: 01/02/03/06 更新)`
