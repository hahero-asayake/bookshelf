# #402 step2: view 系プラグイン契約の洗い出しと ADR 案

- 日時: 2026-10-29 06:58〜07:05 JST。基準: bookshelf HEAD=f01c257（発火点の行番号は HEAD 版。作業ツリーには #401 の未コミット変更があり、行がずれている）。
- 読んだもの:
  - `js/plugin-api.js`
  - `plugins-sample/*`（標準5個＋同梱の reading-goal）
  - 同期先の写し `~/GitHub/bookshelf-data`（2026-06-07）の `plugins/view-spines`
  - `_trash/plugins-removed-2026-06-03/view-{compact,coverflow,mosaic,timeline}`
  - obsidian `08_意思決定記録.md` の ADR-041/042/139
- **本番に別の版があるか**: 確かめられなかった（同期先は private・kuroko に認証が無い）。→ 写しを正として扱う（step1 と同じ限界）。

## 0. 先に: #401 の ADR-139 との関係

- obsidian `08_意思決定記録.md` に、#401 が **ADR-139「本棚一覧の描画量を減らす方式と、view系プラグインとの契約（提案＝②レビュー待ち）」** をすでに書いている。obsidian では未コミット（`M`）で、自動の vault backup に乗る見込み。
- その「B を採る場合の契約」（range 付きペイロード・`ui:books-range-rendered`・`data-index`・読みAPI）は、本 step の detail が求めている契約とほぼ同じ骨格になっている。
- ADR 番号の実測（`grep "^### ADR-"`）では、最新は ADR-139。**本案は仮に ADR-140 とする**。ただし中身は ADR-139 の B 用契約の詳細化・訂正にあたるので、**②の判断で「ADR-139 に統合」か「ADR-140 として後継」かを決めてもらう**。08 にはまだ書いていない。
- ADR-139 に足りない点（本案で補ったもの）:
  1. `:nth-child` 系の互換を**窓の開始位置の揃え**で保つ方法（ADR-139 は「`data-index` へ書き換え」＝プラグイン側の改修が前提）
  2. **レイアウトを変えるプラグイン**（coverflow＝横スクロール・mosaic＝多段組 column-count・spines＝flex 折り返し）では、行窓の計算が成り立たない。そのため、全件 DOM に戻す**属性プロバイダ**を設ける
  3. 移行期の安全策（未対応の購読者がいれば全件 DOM）
  4. CSS の注入先と DOM の形の不変条件

## 1. プラグインごとの依存表

凡例:
- **全件DOM前提**＝`#bookshelf` に表示対象が全件・並び順どおりに並んでいることに頼っている
- **並び順依存**＝DOM の位置（`:nth-child`・兄弟セレクタ・自前の並べ替え）に頼っている

### 1-a. view 系（実体の有無は step1 のとおり）

| プラグイン | 実体／読み込み | ui:books-rendered の使い方 | 全件DOM前提の箇所 | injectCSS の注入先 | dataset 依存 | 並び順・DOM位置への依存 | レイアウトの変更 | 行窓で壊れ方 |
|---|---|---|---|---|---|---|---|---|
| **view-spines** | 実体あり／`disabledPlugins` に入っていて**読み込まれない** | `api.on('ui:books-rendered', schedule)`（index.js:98）。rAF で `applyColors` | `document.querySelectorAll('body.<cls> .book-item')` で全件に `--spine-color` を付ける（:64）。範囲外のカードは DOM に無いので色が付かない。範囲に戻った時、付け直しのきっかけが無い | `api.injectCSS('spines')`＝`document.head` の `<style id="plugin-style-view-spines-spines">`（plugin-api.js:633-643）。セレクタは `body.<cls> .bookshelf.view-covers .book-item` | `item.dataset.asin`（:65） | `.book-item:nth-child(4n…)` で背の高さを4通りに分ける（:36-39）。窓の開始位置が4の倍数でないと、スクロールのたびに背の高さが入れ替わる | `.bookshelf.view-covers` を `display:flex; flex-wrap` にし、幅42px・高さ可変にする（:15-35）。`content-visibility: visible !important` | 中。色付けは範囲イベントで直せる。ただし行高・列数がコアの想定（グリッド）と違う＝**実測でしか窓が切れない** |
| view-compact | **実体なし**（有効と設定されているが `_trash`）＝読み込まれない | 使わない | なし（CSS のみ） | 自前で `document.head.appendChild(style)`（index.js:145。injectCSS 以前の旧型） | なし | `.book-item:nth-child(even)` でしま模様（:43,46） | 1行1冊のリスト（grid 列） | 小。開始位置を2の倍数に揃えれば見た目は同じ |
| view-coverflow | **実体なし**（同上） | 使わない | なし（CSS のみ） | 自前で `document.head`（:140） | なし | `:nth-child(odd)`（:53）・`.book-item:hover ~ .book-item`（:61。後ろの兄弟を全部ずらす） | `.bookshelf.view-covers` を**横スクロール**（flex nowrap・overflow-x:auto・scroll-snap）にする（:14-23） | **大**。スクロール軸が横で、縦の行窓は成り立たない＝**全件 DOM が必要** |
| view-mosaic | **実体なし**（同上） | 使わない | なし（CSS のみ） | 自前で `document.head`（:120） | なし | なし | **多段組**（`column-count` 2〜5・`break-inside:avoid`）。並びは縦に流れて段ごとに埋まる（:20-30） | **大**。窓の中の分だけで段を組み直すので、スクロールのたびに配置が全部変わる＝**全件 DOM が必要** |
| view-timeline | **実体なし**（同上） | 使わない（`MutationObserver` で `#bookshelf` の childList を監視・:173） | `bs.querySelectorAll('.book-item')` を全件取り、`api.getBooks()` と突き合わせ、取得日で**DOM を並べ替え**、`bs.innerHTML=''` から月見出しを挟んで差し戻す（:118-166）。`window.bookshelf.updateDisplay()` を直に呼ぶ（:212） | 自前で `document.head`（:199） | `item.dataset.asin`（:130,131,142） | DOM の順序そのものを自分で決める | 見出し要素を `#bookshelf` の子に差し込む | **成り立たない**。コアの DOM を書き換える**排他オーナー**の型で、ADR-041 違反。仮想化の有無と関係なく、新契約では非対応（月見出しは将来の加算スロット候補） |

### 1-b. 標準5個（STANDARD_PLUGIN_IDS）＋同梱の reading-goal

| プラグイン | 一覧への依存 | ui:books-rendered | 全件DOM前提 | injectCSS | dataset | 並び順 | 仮想化の影響 |
|---|---|---|---|---|---|---|---|
| author-grouping | なし。`registerDetailSection`・`api.getBooks()`（全件データ） | 使わない | なし | `author-grouping`（詳細ペイン用） | 自分のボタンの `data-asin` だけ | なし | なし |
| dark-theme | なし。`registerCommand`・`addUIButton` | 使わない | なし | `dark`（`.book-cover` 等の色だけ。範囲外のカードが無くても無害） | なし | なし | なし |
| highlights-builtin | なし。`registerDetailSection` | 使わない | なし | `highlights` | なし | なし | なし |
| memo-templates | なし。`registerDetailSection` | 使わない | なし | `memo-templates` | なし | なし | なし |
| series-grouping | `registerBookFilter`（applyFilters の中＝描画より前のデータ段）・`registerActiveFilter`・`books:changed` | 使わない | なし（データで絞る） | なし | なし | なし | なし（絞った後の配列を窓が描くだけ） |
| reading-goal（同梱） | `registerWidget`・`api.getBooks()` | 使わない | なし | `reading-goal`（ダッシュボード） | なし | なし | なし |

→ **標準の6個は一覧の DOM に頼っていない**。仮想化で壊れうるのは view 系だけで、今実際に読み込まれる view 系は写しで見るかぎり0個。契約は「今後のプラグイン（サードパーティ含む）と、view-spines を再び有効にした時」に向けたものになる。

### 1-c. コア側の発火点（HEAD f01c257）

| 発火点 | ペイロード | 発火時の DOM |
|---|---|---|
| `_renderListDiff` 空のとき（bookshelf.js:2007） | `{view, changed:0}` | 0件 |
| `_renderListDiff` 通常（:2072） | `{view, changed: created+removed+moved}` | 表示対象の全件・並び順どおり |
| `renderStandardView` 空／全件描画後（:2088/:2099） | `{view}` | 同上 |
| `reorderBooks` の1冊移動（:2695） | `{view, changed:1}` | 同上 |

- 05_プラグイン仕様書のペイロードは `{view}` だけ（ADR-139 の一次確認と同じ）。
- 作業ツリーの #401 案C では、段階描画が描き終わった時に1回だけ出す（`changed: tail.changed`）＝「出た時点で全件」を守る設計。

## 2. ADR 案（仮 ADR-140・ADR-139 の B 用契約の詳細化）

**題**: 本棚一覧を仮想化しても view 系プラグインを壊さない契約＝「範囲イベント（加算スロット）＋全件DOM要求（属性プロバイダ）＋読みAPI」。既存の `ui:books-rendered` は後方互換で残す。

### 決定

1. **CSS の注入先と DOM の形は変えない（不変条件）**
   - `injectCSS(id, css)` は今と同じく `document.head` の `<style id="plugin-style-<pluginId>-<id>">` に入れる。
   - 一覧は今と同じく `#bookshelf.bookshelf.view-<view>` 1つ。**その直下の子は `.book-item` だけ**にする。窓の上下の余白は padding（またはコンテナ自身の疑似要素）で作り、**スペーサー要素を子に入れない**（`:nth-child`・`~` 兄弟セレクタ・`children` 走査を壊さないため）。
   - `.book-item` の `data-asin` も今のまま持つ。
2. **`ui:books-rendered` は後方互換で残す（意味も変えない）**
   - 全件 DOM で描いている時（下の 4 で戻った時を含む）は、今と同じく「出た時点で表示対象の全件が並び順どおり DOM にある」。
   - 仮想化で描いている時も、一覧の作り直し（並べ替え・絞り込み・本棚切替）のたびに今と同じ場所で出す。その時はペイロードに**加算で** `{ total, range:{start,end} }` を足す（`range` がある＝DOM にあるのはその範囲だけ）。既存の `{view, changed}` は残す。
3. **加算スロット: `ui:books-range-rendered { view, start, end, total }` を新設**
   - スクロールで DOM に入るカードが変わるたびに、置き終えた後で出す（ADR-139 B-2 と同じ）。
   - 範囲内のカードを飾るプラグインは、これを購読して範囲内だけ付け直す（view-spines の色付けは、`ui:books-rendered` と同じ `schedule` をこちらにも登録するだけで直る）。
   - 範囲から外れたカードの DOM は消えるので、プラグインが足した飾りも一緒に消える＝後片付けは不要。
4. **属性プロバイダ: 全件 DOM の要求（`registerListNeedsFullDom(() => boolean)`・名前は仮）**
   - コアは描画方式を決める時に、登録されたプロバイダへ逆問い合わせする。どれかが `true` を返したら、仮想化をやめて**今の全件 DOM（cv:auto）で描く**。ADR-041 の類型(b)で、空状態の `registerActiveFilter` と同じ型。コアはプラグイン名を知らない。
   - 対象の例: 横スクロール（coverflow 型）・多段組（mosaic 型）・行高が揃わない独自レイアウト（spines 型の flex 折り返し）。プラグインは自分の body class が ON の間だけ `true` を返す。
   - 費用: 要求が出ている間は今の性能（913冊で並べ替え166ms級）に戻るだけで、壊れない。
5. **`:nth-child` 互換: 窓の開始位置を揃える**
   - 窓の先頭の位置（並び順の index）は、常に **12 の倍数**（2・3・4・6 の公倍数）かつ列数の倍数（＝ lcm(12, 列数)）に切り捨てる。
   - これで `:nth-child(2n/odd/even/3n/4n…)` の当たり方が、全件 DOM の時と同じになる（compact のしま模様・spines の背の高さ4通り）。overscan が最大で lcm−1 件増えるだけ。
   - 加えて、各 `.book-item` に `data-index`（並び順の位置）を**属性として足す**（ADR-139 B-3）。新しく書くプラグインは、`:nth-child` ではなくこれを読むよう 05 に書く。
6. **全件のデータを渡す読みAPI: `getDisplayedBooks()`（名前は仮）**
   - 今の一覧に表示中の本（絞り込み・並び順を適用済み）を、並び順どおりの配列（複製）で返す。
   - 「全件の DOM をなめて ASIN を拾う」用途は、これに置き換える。既存の `getBooks()` は蔵書全件で、並び順も絞り込みも反映しない。ADR-043 の読み取りヘルパー（コアの状態への薄いラッパ）の型。
7. **移行期の安全策（後方互換の既定）**
   - プラグインの manifest に `"listContract": 2`（範囲イベント対応の宣言）が無く、そのプラグインが `ui:books-rendered` を購読している間は、4 と同じく全件 DOM で描く。
   - コアは「購読者のプラグインID → manifest の宣言」を総称的に見るだけで、特定プラグインは名指ししない。
   - これで、未知のサードパーティの view 系（全件 DOM 前提）も、何も直さずに今の挙動のまま動く。
8. **非対応として明記**
   - コアの一覧 DOM を並べ替える・`innerHTML` で作り直す・子に見出し等の要素を差し込む型（view-timeline 型）は、ADR-041 の排他オーナーにあたる。仮想化の有無と関係なく非対応にする。
   - 月見出しのような区切りが要るなら、将来、コアが描く**加算スロット**（例: `registerListSeparator`＝並び順の境目に見出しを足す）として別に検討する（本 ADR の範囲外）。

### 3類型との対応（ADR-041）

- 加算スロット(a): 3（範囲イベント）・2（既存イベントへのペイロードの加算）・5 の `data-index`（属性の追加）
- 属性プロバイダ(b): 4（全件DOMの要求）・7（manifest 宣言による既定の切り替え）
- 読み取りヘルパー（ADR-043）: 6
- 変換フック(c)・排他オーナー: **使わない／新設しない**

### 理由

- 標準の6個は一覧の DOM に頼っていない。今読み込まれている view 系も写しでは0個。なので、**既定は仮想化・頼るものがいる時だけ全件 DOM**にしても、今の利用者の挙動は変わらない。
- レイアウトを丸ごと変えるビュー（横スクロール・多段組）を、行窓に合わせて作り直すのは割に合わない。「その間だけ全件 DOM」の逃げ道を属性プロバイダで持つほうが、コアは単純なまま、プラグインの自由も守れる。
- `:nth-child` は CSS だけのプラグインがいちばん使う手段。開始位置を揃えるだけで、プラグインを直さずに互換が取れる。

### 却下した案

- **`data-index` への書き換えをプラグインに義務づけるだけ（ADR-139 B-3 単独）**: 未知のサードパーティが黙って壊れる。7 の宣言がない限り全件 DOM、を既定にする。
- **ビュー丸ごとの置換 API（registerView）**: 排他オーナー。ADR-041 で新設しない。
- **スペーサー要素を一覧の子に入れる**: `:nth-child`・兄弟セレクタ・`children` 走査が全部ずれる。

### 05_プラグイン仕様書に足す行（承認後・step4で）

- イベント一覧:
  - `ui:books-rendered { view, changed?, total?, range? }`（range が無ければ全件 DOM）
  - `ui:books-range-rendered { view, start, end, total }`
- API:
  - `registerListNeedsFullDom(fn)`
  - `getDisplayedBooks()`
- manifest: `listContract`
- 不変条件: 1 の DOM の形・injectCSS の注入先・`data-asin`/`data-index`
- サンプル: view-spines を契約2の形に直した例（範囲イベントの購読・`registerListNeedsFullDom` で flex レイアウト中は全件DOM）

## 3. E2E の主対象（②申し送りどおり spines 中心）

- view-spines をテストで有効にして流す（同期先の写しは無効化中）。確かめる点:
  - (i) 範囲内のカードに色が付く
  - (ii) スクロールで範囲に入ったカードにも色が付く
  - (iii) `:nth-child(4n…)` の背の高さが、スクロールの前後で同じカードについて変わらない
  - (iv) ON の間は全件 DOM に戻る（4 を採る場合）
- 標準6個: 詳細ペイン・ウィジェット・series の絞り込みが、仮想化 ON でも今と同じ結果になること（回帰）。
- 退避済みの4つは E2E を作らない。代わりに、型ごとの最小フィクスチャで「全件 DOM に戻る」ことだけを確かめる（横スクロール型・多段組型）。

## 4. ②へ

1. 本案を ADR-139 に統合するか、ADR-140 として後継にするか。
2. 7（`listContract` の宣言が無ければ全件 DOM）を既定にするか。安全だが、未対応のプラグインが入っているだけで、仮想化の効果が丸ごと消える。
3. step3（設計案の比較）は、ADR-139 の A/B/C 比較と step1 の 3000冊の実測を前提にする。#401 の案C が本体に入りかけている点の扱い（step1 の報告どおり）も合わせて決めてほしい。
