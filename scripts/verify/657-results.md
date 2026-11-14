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
