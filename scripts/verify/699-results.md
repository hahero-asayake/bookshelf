# #699 公開した記事で本をタップしても Amazon に移らない

## §1 再現と原因（step1・2026-11-22 04:55〜05:05 JST・コードは変えていない）

行番号は origin/main 6942583（worktree の HEAD と同じ）のもの。本番へ出したのは GET/HEAD と、KV の読み取りだけ。Amazon へは要求を出していない（ブラウザ側で止めた）。

### 1-1 原因（1つ）

公開した記事は `bookshelf.asayake.org`（Worker `bookshelf-cdn`）から配信される。本のリンクは `/go/<siteId>/<ASIN>` という先頭が `/` の相対パスで出るので、`bookshelf.asayake.org/go/…` に解決される。Amazon へ渡す中継（`/go`）は `hub.asayake.org`（Worker `asayake-hub`）にしか無く、`bookshelf-cdn` は `/go` を予約語として 404 にする。そのため、表紙でも題名でも、押すと新しいタブに「Not found」（404）が出る。端末やブラウザによらない。

- リンクを出す所：`js/publish-article-generator.js` L425（`goBase` があれば `goBase/asin`）・L971-974（公開先がハブなら `goBase` は `/go/<siteId>`）。
- 404 を返す所：`cf-worker/bookshelf-cdn.js` L94-97（`isReservedTopLevel`）。`cf-worker/reserved-usernames.js` L26-27 の `EXCLUDED_PATHS` に `go` がある。
- 中継の実体：`cf-worker/asayake-hub.js` L88 → `handleGo`（L198-228）。
- いつから：`bookshelf-cdn` の実装は eba853d（2026-09-05）。公開の一覧 API（`hub.asayake.org/community/sites`）の `published_at` は2本とも 2026-09-06。その頃から新しい URL で配信されていて、それ以降ずっと 404 だったと考えられる（当時の応答の記録は無いので推定）。

### 1-2 証拠：公開された実ページ

確認スクリプト `scripts/verify/699-prod-check.mjs`（ヘッドレス・一時プロファイル）。WebKit 26.4（iPhone 13 の UA・390×844・タッチ）と Chromium 148（1280×800・クリック）。記事ごとに最初の表紙と最初の題名を押した。

| ブラウザ | 記事 | 表紙 / 題名のリンク数 | 上に別の要素があるリンク | 押した結果（表紙・題名とも同じ） |
|---|---|---|---|---|
| WebKit 390 | `/hahero/6h8aVAy0YP/` | 1 / 1 | 0 | 新しいタブが開く → `bookshelf.asayake.org/go/31b0fe39-…/B087JKL1JH` → **404**「Not found」 |
| WebKit 390 | `/hahero/OfGFUCJFVY/` | 9 / 9 | 0 | 新しいタブが開く → `bookshelf.asayake.org/go/31b0fe39-…/B0BNTNRDV7` → **404**「Not found」 |
| Chromium PC | `/hahero/6h8aVAy0YP/` | 1 / 1 | 0 | 同上（404） |
| Chromium PC | `/hahero/OfGFUCJFVY/` | 9 / 9 | 0 | 同上（404） |

- リンクの中身は全部 `href="/go/31b0fe39-a3f1-475e-85ab-eee336368355/<ASIN>" target="_blank" rel="nofollow sponsored noopener"`。リンクは出ている。
- 重なり：リンクの各行の中心点で `elementFromPoint` を取ると、全 40 本（2記事×2ブラウザ）で一番上はリンク自身かその子（表紙の `img`）だった。上に重なる要素は無い。（題名が2行に折り返すと、外接矩形の中心は行の外＝親の `p.bk-title` に落ちる。最初はそこを測って9本を「重なりあり」と数えたが、測り方の誤りだったので行ごとの中心に直した。）
- Amazon への要求は0件（404 で止まるので届かない）。
- 版：本番アプリの `publish-article-generator.js?v=2026111796` は origin/main と同じ（計画時に確認）。版が古いせいではない。
- 中継の実体：`curl -sI https://hub.asayake.org/go/31b0fe39-…/B087JKL1JH` → **302**・`Location: https://www.amazon.co.jp/dp/B087JKL1JH?tag=…`（追っていない）。

画像（`/home/kuroko/kuroko/_vault-work/699/`）：`before-webkit-iphone390-6h8aVAy0YP-article.png`（記事）・`before-webkit-iphone390-6h8aVAy0YP-cover-opened.png`（押して開いたタブ＝Not found）ほか、ブラウザ×記事×表紙/題名の分。生の記録は `before-prod-check.json`・`before-prod-check.log`。

### 1-3 プレビュー（記事エディタの「表示幅を切り替えて見る」）

記録用の spec `scripts/verify/699-preview-probe.spec.js`（門のE2Eではない。`tests/e2e/gate/` へ一時的に写して流し、流した後に `_trash/699/` へ退避した）。手元のアプリ（PORT 8199）で、保存先ローカルと、保存先・公開先ハブ（模擬）の2通り。390幅・タッチ。

| 保存先 | ブラウザ | プレビューの中の href | 押した結果 |
|---|---|---|---|
| ローカル | Chromium / WebKit | `https://www.amazon.co.jp/dp/B000000001`（Amazon 直・タグ無し） | 新しいタブは開かない。プレビューはそのまま |
| ハブ | Chromium / WebKit | 同上（`/go` ではない） | 同上 |

- `#pp-preview-frame` は `sandbox="allow-same-origin"`（index.html L1095）で `allow-popups` が無いので、`target="_blank"` のリンクは開かない。
- プレビューのリンクは Amazon 直で、公開ページの `/go/…` とは形が違う。プレビューを見ても今回の不具合には気づけない。
- ②の決定（計画の承認の申し送り (d)）のとおり、このイシューでは直さない。

### 1-4 同じ種類の洗い出し（公開ページに出るリンク × 配信元）

生成器（`js/publish-article-generator.js`）と Worker（`bookshelf-cdn.js`・`top-page.js`・`report-page.js`・`suspended-page.js`）が出すリンクの種類と、解決した行き先の応答（HEAD・追わない）。

| リンクの種類 | 出す所 | 新URL（bookshelf.asayake.org）での行き先 | 旧URL（hub.asayake.org/public/…）での行き先 |
|---|---|---|---|
| 本の表紙・題名 `/go/<siteId>/<asin>` | 生成器 L437-447・L973 | **404**（今回の不具合） | 302 → Amazon |
| 一覧から記事へ `./<publicId>/` | 生成器（トップ） | 200 | 301 → 新URL のトップ（username がある時） |
| 通報 `<配信元>/report?target=…` | 生成器 L987 | 200 | **404**（hub に `/report` の道が無い） |
| 一覧への誘導 `<配信元>/top` | 生成器 L1095 | 200 | **404**（hub に `/top` の道が無い） |
| 画像 `og.png`・canonical | 生成器 | 200 | —（新URLへ 301） |
| アプリ・利用規約・プライバシー（`asayake.org/bookshelf/…` の絶対URL） | 生成器 L796-797 | 200 | 200 |
| 連絡先（mailto）・表紙の画像（m.media-amazon.com） | 生成器 | 配信元に依らない | 配信元に依らない |
| `/top` の中のリンク（`/top?tag=`・記事の絶対URL） | `top-page.js` | 200 | — |

- 相対パスで出るのは `/go/…` と `./<publicId>/` だけ。配信元が変わって壊れたのは `/go/…` だけ。
- 旧URLの側の2つ（通報・一覧への誘導）は、username の無い利用者のページでだけ起きる。本番の KV を読み取りだけで数えた（`scripts/verify/699-kv-oldurl-count.mjs`・件数だけ出力）：`site:` 2件・`uname:` 2件・username のある site 2件・**username の無い site 0件**。今の本番に該当する利用者は居ない。公開の一覧 API に出る2件も新URLだった。
- この2つは、このイシューでは直さない（②の決定）。別イシューの候補として報告に載せる。

### 1-5 `/go` の渡し方ごとの、リダイレクトの回数と Amazon へ届く Referer

手元の3つのオリジンで実測した（`scripts/verify/699-referer-probe.mjs`・外へは出ない）。P＝公開ページの配信元の役、H＝hub の役、A＝Amazon の役。記事は本番と同じ `Referrer-Policy: no-referrer`、`/go` の応答は `handleGo` と同じ `Referrer-Policy: strict-origin-when-cross-origin`。対照として、ページに Referrer-Policy を付けない場合も測った。WebKit（iPhone 390）と Chromium で結果は同じ。

| 渡し方 | リダイレクト | Amazon 役へ届いた Referer（本番と同じ no-referrer のページ） | 対照（ページに指定なし） |
|---|---|---|---|
| 302 で hub へ送る（P→H→A） | 2回 | 届かない | P のオリジンが届く |
| hub の応答を中継して返す（P→A） | 1回 | 届かない | P のオリジンが届く |
| （参考）リンクが hub を直接指す（H→A） | 1回 | 届かない | P のオリジンが届く |

- 渡し方で変わるのはリダイレクトの回数だけ（2回か1回）。Referer は変わらない。
- **Referer は、どの渡し方でも Amazon へ届かない**。ページが `no-referrer` で配信されている（`cf-worker/serve-headers.js` L9）ので、`/go` の応答に `strict-origin-when-cross-origin` を付けても戻らない。`handleGo` の注記（L223-225「origin までは渡す」）のねらいは、hub から配信していた頃も含めて、成り立っていない見込み。これは今回の不具合とは別の、前からの動き。本番での確認は step4（直した後、止めた Amazon への要求の Referer を記録する）で行う。このイシューでは変えない（配信の安全ヘッダとアフィリエイトの決まりに関わる）。別イシューの候補として報告に載せる。

### 1-6 直し方（②の決定＝案1）と、渡し方の見立て

②の決定（計画の承認の申し送り）：案1＝`bookshelf-cdn` に `/go/<siteId>/<asin>` を足し、行き先を決めるのは hub に任せる。J5-7 を新しく足す。Amazon への要求は止めたまま判定する。プレビューと旧URLの通報リンクは直さない。

案の比較（記録として）：

| 案 | 既存の記事が再公開なしで直る | 記事の中身に触る | タグの決まりに触る | 本番へ出す手段 | リダイレクト |
|---|---|---|---|---|---|
| 1 `bookshelf-cdn` が `/go` を hub へ渡す（採用） | 直る | 触らない | 触らない | `bookshelf-cdn` の deploy（戻しは rollback） | 2回 か 1回（渡し方による） |
| 2 生成器が hub の絶対URLで出す | 直らない（再公開まで 404） | 再公開で変わる | 触らない | push（Pages）＋ `?v=` | 1回 |
| 3 Cloudflare の route で `/go/*` を hub へ向ける | 直る | 触らない | 触らない | hub の deploy（route の設定） | 1回 |
| 4 案1＋案2 | 直る | 再公開で変わる | 触らない | 両方 | 1回（再公開後） |

案1の中の渡し方（②の指示：step1 で Referer と回数を見て、step3 の tp に理由を書く）：

| 渡し方 | リダイレクト | Referer | コードと権限 | 壊れ方 |
|---|---|---|---|---|
| (i) 302 で hub の `/go` へ送る | 2回 | 変わらない（届かない） | 数行。`bookshelf-cdn` は外へ要求を出さない。読み取りだけの今の権限のまま | hub が落ちている時は、利用者が hub のエラーを見る |
| (ii) fetch で中継して hub の応答を返す | 1回 | 変わらない（届かない） | `bookshelf-cdn` から hub へ要求を出す（`redirect: 'manual'`）。同じ zone の Worker 同士の fetch が custom domain 宛てで通るかは Cloudflare の文書で未確認 | hub が落ちている・遅い時の扱いを `bookshelf-cdn` 側に書く必要がある |

今の見立ては (i)。Referer に差が無く、(ii) で減るのは往復1回だけで、(i) の方がコードが少なく壊れ方も単純なため。(ii) の「同じ zone の fetch が通るか」を step2 で文書で確かめ、最終の理由は step3 の tp に書く。

### 1-7 このイシューで直さないもの（報告に載せる）

1. プレビューで本を押しても開かない（sandbox に `allow-popups` が無い）。プレビューのリンクは Amazon 直で、公開ページと形が違う。→ 公開エディタの直しの段階へ（②の決定）。
2. 旧URL（username 無し）のページの「通報」と「一覧への誘導」の行き先が 404。今の本番に該当する利用者は0。
3. Amazon へ Referer が届いていない見込み（1-5）。前からの動きで、渡し方に依らない。

### 1-8 テストが見つけられなかった理由（step2 で埋める所）

- 門のE2Eに、公開ページの本のリンクを押す確認が無い（`tests/e2e/gate/jobs.json` は J5-1〜J5-6）。
- 模擬ハブ `tests/e2e/helpers/gate-hub.js` L544-550 は、本番と同じく `bookshelf.asayake.org` の `/<username>/` 以外に 404 を返す。押す確認があれば赤になっていた。
- `tests/unit/publish-article-generator.test.js` L790・L807 は `/go/site1/` を含むことだけを見ている。`tests/unit/bookshelf-cdn.test.js` に `/go` の場合は無い。生成器の href を配信元で解決して Worker に通すテストが無い。

### 1-9 確認に使ったもの

| 種類 | 場所 |
|---|---|
| 本番の実ページの確認 | `scripts/verify/699-prod-check.mjs`（step4 で `after` として流し直す） |
| プレビューの記録 | `scripts/verify/699-preview-probe.spec.js` |
| Referer と回数の実測 | `scripts/verify/699-referer-probe.mjs` |
| 旧URLの利用者の件数 | `scripts/verify/699-kv-oldurl-count.mjs` |
| 画像・ログ・JSON | `/home/kuroko/kuroko/_vault-work/699/`（`before-*.png`・`before-prod-check.{json,log}`・`preview-probe.log`・`referer-probe.log`・`kv-oldurl-count.log`） |

## §2 落ちるテストを先に足して直した（step2・2026-11-22 05:05〜05:20 JST・push していない）

### 2-1 渡し方

302 で hub の `/go` へ送る方にした（②の step2 の指示どおり）。同じ zone の Worker の間で fetch できるかは調べていない（中継はしないと決まったため）。

### 2-2 先に足したテストと、直す前の赤

| テスト | 直す前 | 直した後 |
|---|---|---|
| 門のE2E `tests/e2e/gate/j5-7-article-amazon-link.spec.js`（J5-7・chromium と gate-webkit） | **赤**（2本とも）。「確認: 新しいタブが、置いた本の Amazon の商品ページになる」で `Expected pattern: /^https:\/\/www\.amazon\.co\.jp\/dp\/B000000001(\?|$)/`・`Received string: "https://bookshelf.asayake.org/go/s1/B000000001"` | 緑 |
| 単体 `tests/unit/bookshelf-cdn.test.js` の `/go` の6本 | **4本が赤**（302 のはずが 404・Location が null）。形が違う `/go` の 404 と、他の予約語の 404・POST の 405 の2本は緑 | 6本とも緑 |
| 単体 `tests/unit/publish-go-route.test.js`（生成器 → 配信元の Worker → ハブを順に通す） | 新URLの1本が**赤**（`{ url: "https://bookshelf.asayake.org/go/site1/B000000001", status: 404, hops: 0 }`）。href の形と旧URLの2本は緑 | 3本とも緑（新URLは2回、旧URLは1回たどって `https://www.amazon.co.jp/dp/B000000001?tag=operator-tag-01`） |

赤の出力は `/home/kuroko/kuroko/_vault-work/699/j5-7-red.log`・`unit-red.log`、緑は `j5-7-green.log`・`unit-green.log`。

### 2-3 直した内容

`cf-worker/bookshelf-cdn.js`：予約語の判定より前に `/go` の分岐を足した。`/go/<siteId>/<asin>` の形（siteId が空でない・asin は英数字8〜14桁＝`handleGo` と同じ検査）なら、`HUB_API_ORIGIN`（未設定なら `https://hub.asayake.org`）の同じ道へ 302 で送る。ヘッダは `handleGo` と同じ（`Cache-Control: no-store`・`Referrer-Policy: strict-origin-when-cross-origin`）。形が違えば、今までどおり予約語の 404 に落ちる。KV を読まず、タグもプランも見ない（単体テストで KV を読むと落ちるようにしてある）。

### 2-4 門のE2Eの模擬

- `tests/e2e/helpers/gate-hub.js`：`/go/<siteId>/<asin>` を3か所で答える。①公開ページの配信元（`bookshelf.asayake.org`）は本物のハブのホストの同じ道へ送る ②本物のハブのホスト（`https://hub.asayake.org/go/**`）と ③模擬のハブ（`mockhub.test`・旧URLのページから届く）は、`handleGo` と同じ約束で Amazon の商品ページへ送る（Free と知らない siteId は運営のタグ、Plus は本人のタグ）。本人のタグは `/publish` で受け取って控える（本物の 821-824 行と同じ）。
- **模擬は 302 を返せない**。Playwright の `route.fulfill` は WebKit で「Cannot fulfill with redirect status: 302」で落ちる（実測）。代わりに、同じ行き先へすぐ移るページ（meta refresh）を返す（`redirectForTest`）。新しいタブの最後の URL は本物と同じになる。本物の 302 そのものは、単体テストと step4 の本番の確認で見る。
- `tests/e2e/helpers/gate-amazon.js`：`mockAmazonProductPageForTest`（`/dp/<ASIN>` に「Amazon の商品ページ (模擬)」を返す）を足した。

### 2-5 新しく分かったこと：route はリダイレクトの先の要求に効かない

`scripts/verify/699-route-redirect-probe.mjs`（手元だけ・外へ出ない）で確かめた。WebKit と Chromium で結果は同じ。

| 場面 | route が呼ばれた | 実サーバーへ届いた |
|---|---|---|
| 模擬が meta refresh で送る（門のE2Eの形） | 3つとも（配信元の /go・ハブ・Amazon 役） | 0 |
| 実サーバーが 302 で送る（本番の確認の形）。Amazon 役にだけ route | **呼ばれない** | ハブ役と **Amazon 役に届く** |

- 本番の確認で「ブラウザに 302 をたどらせ、Amazon への要求だけ route で止める」やり方は**効かない**。直した後にそのまま流すと、運営タグ付きの要求が本当に Amazon へ届く。
- そこで `scripts/verify/699-prod-check.mjs` を変えた：新しいタブの最初の要求（`bookshelf.asayake.org/go/…`）を route で受け、その先は Playwright の要求（`maxRedirects: 0`）で1つずつ読む。要求を出すのは公開ページの配信元とハブだけで、Location が Amazon を指したら止める。開いたタブには読んだ結果を出す。直す前の本番で流し直して動くことを確かめた（`before2-prod-check.log`：8回とも `/go の先=[404 …]`・Amazon への要求0件）。
- このやり方では、Amazon へ渡る Referer は本番では測れない（ブラウザが Amazon へ要求を出さないため）。Referer は手元の実測（§1-5）で代える。

### 2-6 観測点を38点にした

`tests/e2e/gate/jobs.json` に J5-7「公開した記事の本から Amazon へ移れる」を足した。`tests/e2e/gate/README.md` の表と数、点数を決め打ちしていた単体テスト2本（`check-e2e-gate.test.js`・`gate-report.test.js`）も38点に合わせた。`npm run lint:e2e-gate` は「OK: @gate 42本・違反0件・観測点の網羅 38/38」。

### 2-7 流した確認（step2 の分。全件は step3）

- 単体：`bookshelf-cdn`・`publish-go-route`・`check-e2e-gate`・`gate-report`・`hub-go`・`publish-article-generator`・`reserved-usernames` の7本で 179 件 0 失敗。
- 門のE2E：J5-7 と、模擬ハブを使う J1-3・J5-4・J5-5・J5-6・J6-3・J7 の8本を chromium と gate-webkit で流し、22 件 0 失敗。
- J5-7 の揺れ：chromium と gate-webkit で3回ずつ（`--repeat-each=3 --workers=1`）流し、6 件 0 失敗（`j5-7-repeat3.log`）。
- 全体（commit 1d317a4 の中身で）：`npm test` は 81 ファイル 1210 件 0 失敗（todo 2）。`npm run lint` は「12 本中 0 本失敗」。E2E の全件と e2e-diff は step3 で流す。

### 2-8 設計書の差分案（obsidian への反映は step4 でまとめて1回）

節の番号は step4 で実物を読んで合わせる（09 は方針転換の検討中のため、ADR と併せて読む）。

| 文書 | 直す所 | 書く内容 |
|---|---|---|
| `09_公開システム設計.md` | Worker 構成の節（§11.7）と `/go` の説明の節（§10.3-v2・ADR-034追補の所） | 公開ページの本のリンクは `/go/<siteId>/<asin>`（相対パス）。新URLのページは `bookshelf-cdn` が配信するので、`bookshelf-cdn` が `/go` を受け、hub の同じ道へ 302 で送る。行き先（プランとタグ）を決めるのは hub の `/go` だけ。`bookshelf-cdn` は KV を読まず、タグを持たない |
| `08_意思決定記録.md` | ADR を1つ追記（番号は step4 で採番） | 決定：`bookshelf-cdn` が `/go` を hub へ 302 で送る。理由：既存の記事が再公開なしで直る・タグの判断を1か所に保つ・最小権限を変えない。採らなかった案：生成器が絶対URLで出す（既存の記事が直らない）・Cloudflare の route・fetch での中継（Referer に差が無く、往復が1回減るだけ）。教訓：配信元を移す時は、ページの中の相対リンクの行き先を全部洗う。生成器・配信元・中継を順に通すテストを置く |
| `60_🐙claude/63_🐙project/bookshelf/公開前最終テスト設計.md` §2 | J5 の観測点 | J5-7「公開した記事の本から Amazon へ移れる」を足し、37点を38点にする |
| `cf-worker/HUB-SETUP.md` L97（repo の中・step5） | 確認項目6 | 今の作りに合わせる：公開ページの Amazon リンクは `/go/<siteId>/<asin>`。`curl -sI https://bookshelf.asayake.org/go/<siteId>/<asin>` が 302 で hub の同じ道を指し、hub が 302 で Amazon を指す |
