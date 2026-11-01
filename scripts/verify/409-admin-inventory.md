# #409 管理者限定機能の洗い出し（着手前・2026-11-01）

対象リポジトリ: `~/GitHub/bookshelf`（HEAD `0f83ccd`、未コミットは `scripts/verify/*` の未追跡ファイルのみ・`js/bookshelf.js`/`index.html`/`css/bookshelf.css` に変更なし）。
`grep -rn -i "admin\|管理者\|ADMIN_EMAILS"` を `index.html`・`js/bookshelf.js`・`js/hub-auth.js`・`cf-worker/asayake-hub.js` に対して実行し、以下で全件を網羅した（他ファイルにヒットなし）。

## 1. アプリ側（設定モーダル）に表示される管理者限定機能

| # | 機能 | 置き場所（設定のカテゴリ・画面） | 表示条件（判定の仕方） | 操作の内容 | サーバー側の拒否 |
|---|---|---|---|---|---|
| A | プラン手動切替（Plus にする／無料にする／課金リンクをリセット） | 設定 → **アカウント** 内 `#account-admin`（`index.html:427-436`） | `js/bookshelf.js:4715-4716` で `admin.hidden = !hub.isAdmin`（`hub.isAdmin` は `/session` 応答由来・`js/hub-auth.js:120/156`） | `_adminSetPlan(plan, reset)`（`js/bookshelf.js:5205`）→ `POST /admin/plan`（対象はメールアドレス指定） | `cf-worker/asayake-hub.js:399-402` `handleAdminSetPlan` が `isAdminEmail(caller.email, env)` を再検証し、非管理者は **403 'admin only'** |
| B | 通報の審査（一覧表示・一覧から外す/hide・一覧に戻す/restore・却下/dismiss） | 設定 → **アカウント** 内 `#account-admin-reports`（`index.html:438-441`） | `js/bookshelf.js:4717-4720` で `adminReports.hidden = !hub.isAdmin`（表示時に `_loadReportReview()` を自動実行） | `_loadReportReview`（`:5123`）が `GET /admin/reports?status=open`、操作ボタンから `POST /admin/articles/:id/hide|restore`、`POST /admin/reports/:id/dismiss` | `cf-worker/asayake-hub.js:1589-1592` `requireAdmin()` が3エンドポイント共通で `isAdminEmail` を再検証し403（451停止系はこの hide/restore 経由） |

→ **アカウントに置かれている管理者限定機能はこの2ブロックのみ**。今回「管理者」カテゴリへ移設する対象。

## 2. サーバー側のみ（アプリ側にUIが無い管理API）

| # | 機能 | エンドポイント | 表示条件 | サーバー側の拒否 |
|---|---|---|---|---|
| C | プラグインの登録・更新 | `POST /admin/plugins`（`cf-worker/asayake-hub.js:108`） | UIなし（クライアントから呼ぶコードが無い＝運用者が直接叩く想定） | `handleAdminUpsertPlugin`（`:449-453`）が `isAdminEmail` を検証し403 |

→ 設定画面への移設対象外（UIが存在しないため）。表に「UI無し」と明記するのみ。

## 3. 管理者判定が絡むが「管理者限定機能」ではないもの（移設対象外）

| # | 箇所 | 内容 | 判定 |
|---|---|---|---|
| D | `cf-worker/asayake-hub.js:1396-1406` `handleCommunitySiteDelete` | 掲載の取り下げ。**本人 or 管理者**のどちらでも実行できる（owner 不一致のときだけ admin を許可）。UIは一般利用者の削除導線と共通で、管理者専用の入口は無い | 移設対象外（「管理者限定機能」ではなく、一般機能に管理者も通れる例外が付いているだけ） |
| E | `js/bookshelf.js:4278` | GitHub OAuth Client ID 未設定時のトースト文言に「bookshelf 管理者に問い合わせる」という**文言**が出るだけ（運営者への問い合わせ案内・機能ではない） | 対象外 |
| F | `index.html:415` `#account-comp-notice` | 「管理者付与の Plus です」という**一般利用者向け**の案内文（comp プランの説明・管理者操作ではない） | 対象外（アカウントに残す） |

## まとめ（判定の結論）

- 管理者の判定は **クライアント側の表示条件だけではない**。A・B・C のいずれもサーバー側で `isAdminEmail(email, env)`（`ADMIN_EMAILS` secret との照合）を再検証しており、非管理者が叩いても403で拒否される。クライアントの `hidden` 切替は見た目の制御のみ。
- 移設対象は **A・B の2ブロック**（設定→アカウント内 → 設定→管理者 へ）。C はUIが無いため対象外、D〜F は管理者限定機能ではないため対象外。
