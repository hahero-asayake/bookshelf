-- Asayake コミュニティ (ADR-044) D1 スキーマ
-- 公開本棚ギャラリー＋プラグインマーケットの社会機能 (スター/コメント/通報/集計)。
-- 適用例 (hahero 手動・着手時):
--   wrangler d1 create asayake-community            # database_id を控える
--   wrangler.hub.toml の [[d1_databases]] を有効化し database_id を貼る
--   wrangler d1 execute asayake-community --remote --file=community-schema.sql
-- ※ wrangler は WSL 不可 → powershell.exe 経由で実行する。

-- 掲載された公開本棚 (オプトイン)。url は hub /public/<siteId>/ でも GitHub Pages 等の外部 URL でも可。
CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,            -- 掲載エントリ id (uuid)
  uid         TEXT NOT NULL,               -- 掲載者 (Google sub)。URL には晒さない
  url         TEXT NOT NULL,               -- 公開本棚 URL
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url   TEXT NOT NULL DEFAULT '',    -- OGP/サムネ
  tags        TEXT NOT NULL DEFAULT '',    -- カンマ区切り
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0   -- モデレーション (Phase C)
);
CREATE INDEX IF NOT EXISTS idx_sites_uid    ON sites(uid);
CREATE INDEX IF NOT EXISTS idx_sites_hidden ON sites(hidden);

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

-- 通報 (Phase C モデレーションキュー)。
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  comment_id  TEXT NOT NULL DEFAULT '',
  uid         TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
