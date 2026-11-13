# U9 G4 実装計画（step1・実測と仕分け案）

対象：イシュー#554。U9（委譲の撤去）最後の群。origin/main 793b53b（本worktreeのHEADと同一）で実測。

## 0. 計画§5の正本（②補足で確認）

`docs/char/u9-classification.md` の lint コメントが参照する「計画」は
`/home/sei/GitHub/bookshelf/tmp/499/recovered/499-step4-plan.md`（**repo の外・`tmp/` は `.gitignore` 対象**）。
§5「委譲（古い呼び口）を外す計画」311-326行の要旨：

> U9で「テストの内部への参照を0にし、委譲を撤去する。残すのは、plugin-api.js が依存している窓口（d）だけ」

## 1. 実測表（lintの現パターン＝narrow、`\b(bookshelf|app)\._[A-Za-z]`）

```
$ node scripts/check-test-internal-refs.mjs
テストの内部参照(bookshelf._/app._)の件数: 128 (上限 128)
-- パターン別 --
  bookshelf._: 120
  app._: 8
```

ファイル別（helpers内か否かで列を分ける）：

| ファイル | 件数 | helpers内か |
|---|---:|---|
| tests/e2e/helpers/art-editor.js | 39 | ○helper |
| tests/e2e/app-version-check.spec.js | 8 | spec |
| tests/e2e/back-nav-matrix.spec.js | 8 | spec |
| tests/e2e/helpers/book-memo.js | 8 | ○helper |
| tests/e2e/standard-ops.spec.js | 7 | spec |
| tests/e2e/publish-article-editor.spec.js | 6 | spec |
| tests/e2e/helpers/settings.js | 5 | ○helper |
| tests/e2e/touch-reorder.spec.js | 5 | spec |
| tests/e2e/bookshelf-clip-385.spec.js | 4 | spec |
| tests/e2e/username-publish-gate.spec.js | 4 | spec |
| tests/e2e/char/hub-conflict.spec.js | 3 | spec |
| tests/e2e/list-staged-render.spec.js | 3 | spec |
| tests/e2e/bookshelf-clip-373.spec.js | 2 | spec |
| tests/e2e/char/article-ops-count.spec.js | 2 | spec |
| tests/e2e/char/publish-hub.spec.js | 2 | spec |
| tests/e2e/checklist-timing.spec.js | 2 | spec |
| tests/e2e/forward-reopen-idempotent.spec.js | 2 | spec |
| tests/e2e/sync-conflict.spec.js | 2 | spec |
| （残り16ファイル、各1件） | 16 | spec |

**helpers内合計＝52（art-editor.js 39 + book-memo.js 8 + settings.js 5。すべてG1〜G3-3で集約済みのもの）。
spec側合計＝76（24ファイル・22名）。52+76=128＝lint実測値と一致。**

### 1-1. lintパターンを広げた場合（②補足：`_+[A-Za-z]`＝二重アンダースコアも数える）

| | narrow（現行） | widened（`_+`） | 差分 |
|---|---:|---:|---:|
| bookshelf._ | 120 | 122 | +2 |
| app._ | 8 | 8 | ±0 |
| 合計 | 128 | 130 | +2 |

差分2件はいずれも `tests/e2e/publish-article-editor.spec.js:662,679` の `window.bookshelf.__releaseRead`（lintの正規表現が`_`1つ始まりのため今まで数えていなかった分）。
**widenedで新たに引っかかった名前はこの1つのみ**（`git grep -noE "\b(bookshelf|app)\.__+[A-Za-z][A-Za-z0-9_]*"` で確認・他に二重アンダースコア名は0件）。

## 2. 名前別の内訳（spec側・G4の対象。widenedパターンで実測）

| 名前 | spec件数 | helper内の既存件数 | §1分類表の分類 | 実際の使われ方（確認済み） | (a)/(c)提案 |
|---|---:|---:|---|---|---|
| `_isSyncReady` | 27(26+app._1) | 0 | (d)/一部(c) | **全27件がモック上書き**(`= () => true/false/ready`)。読み取りではない | (c)モック用ヘルパー |
| `_openDrawer` | 9(7+app._2) | 0 | (a) | 全件呼び出し（引き出しを開く） | (a)実クリック |
| `_handleSyncConflict` | 5 | 0 | (c) | catch節エラー注入、クリック再現不可 | (c) |
| `_setBodyView` | 4 | 0 | (c)要確認 | 全件呼び出し（'main'へ強制遷移） | (a)/(c)要確認 |
| `_scheduleSync` | 4 | 0 | (c) | 即時同期の強制呼び出し（決定性） | (c) |
| `_checkAppVersion` | 3 | 0 | (c)モック | fetchメソッド自体を上書き | (c)モック用ヘルパー |
| `_conflictNotified` | 3 | 0 | (c) | フラグの直接読み取り | (c) |
| `_applyPwaUpdate` | 2 | 0 | (c) | 即時適用の強制呼び出し | (c) |
| `_pwaUpdateReg` | 2 | 0 | (c) | 状態の直接読み取り | (c) |
| `_openPalette` | 2 | 0 | (a) | 全件呼び出し | (a)⌘K相当のキー入力 |
| `_navigateFromUi` | 2 | 0 | (a)要確認 | `if(router) navigateFromUi else setBodyView`の二択で呼ばれる | (a)/(c)要確認（routerが常にtrueなら片方は死に経路） |
| `_runPendingSync` | 2 | 0 | (c) | 即時実行の強制呼び出し | (c) |
| `_listTail` | 2 | 0 | (c) | 内部状態の直接読み取り | (c) |
| `__releaseRead` | 2 | 0 | (c) | テストが`window.bookshelf`に後付けした計測/解放フック | (c)（ヘルパー内に隠す） |
| `_onPwaUpdateReady` | 1 | 0 | (c) | 強制呼び出し | (c) |
| `_modalHistPush` | 1 | 0 | (c) | **読み取りでも呼び出しでもない**。真偽値ガード(`window.bookshelf._modalHistPush && ...`)としての存在確認のみ | (c)（ガード自体を撤去できるか検討） |
| `_showConflictDialog` | 1 | 0 | (c) | 自動表示ダイアログ、クリック導線なし | (c) |
| `_updateCoverSizeOptionLabels` | 1 | 0 | (c) | 強制呼び出し | (c) |
| `_orderedBooksToRender` | 1 | 0 | (c) | 内部状態の直接読み取り | (c) |
| `_applyRoute` | 1 | 0 | **§1に無し（新規発見）** | ルーターの再適用を無効化するモック上書き（E2E専用割り切り） | (c)モック用ヘルパー |
| `_applyHeaderLayout` | 1 | 0 | **§1に無し（新規発見）** | プラグインボタンのモック注入直後の強制再計算呼び出し | (c)要確認（実トリガ未確認） |
| `_runPublishExport` | 1 | 0 | (c)要確認→確認済み | 非同期メソッド自体をモック上書き（ネットワーク迂回） | (c)モック用ヘルパー |
| `_applyRatingEverywhere` | 1 | 0 | (a) | `saveRating()`直後に手で呼んでいるが、**実クリック経路(`.star-rating .star`)は内部でこの2行をセットで呼ぶ**(bookshelf.js:2444-2445) | (a)実クリック |

**合計：23名・78件（widened）／22名・76件（narrow、`__releaseRead`除く）**

## 3. 分類表§3の「18種類+__releaseRead・70+2件」とのずれ

実測は **22名（regular）+ `__releaseRead` = 23名、76件（narrow）/78件（widened）**。②補足の指示どおり実測値側に合わせる。差分の内訳：

1. **分類表§1の記載に無い名前が2つ見つかった**：`_applyRoute`・`_applyHeaderLayout`（いずれも `tests/e2e/touch-reorder.spec.js` の`app._`形）。355件棚卸し時の数え落とし（G2の`_openBookMemoInAppEditor`・G3-2の`_artRenderBlocks`等と同種のパターン）。
2. 分類表§1を素直に数えると実は20名（18ではない）相当になる（§1記載の core/雑多系から art*/settings/book-detail の完了済み名前を除いた残り）。brief の「18種類」はおおよその記述で、実測の方を正とする（②補足どおり）。

## 4. (a)化前の自動発火チェック（#553の教訓）

(a)候補について、本体コードが別経路で同じ処理を自動的に呼んでいないかを確認した：

- **`_openDrawer`**：`forward-reopen-idempotent.spec.js`は既にこの呼び出しを`openByButton`という名のヘルパーで包んでおり、実クリック相当の意図で書かれていた。自動発火は見つからなかった（bookshelf.js内の呼び出し元はクリックハンドラのみ）。
- **`_openPalette`**：⌘K相当。自動発火なし。
- **`_applyRatingEverywhere`**：`saveRating()`自体は`_applyRatingEverywhere`を呼ばない（bookshelf.js:6594-6600で確認・単純なデータ書き込みのみ）。実クリック経路(`.star-rating .star`、bookshelf.js:2437-2446)は`saveRating()`→`_applyRatingEverywhere()`を**この順でセット呼び出し**している。現在のテストの2行呼び出しはこのクリックハンドラの中身をそのまま手で再現したものなので、(a)化で安全に1クリックへ置換できる。
- **`_navigateFromUi`**：二択分岐(`if (router) ... else ...`)の`else`枝が現行コードで本当に到達するか、本体側の`router`初期化経路をstep2着手時に確認する（要確認のまま持ち越し）。

## 5. 重要な訂正・判断材料（②向け）

1. **`_isSyncReady`はbriefの記述と実態が異なる**：briefは「テストでは『足場ができるのを待つ』ために状態を読んでいる」としているが、実測では**全27件が`window.bookshelf._isSyncReady = () => true/false/ready`という代入（モック上書き）**で、一件も読み取り(wait)ではなかった。plugin-api.js:769の契約呼び出し自体（(d)）はテストコードには出現しない。
   - brief例示の`waitForSyncReady`という名前は「待つ」ヘルパーを想起させるが、実態に合わせると`mockSyncReady(page, ready = true)`のような**上書き系ヘルパー**にするのが適切と考える。②の判断を待つ（step2着手前に確定したい）。
2. **`_checkAppVersion`／`_runPublishExport`／`_applyRoute`も同系統のモック上書きパターン**。これらは`mockXxx(page, ...)`系の命名に揃えるのが自然。
3. **`_modalHistPush`の1件は呼び出しでも読み取りでもなく、存在確認ガード**（back-nav-matrix.spec.js:596）。加えて、2026-11-03の古い project note（#509）には「残した委譲（U9で外す）：`_modalHistPush`と`_modalHistPop`の定義2つ・overlays.hooksから呼ぶ2行・tests内の参照10行」という記載がある。実際に確認すると、tests内の「10行」はほぼ全てコメント（実コード呼び出しは上記1件のみ）で、本体側の`_modalHistPush`/`_modalHistPop`の**定義自体の撤去**（Surface.push/pop への置き換え）は別の作業（nav-state.js/surface.jsとの結線変更を伴う構造変更）であり、本イシューのbrief（テスト内部参照の置換）の範囲外と判断する。このガード1件はヘルパー化（存在確認自体を撤去してよいか含め）で対応し、**定義そのものの撤去はU9-G4のスコープ外として持ち越す**（次段の課題として§6まとめに書く）。②の了承を得たい。
4. **`__releaseRead`**：テストが`window.bookshelf`へ後付けした計測/解放フックで、本体の正式メソッドではない。ヘルパー（例：`stallLongMemoRead(page)`が release 関数を返す）に閉じ込め、spec側からは生参照を無くす。

## 6. 見込み差分行数・分け方

76件（narrow）/78件（widened）・24ファイルのうち、ほとんどの名前が1〜5件・単純な呼び出し/代入パターン（G1のsettings系・G3-3の雑多系と同程度の複雑度）。新設ヘルパーファイルは1つ（`tests/e2e/helpers/app-misc.js`または`sync.js`）を想定。

**見込み差分：約200〜260行**（ヘルパー新設+各specの書き換え+lintコメント更新+本ドキュメント更新）。500行目安を超える見込みは無いため、**分割せず1イシュー（本イシュー）で完結**させる。

## 7-1. step2 実施結果（②回答の反映）

②の2026-11-13 step2承認時の3点回答を反映した。

1. **命名方針**：モック上書き系(c)ヘルパーは`mockSyncReady`/`stubScheduleSync`/`stubRunPendingSync`のように
   「待つ」ではなく「差し替える」と分かる名前にした（`tests/e2e/helpers/sync.js`）。
   **将来、正式なテスト用差し替え口にするかどうかの判断材料（U9まとめへ転記予定）**：
   `_isSyncReady`・`_checkAppVersion`・`_runPublishExport`・`_applyRoute`の4名は、いずれもテストが
   「メソッド自体を上書きして本来の処理を迂回する」という同一パターン（モック注入点）。plugin-api.js側の
   契約は`_isSyncReady`のみだが、残り3名も本体コード側に恒久的なテスト注入点として扱われている
   兆候がある（`_isSyncReady`はplugin-api.js:769、`_artPreviewStallMs`/`_artPreviewHardDeadlineMs`は
   bookshelf.jsのコメントで「テストから注入できるよう」と既に明記済み＝前例あり）。次段で、これら
   モック上書き系をまとめて「正式なテスト用フック」として`window.bookshelf.__test__`のような専用の
   窓口に昇格させるかどうかを検討する価値がある（今回はヘルパー集約のみで、本体側の変更はしない）。
2. **`_modalHistPush`/`_modalHistPop`の定義撤去**：本イシューの範囲外として持ち越す。今回はテスト参照側の
   ヘルパー化のみ行う（step3で対応）。
3. **`_navigateFromUi`のelse枝の到達性確認（実施済み）**：
   `index.html:1500`で`js/router.js`は条件無しで常に読み込まれる（`<script defer src="js/router.js?v=...">`、
   他のオプション機能のような`if (window.XxxYyy)`ガード無し）。`js/bookshelf.js:234-237`の
   `if (window.BookshelfRouter) { this.router = new BookshelfRouter(); ... }`は、`BookshelfRouter`クラスが
   常にグローバルに存在するため実質的に常にtrueで、`this.router`は常にインスタンス化される。
   よって`bookshelf-clip-373.spec.js:139`/`bookshelf-clip-385.spec.js:172`の
   `if (window.bookshelf.router) window.bookshelf._navigateFromUi('main'); else window.bookshelf._setBodyView('main');`
   の`else`枝（`_setBodyView`呼び出し）は、現行コードでは到達しない死に経路と確認した。
   ②指示のとおり、**今回はこの`else`枝を消さない**（到達しないことの記録のみ・コード変更はstep3で
   `_setBodyView`/`_navigateFromUi`をまとめて扱う時に判断する）。

## 7-2. step2 実測結果

lint実測 128→98（純減30、全て(c)）。対象：`_isSyncReady`(27件中25件・2件は下記の理由で延期)・
`_scheduleSync`(4)・`_runPendingSync`(2)・`_handleSyncConflict`(5)・`_conflictNotified`(3)・
`_showConflictDialog`(1)。ヘルパー新設`tests/e2e/helpers/sync.js`（10件のraw参照を内部に持つ）。

**意図的に未変更にした2件**（1回のevaluateで別群(step3)の名前と連結しているため、分割しない方針
＝#552/#553の教訓の踏襲）：
- `tests/e2e/touch-reorder.spec.js:55`の`app._isSyncReady`：同じ`page.evaluate`内で`_applyRoute`の
  上書き・`_openDrawer()`呼び出し・`_applyHeaderLayout()`呼び出し（いずれもstep3対象）と連結している。
  このファイルのコメント自体が「ルーター(hashchange)の非同期な再適用」のタイミング問題に言及しており、
  実際に`js/bookshelf.js`の`finishStartup()`（起動時に`_isSyncReady()`を非同期で参照する処理）が存在する
  ことを確認した（コンストラクタ内`startRouter()`/`finishStartup()`、`js/bookshelf.js:409-470`）。
  この評価ブロックを分割するリスクを避け、step3でまとめて1つのヘルパーへ置き換える。
- `tests/e2e/username-publish-gate.spec.js:261`の`_isSyncReady`：同じevaluate内で`_runPublishExport`
  （step3対象のモック上書き）と連結しているため、同様にstep3へ回す。

## 7-3. step3 実施結果

lint実測（widenedパターン `_+[A-Za-z]`）：130（step1広げた後の基準）→100（step2完了時点）→**82**（step3完了）。
narrowパターン（`_[A-Za-z]`）では98→80→**74+8=82**。spec側（`tests/e2e/helpers`の外）の生の内部参照は**0件**（`git grep`確認済み）。

**(a)化 12件**（`tests/e2e/helpers/nav.js`新設）：
- `_openDrawer`(9件) → `openDrawer(page)`。`[data-mobile-nav="shelves"]`クリック、既に`drawer-open`なら何もしない。
- `_openPalette`(2件) → `openCommandPalette(page)`。`Ctrl+K`、既に開いていれば何もしない。
- `_setBodyView`(1件・ux-p1-nav.spec.js) → `navigateHome(page)`。`[data-mobile-nav="home"]`クリックで
  `_closeDrawer→_navigateFromUi('main')→router.navigateMain()→(非同期hashchange)→_applyRoute→_setBodyView('main')`
  の実経路を通す。
- `_applyRatingEverywhere`(1件・ux-quickwins.spec.js) → `clickStarRating(page, asin, rating)`。
  実クリック経路(`saveRating`+`_applyRatingEverywhere`のセット呼び出し、js/bookshelf.js:2437-2446)が
  既に存在することを確認した上で置換。

**(c)化 36件**（`tests/e2e/helpers/app-misc.js`新設）：
- `_checkAppVersion`/`_applyPwaUpdate`/`_pwaUpdateReg`/`_onPwaUpdateReady`(計8件) →
  `triggerAppVersionCheck`/`spyOnAppVersionCheck`/`mockPwaUpdateReloadFallback`。
  いずれも「メソッド自体を呼ぶ/上書きする」モック・スパイパターンで、クリックでは代替できない。
- `_listTail`/`_orderedBooksToRender`(計3件) → `waitForListStaged`/`getOrderedBooksToRender`。
  段階描画の内部状態、DOM側に型/内容を1:1で示す属性が無い。
- `_runPublishExport`(1件) → `mockRunPublishExport`。
- `__releaseRead`(2件) → `stallLongMemoRead`/`releaseLongMemoRead`。
- `_navigateFromUi`/`_setBodyView`の残り3件(bookshelf-clip-373.spec.js 1件・bookshelf-clip-385.spec.js 2件)
  → `navigateToMainInternal`。**(a)化を見送った理由**：いずれも
  `test.skip(({browserName}) => browserName !== 'webkit', ...)`でwebkit限定の回帰テスト
  （高速連打のストレステスト・WebKit実機再現）であり、`BACKNAV_WEBKIT=1`環境変数が無い
  本runでは実行自体がskipされ、実クリックへの置換が正しく動くかをこの場で検証できない。
  「検証できない変更はリスクが高い」という#550/#553の教訓に沿って(c)のまま残した。
- `touch-reorder.spec.js`のbootApp専用連結ブロック(`_isSyncReady`/`_applyRoute`/`_openDrawer`/
  `_applyHeaderLayout`の4件) → `mockSyncRouteAndMobileCompat`1関数に集約。元の1回の`evaluate`を
  分割せず保った。このファイルも`viewport:{width:1280,height:900}`固定（デスクトップ幅）で実行され、
  `[data-mobile-nav]`は非表示のため、ここの`_openDrawer`は他の8件と異なり(a)化できない
  （モバイル幅限定の防御的コードのため）。
- `_updateCoverSizeOptionLabels`(1件・bookshelf-clip-385.spec.js) → **削除**。`setView('covers')`
  自身が`js/bookshelf.js:1114`で同じ呼び出しを既に行っており（`switchBookshelf`は`cover-size`の
  選択肢に触れないため後段で再度呼ぶ必要もない）、本体コードが別経路で自動的に呼んでいることを
  確認した上で冗長な直接呼び出しを無くした（#553の「(a)化前に自動発火を確認する」教訓の応用。
  クリックでもモックでもなく「既存の公開APIが既に行っている」ケース）。
- `_modalHistPush`存在確認ガード(1件・back-nav-matrix.spec.js) → **撤去**（存在確認のみ削除、
  実際に呼ばれる`openBookshelfModal()`は残す）。`_modalHistPush`は常に`window.bookshelf`上に
  定義済みのメソッドのため、このガードは常にtrueで無意味だった。

**検証**：対象spec全件実行（PORT=8154）で339件passed（back-nav-matrix/checklist-timing/
forward-reopen-idempotent/standard-ops 172・touch-reorder/bookshelf-clip-373/385/
app-version-check/list-staged-render 31（+13 webkit-skip）・username-publish-gate/ux-quickwins/
ux-p1-nav/book-detail-entries 24・publish-article-editor 109）。vitest 852 passed。

**変異検査**：
- (a) `openDrawer`を無効化 → `standard-ops.spec.js`の「ドロワー: 戻るで閉じてアプリに留まる」が
  `body.drawer-open`クラス不在でタイムアウト失敗することを確認（復元後pass）。
- (c) 1回目は`waitForListStaged`を無効化したが、後続の`page.waitForTimeout(300)`で無害化され
  失敗しなかった（#552点4の教訓と同種：無害化チェックの重要性）。2回目に`triggerAppVersionCheck`
  を無効化し、`app-version-check.spec.js`が更新バー非表示で失敗することを確認（復元後pass）。

## 8. 置き換え方針のまとめ（step2・step3への申し送り）

- **step2（同期・競合系）**：`_isSyncReady`(27)・`_scheduleSync`(4)・`_runPendingSync`(2)・`_handleSyncConflict`(5)・`_conflictNotified`(3)・`_showConflictDialog`(1) → 新設`tests/e2e/helpers/sync.js`に集約。全て(c)。`_isSyncReady`は上記5-1の訂正（モック系ヘルパー名）で実装する。
- **step3（残り）**：`_openDrawer`(9,(a))・`_openPalette`(2,(a))・`_applyRatingEverywhere`(1,(a))・`_navigateFromUi`(2,要確認)・`_setBodyView`(4,要確認)・PWA/version系(`_checkAppVersion`/`_applyPwaUpdate`/`_pwaUpdateReg`/`_onPwaUpdateReady`、計8)・`_listTail`(2)・`_conflictNotified`は2に含めた・`_updateCoverSizeOptionLabels`(1)・`_orderedBooksToRender`(1)・`_modalHistPush`(1,ガード)・`_runPublishExport`(1)・`_applyRoute`(1)・`_applyHeaderLayout`(1,要確認)・`__releaseRead`(2) → 新設`tests/e2e/helpers/app-misc.js`に集約。
