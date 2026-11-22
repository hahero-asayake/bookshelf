# イシュー#770 公開エディタ一式をアプリに入れる — 結果

## §0 入れた物と切り替え5本（戻し方）

既定はどれも新しい形（true）。戻し方は2通り：
- **全端末で戻す**：下の定数を `false` にする1行（その群だけ前の形になる）。
- **端末ごとに戻す**：その端末の localStorage のキーに `'0'` を入れる（`'1'`＝新しい形・それ以外＝定数の既定）。

| 群 | 入れた物 | 定数（場所） | localStorage のキー |
|---|---|---|---|
| ① | #759 の1〜6（PC の引き出しを真ん中のシート・編集状態では引き出しを出さない・「＋ ここに追加」を常に・本棚の全画面の「全部の本で」の段・空のブロックの案内＝案B・表のボタンの行と列の欄） | `ART_SIX_DEFAULT`（js/screens/article-editor.js `_artSixOn`） | `bookshelf.flag.artSix` |
| ② | #767 本ブロックの切り替え（本を選ぶ/替えるボタン・＋ここに追加→本で自分で開く・選んだら閉じる・表示中のN冊を出さない）と、本ブロックの短文メモ（#758） | `ART_BOOK_BLOCK_DEFAULT`（同 `_artBookBlockOn`） | `bookshelf.flag.artBookBlock` |
| ③ | #769 見た目の選択肢を縦一列 | `ART_LOOK_LIST_DEFAULT`（同 `_artLookListOn`） | `bookshelf.flag.artLookList` |
| ④ | 8c 本の詳細の閲覧中は帯の行をなくし鉛筆を表紙の段の右上に（編集中は今のまま） | `DETAIL_TOPBAR_FLOAT_DEFAULT`（js/screens/book-detail.js `_detailTopbarFloatOn`） | `bookshelf.flag.detailTopbarFloat` |
| ⑤ | 記事を書く入口（本の詳細「この本で記事を書く」#758・本棚の画面の帯の右端の pencil の角ボタン 9） | `ART_WRITE_ENTRY_DEFAULT`（article-editor.js `_artWriteEntryOn`） | `bookshelf.flag.writeEntry` |

入れていない物：8・8b・9b・題の下の入口・a1/b/c（計画の決め6）。


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

- origin/main 7e60b0a との比べ：e2e-diff-main（§5）で、手当て後の work だけ落ちる物は E2E・vitest とも0件（base 側は E2E 1289・vitest 1298 が全部緑＝上の赤は元からの赤ではない）。
- addBlock（helpers）は、PC の is-six で引き出しのシートが開いていれば先に閉じるようにした（本棚ブロックを続けて足す所・addShelfWithBooks の後の行の操作）。publish-article-editor の addShelfWithBooks（4か所）も足した後に閉じる。

### §2-1 手当て後の再実行（chromium）

- 全件の1回目（step5-e2e-all.log）：870秒で打ち切り。1143件中およそ1100件まで流れた。赤は上の表の物だけ（33件）。
- article-pc-pane：10件緑。
- 手当てした12 spec（step5-fix2.log・330秒で打ち切り・220件中約170件）：publish-article-editor の 1132・1449・1802・1843 だけ赤＝addBlock の手当ての前の物。3件は手当て後に緑（step5-fix3.log）。
- 13 spec をまとめて（step5-fix4.log・390秒）：230件中187件まで、赤は publish-article-editor の 1959・1988・2145（addShelfWithBooks の後の行の操作＝幕）。addShelfWithBooks で閉じる手当てを入れたが、手当て後の再実行はまだ。

### §2-2 webkit（iPhone 13 相当・step6）

- `BACKNAV_WEBKIT=1 npx playwright test --project=webkit`（新しい5 spec＝art-editor-six・art-book-block-pick・art-look-list・write-article-entry・book-detail-topbar-float と、手当て・変更した spec のうち webkit の列にある art-canvas-tap-edit・art-publish-sheet・back-nav-matrix）：**187 passed・0 failed・14 skipped**（5.5分・ログ `_vault-work/770/logs/step6-webkit.log`）。
- `GATE_WEBKIT=1 npx playwright test --project=gate-webkit`（全件）：**113 passed・0 failed・13 skipped**（2.8分・ログ `step6-gate-webkit.log`）。

## §3 char（test (char)・6端末）

- step5 で 774件を流し、10件が赤（PC の 1024・1440・1920 だけ・どれも60秒の時間切れ）：char/article-ops-count.spec.js:194・:209、char/publish-hub.spec.js:167（A1）・:178（A7）、char/article.spec.js:176（A-b）。
- 原因：PC でも本棚ブロックを足すと引き出しが真ん中のシートで開き（#759-1）、その幕が「完了」（#art-fs-done）を覆う＝意図した差。
- 手当て（d5c21d3）：3つの spec の leaveForm で、幅900px超なら先に closeArtSheet でシートを閉じる。手数の写し（article-ops-count）は、シートが開いていた時だけ「引き出しのシートを閉じる」を1手として数える。
- 手当て後（step6-char-fix.log）：3 spec × char-390/1024/1440/1920 で 38 passed・0 failed。
- 手数の変化（意図した差・1行ずつ）：

| 計測 | 端末 | 前（docs/char/x3-step1-design.md §8） | 後 |
|---|---|---|---|
| 公開済みの記事に3冊足して変更を公開（A7相当） | PC 1024/1440/1920 | 9手（base 側の実測も9手） | 10手（③〜⑤本3冊の後に「引き出しのシートを閉じる」が1手増える） |
| 公開済みの記事に3冊足して変更を公開（A7相当） | 390/768 | 9手 | 9手（変わらない） |
| 新しい記事に3冊入れて初めて公開（A1相当） | 390 | 15手 | 15手（変わらない） |
| 新しい記事に3冊入れて初めて公開（A1相当） | PC 1024/1440/1920 | 14手（e2e-diff の base 側＝origin/main 7e60b0a の実測） | 15手（本3冊の後に「引き出しのシートを閉じる」が1手増える） |

## §4 lint・単体・版

- npm run lint：12本中0本失敗（spec の手当ての後にも流した）。
- npm test：緑（vitest）。
- check:version --range=origin/main..HEAD：OK。

## §5 e2e-diff-main（step6・origin/main 7e60b0a 対 work）

### 2回目（最終・work HEAD=b34a693）

結果の置き場：`_vault-work/770/e2e-diff2/`（report.md・ログ `_vault-work/770/logs/step6b-e2e-diff.log`）。systemd-run（unit i770-e2ediff2・PORT 8178・`--init-storage` なし・時間の都合で `--retries=1`）。

| 表 | base（origin/main） | work | work だけ落ちる |
|---|---|---|---|
| E2E（全 project・char 含む・sort-perf-budget 除外） | 1289 passed・0 failed | 1327 passed・0 failed | **0件** |
| vitest | 1298 passed・0 failed | 1298 passed・0 failed | **0件** |
| 画像比較（work 単独・公式コンテナ） | — | 54件中0件が差分 | 0（意図した差12枚は step5 で撮り直し済み＝§1 の名前だけ） |

- フレーク判定・判定不能：0件。
- check:version --range=origin/main..HEAD：OK。npm run lint：12本中0本失敗。
- 監査（mde-table-menu を足した分）：layout・a11y-names・button-names を mde-table-menu で絞って36 passed、check-audit は3つとも上限以内。

### 1回目（work HEAD=2ac6252＋d5c21d3・参考）

E2E で work だけ落ちる5件（publish-article-editor.spec.js:1990・2656・2679・2846・2996）と vitest 23件があった。手当て：
- vitest 22件：book-detail.js が記事エディタの mixin の無い単体の環境で `_artWriteEntryOn` を直に呼んでいた＝typeof で守る（c351a73・アプリ側の直し）。
- vitest 1件（audit-screens-coverage）：表の欄 'mde-table-menu' を tests/audit/screens.js・open-dialogs.js・docs/ui-standards.md の期待表・standard-ops.spec.js に足した（b34a693）。
- 2656・2679（PC の右の列の「畳む」）：決め5の (a)。前の形は artSix='0'（起動後に page.evaluate で入れる）で2件そのまま残し、新しい形（本エリアの常駐ボタンで真ん中のシートが開く・×で閉じる・畳むボタンは無い／前に畳んだ記憶があっても本棚ブロックを足すとシートが開く）の2件を足した。
- 2846・2996：本棚ブロックの後の leaveForm で、シートの幕が「完了」を覆っていた＝leaveForm で幅900px超なら先に closeArtSheet。
- 1990：⋯メニューの「編集」で本棚ブロックを開き直した時は引き出しが自分で開かない（#759-1/2 の形）＝openArtSheet で開く。helpers の openArtSheet は、本棚の全画面（data-art-mode=form）では #art-blocks 側の「本を追加」を押すように直した。
