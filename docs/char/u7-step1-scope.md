# U7 step1: 棚卸しと移し方の決定（イシュー#525）

対象: `_art*`（記事エディタ）を `js/bookshelf.js` から `js/screens/article-editor.js` へ移す。
計測は origin/main（afeb6cd 以降の最新、本文書作成時点のHEAD = d34226b、#524 のvisual基準撮り直しを含む）で実施。

## 1. 移す対象（確定・②判断で修正）

②判断（step2 tp承認時）：移す範囲は名前の接頭辞ではなく責務で決める。Plan A（prototype取り付け）なので、呼び出し元がグローバルのボタンやルート表であっても、移しただけでは壊れない。「共有されているから残す」は理由にならない。中身が記事専用かどうかで判定する。

- **`_art*` メソッド定義：132件**（brief の「約131」で一致。`js/bookshelf.js` 8895〜12528行）
  - 初回の正規表現（`^\s{4}_art...\(`）は `async` 付きメソッドを漏らし107件と誤カウントした。`^\s{4}(async\s+)?_art...\(` で132件、brief と一致。
  - 範囲: 先頭 `_artRunExclusive`(8895行) 〜 末尾 `_artTogglePreviewDevice`(12517行、本体末12528行)。
- **追加で移す6メソッド**（`_art` を名乗らないが中身は記事専用、または記事の画面の一部と判断）：
  - `_ensureFreeAffiliateConsent`(8932行)：呼び出しは`_artPublish`(11897行)のみ＝記事専用。
  - `_handleAdapterWriteStatus`(11830行)：本体は`_artSetSaveStatus`しか呼ばない＝記事専用。登録元（コンストラクタの`this.storage.adapter.onWriteStatus = ...`、220行）はbookshelf.js側に残る＝`this._handleAdapterWriteStatus`への代入はそのままprototype経由で解決される。
  - `openPublishPagesModal`・`closePublishPagesModal`・`openPublishSettingsModal`・`closePublishSettingsModal`(8955〜9022行)：公開の一覧・公開の設定は記事の画面の一部と判断（②判断）。呼び出し元がグローバルの「公開」ボタン(919行)やURLルート表(13045/13046/13187行)にあっても、Plan Aでは移しただけで壊れない。
  - 合計 132+6 = **138メソッドを移動**（`js/screens/article-editor.js`）。
- `_art*` で始まる識別子は全体で173種（うち132がメソッド、約40が状態プロパティ＝`_artDraft`/`_artEditingId`/`_artMode` 等）。状態プロパティも移動の対象の一部（メソッドと一緒にインスタンス上で使われる値であり、ファイルを分けても `this.` のまま読み書きされる＝移すだけで壊れない）。

## 2. 移さない（8895〜12528行の中にある、記事専用ではない2件）

| メソッド | 行 | 理由（実測・②判断） |
|---|---|---|
| `_placeAnchoredMenu` | 10875 | 記事内の5箇所(9921/10920/11119/11453/11978行)に加え、`_mdeToggleHeadingMenu`(下記の長文メモ共有クラスタ)からも呼ばれる(12726行)。どの画面のメニュー位置決めにも使える汎用部品＝記事専用ではない |
| `_handleAdapterWriteStatus` | ~~11830~~ | （§1参照・②判断で移す側に変更） |

**この直後(12534〜12829行)に続く「記事と見た目が近いが別機能」のクラスタも移さない**：`openOrCreateBookMemo`・`_openMdEditor`・`_mdeToolbarConfig`・`_mdeApplyToolbarLabels`・`_mdeToggleHeadingMenu`・`_mdeCloseHeadingMenu`・`_mdeCurrentHeadingLevel`・`_mdeApplyHeadingLevel`・`_mdeDestroyEditor`・`_ensureEasyMDELoaded`・`_mountFsHeader`（11メソッド）。②判断：記事専用ではない（長文メモと共有）＝U8かそのあとの共通部品の単位で扱う。

理由（実測）：`_openMdEditor`は記事(10014行)と長文メモ(12906行)の両方から呼ばれ、同じ`toolbar: this._mdeToolbarConfig(...)`を使う。`_mdeDestroyEditor`も記事(10007/10067行)と長文メモ(12860/12959行)の両方から呼ばれる。見出しメニューのEsc/外側クリック配線(940〜960行、コンストラクタ内)はグローバルに1回だけ登録され、記事と長文メモの両方のエディタに効く。つまり「記事エディタのMarkdown本文入力」と「本の長文メモのMarkdown入力」が同じ部品を共有している＝記事だけのものではない。移すと長文メモ側がarticle-editor.jsに依存する逆方向の依存になる。

**最終的にbookshelf.jsに残るのは12メソッド**（`_placeAnchoredMenu` 1件＋長文メモ共有クラスタ11件）。

## 3. 記事エディタが使う、VirtualBookshelf側の状態・メソッド（(b)の一覧）

移した後も `this.` 経由でそのまま呼ぶ前提（§7のPlan A）。確認できた主なもの：

- bookshelf.jsに残る12メソッド（§2：`_placeAnchoredMenu`・長文メモ共有のMarkdown編集部品11件）
- `this.storage`（`BookshelfStorage`）・`this.publishArticleStore`（`PublishArticleStore`）・`this.publishArticleGenerator`（`PublishArticleGenerator`）
- `this.bookManager`・`this.bookshelfManager`（記事ブロックが参照する本・本棚の解決）
- `this._surface()`（Surfaceのopen/close）・`this.userData`（設定・同意フラグ）
- `SyncConfigManager`（静的import）・`confirmDialog`・`BookshelfEscape.escapeHtml`・`window.renderIcon`/`window.applyIcons`
- プラグインとの橋: `_artThemeItems`(10219行)が`window.bookshelfAPI.getArticleThemes(kind)`を呼ぶ（globalの`window.bookshelfAPI`経由＝`this.`ではない。ファイルを移してもこの呼び方は変わらないため影響なし）

> この一覧は、次の段（クラス化・注入）でVirtualBookshelfとの境界を置き換えるための足場にする。今回はクラス化・注入はしない（U9以降）。

## 4. 記事エディタ外から `_art*` を読み書きしている箇所（(c)の一覧）

`js/bookshelf.js`の8895〜12528行の外にある参照（grep実測、コメントのみの参照は除く）：

| 行 | 内容 |
|---|---|
| 405〜406 | ページ可視性変化ハンドラが `this._artRemoteFlushTimer`/`this._artFlushRemoteNow()` を直接触る |
| 7818 | 別箇所の後始末処理が `typeof this._artClosePublishPanel === 'function'` を確認して呼ぶ |
| 8119〜8121 | URLルート処理が `this._artEditingId` を読み `this._artOpenEditor(route.id)` を呼ぶ |
| 8818 | 全オーバーレイを閉じる処理が `this._artMode = 'view'` を直接代入 |
| 13166〜13240 | URLルート表（ブロック編集・追加シート・本探しシート・本棚メニュー・公開パネル・プレビューモーダルの深リンク）が `_artDraft`/`_artMode`/`_artEditingId`/`_artActiveShelfBlockId` を読み書きし、`_artEditBlock`/`_artShowEditor`/`_artSetMode`/`_artOpenEditor`/`_artOpenAddSheet`/`_artOpenLookSheet`/`_artOpenSheet`/`_artOpenPublishPanel`/`_artOpenPreviewModal` を呼ぶ |

他ファイル：`js/nav-state.js:201` が `wrap(app, '_artHistHandOver', ...)` でインスタンスメソッドを包んでいる（モンキーパッチ）。

**Plan A（§5）であれば、これらは一切変更不要**：`_art*` がどのファイルで定義されていても、`VirtualBookshelf.prototype` 上に乗る限り `this._artXxx` は同じ関数を指す。上の一覧は「今の結合の実態」の記録であり、U9以降の境界整理の材料として残す。

## 5. テストが直接触っている `_art*`（(d)の一覧）

grep実測（`_art[A-Za-z0-9_]*` を直接書いているファイル・行数、コメント含む生の行数）：

| ファイル | 行数 |
|---|---|
| tests/e2e/publish-article-editor.spec.js | 93 |
| tests/e2e/back-nav-matrix.spec.js | 16 |
| tests/e2e/article-pc-pane.spec.js | 13 |
| tests/e2e/publish-conflict-hub.spec.js | 13 |
| tests/e2e/standard-ops.spec.js | 11 |
| tests/e2e/username-publish-gate.spec.js | 9 |
| tests/e2e/preview-real-adapter.spec.js | 7 |
| tests/e2e/mde-toolbar-icons.spec.js | 3 |
| tests/e2e/publish-panel.spec.js | 3 |
| tests/e2e/overlay-front.spec.js | 3 |
| tests/e2e/helpers/art-editor.js | 3 |
| tests/e2e/forward-reopen-idempotent.spec.js | 2 |
| tests/unit/art-preview-stage-label.test.js | 2 |
| tests/e2e/critical-path.spec.js | 1 |
| tests/e2e/smoke.spec.js | 1 |
| **合計** | **180** |

brief/§5表の「189か所」とは±9の差（プランを書いた時点から多少増減した程度・大きなズレではない）。

**使っている名前（重複除去）**：メソッド名30種＋状態プロパティ6種（`_artDraft`・`_artEditingId`・`_artMode`・`_artTextFsEditor`・`_artPreviewHardDeadlineMs`・`_artPreviewStallMs`）＝**36種**。うち1件（`publish-article-editor.spec.js:2570`）は `window.bookshelf._artPublish = async (...) => {...}` のように**メソッド自体を上書きするテスト**がある。これはPlan A（prototypeに直接乗る）なら、どのファイルで定義されていても `window.bookshelf._artPublish` という同じインスタンスプロパティ経路で上書きできる＝無停止で動く。

## 6. プラグイン（plugin-api.js）が使っている名前（(e)の一覧）

**0件**。`js/plugin-api.js`に`_art*`という名前の参照は無い。唯一の近い名前`_articleThemes`はPluginAPI自身の状態（記事の見た目をプラグインから加算登録するためのスロット）で、VirtualBookshelfの`_art*`とは無関係。繋がりは`_artThemeItems`(VirtualBookshelf側、10219行)が`window.bookshelfAPI.getArticleThemes(kind)`をグローバル経由で呼ぶ一方向だけ（§3参照）。

## 7. 移し方の決定：Plan A（prototype取り付け）

**案A（採用・実施済み）**：`js/screens/article-editor.js`に移動する138メソッドの定義を**class構文のまま**(`class _ArticleEditorMethods { ... }`)書き、ファイル末尾で

```js
const _artEditorDescriptors = Object.getOwnPropertyDescriptors(_ArticleEditorMethods.prototype);
delete _artEditorDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _artEditorDescriptors);
```

により`VirtualBookshelf.prototype`へ合成する。オブジェクトリテラル(`Object.assign(..., {a(){}, b(){}})`)はメソッド間にカンマが要るため1行変換が必要になるが、class構文同士(bookshelf.js側のclass本体→article-editor.js側のclass本体)なら区切りの記法が完全に同じ＝**138メソッドの見出し・本体を1文字も書き換えずに済む**（実施：bookshelf.jsから該当行範囲をそのまま切り取り、article-editor.js側のclass本体へそのまま貼る機械的な操作のみ）。メソッド内部の`this`は実行時に`VirtualBookshelf`インスタンスを指す（prototypeに乗るのは中身であって所属クラスではないため）。

**案B（不採用）**：`ArticleEditor`クラス＋`this.app`経由に変える。中身の`this.`を全数千か所書き換える必要があり「移すだけ」の原則に反し、retrogression（退行）のリスクが大きい。不採用。

**コンストラクタの`this._art*`初期代入（②指摘③の確認結果）**：`class VirtualBookshelf`のコンストラクタ(bookshelf.js 190〜280行)を実測したが、`this._art*`への代入は**1件も無い**（`this._art`を含む行自体が無い）。約40種の状態プロパティ（`_artDraft`・`_artMode`等）はコンストラクタでは初期化されず、各`_art*`メソッドが初回実行時に自分で代入する（例：`_artSetupUI`が`this._artBound = true`を代入）。これらのメソッドは今回すべて移動対象なので、**状態の初期化処理そのものも移動先(article-editor.js)に含まれる**。コンストラクタ側に残す/動かす対象は無かった。state自体の持ち主（`this`が指すインスタンス）は変わらずVirtualBookshelf＝article-editor.jsは別のインスタンスを持たない、という前提は変わらない。

案Aの結果：
- `bookshelf.js`に残る`_art*`の**メソッド定義は0件**（132件全て移動。§1参照）。
- `nav-state.js`の`wrap(app, '_artHistHandOver', ...)`は無変更で動く（実測：移動後も109件のpublish-article-editorテストが全件合格）。
- テストの直接アクセス・メソッド上書きも無変更で動く。
- 「委譲」という追加コードは発生しない（bookshelf.js側に薄いラッパーを書く必要がない）。brief/§5が想定する「委譲の数」は、この案では**0**（新規に追加するラッパーコードは無い）。報告の実体としては「テスト・プラグインが直接触れていて、移動後も同じ名前で動くことを確認した対象」の数＝**36種（テスト）＋0種（プラグイン）**とする。

## 8. §5 lint（テスト中の`bookshelf._`参照の上限329）について

scripts/・.github を検索したが、この上限を強制する仕組みは見当たらない＝**未実装**。②の指示により、このイシューでは新設しない。参考として現在の総数を実測：`tests/`配下の`bookshelf._`系参照（設定・ドロワー等、記事以外も含む全体）は**306件**（grep実測、§5表の329とは差があるが同程度の規模）。U7では数の報告のみ行い、仕組み化はしない。

## 9. 基準値（origin/main、本書作成時点で実測・PORT=8125）

| 対象 | 結果 |
|---|---|
| tests/e2e/publish-article-editor.spec.js | 109 passed |
| tests/e2e/article-pc-pane.spec.js | 10 passed |
| tests/e2e/publish-panel.spec.js | 9 passed |
| tests/e2e/char/article.spec.js + tests/e2e/char/publish-hub.spec.js（A1〜A7・A-a〜A-e、6端末マトリクス） | 22 passed / 98 skipped / 0 failed |

## 10. 次段への足場

この一覧（特に§3・§4）は、記事エディタをクラス化し、VirtualBookshelfへの依存を注入の形に変える次の段（U9以降）のための足場として残す。今回（U7）ではクラス化・注入はしない。

②指摘（step4）：`ART_LOCAL_DRAFT_PREFIX`・`ART_DRAWER_COLLAPSE_KEY`の2定数は`js/bookshelf.js`に残っており、`js/screens/article-editor.js`側はclassic `<script>`同士がトップレベルscopeを共有すること（index.htmlの読み込み順＝bookshelf.js→article-editor.jsに依存）に頼って参照している。次段（クラス化・注入）で、この2定数もarticle-editor.js側へ移すこと。
