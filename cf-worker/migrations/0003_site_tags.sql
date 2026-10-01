-- S7 (イシュー#269): タグ横断検索用の site_tags 表を追加する。追加型のみ (既存列は消さない)。
-- 適用: wrangler d1 execute asayake-community --remote -c wrangler.hub.toml --file=migrations/0003_site_tags.sql
-- ※ 適用前に `wrangler d1 export asayake-community --remote --output=...` で退避すること。
-- ※ CREATE TABLE/INDEX は IF NOT EXISTS なので再実行しても壊れないが、下の backfill INSERT は
--    INSERT OR IGNORE なので再実行しても重複は作らない (冪等)。
-- 戻し方: `DROP TABLE site_tags;` (sites.tags が正本のままなので他表への影響は無い)。

CREATE TABLE IF NOT EXISTS site_tags (
  site_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (site_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_site_tags_tag ON site_tags(tag);

-- backfill: 既存 sites.tags (カンマ区切り) を 1 タグ 1 行へ展開する。
-- SQLite に split 関数が無いため再帰 CTE で分解する (末尾にカンマを足してから先頭から1語ずつ切り出す)。
WITH RECURSIVE split(site_id, rest, tag) AS (
  SELECT id, tags || ',', NULL FROM sites WHERE tags != ''
  UNION ALL
  SELECT site_id,
         substr(rest, instr(rest, ',') + 1),
         substr(rest, 1, instr(rest, ',') - 1)
  FROM split
  WHERE rest != ''
)
INSERT OR IGNORE INTO site_tags (site_id, tag)
SELECT site_id, trim(tag) FROM split WHERE tag IS NOT NULL AND trim(tag) != '';
