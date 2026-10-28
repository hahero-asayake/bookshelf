# #401 step2: H2-7の再確認・before計測・view系5プラグインの実在確認

- 基準: HEAD=f01c257（origin/mainと一致・js/css/index.htmlに未コミット差分なし）。配信は既存の localhost:8000（working tree）。`?v=2026102902`。
- 計測日時: 2026-10-29 06:47〜06:50 JST

## (a) H2-7（JS仮想化はスクロール時の再描画でカクつく）の再確認

ハーネス: `scripts/verify/401-scroll-virt.mjs`（389-scroll-perf.mjs の複製に `--virt=1` を追加）。
仮想化試作＝**計測専用・アプリは変えない**。描画済み `.book-item` を全件抜き取り、可視行±3行だけを上下スペーサ付きで置き、
scrollイベントで範囲が変わるたびに `replaceChildren` で差し替える（H2-7で撤去した「スクロール時の再描画」方式の最小再現）。
条件: 390×844・view-covers medium(2列, 行高345px)・913冊(合成)・10秒・1200px/s・画像80ms遅延・各3回（中央値）。

| 条件 | 方式 | 長いフレーム(rAF>50ms) 件/合計ms | long-animation-frame 件/ms | フレーム数/10秒 | 再描画回数 |
|---|---|---:|---:|---:|---:|
| WebKit 素の速さ | 現行 cv:auto | 0/0 | - | 622 | - |
| WebKit 素の速さ | 仮想化試作 | 0/0 | - | 624 | 67 |
| chromium CPU x6 | 現行 cv:auto | 0/0（rep1のみ1件50ms） | 0/0 | 576 | - |
| chromium CPU x6 | 仮想化試作 | 0/0 | 1/51 | 595 | 67 |

読み:
- **今の条件では、仮想化してもスクロールのカクつきは再現しなかった**（どちらも長いフレームは0件、フレーム数もほぼ同じ）。H2-7の撤去理由は、少なくともこの最小試作と今のCSS（cv:auto込み）では裏が取れない。
- ただし次の限界がある（step3のADRで扱う）:
  1. WebKitはCPUを絞れない（Playwrightに手段が無い）。iPhone実機より速い可能性がある。chromium x6で代わりに確かめた。
  2. 試作は「生成済みのDOMを付け替えるだけ」。本実装で `createBookElement` を毎回呼ぶと、そのぶん重くなる。
  3. 10秒×1200px/sで届くのは一覧のおよそ8%（最下部には届いていない＝reachedBottom=false）。慣性スクロールや速いフリックは測っていない。
  4. 空き枠・画像デコードの近似値は、**現行・試作とも全repで0**。表紙の空き枠は今回の比較に使えない（計測側が拾えていない可能性を否定できない＝未確認）。
- 当時（H2-7）の実装・計測条件の記録は残っていない（js/bookshelf.js:2079-2083 のコメントのみ）。

## (b) before：並び替え3操作（#397と同じ手順・397-sort-perf.mjs）

`node scripts/verify/397-sort-perf.mjs --browser=webkit --sw=on --n=913 --reps=3 --out=tmp/401`（データは tmp/397 の実データ由来913冊をコピー）

| 操作 | tFrame 中央値/最大 (ms) | 固まる時間=maxInputDelay 中央値/最大 (ms) | applySorting/updateDisplay (ms) |
|---|---:|---:|---:|
| 並び順の変更(order) | 166 / 185 | 128 / 146 | 39 / 39 |
| 昇順/降順の切替(direction) | 163 / 172 | 126 / 133 | - / 41 |
| ドラッグ並べ替え(drag) | 35 / 45 | 0 / 0 | reorderBooks 1 |

- 目標（≤150ms・固まる時間≤100ms）に対して、order/direction は tFrame で +13〜16ms、固まる時間で +26〜28ms 足りない。
- JSの処理（applySorting/updateDisplay）は約40ms。tFrameとの差（約125ms）は、レイアウト・描画など **JSの外の費用**。DOM 913件があることのコストと整合する。
- **依頼の「再取込」は、#397のハーネスに無い**（このハーネスの3操作は order/direction/drag）。#397の結果も同じ3つ。step5のafterも同じ3つで比べ、再取込を足すかはstep3で②が決める。
- chromium x4/x6のbeforeは時間の都合で取っていない（#397 step1の値がHEAD前の参考になる）。

## (c) view系5プラグインは実際に読み込まれるか

ローダの経路（一次確認）:
- `js/plugin-loader.js:51-72` `listInstalledPlugins` ＝ 同期先の `plugins/` ディレクトリを `listDirs` で列挙し、`plugins/<id>/manifest.json` があるものだけを対象にする。
- `js/plugin-loader.js:79-90` `loadEnabledPlugins` ＝ **オプトアウト方式**。`settings.disabledPlugins` に**入っていない**ものを全部起動する。
- `settings.enabledPlugins` は、ローダからは**参照されていない**（grep: storage.js の初期値と bookshelf.js:5678 のコピーだけ）。→ 計画時に「有効一覧に5つ入っている」と書いたのは、使われていない古い欄を見ていた。
- 自動で配置されるのは標準5個（`STANDARD_PLUGIN_IDS`＝author-grouping/dark-theme/highlights-builtin/series-grouping/memo-templates・plugin-loader.js:20）だけ。view系は含まれない。

ローカルの実データ（`~/GitHub/bookshelf-data`・最終commit 7f5046b 2026-06-07）での判定:

| プラグイン | plugins/ に実体 | disabledPlugins | 読み込まれるか | ui:books-rendered を使うか |
|---|---|---|---|---|
| view-spines | あり | **入っている** | **読み込まれない** | 使う（index.js:98）。さらに `:nth-child(4n…)` で背の高さを決め、`document.querySelectorAll('.book-item')` で全件に色を付ける |
| view-compact | なし（_trash/plugins-removed-2026-06-03） | - | 読み込まれない | 0件（grep） |
| view-coverflow | なし（同上） | - | 読み込まれない | 0件 |
| view-mosaic | なし（同上） | - | 読み込まれない | 0件 |
| view-timeline | なし（同上） | - | 読み込まれない | 0件 |

→ **ローカルの写しで見るかぎり、5つとも今は読み込まれない（契約の対象は実質0件）**。リポジトリ側（plugins-sample/README.md:23-27）でも、4つは退避済み、view-spines は削除済み。

**未確認**: ハヘロの今の実環境（ハブまたはGitHubアダプタの同期先）の `plugins/` の中身と `disabledPlugins`。ローカルの写しは2026-06-07で止まっている（bookshelf-data の remote は private・kurokoに認証が無く、`git ls-remote` が失敗）。実環境と写しが違えば結論も変わる。

## step3（ADR・tp）へ持ち越す分岐（②が決める）

1. **契約の対象**: (i) 実環境の確認を待つ（ハヘロに `plugins/` の中身を見てもらう／ハブのデータを読む手段を用意する）。(ii) 写しどおり「view系は実質0件」として、ADRは**今後の view 系プラグインに向けた契約**として書く。view-spines（`nth-child` と全件DOMが前提）は、仮想化すると壊れる側の代表例として載せる。
2. **仮想化の必要性**: スクロールのカクつき（H2-7の撤去理由）は今回の条件で再現しなかった。一方、並び替えの時間は JS の外（レイアウト・描画）が大半で、DOMを減らせば効く見込みが大きい。ADRでは「する／しない／並べ替えのときだけ」を、スクロール・並べ替え時間・プラグインの改修量・ドロップ判定の複雑さの4軸で比べる。
3. **「再取込」の計測**: ハーネスに足すか、#397と同じ3操作（order/direction/drag）で比べるか。

---

# #401 step4: 案C（並べ替えの時だけ段階描画）の実装と after

## 実装
`js/bookshelf.js`：`_renderListDiff` の一括差し替え経路（移動が半分超）でだけ、先に「画面の下端より上の枚数＋24（最低48）」を置き、残りを120件ずつ `setTimeout(0)` で足す。
`ui:books-rendered` は置き終えた時に1回だけ出す。追加したのは `_listHeadCount`・`_startListTail`・`_flushListTail`・`_cancelListTail`・`_finishListTail`。
`_flushListTail` は `_renderListDiff` の先頭・`_onBookPointerDown`・`_moveBookElement` で呼ぶ。`_cancelListTail` は `updateDisplay` の全件描画経路と `renderStandardView` で呼ぶ。
`index.html` の `js/bookshelf.js?v=` を 2026102902 → 2026102903 に上げた。

## after（WebKit 素の速さ・SW on・913冊・3回・中央値/最大）

計測1回目＝E2E全件の並走なし（`397-sort-perf.mjs`、06:54）:

| 操作 | before tFrame | after tFrame | before 固まる時間 | after 固まる時間 |
|---|---:|---:|---:|---:|
| 並び順の変更 | 166 / 185 | **75 / 80** | 128 / 146 | **29 / 38** |
| 昇順/降順 | 163 / 172 | **73 / 76** | 126 / 133 | **23 / 37** |
| ドラッグ | 35 / 45 | 36 / 45 | 0 / 0 | 0 / 0 |

計測2回目＝再取込を追加（`401-sort-perf.mjs`）。before は HEAD を `git archive` して :8097 で配信し、after は作業ツリー。**E2E全件（8 worker）の並走下**で測った:

| 操作 | before tFrame | after tFrame | before 固まる時間 | after 固まる時間 |
|---|---:|---:|---:|---:|
| 並び順の変更 | 208 / 230 | 74 / 102 | 169 / 208 | 21 / 71 |
| 昇順/降順 | 158 / 185 | 65 / 83 | 120 / 147 | 21 / 58 |
| ドラッグ | 39 / 44 | 41 / 52 | 0 / 0 | 0 / 0 |
| 再取込 | 139 / 139 | 144（1回目）／221・414（2・3回目） | 102 / 102 | 106（1回目）／184・376 |

- 再取込は段階描画の経路を**通らない**（`insertBefore` で 898件を1件ずつ動かす経路。moved=898）。after の1回目（144ms／106ms）は before（139／102）とほぼ同じ。2・3回目は JS（`_renderListDiff`）自体が 166ms・73ms に膨らんでいて、E2E並走の CPU 競合の影響と見られる（before は並走の初めの方で測った）。**並走なしでの再取込の再計測は step5 で行う**。
- 再取込は before の時点で、目標（≤150ms）の内側、固まる時間（≤100ms）の境目（102ms）にある。

## テスト
- `npx vitest run`：exit 0。
- `npx playwright test`（全件・chromium）：519 passed / 13 skipped / **1 failed**。
  - 失敗は `onboarding-and-prefs.spec.js:135`（pageerror: `this._getLibrarySortedAsins is not a function`）。原因は**#398 が同じ作業ツリーの js/bookshelf.js を編集している途中の状態**（`_getLibrarySortedAsins` は #398 の追加分。テストの実行中は呼び出し側だけがあった）。再実行で合格したため、#401 の変更が原因ではない。
- 新規 `tests/e2e/list-staged-render.spec.js`（4件：段階描画を通ったこと・全件が並び順どおり・通知1回・途中での並べ替え／未配置の本へのドロップ／クリック）と、touch-reorder・sort-perf-budget・sort-persist・onboarding-and-prefs を合わせて再実行：32 passed。

---

# #401 step5: after（並走なし・#401の変更だけを当てた版）

条件：before＝HEAD（f01c257 相当・`git archive`）を :8097、after＝HEAD に #401 の差分だけを当てた版を :8098 で配信した。作業ツリーには #398 の未コミット変更（並び順の比較ロジック等）が混ざっているため、作業ツリーそのものは使っていない。
WebKit 素の速さ・SW on・913冊（実データ種）・各3回・`scripts/verify/401-sort-perf.mjs`・2026-10-29 07:06〜07:08・E2E並走なし。

| 操作 | tFrame before→after（中央値/最大） | 固まる時間 before→after（中央値/最大） | JS（_renderListDiff）before→after | 目標 |
|---|---|---|---|---|
| 並び順の変更 | 177/182 → **65/87** | 138/144 → **17/40** | 42 → 28 | 達成 |
| 昇順/降順の切替 | 171/175 → **73/74** | 132/135 → **22/24** | 41 → 30 | 達成 |
| ドラッグ | 34/42 → 33/43 | 0 → 0 | - | 達成（変化なし） |
| 再取込 | 152/155 → 155/160 | 114/116 → 117/121 | 39 → 39 | **未達**（変化なし） |

再取込が未達の内訳（after の3回：tSync 44/41/40ms・tFrame 160/155/154ms・固まる時間 121/117/116ms）:
- JS の同期処理は約40ms（`_renderListDiff` 39ms）。残りの約115ms は、JS が終わってから次の描画までの時間（レイアウト・描画）。
- 再取込は、並び順がほとんど変わらない（移動の見込みが半分以下）と判定され、案C の一括差し替え経路を**通らない**。`insertBefore` の経路で処理され、計装では moved/insertBefore が 898 件だった。「見込みは半分以下なのに、実際の挿入が898件になる」理由は**未確認**（取込で約1割の本の内容が変わって作り直され、`cursor` との突き合わせがずれて連鎖している可能性がある）。
- つまり再取込の費用も「913件のDOMを動かした後のレイアウト」が大半。案C を再取込の経路に広げる（`insertBefore` 経路でも、移動が多い時は段階描画にする）か、`insertBefore` の連鎖を直すかの、どちらかで縮む見込み。B（全面仮想化）でなくても届く可能性がある。

スクロール（after・cv:auto＋案C。案C は並べ替えの時しか動かないため、スクロールの経路は変わらない）：WebKit は長いフレーム 0件・624フレーム、chromium CPU x6 は 0件・578フレーム（before と同じ）。
