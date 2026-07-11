# iOS ショートカットで Kindle 蔵書を取り込む

iPhone/iPad の **ショートカット** App を使うと、拡張機能の無い iOS でも Safari の共有シートからほぼワンタップで Kindle 蔵書を取り込めます (ADR-045 の②)。

ショートカットは「**WebページでJavaScriptを実行**」アクション **1 個だけ** です。結果の表示もクリップボードへのコピーも、スクリプトが Amazon のページ上に出すパネルで完結します（ショートカット側の「もし」分岐や通知アクションは不要）。

**Hub 接続時（推奨）**: bookshelf でリレー URL を生成 → Safari でそのリンクを開く → 共有シートでショートカット実行 → bookshelf に**自動受信**（コピー・ペースト不要）。

**Hub 未設定時（フォールバック）**: ページ上のパネルの「クリップボードにコピー」ボタンでコピー → bookshelf の「取込データを直接渡す」でペースト。

> ⚠️ Amazon の内部 API 仕様変更で動かなくなることがあります (ブックマークレットと同じリスク)。

---

## 1. スクレイパ JavaScript

ショートカットの「WebページでJavaScriptを実行」アクションに貼り付けるコード。

**設計メモ**: `completion()` には `"OK:N冊"` / `"ERROR:…"` の短い文字列しか返しません。蔵書 JSON のような大きなデータを Shortcuts ブリッジに渡さず、コピーはページ上のボタン（＝新しいユーザー操作）で行います。ショートカット側で結果を加工する必要がないため、分岐・通知アクションは一切不要です。

```javascript
// Amazon Kindle 一覧ページ (mycd/digital-console/contentlist/booksAll) を Safari で開き、共有シートから実行する。
// 結果表示もコピーもこのスクリプトがページ上に出すパネルで完結する。ショートカット側はこのアクション1個だけでよい。
// 注意: Shortcuts の JS コンテキストは completion() 後に破棄され得るため、パネルのボタンは
// クロージャでなく inline onclick 属性（ページ本体のコンテキストで実行される）で配線する。
(async () => {
  // ページ上に結果パネルを出す（ショートカット側の通知・分岐に依存しない）
  const panel = (msg, isError) => {
    const old = document.getElementById("bs-import-panel");
    if (old) old.remove();
    const ov = document.createElement("div");
    ov.id = "bs-import-panel";
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;font-family:sans-serif";
    const p = document.createElement("div");
    p.id = "bs-import-msg";
    p.style.cssText = "color:" + (isError ? "#fca5a5" : "#fff") + ";font-size:17px;line-height:1.7;text-align:center;max-width:520px;word-break:break-word";
    p.textContent = msg;
    ov.appendChild(p);
    const x = document.createElement("button");
    x.textContent = "閉じる";
    x.style.cssText = "font-size:14px;padding:10px 24px;border:0;border-radius:8px;background:#475569;color:#fff";
    x.setAttribute("onclick", "document.getElementById('bs-import-panel').remove()");
    ov.appendChild(x);
    document.body.appendChild(ov);
    return { ov: ov, p: p, x: x };
  };
  try {
    // csrfToken はページのグローバル変数に無いレイアウト（モバイル表示等）があるため、
    // inline script と input/meta もフォールバック探索する
    const findToken = () => {
      if (window.csrfToken) return window.csrfToken;
      for (const s of document.scripts) {
        const m = (s.textContent || "").match(/csrfToken['"]?\s*[:=]\s*['"]([^'"]{8,})['"]/);
        if (m) return m[1];
      }
      const el = document.querySelector('input[name="csrfToken"], meta[name="csrfToken"]');
      return el ? (el.value || el.content || null) : null;
    };
    const c = findToken();
    if (!c) {
      const msg = "Amazonの蔵書一覧ページで実行してください（今のページ: " + location.hostname + location.pathname + "）。蔵書一覧を開いているのにこれが出る場合は、Safariのアドレスバー左の「ぁあ」→「デスクトップ用Webサイトを表示」に切り替えてからもう一度実行してください。";
      panel(msg, true);
      completion("ERROR:" + msg);
      return;
    }
    const fetchPage = async (start) => {
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
      return j.GetContentOwnershipData;
    };
    // ショートカットのJS実行には時間制限があるため、1ページ目で総数を得て残りは並列取得
    // （2,000冊超でも直列25回→並列1波で数秒に収まる）
    const first = await fetchPage(0);
    const total = first.numberOfItems || 0;
    const starts = [];
    for (let s = 100; s < total; s += 100) starts.push(s);
    const rest = await Promise.all(starts.map(fetchPage));
    const items = first.items.concat(...rest.map(d => d.items));
    const out = items.map(i => ({
      title: i.title, authors: i.authors, acquiredTime: i.acquiredTime,
      readStatus: i.readStatus, asin: i.asin, productImage: i.productImage
    }));
    const json = JSON.stringify(out);

    // 自動受け渡し対応: ?bs_relay=UUID&bs_hub=URL があれば直接送信（クリップボード不要）
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
        panel(out.length + "冊を bookshelf に自動送信しました。bookshelf のタブに戻ってください。", false);
        completion("OK:" + out.length);
        return;
      } catch (_) {
        // Amazon のページが外部送信をブロックした場合はページ上コピーへフォールバック
      }
    }

    // ページ上のボタンからコピーする（fetch 完了後はユーザー操作なしのクリップボード書込が
    // 許可されないことがあるため、ボタンのタップを新しいユーザー操作として使う）。
    // JSON は常時表示の textarea にも置く: ボタン系が全滅しても長押しコピーで必ず取れる。
    const ui = panel(out.length + "冊の一覧を取得しました。ボタンを押してコピーしてください。", false);
    const btn = document.createElement("button");
    btn.textContent = "クリップボードにコピー";
    btn.style.cssText = "font-size:18px;padding:14px 32px;border:0;border-radius:10px;background:#2563eb;color:#fff";
    btn.setAttribute("onclick", "(function(){var t=document.getElementById('bs-import-json');var m=document.getElementById('bs-import-msg');var okmsg='コピーしました。bookshelf の設定 → 取込 → 「取込データを直接渡す」に貼り付けてください。';var fin=false;var ok=function(){if(fin)return;fin=true;m.textContent=okmsg;};var ng=function(){if(fin)return;fin=true;var c=false;try{t.focus();t.select();c=document.execCommand('copy');}catch(e){}m.textContent=c?okmsg:'自動コピーできませんでした。下の欄を長押し →「すべてを選択」→ コピーしてください。';};try{navigator.clipboard.writeText(t.value).then(ok,ng);setTimeout(ng,2000);}catch(e){ng();}})()");
    const hint = document.createElement("div");
    hint.style.cssText = "color:#cbd5e1;font-size:12px;line-height:1.6;text-align:center;max-width:520px";
    hint.textContent = "ボタンで何も起きない場合は、下の欄を長押し →「すべてを選択」→ コピーしてください。";
    const ta = document.createElement("textarea");
    ta.id = "bs-import-json";
    ta.textContent = json;
    ta.setAttribute("readonly", "readonly");
    ta.setAttribute("onclick", "this.select()");
    ta.style.cssText = "width:92%;max-width:520px;height:110px;font-size:11px;background:#fff;color:#111;border-radius:8px;padding:8px;border:0";
    ui.ov.insertBefore(btn, ui.x);
    ui.ov.insertBefore(hint, ui.x);
    ui.ov.insertBefore(ta, ui.x);
    completion("OK:" + out.length + "冊");
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e));
    panel("取得に失敗しました: " + msg, true);
    completion("ERROR:" + msg);
  }
})();
```

---

## 2. ショートカットの作り方 (iPhone/iPad)

アクションは 1 個だけです。

1. **ショートカット** App → 右上「+」で新規作成。
2. 「**WebページでJavaScriptを実行**」(Run JavaScript on Web Page) を追加し、JavaScript 欄に **第 1 章のコード** を貼り付け（bookshelf の取込画面「取込用コードをコピー」でコピーできます）。
   - このアクションは**共有シート経由 (Safari) でしか動きません**。
3. 上部のショートカット名を「**Kindle取込**」等に設定。設定 (ⓘ) → 「**共有シートに表示**」をオン → 受け取るタイプを **Safari の Web ページ** に絞る。
4. 初回実行時に「スクリプトの実行を許可」を求められたら許可する（出ない場合は 設定 App → アプリ → ショートカット → 詳細 → 「スクリプトの実行を許可」をオン）。

> **旧構成（If 分岐＋通知＋クリップボードにコピー）から移行する場合**: JavaScript アクションのコードを第 1 章の最新版に貼り替え、**「もし」以下のアクションはすべて削除**してください。現在のコードはページ上のパネルで完結するため不要です。
> なお旧構成は「もし」の入力に「JavaScriptの結果」の**「キー」プロパティ**が付きやすく（変数選択時に Shortcuts が提案してくる）、テキスト結果にはキーが無いため分岐が一切成立しない罠がありました。アクション 1 個構成にした理由のひとつです。

---

## 3. 使い方

### Hub 接続時（推奨・コピー不要）

1. **bookshelf** の取込モーダル → 「**iPhone / iPad**」タブ →「**取込リンクを作る**」をタップ。
   - リレー URL がクリップボードにコピーされ、画面にも表示されます（タップでも開けます）。
2. Safari でそのリンクを開く（アドレスバーに貼り付け）。
   - Amazon の Kindle 一覧ページが `?bs_relay=…&bs_hub=…` 付き URL で開きます。
3. Safari の **共有ボタン → 「Kindle取込」** を実行。
   - ページ上に「**N冊を bookshelf に自動送信しました**」と出たら成功。
   - 「**ボタンを押してコピーしてください**」と出た場合は、Amazon のページが外部送信をブロックしたためコピー方式にフォールバックしています。ボタンでコピーして手動ペーストへ。
4. **bookshelf タブに戻る** → 本の選択画面が自動で表示されます（自動送信成功時）。

### Hub 未設定時（フォールバック）

1. Safari で Amazon の **Kindle 一覧ページ** (`mycd/digital-console/contentlist/booksAll`) を直接開く（Amazon にログイン済みで）。
2. **共有ボタン → 「Kindle取込」** を実行。数秒でページ上にパネルが出る。
3. 「**クリップボードにコピー**」ボタンをタップ。
4. AsayakeBookshelf を開く → **設定 → 取込 → 「取込データを直接渡す」** → 貼り付け → 本を選択 → 取込。

### エラー時

ページ上のパネルに赤字でエラー内容が表示されます。Kindle 一覧ページ以外で実行していないか、「デスクトップ用 Web サイトを表示」になっているかを確認してください。

---

## 4. 配布 (任意)

自分用に作ったショートカットは **iCloud リンク** で他の人にも配れます（ショートカットを長押し → 共有 → リンクをコピー）。公式リンクを発行したら、アプリの取込モーダルにワンタップ導線 (リンク) を足せます。

## 5. Android の場合

Android は拡張もショートカットの当アクションも無いので、**取込用ブックマーク（ブックマークレット）→ 「取込データを直接渡す」** が基本:
- Chrome で取込用ブックマークを登録（アプリの「Android」タブ →「取込用ブックマークのコードをコピー」）→ Amazon ページでアドレスバーにブックマーク名を入力して実行 → クリップボードにコピー → アプリで「取込データを直接渡す」。
- うまく動かなければ PC で取得した JSON を同期/貼り付け。
