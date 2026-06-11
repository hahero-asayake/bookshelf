# T01: GitHub トークン自動更新 (refresh_token)

状態: 未着手 / 依存: なし / 優先: 最高 (毎日の実害)

## 目的

GitHub App のユーザトークン (`ghu_…`) は **8 時間で失効**し、現状ユーザは毎日再認証を強いられている。auth レスポンスに含まれる `refresh_token` (`ghr_…`、約 6 ヶ月有効) を保存し、**自動で access_token を更新**して再認証を 6 ヶ月に 1 回へ減らす。

GitHub の仕様上、refresh には `client_secret` が必要 → **secret は Cloudflare Worker にのみ置き** (環境変数)、クライアントには持たせない (ADR-021)。

## 事前手作業 (ユーザ) — ✅ 1・2 完了 (2026-06-12)

1. ✅ GitHub App `bookshelf-sync` の client secret 生成済み
2. ✅ Cloudflare Worker `bookshelf-oauth-proxy` に Secret `GITHUB_CLIENT_SECRET` 設定済み
3. **Worker のデプロイは実装 AI が wrangler で行う** (下記。手動貼り付け不要):
   - `_local/cloudflare-token.txt` に Cloudflare API トークン (Workers 編集権限) がある前提 (COMMON の `_local` 規約参照)
   - `cf-worker/wrangler.toml` を新規作成: `name = "bookshelf-oauth-proxy"` / `main = "oauth-proxy.js"` / `compatibility_date` は当日
   - デプロイ: 環境変数 `CLOUDFLARE_API_TOKEN` にファイル内容を渡して `npx wrangler deploy` (cf-worker ディレクトリで)。**トークンを echo・ログ出力しない**
   - ダッシュボードで設定済みの Secret (`GITHUB_CLIENT_SECRET`) はコードデプロイ後も**保持される** (wrangler.toml に vars を書かないこと)
   - デプロイ後 `https://bookshelf-oauth-proxy.asayake-hahero.workers.dev` への疎通確認 (対象外パス GET → 404 が返れば OK)
4. 確認: App の「Expire user authorization tokens」(Optional features) は**有効のまま**にする (現状の 8h 失効 = 有効状態。無効化はしない)

## GitHub API 仕様 (実装の根拠)

- Device Flow 成功レスポンス (失効有効時):
  `{ access_token: "ghu_…", expires_in: 28800, refresh_token: "ghr_…", refresh_token_expires_in: 15811200, token_type, scope }`
- **refresh リクエスト**: `POST https://github.com/login/oauth/access_token` (Accept: application/json)
  パラメータ: `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`
- refresh レスポンスは上と同形。**refresh_token はローテーションする** (毎回新しい `ghr_` が返る → 必ず保存し直す)
- 失敗時は `{ error: "bad_refresh_token" | … }` (HTTP 200 で返ることがある点に注意。`error` フィールドの有無で判定)

## 変更対象と実装手順

### 1. `cf-worker/oauth-proxy.js`

- 既存: `/login/device/code` と `/login/oauth/access_token` への POST を素通し
- 変更: `/login/oauth/access_token` へのリクエスト body に `grant_type=refresh_token` が含まれる場合のみ、`env.GITHUB_CLIENT_SECRET` を `client_secret` として **body に追加**して転送する
  - 現行クライアントの body エンコーディング (JSON か form-urlencoded か) を `js/github-auth.js` の既存実装で確認し、**同じ形式のまま**追加する
  - secret が未設定 (`env.GITHUB_CLIENT_SECRET` 無し) の場合は 500 + `{error:"proxy_secret_not_configured"}` を返す
- 不変条件の維持: token をログ・KV 等に**一切保存しない** / 対象外パスは 404 / CORS ヘッダ付与
- Worker は手動デプロイ (ユーザ作業 3)。コードに「デプロイ時に GITHUB_CLIENT_SECRET の設定が必要」とコメントを残す

### 2. `js/github-auth.js`

- `pollAccessToken` の戻り値を拡張: `access_token` だけでなく `refresh_token` / `expires_in` / `refresh_token_expires_in` も呼び出し元へ返す (現行の戻り値形式を確認し、後方互換を保って拡張)
- 新規 static `refreshAccessToken(refreshToken)`:
  - proxy 経由で `grant_type=refresh_token` を POST (`client_id` はコード内定数、secret は Worker が付与)
  - 成功 → `{ token, refreshToken, tokenExpiresAt, refreshTokenExpiresAt }` を返す (ExpiresAt は `Date.now() + expires_in*1000` で絶対時刻 ms に変換)
  - `error` フィールドがあれば `new Error('AUTH_REFRESH_FAILED')` を throw

### 3. `js/sync-config.js`

- `github` スキーマに `refreshToken` / `tokenExpiresAt` / `refreshTokenExpiresAt` を追加 (defaults では undefined)

### 4. `js/bookshelf.js`

- `_connectToGitHub()` 成功時: 新フィールドも `bookshelf_sync` に保存
- `_disconnectGitHub()`: 新フィールドも削除
- 新規 `async _ensureFreshGitHubToken()`:
  - `syncMethod !== 'github'` なら即 return
  - `tokenExpiresAt` があり「現在時刻 > tokenExpiresAt − 10 分」かつ `refreshToken` がある → refresh 実行 → 成功で config 保存 + **adapter のトークン差し替え** (GitHubAdapter に `setToken(token)` を追加するか、既存プロパティを直接更新。adapter 実装を確認して安全な方を選ぶ)
  - **同時実行ガード**: 進行中の refresh Promise を `this._tokenRefreshPromise` に保持し、並行呼び出しは同じ Promise を待つ
  - refresh 失敗 → `_syncError` を立て、ステータスバーに「GitHub の認証が切れました。設定から再接続してください」+ 設定ボタン
- 呼び出し点に組み込み: `initGitHubSync()` 冒頭 / `syncToObsidianFolder()` 冒頭 / `_runPendingSync()` 冒頭 / `_loadGitHubRepos()` 冒頭
- **401 フォールバック**: `syncToObsidianFolder` 等で `GitHubAuthError` を catch したら、refresh を 1 回だけ試行 → 成功なら操作をリトライ、失敗なら上記のエラー表示 (無限リトライ禁止)
- **後方互換**: 既存ユーザの config には `refreshToken` が無い。この場合 refresh はスキップし、401 時に再接続誘導のみ。再接続すれば新フィールドが入る

## 検証用の実セッション注入

実トークンでの E2E 検証は `_local/bookshelf_sync.json` (ユーザの実セッションのコピー、COMMON 参照) を使う:
Playwright で `localhost:8000` を開く**前に** `localStorage.setItem('bookshelf_sync', <ファイル内容>)` を注入 → アプリが GitHub 接続状態で起動する。検証は読み取り系 API 中心で行い、終了後に新しい token/refreshToken が発行されていたら**ファイルにも書き戻して報告に明記** (refresh はローテーションするため、古い値はユーザのブラウザ側で失効している可能性がある点を朝の報告に含める)。

## 受け入れ基準 (全て満たすまで push 禁止)

1. 再認証直後 (または注入セッションの refresh 後)、`bookshelf_sync` に `refreshToken` / `tokenExpiresAt` が保存される
2. console で `tokenExpiresAt` を過去時刻に書き換え → 同期系操作 (例: `app.storage` 経由の `testConnection`) → **refresh リクエストが発生し、新しい token と新しい refreshToken が保存され、操作が成功**する
3. `token` を `'ghu_invalid'` に書き換え (refreshToken は正) → 操作 → 401 → 自動 refresh → リトライ成功
4. `refreshToken` も不正にする → 操作 → ステータスバーに再接続誘導が表示される (例外で UI が死なない)
5. Worker: refresh 以外のリクエスト (device code / device flow polling) が**従来通り secret なしで**動く
6. console エラー 0 / 既存の同期 (保存→反映) が従来通り動く

⚠️ 検証は読み取り系 (`testConnection` / repo 取得) を優先し、実データの書込同期は通常操作の範囲のみ。検証で userData を変更しない。

## 設計書同期

- 03_詳細設計書: GitHubDeviceAuth (`refreshAccessToken`)・SyncConfigManager スキーマ・VirtualBookshelf (`_ensureFreshGitHubToken`) を更新
- 06_データ仕様書: `bookshelf_sync.github` のフィールド表に 3 フィールド追加
- 02_基本設計書: 同期方式の GitHub 行に「トークン自動更新 (8h→自動 refresh)」を反映
- 07_残検討事項: T1 の該当行を削除
- (ADR-021 は記録済み・追記不要)

## コミット

`feat: GitHubトークンの自動更新 (refresh_token + Worker secret注入) (設計: 02/03/06 2026-06-XX 更新)`
