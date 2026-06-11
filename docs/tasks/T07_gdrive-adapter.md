# T07: Google Drive アダプタ

状態: 未着手 / 依存: T01 (認証 UX の型)、T05 (テスト網)

## 目的

同期方式に Google Drive を追加し「対応予定」表示を解消する。StorageAdapter 契約 (03_詳細設計書) を実装すれば、上位層 (BookshelfStorage / アプリ) は無変更で動くのが設計の狙い。

## アーキテクチャ決定

- **認証**: Google Identity Services (GIS) の **token model** (`accounts.google.com/gsi/client`、CDN 読込はこのタスクに限り許可)。`initTokenClient` + scope **`https://www.googleapis.com/auth/drive.file`** のみ
  - `drive.file` は**非センシティブ scope** → Google の審査なしで本番公開でき、テストモードの 7 日失効も回避できる。**consent 画面は必ず Production に publish する** (runbook 参照)
  - access token は約 1 時間。期限切れ時は `requestAccessToken({ prompt: '' })` でサイレント再取得 → 失敗したらステータスバーで再接続誘導 (T01 と同じ UX パターン)
- **client_secret 不要** (token model は public client)。Client ID は定数としてコードに埋め込み
- **フォルダ**: `drive.file` はアプリが作ったファイルしか見えないため、初回接続時にアプリが Drive ルートへ **`bookshelf-data` フォルダを作成**し、その fileId を `bookshelf_sync.googleDrive.rootFolderId` に保存。ユーザによる任意フォルダ選択はしない
- **バッチなし**: Drive に Trees API 相当はない。`syncBatch` はアダプタがバッチ未対応の場合の**逐次書きフォールバック** (storage.js 実装済み) に乗る

## 事前手作業 (ユーザ) — ✅ 完了 (2026-06-12)

GCP プロジェクト作成・Drive API 有効化・同意画面 Production 化・OAuth クライアント作成済み。

- **Client ID**: `71180460551-i3tltloc3sl2oej2avi748ns2qmm6cvd.apps.googleusercontent.com` (公開情報。コード定数に埋め込む)
- このクライアントは**全ユーザ共用** (ホスト型マルチユーザ、ADR-028)。各ユーザは自分の Google アカウントで認可し、自分の Drive にだけ書く。JavaScript 生成元はホストされたアプリの URL + localhost のみで足りる

## 実装手順

1. **`js/gdrive-adapter.js` (新規)** — `StorageAdapter` を継承し全インタフェースを実装:
   - path→fileId 解決: ルートから 1 階層ずつ `files.list` (`q: '<parentId>' in parents and name='<seg>' and trashed=false`) で辿り、**Map でキャッシュ** (書込/削除で該当エントリを無効化)
   - `readJSON`/`readText`: `GET files/{id}?alt=media`。404/未解決 → null
   - `writeJSON`/`writeText`: 既存あり → `PATCH upload/drive/v3/files/{id}?uploadType=media`、新規 → multipart で `POST upload/drive/v3/files?uploadType=multipart` (metadata に name + parents)。**親フォルダは無ければ作成** (mimeType `application/vnd.google-apps.folder`)
   - `listFiles`/`listDirs`: `files.list` を mimeType で振り分け。ページネーション (`nextPageToken`) を処理
   - `deleteFile`: `DELETE files/{id}`。存在しなければ黙って成功
   - 401 → トークン再取得を 1 回試行してリトライ (T01 の `_ensureFresh…` パターンを Drive 用に用意)
   - レート制限 (403 userRateLimitExceeded / 429) → 指数バックオフで最大 3 回
2. **`js/gdrive-auth.js` (新規)**: GIS スクリプトの遅延ロード (Drive 選択時のみ)、`connect()` (同意ポップアップ)、`ensureToken()` (サイレント再取得 + 同時実行ガード)、token と expiry を `bookshelf_sync.googleDrive` に保存
3. **`js/sync-config.js`**: `googleDrive: { token, tokenExpiresAt, rootFolderId }` スキーマ + `buildAdapter` に分岐追加
4. **設定 UI** (`js/bookshelf.js` + `index.html`): 同期方式セレクタの Google Drive を有効化 (「対応予定」表示を撤去)。接続ボタン → 同意 → `bookshelf-data` フォルダ作成 → 接続済み表示 (アカウント名は `drive/v3/about?fields=user` で取得)。切断でトークン破棄
5. 起動分岐: `initSync()` に `google-drive` を追加 (GitHub と同型: loadAll → 適用、空なら initEmpty)
6. script タグ追加 + `?v=` バンプ

## 受け入れ基準

1. 接続フロー: 同意 → `bookshelf-data` フォルダが Drive に作成され、接続済み表示になる
2. アダプタ単体 (console から): `writeText('_test/ping.json', …)` → Drive 上に `_test/ping.json` が出現 → `readText` 一致 → `listFiles('_test')` に出る → `deleteFile` で消える
3. 空フォルダで初回起動 → `initEmpty` が new 構造を生成し、アプリが起動する
4. メモ編集 → 保存 → Drive 上の該当 JSON が更新される。リロードで反映が残る
5. トークン失効シミュレーション (token を不正値に書換) → サイレント再取得 or 再接続誘導で復帰し、例外で UI が死なない
6. GitHub / ローカル同期が無影響 (T05 smoke green + GitHub 接続での起動確認)
7. console エラー 0

⚠️ 検証はユーザの Drive に書く (ユーザ自身のストレージなので可)。`_test/` 配下は検証後に削除。

## 設計書同期

- 02_基本設計書: 同期方式の表に Drive を ✅ で追加 (token model / drive.file / rootFolderId)
- 03_詳細設計書: GoogleDriveAdapter / gdrive-auth の節を追加
- 06_データ仕様書: `bookshelf_sync.googleDrive` スキーマ
- 01_要件定義書: F-06-1 / NF-03 の表を更新
- 07_残検討事項: Drive 行を削除
- 08_意思決定記録: 「ADR-026 Drive は GIS token model + drive.file (審査不要・アプリ専有フォルダ)」を新規追記

## コミット

`feat: Google Drive 同期アダプタ (GIS + drive.file) (設計: 01/02/03/06/08 更新)`
