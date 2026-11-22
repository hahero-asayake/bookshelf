# イシュー#746 本棚を階層パスで示す — 検証の記録

## step1（表示の文字の関数・切り替え・単体、と「文」と選択肢の8か所）

- 起点：origin/main bee101c（#742 の push の後）。
- 足した物（js/bookshelf-manager.js・getPathLabel の直後）：`shelfPathOn()`（切り替え・`SHELF_PATH_DEFAULT = true`・localStorage `bookshelf.flag.shelfPath` '0'/'1'）・`getShelfPath()`（根→自身の配列）・`getShelfLabel(k, {max})`（表示の文字はここだけ）・`getShelfTextLabel(k)`（通知・確認の文＝`BookshelfManager.SHELF_LABEL_TEXT_MAX`）。
- `SHELF_LABEL_TEXT_MAX = 24` の出どころ：手元のブラウザでは測っておらず、CSS から計算した（toast は 390 幅で 359px・余白とアイコンを引いた本文の幅は約 290px・0.88rem＝全角で1行約20字）。390 幅で本文の1文が2行に収まるかは、step3 の E2E で実際に測って確かめる。
- previewReparent の targetShelves に `key` を足した（name は残した）。M7 の補充先の一覧はこの key で `getShelfTextLabel` を引く。
- 直した8か所：H1 book-detail.js の選択肢・M6 bookshelf-list.js の「親」の選択肢（どちらも `getShelfLabel`・max 無し）。H3・H4・H5・H6・H7・M7 は bookshelf.js の文（`getShelfTextLabel`。祖先・子孫の一覧の1行1行も同じ関数）。
- book-detail.js は、bookshelfManager に getShelfLabel が無い時（既存の単体の stub）は name を出す。
- 単体：tests/unit/shelf-label.test.js（16件）。H1 は描画の関数 `_detailShelvesBodyHtml` を本物の BookshelfManager で通した。bookshelf.js の文（H3〜H7・M7）は、VirtualBookshelf の class が window に出ていないので単体では通せない（既存の単体も stub のクラスに付け替えている）。画面の操作で通す確かめは step3 の E2E（tests/e2e/shelf-path-label.spec.js）でする。
- 結果：npm test＝86 ファイル・1278 件 pass（失敗 0）。npm run lint＝12 本中 0 本失敗。

## step2（1行の部品に T1・本棚の画面の題を名前とパスの2行に分ける）

- js/ui-components.js の BookshelfUI に `shelfPathHtml(bm, shelfOrKey, {parentsOnly})` と `fitShelfPaths(root)` を足した。window の resize に1つだけ（rAF でまとめて）測り直しを付けた。ResizeObserver は使っていない。
  - 切り替え on の時は `<span class="shelf-path" data-shelf-segs="[…]">` を出す。段は JSON で持ち、文字から ' / ' で割らない。off の時は素の名前（エスケープ済み）。
  - fitShelfPaths は、全文に戻す（書く）→まとめて測る（読む）→はみ出した物だけ根の側の段を「… / 」に替えて測り直す。最後の段で収まらない時は is-self-wrap で折り返す。省いた時は title に全文を入れる。
- 直した6か所：H2 一括追加の一覧・H8 子孫の選択・M1 チップ・M2 パレット・M4 ホームのカード・M5 冊数の Top5。どれも描いた後に rAF で fitShelfPaths を呼ぶ。
  - M2 は title だけをパス（titleHtml）にした。当たり方は今のまま name と id。
- 前からのエスケープ漏れを2つ直した。H8 の子孫の行（`${d.name}`）と、M4 のカードの名前（js/ui/bookshelf-card.js の h3 の `${name}`）がエスケープされずに innerHTML へ入っていた。どちらも、切り替え off でも escapeHtml を通すようにした。
- M3：index.html の題の直後に `#current-bookshelf-path`（.bvh-path・hidden）を足した。切り替え on の時は次のとおり。
  - 題には .bvh-title-wrap を付け、流れる文字にしない（_refreshMarqueesNow の対象から題を外した）。2行まで折り返す（line-clamp 2）。
  - 下の行は親までのパス（T1）。1階層・ALL・off の時は hidden。
- css/bookshelf.css に .shelf-path・.is-self-wrap・.bvh-path・.bvh-title-wrap と、各部品が縮められるようにする min-width:0 を足した。色は既存のトークン（var(--muted)）だけを使った。
- index.html の ?v= を、変えた8ファイル（css 1・js 7）の分だけ 2026112246 にした。
- tests/unit/book-detail-shelf-chips.test.js は直さずに通った。stub の bookshelfManager に getShelfPath が無い時は、チップを名前だけで出す分岐にしてある。

### 手元の測り（_vault-work/746/harness/measure2.mjs・chromium・見本は fixture＋同名 SF・3階層 s18）

| 幅 | 部品 | 出た文字 | scrollWidth / clientWidth | 1行 |
|---|---|---|---|---|
| 390 | 題（s18） | 2026年に読み返したい本（2行に折り返し・高さ36px・流れる文字なし） | 160 / 160 | 折り返し（決めどおり） |
| 390 | 題の下の行（s18） | … / マーケティングとブランド（title に全文） | 160 / 160 | 収まる |
| 390 | 題の下の行（漫画 / SF） | 漫画 | 24 / 24 | 収まる |
| 390 | チップ（s18） | … / マーケティングとブランド / 2026年に読み返したい本 | 285 / 285 | 収まる |
| 390 | パレット「2026」 | … / 2026年に読み返したい本 | 267 / 267 | 収まる |
| 390 | パレット「SF」 | 小説 / SF・漫画 / SF の2行だけ（子の海外・国内は出ない） | 267 / 267 | 収まる |
| 1280 | 題の下の行（s18） | ビジネスと自己啓発 / マーケティングとブランド（省かれない） | 237 / 237 | 収まる |
| 1280 | チップ（s18・右の詳細の欄は狭い） | … / 2026年に読み返したい本 | 150 / 150 | 収まる |
| 1280 | パレット「2026」 | 全文（省かれない） | — | 収まる |

- 結果：npm test＝86 ファイル・1278 件 pass。npm run lint＝12 本中 0 本失敗（lint:copy の丸かっこの注記は前からある物で、今回の文ではない）。
- 測っていない物：ホームのカード（M4）と冊数（M5）、一括追加の一覧（H2）、子孫の選択（H8）、webkit。step3 の E2E で測る。

## step3（新しい E2E：tests/e2e/shelf-path-label.spec.js）

- 見本：_vault-work/743/harness/shelves-fixture.json を tests/fixtures/shelves-path.json へ写した。about の頭に出どころを足した。中身は見本のデータだけ。起動は book-detail-shelf-add.spec.js と同じ型で、fixture-userdata/library を土台にした（本150冊は本1の写し・本棚20は fixture の ranges/extra のとおり）。
  - M5 の場面だけは、2つの SF の本を親と同じにした写し（topSF）で、冊数の Top5 に SF を入れた。
- 確認の文（H5・H6・H7・M7）は、`window.confirmDialog` を「文を記録してキャンセルを返す」に替えて読んだ。描いた文はそのままで、押した後の処理は走らせない。
- 経路：H1・M1・H3・H6・H8 は本の詳細の編集で、選択肢を選び「追加」を押し、チップの × を押して出した。H2・H4・H7 は「漫画 / SF」を開き、複数選択のボタン→本を2冊押す→「本棚に追加」→一覧の行を押す・「本棚から外す」を押す、で出した。M6・M7 は本棚の作成・編集のフォームで、親を替えて「保存」を押した。M2 は Ctrl+K と入力。M3 は本棚を開く。M4・M5 はホーム。
  - H5（削除の確認）だけは、木の「…」が呼ぶ `deleteBookshelf` を直に呼んだ（#743 の step2 と同じ）。開くための `showBookDetail`・`showBookshelfForm`・`switchBookshelf` も直に呼んだ。どれも bookshelf._ の内部参照ではない（lint:internal-refs は上限内）。
- 場面と結果（chromium のスマホ390 と PC1280・各5件＝10件／webkit iPhone 13 で同じ10件）：

| 場面 | 確かめた事 | chromium | webkit |
|---|---|---|---|
| H1・M1・H3・H6・H8 | 選択肢・チップ（小説 / SF・漫画 / SF・小説 / SF / 海外・1階層は名前）・通知「「漫画 / SF」に追加しました」・除外の確認・子孫の選択の行。(c) s18 への追加の通知は「「… / 2026年に読み返したい本」に追加しました」で、本文の1文が2行以内（Range の行数で測った） | 緑 | 緑 |
| H2・H4・H7・H5・M6・M7 | 一括の一覧（収まる）・「2 冊を「漫画 / SF」に追加しました」・「…冊を「漫画 / SF」から外しますか？」・「本棚「小説 / SF」を削除しますか？」と子孫「・小説 / SF / 海外」（消えていない）・親の選択肢・「「小説 / SF / 海外」を「漫画 / SF」の下へ移動します」と「・漫画 / SF: +」 | 緑 | 緑 |
| M2・M3・M4・M5 (b)(d)(e) | ホームのカードと冊数に2つの SF（カードは収まる）・パレット「SF」は2つの SF だけ・「2026」はスマホで「… / 」始まり・title に全文、PC は全文・題「SF」と下の行「漫画」・s18 の下の行は親までで、スマホは「… / マーケティングとブランド」・PC は全文・流れる文字なし・1階層は下の行が hidden | 緑 | 緑 |
| (g) 低3 | 木の行に「 / 」が無い・空の棚の案内は名前だけ | 緑 | 緑 |
| (f) 切り替え off | チップに .shelf-path が無く SF が2つ・通知「「SF」に追加しました」・題「SF」で下の行なし・画面に .shelf-path が0 | 緑 | 緑 |

- webkit で流すため、playwright.config.js の webkit の testMatch（BACKNAV_WEBKIT=1 の時だけの project）に shelf-path-label.spec.js を1つ足した。計画では「config は触らない」だったが、スマホ幅の指定は spec の中の test.use で済ませた。webkit の project は名前を並べた所に入れないと流れないため。
- 繰り返し：chromium で --repeat-each=3 を流し、30件緑。
- 結果：npm test＝86 ファイル・1278 件 pass。npm run lint＝12 本中 0 本失敗。

## step4（関連する既存 spec・lint・単体・audit・画像比較）

- 既存 spec（chromium・計画の10本・77件）：最初は13件が落ちた。どれも「意図した変化」で、子の本棚の名前が親からのパスで出るようになったため。3本の期待を直し、どれも緑になった（commit b031ab4）。
  - book-detail-shelf-add（2件）：子のチップ「親の本棚 / 子の本棚」が hasText '親の本棚' に当たり、親のチップが2つに数えられた → 子のチップを除いて数える。
  - shelf-structure-home-refresh（10件）：本棚別 Top5 が「消す本棚Q / Qの子」と出る → 名前の欄は最後の段（本棚自身）で比べる。
  - exclude-custom-shelf（1件）：カードと Top5 の名前に親が入る → パスを本棚自身の名前に戻してから見分ける。
- char/bookdetail（char-390/768/820/1024）：7件緑。back-nav-matrix（webkit）：128件緑。gate/j3-2 は chromium で緑。gate-webkit では、もともと対象外（playwright.config.js の GATE_WEBKIT_IGNORE・PC の左ペインの操作のため）。
- lint 一式：12本中0本失敗。npm test：1278件 pass。check:version --range=origin/main..HEAD：OK。
- 画像比較（PORT=8746 visual-docker.mjs・v1.65.1-resolute）：54件 pass・差分0（1階層の見本の画面は今と同じ）。※ この時は後の2つの直し（1階層は素の名前／題の分割は親がある時だけ）の前の版で流した。どちらも1階層の見た目を前に近づける直しで、step5 の e2e-diff の visual でもう一度見る。
- audit（npm run audit・手元の work）：
  - 1回目：overflow 74（上限30）で違反。ホームのカードが、1階層の長い名前（long の見本）まで .shelf-path（nowrap）にしたため、格子の幅を押し広げていた。
    - 直し：1階層は前と同じ素の名前にした（shelfPathHtml・T1 は親がある時だけ）。.shelf-path のあるカードは min-width:0。
  - 2回目：overflow 26（上限内・前の30より少ない）。clip 86（上限70）。
    - 本棚の画面の題（#current-bookshelf-title）が、1階層の standard の見本でも clip に出た。題の分割と流れる文字の取りやめを、どの棚でもしていたため。
    - 直し：題の分割は親がある時だけにした。1階層・ALL・off は前と同じ題（名前＋流れる文字）。
  - 3回目と4回目：clip 80（上限70）で、まだ違反。
    - 残っているのは10件。どれも long の見本のホームのカード（home・home-edit の5幅ずつ）で、`h3 > span.shelf-path` が clip に出ている。
    - 描いた時に見えていなかった物を300ms後に1回だけ測り直す口を足したが（ui-components.js）、件数は変わらなかった＝原因は見えていないことではない。最後の段（本棚自身）だけでも収まらない長い名前で、is-self-wrap（折り返し）がカードの h3（flex・overflow hidden）の中で効いていない見込み（未確認）。
  - ログ：_vault-work/746/spill/audit-first.log・audit-after.log。
- M4 の部品（_renderBookshelfCard）が描かれる所：dashboard.js のホームの本棚ハイライトだけ。bookshelf.js の renderBookshelfOverview は #bookshelves-grid が index.html に無く、何もしない（git grep で bookshelves-grid は index.html に0件）。audit でもカードが出たのは home と home-edit（ホームの編集）だけだった。

### step4 の続き（②の差し戻し 17:56 の後）

- 残っていた clip 10件の原因を、実画面の値で確かめた。
  - 手元（_vault-work/746/harness/measure4.mjs・long の見本と同じ40字の親と子）では、カードの名前は `shelf-path is-self-wrap is-t1`。390 で 244x62 / 244x62、1440 で 328x42 / 328x42。手元では切れていなかった。
  - audit の生データ（test-results-audit/all/raw/layout/*long*）では、カードが `y 中身 244x64 / 箱 244x62` など、縦に 2px だけあふれていた。チップは `y 中身 226x58 / 箱 226x39`。
  - 原因：本棚自身の名前だけでも収まらない時の折り返し（is-self-wrap）が、行数の制限も省略の印も持っていなかった。そのため、audit の検出（overflow hidden で中身があふれていれば「文字の切れ」）に、意図した省略として扱われなかった。描いた時に見えていなかった事は原因ではなかった（測り直しの口を足しても件数は同じだった）。
- 直し（②の指示どおり「2行まで折り返しを許す」を第一にした）：
  - .shelf-path.is-self-wrap を2行の制限（-webkit-line-clamp: 2）にした。
  - .shelf-path に text-overflow: ellipsis を足した。測る前や測れない時は、末尾が「…」になり、黙って切らない。
  - tests/audit/layout-allowlist.json に `.shelf-path` の clip を1行足した。理由は「T1・末尾の省略・2行の制限＝意図した省略表示」。除外は ellipsis か line-clamp が実際に付いている時だけ効く（detectors/layout.js の intended）。
- 「300ms後に1回だけ測り直す」口は外した。原因ではなかったため（効かない物を残さない）。
- 直した後の版の結果：
  - audit（work）：layout exit 0。clip 70（上限70）・overflow 30（上限30）・pageX 0・overlap 0。a11y・buttons も exit 0（axe 6・input 2・inputPlaceholderOnly 12・select 2・variants 8）。前回の一覧との差は「増えた」0。
  - 同じ手元で origin/main（bee101c を git archive して展開）を流した：clip 83（上限超えで exit 1）・overflow 30。a11y と buttons の件数は work と同じ。＝この手元では、main の方が clip が多い。work は、どの件数も main 以下。
  - ログ：_vault-work/746/spill/audit-final.log（work）・audit-main.log（main）。
  - 画像比較（visual-docker・resolute）：直した後の版で 54件 pass・差分0。
  - 新 spec：chromium 10件・webkit 10件が緑。b031ab4 で直した3本（book-detail-shelf-add・shelf-structure-home-refresh・exclude-custom-shelf）も、新 spec と合わせて37件緑。
  - npm test：1278件 pass。lint：12本中0本失敗。check:version：OK。
- 1階層の扱いの変更（55bc59b・step6 の頁の「モックと違う所」に載せる）：
  - 1階層の本棚は、どの部品でも前と同じ素の名前（.shelf-path にしない）。
  - 本棚の画面の題も、1階層・ALL では前と同じ（名前＋流れる文字）。題を名前と下の行に分けて流れる文字をやめるのは、親がある棚だけ。
  - 理由：1階層まで1行の nowrap にすると、long の見本でホームのカードが格子を押し広げた（overflow 74）。題は、1階層でも clip に出た。

## step5（e2e-diff：main との全件比較）

- 流し方：`systemd-run --user --unit=e2e-diff-746 --working-directory=…/issue-746` で `node scripts/verify/e2e-diff-main.mjs --port=8746 --out=_vault-work/746/e2e-diff/out` を流した。18:06 に始めて 18:15 に終わった（約9分）。--init-storage は付けていない。
  - 8146 に、step2 の手元の測りで立てた python の http.server（17:34 起動・cwd はこの worktree）が残っていたので止めた。
- 比べた版：base＝origin/main @ b5b174a、work＝HEAD 7bed611。
  - この間に、#745（同じ親の下の同名を止める・b485daa・b5b174a）が main に入った。work はまだ #745 を含まない（rebase は step7）。
- 3表（report.md・_vault-work/746/e2e-diff/out/）

| 表 | E2E（playwright） | Unit（vitest） |
|---|---|---|
| work だけ落ちる（新しく落ちた） | 1件（下）→ 直した | 0件 |
| main だけ落ちる（新しく通った） | 0件 | 0件 |
| 両方落ちる（既存の問題） | 0件 | 0件 |

- 除外は、既定の1件（sort-perf-budget・CI でも別の step で流す物）だけ。
- 画像比較（e2e-diff の visual・work 側）：54件中0件が差分。
- work だけ落ちた1件：tests/e2e/exclude-local-reload-unexclude.spec.js の「675-A 保存先なしで1冊除外して再読込した後、除外一覧から取り消すと、蔵書と元の本棚に戻り book:added が出る」（chromium・3回流し直して3回とも落ちた）。
  - 落ちた所：ホームのカードの冊数が `{ p, c }` のうち c だけ取れない。
  - 原因：step4 の exclude-custom-shelf と同じ、意図した変化。子のカードの名前が「親の本棚 / 子の本棚」と親からのパスで出るため、「子の本棚を含み親の本棚を含まない」で子のカードを見分けられなくなった。
  - 直し：パスを本棚自身の名前に戻してから見分ける（exclude-custom-shelf と同じ直し方）。直した後、この spec は7件緑。
- 結論：work だけ落ちる物は、意図した変化の1件だけ。直したので、残りは0件。

## step6（ハヘロ向けの前後の頁）

- 頁：_vault-work/746/hahero/本棚の階層パス前後20261122/index.html（画像 img/pb・pa＝スマホの前後・cb・ca＝PCの前後・off＝切り替え off）。ダッシュボードの URL は https://homelab.tail83cfaa.ts.net:8444/bookshelf/5/3/本棚の階層パス前後20261122/ （curl で頁と画像5枚が200）。
- 撮り方：#743 の足場（mini.mjs・now.mjs）を _vault-work/746/harness/ へ写した。PORT を 8146、配信元を SNAP_DIR（前＝snap/before＝bee101c の git archive・後＝snap/after＝HEAD の git archive）にした。切り替え off は SHELF_FLAG=0 で撮った。差し込み（inject/label.js）は使っていない。同じ見本・同じ操作・同じ順で撮った。
- 撮れた場面：スマホは前後とも20場面（H1〜H8・H3b・M1〜M7・M3b・L1〜L3・U1）。PC は前後とも、頁に載せた5場面（M1・M2・M3・M3b・M4）。off は3場面（M1・H3・M3）。PC の H3（本の詳細からの追加の通知）は、#743 と同じ理由で載せていない（足場で撮れない場面・文はスマホと同じ）。
- 「前」は bee101c（#745 が入る前の main）で撮った。今回の変更だけを前後で見せるため。
