# 監査の機械検査：今の検出結果（イシュー#585）

2026-11-14 の実測。決まりは `docs/audit/machine-checks.md`、基準値は `tests/audit/baseline.json`、検出の一覧は `tests/audit/findings/` にある。

## 流し方

```
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit          # 3検査を1回の訪問でまとめて (CI はこれ)
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit:a11y-names
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit:buttons
PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npm run audit:layout
npm run lint:copy
npm run lint:terms
```

- `npm run audit` は744件。ローカル（16コア・6並列）で216秒（ほかの作業で負荷が高い時に測った値）。

## 数え方の変更（step4 のやり直し）

- ポップオーバー・メニュー・バナー・シート・本の詳細の欄（17画面・`tests/audit/screens.js` の `scope`）は、その面の中だけを測る。背後の画面の崩れは、背後の画面の行で数える。
- 除外リストに、全部の画面で同じ形の省略（本のカードの題・著者・短文メモ、ウィジェットの題とウィジェットに並ぶ本の題）を載せた。

| 検査 | 種類 | 変える前 | 変えた後 |
|---|---|---|---|
| 名前の無い部品 | axe | 7 | 6 |
| 名前の無い部品 | input | 3 | 2 |
| 名前の無い部品 | inputPlaceholderOnly | 20 | 12 |
| 名前の無い部品 | select | 2 | 2 |
| ボタン名の揺れ | variants | 9 | 9 |
| 表示崩れ | clip | 353 | 70 |
| 表示崩れ | overflow | 94 | 30 |

## 文字の検査（step2）

| 検査 | 件数 | 中身 |
|---|---|---|
| 抽出 | 1894 | app 1540・error 113・public 68・ogp 7・legal 166 |
| lint:copy（textlint） | 117 | 半角かっこ 99・句読点 11・その他 7。legal は別に4件 |
| 用語表 | 1 | `js/screens/settings.js:1983`「公開エクスポート対象」。legal は別に4件 |

## ボタン名の揺れ（全画面×6幅・標準データ）

件数は9（操作キーごとの「名前の種類の数−1」の合計）。未分類のボタンは361件で、合否に入れない。

| 操作キー | 名前 | 出る所の例 |
|---|---|---|
| confirm:cancel | やめる・キャンセル・何もしない・編集を続ける・閉じる | 確認ダイアログ・同期衝突ダイアログ・抽出した cancelLabel |
| std:back | ← 設定・戻る・記事の一覧へ戻る | `#settings-back`・`#mobile-detail-back`・`#art-back` |
| std:cancel | キャンセル・閉じる | `#art-fs-cancel`・`#book-memo-fs-cancel`・`#art-pub-cancel` |
| std:close | ×・← ホーム・閉じる | `#add-book-modal-close` ほか・`#settings-modal-close`・`#art-sheet-close` |

## 名前の無い部品（全画面×6幅・標準データ・ライトとダーク）

| 画面 | 件数 |
|---|---|
| art-drawer | inputPlaceholderOnly 1 |
| art-edit | inputPlaceholderOnly 2 |
| art-fs | input 1・axe 1・inputPlaceholderOnly 1 |
| art-publish | inputPlaceholderOnly 1 |
| art-viewing | inputPlaceholderOnly 1 |
| book-detail | inputPlaceholderOnly 1 |
| book-memo | input 1・axe 1 |
| command-palette | inputPlaceholderOnly 1 |
| icon-picker | inputPlaceholderOnly 1 |
| import | inputPlaceholderOnly 1 |
| plugin-settings | axe 2 |
| popover-display | select 2・axe 2 |
| popover-search | inputPlaceholderOnly 1 |
| settings-cat | inputPlaceholderOnly 1 |

- input と axe の label：書式つきエディタの textarea（記事の文章ブロック・長文メモ）。axe の残りは、プラグイン設定の切替2件と、表示のポップオーバーの select 2件（`#cover-size`・`#sort-order`）。
- inputPlaceholderOnly：`#art-title`・`#art-drawer-search`・`#art-tag-input`・`#cmdk-input`・`#search-input`・`#plugin-search`・`#kindle-paste-input`・`#icon-picker-lucide-input`・本の詳細の短文メモ。

## 表示崩れ（全画面×6幅・データ3種）

| 画面 | 件数 |
|---|---|
| art-drawer | clip 12 |
| art-drawer-shelf-popover | clip 6 |
| art-edit | clip 12 |
| art-fs | overflow 7・clip 6 |
| book-memo | clip 6・overflow 7 |
| command-palette | clip 6 |
| home | clip 6・overflow 2 |
| home-edit | overflow 3・clip 6 |
| icon-picker | clip 6・overflow 1 |
| shelf | overflow 10・clip 4 |

要素の形ごと（上位）：`div.art-cover` clip 15・`div.art-drawer-item-title` clip 15・`p.bs-card-desc` clip 12・`div.CodeMirror-scroll` overflow 12・`span.amq-inner` overflow 10・`span.art-drawer-shelf-item-label` clip 6・`#book-memo-fs-title` clip 6・`span.cmdk-item-title` clip 6・`span.icon-picker-cell-name` clip 6・`div.book-cover-placeholder` clip 4。

- pageX（横スクロール）と overlap（重なり）は0件。
- 除外リストは7件：揺れの1件（空の本棚の題）と、全部の画面で同じ形の省略6件。ほかの省略表示（上の clip の多く）は一覧に残してあり、意図したものかどうかは「監査の一覧」で決める。
