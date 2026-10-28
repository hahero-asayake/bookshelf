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

## 本番動作確認(未完了・②へ報告)

**クライアント側の変更(commit `b42f9e7`・`9ed0978`)が push できておらず、本番に反映されていないため、本番でのハブ経由起動の動作確認(「変更なしで本文GETが出ないこと」等)は実施できなかった。**

経緯:
- step5の時点で、push-gate が「Issue trailer 混在」で push を拒否した。自分の2commitより前に、同じ共有作業ツリーに別イシュー#396 のcommit(`77a3302`・テストのみの修正)が積まれているため。
- 規約により commit を抜かず②の判断(`BOOKSHELF_PUSH_ALLOW=396` での同梱許可、または別の対処)を待つ状態で step5 を終えた。
- step6 開始時点(本ステップ)で再確認したが、`origin/main` はまだ `dcd17a0`(自分のcommitより前)のままで、②からの新しい指示(台帳にも記録なし)も付いていない。再度 push を試したが同じ理由で拒否された。
- worker(cf-worker)側は step3 で本番 deploy 済み・動作確認済み(`entries`/`truncated:false`が本番の `?list=1` に付くことを確認済み)。**worker 側は完了しているが、クライアント側(ブラウザが実際に使うコード)が未反映のため、「本番でのハブ起動が速くなる」という完了条件はまだ満たせていない。**

**②への確認事項**(step5報告から変わらず):
1. #396 との同梱 push を承認するなら `BOOKSHELF_ISSUE=392 BOOKSHELF_PUSH_ALLOW=396 git push origin 9ed0978:main` で進められる。
2. 同梱不可なら `77a3302` の扱い(抜く判断は③では行わない)を指示してください。
3. push 完了後、Pages 反映(`?v=`確認)→ 本番でのハブ起動確認(差分GET・並列取得のネットワークログ)を改めて実施する必要がある。

## 07_残検討事項・project note

- `80_🚀project/81_🚀development/bookshelf/07_残検討事項.md` に「起動時12本直列フェッチ」「hub R+PAR」に該当する行は無かった(grep実測・0件)。更新対象なし。
- 知見は `append_project_note` で追記する(本ステップの成果物として別途記録)。
