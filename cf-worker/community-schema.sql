-- Asayake コミュニティ (ADR-044) D1 スキーマ
-- 公開本棚ギャラリー＋プラグインマーケットの社会機能 (スター/コメント/通報/集計)。
-- 適用例 (hahero 手動・着手時):
--   wrangler d1 create asayake-community            # database_id を控える
--   wrangler.hub.toml の [[d1_databases]] を有効化し database_id を貼る
--   wrangler d1 execute asayake-community --remote --file=community-schema.sql
-- ※ wrangler は WSL 不可 → powershell.exe 経由で実行する。

-- 索引 (ADR-099): ハブ公開の記事だけを載せる記事単位の行。POST /publish が index を同送して upsert / 削除同期する。
-- 自前公開 (GitHub Pages 等) の記事は索引に入れない (登録口は無い)。url は https://bookshelf.asayake.org/<username>/<publicId>/。
CREATE TABLE IF NOT EXISTS sites (
  id           TEXT PRIMARY KEY,            -- 索引エントリ id (uuid)
  uid          TEXT NOT NULL,               -- 公開者 (Google sub)。URL には晒さない
  url          TEXT NOT NULL,               -- 記事の公開 URL
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  cover_url    TEXT NOT NULL DEFAULT '',    -- OGP/サムネ
  tags         TEXT NOT NULL DEFAULT '',    -- カンマ区切り
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  hidden       INTEGER NOT NULL DEFAULT 0,  -- 旧列。status と同期して残す (旧 Worker へ戻しても隠した記事が出ないため)
  source       TEXT NOT NULL DEFAULT 'hub', -- 常に 'hub' (自前公開は索引しない)
  public_id    TEXT NOT NULL DEFAULT '',    -- 記事の publicId (base62 10 文字・不変)
  status       TEXT NOT NULL DEFAULT 'active', -- active | hidden | quarantined (自動仮非表示 B 用の予約)
  report_count INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL DEFAULT 0,
  modified_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sites_uid    ON sites(uid);
CREATE INDEX IF NOT EXISTS idx_sites_hidden ON sites(hidden);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_uid_pub ON sites(uid, public_id) WHERE public_id != '';
CREATE INDEX IF NOT EXISTS idx_sites_status_created ON sites(status, created_at DESC);

-- 集計 (ランキング読取の高速化。star/comment/install は書込時に増減する)。
CREATE TABLE IF NOT EXISTS stats (
  target_type   TEXT NOT NULL,             -- 'plugin' | 'site'
  target_id     TEXT NOT NULL,
  star_count    INTEGER NOT NULL DEFAULT 0,
  install_count INTEGER NOT NULL DEFAULT 0,
  view_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (target_type, target_id)
);

-- スター (ログイン無料・1 uid 1 票で重複防止)。
CREATE TABLE IF NOT EXISTS stars (
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  uid         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_stars_uid ON stars(uid);

-- コメント (投稿=有料会員のみ・閲覧は無料, Phase B)。
CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  uid          TEXT NOT NULL,              -- 投稿者 (内部。一覧では author_name のみ返す)
  author_name  TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  hidden       INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at);

-- 通報 (Phase C モデレーションキュー / ADR-099)。全件手動審査 (自動措置なし)。
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  comment_id  TEXT NOT NULL DEFAULT '',
  uid         TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',   -- spam | abuse | illegal | discrimination | dead | other
  status      TEXT NOT NULL DEFAULT 'open',    -- open | actioned | dismissed
  handled_at  INTEGER NOT NULL DEFAULT 0,
  weight      INTEGER NOT NULL DEFAULT 1       -- 自動仮非表示 B 用の予約 (ローンチは常に 1)
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
-- 重複通報の防止 (同一 uid が同一対象を再通報できない)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_uniq ON reports(target_type, target_id, uid, comment_id);
