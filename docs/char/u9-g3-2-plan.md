# U9 G3-2（article-editor・art*系・_artDraft/_artTextFsEditor中心）置き換え計画（イシュー#552 step1）

## 0. 対象範囲の確定

依頼文の対象は`_artDraft`(36件)・`_artTextFsEditor`(29件)＝65件。lintで実測すると、この2名と**同一のevaluate呼び出し内に同居している**`_artRenderBlocks`(2件・app._経由)・`_artBuildPreviewState`(1件・app._経由)の計3件が追加で見つかった（分類表`docs/char/u9-classification.md`§1に記載が無い名前＝G2で既知のパターン「分類表の件数は数え落とす」の再発・後述§1）。この3件は`_artDraft`と同じ行・同じ`page.evaluate`ブロック内にあるため、分離すると却って呼び出し構造が崩れる。本イシューの対象に含める。

- 本イシュー（G3-2）対象：`_artDraft`(36)・`_artTextFsEditor`(29)・`_artRenderBlocks`(2)・`_artBuildPreviewState`(1)＝**68件**
- 残り（G3-3行き）：`_artOpenSheet`(13)・`_artCloseSheet`(10)・`_artPreview`(6)・`_artPreviewStallMs`(5)・`_artRenderList`(3)・`_artPublishCalled`(3)・`_artUnpublish`(2)・`_artPublish`(2)・`_artOpenPublishPanel`(2)・`_artEditBlock`(2)・`_artDelete`(2)・`_artShowList`(1)・`_artRenderPublishPanel`(1)・`_artPreviewHardDeadlineMs`(1)・`_artOpenEditor`(1)＝**54件**
- 合計：68+54=122（依頼文の「残り122件」と一致。G3-1(87件)+本イシュー(68件)+G3-3(54件)=209=`_art*`全体のlint実測合計）

## 1. 件数の実測根拠

`/home/sei/.nvm/versions/node/v24.18.0/bin/node scripts/check-test-internal-refs.mjs`（lint本体・現在値216=MAX、ちょうど上限値）の対象範囲（`tests/e2e/`+`tests/visual/`）で
`grep -rnoE "\b(bookshelf|app)\._art[A-Za-z]+" tests/e2e tests/visual` を実測（②承認note指示どおり、helpers内と非helpers側を分けて集計）：

| 名前 | 件数(合計) | うち`tests/e2e/helpers/`内 | うちspec側 |
|---|---:|---:|---:|
| `_artDraft` | 36 | 2（既存`addBlock`内） | 34 |
| `_artTextFsEditor` | 29 | 1（既存`addBlock`内） | 28 |
| `_artRenderBlocks` | 2 | 0 | 2 |
| `_artBuildPreviewState` | 1 | 0 | 1 |
| **本イシュー対象計** | **68** | **3** | **65** |
| `_artFlushSave`（G3-1済・残存） | 2 | 2 | 0 |
| `_artFlushRemoteNow`（G3-1済・残存） | 2 | 2 | 0 |
| `_artEditingId`（G3-1済・残存） | 1 | 1 | 0 |
| G3-3行き16名 | 54 | 0 | 54 |
| `_art*` 全体合計 | 127 | 8 | 119 |

lint全体の実測内訳（216件）：`bookshelf._` 204・`app._` 12。`_art*`以外（G1/G2既済の残存・G4対象等）が216-127=89件（#551時点の記録と同値＝変化なし）。

helpers内8件のうち、G3-1で作ったヘルパー自身の実装(`flushArtSave`/`flushArtRemoteNow`/`flushArtSaveAndRemote`/`getArtEditingId`)に残る5件は**今回は触らない**（すでに(c)集約の最終形）。残り3件（`addBlock`内の`_artDraft`2・`_artTextFsEditor`1、#372由来の既存ヘルパー）は今回の対象に含める。

## 2. 分類表に無かった2名の確認（§0の訂正点）

`_artRenderBlocks`・`_artBuildPreviewState`は`docs/char/u9-classification.md`§1の50種類に記載が無い。実体を確認した：

- `_artRenderBlocks`（article-editor.js:1649で定義）：ブロック配列の変更を即時キャンバスへ反映する内部再描画メソッド。`article-pc-pane.spec.js:195,280`で`app._artDraft.blocks = [...]; app._artRenderBlocks();`という形（直接代入の直後に同じevaluate内で呼ぶ）で使われている。クリック等価は無い（代入後の即時反映トリガそのもの）。
- `_artBuildPreviewState`（article-editor.js:3409で定義）：公開プレビュー生成用の内部状態オブジェクトを組み立てる。`article-pc-pane.spec.js:106`で`app._artDraft`の読み取りと同じevaluate内で`publishArticleGenerator.build([a], { state: app._artBuildPreviewState() })`として使われる。状態オブジェクトの構築はUI操作では代替できない。

両名とも`bs.`別名（lint対象外）での使用はなし。見落としていた理由：u9-classification.mdの355件棚卸し（イシュー#548）は`bookshelf._`パターンの出現のみを基準にしており、この2名は該当spec内で常に`app._`形（`const app = window.bookshelf;`のローカル別名）でしか使われていないため、当初の棚卸しでは見えなかった（G2で判明した「app._経由の数え落とし」と同系統・#550落とし穴1）。

## 3. `_artDraft`・`_artTextFsEditor`の区分と(a)/(c)判断

②承認note（2026-11-13 12:05:56）の指示により、`_artDraft`の「テスト前の状態設定（直接代入）」は(c)を既定にする。加えて、全65行(spec側)+3行(helpers側)を目視し、以下の3区分＋付随2名で整理した。**65+3件すべて(c)**（DOM等価が無い、またはあっても既存コードが意図的に内部状態読み取りを選んでいる）。

### (i) 下書き中身の検証・フィールド読み取り（`_artDraft`のうち約20件）

`theme.layout/.color`（publish-article-editor.spec.js:719）・`adTag`（publish-panel.spec.js:131）・`sourceShelfId`代入+`shelfId`読み取り（publish-article-editor.spec.js:2511,2513）・`blocks[].markdown/type/show/asin/items.length`（多数）・ドラフト全体のJSON内容チェック（back-nav-matrix.spec.js:934の`draftHas`）・ドラフト全体のspread（article-pc-pane.spec.js:105、公開プレビューHTML生成用）。

**DOM等価の確認結果**：`js/screens/article-editor.js`のキャンバス描画（716〜960行）を確認した。編集中に注入される`.art-cv-ui`系オーバーレイ（`.art-cv-grip`/`.art-cv-more`等）には`data-blk-idx`（配列index）は付くが、ブロック本体(`.blk`要素)には`data-block-type`等の**型やmarkdown内容を示す属性が無い**（アイコンは`CHIP_ICON[b.type]`でSVGを描き分けるのみ＝DOMからtypeを一意に逆引きできない）。さらに`.art-cv-ui`は非編集時に全除去される（article-editor.js:811）ため、保存後・閲覧モードでの検証には使えない。既存の`addBlock()`ヘルパー自身（#372・U9以前からの実装）も、ブロック数をDOMではなく`_artDraft.blocks.length`で数えている（art-editor.js:41,52）＝この内部状態読みは本プロジェクトで以前から意図的に選ばれた手段。よって(a)化の対象外、(c)固定。

### (ii) ブロック配列の読み取り（長さ・map・find、`_artDraft`のうち約10件）

`blocks.length`（standard-ops.spec.js等）・`blocks.map(b => b.type).join(',')`（publish-article-editor.spec.js:2833,2983）・`blocks.find(...)`（2513）・`order()`関数（article-pc-pane.spec.js:199、並べ替え後の順序検証）。理由は(i)と同じ（DOM側に型・順序を1:1で表す属性が無い）。(c)固定。

### (iii) テスト前の状態設定・直接代入（`_artDraft`のうち約6件）

`blocks = [...]`の直接代入（article-pc-pane.spec.js:194,279、char/article.spec.js:131、preview-real-adapter.spec.js:218）・`sourceShelfId`代入（publish-article-editor.spec.js:2511）。②指示により(a)化しない＝(c)固定。直接代入の直後に`_artRenderBlocks()`を同じevaluate内で呼ぶ2件（article-pc-pane.spec.js:194,279）は、代入と再描画を1回のevaluateにまとめたまま1つのヘルパーに封じる（分割しない＝G1のawait形保持の原則どおり）。

### `_artTextFsEditor`（29件・全て(c)固定）

全画面MDEエディタのインスタンス参照。使用形は3パターンのみ（#551の`_artFlushSave`と同様に高度に均一）：

1. `page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 })`（エディタ起動待ち）＝**12件**
2. `window.bookshelf._artTextFsEditor.value(md)`（本文を直接セット）＝**15件**
3. `window.bookshelf._artTextFsEditor.toolbarElements.bold.innerHTML`（ツールバーHTML読み取り、mde-toolbar-icons.spec.js:154のみ）＝**1件**
4. helpers/art-editor.js内`addBlock()`の`waitForFunction`1件

DOM等価なし（意図的なテスト注入点＝ブラウザ側のEasyMDEインスタンスへ直接文字列を入れることで、実入力の遅さを回避する既存の設計。article-pc-pane.spec.js等のコメントにも明記）。(c)固定。

## 4. ヘルパー設計（`tests/e2e/helpers/art-editor.js`へ追記）

既存の`flushArtSave`等4関数に加えて、以下を追加する（カッコ内は置換される参照数）：

| ヘルパー | 内容 | 置換対象 |
|---|---|---:|
| `getArtDraft(page)` | `_artDraft`全体を返す | (i)の一部（theme/adTag/draftHas/existence確認） |
| `waitForArtDraft(page)` | `expect.poll(() => !!_artDraft).toBe(true)` | preview-real-adapter.spec.js:213 |
| `getArtBlocks(page)` | `_artDraft.blocks \|\| []`を返す | (i)(ii)のblocks参照の大半（配列を返すだけで、後続のmap/find/lengthはテスト側のJSのまま＝期待値・アサーションは変えない） |
| `setArtBlocks(page, blocks)` | `_artDraft.blocks = blocks; _artRenderBlocks();`を1回のevaluateで実行 | (iii)の4件（代入+即時再描画セット） |
| `setArtDraftField(page, key, value)` | `_artDraft[key] = value`を1回のevaluateで実行 | sourceShelfId代入1件 |
| `waitForArtTextFsEditor(page)` | `page.waitForFunction(...)` | 12件(+addBlock内1件) |
| `setArtTextFsEditorValue(page, markdown)` | `_artTextFsEditor.value(md)` | 15件 |
| `getArtTextFsEditorBoldToolbarHtml(page)` | ツールバーHTML読み取り | 1件 |
| `buildArtPublicPreviewHtml(page)` | article-pc-pane.spec.js:94-109のブロック（`_artDraft`spread×2+`_artBuildPreviewState`×1+`publishArticleGenerator.build`+結果HTML抽出）をそのまま1つの関数に封じる | 3件を1関数に集約 |

`publish-article-editor.spec.js:2019`（`_artEditBlock(_artDraft.blocks[0].id)`）は`_artEditBlock`自体がG3-3対象（本イシュー対象外）のため、`_artDraft.blocks[0].id`の部分だけ`(await getArtBlocks(page))[0].id`に差し替え、`_artEditBlock`呼び出しは現状の生参照のまま残す（G1教訓#3の「先に値を取得し第2引数で渡す」形は既にこの行が該当。2回のevaluateに分かれるが`_artEditBlock`は非同期チェーンを返さない同期的クリック相当のため、G1のデッドロックパターンには当たらない）。

back-nav-matrix.spec.js:934の`draftHas`は`publishArticleStore`（`_art*`以外・355件の対象外）と`_artDraft`の両方をOR検索しているため、`_artDraft`部分だけ`getArtDraft(page)`に差し替え、`publishArticleStore`部分は現状のまま残す。

**await形の保持**：対象65+3件はすべて元から`await page.evaluate(...)`または`await page.waitForFunction(...)`の単発round-tripで、`.then()`連結や後続のユーザー操作待ちと競合する構造は無い（G1のデッドロック例に該当する箇所なし）。ヘルパー化後も同じ単発awaitの形を保つ。

## 5. 見込み差分行数とMAX

| 内容 | 見込み行数 |
|---|---:|
| 呼び出し箇所の置換（spec側65行、各1〜2行の書き換え＋import追記） | 約110〜150 |
| 新規ヘルパー9関数（うち1関数は15行程度のブロック移植、他は3〜6行） | 約60〜80 |
| `addBlock()`内3件の置換（既存ヘルパー自身） | 約10 |
| u9-classification.md・本ドキュメントの更新 | 約30 |
| **合計見込み** | **約210〜270行** |

500行の目安に対して十分な余裕がある（G3-1実測は140〜170行見込みで87件、本イシューは68件だが1件あたりの複雑度が高いため単価を2〜3倍に見て見積もった）。

純減見込み：68件の生参照はヘルパー内の実装9箇所程度に集約される見込み。純減 ≈ 68 - 9 = **59**（全て(c)由来、(a)由来0件）。
MAX見込み：216 → **約157**（lintの実測値で確定、step2で定数を書き換える）。

## 6. 落とし穴チェック（#548/#550/#551、着手前確認済み）

1. **非同期awaitのデッドロック**：対象外。§4で確認したとおり、全件が単発round-tripで、`.then()`連結や後続のクリック待ちと競合しない。
2. **非表示対象への直接遷移テスト**：該当なし。全件が内部状態の読み取り/設定であり、UI要素への遷移を伴わない。
3. **fixtureへの依存**：該当なし。(a)化しないため、実クリック対象のUI要素・fixtureデータの有無を問わない。
4. **scrollIntoViewとfocus**：該当なし。
5. **分類表でapp._を数え落とすパターン**：本ドキュメント§2で2名（`_artRenderBlocks`・`_artBuildPreviewState`）を新たに発見・対象に追加済み。
6. **G3-1の教訓（1回のevaluate内連結を保つ・裸の内部参照を先に値取得してから渡す）**：§4の`setArtBlocks`（代入+再描画を1回のevaluateで保持）、`publish-article-editor.spec.js:2019`（先にブロックidを取得してから`_artEditBlock`へ渡す既存idiomを維持）で適用済み。

## 7. 変異検査・e2e-diff-main.mjs --visual・G3-3への申し送り

step3/step4で実施・記録する（本ドキュメントに追記）。
