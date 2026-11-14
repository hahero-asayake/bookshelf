# イシュー#639 の記録

読込時の3択 (`#load-conflict-dialog`・ADR-162) を選ばずに閉じた後も、同期欄が「同期済み」のままで、保存先へ書いていないことが分からない件。

## step1: 再現と、同じ種類の箇所の洗い出し (2026-11-14 15:19〜15:28)

- 着手時の origin/main は `0300351`。計画時の `6dc2c04` の上に、#631 と門の E2E (J3-4・J5-1・J6-5) の commit が積まれている。#635 はまだ push されていない。issue/639 は `0300351` へ早送りした。
- 行番号は `0300351` のもの (計画時から変わっていない)。

### 1. 再現 E2E (赤)

`tests/e2e/load-conflict-unsaved.spec.js` で確かめた (chromium・PORT 8139)。結果の JSON は `_local/639/` に置いた (リポジトリには入れない)。

期待値は、直した後の姿で書いた。
- 状態バーに `data-sync-failure="load-conflict"` の行が出る
- 同期欄が「同期済み」「保存済み」と言わない
- 公開は送らず (送信0件)、「公開を止めました」が出る

| 経路 | 時点 | 状態バー | 同期欄 (`#obsidian-sync-path` ／ `#obsidian-sync-status`) | 未反映の印 | 保存先 |
|---|---|---|---|---|---|
| ローカルフォルダ | 閉じた後 | 出ない | bookshelf-sync-test ／「3:22:32 PM 同期済み（「フォルダを選ぶ」で再読み込み）」 | `'1'` | 本Bなし |
| ローカルフォルダ | 閉じた後に短文メモを書き、2.5秒待つ | 出ない | 同上 (同期済みのまま) | `'1'` | 本Bなし |
| ハブ | 閉じた後 | 出ない | Asayake ハブ ／「3:24:18 PM 保存済み」 | `'1'` | 本Bなし |
| ハブ | 記事の「公開」を押した | toast なし | ― | ― | **`POST /publish` が1件。記事は published=true** |
| ハブ | 閉じた後に本を足し、2.5秒待つ | 出ない | 同上 (保存済みのまま) | `'1'` | 本Bなし |

判定:
- **2本とも赤** (ローカルは soft の失敗6件、ハブは8件)。依頼文の症状をそのまま再現した。同期欄は「同期済み／保存済み」のまま、状態バーには何も出ない。閉じた後に編集しても変わらない。
- **ハブでは公開が通った**。手元で足した本Bが保存先に無いまま、公開の送信が1件出た。つまり、保存先の古い内容が公開される。

記録の途中で分かった前提 (step3 の E2E で使う):
- 公開ボタンから公開ガードまで届くには、2つの条件がある。
  - 公開の名義 (username) が要る。無いと「本棚を公開するには、まずユーザー名を設定してください」(js/screens/article-editor.js:3249) で先に止まる。
  - 無料プランでは同意の確認 (「同意して公開」) が出る。
- spec では、ハブの設定に username を入れ、同意の確認は押して進めている。
- ローカルの経路では公開を押していない。ローカルを保存先にしていても、公開にはハブか GitHub の接続が要るため、公開はハブの経路で代表させた。

### 2. 同じ種類の箇所 (保存先へ書いていないのに、書けているように見える／公開が通る)

| | 経路 | 状態バー | 同期欄 | 公開 | 出典 |
|---|---|---|---|---|---|
| (a) | 読込時の3択を選ばずに閉じる (今回の件) | 出ない (実測) | 同期済み／保存済み (実測) | 通る (ハブで実測) | js/bookshelf.js:2959-2960 |
| (b) | 書き込み時の3択 (#616・`#sync-conflict-dialog`) を選ばずに閉じる | 出ない (実測) | 「Asayake ハブ（要再接続）」「保存できませんでした」(実測・赤字)。ただし「要再接続」は原因と合わない | 通る見込み (理由は下の a・b の共通の穴。実測していない) | L3659-3662・L3908 |
| (c) | 設定を開いて、GitHub の一覧が取れた | 失敗の行が消える | 変わらない | `_syncError` が外れるので、L5715 のガードが外れる | js/screens/settings.js:378-383 (GitHub の時だけ。コードで確認・実測していない) |
| (d) | 保存先が未設定・フォルダの許可が無い | 「保存先が未設定」の行 (L5032-5036)。許可が無い時は `NotAllowedError` を投げて 'permission' の行 (L3665-3675) | ― | ― | 対象外 (表示はある) |

(b) の補足: #635 (step2 の commit 5c733d9・まだ push されていない) が「何もしない」のボタンを無くした。閉じるのは Esc と枠外クリックだけになるが、閉じた後の動きは今と同じ。(b) の記録は spec の3本目 (記録だけ・合否は付けない) で取った。手順は門の E2E J6-4 と同じ。

**(a) と (b) は同じ穴**:
- 保留中の保存 (L3651-3655) も、衝突中の保存 (L3659-3662) も、throw せずに戻るだけ。
- そのため `_runPendingSync` は成功として扱い、`_clearSyncFailure()` (L3041) を呼ぶ。
- 結果として `_syncError` が立たない。状態バーにも、公開ガード (L5715 `hadPending && this._syncError`) にも、書いていないことが届かない。

### 3. 修正の案

| | 案A: SyncFailure に種類を足す (依頼文の推奨) | 案B: 保留専用の状態バーの行を別に持つ |
|---|---|---|
| 立て方 | 保留中・衝突中の `syncToObsidianFolder` が、印の付いたエラー (例 `name='SyncHoldError'`・`reason='load-conflict'`) を throw する。`_runPendingSync` の catch から `_onSyncFailed` を通り、`SyncFailure.classify` が種類を返す。閉じた枝 (L2959) でも `_onSyncFailed` を直に呼び、閉じた直後に出す | `_updateStatusBar` が `this._loadConflictHold` を見て、専用の行を描く |
| 表示の一貫性 | 状態バー・記事エディタの注意帯 (article-editor.js:582)・同期欄が、#603 と同じ1か所の文言を使う | 同期欄・注意帯・公開ガードに、それぞれ保留の分岐を足す (#603 の「1か所で決める」から外れる) |
| 自動の再試行 | retryable:false なので、phase 'final' ですぐ出し、再試行しない。電波が戻った時の送り直し (`_watchSyncRecovery`) も retryable だけが対象なので走らない | 再試行とは関係しない (保留中は今も書かない) |
| 成功扱いで表示が消える穴 | throw するので `_clearSyncFailure()` に届かない | 保留の印そのものを見るので、穴の影響を受けない |
| (c) で消える | 消える (`_syncError=false`)。(c) も直す必要がある | 消えない |
| #635 との重なり | どちらの案も、`_askLoadConflict` の閉じた枝 (#635 の hunk `@@ -2931`・`@@ -2960` の隣) と、`syncToObsidianFolder` の保留・衝突の枝 (#635 の hunk `@@ -3658` の隣) を触る。載せ直しで文字の衝突が出る見込み (解き方は機械的) | 同じ |

**推奨: 案A**。具体的には次の3つ。
1. 印の付いたエラーを throw し、`_onSyncFailed` の1か所で状態を立てる。
2. 公開ガードは、②の指示どおり `_syncError` ではなく、保留そのもの (`_loadConflictHold`) を見る。(b) を含めるなら `SyncConfigManager.conflict()` も見る。
3. (c) は、settings.js:381 の解除を「`_syncFail` が立っていない時だけ」に絞る。

### 4. #635 との突き合わせ (15:25 時点)

- DB: #635 は state=`tp_review`、step_idx=1 (step2 の後の tp)。更新は 15:17。
- commit は2つ。issue-635 の worktree の HEAD にあり、origin/main には無い (`git log origin/main..HEAD` に2件)。
  - `2935d83` docs
  - `5c733d9` fix「読込時と書き込み時の衝突の選択ダイアログを1つの定義から出し…」
- 5c733d9 が触ったファイル: css/bookshelf.css・index.html・js/bookshelf.js (130行)・scripts/verify/635-results.md・tests/e2e/back-nav-matrix.spec.js・tests/e2e/char/hub-conflict.spec.js・tests/e2e/gate/j6-4-sync-conflict.spec.js・tests/e2e/standard-ops.spec.js・tests/e2e/sync-conflict.spec.js。
  - #639 が足した spec と同じファイルは無い。tests/e2e/sync-offline-reconnect.spec.js も触っていない。
- js/bookshelf.js の hunk は5か所。
  - 先頭 (`CONFLICT_DIALOG` の定義・`@@ -16`)
  - `_askLoadConflict` (`@@ -2931`)
  - `_showLoadConflictDialog` を `_showConflictChoiceDialog` に寄せた所 (`@@ -2960`)
  - `syncToObsidianFolder` の衝突の枝 (`@@ -3658`。`_syncConflictSource()` を `_syncLabel()` に替えた)
  - `_handleSyncConflict` と `_showConflictDialog` (`@@ -3857`〜`-3927`。'reload' を 'remote' に替え、「何もしない」を撤去)
- #639 の E2E への影響:
  - `#load-conflict-dialog` と `#sync-conflict-dialog` の id は残る。閉じ方 (Esc) も同じ。
  - いまの spec はダイアログのボタンを押していない。step3 で「選ぶと消える」を足す時に、#635 の後のボタンに合わせる。

### 5. ②に決めてほしいこと

1. (b)・(c) を同じ仕組みに含めるか。
   - 推奨: **両方含める**。
   - (b) は (a) と同じ穴で、公開が通る見込み。#635 で2つの3択が1つの定義になるので、閉じた後の見え方も揃えるのが「同じ操作は同じ見た目」に合う。
   - (c) は、案A にすると「未保存」の行を消してしまうので、直さないと案A が成り立たない。
2. 案A／案B。推奨は **案A** (上の 3. の1〜3)。
3. #635 との順番。承認どおり並行で進める。ただし (b) を含める場合、#635 が `_handleSyncConflict` を書き換えた上で tp_review 中なので、step2 の着手時に #635 が main に入っていればその上で実装する。入っていなければ (a) と (c) から実装し、(b) は step4 の載せ直しの時に #635 の形へ合わせる。

## step2: 修正の実装 (2026-11-14 15:45〜)

- 着手時の確認: #635 の commit `5c733d9` は origin/main に入っていない (`git branch -r --contains 5c733d9` が空)。②の決定どおり、(a) と (c) を実装した。(b) は step4 の載せ直しの時に #635 の形 (`_showConflictChoiceDialog`・「何もしない」ボタンの撤去) に合わせて足す。
- origin/main `4f1a19b` へ早送りしてから実装した。commit は `feb58a0`。

### 1. 決めたこと: 印のエラーは名前を1つにし、止めている理由で種類を分ける (ADR 追補に書く理由)

- 印は `SyncFailure.holdError(reason)` で作る。名前は `SyncHoldError` の1つで、止めている理由を `reason` に持つ。理由は2つ。
  - `'load-conflict'`: 読込時の3択をまだ選んでいない (#602)
  - `'sync-conflict'`: 書き込み時の3択をまだ選んでいない (#616)
- `classify` は理由ごとに種類 (kind) を返す。種類は `load-conflict` と `sync-conflict` の2つ。どちらも `retryable:false`・`reconnect:false`・`hold:true`・`actionLabel:'選ぶ'`。
- 名前を1つにした理由:
  - 呼び手から見た扱いがどちらも同じだから。再試行しない、すぐ出す、公開を止める、状態バーの「選ぶ」で3択を開き直す。
  - そのため、次の3つを `name === 'SyncHoldError'` または `f.hold` の1つの判定で済ませられる。
    - `_runPendingSync` でエラーとして記録しない所
    - 同期欄に出す所
    - 状態バーのボタンを「選ぶ」にする所
- 種類を2つに分けた理由:
  - 利用者に出す文と、開き直す3択が違うから。
  - 状態バーの行 (`data-sync-failure`) と E2E で、どちらの理由で止めているかを見分けられるようにするため。
  - #635 で3択が1つの定義に寄るので、開き直す先は理由で選ぶだけになる。

### 2. 実装 (`feb58a0`)

| 所 | 変えたこと |
|---|---|
| js/sync-failure.js | 次の3つを足した。① `holdError(reason)`。② `classify` の先頭に、止めている間の2種類 (文言は下)。③ 公開を止めた時の文 `HOLD_PUBLISH_MESSAGE`。印のエラーの `message` は英語の内部用 (`sync hold: <reason>`)。利用者には出さない (日本語で半角かっこを含めたら lint:copy に2件指摘された) |
| js/bookshelf.js `_askLoadConflict` | 選ばずに閉じた枝で `_onSyncFailed(holdError('load-conflict'))` を呼ぶ。'remote' を選んだら、表示を解いて同期欄を「同期済み」に戻す。'local' を選んだら表示を解く (上書きが書けたかは、この後の保存がふつうに知らせる) |
| `syncToObsidianFolder` の保留の枝 | 黙って戻らず、`holdError('load-conflict')` を投げる。こうすると `_runPendingSync` が成功とみなさず、`_clearSyncFailure()` に届かない |
| `_runPendingSync` の catch | `SyncHoldError` は決めた動きなので `console.error` しない (端末エラーの見張りに出さない) |
| `_onSyncFailed` | `f.hold` の時は、同期欄にも同じ文を出す (`updateSyncStatus('held', …)`) |
| `updateSyncStatus` | 状態 `'held'` を足した (文を赤で出す。フォルダの「要再接続」は付けない)。保留中に来た `'synced'` はここで `'held'` に読み替える。読み込みの後の 'synced' の呼び出し (フォルダを選んだ時・起動時の読み込み) を1つずつ直さずに済む |
| `_syncFailureRow`・状態バーの振り分け | `f.hold` の行のボタンは `data-status-action="resolve-hold"`。押すと `_resolveSyncHold()` から `_askLoadConflict()` を呼び、3択を開き直す |
| `_runPublishExport` | `_loadConflictHold` があれば、flush の前に止める。toast は `HOLD_PUBLISH_MESSAGE`、戻り値は `{ ok:false, reason:'hold' }`。`_syncError` は見ないので、印が外れても止まり、再読込の後も保留がある間は止まる |
| js/screens/settings.js:380 (c) | GitHub の一覧が取れた時の解除を「`_syncFail` が無い時だけ」に絞った (保存の失敗・保留の表示を消さない) |
| index.html | `?v=` を origin/main の最大 (2026111633) より新しくした。sync-failure.js 2026111640・bookshelf.js 2026111641・screens/settings.js 2026111642 |

文言 (lint:copy 119/119 で通過):
- load-conflict: 「保存先とこの端末の両方が変わっているため、保存先へ保存していません。「選ぶ」から、どちらの内容を使うか選んでください。」
- sync-conflict (step4 でつなぐ): 「別の端末で保存先が更新されたため、保存先へ保存していません。「選ぶ」から、どちらの内容を使うか選んでください。」
- 公開を止めた時: 「保存先とこの端末の両方が変わっているため、公開を止めました。状態バーの「選ぶ」で使う内容を選んでから、もう一度公開してください。」

記事エディタの注意帯 (js/screens/article-editor.js:582) は `_syncErrorMsg` を出す。`_onSyncFailed` は phase 'final' の時に `_syncErrorMsg = f.message` にするので、注意帯にも同じ文が出る。ただし、これはコードで確かめただけで、E2E では見ていない (step3 で足す)。

### 3. 確認

| 項目 | 結果 |
|---|---|
| 新しい spec (chromium) | (a) ローカル **passed**・(a) ハブ **passed**。ハブでは公開の送信が0件、止めた理由の toast が出て、記事は published=false のまま。(b) は記録だけで、まだつないでいないので表示は step1 と同じ |
| 単体 (vitest) | sync-failure 11/11。全件は 74 files・**1104 passed**・2 todo・失敗0 |
| lint | copy 119/119 (足した直後は 121 → 内部用の文を英語にして戻した)・terms・css・e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs (82 以内)・e2e-gate (41本・37/37)・known-red (2件)。すべて OK |
| check:version `--range=origin/main..HEAD` | OK (commit 後に実行) |
| 関係する E2E 17本 (chromium・workers 3) | **119 passed・4 skipped・失敗0** (2.4分)。対象は #602 (sync-offline-reconnect・sync-first-connect)・#603 (save-failure-visible・publish-conflict-hub)・#616 (sync-conflict・char/hub-conflict)・門の J1-3・J6-1・J6-3・J6-4・J6-5・J8-4・online-resync・shelf-file-delete・book-memo-file-lifecycle・standard-ops と、この spec |

### 4. 残り (step3・step4 へ)

- step3:
  - E2E に3つを足す。「選ぶと消える」(読み込む・上書きの両方)、「再読込をまたいでも、保留がある間は公開が止まる」(②の指示)、「記事エディタの注意帯に同じ文が出る」。
  - chromium と webkit で3回ずつ流す。
  - 全件比較と、画像 (390幅・PC幅) を撮る。
- step4 で (b) をつなぐ。#635 の形の上で、次の5つを行う。
  - 衝突中の `syncToObsidianFolder` は `holdError('sync-conflict')` を投げる。
  - 書き込み時の3択を選ばずに閉じたら `_onSyncFailed` を呼ぶ。
  - `_resolveSyncHold()` から書き込み時の3択も開き直す。
  - 公開ガードは `SyncConfigManager.conflict()` も見る。
  - 同期欄の 'synced' の読み替えに衝突中も足す。
- (b) の spec も step4 で、直した後の姿を期待値にした合否つきに直す。中身は、閉じた後に状態バーへ出る・公開が止まる・選ぶと消える、の3つ。

## step3: E2E の3点・全件比較・画像 (2026-11-14 16:05〜)

- 着手時に origin/main へ載せ直した。#635 の commit (5c733d9 ほか・ADR-164) は origin/main に入っていた。
  - 衝突は index.html の `?v=` だけ。origin/main の最大 (2026111660) より新しくした: sync-failure.js 2026111671・bookshelf.js 2026111672・screens/settings.js 2026111673。
  - js/bookshelf.js は自動で合わさった。#635 の後もダイアログの id とボタンの class (`.cfm-remote`・`.cfm-local`・`.cfm-export`) は同じなので、spec のセレクタは直していない。
  - 載せ直した後の commit: `5aa8362` fix・`1c110d7` docs・`6b60ee2` test・`e1f134e` test (画像の撮り方)。

### 1. E2E (tests/e2e/load-conflict-unsaved.spec.js)

画面の操作だけで確かめる。関数の直呼びは、記事を作る手順と状態を読む所だけで使う。

| | ローカルフォルダ | ハブ |
|---|---|---|
| ① 閉じた後に「未保存」が出る | 状態バーの行 `data-sync-failure="load-conflict"` と、同期欄の文 | 状態バーの行 (同期欄の文は DOM で確かめる。ハブの設定画面には同期欄の文の欄が出ない。下の 4. を参照) |
| ① 自動の再試行をしない | 再試行の間隔を 300ms に縮めても、行は `status-warn` のまま。「再試行」のボタンも無い | ― |
| 閉じた後に編集しても消えない | 短文メモを書いた後も出る | 本を足した後も出る |
| ② 公開が止まる | ― (ローカルを保存先にしていても、公開はハブか GitHub を使うため) | 送信0件・止めた理由の toast・記事は published=false |
| 再読込でもう一度聞かれる | 再読込で3択が出る。閉じるとまた出る | 同じ |
| 再読込をまたいでも公開が止まる (②の指示) | ― | 再読込→閉じた後の公開も、送信0件・toast あり |
| ③ 状態バーの「選ぶ」から選ぶと消える | 「この端末の内容で保存先を上書き」→ 行が消え、フォルダに本Bが届き、同期欄は「同期済み」 | 「保存先の内容を読み込む」→ 行が消え、同期欄は「保存済み」、他の端末の本Cが入る |

3本目 (書き込み時の3択を閉じた後・(b)) は、まだ記録だけ。step4 で (b) をつなぎ、合否つきに直す。

### 2. 3回続けて緑

| ブラウザ | 結果 |
|---|---|
| chromium (`--repeat-each=3`) | **6/6 passed** (ローカル3・ハブ3)。全件比較を同時に流している負荷の中でも通った |
| webkit (iPhone 13・`--repeat-each=3`) | **ハブ 3/3 passed**。ローカルの3回は skip (ローカルフォルダは PC の Chrome/Edge だけで選べる・ADR-046。spec に skip の理由を書いた) |

- webkit について: playwright.config.js の webkit の project は、決まった spec だけを流す設定になっている。そこで `_local/639/pw-webkit639.config.mjs` (git に入らない一時の設定) で、この spec だけを iPhone 13 相当で流した。
- 画像の撮り方を直した後 (`e1f134e`) に、ローカル (chromium) とハブ (webkit) をもう1回ずつ流して、どちらも passed。

### 3. 全件比較

`node scripts/verify/e2e-diff-main.mjs --port=18139 --out=_local/639/e2e-diff2` (16:13〜16:26)。比較相手は origin/main `51f29dd` (#635 入り)、作業側は `6b60ee2` の作業ツリー。
- 前の run で始めた全件比較は、比較相手の側を流している途中で run と一緒に止まった。残っていた一時の worktree は `_trash/639-e2e-diff-stopped-1613` へ退避し、流し直した。

| 対象 | 比較相手 (origin/main) | 作業側 | 新しく落ちた |
|---|---|---|---|
| E2E (playwright・visual 以外) | 1020 passed・594 skipped・1 failed | 1020 passed・594 skipped・4 failed (新しい spec の3本は通った) | **0件**。作業側だけで落ちた3件は、流し直して通ったので flake と判定 (icons-vendor の未 inline の Lucide 名・save-failure-visible の GitHub 401 の保存し直し・shelf-file-delete の GitHub の削除待ち) |
| 両方で落ちた | save-failure-visible「GitHub: トークンを更新しても 401 なら…」 | 同じ | ― (main でも落ちる既存のもの。step2 の関係 E2E では通っていたので、負荷で揺れる候補) |
| 単体 (vitest) | 失敗0 | 失敗0 | **0件** |
| 画像の差分 (visual・作業側) | ― | **54件中0件** | ― |

flake の3件のうち save-failure-visible の 401 の保存し直しは、今回変えた所に近い (保存の失敗の1か所)。ただし通る道は `_syncWithAuthRetry` で、今回変えたのは保留の印のエラーの扱いだけなので、この道は通らない。step2 の関係 E2E (119 passed) でも、この spec は全部通っている。

### 4. 画像 (`_local/639/shots/`・push 前の tp で見せる)

| ファイル | 中身 |
|---|---|
| local-unsaved-pc-statusbar.png | PC 幅。状態バーの上に「保存先とこの端末の両方が変わっているため、保存先へ保存していません。…」と「選ぶ」 |
| local-unsaved-pc-sync.png | PC 幅。設定 → 同期の保存フォルダの欄に、同じ文が赤字で出る (以前は「同期済み」) |
| local-unsaved-390-statusbar.png | 390 幅。本棚の一覧の上に同じ行と「選ぶ」 |
| local-unsaved-390-sync.png | 390 幅。同期の画面の保存フォルダの欄に、同じ文が赤字で出る |
| hub-unsaved-pc-statusbar.png・hub-unsaved-390-statusbar.png | ハブ (webkit・iPhone 13)。ホームの上に同じ行と「選ぶ」。390 幅では Safari の「ホーム画面に追加」の案内の下に出る |
| hub-unsaved-pc-sync.png・hub-unsaved-390-sync.png | ハブの同期の画面。「この保存先を使用中です。」とログイン中の表示だけで、保存の状態の文の欄は無い (#obsidian-sync-status はローカルフォルダの欄の中にあり、ハブでは出ない) |

画像で分かったこと (step4 の tp で②に見てほしい点):
- **ハブ・GitHub では、設定の同期の画面に保存の状態が出ない**。これはこのイシューで変えたことではなく、もとからの作りで、「保存済み」「保存できませんでした」も出ていなかった。
  - 「未保存」が見えるのは状態バーだけになる。状態バーには出ているので、完了条件は満たす。
  - ただ、同期の画面は「この保存先を使用中です。」とだけ出るので、保存できていると読める。ここに保存の状態を出すかは、別の行として 07 に起こすか、②に判断してほしい。
- スマホ幅で本の詳細や横のメニューを開いている間は、状態バーがその下に隠れる。保存の失敗 (#603) でも同じで、もとからの作り。
