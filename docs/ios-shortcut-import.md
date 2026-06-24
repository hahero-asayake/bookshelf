# iOS ショートカットで Kindle 蔵書を取り込む

iPhone/iPad の **ショートカット** App を使うと、拡張機能の無い iOS でも Safari の共有シートからほぼワンタップで Kindle 蔵書を取り込めます (ADR-045 の②)。

仕組み: 共有シート → 「WebページでJavaScriptを実行」が Amazon ページ上でスクレイパJS (ブックマークレットと同じ) を走らせ、取得した JSON を**クリップボードにコピー** → AsayakeBookshelf の取込モーダルで「クリップボードから読み取り」。

> ⚠️ Amazon の内部 API 仕様変更で動かなくなることがあります (ブックマークレットと同じリスク)。

---

## 1. スクレイパ JavaScript

ショートカットの「WebページでJavaScriptを実行」アクションに貼り付けるコード。取得結果を文字列で `completion()` に返します。

```javascript
// Amazon Kindle 一覧ページ (mycd/digital-console/contentlist/booksAll) を Safari で開いた状態で実行する。
(async () => {
  try {
    const c = window.csrfToken;
    if (!c) { completion("ERROR: Amazon Kindle 一覧ページ (mycd/digital-console/contentlist/booksAll) を Safari で開いてから実行してください"); return; }
    let items = [], start = 0, total = Number.MAX_SAFE_INTEGER;
    while (items.length < total) {
      const input = JSON.stringify({
        contentType: "Ebook", contentCategoryReference: "booksAll",
        itemStatusList: ["Active"], showSharedContent: true,
        fetchCriteria: { sortOrder: "DESCENDING", sortIndex: "DATE", startIndex: start, batchSize: 100, totalContentCount: -1 },
        surfaceType: "Desktop"
      });
      const r = await fetch("https://www.amazon.co.jp/hz/mycd/digital-console/ajax", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ activity: "GetContentOwnershipData", activityInput: input, csrfToken: c })
      });
      const j = await r.json();
      if (j.success === false) throw new Error(JSON.stringify(j.error));
      const d = j.GetContentOwnershipData;
      total = d.numberOfItems; start += 100; items.push(...d.items);
    }
    const out = items.map(i => ({ title: i.title, authors: i.authors, acquiredTime: i.acquiredTime, readStatus: i.readStatus, asin: i.asin, productImage: i.productImage }));
    completion(JSON.stringify(out));
  } catch (e) {
    completion("ERROR: " + (e && e.message ? e.message : e));
  }
})();
```

---

## 2. ショートカットの作り方 (iPhone/iPad)

1. **ショートカット** App → 右上「+」で新規作成。
2. アクションを追加 → 検索で「**WebページでJavaScriptを実行**」(Run JavaScript on Web Page) を追加。
   - このアクションは**共有シート経由 (Safari) でしか動きません**。
3. その JavaScript 欄に **第1章のコード**を貼り付け。
4. 下に「**クリップボードにコピー**」(Copy to Clipboard) を追加 → 入力に「**JavaScriptの実行結果**」を指定。
5. (任意) 「**通知を表示**」を追加して「コピーしました」等を出す。
6. 上部のショートカット名を「**Kindle取込**」等に設定。設定 (ⓘ) →「**共有シートに表示**」をオン → 受け取るタイプを **Safari の Web ページ** に絞る。
7. 完了。

---

## 3. 使い方

1. Safari で Amazon の **Kindle 一覧ページ** (`mycd/digital-console/contentlist/booksAll`) を開く (Amazon にログイン済みで)。
2. **共有ボタン → 「Kindle取込」**。数秒〜十数秒で取得 → クリップボードにコピー。
3. AsayakeBookshelf を開く → **取込 → 「クリップボードから読み取り」** → 本を選択 → 取込。
   - 失敗時はクリップボードに `ERROR: …` が入るので、アプリで貼り付けた時に原因が分かります。

---

## 4. 配布 (任意)

自分用に作ったショートカットは **iCloud リンク**で他の人にも配れます (ショートカットを長押し → 共有 → リンクをコピー)。公式リンクを発行したら、アプリの取込モーダルにワンタップ導線 (リンク) を足せます。

## 5. Android の場合

Android は拡張もショートカットの当アクションも無いので、**ブックマークレット → 「貼り付け取込」**が基本:
- Chrome でブックマークレットを登録 (アプリの「ブックマークレットをコピー」) → Amazon ページでアドレスバーにブックマーク名を入力して実行 → クリップボードにコピー → アプリで「クリップボードから読み取り」。
- うまく動かなければ PC で取得した JSON を同期/貼り付け。
