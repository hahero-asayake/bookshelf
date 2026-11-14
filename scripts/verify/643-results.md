# イシュー#643 空の保存先で初期化と最初の保存が重なると initEmpty が2回走る — 確かめた結果

## step1 再現の E2E と影響（直す前の版 = origin/main 0300351）

### 流したもの

- spec: `tests/e2e/first-run-save-during-init-empty.spec.js`（ハブ・chromium・PORT=8143）
  - 空のハブ → 「新規データで初期化しますか？」で OK → 初期化の途中（all.json が届く前）に、本物の操作（設定 → 蔵書 → 手動で追加）で1冊足す → 模擬のハブへの書き込みが4秒止まるまで待つ → 数える → 開き直す → 数える → 2冊目を足す → 数える
  - 時機の作り方：spec の中で `page.route` を足し、1件ずつの書き込み（PUT /data/*）を1件1.5秒遅らせてから gate-hub.js の模擬へ回す（gate-hub.js 本体は変えない）
  - 数えたのは模擬のハブの中身と通信だけ（アプリの内部は読まない）
- 回数：7回（1回＋3回＋3回）。全回の出力は `tmp/643/red-before-1.txt`・`red-before-repeat3.txt`・`red-before-ids.txt`（tmp/ は .gitignore で commit しない）
- gate-hub.js の模擬は PUT に常に 200 を返す（`tests/e2e/helpers/gate-hub.js:391-392`）。そのため #633 で見えた「201 から 200」の違いはここでは出ない。初期化が何回走ったかは、初期化の7ファイルへの PUT の回数で数えた（まとめ保存は POST /data/batch で PUT を使わない＝初期化以外で7ファイルに PUT は来ない）

### 結果（7回とも赤・落ちたのは「PUT の回数」の主張だけ）

| 回 | 初期化の7ファイルへの PUT | 2回の初期化が書いた「すべての本」の id（1回目 → 2回目） | 最初の保存の後の保存先の id（bookshelves.json / all.json / main.json） | 冊数・asin（library / all） | 開き直した後 | 2冊目の保存の後 |
|---|---|---|---|---|---|---|
| 1 | 各2回 | （この回は控えていない） | xoobnla6 / 同 / 同 | 1冊 B0INITSAV1 / 同 | 確認・3択 0件・id 同じ・蔵書数1 | id 同じ・2冊・蔵書数2 |
| 2 | 各2回 | （控えていない） | hpk9qeob ×3 | 1冊 / 同 | 同上 | 同上 |
| 3 | 各2回 | （控えていない） | 37914zsl ×3 | 1冊 / 同 | 同上 | 同上 |
| 4 | 各2回 | （控えていない） | zpuh0sde ×3 | 1冊 / 同 | 同上 | 同上 |
| 5 | 各2回 | jt0vhq2j → 5gs3qvlg | 5gs3qvlg ×3 | 1冊 / 同 | 同上 | 同上 |
| 6 | 各2回 | 357v1rzs → dz7j54rt | dz7j54rt ×3 | 1冊 / 同 | 同上 | 同上 |
| 7 | 各2回 | slm9buif → rvewlszq | rvewlszq ×3 | 1冊 / 同 | 同上 | 同上 |

- 赤の中身：7回 × 7ファイル = 49件の「PUT の回数 期待1・実際2」だけ（3つの出力の `Error:` を数えた：7件・21件・21件、すべて「への PUT の回数」）。id の一致・冊数・asin・開き直した後の確認0件・蔵書数の表示は、7回とも主張どおり
- 新しい spec で lint:internal-refs（上限82以内）・lint:e2e-wait・lint:e2e-goto・lint:e2e-gate は OK（e2e-gate の「J3-5 未達」の警告は前からのもの）
- 開き直した後の同期欄は「保存済み」（7回とも）

### 結論

- **2回の初期化は「すべての本」の id を別々に作る：確かめた**（回5〜7で、1回目と2回目の初期化が違う id を書いた）
- **保存先のファイル同士の食い違い：残らない**（この場面）。2回目の初期化が7ファイルとも後から書くので、3か所とも2回目の id に揃う。その後の最初の保存も同じ id で書く
- **保存先と手元の食い違い：残らない**（この場面）。開き直しても確認・3択は出ず、2冊目を足した次の保存の後も3か所の id は変わらず、冊数・asin も合う＝手元も2回目の id を持っている
- 残る害は、初期化の7件をもう一度書くこと（本番のハブは1件 約2秒＝約14秒の余分な書き込み）と、1回目の初期化が作った id が捨てられること
- したがって、この場面では案D（起動の読込が終わるまで保存を待つ）で足りる。案Dで消えない食い違いは、この場面では見つからなかった

### 測っていないもの（未実測）

- 起動前から手元に別の保存先の allInternalId が残っている時（保存先を切り替えた人）。#612（変えたファイルだけ送る）が入った後の版で、step2 の前にもう一度数える（②の申し送り）
- 初期化の途中に、本ではなく設定・メモを変えた時（2回目の初期化が settings.json・notes.json を既定値で書き直す）
- GitHub・ローカルの空の保存先（コード上は同じ形：js/bookshelf.js L3246・L3381）

## step2 案D で直した（js/bookshelf.js・index.html の ?v=）

### 基にした版

- step2 の前に fetch した：#633 が origin/main に入った（4f1a19b）ので、その上に rebase した（step1 の commit は 57aad53 になった）。#612 はまだ入っていない＝「起動前から手元に別の保存先の allInternalId が残っている形」は未実測のまま（step4 の rebase で合わせる）
- 0300351 と 4f1a19b の間で js/ と index.html は変わっていない（`git diff --stat 0300351 4f1a19b -- js/ index.html` が空）。spec も step1 から変えていない
- 念のため、直した後に、直す前の版（57aad53）の js/bookshelf.js・index.html を作業ツリーに一時的に戻し、同じ spec を1回流して戻した：**赤**（`Error:` 7件・すべて「への PUT の回数」・初期化の id 3kbm3769 → udegk8h9 の2つ・出力 `tmp/643/red-before-final-1.txt`）

### 直したところ

- 起動の読込の印を1つの入口で持つ：`_beginBootLoad()`（立てて、下ろす関数を返す）・`_waitBootLoads()`（立っている間は待つ）。印は Set で持つ＝読込が2本重なっても、全部が終わるまで待つ
- 印を立てるのは起動の読込3か所：`initCloudSync`（ハブ）・`initGitHubSync`（GitHub）は本体を `_initCloudSyncLoad`・`_initGitHubSyncLoad` に移し、入口で立てて finally で下ろす。`selectObsidianFolder`（ローカル）は detectFormat の直前で立て、既存の try に足した finally で下ろす。確認ダイアログで「キャンセル」した時・読込に失敗した時・例外の時も下ろす
- 待つのは保存の入口 `syncToObsidianFolder` の先頭（`_isSyncReady()` の直後・`_loadConflictHold` の判定より前）。待った後に `_isSyncReady()` を見直してから進む
- index.html：`js/bookshelf.js?v=2026111632` → `2026111634`（origin/main の最大値 2026111633 より新しい）

### 相互待ちが無いこと（grep・関数ごとに数えた）

- `syncToObsidianFolder()` を呼ぶのは `_syncWithAuthRetry` だけ（2か所）。`_syncWithAuthRetry` を呼ぶのは `_runPendingSync` だけ
- `_runPendingSync()` を呼ぶのは `_scheduleSync` のタイマー・`init` の中の画面イベントの受け口（L388・L402、await しない）・`_retrySyncNow`（await しない）・`flushSync`
- `flushSync()` を await するのは公開の `_runPublishExport` だけ（article-editor.js:3051 は await しない）
- 印を立てている間に走る関数（`_initCloudSyncLoad`・`_initGitHubSyncLoad`・`selectObsidianFolder` の読込・`loadFromObsidianFile`・`_applyLoadedState`・`_keepLocalOverLoaded`・`_holdForLoadConflict`）は、どれも保存を await しない（保存は `_scheduleSync` のタイマー経由、3択は `_askLoadConflict()` を await せずに出す＝js/bookshelf.js `_holdForLoadConflict`）＝起動の読込が保存を待ち、保存が起動の読込を待つ形は無い

### 結果（新しい spec・--repeat-each=3・3回とも緑・出力 `tmp/643/green-after-repeat3.txt`）

| | 直す前（step1 の回5〜7） | 直した後（3回） |
|---|---|---|
| 初期化の7ファイルへの PUT | 各2回（49件の赤） | **各1回**（3回とも） |
| 初期化が書いた「すべての本」の id | 2つ（例 jt0vhq2j → 5gs3qvlg） | **1つ**（6fmvfs6z・91j3e2bl・3kygpdvl） |
| 最初の保存の後の id（bookshelves.json / all.json / main.json） | 2回目の id ×3 で揃う | 初期化の id ×3 で揃う |
| 冊数・asin（library / all） | 1冊 B0INITSAV1 / 同 | 1冊 B0INITSAV1 / 同 |
| 開き直した後 | 確認・3択 0件・id 同じ・蔵書数1 | 確認・3択 0件・id 同じ・蔵書数1 |
| 2冊目の保存の後 | id 同じ・2冊・蔵書数2 | id 同じ・2冊・蔵書数2 |
| 1回にかかった時間 | 約31秒 | 約28秒 |

### 初期化の途中にメモを書いた時（直した後に1回だけ・②の指示）

- 一時の spec（`tmp/643/zz-643-memo-probe.spec.js`・commit しない）：PUT を1件3秒に遅らせ、初期化の途中に本を足し、その本の詳細の短文メモに書く（書いた時点で all.json も notes.json もまだ保存先に無い）→ 落ち着くまで待つ → 開き直す
- 結果（出力 `tmp/643/memo-probe-after.txt`）：notes.json への PUT 1回・settings.json への PUT 1回。保存先の notes.json にメモがある（最初の保存の後・開き直した後とも）。開き直した後の本の詳細にもメモが出る。確認・3択は0件
- 新しい spec には足さない：直す前の害（2回目の初期化が notes.json・settings.json を既定値で書き直す）は、新しい spec の「7ファイルへの PUT が各1回」で捕まえている。直す前の版ではこの一時の spec を流していない（メモが消えるかは未実測）

## step3 関係する spec・vitest・lint 一式・設計書

### 基にした版

- origin/main が e7f5e0d（bookshelf-list.js の ?v= の更新）まで進んでいたので、その上に rebase した（28d7967 test・4ccde67 fix・a47d3ca docs）。#612 はまだ入っていない
- rebase で、main の ?v= の最大値が 2026111650 になっていた。bookshelf.js の ?v= を、main と他の作業中の worktree の最大値（2026111650）より新しい 2026111651 にした（commit を分けた）

### 関係する spec（chromium・PORT=8143・workers=4・出力 `tmp/643/related-specs.txt`）

- 対象：依頼の3本（sync-offline-reconnect・boot-confirm-dialog・dashboard-stats-after-manual-add）、#633 の first-run-add-article-drawer（main に入ったので、そのまま流した）、新しい spec、tests/e2e と tests/e2e/gate でファイル名に sync・boot・first-run・hub・conflict・offline を含むもの（計22ファイル）
- 結果：**63件すべて緑**（63 passed・1.3分・赤0件）。新しい赤が無いので、origin/main との突き合わせはしていない

| ファイル | 件数 |
|---|---|
| boot-confirm-dialog・dashboard-stats-after-manual-add・first-run-add-article-drawer・first-run-save-during-init-empty・sync-offline-reconnect | 依頼の分（すべて緑） |
| gate/j1-1・j1-3 ハブ/GitHub・j1-4・j6-2・j6-3・j6-4・j6-5・j8-4・j8-offline | 門の分（すべて緑） |
| github-sync-resilience・online-resync・publish-conflict-hub・startup-background-sync・sync-chosen-mark・sync-conflict・sync-first-connect | 保存・起動まわり（すべて緑） |

### vitest（出力 `tmp/643/vitest.txt`）

- Test Files 74 passed（74）・Tests 1099 passed・2 todo。exit 0

### lint 一式（CI と同じ並び・出力 `tmp/643/lint-all.txt`）

| lint | 結果 |
|---|---|
| check:version --range=origin/main..HEAD | OK（変更した js はすべて ?v= を上げてある） |
| lint:css | OK（exit 0） |
| lint:e2e-goto | OK（146ファイルで0件） |
| lint:e2e-wait | OK（147ファイルで0件） |
| lint:breakpoint | OK |
| lint:esc | OK |
| lint:js-color | OK |
| lint:internal-refs | OK（上限82以内） |
| lint:e2e-gate | OK（@gate 41本・違反0件・観測点 37/37） |
| lint:copy | OK（119/119） |
| lint:terms | OK |
| lint:known-red | OK（既知の赤 2件・違反0件） |

- 上の lint・spec・vitest は e7f5e0d の上（?v= 2026111651）で流した。その後、origin/main が #612 の取り込み（76e122c）まで進み、#612 も bookshelf.js の ?v= を同じ 2026111651 にしていたので、check:version を流し直すと「js/bookshelf.js の ?v= が更新されていない」で落ちた → 下の「#612 の上に載せ直した後」で直して流し直した

### 設計の記述

- docs/char/boot-flow.md §1-5：起動の読込の間（確認が出ている間も含む）は保存が入口で待つ、という段落を足した
- obsidian 03_詳細設計書：L87 の `initSync()` の行（同期方式別の初期化）に、`_beginBootLoad()`・`_waitBootLoads()` で読込の間は保存が待つ（2回目の initEmpty を呼ばない）ことを書き足した。1行の書き換えで、行数は変わっていない（609 行のまま）
- obsidian 07_残検討事項：該当する行は無かった（「#643」「initEmpty が2回」「初期化が2回」で0件）＝更新していない

### #612 の上に載せ直した後（origin/main 18ede16）

- step3 の途中で #612（ハブの一括保存は変えたファイルだけ送る・ETag の照合・項目ごとの合わせ）が origin/main に入ったので、その上に rebase した（77b514d test・729b084 fix・8a5254f docs・9f56975 docs）
- 衝突は index.html の bookshelf.js の ?v= の1行だけ（#612 が 2026111651 にしていた）。main と他の作業中の worktree の最大値 2026111651 より新しい **2026111652** にした。前の ?v= だけの commit（2026111651 にしたもの）は不要になったので、rebase で外した
- js/bookshelf.js は衝突なし。待ち（`_waitBootLoads()`）は #612 の後も syncToObsidianFolder の先頭（`_isSyncReady()` の直後・`_loadConflictHold` の判定より前）にある。initEmpty を呼ぶ所は4か所のまま（起動側3・保存側1）
- 流し直した結果（すべて 18ede16 の上・PORT=8143）：

| 確かめたこと | 結果 | 出力 |
|---|---|---|
| 新しい spec（--repeat-each=3） | 3 passed・初期化の7ファイルへの PUT は各1回 | `tmp/643/green-after-612-repeat3.txt` |
| 関係する spec（上と同じ22ファイル） | 63 passed・赤0件 | `tmp/643/related-specs-after-612.txt` |
| lint 一式（12本） | すべて exit 0（check:version も OK・e2e-gate は観測点 37/37） | `tmp/643/lint-all-after-612.txt` |
| vitest | Test Files 75 passed・Tests 1114 passed・2 todo | `tmp/643/vitest-after-612.txt` |

- 「起動前から手元に別の保存先の allInternalId が残っている形」は、#612 が入ったので数える条件はそろったが、この step では測っていない（未実測のまま・step4 で数える）

## step4 origin/main と全件比較（push の前）

### 載せ直し（rebase）

- step4 の開始時に fetch すると、origin/main が 98de66d（#635 衝突ダイアログの1本化・#637 E2E の外部通信の遮断ほか）まで進んでいたので、その上に rebase した（f6696eb test・83018ea fix・3058e2f docs・6ed51b7 docs・f6bf371 docs）
- 衝突は index.html の bookshelf.js の ?v= の1行だけ（#635 が 2026111660 にしていた）。main と作業中の worktree の最大値は 2026111673 で、#614 が 2026111652（前の自分と同じ値）を使っていたので、**2026111674** にした
- js/bookshelf.js は衝突なし（#635 の変更と重ならない）。待ち（`_waitBootLoads()`）は syncToObsidianFolder の先頭のまま
- 前の run（16:01 に始めた全件比較）は base 側の E2E が終わった所で run ごと切れた（exit 137）。その結果は使わず、載せ直した後に最初から流し直した

### 載せ直した後の確認（98de66d の上・PORT=8143）

| 確かめたこと | 結果 | 出力 |
|---|---|---|
| lint 一式（CI と同じ14本：check:version・css・e2e-goto・e2e-wait・e2e-external・breakpoint・esc・js-color・internal-refs・e2e-gate --strict-coverage・copy・terms・known-red、e2e-gate は引数なしでも） | すべて exit 0（check:version OK・e2e-external 151ファイルで0件・e2e-gate 37/37） | `tmp/643/lint-all-step4.txt` |
| 新しい spec（--repeat-each=3） | 3 passed | `tmp/643/green-step4-repeat3.txt` |
| 関係する spec（sync-offline-reconnect・boot-confirm-dialog・dashboard-stats-after-manual-add・first-run-add-article-drawer） | 17 passed | `tmp/643/related3-step4.txt` |

- CI の lint は #637 で lint:e2e-external が増え、e2e-gate は --strict-coverage 付きになっていた（ci.yml L56-97）。どちらも流した

### 全件比較（e2e-diff-main・base=origin/main 98de66d・work=f6bf371・PORT=8143・visual 込み・16:15〜16:28）

- 結果一式：`/home/kuroko/worktrees/bookshelf/_artifacts/e2e-diff-20261114-161547-2700843`（報告は `tmp/643/e2e-diff-2.txt`）。exit 0
- base 側の E2E：1019 passed・2 failed（list-staged-render・reimport-diff「手動追加は枚数・並びが正しい」）・594 skipped

| 表 | 件数 | 中身 |
|---|---|---|
| 新しく落ちた（E2E） | 4件（スクリプトの判定はすべて flake） | duplicate-asin-notice（重複ASIN検出バッジ）・gate/j3-5-many-books（913冊・CPU 6倍遅く）・reimport-diff（order(title) の moved #406）・save-failure-visible（ローカルフォルダの再試行が尽きた失敗 #603） |
| 新しく通った（E2E） | 2件 | list-staged-render（途中で並び順を変える）・reimport-diff（手動追加の枚数・並び #480）＝base 側で落ちた2件 |
| 両方で落ちた（E2E） | 0件 | |
| vitest | 新しく落ちた0・新しく通った0・両方0 | |
| 画像の差分（work 側） | 0件 / 54件 | |

- 「新しく落ちた」4件の切り分け：
  - スクリプトが work 側で3回流し直し、4件とも flake と判定した（流し直しで通った）
  - 4件を単独で（file:line 指定・--repeat-each=2・workers=2）流し直した：**work 側 12 passed**（`tmp/643/newfail-alone-work.txt`）・**base 側 12 passed**（一時の checkout・この時の origin/main は 3a0d720・`tmp/643/newfail-alone-base.txt`）
  - 4件とも、全件を同時に流した時だけ落ち、単独では両側とも通る＝負荷による揺れ。新しい spec・直しの影響ではない（4件のうち保存の経路を通るのは save-failure-visible だけで、これはローカルフォルダの保存の失敗の出し方。起動の読込の印が立つのは起動の読込の間だけで、この spec の失敗の注入は起動の後）
- base 側で使った一時の checkout は、流した後に `_trash/` へ退避して `git worktree prune` した

### push する範囲（origin/main..HEAD）

- 自分の commit 5本だけ・5本とも trailer `Issue: #643`：f6696eb test・83018ea fix・3058e2f docs・6ed51b7 docs・f6bf371 docs（＋この記録の commit）
- 全件比較の後に origin/main が 3a0d720 まで進んだ（2本・js/ と index.html は変わっていない・main の bookshelf.js の ?v= は 2026111660 のまま）。push の前（step5）に、もう一度 rebase して lint（lint:e2e-wait が変わっている）と新しい spec を流し直す
