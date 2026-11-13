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
