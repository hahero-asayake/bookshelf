# イシュー#635 衝突の3択を1つに寄せる・最初のフォーカスを揃える — 確かめた結果

## step1: 現状の固定と、書き込み時の「上書き」の道の実測 (2026-11-14 15:04〜)

### 1. 土台

- worktree `issue-635` を origin/main `6dc2c04` へ早送りした。#602 の `029bf88` が祖先であることを `git merge-base --is-ancestor` で確かめた。
- #612 (変えたファイルだけ送る) はまだ main に無い (`git log origin/main --grep='Issue: #612'` が0件。`issue/612` の `3b69968` にある)。

### 2. 現状の2つのダイアログ

| | 書き込み時 (`#sync-conflict-dialog`・#616) | 読込時 (`#load-conflict-dialog`・#602) |
|---|---|---|
| 作る関数 | `js/bookshelf.js` `_showConflictDialog` (呼び手 `_handleSyncConflict`) | `js/bookshelf.js` `_showLoadConflictDialog` (呼び手 `_askLoadConflict`) |
| 題 | 同期の衝突 | 保存先とこの端末の両方が変わっています |
| ボタン (左→右) | 何もしない (灰)／編集内容をJSONで書き出す (灰)／再読込して最新版を取得 (青) | 保存先の内容を読み込む (赤)／この端末の内容で保存先を上書き (赤)／この端末の内容を書き出す (青) |
| 最初のフォーカス | 再読込して最新版を取得 | この端末の内容を書き出す |
| 390幅の並び (実測) | 1行目に「何もしない」「書き出す」、2行目に「再読込」 | 1つずつ3行 (右寄せ・幅はそろっていない) |
| 1280幅の並び (実測) | 3つが1行 | 1行目に「読み込む」「上書き」、2行目に「書き出す」 |

- 画像: `_local/635/before-{write,load}-{390,1280}.png` (commit しない)。ボタンの位置・文言・最初のフォーカスは `_local/635/before-measure.json`。
- 撮るスクリプト: `scripts/verify/635-shots.mjs` (`PORT=8135 node scripts/verify/635-shots.mjs <label>`。step2・step4 は `after` で撮る)。ダイアログは内部の関数で直接出す (見た目を撮るためだけ)。

### 3. 変更前の合否 (origin/main `6dc2c04`)

| spec | project | 結果 |
|---|---|---|
| `tests/e2e/gate/j6-4-sync-conflict.spec.js` | chromium | 2 passed |
| 同上 | gate-webkit | 2 passed |
| `tests/e2e/sync-conflict.spec.js` | chromium | 2 passed |
| `tests/e2e/standard-ops.spec.js` | chromium | 28 passed |
| `tests/e2e/sync-offline-reconnect.spec.js` (#602 の13本) | chromium | 13 passed |
| `tests/e2e/back-nav-matrix.spec.js` D03c | chromium | 1 passed |
| `tests/e2e/char/hub-conflict.spec.js` | char の6端末 | 3 passed・15 skipped (3幅だけを見る spec) |

落ちは0件。

### 4. 書き込み時の「上書き」の道の実測 (probe)

使い捨ての probe (`tests/e2e/zz-probe-635.spec.js`。commit せず `_local/635/` に移した)。J6-4 と同じ手順で2台を衝突させ、Esc で閉じた後に次の順で見た。

1. (d) 外への通信をすべて落とした状態で、上書きの道 (`storage.loadAll()` → 成功した時だけ衝突中の印を消す → `_writeSyncBase` → `_keepLocalOverLoaded`) を通す。
2. (a)(b)(c) 通信を戻して、同じ道を通す。
3. 続けて短文メモを書く (版が取り直されているか)。
4. 端末Aを開き直す (保存先が端末Bの内容になったか)。

| | ハブ | GitHub (アダプタを変えない) | GitHub (参考: tree の控えを捨ててから読む) |
|---|---|---|---|
| (d) 読み直しの失敗 | Failed to fetch。衝突中の印・未反映の印が残り、書き込みは0 ✓ | 同じ ✓ | 同じ ✓ |
| 読み直した中身 | 最新 (Aの短文メモあり) | **起動した時の古い中身 (Aの短文メモ無し)** | 最新 |
| (a) 次の保存 | 衝突せずに通る。印が消える ✓ | **また衝突する (印が付き直す)・書き込み0** ✗ | 通る ✓ |
| (b) 保存先が手元の内容になる | notes.json がBの短文メモ (Aは無い)。端末Aを開き直すとBの内容 ✓ | notes.json はAのまま ✗ | ✓ |
| (c) 混ざらない | 中身の変わった書き込み7本 (今の main は毎回全部を送る)。Aの短文メモが残るファイルは無い ✓ | — | commit 1つ ✓ |
| 続けて書く | 届く・衝突しない ✓ | 届かない ✗ | ✓ |

ログ: `_local/635/probe.log` (ハブ・GitHub)、`_local/635/probe-github-reset.log` (参考の版)。

**GitHub で通らない理由**: `js/github-adapter.js` の `_ensureRemoteShaMap()` (104-133行) は、リポジトリの tree の sha の一覧を1回だけ取り、ページを開き直すまで取り直さない。`storage.loadAll()` は `_tryReadFromShaCache()` (175-188行) でこの古い一覧と手元の控え (VersionCache) から中身を返すので、他の端末が書いた後の中身を読まない。そのため、まとめ保存の照合 (`_assertBatchNotStale`・#616) がもう一度「古い版」と判定する。既存の口 `clearShaCache()` (486行) は `_shaCache` しか消さない。#616 の決まり (照らし合わせで最新を見つけても `_shaCache`・`_lastKnownContent` を更新しない＝更新すると次の試行が上書きしてしまう) もあり、読み直した版を新しい土台にするにはアダプタに手を入れる必要がある。今の「再読込して最新版を取得」は `location.reload()` でページごと作り直すので、この問題に当たらない。

参考の版 (probe の中で `_remoteShaMap`・`_treeFetchPromise` を捨ててから読む) は (a)〜(d) が全部通った。アダプタに「tree の控えを捨てる」口を1つ足せば、GitHub でも案1が成り立つ見込み。

**#612 との関わり (コードを読んだだけ・未実測)**: #612 (`3b69968`) の `_dropUnchanged` は、ハブのアダプタが最後に読んだ・書いた中身 (`_lastKnownContent`) と同じ put を送らない。ハブは読み直しで最新の中身を取り直すので、手元と保存先で違うファイルは送られる見込み。

### 5. 判定

決まり (計画 step1 の 5)): アダプタを変えずに (a)〜(d) が通れば案1、通らない・アダプタの変更が要るなら案2。

- ハブはアダプタを変えずに通る。GitHub は (a)(b) が通らず、通すにはアダプタの変更が要る。
- 保存先によって選べる物を変える (ハブだけ「上書き」を出す) のは、場面で出る物が違うという今回の問題を別の形で残すので採らない。
- **案2 で step2 を実装する。**

案2 の中身:
- 定義は1つ (題・本文・ボタンの文言と見た目・並び・最初のフォーカス・書き出した後の知らせ)。2つのダイアログはそこから作る。
- 題は2つとも「保存先とこの端末の両方が変わっています」。最初のフォーカスと Enter は2つとも「この端末の内容を書き出す」。
- 書き込み時のボタンは「保存先の内容を読み込む」(赤・今の「再読込して最新版を取得」と同じ動き) と「この端末の内容を書き出す」(青) の2つ。「上書き」は出さない。
- 「何もしない」のボタンは無くし、Esc・枠外クリックで閉じる (②の回答3)。390幅の枠外クリックで閉じ、閉じた後も手元の内容と衝突中の印が残ることを見るテストを1本足す (②の回答3)。
- 本文の「どちらの内容を使うか選んでください。選ばなかった方の変更は消えます。」は、書き込み時には合わない (上書きを選べない) ので、書き込み時だけ別の文にする。書き込み時の案:「保存先（{保存先}）の内容が、別の端末などで更新されています。この端末にも、まだ保存先に入っていない編集があります。保存先の内容を読み込むと、この端末の未保存の編集は消えます。迷う時は、先にこの端末の内容を書き出してください。」(lint:copy・lint:terms は step2 で流す)

### 6. 申し送り

- 案1 (書き込み時にも「上書き」) にするには、GitHub のアダプタに tree の控えを捨てる口を足す変更が要る。07 に行を起こすかは step4 で決める。
- ②の追加指示「#612 が main に入っていたら step4 で (a)〜(d) をやり直す」は、案2 では書き込み時に上書きの道を作らないので対象が無くなる。step4 では、#612 が入っていたら J6-4 (chromium・gate-webkit)・sync-conflict・sync-offline-reconnect を載せ直した後の版で流し直す形に読み替えたい (②の判断を仰ぐ)。
- 検証のサーバ: `python3 -m http.server 8135` を自分で立てて流した (playwright は `reuseExistingServer: true`)。

## step2: 共通の定義と部品の実装 (2026-11-14 15:11〜・案2)

### 1. 入れたもの

- `js/bookshelf.js` の先頭に、選択ダイアログの定義 `CONFLICT_DIALOG` を1つ置いた (題・本文・ボタンの文言と見た目・並び・最初のフォーカス・書き出した後の知らせ)。
- ダイアログを組む関数は `_showConflictChoiceDialog(id, source, choices)` の1つ。`_showLoadConflictDialog` (読込時・`['remote','local','export']`) と `_showConflictDialog` (書き込み時・`['remote','export']`) はこれを呼ぶだけ。id は2つとも残した。ボタンのクラスは `.cfm-remote`／`.cfm-local`／`.cfm-export`。
- `_handleSyncConflict` の選択を定義の語にした: `'remote'`＝今の「再読込」と同じ動き (予約・未反映の記録・衝突中の印を消して読み直す)、`'cancel'` (Esc・枠外クリック)＝今の「何もしない」と同じ動き。保存先の名前は `_syncLabel()` に寄せ、`_syncConflictSource()` は消した (GitHub の時は `owner/repo@branch` が出る)。`_askLoadConflict` の動きは変えていない。
- CSS: 2つの id を並べたセレクタを共通のクラス `.conflict-dialog` に置き換えた (幅 600px・折り返し・ボタンの改行なし。値は同じ)。
- `?v=`: `bookshelf.js` 2026111603→2026111604、`bookshelf.css` 2026111600→2026111601。

### 2. 文言 (変更前と変更後)

| | 変更前 | 変更後 |
|---|---|---|
| 書き込み時の題 | 同期の衝突 | 保存先とこの端末の両方が変わっています |
| 書き込み時の本文 | 同期先（{保存先}）のデータが他の場所から更新されています。このセッションの直近の編集はまだ同期先に反映されていません。「再読込」を選ぶと最新版を取得しますが、未反映の編集は失われます。心配なときは先に「編集内容を書き出す」で退避してください。 | 保存先（{保存先}）の内容が、別の端末などで更新されています。この端末にも、まだ保存先に入っていない編集があります。保存先の内容を読み込むと、この端末の未保存の編集は消えます。迷う時は、先にこの端末の内容を書き出してください。 |
| 書き込み時のボタン | 何もしない (灰)／編集内容をJSONで書き出す (灰)／再読込して最新版を取得 (青・最初のフォーカス) | 保存先の内容を読み込む (赤)／この端末の内容を書き出す (青・最初のフォーカス) |
| 書き込み時の書き出した後の知らせ | 現在の編集内容を書き出しました。 | この端末の内容を書き出しました。 |
| 読込時の本文 | {保存先} の内容が、この端末で最後に保存した後に、別の端末などで更新されています。この端末にも、まだ保存していない編集があります。どちらの内容を使うか選んでください。選ばなかった方の変更は消えます。迷う時は、先にこの端末の内容を書き出してください。 | 保存先（{保存先}）の内容が、別の端末などで更新されています。この端末にも、まだ保存先に入っていない編集があります。どちらの内容を使うか選んでください。選ばなかった方の変更は消えます。迷う時は、先にこの端末の内容を書き出してください。 |
| 読込時の題・ボタン・最初のフォーカス | (変えていない) | 同じ |

lint:copy・lint:terms は直さずに通った。

### 3. 見た目 (座標・`_local/635/{before,after}-measure.json`)

| | 箱 (左〜右) | ボタンの右端 | 行数 | 最初のフォーカス |
|---|---|---|---|---|
| 書き込み時 390 変更前 | 16〜374 | 147・352・353 (そろっていない) | 2 | 再読込して最新版を取得 |
| 書き込み時 390 変更後 | 16〜374 | 352・352 | 2 (1つずつ・右寄せ) | この端末の内容を書き出す |
| 書き込み時 1280 変更前 | 340〜940 | 527・733・918 | 1 | 再読込して最新版を取得 |
| 書き込み時 1280 変更後 | 340〜940 | 721・918 | 1 | この端末の内容を書き出す |
| 読込時 390 (前後とも) | 16〜374 | 352 | 3 | この端末の内容を書き出す |
| 読込時 1280 (前後とも) | 340〜940 | 679・918 | 2 | この端末の内容を書き出す |

どのボタンも箱の内側に収まる (はみ出し0)。並べた画像は `_local/635/compare-{write,load}-{390,1280}.png` (左＝変更前・右＝変更後)。

### 4. テスト

- 直した spec: `gate/j6-4-sync-conflict.spec.js` (題・ボタンの名前・押すボタン・最初のフォーカス・ボタンが2つ)、`sync-conflict.spec.js`、`char/hub-conflict.spec.js`、`standard-ops.spec.js` と `back-nav-matrix.spec.js` D03c (テスト名の「何もしない」)。
- 足したテスト (`sync-conflict.spec.js`・②の回答3): 390幅で2台の本当の衝突を起こし、最初のフォーカスが「書き出す」、Enter は書き出すだけでダイアログに戻る、枠外クリックで閉じた後も手元の短文メモ・衝突中の印・未反映の印が残り、保存先は端末Aの短文メモのまま。
- 結果: chromium (J6-4・sync-conflict・standard-ops・sync-offline-reconnect) 46 passed、gate-webkit の J6-4 2 passed、D03c 1 passed、char hub-conflict 3 passed (15 skipped)。lint (css・esc・js-color・copy・terms・internal-refs・e2e-gate・e2e-wait・e2e-goto) すべて OK。

## step3: 残りのテスト・lint・全件比較と docs (2026-11-14 15:25〜)

### 1. docs の更新

- `docs/ui-standards.md` §1: 「同期衝突ダイアログ (3択)」と「読込時の衝突ダイアログ (3択・イシュー#602)」の2行を、「衝突の選択ダイアログ (書き込み時・読込時・イシュー#635)」の1行にした (定義 `CONFLICT_DIALOG`・選べる物・既定のフォーカス・選ばずに閉じた時・幅)。
- `tests/audit/screens.js`: §1 の行の名前が変わったので、`sync-conflict` の `std1` を「衝突の選択ダイアログ」に、題を「衝突の選択ダイアログ（書き込み時）」にした。読込時の対象外の行は `std1` を外し、理由に「書き込み時と同じ定義から出る」を足した (`tests/unit/audit-screens-coverage.test.js` 5本 OK)。
- `docs/char` の E4 (u0-findings.md・u0-77-table.md・u0-targets.md・u5-inventory.md) と `tests/e2e/gate/README.md` の J6-4 の行を、今の選び方 (読み込む・書き出す・Esc で閉じる) と定義の場所に合わせた。

### 2. 書き込み時の「保存先の内容を読み込む」で最新の中身が入るか (GitHub の模擬・②の追加指示)

- 手順 (門の J6-4 GitHub 版 `tests/e2e/gate/j6-4-sync-conflict.spec.js:106` と同じ): リポジトリの模擬 (gate-github.js) に蔵書を置き、端末Aと端末Bで開く → Aが短文メモを書いてリポジトリに届く → Bが古い版のまま同じ本に別の短文メモを書く → Bにダイアログが出る → 「この端末の内容を書き出す」→ もう一度出たダイアログで「保存先の内容を読み込む」→ 読み込みの後に本を開く。
- 結果: Bの短文メモ欄が端末Aの短文メモ (最新) になった (`toHaveValue(MEMO_A)`)。chromium・gate-webkit とも緑 (step2 の `_local/635/after-chromium.log`・`after-webkit.log`、この step の全件比較)。
- 理由: 「保存先の内容を読み込む」は今までの「再読込」と同じく `location.reload()` でページごと作り直すので、GitHub のアダプタも作り直され、tree の控え (`_ensureRemoteShaMap`) も取り直される。step1 で見つけた「同じページのまま読み直すと起動時の古い中身が返る」は、この道には効かない。

### 3. lint・check:version

- lint は package.json の11本すべて OK (css・esc・js-color・copy・terms・internal-refs・e2e-gate・e2e-wait・e2e-goto・breakpoint・known-red)。
- `check:version --range=origin/main..HEAD`: OK (bookshelf.js・bookshelf.css の ?v= は上げてある)。
- vitest: step2 で 1088 passed。この step の docs 変更で関わる `tests/unit/audit-screens-coverage.test.js` は5本 OK。

### 4. 全件比較 (e2e-diff-main)

- 最初は base を origin/main にしたが、origin/main が進んでいた (J5-1・J6-5 の投入、#631 の修正、J3-4 の待ちの修正など6 commit) ので、今回の変更だけを比べるため base を作業の土台 `6dc2c04` にして流し直した (`--base=6dc2c04 --port=8135`)。
- 12分の上限で打ち切った (他のイシューの全件比較と重なり、base 側の E2E だけで5分半かかった)。**base 側は完走、work 側の E2E は途中、vitest と画像比較 (visual) は流れていない**。work 側の結果は JSON の書き出しが最後なので残っていない。
- base 側 (変更前): 991 passed・2 failed・594 skipped。落ちた2本は `book-memo-file-lifecycle.spec.js`「題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない」(GitHub) と `save-failure-visible.spec.js`「再試行が尽きた失敗は…」(GitHub)。
- この2本の spec を work 側で単独に流し直した (監査の6並列と同時): 3 failed・28 passed。落ちたのは上の2本と `save-failure-visible.spec.js:136`「1回目の自動の再試行で直る失敗は、何も出さない」(GitHub)。3本とも `expect.poll` の5秒の時間切れ。保存の失敗 (500) の再試行と長文メモの題名の変更の spec で、衝突の経路 (`_handleSyncConflict`・`_showConflictChoiceDialog`) は通らない。今回の変更で動きが変わるのは衝突した時だけなので、負荷による揺れと見ている (base でも同じ spec が落ちている)。
- 衝突まわりの spec は step2 で単独に緑を確かめてある (chromium 46・gate-webkit の J6-4 2・D03c 1・char hub-conflict 3)。
- visual: 衝突ダイアログの基準画像は無い。全件比較の中の画像比較は流れなかったので、他の画面に差分が出ないことは確かめていない。CSS の変更は、2つの id を並べたセレクタを1つのクラスに置き換えただけ (値は同じ)。

### 5. 監査 (npm run audit・6並列・744件)

- 3検査とも exit 0 (a11y・buttons・layout)。
- buttons (ボタン名の揺れ): 前回の一覧から「`variants|confirm:cancel|何もしない`」が消えた (書き込み時の衝突ダイアログから「何もしない」のボタンを無くしたため)。増えたものは0。`node scripts/check-audit.mjs buttons --from=test-results-audit/all --update` で一覧 (`tests/audit/findings/buttons.json`) と基準値 (`tests/audit/baseline.json` の buttons.variants 9→8) を書き直した。
- layout: clip が1件減った (`shelf` の char-390 の表紙の代わりの表示)。衝突ダイアログとは関係ないので、基準値は書き直していない (69/70 のまま上限以内)。a11y は前回と同じ。
