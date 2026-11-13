// 長文メモ(アプリ内エディタ)に関するテストヘルパー (U9・イシュー#550・G2置き換え)。
//
// 分類 (docs/char/u9-classification.md 参照):
// - 全関数は (c)テスト用ヘルパー集約。openBookMemoInAppEditor は実際のUIボタン
//   (.memo-file-btn、js/screens/book-detail.js:237,407-410)をクリックすれば同じ経路を通るが、
//   そのボタンは本の詳細ペイン(#book-detail-pane)が開いている時だけDOMに存在する。本の詳細を
//   開くshowBookDetail()はbody.book-detail-pinnedを付け、nav履歴に段を積む副作用を持つ
//   (book-detail.js:130-146)。呼び出し元の大半(back-nav-matrix/checklist-timing/standard-ops)は
//   まさに戻る/進むの履歴段数を検証するテストのため、本の詳細を開く前段を追加すると履歴が
//   汚れてテスト前提(「長文メモモーダルだけを単独で開いた状態」)を壊す。既存スイート全体にも
//   実クリックで長文メモを開く例は無いため、内部呼び出しのままここ1か所に集約する
//   (G1のu9-classification.md該当行にある_confirmOpenSettings・_openPluginSettingsと同じ理由付け)。
// - setBookMemoValue/getBookMemoValue 等はエディタの値を即時に読み書きする(保存のフラッシュと
//   同種・決定性のため(c)・#536の教訓)。実際のキー入力で再現すると、checklist-timing.spec.jsの
//   デバウンス計測が崩れる。

// 長文メモをアプリ内エディタで開く。asin省略時はbooks[0]、book省略時はasinからbooksを検索する
// (呼び出し元ごとに異なる3パターン(asin指定のみ/asin+book両方明示/両方省略)を1関数で再現する)。
export async function openBookMemoInAppEditor(page, asin, book) {
    await page.evaluate(({ asin, book }) => {
        const target = book || window.bookshelf.books.find((b) => b.asin === asin) || window.bookshelf.books[0];
        const useAsin = asin || target.asin;
        return window.bookshelf._openBookMemoInAppEditor(useAsin, target);
    }, { asin, book });
}

// エディタの内容を直接セットする(キー入力ではなく即時の値設定・決定性のため(c))。
// 元の `window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor` というフォールバック式を
// そのまま保持する(bookMemoEditor無underscore版はjs/に実装が無く常にundefined=死んだ分岐だが、
// 挙動を変えないためそのまま移植する)。
export async function setBookMemoValue(page, text) {
    await page.evaluate((t) => {
        const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor;
        if (ed) ed.value(t);
    }, text);
}

// エディタの現在値を読む(無ければnull)。
export async function getBookMemoValue(page) {
    return page.evaluate(() => {
        const ed = window.bookshelf._bookMemoEditor;
        return ed ? ed.value() : null;
    });
}

// エディタインスタンスが存在するか(破棄済み/未作成の確認用)。
export async function hasBookMemoEditor(page) {
    return page.evaluate(() => !!window.bookshelf._bookMemoEditor);
}

// エディタインスタンスが作られるまで待つ。
export async function waitForBookMemoEditor(page, opts) {
    await page.waitForFunction(() => !!window.bookshelf._bookMemoEditor, null, opts);
}

// 保存導線のコンテキスト(asin/title)を読む(読込失敗時などにnullであることの確認用)。
export async function getBookMemoEditorContext(page) {
    return page.evaluate(() => window.bookshelf._bookMemoEditorContext);
}

// ツールバーの太字ボタンのHTML(文章ブロック側のエディタと見た目が一致するかの比較用)。
export async function getBookMemoBoldToolbarHtml(page) {
    return page.evaluate(() => window.bookshelf._bookMemoEditor.toolbarElements.bold.innerHTML);
}
