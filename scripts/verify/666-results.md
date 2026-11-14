# #666 起動の読込が通信で失敗した時の文に「次にどうすればよいか」が無い — 記録

## step1 着手条件・#653 が入れた形・今の表示の実測・文言と揃え方の材料（2026-11-14 18:46〜18:52・コードは変えていない）

### 着手条件と土台

- 18:46 に `git fetch -q origin` した。origin/main は d18af26。`git log origin/main --oneline --grep='Issue: #653'` に #653 の fix 3f56855「fix: ハブ・GitHub の起動の読込が失敗した時、同期欄に「保存できませんでした」ではなく状態バー・toast と同じ読込の失敗の文を出し、…」が出た（ほかに test・docs の commit が9件）。DB では #653 が done（step_idx 5）。#657 も done。
- worktree を f9468f8 から d18af26 へ `git merge --ff-only origin/main` で早送りした。node_modules はもうあった（実ディレクトリ）ので、張り直していない。
- 以下の行番号は d18af26 のもの。

### #653 が入れた形（このイシューで1か所へ寄せる文）

- ハブの catch（js/bookshelf.js L3259-3272）：`_syncErrorMsg` を、認証切れなら「${svc} の認証が切れました。設定から再接続してください。」、それ以外なら「${svc} からの読み込みに失敗しました。」にする（L3263-3265）。`updateSyncStatus(isAuthErr ? 'reconnect' : 'failed', label, this._syncErrorMsg)`（L3268）で同期欄に同じ文を渡し、`_updateStatusBar()`（L3269）で状態バーに出す。認証切れ以外は `_markInitLoadFailed(this._syncErrorMsg)`（L3271）。
- GitHub の catch（L3392-3415）：同期欄へは `updateSyncStatus(authErr ? 'reconnect' : 'failed', label, authErr ? authMsg.replace('\n', '') : 'GitHub からの読み込みに失敗しました。')`（L3398-3399）。通信の失敗の時は、toast「手元のデータで表示中です。GitHub からの読み込みに失敗しました。」と「再試行」（`initGitHubSync`・10秒）を出し（L3407-3411）、`_markInitLoadFailed()`（barMsg なし・L3413）を呼ぶ。`_syncError` は立てないので、状態バーに読込の失敗の行は出ない。
- 通信の失敗の文は、今は3つの別々の文字列で書かれている：L3265（ハブ。状態バーと同期欄の両方に使う）、L3399（GitHub の同期欄）、L3407（GitHub の toast。前に「手元のデータで表示中です。」が付く）。1か所では決めていない。
- 同期欄（#657 の後）：`updateSyncStatus` は `_applySyncStatus`（L4177-）と `_renderSyncState`（L5236-5260）に分かれた。`#sync-state-row` は3つの保存先に共通で、文がある時は見える（`row.hidden = !text`）。`#sync-state-actions` の「再試行」は保存の失敗（`_syncFail`）の時だけ出る。読込の失敗は `_syncFail` を立てないので、同期欄にボタンは出ない。
- 状態バーと同期欄のボタンは、どちらも `_runStatusAction`（L5196-5201）で動く（#657）。今ある動きは update・open-sync・retry-sync（保存の再試行 `_retrySyncNow`）・resolve-hold の4つ。読込をやり直す動きは無い。

#### spec で通信の失敗の文を直書きしている行（このイシューで書き換える行の候補）

| ファイル | 行 | 見ている所 | 今の書き方 |
|---|---|---|---|
| tests/e2e/boot-load-failure-status.spec.js（#653） | L82 | ハブの状態バー | `toContainText('Asayake ハブ からの読み込みに失敗しました。')` |
| 同 | L83 | ハブの同期欄 | `expectSyncField` の `toHaveText('Asayake ハブ からの読み込みに失敗しました。')` |
| 同 | L99 | GitHub の toast | `.toast-message` の hasText 'GitHub からの読み込みに失敗しました。' |
| 同 | L100 | GitHub の同期欄 | `toHaveText('GitHub からの読み込みに失敗しました。')` |
| tests/e2e/online-resync.spec.js（#617） | L65 | ハブの状態バー | `toContainText('読み込みに失敗しました')` |
| 同 | L137 | GitHub の toast | `.toast-message` の hasText 'GitHub からの読み込みに失敗しました'（計画の時は L136。#653 の e8b9788 で toast に絞られて1行ずれた） |

- 認証切れの行（boot-load-failure-status.spec.js L91・L92・L107 など）は対象外なので触らない。
- ほかの spec には、この文は無い（`git grep -n "からの読み込みに失敗" -- tests`）。

#### vault の 04_画面設計書（#653 が足した行）

- L335「設定の同期欄の起動の読込の失敗: ハブ・GitHub の起動の読込が失敗した時は、保存の失敗の「保存できませんでした」ではなく、同じ失敗で状態バー (ハブ)・トースト (GitHub) に出す文を出す。ハブ「Asayake ハブ からの読み込みに失敗しました。」(ログイン切れは …)、GitHub「GitHub からの読み込みに失敗しました。」(接続切れは …)。名前の後ろの「（要再接続）」はログイン切れ・接続切れの時だけで、通信の失敗には付けない (ネットにつながった時とタブに戻った時に読み直す)。」
- step3 では、この行の通信の失敗の文と、出す場所（「状態バー (ハブ)・トースト (GitHub)」）を、決めた形に合わせる。読むのには tmp/666/read-04.mjs を使った（vault のパスはスクリプトの中に持った）。

### 今の表示（直す前・d18af26 で実測）

流し方：`PORT=8166 npx playwright test --config tmp/666/probe.config.mjs`。probe は `tmp/666/probe-666.spec.mjs` で、tmp/ は commit しない。作り方は boot-load-failure-status.spec.js（#653）と同じで、1回ふつうに起動してから、模擬より手前の `context.route` で起動の読込を落として開き直す。4本とも最後まで届いた（4 passed・47.4s・18:49）。元の記録は `tmp/666/runs/*.json`。

#### 表1　通信の失敗（`route.abort('internetdisconnected')`）

| 場面 | 状態バー | toast | 同期欄 `#obsidian-sync-status`（`#sync-state-row`） | path |
|---|---|---|---|---|
| ハブ・2.5秒後 | 「Asayake ハブ からの読み込みに失敗しました。」＋「確認」 | なし | 「Asayake ハブ からの読み込みに失敗しました。」（行は見える・ボタンなし） | 「Asayake ハブ」 |
| ハブ・11.5秒後 | 同じ | なし | 同じ | 同じ |
| GitHub・2.5秒後 | 「最新のデータを確認しています…」と「GitHub の保存先を取得できません。」＋「確認」（注1） | 「手元のデータで表示中です。GitHub からの読み込みに失敗しました。」＋「再試行」＋閉じる | 「GitHub からの読み込みに失敗しました。」（行は見える・ボタンなし） | 「taro/bookshelf-data@main」 |
| GitHub・11.5秒後 | 「GitHub の保存先を取得できません。」＋「確認」（注1） | なし（10秒で消えた） | 同じ | 同じ |

- 注1：「GitHub の保存先を取得できません。」は js/screens/settings.js L396-399 の文。設定の GitHub の欄がリポジトリの一覧を取りに行って失敗した時に、`_syncError`・`_syncErrorMsg` を立てて状態バーに出している。起動の読込の catch とは別の経路（653-results step1 の注1 と同じ）。模擬がその要求に答えないので、失敗させる前の起動でも出る。
- 分かったこと：brief の「3か所に出る」は、実際はサービスごとに2か所。ハブは状態バーと同期欄、GitHub は toast と同期欄に出る。GitHub では toast が10秒で消えた後、主画面に読込の失敗の文が残らない（設定を開けば同期欄で見える。#657 の後は行が見える）。

#### 表2　電波はあるのにサーバが失敗する（503）→ サーバが戻る → タブに戻る

| 場面 | 失敗の直後 | サーバが戻ってから8秒（'online' は来ない） | visibilitychange の後 |
|---|---|---|---|
| ハブ | 表1と同じ文 | 読込の GET は0回。同期欄は失敗の文のまま | GET 7回。同期欄は「6:49:06 PM 保存済み」、状態バーの行は消えた（バーごと hidden） |
| GitHub | 表1と同じ文（toast も出た） | GET 0回。失敗の文のまま（toast も出たまま） | GET 8回。同期欄は「6:49:16 PM 保存済み」。ただし toast「手元のデータで表示中です。GitHub からの読み込みに失敗しました。」は、読み直せた後も残っていた（10秒の間） |

- visibilitychange は、ヘッドレスで `document.dispatchEvent(new Event('visibilitychange'))` を出して代わりにした（visibilityState は 'visible' のまま）。本物のタブの切り替えではない。
- 電波が戻った時（'online'）に読み直すことは、online-resync.spec.js の L42（ハブ）と L110（GitHub）（#617）が確かめている。このステップでは流していない。
- 分かったこと：自動の読み直しは、「電波が戻った時（'online'）」と「タブに戻った時」の2つだけ（js/bookshelf.js `_watchSyncRecovery` L5290-5307、js/ui/online-watcher.js）。電波があるままサーバが落ちた時は、サーバが戻っても、その画面にいる間は読み直さない（実測で確かめた）。手で読み直す手段は GitHub の toast の「再試行」（10秒で消える）だけで、ハブには無い（状態バーの「確認」は設定を開くだけ）。ページの再読込（タッチの引っぱって更新も含む）でも読み直す。
- GitHub の今の toast は、読み直せた後も最大10秒「…読み込みに失敗しました。」と出たまま残る。状態バーの行は、読み直せたら消える（ハブで実測。`_retryInitLoad` が `barMsg` と同じ文を下ろす・L5324-5326）。

### 文言の案（画面に出る文）

| 場面 | 今 | 案A | 案B | 案C |
|---|---|---|---|---|
| ハブ | Asayake ハブ からの読み込みに失敗しました。 | Asayake ハブから読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。 | Asayake ハブから読み込めませんでした。この端末の内容を表示しています。電波が戻った時か、この画面に戻った時に、自動で読み直します。 | Asayake ハブ からの読み込みに失敗しました。この端末の内容を表示しています。通信を確かめて、ページを開き直してください。 |
| GitHub | GitHub からの読み込みに失敗しました。（toast は前に「手元のデータで表示中です。」が付く） | GitHub から読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。 | GitHub から読み込めませんでした。この端末の内容を表示しています。電波が戻った時か、この画面に戻った時に、自動で読み直します。 | GitHub からの読み込みに失敗しました。この端末の内容を表示しています。通信を確かめて、ページを開き直してください。 |
| 足すボタン | — | 状態バーの行に「再試行」（`_retryInitLoad` を呼ぶ新しい動き）。同期欄の `#sync-state-actions` にも同じ「再試行」（保存の失敗と同じ作り・#657） | なし | なし |

| 比べる点 | 案A | 案B | 案C |
|---|---|---|---|
| 書いた次の手が本当にあるか | ある（ボタンを足すので）。自動の読み直し（表2）もそのまま残る | 文は事実と合う（表2）。ただし、電波があるままサーバが落ちた時は、画面にいる間は何も起きない。ハブには今すぐ直す手が無いまま | ある（再読込で読み直す）。ただし、自動で直る場面でも開き直しを求める。ホーム画面に置いたアプリにはブラウザの再読込ボタンが無い（タッチの引っぱって更新はある） |
| 保存の失敗の文との揃い（js/sync-failure.js の network「Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。」） | 揃う（「〜できませんでした。通信が戻ったら「再試行」を押してください。」） | 前半だけ揃う | 揃わない（「Asayake ハブ から」の空白も） |
| 挙動の変化 | ボタンが1つ増える（ハブで手で読み直せるようになる） | なし | なし |
| lint:copy（上限119） | OK 119/119 | OK 119/119 | **違反 120/119**。「Asayake ハブ からの…」が jtf-style 3.1.2「全角文字どうしの間にスペースを入れない」に当たる（今の文はテンプレート `${svc} から…` なので抽出で〈値〉になり、当たっていない） |
| lint:terms | OK（table 1/1・jargon 0/0） | OK（同じ） | OK（同じ） |
| spec の書き換え | #653 の spec L82・L83・L99・L100、online-resync L65・L137（文が変わるため） | 同じ | online-resync は部分一致のまま通る。#653 の spec の L83・L100（toHaveText）は書き換えが要る |
| 長さ（ハブの文） | 60字 | 69字 | 64字 |

- 参考：今の文は26字、保存の失敗の network の文は43字。
- lint の当て方：`node tmp/666/trial.mjs`。js/bookshelf.js の3つの文（L3265・L3399・L3407）を案の文に一時的に置き換えて `extract-ui-strings`・`check-ui-copy`・`check-ui-terms` を流し、毎回 `git checkout -- js/bookshelf.js` で戻した。退避した写しと3回とも一致した（cmp OK）。抽出の結果（`_local/ui-strings.json`）に案の文が入っていたことも確かめた（A・B・C とも、2文とも true）。最後にもとの文で抽出し直した。出力は `tmp/666/trial/{base,A,B,C}.txt`。

### 出す場所の揃え方

| 比べる点 | (a) 3か所に出す | (b) 状態バーと同期欄に出す（推奨） | (c) 今の場所のまま、文だけ揃える |
|---|---|---|---|
| ハブ | 状態バー・toast（足す）・同期欄 | 状態バー・同期欄（今と同じ場所） | 状態バー・同期欄 |
| GitHub | 状態バー（足す）・toast・同期欄 | 状態バー（足す）・同期欄。toast はやめる | toast・同期欄 |
| 読み直せた後 | toast は最大10秒、古い失敗の文が残る（表2の GitHub） | 状態バーの行は読み直せたら消える（表2のハブ）。古い知らせが残らない | GitHub は toast が残る |
| 失敗が見え続けるか | 見える（状態バー） | 見える（状態バー） | GitHub は toast が消えた後、主画面に残らない（§2-11「失敗を無言にしない」に弱い） |
| 保存の失敗（#603）と同じ形か | 違う（保存の失敗は toast を出さない・`_onSyncFailed` L5203-5223） | 同じ（状態バー＋同期欄・「再試行」も同じ場所） | 違う |
| 完了条件の読み方 | brief のとおり「3か所」 | 「状態バーと同期欄の2か所に出て、toast は出ない」（②の承認メモで読み替え可） | 「出ている所すべて」 |

- (a)・(b) で GitHub の状態バーに行を足す時の注意（step3 で決める）：状態バーの同期の行は、`_syncErrorMsg` の1行を js/screens/settings.js L396-399（リポジトリ一覧の取得の失敗「GitHub の保存先を取得できません。」）と取り合う。`_syncErrorMsg` に読込の失敗の文を入れると、後から書いた方だけが残る。今のハブも同じ作り。読込の失敗の行を `_initLoadFailed` から出す別の行にする（`_syncChecking` の行と同じ形）か、`_syncErrorMsg` を使ったままにするかは、step3 で決めて記録する。
- 推奨は **案A＋(b)**。
  1. 書いた次の手（「再試行」）が、ハブ・GitHub とも本当に画面にある。
  2. 文の作りと出す場所が、保存の失敗（#603）と同じになる（「同じ操作は同じ見た目・同じ挙動」）。
  3. 読み直せた後に古い失敗の文が残らない（toast をやめるため）。
  4. lint:copy・lint:terms が今と同じ数で通る。

### step1 の tp で決まったこと（②・18:56）

- 文言は案A。出す場所は (b)。ハブ・GitHub とも、状態バーと同期欄に文と「再試行」を出し、GitHub の toast はやめる。完了条件は「2か所に同じ文が出て、toast は出ない」と読む。
- 状態バーの行は `_syncErrorMsg` を使わず、`_initLoadFailed` から出す別の行にする（`_syncChecking` と同じ形）。settings.js L396-399 の失敗と取り合って、片方が無言で消えるのを避けるため。
- 「再試行」の二重押しは、step2 の spec に1本足して、赤と緑で見る（読み直しの GET が1組だけか）。
- 503 で自動では読み直さない件は、ボタンで覆えるので、今回は直さない。

## step2 E2E を足し、直す前の版で赤を取る（2026-11-14 18:58〜19:08）

### 新しい spec：tests/e2e/boot-load-failure-message.spec.js（7本）

作りは boot-load-failure-status.spec.js（#653）と同じ。1回ふつうに起動してから、模擬（gate-hub.js・gate-github.js）より手前の `context.route` で起動の読込を落とし（`route.abort('internetdisconnected')`、GitHub の認証切れは 401）、開き直す。画面（`#app-status-bar`・`#obsidian-sync-status`・`#obsidian-sync-path`・`#sync-state-actions`・`.toast-message`）だけを読み、`bookshelf._*` は読まない。

| # | 本 | 見ること |
|---|---|---|
| 1 | ハブ・通信の失敗 | toast（読込の失敗の文）が0件。同期欄の textContent が決めた文と完全に一致（toHaveText）。状態バーの行の文に決めた文がある。その行の `.status-msg` が決めた文と完全に一致する。その行に「再試行」が1つ。同期欄の `#sync-state-actions` に「再試行」が1つ。path に「（要再接続）」を付けない（#653） |
| 2 | GitHub・通信の失敗 | 1 と同じ（文は GitHub の文） |
| 3 | ハブ・状態バーの「再試行」 | 通信を戻してから押すと読み直し、同期欄が「保存済み」になる。状態バーの読込の失敗の行と、同期欄の「再試行」が消える |
| 4 | GitHub・同期欄の「再試行」 | 同期欄が決めた文になる。通信を戻し、設定の同期を開いて同期欄の「再試行」を押すと読み直し、「保存済み」になる。同期欄の「再試行」と状態バーの行が消える |
| 5 | ハブ・二重押し | 1回押した時の読み直しの GET の数を、同じテストの中で数える（落ち着くまで待つ）。もう一度落としてから「再試行」を素早く2回押し（dblclick）、GET の数が1回押しと同じであることを見る |
| 6 | 守り・ハブの認証切れ | 状態バーと同期欄が #653 の文「Asayake ハブ の認証が切れました。設定から再接続してください。」のまま。path に「（要再接続）」が付く |
| 7 | 守り・GitHub の認証切れ（401） | toast「GitHub との接続に失敗しました。」が出る。同期欄が #653 の文のまま。path に「（要再接続）」が付く |

- 1・2 は、どこが違うかを1回で全部見るため soft にした。toast の0件は、最初に見る（10秒で消えるので）。同期欄の文と同じ catch の中で出すので、出るならもう出ている。
- 待つのは expect(locator) と expect.poll だけ（GET の数が落ち着くのは、0.7秒あけて2回同じになるのを expect.poll で待つ）。lint:e2e-goto・lint:e2e-wait・lint:e2e-external・lint:internal-refs（上限82以内）・lint:e2e-gate（@gate 41本・違反0件）は、すべて OK。

### 直す前の版（issue/666 の 36aac79＝origin/main d18af26＋記録だけ）で2回流した結果

流し方：`PORT=8166 npx playwright test tests/e2e/boot-load-failure-message.spec.js --project=chromium --workers=4`。出力は tmp/666/step2-before.txt（commit しない）。

| 回 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 時間 |
|---|---|---|---|---|---|---|---|---|
| 1回目（19:03:59） | 赤 | 赤 | 赤 | 赤 | 赤 | 緑 | 緑 | 1.8m |
| 2回目（19:05:50） | 赤 | 赤 | 赤 | 赤 | 赤 | 緑 | 緑 | 2.0m |

赤の理由（Received の値）。2回で同じだった。失敗の見出しと Received の行を抜き出して比べると29行が一致した（tmp/666/step2-red-run{1,2}.txt）。

- 1（ハブ）
  - 同期欄：Received「Asayake ハブ からの読み込みに失敗しました。」
  - 状態バーの行の文（全部）：Received ["Asayake ハブ からの読み込みに失敗しました。"]
  - 決めた文の行：無い
  - 行の「再試行」：0
  - 同期欄の「再試行」：0
  - toast の0件と path は緑（ハブは今も toast を出していない）
- 2（GitHub）
  - toast：Received 1（「手元のデータで表示中です。GitHub からの読み込みに失敗しました。」）
  - 同期欄：Received「GitHub からの読み込みに失敗しました。」
  - 状態バーの行の文（全部）：Received ["GitHub の保存先を取得できません。"]（settings.js の別の失敗。読込の失敗の行は無い）
  - 決めた文の行：無い
  - 「再試行」：状態バー・同期欄とも0
  - path は緑
- 3・5（ハブ）：状態バーに、決めた文の行の「再試行」が無い（20秒待って element(s) not found）
- 4（GitHub）：同期欄が Received「GitHub からの読み込みに失敗しました。」
- 6・7：緑（認証切れの文は #653 のまま）

### 流し直した経緯

- 最初の版（tmp/666/step2-before-v1.txt・1回目 2.0m）では、2 の toast の0件が緑になっていた。toast を見る前に、soft の4つ（各5秒）を待っていた。その間に、10秒で消える toast が消えていた。toast を最初に見る形に直し、2回とも流し直した。
- 流し直しの1回目の途中で、前の実行を止めた。その時、port 8166 の `python3 -m http.server` が残った（親の playwright が無くなり、ログの出口を失ったと見ている）。残ったサーバへの要求は、すべて `net::ERR_EMPTY_RESPONSE` になった（tmp/666/step2-before-v2-server-broken.txt）。そのサーバを PID で止めて、もう一度2回流した（上の表）。

## step3 文を1か所で決める形にして直し、緑にする（2026-11-14 19:09〜19:2x）

### 直したこと

- js/sync-failure.js：`SyncFailure.loadFailure(method)` を足した。返すのは `{ kind: 'load-network', retryable: true, actionLabel: '再試行', message }`。文はハブと GitHub で分けた（案A）。認証切れの文は移していない（対象外）。
- js/bookshelf.js
  - 2つの catch（`_initCloudSyncLoad`・`_initGitHubSyncLoad`）：認証切れの分岐はそのまま（文・`_syncError`・GitHub の toast とも #653 と同じ）。読みやすくするため、先に認証切れを扱って return する形にしただけ。通信の失敗の分岐は、`_markInitLoadFailed(SyncFailure.loadFailure(method))` で印に文を持たせ、同期欄へは `updateSyncStatus('failed', label, 同じ文)` を渡す。状態バーは `_updateStatusBar()` で出す。GitHub の toast（「手元のデータで表示中です。…」と「再試行」）はやめた（(b)）。
  - 状態バー：`_updateStatusBar` に、`_initLoadFailed` から描く読込の失敗の行（`data-load-failure="load-network"`・文と「再試行」）を足した。`_syncChecking` の行の次に置く。`_syncErrorMsg` は使わない（②の決定3）。ハブの通信の失敗では `_syncError`・`_syncErrorMsg` を立てなくなった。
  - 同期欄：`_renderSyncState` で、保存の失敗（`_syncFail`）が無く `_initLoadFailed` がある時に、`#sync-state-actions` へ同じ「再試行」を出す。文は updateSyncStatus が書いた同じ文。
  - 「再試行」の動き：`_runStatusAction` に `retry-load` を足した。`_retryInitLoad()` を呼ぶ（保存の `retry-sync`＝`_retrySyncNow` とは別）。状態バーと同期欄のボタンは、どちらもこの動きを通る（#657 の共有の口）。
  - 印の上げ下げ：`_markInitLoadFailed(failure)` は印に文と種類を持たせる（前は barMsg だけ）。新しく `_clearInitLoadFailed()` を作った。印を下ろし、状態バーの行と同期欄の「再試行」を消す。読み直しの始め（2つの load 関数の先頭）と `_retryInitLoad` から呼ぶ。`_retryInitLoad` の barMsg の後始末（`_syncErrorMsg` を消す所）は、`_syncErrorMsg` を使わなくなったので外した。
- 触っていないもの：updateSyncStatus の本体（`_applySyncStatus`）、保存の失敗（classify・`_onSyncFailed`・`_syncFailureRow`）、認証切れの文、#648 のキャンセルの後。
- index.html：`js/sync-failure.js?v=2026111691` を `2026111866` に、`js/bookshelf.js?v=2026111795` を `2026111866` に上げた。値は、19:10 の origin/main（02772ca）の最大値 2026111798 と、開いている他の worktree の最大値 2026111799（#672）より大きい。
- 設計の記述
  - docs/ui-standards.md §2-11（L71）に1文を足した：「起動時の保存先からの読み込みが通信で失敗した時も、同じ1か所（SyncFailure.loadFailure）で文を決め、状態バーの行と設定の同期欄に同じ文と「再試行」（読み直す）を出す（トーストは出さない・イシュー#666）。」。改訂履歴にも1行足した。
  - vault の 04_画面設計書 L336「設定の同期欄の起動の読込の失敗」：ハブ・GitHub の通信の失敗の文を新しい文にし、「同じ失敗で状態バー (ハブ)・トースト (GitHub) に出す文」を「状態バーの行 (GitHub の接続切れはトースト) と同じ文」に直した。行の末尾に「通信の失敗の時は、状態バーの行と同期欄に「再試行」を出し、押すと読み直す (トーストは出さない・…)」を足した。直すのに使ったのは tmp/666/edit-04.mjs。vault のパスは、文字列をつないで組んだ。vault の commit は自動バックアップに任せる。

### 書き換えた既存の spec の行（変えた文を直書きしていた行だけ・期待は全文のまま）

| ファイル | 行（前） | 前 | 後 | 理由 |
|---|---|---|---|---|
| tests/e2e/boot-load-failure-status.spec.js | L82 | 状態バー `toContainText('Asayake ハブ からの読み込みに失敗しました。')` | 状態バー `toContainText(新しいハブの文の全文)` | 文が変わった |
| 同 | L83 | 同期欄 `toHaveText('Asayake ハブ からの…')` | 同期欄 `toHaveText(新しいハブの文の全文)` | 同じ |
| 同 | L99 | toast `.toast-message` hasText 'GitHub からの読み込みに失敗しました。' が見える | 状態バー `toContainText(新しい GitHub の文の全文)` | GitHub の toast をやめ、状態バーに出すようにした（(b)） |
| 同 | L100 | 同期欄 `toHaveText('GitHub からの…')` | 同期欄 `toHaveText(新しい GitHub の文の全文)` | 文が変わった |
| 同 | L95 のテスト名 | 「同期欄は toast と同じ読込の失敗の文」 | 「同期欄は状態バーと同じ読込の失敗の文」 | toast をやめた |
| tests/e2e/online-resync.spec.js | L65 | 状態バー `toContainText('読み込みに失敗しました')`（部分一致） | 状態バー `toContainText(新しいハブの文の全文)` | 文が変わった（前より狭い期待にした） |
| 同 | L137 | toast `.toast-message` hasText 'GitHub からの読み込みに失敗しました' が見える | 状態バー `toContainText(新しい GitHub の文の全文)` | toast をやめた |

### 二重押し（②の申し送り）

- `_retryInitLoad` は、最初に印（`_initLoadFailed`）を下ろす。下ろすと、状態バーの行と同期欄の「再試行」は、その場で（同じ処理の中で）描き直されて消える。読み直しの間は `_initLoadRetrying` も立っている。だから、読み直しの最中に押し直したり、電波が戻った・タブに戻ったの合図が重なったりしても、2回目の initSync は走らない。
- spec の5（dblclick）では、素早く2回押した時の読み直しの GET の数が、1回押した時と同じだった（直した後、2回とも緑）。
- 前の GitHub の toast の「再試行」は、`initGitHubSync()` を直に呼んでいて、この守りを通っていなかった。toast をやめたので、この経路は無くなった。

### 流した結果（直す前と直した後）

| 対象 | 直す前 | 直した後 |
|---|---|---|
| 新しい spec boot-load-failure-message（7本） | step2 の2回とも 1〜5 が赤・6・7 が緑 | 2回とも 7本すべて緑（11.0s・11.6s・19:11） |
| 関係する spec の束（16ファイル・chromium・下の一覧） | このステップでは流していない（#653 が push する前に、同じ origin/main の土台で流して緑にしていた・653-results.md） | 124本：120 通過・2 失敗・2 スキップ（2.9m・19:14）。落ちた2本は下の注 |
| 落ちた2本だけ流し直し | — | 4本（save-failure-visible L149 のハブ・GitHub・ローカルと、load-conflict-unsaved L180）すべて緑（32.8s・19:15） |
| `npm test`（vitest） | — | 80ファイル・1194 通過・2 todo（sync-failure.test.js に loadFailure の2本を足した） |
| `npm run lint` | — | 12 本中 0 本失敗（lint:copy・lint:terms を含む） |

- 関係する spec の束の一覧：boot-load-failure-status・online-resync・save-failure-visible・gate/j6-5-sync-failure・first-run-init-status。ほかに、`git grep -l -e obsidian-sync-status -e 読み込みに失敗 -- tests` で出た book-memo-file-lifecycle・first-run-save-during-init-empty・gate/j1-3-connect-local・gate/j6-1-local-restart・gate/j6-3-hub-other-device・import-reload-persist・load-conflict-unsaved・shelf-file-delete・sync-first-connect・sync-offline-reconnect・sync-section-status。出力は tmp/666/step3-after.txt。
- 注（落ちた2本）：どちらもローカルフォルダの場面で、今回の印（`_initLoadFailed`）はハブ・GitHub でしか立たない。
  - load-conflict-unsaved L180 は、失敗が `ENOENT: copyfile …test-results/…`（テストの添付を写す所）だった。この束は、`npm test`・`npm run lint` と同時に流していた。
  - save-failure-visible L149（ローカル）は、出力に失敗の行が残っていなかった。
  - 2本とも、単独で流し直すと緑だった。step4 の全件比較でもう一度見る。
- 直した後に変わった挙動（記録しておく）：ハブの通信の失敗で `_syncError` を立てなくなった。そのため、公開の前の確認（js/bookshelf.js の `if (hadPending && this._syncError)`・公開の flush の後）は、ハブの読込の失敗だけでは公開を止めなくなった。flush で保存が失敗すれば、`_onSyncFailed` が `_syncError` を立てるので、今までどおり止まる。GitHub は前から読込の失敗で `_syncError` を立てていなかったので、ハブが GitHub と同じ形になった。止める条件に読込の失敗を足すかは、②の判断にする。

## step4 載せ直し・main との全件比較（2026-11-14 19:16〜・push はしない）

### 載せ直し

- 19:16 に `git fetch -q origin` した。origin/main は 61a91a2。`git rebase origin/main` した（土台は d18af26 から 61a91a2 へ。間に #663・#664・#668・#669 などが入っていた）。
- ぶつかったのは index.html の `?v=` の2行だけ。main 側は `sync-failure.js?v=2026111691`・`bookshelf.js?v=2026111798`、こちらは両方 2026111866 だった。ほかの開いている worktree を見ると #671 が 2026111867 を使っていた。そこで両方を **2026111876** にして解いた（main の最大 2026111798、ほかの worktree の最大 2026111867 より大きい）。`npm run check:version -- --range=origin/main..HEAD` は OK。
- js/bookshelf.js は自動でまとまった。main 側の d18af26..61a91a2 の差分（26行）を見たが、今回触った所（`_updateStatusBar`・`_renderSyncState`・`_runStatusAction`・2つの catch・`_initLoadFailed` まわり）には当たっていない。#657・#660 は d18af26 の時点でもう入っていたので、状態の欄と状態バーの扱いは step3 で読んだ形のまま。
- 載せ直した後の sha：9ca6c40（step1 の記録）・fc7d5ec（test・赤のまま）・e18a12c（fix）・d0bc39e（step3 の記録）。
- 全件比較を始めた時（19:18）には、origin/main が 80e2cc8 に進んでいた。増えたのは 668-results.md の docs の commit 1件だけなので、比較の結果には響かない。

### 最後の載せ直しの後の lint・単体（19:17）

- `npm run lint`：12 本中 0 本失敗。
- `npm test`：80ファイル・1196 通過・2 todo。

### main との全件比較（`node scripts/verify/e2e-diff-main.mjs --port=8166 --out=tmp/666/e2e-diff`・19:18〜19:29）

- 負荷が高かったので（load average 37〜47・16コア）、run の30分を超えても止まらないように、`systemd-run --user --unit=bs666-e2e-diff` で切り離して流した（#634 のノートの流し方）。19:29 に終わった（11分）。比較のための base の worktree は、スクリプトが片付けた。
- base は origin/main 80e2cc8、work は作業ツリー（HEAD d0bc39e）。visual は既定どおりオン。除外は sort-perf-budget だけ（ci.yml と同じ）。
- 件数：base は E2E 1100 通過・592 スキップ・3 失敗。work は 1106 通過・592 スキップ・4 失敗（新しい spec の7本などが増えた分）。

| 表 | 件数 | 中身 |
|---|---|---|
| 新しく落ちた（E2E） | **1** | github-sync-resilience.spec.js:59「GitHub からの読み込みが失敗すると「手元のデータで表示中・再試行」が出て、再試行で回復できる」（流し直し3回とも落ちた＝揺れではない） |
| 新しく通った（E2E） | 0 | — |
| 両方で落ちた（E2E） | 3 | duplicate-asin-notice.spec.js:111・gate/j3-5-many-books.spec.js:29（913冊・CPU 6倍遅くの時間計測）・list-staged-render.spec.js:109（913冊の段階描画）。どれも今回の変更に関係しない所で、base でも落ちた（負荷の揺れの見込み） |
| vitest | 新しく落ちた 0・新しく通った 0・両方で落ちた 0 | — |
| 画像の差分 | 0 / 54 | — |

- step3 の束の中でだけ落ちたローカルフォルダの2本（load-conflict-unsaved L180・save-failure-visible L149 のローカル）は、この全件比較では base・work とも通っていた。

#### 新しく落ちた1本の原因と直し

- 原因：この spec（#391 E2E#1）は、GitHub の読込の失敗で出していた toast「手元のデータで表示中です。…」（`.toast-error .toast-message`）と、その「再試行」（`.toast-action`）を見ていた。step2 の tp の決定 (b) でこの toast をやめたので落ちた。step3 で書き換える spec を探した時の grep（`obsidian-sync-status`・`読み込みに失敗`）の語に当たらず、書き換えから漏れていた。
- 直し：tests/e2e/github-sync-resilience.spec.js の L59 のテストを、今の挙動に合わせて書き換えた。状態バーの読込の失敗の行（`#app-status-bar [data-load-failure] .status-msg`）が新しい GitHub の文と完全に一致すること、その行に「再試行」（`data-status-action="retry-load"`）があること、読込の失敗の toast が出ないことを見る。テスト名も「状態バーに「この端末の内容を表示しています」と「再試行」が出る」に変えた。手元のデータの冊数が変わらないことの確認は、そのまま残した。
- 直した後：github-sync-resilience.spec.js を `--repeat-each=2` で流し、4本すべて緑（2.9s・19:29）。`npm run lint` は 12 本中 0 本失敗。
- 同じ漏れが他に無いかの確認として、`git grep -n "手元のデータで表示中" -- tests js` を使った。直す前に当たったのはこの spec の2行だけだった。

## step4 やり直し（②の差し戻し 19:30・公開を止める条件を変更前と同じに戻す）

### 差し戻しの中身

ハブの通信の失敗で `_syncError` を立てなくなった。そのため、公開の flush の後の確認（`if (hadPending && this._syncError)`）は、ハブの読込が失敗していても公開を止めなくなっていた。文を直すイシューで、公開を止める条件が黙って緩むのは困る、というのが差し戻しの理由。ハブは変更前と同じに戻し、GitHub は変えない。

### 変更前の挙動をコードで確かめた（d18af26）

- ハブの起動の読込が通信で失敗すると、`_syncError = true` と `_syncErrorMsg` が立っていた。この印は、そのあと保存が1回成功すると `_clearSyncFailure()` で下りる（`_runPendingSync` の成功）。
- 公開の前の確認は、`flushSync()` の後に `hadPending && this._syncError` を見る。`hadPending` は、メモリの保存待ちか、localStorage の `virtualBookshelf_pendingSync === '1'`（前の回に保存できなかった印）のどちらかがあれば true。
- ずれが出る場面：前の回に保存できなかった印だけが残っていて、開き直した時に起動の読込が失敗した時。起動の読込が失敗すると、保存待ちを送るのは読めた後（`_applyLoadedState`）なので、flush は何も送らない。変更前は `_syncError` が立ったままなので公開を止めた。step3 の版は止めない。
- flush の保存が失敗する場面は、`_onSyncFailed` が `_syncError` を立てるので、変更前も step3 の版も止める（違いは無い）。

### 直したこと

- js/bookshelf.js の公開の前の確認を、`if (hadPending && (this._syncError || hubLoadFailed))` にした。`hubLoadFailed = !!this._initLoadFailed && this.syncMethod === 'hub'`。GitHub は変えていない（前から読込の失敗では止めていない）。
- ②の指定どおり「`_initLoadFailed` が立っていて、方式がハブの時」に止める。変更前は、読込の失敗の後に保存が1回成功すると `_syncError` が下りて公開できた。今の形は、読み直せるまで（`_initLoadFailed` が下りるまで）止める。その場面だけは、変更前より少しきびしい。保存が成功しても読み直しはされていないので、止める方を残した。
- index.html：`bookshelf.js` と `sync-failure.js` の `?v=` を **2026111886** にした。19:37 の origin/main（703699c）の最大値 2026111878 と、ほかの worktree の最大値 2026111878 より大きい。

### 守りの spec（tests/e2e/publish-conflict-hub.spec.js に1本足した）

- 「ハブの起動の読込が失敗している間は公開を止める (イシュー#666)」。#603 のテストと同じ道具（`bootApp`・`createArticleWithBook`・公開の書き込みの数）を使う。
  - 流れ：まとめ保存（POST /data/batch）を 500 にして本棚を足し、保存できなかった印を残す。記事を作り、開き直す。開き直した時の起動の読込（GET /data/**）は、通信の失敗にする。記事のファイル（`/publish/` の下）だけは読ませる。そのうえで「公開」を押す。
  - 見ること：公開を止めた知らせ「保存できていない変更があるため、公開を止めました。保存できてから、もう一度公開してください。」が出る。公開の書き込みが0件。
- 書いている途中の2回は、テストの作りの誤りで落ちた。1回目はサイドバーの「本棚を足す」が記事の一覧に隠れて押せなかった（#603 と同じ順に並べ替えた）。2回目は、開き直した後に記事の一覧が空だった（GET を全部落としたため。`/publish/` を通した）。
- 直す前の版（step3 の版＝この差し戻しの前の HEAD）で流した結果：**赤**（見込みどおり）。止める知らせが出なかった（`element(s) not found`）＝公開の前の確認を素通りした。tmp/666/step4b-guard-before.txt。
- 直した後：`--repeat-each=2` で2回とも緑。このファイルの全体（#603 の既存テストを含む）と、boot-load-failure-message・github-sync-resilience をあわせて流し、16本すべて緑（10.3s）。

### 載せ直し（2回目）

- 19:37 に fetch した。origin/main は 703699c（前の載せ直しの 61a91a2 から44 commit 進んでいた）。rebase でぶつかったのは、前と同じく index.html の `?v=` の行だけ（2つの commit で1回ずつ）。どちらも 2026111886 で解いた。check:version は OK。
- 61a91a2..703699c の js/bookshelf.js の差分（36行）を読んだ。今回触った所に当たる変更が1つあった。別のイシューが、起動の読込が通信で失敗した時（`_initLoadFailed` が立っている時）に「最新のデータを確認しています…」の行を下ろす処理を足していた。`_initLoadFailed` が立っているかだけを見る作りなので、今回の形（印に文と種類を持たせる）と食い違わない。
- 載せ直した後の sha：c3830e5（step1 の記録）・c3741b2（test・赤のまま）・2985878（fix・文と出す場所）・1829d88（step3 の記録）・7f6180b（test・github-sync-resilience）・8e2e405（step4 の記録）・df7bf09（fix・公開を止める確認）。
- 最後の載せ直しの後：`npm run lint` は 12 本中 0 本失敗。`npm test` は 80ファイル・1199 通過・2 todo。

### main との全件比較（2回目・`e2e-diff-main.mjs --port=8166 --out=tmp/666/e2e-diff2`・systemd-run・19:38〜19:48）

- base は origin/main 7e0f386（703699c の後に増えたのは 670-results.md の docs の commit 1件だけ）、work は作業ツリー（HEAD df7bf09）。visual は既定どおりオン。負荷は、始めた時点で load average 0.8 だった。
- 件数：base は E2E 1122 通過・592 スキップ・1 失敗。work は 1129 通過・592 スキップ・2 失敗。

| 表 | 件数 | 中身 |
|---|---|---|
| 新しく落ちた（E2E） | **1** | boot-load-checking-row.spec.js:74「GitHub: 起動の読込が通信で失敗したら、toast が出てから2秒のうちに「最新のデータを確認しています…」が消える」（流し直し3回とも落ちた） |
| 新しく通った（E2E） | 0 | — |
| 両方で落ちた（E2E） | 1 | sync-conflict-overwrite.spec.js:76（ハブの書き込み時の衝突の上書き）。base でも落ちた。今回の変更とは別の所 |
| vitest | 新しく落ちた 0・新しく通った 0・両方で落ちた 0 | — |
| 画像の差分 | 0 / 54 | — |

- 前の比較で両方で落ちた3本（duplicate-asin-notice・j3-5-many-books・list-staged-render）は、今回は両側とも通った（前回は負荷 37〜47 での揺れだった見込み）。
- 公開の前の確認の守りの spec（publish-conflict-hub.spec.js の新しい1本）は、work で通った。

#### 新しく落ちた1本の原因と直し

- 原因：boot-load-checking-row.spec.js は、1回目の載せ直しの後に main へ入った別のイシューの spec（7397d15）。GitHub の起動の読込が通信で失敗した時に、toast（`.toast-message` に 'GitHub' を含む）が出るのを待っていた。今回 (b) でこの toast をやめたので、待ちが時間切れになった。
- 直し：tests/e2e/boot-load-checking-row.spec.js の L74 のテストだけを書き換えた。待つものを、状態バーの読込の失敗の行（`#app-status-bar [data-load-failure]`）に替え、テスト名と知らせの文も合わせた。見ていること（失敗の表示から2秒のうちに「最新のデータを確認しています…」が消える）は変えていない。同じファイルの GitHub の認証切れのテスト（L106）は、今も toast を出すので `githubToast` のまま。
- 直した後：boot-load-checking-row.spec.js を `--repeat-each=2` で流し、12本すべて緑（7.8s・19:49）。`npm run lint` は 12 本中 0 本失敗。
- 全件比較は、この1本を直す前の作業ツリーで流したもの。直した後は、このファイルだけを流し直した。
