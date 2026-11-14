# イシュー#679 結果：sync-conflict-overwrite.spec.js のハブの上書きが main の CI でときどき赤

対象: `[chromium] › tests/e2e/sync-conflict-overwrite.spec.js:76 › Asayake ハブ: 書き込みで衝突した時に「この端末の内容で保存先を上書き」を選ぶと、保存先が端末の内容になり、続けて書いても衝突しない`

## まとめ

- 原因はアプリ側（テストの待ち方ではない）。ハブのアダプタは一覧の控え（ETag の表）を3秒（`ETAG_MAP_TTL_MS`）使い回す。`BookshelfStorage.loadAll()` は読み直しのたびに `adapter.forgetRemoteListing()` を呼ぶが、この口は #645 で GitHub にだけ足され、ハブには無かった。前の一覧から3秒以内に読み直すと（書き込み時の衝突で上書きを選んだ直後など）、衝突より前の一覧のまま古い中身と版を返し、その版で上書きのまとめ書きを送ってまた 412 になった。
- 直し: `HubStorageAdapter.forgetRemoteListing()` を足した（世代 `_remoteListingGen` つき＝一覧を待つ間に捨てられた読みは、その一覧を使わずに本文を取り直す）。js/bookshelf.js は触っていない。
- 数字: 元の spec のハブ版の繰り返しは、直す前 15/30 赤 → 直した後 0/30 赤（載せ直した後も 0/40）。決定的な E2E（端末B の時計を止める）は直す前 3/3 赤 → 直した後 3/3 緑。単体2本は直す前に赤 → 直した後に緑。

## 1. CI の事実（step1・2026-11-14 19:26〜19:32 に run 画面の HTML から採取）

落ち方（赤の3回とも同じ）: `Error: gate-hub.js: private/notes.json に「#645 端末Bが古い版のまま書いた短文メモ」が 20000ms 以内に届かなかった`（tests/e2e/helpers/gate-hub.js:182 ← spec:92:9 `await s.waitNotes(MEMO_B)`）。spec:82-89（ダイアログの3つのボタン・上書きを押してダイアログが消える）は通っている。playwright.config.js に retries の指定は無い（CI は1回きり）。

| run id | head | この1本 | e2e の失敗一覧 |
|---|---|---|---|
| 43579183702 | 36cf113 | 緑 | CI 全体 success |
| 43580225965 | 48e5bda | 緑 | CI 全体 success |
| 43580396824 | 492ed66 | 緑 | CI 全体 success |
| 43580745601 | 6b22a9e | 緑 | 2（#674・#676） |
| 43580805958 | 72d31cb | 緑 | 2 |
| 43580906116 | ab34c16 | 緑 | 2 |
| 43581255563 | 2946a43 | **赤** | 3（+本件） |
| 43581461146 | c34be0a | 緑 | 2 |
| 43581625365 | 2072774 | 緑 | 2 |
| 43582027584 | d18af26 | 緑 | 2 |
| 43582423053 | 47505b2 | **赤** | 3（+本件） |
| 43582903319 | 9713381 | **赤** | 3（+本件） |
| 43583658160 | 585f13a | 緑 | 2 |
| 43583884422 | 02772ca | 緑 | 2 |

- 完了した14回中3回が赤（約21%）。61a91a2・80e2cc8・d0a3552・4fa0d72・def8437 は採取時に e2e が実行中で数えていない（最大待ち時間5分で打ち切った）。
- 0a75394（#669）は原因ではない: 2946a43 は 0a75394 を含まないのに赤、585f13a は含むのに緑。
- job のログ本文は未認証では取れない（`commit/<sha>/checks/<id>/logs` が 404）。GitHub API は IP 共有の上限（60回/時）に当たったので、annotations は run 画面の HTML から読んだ。

## 2. 手元の再現と切り分け（step2・base 4fa0d72）

spec のハブ版に、両端末のハブへの要求（method・path・status・If-Match・まとめ書きの ifMatch・412 の conflicts）と console、待ち切れた時の端末B の状態を出す記録を一時的に足した（commit していない）。先に「存在しない文字列」を待たせて、待ちが20秒効いて赤になり、記録が出ることを確かめた。

| 回 | 条件（CI=1・--project=chromium・ハブ版だけ） | 1分の負荷 | 直す前 |
|---|---|---|---|
| (a) | --workers=1 --repeat-each=10 | 2.64 | **7/10 赤** |
| (b) | --workers=4 --repeat-each=20 | 2.25 | **8/20 赤** |
| (c) | taskset -c 0,1・--workers=2 --repeat-each=10 | 5.08 | 0/10 赤 |

赤の回の要求の並び:

1. 端末B が起動の読込で一覧 `GET /data/private?list=1` を取る（この時のハブは端末Aが書く前）。
2. 端末Aが書き、端末B のまとめ書きが 412 → `HubRemoteChangedError` → 衝突ダイアログ。
3. 上書きを押す。`storage.loadAll()` の読み直しは一覧を取り直さない（3秒以内なので 1. の一覧を使い回す）。古い一覧と端末に残した中身（VersionCache）の版が一致するので、library・notes・all・bookshelves を通信せずに古い中身で返し、`_etagCache` に古い ETag（v1・v4・v3・v2）を入れる（`_tryReadFromEtagCache`）。
4. 上書きのまとめ書きは If-Match が古いまま → 412 → ダイアログがもう一度出る。ハブの notes.json は端末Aのまま、spec:92 の20秒待ちが切れる。

境目（上書きを押す前の端末B の最後の一覧から、押すまでの差）: (b) の20回で、赤8回は 2947〜2985ms で全部「上書きの後に一覧の取り直し無し」、緑12回は 2986〜3140ms で全部「取り直しあり」。2コアの (c) は遅く、差が 3088〜3397ms で毎回3秒を超えて取り直した＝速く回るほど赤。#668 の手元の緑（高負荷で遅い）と CI の約21% はこれで説明がつく。一時の直し（口を足すだけ）を入れた (a) は 0/10 赤だった。

## 3. 直し（step3）

- `HubStorageAdapter.forgetRemoteListing()`（新規）: `_etagMapPromise`・`_etagMapFetchedAt` を捨て、世代 `_remoteListingGen` を進める。`BookshelfStorage.loadAll()` の入口（js/storage.js）が口を持つ adapter だけ呼ぶ＝ハブも読み直しのたびに一覧を取り直す。書き込みの照合の版 `_etagCache` は触らない。
- `HubStorageAdapter._tryReadFromEtagCache()`: 一覧を待つ前の世代を控え、待つ間に捨てられたらミス扱いにして本文を取り直す（捨てる前に始まった一覧で古い中身と版を控えに戻さない）。
- コメントの「3秒の期限で足りる」という前提を直した（js/hub-adapter.js の `ETAG_MAP_TTL_MS` の上・js/storage.js の loadAll の冒頭）。index.html の ?v=（hub-adapter.js・storage.js）を上げた。
- 3秒の一覧の控えを使う所（git grep）: `_etagMapPromise`・`_etagMapFetchedAt` を使うのは `_ensureRemoteEtagMap` だけで、呼ぶのは `_tryReadFromEtagCache`→`_read`（readJSON/readText）の1本だけ。書き込み（`_writeOnce`）・存在確認（`fileExists`）・まとめ書きの照合（`_resolveBatchEntry`）・412 の後の回復（`_recoverBatchConflictAndRetry`・`_recoverFromConflictAndRetry`）は使わない。一覧に載る `private`・`private/bookshelves` の直下を読むのは `loadAll()` と、呼び元の無い `readNotes()` だけ。loadAll の外の読み（private/publish/*・plugins/*・public/*・books/*・旧 library.json）は一覧に無い。なので 412 を受けた時にも控えを捨てる案は足さない（足しても効く経路が無い）。
- 設計書: 03_詳細設計書の HubStorageAdapter の節に「読み込みの控え」の行、08_意思決定記録の ADR-167 に追補（決定4の「ハブは一覧の控えを3秒で切っている」では足りなかった）。

### 決定的な検査

| 検査 | 直す前 | 直した後 |
|---|---|---|
| 単体 `tests/unit/hub-adapter.test.js`「3秒以内の loadAll で最新の中身と版が返り、その版で上書きできる」 | 赤（一覧を取り直さない） | 緑 |
| 単体 同「一覧を待つ間に控えを捨てたら古い中身と版を控えに戻さない」 | 赤（口が無い）。口だけで世代の印が無い版でも赤（`expected '最初' to be 'この端末'`） | 緑 |
| E2E `sync-conflict-overwrite.spec.js`「前の一覧から3秒たたないうちに上書きを選んでも…」（端末Bの `clock.setFixedTime`・--repeat-each=3） | **3/3 赤**（CI と同じ文） | **3/3 緑** |

## 4. 検証（step4・origin/main 27df129 へ載せ直した後）

| 回 | 条件 | 1分の負荷（開始時） | 直す前（step2） | 直した後 |
|---|---|---|---|---|
| (a) | --workers=1 --repeat-each=10 | 8.91 | 7/10 赤 | **0/10 赤**（1.0m） |
| (b) | --workers=4 --repeat-each=20 | 7.67 | 8/20 赤 | **0/20 赤**（33.3s） |
| (c) | taskset -c 0,1・--workers=2 --repeat-each=10 | 5.55 | 0/10 赤 | **0/10 赤**（38.3s） |
| 決定的な E2E | --workers=3 --repeat-each=3 | 6.64 | 3/3 赤 | **0/3 赤**（6.0s） |

- 載せ直す前（step3・base 4fa0d72）も (a) 0/10・(b) 0/20 赤だった。
- 関係する spec（`tests/e2e/helpers/gate-hub.js` を使う spec と `sync-conflict*.spec.js`、40ファイル）: 225 本のうち **223 passed・2 skipped・失敗 0**（3.2m・--workers=4・負荷 5.63）。
- `npm run lint`: 12 本中 0 本失敗。`npm test`: Test Files 80 passed・Tests 1201 passed | 2 todo。`check:version --range=origin/main..HEAD`: OK。
- ?v=: 載せ直しで main の最大が 2026111886 になったので、hub-adapter.js・storage.js を 2026111887 に上げ直した。
- `scripts/verify/e2e-diff-main.mjs`（全件の比較）は流していない。base と work で全件（約970本×2）と vitest を流すので、負荷のある時は run の30分に収まらない見込み（#668 では高負荷で base の 449/1744 本で止まった）。代わりの判定は、上の関係する spec 225 本・繰り返し・lint・vitest で行った。
