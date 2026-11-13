-- イシュー#584: 端末エラーの匿名受け口 (POST /client-error・client-errors.js) が数える client_errors 表を追加する。追加型のみ。
-- 適用: wrangler d1 execute asayake-community --remote -c wrangler.hub.toml --file=migrations/0004_client_errors.sql
-- ※ 適用前に `wrangler d1 export asayake-community --remote --output=...` で退避すること。
-- ※ CREATE TABLE は IF NOT EXISTS なので再実行しても壊れない (冪等)。
-- 戻し方: `DROP TABLE client_errors;` (他表からの参照は無い)。

-- (JST の日, 指紋) ごとに 1 行。IP・User-Agent・Cookie・Bearer は持たない (列を作らない)。
CREATE TABLE IF NOT EXISTS client_errors (
  day      TEXT NOT NULL,               -- JST の 'YYYY-MM-DD'
  fp       TEXT NOT NULL,               -- sha256("v|screen|msg") の先頭 16 桁 hex
  v        TEXT NOT NULL,               -- アプリの版
  screen   TEXT NOT NULL,               -- 画面名 (英数と - _)
  msg      TEXT NOT NULL,               -- エラーの先頭行 (200 字まで)
  count    INTEGER NOT NULL DEFAULT 1,
  first_at INTEGER NOT NULL,            -- epoch ms
  last_at  INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,  -- 10 件超えの通知を送ったら 1 (一度きり)
  PRIMARY KEY (day, fp)
);
