# iOS ショートカットで Kindle 蔵書を取り込む

iPhone/iPad の **ショートカット** App を使うと、拡張機能の無い iOS でも Safari の共有シートからほぼワンタップで Kindle 蔵書を取り込めます (ADR-045 の②)。

**Hub 接続時（推奨）**: bookshelf でリレー URL を生成 → Safari でそのリンクを開く → 共有シートでショートカット実行 → bookshelf に**自動受信**（クリップボードへのコピー・ペースト不要）。

**Hub 未設定時（フォールバック）**: 取得した JSON をクリップボードにコピー → bookshelf の「貼り付けて取込」で手動ペースト。

> ⚠️ Amazon の内部 API 仕様変更で動かなくなることがあります (ブックマークレットと同じリスク)。

---

## 1. スクレイパ JavaScript

ショートカットの「WebページでJavaScriptを実行」アクションに貼り付けるコード。

**Hub 接続時**: ページ URL の `?bs_relay=UUID&bs_hub=URL` を読み取り、Hub に直接送信します（`completion()` は `"OK:N"` を返す）。  
**Hub 未設定時**: JSON 文字列をそのまま `completion()` で返すので、後続の「クリップボードにコピー」に渡されます。

```javascript
// Amazon Kindle 一覧ページ (mycd/digital-console/contentlist/booksAll) を Safari で開いた状態で実行する。
(async () => {
  try {
    const c = window.csrfToken;
    if (!c) {
      completion("ERROR:Amazon Kindle 一覧ページ (mycd/digital-console/contentlist/booksAll) を Safari で開いてから実行してください");
      return;
    }
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
    const out = items.map(i => ({
      title: i.title, authors: i.authors, acquiredTime: i.acquiredTime,
      readStatus: i.readStatus, asin: i.asin, productImage: i.productImage
    }));

    // Hub リレー対応: ?bs_relay=UUID&bs_hub=URL があれば直接送信（クリップボード不要）
    const p = new URLSearchParams(location.search);
    const rid = p.get('bs_relay');
    const hub = p.get('bs_hub');
    if (rid && hub) {
      try {
        await fetch(hub + '/kindle/relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: rid, items: out })
        });
        completion("OK:" + out.length);
      } catch (re) {
        completion("ERROR:Hub への送信に失敗しました: " + (re.message || re));
      }
      return;
    }

    // フォールバック: JSON をそのまま返す（ショートカットがクリップボードにコピー）
    completion(JSON.stringify(out));
  } catch (e) {
    completion("ERROR:" + (e && e.message ? e.message : e));
  }
})();
```

---

## 2. ショートカットの作り方 (iPhone/iPad)

### アクション構成

1. **ショートカット** App → 右上「+」で新規作成。
2. 「**WebページでJavaScriptを実行**」(Run JavaScript on Web Page) を追加。
   - JavaScript 欄に **第 1 章のコード** を貼り付け。
   - このアクションは**共有シート経由 (Safari) でしか動きません**。
3. 「**もし**」(If) ブロックを追加:
   - 条件: 「JavaScriptの実行結果」が **「OK:」で始まる**
   - **はい** → 「**通知を表示**」: テキストに `Kindle 取込完了！bookshelf に自動送信されました。` を設定。
4. 「**でなければ、もし**」ブロックを追加:
   - 条件: 「JavaScriptの実行結果」が **「ERROR:」で始まる**
   - **はい** → 「**通知を表示**」: テキストに「JavaScriptの実行結果」を指定（エラー内容をそのまま表示）。
5. 「**でなければ**」ブロックを追加（Hub 未設定時のフォールバック）:
   - 「**クリップボードにコピー**」: 入力に「JavaScriptの実行結果」を指定。
   - 「**通知を表示**」: `コピーしました。bookshelf の「貼り付けて取込」に貼り付けてください。`
6. 「**完了**」(End If) で閉じる。
7. 上部のショートカット名を「**Kindle取込**」等に設定。設定 (ⓘ) → 「**共有シートに表示**」をオン → 受け取るタイプを **Safari の Web ページ** に絞る。
8. 完了。

---

## 3. 使い方

### Hub 接続時（推奨・クリップボード不要）

1. **bookshelf** の取込モーダル → 「**スマホから取込**」→「**Amazon を開く（スマホ向け）**」をタップ。
   - リレー URL がクリップボードにコピーされ、画面にも表示されます。
2. Safari でそのリンクを開く（アドレスバーに貼り付け）。
   - Amazon の Kindle 一覧ページが `?bs_relay=…&bs_hub=…` 付き URL で開きます。
3. Safari の **共有ボタン → 「Kindle取込」** を実行。
   - 数秒〜数十秒で取得・Hub に自動送信されます。
4. **bookshelf タブに戻る** → 本の選択画面が自動で表示されます。
   - ペースト不要で完了。

### Hub 未設定時（フォールバック）

1. Safari で Amazon の **Kindle 一覧ページ** (`mycd/digital-console/contentlist/booksAll`) を直接開く（Amazon にログイン済みで）。
2. **共有ボタン → 「Kindle取込」** を実行。数秒〜十数秒で取得 → クリップボードにコピー。
3. AsayakeBookshelf を開く → **取込 → 「貼り付けて取込」** → データを貼り付け → 本を選択 → 取込。

### エラー時

通知に `ERROR:…` が表示されたら原因が分かります。Kindle 一覧ページ以外で実行していないか確認してください。

---

## 4. 配布 (任意)

自分用に作ったショートカットは **iCloud リンク** で他の人にも配れます（ショートカットを長押し → 共有 → リンクをコピー）。公式リンクを発行したら、アプリの取込モーダルにワンタップ導線 (リンク) を足せます。

## 5. Android の場合

Android は拡張もショートカットの当アクションも無いので、**ブックマークレット → 「貼り付け取込」** が基本:
- Chrome でブックマークレットを登録（アプリの「ブックマークレットをコピー」）→ Amazon ページでアドレスバーにブックマーク名を入力して実行 → クリップボードにコピー → アプリで「貼り付けて取込」。
- うまく動かなければ PC で取得した JSON を同期/貼り付け。
