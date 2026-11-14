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

## §2 step2：決まりとの照合・横展開・直し方（2026-11-14 17:50〜17:58）

- 基準：origin/main = **f9468f8**（1c99d78 の後に入ったのは #622 の test/docs の3 commit だけ。`git diff --stat 1c99d78..f9468f8 -- js index.html` は空）。行番号は f9468f8＝1c99d78 と同じ。
- #662 の直しは `issue/662` の 61bf0db（ADR-166・08_意思決定記録.md:2219-）。17:52 の時点で origin/main には無い。

### 2-0 読む人に見えるか（公開記事）※②の指示で別立て

1. **all.json の books が、そのまま公開に出る経路は無い（0件）。**
   - `_shelfBooks`（js/publish-article-generator.js:482-489）は、どこからも呼ばれていない。`git grep -n _shelfBooks origin/main -- js tests` は、定義の1件だけ。
   - 本棚ブロックは、記事に保存した置き場所（`block.items` の ASIN）を `_resolveBookData` で解決する（同:509-516・463）。all.json の books は読まない。
   - 記事エディタのプレビューの状態（js/screens/article-editor.js:3617-3627）も、all.json の代わりに「すべて」本棚の books を入れるだけ。`_shelfBooks` が呼ばれないので使われない。
2. **間接の経路は1本ある（コードを読んでの見立て・未実測）。**
   - 記事の本の引き出し（`_artRenderDrawer`・article-editor.js:2863-）は、選んだ本棚の `shelf.books` を並べる（+11行）。蔵書（`this.books`＝除外を引いた本）に無い ASIN は、`{ asin, title: asin }` の仮の行で出す（+40行）。
   - #662 の直しの後は、書き出しのたびに「すべて」本棚の books が除外入りになる（§1 run2・9/9）。このため、**除外した本が ASIN の題で引き出しに出る**見込み。
   - 引き出しの絞り込み（`_artDrawerFilteredAsins`）は、検索語が無ければ `shelf.books` をそのまま返す。蔵書に無い ASIN も落とさない。上の「表示中のN冊を追加」ボタン（`addAllBtn`・同 +23〜+26行）は、この一覧を全部記事へ入れる。つまり、**1回押すだけで除外した本も記事に入る**（コードで確認・E2E は未実測）。
   - 利用者がそれを記事に置くと、公開（exporter.js:109 の `build`。`opts.state` を渡さない＝保存先の library.json を読む）で、`libMap` が除外した本の書誌を解決する（library.json は除外した本も含む）。つまり、**題・表紙つきで公開に出る**見込み。利用者が置く操作（1つずつ、または「表示中のN冊を追加」）が要る。
   - 直し方 A で「すべて」本棚の books から除外が消えれば、この経路も閉じる。step3 の E2E に「書き出しの後、引き出しに除外した本が出ない」を1行足す。
3. **別件（この直しの範囲外・②の判断が要る）**：除外する前から記事に置いてあった本は、除外した後も公開に出る。
   - `libMap` は、除外を含む library.json から作る（publish-article-generator.js:938）。all.json とは関係がない。
   - 除外が記事に効くべきかの決まりは、設計書に無い。01_要件定義書.md:75 F-03-6・02_基本設計書.md:138・06_データ仕様書.md:83（D-7）が決めているのは、ALL・新規取込・⌘K だけ。
   - 起票するかは②に任せる。

### 2-1 決まりの出典と判定

設計書（obsidian 80帯 bookshelf/）の決まり：

- 01_要件定義書.md:177「ALL＝library − exclusions」・:75 F-03-6・:182
- 02_基本設計書.md:95「書誌の正本＝library.json。ALL 本棚の books[]＝library − exclusions」・:138
- 06_データ仕様書.md:83「ALL と新規取込から除外 (D-7)」・:165「all.json の books＝library − exclusions。カスタム順の正本は bookOrder.all で、同期時にここへ書かれる (D-4)」・:503「library.json ──(− exclusions)──→ all.json の books[]」
- 08_意思決定記録.md:66「ALL は bookOrder.all が正本」・ADR-166（books と bookOrder.all は同じ配列）
- 除外を主題にした ADR は 08 に無い（03・06・07・08 を「除外」「exclusion」「bookOrder.all」で grep した）。03 は、メソッドの表（:98・:163・:164・:195）に除外の扱いを書いているだけ。

| 項目 | 実測（§1） | 決まり | 判定 |
|---|---|---|---|
| library.json に除外した本の書誌が入る | 9/9 | 02:95「書誌の正本＝library.json」。06:503 は library.json から exclusions を引いて all.json を作る形＝library.json は除外を含む前提。ADR-156 決まり(1)（08:2002「一覧にある本（除外中を含む）」） | **直さない**。除外の取り消し（`unexcludeBook`・1c99d78:5859-）が、この書誌から本を戻す（U 3/3 緑）。依頼文の「library.json に戻る」は決まりどおり |
| all.json の books に除外した本が入る | 9/9 | 06:165・06:503・02:95・01:177 | **直す** |
| bookOrder.all（メモリ・端末の控え）に除外した本が入る | 書き出しの後 9/9・次の保存で控えへ 3/3 | 06:165（all.json に書かれる bookOrder.all も library − exclusions）・08:66 | **直す** |
| 正本 | － | 並び＝bookOrder.all（08:66・06:165）、除外＝exclusions.json（06:77-83）、書誌＝library.json（02:95）。「すべて」本棚の books は bookOrder.all と同じ配列（ADR-166） | 変えない |

### 2-2 横展開（全数 grep・f9468f8）

bookOrder.all と「すべて」本棚の books を**書く所**：

`git grep -n "bookOrder\.all\s*=\|bookOrder = {}\|allShelf\.books\s*=\|shelf\.books = \|bookOrder\[shelf\.id\] =" origin/main -- js` の全件と、足す所（unshift）。

| 場所 | 何をするか | 除外の扱い |
|---|---|---|
| bookshelf.js:3907-3912 書き出し（`syncToObsidianFolder`） | `allBooksList` を、除外を含む `libraryAsins` から作り、bookOrder.all を置き換える | **×（原因・唯一の違反）** |
| bookshelf.js:3620-3628・3646-3649 読込（`_applyLoadedState`） | all を library − exclusions に正規化し、bookOrder[id] と同じ配列にする | ○ |
| bookshelf.js:3670-3680 読込の手元の並び | 所属は保存先（正規化済み）、順序だけ手元 | ○ |
| bookshelf.js:4266-4271 `_onLibraryChanged`（#662 で `_ensureAllShelf` へ移る） | books を bookOrder.all と同じ配列にする | △ 汚れはそのまま写る |
| bookshelf.js:4282-4290 `_ensureAllShelf`（#662 の後は呼ばれるたびに揃える） | 無ければ作る・books＝bookOrder.all | △ 同上 |
| bookshelf.js:5823 `_excludeAsinCore` | bookOrder.all から除く | ○ |
| bookshelf.js:5873-5878 `unexcludeBook` | 無ければ先頭へ | ○。ただし汚れがあると先頭へ行かない（§1 U） |
| bookshelf.js:6604・6619 `deleteBook` | 除く | ○ |
| bookshelf.js:7112-7115 手動追加 | 先頭へ | ○（除外中の ASIN を手で足した時の扱いは未確認・範囲外） |
| js/screens/import.js:239-245 取込 | 新しく取り込んだ本（`results.imported`）を先頭へ | ○（除外した本は取込で戻さない＝06:83 D-7・ADR-069。`importSelectedBooks` の判定は未確認） |
| bookshelf.js:1598-1606 選んだ本を先頭へ | `bookOrder[key]` を、今の並びから作り直す | △ 汚れた並びなら、除外した本もそのまま並べ直す |
| bookshelf.js:2701-2702 ドラッグの並べ替え | `shelf.books` と `bookOrder[id]` を**別のコピー**にする | 除外とは無関係。ただし ADR-166 の「同じ配列」と食い違う。#662 の `_ensureAllShelf` が次に呼ばれた時に揃う。#662 側で確認済みかは未確認 |
| 起動時の控えの読込・`_keepLocalOverLoaded` | 手元を丸ごと採る | △ 控えの汚れは残る（§1 S） |

all.json の books・「すべて」本棚の books を**読む所**：

| 場所 | 使い方 | 除外が入っている時 |
|---|---|---|
| publish-article-generator.js:482-489 `_shelfBooks` | all.json の books をそのまま返す | 呼び出し0件＝影響なし（2-0） |
| article-editor.js:2863- `_artRenderDrawer` | 「すべて」本棚の books を引き出しに並べる | ASIN の題の仮の行で出る見込み（2-0） |
| article-editor.js:3617-3627 プレビューの状態 | `allBookshelf.books`＝「すべて」本棚の books | 読む所が無い（`_shelfBooks` 経由のみ） |
| js/screens/bookshelf-list.js:56 ツリーの冊数 | `bs.books.length` | 除外を数える（§1 run2 S 3/3） |
| storage.js:188・289 空の初期化 / :356 `loadAll` | 空の all.json を書く / 読んで `_applyLoadedState` へ | 読込で正規化される |

→ 決まりを破って書くのは、**書き出しの1か所だけ**。ほかの書き手は守っていて、読込の正規化がこの1か所の汚れを隠していた。#662 で books と bookOrder.all が同じ配列になり、隠れなくなった（§1）。

### 2-3 直し方の案（推奨＝A）

**A（推奨）書き出しで除外を外す・1か所**（bookshelf.js の `syncToObsidianFolder`・`allBooksList`）

```js
// exclusionsSet は同じ関数の上で既に作っている (1c99d78:3832)
const visibleAsins = libraryBooks.map(b => b.asin).filter(a => !exclusionsSet.has(a));
const visibleSet = new Set(visibleAsins);
const orderedSet = new Set(orderedAll);
const allBooksList = [
    ...orderedAll.filter(a => visibleSet.has(a)),
    ...visibleAsins.filter(a => !orderedSet.has(a))
];
this.userData.bookOrder.all = allBooksList;   // ここは今のまま (この後の _ensureAllShelf が books を同じ配列にする・ADR-166)
```

- 効く範囲：all.json（§1-1）・メモリの bookOrder.all（§1-2）・次の保存の控え（§1 S）・#662 の後の画面と引き出し（§1-3・2-0 の2）・取り消しの並び（§1-5。汚れが無くなるので、戻した本が先頭に来る）。
- library.json は今のまま（除外を含む全書誌）。今の `orderedAll.filter(a => libraryAsins.includes(a))` は、冊数の2乗の手間がかかる。Set にすると1回で済む。
- 弱い点：既に汚れた控えを持つ端末は、起動してから最初の書き出しまでの間だけ、除外した本を数える。書き出しは毎回 bookOrder.all を作り直すので、最初の書き出しで消える。保存先を採る起動なら、読込の正規化で起動の時点で消える。

**B　A＋`_ensureAllShelf` でも除外を落とす**（既に汚れた控えも、起動の直後に直る）

#662 の「books と bookOrder.all を同じ配列に保つ」前提を壊さないように、配列を置き換えず、中身だけ詰め直す：

```js
// _ensureAllShelf 内・#662 の `if (shelf) shelf.books = ud.bookOrder.all;` の前
const ex = new Set((ud._storage && ud._storage.exclusions) || []);
if (ex.size && ud.bookOrder.all.some(a => ex.has(a))) {
    const kept = ud.bookOrder.all.filter(a => !ex.has(a));
    ud.bookOrder.all.length = 0;          // 同じ配列のまま中身だけ入れ替える (参照を持つ側も同じ中身を見る)
    ud.bookOrder.all.push(...kept);
}
```

- 良い点：起動の直後の汚れも消える。
- 弱い点：
  - 除外の決まりを2か所（書き出しと `_ensureAllShelf`）に書くことになる。
  - `_ensureAllShelf` は保存と描き直しのたびに呼ばれ、そのたびに走査する（913冊なら軽い）。
  - 汚れた控えが残るのは、bookshelf が未公開の今、すでに除外して書き出した端末だけ。**ADR-006**（未公開のため既存データの互換は考えず、移行を書かない）にも当たる。
- → **採らない**（A だけで足りる）。

**C　読む側で引く**（ツリーの冊数・引き出し・`_shelfBooks`）

- 読む所が4か所以上あり、新しい読み手を足すたびに漏れる。ノートの「個別の症状をすぐ直さない」にも反する。
- → **採らない**。

**移行**：不要。
- 保存先にすでに書かれた除外入りの all.json は、読込で正規化され（1c99d78:3620-3628）、次の書き出しで書き直される。
- 端末の控えも、最初の書き出しで書き直される。
- ADR-006 にも当たる。

### 2-4 ADR の追記案（step4 で 08 へ・番号は書く時の次の番号）

> ### ADR-xxx 書き出しは all.json の books と bookOrder.all に除外した本を入れない。library.json は除外を含む全書誌のまま（2026-11-14・イシュー#664）
> - **背景**：書き出し（`syncToObsidianFolder`）が、all.json の books と `bookOrder.all` を、除外した本を含む library.json の一覧から作っていた。読込で保存先を採る時の正規化が、これを隠していた。ADR-166（books と bookOrder.all を同じ配列にする）の後は、除外した本が「すべての本」の冊数と引き出しに出るようになった（#664 の実測：手元を採る再読込で 3/3）。
> - **決定**：書き出しでも 06 の「all.json の books＝library − exclusions」を守る。`bookOrder.all` も同じ（除外は入れない）。正本は、並び＝`bookOrder.all`、除外＝exclusions.json、書誌＝library.json（除外を含む・取り消しで戻すため）。
> - **採らなかった案**：起動時の片付け（`_ensureAllShelf` でも除外を落とす）は、移行に当たる（ADR-006）ので採らない。読む側で引く案は、読み手が増えると漏れるので採らない。
> - **教訓**：決まりを守る書き手のうち1か所だけが外れていても、読込の正規化があると表に出ない。直す時は、書き手を全数 grep して違反を探す。

### 2-5 step3 でやること（承認されたら・#662 の着地後）

1. origin/main に #662 が入ったかを、題で確かめる（`--grep 'Issue: #662'`）。入っていれば rebase し、A を入れる。?v= を上げる。
2. spec の期待を決まりどおりにし、行を足す：
   - #664 の spec の R・L・S・U を緑にする（all.json＝2・控え＝2・画面＝2・U で先頭に3）。
   - 書き出しの後に描き直した時の冊数を1行。
   - 書き出しの後、引き出しに除外した本が出ないことを1行。
3. #662 の spec の I 行（`test.fixme(..., async () => {})`＝中身が空）に中身を書いて、fixme を外す。
4. 関係する spec を `--repeat-each=3` で流す。

## §3 step3：実装と検証（2026-11-14 18:36〜18:43）

### 前提

- #662 の着地を題で確かめた（`git log origin/main --grep 'Issue: #662'`：77c86ae・2f4d112・5a344c6・2efb45c・6b22a9e）。
- rebase の基準は origin/main = **2946a43**。衝突は無かった。18:42 の時点で origin/main は 2072774 へ進んでいる。push の前（step5）にもう一度 rebase する。
- 着地版の `_ensureAllShelf`（5a344c6・ADR-166 追補）は、蔵書（`bookManager.library.books`＝除外を引いた本）にあって bookOrder.all に無い本を末尾に足す。除外した本は足さない。案A とぶつからない。

### 直したこと（案A・承認どおり）

- `js/bookshelf.js` の `syncToObsidianFolder`：`allBooksList` を、除外を引いた ASIN（`visibleAsins`＝library.json の ASIN から `exclusionsSet` を引いたもの）から作る。
  - all.json の books と、置き換える `bookOrder.all` に、除外した本が入らない。
  - library.json は今のまま（除外を含む全書誌）。
  - `includes` の2乗の走査を Set にした。
- `index.html`：`js/bookshelf.js?v=2026111783`（origin/main の最大 2026111782 より新しい）。

### テスト

- `tests/e2e/exclude-export-all-shelf.spec.js`
  - R・L・S・U は期待を変えずに緑になった。
  - 行を足した：
    - R・S・U の書き出しの後に、ツリーを描き直した冊数と、メモリの「すべて」本棚の books を見る。
    - **D**：引き出しに除外した本が出ない。`.art-drawer-item` が2件で、除外した本は0件。
    - **K**：古い控えで起動する（②の追加の指示）。
  - lint:internal-refs が上限（82）を1件超えたので、読込の決め方（`_lastLoadDecision`）を読むのをやめた。K は「3択が出ない」と、起動の直後の冊数の記録で確かめる。
- `tests/e2e/manual-add-reload-all-shelf.spec.js`（#662）
  - **I 行**：中身を書き、fixme を外した。除外の保存がフォルダに届く（all.json＝2）のを待ってから取り消し、待たずに再読込する。「すべての本」・控え・フォルダが3であること。
  - **H 行**：フォルダの all.json＝2 も見るようにした。前は、除外した本が残るので見ていなかった。
- 単体（vitest）は足していない。`syncToObsidianFolder` と bookOrder.all を単体で試す土台が無い（tests/unit に該当0件）。経路を通す E2E（上の D・K を含む）で確かめた。

### 結果（chromium・`--repeat-each=3`・workers=4）

| 流したもの | 結果 |
|---|---|
| #664 の spec（R・L・S・U・D・K）＋#662 の spec（E・G・H・I・J・D・K・HUB・GH） | **45 passed**（1.0分・最終の spec。記録は `664-run4-final.jsonl`）。`_lastLoadDecision` を読むのをやめる前にも 45 passed（1.1分・`664-run3-fixed.jsonl`） |
| library-count-refresh・kindle-reimport-merge・first-run-drawer-before-first-save（#636） | **24 passed**（12.5秒） |
| vitest（npm test 相当） | 79 ファイル・**1185 passed**・2 todo・失敗0 |
| lint（`scripts/run-lint.mjs`） | 1回目は12本中1本失敗（lint:internal-refs 83/82）→ 直して lint:internal-refs は OK。12本全部の流し直しは step4 で行う |

場所ごとの値（`664-run4-final.jsonl`・各3回）：

| 場所 | 直す前（§1・1c99d78） | 直した後 |
|---|---|---|
| library.json | 3（除外した本を含む） | 3（変わらない・決まりどおり） |
| all.json の books（書き出しの後） | 3（除外した本が残る）9/9 | **2** 9/9（R・S・U） |
| メモリの bookOrder.all（書き出しの後） | 3（除外入り）9/9 | **2** 9/9 |
| 書き出しの後に描き直したツリー | （測っていない） | **2** 9/9 |
| 端末の控えの bookOrder.all（S：次の保存の後） | 3・3/3 | **2** 3/3 |
| 画面 R・L・S（再読込の後） | L で3（基準）／S で3（#662 の後） | **2**・各3/3 |
| U（取り消しの後の書き出し） | all.json 3・重複0・ツリー3 | all.json 3・重複0・ツリー3。控えとメモリも3 |
| D（引き出し） | （未実測・2-0 の見立て） | 2件・除外した本0件 3/3 |
| 3択 | 0回 | 0回 |

### K：案A の弱い点の見え方（②の追加の指示）

古い控えを作って起動した。作り方：除外を書き出した後、控えの bookOrder.all と「すべて」本棚の books に除外した本を戻し、未反映の印を立てて、手元を採らせた。

| 時点 | ツリー | メモリ | all.json | 端末の控え |
|---|---|---|---|---|
| 起動の直後〜書き出しの後（16回×250ms） | **3**（3/3） | － | 2 | 3（除外入り） |
| 書き出しの後 | **3**のまま（書き出しはツリーを描き直さない） | **2**（3/3） | **2**（3/3） | **3**のまま（書き出しは控えを書き直さない） |
| 描き直した後（`updateBookshelfSelector`） | **2**（3/3） | 2 | 2 | 3 |

- メモリと all.json は、書き出しで2に戻る（3/3）＝②の合格条件どおり。
- 画面のツリーは、次に描き直されるまで3のまま残る（蔵書を変える操作・再読込など）。端末の控えは、次の保存（saveUserData）まで3のまま残る。次の起動で手元を採っても、`_ensureAllShelf` がメモリでは揃え直さない（除外を引くのは書き出しだけ）。このため、書き出しまでは同じ見え方を繰り返す。
- これが残るのは、直す前の版で除外して書き出し、その後に保存した端末だけ。bookshelf は未公開なので、移行は書かない（ADR-006・②の承認どおり）。
