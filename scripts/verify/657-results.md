# イシュー#657 ハブ・GitHub の設定の同期欄に保存の状態の文が無い — 記録

## step1 洗い出しと表示の案（アプリのコードは変えない）

- 着手時の origin/main: `36eba5e`（#648 の step5 の記録まで入っている。#639 は `985e770` で入っている）
- 関係するイシューの state（kuroko.db を読み取り専用で 16:59 に読んだ）: #639 running（step5・CI と本番の確認）／#648 running（step6・push 済みで CI の確認）／#653 await_approve（#648 の着地待ち）／#645 await_approve（未着手）
- 作業ツリー: `/home/kuroko/worktrees/bookshelf/issue-657` を `36eba5e` へ早送りした

### 1. 同期欄に書く呼び出し（`updateSyncStatus` の全部・23か所＋本体）

`git grep -n "updateSyncStatus(" -- js`（`36eba5e`）。全部 `js/bookshelf.js`。行は `36eba5e` のもの（場所は関数名と中身で探す）。
書く先は `#obsidian-sync-path`・`#obsidian-sync-status` の2つだけで、どちらもローカルの欄 `#sync-config-local` の中にある。ハブ・GitHub を選んでいる間は、`_showSyncPanel`（js/screens/settings.js）がこの欄を隠す。

| 行 | 関数 | 場面 | 渡す state（detail） | ローカルで見えるもの | ハブ・GitHub で見えるもの |
|---|---|---|---|---|---|
| 2972 | `_askLoadConflict` | 読込時の3択で「保存先の内容を読み込む」を選んだ (#639) | synced | 「〈時刻〉 同期済み（…）」 | 見えない（隠れた欄に「〈時刻〉 保存済み」） |
| 3180 | `_initCloudSyncLoad` | ハブの起動の読込の始め | loading | – | 見えない（「読み込み中...」） |
| 3192 | `_initCloudSyncLoad` | ハブが空で、初期化の確認をキャンセルした (#648) | reconnect（名前に「(空)」） | – | 見えない（「保存できませんでした」） |
| 3218 | `_initCloudSyncLoad` | ハブの起動の読込が済んだ | synced | – | 見えない（「〈時刻〉 保存済み」） |
| 3223 | `_initCloudSyncLoad` | ハブの起動の読込の失敗（catch・#653 が文言を変える予定） | reconnect | – | 見えない（「保存できませんでした」） |
| 3321 | `_initGitHubSyncLoad` | GitHub の起動の読込の始め | loading | – | 見えない |
| 3330 | `_initGitHubSyncLoad` | GitHub が空で、初期化の確認をキャンセルした (#648) | reconnect（「(空)」） | – | 見えない |
| 3351 | `_initGitHubSyncLoad` | GitHub の起動の読込が済んだ | synced | – | 見えない |
| 3354 | `_initGitHubSyncLoad` | GitHub の起動の読込の失敗（catch・#653） | reconnect | – | 見えない |
| 3435 / 3437 / 3445 | `initObsidianSync` | ローカルの起動の読込（始め・済み・許可なし） | loading / synced / reconnect | 「読み込み中...」／「〈時刻〉 同期済み（…）」／「「フォルダを選ぶ」を押して…」 | – |
| 3464 / 3480 / 3491 | `selectObsidianFolder` | フォルダを選んだ（始め・済み・読込の失敗） | loading / synced / reconnect | 同上 | – |
| 3691 / 3698 / 3700 | `reloadFromObsidianFile` | ローカルの再読込 | loading / synced | 同上 | – |
| 3773 | `syncToObsidianFolder` | ローカルの書き込みの許可が無い | disconnected | 「（未接続）」 | – |
| 3977 | `syncToObsidianFolder` | ハブ・GitHub の書き込みが衝突した（#616） | reconnect | – | 見えない |
| 3991 | `syncToObsidianFolder` | 保存できた | synced | 「〈時刻〉 同期済み（…）」 | 見えない（「〈時刻〉 保存済み」） |
| 3996 | `syncToObsidianFolder` の catch | 保存の失敗（毎回・1回目から） | failed / reconnect（`failure.message`） | **「「フォルダを選ぶ」を押してフォルダを選び直してください」**（ローカルは failed を reconnect に読み替える＝失敗の文を使わない） | 見えない（状態バーと同じ失敗の文） |
| 5079 | `_onSyncFailed` | 保存先へ書くのを止めている間 (#639 の hold) | held（`f.message`） | 状態バーと同じ文（「選ぶ」ボタンは無い） | 見えない |
| 4108 | `updateSyncStatus` 本体 | – | – | – | – |

#648 の 648-results.md の表（22か所）と比べると、増えたのは `_askLoadConflict` の synced と `_onSyncFailed` の held の2か所（どちらも #639）。

### 2. 状態ごとの対応（実測は 1280 幅の chromium・`tmp/657/zz-657-shots.spec.js`）

印: ✗＝食い違い・保存できていないことが同期欄から分からない

| 状態 | 状態バー（文とボタン） | 同期欄 `#obsidian-sync-status` | ハブの欄に見えるもの | GitHub の欄に見えるもの |
|---|---|---|---|---|
| 正常（保存の後） | 出ない | ハブ・GitHub「〈時刻〉 保存済み」（実測「5:00:29 PM 保存済み」・隠れている）／ローカル「〈時刻〉 同期済み（「フォルダを選ぶ」で再読み込み）」 | 「この保存先を使用中です。」と「使用中」 | 「〈login〉 として接続中」と設定のフォームだけ（状態の文は無い） |
| 読込中 | 「最新のデータを確認しています…」 | 「読み込み中...」（ハブ・GitHub は隠れている） | 同上 ✗ | 同上 ✗ |
| 未保存（読込時・load-conflict） | 「保存先とこの端末の両方が変わっているため、保存先へ保存していません。「選ぶ」から、どちらの内容を使うか選んでください。」＋「選ぶ」 | 同じ文（#639）。ローカルは見える。**「選ぶ」ボタンは無い** ✗(b) | 「この保存先を使用中です。」だけ ✗（#639 の画像 before-from639-hub-unsaved-*） | 状態の文は無い ✗ |
| 未保存（書き込み時・sync-conflict） | 「別の端末で保存先が更新されたため、保存先へ保存していません。「選ぶ」から…」＋「選ぶ」 | 同じ文・「選ぶ」は無い ✗(b) | 同上 ✗ | 同上 ✗ |
| 保存失敗・1回目（quiet） | 出ない（1回目の自動の再試行を待つ） | catch が失敗の文をすぐ書く ✗(a) | 同上 ✗ | 同上 ✗ |
| 保存失敗・再試行中（retrying） | 「保存できていない変更があります。自動で再試行しています。」＋「再試行」 | 失敗の文のまま（catch の文） ✗(a) | 同上 ✗ | 同上 ✗ |
| 保存失敗・尽きた（ハブ・GitHub の通信） | 「Asayake ハブ（GitHub）に保存できませんでした。通信が戻ったら「再試行」を押してください。」＋「再試行」「確認」 | 同じ文（実測・隠れている）・**「再試行」は無い** ✗(b) | 「この保存先を使用中です。」だけ ✗（実測 before-hub-failed-*） | 状態の文は無い ✗（実測 before-github-failed-*） |
| 保存失敗・尽きた（ローカルの書き込み） | 「フォルダに保存できませんでした。「再試行」で直らないときは、設定からフォルダを選び直してください。」＋「再試行」「確認」 | **「「フォルダを選ぶ」を押してフォルダを選び直してください」**・名前に「（要再接続）」（実測） ✗(c) | – | – |
| ログイン切れ・接続切れ | 種類の文＋「ログインし直す」 | reconnect＋失敗の文・名前に「（要再接続）」（ハブ・GitHub は隠れている） | 同上 ✗ | 同上 ✗ |
| 保存先未設定・未ログイン | 「保存先が未設定です。…」／「Asayake ハブにログインしていません。…」＋「保存先を選ぶ」 | 空（「（未接続）」） | ログインの案内 | 接続の案内 |

見つかった食い違い:
- (a) 1回目の失敗（quiet）と再試行中は、状態バーと同期欄の文が違う（同期欄は catch が毎回すぐ書く）。
- (b) 同期欄の文が「「選ぶ」から」「「再試行」を押して」と言うのに、同期欄にそのボタンが無い（ローカルでも今そう）。
- (c) **ローカルの保存失敗は、同期欄が状態バーと違う文になる**（`updateSyncStatus` が failed を reconnect に読み替え、失敗の文を捨てて「「フォルダを選ぶ」を押して…」を出す）。計画時には見えていなかった。直すならハブ・GitHub と同じ1か所の文にそろえる。

### 3. 同期欄を読む spec（読み手）

- `#obsidian-sync-status`・`#obsidian-sync-path` を読む: 13本（`36eba5e`）。book-memo-file-lifecycle・first-run-init-status（#648 で入った）・first-run-save-during-init-empty・gate/j1-3-connect-local・gate/j6-1-local-restart・gate/j6-3-hub-other-device・load-conflict-unsaved・save-failure-visible・shelf-file-delete・sync-chosen-mark・sync-first-connect・sync-github-disconnect・sync-offline-reconnect。ハブ・GitHub の名前も出てくるのは、j1-3-connect-local・j6-1-local-restart を除く11本（ハブ・GitHub の時にこの id を読んでいる見込み。1本ずつの確認は step2/step3 で行う）。
- `#hub-active-state`・`#hub-status`・`#github-status` を読む: gate/j1-3-connect-hub・publish-article-editor・ux-h-series の3本。
- visual: tests/visual/screens.spec.js の設定の同期（保存先が決まっていない端末の画面）。
- 進行中: #653 の新しい spec（boot-load-failure-status・予定）もハブ・GitHub で `#obsidian-sync-status` を読む。

### 4. 画像（`_local/657/shots/`・git には入れない）

広い幅は chromium 1280。390 幅は同じページで幅だけ 390 にして設定を開き直したもの（chromium・PC の UA）。計画では webkit の iPhone 13 相当と書いたが、時間の都合で幅だけで撮った。設定の画面は幅で決まる作りで、#639 の webkit の画像と並びは同じ。

| ファイル | 中身 |
|---|---|
| before-hub-normal-{wide,390}.png | ハブ・正常。「この保存先を使用中です。」と「使用中」だけ |
| before-hub-failed-{wide,390}.png | ハブ・保存失敗（再試行が尽きた後）。正常と同じ見た目で、保存できていないことが分からない |
| before-github-normal-{wide,390}.png | GitHub・正常。接続中とフォームだけ |
| before-github-failed-{wide,390}.png | GitHub・保存失敗。正常と同じ見た目 |
| before-local-normal-{wide,390}.png | ローカル・正常。「保存フォルダ」の欄の足元に「〈時刻〉 同期済み（…）」（緑） |
| before-local-failed-{wide,390}.png | ローカル・保存失敗。「「フォルダを選ぶ」を押して…」（赤）と名前の「（要再接続）」（状態バーの文とは違う＝(c)） |
| before-from639-{hub,local}-unsaved-{390,pc}-sync.png・…-390-statusbar.png | 未保存（#639 が撮った webkit の画像を写した）。ハブは「この保存先を使用中です。」だけ |
| mock-A-{hub,github,local}-failed-{wide,390}.png | 案A の試し。保存先セレクトの下に1行（赤字＋「再試行」） |
| mock-A-local-normal-{wide,390}.png | 案A のローカルの前後の「後」（前は before-local-normal）。正常の文が緑で、保存先セレクトの下へ移る（「フォルダを選ぶ」の横は空く）。17:04 に正常の形（緑・ボタン無し）で撮り直した |
| mock-B-{hub,github}-failed-{wide,390}.png | 案B の試し。欄の足元（「使用中」「この設定で使う」の横）に赤字＋「再試行」 |
| mock-C-hub-failed-{wide,390}.png | 案C の試し。「この保存先を使用中です。」の帯を警告の帯に替える |

GitHub の未保存は撮っていない（GitHub の欄はどの状態でも状態の文が無いことを、正常・保存失敗の画像で示している）。

### 5. 表示の案

| 比較軸 | 案A 共通の1行（保存先セレクトの下） | 案B 保存先ごとの欄の足元 | 案C 「使用中です」の帯を出し分け |
|---|---|---|---|
| **ハブ・GitHub の人が同期の画面だけで保存できていないと分かるか**（②の追加の軸・完了条件） | 分かる。画面のいちばん上（保存先の名前のすぐ下）に赤字と「再試行」「選ぶ」が出る。ただし下の欄の「この保存先を使用中です。」（チェックの印）は残る（mock-A-hub-failed-390） | 分かるが弱い。欄のいちばん下で、390 幅では「使用中」ボタンの横の細い列に折り返す。上の「この保存先を使用中です。」の帯の方が目立つ（mock-B-hub-failed-390） | ハブはいちばん強く分かる（帯そのものが警告になる・mock-C-hub-failed-390）。GitHub は帯が無いので新しく作る |
| 同じ操作は同じ見た目か（ローカルとそろうか） | 3つの保存先で同じ場所・同じ部品。**ローカルの文の場所が変わる**（欄の足元→保存先セレクトの下・mock-A-local-*） | ローカルの「フォルダを選ぶ」の横と同じ位置＝ローカルは変わらない | ローカルには帯が無い＝そろわない |
| 文の決め方が1か所か（ADR-158） | 1つの要素に1つの関数で描く＝1か所 | 保存先ごとに書く先を選ぶ（関数は1つにできる） | 「使用中／未適用」（ADR-032/033 の別の概念）と保存の状態を1つの帯で混ぜる |
| 07 L393（ハブ・GitHub の状態がローカルの欄に書かれる）も直るか | 状態の文は直る（欄の外に出る）。名前（`#obsidian-sync-path`）はローカルの欄に残るので、ハブ・GitHub の時に名前を書かないことも一緒にする | 直る（ハブ・GitHub の時はローカルの欄へ書かない） | 直らない（別に直す） |
| 既存 spec と #648・#653 への影響 | id `#obsidian-sync-status` を据え置くので、読み手の spec はそのまま（見えるようになるだけ）。visual の基準画像（設定の同期）は更新する見込み。**#653 を待たなくてよい** | ハブ・GitHub の時に `#obsidian-sync-status` を読む11本＋#653 の新しい spec を直す。#653 の着地を待ってから載せ直す | 3本（hub-active-state を読む）を直す。GitHub の帯は新しい部品 |
| 390 幅で読めるか | 全幅の1行で、2行に折り返して読める | ボタンの横の細い列で4行に折り返す | 帯の中で3行に折り返して読める |
| 作業量 | 小（要素を移す・CSS・描く関数を1つ） | 中（要素の新設・書く先の切り替え・spec 11本） | 中（帯の出し分け・GitHub の帯の新設・「使用中」の意味の扱い） |

### 6. どの案でも決めること（推奨）

- **(a) 同期欄の文の源**: 状態バーと同じ源（`_syncFail` と `_syncErrorMsg || f.message`）から描く。保存の失敗の catch（3996）が同期欄へ直接書くのはやめ、`_onSyncFailed`／`_clearSyncFailure` から同期欄も描き直す。1回目（quiet）と再試行中は、同期欄に再試行中の文（`RETRYING_MESSAGE`「保存できていない変更があります。自動で再試行しています。」）を出す。quiet の間、状態バーは出さないが、同期欄では「保存済み」と言わないために出す。尽きた後（final）・止めている間（hold）は、状態バーと同じ文を出す。**ローカルもこの1か所に寄せる**（(c) の「「フォルダを選ぶ」を押して…」の読み替えをやめ、状態バーと同じ「フォルダに保存できませんでした。…」にする。名前の「（要再接続）」は reconnect の種類の時だけ残す）。
- **(b) ボタン**: 同期欄の行にも、状態バーと同じ「再試行」（`retry-sync`）と「選ぶ」（`resolve-hold`）を出す。描くのは状態バーの行と同じ関数にして、文とボタンが必ず組で出るようにする（押せないボタンを指す文は残らない）。「確認」「ログインし直す」（`open-sync`＝設定の同期を開く）は、同期欄の中では出さない（もう同期の画面にいるため）。この種類の文は「設定から…」「設定の「フォルダを選ぶ」から…」で、ボタンの名前を指していない。指しているのは同期の画面にある「フォルダを選ぶ」だけで、これはローカルの欄にある。
- **正常の文**: いまのまま（ハブ・GitHub「〈時刻〉 保存済み」・ローカル「〈時刻〉 同期済み（「フォルダを選ぶ」で再読み込み）」・緑）。04 L331-332 の決まりどおりで、状態バーに正常の種類は無いので、そろえる先が無い。種類名をそろえるのは範囲外とする。

### 7. 推奨と着手順

**推奨: 案A＋(a)＋(b)**。
- 理由1（完了条件）: 3つの保存先とも、同期の画面を開いて最初に目に入る場所（保存先の名前のすぐ下）に、状態バーと同じ文とボタンが出る。
- 理由2（同じ見た目）: 3つの保存先で同じ場所・同じ部品。状態バーの行と同じ関数で描くので、文とボタンが食い違わない。
- 理由3（他のイシュー）: id を据え置くので、`#obsidian-sync-status` を読む spec 13本と #653 の新しい spec がそのまま使える。#653 を待たずに進められる。ぶつかるのは index.html の `?v=` の行だけの見立て。
- 依頼外への波及: **ローカルの状態の文の場所が変わる**（欄の足元→保存先セレクトの下）。前後は before-local-normal・mock-A-local-normal（いずれも wide と 390）。
- 残る弱さ: ハブの「この保存先を使用中です。」（チェックの印）は残る。上の赤い行で足りるかを step3 の画像で確かめる。足りなければ、帯の印だけを中立に替えるかを step3 の tp で決める。

案B を選ぶ場合は、#653 の着地の後に載せ直し、その spec と既存の11本の読み口を直す（step4 で待つ）。

### 8. 撮り方

`tmp/657/zz-657-shots.spec.js`（git には入れない）を `tests/e2e/` へ写して、次で流す（3 passed・24.8s）:
`PORT=8157 PLAYWRIGHT_BASE_URL=http://localhost:8157 npx playwright test tests/e2e/zz-657-shots.spec.js --project=chromium --workers=3`
試しの DOM は撮るたびに片付ける（1回目は片付けが無く、前の試しが次の画像に残った＝`_trash/657-shots-1/` に退避）。

## step2 E2E を足し、直す前の版で赤を取る

- 新しい spec: `tests/e2e/sync-section-status.spec.js`（9本）。期待値は直した後の姿（案A・(a)(b)(c)、②承認 2026-11-14）で書いた。判定は見えている要素で行う（`#obsidian-sync-status` の `toBeVisible()` と、状態バーと同じ文の `toContainText()`）。同期欄の「再試行」「選ぶ」は `#sync-section [data-status-action="retry-sync"|"resolve-hold"]`（状態バーと同じ data-status-action）が見えることと、押すと状態バーのボタンと同じ結果になる（保存される／3択が開き直る）ことを確かめる。
- 保存のきっかけは、設定から本を手で足す操作にした。本棚を足すボタン（`#sidebar-add-bookshelf`）はスマホ幅では横のメニューの中にあり、webkit の1回目は4本がそのクリックの時間切れ（別の理由の赤）になったため（出力は上書き済み）。
- 390幅は webkit の iPhone 13 相当で流した。`playwright.config.js` の webkit（`BACKNAV_WEBKIT=1` の時だけ足す project）の testMatch にこの spec を足した。ローカルは PC の Chrome/Edge だけ（ADR-046）なので webkit では skip。
- 流し方: `BACKNAV_WEBKIT=1 PORT=8157 PLAYWRIGHT_BASE_URL=http://localhost:8157 npx playwright test tests/e2e/sync-section-status.spec.js --project=chromium --project=webkit`。出力 `tmp/657/step2-before.txt`（git には入れない）。base は `70ea04a`（アプリのコードは `36eba5e` と同じ）。

| テスト | chromium（広い幅） | webkit（390幅） | 赤の理由 |
|---|---|---|---|
| ハブ 正常（保存済みが見える） | 赤 | 赤 | `#obsidian-sync-status` が hidden（見えない） |
| ハブ 保存失敗（状態バーと同じ文・「再試行」→保存→正常に戻る） | 赤 | 赤 | 同上 |
| GitHub 正常 | 赤 | 赤 | 同上 |
| GitHub 保存失敗 | 赤 | 赤 | 同上 |
| ハブ 未保存・読込時（load-conflict・「選ぶ」→3択→読み込むと正常に戻る） | 赤 | 赤 | 同上 |
| ハブ 未保存・書き込み時（sync-conflict・端末2つ） | 赤 | 赤 | 同上 |
| GitHub 未保存・読込時（load-conflict・模擬の library.json を他の端末の更新に書き換えて読み直す） | 赤 | 赤 | 同上（3択が出て状態バーに load-conflict の行が出た後、同期欄が見えない） |
| ローカル 正常（同期済みが見える） | **緑** | skip | – |
| ローカル 保存失敗（状態バーと同じ文・「再試行」） | 赤 | skip | 文が違う（受け取った文「「フォルダを選ぶ」を押してフォルダを選び直してください」＝(c)。②の決めでローカルもそろえるので、直す前は赤が正しい） |

- 計15本が赤・1本が緑・2本が skip。赤は全部、見えない（14本）か文が違う（1本）で、別の理由の赤は無い。GitHub の未保存の2本は後から足して流した（出力 `tmp/657/step2-before-github-unsaved.txt`）。
- ハブ・GitHub は見えるかの所で止まるので、その後の判定（文・ボタン・正常に戻る）は直す前には届かない。隠れた要素の文が状態バーと同じであることは step1 の実測（§2）で確かめてある。ボタンは同期欄にまだ無い。
- ローカルの未保存（読込時）は、#639 の `load-conflict-unsaved.spec.js` が同期欄の文を確かめている。「選ぶ」ボタンの確かめは step3 で足すかを決める（このステップでは足していない）。GitHub の書き込み時の未保存（sync-conflict）は足していない（GitHub の衝突は #645 が触る所。読込時の未保存は足した）。
- e2e の lint（`check-e2e-goto`・`check-e2e-async-wait`・`check-e2e-external`）は通った。

## step3 直して緑にし、関係する spec・lint・単体を通し、画像を撮る

### 直したこと（commit b01cfcc）

- index.html: `#obsidian-sync-status` を、id を変えずにローカルの欄の足元から、保存先の選択のすぐ下の新しい行 `#sync-state-row`（3つの保存先に共通）へ移した。ボタンの入れ物 `#sync-state-actions` も同じ行に置いた。`?v=` は bookshelf.js・bookshelf.css とも 2026111720（origin/main の最大 2026111710 より新しい）。
- js/bookshelf.js:
  - `updateSyncStatus` は、名前と文を書く本体（`_applySyncStatus`）を呼んだ後、書いた文を「失敗が解けた時に戻す文」として控え、`_renderSyncState` で状態の行を描く。
  - `_renderSyncState`（新）: 保存の失敗・書くのを止めている間（`_syncError && _syncFail`）は、状態バーと同じ源から文とボタンを出す。1回目の自動の再試行を待つ間（quiet）と再試行中は `RETRYING_MESSAGE`（警告の色）、尽きた後・止めている間は `_syncErrorMsg || f.message`（危険の色）。ボタンは状態バーと同じ条件で「再試行」（`retry-sync`）と「選ぶ」（`resolve-hold`）。「確認」「ログインし直す」（`open-sync`）は出さない。文が空なら行を隠す。
  - `_onSyncFailed`・`_clearSyncFailure` の最後で `_renderSyncState` を呼ぶ。
  - ボタンの動きは、状態バーと同期欄の行で同じ関数（`_runStatusAction`）を通す。
  - (c) ローカルの保存の失敗（要再接続ではない種類）は「（要再接続）」を付けず、状態バーと同じ文を出す（「「フォルダを選ぶ」を押して…」への読み替えをやめた）。
- css/bookshelf.css: `.sync-state-row`（折り返す横並び）・`.sync-state-actions`。
- 文は SyncFailure の文だけを使い、同期欄のための文は足していない。

### 確かめたこと

| 何を | 結果 | 出力（tmp/657/・git には入れない） |
|---|---|---|
| 新しい spec（chromium＝広い幅・webkit＝iPhone 13 相当の 390 幅） | 1回目 16 passed・2 skipped（ローカルは webkit で流さない） | step3-after-1.txt |
| 新しい spec の繰り返し（--repeat-each=2） | 32 passed・4 skipped（1回目と合わせて3回とも緑） | step3-after-repeat.txt |
| visual（playwright.visual.config.js の「設定の一覧」「設定の1節」） | 12 passed（基準画像は変えていない） | step3-visual.txt |
| 関係する spec 19本（chromium）: load-conflict-unsaved・save-failure-visible・gate/j6-5・gate/j6-4・gate/j1-3-connect-hub・同期欄を読む13本・publish-article-editor・ux-h-series・standard-ops | 250 passed・1 skipped | step3-related.txt |
| `npm run lint` | 12 本中 0 本失敗 | step3-lint.txt |
| `npm test` | 77 files・1156 passed・2 todo | step3-unit.txt |
| `npm run check:version -- --range=origin/main..HEAD` | OK（変えた js/css はすべて ?v= を上げてある） | – |

- visual は、保存先を決めていない端末の設定の画面で、状態の行は空（隠れる）なので基準画像と同じだった。

### 直した後の画像（`_local/657/shots/`）

広い幅は chromium 1280、390 幅は webkit の iPhone 13 相当（ローカルだけは webkit で流せないので chromium で幅を 390 にした）。撮る前に行の座標を測った（`after-*.json`）: どれも行は保存先の選択の下（選択の下端 ≤ 行の上端）で、右端は 390 幅で 356・広い幅で 1185＝画面の外へはみ出していない。

| 状態 | ハブ | GitHub | ローカル |
|---|---|---|---|
| 正常 | after-hub-normal-{wide,390}「〈時刻〉 保存済み」（緑） | after-github-normal-{wide,390} | after-local-normal-{wide,390}「〈時刻〉 同期済み（…）」 |
| 未保存（読込時） | after-hub-unsaved-{wide,390}「保存先とこの端末の両方が変わっているため、保存先へ保存していません。…」＋「選ぶ」 | after-github-unsaved-{wide,390} 同じ | （#639 の spec で確かめ済み・画像なし） |
| 保存失敗（再試行が尽きた後） | after-hub-failed-{wide,390}「Asayake ハブに保存できませんでした。…」＋「再試行」 | after-github-failed-{wide,390}「GitHub に保存できませんでした。…」＋「再試行」 | after-local-failed-{wide,390}「フォルダに保存できませんでした。…」＋「再試行」（直す前は「「フォルダを選ぶ」を押して…」＝before-local-failed-*） |

### 「この保存先を使用中です。」の帯（②の申し送り3・この tp で決める）

ハブの保存失敗・未保存の 390 幅で、3つの案を DOM に入れて撮った（アプリの動きではない）。
- 案1 帯の印を中立にする（band-neutral-hub-{failed,unsaved}-390）: チェックの印を雲の印に替え、使用中の色（is-active）を外した。外すと今ある「未適用」の時の警告の色になる（中立の色の帯は今の部品に無い）。
- 案2 保存できていない間は帯を出さない（band-hidden-hub-{failed,unsaved}-390）: 使用中であることは、下の「使用中」ボタン（押せない）で分かる。
- 案3 帯の文を変える（band-text-hub-{failed,unsaved}-390）: 警告の印と「この保存先を使用中です。保存できていない変更があります（上の文を見てください）。」。

推奨は **案2**。上の赤い行が保存の状態のただ1つの文になり、帯と2か所で別の言い方をしなくて済む。使用中であることは「使用中」ボタンで残る。案1は今の部品では警告の色になり、未適用の時の見た目と区別が付かない。案3は上の行と同じことを別の文でもう一度言う（文の決め方が2か所になる）。

### そのほか

- 時刻の書き方（「5:19:46 PM」）は、テストのブラウザの言語のせい。playwright.config.js に locale の指定が無く、Playwright の既定（en-US）で動いている。アプリは `toLocaleTimeString()` を言語の指定なしで呼ぶ（js/bookshelf.js の updateSyncStatus の2か所）ので、日本語の端末では「17:19:46」の形になる。英語の設定の端末では英語の書き方になる作り。起票するかは②の判断に任せる（直していない）。
- 撮る spec は `tmp/657/zz-shots-sync-section-status.spec.js`（git には入れない。流す時は `tests/e2e/` へ写す。名前に `sync-section-status.spec.js` を含めると webkit の project で流れる）。
