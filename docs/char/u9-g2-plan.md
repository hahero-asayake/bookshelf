# U9 G2（book-detail）置き換え計画（イシュー#550 step1）

## 0. 件数の確定（21→23）

`docs/char/u9-classification.md` §2/§3 の G2 行は21件・5ファイルだが、lint（`scripts/check-test-internal-refs.mjs`、`bookshelf._`と`app._`を合算）で実測すると **23件・5ファイル**。

差の理由：分類表は元々 `grep -ron "bookshelf\._<name>\b"` で数えており、`app._`経由（mde-toolbar-icons.spec.js の2件）を含めていなかった。lintは§0の決定（②決裁2026-11-13）で`app._`も合算する仕様のため、実際に減らすべき値は23。

②承認（2026-11-13 10:35）：実測23件を正とし、`u9-classification.md` のG2行は23件に直す（docs更新はstep2の実装commitで行う＝G1 c886ec7と同じ、分類表更新と置き換えを同じcommitにまとめる）。

## 1. 23件の一覧と分類

| # | ファイル:行 | 元の参照 | 文脈 | 分類 | 置き換え先 |
|---|---|---|---|---|---|
| 1 | back-nav-matrix.spec.js:497 | `bookshelf._bookMemoEditor \|\| bookshelf.bookMemoEditor` | L04: 変更ありメモの内容を直接セット | (c) | `setBookMemoValue(page, text)` |
| 2 | back-nav-matrix.spec.js:531 | 同上 | L10: 確認表示前に内容をセット | (c) | `setBookMemoValue(page, text)` |
| 3 | back-nav-matrix.spec.js:1146 | `bookshelf._bookMemoEditor`（存在待ち） | openMemo2内のwaitForFunction | (c) | `waitForBookMemoEditor(page, opts)` |
| 4 | back-nav-matrix.spec.js:1149 | `bookshelf._bookMemoEditor.value(x)`（setMemoローカル定義） | L01/L06等が呼ぶ共有setMemoの定義 | (c) | `setBookMemoValue(page, t)` に委譲 |
| 5 | back-nav-matrix.spec.js:1520 | `bookshelf._lastDetailEditMode` | R08i: hash未確定から開いた直後、編集モードが静かに戻らないことの確認 | **(a)** | DOM: `!!document.querySelector('.bd.editing')`（book-detail.js:318、isEditModeで付くクラス。既存の`.bd-grip`カウント確認と同じ評価ブロック内） |
| 6 | checklist-timing.spec.js:191 | `bookshelf._bookMemoEditor \|\| bookshelf.bookMemoEditor` | CHK3: 戻る前に1文字セット | (c) | `setBookMemoValue(page, text)` |
| 7 | checklist-timing.spec.js:197 | 同上（読み取り） | CHK3: 再度開いて永続化確認 | (c) | `getBookMemoValue(page)` |
| 8 | mde-toolbar-icons.spec.js:46 | `app._openBookMemoInAppEditor(a, book)` | 共有openMemo(asin)の定義 | (c) | `openBookMemoInAppEditor(page, asin)` |
| 9 | mde-toolbar-icons.spec.js:152 | `bookshelf._bookMemoEditor.toolbarElements.bold.innerHTML` | ツールバーHTML比較（文章ブロック側と同一か） | (c) | `getBookMemoBoldToolbarHtml(page)` |
| 10 | mde-toolbar-icons.spec.js:170 | `bookshelf._bookMemoEditor.value('本文行')` | 見出し変換前のセット | (c) | `setBookMemoValue(page, text)` |
| 11 | mde-toolbar-icons.spec.js:183 | `bookshelf._bookMemoEditor.value()` | 見出し変換後の読み取り | (c) | `getBookMemoValue(page)` |
| 12 | mde-toolbar-icons.spec.js:193 | `bookshelf._bookMemoEditor.value('## 本文行')` | トグル確認用セット | (c) | `setBookMemoValue(page, text)` |
| 13 | mde-toolbar-icons.spec.js:197 | `bookshelf._bookMemoEditor.value()` | トグル後の読み取り | (c) | `getBookMemoValue(page)` |
| 14 | mde-toolbar-icons.spec.js:231 | `app._openBookMemoInAppEditor('B000000001', { title })` | 長いタイトルのタイトル省略確認用に合成bookで開く | (c) | `openBookMemoInAppEditor(page, asin, book)` |
| 15 | publish-article-editor.spec.js:2333 | `bookshelf._openBookMemoInAppEditor(b.asin, b)` | 長文メモ読込失敗テスト | (c) | `openBookMemoInAppEditor(page)` |
| 16 | publish-article-editor.spec.js:2339 | `!!bookshelf._bookMemoEditor` | 読込失敗時にエディタが作られないことの確認 | (c) | `hasBookMemoEditor(page)` |
| 17 | publish-article-editor.spec.js:2340 | `bookshelf._bookMemoEditorContext` | 読込失敗時に保存導線が張られないことの確認 | (c) | `getBookMemoEditorContext(page)` |
| 18 | standard-ops.spec.js:533 | `bookshelf._openBookMemoInAppEditor(b.asin, b)` | 共有openMemo()の定義 | (c) | `openBookMemoInAppEditor(page)` |
| 19 | standard-ops.spec.js:535 | `bookshelf._bookMemoEditor`（存在待ち） | 共有waitEditor()の定義 | (c) | `waitForBookMemoEditor(page)` |
| 20 | standard-ops.spec.js:536 | `bookshelf._bookMemoEditor.value()` | 共有memoValue()の定義 | (c) | `getBookMemoValue(page)` |
| 21 | standard-ops.spec.js:548 | `bookshelf._bookMemoEditor.value('戻るテスト本文')` | 戻る確認なしケースのセット | (c) | `setBookMemoValue(page, text)` |
| 22 | standard-ops.spec.js:558 | `bookshelf._bookMemoEditor.value('Escテスト本文')` | Esc確認なしケースのセット | (c) | `setBookMemoValue(page, text)` |
| 23 | standard-ops.spec.js:567 | `bookshelf._bookMemoEditor.value('キャンセルテスト本文')` | キャンセル確認ありケースのセット | (c) | `setBookMemoValue(page, text)` |

集計：(a) 1件（#5）／(c) 22件。

## 2. (a)/(c) の判断根拠

### `_lastDetailEditMode`（#5）→ (a)

②指示（2026-11-13承認note）：「戻ったあとに編集モードが戻ること」がDOMでも確かめられるなら(a)を優先。book-detail.js:318 `<div class="bd${isEditMode ? ' editing' : ''}">` がisEditModeと1:1で付く見た目のクラス（grips(`.bd-grip`)は編集モードの一部UIにすぎず、より直接的な指標はこちらの`.bd.editing`）。同じ`page.evaluate`ブロック内の`grips`チェックと並べて置き換えても期待値・アサーション文は無変更（`expect.soft(after.isEditMode, ...).toBe(true)`はそのまま）。

### `_openBookMemoInAppEditor`（4件：#8,#14,#15,#18）→ 分類表の(a)を(c)に変更（要確認・下記で判断）

u9-classification.md §1 の元の分類は(a)（「book-detail.js:553。メモ編集ボタンクリックで到達する経路」）。実装を確認した結果、(a)化は不採用とし(c)に残すべきと判断した：

- 実クリック経路は `.memo-file-btn`（book-detail.js:237,407-410）で、これは本の詳細ペイン（`#book-detail-pane`）が開いている時だけDOMに存在する。
- 本の詳細を開く`showBookDetail()`は`document.body.classList.add('book-detail-pinned')`・`this.nav.openBook(...)`（nav履歴へ段を積む）という副作用を持つ（book-detail.js:130-146）。
- 4件の呼び出し元のうち3ファイル（back-nav-matrix/checklist-timing/standard-ops）は、まさに「戻る/進むの段数・履歴」を検証するテスト（`expectSameHistory`・`page.goBack()`後のURL確認等）。本の詳細を開く前段を追加すると、その段そのものが比較対象の履歴に混入し、テストの前提（「長文メモモーダルだけを単独で開いた状態」）を壊す。
- 既存のE2Eスイート全体を見ても、`.memo-file-btn`を実クリックして長文メモを開く経路は1件も存在しない（全呼び出し元が`_openBookMemoInAppEditor`直呼び）。新規に実クリック化すると前例のない変更になり、4ファイルすべてに影響するリスクが高い。
- G1でも同種の判断（`_confirmOpenSettings`：当初(a)想定が実装時に(c)へ変更、`_openPluginSettings`：fixtureに対応ボタンが出ない3件は(c)に残した）があり、同じ理由付け（対照性・fixture依存・副作用の混入回避）で(c)に残すのは妥当（u9-classification.md該当行のコメント参照）。

この再分類は u9-classification.md §1 の該当行にも反映する（step2のcommitで、c886ec7の`_confirmOpenSettings`と同じ注記スタイルで「(a)※」として理由を書く）。

## 3. 集約ヘルパー（新設: tests/e2e/helpers/book-memo.js）

G1の`tests/e2e/helpers/settings.js`と同じ形。全関数(c)。

```js
export async function openBookMemoInAppEditor(page, asin, book) {
    await page.evaluate(({ asin, book }) => {
        const target = book || window.bookshelf.books.find((b) => b.asin === asin) || window.bookshelf.books[0];
        const useAsin = asin || target.asin;
        return window.bookshelf._openBookMemoInAppEditor(useAsin, target);
    }, { asin, book });
}
export async function setBookMemoValue(page, text) {
    await page.evaluate((t) => {
        const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor;
        if (ed) ed.value(t);
    }, text);
}
export async function getBookMemoValue(page) {
    return page.evaluate(() => {
        const ed = window.bookshelf._bookMemoEditor;
        return ed ? ed.value() : null;
    });
}
export async function hasBookMemoEditor(page) {
    return page.evaluate(() => !!window.bookshelf._bookMemoEditor);
}
export async function waitForBookMemoEditor(page, opts) {
    await page.waitForFunction(() => !!window.bookshelf._bookMemoEditor, null, opts);
}
export async function getBookMemoEditorContext(page) {
    return page.evaluate(() => window.bookshelf._bookMemoEditorContext);
}
export async function getBookMemoBoldToolbarHtml(page) {
    return page.evaluate(() => window.bookshelf._bookMemoEditor.toolbarElements.bold.innerHTML);
}
```

`setBookMemoValue`は元の`window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor`というフォールバック式をそのまま保持する（`bookMemoEditor`無underscore版はjs/に実装が無く常にundefined＝死んだ分岐だが、挙動を変えないためそのまま移植する）。

`openBookMemoInAppEditor`は呼び出し元ごとに異なる4パターン（asin指定+bookはbooks配列から検索／asin+book両方明示／両方省略でbooks[0]）を1関数で再現する（詳細は上表#8,#14,#15,#18）。

`_isSyncReady`（mde-toolbar-icons.spec.js:35）・`_artTextFsEditor`（同ファイル:64,65,157）は本群の対象外（G4/G3）のため無変更。

## 4. 落とし穴チェック（#548の4つ、着手前確認済み）

1. 非同期awaitのデッドロック：`_openBookMemoInAppEditor`はawaitしても相互デッドロックしない（確認ダイアログを待つ構造ではない、G1の`_confirmOpenSettings`とは別物）。ヘルパーはawaitする。
2. 非表示対象への直接遷移確認テスト：該当なし（G2には同種のテストは無い）。
3. 自己完結メソッドのfixture依存：`_openBookMemoInAppEditor`自体がこれに該当すると判断し、(c)に残すことで回避（§2参照）。
4. サブ要素ターゲットのscrollIntoView+focus：該当なし（G2の対象メソッドにサブ要素スクロールは無い）。

## 5. 変異検査の対象（step3用メモ）

js/screens/book-detail.js の `.memo-file-btn` クリック配線（407-410行目、`this.openOrCreateBookMemo(...)`呼び出し）を一時的に壊す（例：行をコメントアウト）→ 本群の(c)ヘルパー経由テストは**直接 `_openBookMemoInAppEditor` を呼ぶため影響を受けない**ことが予想される（これは意図通り＝クリック配線とは独立した経路であることの確認にしかならない）。
本群で変異検査が有効な箇所は、`_bookMemoEditor`状態そのもの（例：`_mdeDestroyEditor`呼び出しを一時的に無効化し、閉じた後も`_bookMemoEditor`が残ることで`hasBookMemoEditor`を使うテスト(#16)が落ちることを確認する）。具体実装はstep3で行う。
