-- ADR-099 / イシュー#220: 索引を記事単位 (ハブ公開のみ) にし、通報を審査キュー化する。追加型のみ (既存列は消さない)。
-- 旧 hub Worker (hidden 列で絞る版) のままでも動く = wrangler rollback しても D1 は壊れない。
-- 適用: wrangler d1 execute asayake-community --remote -c wrangler.hub.toml --file=migrations/0001_index_articles.sql
-- ※ 1 回だけ実行する (ALTER TABLE ADD COLUMN は再実行すると duplicate column で失敗する)。
-- ※ 適用前に `wrangler d1 export asayake-community --remote --output=...` で退避すること。
-- ※ 旧登録 API 由来の行 (public_id='') の削除は破壊的なため 0002 に分けてある。

ALTER TABLE sites ADD COLUMN source       TEXT    NOT NULL DEFAULT 'hub';
ALTER TABLE sites ADD COLUMN public_id    TEXT    NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN status       TEXT    NOT NULL DEFAULT 'active';
ALTER TABLE sites ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN published_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN modified_at  INTEGER NOT NULL DEFAULT 0;
-- 旧登録 API 由来の行は public_id='' のまま残る (部分 UNIQUE の対象外)。新コードの一覧は status='active' で絞る。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_uid_pub ON sites(uid, public_id) WHERE public_id != '';
CREATE INDEX IF NOT EXISTS idx_sites_status_created ON sites(status, created_at DESC);

ALTER TABLE reports ADD COLUMN category   TEXT    NOT NULL DEFAULT 'other';
ALTER TABLE reports ADD COLUMN status     TEXT    NOT NULL DEFAULT 'open';
ALTER TABLE reports ADD COLUMN handled_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN weight     INTEGER NOT NULL DEFAULT 1;
-- 重複通報の防止: 既存の重複行は最古 1 件だけ残して整理してから UNIQUE を張る (旧 API は重複を許していた)。
DELETE FROM reports WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM reports GROUP BY target_type, target_id, uid, comment_id
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_uniq ON reports(target_type, target_id, uid, comment_id);
