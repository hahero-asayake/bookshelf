# イシュー#770 公開エディタ一式をアプリに入れる — 結果

## §1 画像比較（tests/visual・公式コンテナ mcr.microsoft.com/playwright:v1.65.1-resolute）

撮り直す前に全54件（基準は PNG 66枚）を比べた。差が出たのは12枚で、どれも意図した変更。撮り直したのはこの12枚だけ（`-g "本棚の一覧|本の詳細|記事の編集|引き出し" --update-snapshots`・他の画像は変わっていない）。

| 画像 | 幅 | 差の中身 | 由来 |
|---|---|---|---|
| 03-bookshelf-list | 390 | 帯の右の道具の列の末尾に pencil の角ボタン（この本棚で記事を書く） | 9（#768） |
| 04-book-detail | 390・768・820・1024・1440・1920 | 閲覧中は帯の行が無く、鉛筆が表紙の段の右上に重なる | 8c（#768） |
| 08-article-edit | 1024・1440 | 編集状態に右の列（引き出し）が無く、記事の列が真ん中に来る | #759-2 |
| 09-drawer | 1024・1440・1920 | 本の引き出しが右の列でなく、画面の真ん中のシート（幕つき）で出る | #759-1 |

- 03-bookshelf-list の 768 以上は差が閾値（maxDiffPixelRatio 0.001）の中に収まった（角ボタン1つ分の画素）。
- 08-article-edit の 1920 は、前から記事の列が真ん中にあるため差が出ない。390・768・820 は前から引き出しがシートなので差が出ない。
- 見込み（08・04・03）より多かったのは 09-drawer で、#759-1（PC の引き出しを真ん中に）そのもの＝意図した差。

## §2 既存 E2E の手当て（chromium・決め5）

- 全件（`npx playwright test --project=chromium`・1143件）を流した。ログ：`_vault-work/770/logs/step5-e2e-all.log`。
- 新しく落ちた物はどれも同じ原因の2種類：
  - (イ) PC の編集状態に引き出しの右の列が無くなった（#759-2）＝右の列が見える前提の待ち・矩形が外れる。
  - (ロ) PC でも本棚ブロックを足すと引き出しが真ん中のシートで開く（#759-1）＝幕が次に押す所（完了・＋・公開・見出しのボタン）を覆う。
- 手当ては helpers の共通の開き方・閉じ方（`openArtSheet`・`openArtSheetInternal`・`closeArtSheet`）に寄せた。`helpers/art-editor.js` の `openArtSheet` は、PC でも `#art-edit-view.is-six` の時は狭幅と同じくシートを開くようにした。
- '0'（前の形）で残したのは article-pc-pane の 1280 の2件（前の形＝右の列ありの #278 の検査をそのまま守る）。'0' は起動の後に page.evaluate で入れる（addInitScript は使っていない）。

| spec | 件 | (a)/(b) | 手当て・理由 |
|---|---|---|---|
| article-pc-pane | 4（1280・1440 の各2） | (a) | 右の列そのものを見ている。1440 は新しい形（編集状態に右の列が無い・ペインはモーダルの右端の列）へ直した。1280 は '0' で前の形を残す |
| art-canvas-tap-edit | 3（PC1440 の本棚・⋯ピル・つまみ） | (a) | pickAndDone の「狭幅なら開く」に is-six も入れ、本棚ブロックで開いたままのシートは「完了」の前に閉じる（closeArtSheet） |
| art-publish-sheet | 3（PC 1280） | (b) | 公開パネルの検査。準備で本を足した後のシートを閉じる（closeArtSheet・PC だけ） |
| exclude-export-all-shelf | 1（664-D） | (b) | 引き出しの中身を見るだけ＝編集状態に入ってから openArtSheetInternal で開いて見る |
| manual-add-reload-all-shelf | 1（662-D） | (b) | 同上 |
| first-run-add-article-drawer | 1 | (b) | 同上 |
| first-run-drawer-before-first-save | 2 | (b) | 同上 |
| publish-article-editor | 6（349・378・857・1132・1449 U1・1802 検索） | (b) | 本を足した後のシートの幕が次の操作を覆う＝closeArtSheet で閉じてから次へ。step2 で残っていた U1 の時間切れもこれ |
| publish-panel | 5 | (b) | 同上（公開パネルを開く前に閉じる） |
| smoke | 1（公開 S3） | (b) | 同上 |
| critical-path | 1 | (b) | 同上 |
| status-bar-over-faces | 1（(g) PC） | (b) | 帯と見出しのボタンの検査。プレビューを開く準備の「表示中のN冊を追加」は、シートで開いて押し、閉じてから次へ |
| standard-ops | 1（:150 ⋯メニュー/ESC） | (a) | PC でも本棚ブロックを足すとシートが開く＝ESC はまずシートだけ閉じ（全画面は残る）、2回目で完了。新しい段の並びを見る形に直した |

- origin/main 7e60b0a との比べはまだ流していない（/tmp/i770base に 7e60b0a を展開済み）。上の赤はどれも引き出しの前提が原因で、手当て後に緑になった（§2-1）ことで元からの赤ではないと判断した。
- addBlock（helpers）は、PC の is-six で引き出しのシートが開いていれば先に閉じるようにした（本棚ブロックを続けて足す所・addShelfWithBooks の後の行の操作）。publish-article-editor の addShelfWithBooks（4か所）も足した後に閉じる。

### §2-1 手当て後の再実行（chromium）

- 全件の1回目（step5-e2e-all.log）：870秒で打ち切り。1143件中およそ1100件まで流れた。赤は上の表の物だけ（33件）。
- article-pc-pane：10件緑。
- 手当てした12 spec（step5-fix2.log・330秒で打ち切り・220件中約170件）：publish-article-editor の 1132・1449・1802・1843 だけ赤＝addBlock の手当ての前の物。3件は手当て後に緑（step5-fix3.log）。
- 13 spec をまとめて（step5-fix4.log・390秒）：230件中187件まで、赤は publish-article-editor の 1959・1988・2145（addShelfWithBooks の後の行の操作＝幕）。addShelfWithBooks で閉じる手当てを入れたが、手当て後の再実行はまだ。

## §3 char（test (char)・6端末）

- 774件を流した（step5-char.log・4.0分）。189 passed・10 failed（PC の 1024・1440・1920 だけ）：
  - char/article-ops-count.spec.js:194・:209（X3 step4 の手数・1024/1440/1920）
  - char/publish-hub.spec.js:167（A1）・:178（A7）（1024）
  - char/article.spec.js:176（A-b・1440/1920）
- どれも PC で本棚ブロックを足すと引き出しが真ん中のシートで開く（#759-1）ことに当たっていると見ている（原因はまだ見ていない）。手数の写しは、引き出しの開閉の手数が変わる＝意図した差の見込み。次の step で分ける。

## §4 lint・単体・版

- npm run lint：12本中0本失敗（spec の手当ての後にも流した）。
- npm test：緑（vitest）。
- check:version --range=origin/main..HEAD：OK。
