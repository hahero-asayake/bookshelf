# T03: ツールバー 4 動詞化 + 画像のみビュー

状態: ✅ 完了 (2026-06-12) / 依存: なし

## 目的

1. 第 3 のビュー **「画像のみ」(表紙ウォール)** を追加する: 表紙画像だけを敷き詰め、タイトル・著者・星・メモを一切出さない
2. それに合わせて本棚ツールバーを **4 動詞** に再構成する (ADR-023):
   - 検索 🔍 / **絞り込み (funnel)** = 評価のみ / **表示 (sliders)** = 表示形式 + 並び順 + 表紙サイズ / 選択 ☑
   - 現行は「表紙⇄リスト トグル」+「sliders に並び順・評価・サイズが同居」。評価 (絞り込み) と表示設定が混在しているのを分離する

## 現状の把握 (実装前に必ず読む)

- ツールバー DOM: `index.html` の `#bookshelf-toolbar` (約 120〜171 行付近)。`#toggle-search` / `#view-toggle` / `#toggle-filter` (popover 内: 並び順 `#sort-order`・評価 `#rating-seg`・表紙サイズ `#cover-size`) / `#toggle-select-mode`
- ビュー状態: `js/bookshelf.js` の `this.currentView` (`'covers' | 'list'`)、`setView(view)`、`createBookElement(book, displayType)` (約 1379 行〜)、`updateDisplay()` が `#bookshelf` に `view-X` クラスを付与
- 評価フィルタ: `this.ratingFilter` (Set) + `_updateRatingFilterUI()` + `#toggle-filter` の `.has-active-filter`
- ⌘K: `_paletteCommands()` に「表紙/リスト表示を切替」コマンドあり
- 設定: `settings.defaultView` (起動時ビュー)。設定モーダル「表示」セクションに該当 select があるか確認
- アイコン override キー: `view-toggle:covers` / `view-toggle:list` (`bookshelf_headerIconOverrides_v1`)

## 実装手順

### Step 1: 画像のみビュー (`'images'`)

1. `currentView` の取り得る値に `'images'` を追加。`setView('images')` が動くように分岐を確認
2. `createBookElement`: `displayType === 'images'` のとき:
   - `.book-cover-container` (drag-handle / 選択チェック / 表紙 or プレースホルダ) のみ生成し、**`.book-info` を出力しない**
   - 星 overlay・hover ポップ・長押しポップも**生成しない** (純粋な表紙ウォール)
   - 画像なしの本は従来のプレースホルダ (タイトル文字入り) でフォールバック
   - クリックで本詳細 / D&D 並び替え (カスタム順時) / 選択モードは covers と同じ挙動
3. CSS `.bookshelf.view-images`: covers のグリッドを流用しつつ `.book-item` の `contain-intrinsic-size` を表紙のみの高さに調整 (テキスト分を引く)。表紙サイズ設定 (`size-small/medium/large`) が効くこと。モバイルは 2 列 `minmax(0,1fr)` (COMMON の落とし穴参照) — 画像のみは 3 列にしてもよい (モバイルで `view-images` のみ `repeat(3, minmax(0,1fr))`)
4. `settings.defaultView` に `'images'` を許容。設定モーダルの該当 select に「画像のみ」を追加

### Step 2: ツールバー再構成

1. `index.html` のツールバーを 4 ボタンに:
   - `#toggle-search` (変更なし)
   - **`#toggle-filter`** … アイコンを `funnel` (Lucide) に変更。popover の中身を**「評価でしぼり込み」セクションのみ**に (rating-seg + リセット)。`.has-active-filter` 指標はこのボタンのまま
   - **`#toggle-display`** (新設) … アイコン `sliders-horizontal`。popover (`#display-popover`) に上から:
     1. **表示形式**: 連結セグメント `#view-seg` (`表紙 | 画像 | リスト`、`data-view="covers|images|list"`)。生成は rating-seg と同じパターン (`.rseg` 相当のクラスを流用 or 共通化)
     2. **並び順**: 既存 `#sort-order` + 方向ボタンを移設 (ID 維持でハンドラ温存)
     3. **表紙の大きさ**: 既存 `#cover-size` を移設 (リスト表示中は無効化 or 非表示にしない — 現状踏襲)
   - `#view-toggle` ボタンは**削除** (`_trash` 不要、DOM から除去)
   - `#toggle-select-mode` (変更なし)
2. `js/bookshelf.js`:
   - `#view-seg` クリック → `setView(value)` + セグメントの `.on` 更新。popover は**閉じない** (連続で試せるように)
   - `#toggle-display` の popover 開閉を既存 popover 機構 (popover-host) に乗せる
   - `view-toggle` 関連の不要コード (トグルハンドラ・`_updateViewToggleButton` の参照) を整理。ヘッダーアイコン override キー `view-toggle:*` の参照箇所を確認し、残骸でエラーが出ないように
   - ⌘K コマンドを「表示形式を切替」3 件 (表紙 / 画像のみ / リスト) に置き換え
3. モバイル (390px) で popover が画面内に収まること (右端揃え + `max-height:78vh`)

### Step 3: 永続化と整合

- ビュー切替は従来どおりセッション内state + `defaultView` 設定 (現行の保存挙動を確認し踏襲。現行が currentView を保存しているならそれも踏襲)
- `is-custom-order` クラス・draggable 制御が images ビューでも機能すること

## 受け入れ基準

1. 表紙 / 画像 / リストの 3 ビューが `#view-seg` で切替でき、画像ビューは**文字・星・メモが一切出ない**
2. 画像ビューで: クリック→詳細が開く / カスタム順で D&D 並び替えできる / 選択モードのチェックが出る / 画像なし本はプレースホルダ
3. 絞り込み (funnel): 評価セグメントが従来どおり動作し (未評価+★5 → 87 冊中 29 冊)、絞り込み中は funnel ボタンが点灯
4. 表示 popover: 並び順・表紙サイズが従来どおり動作 (カスタム順で方向ボタンが隠れヒント表示)
5. ⌘K から 3 ビューに切替できる
6. PC 1280px / モバイル 390px の両方でレイアウト崩れなし・console エラー 0
7. `?v=` バンプ済み

## 設計書同期

- 04_画面設計書: ツールバー節を 4 動詞構成に書き換え (funnel popover / 表示 popover の構成図)。本一覧節に images ビューを追記
- 01_要件定義書: F-08-1 を 3 ビューに、F-08-5 の 🔜 を削除
- 06_データ仕様書: `defaultView` の値域に `images` を追加
- 08_意思決定記録: ADR-023 は記録済み (追記不要)
- 07_残検討事項: T6 の「画像のみビュー」「ツールバー 4 動詞案」行を削除

## コミット

`feat: ツールバー4動詞化 + 画像のみビュー追加 (設計: 01/04/06 更新)`
