# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 開発環境とコマンド

### ローカル開発サーバー起動
```bash
# HTTPサーバーを起動 (CORS制約回避のため)
python -m http.server 8000
# または
npx serve .
# または
php -S localhost:8000
```

ブラウザで `http://localhost:8000` を開く

#### ⚠️ VS Code Live Server を使う場合の注意
Live Server は VS Code ワークスペース内のファイル変更を watch してブラウザを reload する。
**同期フォルダ (Obsidian vault) がワークスペース内にある場合、同期書き込みのたびにアプリがリロードされて編集状態が失われる**。

対策 (どれか):
1. **Live Server を使わず `python -m http.server` に切り替える** (一番確実)
2. ワークスペースを bookshelf プロジェクト直下のみに絞る (`File → Open Folder...` で bookshelf を直接開く)
3. ワークスペースの `.vscode/settings.json` (ユーザ自身のローカル設定) に以下を追加して同期フォルダを除外:
   ```json
   {
       "liveServer.settings.ignoreFiles": [
           "**/.vscode/**",
           "**/.git/**",
           "**/node_modules/**",
           "**/obsidian/**",
           "**/bookshelf-export/**"
       ]
   }
   ```
   (このリポジトリの `.gitignore` は `.vscode/` を除外しているため、設定はユーザ各自のローカルに置く)

## アーキテクチャ概要

### データ構造とフロー
このプロジェクトは **フロントエンドのみのWebアプリケーション** で、バックエンドサーバーは不要です。

#### 主要コンポーネント
- **VirtualBookshelf** (`js/bookshelf.js`): メインアプリケーションクラス、UI制御とビジネスロジック
- **BookManager** (`js/book-manager.js`): 蔵書のCRUD操作（作成・読み込み・更新・削除）
- **ハイライト機能**: コア機能から削除済み。`plugins-sample/highlights-builtin/` をプラグインとして同期フォルダ `plugins/` に置けば有効化される

#### データ永続化戦略
1. **ブラウザのLocalStorage**: ユーザーの設定、星評価、メモ、本棚カスタマイズを保存
2. **GitHubリポジトリファイル**: 永続化用データ（`data/library.json`）
3. **ハイブリッド読み込み**: LocalStorage優先、フォールバックとしてファイル読み込み

#### コアデータファイル
- `data/library.json`: 旧フォーマットのフォールバック（同期フォルダ未接続時の初期データ）
- `data/config.json`: アフィリエイトIDなどのフォールバック設定（新設計では `private/settings.json` に統合予定）

### 初期化フロー
1. `VirtualBookshelf.init()` でBookManagerを初期化
2. `BookManager.initialize()` で蔵書データを読み込み（LocalStorage → ファイル）
3. ユーザー設定データをLocalStorageから復元、なければファイル読み込み
4. プラグインローダーが `plugins/` をスキャンして有効化されたものを起動

### データエクスポート・インポート機能
- **Kindleデータインポート**: [Kindle Bookshelf Exporter](https://chromewebstore.google.com/detail/kindle-bookshelf-exporter/olimpmeljimffgjonlpmiaebaonnegdp)でエクスポートしたJSONファイルを取り込み
- **手動蔵書追加**: ASIN、タイトル、著者を手動入力して蔵書に追加
- **設定エクスポート**: LocalStorageのデータを`library.json`としてダウンロード

### 本棚管理システム
- 複数の本棚を作成してテーマ別にキュレーション
- 本棚ごとの公開・非公開設定
- ドラッグ&ドロップによる本の並び替え（カスタム順序の永続化）
- 星評価システム（1-5星）とフィルタリング

### ハイライト機能（プラグイン）
- `plugins-sample/highlights-builtin/` をプラグインとして配布
- 同期フォルダ `plugins/highlights-builtin/data/HighlightsASCII/` + `index.json` を読む
- `ui:book-modal-opened` イベントで本詳細モーダルに `.book-highlights-section` を inject

### UI/UX パターン
- **2つの表示モード**: 表紙表示（カード）・リスト表示
- **レスポンシブデザイン**: デスクトップ・タブレット・スマートフォン対応
- **インタラクティブな要素**: モーダル詳細表示、星評価、検索・フィルター

### Amazon Associates統合
- `data/config.json`のaffiliateIdでアフィリエイトリンク自動生成
- 商品画像とリンクをAmazonから動的取得

## 重要な技術的制約

### セキュリティとCORS
- **CORS制約**: `file://`プロトコルではJSONファイル読み込み不可のため、HTTPサーバーが必須
- **クライアントサイドのみ**: バックエンド処理なし、すべてJavaScriptで完結

### ファイル構成規則
- **データファイル命名**: ASINベース（Amazon Standard Identification Number）