# #392 step6: 変更後の実測と本番動作確認・報告

## 完了条件の確認状況

| 完了条件 | 状態 |
|---|---|
| ハブ経由の起動で、変更の無いファイルを取りに行かないこと | ✅ ローカル実機で確認(本文GET 0本) |
| 差分だけを並列で取ること | ✅ ローカル実機で確認(1本だけGET・2本以上は`runLimited`で並列) |
| 前後の実測値がそろっていること | ✅ 本ファイルの表 |
| 本番 deploy 後に動作を確認したこと | ⚠️ worker(cf-worker)は本番deploy済み・動作確認済み(step3)。**クライアント側(hub-adapter.js等)は push が止まっており未反映**。下記「本番確認」参照 |

## 実測条件(全てstep1と同条件)

- `wrangler dev --local`(R2/KVローカルシム、port 8787)に12本相当のダミーデータ(固定7本+本棚5本)。
- Playwright(chromium)でハブ接続起動(`bookshelf_sync=hub`)を測定。ネットワークレベル(`Request.timing()`)で `/data/private` 配下のリクエストを記録し絶対時刻化。
- 3条件×5回:
  - **初回**: 毎ラウンド新規`BrowserContext`(step1と同じスクリプト `392-hub-load-measure.mjs`)
  - **変更なし再起動**: 1回ウォームアップ後、同一ページを `page.reload()`(localStorageのVersionCacheキャッシュを保持)
  - **1本だけ変更**: 各ラウンド前に worker API 経由で `private/library.json` を1本だけ PUT してから `page.reload()`

## 結果

### 取得本数・所要時間(5ラウンドの範囲)

| 条件 | loadAll本体の本文GET数 | listDir呼び出し数 | 総リクエスト数(HEAD+list+GET+publish404) | 総時間(ms) | 直列/並列 |
|---|---|---|---|---|---|
| **step1 (#391前・#392前・直列)** | 12 | 0 (listDir機能なし) | 15 | 419〜440 | 直列 |
| **#391後・#392前 (PARのみ)** | 12 (毎回全件) | 0 (ハブ側R未実装) | 15 | 398〜441 | **並列** |
| **#392後・初回** | 12 | 2 | 16(※注1) | 405〜446 | 並列 |
| **#392後・変更なし再起動** | **0** | 2 | 6(※注1) | 379〜382 | 並列(リクエスト数僅少) |
| **#392後・1本だけ変更** | **1** | 2 | 7(※注1) | 381〜398 | 並列 |

※注1: `listDir`(`?list=1`)は`private`と`private/bookshelves`の2回。計測スクリプトのURLフィルタ(`/data/private/`、末尾スラッシュ必須)が`/data/private?list=1`(スラッシュなし)を拾えず記録上1回に見えるが、journalctl(wrangler devのログ)で実際に2回呼ばれていることを確認済み(下記「listDir呼び出し本数の確認」参照)。上表の「listDir呼び出し数」は実測した正しい値(2)。

### 完了条件の核心(本文GET数)の実測詳細

- **初回**: `library/exclusions/notes/bookshelves.json/all.json/settings/main`の7本 + `shelf1〜5`の5本 = **12本、全て取得**(キャッシュ無し)。
- **変更なし再起動**: loadAll対象の12本は**1本もGETされない**(VersionCacheが全部ヒット)。実測リクエストに現れる本文GET 2本(`private/publish/articles.json`・`private/publish/pages.json`、いずれも404)は loadAll ではなく別処理(`migrateFromLegacyIfNeeded`、記事モデル移行チェック)で、今回のキャッシュ対象外(#392のスコープ外)。
- **1本だけ変更**: `private/library.json` だけPUTで書き換えた後の再起動で、**その1本だけがGETされ、残り11本は1本もGETされない**(`scripts/verify/392-after-same-changed-raw.json` changed round1 の実測で確認)。

### listDir呼び出し本数の確認(②指示2)

journalctl(wrangler dev、1回のloadAll呼び出し分)で実測:
```
GET /data/private 200 OK
GET /data/private/bookshelves 200 OK
GET /data/private/library.json 200 OK
... (以下loadAllの本文取得が続く)
```
`private`・`private/bookshelves`それぞれ**ちょうど1回**(合計2回)。固定7本のrunLimited(同時数4)と本棚N本のrunLimitedの2段構成の間で、`_ensureRemoteEtagMap`のTTL(3秒)によって一覧取得がまとめられ、再フェッチが発生していないことを確認した。

### 時間短縮効果について(重要な注記)

ローカル`wrangler dev`(レイテンシ実質0ms)では、本文GETが12本→0本/1本に減っても**総時間に明確な短縮は見えない**(全条件とも380〜446msの範囲に収まる)。これは、このローカル環境ではネットワーク往復時間がほぼ無視できるほど小さく、リクエスト本数の削減効果が時間に反映されないため。本番相当のRTT(数十〜数百ms)がある環境でこそ、本数削減とPARの効果が時間短縮として現れると考えられる。**本番での時間計測は、下記の理由により今回は実施できていない**。

## 本番動作確認(②承認を得てpush・実施完了)

### push

②が #396(`77a3302`)との同梱を承認(「#396 の step3 で `#392 が push するときに 77a3302 も一緒に送る` と決めている」)。
```
BOOKSHELF_ISSUE=392 BOOKSHELF_PUSH_ALLOW=396 git push origin 8a216df:main
```
push-gate OK(5件中5件がIssue #392/#396のtrailerを持つ)。`origin/main` が `8a216df` になったことを確認。CIの `test` ジョブが `completed/success` になることを確認(待ち約7分)。本番 `index.html` の `?v=` (`storage-adapter.js?v=2026102902`) が反映されたことを確認(即時)。

### 本番実機確認(1回目)で発見した問題: 弱いETag(`W/"..."`)不一致

kurokotest アカウントで本番ハブ接続を起動し直すと、**「変更なしで本文GETが出ない」が成立しなかった**(2〜4回目起動とも4〜5本が毎回GETされ続けた)。原因を直接確認(ブラウザ上で `fetch` と `localStorage` を読んで比較):

- listDirの `entries[].etag` = `"09d5217b2695159a4f22cabc17fe2051"`(強いETag、worker が R2 の `httpEtag` をそのまま返す)
- GETレスポンスの `ETag` ヘッダ(= VersionCacheに保存される値) = `W/"09d5217b2695159a4f22cabc17fe2051"`(弱いETag、本番の Cloudflare 経由で `W/` が付加される)

ハッシュ値自体は同じだが、`VersionCache.read` が文字列完全一致で比較していたため、**毎回「不一致」と判定されてキャッシュミスし続けていた**。ローカル `wrangler dev` は Cloudflare の CDN 層を経由しないため、この差が再現しなかった(step1〜5のローカル実測は全て `W/` 無しの一致だった)。

### 修正・再pushと再確認

`VersionCache.read` で比較前に `W/` 接頭辞を正規化するよう修正(`js/storage-adapter.js`、commit `d05470c`。GitHubAdapterのsha値はこの接頭辞を持たないため無害・既存テスト全緑)。`index.html` の `?v=`(`storage-adapter.js?v=2026102903`)を再バンプし、`BOOKSHELF_ISSUE=392` で通常push(混在イシューなし・push-gate OKで通過)。CIは `build`/`deploy`/`report-build-status` が `success`、`test` は締切の都合で待ち切れず `in_progress` のまま(到達分で判定・下記「未完了事項」参照)。本番 `?v=2026102903` の反映を確認後、本番で再度ハブ起動を2回行い、**本文GETが0本(HEAD+listDir2回のみ)になったことを確認**。修正が効いていることを本番実機で確認できた。

### 1本だけ変更した時の確認について

時間の制約(締切直前)のため、本番での「1本だけ変更」確認は実施できなかった。ローカル(wrangler dev)では実施済み(上記「結果」の表、1本だけGETされることを確認済み)。本番でも同じコードパスのため同様に動くと見込むが、未実施である旨をここに明記する。

### 未完了事項(②への報告)

1. 2回目のpush(`d05470c`、ETag正規化の修正)に対するCIの `test` ジョブ結果を確認し切れていない(待ち7分で `in_progress` のまま時間切れ)。`build`/`deploy`/`report-build-status` は `success`。②側で `test` の最終結果を確認してください。
2. 本番での「1本だけ変更」確認は時間切れのため未実施(上記理由)。
3. `.wrangler/state` のローカルシード・KVキーはそのまま残した(②指示どおり)。`/tmp/392-hk.txt`・`/tmp/392-uid.txt` は `_trash/` へ退避済み。

## 07_残検討事項・project note

- `80_🚀project/81_🚀development/bookshelf/07_残検討事項.md` に「起動時12本直列フェッチ」「hub R+PAR」に該当する行は無かった(grep実測・0件)。更新対象なし。
- 知見は `append_project_note` で追記する(本ステップの成果物として別途記録)。
