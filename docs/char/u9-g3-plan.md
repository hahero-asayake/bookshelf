# U9 G3-1（article-editor・art*系・前半）置き換え計画（イシュー#551 step1）

## 0. 分割案の確定（名前単位／②指示の狭い組み合わせを採用）

`docs/char/u9-classification.md` §3 の提案（G3-1=`_artFlushSave`/`_artFlushRemoteNow`/`_artDraft`/`_artTextFsEditor`/`_artEditingId`＝148件）は**名前単位**。依頼文の「テストファイル単位で差分500行以内」とは切り方の軸が異なり、分類表の件数（148）も lint の実測（152、後述）とずれていたため、あいまいと判断し実測した。

②承認note（2026-11-13 11:17:55）の指示に従い、**5名のうち `_artDraft`・`_artTextFsEditor` を外し、`_artFlushSave`／`_artFlushRemoteNow`／`_artEditingId` の3名だけを本イシュー（G3-1）の対象にする**。理由は §1 の実測差分見積りで、5名フルセットだと複雑度の高い `_artDraft`（オブジェクトの多様なフィールド読み書き）が重く、500行に対して安全マージンが乏しくなるため。3名案なら軽い（§2）。

- 本イシュー（G3-1）対象：`_artFlushSave`(39)・`_artFlushRemoteNow`(34)・`_artEditingId`(14)＝**87件**
- 次イシュー行き（名称は②が別途決める。暫定呼称G3-1b）：`_artDraft`(32+app._4=36)・`_artTextFsEditor`(29)＝**65件**
- 既存分類表のG3-2（シート/プレビュー/公開操作系・`_artOpenSheet`以下）：**約57件**（lint実測、分類表記載の55とは近似差）
- 合計：87+65+57=209（lint実測の`_art*`合計。分類表記載203とは`app._`経由7件の数え落とし分だけ差がある＝G2と同じ既知パターン）

## 1. 件数の実測根拠

`node scripts/check-test-internal-refs.mjs`（lint本体・298が現在のMAX）の対象範囲（`tests/e2e/`+`tests/visual/`）で
`grep -rnoE "\b(bookshelf|app)\._art[A-Za-z]+\b" tests/e2e tests/visual` を実測：

| 名前 | bookshelf._ | app._ | 合計 |
|---|---:|---:|---:|
| `_artFlushSave` | 39 | 0 | 39 |
| `_artFlushRemoteNow` | 34 | 0 | 34 |
| `_artEditingId` | 14 | 0 | 14 |
| **3名計（本イシュー対象）** | **87** | **0** | **87** |
| `_artDraft` | 32 | 4 | 36 |
| `_artTextFsEditor` | 29 | 0 | 29 |
| 以降（G3-2系16名） | 計50 | 計7 | 57 |
| `_art*` 全体合計 | 202 | 7 | **209** |

lint全体の実測内訳（298件）：`bookshelf._` 286・`app._` 12。`_art*`以外（G1/G2既済の残存・G4対象等）が298-209=89件。

## 2. 3名の中身と(a)/(c)判断

### `_artFlushSave`・`_artFlushRemoteNow`（73件・両方(c)固定＝依頼の「守ること」より）

決定性のため実クリックや非同期遷移に置き換えず、既存の `window.bookshelf._artFlushSave()`/`_artFlushRemoteNow()` 呼び出しをそのまま(c)ヘルパーへ移すだけ（#536の教訓どおり）。

使用形は2パターンのみ（article-editor.js:263の実装自体も同じ連結形）：

1. 結合呼び出し `window.bookshelf._artFlushSave().then(() => window.bookshelf._artFlushRemoteNow())` が **32行**（publish-conflict-hub.spec.js:173／publish-article-editor.spec.js 31行）。
2. 単独呼び出し：`_artFlushSave()`のみが **7行**（publish-panel.spec.js:199、char/publish-hub.spec.js:212、standard-ops.spec.js:177,469、publish-article-editor.spec.js:331,1483,2933）、`_artFlushRemoteNow()`のみが **2行**（publish-article-editor.spec.js:338,1484）。

→ ヘルパー3関数（`flushArtSave`/`flushArtRemoteNow`/`flushArtSaveAndRemote`、後者は前2つを順に呼ぶだけで自前のevaluateを持たない）で41行の呼び出し箇所を置換。

### `_artEditingId`（14件・(c)固定＝DOM等価なし）

全て「現在編集中の記事id」を読むだけの単純な読み取り（`page.evaluate(() => window.bookshelf._artEditingId)`、1件のみ`publishArticleStore.get(...)`と combined）。DOM側に記事idを1:1で反映する属性は無い（`js/screens/article-editor.js`をgrepしたが`data-article-id`等は存在しない。`data-art-idx`はブロックの配列indexで別物）。(a)化の対象外、G1/G2と同じ理由（自己完結・DOM等価なし）で(c)ヘルパー`getArtEditingId(page)`1関数に集約。

14行：publish-conflict-hub.spec.js:175／username-publish-gate.spec.js:154,275／publish-article-editor.spec.js:333,340,898,961,1001,1037,1191,1285,1355,1385,2503。

## 3. 落とし穴チェック（#548/#550の4点、着手前確認済み）

1. **非同期awaitのデッドロック**：対象外。(a)化（実クリック＋確認待ち）を一切行わず、既存の`await page.evaluate(...)`形をそのままヘルパー内に移すだけなので、G1で起きた「Promiseをawaitすると後続のユーザー操作待ちと相互デッドロック」は発生しない。
2. **非表示対象への直接遷移テスト**：該当なし。3名とも状態読み取り/保存確定であり、UI要素への遷移を伴わない。
3. **fixtureへの依存**：該当なし。(a)化しない＝実クリック対象のUI要素・fixtureデータの有無を問わない。
4. **scrollIntoViewとfocus**：該当なし。
5. **分類表でapp._を数え落とすパターン**：3名とも`app._`経由は実測0件（§1表）。取り逃しなし。

→ この3名の範囲は(a)化を伴わないため、G1/G2で実際に踏んだ落とし穴（いずれも(a)化固有のリスク）の対象外。低リスクな置換のみ。

## 4. 見込み差分行数

既存ヘルパーファイル`tests/e2e/helpers/art-editor.js`（既存48行・addBlock/canvas）を拡張する。対象6ファイルのうち5ファイルは既に`from './helpers/art-editor.js'`（または`../helpers/`）をimport済み（import行の追記のみ、新規import行は`standard-ops.spec.js`の1件だけ）。

| 内容 | 見込み行数 |
|---|---:|
| 呼び出し箇所の置換（87件中、物理行は55行＝flush41行+editingId14行、各1削除+1追加） | 約110 |
| 新規ヘルパー4関数（flushArtSave/flushArtRemoteNow/flushArtSaveAndRemote/getArtEditingId） | 約20 |
| import行の追記・新設（6ファイル） | 約10 |
| **合計見込み** | **約140〜170行** |

500行の目安に対して十分な余裕（G1実測226行／G2実測128行(テストファイルのみ、ヘルパー新設込み)という前例と比べても、本範囲は呼び出し形が高度に均一なため1件あたりのコストがG1/G2より低い）。

## 5. 見込みMAX

置換後、87件の生参照はヘルパー内の実装3〜4箇所（`flushArtSave`内1・`flushArtRemoteNow`内1・`getArtEditingId`内1。`flushArtSaveAndRemote`は前2つを呼ぶだけで自前のevaluateを持たない設計のため生参照0）に集約される見込み。
純減 ≈ 87 - 3 = 84（内訳：(a)由来0件・(c)由来84件）。
MAX見込み：298 → **約214**（lintの実測値で確定、step2で定数を書き換える）。

## 5-1. 変異検査（step3実測）

1回目：`_artFlushSave`内`this._artEditingId = created.id;`（article-editor.js:2895、新規記事の初回保存でストアの発行idを編集中idへ確定させる行）をコメントアウトして`publish-article-editor.spec.js`をフル実行 → **0件も落ちなかった**。原因：`_artEditingId`はこの行より前（記事を開く時点、`_artPendingId`の仮id発行）で既に設定されており、`create()`に`id: this._artPendingId`を渡しているため`created.id`と既存の`_artEditingId`が同値になる経路がほとんどで、この行の無効化が無害化されていた。1回目は不採用と判断し元に戻した（diffなしを確認）。

2回目：`_artFlushSave`内`this._artSaveDraftToLocalStorage();`（article-editor.js:2901、メモリ反映直後にlocalStorageへ下書きを同期する行）をコメントアウトして`publish-article-editor.spec.js`をフル実行(109件) → **1件失敗**(`記事下書きのlocalStorageバックアップと復元(イシュー#142) > 編集中は入力のたびlocalStorageに下書きが同期保存され、リモート保存完了後は消える`、325行目。`flushArtSave`/`getArtEditingId`を使う置換後のテスト)。エラーは`TypeError: Cannot read properties of null (reading 'draft')`＝`localStorage.getItem(...)`がnullを返しJSON.parseが失敗。置き換えたテストが「保存確定でlocalStorageに下書きが書かれる」という元の挙動を正しく検知できていることを確認。`git diff`で元に戻し、同テストが再度1件通ることを確認した(664ms)。

## 5-2. e2e-diff-main.mjs --visual フル実行（step4実測）

`PORT=8151 PLAYWRIGHT_BASE_URL=http://localhost:8151 node scripts/verify/e2e-diff-main.mjs --visual` をフル実行（約7分、base=origin/main@0f82658、work=作業ツリーHEAD f8314182・未コミット差分含む）。

- E2E(playwright)：新しく落ちた0件／新しく通った0件／両方で落ちた0件。判定不能0件。
- Unit(vitest)：新しく落ちた0件／新しく通った0件／両方で落ちた0件。
- 画像の差分(visual)：0件/54件。
- 結果一式：`/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261113-114148-1253330`（生成2026-11-13T02:48:45Z）。

完了条件（新しく落ちたテスト0件・画像差分0件）を満たした。再実行・flake判定は不要だった。

## 6. 次イシュー（暫定G3-1b）への申し送り

`_artDraft`(36件)・`_artTextFsEditor`(29件)は本イシューの対象外。`_artDraft`はオブジェクトの多様なフィールド読み書き（`.blocks`配列操作・`.theme`・`.adTag`・`.sourceShelfId`等、直接代入によるテスト用セットアップも含む）で、1〜2種の汎用ヘルパーに収まらず複数の専用ヘルパーが必要になる見込み（複雑度が高い）。`_artTextFsEditor`は`waitForFunction(!!...)`＋`.value()`の2パターンがほぼ全件（29件中27件）で比較的均一・低コストだが、`_artDraft`と同じ名前単位の提案に含まれていたため今回は一緒に見送った。次イシューの着手時はこの2名の実測（本ドキュメント§1の表）から始められる。
