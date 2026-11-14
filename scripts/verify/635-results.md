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
