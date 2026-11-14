# 門のE2E（`@gate`）の書き方

公開前品質の門(a)。観測点37（`jobs.json`）を、**利用者と同じ操作で、画面に見える結果を確かめる** E2E で埋める。内部を呼んで通したテストは「ボタンが壊れていても緑」になりうる（#580）ので、門には数えない。設計の正本は obsidian `60_🐙claude/63_🐙project/bookshelf/公開前最終テスト設計.md` §2・§3。

- 見本：`j5-2-shelf-block-tap.spec.js`（J5-2）
- 前提の置き場：`../helpers/gate-setup.js`
- 門に数えないテスト（回帰・境界・性能）は、今までの書き方のままでよい。

## 決まり（`npm run lint:e2e-gate` が確かめる）

**テスト名**に `@gate` と観測点ID を書く。静的な文字列にする（ID は複数書いてよい）。

```js
test('@gate J5-2 記事に本棚ブロックを置き、キャンバスのブロックをタップして本を足せる', async ({ page }) => {
    await test.step('前提: …', async () => { … });
    await test.step('操作: …', async () => { … });
    await test.step('確認: …', async () => { … });
});
```

**本文**は `test.step` の3種だけで組む。操作と確認は1つ以上要る。区間の外に書けるのは、値を置くだけの宣言だけ。

| 区間 | 書けるもの | 書けないもの |
|---|---|---|
| `前提: …`（同じ範囲の `beforeEach`・`beforeAll` も前提として扱う） | `tests/e2e/helpers/` の関数の呼び出しだけ | `page.*` の直書き、spec 内の自作関数、`expect` |
| `操作: …` | タップ・クリック・入力・キー・ファイル選択・再読込・利用者が開く URL への移動。画面が変わるのを待つ `expect` | `evaluate` の類、内部から開く・内部から動かす関数 |
| `確認: …` | 画面に見えるもの（文字・件数・URL）への `expect`。1つ以上要る | `evaluate` の類、内部の状態を読む関数 |

- **`evaluate` の類**：`evaluate`・`evaluateHandle`・`evaluateAll`・`$eval`・`$$eval`・`waitForFunction`・`addInitScript`・`addScriptTag`・`exposeFunction`・`exposeBinding`・`route`・`routeFromHAR`・`unroute`・`storageState`。
- **操作・確認で呼ぶ関数**（helpers のものも、spec 内の自作も）は、本体を辿って確かめられる。ヘルパーからヘルパーへの呼び出しも追い、`evaluate` の類に届けば違反になる（深さの上限は8。超えると「確かめ切れない」で違反）。
  - 使えない例：`addBlock`（内部で件数を読む）・`getArtDraft`・`setArtBlocks`・`flushArtSave`
  - 使える例：`canvas`・`editArtBlockViaMenu`（クリックだけ）
- **helpers の `open*`・`show*`・`*Internal`** は、中身がクリックだけでも操作・確認では使えない（`openArtEditor`・`openDrawer` 等）。ボタンを直接押すか、クリックだけのヘルパーを別の名前で足す。
- **アプリ自身のファイル**（`index.html`・`js/`・`css/`・`sw.js`）への通信は、前提のヘルパーの中でも差し替えない。外部（ハブ・GitHub・Amazon）の模擬は前提でしてよい。
- `@gate` に `test.skip`・`test.only` 等を付けない。`@gate` を `describe` やタグのオプションで付けない。
- ファイル・IndexedDB など非同期でしか読めないものを待つ時は `expect.poll(() => page.evaluate(async …))` を使う（`waitForFunction` に async 関数を渡さない。返る Promise が真とみなされ、待たずに通る・#607）。門に数えないテストも含めて `npm run lint:e2e-wait` が確かめる。

## 機械では分からない決まり（書く人が守る）

- 入口の観測点（「入口のボタンから開ける」等）は、直リンク（`index.html#/publish` 等）で飛ばさない。
- 関数を別の名前に入れ直してから呼ばない。ヘルパーはオブジェクトのメソッドにせず、関数として書く（lint が本体を辿れなくなる）。
- `route` の宛先を変数や関数にして、アプリ自身のファイルを差し替えない。
- 確認は、利用者が見て分かるもので書く。内部の属性を読むのは、画面が変わるのを待つ時だけにする。

## 流し方

```bash
# 書き方と、観測点の網羅（未達は警告だけ）
npm run lint:e2e-gate

# 門のE2E を3回流す（揺れ0が合格の条件）。PORT は自分の作業ツリーの番号にする
PORT=8183 PLAYWRIGHT_BASE_URL=http://localhost:8183 PLAYWRIGHT_JSON_OUTPUT_NAME=_local/gate/gate-e2e.json \
  npx playwright test tests/e2e/gate --project=chromium --repeat-each=3 --reporter=list,json

# 合否の集計（今の未達を表で出す）。読む結果の形は docs/gate/README.md
npm run gate:report -- --collect
```

観測点37は全部そろったので、CI の `lint:e2e-gate` は `--strict-coverage` 付きで流し、未達も失敗にする（`.github/workflows/ci.yml`・#629）。手元で同じ判定をするなら `npm run lint:e2e-gate -- --strict-coverage`。

## 保存先と別の端末の前提（公開・同期の観測点・イシュー#588）

外部は通信の模擬で、アプリの読み書きは本物を通す。どれも前提の区間で呼ぶ。使い方の例は J5・J6 の spec。

| やりたいこと | ヘルパー |
|---|---|
| 保存先・公開先をハブにする（保存・まとめ書き・公開・公開ページの配信） | `gate-hub.js`：`createHubStateForTest` → `seedHubDataForTest`（ハブに蔵書）→ `seedHubLoginForTest(page, hub, { method: 'hub', library: false })` → `mockHubForTest` → `bootAppForTest` → `waitForHubStartupForTest` |
| ハブへの書き込みを失敗させる・届くのを待つ | `failHubWritesForTest(hub)`（これ以降ずっと）・`failHubWritesForTest(hub, n)`（次の n 回だけ）・`waitForHubFileContainsForTest` |
| 保存の失敗の自動の再試行の間隔を短くする（再試行が尽きた後の知らせまで確かめる時。既定は 5秒・15秒・45秒で、尽きるまで約66秒） | `gate-sync-retry.js`：`shortenSyncRetryForTest(page)`（既定 `[300, 300, 300]`。アプリを開く前に呼ぶ・イシュー#632） |
| ハブの中身・書き込み・削除の要求を読む（保存先3つを同じ形で回す spec 用。門以外の shelf-file-delete・book-memo-file-lifecycle・save-failure-visible が使う） | `hubStoreForTest(hub)`：`has`・`readJSON`・`list`・`writes`・`deleteRequests`・`failNextWrites(n)`・`failuresLeft`（`storage-fakes.js` の GitHub・ローカルの模擬と同じ名前） |
| 保存先を GitHub にする | `gate-github.js`：`createMockGitHubForTest` → `seedGitHubDataForTest` → `seedGitHubLoginForTest` → `mockGitHubForTest`（届くのを待つのは `waitForGitHubFileContainsForTest`） |
| 接続を画面の操作で通す（初回の J1-3・J1-4・イシュー#629） | ハブ：`createHubStateForTest`（同じ worker で繰り返すなら `resetHubStateForTest`）→ `mockHubForTest` → `mockHubSessionForTest` → `mockGoogleSignInForTest` → `bootAppForTest`（`seedHubLoginForTest` は使わない）。GitHub：`createMockGitHubForTest` → `seedGitHubDataForTest` → `mockGitHubForTest` → `mockGitHubConnectForTest` → `bootAppForTest`（`seedGitHubLoginForTest` は使わない。`mockGitHubDeviceFlowForTest` とは併用しない） |
| 別の端末（2つ目のブラウザコンテキスト）で同じ保存先を開く | `gate-device.js`：`prepareOtherDeviceForTest(page, hub または gh)`・`closeOtherDeviceForTest` |
| 保存先をローカルのフォルダにする（ブラウザの中の OPFS） | `gate-local.js`：`stubFolderPickerForTest`・`seedLocalLibraryOnceForTest`・`seedLocalFolderForTest`・`waitForLocalFileContainsForTest`・`clearLocalCacheForTest` |

- 模擬の route はページではなくコンテキストに、ホストごとに1本だけ掛ける。同じコンテキストに同じ模擬を2回掛けない（取り合いになる）。
- `seedLibraryForTest`（gate-setup.js）は再読込のたびに入れ直す。再読込・再起動をまたいで確かめるテストでは、1回だけ入れる `seedHubLoginForTest`・`seedGitHubLoginForTest`・`seedLocalLibraryOnceForTest` を使う。
- ハブと GitHub の保存では「同期済み」の文字が画面に出ない。保存が届いたことは、前提の `wait…FileContainsForTest` で待つ。
- 公開URLは本番と同じ形（`https://bookshelf.asayake.org/<username>/<publicId>/`）。新しいタブで開いても同じ模擬が答える。

### J5・J6 の網羅（イシュー#588・#632 時点）

J5・J6 の観測点は、全部 main に入っていて緑（2026-11-14・イシュー#632）。#588 でアプリの不具合のため赤だった4本は、直すイシューが入った後に緑にして入れた（J6-1・#607、J6-4・#616、J5-1・J6-5・#632）。J6-1 の赤の原因は、アプリではなくテストの待ちのヘルパーだった。

| 観測点 | テスト | 状態 |
|---|---|---|
| J5-1 | `j5-1-article-create.spec.js` | 投入済み・緑（題名を入れてすぐ一覧へ戻ると記事が出なかった不具合を、#595・#609 で直した後に入れた・#632） |
| J5-2〜J5-6 | `j5-2-shelf-block-tap`・`j5-3-article-preview`・`j5-4-publish-read-url`・`j5-5-publish-update`・`j5-6-unpublish-delete` | 投入済み・緑 |
| J6-1 | `j6-1-local-restart.spec.js` | 投入済み・緑（赤はアプリの不具合ではなく、フォルダへの書き込みを待たずに通るヘルパーのせいだった・#607）。webkit では流さない（ローカルのフォルダ保存は PC の Chrome/Edge 専用・`gate-webkit` の `testIgnore`） |
| J6-2・J6-3 | `j6-2-github-other-device`・`j6-3-hub-other-device` | 投入済み・緑 |
| J6-4 | `j6-4-sync-conflict.spec.js` | 投入済み・緑（2台の本当の衝突で3択も知らせも出なかった不具合を直して入れた・#616）。ハブと GitHub の2本。GitHub はリポジトリからAの短文メモが消えないことも見る（まとめ保存が古い版で上書きしていた・#616）。ダイアログは読込時の選択と同じ定義から出る（題「保存先とこの端末の両方が変わっています」・ボタン「保存先の内容を読み込む」「この端末の内容を書き出す」・最初のフォーカスは書き出す・#635） |
| J6-5 | `j6-5-sync-failure.spec.js` | 投入済み・緑（ハブへの保存の失敗が画面に出なかった不具合を #603 で直した後、今の文言と出し方＝ADR-158 に合わせて2本で入れた・#632）。1本目は既定の間隔のまま、状態バーに「保存できていない変更があります。自動で再試行しています。」が出る（約6秒後・15秒まで待つ）。2本目は前提で再試行の間隔を短くし（`gate-sync-retry.js`）、原因の文と「再試行」が出る。範囲はハブの1経路（GitHub・ローカルと直らない種類の失敗は、回帰の `save-failure-visible.spec.js` が見る） |

## webkit（iPhone 相当）で流す（イシュー#589）

`GATE_WEBKIT=1` の時だけ、project `gate-webkit`（`devices['iPhone 13']`＝幅390・タッチ）が足される。対象は `tests/e2e/gate/` の spec と `art-canvas-tap-edit.spec.js`。CI では「test (webkit)」のレグがこれを流す。

```bash
GATE_WEBKIT=1 PORT=8183 PLAYWRIGHT_BASE_URL=http://localhost:8183 \
  npx playwright test --project=gate-webkit --workers=1 --repeat-each=3
```

- **workers を絞る**（`--workers=1`）。並列の負荷の下では、起動や画面の切り替えが既定の待ち（5秒）に収まらず揺れる（#589 step4 で実測）。待ち時間を伸ばして通さない。
- spec で viewport を決めていないと、chromium は PC 幅・webkit はスマホ幅で流れる。入口が幅で変わる操作（設定は PC が `#sidebar-settings`、スマホが `[data-mobile-nav="settings"]`）は、spec で幅を決める。
- 下のナビは起動の前から見えている。起動が済む前に押しても何も起きないので、再読込や画面の移動の後は、起動が済んだ印（ホームに書名が出る等）を待ってから押す。
- 引き出し（スマホの本棚の一覧）の項目を押した後に、その下の画面を押す時は、引き出しが画面の外へ出たのを確かめてから押す（`expect(page.locator('#app-sidebar')).not.toBeInViewport({ ratio: 0.01 })`）。引き出しは閉じる動き（0.25秒）の間も押す操作を受け、URL や件数は押した直後に変わるので、それだけでは待てない。閉じた後も右の境界線が 0.1px 画面に残るため、ratio を付ける（#628）。
- 外部の模擬は `helpers/gate-hub.js`（ハブ・決済・Google のログイン）。Service Worker を止めた実行（既定）なら、webkit でも `page.route` の模擬が効く。

## Service Worker を動かす（J8 オフライン・イシュー#589）

- spec の先頭で `test.use({ serviceWorkers: 'allow' })` にする（config の既定は `'block'`）。前提は `helpers/gate-offline.js`（`seedLibraryOnceForTest` → `openAppForTest` →（2回開いた端末にするなら）`reopenAppForTest`）。
- 電波なしは、操作の区間で `context.setOffline(true)`。
- `gate-setup.js` の `seedLibraryForTest` は再読込のたびに見本を入れ直すので、再読込をまたいで「残る」を確かめる時は使わない。
- webkit では流さない（`gate-webkit` の `testIgnore`）。Playwright の WebKit は、電波なしの間は SW のキャッシュからも読めない（最小の SW でも再読込が失敗する）。iPhone の電波なしは人の実機 H1 で見る。
- SW がページを制御している間は、webkit では `page.route`・`context.route` の模擬が効かない（通信が実ネットワークへ出る）。
- J8-4（電波が戻ると同期される）は SW を動かさない（既定のまま）。書き方は次の節。

## 電波なし・電波が戻る（SW を止めたまま・J8-4・イシュー#617）

アプリは開いたままで電波だけが切れる場面は、SW を止めたまま（既定）で書く。webkit でも外部の模擬が効く。見本は `j8-4-online-resync.spec.js`。

- 電波の切り替えは `helpers/gate-network.js` を使う。前提で `prepareOfflineForTest(context, `${HUB_BASE}/**`)`（外部の模擬を掛けた後に呼ぶ）、操作で `goOfflineForTest(context)`・`goOnlineForTest(context)`。
- **`context.setOffline(true)` だけで書かない**。chromium は `navigator.onLine` が false になり 'offline' も出るが、route で模擬した通信は模擬が答えてしまう（電波なしの間に保存先へ届く＝何も確かめずに緑になる）。webkit は模擬した通信も失敗する。'online'・'offline' はどちらのブラウザでも出る（2026-11-14 に実測）。`gate-network.js` は、電波なしの間、模擬より手前で通信を落として、両方のブラウザを同じにする。
- 電波が戻った後の送り直しを、自動の再試行（5秒・15秒・45秒）と見分ける。電波なしの間に、状態バーの「保存できていない」知らせが出るまで待つ（次の番は15秒後になる）。電波を戻した後、知らせが既定の5秒以内に消えることを確認にする。
- 門ではない E2E（二重に送らない・送信中に重ならない・電波なしのまま開き直した端末）は `tests/e2e/online-resync.spec.js`。

## J7・J8 の網羅（イシュー#589・2026-11-14）

| 観測点 | spec | chromium | webkit |
|---|---|---|---|
| J7-1 | `j7-billing.spec.js` | 緑 | 緑 |
| J7-2 | `j7-billing.spec.js` | 緑 | 緑 |
| J7-3・J7-4 | `j7-account-delete.spec.js` | 緑 | 緑 |
| J8-1 | `j8-offline.spec.js` | 緑 | 流さない（Playwright の制約） |
| J8-2・J8-3 | `j8-offline.spec.js` | 緑 | 流さない（Playwright の制約） |
| J8-4 | `j8-4-online-resync.spec.js` | 緑 | 緑 |

## 既知の赤（`docs/gate/known-red.json`・イシュー#589）

アプリの不具合で赤になっている `@gate` は、テストを緩めずに、この一覧に載せる。1件＝`{ test: テスト名, gate: 観測点ID, issue: 直すイシューの番号, reason }`。

- CI の e2e・webkit レグは、`E2E_SKIP_KNOWN_RED=1` で一覧のテストだけを外す（`helpers/test-base.js` の `skipKnownRed`）。門の判定（`gate:report`）に渡す実行では付けない＝赤のまま数える。外した結果を渡しても、`gate-report` は「未実行」として合格に数えない。
- `npm run lint:known-red`（CI の e2e レグ）が、各件のイシュー番号・観測点ID・テスト名の実在を確かめる。
- 直すイシューが入ったら、そのイシューの側で一覧から消す。

## 網羅（イシュー#590 の J1〜J4 の分・#629 で J1-3・J1-4 のハブと GitHub・J3-5 を足した・2026-11-14）

| 観測点 | テスト | 状態 |
|---|---|---|
| J1-1 | `j1-1-first-run-guide.spec.js` | 投入済み・緑 |
| J1-2 | `j1-2-storage-choice-pc`・`j1-2-storage-choice-phone` | 投入済み・緑（PC と iPhone 相当） |
| J1-3 | `j1-3-connect-local`（フォルダ）・`j1-3-connect-github`（Device Flow）・`j1-3-connect-hub`（ハブのログイン） | 投入済み・緑。ハブの分は chromium・webkit とも緑 |
| J1-4 | `j1-3-connect-local`（フォルダ）・`j1-3-connect-hub`（ハブ）・`j1-4-github-save-reload`（GitHub） | 投入済み・緑。保存先として使っていることは、選択肢ではなく画面の「この保存先を使用中です。」（ハブ）・選択肢の「GitHub」とリポジトリの蔵書（GitHub）で確かめる（保存先を決めていない端末でも、選択肢は「ハブ」を表示するため）。GitHub の分は PC 幅なので webkit では流さない |
| J2-1・J2-3・J2-4 | `j2-1-import-entry`・`j2-3-import-file`・`j2-4-import-bookmarklet` | 投入済み・緑 |
| J2-2・J2-5・J2-6 | `j2-2-import-paste`・`j2-5-import-no-duplicate` | 投入済み・既知の赤（#622・取込の直後すぐ再読込すると冊数が 0 になる。3秒待つと通る。2026-11-14 #590 で実測） |
| J3-1〜J3-4 | `j3-1-shelf-to-detail`〜`j3-4-back-forward-esc-pc`・`-phone` | 投入済み・緑 |
| J3-5 | `j3-5-many-books.spec.js` | 投入済み・緑。913冊・390×844・CPU 6倍で、ページの中で測った時間（`recordInPageTimingsForTest`）を sort-perf-budget と同じ基準（並び順 380／直後の本 420、昇降 340／直後の本 320ms）と比べる。記録が済むのは `toHaveCount` で待つ（`expect(…).toHaveAttribute` で待つと、その問い合わせがページを数秒塞ぎ、測る値が遅れる・#629）。chromium だけ（CPU を遅くするのに CDP を使う） |
| J4-1〜J4-3 | `j4-memo.spec.js` | 投入済み・緑（#611 の症状＝「完了」のあともボタンが「長文メモを書く」のまま、は #620 の本の詳細の更新の修正で出なくなった。2026-11-14 に3回とも緑） |

webkit（gate-webkit）で流さない分と理由は、playwright.config.js の GATE_WEBKIT_IGNORE に1行ずつ書いてある。

観測点37は全部そろった（2026-11-14・#632 の J5-1・J6-5 と #629 の J3-5 で。`npm run lint:e2e-gate` は「網羅 37/37」）。CI の `lint:e2e-gate` は `--strict-coverage` 付きで流す（#629）。