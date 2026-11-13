# イシュー#603 step1 — 保存（書き込み）失敗の画面の実測

- 実測日時: 2026-11-14 04:51〜04:52 JST（origin/main 2678256 の上・chromium・PORT=8103）
- 実測コード: `tests/e2e/save-failure-visible.spec.js`（3保存先 × 1本＝3 passed / 1.3m）
- 失敗の注入:
  - ハブ・GitHub は `tests/e2e/helpers/storage-fakes.js` の `failNextWrites(n)`。書き込みの要求を 500 にする。
  - ローカルは今回足した `installLocalWriteFailures(page)`。`createWritable` と `removeEntry` が `NoModificationAllowedError` で失敗する。`installFakeLocalFolder` の既定の動きは変えず、別の export として足した。
- 生の記録（場面ごとの JSON）: `/home/kuroko/worktrees/bookshelf/_artifacts/603-step1/603-snap-{hub,github,local}.json`
- 状態バーの「30秒ごとの見直し」の扱い: setInterval（30秒）と window の `focus` は、同じ `_updateStatusBar()` を呼ぶ（`js/bookshelf.js` の `_initStatusBar`）。そのため30秒は待たず、`focus` を送って見直させた。

## 1. 表（保存先 × 操作 × 表示の場所）

3保存先とも結果は同じだった。差は設定の同期欄に出る名前（ハブ＝「Asayake ハブ」、GitHub＝`owner/repo@branch`、ローカル＝フォルダ名）だけ。

| 場面（各保存先で同じ順に操作） | 上部の状態バー | トースト | 設定の同期欄（名前／状態の行） | `_syncError` | 保存先の中身 |
|---|---|---|---|---|---|
| 1a 通常の保存（本棚の改名）が1回失敗した直後 | **出ない**（hidden） | **出ない** | 「〈名前〉（要再接続）」／「「フォルダを選ぶ」を押してフォルダを選び直してください」 | false | 改名は届いていない |
| 1b 状態バーを見直した後 | **出ない** | 出ない | 同上 | false | 同上 |
| 2 次の操作の保存が成功した後 | 出ない | 出ない | 「〈名前〉」／「〈時刻〉 同期済み（「フォルダを選ぶ」で再読み込み）」 | false | 2回分とも届く |
| 3a 本棚の削除の保存が1回失敗した直後 | **出ない** | **出ない** | 「（要再接続）」＋上と同じ案内 | false | 本棚ファイルが残る |
| 3b 状態バーを見直した後 | **出ない** | 出ない | 同上 | false | 同上 |
| 4 失敗が続く（n=100・2回操作した後） | **出ない** | **出ない** | 同上 | false | 2回とも届いていない（失敗の注入は 100→98＝1操作で1要求） |
| 5 保存先が直った後、何も操作せず8秒待った | 出ない | 出ない | 「（要再接続）」のまま | false | **届かないまま**（自動の再試行は無い） |
| 6 次の操作の保存が成功した後 | 出ない | 出ない | 「同期済み」に戻る | false | 溜まっていた改名・削除がまとめて届く（削除の保存待ちは #587 の仕組み） |

補足：
- 未保存の印（localStorage の `virtualBookshelf_pendingSync`）は、失敗している間 `'1'` のまま残り、成功すると消える。データには「保存できていない」状態が残っているのに、画面には出ていない。
- 利用者が気づける手がかりは、設定の同期欄だけ。設定を開かない限り、保存できていないことは見えない。
- ローカルで初めてフォルダをつないだ時のトースト（「…に新ファイル構造で初期化しました。」）は失敗とは関係がない。

## 2. 原因（実測とコードで確かめた）

**(a) 確定。** `syncToObsidianFolder()` の外側の catch（`js/bookshelf.js:3684-3696`）が、例外を投げ直さない。
- 実測では、12回の失敗（3保存先 × 4回）すべてが、この catch の `console.error('同期エラー:', e)`（3685）で記録された。
- 状態バーを出す `_runPendingSync()` の catch（2870-2888）にある `console.error('Obsidian同期エラー:', e)`（2871）は、0回だった。
- そのうえ `_runPendingSync()` は、例外が来ないので成功とみなす。2869 の「保存成功 → 同期エラー解消」で `_syncError` を消している（実測でも全場面で `_syncError=false`）。
- 状態バーには `_syncError` の時の行（`_updateStatusBar` 4691-4694・「確認」ボタン付き）がすでにある。ただ、そこへ届く経路が無い。
- 実際のエラー:
  - ハブ: `Hub API error (POST data/batch): 500 …`（`HubStorageAdapter._err`）
  - GitHub: `update ref main: 500 …`（`GitHubAdapter.commitBatch`）
  - ローカル: `NoModificationAllowedError`

**(b) コードで確定**（(a) の実測から導いた。画面からはまだ通していない）。次の2つの経路も、通常の保存失敗では動かない。
- 公開前のガード（5338 `if (hadPending && this._syncError)`）: 保存が失敗しても `_syncError` は false のまま（実測）なので、ガードは働かない。未保存の変更が保存先に届いていないまま、保存先の古い内容で公開が進む。
- GitHub 401 の再試行（`_syncWithAuthRetry` 3046-3059）: `e instanceof GitHubAuthError` を受け取る前提だが、(a) の catch が先に飲む。そのため、トークンを更新して1回再試行する処理は動かない。期限が近いトークンを前もって更新する処理（3495 `_ensureFreshGitHubToken()`）は、この経路の外にあるので動く。
- step3 の E2E で、この2つも画面の経路から確かめる。

**(c) 確定（実測）。** 設定の同期欄の案内は、保存先を問わずローカル向けの文言になっている（3784-3789）。
- 失敗時: ハブ・GitHub でも「（要再接続）」「「フォルダを選ぶ」を押してフォルダを選び直してください」と出る。ハブ・GitHub には「フォルダを選ぶ」ボタンが無い。
- 成功時: 「同期済み（「フォルダを選ぶ」で再読み込み）」も3保存先で同じ文言だった。成功時の文言も同じ種類のずれ。
- 時刻は `toLocaleTimeString()` が言語の指定なしで出す。実測では英語の表記（`4:51:35 AM`）になった。E2E のブラウザ言語が en-US だったためで、日本語の環境では日本語になる見込み（未確認）。

**(d) コードだけで確認（未実測）。** ローカルで権限を失うと、3504-3507 で `obsidianDirHandle=null`・`updateSyncStatus('disconnected')` にして黙って戻る（例外も `_syncError` も出さない）。
- その後の状態バーは `_isSyncReady()` が false の時の行、つまり「保存先が未設定です。今はこの端末の中だけに保存されています。」（4686-4690）になる見込み。#587 の再読み込みの E2E（shelf-file-delete.spec.js の「保存先が未設定」）で同じ文言が出ている。
- 保存先は設定済みで、権限が切れただけなので、文言がずれる。
- この経路（3499-3510）は #602 も触る（②の申し送り）。step2 で #602 の差分を取り直して扱いを決める。

**(e) 確定（実測）。** 自動の再試行は無い。
- 保存先が直っても、操作しなければ届かないまま（場面5）。
- `_runPendingSync()` の finally（2889-2898）が再実行するのは、実行中に積まれた分だけ。
- `OnlineWatcher` はどこからも呼ばれていない（`js/ui/online-watcher.js:8`）。
- アダプタの側でも、500 の再試行はしていない（失敗の注入が1操作で1要求ずつ減った）。ハブのアダプタの再試行（`hub-adapter.js:298-339`）は、412 の衝突を解く時だけのもの。

## 3. step2 へ渡すこと

- 直す場所は1か所に寄せられる。(a) の握りつぶしを直せば、既存の `_syncError` → 状態バーの仕組みがそのまま使える。
- ただし、直すと (b) の2つの経路も同時に動き出す。公開が止まる場面と、GitHub が再試行する場面。②の申し送り3に沿って、変わる場面を「どの操作で・何が出る／止まるか」で列挙する。
- 設定の同期欄（(c)）は、失敗時も成功時も保存先別の文言にする必要がある。
- 自動の再試行（(e)）を入れるかは、#600 の再試行と層を1つに決めて書く（②の申し送り4）。

## 4. 回し方

```bash
cd /home/kuroko/worktrees/bookshelf/issue-603
PATH=/home/sei/.nvm/versions/node/v24.18.0/bin:$PATH PORT=8103 PLAYWRIGHT_BASE_URL=http://localhost:8103 \
  npx playwright test tests/e2e/save-failure-visible.spec.js --project=chromium --workers=3 --reporter=line
# 場面ごとの記録は /tmp/603-snap-{hub,github,local}.json に書かれ、テスト結果にも添付される
```
