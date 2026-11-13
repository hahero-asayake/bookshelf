# 監査の機械検査：今の検出結果（イシュー#585）

2026-11-14 の実測。決まりは `docs/audit/machine-checks.md`、基準値は `tests/audit/baseline.json`、検出の一覧は `tests/audit/findings/` にある。

## 流し方

```
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit:a11y-names
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit:buttons
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit:layout
npm run lint:copy
npm run lint:terms
```

## 文字の検査（step2）

| 検査 | 件数 | 中身 |
|---|---|---|
| 抽出 | 1894 | app 1540・error 113・public 68・ogp 7・legal 166 |
| lint:copy（textlint） | 117 | 半角かっこ 99・句読点 11・その他 7。legal は別に4件 |
| 用語表 | 1 | `js/screens/settings.js:1983`「公開エクスポート対象」。legal は別に4件 |

## ボタン名の揺れ（全画面×6幅・標準データ）

件数は9（操作キーごとの「名前の種類の数−1」の合計）。未分類のボタンは637件で、合否に入れない。

| 操作キー | 名前 | 出る所の例 |
|---|---|---|
| confirm:cancel | やめる・キャンセル・何もしない・編集を続ける・閉じる | 確認ダイアログ・同期衝突ダイアログ・抽出した cancelLabel |
| std:back | ← 設定・戻る・記事の一覧へ戻る | `#settings-back`・`#mobile-detail-back`・`#art-back` |
| std:cancel | キャンセル・閉じる | `#art-fs-cancel`・`#art-pub-cancel` |
| std:close | ×・← ホーム・閉じる | `#add-book-modal-close` ほか・`#settings-modal-close`・`#art-sheet-close` |

## 名前の無い部品（全画面×6幅・標準データ・ライトとダーク）

| 種類 | 件数 | 中身 |
|---|---|---|
| axe | 7 | label 5（書式つきエディタの textarea 3・プラグイン設定の切替 2）・select-name 2（`#cover-size`・`#sort-order`） |
| input | 3 | 書式つきエディタの textarea（記事の文章ブロック・長文メモ） |
| inputPlaceholderOnly | 20 | `#art-title`・`#art-drawer-search`・`#cmdk-input`・`#search-input`・`#plugin-search`・`#kindle-paste-input` ほか |
| select | 2 | `#cover-size`・`#sort-order` |
| button・link・image・other | 0 | — |

同じ要素が複数の画面に出ると、画面の数だけ数える（例：`#art-title` は6画面）。

## 表示崩れ（全画面×6幅・データ3種）

| 種類 | 件数 |
|---|---|
| clip（文字の切れ） | 353 |
| overflow（はみ出し） | 94 |
| pageX（横スクロール） | 0 |
| overlap（重なり） | 0 |

要素の形ごとの件数（上位）

| 種類 | 要素 | 件数 |
|---|---|---|
| overflow | `span.amq-inner` | 60 |
| clip | `div.art-cover` | 39 |
| clip | `div.art-drawer-item-title` | 39 |
| clip | `div.widget-book-cell-title` | 37 |
| clip | `div.book-title`・`div.book-author`・`div.book-memo` | 各36 |
| clip | `div.widget-today-pick-title`・`p.bs-card-desc` | 各33 |
| clip | `div.book-cover-placeholder` | 24 |
| overflow | `div.CodeMirror-scroll` | 18 |
| clip | `#book-memo-fs-title` | 12 |

- 幅ごとの件数は、clip が57〜63、overflow が9〜27（1024 が最多）。
- ポップオーバーやバナーの画面は、背後の画面も測る。本棚の一覧の崩れ（clip 22・overflow 10）は、本棚の上に出る6画面のそれぞれで数えている。
- 除外リスト（`tests/audit/layout-allowlist.json`）は1件だけ。空の本棚の題（`#current-bookshelf-title`）で、検出が実行ごとに揺れたため外した。
- 省略表示を指定している CSS は39か所ある（`text-overflow: ellipsis` と行数の制限）。意図した省略かどうかの見直しは、まだしていない。上の clip の多くがこれに当たる。
