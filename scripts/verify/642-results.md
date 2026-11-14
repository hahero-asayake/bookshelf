# イシュー#642 本棚の親の付け替え・削除の後のホームの集計

## step1 実測 (2026-11-14・アプリは変えていない・HEAD 0300351 = origin/main 6dc2c04 の後ろに他イシュー6 commit)

spec: `tests/e2e/shelf-structure-home-refresh.spec.js` (chromium・PORT=8142・workers=5・1回の実行の上限5分)。
蔵書20冊・利用者の本棚8つ (+fixture のテスト本棚)。冊数はすべて違う: 消す本棚Q 14 > Qの子 13 > 移す本棚A1 11 > 移す本棚A2 9 > A1の子 4 > テスト本棚 3 > A2の子 2 > 受ける本棚P1・P2 1。
受ける本棚 P1・P2 は、移す本棚に無い本を1冊だけ持たせた (計画では「本の無い本棚P」。空だと補充の後に移す本棚と同じ冊数になり、Top5 の同数の並びが配列の順に左右されるため)。

観測点: 本棚別 Top5 (名前と冊数の並び全体)・本棚ハイライトのカードの冊数・左ツリーの本棚の冊数・消えた本棚のカードとツリーの行・蔵書 20 冊・「すべての本」20。

| 経路 | S1 ホームを表示したまま | S2 本の詳細を開いたまま | S3 本棚の一覧から戻る | 390幅 S1 |
|---|---|---|---|---|
| ① 本棚フォームで親を付け替える (A1→P1。P1 が 1→12) | 緑 (ホームのまま、その場で新しい値) | 緑 (同) | 緑 (戻った時に新しい値) | 緑 |
| ② ツリーのドラッグで付け替える (A2→P2。P2 が 1→10) | 緑※ | 緑※ | 緑 | — |
| ③ 子つきの本棚を削除する (Q と Qの子が消え、テスト本棚・A2の子が繰り上がる) | 緑 | 緑 | 緑 | — |

結果: 10本中10本が緑 (2回目・3回目の実行。`10 passed (22.5s)`・`10 passed (17.9s)`)。古いまま残った集計は無かった。

※ ② の S1・S2: ドロップした直後に、ドラッグした本棚 (移す本棚A2) の一覧が開く (body が `app-view-bookshelf`・見出し「移す本棚A2」)。
このため、`_onTreeDrop` が `updateBookshelfSelector()` を呼ぶ時点ではもうホームではなく、`dashboard.render()` は飛ばされる。
隠れているホームの Top5 は古いままだった: `["消す本棚Q14","Qの子13","移す本棚A111","移す本棚A29","A1の子4"]`。
左上のロゴでホームへ戻ると (router の `_applyRoute` main が `dashboard.render()` を呼ぶ) 新しい値になる。
1回目の実行では、ここで「ホームのまま」の確かめが赤になり (2 failed)、この動きに気づいた。
ドロップで一覧が開くのは今回の範囲外 (起票候補)。E2E のマウス操作 (#623 (j) と同じ mouseDrag) で起きた。実機のマウスでは未確認。

素通り防止: spec の写しで期待値をわざと変えて (P1 の名前を「無い本棚」に、P1 の冊数を 99 に)、① の S1 を1本流した。
3か所とも赤になった (Top5・カード「99冊」に対して「12冊」・ツリー「99」に対して「12」)。写しは `_trash/zz-642-sanity.spec.js` へ退避した (commit しない)。

lint: internal-refs・e2e-wait・e2e-goto・e2e-gate・known-red はすべて OK。

## step2 裏付け (2026-11-14・描き直しの呼び出しを一時的に外して spec を流した・確かめた後は元に戻した)

行番号は HEAD 0300351。戻した後の `git diff` は0行 (2回とも確認)。`git status` は spec と、この結果ファイルの2つが未追跡なだけ。

(a) 3経路の `updateBookshelfSelector()` を `_renderSidebarTree()` に差し替えた。ツリーの描き直しは残し、ホーム表示中の `dashboard.render()` だけを外した形。
差し替えた所は js/bookshelf.js:5325 saveBookshelfForm・5389 deleteBookshelf と、js/screens/bookshelf-list.js:188 _onTreeDrop (if の条件を false にして、else の `_renderSidebarTree()` を通した)。
→ 5 failed / 5 passed。
- 赤: フォームの S1・S2・390 S1、削除の S1・S2。落ちた観測点は、本棚別 Top5 が5か所、カード p1642 が3か所、消えた本棚のカード q642・qc642 が2か所ずつ。ツリーの冊数は合っていた。
- 緑: フォームの S3、削除の S3、ドラッグの S1・S2・S3 (ドラッグはドロップでホームを離れ、戻る時に描き直される)。
- 最初の試行では if の行をコメントにしたため、次の行の else が宙に浮いて構文エラーになり、起動の時点で10本とも赤になった (計測の誤り・結果には数えない)。

(b) `_applyRoute` の main の `dashboard.render()` (js/bookshelf.js:5133・#398) を外した。
→ 5 failed / 5 passed。
- 赤: S3 の3本と、ドラッグの S1・S2 (どちらもロゴでホームへ戻ってから見ている)。落ちた観測点は、本棚別 Top5 が5か所、カード p2642 が3か所・p1642 が1か所、消えた本棚のカードが q642・qc642 で1か所ずつ。
- 緑: フォーム・削除の S1・S2 と 390 S1。

結論:
- ホームを表示したまま操作した時は、各経路の `updateBookshelfSelector()` の中の `dashboard.render()` (js/bookshelf.js:4081-4088) がその場で描き直している。
- 本棚の一覧などからホームへ戻る時は、`_applyRoute` main の `dashboard.render()` が描き直している。
- `_onLibraryChanged()` が足すのは all本棚の揃え直し (js/bookshelf.js:4099-4104) だけで、蔵書の冊数が変わらないこの3経路には要らない。ホームの描き直しは、どちらも同じ `updateBookshelfSelector()` を通る。

## step2 横展開 (本棚の所属・構造を変える経路・HEAD 0300351)

| 経路 | 場所 | 最後の描き直し | ホーム |
|---|---|---|---|
| 本棚フォーム (作成・名前などの変更・slug の変更・親の付け替え) | js/bookshelf.js:5257 saveBookshelfForm (create 5308・update 5292・rename 5305・reparent 4474 経由) | updateBookshelfSelector (5325) | その場 (S1/S2 実測)・戻る時 |
| ツリー・本棚管理の一覧のドラッグ (親の付け替え・同じ階層の並べ替え) | js/screens/bookshelf-list.js:138 _onTreeDrop (一覧の D&D も 466 で同じ所を通る) | updateBookshelfSelector (188) | ドロップでホームを離れる (下の※)・戻る時 |
| 本棚の削除 (子ごと) | js/bookshelf.js:5358 deleteBookshelf | updateBookshelfSelector (5389) | その場・戻る時 |
| 本の詳細からの本棚への追加・外す | 5400 addBookToBookshelf・5518 removeFromBookshelf | _onLibraryChanged (5446・5560・#615) | その場・戻る時 |
| 一括で本棚へ追加・一括で外す (選択モード) | 1509 _bulkAddToShelf・1592 _bulkRemoveFromShelf | _renderSidebarTree だけ (1529・1609) | 本棚の一覧の中の操作なのでホームは見えていない。戻る時に描き直される |
| 一括の除外 | 1534 _bulkExclude | _onLibraryChanged (1552・#605) | その場・戻る時 |
| 同期の読み直し・保存先の切り替え | 2926 _askLoadConflict (2947)・3099 initCloudSync (3140)・3228 initGitHubSync (3260)・3336 initObsidianSync (3354)・3365 selectObsidianFolder (3388)・3595 reloadFromObsidianFile (3602) | updateBookshelfSelector | その場・戻る時 |
| プラグイン API | js/plugin-api.js | 本棚を変える呼び出しは grep で0件 | — |

範囲外の起票候補: ※ ツリーで本棚をドラッグして別の本棚の真ん中へ落とすと、ドラッグした本棚の一覧が開いてホームを離れる (step1 で発見・E2E のマウス操作で起きた・実機は未確認)。集計は戻った時に正しい。
古いまま残る経路は、横展開でも見つからなかった。

## step3 見張りとして残す (2026-11-14・案A: アプリは変えない)

②の決定 (step2 承認): 全部緑だったので案A。アプリ・index.html の ?v=・設計書は変えない。spec を回帰の見張りとして残す。
spec の整理:
- 測るための console.log を外した。
- ドラッグの S1・S2 は、ホームを離れるかどうかを確かめない (落とすと一覧が開く動きが直っても赤にしない)。離れていたらロゴでホームへ戻り、戻った時の値を見る (`settleOnHome`)。
- フォームと削除の S1・S2 は、ホームのまま (S2 は詳細も開いたまま) その場で見る。
- 素通り防止の写し (`_trash/zz-642-sanity.spec.js`) は commit しない。

検証 (HEAD e7f5e0d = その時の origin/main・#638 の 9ca35fd を含む・chromium・PORT=8142):
- 新しい spec を --repeat-each=3: 30 passed (10.2s)。
- 関連 spec (library-count-refresh・book-detail-shelf-meta・shelf-file-delete・dashboard-stats-after-manual-add・dashboard-recent-books): 44 passed (1.2m)。
- `npm test`: Test Files 74 passed・Tests 1099 passed | 2 todo。
- lint 一式 (css・e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs・copy・terms・known-red・e2e-gate --strict-coverage): すべて OK。
- main との全件比較 (`scripts/verify/e2e-diff-main.mjs --port=8142`・15:56〜16:06): E2E は新しく落ちた 0件・新しく通った 1件 (gate/j2-2-import-paste。base 側で落ちていた門の E2E で、この変更とは関係しない)・両方で落ちた 0件。vitest は 0件・0件・0件。画像の差分は 54件中 0件。
  比べた base は origin/main 76e122c (実行中に main が進み、#612 の6 commit が base にだけ入っていた)。work 側の変更はこの spec 1本の追加だけ。
- その後 main を 51f29dd (#612・#635 を含む) まで取り込み直し、lint 一式 (上の11種) をすべて OK・新しい spec を --repeat-each=3 で 30 passed (25.7s) と確かめた。
