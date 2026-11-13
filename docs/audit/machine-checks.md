# 監査の機械検査の決まり（門(c)・イシュー#585）

公開前品質の門(c)「監査の門」のうち、機械が判定する5つの検査の決まりを書く。
検査は、文言の表記（`lint:copy`）、用語表（`lint:terms`）、ボタン名の揺れ（`audit:buttons`）、名前の無い部品（`audit:a11y-names`）、表示崩れ（`audit:layout`）の5つ。

- 決まりは、検出結果を見る前にここへ書く。結果を見てから決まりを変える時は、変えた理由と変える前後の件数を commit 本文に書く。
- 検査は「今の件数を上限にして、増えたら落とす」。0件にするのは後続の「監査の一覧」イシュー。
- 色・コントラスト・操作の挙動は、この検査の範囲に入れない（門(a)(b)の範囲）。

## 1. 全画面の一覧

### 1-1. 正本と網羅の確かめ方

- 一覧の正本は `tests/audit/screens.js`。1件は、画面ID・開き方・当てる幅・対応する面（下の2つ）を持つ。
- 網羅は機械で確かめる。次の2つの全件が、一覧の「対応する面」か、一覧の末尾の「対象外（理由つき）」のどちらかに載っていること。載っていないものが1つでもあれば検査が落ちる。
  1. `js/bookshelf.js` の `_defineSurfaces` にある `S.define` の全ID（今は29）
  2. `docs/ui-standards.md` §1 の表の全行（今は28。「面」の列の文字で突き合わせる）
- `index.html` にあるのに上の2つのどちらにも無い面は、一覧に手で載せる（今は `bulk-shelf-popover`・`mobile-setup-banner`・`art-drawer-shelf-popover`）。
- 片方にしか無い面（今は `plugins-modal`・`publish-settings-modal`・`dashboard-edit` が `S.define` にだけある）は、検査の結果に名前を出す。落とさない。
- 開き方は、次の順で最初に使えるもので書く。①利用者の操作（クリック・タップ・キー）②`tests/e2e/helpers/` の関数 ③公開の窓口（`window.bookshelf.` の、先頭に `_` の無いメソッド）。
- spec と一覧に `bookshelf._`・`app._` を直接書かない（`lint:internal-refs` の対象に `tests/audit` を足し、上限82のまま保つ）。

### 1-2. 画面（初版）

| 画面ID | 画面 | S.define のID | ui-standards §1 の行 | 幅 |
|---|---|---|---|---|
| home | ホーム | — | — | 全部 |
| home-empty | 蔵書0のホーム（初回の案内） | — | — | 全部 |
| home-edit | ホームの編集 | dashboard-edit | — | 全部 |
| widget-picker | ウィジェットピッカー | — | ウィジェットピッカー | 全部 |
| shelf | 本棚の一覧 | — | — | 全部 |
| shelf-empty | 空の本棚 | — | — | 全部 |
| shelf-tree-menu | 本棚ツリーの「…」メニュー | — | 本棚ツリーの「…」メニュー | 全部 |
| popover-filter / popover-display / popover-search | ヘッダーのポップオーバー3種 | — | ヘッダーのポップオーバー 3 種 | 全部 |
| bulk-shelf-popover | まとめて本棚に入れるポップオーバー | — | — | 全部 |
| book-detail | 本の詳細（PCは右ペイン・スマホはシート） | — | 本詳細シート (SP) | 全部 |
| book-memo | 長文メモエディタ | book-memo-modal | 長文メモエディタ | 全部 |
| mde-heading-menu | 見出しボタンの3択メニュー | mde-heading-menu | 書式ツールバーの見出しボタンの3択メニュー | 全部 |
| drawer | 左ナビのドロワー | drawer | ドロワー (SP 左ナビ) | 出る幅だけ |
| command-palette | コマンドパレット | command-palette | コマンドパレット (⌘K) | 全部 |
| settings | 設定の一覧 | settings-modal | 設定モーダル | 全部 |
| settings-cat-* | 設定の各節（画面にある節を全部） | settings-cat | 設定モーダル | 全部 |
| plugins | プラグインの一覧 | plugins-modal | — | 全部 |
| plugin-settings | プラグイン設定 | plugin-settings-modal | プラグイン設定モーダル | 全部 |
| import-* | 取込（取込の方法ごと） | import-modal | 取込モーダル | 全部 |
| add-book | 本の手動追加 | add-book-modal | 手動追加モーダル | 全部 |
| exclusions | 除外一覧 | exclusions-modal | 除外一覧モーダル | 全部 |
| shelves-manage | 本棚管理 | bookshelf-modal | 本棚管理モーダル | 全部 |
| shelf-form | 本棚フォーム | bookshelf-form-modal | 本棚フォームモーダル | 全部 |
| icon-picker | アイコンピッカー | icon-picker-modal | アイコンピッカー | 全部 |
| descendants-pick | 子孫選択 | descendants-pick-modal | 子孫選択モーダル | 全部 |
| publish-list | 記事の一覧 | publish-pages-modal | 公開記事モーダル (一覧＋エディタ) | 全部 |
| art-viewing | 記事の閲覧状態 | art-viewing | 記事エディタの多段 | 全部 |
| art-edit | 記事の編集状態 | art-edit-mode | 記事エディタの多段 | 全部 |
| art-fs | ブロックの全画面・PCの文章ブロック右ペイン | art-fs | 記事エディタのブロック全画面 / PCの文章ブロック右ペイン | 全部 |
| art-add-sheet | ブロックを足すシート | art-add-sheet | 記事エディタの多段 | 全部 |
| art-blk-menu | ブロックのメニュー | art-blk-menu | 記事エディタの多段 | 全部 |
| art-look-sheet | 見た目のシート | art-look-sheet | 記事エディタの多段 | 全部 |
| art-drawer | 引き出し | art-sheet | 記事エディタの多段 | 全部 |
| art-drawer-shelf-popover | 引き出しの本棚えらび | — | — | 全部 |
| art-more-menu | 記事の ⋯ メニュー | art-more-menu | 記事エディタの ⋯ メニュー | 全部 |
| art-publish | 公開パネル | art-publish-modal | 公開パネル | 全部 |
| art-preview | 公開プレビュー（中の公開記事ページを含む） | pp-preview-modal | 公開プレビューモーダル | 全部 |
| publish-settings | 公開の設定 | publish-settings-modal | — | 全部 |
| report | 記事の通報 | report-modal | 記事の通報ダイアログ | 全部 |
| confirm | 確認ダイアログ（2択） | — | confirmDialog (2択) | 全部 |
| sync-conflict | 同期衝突ダイアログ（3択） | — | 同期衝突ダイアログ (3択) | 全部 |
| usage-alert | 容量アラートバナー | — | 容量アラートバナー | 全部 |
| mobile-setup-banner | スマホの設定案内バナー | — | — | 出る幅だけ |

対象外（理由つき）

| 面 | 理由 |
|---|---|
| プラグインの面（`api.ui.openOverlay`・ui-standards §1 の行「プラグインの面」） | 中身はプラグインごとに違う。標準プラグインがこの面を使う場合は一覧へ移す |
| トースト | 数秒で消える表示。文言は抽出（§7）で見る |

開き方（既存の spec が使っている入口。表に無い画面は①利用者の操作で書く）

| 画面ID | 開き方 |
|---|---|
| home | 起動する |
| home-empty・shelf-empty | 本が0冊のデータで起動する |
| home-edit | `#dashboard-edit-toggle` を押す |
| shelf | 左ナビの本棚を押す（左ナビが畳まれている幅は、先にドロワーを開く） |
| book-detail | 本棚の一覧で本を押す |
| book-memo | `openBookMemoInAppEditor`（helpers/book-memo.js） |
| drawer | `openDrawer`（helpers/nav.js） |
| command-palette | `openCommandPalette`（helpers/nav.js） |
| settings・settings-cat-* | `openSettingsByClick`（helpers/settings.js。節は第2引数） |
| plugin-settings | `openPluginSettingsByClick`（helpers/settings.js） |
| import-* | `showImportModal()` |
| add-book | `showAddBookModal()` |
| exclusions | `showExclusionsModal()` |
| shelves-manage | `showBookshelfManager()` |
| shelf-form | `#add-bookshelf` を押す。または `showBookshelfForm()` |
| icon-picker | 本棚フォームのアイコンのボタンを押す。または `openIconPicker()` |
| publish-list | `openPublishPagesModal()` |
| art-viewing | 記事の一覧で `#art-new` を押す |
| art-edit | `#art-mode-edit` を押す |
| art-drawer | `addBlock(page, 'shelf', 'first')`・`openArtSheet`（helpers/art-editor.js） |
| art-blk-menu・art-fs | `editArtBlockViaMenu`（helpers/art-editor.js） |
| art-look-sheet | `#art-look-btn`（幅によっては `#art-bar-look`）を押す |
| art-more-menu | `#art-more-btn` を押す |
| art-publish | `#art-publish-header`（幅によっては `#art-bar-publish`）を押す |
| art-preview | `openArtPreview`（helpers/art-editor.js） |
| report | `openReportModal()` |
| confirm | `confirmOpenSettingsForTest`（helpers/settings.js） |
| sync-conflict | `showConflictDialogForTest`（helpers/sync.js） |
| usage-alert | `renderUsageAlertForTest`（helpers/settings.js） |

- 幅で出ない画面（例：ドロワー）は、その幅では飛ばす。どの幅で出るかは `screens.js` に書く。飛ばした組合せは結果に件数を出す。
- 同じ起動のまま、同じ群の画面を順に開いて検査する（群の単位は `screens.js` で決める）。1画面の失敗が次の画面に残らないよう、群ごとに起動し直す。

## 2. データ3種

| 名前 | 中身 | 作り方 |
|---|---|---|
| 標準 | 本5冊・本棚1つ | `tests/fixtures/fixture-userdata.json`・`fixture-library.json`（visual と同じ） |
| 多数 | 本780冊・本棚12 | `tests/perf/fixtures/gen-scale.mjs` の `genScale({ shelves: 12, perShelf: 130 })` |
| 長い名前 | 本5冊・本棚3つ（2段の入れ子）。本の題は全角120字、著者は10人、本棚名は全角40字、記事の題は全角80字、短文メモは全角300字、ユーザー名は入力欄の上限いっぱい。題の1つは空白の無い英数40字を含む | `tests/fixtures/audit/` に新しく置く |

- 外部への通信は全部止める（`tests/e2e/helpers/test-base.js` の経路。表紙は固定の画像に差し替える）。
- 絵文字はデータに入れない（絵文字のフォントは環境で違う）。
- 多数のデータで1画面の検査が10秒を超える時は、本を300冊へ減らし、実測値と理由を結果に書く。

## 3. 巡回の組合せ

| 検査 | 画面 | 幅 | データ | テーマ |
|---|---|---|---|---|
| 表示崩れ | 全画面 | 6幅 | 3種 | ライト |
| 名前の無い部品 | 全画面 | 6幅 | 標準 | ライトとダーク |
| ボタン名の揺れ | 全画面 | 6幅 | 標準 | ライト |

- 6幅は `tests/char-devices.js` の `CHAR_DEVICES`（390・768・820・1024・1440・1920）を import して使う。390〜1024 はタッチ、1440・1920 はマウス。
- ダークは標準プラグイン `dark-theme` を有効にした状態（`body.plugin-dark`）。
- 同じ訪問で複数の検出器を流してよい（結果は同じ）。
- 設定は `playwright.audit.config.js`（`playwright.config.js` は変えない）。実行には `PORT` と `PLAYWRIGHT_BASE_URL` を必ず付ける。

## 4. 環境をそろえる手当て

検出の件数が、実行する機械で変わらないようにする。

- フォント：起動関数が、ページと同一オリジンの iframe の全部に `font-family: "Noto Sans CJK JP" !important` を入れる。アイコン用のフォントを使う要素には入れない。CI は `fonts-noto-cjk` を入れる。
- 検査の最初に、本文の文字が実際に Noto Sans CJK JP で描かれたことを確かめる（Chromium の `CSS.getPlatformFontsForNode`）。違う時は、件数を比べずに「フォントが違う」で落とす。
- 時刻は固定する（`page.clock`）。アニメーションと遷移は止める。`document.fonts.ready` を待ってから測る。
- 基準値は1つ。環境ごとに分けない。

## 5. 判定の決まり

### 5-1. 件数の数え方（共通）

- 要素の識別子：一番近い「id を持つ祖先」から対象までを、タグ名と最初のクラス名でつないだもの。数字の並びと ASIN は `*` に置き換える。何番目の子かは入れない（一覧の780枚のカードは1つの識別子になる）。
- 1件の単位は下の表。同じ単位の中で、データやテーマだけが違うものは1件にまとめる。

| 検査 | 1件の単位 |
|---|---|
| 用語表 | 文言の場所（ファイル:行）× 使わない語 |
| ボタン名の揺れ | 操作キーごとの（名前の種類の数 − 1）の合計 |
| 名前の無い部品 | 種類 × 画面ID × 要素の識別子 |
| 表示崩れ | 種類 × 画面ID × 要素の識別子 × 幅 |

### 5-2. 用語表（`lint:terms`）

- 正本は `docs/ui-terms.json`。`docs/ui-standards.md` §3 の表は人が読むための写しで、「正」「使わない」の列が JSON と食い違ったら `lint:terms` が落ちる。
- JSON の形：

```json
{
  "terms": [
    { "id": "hub", "preferred": ["Asayake ハブ", "ハブ"],
      "avoid": [{ "pattern": "Hub", "notInside": ["GitHub"] }, { "pattern": "hub", "notInside": ["GitHub", "github"] }],
      "note": "初出はフル、以後「ハブ」可" }
  ],
  "jargon": [
    { "id": "json", "avoid": ["JSON"], "allowTexts": ["JSONで書き出す"], "note": "ファイル形式の明示が要る場面は可" }
  ]
}
```

- 照合は部分一致で、大文字と小文字を区別する。
- `notInside`：その語を含む別の語の中に出た時は当てない（「Hub」を「GitHub」に、「拡張」を「拡張子」に当てない）。
- URL・メールアドレス・〈値〉の中は当てない。
- `jargon`（ブックマークレット・リレー・JSON・CSRF・ETag）は、`allowTexts` に載せた文言だけ許す。載せる時は理由を `note` に書く。
- 種類は `table`（用語表の行）と `jargon`（専門用語）の2つ。
- 合否に入れるのは、抽出の kind が app・public・error・ogp の文言。legal は件数と一覧を出すだけで、合否に入れない。

### 5-3. 文言の表記（`lint:copy`）

- 今と同じ textlint（`.textlintrc.json`）を、広げた抽出（§7）に流す。
- 合否に入れる kind と legal の扱いは、用語表と同じ。

### 5-4. ボタン名の揺れ（`audit:buttons`）

- 集めるもの：見えている `button`・`[role=button]`・`a.btn`・`input[type=button|submit]`。名前は、aria-label、中の文字、title の順で最初にあるもの。前後の空白を取り、続く空白は1つにする。名前が空のものは、この検査では数えない（§5-5 で数える）。
- 操作キーは、次の順で最初に当たったものを付ける。

| 順 | 条件 | 操作キー |
|---|---|---|
| 1 | `data-act` がある | `act:<値>` |
| 2 | 確認ダイアログの取消ボタン | `confirm:cancel` |
| 3 | `.modal-close`、または id が `-close` で終わる | `std:close` |
| 4 | id かクラスが `-back` で終わる | `std:back` |
| 5 | id が `-cancel` で終わる | `std:cancel` |
| 6 | id が `-save` で終わる | `std:save` |
| 7 | id が `-done` で終わる | `std:done` |
| 8 | id が `-delete` で終わる | `std:delete` |
| — | どれにも当たらない | 未分類 |

- 確認ダイアログの実行ボタン（`okLabel`）は、操作ごとに名前が違うのが正しいので、揺れの判定に入れない。
- `confirmDialog` の呼び出しにある `cancelLabel` は、抽出（§7）から読み、`confirm:cancel` の名前に加える（巡回で開かなかったダイアログも見るため）。
- 揺れ：1つの操作キーに名前が2種類以上あること。件数は（種類の数 − 1）の合計。
- 未分類のボタンは、件数と一覧を出すだけで、合否に入れない。
- 「名前が違ってよい」組の除外は、最初は空。足すのは「監査の一覧」イシューで判断が出た後で、理由を書く。

### 5-5. 名前の無い部品（`audit:a11y-names`）

- 対象：見えている `button`・`[role=button]`・`a[href]`・`input`（hidden 以外）・`select`・`textarea`・`img`・`[role=img]`・`summary`・`iframe`。`aria-hidden` か `inert` の祖先を持つ要素は対象外（背後の面は、その面を開いた時に数える）。
- 自前の判定。次のどれかに空白以外の文字があれば「名前あり」。
  - `aria-labelledby` の参照先、`aria-label`
  - 入力：対応する `label`
  - 画像：`alt`
  - ボタン・リンク：中の文字（中の画像の `alt` を含む）
  - `title`、`input[type=button|submit]` の `value`
- 画像は、`alt` 属性そのものが無い時に検出する。`alt=""` は飾りとして扱い、検出しない。ただし、その画像だけが中身のボタン・リンクに名前が無ければ、ボタン・リンクを検出する。
- 入力が `placeholder` しか持たない時は、別の種類（`inputPlaceholderOnly`）で検出する。
- axe は、名前に関するルールだけを流す：`button-name`・`link-name`・`image-alt`・`input-image-alt`・`input-button-name`・`label`・`select-name`・`aria-command-name`・`aria-input-field-name`・`aria-toggle-field-name`・`role-img-alt`・`svg-img-alt`・`summary-name`・`frame-title`。
- 種類は、自前が `button`・`link`・`image`・`input`・`inputPlaceholderOnly`・`select`・`other`、axe が `axe`（ルールID × 要素の識別子）。

### 5-6. 表示崩れ（`audit:layout`）

共通の決まり

- 対象：見えている要素（`checkVisibility` が真、幅と高さが0より大きい、`inert` の祖先が無い）。スクロールしないと見えない位置の要素も対象。
- `content-visibility` で描画を省かれた要素は対象外。
- 同一オリジンの iframe の中（公開プレビュー・記事のキャンバス）も同じ決まりで見る。
- 許容は1px。差が1px以下なら検出しない。

| 種類 | 検出する条件 | 対象外 |
|---|---|---|
| `clip`（文字の切れ） | 直下に文字を持つ要素で、overflow が hidden か clip の向きに、`scrollWidth − clientWidth` か `scrollHeight − clientHeight` が1pxを超える | 入力欄（中でスクロールできる）。overflow が auto・scroll の箱 |
| `overflow`（はみ出し） | 子の矩形が、親の枠の外に1pxを超えて出ている。親の overflow が visible なら見えてはみ出している、hidden・clip なら切られている | 親が auto・scroll（スクロールできる）。子の position が absolute・fixed・sticky。display が inline の要素 |
| `pageX`（横スクロール） | 文書の `scrollWidth − clientWidth` が1pxを超える（1画面×1幅で1件） | — |
| `overlap`（重なり） | 同じ親の直下の兄弟2つの矩形が、幅も高さも1pxを超えて交差している | どちらかの position が absolute・fixed・sticky。display が inline の要素 |

- 分かっている限界：position を指定した要素が親に切られている場合と、マウスを載せた時だけ出る表示は、検出できない。

除外リスト `tests/audit/layout-allowlist.json`

```json
[{ "kind": "clip", "selector": ".book-title", "screens": ["shelf"], "reason": "題は1行で省略する設計" }]
```

- 載せてよいのは、設計として意図した省略・重ねだけ。`reason` は必須。検出を減らす目的で足さない。迷うものは載せずに一覧へ残す。
- `clip` の除外は、その要素に `text-overflow: ellipsis` か行数の制限（line-clamp）が実際に付いている時だけ効く。付いていない要素は、除外リストにあっても検出する。
- どの要素にも当たらなかった除外の行は、警告に出す（落とさない）。

## 6. 基準値

- 置き場は `tests/audit/baseline.json`。検査 × 種類ごとの件数の上限を持つ。

```json
{
  "copy": { "textlint": 0 },
  "terms": { "table": 0, "jargon": 0 },
  "buttons": { "variants": 0 },
  "a11y": { "axe": 0, "button": 0, "link": 0, "image": 0, "input": 0, "inputPlaceholderOnly": 0, "select": 0, "other": 0 },
  "layout": { "clip": 0, "overflow": 0, "pageX": 0, "overlap": 0 }
}
```

- 上の数字は形の例。実際の上限は、実測した今の件数を入れる。
- 実測が上限を超えた種類が1つでもあれば exit 1。超えた種類・件数・増えた識別子を表示する。
- 実測が上限以下なら exit 0。下回った時は「上限を下げられる」と表示するだけで、落とさない（`scripts/check-test-internal-refs.mjs` の `MAX` と同じ動き）。
- 上限を上げる commit は、本文に理由と前後の件数を書く。
- 検出の一覧は `tests/audit/findings/<検査>.json` に commit して残す（識別子を並べ替えて保存）。実行のたびに、今回の一覧との差（増えた識別子・消えた識別子）を表示する。この差では落とさない。件数が同じまま中身が入れ替わったことを、報告で見えるようにするためのもの。
- 記録する前に同じ検査を3回流し、一覧が3回とも同じであることを確かめる。

## 7. 文言の抽出（`scripts/extract-ui-strings.mjs`）

| kind | ソース | 拾うもの |
|---|---|---|
| app | `index.html` の body | 表示される文字と、placeholder・title・aria-label・alt |
| app | `js/*.js`・`js/screens/*.js`・`js/ui/*.js`（`js/vendor` は除く） | toast・confirm・alert の文字列。title・message・okLabel・cancelLabel の値。画面の HTML を組み立てる文字列の中の文字と、上の4属性 |
| error | 上と同じ JS と `cf-worker/*.js` | `new Error(…)` の文字列、応答の `error`・`message` の値、`js/ui-feedback.js` の既定の文言 |
| public | `js/publish-article-generator.js`、`cf-worker/top-page.js`・`report-page.js`・`suspended-page.js` | 公開ページに出る固定の文言 |
| ogp | `index.html` の head、上の公開ページの生成元、`manifest.webmanifest` | title・description・`og:*`・`twitter:*`・name・short_name |
| legal | `legal/*.html` | 本文 |

- 日本語を含む文字列だけを拾う。コメントは拾わない。`${…}` は〈値〉に置き換える。
- `cf-worker/seo.js`（robots.txt・sitemap）は、機械が読む出力なので対象外。
- 出力は2つ。
  - `_local/ui-strings.md`：textlint 用。今の形（`- 文言<!-- 場所 -->`）のまま。同じ文言は1行にまとめる。legal は `_local/ui-strings-legal.md` に分ける。
  - `_local/ui-strings.json`：場所つきの全件。重複もまとめない。1件は `{ "text", "src": "ファイル:行", "kind", "via" }`。`via` は拾い方（toast・okLabel・cancelLabel・attr:aria-label・text など）。
- 巡回で実際に画面へ出た文字のうち、抽出に無いものの数を「抽出もれ」として結果に出す（データ由来の文字は除く。合否に入れない）。

## 8. 直す範囲（明らかな誤字と表記）

直すのは、次の全部に当てはまるものだけ。

1. `lint:copy` か `lint:terms` が指摘した
2. 直し方が1通りに決まる（語の置き換えだけで済み、文を組み替えない）
3. 意味が変わらない
4. kind が app・error・ogp・public（legal は直さない）

直さずに一覧へ残すもの：ボタン名の揺れ、名前の無い部品、表示崩れ、legal の全部、言い回しとトーン、置き換え先が文脈で変わる語。

直した時は、E2E の期待値、`?v=`、visual の基準画像を同じ commit で直し、基準値を下げる。

## 9. 検査が検出できることの確かめ方（変異検査）

- 見本ページ（`tests/fixtures/audit/`）：誤りを入れた見本で、入れた数と同じ件数を検出すること。誤りの無い見本で0件であること。検出器ごとに `tests/audit/selftest/` に置き、毎回流す。
- 実画面：実行時に誤りを1つ入れる切替（環境変数 `AUDIT_PLANT`。ソースは書き換えない）で、対応する npm script が基準値の超過で exit 1 になること。入れる誤りは、aria-label を1つ外す・ボタン名を1つ変える・見出しを狭めて切る、の3つ。
- 文言：見本の文言に「インポート」を入れると `lint:terms` が exit 1 になること。

## 10. 実行の場所

| 検査 | npm script | CI |
|---|---|---|
| 文言の表記 | `lint:copy` | e2e レグの lint の並び |
| 用語表 | `lint:terms` | e2e レグの lint の並び |
| 名前の無い部品 | `audit:a11y-names` | audit レグ（check-run 名は「test (audit)」） |
| ボタン名の揺れ | `audit:buttons` | audit レグ |
| 表示崩れ | `audit:layout` | audit レグ |

- audit レグは3つの検査を最後まで流し、件数を `::notice::` で出す。
- audit レグの所要は5分以内を目安にする。
