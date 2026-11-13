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

観測点37が全部そろったら、CI の `lint:e2e-gate` に `--strict-coverage` を付けて、未達を失敗にする（`.github/workflows/ci.yml`）。

## 保存先と別の端末の前提（公開・同期の観測点・イシュー#588）

外部は通信の模擬で、アプリの読み書きは本物を通す。どれも前提の区間で呼ぶ。使い方の例は J5・J6 の spec。

| やりたいこと | ヘルパー |
|---|---|
| 保存先・公開先をハブにする（保存・まとめ書き・公開・公開ページの配信） | `gate-hub.js`：`createHubStateForTest` → `seedHubDataForTest`（ハブに蔵書）→ `seedHubLoginForTest(page, hub, { method: 'hub', library: false })` → `mockHubForTest` → `bootAppForTest` → `waitForHubStartupForTest` |
| ハブへの書き込みを失敗させる・届くのを待つ | `failHubWritesForTest`・`waitForHubFileContainsForTest` |
| 保存先を GitHub にする | `gate-github.js`：`createMockGitHubForTest` → `seedGitHubDataForTest` → `seedGitHubLoginForTest` → `mockGitHubForTest`（届くのを待つのは `waitForGitHubFileContainsForTest`） |
| 別の端末（2つ目のブラウザコンテキスト）で同じ保存先を開く | `gate-device.js`：`prepareOtherDeviceForTest(page, hub または gh)`・`closeOtherDeviceForTest` |
| 保存先をローカルのフォルダにする（ブラウザの中の OPFS） | `gate-local.js`：`stubFolderPickerForTest`・`seedLocalLibraryOnceForTest`・`seedLocalFolderForTest`・`waitForLocalFileContainsForTest`・`clearLocalCacheForTest` |

- 模擬の route はページではなくコンテキストに、ホストごとに1本だけ掛ける。同じコンテキストに同じ模擬を2回掛けない（取り合いになる）。
- `seedLibraryForTest`（gate-setup.js）は再読込のたびに入れ直す。再読込・再起動をまたいで確かめるテストでは、1回だけ入れる `seedHubLoginForTest`・`seedGitHubLoginForTest`・`seedLocalLibraryOnceForTest` を使う。
- ハブと GitHub の保存では「同期済み」の文字が画面に出ない。保存が届いたことは、前提の `wait…FileContainsForTest` で待つ。
- 公開URLは本番と同じ形（`https://bookshelf.asayake.org/<username>/<publicId>/`）。新しいタブで開いても同じ模擬が答える。

### J5・J6 の網羅（イシュー#588 時点）

赤の4本は、テストは書いてあるがアプリの不具合で落ちるため、まだ main に入れていない。入れるのは、既知の赤の一覧（docs/gate/known-red.json）が main に入った時（一覧に載せて入れる）か、直すイシューが入った時（緑にして入れる）の早い方。テストの本体は patch `/home/kuroko/kuroko/discord/core/tmp/588-red-specs.patch`（ローカルのブランチ `gate-red-588` にもある）。

| 観測点 | テスト | 状態 |
|---|---|---|
| J5-1 | `j5-1-article-create.spec.js` | テストあり・不具合のため未投入（題名を入れてすぐ一覧へ戻ると記事が出ない・#595） |
| J5-2〜J5-6 | `j5-2-shelf-block-tap`・`j5-3-article-preview`・`j5-4-publish-read-url`・`j5-5-publish-update`・`j5-6-unpublish-delete` | 投入済み・緑 |
| J6-1 | `j6-1-local-restart.spec.js` | テストあり・不具合のため未投入（ローカルのフォルダに書いた短文メモが開き直すと消える） |
| J6-2・J6-3 | `j6-2-github-other-device`・`j6-3-hub-other-device` | 投入済み・緑 |
| J6-4 | `j6-4-sync-conflict.spec.js` | テストあり・不具合のため未投入（2台の本当の衝突で3択も知らせも出ない） |
| J6-5 | `j6-5-sync-failure.spec.js` | テストあり・不具合のため未投入（ハブへの保存の失敗が画面に出ない・#603） |
