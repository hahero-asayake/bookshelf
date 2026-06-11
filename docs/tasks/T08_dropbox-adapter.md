# T08: Dropbox アダプタ

状態: 未着手 / 依存: T07 (構造・UX パターンを踏襲)

## 目的

同期方式に Dropbox を追加。T07 と同じく StorageAdapter 契約の実装で完結させる。

## アーキテクチャ決定

- **認証**: OAuth 2 **PKCE + リダイレクト**。Dropbox は public client の PKCE と **refresh_token をネイティブサポート**するため、proxy も secret も不要 (GitHub より素直)
  - authorize: `https://www.dropbox.com/oauth2/authorize?client_id=…&response_type=code&code_challenge=…&code_challenge_method=S256&token_access_type=offline&redirect_uri=…`
  - token 交換 / refresh: `POST https://api.dropboxapi.com/oauth2/token` (CORS 対応済み。`grant_type=authorization_code` / `refresh_token`、client_id のみで可)
  - リダイレクト復帰: アプリ起動時に URL の `?code=` を検知して交換 → `history.replaceState` で URL を掃除。`code_verifier` は交換まで sessionStorage に保持
- **App folder 型**: Dropbox アプリを「App folder」アクセスで作る → 自動的に `アプリ/bookshelf` 配下にサンドボックスされ、パスはその中の相対 (`/private/library.json` 等)。フォルダ選択 UI 不要
- access token は約 4 時間 → `tokenExpiresAt` を保存し、期限前 / 401 時に refresh (T01 と同じ「期限前更新 + 401 で 1 回リトライ + 失敗で再接続誘導 + 同時実行ガード」パターン)
- バッチなし → syncBatch は逐次フォールバック

## 事前手作業 (ユーザ) — ✅ 完了 (2026-06-12)

Dropbox App 作成・Redirect URI・Permissions 設定済み。

- **App 名**: `asayake-bookshelf` / **App key**: `jv37cvpdbjfd55y` (公開情報。コード定数に埋め込む。App secret は使わない)
- このアプリは**全ユーザ共用** (ADR-028)。各ユーザの認可で各自の Dropbox の `アプリ/asayake-bookshelf/` に書く
- ⚠️ **Development ステータスの利用者数上限**: 多数のユーザが使う段階になったら Dropbox の **Production 申請**が必要 (07_残検討事項に TODO 記録済み)。個人利用 + 少数のうちは不要

## 実装手順

1. **`js/dropbox-auth.js` (新規)**: PKCE ヘルパ (`code_verifier` 生成 / S256 challenge は SubtleCrypto)、`startConnect()` (authorize へ遷移)、`handleRedirect()` (起動時の code 検知 → token 交換)、`ensureToken()` (期限前 refresh + ガード)。トークン類は `bookshelf_sync.dropbox` に保存
2. **`js/dropbox-adapter.js` (新規)** — StorageAdapter 実装。Dropbox はパスベースなので fileId 解決は不要:
   - `readText`/`readJSON`: `POST content.dropboxapi.com/2/files/download` (パスは `Dropbox-API-Arg` ヘッダの JSON、**non-ASCII は \uXXXX エスケープ必須** — 日本語ファイル名対応の要)。409 `path/not_found` → null
   - `writeText`/`writeJSON`: `POST content.dropboxapi.com/2/files/upload` (`mode: overwrite`)。**中間フォルダは自動作成される**ため mkdir 不要
   - `listFiles`/`listDirs`: `POST api.dropboxapi.com/2/files/list_folder` (+ `list_folder/continue` でページング)。`.tag` (`file`/`folder`) で振り分け。存在しないフォルダ → `[]`
   - `deleteFile`: `files/delete_v2`。not_found → 黙って成功
   - 429 / `too_many_requests` → `Retry-After` を尊重してリトライ (最大 3 回)
3. **`js/sync-config.js`**: `dropbox: { token, refreshToken, tokenExpiresAt }` + `buildAdapter` 分岐
4. **設定 UI**: Dropbox を有効化 (「対応予定」撤去)。接続 → リダイレクト → 復帰 → 接続済み表示 (アカウント名は `users/get_current_account`)。切断 = トークン破棄 + `auth/token/revoke`
5. 起動分岐 `initSync()` に dropbox 追加。script タグ + `?v=` バンプ
6. リダイレクト復帰時の状態保持に注意: 復帰直後は通常の起動フローを通し、code 交換完了後にリロード (GitHub 接続の「設定保存 → リロード」と同じ流儀)

## 受け入れ基準

1. 接続フロー: 認可 → 復帰 → 接続済み表示。Dropbox 側に `アプリ/bookshelf-sync/` フォルダが見える
2. アダプタ単体: `_test/ping.json` の write → read 一致 → list → delete (日本語ファイル名 `_test/日本語テスト.md` でも write/read が通ること)
3. 空フォルダ初回起動で `initEmpty` → アプリ起動
4. メモ編集 → 保存 → Dropbox 上の JSON 更新 → リロードで維持
5. refresh: `tokenExpiresAt` を過去に書換 → 操作 → 自動 refresh で成功。refreshToken 不正 → 再接続誘導
6. GitHub / ローカル / Drive が無影響 (T05 smoke green)
7. console エラー 0。検証後 `_test/` は削除

## 設計書同期

- 02_基本設計書: 同期方式表に Dropbox ✅ (PKCE + App folder + refresh ネイティブ)
- 03_詳細設計書: DropboxAdapter / dropbox-auth の節
- 06_データ仕様書: `bookshelf_sync.dropbox` スキーマ
- 01_要件定義書: F-06-1 / NF-03 更新。「💤 対応予定」表記を全廃
- 07_残検討事項: Dropbox 行を削除 (T1 セクションが空になったらセクションごと削除)
- 08_意思決定記録: 「ADR-027 Dropbox は PKCE + App folder (proxy 不要)」を追記

## コミット

`feat: Dropbox 同期アダプタ (PKCE + App folder) (設計: 01/02/03/06/08 更新)`
