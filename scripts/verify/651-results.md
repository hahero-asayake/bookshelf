# イシュー#651: Playwright 1.60.0 → 1.65.1 の版上げの評価（A/B）

A＝1.60.0（今の lock）、B＝1.65.1（npm の latest・2026-11-13 公開）。

## step1: 前提・B の用意・#640 の再現と画像比較の A/B（2026-11-14 17:21〜）

### 前提

- `git log --grep='Issue: #640' origin/main` → `3a0d720 test: lint:e2e-wait に、ページ全体を写す待ち…を禁じる検査を足す`。origin/main の `scripts/check-e2e-async-wait.mjs` に `findHeavyAriaWaits` がある（2か所）。
- worktree は origin/main（16c0a10）まで早送りしてから測った（46 commit 遅れていた・自分の commit は無し）。

### 計画との違い（2つ）

- **worktree の node_modules は symlink ではなかった**。この worktree 専用の実ディレクトリ（btrfs・179M・playwright-core 1.60.0）。そのため、版の付け替えは symlink の `ln -sfn` ではなく、#640 の ab.sh と同じく `mv` で行った（`_local/651/ab.sh`。trap EXIT で必ず A に戻す）。共有の `/home/sei/GitHub/bookshelf/node_modules` には触れていない。
- port は、実行時の指示（このイシュー専用 8151）に従い、計画の 8651 ではなく 8151 を使った。

### B（1.65.1）の用意

- `_local/651/nmB/` に origin/main の package.json・package-lock.json を写し、`npm install -D @playwright/test@1.65.1`（3秒・キャッシュから）。
- package.json の差分は devDependencies の1行だけ：`"@playwright/test": "^1.49.0"` → `"^1.65.1"`。
- lock の差分は、パッケージの版が変わったものが3つだけ：`@playwright/test`・`playwright`・`playwright-core`（1.60.0 → 1.65.1）。`@axe-core/playwright` の peer は動いていない。
- 注意：今の npm は esbuild の postinstall を `allow-scripts` で止めた（警告のみ）。Playwright の回には関係しないが、step5 で vitest を B で流す時に効くかもしれない。
- ブラウザは `PLAYWRIGHT_BROWSERS_PATH=/home/kuroko/.cache/ms-playwright-651` に入れた（既定の `~/.cache/ms-playwright` には触れていない）。

| | 1.60.0 | 1.65.1 |
|---|---|---|
| chromium | 148.0.7778.96（r1223） | 159.0.8154.6（r1255） |
| webkit | 26.4（r2287） | 27.2（r2388） |
| ffmpeg | r1011 | r1013 |

（各版の `playwright-core/browsers.json` による）

**webkit 27.2 はこの機械にない `libavif.so.16` を要る**（`ldd`。webkit の lib ディレクトリを全部 LD_LIBRARY_PATH に入れて見た）。直接リンクしているのは `libWPEWebKit-2.0.so.1.12.0`・`libWPEInjectedBundle.so`・`libwebkitgtk-6.0.so.4.20.0`・`libwebkitgtkinjectedbundle.so`。1.60 の webkit 26.4（r2287）は、同じ見方で足りないものは0件。この機械は Ubuntu 24.04.5 で、`libavif16` は入っていない（apt の候補は 1.0.4-1ubuntu3）。CI は `npx playwright install --with-deps` なので入る。手元で webkit の B を流す（step3）には `libavif16` を apt で入れる必要がある（sudo・システムの変更）。

### 画像比較（playwright.visual.config.js）

| 版 | 結果 | 時間 | 負荷（1分平均・前→後） |
|---|---|---|---|
| A 1.60.0（1回目） | 54 passed・差分0 | 11秒 | 16.9→19.7 |
| B 1.65.1（1回目） | 50 passed・**4件に差分** | 15秒 | 13.9→21.2 |
| B 1.65.1（2回目） | 50 passed・**同じ4件に差分**（画素数も1回目と同じ：1368・2880・4021・1892） | 16秒 | 36.3→43.8 |
| A 1.60.0（2回目） | 54 passed・差分0 | 22秒 | 45.1→48.2 |

→ 差分は B でだけ、毎回同じ所に同じ画素数で出る。A では2回とも0件。**4件は版によるもの**と判定する（基準画像を作り直すかどうかは step4 で決める）。

B の差分は4件とも「設定の1節」の全体画像 `06-settings-section`（`tests/visual/screens.spec.js:118`）。幅は char-390・768・820・1024 で、どれもタッチの端末。マウスの端末（1440・1920）と、同じ test の見出しだけの画像（`06-settings-section-header`）は通る。基準は `maxDiffPixelRatio: 0.001`（playwright.visual.config.js:38）。

| 端末 | 差分の画素 | 違う所 |
|---|---|---|
| char-390 | 1368 | 保存先の `<select>` の枠だけ |
| char-768 | 2880 | 保存先の `<select>` の枠だけ |
| char-820 | 4021 | `<select>` の枠と、上の方（左の一覧の「アカウント」の行） |
| char-1024 | 1892 | `<select>` の枠と、左の一覧の「アカウント」「ログイン」のアイコン、右上の × |

違いは2種類だった（画像：`_local/651/visual-B-sheet/01.png`〜`04.png`、全部を縦につないだもの `all.png`。左から期待＝1.60.0 の基準画像・実際＝1.65.1・差分）。

1. **保存先の `<select>` のフォーカスの枠**：1.60.0 は橙の枠（フォーカスが見える状態）。1.65.1 は黒い通常の枠（フォーカスの枠が出ない）。4件すべて。
2. **「アカウント」「ログイン」のアイコン**（820・1024 の、左の一覧が見える幅）：1.60.0 の基準画像は小さな点だけで、アイコンが描かれていない。1.65.1 ではユーザーのアイコンが描かれる。

どちらも文字の描画や字形の差ではなく、フォーカスの見え方とアイコンの描画の差。

### #640 の再現の A/B

流し方：#640 の再現 spec（`/home/kuroko/kuroko/work/651-from-640/zz-640-repro.spec.js.txt`・sha256 の先頭 81a1befc6f0b53d6）を、流す間だけ `tests/e2e/zz-651-repro.spec.js` に置いた（commit しない。終わった後に `_local/651/` へ mv した）。中身は変えていない。chromium・workers=1・913冊・390×844・CPU 6倍。並び順を「タイトル」に切り替えた直後に、印 `#m640` を待つ。

- 順番：A1（3巡）→ B1（3巡）→ B2（2巡）→ A2（2巡）。どの組も版ごとに5回。
- 各巡で、7組（`R640_SET` なし。`prof` は除外）と3組（`R640_SET=2`）を流した。
- 負荷（1分平均）は、A の回が 13.7〜31.7、B の回が 21.2〜53.0。B の方が高い時間帯に当たった（他の処理の負荷。16 コア）。

| 組 | 形 | 版 | 回数 | 待ちの往復ms（回ごと） | 中央値 | ページの中の記録ms 中央値 | 1秒以上の長いタスク（回ごと） | 長いタスクの最大ms 中央値 | 負荷（前の範囲） |
|---|---|---|---|---|---|---|---|---|---|
| a-attr | 待つ形 | 1.60.0 | 5 | 3675・5125・5190・5690・5216 | 5190 | 2692 | 0・2・2・2・2 | 2590 | 14.3〜26.2 |
| a-attr | 待つ形 | 1.65.1 | 5 | 3189・3686・3508・2799・106 | 3189 | 3344 | 0・0・0・0・0 | 72 | 21.2〜39.3 |
| a-text | 待つ形 | 1.60.0 | 5 | 4768・4983・4999・5481・5141 | 4999 | 2337 | 2・2・2・2・2 | 2766 | 15.4〜24.4 |
| a-text | 待つ形 | 1.65.1 | 5 | 3370・3318・117・2747・3242 | 3242 | 3307 | 0・0・0・0・0 | 73 | 22.5〜41.0 |
| d-missing-attr | 待つ形 | 1.60.0 | 5 | 5604・2227・5636・7243・3931 | 5604 | 2485 | 2・1・2・2・1 | 3245 | 13.7〜29.6 |
| d-missing-attr | 待つ形 | 1.65.1 | 5 | 154・5472・6119・5122・4978 | 5122 | 274 | 0・0・0・0・0 | 73 | 28.0〜53.0 |
| f-bigvisible-attr | 待つ形 | 1.60.0 | 5 | 4800・5011・5574・8480・8716 | 5574 | 2832 | 2・2・2・2・1 | 2796 | 14.1〜31.7 |
| f-bigvisible-attr | 待つ形 | 1.65.1 | 5 | 3784・2802・113・2228・2629 | 2629 | 2685 | 0・0・0・0・0 | 68 | 27.3〜51.1 |
| e-hidden-tobehidden | すぐ通る形 | 1.60.0 | 5 | 2801・2598・1910・2828・3320 | 2801 | 2733 | 1・1・1・1・1 | 2670 | 13.8〜31.1 |
| e-hidden-tobehidden | すぐ通る形 | 1.65.1 | 5 | 140・103・119・91・118 | 118 | 263 | 0・0・0・0・0 | 54 | 26.9〜51.1 |
| a-count | 対照 | 1.60.0 | 5 | 262・78・157・151・198 | 157 | 205 | 0・0・0・0・0 | 62 | 15.9〜24.4 |
| a-count | 対照 | 1.65.1 | 5 | 183・222・212・190・173 | 190 | 294 | 0・0・0・0・0 | 71 | 21.5〜38.0 |
| a-poll | 対照 | 1.60.0 | 5 | 260・344・376・297・566 | 344 | 232 | 0・0・0・0・0 | 71 | 14.9〜23.3 |
| a-poll | 対照 | 1.65.1 | 5 | 324・321・376・288・291 | 321 | 278 | 0・0・0・0・0 | 69 | 22.2〜41.0 |
| b-attr | 対照 | 1.60.0 | 5 | 182・182・261・164・389 | 182 | 273 | 0・0・0・0・0 | 70 | 14.9〜24.4 |
| b-attr | 対照 | 1.65.1 | 5 | 259・419・265・135・191 | 259 | 354 | 0・0・0・0・0 | 93 | 22.2〜43.7 |
| b-text | 対照 | 1.60.0 | 5 | 145・206・330・180・243 | 206 | 231 | 0・0・0・0・0 | 79 | 15.0〜25.0 |
| b-text | 対照 | 1.65.1 | 5 | 290・247・259・191・209 | 247 | 336 | 0・0・0・0・0 | 101 | 25.2〜46.7 |
| c-attr | 対照 | 1.60.0 | 5 | 108・250・111・194・609 | 194 | 124 | 0・0・0・0・0 | 76 | 15.0〜25.0 |
| c-attr | 対照 | 1.65.1 | 5 | 240・193・217・127・172 | 193 | 202 | 0・0・0・0・0 | 0 | 28.9〜46.7 |

組の意味（#640 の repro.md と同じ）：a＝913冊・印は hidden、b＝913冊・印は見える 8×8px、c＝5冊・印は hidden、d＝印がまだ無い、e＝hidden の印に toBeHidden（すぐ通る）、f＝見える大きな入れ物 `#bookshelf` の属性を待つ。

#### 判定（step1 で測る前に固定した基準・`_local/651/summarize.mjs` が機械的に当てた）

- **「すぐ通る形の遅れは消えた」→ 1.65.1 で当てはまる。** e-hidden-tobehidden の中央値は 118ms で、a-count（190ms）の 0.6 倍（基準は2倍以内）。1秒以上の長いタスクは5回で0件（基準は0件）。1.60.0 では 2801ms（17.8 倍）・5回とも1件ずつ。
- **「待つ形は残った」→ 1.65.1 でも当てはまる。** a-count に比べて、a-attr は 3189ms（16.8 倍）、a-text は 3242ms（17.1 倍）、d-missing-attr は 5122ms（27.0 倍）。基準は5倍以上。

#### 数字から読めること（判定の外・参考）

- 1.65.1 の待つ形は、1.60.0 より短くなった。中央値で a-attr −39%、a-text −35%、f −53%、d −9%。B の方が負荷の高い時間帯だったので、版の差による短縮を大きく見積もってはいない。また、1.65.1 では5回に1回ほど 0.1 秒で通る回がある（a-attr 106・a-text 117・d 154・f 113）。最初の問い合わせで条件を満たした回は写しを作らない、という 1.65.1 のコード（`core.matches !== options.isNot ? void 0 : …`）と合う。1.60.0 の待つ形では、2.2 秒を切った回は無い（最小は d の 2227ms）。
- **1.65.1 では、1秒以上の長いタスクが全部の組で0件**（長いタスクの最大の中央値は 0〜101ms）。それでも、ページの中の記録（並べ替え→rAF→setTimeout(0)）は、a-attr 3344ms・a-text 3307ms・f 2685ms で、a-count（294ms）の約 9〜11 倍。写しの処理が細かいタスクに分かれて走るようになったが、ページはほぼ同じだけ遅れる、と読める（1.65.1 のコードで分かれ方を確かめてはいない＝未確認）。
- d-missing-attr（印がまだ無い）の 1.65.1 は、ページの中の記録が 274ms と短い（ページはすぐ印を作った）。一方、待ちの往復は 5122ms と長い。印が無い間の問い合わせが重く、印ができた後の問い合わせまで時間がかかる形。

#### CPU プロファイル（spec の `prof a-attr`・`prof a-count`。版ごとに1回。B→A の順。負荷 44〜49）

| 版 | 組 | 待ちの往復ms | ページの中の記録ms | JS の自己時間の合計ms | 上位（自己時間ms） |
|---|---|---|---|---|---|
| 1.60.0 | a-attr | 8586 | 4314 | 9052 | checkVisibility 3241・getCSSContent 1289・isElementHiddenForAria 1087・getComputedStyle 389・(program) 379・visit 263 |
| 1.60.0 | a-count | 453 | 578 | 1059 | (program) 358・(anonymous) 186・_renderListDiff @bookshelf.js 98 |
| 1.65.1 | a-attr | 3916 | 4059 | 4352 | checkVisibility 1605・isElementHiddenForAria 462・getCSSContent 416・(program) 251・(anonymous) 118・toAriaNode 110・getComputedStyle 108・getTextAlternativeInternal 106 |
| 1.65.1 | a-count | 207 | 361 | 676 | (program) 203・(anonymous) 73・(garbage collector) 69・replaceChildren 55 |

→ 1.65.1 でも、待つ形（a-attr）では Playwright の可視判定と aria の関数（checkVisibility・isElementHiddenForAria・getCSSContent・toAriaNode・getTextAlternativeInternal）が上位を占める。足すと約 2700ms で、JS の自己時間 4352ms の約6割。a-count では、上位に aria の関数は出ない。1回ずつの計測で、負荷も高い（44〜49）ので、割合は目安として読む。

### 生のデータ（`_local/651/`）

- `runs.log`：各回の開始・終わり・負荷・版
- `repro-A1/A2/B1/B2.jsonl`：再現の1回ごと
- `prof-A.jsonl`・`prof-B.jsonl`：プロファイルの上位
- `summary.md`：上の表と判定（`summarize.mjs` の出力）
- `run-*.log`：各回の Playwright の出力
- `visual-B`・`visual-B2`：差分の画像（期待・実際・差分）
- `visual-B-sheet/`：差分の画像を並べたもの
- `ab.sh`・`ab2.sh`：A/B を流したスクリプト（mv で付け替え、trap で A に戻す）
- `zz-651-repro.spec.js`：流した再現 spec（commit しない）

### 終わった時の状態

- worktree の node_modules は A（1.60.0）に戻っている（`_local/651/nmA` は残っていない）。
- B は `_local/651/nmB/node_modules`（1.65.1）に残してある。step2・3 で使う。
- B のブラウザは `/home/kuroko/.cache/ms-playwright-651`（chromium-1255・chromium_headless_shell-1255・webkit-2388・ffmpeg-1013）。

## step2: E2E 全件（chromium）の A/B（2026-11-14 17:35〜）

流し方：CI の e2e レグと同じ `npx playwright test --project=chromium --grep-invert "sort-perf-budget"`（ci.yml:135）に、`--reporter=dot,json` と `--output=_local/651/out-<回>` を足した。worktree は origin/main 1234cf4 まで早送りしてから流した。予定は 899 件・8 workers。順番は A→B→B→A で、各回 timeout 480 秒。付け替えは step1 と同じく mv と trap（`_local/651/ab3.sh`・記録は `_local/651/runs2.log`）。

### 起きたこと（この時間帯は負荷が非常に高かった）

- **負荷（1分平均）は、A1 の始めの 24.8 から 87〜94 まで上がった**（16 コア。他のイシューの処理による）。この負荷の下では、どの回も 480 秒で全件を終えられなかった。#640 の時（負荷 50〜110 で 330 秒の timeout）と同じ形。そのため json reporter の結果は書かれず、合否と時間は dot の印と出力フォルダから数えた（`_local/651/count-partial.mjs`）。
- **B1 は無効**。B1 の赤は全部 `page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:8151/...` だった（430件）。原因は版ではなく、A1 を timeout で止めた時に、A1 の Playwright が立てた webServer（`python3 -m http.server 8151`・pid 1578144）が残ったこと。設定は `reuseExistingServer: true`（playwright.config.js:71）なので、B1 はそれをそのまま使った。残ったサーバは、標準エラーの読み手（A1 の Playwright）がいなくなっている。http.server は要求のたびに標準エラーへ記録を書くので、そこで書けずに応答が空になる、と考えられる（BrokenPipe の記録そのものは見ていない）。17:47:30 に残ったサーバと B1 を止めた。B2 は空いた 8151 番に、自分で新しいサーバを立てて流れた。
- **step3 以降の注意**：timeout で止めた回の後は、8151 番に残ったサーバを `ss -ltnp` で確かめて止めてから、次の回を流す。止めないと、次の回は版に関係なく全部赤になる。

### 結果（全件を終えたのは B2 と A2 の2回。A1 は timeout・B1 は無効）

| 回 | 版 | 時刻 | 負荷（前→後） | 終わった件数 | 通った | 赤 | skip | 壁時計（秒） | テストの duration の合計（秒） |
|---|---|---|---|---|---|---|---|---|---|
| A1 | 1.60.0 | 17:36:30〜 | 24.8→87.5 | 847 / 899（480 秒で timeout） | 814 | 17 | 16 | （480 で打ち切り） | （json なし） |
| B1 | 1.65.1 | 17:44:30〜 | 87.5→70.7 | **無効**（残ったサーバのため。上を参照） | | | | | |
| B2 | 1.65.1 | 17:47:30〜 | 70.7→73.8 | 899 / 899 | 880 | 3 | 16 | 308.5 | 2151.5 |
| A2 | 1.60.0 | 17:52:39〜 | 73.8→52.3 | 899 / 899 | 882 | 1 | 16 | 290.6 | 1953.8 |

- A1 の件数・赤は dot の印から数えた。A1 は負荷が 25 から 87 へ上がる途中の回で、他の回とは比べられないので「参考」とする。
- **比べられるのは B2 と A2**（続けて流した回で、負荷も近い）。壁時計は B2 が 6% 長い（308.5 / 290.6）。両方で通った 879 件の時間は、版ごとの合計で A 1947.5 秒 → B 2083.0 秒（B/A＝1.07）。テストごとの比 B/A の中央値は 1.09。**全件の時間には、1.65.1 で短くなる効き目は見えない**（1回ずつで、負荷も 50〜75 と高いので、±10% は揺れの範囲と読む）。1.65.1 で大きく短くなったテストもある（save-failure-visible:241 は 10.4→4.3 秒、article-orphan-draft:124 は 8.1→4.0 秒、billing-portal-return:91 は 6.4→3.2 秒）。一方、長くなったテストもある（load-conflict-unsaved:301 は 22.9→28.4 秒、book-memo-file-lifecycle:234 は 2.9→6.0 秒）。全体では打ち消し合っている。#640 の lint で重い待ちの形が spec から消えているので、全件では差が出にくい、と読める（未確認）。
- sort-perf-budget（workers=1 の単独）は、18 分の打ち切り（17:53）を過ぎたため、A・B とも流していない（未実施）。

#### 合否の3分類（B2 と A2。どちらも1回ずつ）

- 両方赤：0件
- A だけ赤：1件 — `sort-persist.spec.js:133`（#387 並び替え設定の保持 (github) › PC と交互に変更）。`expect(received).toBe(expected)`
- B だけ赤：3件（時間が無く、流し直しての切り分けはしていない。揺れか版によるものかは未確定）
  - `esc-focus.spec.js:31`（⌘K パレットの Esc (PC) › Tab で結果欄へ移った後も Esc で閉じる）。`expect(received).not.toBe(expected)`。**フォーカスに関わる test**で、step1 の画像の差（フォーカスの枠の出方）と同じ種類の可能性がある。step3 で A・B 各2回の流し直しを優先する。
  - `gate/j2-5-import-no-duplicate.spec.js:17`（@gate J2-5）。`Test timeout of 60000ms exceeded`（負荷 70 台の回）。
  - `reimport-diff.spec.js:181`（重複asinは2回目の描画でカードが作り直されない #480）。`page.evaluate: TypeError: Cannot read properties of null (reading 'bookshelves')`。
- 揺れ（再試行で通った）：A・B とも0件（ローカルは再試行なし）。

生のデータ：`_local/651/runs2.log`・`full-B2.json`・`full-A2.json`・`run-full-*.log`・`out-full-*`（失敗の印）・`summary-full.md`（`summarize-full.mjs` の出力）・`count-partial.mjs`。

## step3: webkit・char・audit の A/B（2026-11-14 17:58〜・18:04 にやり直し）

### 流し方

- CI と同じコマンドで流した。
  - webkit：`GATE_WEBKIT=1 npx playwright test --project=gate-webkit --workers=1`（60件）
  - char：`--project=char-390 … char-1920` の6つ
  - audit：`npm run audit -- --workers=4`
- worktree は origin/main f9468f8。
- **同じ版の webkit と char は同時に流した**（A：webkit-A と char-A、B：webkit-B と char-B）。30分の run に収めるためで、負荷の条件は A/B でそろえてある。そのため webkit の時間は char と重なった時の値で、単独の時間ではない。
- **8151 番のサーバは script が1つ立てて、全部の回で使い回した**（main の設定は `reuseExistingServer: true`）。どの回もサーバを持たないので、回を timeout で止めても、step2 の B1 のようにサーバが壊れない。audit の設定（playwright.audit.config.js）には `reuseExistingServer` が無く、8151 番が使用中だと落ちるため、audit の回だけサーバを止めた。
- 17:58 からの1回目（`_local/651/ab4.sh`）は、前の run が 18:03 に終わったため、webkit-A の途中で止まった（trap で A に戻り、サーバも止まった）。18:04 から `_local/651/ab5.sh` で流し直した。記録は `_local/651/runs3.log`。

### webkit 27.2 のライブラリ（システムは変えていない）

step1 で、webkit 27.2 はこの機械に無い `libavif.so.16` を要ると分かっていた。さらに libavif16 自身も `libgav1.so.1` と `libyuv.so.0` を要る（どちらも入っていない）。そこで、Ubuntu の archive の .deb を `apt-get download` で取り（root 不要）、`dpkg-deb -x` で `_local/651/avif/` に展開した。webkit-B の回だけ `LD_LIBRARY_PATH` にこの場所を足した（Playwright の `pw_run.sh:65` は既存の LD_LIBRARY_PATH の後ろに自分の lib を足すので、こちらの値も効く）。

- 取った版：libavif16 1.0.4-1ubuntu3、libgav1-1 0.18.0-1build3、libyuv0 0.0~git202401110.af6ac82-1。どれも CI の `--with-deps` が入れるのと同じ Ubuntu 24.04 の版。
- 展開した後に webkit 27.2 のファイルを全部 `ldd` で見て、足りないライブラリが0件になったことを確かめた。
- **手元で webkit の B を流すには、この3つのライブラリが要る。** step5 以降で共有の環境を 1.65.1 に切り替える時は、`sudo apt install libavif16`（libgav1-1・libyuv0 も付いて入る）か、`npx playwright install-deps webkit` が要る。これは②の判断が要るシステムの変更。

### step2 で B だけ赤だった3件の流し直し（chromium・各2回）

| test | A 1.60.0（18:01・負荷 66） | B 1.65.1 |
|---|---|---|
| esc-focus.spec.js:31（⌘K パレットの Esc） | 通過・**赤**（`#command-palette` が5秒で出ない） | 通過・通過 |
| gate/j2-5-import-no-duplicate.spec.js:17 | 通過・通過 | 通過・通過 |
| reimport-diff.spec.js:181 | 通過・通過 | 通過・通過 |

→ B（18:19・負荷 61）では3件とも2回通った。esc-focus:31 は A でも赤になった。**step2 の「B だけ赤」3件は、版によるものではなく揺れ**と判定する（負荷 60〜75 の時間帯の待ちの遅れ）。

### 結果

| 回 | 版 | 時刻 | 同時に流したもの | 負荷（前→後） | 結果の数 | 通った | 赤 | skip | 壁時計（秒） |
|---|---|---|---|---|---|---|---|---|---|
| webkit-A | 1.60.0 | 18:04:29〜 | char-A | 46.9→50.2 | 60 | 48 | 0 | 12 | 355.4 |
| webkit-B | 1.65.1 | 18:19:41〜 | char-B | 60.7→62.5 | 60 | 0 | **50（全部、起動の失敗）** | 10 | 41.5 |
| char-A | 1.60.0 | 18:04:29〜 | webkit-A | 46.9→74.2 | 774 | 199 | 0 | 575 | 101.3 |
| char-B | 1.65.1 | 18:19:41〜 | webkit-B（すぐ落ちた） | 60.7→67.2 | 774 | 199 | 0 | 575 | 63.8 |
| audit-B | 1.65.1 | 18:14:34〜 | なし | 29.4→62.5 | 744 件のうち 666 件まで（300 秒の timeout） | 666 | 0 | — | （300 で打ち切り） |

- **char**：両方赤0・A だけ赤0・B だけ赤0。通過と skip の数も同じ（char は端末の幅で skip する test が多い）。時間は同時に流したものと負荷が違うので比べない。
- **audit**：B は timeout の 300 秒までに 666 件が通り、赤は0件。届かなかったのは 78 件。B に赤が無いので、計画どおり A は流していない。CI の audit レグには timeout が無いので、全件は CI で見ることになる。
- **webkit の B は未実施（起動できなかった）**。50 件とも `browserType.launch: Target page, context or browser has been closed` で、ブラウザの出力は `minibrowser-wpe/bin/MiniBrowser: error while loading shared libraries: libavif.so.16: cannot open shared object file`。私用に展開したライブラリの場所を `LD_LIBRARY_PATH` に足して流したが、MiniBrowser まで届かなかった。`pw_run.sh` には「zip の bundle のラッパーが自分で環境変数を設定する」と書かれている。Playwright の本体（coreBundle.js）にも LD_LIBRARY_PATH を扱う所が5か所ある。どちらかで外の値が使われていない、と考えられる（どちらかは確かめていない）。
  - 次に試す手（システムは変えない）：私用のブラウザ置き場 `/home/kuroko/.cache/ms-playwright-651/webkit-2388/minibrowser-wpe/lib/` に、3つの .so（`_local/651/avif/usr/lib/x86_64-linux-gnu/` の libavif.so.16・libgav1.so.1・libyuv.so.0）を写してから流す。ラッパーが自分の lib を探すなら、これで読める見込み（未検証）。
  - または、`sudo apt install libavif16` を入れる（②の判断）か、webkit の B は CI だけで見る。
- webkit の A は、60 件のうち 48 件が通り、赤0（skip 12 は iPhone で外す決まりの分）。

### 起きたこと（時間を失ったところ）

- 18:10 に A の2回が終わった後、`ab5.sh` が B に移らず、約4分止まった。原因は script の書き方で、引数なしの `wait` が、裏で立てたサーバ（終わらない）まで待っていた。18:14 に止め、B の分だけを `ab6.sh` で流した（`wait` は test の回の PID だけを待つ形に直した）。
- 生のデータ：`_local/651/runs3.log`、`webkit-A.json`・`webkit-B.json`・`char-A.json`・`char-B.json`・`reds-A-m.json`・`reds-B-m.json`、`run-*.log`、`out-*`。集計は `_local/651/summarize-any.mjs`。

## step4: 判断の材料と判断（2026-11-14 18:23〜）

### (1) A/B の数値表（まとめ）

| 調べたもの | 回数（A/B） | 1.60.0（A） | 1.65.1（B） | 負荷（1分平均） | 節 |
|---|---|---|---|---|---|
| 再現：すぐ通る形（e・toBeHidden） | 5/5 | 中央値 2801ms・1秒以上の長いタスク 5件 | **118ms・0件** | A 13.7〜31.7／B 21.2〜53.0 | step1 |
| 再現：待つ形（a・toHaveAttribute） | 5/5 | 5190ms | 3189ms | 同上 | step1 |
| 再現：待つ形（a・toHaveText） | 5/5 | 4999ms | 3242ms | 同上 | step1 |
| 再現：待つ形（d・印がまだ無い） | 5/5 | 5604ms | 5122ms | 同上 | step1 |
| 再現：待つ形（f・見える大きな入れ物） | 5/5 | 5574ms | 2629ms | 同上 | step1 |
| 再現：対照（a・toHaveCount） | 5/5 | 157ms | 190ms | 同上 | step1 |
| chromium 全件（899件・CI の e2e と同じ） | 1/1（全件を終えた回） | 290.6秒・通過882・赤1 | 308.5秒・通過880・赤3（3件とも揺れと確認） | A 73.8→52.3／B 70.7→73.8 | step2・3 |
| webkit（gate-webkit・60件） | 1/0 | 355.4秒・通過48・赤0・skip12 | **未実施**（起動できず。下の (5)） | A 46.9→50.2 | step3 |
| char（6端末・774件） | 1/1 | 101.3秒・通過199・赤0 | 63.8秒・通過199・赤0 | A 46.9→74.2／B 60.7→67.2 | step3 |
| audit（744件） | 0/1 | 流していない（B に赤が無いため） | 300秒で打ち切り・666件通過・赤0 | B 29.4→62.5 | step3 |
| 画像比較（54件） | 2/2 | 2回とも 54 passed・差分0 | 2回とも 50 passed・**同じ4件に差分** | | step1 |

時間は、負荷の高い時間帯（16 コアで 50〜94）の1回ずつの値が多い。版の差を読むのは、同じ組で交互に流した回だけにした（全件は B2/A2 の B/A＝1.07＝揺れの範囲）。

### (2) 見込みが当たったか（step1 で測る前に固定した判定）

- **「すぐ通る形の遅れは消えた」→ 当たった。** toBeHidden は 118ms で、a-count（190ms）の 0.6 倍（基準は2倍以内）。1秒以上の長いタスクは0件。
- **「待つ形は残った」→ 当たった。** a-count に比べ、a-attr は 16.8 倍、a-text は 17.1 倍、d-missing は 27.0 倍（基準は5倍以上）。1.65.1 では写しの処理が細かいタスクに分かれ、1秒以上の長いタスクは出なくなった。それでも、ページの中の記録（並べ替え→rAF→setTimeout(0)）は a-count の約9〜11倍遅れる。1.65.1 の CPU プロファイルでも、aria と可視判定の関数（checkVisibility・isElementHiddenForAria・getCSSContent・toAriaNode・getTextAlternativeInternal）が JS の自己時間の約6割を占めた。

### (3) ブラウザの版

1.60.0：chromium 148.0.7778.96（r1223）・webkit 26.4（r2287）。1.65.1：chromium 159.0.8154.6（r1255）・webkit 27.2（r2388）。どちらも各版の `playwright-core/browsers.json` による（step1 の表）。

### (4) 画像比較の差分（版によるもの・4件）

- 1枚にまとめた画像：`/home/kuroko/kuroko/work/651-visual/visual-diff-1.65.1-all.png`。1件ずつの画像は同じ場所の `01.png`〜`04.png`。worktree の写しは `_local/651/visual-B-sheet/`。どの画像も、左から期待（1.60.0 の基準画像）・実際（1.65.1）・差分の順。
- 対象：`tests/visual/__screenshots__/06-settings-section-char-{390,768,820,1024}-linux.png` の4枚。差分の画素は 1368・2880・4021・1892。
- 中身は2種類。
  - 保存先の `<select>` のフォーカスの枠：1.60.0 は橙の枠、1.65.1 は通常の枠。タッチの端末の4幅すべて。
  - 820・1024 の「アカウント」「ログイン」のアイコン：1.60.0 の基準画像は点だけで描かれていない。1.65.1 では描かれる。
- 文字の描画の差は無い。B で2回とも同じ所に同じ画素数で出て、A では2回とも0件。

### (5) CI の見込み

- ブラウザは `npx playwright install --with-deps <chromium|webkit>`（ci.yml:121。origin/main 492ed66 の時点）で入る。入れた Playwright の版に合ったブラウザと、依存するシステムのライブラリ（webkit 27.2 が要る libavif16・libgav1・libyuv も）がそろう。container による版の固定は無い。
- setup-node は 22（ci.yml:36）。1.65.1 の engines は node>=20 なので問題ない。
- matrix は e2e・char・audit・webkit で、画像比較のレグは無い。基準画像の差は手元（e2e-diff-main の visual・各③の確認）だけに効く。
- 手元で見た限り、e2e（chromium）・char・audit には版による赤が無い。**webkit の 1.65.1 は手元で確かめられていない**（起動できなかった）。上げるなら、CI の webkit レグが全件を確かめる初めての場になる。

### (6) #640 の lint は残す

1.65.1 でも待つ形は重いまま（(2)）なので、`scripts/check-e2e-async-wait.mjs` の2つ目の検査（`findHeavyAriaWaits`）は、版に関係なく残す。

### 判断（推奨）：**保留**

理由：

1. **今の E2E では効き目が見えない。** 全件の時間は B/A＝1.07 で、揺れの範囲。1.65.1 で直るのは「すぐ通る形」だけで、大量の蔵書の spec でのこの形は、#640 の lint がもう禁じている。待つ形は 1.65.1 でも重い。
2. **切り替えに手間と危険がある。**
   - (a) webkit 27.2 は、この機械に無い libavif16・libgav1・libyuv を要る。入れないと、手元の webkit の E2E が全部起動しなくなる。入れるにはシステムの変更（`sudo apt install libavif16`）が要る。私用に展開して LD_LIBRARY_PATH で渡す手は効かなかった。
   - (b) 手元で webkit の 1.65.1 を確かめられていない。
   - (c) bookshelf の③が何本も同時に走っている。共有の node_modules を切り替える間、各イシューの node_modules の版と、main の基準画像がずれる。(4) の4枚が、版のせいで差分に出る。
3. 優先度は低い。

上げ直す条件（どれかがそろったら、このイシューの step5・6 の形で上げる）：

- ②が libavif16 の導入を認め、bookshelf の③が E2E を流していない時間がある。
- 新しい Playwright にしか無い直しや機能が要るようになった。
- 上流が待つ形の写しを直した（#41117 のように「最後の失敗の時だけ写す」）。その版なら (1) の効き目が大きくなる。

「上げない」は勧めない。いずれ上げる必要があり、ここまでの測り方と手順（`/home/kuroko/kuroko/work/651-tools/` に script を残した）がそのまま使えるため。

### ②が「上げる」と決めた場合の案

- **基準画像を更新する範囲**：(4) の4枚だけ（`06-settings-section-char-{390,768,820,1024}-linux.png`）。B の2回で毎回同じに出て、A では出なかった＝版によるものと確かめた分。ほかの 50 件は B でも通ったので触らない。
- **共有 node_modules（/home/sei/GitHub/bookshelf/node_modules・1.60.0）の切り替え**：
  1. 先に libavif16 を入れる（`sudo apt install libavif16`。②の判断）。1.60 の webkit 26.4 には影響しない。
  2. bookshelf の③が E2E を流していない時間を選ぶ。`ps` で `/home/kuroko/worktrees/bookshelf/*` の playwright が無いことを確かめる。
  3. 同じ時間のうちに、lock と4枚の push（step6）と共有 node_modules の切り替えを続けて行う。切り替えの手順：origin/main の package.json と lock から一時ディレクトリで `npm ci` → 共有の node_modules を `node_modules.prev-1.60.0` へ mv（消さない）→ 新しいものを mv で置く → 既定のキャッシュへ `npx playwright install chromium webkit`。
  4. 走っている各 worktree の node_modules は、その worktree の実ディレクトリ（#651 では btrfs・179M。作られ方は未確認）なので、切り替えだけでは変わらない。各③は、rebase の後に 1.65.1 の node_modules に入れ替えるまで、(4) の4枚が版のせいで差分に出る。これをプロジェクトノートに書いて知らせる。
  5. 戻し方：共有は `node_modules.prev-1.60.0` を mv で戻す。main は lock と4枚の commit を revert する。

### 上流（microsoft/playwright）

GitHub の検索 API（認証なしで読むだけ）で調べた。

- **#41098**「expect() renders a full-page aria snapshot on every poll — concurrent assertions on hidden elements saturate the page main thread (1.60 regression)」（2026-06-02）は同じ原因の報告。原因の変更は #40390（commit d8378c365）。2026-06-04 に、メンテナが **not planned** で閉じた。理由は「同時に待つ使い方には、まだ向いていない。順番に待つなら問題は起きない。写しは失敗の近くで作りたい」。
- **#41117**「fix(expect): render expect error aria snapshot lazily on final failure」は、メンテナ自身の直しの PR。**merge されずに** 2026-06-04 に閉じた。
- 1.65.1 には「通った回は写さない」形が入っているが、どの PR で入ったかは見つけていない（未確認）。
- 関連：#43057（isVisibleTextNode の Range の取り残し）は v1.64 で直っている。

**要否：報告する価値はある（急がない・推奨度は中）。** 我々の数字は、閉じた理由の「順番に待つなら問題は起きない」と合わない。大きなページでは、順番に1つ待つだけでも1回約3秒かかる。ただし、我々の E2E は lint でこの形を避けているので急がない。出すなら、新しい issue で #41098・#41117 を参照する。出す前に、bookshelf を使わない最小の再現（HTML 1つと spec 1つ）を作り、数字を取り直す（今の数字は bookshelf のページの値）。**投稿はしていない**（外への公開なので、ハヘロの承認が要る）。

文案（英語・投稿前に最小の再現を足すこと）：

```
Title: [Bug]: expect() still renders a full-page aria snapshot on every failing poll in 1.65 — one sequential toHaveAttribute on a large page takes ~3 s (follow-up to #41098)

### Version
1.65.1 (also 1.60.0–1.64.x; not in 1.59.1)

### Context
#41098 reported that InjectedScript.expect() renders an aria snapshot on every poll (introduced in #40390). It was closed because sequential assertions do not suffer, and #41117 (render the snapshot lazily on the final failure) was closed without merging. In 1.65.1 the snapshot is skipped when the matcher passes (`core.matches !== options.isNot ? void 0 : this._ariaSnapshotForExpect(...)`), so assertions that pass on the first poll are fast again. Assertions that have to wait still render a full-page snapshot on every failing poll, and on a large page this is slow even when only one assertion runs at a time.

### What we see (one assertion at a time)
Chromium, ~900 list items, CPU throttled 6x via CDP, viewport 390x844. After changing a sort order, we wait for a hidden marker `<div id="m" hidden>` to get data-done="1" (set in requestAnimationFrame -> setTimeout(0) after the re-render). 5 runs each, median wall time of the await:

| assertion | 1.60.0 | 1.65.1 |
|---|---|---|
| expect(m).toHaveAttribute('data-done', '1') | 5190 ms | 3189 ms |
| expect(m).toHaveText('1') | 4999 ms | 3242 ms |
| marker not in the DOM yet + toHaveAttribute | 5604 ms | 5122 ms |
| expect(m).toBeHidden() (passes on the first poll) | 2801 ms | 118 ms |
| expect(page.locator('#m[data-done="1"]')).toHaveCount(1) | 157 ms | 190 ms |
| expect.poll(() => m.getAttribute('data-done')).toBe('1') | 344 ms | 321 ms |

With 1.65.1 the page's own rAF -> setTimeout(0) after the change is delayed to ~3.3 s (vs ~0.3 s with toHaveCount). A CPU profile of the 1.65.1 toHaveAttribute case shows checkVisibility, isElementHiddenForAria, getCSSContent, toAriaNode and getTextAlternativeInternal at ~60% of JS self time; none of them show up for toHaveCount.

### Expected
A single sequential web-first assertion should not slow the page down much more than toHaveCount or expect.poll, regardless of DOM size.

### Suggestion
Render the aria snapshot only for the final failure (as in #41117), or allow turning it off (for example via expect.configure).

### Repro
<minimal standalone repro: one HTML page with N list items and a hidden marker, plus one spec — to be added>
```

（投稿する時は、#43057 の投稿者のように「AI の助けで書いた・数字は実測」と一言添えるかどうかも、ハヘロが決める。）
