# イシュー#598 E2E のハブの模擬を1本に寄せる（結果）

- A = `tests/e2e/helpers/storage-fakes.js` の `installFakeHub`（#587）
- B = `tests/e2e/helpers/gate-hub.js`（#589 が作り、#588・#589 で道を足した）

## step1 着手条件・呼び出し元・機能の差・移行前の合否（2026-11-14・origin/main 54363ab）

### 着手条件

waitForIssues の4本は、どれも DB で done になっていて、origin/main に `Issue:` trailer 付きの commit がある。

| イシュー | DB | origin/main の commit |
|---|---|---|
| #587 | done | a1e88b9 |
| #588 | done | b83d82f・3e81e09・5d9d895 |
| #589 | done | 66d9ac4・7ae2ee3・6c4740f・db7a720・2aff5a2・ae1a6fd |
| #594 | done | eb9774a 〜 06f7afd（16本） |

### 呼び出し元（`git grep`・origin/main 54363ab）

| spec・ヘルパー | 使う模擬 | ハブを使うテスト（chromium） | 使う機能 |
|---|---|---|---|
| `shelf-file-delete.spec.js`（#587・#603 で変更） | A | 6 | has・readJSON・list・writes・deleteRequests・failNextWrites(1)・failuresLeft |
| `book-memo-file-lifecycle.spec.js`（#594） | A | 8（fixme の1本を含む） | has・readJSON・list・deleteRequests・failNextWrites(1)・failuresLeft |
| `save-failure-visible.spec.js`（#603） | A | 4 | has・readJSON・failNextWrites(1 / 4)・failuresLeft（`await` を付けて呼ぶ） |
| `gate/j5-4`・`j5-5`・`j5-6`・`j6-3` | B | 5 | createHubStateForTest・seedHubDataForTest・seedHubLoginForTest(method:'hub', library:false)・mockHubForTest・waitForHubStartupForTest |
| `gate/j6-2` | B（`waitForHubStartupForTest` だけ。保存先は GitHub） | 0 | — |
| `gate/j7-billing`・`j7-account-delete` | B | 4 | resetHubStateForTest・plusStateForTest・mockBillingPagesForTest・mockHubSessionForTest・mockGoogleSignInForTest |
| `billing-portal-return.spec.js`（#604） | B（`/usage` だけ自前の page.route で上書き） | 4 | createHubStateForTest・resetHubStateForTest・plusStateForTest・seedHubLoginForTest・mockHubForTest・mockBillingPagesForTest・HUB_BASE・BILLING_BASE |
| `helpers/gate-device.js`（j6-2・j6-3 が使う） | B | — | seedHubLoginForTest・mockHubForTest（2つ目のコンテキスト） |

- A のハブを使うテストは3 spec で計18本（chromium だけ・1本は fixme）。3 spec とも、保存先3つ（ハブ・GitHub・ローカル）を同じ読み口（has・readJSON・list…）で回している。GitHub とローカルの分は `installFakeGitHub`・`installFakeLocalFolder`（同じファイル）を使う。
- `tests/unit/fixtures/e2e-gate/` の `mockHubForTest` は lint:e2e-gate のテスト用の見本（別物）で、対象外。
- `scripts/verify/587-results.md`・`594-results.md`・`603-*.md` は過去の記録なので書き換えない。

### 機能の差（main 54363ab の gate-hub.js で取り直した）

A にだけあり、B に無いもの（計画時点と同じ5つ。#588・#589 が入った後も残っている）:

| | A（installFakeHub） | B（gate-hub.js） | 本物（cf-worker/asayake-hub.js）・アプリ |
|---|---|---|---|
| (a) 一覧 `GET /data/<dir>?list=1` | `{files, dirs, entries:[{name,etag,size}], truncated:false}` | `{files, dirs}` だけ | 本物は listDir（578-592行）で entries・truncated を返す。アプリは js/hub-adapter.js `_fetchRemoteEtagMap`（113-120行）で entries を ETag 表にする。entries が無いと、一覧の ETag 表を使わず1件ずつ読む経路に回る |
| (b) If-Match の比べ方（単発 PUT・まとめ書き） | `W/` と引用符を外してから比べる | 文字列のまま比べる | 本物は normalizeEtag（553行）を putObject（561行）と handleBatch（683・697行）で使う |
| (c) 書き込みの失敗 | `failNextWrites(n)` で次の n 回（PUT・DELETE・まとめ書き）を 500 にする。残りの回数は `failuresLeft()` | `failHubWritesForTest(state)` で、以後の書き込み（PUT・DELETE・まとめ書き・公開）をずっと 500 にする | — |
| (d) 書き込みの記録 | `writes[{op,path,via}]`（実際に変わったもの）・`deleteRequests[{path,via,existed}]`（届いた削除要求。まとめ書きの中身も1件ずつ） | `requests[{method,path}]`（まとめ書きの中身は残らない） | — |
| (e) 読み口 | `has(path)`・`readJSON(path)`・`list(dir)`（GitHub・ローカルの模擬と同じ名前） | 無い（`state.files` の Map を直接読む。`waitForHubFileContainsForTest` はある） | — |

どちらにもあるが中身が違うもの:

| | A | B | 寄せた後 |
|---|---|---|---|
| 置き場 | `https://fakehub.test`（引数で変えられる） | `https://mockhub.test`（固定） | B に揃える（A の呼び出し元が置き場を変えている所は無い） |
| OPTIONS・CORS のヘッダ | OPTIONS に 204、全部の応答に CORS のヘッダ | 付けない（不要と #589 が実測。ETag の Expose だけ付ける） | B のまま |
| `GET /usage` | `{plan:'free', usedBytes:0, quotaBytes:100MB}` 固定 | state から（usedBytes の既定は 10MB・課金の項目つき） | 移す spec は `createHubStateForTest({ usedBytes: 0 })` で今と同じ値にする |
| 模擬に無い道 | 404 | 501（足りない道を見つけるため） | B のまま。移した後に `requests` に 501 が出ないことを確かめる |
| route の掛け先 | page | context（別のタブ・別の端末でも同じ模擬が答える） | B のまま |
| 単発 PUT の 412 の本文 | `{"error":"etag mismatch"}` | `conflict`（文字列） | 本物（httpError(412, 'etag mismatch')）に合わせて JSON にするかは step2 で本物の形を確かめて決める |
| ログイン済みの接続の投入 | 無い（呼び出し元が `bookshelf_sync = {method:'hub', hub:{apiBase,key,uid,email}}` を addInitScript で毎回入れる） | `seedHubLoginForTest`（plan・使用量・公開名義 username 'hahero'・`publish:{target:'hub'}` まで入れる。入れるのはそのタブで最初の1回だけ） | step3 で `seedHubLoginForTest(page, hub, { method: 'hub', library: false })` に替える。起動の進み方が変わったら、spec 側の今の投入を残して apiBase を HUB_BASE に向けるだけにする |

B にだけあるもの: ハブの蔵書の投入（seedHubDataForTest）・状態の作り直し（resetHubStateForTest）・Plus の状態・決済の模擬のページ・ログイン（POST /session）と Google のログインボタン・退会（DELETE /account と、その後の 401）・公開（POST /publish）と公開ページの配信（旧URL・新URL）・起動待ち（waitForHubStartupForTest）・届くのを待つ（waitForHubFileContainsForTest）・webkit で SW が制御するページの通信は route に来ない、という制約の記載。

### 移行前の合否（main 54363ab のまま・変更なし）

```
GATE_WEBKIT=1 PORT=8198 PLAYWRIGHT_BASE_URL=http://localhost:8198 npx playwright test \
  tests/e2e/shelf-file-delete.spec.js tests/e2e/book-memo-file-lifecycle.spec.js tests/e2e/save-failure-visible.spec.js \
  tests/e2e/billing-portal-return.spec.js tests/e2e/gate/j5-4-publish-read-url.spec.js tests/e2e/gate/j5-5-publish-update.spec.js \
  tests/e2e/gate/j5-6-unpublish-delete.spec.js tests/e2e/gate/j6-2-github-other-device.spec.js tests/e2e/gate/j6-3-hub-other-device.spec.js \
  tests/e2e/gate/j7-account-delete.spec.js tests/e2e/gate/j7-billing.spec.js --project=chromium --project=gate-webkit
```

結果: 79本のうち 75 passed・4 skipped（どれも既存の `test.fixme`）・失敗0・flaky 0（1.6分）。

| spec | project | 合計 | 通った | 落ちた | flaky | skip |
|---|---|---|---|---|---|---|
| billing-portal-return.spec.js | chromium | 4 | 4 | 0 | 0 | 0 |
| billing-portal-return.spec.js | gate-webkit | 4 | 4 | 0 | 0 | 0 |
| book-memo-file-lifecycle.spec.js | chromium | 24 | 20 | 0 | 0 | 4 |
| gate/j5-4-publish-read-url.spec.js | chromium / gate-webkit | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| gate/j5-5-publish-update.spec.js | chromium / gate-webkit | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| gate/j5-6-unpublish-delete.spec.js | chromium / gate-webkit | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 0 / 0 |
| gate/j6-2-github-other-device.spec.js | chromium / gate-webkit | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| gate/j6-3-hub-other-device.spec.js | chromium / gate-webkit | 1 / 1 | 1 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| gate/j7-account-delete.spec.js | chromium / gate-webkit | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 0 / 0 |
| gate/j7-billing.spec.js | chromium / gate-webkit | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 0 / 0 |
| save-failure-visible.spec.js | chromium | 11 | 11 | 0 | 0 | 0 |
| shelf-file-delete.spec.js | chromium | 16 | 16 | 0 | 0 | 0 |

- skip の4本: book-memo-file-lifecycle の「変更してすぐ再読込」（ハブ・GitHub・ローカル）と「フォルダ未接続の間の変更」（ローカル）。どれも #594 が `test.fixme` にしたもの。
- A を使う3 spec は、main でも WebKit では流していない（gate-webkit の testMatch は `tests/e2e/gate/`・art-canvas-tap-edit・billing-portal-return だけ）。WebKit で「新しく落ちたテストが0件」かは、B を使う gate spec と billing-portal-return で見る。
- CI の matrix は `suite: [e2e, char, audit, webkit]` になっている（#589 が webkit を足した）。check-run は「test (e2e)」「test (char)」「test (audit)」「test (webkit)」の4本。

### 寄せ方（推奨・②の判断を待つ）

寄せ先は B（gate-hub.js）にする。今の B の呼び出し方は変えず、A にだけある (a)〜(e) を足す。

1. (a) 一覧に `entries:[{name,etag,size}]` と `truncated:false` を足す（本物と同じ形）。
2. (b) 単発 PUT とまとめ書きの If-Match を、本物の normalizeEtag と同じく `W/` と引用符を外してから比べる。
3. (c) 書き込みの失敗に回数を指定できるようにする。案: state に `failNextWrites: 0`（残りの回数）を足し、「`failWrites` が true、または残りの回数が1以上なら 500 にして1減らす」で判定する。`failHubWritesForTest(state)` は引数が無ければ今までどおり失敗させ続け、`failHubWritesForTest(state, n)` の時だけ次の n 回にする。数える対象は B の今の「書き込み」（PUT・DELETE・まとめ書き・公開）に揃える（A の呼び出し元は公開を使っていないので、合否には影響しない見込み）。
4. (d) state に `writes: []`・`deleteRequests: []` を足し、単発の PUT・DELETE とまとめ書きの1件ずつを記録する（A と同じ形）。`resetHubStateForTest` でも空に戻る。
5. (e) 読み口 `hubStoreForTest(state)` を足す。返り値は `{ has, readJSON, list, writes, deleteRequests, failNextWrites, failuresLeft }` で、GitHub・ローカルの模擬と同じ名前にする。中身は state を読むだけ（route は掛けない）。
6. 移す3 spec の `bootWithHub` は、`createHubStateForTest({ usedBytes: 0 })` → `seedHubLoginForTest(page, hub, { method: 'hub', library: false })` → `mockHubForTest(page, hub)` → `hubStoreForTest(hub)` の順にする。
7. storage-fakes.js からは `installFakeHub`・`FAKE_HUB_BASE`・ハブ専用の `normEtag` だけを外す。`CORS` は GitHub の模擬も使うので残す。ファイルは GitHub・ローカルの模擬が残るので退避しない（②承認済み）。

(a) で、B を使う gate spec でもアプリが一覧の ETag 表の経路を通るようになる。step2 で gate spec を chromium と gate-webkit で流し直し、合否が変わったら隠さずに報告する（期待値は緩めない）。

### 計画時点との違い

- A の呼び出し元が1本から3本に増えた。#594 の `book-memo-file-lifecycle.spec.js` に加え、#603 が `save-failure-visible.spec.js` を足し、`shelf-file-delete.spec.js` も変えた（260b22f）。#603 は waitForIssues に入っていなかった。DB では running のまま（2026-11-14 06:10）。
- B の呼び出し元に、gate 以外の `billing-portal-return.spec.js`（#604・done）が加わった。gate-webkit の testMatch にも入っている（playwright.config.js 21行）。
- #603 で GitHub の模擬の `failNextWrites(n, { status })` に状態コードの指定が付いた。ハブには無い（A のハブも 500 だけ）。今回は足さない（使う所が無い）。

### 並行して触っているイシュー（2026-11-14 06:10 の worktree で確かめた）

- #602（tp_review）: worktree で storage-fakes.js の末尾に `installReloadPermissionPrompt`（ローカル）を足している（+37行・commit 前）。A のハブの部分とは離れているので、rebase では自動で合わさる見込み。
- #603（running）: worktree に今は重なる変更が無い。ただし running なので、A の呼び出し元（save-failure-visible・shelf-file-delete）や storage-fakes.js を、また変える可能性がある。

## step2 寄せ先 gate-hub.js に足りない機能を足す（2026-11-14・土台 origin/main a245035）

- 始める前に origin/main（54363ab → a245035・6 commit。#590 の J1〜J4 の投入と a245035 の billing-portal-return の修正）へ rebase した。gate-hub.js は main で変わっていない。B の呼び出し元も step1 と同じ（gate spec 7本・gate-device.js・billing-portal-return）。
- 足したもの（commit da25bcd・今の呼び出し方は変えていない）:
  - (a) 一覧 `?list=1` が `entries:[{name, etag, size}]` と `truncated:false` を返す。size はバイト数（本物の R2 の size に合わせた。A は文字数だった）。本物が返す `uploaded` は、アプリが読まないので入れていない。
  - (b) 単発の PUT とまとめ書きの If-Match を、`normEtag`（本物の normalizeEtag と同じ）で比べる。あわせて、単発 PUT の 412 の本文を本物と同じ `{error:'etag mismatch'}` にし、まとめ書きの conflicts の etag を本物と同じ引用符なしにした（どちらも A と同じ形）。
  - (c) state に `failNextWrites`（残りの回数）を足した。`failHubWritesForTest(state)` は今までどおり失敗させ続ける。`failHubWritesForTest(state, n)` の時だけ次の n 回を 500 にする。両方が立っている時は、失敗させ続ける方が優先する（残りの回数は減らない）。数える対象は、今の B の「書き込み」（単発の PUT・DELETE、まとめ書き、公開）。
  - (d) state に `writes`（中身が変わった書き込み `{op, path, via}`）と `deleteRequests`（届いた削除の要求 `{path, via, existed}`）を足した。まとめ書きの中身も1件ずつ残す。`resetHubStateForTest` でも空に戻る。
  - (e) `hubStoreForTest(state)` を足した。返すのは `{ has, readJSON, list, writes, deleteRequests, failNextWrites, failuresLeft }`。writes と deleteRequests は getter で、`resetHubStateForTest` で作り直した後の配列も追う。
  - 冒頭のコメントに、経緯の行（#598 で足したもの）と hubStoreForTest の使い方を足し、mockHubForTest の「今ある道」に entries・If-Match の比べ方・失敗と記録を書いた。

### 確認

| 何を | 結果 |
|---|---|
| `npm run lint:e2e-gate` | OK（@gate 30本・違反0）。観測点の未達8点の警告は、spec と jobs.json を変えていないので main と同じ |
| `npm test`（vitest） | 72ファイル・1063 passed・2 todo |
| B を使う8 spec（gate 7本と billing-portal-return）を chromium と gate-webkit で（1回目） | 28本中 27 passed・1 failed |
| 落ちた1本だけを gate-webkit で `--repeat-each=3` | 12本（4本×3回）すべて passed |
| B を使う8 spec をもう1回 chromium と gate-webkit で | 28本すべて passed |

- 1回目に落ちたのは billing-portal-return の WebKit の「Webhook が遅れても、支払い管理から戻った後に取り直して解約予約済みと表示される (保存先 local)」。支払い管理のページから index.html へ戻った後、「フィクスチャの本 1」が5秒以内に見えなかった。
  - この1本は保存先がローカルで、ハブの /data（一覧・PUT・まとめ書き）を通らない。今回変えた道を通らず、失敗の判定も既定（0回・false）のままなので、変更とは関係のない揺れと判断した。単独で3回流すとすべて通り、全部を流し直しても通った。
  - billing-portal-return.spec.js は、step1 の後に main で a245035 が変えている（ハブの起動待ちの書き方）。step1 の表の数字は変わる前の版のもの。
- (a) で、ハブから読む gate spec（j5-4・j5-5・j5-6・j6-3）のアプリは、hub-adapter の readJSON → `_tryReadFromEtagCache` → `_ensureRemoteEtagMap` で一覧の entries を ETag 表に使うようになる。通信の回数は測っていないが、合否は step1 と同じ（chromium と gate-webkit で全部通る）。

## step3 呼び出し元を gate-hub.js へ移し、storage-fakes.js から installFakeHub を外す（2026-11-14・土台 origin/main 15b0f9e）

- 始める前に fetch した。origin/main は 15b0f9e で、06:18 に rebase した時から動いていない（`git ls-remote` でも同じ）。3 spec は #603 の最終版（#603 は done）。#602 が storage-fakes.js の末尾に足す `installReloadPermissionPrompt` は、origin/main にまだ入っていない（rebase の衝突は起きていない）。
- 移したもの（commit 4e54188）:
  - 3 spec（shelf-file-delete・book-memo-file-lifecycle・save-failure-visible）の `bootWithHub` を、`createHubStateForTest({ usedBytes: 0, email })` → `seedHubLoginForTest(page, state, { method: 'hub', library: false })` → `mockHubForTest(page, state)` → `hubStoreForTest(state)` の順に替えた。email は spec ごとの今までの値を渡している。読み口の名前は同じなので、`bootWithHub` より下は変えていない。
  - 接続の投入は `seedHubLoginForTest` に替えられた。入る値は増える（plan・使用量・公開名義 `hahero`・`publish:{target:'hub'}` など）が、起動の進み方（空のハブ →「新規データで初期化しますか？」→ OK → `private/bookshelves/all.json` が書かれる）は変わらなかった。spec 側の投入を残す必要は無かった。
  - storage-fakes.js は 482行 → 328行。外したのは `FAKE_HUB_BASE`・`normEtag`・`installFakeHub`。残したのは `CORS`（GitHub の模擬が使う）・`FAKE_GITHUB`・`installFakeGitHub`・`installFakeLocalFolder`・`installLocalWriteFailures`。冒頭のコメントと「読み口は installFakeHub と同じ」の2か所を直した。
  - gate-hub.js は冒頭のコメントだけ（外した関数の名前を書いていた行）。tests/e2e/gate/README.md の表は、`failHubWritesForTest` の行に回数の指定を足し、`hubStoreForTest` の行を足した。
- 今までと違う点（合否には出ていない）:
  - 接続を入れるのは、そのタブで最初の1回だけになった（今までは読み込みのたびに入れ直していた）。ハブで再読込するのは book-memo の「変更してすぐ再読込」だけで、これは fixme で流れていない。fixme を外す時は、再読込の後にアプリ自身が保存した接続情報が残る（本物に近い）。
  - 書き込みを失敗させた時の本文が `{error:'injected write failure'}` から `{error:'gate-hub.js の模擬: 書き込みの失敗'}` に変わった（どちらも 500）。
  - `GET /usage` は課金の項目（billingManaged・planSource など）も返す。plan・usedBytes・quotaBytes は今までと同じ値。

### 確認

| 何を | 結果 |
|---|---|
| (i) `git grep -nE 'installFakeHub\|FAKE_HUB_BASE\|fakehub\.test'` | scripts/verify 以外は0件。残るのは scripts/verify/587-results.md（#587 の記録・2行）と、この記録だけ |
| (ii) 3 spec を chromium で（PORT=8198） | 51本中 47 passed・4 skipped（どれも既存の `test.fixme`）・失敗0・flaky 0（1.7分）。step1 の結果と1本ずつ突き合わせて、51本すべて同じ |
| (iii) 模擬に無い道（501） | 0件（3 spec・51本の実行の間） |
| `npm run lint:e2e-gate`・`lint:internal-refs`・`lint:e2e-goto`・`lint:e2e-wait` | どれも OK（@gate 32本・違反0。内部参照は上限82以内） |
| `npm test`（vitest） | 73ファイル・1076 passed・2 todo |

- (iii) の確かめ方: `state.requests` は状態コードを持たないので、501 を返す行の直前に「環境変数 `GATE_HUB_501_LOG` があれば、その道をファイルに1行書く」という1行を一時的に足して3 spec を流した（ファイルは作られなかった = 0件）。この1行が本当に拾うことは、模擬に無い道（`GET /no-such-route-598`）を1回呼ぶ対照の spec で確かめた（501 が返り、ファイルに1行出た）。足した1行と対照の spec は commit していない（gate-hub.js の差分はコメントだけ）。
- (ii) の突き合わせの相手は step1（main 54363ab）の結果。3 spec は 54363ab から 15b0f9e の間に変わっていない。同じ土台での比較（origin/main と作業ツリー）は step4 の e2e-diff-main で行う。

ハブを使う18本（fixme の1本を含む）の突き合わせ:

| spec | テスト | step1 | step3 |
|---|---|---|---|
| book-memo-file-lifecycle | 長文メモ: 保存先に書けない間の変更 Asayake ハブ (イシュー#594) › 書けない間に題名を変えても、記録が残り、次の保存で新しい名前へ移って古いファイルが消える | 通った | 通った |
| book-memo-file-lifecycle | 長文メモ: 変更してすぐ再読込 Asayake ハブ (イシュー#594) › 題名を変えてすぐ再読込しても、新しい名前で読め、次の保存で古いファイルが消える | skip（fixme） | skip（fixme） |
| book-memo-file-lifecycle | 長文メモのファイルが取り残されない: Asayake ハブ (イシュー#594) › ASIN を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 通った | 通った |
| book-memo-file-lifecycle | 長文メモのファイルが取り残されない: Asayake ハブ (イシュー#594) › 本を削除すると、保存先からその本の長文メモのファイルが消える | 通った | 通った |
| book-memo-file-lifecycle | 長文メモのファイルが取り残されない: Asayake ハブ (イシュー#594) › 題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 通った | 通った |
| book-memo-file-lifecycle | 長文メモのファイルが取り残されない: Asayake ハブ・使えない文字と空白を含む題名 (イシュー#594) › ASIN を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 通った | 通った |
| book-memo-file-lifecycle | 長文メモのファイルが取り残されない: Asayake ハブ・使えない文字と空白を含む題名 (イシュー#594) › 本を削除すると、保存先からその本の長文メモのファイルが消える | 通った | 通った |
| book-memo-file-lifecycle | 長文メモのファイルが取り残されない: Asayake ハブ・使えない文字と空白を含む題名 (イシュー#594) › 題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 通った | 通った |
| save-failure-visible | 保存の失敗が画面に出る: Asayake ハブ (イシュー#603) › 1回目の自動の再試行で直る失敗は、何も出さずに保存される | 通った | 通った |
| save-failure-visible | 保存の失敗が画面に出る: Asayake ハブ (イシュー#603) › 再試行が尽きた失敗は状態バーに原因と「再試行」が出て、「再試行」・次の保存で消える (通常の保存と本棚の削除) | 通った | 通った |
| save-failure-visible | 日本語のブラウザでの表示 (イシュー#603) › 同期欄の時刻と状態バーの文言が日本語の表記で出て、状態バーの行がはみ出さない | 通った | 通った |
| save-failure-visible | 自動の再試行を待つ間にネットにつながったら、すぐ再試行して保存する (イシュー#603) | 通った | 通った |
| shelf-file-delete | 本棚の削除で保存先の本棚ファイルも消える: Asayake ハブ (イシュー#587) › 子を持つ本棚を削除すると、親と子の両方のファイルが保存先から消える | 通った | 通った |
| shelf-file-delete | 本棚の削除で保存先の本棚ファイルも消える: Asayake ハブ (イシュー#587) › 本棚の名前を変えても、保存先の本棚ファイルは同じ1つのまま (古いファイルが残らない) | 通った | 通った |
| shelf-file-delete | 本棚の削除で保存先の本棚ファイルも消える: Asayake ハブ (イシュー#587) › 本棚を1つ削除すると、保存先からその本棚のファイルが消える | 通った | 通った |
| shelf-file-delete | 本棚ファイルの削除待ち: Asayake ハブ (イシュー#587) › 保存先にまだ無い本棚ファイルの削除が混ざっても、保存は失敗しない | 通った | 通った |
| shelf-file-delete | 本棚ファイルの削除待ち: Asayake ハブ (イシュー#587) › 削除の保存が一度失敗しても、次の保存で本棚ファイルが消える | 通った | 通った |
| shelf-file-delete | 本棚ファイルの削除待ち: Asayake ハブ (イシュー#587) › 削除待ちの slug で作り直した本棚のファイルは消えない | 通った | 通った |

残りの33本（GitHub・ローカルの分と、GitHub だけのテスト）も、step1 と同じ（30 passed・3 skipped）。

## step4 main と比べて新しく落ちたテストが無いか（2026-11-14・base origin/main bd610ea・work 0ff68f4）

- 始める前に origin/main bd610ea（#590 の J2-2・J2-5 の投入）へ rebase した（衝突なし）。自分の commit は5本（3f5bc69・8c21dae・db5c57e・9de9552・0ff68f4）。rebase の後も、外した名前の grep は scripts/verify 以外で0件。main に入った `gate/j6-4-sync-conflict.spec.js`（#616）が gate-hub.js を使っている（gate-hub.js の呼び出し元が1本増えた）。
- 流したもの: `GATE_WEBKIT=1 node scripts/verify/e2e-diff-main.mjs --port=8198 --out=<_artifacts/598/e2e-diff>`（13:38 開始）。
- スクリプトは最後まで終わらなかった。base・work の E2E（各1560本）、vitest（両側）、画像比較（work）までは終わり、「新しく落ちた1件を work 側で3回流し直す」の途中（13:49 ごろ）で、実行役のセッションごと止められた（exit 137）。report.md は出ていない。
  - 再開後（13:51）、HEAD（0ff68f4）と origin/main（bd610ea）が止まる前と同じことを確かめた。残っていた結果（base/work の json）から、スクリプトと同じ分類（scripts/verify/e2e-diff-lib.mjs の `categorize`）で3つの表を作った。
  - 途中だった流し直しは、スクリプトと同じ引数（`test gate/j2-5-import-no-duplicate.spec.js:17 --project chromium`）で、手で3回流した。

### E2E（1側 1560本: chromium 756・gate-webkit 30・char 6端末 × 129）

| | base（bd610ea） | work（0ff68f4） |
|---|---|---|
| 通った | 954 | 959 |
| skip | 599 | 599 |
| 落ちた | 7（すべて chromium） | 2（すべて chromium） |

| 表 | 件数 | 中身 |
|---|---|---|
| 新しく落ちた | 1（chromium 1・gate-webkit 0・char 0） | `gate/j2-5-import-no-duplicate`「@gate J2-5 「選択した本を取り込む」の二度押しと、同じデータの再取込で、冊数が N=3 のまま (重複0件)」 |
| 新しく通った | 6（すべて chromium） | `book-memo-file-lifecycle`「GitHub・使えない文字と空白を含む題名 › 本を削除すると…」1本・`list-staged-render` 2本・`reimport-diff` 3本 |
| 両方で落ちた | 1（chromium） | `gate/j2-2-import-paste`「@gate J2-2 J2-6 取込データを貼って取り込むと…」 |

- 新しく落ちた1件（J2-5）を work 側で3回流し直した結果: 通った・落ちた・通った。スクリプトの決まり（1回でも通れば flake）で flake。**regression は0件**。
  - J2-5 と J2-2 は既知の赤（docs/gate/known-red.json・#622「取り込んだ直後（1秒以内）に再読込すると冊数が 0 になる」）。どちらの spec も、今回変えた gate-hub.js・storage-fakes.js を読み込んでいない。
- 新しく通った6件は、base 側だけで落ちたもの。base 側を流している間は、他のイシューの E2E と重なって負荷が高かった（16コアで load average 約50。work 側の間は約20〜35）。
- gate-webkit: 30本。両側とも落ちたテストは0 = 新しく落ちた0件。step2 で1回だけ落ちた billing-portal-return（WebKit・保存先 local）は、両側とも通った。
- 今回変えたヘルパーを読み込む spec だけを取り出した結果（移した3 spec・gate-hub.js を使う gate spec 8本（j5-4・j5-5・j5-6・j6-2・j6-3・j6-4・j7-account-delete・j7-billing）・billing-portal-return）: chromium 67本・gate-webkit 16本の計83本。新しく落ちたものは0。base と違うのは book-memo の GitHub の1本（base で落ち、work で通った）だけ。
  - j6-4 のハブの衝突（2台で衝突 → 3択）は、If-Match の比べ方を変えた後の gate-hub.js で初めて流れた。両側・両 project で通った。

### vitest・画像比較・lint

| 何を | 結果 |
|---|---|
| vitest（スクリプトが両側で流した分） | 両側とも 1078本中 1076 passed・2 todo・失敗0。3つの表は 0件・0件・0件 |
| 画像比較（work 側） | 54本すべて一致（失敗0） |
| CI と同じ lint（check:version・lint:css・e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs・e2e-gate・copy・terms・known-red） | すべて exit 0（check:version は「js/css の変更なし」。e2e-gate は @gate 34本・違反0。known-red は既知の赤2件・違反0） |

### 判定

新しく落ちたテスト（regression）は、chromium・gate-webkit とも0件。push してよいかは②の判断を待つ。

- 結果の置き場: `/home/kuroko/worktrees/bookshelf/_artifacts/598/e2e-diff/`（base.e2e.json・work.e2e.json・base/work.vitest.json・work.visual.json）と、流し直しの記録 `_artifacts/598/j25-work-{1,2,3}.log`（どれもリポジトリの外）。
- 止められた時の残り: `_artifacts/598/e2e-diff/_worktree-base` のフォルダ（base 側の一時 worktree の残り。git の worktree の登録は残っていない）。同じ `--out` で流し直す時は邪魔になるので、別の `--out` を使う。

## step5 push の前の確認（2026-11-14・土台 origin/main 762e41b）

- ②の承認（14:06）の後、push の前に fetch すると origin/main が 762e41b へ進んでいた（#596 の8本と #608 の1本）。rebase した（衝突なし）。#596 は移した3 spec の `bootWithLocalFolder`（ローカルの投入に決めた印 `methodChosen: true`）を変えている。`bootWithHub` は変えていない。
- rebase の後も、`installFakeHub|FAKE_HUB_BASE|fakehub\.test` の grep は scripts/verify 以外で0件。origin/main から HEAD までは自分の commit だけ。
- 載せ直した状態で、移した3 spec と gate-hub.js を使う spec（gate 8本・billing-portal-return）を chromium と gate-webkit で流した: 83本中 78 passed・4 skipped（既存の fixme）・1 failed。
  - 落ちた1本は shelf-file-delete の「本棚の削除で保存先の本棚ファイルも消える: GitHub › 子を持つ本棚を削除すると…」（GitHub の模擬の分）。本棚を作った後、保存先の一覧に届くのを待つ5秒の制限に掛かった。この時 load average は約35。同じテスト（:153・保存先3つ分）を3回流し直して、3回とも3本すべて通った = flake。ハブの分ではない。
- CI と同じ lint と check:version は、rebase の後にもう一度流してすべて exit 0。
- push と CI の結果は、イシューの完了報告に書く（この記録を足すと、もう1回 push が要るため）。

### 移した spec（ハブの模擬を installFakeHub から gate-hub.js へ）

- tests/e2e/shelf-file-delete.spec.js（#587・ハブを使うテスト6本）
- tests/e2e/book-memo-file-lifecycle.spec.js（#594・8本。うち1本は fixme）
- tests/e2e/save-failure-visible.spec.js（#603・4本）

### 範囲外の重なり（別イシューの候補・今回は触っていない）

- GitHub の模擬が2本ある: storage-fakes.js の `installFakeGitHub`（3 spec が使う）と、gate-github.js（門の E2E が使う）。
- ローカルフォルダの模擬が2本ある: storage-fakes.js の `installFakeLocalFolder`・`installLocalWriteFailures` と、gate-local.js。
- spec の中に自前のハブの模擬を持つファイル（`page.route` でハブの応答を書いている）: plugin-seed（installMockHub）・publish-conflict-hub・publish-article-editor（2か所）・critical-path・char/hub-conflict・char/publish-hub・char/article-ops-count・onboarding-and-prefs。
- #602 の branch の tests/e2e/sync-offline-reconnect.spec.js（main 未着）は installFakeHub と FAKE_HUB_BASE を使っている。#602 が載せ直す時に gate-hub.js（HUB_BASE・hubStoreForTest）へ替える（②が #602 へ伝える）。
- gate-hub.js の `state.requests` は状態コードを持たない。模擬に無い道（501）を機械で拾いたい時は、記録に印を付ける小さな変更が要る。
