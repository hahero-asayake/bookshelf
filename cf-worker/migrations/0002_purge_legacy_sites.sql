-- ADR-099 決裁「自前公開の記事は索引に一切入れない」を既存データに適用する (破壊的・任意)。
-- 旧 POST /community/sites (任意 https URL を登録できた) 由来の行 = public_id='' の行を消す。
-- 実行の条件: 0001 適用済み・`SELECT COUNT(*) FROM sites WHERE public_id=''` が 1 件以上・D1 export 済み。0 件なら実行不要。
-- 戻し方: export した SQL から該当行を INSERT し直す。
DELETE FROM sites WHERE public_id = '';
