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
- 0300351 と 4f1a19b の間で js/ と index.html は変わっていない（`git diff --stat 0300351 4f1a19b -- js/ index.html` が空）＝step1 の赤は、直す前の版 57aad53 の赤と同じ。spec は step1 から変えていないので、赤の取り直しはしていない

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
