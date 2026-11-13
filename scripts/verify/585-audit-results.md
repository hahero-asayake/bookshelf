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
| lint:copy（textlint） | 119 | 半角かっこ 101・句読点 11・その他 7。legal は別に4件。push 前の rebase で入った #584 の `js/ui-feedback.js:197`「(内容は伏せた)」の2件（開き・閉じ）を含む。下の全件の一覧は、その前の117件 |
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

## 直した誤字（0件）

このイシューでは直していない。直す範囲（`docs/audit/machine-checks.md` §8）に当てはまる候補はあるが、次の理由で「監査の一覧」へ回した。

| 候補 | 件数 | 直さなかった理由 |
|---|---|---|
| 半角のかっこ → 全角（jtf-style 4.3.1） | 99（開きと閉じを別に数える） | 置き換えは1通りだが、22ファイルの画面の文言にまたがる。文言を見ている E2E の期待値と visual の基準画像（字幅が変わる）に波及し、並行イシュー（#580 ほか）と index.html・js/ が重なる。まとめて直すかどうかを一覧で決めてから、1つのイシューで直すほうが安全 |
| 句読点（「...」→「…」など・1.2.1） | 11 | 置き換え先が文脈で変わる（「…」か「。」か） |
| 用語表「公開エクスポート対象」（js/screens/settings.js:1983） | 1 | 用語表の「正」は「全データを書き出す」で、この文脈には当てはまらない＝置き換え先が1通りに決まらない |

## 全件の一覧

「監査の一覧」イシューの入力。直すかどうかは、そちらで決める。

### 文言の表記（lint:copy・117 件）

| 場所 | 今の文言 | 規則 |
|---|---|---|
| js/bookshelf.js:445 | プラグインを読み込み中… (〈値〉/〈値〉) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:445 | プラグインを読み込み中… (〈値〉/〈値〉) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:2952 | 〈値〉 (空) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:2952 | 〈値〉 (空) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:3782 | 読み込み中... | 1.2.1.句点(。)と読点(、) |
| js/bookshelf.js:4222 | (ルート) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:4222 | (ルート) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:5446 | (同期先) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:5446 | (同期先) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:5453 | 同期フォルダが vault のサブフォルダ: vault 名を入力 (後でサブパスも聞きます) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:5453 | 同期フォルダが vault のサブフォルダ: vault 名を入力 (後でサブパスも聞きます) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:5458 | vault 内のサブパス (例: 40_reading) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:5458 | vault 内のサブパス (例: 40_reading) | 4.3.1.丸かっこ（） |
| js/bookshelf.js:6387 | 書籍情報を取得中... | 1.2.1.句点(。)と読点(、) |
| js/bookshelf.js:6389 | 取得中... | 1.2.1.句点(。)と読点(、) |
| js/dashboard.js:129 | 大きさ (スマホ) | 4.3.1.丸かっこ（） |
| js/dashboard.js:129 | 大きさ (スマホ) | 4.3.1.丸かっこ（） |
| js/dashboard.js:318 | ここにウィジェットを追加 (〈値〉 種) | 4.3.1.丸かっこ（） |
| js/dashboard.js:318 | ここにウィジェットを追加 (〈値〉 種) | 4.3.1.丸かっこ（） |
| js/dashboard.js:1072 | 自由メモ (localStorage に保存)... | 4.3.1.丸かっこ（） |
| js/dashboard.js:1072 | 自由メモ (localStorage に保存)... | 4.3.1.丸かっこ（） |
| js/hub-adapter.js:500 | Asayake ハブに接続していません (キー無し) | 4.3.1.丸かっこ（） |
| js/hub-adapter.js:500 | Asayake ハブに接続していません (キー無し) | 4.3.1.丸かっこ（） |
| js/hub-auth.js:99 | ハブ認証に失敗しました (〈値〉)〈値〉 | 4.3.1.丸かっこ（） |
| js/hub-auth.js:99 | ハブ認証に失敗しました (〈値〉)〈値〉 | 4.3.1.丸かっこ（） |
| js/hub-auth.js:141 | 使用量の取得に失敗しました (〈値〉) | 4.3.1.丸かっこ（） |
| js/hub-auth.js:141 | 使用量の取得に失敗しました (〈値〉) | 4.3.1.丸かっこ（） |
| js/hub-auth.js:180 | このユーザー名は使えません (3〜30文字の半角英数字とハイフン、予約語不可) | 4.3.1.丸かっこ（） |
| js/hub-auth.js:180 | このユーザー名は使えません (3〜30文字の半角英数字とハイフン、予約語不可) | 4.3.1.丸かっこ（） |
| js/hub-auth.js:182 | ユーザー名の設定に失敗しました (〈値〉) | 4.3.1.丸かっこ（） |
| js/hub-auth.js:182 | ユーザー名の設定に失敗しました (〈値〉) | 4.3.1.丸かっこ（） |
| js/plugin-loader.js:286 | ⚠️ プラグインは外部のコードとして実行されます。信頼できる配布元のものだけを導入してください。 | no-ai-list-formatting |
| js/plugin-loader.js:288 | (未指定) | 4.3.1.丸かっこ（） |
| js/plugin-loader.js:288 | (未指定) | 4.3.1.丸かっこ（） |
| js/publish-article-generator.js:702 | [通報] AsayakeBookshelf 公開記事 〈値〉 | 4.3.2.大かっこ［］ |
| js/publish-article-generator.js:702 | [通報] AsayakeBookshelf 公開記事 〈値〉 | 3.3.かっこ類と隣接する文字の間のスペースの有無 |
| js/publish-article-generator.js:1020 | 長文メモを読み込めなかったため公開を中止しました: 〈値〉 (接続を確認して再実行してください) | 4.3.1.丸かっこ（） |
| js/publish-article-generator.js:1020 | 長文メモを読み込めなかったため公開を中止しました: 〈値〉 (接続を確認して再実行してください) | 4.3.1.丸かっこ（） |
| js/publish-article-store.js:246 | 記事データが未読込のため保存できません (読込に失敗している可能性があります) | 4.3.1.丸かっこ（） |
| js/publish-article-store.js:246 | 記事データが未読込のため保存できません (読込に失敗している可能性があります) | 4.3.1.丸かっこ（） |
| js/publish-article-store.js:281 | 公開IDの生成に失敗しました (衝突が続きました) | 4.3.1.丸かっこ（） |
| js/publish-article-store.js:281 | 公開IDの生成に失敗しました (衝突が続きました) | 4.3.1.丸かっこ（） |
| js/screens/article-editor.js:2590 | (本棚がありません) | 4.3.1.丸かっこ（） |
| js/screens/article-editor.js:2590 | (本棚がありません) | 4.3.1.丸かっこ（） |
| js/screens/article-editor.js:3108 | (注意 〈値〉 件) | 4.3.1.丸かっこ（） |
| js/screens/article-editor.js:3108 | (注意 〈値〉 件) | 4.3.1.丸かっこ（） |
| js/screens/book-detail.js:200 | 本棚を追加... | 1.2.1.句点(。)と読点(、) |
| js/screens/book-detail.js:263 | 同じ本が複数登録されています(ASIN: 〈値〉)。統合・削除は必要ありません。 | 4.3.1.丸かっこ（） |
| js/screens/book-detail.js:263 | 同じ本が複数登録されています(ASIN: 〈値〉)。統合・削除は必要ありません。 | 4.3.1.丸かっこ（） |
| js/screens/book-detail.js:282 | 変更後 ASIN (オプション) | 4.3.1.丸かっこ（） |
| js/screens/book-detail.js:282 | 変更後 ASIN (オプション) | 4.3.1.丸かっこ（） |
| js/screens/book-detail.js:632 | 保存中... | 1.2.1.句点(。)と読点(、) |
| js/screens/bookshelf-list.js:69 | 本棚の操作 (編集) | 4.3.1.丸かっこ（） |
| js/screens/bookshelf-list.js:69 | 本棚の操作 (編集) | 4.3.1.丸かっこ（） |
| js/screens/bookshelf-list.js:69 | 本棚の操作 (編集 / 子追加 / 削除) | 4.3.1.丸かっこ（） |
| js/screens/bookshelf-list.js:69 | 本棚の操作 (編集 / 子追加 / 削除) | 4.3.1.丸かっこ（） |
| js/screens/import.js:108 | (取り込み済み) | 4.3.1.丸かっこ（） |
| js/screens/import.js:108 | (取り込み済み) | 4.3.1.丸かっこ（） |
| js/screens/import.js:108 | (除外済み・取り込みません) | 4.3.1.丸かっこ（） |
| js/screens/import.js:108 | (除外済み・取り込みません) | 4.3.1.丸かっこ（） |
| js/screens/import.js:223 | 取込データに同じASINの本が複数含まれています(〈値〉件)。重複したまま取り込まれます。 | 4.3.1.丸かっこ（） |
| js/screens/import.js:223 | 取込データに同じASINの本が複数含まれています(〈値〉件)。重複したまま取り込まれます。 | 4.3.1.丸かっこ（） |
| js/screens/import.js:499 | 件)が「Active」のみの件数( | 4.3.1.丸かっこ（） |
| js/screens/import.js:499 | 件)が「Active」のみの件数( | 4.3.1.丸かっこ（） |
| js/screens/import.js:499 | 件)を下回りました。 | 4.3.1.丸かっこ（） |
| js/screens/import.js:640 | コピーしました。bookshelf の設定 → 取込 → 「取込データを直接渡す」に貼り付けてください。 | 3.3.かっこ類と隣接する文字の間のスペースの有無 |
| js/screens/settings.js:205 | 戻りました、3秒後に再取得します... | 1.2.1.句点(。)と読点(、) |
| js/screens/settings.js:207 | 再取得中... | 1.2.1.句点(。)と読点(、) |
| js/screens/settings.js:229 | (取得中...) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:229 | (取得中...) | 1.2.1.句点(。)と読点(、) |
| js/screens/settings.js:229 | (取得中...) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:236 | (まず repo を選択してください) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:236 | (まず repo を選択してください) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:254 | (空) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:254 | (空) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:260 | (これはディレクトリではなくファイルです) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:260 | (これはディレクトリではなくファイルです) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:293 | (取得失敗: 〈値〉) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:293 | (取得失敗: 〈値〉) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:312 | (ユーザ取得中) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:312 | (ユーザ取得中) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:334 | (repo 選択後に取得) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:334 | (repo 選択後に取得) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:338 | (GitHub App 未インストール) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:338 | (GitHub App 未インストール) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:464 | 以前の公開先「〈値〉」にサイトが残っています。完全に消すには、公開先を「〈値〉」に戻し、全ページを「公開を取り消す」で取り消してから再公開（空にする）してくださ | no-ai-hype-expressions |
| js/screens/settings.js:619 | GitHub で承認されるのを待っています... | 1.2.1.句点(。)と読点(、) |
| js/screens/settings.js:730 | (接続済み) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:730 | (接続済み) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:988 | (ログイン済み) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:988 | (ログイン済み) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:1073 | 変更後の名前 (現在: 〈値〉) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:1073 | 変更後の名前 (現在: 〈値〉) | 4.3.1.丸かっこ（） |
| js/screens/settings.js:1118 | 〈値〉 まで利用可能 ・ その後 無料プランに戻ります | 3.1.2.全角文字どうし |
| js/screens/settings.js:1400 | 接続確認中... | 1.2.1.句点(。)と読点(、) |
| js/screens/settings.js:1418 | 保存しました。ページをリロードします... | 1.2.1.句点(。)と読点(、) |
| js/screens/settings.js:2523 | 同期先 (ローカルフォルダ or GitHub) を先に接続してください。 | 4.3.1.丸かっこ（） |
| js/screens/settings.js:2523 | 同期先 (ローカルフォルダ or GitHub) を先に接続してください。 | 4.3.1.丸かっこ（） |
| js/storage-adapter.js:128 | 通信がタイムアウトしました (〈値〉ms): 〈値〉 | 4.3.1.丸かっこ（） |
| js/storage-adapter.js:128 | 通信がタイムアウトしました (〈値〉ms): 〈値〉 | 4.3.1.丸かっこ（） |
| js/storage-adapter.js:167 | 〈値〉がタイムアウトしました (〈値〉ms) | 4.3.1.丸かっこ（） |
| js/storage-adapter.js:167 | 〈値〉がタイムアウトしました (〈値〉ms) | 4.3.1.丸かっこ（） |
| js/ui/book-list.js:37 | 同じ本が複数登録されています(統合・削除の必要はありません) | 4.3.1.丸かっこ（） |
| js/ui/book-list.js:37 | 同じ本が複数登録されています(統合・削除の必要はありません) | 4.3.1.丸かっこ（） |
| cf-worker/asayake-hub.js:409 | account not found (まだログインしていない可能性) | 4.3.1.丸かっこ（） |
| cf-worker/asayake-hub.js:409 | account not found (まだログインしていない可能性) | 4.3.1.丸かっこ（） |
| cf-worker/asayake-hub.js:1564 | (コメント) | 4.3.1.丸かっこ（） |
| cf-worker/asayake-hub.js:1564 | (コメント) | 4.3.1.丸かっこ（） |
| cf-worker/backup.js:73 | --remote --file=d1.sql` (本番への書き込みは人間の承認を経る) | 4.3.1.丸かっこ（） |
| cf-worker/backup.js:73 | --remote --file=d1.sql` (本番への書き込みは人間の承認を経る) | 4.3.1.丸かっこ（） |
| cf-worker/backup.js:130 | 予定 〈値〉 回 > 上限 〈値〉 回 (KV 〈値〉・R2 〈値〉) | 4.3.7.山かっこ<> |
| cf-worker/backup.js:130 | 予定 〈値〉 回 > 上限 〈値〉 回 (KV 〈値〉・R2 〈値〉) | 4.3.1.丸かっこ（） |
| cf-worker/backup.js:130 | 予定 〈値〉 回 > 上限 〈値〉 回 (KV 〈値〉・R2 〈値〉) | 4.3.1.丸かっこ（） |
| cf-worker/backup.js:262 | 【バックアップ警告】bookshelf ハブ／前回の成功より件数が半分未満に減った (〈値〉→〈値〉)ため、古い世代の間引きを止めました。 | 4.3.1.丸かっこ（） |
| cf-worker/backup.js:262 | 【バックアップ警告】bookshelf ハブ／前回の成功より件数が半分未満に減った (〈値〉→〈値〉)ため、古い世代の間引きを止めました。 | 4.3.1.丸かっこ（） |
| cf-worker/report-page.js:97 | 通報には Asayake アカウントへの Google ログインが必要です(このページ上で完結します。他サイトには移動しません)。 | 4.3.1.丸かっこ（） |
| cf-worker/report-page.js:97 | 通報には Asayake アカウントへの Google ログインが必要です(このページ上で完結します。他サイトには移動しません)。 | 4.3.1.丸かっこ（） |

### 用語表（lint:terms・1 件）

- [table] js/screens/settings.js:1993 「公開エクスポート対象」 ← 使わない語「エクスポート」（正：全データを書き出す）

### 名前の無い部品（識別子 22 件）

| 種類 | 画面 | 要素 |
|---|---|---|
| axe | art-fs | label: #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div > textarea |
| axe | book-memo | label: #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div > textarea |
| axe | plugin-settings | label: #plugin-settings-modal > div.psm-panel > div.psm-body > div.psm-enable-card > label.toggle-switch > input.psm-toggle-input |
| axe | plugin-settings | label: #plugin-settings-modal > div.psm-panel > div.psm-body > div.psm-section > div.psm-field > label.toggle-switch > input.psm-show-icon-input |
| axe | popover-display | select-name: #cover-size |
| axe | popover-display | select-name: #sort-order |
| inputPlaceholderOnly | art-drawer | #art-drawer-search |
| inputPlaceholderOnly | art-edit | #art-drawer-search |
| inputPlaceholderOnly | art-edit | #art-title |
| inputPlaceholderOnly | art-fs | #art-drawer-search |
| inputPlaceholderOnly | art-publish | #art-tag-input |
| inputPlaceholderOnly | art-viewing | #art-title |
| inputPlaceholderOnly | book-detail | #bd-sections > div.bd-section > div.bd-section-body > div.bd-memo-block > textarea.note-textarea |
| inputPlaceholderOnly | command-palette | #cmdk-input |
| inputPlaceholderOnly | icon-picker | #icon-picker-lucide-input |
| inputPlaceholderOnly | import | #kindle-paste-input |
| inputPlaceholderOnly | popover-search | #search-input |
| inputPlaceholderOnly | settings-cat | #plugin-search |
| input | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div > textarea |
| input | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div > textarea |
| select | popover-display | #cover-size |
| select | popover-display | #sort-order |

### ボタン名の揺れ（識別子 13 件）

| 種類 | 操作キー | 名前 |
|---|---|---|
| variants | confirm:cancel | やめる |
| variants | confirm:cancel | キャンセル |
| variants | confirm:cancel | 何もしない |
| variants | confirm:cancel | 編集を続ける |
| variants | confirm:cancel | 閉じる |
| variants | std:back | ← 設定 |
| variants | std:back | 戻る |
| variants | std:back | 記事の一覧へ戻る |
| variants | std:cancel | キャンセル |
| variants | std:cancel | 閉じる |
| variants | std:close | × |
| variants | std:close | ← ホーム |
| variants | std:close | 閉じる |

### 表示崩れ（識別子 100 件）

| 種類 | 画面 | 要素 | 幅 |
|---|---|---|---|
| clip | art-drawer-shelf-popover | #art-drawer-shelf-list > button.art-drawer-shelf-item > span.art-drawer-shelf-item-label | char-1024 |
| clip | art-drawer-shelf-popover | #art-drawer-shelf-list > button.art-drawer-shelf-item > span.art-drawer-shelf-item-label | char-1440 |
| clip | art-drawer-shelf-popover | #art-drawer-shelf-list > button.art-drawer-shelf-item > span.art-drawer-shelf-item-label | char-1920 |
| clip | art-drawer-shelf-popover | #art-drawer-shelf-list > button.art-drawer-shelf-item > span.art-drawer-shelf-item-label | char-390 |
| clip | art-drawer-shelf-popover | #art-drawer-shelf-list > button.art-drawer-shelf-item > span.art-drawer-shelf-item-label | char-768 |
| clip | art-drawer-shelf-popover | #art-drawer-shelf-list > button.art-drawer-shelf-item > span.art-drawer-shelf-item-label | char-820 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-cover | char-1024 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-cover | char-1440 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-cover | char-1920 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-cover | char-390 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-cover | char-768 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-cover | char-820 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-1024 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-1440 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-1920 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-390 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-768 |
| clip | art-drawer | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-820 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-cover | char-1024 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-cover | char-1440 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-cover | char-1920 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-cover | char-390 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-cover | char-768 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-cover | char-820 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-1024 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-1440 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-1920 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-390 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-768 |
| clip | art-edit | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-820 |
| clip | art-fs | #art-drawer-list > div.art-drawer-item > div.art-cover | char-390 |
| clip | art-fs | #art-drawer-list > div.art-drawer-item > div.art-cover | char-768 |
| clip | art-fs | #art-drawer-list > div.art-drawer-item > div.art-cover | char-820 |
| clip | art-fs | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-390 |
| clip | art-fs | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-768 |
| clip | art-fs | #art-drawer-list > div.art-drawer-item > div.art-drawer-item-title | char-820 |
| clip | book-memo | #book-memo-fs-title | char-1024 |
| clip | book-memo | #book-memo-fs-title | char-1440 |
| clip | book-memo | #book-memo-fs-title | char-1920 |
| clip | book-memo | #book-memo-fs-title | char-390 |
| clip | book-memo | #book-memo-fs-title | char-768 |
| clip | book-memo | #book-memo-fs-title | char-820 |
| clip | command-palette | #cmdk-results > div.cmdk-item > span.cmdk-item-title | char-1024 |
| clip | command-palette | #cmdk-results > div.cmdk-item > span.cmdk-item-title | char-1440 |
| clip | command-palette | #cmdk-results > div.cmdk-item > span.cmdk-item-title | char-1920 |
| clip | command-palette | #cmdk-results > div.cmdk-item > span.cmdk-item-title | char-390 |
| clip | command-palette | #cmdk-results > div.cmdk-item > span.cmdk-item-title | char-768 |
| clip | command-palette | #cmdk-results > div.cmdk-item > span.cmdk-item-title | char-820 |
| clip | home-edit | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-1024 |
| clip | home-edit | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-1440 |
| clip | home-edit | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-1920 |
| clip | home-edit | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-390 |
| clip | home-edit | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-768 |
| clip | home-edit | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-820 |
| clip | home | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-1024 |
| clip | home | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-1440 |
| clip | home | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-1920 |
| clip | home | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-390 |
| clip | home | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-768 |
| clip | home | #widget-bookshelves-grid-host > div.bookshelf-preview > p.bs-card-desc | char-820 |
| clip | icon-picker | #icon-picker-grid > div.icon-picker-section > button.icon-picker-cell > span.icon-picker-cell-name | char-1024 |
| clip | icon-picker | #icon-picker-grid > div.icon-picker-section > button.icon-picker-cell > span.icon-picker-cell-name | char-1440 |
| clip | icon-picker | #icon-picker-grid > div.icon-picker-section > button.icon-picker-cell > span.icon-picker-cell-name | char-1920 |
| clip | icon-picker | #icon-picker-grid > div.icon-picker-section > button.icon-picker-cell > span.icon-picker-cell-name | char-390 |
| clip | icon-picker | #icon-picker-grid > div.icon-picker-section > button.icon-picker-cell > span.icon-picker-cell-name | char-768 |
| clip | icon-picker | #icon-picker-grid > div.icon-picker-section > button.icon-picker-cell > span.icon-picker-cell-name | char-820 |
| clip | shelf | #bookshelf > div.book-item > div.book-cover-container > div.book-cover-link > div.book-cover-placeholder | char-1024 |
| clip | shelf | #bookshelf > div.book-item > div.book-cover-container > div.book-cover-link > div.book-cover-placeholder | char-1440 |
| clip | shelf | #bookshelf > div.book-item > div.book-cover-container > div.book-cover-link > div.book-cover-placeholder | char-1920 |
| clip | shelf | #bookshelf > div.book-item > div.book-cover-container > div.book-cover-link > div.book-cover-placeholder | char-390 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-1024 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-1440 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-1920 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-390 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-768 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-820 |
| overflow | art-fs | #art-blocks > div.art-block > div.art-fs-text-editor > div.EasyMDEContainer > div.editor-toolbar > button.preview > span.mde-tb-lbl | char-390 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-1024 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-1440 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-1920 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-390 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-768 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.CodeMirror > div.CodeMirror-scroll | char-820 |
| overflow | book-memo | #book-memo-modal > div.modal-content > div.modal-body > div.EasyMDEContainer > div.editor-toolbar > button.preview > span.mde-tb-lbl | char-390 |
| overflow | home-edit | #dashboard-grid > div.dashboard-widget > div.widget-body > div.widget-big-number > span.bn-sub | char-1024 |
| overflow | home-edit | #dashboard-grid > div.dashboard-widget > div.widget-body > div.widget-big-number > span.bn-value | char-1024 |
| overflow | home-edit | #dashboard-grid > div.dashboard-widget > div.widget-header > span.widget-actions | char-1024 |
| overflow | home | #dashboard-grid > div.dashboard-widget > div.widget-body > div.widget-big-number > span.bn-sub | char-1024 |
| overflow | home | #dashboard-grid > div.dashboard-widget > div.widget-body > div.widget-big-number > span.bn-value | char-1024 |
| overflow | icon-picker | #icon-picker-lucide-use | char-390 |
| overflow | shelf | #current-bookshelf-desc > span.amq-inner | char-1024 |
| overflow | shelf | #current-bookshelf-desc > span.amq-inner | char-1440 |
| overflow | shelf | #current-bookshelf-desc > span.amq-inner | char-1920 |
| overflow | shelf | #current-bookshelf-desc > span.amq-inner | char-390 |
| overflow | shelf | #current-bookshelf-desc > span.amq-inner | char-768 |
| overflow | shelf | #current-bookshelf-desc > span.amq-inner | char-820 |
| overflow | shelf | #current-bookshelf-title > span.amq-inner | char-1024 |
| overflow | shelf | #current-bookshelf-title > span.amq-inner | char-390 |
| overflow | shelf | #current-bookshelf-title > span.amq-inner | char-768 |
| overflow | shelf | #current-bookshelf-title > span.amq-inner | char-820 |
