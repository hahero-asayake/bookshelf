# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 設計書との整合性ルール (最重要)

bookshelf は **コードと設計書の双方向同期** を運用ルールとする。

### 設計書の場所
```
c:/Users/magur/Documents/GitHub/obsidian/80_🚀project/81_🚀development/bookshelf/
├── 00_概要.md            # 入口・文書マップ・書き方ルール
├── 01_要件定義書.md
├── 02_基本設計書.md       # アーキテクチャ + ドメインルール (D-1〜D-7)
├── 03_詳細設計書.md       # クラス/メソッド リファレンス
├── 04_画面設計書.md
├── 05_プラグイン仕様書.md
├── 06_データ仕様書.md     # 全スキーマ
├── 07_残検討事項.md       # バックログ (未完了のみ)
└── 08_意思決定記録.md     # ADR (決定・理由・教訓)
```

**設計書の書き方 (2026-06-10 再構成)**: 01〜06 は「現在の仕様」だけを書き、日付つき追記・経緯・検証ログを書かない (本文を直接書き換える)。「なぜ」は 08 に ADR として追記、未実装・新課題は 07 へ (完了したら行を削除)。詳細は 00_概要 の運用ルール。

### 重要な前提: コードと設計書は別リポジトリ

- **コード**: `c:/Users/magur/Documents/GitHub/bookshelf` (このリポジトリ)
- **設計書**: `c:/Users/magur/Documents/GitHub/obsidian` (vault リポジトリ)

別リポジトリのため、git レベルでの「同一コミット」はできない。代わりに **同一作業セッション内で両方を更新する** ことを規律とする。

### コード変更時のルール

**コードを変更する作業セッション中に、必ず該当する設計書も同じセッション内で更新する**。

| コード変更の種類 | 更新すべき設計書 |
|---|---|
| 新機能追加 | 01_要件定義書 (機能要件) + 02_基本設計書 (該当箇所) |
| アーキテクチャ変更 | 02_基本設計書 (全体像 / コンポーネント図) |
| クラス追加・削除・責務変更 | 03_詳細設計書 (該当クラスの節) |
| メソッド追加・削除・シグネチャ変更 | 03_詳細設計書 (該当クラスの主要メソッド表) |
| 画面構成・UI 変更 | 04_画面設計書 |
| プラグイン API 変更 | 05_プラグイン仕様書 |
| データ形式変更・マイグレーション追加 | 06_データ仕様書 |
| プラグイン追加 | 05_プラグイン仕様書 (サンプルプラグイン一覧) |
| イベント追加・削除 | 05_プラグイン仕様書 (イベント一覧が正) |
| 重要な設計判断・方針転換 | 08_意思決定記録 (ADR を追記) |
| 未実装の積み残し・新たな課題 | 07_残検討事項 (完了したら行を削除) |

### 設計書変更時のルール

**設計書を変更したら、該当するコード箇所の追従可否を確認する**。
- 仕様変更で実装も変える → コードを直す
- 仕様だけ変えたい (実装は後追い) → 設計書末尾に `## 未実装` セクションを追加して明示

### コミット運用 (別リポジトリでの整合)

完璧な同期は git では不可能なので、次のルールで近似する:

1. **両リポジトリで同じ作業セッション中に変更を完了させる**
   - コードを書いて bookshelf 側で commit する前に、設計書も書いて obsidian 側で commit する (順不同)
   - 片方だけ commit してセッションを終えない

2. **コミットメッセージで相互参照する**
   - bookshelf 側: `feat: ペイン折りたたみ追加 (設計: 04_画面設計書 2026-05-29 更新)`
   - obsidian 側: `bookshelf: 04_画面設計書 ペイン折りたたみ追加 (実装: bookshelf@<hash>)`
   - `<hash>` は片方を後にコミットする場合のみ書ける。先にコミットした側は手書きの日付や PR 番号で代替

3. **コミット日時を近接させる**
   - 数分以内に両方を commit、できれば push まで一気にやる
   - 「コード先行 push、設計書はあとで」は禁止 (整合性が崩れる)

4. **コミットメッセージ prefix**
   - 機能追加: `feat:` / バグ修正: `fix:` / リファクタ: `refactor:` / 設計書のみ: `docs:` / スタイル: `style:`
   - 設計書のみの変更 (バグ取り、表記揺れ修正等) は片リポでの `docs:` commit のみで OK

### 整合性チェック (定期的に)

レビューやリファクタの節目に以下を確認する。乖離があれば設計書を直す or コードを直す。

- 03_詳細設計書のクラス一覧と `js/*.js` のクラスが一致しているか
- 03_詳細設計書の各クラスの主要メソッド表と実装が一致しているか
- 06_データ仕様書の JSON スキーマと `storage.js` の writeXxx 引数構造が一致しているか
- 05_プラグイン仕様書の API 一覧と `plugin-api.js` の forPlugin 返り値が一致しているか
- 05_プラグイン仕様書のイベント一覧と `plugin-api.js` 冒頭のコメントが一致しているか
- 04_画面設計書のレイアウトと `index.html` / `mockups/refined.html` が一致しているか

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

ブラウザで `http://localhost:8000` を開く。

#### ⚠️ VS Code Live Server を使う場合の注意

Live Server は VS Code ワークスペース内のファイル変更を watch してブラウザを reload する。
**同期フォルダ (Obsidian vault) がワークスペース内にある場合、同期書き込みのたびにアプリがリロードされて編集状態が失われる**。

対策 (どれか):
1. **Live Server を使わず `python -m http.server` に切り替える** (一番確実)
2. ワークスペースを bookshelf プロジェクト直下のみに絞る (`File → Open Folder...` で bookshelf を直接開く)
3. ワークスペースの `.vscode/settings.json` (ユーザ自身のローカル設定) で同期フォルダを除外:
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

## アーキテクチャ概要 (要点)

詳細は [02_基本設計書](../../../obsidian/80_🚀project/81_🚀development/bookshelf/02_基本設計書.md)。

### 主要コンポーネント

| クラス | ファイル | 責務 |
|---|---|---|
| `VirtualBookshelf` | `js/bookshelf.js` | メインアプリ、UI制御、状態管理 |
| `BookManager` | `js/book-manager.js` | 蔵書 CRUD |
| `BookshelfManager` | `js/bookshelf-manager.js` | 本棚操作、継承、逆引き |
| `StorageAdapter` | `js/storage-adapter.js` | 同期ストレージの抽象基底 (path I/O) |
| `LocalFSAdapter` | `js/local-fs-adapter.js` | File System Access API 実装 |
| `GitHubAdapter` | `js/github-adapter.js` | GitHub Contents API 実装 (PAT 認証) |
| `SyncConfigManager` | `js/sync-config.js` | LocalStorage で同期方式 + 接続情報を管理 |
| `BookshelfStorage` | `js/storage.js` | bookshelf 構造の高レベル読み書き (adapter 経由) |
| `BookshelfExporter` | `js/exporter.js` | 公開エクスポート |
| `BookshelfRouter` | `js/router.js` | URL ハッシュ |
| `BookshelfPluginLoader` | `js/plugin-loader.js` | プラグイン読込 |
| `BookshelfPluginAPI` | `js/plugin-api.js` | プラグイン公開 API |
| `BookshelfDashboard` | `js/dashboard.js` | ホームダッシュボード (12 列 grid + ウィジェット registry + 編集モード) |

### データ永続化戦略

- **同期フォルダ (Obsidian vault)**: 編集データの正本 (File System Access API 経由)
- **localStorage**: キャッシュ + フォールバック
- **IndexedDB**: FileSystemDirectoryHandle の永続化

### 重要な技術的制約

- **CORS 制約**: `file://` プロトコルでは JSON 読み込み不可、HTTP サーバー必須
- **クライアントサイドのみ**: バックエンド処理なし、すべて JavaScript で完結
- **File System Access API**: Chrome / Edge 必須 (Firefox / Safari は同期不可)

### 本棚の構造

- **all 本棚** は特殊 (`isSpecial: true`): 削除・slug 変更不可、本データの正本
- 通常本棚は階層 (parent) を持てる、子は親のサブセット制約
- 短文メモ (2026-06-01 Phase B-2 改訂): **「本棚 override → ALL」** の 2 段解決。親本棚継承チェーンは廃止。
  - ALL.notes[asin].memo = デフォルト (どの本棚・ホームから開いても同じ)
  - bookshelves/`<slug>`.json の notes[asin].memo = 任意の本棚 override
  - 公開時: 本棚 override は本棚 public で公開、ALL は `hideMemo` フラグで opt-out (default 公開 ON)
- 「個人メモ」「要約メモ」「短文メモ」用語は **「短文メモ」** に統一 (Phase B-3)
- 本→所属本棚 の逆引きはメモリ map で構築 (ファイル化しない)

### プラグイン

- **オプトアウト方式**: `settings.disabledPlugins` 以外は自動有効化
- 同期フォルダの `plugins/<id>/manifest.json` + `index.js` 構造
- `window.bookshelfAPI.forPlugin(id)` 経由でフック
- 詳細は [05_プラグイン仕様書](../../../obsidian/80_🚀project/81_🚀development/bookshelf/05_プラグイン仕様書.md)

## ディレクトリ構造

```
bookshelf/
├── index.html
├── css/bookshelf.css
├── js/
│   ├── bookshelf.js          # メイン
│   ├── book-manager.js
│   ├── bookshelf-manager.js
│   ├── storage.js
│   ├── exporter.js
│   ├── router.js
│   ├── plugin-loader.js
│   └── plugin-api.js
├── data/                     # 公開モード用フォールバック
├── plugins-sample/           # サンプル/標準プラグインのソース
├── mockups/                  # 設計モックアップ
│   ├── index.html            # 初期5案
│   ├── refined.html          # PC案確定版
│   └── refined-iconified.html # Lucide 版
└── CLAUDE.md                 # このファイル
```

## 同期フォルダ構造 (2026-05-31〜)

bookshelf は **同期先フォルダを 1 つだけ指定** する。中身は `private/` と `public/` に分離される。

```
<同期フォルダ root>/
├── private/                       # アプリ編集データの正本
│   ├── library.json
│   ├── exclusions.json
│   ├── notes.json
│   ├── bookshelves.json
│   ├── bookshelves/{all,<slug>}.json
│   ├── books/<ASIN>__<title>.md   # 長文メモ
│   ├── settings.json
│   └── main.json
├── public/                        # 公開エクスポート出力 (アプリが書き出す)
│   ├── library.json (filtered)
│   ├── bookshelves.json (isPublic=true)
│   ├── bookshelves/, books/, notes.json, main.json, settings.json
│   └── plugins/<id>/ (publishable=true)
└── plugins/<id>/                  # プラグインソース (root)
    ├── manifest.json
    ├── index.js
    └── data/
```

実例: `c:/Users/magur/Documents/GitHub/obsidian/40_📖reading/` を root とした場合
(40_📖reading 全体が別 repo `bookshelf-data` として運用、obsidian repo は `40_📖reading/` を `.gitignore`)

## ファイル操作の注意

- ファイル削除は直接削除せず `_trash/` に退避 (project ルートで管理)
- データファイル命名: ASIN ベース

## コミットの粒度

- 1コミット = 1論理的変更
- 設計書の更新は **同じコミット内** に含める
- コミットメッセージ:
  - 機能追加: `feat: ...`
  - バグ修正: `fix: ...`
  - リファクタ: `refactor: ...`
  - 設計書のみ: `docs: ...`
  - スタイル: `style: ...`

## デザインの方向性 (確定済み — 2026-05-29)

PC 版は [04_画面設計書](../../../obsidian/80_🚀project/81_🚀development/bookshelf/04_画面設計書.md) に従う:
- 3 ペイン (左ナビ / 中央本棚 or ホーム / 右本詳細)
- 左右ペインは個別に折りたたみ可
- ホームはカスタマイズ可能なダッシュボード (ウィジェット)
- コマンドパレット (⌘K) で本・本棚・コマンド横断検索
- 管理ツール (取込・公開・除外等) はサイドバーに置かず、設定モーダル + ⌘K
- 本棚階層は icon 列を縦揃え、`▼/▸` は末尾 (Lucide chevron)
- **アプリ内の絵文字は全廃** (2026-06-01 Phase A 完了)。デフォルト UI は Lucide のみ、ユーザが選ぶアイコン (本棚/プラグイン/ヘッダー) は IconPicker で Lucide / 任意文字 (絵文字含む) を切替可
- `<title>` は表示名 `AsayakeBookshelf`、favicon/PWA アイコンは `icons/` の朝焼けアイコン (ADR-025)。旧 📚 絵文字は廃止
- ボタンの色規約:
  - `.btn-primary`: `var(--accent)` (青紫 #5b6cff) — 主要アクション (保存、公開、接続 等)
  - `.btn-secondary`: ghost (white + line) — 副次アクション (キャンセル、開く 等)
  - `.btn-danger`: ghost + danger color (#e25555) — 削除系
  - `.btn-warning`: ghost + warning color (#d49100) — 注意系
  - 色を直接指定するボタン上書きは禁止 (旧 `#007bff` `#dc3545` 等)

スマホ向け・公開モードは未確定。

## 実装ステータス

このファイルではステータス表を持たない (古くなりやすいため 2026-06-10 に撤去)。

- **現在地のサマリ**: [00_概要](../../../obsidian/80_🚀project/81_🚀development/bookshelf/00_概要.md) の「現在地」
- **未実装・優先順位**: [07_残検討事項](../../../obsidian/80_🚀project/81_🚀development/bookshelf/07_残検討事項.md)

前提: 未公開アプリのため、既存データとの互換性は考慮しない (旧形式マイグレーションを書かない、ADR-006)。

## 同期方式 (確定方針)

bookshelf は **StorageAdapter** で 4 方式を切替できる:

| 方式 | 対応環境 |
|---|---|
| **ローカルファイル** (FS API / SAF) | PC Chrome/Edge, Android Capacitor |
| **GitHub リポジトリ** | 全環境 (PC / iOS PWA / Android) |
| **Google Drive** | 全環境 |
| **Dropbox** | 全環境 |

iCloud Drive は公式 Web API がないため非対応。

### GitHub 接続: OAuth Device Flow のみ (PAT 非採用)

GitHub 認証は **OAuth Device Flow 限定** (PAT 入力 UI は無い)。

#### 事前準備A: GitHub App 登録 (hahero が初回 1 回)

**重要**: OAuth App ではなく **GitHub App** を使う。理由はリポジトリ単位の最小権限化:
- OAuth App + scope=repo はユーザの全 private repo に R/W → セキュリティ的に過大
- GitHub App はユーザがインストール時に対象 repo を選べる (Selected repositories)
- permission は Contents R/W のみ要求

1. GitHub Settings → Developer settings → **GitHub Apps** → "New GitHub App"
2. 基本情報:
   - GitHub App name: `bookshelf-sync` (※ ユニーク必須、被ったら別名)
   - Homepage URL: `https://hahero-asayake.github.io/bookshelf`
3. Identifying and authorizing users:
   - Callback URL: `https://hahero-asayake.github.io/bookshelf` (Device Flow では使われないがダミー)
   - **"Enable Device Flow" にチェック必須**
4. Webhook: **Active のチェックを外す** (不要)
5. Repository permissions:
   - **Contents: Read and write** ← これだけ
   - (他は No access のまま)
6. Account permissions: 全て No access のまま
7. Where can this GitHub App be installed?: **Any account** (fork ユーザも使えるように)
8. 作成後:
   - **Client ID** を [js/github-auth.js](js/github-auth.js) の `GITHUB_OAUTH_CLIENT_ID` に貼り付け
   - **Public link** (`https://github.com/apps/<app-name>`) を `GITHUB_APP_PUBLIC_URL` に貼り付け
9. hahero 自身のアカウントに **インストール** (動作確認用) — "Install App" → 対象リポジトリを選択 → Install
10. Client secret は **生成しない / 使わない** (Device Flow は public client)

#### 旧 OAuth App は廃棄

OAuth App (`Ov23liFBuec4YHaOgfOx`) は scope `repo` で過大権限。廃止して GitHub App に統一。

#### 事前準備B: Cloudflare Worker (OAuth proxy) のデプロイ (hahero が初回 1 回)

GitHub の OAuth endpoints (`github.com/login/device/code` と `oauth/access_token`) は CORS ヘッダを返さないため、SPA から直接叩けない。間に薄い proxy を挟む。

1. Cloudflare アカウント作成 (無料、メール認証のみ)
2. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Create Worker**
3. Worker 名を決める (例: `bookshelf-oauth-proxy`) → **Deploy**
4. 「Edit code」を開き、既存のサンプルコードを全削除して [cf-worker/oauth-proxy.js](cf-worker/oauth-proxy.js) の内容を貼り付け → **Save and deploy**
5. 発行された URL (例: `https://bookshelf-oauth-proxy.<your-account>.workers.dev`) を [js/github-auth.js](js/github-auth.js) の `GITHUB_OAUTH_PROXY_BASE` 定数に貼り付け
6. (任意) カスタムドメインを当てる場合は Workers の Triggers タブで設定

**Worker の責務 (確認用)**:
- 受け付けるのは `/login/device/code` と `/login/oauth/access_token` の **POST のみ** (それ以外は 404)
- リクエスト body を素通しで github.com に転送
- レスポンスに CORS ヘッダを付与して返す
- **token を保存しない** (ログにも残さない)
- Origin / Referer / Host ヘッダは削ぐ (匿名性確保)

**Cloudflare 無料枠**: 100,000 req/day。1 認証で数〜十数回 polling するが、数千ユーザでも十分余裕。

#### ユーザフロー

1. 設定 → 同期 → GitHub → 「🔌 GitHub に接続」
2. bookshelf が 8 桁 user_code を表示 + `https://github.com/login/device` を開くリンク
3. ユーザが別タブで code を入力 + 認可
4. bookshelf がポーリングで access_token を取得 → LocalStorage 保存
5. GitHub App が未インストールなら誘導が出る → App ページで対象リポジトリを選んでインストール → bookshelf で「🔄 再取得」
6. repo select に **App でインストール許可した repo のみ** が並ぶ → 選択
7. branch select に対象 repo の branches が並ぶ (default が自動選択)
8. basePath: 直接入力 or **「📂 選択」ボタンで repo 内ブラウザ** を開いて階層を辿って選択
9. 「✅ この設定で使う」→ リロード

#### fork する人へ

- 自分の OAuth App と Worker を作って両方の定数を差し替える、または
- hahero の OAuth App + Worker をそのまま流用 (誰の token も Worker に保存されないため、信頼するなら問題なし)

#### permission

GitHub App の **Contents: Read and write のみ** (scope の概念は使わない)。アクセス可能なのは「ユーザが App をインストール時に選んだ repo」だけ。

## モバイル配布方針

- **iOS**: PWA で配布 (Safari → ホーム画面に追加)。Capacitor / ネイティブアプリは作らない
  - 同期は GitHub / Google Drive / Dropbox のいずれか (ローカル不可)
  - 7日問題・ストア審査・署名問題から完全に解放される
- **Android**: Capacitor で `.apk` ビルド、GitHub Releases 等で直接配布
- **App Store / Play Store は使わない**
