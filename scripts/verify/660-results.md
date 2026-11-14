# イシュー#660 step1 再現の記録：面を開いている間の状態バー（保存の失敗・未保存）

- 測った日時：2026-11-14 17:16〜17:17。base は 16c0a10（その時点の origin/main と同じ）
- spec：`tests/e2e/status-bar-over-faces.spec.js`（記録だけで合否は付けない。step3 で期待値を「見える・押せる」に反転して入れる）
- 流し方：一時の設定 `playwright.660.config.js`（commit しない）で、3つの project × 2つの状態を流した。結果は6本で、1.1分だった。
  - project：chromium-390（390×844）／webkit-iphone13（`devices['iPhone 13']`）／chromium-1280（参考）
  - コマンド：`PORT=8160 PLAYWRIGHT_BASE_URL=http://localhost:8160 node node_modules/@playwright/test/cli.js test -c playwright.660.config.js --workers=3`
- 状態(a) 保存の失敗：J6-5 の2本目と同じ手順。`shortenSyncRetryForTest` と `failHubWritesForTest` を掛けて短文メモを書き、「再試行」の行（`data-sync-failure="network"`）を出す。
- 状態(b) 未保存：`load-conflict-unsaved.spec.js` のハブの手順。書けない間に本を足し、他の端末の更新を入れて再読込する。読込時の3択を Esc で閉じ、「選ぶ」の行（`data-sync-failure="load-conflict"`）を出す。
- 判定のしかた：
  - 見える＝行の中心の `document.elementFromPoint` が行の中にあるか（toBeVisible は重なりを見ないので使わない）
  - 押せる＝ボタンへの `click({trial:true, timeout:2000})` が通るか（Playwright が、その点で受ける要素を確かめる）
  - inert＝`#app-status-bar` とその祖先に inert が付いているか
- 面を開いた入口：
  - 本の詳細＝一覧のカードの click（#639 の editMemo と同じ）
  - 横のメニュー＝`_openDrawer()`／設定＝`_openSettingsModal()`／コマンドパレット＝`_openPalette()`
  - 手動で追加＝`openSettingsByClick` →`#add-book-manually`
  - 記事の一覧＝`openPublishPagesModal()`／記事エディタ＝記事の一覧 →`#art-new`
- 画像：`tmp/660/<project>/<状態>-<面>.png`（48枚。gitignore 済み。step2 の比較に使う）

## 結論

1. **390幅（chromium・webkit とも）**：測った7つの面のすべてで、状態(a)(b)のどちらも、行は見えず押せない。7面×2状態×2ブラウザの28件がすべて ×。面を開いていない対照は4件とも ○。
2. **隠れ方は2種類**
   - **重なるだけ（inert なし）**：本の詳細と横のメニュー。
     - 本の詳細（`#app-detail`）は `position:fixed`・z=940 で、常設クロームの帯にあり、overlay-manager のスタックの外。
     - 横のメニュー（`#app-sidebar`）は overlay-manager の sheet で、`data-layer=0`・z=1000。trap ではないので inert は付かない。押すと `#app-sidebar` の中身か `#mobile-scrim` が受ける。
   - **重なる＋inert**：設定・手動で追加（設定の上・z=1001）・コマンドパレット・記事の一覧・記事エディタ。
     - 記事エディタは `#publish-pages-modal`（`data-ov-size="full"`）の中にある。
     - どれも overlay-manager の modal（trap）で、`_applyInert` が `main.main` に inert を付ける。狭幅では `hooks.inertKeep` が [] を返すので、状態バーも inert の内側に入る。
3. **PC 1280（参考）**
   - 本の詳細・横のメニュー：○（重ならない）。
   - 設定・手動で追加・コマンドパレット・記事の一覧・記事エディタ：×。モーダルの背景が受け、inert も付く。設定は exit:'page' でサイドバーを残すので、inert は `section.app-main-pane` に付く。
4. **状態バーの行（390幅）**
   - chromium：y=0・高さ78px。文が2〜3行に折れ、ボタン（「再試行」「確認」／「選ぶ」）は min-height 44px。
   - webkit：iOS の「ホーム画面に追加」の帯の下に出る。

## 面ごとの記録

### chromium-390 / 状態(a) 保存の失敗
viewport 390×844・行の位置 y=0 高さ 78・行の種類 network・ボタン「再試行」

| 面 | 見える（行の中心） | 行の中心で一番上の要素 ／ 覆う面と z-index | 押せる（click trial） | 状態バーの祖先の inert | 開いていた面 |
|---|---|---|---|---|---|
| 面なし (対照) | ○ | （行そのもの） | ○ | なし | - |
| 本の詳細 | × | button#mobile-detail-back.mobile-detail-back ／ aside#app-detail.app-detail z=940 | × #app-detail の中身 が受ける | なし | book-detail-pinned |
| 横のメニュー | × | div.sidebar-brand ／ aside#app-sidebar.app-sidebar z=1000 | × #app-sidebar の中身 が受ける | なし | app-sidebar,drawer-open |
| 設定 | × | h2#settings-md-title ／ div#settings-modal.modal.settings-fullpage z=1000 | × #settings-modal の中身 が受ける | main.main | settings-modal |
| モーダル (設定の上の「手動で追加」) | × | h2 ／ div#add-book-modal.modal.show z=1001 | × #add-book-modal の中身 が受ける | main.main | settings-modal,add-book-modal |
| コマンドパレット | × | div#cmdk-backdrop.cmdk-backdrop ／ div#command-palette.cmdk z=1000 | × #command-palette の中身 が受ける | main.main | command-palette |
| 記事の一覧 (公開) | × | h2 ／ div#publish-pages-modal.modal.show z=1000 | × #publish-pages-modal の中身 が受ける | main.main | publish-pages-modal |
| 記事エディタ (新規) | × | div.art-hd-title ／ div#publish-pages-modal.modal.show z=1000 | × #art-mode-edit が受ける | main.main | publish-pages-modal |

### chromium-390 / 状態(b) 未保存（止めている）
viewport 390×844・行の位置 y=0 高さ 78・行の種類 load-conflict・ボタン「選ぶ」

| 面 | 見える（行の中心） | 行の中心で一番上の要素 ／ 覆う面と z-index | 押せる（click trial） | 状態バーの祖先の inert | 開いていた面 |
|---|---|---|---|---|---|
| 面なし (対照) | ○ | （行そのもの） | ○ | なし | - |
| 本の詳細 | × | button#mobile-detail-back.mobile-detail-back ／ aside#app-detail.app-detail z=940 | × #app-detail の中身 が受ける | なし | book-detail-pinned |
| 横のメニュー | × | div.sidebar-brand ／ aside#app-sidebar.app-sidebar z=1000 | × #mobile-scrim が受ける | なし | app-sidebar,drawer-open |
| 設定 | × | h2#settings-md-title ／ div#settings-modal.modal.settings-fullpage z=1000 | × #settings-modal の中身 が受ける | main.main | settings-modal |
| モーダル (設定の上の「手動で追加」) | × | h2 ／ div#add-book-modal.modal.show z=1001 | × #add-book-modal の中身 が受ける | main.main | settings-modal,add-book-modal |
| コマンドパレット | × | div#cmdk-backdrop.cmdk-backdrop ／ div#command-palette.cmdk z=1000 | × #command-palette の中身 が受ける | main.main | command-palette |
| 記事の一覧 (公開) | × | h2 ／ div#publish-pages-modal.modal.show z=1000 | × #publish-pages-modal の中身 が受ける | main.main | publish-pages-modal |
| 記事エディタ (新規) | × | div.art-hd-title ／ div#publish-pages-modal.modal.show z=1000 | × #art-more-btn が受ける | main.main | publish-pages-modal |

### webkit-iphone13 / 状態(a) 保存の失敗
viewport 390×664・行の位置 y=69 高さ 78・行の種類 network・ボタン「再試行」

| 面 | 見える（行の中心） | 行の中心で一番上の要素 ／ 覆う面と z-index | 押せる（click trial） | 状態バーの祖先の inert | 開いていた面 |
|---|---|---|---|---|---|
| 面なし (対照) | ○ | （行そのもの） | ○ | なし | - |
| 本の詳細 | × | div.book-cover-placeholder.cover-fallback ／ aside#app-detail.app-detail z=940 | × #app-detail の中身 が受ける | なし | book-detail-pinned |
| 横のメニュー | × | div.sidebar-section.sidebar-section-utility ／ aside#app-sidebar.app-sidebar z=1000 | × #app-sidebar の中身 が受ける | なし | app-sidebar,drawer-open |
| 設定 | × | button.settings-cat ／ div#settings-modal.modal.settings-fullpage z=1000 | × #settings-modal の中身 が受ける | main.main | settings-modal |
| モーダル (設定の上の「手動で追加」) | × | div.form-group ／ div#add-book-modal.modal.show z=1001 | × #add-book-modal の中身 が受ける | main.main | settings-modal,add-book-modal |
| コマンドパレット | × | input#cmdk-input.cmdk-input ／ div#command-palette.cmdk z=1000 | × #cmdk-input が受ける | main.main | command-palette |
| 記事の一覧 (公開) | × | p.pp-hint ／ div#publish-pages-modal.modal.show z=1000 | × #publish-pages-modal の中身 が受ける | main.main | publish-pages-modal |
| 記事エディタ (新規) | × | iframe#art-canvas-frame.art-canvas-frame ／ div#publish-pages-modal.modal.show z=1000 | × #art-canvas-frame が受ける | main.main | publish-pages-modal |

### webkit-iphone13 / 状態(b) 未保存（止めている）
viewport 390×664・行の位置 y=69 高さ 78・行の種類 load-conflict・ボタン「選ぶ」

| 面 | 見える（行の中心） | 行の中心で一番上の要素 ／ 覆う面と z-index | 押せる（click trial） | 状態バーの祖先の inert | 開いていた面 |
|---|---|---|---|---|---|
| 面なし (対照) | ○ | （行そのもの） | ○ | なし | - |
| 本の詳細 | × | div.book-cover-placeholder.cover-fallback ／ aside#app-detail.app-detail z=940 | × #app-detail の中身 が受ける | なし | book-detail-pinned |
| 横のメニュー | × | div.sidebar-section.sidebar-section-utility ／ aside#app-sidebar.app-sidebar z=1000 | × #mobile-scrim が受ける | なし | app-sidebar,drawer-open |
| 設定 | × | button.settings-cat ／ div#settings-modal.modal.settings-fullpage z=1000 | × #settings-modal の中身 が受ける | main.main | settings-modal |
| モーダル (設定の上の「手動で追加」) | × | div.form-group ／ div#add-book-modal.modal.show z=1001 | × #add-book-modal の中身 が受ける | main.main | settings-modal,add-book-modal |
| コマンドパレット | × | input#cmdk-input.cmdk-input ／ div#command-palette.cmdk z=1000 | × #cmdk-input が受ける | main.main | command-palette |
| 記事の一覧 (公開) | × | p.pp-hint ／ div#publish-pages-modal.modal.show z=1000 | × #publish-pages-modal の中身 が受ける | main.main | publish-pages-modal |
| 記事エディタ (新規) | × | iframe#art-canvas-frame.art-canvas-frame ／ div#publish-pages-modal.modal.show z=1000 | × #art-canvas-frame が受ける | main.main | publish-pages-modal |

### chromium-1280 / 状態(a) 保存の失敗
viewport 1280×800・行の位置 y=0 高さ 59・行の種類 network・ボタン「再試行」

| 面 | 見える（行の中心） | 行の中心で一番上の要素 ／ 覆う面と z-index | 押せる（click trial） | 状態バーの祖先の inert | 開いていた面 |
|---|---|---|---|---|---|
| 面なし (対照) | ○ | （行そのもの） | ○ | なし | - |
| 本の詳細 | ○ | （行そのもの） | ○ | なし | book-detail-pinned |
| 横のメニュー | ○ | （行そのもの） | ○ | なし | app-sidebar,drawer-open |
| 設定 | × | h2#settings-md-title ／ div#settings-modal.modal.settings-fullpage z=1000 | × #settings-modal の中身 が受ける | section.bookshelf-container.app-main-pane | settings-modal |
| モーダル (設定の上の「手動で追加」) | × | div#add-book-modal.modal.show ／ div#add-book-modal.modal.show z=1001 | × .modal が受ける | main.main | settings-modal,add-book-modal |
| コマンドパレット | × | div#cmdk-backdrop.cmdk-backdrop ／ div#command-palette.cmdk z=1000 | × #command-palette の中身 が受ける | main.main | command-palette |
| 記事の一覧 (公開) | × | div#publish-pages-modal.modal.show ／ div#publish-pages-modal.modal.show z=1000 | × .modal が受ける | main.main | publish-pages-modal |
| 記事エディタ (新規) | × | input#art-title.art-title-input ／ div#publish-pages-modal.modal.show z=1000 | × #art-title が受ける | main.main | publish-pages-modal |

### chromium-1280 / 状態(b) 未保存（止めている）
viewport 1280×800・行の位置 y=0 高さ 59・行の種類 load-conflict・ボタン「選ぶ」

| 面 | 見える（行の中心） | 行の中心で一番上の要素 ／ 覆う面と z-index | 押せる（click trial） | 状態バーの祖先の inert | 開いていた面 |
|---|---|---|---|---|---|
| 面なし (対照) | ○ | （行そのもの） | ○ | なし | - |
| 本の詳細 | ○ | （行そのもの） | ○ | なし | book-detail-pinned |
| 横のメニュー | ○ | （行そのもの） | ○ | なし | app-sidebar,drawer-open |
| 設定 | × | h2#settings-md-title ／ div#settings-modal.modal.settings-fullpage z=1000 | × #settings-modal の中身 が受ける | section.bookshelf-container.app-main-pane | settings-modal |
| モーダル (設定の上の「手動で追加」) | × | div#add-book-modal.modal.show ／ div#add-book-modal.modal.show z=1001 | × .modal が受ける | main.main | settings-modal,add-book-modal |
| コマンドパレット | × | div#cmdk-backdrop.cmdk-backdrop ／ div#command-palette.cmdk z=1000 | × #command-palette の中身 が受ける | main.main | command-palette |
| 記事の一覧 (公開) | × | div#publish-pages-modal.modal.show ／ div#publish-pages-modal.modal.show z=1000 | × .modal が受ける | main.main | publish-pages-modal |
| 記事エディタ (新規) | × | input#art-title.art-title-input ／ div#publish-pages-modal.modal.show z=1000 | × #art-title が受ける | main.main | publish-pages-modal |


## 測っていない面

面の一覧は、`js/bookshelf.js`（16c0a10）の 6428〜6460 行の S.define にある29面と、NavState の book-detail を合わせた30面。

- **測った6つの id**：book-detail・drawer・settings-modal・add-book-modal・command-palette・publish-pages-modal。publish-pages-modal は、記事の一覧と記事エディタの2通りで測った。
- **測っていない24の id**：plugins-modal・art-add-sheet・art-blk-menu・art-look-sheet・art-sheet・art-more-menu・art-fs・art-edit-mode・art-publish-modal・art-viewing・book-memo-modal・bookshelf-form-modal・bookshelf-modal・descendants-pick-modal・exclusions-modal・icon-picker-modal・import-modal・mde-heading-menu・plugin-settings-modal・pp-preview-modal・settings-cat・report-modal・publish-settings-modal・dashboard-edit
  - 理由：仕組みが測った面と同じなので、仕組みごとの代表を測った。
    - NavState の常設クロームの帯：book-detail
    - overlay-manager の sheet（trap でない）：drawer
    - overlay-manager の modal（trap）：settings／入れ子の add-book／palette／publish-pages（lg・full）
  - overlay-manager に載る面（z=1000+n）は、z-index の無い流れの中の状態バーより必ず上に来る。modal・dialog は trap なので inert も付く。だから、測った面と同じく × になる見込み（未測定）。
  - art-* の sheet・menu は記事エディタの上に重なるので、記事エディタと同じく × になる見込み。
  - **dashboard-edit（exit:'edit'・ホームの編集モード）は重なるかどうか分からない**（未測定）。step3 の E2E で確かめる。
  - import-modal は PC 専用（C-248）。

## step2 への材料

- 直すには、2つの仕組みの両方に手が要る。前に出すだけでは modal の inert で押せず、inert から外すだけでは見えない。
  - (1) z の帯：`.app-detail` は 940（`--z-chrome` の帯）、overlay-manager の面は 1000+n。
  - (2) inert：overlay-manager の `_applyInert`。狭幅では inertKeep が []。
- 「1か所で決める」の今の形：行の描画は `_updateStatusBar` の1か所、クリックは `#app-status-bar` の委譲の1か所（`_initStatusBar`）。
- 面の上に出す行（②の申し送り2）は、保存の失敗と未保存の2種類だけ。
  - 今回測った行の種類は network（a）と load-conflict（b）。
  - 止めている印には sync-conflict（書き込み時の選択・#639）もある。
- 確認ダイアログ（1800帯）は今回の面に入れていない。申し送り3のとおり、押せなくてよい。

---

# step2 直し方の比較（2026-11-14）

## 推奨：案A（保存の失敗・未保存の行だけを、面より前の帯に固定し、面と外枠を帯の高さだけ下げる）

試作（`tmp/660/proto-A.patch`。3ファイル・44行足して4行削った。本体には commit せず、戻してある）を入れて、step1 の spec をそのまま流し直した。

- **48件すべてで、見える・押せる**：3つの project（chromium-390・webkit-iphone13・chromium-1280）× 2つの状態 × 8通り（対照の「面なし」を含む）。step1 では、390幅の28件（7面×2状態×2ブラウザ）がすべて ×だった。
- 帯の下にある面の見出し（本の詳細の「戻る」・設定の「← ホーム」）は隠れない。画像は `tmp/660/proto-A/<project>/<状態>-<面>.png`。
  - 見本：`webkit-iphone13/a-save-failure-detail.png`・`chromium-390/b-unsaved-hold-settings.png`・`chromium-1280/a-save-failure-settings.png`（PC 幅）
- 試作でしたこと：
  - `_updateStatusBar` が、`_syncFailureRow` の行（保存の失敗・未保存）だけを `#app-status-bar` の中の `<div class="status-urgent" data-ov-above>` にまとめる。ほかの行（未設定・新しいバージョン・確認中・旧来の同期エラー）は、今の流れの中に残す。
  - 帯の高さを測って `--status-urgent-h` と `body.has-status-urgent` に書き、帯が出入りした時に `_applyInert` を呼び直す。
  - overlay-manager の `_applyInert` に、汎用の印 `[data-ov-above]` を足す。この印の要素は inert から外す（#toast-container と同じ扱い）。最前面が kind 'dialog' の時は外さない（②の申し送り3）。
  - CSS：
    - 帯：`position:fixed; top:0; z-index:1700`。面（1000+n）より上、確認ダイアログ（1800）より下。
    - 外枠：`.main` を、帯の高さだけ padding-top で下げる。
    - 全画面の面：`[data-layer][data-ov-kind=modal|sheet]` と、狭幅の `.app-detail` の top を、帯の高さだけ下げる。
- **試作2（`tmp/660/proto-A2.patch`）**：外枠を下げる先を、`.main` から `body`（flex の縦並び・`box-sizing:border-box`）の padding-top に変えた。これで下の「残る懸念 1」が消えた。
  - 同じ spec を流し直しても、48件すべてで見える・押せる（17:28）。
  - iOS の「ホーム画面に追加」の案内は帯のすぐ下に出て、空きは出ない（`tmp/660/proto-A2/webkit-iphone13/a-save-failure-none.png`）。
  - **step3 はこの試作2から始める。**

## 比較表

| 軸 | 案A 帯を面より前へ（推奨） | 案B 面の中に同じ行を描く | 案C 面の見出しに印 |
|---|---|---|---|
| 気づけるか | ○ 全部の面で、同じ場所（画面の最上部）に同じ見た目で出る（試作で 48/48 見える） | ○ ただし、面ごとに出る位置が違う | △ 印だけでは文が読めない |
| 押せるか（何手か） | ○ 1手（試作で 48/48 押せる） | ○ 1手 | × 2手（印 → 面を閉じる/バーを出す → 押す） |
| #603・#639 の「1か所で決める」 | ○ 状態（_onSyncFailed・_syncFail・holdError）・文言・描画（_updateStatusBar）・クリック（_initStatusBar の委譲）は1か所のまま。足すのは「行の置き場」と「高さの変数」だけ | △ 描画先が面の数だけ増え、同じ行を複数の場所へ描く | △ 印の描画が面ごとに要る |
| inert・重なりの帯との整合 | ○ `_applyInert` に汎用の印 `data-ov-above` を1つ足すだけ（ダイアログが最前面の時は残さない）。重なりの帯に「面とダイアログの間」（1700）を1つ足す | ○ 面の中なので触らない | ○ 同じく触らない |
| 面ごとの個別実装にならないか | ○ 面を下げる規則は2つのセレクタで全部の面に効く（overlay-manager が書く data-layer×data-ov-kind と、狭幅の .app-detail）。面ごとの CSS は書かない | × 面ごとに見出しの作りが違うので、差し込み口を面ごとに置くことになる（.modal>.modal-content／#app-detail／#app-sidebar／記事エディタ） | × 同じく面ごと |
| 見出し（戻る・×）・safe-area | ○ 面を帯の高さだけ下げるので、見出しは隠れない（画像で確認）。safe-area は帯の padding が受け持つ | ○ | ○ |
| 既存 spec（#app-status-bar を見る13本以上）・visual 基準画像 | ○ 行は #app-status-bar の中に残すので、locator は今のまま使える。帯は失敗・未保存の時だけ出る。tests/visual には失敗の状態を撮った画像が無い（grep で0件）ので、基準画像は変わらない見込み | △ 同じ行が2か所に出るので、getByText 等が2件に当たり strict mode で落ちる。spec の直しが要る | ○ |
| 常時の軽い行（未設定・新しいバージョン・確認中） | ②の方針どおり、帯には出さない（今の位置のまま） | 同じ方針で作れる | 同じ |

案B・案C を推さない理由：どちらも面ごとの差し込み口が要る。これは触るな「共通の仕組みにしてから実装」に反する。案C は押すまで1手多い。

## 残る懸念（step3 で片づける）

1. **iOS Safari の案内の帯と重なる（試作2で解消済み）**
   - 試作1では、`#mobile-setup-banner`（index.html:86・main の前の流れの中・「ホーム画面に追加」の案内）が帯の下に隠れ、その下に空きが出た（`webkit-iphone13/a-save-failure-none.png`）。
   - 試作2で、下げる先を `body` の padding-top に変えて解消した。
2. **帯の分だけ面が低くなる**
   - 帯が出ている間は、全画面の面と外枠が、帯の高さ（390幅で78px＝文が2〜3行）だけ低くなる。
   - 面の下端（記事エディタの下のツールバー・詳細の下の余白）が窮屈になっていないかを、step3 で画像で確かめる。文言は SyncFailure の正本のまま変えない。
3. **作り直しのたびに inert が漏れる**
   - `_updateStatusBar` は30秒ごとと focus の時に innerHTML を作り直す。試作は、帯が出入りした時だけ `_applyInert` を呼び直す。
   - そのため、作り直しのあと、モーダルの背後にある「帯以外の行」が inert から外れる（重なりの下なので押せはしない）。
   - step3 で、作り直すたびに付け直すか、中身が同じなら作り直さない形にする。
4. **下から出す sheet に top が当たるおそれ**
   - `[data-layer][data-ov-kind="sheet"]` の規則が効くのは、今は横のメニューだけ（記事の sheet は layer:false で data-layer が無い）。
   - 今後、下から出す sheet を data-layer 付きで足すと、top が当たって全高になる。規則のコメントと 04 に書く。margin-top で下げる形との比較も step3 で行う。
5. **引っぱって更新の間（未確認）**：`.app-main-pane` に transform が掛かる間、fixed の帯が main を基準にずれないかを step3 で確かめる。
6. **ホームの編集（dashboard-edit）は未測定**：step3 の E2E に入れる。
7. **z の直書き**：試作では z を 1700 と直に書いた。本実装では、重なりの帯の定義（css の `--ov-z-dialog` 等の並び）に `--ov-z-notice: 1700` として足す。
8. **確認ダイアログ（3択・.cfm-overlay）が kind 'dialog' で開いているか**：これを確かめ、ダイアログの背後で帯が inert になることを E2E で見る。

## ②の判断が要る分岐

1. **帯に出す行**
   - 推奨は②の方針と同じで、保存の失敗・未保存の2種類だけにする。
   - ただし、フォルダの許可が切れた行（kind 'permission'・PC のローカルフォルダだけ）も `_syncFailureRow` で作られ、`data-sync-failure` を持つ。これは「保存の失敗」に入れて帯に出した。これでよいか。
2. **PC 幅（901px〜）の扱い**
   - 帯は画面幅いっぱいに出て、サイドバー・中央・詳細の全体を下げる（失敗・未保存の時だけ）。今は中央ペインの上だけに出ていたので、PC の見え方が変わる。
   - 推奨は全部の幅で揃えること（②の申し送り4。PC でもモーダルを開いたまま押せる）。


---

# step3 実装と E2E（2026-11-14）

## 実装（案A・試作2を本番の形に整えた）

- **js/bookshelf.js `_updateStatusBar`**：
  - 行の作り方と状態の判定（_onSyncFailed・_syncFail・SyncFailure）は変えていない。
  - 描いた後に、`data-sync-failure` を持つ行だけを `.status-urgent[data-ov-above]` にまとめる。kind を個別に並べず、この属性の有無の1か所で決める（②の回答1）。
  - 中身が変わった時だけ作り直す（30秒ごと・focus の再評価では作り直さない）。
- **js/bookshelf.js `_syncStatusUrgent`（新設）**：
  - 帯の高さを `--status-urgent-h` へ書き、`body.has-status-urgent` を付け外しする。帯の幅が変わった時は ResizeObserver で測り直す。
  - 呼ばれるたびに `overlays.refreshInert()` で背後の inert を付け直す。
- **js/overlay-manager.js**：
  - `_applyInert` の keep に `[data-ov-above]` を足した。最前面が kind 'dialog' の時は足さない（②の申し送り3）。
  - 公開の `refreshInert()` を足した（帯を出し入れ・作り直した時に呼ぶ）。
- **css/bookshelf.css**：
  - 重なりの帯の定義に `--ov-z-notice: 1700` を、ほかの帯と並べてコメント付きで足した。
  - 帯（`.app-status-bar .status-urgent`・fixed・top 0・safe-area）を足した。
  - `body.has-status-urgent` の padding-top で外枠を下げる。
  - 全画面の面（`[data-layer][data-ov-kind=modal|sheet]`・狭幅の `.app-detail`）の top を下げる。
- **index.html の ?v=**：bookshelf.css 2026111760・overlay-manager.js 2026111761・bookshelf.js 2026111762。
- **playwright.config.js**：gate-webkit（CI の webkit レグ）の testMatch に `status-bar-over-faces.spec.js` を足した。
- **tests/e2e/load-conflict-unsaved.spec.js**：
  - #639 の回避（詳細の「戻る」で閉じてから「選ぶ」を押す）を外し、詳細を開いたまま押す形にした。
  - 撮影前に面を閉じる処理は、画面の素の姿を撮るために残し、コメントだけ直した。

## E2E（tests/e2e/status-bar-over-faces.spec.js・390幅）

- **新しい spec**：(a) 8つの面×保存の失敗、(b) 8つの面×未保存、(c) 作り直し、(d) 下端まで届くかの記録、の18本。
  - 結果：chromium（390×844）と gate-webkit（iPhone 13 に 390×844 を当てた）で、**36本すべて通った**（17:52・3.8分）。
  - (a) 面を開いたまま「再試行」を押すと、行が消えて短文メモがハブへ届く。
  - (b) 面を開いたまま「選ぶ」を押すと3択が開く。その間、帯は背後で inert になる（②の申し送り3）。「この端末の内容で上書き」を選ぶと、行が消えて本Bがハブへ届く。
  - (c) 設定を開いたまま、版の検知（visibilitychange）と focus で状態バーを作り直しても、次のとおり保たれる。
    - 帯は一番上にあり、inert の外にある。
    - 帯以外の行（新しいバージョン）とホーム（#view-main）は、背後で inert のまま。
  - 面は8つ：step1 の7面に、ホームの編集（dashboard-edit）を足した。
- **(d) 下端まで届くか**（画像は `tmp/660/step3-d2-out/*/detail-bottom.png`・`settings-bottom.png`）
  - 本の詳細の一番下の操作（「＋感想」等の button.mt-btn）は、bottom=794 で、下部ナビの上端（794）の真上に出る。
  - 設定の一番下（settings-cat）は bottom=530〜549 で、届く。
  - webkit では、本の詳細の一番下の点に elementFromPoint を当てると null が返る（境目ちょうどの点）。画像では、ナビの上に見えている。
- **step3 の途中で見つけて直したもの**
  - 失敗の状態が落ち着く前に失敗を解くと、自動の再試行が先に成功して行が消えた（初回 9/32 赤のうち7件）。テスト側で「確認」が出た所（止まった状態）まで待つ形にした。実装の不具合ではない。
  - 狭幅のモーダルの × は `position:fixed; top:20px`（面の外枠に付いていない）なので、帯の下に隠れた（webkit の load-conflict-unsaved で、手動で追加の × が押せなかった）。× の top に `--status-urgent-h` を足した（帯が無い時は 0px）。
  - 面の外枠（.modal・狭幅の .app-detail）は height:100% を持つので、top を下げた分だけ下端が画面の外へはみ出した（本の詳細の一番下が bottom=854 で、画面 844 の外）。帯が出ている間は、下端を 0 に留め、高さを自動にした。
  - load-conflict-unsaved の observe は `#app-status-bar` 自体の isVisible で「状態バーが出る」と見ていた。帯（fixed）だけの時は高さ0になるので、行の isVisible で見る形にした。
- **関係する spec**
  - chromium 10本（176件）：171件通過・5件失敗（17:44・ほかの run と並行）。
    - 失敗のうち load-conflict-unsaved の2件は、上の observe の直しで通った。
    - save-failure-visible の GitHub の3件は、`createShelf` で保存先へ新しい本棚が5秒以内に届かない待ちで落ちた。単独に近い流し直し（17:47）では14件すべて通った。並行の重い時（17:52）には別の2件（136:9・241:1）が同じ待ちで落ちた。
  - webkit の load-conflict-unsaved：2件通過・1件は対象外（ローカルフォルダは PC だけ）。#639 の回避を外した形で通った。
  - lint：e2e-wait・e2e-goto・internal-refs（上限82以内）・css・esc・js-color・e2e-external は通った。vitest は 78ファイル・1176件が通った。


---

# step4 回帰の確認（2026-11-14）

- **載せ直し**：origin/main が f9468f8（#656・#622 等）へ進んでいたので、`git rebase origin/main` をした。
  - 衝突は index.html の `js/bookshelf.js?v=` の1行だけ。main は 2026111721、こちらは 2026111762 で、大きい方（こちら）を残した。
  - css・overlay-manager の ?v=（2026111760・2026111761）は、main（2026111601・2026111330）より新しい。
  - 載せ直した後の commit は 5b0a765。
- **e2e-diff**：`node scripts/verify/e2e-diff-main.mjs --port=8160 --out=tmp/660/e2e-diff`（visual は既定でオン。--init-storage・--grep は使っていない）。
  - 1回目（17:55〜）は、base（origin/main f9468f8）の E2E 全件（1683件・8 workers・5.7分・`tmp/660/e2e-diff/base.e2e.json`）まで済んだ。work 側の途中で、run の区切りで打ち切られた（負荷の平均 53〜62）。
  - origin/main は同じ f9468f8 のままだったので、base はこの結果を使った。work 側だけを e2e-diff と同じ条件で流した（`PORT=8160 PLAYWRIGHT_JSON_OUTPUT_NAME=... playwright test --reporter=json --grep-invert sort-perf-budget`・1701件・7分・`work.e2e.json`）。
  - 3表への分け方は `tmp/660/compare-e2e.mjs`（e2e-diff と同じく spec・題・project ごとに見る）。
- **3表**（`tmp/660/e2e-diff/compare.md`）
  - base：1683件（expected 1087・unexpected 3・skipped 593）。work：1701件（expected 1102・unexpected 6・skipped 593）。
  - **新しく落ちた：6件 → 流し直すと全部通った（新しく落ちたものは実質0件）**。
    - 対象：book-memo-file-lifecycle の GitHub 3件・focus-trap-deeplink の PC「設定を開いて Tab 20回」・gate/j4-memo・list-staged-render（913冊の段階描画）。
    - 4つの spec ファイルを丸ごと流し直し（18:11・4 workers）、48件すべて通った。全件を8 workers で流した時の負荷による揺れと判断した。
  - **新しく通った：3件**（gate/j3-5-many-books・gate/j6-1-local-restart・sync-offline-reconnect の GitHub）。base 側で落ちていたもので、今回の変更とは関係しない（時間の測定・ローカルフォルダ・GitHub の再ログイン）。
  - **両方で落ちた：0件**。
  - work だけにある：18件（新しい status-bar-over-faces.spec.js の chromium 分）。すべて expected。
- **見た目（visual・`playwright.visual.config.js`）**：54件すべて基準画像と一致した（18:04）。**基準画像の更新は無し**。帯は保存の失敗・未保存の時だけ出て、基準画像にはその状態が無いため。
- **単体（vitest・載せ直し後）**：79ファイル・1181件が通った（2件は todo）。
- **ホームのウィジェット選択（step3 の申し送り）**：
  - `.widget-picker-overlay` は kind 'popover'（data-layer あり・inset 0）なので、面を下げる規則（modal・sheet）の対象外。
  - 中身の `.widget-picker-panel` は `margin-top: 12vh` で、390×844 では 101px から出るので、帯（78px）より下になる。ただし iPhone 13 の高さ（664px）では 80px で、帯との差が 2px しかない。
  - 帯の文が3行になる時は、上端が重なるおそれがある。popover を下げる対象に入れるかは、step5 の tp で決める。
- **2回目の載せ直し（18:14）**：記録の途中で、origin/main が 36cf113（#645 の、書き込み時の衝突で上書きを選べる・GitHub の読み直し）へ進んだ。
  - 衝突は index.html の `js/bookshelf.js?v=` の1行だけ。main は 2026111746、こちらは 2026111762 で、大きい方を残した。check:version は OK。
  - 載せ直した後の commit は 5ecb97b（fix）とこの docs。
  - 入った spec と関係 spec を流し直した。
    - chromium（18:19）：sync-conflict-overwrite・sync-conflict・gate/j6-4・load-conflict-unsaved・status-bar-over-faces・save-failure-visible の40件のうち36件が通り、4件が落ちた。落ちたのは save-failure-visible の GitHub 3件と、新 spec の (b) 記事エディタ1件。
    - 落ちた4件を流し直すと、6件すべて通った（18:20。記事エディタの (a)(b) と GitHub の3件を含む）。
    - origin/main（36cf113）単独でも、save-failure-visible は11件すべて通った（18:20・別の番号）。
    - webkit（gate-webkit・18:19）：status-bar-over-faces と gate/j6-4 の20件すべてが通った。
  - **save-failure-visible の GitHub 系（createShelf の5秒の待ち）**は、ほかの run と並行で重い時だけ落ちる。
    - これまでの記録：17:44 で3件・17:52 で2件・18:19 で3件落ち、単独ではいつも通る（17:54 で11/11・18:20 で3/3）。
    - origin/main 単独でも通る。並行の重い時の origin/main とは比べられていない（未確認）。

---

# step5 設計書の更新と push 前の最終確認（2026-11-14）

- **設計書**：vault のパスはスクリプト（`tmp/660/docs/write.mjs`）の中に持って書いた。
  - 04_画面設計書：「上部ステータスバー」の段に「面を開いている間の保存の失敗・未保存の帯」（出す行・面を下げる規則・背後の inert）を足した。「重なる画面の重なり順」の表の後に `--ov-z-notice` の帯を足した。
  - 08_意思決定記録：ADR-168 を末尾に足した（その時点の最大は ADR-167＝#645）。
  - 07_残検討事項：この件の行は無かったので、触っていない。
- **最後の確認**：origin/main は 36cf113 のままで、載せ直しは無し。
  - `npm run lint`：12本中0本失敗。
  - vitest：79ファイル・1185件が通った（2件は todo）。
  - check:version --range=origin/main..HEAD：OK。
  - 新しい spec（status-bar-over-faces）：chromium と gate-webkit の36本すべて通った（18:22〜18:25・2.7分）。
- **画像**（`tmp/660/step5-images/`）
  - 390幅：`390-chromium-detail-bottom.png`・`390-gate-webkit-detail-bottom.png`（本の詳細を開いたまま、帯と下端の操作）、`390-*-settings-bottom.png`（設定）。
  - PC 幅：`pc-1280-detail.png`（帯は全幅に出て、サイドバー・中央・詳細がそろって帯の分だけ下がる。崩れは無い）。
- **最後の載せ直し（18:26）**：確認の途中で、origin/main が 492ed66 へ進んだ（#657 の同期欄の保存の状態・#634 の本棚の削除）。
  - 衝突は index.html の2行だけ。
    - css：main は 2026111720、こちらは 2026111760 で、こちらを残した。
    - bookshelf.js：main が 2026111763 で、こちらの 2026111762 より新しかった。そこで main の最大より新しい **2026111764** に付け直した。
  - #657 の変更（js/bookshelf.js・css/bookshelf.css の同じ辺り）は自動で合わさり、相手の変更をそのまま残した。
  - 載せ直した後に流し直した結果（18:26〜18:29）：
    - 新しい spec：chromium と gate-webkit の36本すべて通った。
    - 関係 spec（#657 の sync-section-status・load-conflict-unsaved・save-failure-visible）：24件すべて通った。
    - vitest：79ファイル・1185件が通った。
    - lint：12本中0本失敗。
    - check:version：OK。
- **さらに2回載せ直した（18:29〜18:33）**
  - 1回目：origin/main が 6b22a9e（#662）へ進み、bookshelf.js の ?v= が同じ 2026111764 になっていた。
  - 2回目：続けて ab34c16（#659 の引っぱって更新・js/bookshelf.js の近い所）へ進み、main は 2026111781 になった。
  - bookshelf.js の ?v= は **2026111782** に付け直した（commit e2dfd44）。
  - ab34c16 の上で流し直した結果（18:31〜18:33）：
    - 新しい spec：chromium と gate-webkit の36本すべて通った。
    - 関係 spec（#659 の pull-to-refresh-drag・load-conflict-unsaved・sync-section-status）：18件すべて通った。
    - vitest：1185件が通った。
    - lint：12本中0本失敗。
    - check:version：OK。
