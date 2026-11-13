# イシュー#616 step1 原因の確定（2026-11-14）

対象: 2台で本当に衝突した時、3択も知らせも出ず片方の変更が保存先に入らない（#588 B3・J6-4）。
土台: origin/main 639230e（step1 の開始時に rebase した）。行番号はこの版のもの。

## 結論

| 保存先 | 起きていること | 原因 |
|---|---|---|
| ハブ | 端末Bの保存が `HubRemoteChangedError` で止まり、3択も知らせも出ない。Bの変更はハブに入らない（Aの変更は残る） | `js/bookshelf.js:3672` の内側の catch が `GitHubConflictError`・`HubConflictError` しか 3択（`_handleSyncConflict`）に回さない。`HubRemoteChangedError` は外側の catch（3684-3697）に落ち、`console.error` と同期欄の更新だけで握りつぶされる |
| GitHub | **Aの変更が消える**。古い版のBの保存がそのまま通り、リポジトリの notes.json がBの版で上書きされる。Bには「同期済み」と出て、3択も知らせも出ない | まとめ保存（`js/github-adapter.js` commitBatch）は最新の head を土台にして（L323）書くだけで、Bが読んだ時の版（`_shaCache`）と照らし合わせない。ref の楽観ロック（L386-387 の 422）は「まとめ保存の途中に他が書いた」場合しか見ない。さらに書いた後に `_shaCache.clear()`（L392）するので、照合しようにも2回目以降は手がかりが無い |

依頼文の「GitHubRemoteChangedError も同じ扱いになっている見込み」は外れていた。GitHub のまとめ保存はこの例外を投げない（投げるのは1ファイルずつの PUT `L612-615` だけ）。実際はもっと重く、相手の変更が消える。

## 実測

すべて chromium、`PORT=8116 PLAYWRIGHT_BASE_URL=http://localhost:8116`。

1. 赤の再現（`git checkout gate-red-588 -- tests/e2e/gate/j6-4-sync-conflict.spec.js`）
   - `playwright test tests/e2e/gate/j6-4-sync-conflict.spec.js --project=chromium --repeat-each=3` → **3 failed（3/3 赤）**。3回とも同じ所（spec:63）で止まった。`expect(conflictDialog(other)).toBeVisible({ timeout: 20000 })` が20秒待っても出ない。ログ: `/home/kuroko/worktrees/bookshelf/_artifacts/616/j6-4-red.log`
2. 実測用の spec（`/home/kuroko/worktrees/bookshelf/_artifacts/616/zz-probe-616.spec.js`）。j6-4 と同じ筋でハブ/GitHub を流し、Bの保存の15秒後に状態を読んだ。2 passed（記録用）。ログ: `/home/kuroko/worktrees/bookshelf/_artifacts/616/probe.log`

| | 3択 | Bの短文メモが保存先に入った | Aの短文メモが保存先に残った | Bの pendingSync | Bの同期欄 |
|---|---|---|---|---|---|
| ハブ | 出ない | 入らない | 残った | `'1'` | 「「フォルダを選ぶ」を押してフォルダを選び直してください」（ハブなのにフォルダ向けの案内） |
| GitHub | 出ない | 入った | **消えた** | `null` | 「同期済み（「フォルダを選ぶ」で再読み込み）」 |

端末Bの console（ハブ）:
```
[HubStorageAdapter] batch 412 on private/library.json: etag を破棄して最新状態を取り直します
[HubStorageAdapter] private/library.json はリモートで内容が変わっている。上書きせず中断します
同期エラー: HubRemoteChangedError: private/library.json は他の場所で更新されています。…
```
GitHub では衝突にかかわる console は1行も出なかった（404 の読み込み失敗だけ）。

観測（step2 で確かめる）: ハブの衝突は notes.json より先に **library.json** で見つかった。Aは短文メモしか書いていないのに、Aの保存で library.json の中身も変わっている。まとめ保存は毎回全部のファイルを送る（#612 の論点）。このため、変えていないファイルでも衝突が出うる。中身が本当に違うのか（更新時刻など）、書き方の違いだけなのかは step2 で見る。書き方の違いだけなら、2台を交互に使うだけで3択が出すぎる恐れがある。

## #603 との関係

- `git log origin/main --grep='Issue: #603'` は0件で、main にはまだ入っていない（ブランチ issue/603 の b6edfb4 だけ）。
- b6edfb4 が変えるのは外側の catch（「状態を出して throw e」）、`_runPendingSync`（`_onSyncFailed`・`_clearSyncFailure`）、`js/sync-failure.js` の3つ。内側の振り分け（3670-3677）は変えていない。classify には Conflict/RemoteChanged の分類が無い。このため #603 の上でも `HubRemoteChangedError` は 'write' か 'network' の再試行扱い（5秒→15秒→45秒）になり、尽きたら警告が出るだけで、3択は出ない（読んで確認・実測は未）。
- 直す場所は内側の catch なので、#603 の外側の catch とは文字の上ではぶつかりにくい。意味の上では次の2つを守る。
  - 衝突を3択に回して `return` した時、#603 の `_clearSyncFailure()` が呼ばれても困らない形にする。
  - 衝突の例外を #603 の自動再試行に乗せない。

## 横展開（`git grep -n -E 'ConflictError|RemoteChangedError' -- js/`）

投げる所:

| 経路 | 例外 | 場所 |
|---|---|---|
| ハブのまとめ保存 | HubConflictError（詳細なし・再送後も412） | hub-adapter.js:295・337 |
| ハブのまとめ保存 | **HubRemoteChangedError**（中身が実際に違う） | hub-adapter.js:330 |
| ハブの1ファイル保存 | HubConflictError → recoverFromConflict → HubRemoteChangedError | hub-adapter.js:424・461-463・469 |
| GitHub のまとめ保存 | GitHubConflictError（まとめ保存の途中の 422 だけ）／**古い版の検出なし** | github-adapter.js:387（L323 で最新 head を土台にする） |
| GitHub の1ファイル保存 | GitHubConflictError → recoverFromConflict → GitHubRemoteChangedError | github-adapter.js:515・541・612-615・623 |
| 共通の回復 | makeRemoteChangedError を投げる | storage-adapter.js:214-223 |

受ける所:

| 経路 | いまの扱い | 直すか |
|---|---|---|
| 同期（まとめ保存）bookshelf.js:3670-3677 | Conflict の2つだけ3択へ。RemoteChanged の2つは外側の catch で握りつぶし | **直す**（本件） |
| 公開 exporter.js:191-194 | GitHubConflictError だけ「公開中に公開 repo が更新されました」に変える。この経路の保存先は `new GitHubAdapter`（exporter.js:143）だけ | 判定を共通のものに置き換える（ハブで公開しても同じ判定になる）。公開の出力は生成物なので3択にはしない。文言は今のまま |
| 記事の保存 screens/article-editor.js:3019 | RemoteChanged の2つに専用の文言（#142・#381） | 判定を共通のものに置き換えるだけ（挙動は変えない） |

## 端末内の変更が消えないか（(C) の実測と読み）

- origin/main で衝突した後は `_lastSyncOk` が false のまま（3496 で false にし、成功の 3681 まで進まない）。このため `_runPendingSync` の finally（2892-2896）は pendingSync を消さない（ハブの実測で `'1'`）。
- 起動時に pendingSync が `'1'` だと、短文メモは**端末内の版をまるごと優先**する（3369-3370 `notes[asin] = n`）。そのあと読み込み直後の新しい ETag で再送する（3432-3434 `_scheduleSync()`）。
  - その結果、Bが「再読込して最新版を取得」を選んでも、開き直すとBの短文メモが勝つ。Aの短文メモは**知らせも無く上書きされて消える**。j6-4 の最後の確認（BにAの短文メモが見える）も、この経路で落ちる見込み。
  - 「何もしない」を選んで閉じ、開き直した時も同じで、Aの変更が黙って消える。
- 一方で #603 の後は、衝突を3択に回して `return` すると成功と同じ扱いになる。そのため条件によっては pendingSync が消え、開き直すと今度はBの変更が黙って消える。
- まとめると、pendingSync を「残す」だけでも「消す」だけでも、どちらかの変更が消える。

## ②への確認（承認時の方針 A・B・C に対する実測の結果）

- **(A) 判定の置き場**: 方針どおり、`js/storage-adapter.js` に共通の判定を1つ置く（例: `StorageAdapter.isRemoteConflict(err)`。4つの名前を見る）。同期・公開・記事の保存の3か所から使う。覆す根拠は無かった。
- **(B) GitHub**: 上書きは**実測で確定した**（Aの短文メモがリポジトリから消えた）。方針どおり、このイシューの中で直す。直し方の案:
  1. commitBatch で土台の tree（再帰の GET。模擬にもある）から、put するパスの sha を引く。
  2. 自分が最後に知っている sha と違うパスだけ、最新の中身を取る。
  3. ハブ（hub-adapter.js:300-330）と同じ3通りで判定する。望む中身と同じなら送らない。自分が知っている中身と同じならそのまま進む。どちらでもなければ `GitHubRemoteChangedError`。
  4. 書いた後は `_shaCache.clear()` をやめ、作った blob の sha と中身で覚え直す。

  変えるのは github-adapter.js の50行前後、単体テスト、門のE2E 1本。1イシューに収まる見込みで、分ける提案はしない。
- **(C) pendingSync**: 方針の「消さない」だけでは、上の読みどおり開き直した時にAの変更が黙って消える。そこで「衝突中」の印を足す案を推奨する。
  - 衝突を見つけたら、pendingSync を残し、さらに端末内に「衝突中」の印（例: localStorage `virtualBookshelf_syncConflict`）を残す。
  - 「再読込して最新版を取得」: 書き出しの機会は先に出しているので、印と pendingSync を消してから再読込する。保存先の最新版が見える（j6-4 の最後の確認と合う）。
  - 「何もしない」: 印も pendingSync も残す。開き直した時、印があれば「端末内を優先して再送」を止め、端末内の版のまま3択を出し直す（書き出しの機会が残り、Aの変更も上書きしない）。
  - 「書き出す」: 今のまま（書き出して3択に戻る）。

  この形で進めてよいか確認したい。3択の文言と並び（3699-3712 の既存の約束）は変えない。

## step2 への申し送り

- node は PATH に無い。`env PATH=/home/sei/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/usr/bin:/bin` を付けて `node_modules/.bin/playwright` を呼ぶ。
- 実測用の spec は `/home/kuroko/worktrees/bookshelf/_artifacts/616/zz-probe-616.spec.js`（tests/ からは外した）。GitHub の門のE2E の下書きに使える。
- 赤の spec `tests/e2e/gate/j6-4-sync-conflict.spec.js` は worktree に stage 済み（未 commit）。

## step3 の実測: 2台が別々の本の短文メモを交互に保存した時（②の依頼・2026-11-14）

実測用の spec `/home/kuroko/worktrees/bookshelf/_artifacts/616/zz-probe-616c.spec.js` を chromium で流した（ログは同じ場所の `probe-c.log`）。
手順は3つ。端末Bを先に開いておき、Aが本1に書いて保存先に届ける。Bは読み直さずに本2に書く。そのあとAがもう一度本1に書く。

| 保存先 | Bが本2に書いた時（Aが先に保存していた） | Aがもう一度本1に書いた時 |
|---|---|---|
| ハブ | 3択が出た。Bの短文メモは保存先に入らず、Aの短文メモは残った | 3択は出ず、保存された |
| GitHub | 3択が出た。Bの短文メモは保存先に入らず、Aの短文メモは残った | 3択は出ず、保存された |

- 結論: **別々の本でも、相手が先に保存していれば、読み直していない側が次に保存した時に必ず3択が出る**。notes.json などを1ファイルまるごと送っているため、ファイルの中の別の項目の変更でも衝突になる。step1 で見た library.json での衝突も同じ理由。
- 直す前は、ハブでは知らせが出ないまま保存されず、GitHub では知らせが出ないまま相手の変更を消していた。3択が出るのは、消えることへの正しい防波堤ではある。ただし2台を交互に使う人には出すぎる。
- このイシューでは直さない（②の決定どおり）。対策は #612 の範囲になる。考えられるのは次の2つ。
  - 変わっていないファイルを送らない。
  - 項目ごとに合わせる（notes.json を本ごとに、相手の版と自分の版を合わせて書く）。

