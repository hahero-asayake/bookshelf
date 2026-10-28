# #392 step3: worker 本番 deploy 記録

## deploy 前の確認(#341の型・deploy無しHEAD突合)

- 本番 `GET /accounts/{account}/workers/scripts/asayake-hub/content/v2` でダウンロードしたコード(multipart抽出・114971 bytes)と、`git worktree add --detach 25d55de`(= #392 step1直後・step2のworkerコード変更前)で `wrangler deploy --dry-run --outdir` した結果(114971 bytes)の sha256 が **完全一致**(`786be670c742d5a3fe27c49c2ee6fcfb9fe340264460ed279bf2eafa82777bcf`)。
- → 本番には #392 以外の未deploy差分は混ざっていなかった。deploy して良いと判断した。
- (補足: deploy対象の作業ツリーが共有のため、途中で `ebc7c23`(#391 step4のテストハーネス追加)がHEADの後ろに積まれたが、`git diff f75f4e6 ebc7c23 -- cf-worker/` は空=cf-worker/に影響なし。deploy時のHEADは `ebc7c23` のまま進めて問題ない。)

## version id

| | version id | 作成時刻(UTC) |
|---|---|---|
| deploy前(rollback先) | `05c13b61-600f-46cf-8b63-b157e58f8d09` | 2026-10-26T04:11:13.291Z |
| deploy後(今回) | `8c2c255f-d9aa-4c10-8935-837672c16ec9` | 2026-10-28T20:09Z頃 |

rollback コマンド(異常時):
```
# /home/kuroko/kuroko/discord/core/tmp/wr210-lib.mjs の wr() 経由(トークンはファイルから読む・出力は画面に生出力しない)
wr(['rollback', '05c13b61-600f-46cf-8b63-b157e58f8d09', '-c', 'cf-worker/wrangler.hub.toml', '-m', '<理由>'])
```

## deploy後の動作確認

1. **本番 `?list=1` に entries/truncated が付くこと**: `GET https://hub.asayake.org/data/private?list=1`(kurokotestの実キー、Playwright経由でブラウザのlocalStorageから読んだBearer)→ 200 `{"files":[],"dirs":[],"entries":[],"truncated":false}`。旧コードには無かった `entries`/`truncated` フィールドが付いている。
2. **変更前クライアント(js/hub-adapter.js・js/storage.js、#392のクライアント側はまだ未着手)で起動・保存が1回ずつ成功すること**: 本番ページ(`https://asayake.org/bookshelf/`)上で `window.HubStorageAdapter`/`window.BookshelfStorage`(現行コードそのまま)を使い、
   - 起動1: `storage.detectFormat()` → `'empty'`(kurokotestのhubはこれまで空だった)
   - 保存1: `storage.initEmpty()` → 成功(private/配下に初期データ7本を書き込み)
   - 起動2: `storage.loadAll()` → 成功(`library/exclusions/notes/bookshelvesMeta/allBookshelf/bookshelfFiles/privateSettings/privateMain` の7キー、本0冊・本棚0件で正常)
   - コンソールの404エラー11件は `detectFormat()`/`migrateFromLegacy()` 等が「ファイルが無い」ことを確認する過程の想定内のもの(空アカウントなので発生して当然)。異常ではない。
3. 異常なし → rollback はしていない。

## 副作用・後始末

- kurokotest(hahero所有のテスト専用hubアカウント、#334等で既出)の hub private データが「完全に空」から「初期化済み(本0冊・本棚 all のみ)」に変わった。これはアプリの通常の初回起動と同じ状態であり、他イシューの検証を妨げる内容ではないと判断しそのままにした。元に戻す必要があれば `DELETE /data/private/*` で対応可能。
- 作業中に誤って `cf-worker/` dry-run の `--outdir` を相対パスで指定し、bookshelf リポジトリ内に `core/` ディレクトリを作ってしまった → `_trash/core-mistaken-392-<timestamp>/` へ退避済み(git未追跡のため実害なし)。
- `bookshelf-wrangler-392`(systemd --user unit、ローカル wrangler dev)は停止していない。step5 で再利用する想定(②指示どおり、最後のステップで停止し報告する)。
