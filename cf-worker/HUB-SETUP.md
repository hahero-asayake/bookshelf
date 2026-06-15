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

## Phase C. 検証 (security-critical — 必ず実機で) ＝ B-3「実機検証」の手順書

> Worker 再デプロイ後、**ハブ機能を本番投入する前に必ずここを通す**。Google ログインは自動化できないので手動。
> アプリ (`hahero-asayake.github.io/bookshelf`) を開き、設定→同期/アカウントから操作する。

1. **配信**: R2 に `sites/test/index.html` を置き、`https://<HUB_DOMAIN>/public/test/` が表示。レスポンスに **CSP (`script-src` 無し＝`default-src 'none'`)**・`Set-Cookie` 無しを確認。
2. **認証**: Google サインイン → ID トークンを `POST /session` → `{key, siteId, publicBase}`。改ざん/別 aud は **401**。
   - ※ 事前に **Google Cloud Console の OAuth クライアント (Web)** の「承認済み JavaScript 生成元」にアプリ配信元 (`https://hahero-asayake.github.io`、移行後は `https://asayake.org`) が登録済みであること。未登録だと GIS ボタンが出ても認証が通らない。OAuth 同意画面にプライバシー URL (`…/bookshelf/legal/privacy.html`) も登録。
3. **私的 API**: 返ったキーで
   - `PUT /data/private/library.json` → `ETag` → 古い If-Match で再 PUT は **412**。
   - 別キーで他人の `/data/` が読めないこと。`?list=1` / `DELETE` / `POST /data/batch` 往復。quota 超過で **413**。
4. **パストラバーサル**: `..` 入り path が **400**。
5. **公開**: `POST /publish` (キー付) → `sites/<siteId>/` に書かれ `/public/<siteId>/` で見える。削除同期 (`deleteMissing`) で消える。
6. **アフィリンク /go (ADR-034追補)**: 公開ページの Amazon リンクが `https://<HUB_DOMAIN>/go/<siteId>/<asin>` になっていること。これを開くと Amazon へ **302**。
   - **Free** のとき → `?tag=<OPERATOR_AFFILIATE_TAG>` 付き (vars の値) に飛ぶ。
   - **Plus** のとき → 公開時に送った本人タグ付きに飛ぶ。
   - **Plus→Free 降格 (Phase E で解約)** 後、**再公開せずに**同じ `/go` を開くと運営タグに切替わっている (= キャッシュ無効 `no-store` の効果)。`..`/不正 ASIN は **400**。
7. **退会 `DELETE /account`**: アカウント削除 → `data/<uid>/`・`sites/<siteId>/`・KV (`uid:`/`key:`/`report:`/`site:`) が消える。削除後 `/public/<siteId>/` が **404**、キーが **401**。

> ここが通って初めて UI 統合 (5 つ目の同期方式・公開先「共有」) と課金 (Phase E) を本番投入する。

---

## Phase D. 公開準備 (運営として必須)

1. **ToS / プライバシーポリシー** (平文で私的個人データを預かる = hahero が管理者)。削除・エクスポート要求の窓口、通報導線。
2. **バックアップ** (A-2 の方針を実装 or 明文化)。
3. **通報→停止**: KV `report:<siteId>` を `suspended` にすると `/public/<siteId>/` が 451。

---

## Phase E. 課金 (Stripe Managed Payments, ADR-035 / ADR-037) — Plus プラン

> アプリ側の課金導線・Worker エンドポイント (`/billing/checkout` `/billing/portal` `/billing/webhook`)・プラン反映ロジックは**実装済**。
> ここは **Stripe 口座・商品・キー設定**だけ。未設定の間は課金系が **503** を返し、他機能には影響しない。
>
> **Managed Payments (ADR-037)**: Checkout に `managed_payments[enabled]=true` を送り、Stripe を **Merchant of Record** にする。
> 売上税/VAT の計算・徴収・納付は **Stripe が代行**する (= hahero 自身が各国の税登録・申告をしなくてよい)。
> **プレビュー機能**につき、Checkout・商品作成・Webhook はいずれも **`Stripe-Version: 2026-02-25.preview` 以上**で叩く。
> 手数料は標準 (2.9%+$0.30) に税処理ぶんが上乗せされる → 価格設定はこれ込みで判断する。

### E-1. Stripe アカウント + 商品/価格 (tax_code 付き)
1. Stripe アカウント作成 (https://dashboard.stripe.com)。最初は **テストモード**で通す。`STRIPE_SECRET_KEY` を環境変数に入れておく (`sk_test_…`)。
2. 課金資格 (本人確認/口座) を済ませ、**Managed Payments** が使える状態にする (プレビュー枠の有効化が要る場合は Stripe に依頼)。
3. **商品 (tax_code 付き) と Price 2 本を API で作成** (Dashboard はプレビューの税コードを出さないことがあるため curl が確実):
   ```bash
   # 1) 商品を作成。tax_code はデジタル/SaaS 用 (適格要件は Stripe の Tax codes 一覧で確認)。📝 返り値の id (prod_…) を控える
   curl https://api.stripe.com/v1/products \
     -u "$STRIPE_SECRET_KEY:" \
     -H "Stripe-Version: 2026-02-25.preview" \
     -d name="AsayakeBookshelf Plus" \
     -d description="公開ストレージ 3GB ＋ アフィリエイト収益を自分のタグで受け取る" \
     -d tax_code="txcd_10103100"

   # 2) 月額 Price ($2/月 = 200)。📝 price_… → STRIPE_PRICE_MONTHLY
   curl https://api.stripe.com/v1/prices \
     -u "$STRIPE_SECRET_KEY:" \
     -H "Stripe-Version: 2026-02-25.preview" \
     -d product="prod_xxx" -d unit_amount=200 -d currency=usd -d "recurring[interval]=month"

   # 3) 年額 Price ($5/年 = 500。月額の約2か月ぶんへ大幅割引=年額に寄せる)。📝 price_… → STRIPE_PRICE_YEARLY
   curl https://api.stripe.com/v1/prices \
     -u "$STRIPE_SECRET_KEY:" \
     -H "Stripe-Version: 2026-02-25.preview" \
     -d product="prod_xxx" -d unit_amount=500 -d currency=usd -d "recurring[interval]=year"
   ```
4. **Customer Portal** を有効化 (Settings → Billing → Customer portal)。解約・支払い方法変更を許可。`/billing/portal` がこれを開く。

### E-2. Webhook エンドポイント (Checkout と同じプレビュー版で)
1. Developers → **Webhooks → Add endpoint**: URL = `https://hub.asayake.org/billing/webhook`。
2. **API version = `2026-02-25.preview`** を選ぶ (Checkout と同版。イベント形を揃え、Managed Payments の `checkout.session.completed` を確実に受ける)。
3. 送信イベント: **`checkout.session.completed`** / **`customer.subscription.deleted`** / **`customer.subscription.updated`**。
4. 📝 **Signing secret** (`whsec_…`) を控える → `STRIPE_WEBHOOK_SECRET`。

### E-3. キー/価格を Worker に設定 → 再デプロイ
```bash
cd cf-worker
# vars (wrangler.hub.toml): STRIPE_PRICE_* を E-1 の price_… に、STRIPE_API_VERSION は 2026-02-25.preview のまま
wrangler secret put STRIPE_SECRET_KEY      -c wrangler.hub.toml   # sk_test_… → 本番は sk_live_…
wrangler secret put STRIPE_WEBHOOK_SECRET  -c wrangler.hub.toml   # whsec_…
wrangler deploy -c wrangler.hub.toml
```

### E-4. 実機検証 (テストモード)
1. アプリ→設定→アカウントでログイン (Free) → **「月額で Plus にする」** → Stripe Checkout。
2. **請求先住所を変えて** 税額の出方を見る (Managed Payments が地域別に計算)。テストカード `4242 4242 4242 4242` で決済 → 戻ると `?billing=success` → 数秒後に使用量バーが **Plus / 3GB** に。
3. Webhook ログ (Stripe Dashboard) が 200。KV `plan:<uid>.plan=plus`・`stripe:<customer>=<uid>` を確認。
4. **「支払い・解約の管理」** → Portal で解約 → `customer.subscription.deleted` → KV が `plan=free`・quota 100MB に戻る。Phase C-6 の **/go 降格切替**もここで確認。
5. 通れば **本番キー** (`sk_live_…`・本番 webhook secret) に差し替えて再デプロイ。

> 決済の実体は Stripe ホスト画面。アプリ/Worker はカード情報を一切持たない (PCI 範囲を Stripe に寄せる)。税も Stripe (MoR) が処理する。

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
   - **ハブ** (Google OIDC): JS オリジンに `https://asayake.org`
   - **GitHub** (Device Flow): 変更不要 (origin 非依存)
4. **Worker `APP_ORIGIN`**: 既に `https://hahero-asayake.github.io,https://asayake.org` を許可済 (移行中も両対応)。
5. コード内の絶対参照 (publish-generator の footer リンク `https://hahero-asayake.github.io/bookshelf`、`storage.js` の `extensionImportOrigins`) は動くが旧ドメイン指す → 落ち着いたら `asayake.org/bookshelf` に更新 (任意)。

> ハブだけ先に立てる場合、この節は飛ばしてよい。
