# イシュー#664 実測の記録

## §1 step1：実測（直す前の赤・2026-11-14 17:45〜17:48）

### 前提

- 基準：origin/main = **1c99d78**（#662 は未着地。`git log origin/main --grep '#662'` 0件）。
- 参考：#662 の branch `issue/662` の直しの commit **61bf0db**（ADR-166・案B）の `js/bookshelf.js` の差分（`git diff 1c99d78...issue/662 -- js/bookshelf.js`・58行）を、一時的に当てて同じ spec を流した。流した後は `git checkout -- js/bookshelf.js` で戻した（commit していない）。#662 が着地したら、step3 で着地版で測り直す。
- 決まり（設計書）：library.json は除外した本も含む全書誌（02_基本設計書.md:95「書誌の正本＝library.json」）。all.json の books と bookOrder.all は library − exclusions（06_データ仕様書.md:165・02_基本設計書.md:95/138・01_要件定義書.md:177）。この見本（3冊のうち1冊を除外）では、library.json＝3、all.json＝2、端末の控え＝2、画面の「すべての本」＝2 が決まりどおり。

### 測り方

- spec：`tests/e2e/exclude-export-all-shelf.spec.js`（新規）。フォルダ接続→3冊取込→all.json=3 を待つ→`window.bookshelf.excludeBook('B0GATEIMP3')`（確認の窓は通す）。
- 書き出しの完了は「exclusions.json に除外がある」かつ「未反映の印（`virtualBookshelf_pendingSync`）が無い」を expect.poll で待った（最大20秒）。library.json の exportDate は、本の一覧が変わらないと据え置かれる（#612）。除外では一覧が変わらないので、完了の印には使えない。
- 場面：
  - **R**：書き出しの完了を待ってから再読込（保存先を採る想定）。
  - **L**：除外の直後に、待たずに再読込（手元を採る想定）。
  - **S**：書き出しの後にもう一度保存（`saveUserData` を直接呼ぶ＝次の編集の保存の代わり）し、待たずに再読込。
  - **U**：書き出しの後に `unexcludeBook` し、もう一度書き出す。
- 再読込の後は、ツリーの冊数を 250ms ごとに16回読み、`_lastLoadDecision` を記録した。再読込の後の保存（手元を採った時の書き出し）も最大8秒待ち、フォルダ・控え・メモリをもう一度読んだ。
- 記録（1回ごと JSONL）：`scripts/verify/664-run1.jsonl`（1c99d78）・`scripts/verify/664-run2-with662fix.jsonl`（1c99d78＋61bf0db の差分）。
- chromium・`--repeat-each=3`・workers=4。run1 は1.2分、run2 は41秒。3択（`#load-conflict-dialog`/`#sync-conflict-dialog`）は、再読込した18回すべてで0回だった。

### 結果（spec：両方とも R・L・S の9本が赤、U の3本が緑）

場所ごとの「除外した本が入る／戻る」。数は冊数、分母は回数。

| 場所 | 1c99d78（基準） | ＋#662 の直し（61bf0db・参考） | 決まり |
|---|---|---|---|
| library.json | 3（除外した本を含む）9/9 | 同じ 9/9 | 3＝**決まりどおり** |
| exclusions.json | `["B0GATEIMP3"]` 9/9 | 同じ | ○ |
| **all.json の books（書き出しの後）** | **3（除外した本が残る）9/9** | **3・9/9** | 2 |
| all.json（L：再読込の後の書き出しの後） | 3・3/3 | 3・3/3 | 2 |
| **メモリの bookOrder.all（書き出しの後）** | **3（除外入り）9/9**。「すべて」本棚の books は別の配列で2 | **3（除外入り）9/9**。「すべて」本棚の books も同じ配列で**3** | 2 |
| 書き出し直後のツリーの冊数（再読込なし） | 2・9/9（戻らない） | 2・9/9。ただしメモリの books は3＝次に描き直すと3になる見込み（未実測） | 2 |
| 端末の控えの bookOrder.all（書き出しの後） | 2・9/9（書き出しの後は控えを書き直さない） | 2・9/9 | 2 |
| **端末の控えの bookOrder.all（S：書き出しの後の次の保存）** | **3（除外入り）3/3** | **3・3/3**（控えの「すべて」本棚の books も3） | 2 |
| 画面 R（保存先を採る・decision=remote 3/3） | 最後は2＝**戻らない** 3/3。起動の直後だけ一瞬3（`3>2`・控えの「すべて」本棚の books が古い3のまま＝#662 の型） | 2・3/3（一瞬の3も消えた） | 2 |
| 画面 L（手元を採る・decision=local 3/3） | **3＝戻る 3/3**（控えの「すべて」本棚の books が除外前の3のまま＝#662 の型）。再読込の後の書き出しで、メモリの bookOrder.all も3（除外入り）になる | 2・3/3。ただし再読込の後の書き出しで、メモリの bookOrder.all と books が3（除外入り）＝次に描き直すと3の見込み（未実測） | 2 |
| 画面 S（次の保存の後に手元を採る） | 2・3/3（local 2回・remote 1回）。ツリーは別の配列の books を数えるので戻らない。ただしメモリと控えの bookOrder.all は3（除外入り） | **3＝戻る 3/3**（decision=local 3/3） | 2 |
| U（取り消しの後の書き出し） | all.json 3・重複0・ツリー3・library.json 3（緑 3/3） | 同じ（緑 3/3） | 3 |

### 分かったこと

1. **all.json に除外した本が残るのは確定**（書き出しの後 9/9・両方の基準）。書き出し（`syncToObsidianFolder`）の `allBooksList` を、除外した本を含む library.json の一覧から作るため（1c99d78:3907-3912）。
2. **書き出しは、メモリの bookOrder.all も除外入りの配列に置き換える**（9/9）。この値は、次の保存（S）で端末の控えに入る（3/3）。読込で保存先を採れば、除外を引き直すので消える（R・決まり：`_applyLoadedState` の正規化 1c99d78:3624 付近）。手元を採れば残る（S）。
3. **画面に戻るかは、#662 の直しで変わる。**
   - 基準（1c99d78）：L で戻る（3/3）。原因は控えの「すべて」本棚の books が古いこと（#662 の範囲）。
   - #662 の直しの後：「すべて」本棚の books は、いつも bookOrder.all と同じ配列になる。このため 2 の汚れがそのまま画面に出て、S で戻る（3/3）。L と書き出しの直後も、メモリの books は除外入りの3（描き直せば3の見込み）。
   - **#662 が着地すると、#664 の不具合は画面に出る形になる。**
4. library.json に除外した本が入るのは決まりどおり（9/9・取り消し U は、この書誌から戻して緑 3/3）。
5. 取り消し（U）は緑。ただし、取り消しの前からメモリの bookOrder.all に除外した本が入っている。このため `unexcludeBook` の `unshift` が飛ばされ、戻した本は先頭ではなく元の位置に入る（並び順だけの違い・step2 で扱いを決める）。
6. #662 の spec の I 行は、`issue/662` の e123065 で `test.fixme('662-I 除外を取り消した直後に再読込しても…', async () => {})`（tests/e2e/manual-add-reload-all-shelf.spec.js:152）＝**中身が空の fixme**。step3 では fixme を外すだけでなく、中身を書く必要がある。

### step2 への申し送り

- 公開記事の「すべての本」（publish-article-generator.js の `_shelfBooks`）は、all.json の books をそのまま使う。上の1で all.json に除外した本が入るので、公開に出るかを §2 の冒頭で確かめる（②の指示）。
- 直し方は「書き出しで all.json と bookOrder.all に除外を入れない」の1か所で、1〜3がそろって消える見込み。古い控え・保存先の汚れは、読込の正規化（保存先）と #662 の `_ensureAllShelf`（手元）のどちらで落とすかを §2 で比べる。
