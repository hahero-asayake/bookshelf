# #392 step1: ハブ起動時の取得本数・所要時間（変更前の基準値）

## 環境

- Worker: `wrangler dev -c cf-worker/wrangler.hub.toml --local --port 8787`（R2/KV ともにローカルシム。実行は `/tmp/wrangler-dev-392.log`、プロセスはこの先の step2〜3 でも再利用する想定でバックグラウンドのまま残している）
- 静的ファイル: `http://localhost:8000`（既存の共有サーバー、他イシューとの同居を確認済み）
- 認証: KV に `key:<HK>` → `{uid,siteId,createdAt}` / `uid:<uid>` → `{...}` をローカル Explorer API (`/cdn-cgi/explorer/api/storage/kv/namespaces/<ns>/values/<key>`) 経由でシード。HK は `/tmp/392-hk.txt`（セッション限りのテスト専用キー、本番の値ではない）。
- データ: worker の実 API (`PUT /data/<path>`) 経由で R2 (`data/<uid>/private/...`) に 12 本相当のダミーファイルを投入。
  - 固定7本: `library.json` `exclusions.json` `notes.json` `bookshelves.json` `bookshelves/all.json` `settings.json` `main.json`
  - 本棚5本: `bookshelves/shelf1.json`〜`shelf5.json`（`bookshelves.json` で `isSpecial:false` として登録）
  - 件数は `js/storage.js:278-304` の `loadAll()` が読む本数（固定7本＋`bookshelvesMeta.bookshelves` の非 special 本棚数）に合わせた。依頼文の「12本」は本棚数依存の近似値であることを実測で確認。

## 計測方法

`scripts/verify/392-hub-load-measure.mjs`（新規）。

- Playwright(chromium) で `bookshelf_sync` に `{method:'hub', hub:{apiBase, key}}` を `addInitScript` で仕込み、`index.html` を開く。
- `/data/private/` を含むリクエストだけをネットワークレベル(`Request.timing()`)で記録。`plugins/*`（標準プラグイン読込）や起動後に別途走る処理は対象外。
- `timing.startTime`（UNIX epoch 絶対 ms）+ `timing.requestStart`/`responseEnd`（startTime 相対 ms）を絶対時刻に直してから最初のリクエスト基準の相対 ms に変換。これで「直列か並列か」を機械的に判定できる（前の `endMs` 以降に次の `startMs` が来るか）。
- `window.bookshelf.books.length > 0 && !window.bookshelf._syncChecking` を待ってから300ms待機し、取り残しのリクエストを拾う。
- 5ラウンド、毎回新しい `BrowserContext`（キャッシュ・localStorage 等を毎回リセット）でページを開く＝「起動」を5回測る形。本アダプタ (`HubStorageAdapter`) はメモリ内 ETag キャッシュしか持たずページ間で引き継がないため、各ラウンドは「初回起動」と同じ条件になる（#392前はキャッシュ機構が無いので、2回目以降の起動でも同じ本数を取り直す＝これ自体が基準値として正しい）。

再現コマンド:
```
HK=$(cat /tmp/392-hk.txt) node scripts/verify/392-hub-load-measure.mjs http://localhost:8000 --apibase=http://localhost:8787 --rounds=5 --out=scripts/verify/392-baseline-raw.json --label="step1-before(local-wrangler-dev)"
```

## 結果（5ラウンド、生データ: `392-baseline-raw.json`）

| round | GET+HEAD本数(private/配下) | 総時間(ms) | 直列か |
|---|---|---|---|
| 1 | 15 | 439 | ほぼ直列（注1） |
| 2 | 15 | 440 | 直列 |
| 3 | 15 | 419 | 直列 |
| 4 | 15 | 419 | 直列 |
| 5 | 15 | 419 | 直列 |

**15本の内訳**（1ラウンド分、`392-baseline-raw.json` round1）:
- `HEAD private/bookshelves/all.json`（`detectFormat()` の形式判定、1本）
- `GET` 12本（`loadAll()` 本体＝ library / exclusions / notes / bookshelves.json / bookshelves/all.json / settings / main / shelf1〜5）
- `GET private/publish/articles.json`・`publish/pages.json`（404。`finishStartup()` 内の公開記事移行チェック `migrateFromLegacyIfNeeded`。**loadAll ではなく別処理＝#392のスコープ外**だが同じ `private/` 配下なので計測に含めた）

全リクエストが前のリクエストの `endMs` 以降に `startMs` を持つ＝直列実行。round1 だけ `HEAD`(endMs=8) → 最初の `GET library.json`(startMs=6) が1ms重なって `serial=false` 判定になったが、コードは `await detectFormat()` → `await loadAll()` と完全に順番待ちしており、実際の並列実行ではなくローカル計測の揺れ（1ms未満の誤差）と判断する。round2以降はこの揺れが出ず全て `serial=true`。

**完了条件への対応**: 「変更前の取得本数・所要時間」の基準値として、loadAll本体=**12本のGET**、起動シーケンス全体（detectFormat含む）=**13本**、全部直列、1回の起動が**約420〜440ms**（ローカルワーカー・ローカルR2）。

## 本番での実測

**今回はローカルのみ**。本番は見送った。理由:
- 本番は kuroko の Google アカウントでの実ログインが必要（OAuth往復）で、このステップの残り時間（締切 05:16 待ち合わせ終了・05:21 強制終了）内に安全に終える余裕がなかった。
- 本番の実データは本棚数がこの基準値の「5本」と揃っておらず、絶対値を比べても#392の効果とデータ量差が混ざってしまう（②申し送り3と同じ理由で、本番の絶対値比較は条件を揃えられる場面＝step6側に送る方が妥当と判断）。
- 本番での比較は申し送り3の指示どおり、step6（変更後の実測・本番動作確認）でまとめて行う。

## 次のステップへの申し送り

- `wrangler dev --local`（port 8787, pid はバックグラウンドタスクで管理）は停止せず起動したままにした。step2（worker listDir に ETag 追加のローカル試験）で同じ環境を再利用できる。
- シードした HK（`/tmp/392-hk.txt`）と uid（`/tmp/392-uid.txt`）、R2 内の12本のダミーデータはそのまま残してある。step2 のローカル試験でも使える。
- 本番の version id 確認・rollback 手順は未着手（step3 の担当）。
