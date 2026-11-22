# イシュー#745 結果：同じ親の下に同名の本棚を作れないようにする

## 1 方針（②の決定・tp1）

- 案A：同じ親の下の同名を止める。一意なのは、親を含めた階層パス。
- 比べ方：NFKC → 前後の空白除去 → 小文字化。比べる時だけ使い、保存する名前は変えない。
- 既存の同名：読み込みでは検査しない。名前を変えない編集は通す。
- U4（名前に「 / 」）：入れない。
- 案の比較：`/home/kuroko/kuroko/_vault-work/745/options.md`

## 2 変えた箇所（commit b485daa）

- `js/bookshelf-manager.js`
  - 足した物：`normalizeShelfName`（static）・`_parentKeyOf`・`findSiblingNameConflict`・`nameConflictMessage`・`_nameConflictError`（`code='name-conflict'`）・`_moveConflict`。
  - `create`・`update`（名前と親）・`previewReparent`・`reparent` が、すべて `findSiblingNameConflict` を通る。
- `js/bookshelf.js`
  - `saveBookshelfForm` が、書き換える前に `_shelfFormNameConflict` を通す。
  - 衝突した時は toast を出し、名前欄にフォーカスする。フォームは開いたままで、何も保存しない。
- 移す D&D（左ツリー・本棚管理）は、今ある `_applyReparentWithConfirm` が preview の reason を toast で出す（コードは変えていない）。
- `index.html`：上の2ファイルの `?v=` を 2026112245 にした。

## 3 テスト

- 単体：`tests/unit/bookshelf-manager.test.js` に describe を1つ足した（11件）。`npm test` は 85 files・1273 passed・2 todo・0 failed。
- E2E：`tests/e2e/shelf-name-unique.spec.js`（新規・12件）。PC と 390 幅（`test.use({viewport:390×844, hasTouch, isMobile})`）で流した。
  - (1) 作る：本棚管理の「新しい本棚」から、「小説」の下に「ＳＦ」。止まり、toast の文言が出る。フォームは開いたまま、名前欄にフォーカス、本棚の数は同じ。親を「ミステリー」に変えれば作れる。
  - (2) 名前を変える：「ミステリー」を「 sf 」に。止まり、名前も説明も変わらない。名前を戻して説明だけ変えれば保存できる。
  - (3a) 移す・本棚管理のつまみ：PC はマウス、スマホは CDP のタッチ。「漫画 / SF」を「小説」の真ん中へ。止まり、確認は出ず、親も「小説」の本も変わらない。衝突しない移動（ミステリー→漫画）は、確認の後に移る。
  - (3b) 移す・フォームの「親本棚」：止まり、説明も保存しない。トップ階層へは、確認の後に移る。
  - (3c) 移す・左ツリーの D&D（PC だけ）：止まり、親は変わらない。
  - (4) 既存の同名：「小説」の下に「SF」2つの見本で起動する。両方出る。片方の説明を変えて保存できる（端末の控えにも書かれる）。再読込しても両方残る。片方を「SF2」にできる。
  - 390 幅で左ツリーが画面に出ないこと（スマホの移す口は、本棚管理のつまみとフォームの2つ）。
- 検出力：`findSiblingNameConflict` が常に null を返すように一時的に変えて流した。12件中9件が赤になった。緑のまま残った3件は (4) の2件と左ツリーの件で、どれも止めないことを見る件。変えた所は元に戻した。
- 関連の既存 spec：`tree-drop-stays-home`・`shelf-structure-home-refresh`・`bookshelf-open-paths`・`book-detail-shelf-add`・`book-detail-shelf-meta`・`shelf-delete-open-descendant`・`exclude-custom-shelf`・`shelf-file-delete`。新 spec と合わせて **100 passed**（chromium・PORT 8145・1.1分）。
- `npm run lint`：12 本中 0 本失敗。

## 4 画像（スマホ 390 幅・PC 1280 幅）

- 置き場：`/home/kuroko/kuroko/_vault-work/745/hahero/同名の本棚を止める20261122/img/{phone,pc}/`
  - `1-create-stopped`・`2-rename-stopped`・`2-rename-ok`・`3-move-dnd-stopped`・`3-move-form-stopped`・`3-move-tree-stopped`（PC だけ）・`4-existing-dup`・`4-existing-dup-edit-ok`
  - 前の状態は `before-create`。文言のモック（step1）は `after-create`・`after-move`。
- 頁：https://homelab.tail83cfaa.ts.net:8444/bookshelf/5/2/同名の本棚を止める20261122/
- 撮り方：`/home/kuroko/kuroko/_vault-work/745/harness/shots3.mjs`
  - 見本は #743 の shelves-fixture.json。
  - 本棚管理の D&D の場面は、一覧を5つの本棚に絞った見本で撮った。遠い行へはつまみを運べないため（#638 の落とし穴）。

## 5 分かっている制限

- 1回の保存で名前と親を両方変え、新しい名前が今の親の下にある時も止まる。移す確認でキャンセルすると今の親に残るため、両方を保つ形にした。先に移してから名前を変えれば通る（②承認済み）。
- 既存の同名は、読み込みでは直さない。パスは同じまま表示され、どちらかの名前を変えれば解ける。
- 名前の「 / 」（U4）は止めていない。表示の案が決まってから、別に決める。
