# U6 step1 棚卸し（#523）

base: origin/main 521cfc3（計画時点より進んでいる。worktree issue-523 もこれから分岐）

## 1. 本のカード/行を描く関数（全件）

「約11関数」と正本は言うが、§2-2f の本文は recovered ファイル内に見当たらず、92行の表からの参照のみ
（未確認＝自分で grep して数え直した）。grep したところ **ちょうど11個**が「本1冊のカード/行」を描いている。

| # | ファイル:行 | 関数名 | 画面 | 出力DOM（主な違い） |
|---|---|---|---|---|
| 1 | bookshelf.js:2423 | `createBookElement(book, displayType)` | 本棚メイン一覧 | `.book-item` div。表紙img/placeholder、タイトル、著者、短文メモ、評価★、重複バッジ、チェックボックス（一括選択時） |
| 2 | bookshelf.js:2823 | `showBookDetail(book, ...)` | 本の詳細パネル | ヘッダー（表紙/タイトル/著者）＋本棚チップ＋メモ欄＋評価＋多数の操作ボタン。範囲が広く「カード」というより画面全体 |
| 3 | bookshelf.js:13523 | `renderBookList(books, existingASINs, excludedASINs)` | 取込候補一覧 | `.book-selection-item` div。チェックボックス＋タイトル(+状態ラベル)＋著者＋取得日＋Kindleバッジ。ボタン無し |
| 4 | bookshelf.js:13391 | `renderExclusionsList()` | 除外一覧 | `.exclusion-item` div。表紙img/空プレースホルダ＋タイトル＋著者＋「除外を取り消す」ボタン |
| 5 | bookshelf.js:1292 | `_renderPaletteResults(query)` | ⌘K検索結果 | `.cmdk-item-title`/`.cmdk-item-sub` を含む行（コマンド/本棚/本を混在。本の行部分のみ対象） |
| 6 | bookshelf.js:11691 | `_artRenderDrawer()` | 記事の引き出し | 本の行＋「追加」ボタン＋印（追加済み/pending）。引き出し全体のヘッダー・畳み制御も同じ関数に混在 |
| 7 | bookshelf.js:10688 | `_artRenderBlock(b, index)` | 記事の単品本ブロック | 本1冊カード＋ブロック操作バー（並び替えハンドル・削除等） |
| 8 | bookshelf.js:10879 | `_artRenderShelfBlock(b, index)` | 記事の本棚ブロック | 本棚ブロック内の本の行（複数）＋ブロック操作バー |
| 9 | bookshelf.js:10792 | `_artRenderShelfFs(b, index)` | 記事の本棚ブロック全画面編集 | `_artRenderShelfBlock` と同種の行を全画面シートに描画（並び替えUI付） |
| 10 | bookshelf.js:2401 | `_duplicateAsinBadgeItem(book)` | 上記複数画面から呼ばれる付属部品 | `<span class="book-badge book-badge-warn">` 1個（重複/ASIN共有バッジ） |
| 11 | dashboard.js:928 | `_renderRecentBooks(host, app, config)` | ホーム「最近追加した本」widget | `.widget-book-cell` button。表紙img/placeholder＋タイトルのみ。ボタン無し |

**対象から外した/別枠にしたもの**
- `publish-article-generator.js:561 _renderBookBlock` / `:584 _renderShelfBlock` — ②指示により描画対象から除外（公開ページHTML生成・CSS/文脈が別）。
- `bookshelf.js:9372 _artRenderList` — 記事そのものの一覧（本とは無関係・grep で本/asin/title に無関係と確認済み）。U7の対象。
- `bookshelf.js:11007 _artShowItemTooltip` / `:10656 _artRenderLookSheet` — 本の行ではなくツールチップ/見た目選択シート。対象外。
- `bookshelf.js:8348 renderBookshelfList` / `:14981 renderBookshelfOverview` / `:15029 _renderBookshelfCard` / `:1489 _renderBulkShelfList` / `dashboard.js:983 _renderBookshelfHighlights` — これらは**本棚（shelf）のカード/一覧**であり「本（book）のカード」ではない。brief のタイトルは「本の一覧・カード」なのでU6の対象外と判断（混同注意）。
- `ui-components.js` — 本棚の行専用（esc/keyOf/ツリー描画のみ、87行）。**本のカード関数は無し＝「未使用関数」も無し**。完了条件にある「ui-components.js の未使用関数の撤去/統合」は、調査時点では対象ゼロ。

**②への確認材料（設計判断が必要な3点）**
1. `showBookDetail`（#2）は本の詳細画面全体（226行超）で、カード1枚というより画面。ヘッダー部分（表紙・タイトル・著者）だけBookList経由にし、残りは個別のままにする設計でよいか。
2. `_artRenderDrawer`/`_artRenderBlock`/`_artRenderShelfBlock`/`_artRenderShelfFs`（#6-9）は記事エディタ固有のUI（ドラッグハンドル・畳み・pending印等）と一体化している。本1冊の行部分だけBookList化し、エディタ固有部分は残す設計でよいか。
3. `_renderPaletteResults`（#5）は本/本棚/コマンドを混在した⌘K結果で、本の行部分（2行だけ）をBookList化する価値があるか（効果が薄いなら対象外にする選択肢もある）。

grep の前後件数（完了条件用）: **変更前＝BookList経由0件（存在しない）／変更後＝上記11関数すべてが`BookList.render*`等を経由**（step3で実測し直す）。

## 2. HTML エスケープ関数（確認＝6つではなく **7つ**）

| # | ファイル:行 | 関数名 | 変換文字 | null/undefined/数値 | 実装 |
|---|---|---|---|---|---|
| A | bookshelf.js:2002 | `escapeHtml(text)` | 実質 `& < >` のみ（DOM直列化依存、`" '` は変換しない） | `div.textContent=text` → undefined/nullはブラウザ実装依存（空文字相当になりうるが未検証） | `div.textContent=text; return div.innerHTML` |
| B | bookshelf.js:3889 | `_escapeHtml(s)` | `& < > " '` 5文字 | `s\|\|''` → null/undefined/**0**/''が全部''になる（0が消える） | `String(s\|\|'').replace(...)` |
| C | bookshelf.js:13405（renderExclusionsList内ローカル） | `escapeHtml(s)` | `& < > " '` 5文字 | `s\|\|''` → Bと同じ（0が消える） | 同上（Bと**実装が完全一致**の複製） |
| D | dashboard.js:860 | `_escape(s)` | `& < > "` **4文字（`'`を変換しない）** | `s ?? ''` → null/undefinedのみ''、0は保持 | `String(s ?? '').replace(...)` |
| E | ui-components.js:11 | `esc(s)` | `& < > " '` 5文字 | `s==null?'':s` → null/undefinedのみ''、0は"0"のまま | `String(...)` |
| F | publish-article-generator.js:284 | `static esc(s)` | `& < > " '` 5文字 | `s==null?'':s`（Eと同じ） | Eと**実装が完全一致**の複製 |
| G | icons.js:417 | `_escapeXml(s)` | `& < > " '` 5文字 | **nullチェック無し**（`String(null)`→"null"という文字列になる） | `String(s).replace(...)` |

**変換文字集合で見た差**
- 5文字グループ（B・C・E・F・G）＝一番広い。②の判断基準（icons.jsの文字集合が同じか）に照らすと **G(_escapeXml)は5文字グループと同じ＝1本化に含められる**（nullチェックの有無だけが差）。
- D（dashboard._escape）は`'`を変換しない4文字＝タイトルに`'`を含む本があると、統一後は結果文字列が変わる（表示の見た目は同じになるはずだが、innerHTML文字列としては変わる＝スナップショット/文字列比較テストに影響しうる）。
- A（escapeHtml、DOM textContentトリック）は`" '`を変換しない。呼び出し箇所を全件確認したところ、**属性値コンテキスト**（`title="..."` `data-src="..."` `alt="..."` 等）で使われている箇所が複数ある（2408, 2501, 7572, 15143等）。統一後にエスケープが増えると、同様に見た目は変わらない想定だがinnerHTML文字列は変わる。

**publish-article-generator.js のnode読込み可否（②の確認依頼）**
`static esc`（F）は ES class の static method。これを共通ファイル（例 `js/ui/escape.js`）に出す場合、ブラウザは `<script>` 直読みでグローバル公開、node側は `tests/unit/*.test.js` から読む構成を確認した：`grep` で `publish-article-generator.test.js` の読込み方式を見ると `require`/`import` ではなく、生成器クラス自体を**グローバル変数越しに読む**実装パターンがbookshelf全体の前提（ビルド無しSPA）。共通エスケープを `js/ui/escape.js` に `window.BookshelfEscape = {...}` 形式で置き、node側テストは `vm`/`global` 経由で読み込む既存パターンに合わせれば両対応できる見込み（既存の単体テストの読込み方式を次ステップで実装時に実測する＝未確認のまま進める）。

**統一先の推奨**
- 変換文字：**5文字（`& < > " '`）**＝B/C/E/F/Gと同じ、最も広い集合。
- null/undefined：`s == null ? '' : String(s)` ＝E/F方式を採用（0を"0"のまま保持。B/Cの`s||''`方式は0が消えるバグ寄りの挙動なので引き継がない＝正本の「どの関数の動きに合わせるか決める」に対する③の提案）。
- 変わる入力（単体テストで固定すべき差分）：
  - `'`（シングルクオート）を含む文字列 → D(dashboard._escape)は現状非変換、統一後は`&#39;`になる
  - `"`（ダブルクオート）を含み属性値コンテキストで使われる文字列 → A(escapeHtml)は現状非変換、統一後は`&quot;`になる
  - `0`・空文字列 → B/C(`s||''`)は現状''になる、統一後は"0"のまま残る（0の場合のみ挙動が変わる＝該当呼び出し箇所に数値0が渡る経路があるか次ステップで要確認）
  - `null`/`undefined` → G(_escapeXml)は現状"null"/"undefined"という文字列になる、統一後は''になる

## 3. 単体テスト案・BookListオプション設計案

### 3-1 エスケープの差分固定テスト（tests/unit/escape.test.js 新設想定）
```
describe('統一後エスケープ関数', () => {
  test('& < > " \' をすべて実体参照に変換する', ...)
  test('null/undefined は空文字になる', ...)
  test('0 は "0" のまま残る（旧 _escapeHtml の ||\'\' 方式とは異なる仕様に決定）', ...)
  test('既存呼び出し元での具体的な入力例を固定（例: タイトルに\' を含む本・" を含む本）', ...)
});
```
旧6実装それぞれに対する「この入力でこう変わる」を期待値つきで残し、移行後に旧関数が削除されてもテストの意図が読めるようにする。

### 3-2 BookListのオプション設計（画面ごとの分岐を書き足さない）
`BookList.renderItem(book, opts)` / `BookList.renderList(books, opts)` のイメージで、画面差は以下のオプションで表す案：
- `variant`: `'card' | 'row'`（カード型か行型か）
- `showCheckbox`: boolean（取込候補一覧）
- `showActions`: `{ addButton, removeButton, ratingStars, ... }`（画面ごとのボタン有無）
- `stateLabel`: 文字列 or null（取込済み/除外済みラベル）
- `badge`: 重複バッジ等の付属部品を差し込むスロット
- `onSelect` / `onAction`: コールバック（画面側のイベント配線はBookList内に持ち込まない）

## 4. 性能の前値・画像基準の所在

- **画像の基準54枚の所在確定**：`tests/visual/screens.spec.js`（9テスト）× `tests/char-devices.js` の6端末project = **9×6=54**。設定は `playwright.visual.config.js`。比較は `scripts/verify/e2e-diff-main.mjs --visual`（work側単独の基準画像比較、base比較ではない）。②の事前回答どおり、`ux-p0-visual.spec.js` ではない。
- **性能の前値（実測）**：`PORT=8123 PLAYWRIGHT_BASE_URL=http://localhost:8123 npx playwright test tests/e2e/sort-perf-budget.spec.js` を実行（1 passed, 2.1分）。
  - `order`（並び順切替）: now=[91,90,85]ms vs base=[92,87,87]ms, ratio=1.029
  - `direction`（昇順降順）: now=[87,83,81]ms vs base=[86,85,80]ms, ratio=0.976
  - `drag`（ドラッグ）: now=[65,62,56]ms vs base=[64,74,60]ms, ratio=0.969
  - これは変更前(521cfc3)の値＝BookList移行後にstep4で同じテストを再実行し、ratioの悪化が無いことを確認する基準値として使う。

## まとめ（提出時点で未確定・②判断待ちの点）

1. 描画関数は「約11」ではなく**ちょうど11個**特定できた（本棚自体のカード関数は別枠と判断・除外）。
2. エスケープは「6つ」ではなく**7つ**（icons.js _escapeXml を含む）。文字集合は5つが5文字一致、1つ(dashboard._escape)が4文字、1つ(bookshelf.escapeHtml)がDOM依存で実質3文字。
3. 統一先は5文字+`s==null?'':String(s)`を推奨。
4. 上記「②への確認材料」3点（showBookDetailの範囲・記事エディタ系の切り出し方・⌘K結果の扱い）の回答待ち。
