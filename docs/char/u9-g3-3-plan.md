# U9 G3-3 計画（_artOpenSheet 以下16名→実測15名・54件）

対象イシュー#553。origin/main 42c87e3（HEAD一致、worktree issue-553）で実測。

## 0. 名前の数（16名→実測15名で確定）

依頼文・申し送り（u9-g3-2-plan.md §10）は「16名」だが、列挙されている名前は15名（`_artOpenSheet`〜`_artOpenEditor`）で合計54件。lint実測（`git grep -onE "\b(bookshelf|app)\.<name>\b" tests/e2e tests/visual`）で15名すべての件数が申し送りと1件も狂わず一致した（下表参照）。②指示どおり、lintの実測値（15名・54件）を正として記録する。「16」は申し送り本文の数え誤りと判断する（16番目の名前は存在しない）。

## 0-1. ②指示: G3-1/G3-2残存17件のファイル確認（漏れ0件）

origin/mainのtestsに残る`_artDraft`(7)・`_artTextFsEditor`(3)・`_artFlushSave`(2)・`_artFlushRemoteNow`(2)・`_artRenderBlocks`(1)・`_artEditingId`(1)・`_artBuildPreviewState`(1)＝計17件は、**全件 `tests/e2e/helpers/art-editor.js` の中にある**（spec側への置換漏れは0件）。出典：各名で`git grep -onE "\b(bookshelf|app)\.<name>\b" tests/e2e tests/visual`を実行し、ヒットが全て`tests/e2e/helpers/art-editor.js:行番号`であることを確認した。

## 1. 分類表（15名・54件）

凡例：(a)実クリックで到達 (c)テスト用ヘルパー集約。件数はlint実測（`bookshelf._`+`app._`合算）。

| 名前 | 件数 | 分類 | 出典・根拠 |
|---|---:|---|---|
| `_artOpenSheet` | 13 | (a) | **訂正**: 13件中12件（back-nav-matrix.spec.js:889・char/publish-hub.spec.js:112・publish-article-editor.spec.js:25・publish-conflict-hub.spec.js:169・standard-ops.spec.js:425・username-publish-gate.spec.js:49。各2件=`window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet()`というガード付き同一コピペパターン）は「狭幅で本棚ブロックに本を追加する」ための前提構築。実クリック導線は確認済み：`.art-shelf-add`/`.art-book-pick`クリック→`_artOpenSheet()`（article-editor.js:2089-2107）。残り1件（forward-reopen-idempotent.spec.js:102）は`_artOpenSheet`自体の進む/戻る冪等性を検証する専用テストで、`instrumentCounts`によるスパイでラップした同じメソッドを呼ぶため、実クリックに替えてもスパイは正しく発火する（クリックハンドラの中身が`this._artOpenSheet()`そのもののため）。1つの共有ヘルパー（実クリック）に集約する |
| `_artCloseSheet` | 10 | (a) | 10件全てが同型のガード付きコピペ（char/publish-hub.spec.js:124・publish-article-editor.spec.js:27・publish-conflict-hub.spec.js:171・standard-ops.spec.js:427・username-publish-gate.spec.js:51の各2件）。実クリック導線確認済み：`#art-sheet-scrim`/`#art-sheet-close`クリック→`_artCloseSheet()`（article-editor.js:225-226、1:1）。1つの共有ヘルパー（実クリック）に集約する |
| `_artPreview` | 6 | (c) | 6件全てが**同一実装の`openPreview()`関数**（critical-path/preview-real-adapter/publish-article-editor/publish-panel/smoke/username-publish-gate.spec.jsの6ファイルにコピペ、addBlock/canvasが過去`#372`でコピペされていたのと同じ構図）。既存実装は`#art-more-btn`が見える時は実クリック(`#art-more-btn`→`#art-width-preview`)、見えない時だけ内部呼び出しにフォールバックする設計済み（挙動は変えない）。1つの共有ヘルパーに集約し6→1にする（クリック優先のロジック自体は変更しない） |
| `_artPreviewStallMs` | 5 | (c) | bookshelf.js:70のコメントで「テストから注入できるよう」と明記済みの意図的なテスト注入点。集約先の定数/ヘルパーに正式化する |
| `_artRenderList` | 3 | (c) | article-editor.js:413。状態変更後に即時再描画させる内部呼び出し。公開窓口なし |
| `_artPublishCalled` | 3 | (c) | js/本体に定義無し。テスト側が貼り付けた計測用フラグ。下記`_artPublish`と同一箇所(publish-article-editor.spec.js:2600-2605)のモンキーパッチ1箇所に閉じる |
| `_artUnpublish` | 2 | (c) | **訂正**（分類表原案の(a)は誤り）。実際の2件はpublish-conflict-hub.spec.js:239-240、`Promise.all([_artUnpublish(id), _artUnpublish(id)])`で**同時に2回**呼び、記事単位in-flightガード(`_artRunExclusive`)が2回目を無視することを検証する決定性テスト。実クリックの二度押しは正確な同時実行を保証できずフレークになるため、内部呼び出しのまま専用ヘルパーに集約する |
| `_artPublish` | 2 | (c) | **訂正**（分類表原案の(a)は誤り）。実際の2件はpublish-article-editor.spec.js:2600,2602。`_artPublish`を一時的に差し替えて呼び出し記録を取る**スパイ実装そのもの**（`_artPublishCalled`と同一箇所）。公開操作の再現ではない |
| `_artOpenPublishPanel` | 2 | (a) | overlay-front.spec.js:108（`#art-publish-header`が非表示の時のフォールバック。コメントで「同じ入口関数を直接呼ぶ」とあるが、実際は`#art-bar-publish`クリックで同じ`_artOpenPublishPanel()`に到達する導線が既にある=article-editor.js:276。フォールバックをクリックに変更できる）／publish-article-editor.spec.js:1314（公開直後にパネルを開き直す。同ファイル内の既存ローカル関数`openPublishPanel(page)`（header/bar自動判定クリック、line60-67）に統一できる） |
| `_artEditBlock` | 2 | (a)1+(c)1 | char/article.spec.js:131（`_artEditBlock('legacy-book-1')`、コメント「全画面編集に入ってはじめて#art-blocksが見える」＝テストの前提構築のみ）は(c)。publish-article-editor.spec.js:2019（ブロックAを選び直す検証）は、ブロック「⋯」メニュー→「編集」の実クリック導線が確認済み（article-editor.js:998 `more`ボタン→`_artOpenBlkMenu`→data-blk-act="edit"→`_artBlkMenuAction('edit')`→`_artEditBlock(b.id)`。全画面への履歴1段引き継ぎも既存仕様でクリック時と同一）なので(a) |
| `_artDelete` | 2 | (c) | **訂正**（分類表原案の(a)は誤り）。`_artUnpublish`と同じpublish-conflict-hub.spec.js:253-254の連打防止決定性テスト（`Promise.all`で2回同時呼び出し）。同じ理由で内部呼び出しのまま専用ヘルパーに集約する |
| `_artShowList` | 1 | (c) | publish-conflict-hub.spec.js:176。記事を作成するヘルパー`createArticleWithBook`内で、保存後に一覧へ戻す後始末として呼んでいる＝テストの前提構築のみ（②指示の(iii)と同じ考え方） |
| `_artRenderPublishPanel` | 1 | (c) | article-editor.js:3177。公開パネルの内部再描画、公開窓口なし |
| `_artPreviewHardDeadlineMs` | 1 | (c) | bookshelf.js:78のコメントで明記済みの意図的なテスト注入点 |
| `_artOpenEditor` | 1 | (a) | **実画面操作で確認済み**（下記§2参照）。publish-article-editor.spec.js:3167、`_artOpenEditor(null)`＝新規記事を開く。`#art-new`クリックで同一状態（hash `#/publish/<仮id>`・ストア未登録・エディタ表示）に到達することをPlaywright MCPで実機確認した |

**内訳**：(a)＝27件（`_artOpenSheet`13・`_artCloseSheet`10・`_artOpenPublishPanel`2・`_artEditBlock`1・`_artOpenEditor`1）／(c)＝27件（`_artPreview`6・`_artPreviewStallMs`5・`_artRenderList`3・`_artPublishCalled`3・`_artUnpublish`2・`_artPublish`2・`_artEditBlock`1・`_artDelete`2・`_artShowList`1・`_artRenderPublishPanel`1・`_artPreviewHardDeadlineMs`1）。

## 2. §5要確認フラグ（この群では`_artOpenEditor`のみ）の確認結果

`_setBodyView`(4件)・`_openPluginSettings`・`_runPublishExport`はorigin/mainでの実測・分類表再確認により54件の外（別の名前・別件数）と確定済み（取り扱わない）。

`_artOpenEditor`（1件、publish-article-editor.spec.js:3167）はPlaywright MCPで実画面を操作して確認した：
1. PORT 8153でindex.htmlを配信、fixture-userdata/fixture-libraryをlocalStorageへ注入してリロード
2. `saveUserData`/`HubAuth.renderSignInButton`/`adapter.readJSON・writeJSON`/`_isSyncReady`をbootApp同等にモック
3. `openPublishPagesModal()`→`#art-new`をクリック
4. 結果：`location.hash`が`#/publish/<仮id>`（`#/publish`そのものではない）・`publishArticleStore.get(仮id)`が`undefined`（ストア未登録）・`#art-edit-view`が表示＝テストが検証している3条件すべてに実クリックで到達した

履歴副作用・非表示要素・scrollIntoViewの確認：`#art-new`は公開一覧モーダルのヘッダーに常設された通常ボタンで、クリック前から常に可視・有効（`disabled`は未接続時のみ）。クリックによる追加の履歴段は無い（`_artOpenEditor`自身のSurface操作のみで、ボタン自体は段を積まない）。scrollIntoViewは不要（常に画面内）。

## 3. (a)にする候補の履歴副作用・非表示要素・scrollIntoViewチェック

- `_artOpenSheet`/`_artCloseSheet`：開閉は`_surface().open/close('art-sheet', ...)`経由で、`art-sheet`面は`artFace`（article-editor.js内`_defineSurfaces`）定義。クリックで呼んでも内部呼び出しで呼んでも**同じ`_artOpenSheet()`/`_artCloseSheet()`が実行される**ため、履歍段数はクリックに変えても変化しない（産本コードの時点で両者は等価）。非表示要素：`.art-shelf-add`/`.art-book-pick`はブロックがアクティブ化された後に出るボタンのため、呼び出し元で対象ブロックが直前の`addBlock(page,'shelf',...)`で作られていることをstep3で確認する（既存2箇所=publishViaPanel/createArticleWithBookは両方この順序を満たす）。scrollIntoView：ブロックはキャンバス内にあり、これまでの実装(`addBlock`)でも使っていないため不要と見込む
- `_artOpenPublishPanel`：`#art-publish-header`/`#art-bar-publish`いずれも編集ヘッダー/バー常設のボタンで非表示要素なし。履歴：`_artOpenPublishPanel()`自身は呼び出し元に関わらず同じ処理
- `_artEditBlock`（publish-article-editor.spec.js:2019分のみ）：ブロック「⋯」ボタンはキャンバス(iframe)内、対象ブロックが画面内にあることをstep3で確認する（testは1024x768等の広いviewportで実行されており、2ブロックが同時に見えている前提なのでscrollIntoViewは不要と見込む）。履歴：「⋯」メニューを開く動作自体が1段履歴を積むが、`art-blk-menu→art-fs`のhand-over（article-editor.js:1092 `keepHistory: toFs`）により全画面遷移時に段が増えない仕組みが既にあるため、内部呼び出し直接実行時と同じ最終履歴段数になる

## 4. 置き換えに使うヘルパーの形（実装はしない）

既存`tests/e2e/helpers/art-editor.js`（G3-1/G3-2が同じファイルへ追加した前例に合わせる）に以下を追加する。G1の`_openSettingsModal`集約・G3-2の`_artDraft`系集約と同じ命名規則（動詞+Art+対象）に揃える。

- `openArtSheet(page)` / `closeArtSheet(page)`：実クリック（`.art-shelf-add`優先、`#art-sheet-close`）。呼び出し元の`if (sheetOpen)`/`if (isNarrow)`ガードはそのまま残し、中身だけこの関数に委譲する
- `openArtPreview(page)`：既存の6ファイル重複`openPreview()`をそのまま移設（ロジック変更なし）
- `openArtPublishPanel(page)`：`#art-publish-header`優先・無ければ`#art-bar-publish`クリック（publish-article-editor.spec.jsの既存ローカル`openPublishPanel`と同じロジックを移設）
- `editArtBlockViaMenu(page, blockId)`：対象ブロックの「⋯」→「編集」クリック（publish-article-editor.spec.js:2019専用）
- `spyOnArtPublish(page)` / `wasArtPublishCalled(page)`：`_artPublish`差し替え+`_artPublishCalled`フラグのモンキーパッチを1箇所に集約（内部参照のまま、公開操作ではない）
- `unpublishArticleRaceGuardCheck(page, id)` / `deleteArticleRaceGuardCheck(page, id)`：`Promise.all`で2回同時呼び出しする連打防止検証を集約（内部呼び出しのまま）
- `showArtList(page)`：`_artShowList()`の前提構築呼び出しを集約
- `openArtEditor(page, id)`：既存一覧行の`[data-act="edit"]`クリック、`id===null`相当は`#art-new`クリック

## 5. MAXの見込み

54件が全てヘルパーへ集約されても、集約先のヘルパー内部にはG3-1/G3-2と同様に残存する（0には出来ない。(a)化分は完全0件になるが(c)化分はヘルパー内に居残る）。実測値はstep2/3実装後にlintで取り直し、その値でMAXを書き換える（現在160→実装後に確定）。

## 6. step2実装結果（(c)分の置き換え完了）

(c)27件のうち、§4で予定した8ヘルパーを`tests/e2e/helpers/art-editor.js`に追加し、spec側の呼び出しを置き換えた。lint実測：160→**150**（純減10件、全て(c)由来）。

- `setArtPreviewStallMs`/`setArtPreviewHardDeadlineMs`：5+1件→ヘルパー内2件（純減4件）。各呼び出し元は元のevaluate内で他の非同期連結を持たない独立代入であることを確認した上で切り出した（G1/G3-2の「.then()連結分割禁止」はPromiseチェーンが対象で、本件は無関係な同期代入の束のため該当しない）。
- `openArtPreview`：6ファイルに完全コピペされていた`openPreview()`を1つに集約（6→1）。ロジックは変更していない（`leaveForm`相当の1行はヘルパー内に複製し、他ファイルの`leaveForm`には依存させていない）。
- `runArtRenderList`/`runArtRenderPublishPanel`：3件中2件を集約（publish-article-editor.spec.js旧1349,1432行相当）。**1件（旧1566行、現1561行）は元のevaluate内でstore.create()×3の直後に同期的に呼ばれており、分割せずそのまま残した**（§4の予定から変更。分割の安全性を判断しきれなかったため、G1/G3-2の教訓に従い保守的に連結を保った。この1件は依然spec側に生の`window.bookshelf._artRenderList()`が残る）。
- `spyOnArtPublish`/`wasArtPublishCalled`：`_artPublish`2件+`_artPublishCalled`3件を1箇所のヘルパーに集約（件数はヘルパー内で変わらず5件のまま、spec側からは0件に）。
- `unpublishArticleTwice`/`deleteArticleTwice`：publish-conflict-hub.spec.jsの連打防止テスト。元のコードが`page.evaluate(...)`の戻り値をawaitせずに変数へ保持し、確認ダイアログのクリックを挟んだ後でawaitする構造だったため、ヘルパーも同じく戻り値をawaitせず返す形にして、この間接呼び出しの構造を保った。
- `editArtBlockForSetup`：char/article.spec.js:131の1件（前提構築のみ）を集約。もう1件（publish-article-editor.spec.js、ブロックの⋯メニュー実クリック化）はstep3で対応する。

検証：影響した8ファイル（critical-path/preview-real-adapter/publish-article-editor/publish-panel/smoke/username-publish-gate/publish-conflict-hub/char/article.spec.js）をPORT=8153でPlaywrightのchromium/char-1440/char-1920プロジェクトで個別実行し、全件成功を確認した（publish-article-editor.spec.js単体で109件、他7ファイル合計59件、計168件成功・0失敗）。vitestも852 passed・2 todo（既存のtodoで変化なし）。

## 7. step3実装結果（(a)分の置き換え）

### 7-1. `_artOpenSheet`/`_artCloseSheet`は(a)化を試みたが撤回し、(c)のまま残した

まず実装コード（article-editor.js:2695-2714）を読んで②指摘2点を検証した。

- **900px超での元コードの意味**：`_artOpenSheet()`は`if (!this._artIsDrawerNarrow()) { this._artSetDrawerUserCollapsed(false); return; }`で900px超は早期returnし、シートではなく常駐パネルの「畳み解除」だけを行う（②の推測どおり）。`_artCloseSheet()`側は`if (!side || !side.classList.contains('is-open')) return;`で、900px超では`is-open`が最初から付かないため自然にno-opになる。
- 検証に基づき、`.art-shelf-add`（直前の`addBlock(page,'shelf',...)`で作ったブロックの「このブロックに追加」ボタン）を900px以下でのみクリックし、900px超では何もしない`openArtSheet(page)`/`closeArtSheet(page)`ヘルパーを実装し、全23件の呼び出し元（back-nav-matrix.spec.js:889を除く）に適用した。
- **実測で失敗を確認**：`username-publish-gate.spec.js`・`publish-conflict-hub.spec.js`では成功したが、`forward-reopen-idempotent.spec.js`（ブロック追加後すぐにシートを開く進む/戻るテスト）と`char/publish-hub.spec.js`（77件フィクスチャでのA1/A7、タッチ3端末390/768/1024）で`.art-shelf-add`のクリックが60秒タイムアウトし、計6件が失敗した（原因未特定：要素自体が描画されていない、別のz-index/overlayに覆われている、77件データでの描画遅延等の可能性があるが、残り時間内に特定できなかった）。`username-publish-gate`/`publish-conflict-hub`で成功した同じセレクタ・同じ手順が別の2ファイルで失敗したことから、「クリックで同じ状態にたどり着けないと分かった」と判断し、**この群(23件)は全て(a)化を撤回し、元の内部呼び出し(`window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet()`等)に戻した**。`openArtSheet`/`closeArtSheet`ヘルパーはart-editor.jsから削除した（未使用コードを残さない）。
- char6端末のうち、実際に流せたのは390/768/1024（char/publish-hub.spec.js）。1440/1920/820は、(a)化撤回によりこのセクションの検証対象から外れた（元から内部呼び出しのままで、これらの端末のCI実行には影響しない）。

### 7-2. `back-nav-matrix.spec.js:889`（A40）も(a)化せず(c)に留める

7-1の撤回により該当なしだが、仮に23件を(a)化していたとしても、A40テスト（「記事の引き出しシート→戻る＝シートだけ閉じる」、幅820）は`openNewArticleEdit(page)`の直後に`_artOpenSheet()`を呼んでおり**ブロックを1つも追加していない**。本の引き出しを開く実クリック導線（`.art-shelf-add`/`.art-book-pick`）はブロック単位のボタンで、ブロックが0件の状態では画面上に存在しない（イシュー#166でFAB撤去済み、article-editor.js:224の注記で確認）。このテストには実クリックで同じ状態に到達する手段が無いため、(c)のまま変更しない。

### 7-3. `_artEditBlock`(a)化（publish-article-editor.spec.js、ブロックA=index 0）— 成功

ブロックの「⋯」ボタン（キャンバスiframe内`.art-cv-more[data-blk-idx]`）→メニューの「編集」（`#art-blk-menu [data-blk-act="edit"]`）の実クリック導線を`editArtBlockViaMenu(page, blockIdx)`として集約し、該当箇所を`editArtBlockViaMenu(page, 0)`に置換した。該当テストを個別実行して成功を確認した（2 passed、§7-5参照）。

### 7-4. `forward-reopen-idempotent.spec.js:102`は(a)化せず元のまま

②指示どおり`addBlock`+(当初の)`openArtSheet`で前提を作る形を試みたが、7-1のとおり`.art-shelf-add`クリックがタイムアウトしたため撤回し、**元の`openByButton: async (p) => { await openNewArticleEdit(p); await p.evaluate(() => window.bookshelf._artOpenSheet()); await settle(p, 600); }`に戻した**（import文の`addBlock`/`openArtSheet`も削除）。(c)のまま変更なし。

### 7-5. `_artOpenPublishPanel`/`_artOpenEditor`

- `_artOpenPublishPanel`：**1件のみ成功、1件は撤回**。overlay-front.spec.jsのフォールバックは`#art-bar-publish`クリックに変更（publish-article-editor.spec.jsの既存ローカル`openPublishPanel`と同じ型、SPでは`#art-publish-header`の代わりに`#art-bar-publish`が出る構成Aに合わせた）— これは成功（52 passed中に含まれる、§7-6参照）。一方、publish-article-editor.spec.js側の「公開直後にパネルを開き直す」箇所で既存ローカル`openPublishPanel(page)`を再利用したところ、**step4のe2e-diff-main.mjs --visualフル実行で新規リグレッション1件を検出**：`publishViaPanel`実行後はパネルが開いたまま（コメント「公開成功後もパネルは開いたまま」）のため`#art-publish-header`がモーダル(`#art-publish-modal`)に覆われてクリックできず60秒タイムアウトした。元の内部呼び出し`window.bookshelf._artOpenPublishPanel()`に戻した（単体再実行で成功を確認）。「最初に開く」と「開いたまま再描画」は別の状態であり、後者はクリックで到達できないと判明した。
- `_artOpenEditor`：step1でPlaywright MCPにより実画面確認済み。`openArtEditor(page, null)`に置換し、個別実行で成功を確認した（2 passed、§7-3と同じ実行）。

### 7-6. 最終結果（(a)由来の純減）

(a)で実際に置換できたのは`_artOpenPublishPanel`(1件)・`_artEditBlock`(1件)・`_artOpenEditor`(1件)の**計3件**。`_artOpenPublishPanel`のもう1件(再オープン箇所)と`_artOpenSheet`/`_artCloseSheet`(23件)は検証で失敗したため全件(c)に留まる。lint実測：150→**147**（純減3件、全て(a)由来）。

検証：forward-reopen-idempotent.spec.js+standard-ops.spec.js(37 passed)、overlay-front/username-publish-gate/publish-conflict-hub/standard-ops/forward-reopen-idempotent(52 passed・3 failed→failした3件は全て`_artOpenSheet`/`_artCloseSheet`の(a)化試行によるもので、撤回後に37 passedで再確認)、publish-article-editor.spec.jsの該当2テスト(2 passed)、char/publish-hub.spec.js(撤回前に4 failed確認、撤回理由の実測根拠)。vitest 852 passed・2 todo。

## 8. step4実装結果（検証一式）

- **MAX更新**：160→**147**（scripts/check-test-internal-refs.mjs、実測値と一致。当初146としたが、`_artOpenPublishPanel`の1件をe2e-diff-main.mjs --visualで検出したリグレッションにより(c)へ戻したため147に再調整した）。
- **lint**：`lint:internal-refs`（147、上限以内）・`lint:e2e-goto`（0件）・`lint:breakpoint`（0件）いずれもOK。
- **vitest**：852 passed・2 todo（既存のtodoで変化なし）。
- **変異検査**：
  - (a)分：`js/screens/article-editor.js`の`on('art-new', 'click', () => this._artOpenEditor(null));`を`() => {}`に差し替え、`openArtEditor(page, null)`を使うテスト（publish-article-editor.spec.js「新規記事(仮id)を保存せずにいる間は...」）が1件失敗することを確認した（`expect(pendingHash).toMatch(/^#\/publish\//)`が`"#/publish"`を受け取り失敗）。元に戻して再確認。
  - (c)分：`js/screens/article-editor.js:3482`の`const stallMs = this._artPreviewStallMs || ART_PREVIEW_STALL_MS;`を`ART_PREVIEW_STALL_MS`固定に差し替え、`setArtPreviewStallMs`を使うテスト（preview-real-adapter.spec.js「(c) fetchが最後まで応答しない場合...」）が1件失敗することを確認した（10秒待っても`#pp-preview-stall`が非表示のまま）。元に戻して再確認。
  - 両方とも元に戻した後、`git diff --stat -- js/`で差分0件を確認した。
- **e2e-diff-main.mjs --visual**：§9参照。

## 9. e2e-diff-main.mjs --visual フル実行結果

1回目（PORT=8153、base=origin/main@42c87e3、work=作業ツリーHEAD同コミット・未コミット差分含む）：E2Eで新しく落ちたテスト1件を検出（`_artOpenPublishPanel`の再オープン箇所、§7-5参照）。3回の再実行(flake判定)でも一貫して失敗＝regression。修正（元の内部呼び出しに戻す）後、2回目をフル実行した。

2回目（同条件）：
- E2E(playwright)：新しく落ちた0件／新しく通った0件／両方で落ちた0件。
- Unit(vitest)：新しく落ちた0件／新しく通った0件／両方で落ちた0件。
- 画像の差分(visual)：**0件/54件**。
- 結果一式：`/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261113-135811-1724674`。

完了条件（新しく落ちたテスト0件・画像差分0件）を満たした。

## 10. 差し戻し対応（2026-11-13・②指摘）：`_artOpenSheet`/`_artCloseSheet`の(a)化撤回を取り消し、原因を特定して再実装

②から、§7-1の撤回は「原因不明のまま撤回し、spec側に生の内部参照23件を戻した」ことが差し戻しの指摘を受けた。②の仮説（イシュー#529・A-c）を実測で確かめた上で修正した。

### 10-1. 原因の確認

`addBlock(page, 'shelf', ...)` のクリック経路自体が、ブロック追加完了時に `_artEditBlock(added.id)` → (type==='shelf'なら) `this._artOpenSheet()` を**内部で自動発火する**（article-editor.js:293-301、イシュー#529・A-c：「本棚ブロックを足したら引き出しを開く(完了まで閉じない)」）。したがって `addBlock(page,'shelf','last')` 呼び出し直後には、900px以下では**既に`#art-drawer`が`is-open`**になっている。この状態で `.art-shelf-add` をクリックしようとすると、開いている引き出しのスクリム(`#art-sheet-scrim`)がキャンバスiframeを覆い、クリックが60秒タイムアウトする——これが前回の失敗の直接原因だった。

前回「成功した」ように見えた`username-publish-gate.spec.js`/`publish-conflict-hub.spec.js`は、呼び出し元のテストがデフォルト(ワイド)viewportで実行されていたため、`sheetOpen = innerWidth<=900`のガードで実クリック自体がスキップされていた（＝narrow経路は実際には検証されていなかった）。`standard-ops.spec.js`の該当テストは`test.describe('スマホ戻る (履歴統合)')`内（390px）、`forward-reopen-idempotent.spec.js`は全体が390px、`char/publish-hub.spec.js`はタッチ3端末（390/768/1024）——いずれもnarrowで実際にクリックを試みて失敗していた。仮説どおりだった。

### 10-2. 修正

`openArtSheet(page)`/`closeArtSheet(page)`を、クリック前に`#art-drawer.is-open`を確認する形に直した：
- `openArtSheet`：既に`is-open`なら何もしない（#529で既に開いている場合）。開いていない場合のみ、900px以下で`.art-shelf-add`をクリックする（900px超は元々シートを開かないため何もしない）。
- `closeArtSheet`：`is-open`の時だけ`#art-sheet-close`をクリックする（`_artCloseSheet()`自身の「開いていなければno-op」と同じ挙動）。

23件全てにこの修正版を適用した（旧実装への巻き戻しは無し）。

### 10-3. spec側の生の内部参照を0件にする（(c)の原則どおりヘルパーへ集約）

②指摘のとおり、実クリックで到達できない/すべきでない3箇所も、生の`window.bookshelf._xxx`呼び出しのままspecに残さず、専用の(c)ヘルパーへ集約した：
- `openArtSheetInternal(page)`/`closeArtSheetInternal(page)`：back-nav-matrix.spec.js A40（幅820・ブロック0件）専用。ブロック単位のボタンがDOMに存在しないため実クリック導線が無い。
- `openArtPublishPanelReopen(page)`：publish-article-editor.spec.jsの「公開直後にパネルを開き直す」箇所専用。パネルが既に開いた状態では`#art-publish-header`がモーダルに覆われクリック不能。
- `createArticlesAndRenderList(page, articles)`：publish-article-editor.spec.jsの3記事作成+即時再描画箇所専用。元のevaluate内で`store.create()`×3と`_artRenderList()`が連結していたため、ヘルパー内でも1回のevaluateのまま保持した（分割していない）。

これにより`git grep -n "window\.bookshelf\._artOpenSheet\|_artCloseSheet\|_artOpenPublishPanel()\|_artRenderList()" tests/e2e tests/visual`のヒットは全てヘルパー内（`tests/e2e/helpers/art-editor.js`）のみになり、spec側は0件になった。

### 10-4. 再検証結果

- lint実測：160→**128**（純減32件。前回の13件から大幅に増加）。MAX更新済み。
- lint(internal-refs 128・e2e-goto 0件)・vitest(852 passed)いずれもOK。
- `char/publish-hub.spec.js`を全char projectsで実行：**6 passed・30 skipped・0 failed**（タッチ3端末390/768/1024が対象、他3端末はtest.skip）。
- 影響した他7ファイル（forward-reopen-idempotent/standard-ops/username-publish-gate/publish-conflict-hub/publish-article-editor/back-nav-matrix/overlay-front）をchromiumで実行：**290 passed・0 failed**。
- `e2e-diff-main.mjs --visual`フル実行：§11参照。

## 11. e2e-diff-main.mjs --visual フル実行結果（差し戻し対応後・3回目）

PORT=8153・PLAYWRIGHT_BASE_URL=http://localhost:8153（base=origin/main@42c87e3、work=作業ツリーHEAD ae66e1c・未コミット差分含む）：

- E2E(playwright)：新しく落ちた0件／新しく通った0件／両方で落ちた0件。
- Unit(vitest)：新しく落ちた0件／新しく通った0件／両方で落ちた0件。
- 画像の差分(visual)：**0件/54件**。
- 結果一式：`/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261113-141525-1874179`。

完了条件（新しく落ちたテスト0件・画像差分0件）を満たした。
