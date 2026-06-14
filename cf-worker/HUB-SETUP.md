# Asayake Hub セットアップ手順 (hahero 初回 1 回)

> 共有公開先＋私的同期 (平文) のインフラを立てる runbook。設計は [09_公開システム設計] §10 / ADR-032。
> Worker 実体は [asayake-hub.js](asayake-hub.js)、設定は [wrangler.hub.toml](wrangler.hub.toml)。
>
> **方式: 単一ドメイン・パス分離**。公開は `https://<HUB_DOMAIN>/public/<siteId>/...`、
> 私的同期と API は `https://<HUB_DOMAIN>/data|/session|/publish`。origin 分離 (サブドメイン) はしない
> → **wildcard DNS/TLS も PSL も不要**。安全性は「ハブ≠アプリ origin ＋ cookie 不使用 (Bearer) ＋ /public は CSP script 無し」で担保 (asayake-hub.js 冒頭の 4 不変条件)。
>
> **依存順**: A リソース作成 → B Worker デプロイ＋配線 → C 検証 → D 公開準備。

---

## Step 0. ドメイン (確定: `asayake.org`)

- **ドメイン**: `asayake.org` (取得済み)。
- **ハブ**: `hub.asayake.org` ← `HUB_DOMAIN`。アプリと別 origin にして機密 localStorage を守る。
- **アプリ (任意・後でよい)**: GitHub Pages の**ユーザサイト**にカスタムドメインを当てると `hahero-asayake.github.io/bookshelf` → **`asayake.org/bookshelf`** (パス維持・github.io は 301 リダイレクト)。→ 末尾「アプリ移行」。

> ハブ (Phase A–C) はアプリ移行と独立。アプリは github.io のままでも動く。

---

## Phase A. リソース作成

### A-1. Cloudflare ゾーン
1. Cloudflare アカウント作成 → Registrar で取得 (or 既存ドメインを Add a Site → NS 変更)。
2. ゾーンが Active、Universal SSL 発行済みを確認 (SSL/TLS → Edge Certificates)。**wildcard 証明書は不要** (単一ホストのみ)。

### A-2. R2 バケット
1. R2 を有効化 (**無料枠内でも支払い方法の登録が必要**)。
2. バケット作成: **名前 `asayake-hub`**。
3. (durability) R2 に S3 的版管理は無い。私的データ (平文) の誤削除/障害対策として **定期バックアップ方針**を決める (例: 日次で別バケットへコピーする Cron Worker)。当面はユーザの「全データ エクスポート」で許容も可。→ D-2。

### A-3. KV 名前空間
1. Workers & Pages → KV → Create: **`asayake-hub-kv`**。📝控える: **namespace ID**。

### A-4. Google OAuth クライアント (サインイン用 ID トークン)
1. Google Cloud でプロジェクト作成。
2. **OAuth consent screen**: External、scope = `openid` `email` `profile` (**非センシティブ**) → **Publish 可** (Google 審査不要・テストユーザ上限なし)。
3. **Credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins** = `https://hahero-asayake.github.io` ＋ (アプリ移行するなら) `https://asayake.org`。ローカル検証時は `http://localhost:8011` も。
   - リダイレクト URI 不要 (Sign in with Google の ID トークン credential 方式)。secret も不要。
4. 📝控える: **Client ID** (`xxxxx.apps.googleusercontent.com`)。

---

## Phase B. Worker デプロイ + 配線

> oauth-proxy とは別 Worker (service 名 `asayake-hub`)。

### B-1. wrangler.hub.toml を埋める
[wrangler.hub.toml](wrangler.hub.toml) の `<...>` を置換: `HUB_DOMAIN` (=単一ホスト)、`GOOGLE_CLIENT_ID`、KV `id`、route の `<your-hub-host>` / `zone_name`、`APP_ORIGIN`、`QUOTA_BYTES`。**secret 不要**。

### B-2. デプロイ
```bash
npm i -g wrangler            # 初回のみ
wrangler login
cd cf-worker
wrangler deploy -c wrangler.hub.toml
```

### B-3. DNS (自動)
`wrangler.hub.toml` の route は `custom_domain = true` なので、**`wrangler deploy` が `hub.asayake.org` の DNS レコードと TLS 証明書を自動作成**する。手動の DNS 追加は不要 (証明書発行に数分かかることがある)。

---

## Phase C. 検証 (security-critical — 必ず実機で)

1. **配信**: R2 に `sites/test/index.html` を置き、`https://<HUB_DOMAIN>/public/test/` が表示。レスポンスに **CSP (`script-src` 無し＝`default-src 'none'`)**・`Set-Cookie` 無しを確認。
2. **認証**: Google サインイン → ID トークンを `POST /session` → `{key, siteId, publicBase}`。改ざん/別 aud は **401**。
3. **私的 API**: 返ったキーで
   - `PUT /data/private/library.json` → `ETag` → 古い If-Match で再 PUT は **412**。
   - 別キーで他人の `/data/` が読めないこと。`?list=1` / `DELETE` / `POST /data/batch` 往復。quota 超過で **413**。
4. **パストラバーサル**: `..` 入り path が **400**。
5. **公開**: `POST /publish` (キー付) → `sites/<siteId>/` に書かれ `/public/<siteId>/` で見える。削除同期 (`deleteMissing`) で消える。

> ここが通って初めて UI 統合 (5 つ目の同期方式・公開先「共有」) に進む。

---

## Phase D. 公開準備 (運営として必須)

1. **ToS / プライバシーポリシー** (平文で私的個人データを預かる = hahero が管理者)。削除・エクスポート要求の窓口、通報導線。
2. **バックアップ** (A-2 の方針を実装 or 明文化)。
3. **通報→停止**: KV `report:<siteId>` を `suspended` にすると `/public/<siteId>/` が 451。

---

## 控える値チェックリスト (B で使用)
- [ ] `HUB_DOMAIN` = `hub.asayake.org` (確定)
- [ ] KV namespace ID
- [ ] Google Client ID
- [ ] (確認) R2 `asayake-hub` / KV `asayake-hub-kv` / Universal SSL 発行済

> UI 統合 (`js/hub-auth.js` の `GOOGLE_CLIENT_ID`・`HUB_API_BASE`、設定導線) は Phase C 通過後。

---

## アプリ移行 (任意・後でよい) — `asayake.org/bookshelf` 化

ハブ (A–C) とは独立。github.io のままでも動くので**急がない**。やるなら:

1. **GitHub Pages のユーザサイトにカスタムドメイン**: `hahero-asayake.github.io` **repo** (ユーザサイト) の Settings → Pages → Custom domain = `asayake.org`。repo に `CNAME` ファイル (`asayake.org`) がコミットされる。
   → アカウント全体に波及: `hahero-asayake.github.io/bookshelf` → **`asayake.org/bookshelf`** (パス維持)。github.io は 301 で `asayake.org` にリダイレクト。
2. **DNS** (`asayake.org` ゾーン): apex の A レコードを **GitHub Pages の IP** (`185.199.108–111.153`) に。**GitHub に TLS を取らせるため DNS-only (グレー雲)** にする (proxied だと Pages の Let's Encrypt が詰まる)。`www` も CNAME → `hahero-asayake.github.io` (任意)。
3. **OAuth オリジンを追加** (アプリが `asayake.org` origin で動くため。消さず追加):
   - **Google Drive** (GIS): 承認済み JS オリジンに `https://asayake.org`
   - **Dropbox**: Redirect URI に `https://asayake.org/bookshelf/` (完全一致登録、ADR-027)
   - **ハブ** (Google OIDC): JS オリジンに `https://asayake.org`
   - **GitHub** (Device Flow): 変更不要 (origin 非依存)
4. **Worker `APP_ORIGIN`**: 既に `https://hahero-asayake.github.io,https://asayake.org` を許可済 (移行中も両対応)。
5. コード内の絶対参照 (publish-generator の footer リンク `https://hahero-asayake.github.io/bookshelf`、`storage.js` の `extensionImportOrigins`) は動くが旧ドメイン指す → 落ち着いたら `asayake.org/bookshelf` に更新 (任意)。

> ハブだけ先に立てる場合、この節は飛ばしてよい。
