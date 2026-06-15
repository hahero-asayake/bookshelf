# 撤去済み: Google Drive / Dropbox 同期バックエンド

2026-06-16 に **アプリ本体から撤去**したコード（ADR-036）。**消さずにここへ退避**している（`_trash/` は最終的に削除する前提のため、永続保存先として `archive/` を使う）。git 履歴にも残るが、参照しやすいよう実体を置く。

## なぜ撤去したか（要約）
共有 OAuth アプリで Drive/Dropbox 同期を提供すると、**連携ユーザ数の上限**（Dropbox 開発ステータス〜数十人 / Google 未確認 100人）と、それを超えるための **Production 申請・Google 確認＋継続運用**が発生する。無料で提供しても上限は消えない（上限は「料金」でなく「共有アプリ」の性質）。一方で：
- ゼロ設定の無料多端末同期は **Asayake ハブ（R2・100MB）** が担う。
- 「自分のストレージで無制限・無料」は **GitHub**（GitHub App は同種の上限が無い）が担う。

→ Drive/Dropbox は hub+GitHub と機能が重複し、運用負荷だけ残るため撤去。詳細は設計書 08_意思決定記録 ADR-036。

## 含まれるファイル
- `gdrive-adapter.js` / `gdrive-auth.js` … Google Drive（GIS トークン・`drive.file` 相当）
- `dropbox-adapter.js` / `dropbox-auth.js` … Dropbox（PKCE・refresh トークン）

いずれも `StorageAdapter` を継承した `StorageAdapter` 実装で、`window.<Class>` グローバルに載る素の vanilla JS。

## 復元するには（概略）
1. この 4 ファイルを `js/` に戻す。
2. `index.html`：`<script>` タグ4本を戻す＋同期方式 `<option>`（google-drive/dropbox）＋設定パネル（`#sync-config-google-drive` / `#sync-config-dropbox`）を戻す。
3. `js/sync-config.js`：`defaults()` の `googleDrive`/`dropbox`、`buildAdapter` の `case`、`_buildGoogleDrive`/`_buildDropbox` を戻す。
4. `js/bookshelf.js`：`initSync`/`initCloudSync` の分岐、`_setupSyncMethodUI` のパネル表示、Drive/Dropbox 接続 UI メソッド群、`_isSyncReady`/`_syncLabel`/`isCloud` の方式リスト、起動時の Dropbox `?code=` リダイレクト処理を戻す。
5. `css/bookshelf.css`：`.dropbox-redirect-*`。
6. 外部：hahero の Dropbox アプリ / Google OAuth クライアント（撤去時に削除していなければそのまま使える）。

撤去コミットの diff（`git log` で ADR-036 の commit）を見れば、戻すべき配線が網羅されている。
