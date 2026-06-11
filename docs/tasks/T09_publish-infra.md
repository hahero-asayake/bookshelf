# T09: 公開基盤 (ユーザごとの公開 repo)

状態: 未着手 / 依存: T01 (GitHub 認証基盤)

## 目的

準備中 (disabled) の公開機能を解禁する。**ホスト型マルチユーザ前提 (ADR-028)**: アプリは 1 箇所で配信され、**各ユーザが自分の公開 repo** に公開スナップショットを push する。

```
アプリ本体 (共通): hahero-asayake.github.io/bookshelf — 既存 Pages
各ユーザの編集データ: 各自の private repo / Drive / Dropbox (非公開のまま)
各ユーザの公開データ: 各自の public repo (例: <user>/bookshelf-public)
公開ページ URL: https://hahero-asayake.github.io/bookshelf/?u=<owner>/<repo>
```

- 公開モードは `?u=` で指定された repo の **raw.githubusercontent.com** から fetch (CORS 対応・Pages 設定不要)
- 旧設計の「public/ にアプリシェルもコピー」は**廃止** (アプリは共通配信)。エクスポート対象は**データのみ**

## 事前手作業 (ユーザ) — ✅ 完了 (2026-06-12)

hahero の `bookshelf-public` repo 作成 + App アクセス追加済み。
→ 同じ 2 手順を**エンドユーザにも同じ作業をしてもらう**ため、Step 2 の UI に導線・案内文を組み込むこと。

## 夜間運転時の制約 (2026-06-12 ユーザ指示)

- **実データの公開 push は朝のユーザ確認後** (承認済みスコープ: isPublic =「漫画」のみ。実行時に一致しなければ停止)
- 夜間は実装 + **ドライランまで**: `export({ dryRun: true })` を実装し、push せずに「書き込む/削除するエントリの一覧」を返して報告に残す。private 情報が混ざっていないことの grep 検証はドライラン出力に対して行う

## 実装手順

### Step 1: エクスポート先の付け替え (`js/exporter.js` + 設定)

1. `sync-config` に `publish: { owner, repo, branch }` を追加。既定値: owner = GitHub 接続中の login、repo = `'bookshelf-public'`、branch = `'main'`。**ハードコード禁止** (ユーザごとに変わる)
2. `BookshelfExporter.export()` を改修:
   - 出力先を「同期先の `public/` 配下」から「**publish 設定の repo へ GitHubAdapter (第 2 インスタンス) で syncBatch (1 コミット)**」に変更。token は既存 GitHub 接続のものを共用 (`_ensureFreshGitHubToken` を通す)
   - **アプリシェルのコピー処理 (`_collectAppShell`) を削除**
   - データエントリは従来のフィルタを踏襲: library (公開 ASIN のみ) / bookshelves.json (`isSpecial || isPublic`) / 公開本棚 JSON / notes (hideMemo 反映・hideMemo/hideDetailMemo フラグ除去) / books md (hideDetailMemo=false のみ) / main / settings (`affiliateId`・`obsidianVaultName`・`obsidianSubPath`・`extensionImportOrigins` 除去) / publishable プラグイン
   - **削除同期**: 前回公開して今回非公開になったファイルが残ると非公開化が効かない。`listFiles`/`listDirs` で公開 repo の現状を列挙し、今回エントリに無いものへ delete エントリを出す (ルートの README.md は残す)
3. 同期方式が GitHub 以外 (ローカル / Drive / Dropbox) のユーザも、**公開のためだけに GitHub 接続**できるようにする: 公開セクションに「公開には GitHub 接続が必要」案内 + 接続ボタン (既存 Device Flow を流用)。接続なしなら公開ボタンは disabled のまま

### Step 2: 公開設定 UI

設定モーダルの公開セクション (disabled + 準備中バッジを撤去) に:

1. **公開先 repo の設定**: owner (接続アカウントから自動) / repo 名入力 (既定 `bookshelf-public`) / branch (既定 main)
2. **セットアップ導線**: repo が存在しない or App 未インストールの場合のエラーを拾い、「① github.com/new で public repo を作成 → ② bookshelf-sync アプリのアクセス対象に追加」の 2 ステップ案内 (それぞれリンク付き) を表示
3. **「公開する」ボタン** → 確認ダイアログ (公開される本棚名の一覧 + 冊数を表示) → 実行 → 成功で**公開 URL** (`…/bookshelf/?u=<owner>/<repo>`) を表示 + コピーした URL がそのまま共有リンクになる旨を表示

### Step 3: 公開モードのデータ読込 (`?u=` パラメータ)

1. 起動時に URL の `u` パラメータを検知 → **公開モード** (`IS_PUBLIC` 相当) で起動。既存の `?mode=public` 判定があれば `u` 方式に統合
2. **入力検証 (必須)**: `u` は `^[\w.-]+\/[\w.-]+$` (owner/repo)、任意で `@branch` を許容。**パターン外は拒否**して通常モードのエラーページ (任意 URL fetch への悪用防止。raw.githubusercontent.com 以外へは絶対にリクエストしない)
3. データ取得: `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/…` から library / bookshelves / notes / main / settings / 公開本棚 JSON を fetch → `_applyLoadedState` 相当を通す。404 時は「この本棚は公開されていません」表示
4. 公開モードでの**編集系完全非表示**を点検: 設定 / 同期 / 取込 / 一括 / D&D / 評価クリック / メモ編集 / ツリーの ⋯ メニュー。既存の `body.public-mode` CSS と初期化スキップを実態確認し、漏れを塞ぐ
5. ⌘K は**検索のみ** (コマンド群を出さない)
6. 公開モードでは閲覧者の localStorage を編集データで汚染しない (キャッシュ書込をスキップ or 別キー)

## 受け入れ基準

1. 「公開する」→ 設定した自分の repo に 1 コミットで全公開データが push され、private 情報 (affiliateId / obsidian* / extensionImportOrigins / hideMemo・hideDetailMemo フラグ / 非公開本棚 / hideMemo 付きメモ / 除外本) が**一切含まれない** (push 後の repo 内容を grep で確認)
2. 非公開化の伝播: 一度公開した本棚を isPublic=false にして再公開 → 公開 repo から該当ファイルが消える
3. `?u=hahero-asayake/bookshelf-public` で開く → 公開本棚だけが閲覧でき、編集 UI が一切出ない (PC / モバイル両方)。`?u=../evil` 等の不正値は拒否される
4. 公開モードの ⌘K が検索のみ / 閲覧後に通常モードへ戻っても編集データが壊れていない
5. repo 未作成・App 未インストール時にセットアップ案内が表示される
6. 通常モード (編集) が無影響 (T05 smoke green) / console エラー 0

⚠️ このタスクは実データの公開を伴う。**実行前にユーザへ「どの本棚が isPublic か」を提示して確認**してから公開を実行する。

## 設計書同期

- 02_基本設計書: 公開エクスポートのフロー図・全体像図を新構成 (ユーザごとの公開 repo + ?u= fetch) に書き換え
- 03_詳細設計書: BookshelfExporter 節を書き換え (`_collectAppShell` 削除・削除同期・第 2 アダプタ)
- 06_データ仕様書: public/ 節を「ユーザの公開 repo」構成に書き換え。`bookshelf_sync.publish` 追加
- 01_要件定義書: F-06-5/6 の 💤 解除 + 公開 URL 形式を追記
- 07_残検討事項: T09 行を完了処理
- 08_意思決定記録: ADR-022 に「?u= パラメータでユーザ別公開 (マルチユーザ化に伴う改訂)」を追記

## コミット

`feat: 公開機能を解禁 (ユーザ別公開repo + ?u=公開モード) (設計: 01/02/03/06/08 更新)`
