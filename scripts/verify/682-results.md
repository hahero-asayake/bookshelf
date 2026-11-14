# イシュー#682 結果：PC 幅で保存の失敗・未保存の帯が記事エディタの見出しのボタンを覆う

## §1 着手確認・before の実測・原因・同種の洗い出し・直し方の案（step1・2026-11-14）

### 1-0 着手確認

- #673 は main に入っている（題で確認・`git log origin/main --grep='Issue: #673'`）：ccc5b2d test・68f2c2b test（測りの describe (f) を外す）・5e0048b docs（ui-standards §2-12）。#660（d7d6924 fix）・#671（eceadfb fix＝印 data-ov-below-notice）も入っている。
- worktree issue/682 は origin/main 95d6f9d（20:06 の fetch）で測った。下の行番号はこの版のもの。
- #673 の証拠（tmp/673/chromium・gate-webkit の png と json）は `tmp/682/from-673/` に写した（#673 完了後に消えても読める）。#673 の native click の迂回つきの測り (f) は 68f2c2b で spec から外れている＝戻す迂回は残っていない。

### 1-1 before の実測（帯あり＝ハブへの書き込みを失敗させ「再試行」の行を出した状態）

- 測りの spec は commit しない（`tmp/682/measure/zz-682-measure*.spec.js` に移した）。入口は status-bar-over-faces.spec.js の (a) と同じ帯の出し方＋記事の一覧→「新規」（#art-new）。
- 流し方：`GATE_WEBKIT=1 PORT=8182 npx playwright test tests/e2e/gate/zz-682-measure*.spec.js --project=chromium --project=gate-webkit`（各回 passed・36〜55秒）。
- chromium と gate-webkit（iPhone 13 の UA）の値は同じ（題の欄だけ 34.6 / 36.1）。

| 幅・帯 | 帯の下端（--status-urgent-h） | 面の箱 #publish-pages-modal | .modal.show の align-items | 中身 .art-modal-content top–bottom（高さ） | 見出しのボタンの上端 | 中心を取るもの | 通常の click |
|---|---|---|---|---|---|---|---|
| 1280×800・帯あり | 59.4（60px） | 60–800（印あり・size full） | center | **30–830（800）** | **34** | 帯の行 `div.status-row.status-warn` | **NG**（編集・その他・完了とも timeout） |
| 1280×800・帯なし | -（0px） | 0–800 | center | 0–800（800） | 4 | ボタン自身 | OK |
| 390×844・帯あり | 78.4（79px） | 79–844 | stretch | 79–**923**（844） | 91 | ボタン自身 | OK |
| 390×844・帯なし | -（0px） | 0–844 | stretch | 0–844（844） | 12 | ボタン自身 | OK |

- PC 幅・帯ありで帯の下に入る操作部品（chromium・gate-webkit とも同じ）
  - 閲覧状態：← 記事の一覧へ戻る #art-back・題 #art-title・編集 #art-mode-edit・その他 #art-more-btn（4件中4件）
  - 編集状態：← #art-back・題・見た目 #art-look-btn・公開 #art-publish-header・完了 #art-mode-done・その他（見えている10件中6件）
- **狭い幅（390×844）は上端は帯の下に揃うが、下端が 923 で画面（844）の外に 79px（＝帯の高さ）出る**（②の指示の数値）。外枠 .modal は overflow-y:auto なので、面ごとスクロールしないと下の 79px が見えない。
- 画像（tmp は gitignore）：`tmp/682/<chromium|gate-webkit>/pc-art-editor-band-before.png`（閲覧状態）・`pc-art-editor-band-before-editmode.png`（編集状態）・`pc-art-editor-bandnone-before.png`・`narrow-art-editor-band-before.png`・`narrow-art-editor-bandnone-before.png`。値の JSON は同じ場所の `*.json`。

### 1-2 原因（computed と一致する規則で確かめた）

1. 帯の仕組み（#660/#671）は、面の**箱**を下げる：css/bookshelf.css:7330 `body.has-status-urgent [data-ov-below-notice] { top: var(--status-urgent-h); bottom: 0; height: auto; }`。記事エディタの面にも印は付いていて、箱は 60–800 に下がっている（実測）。
2. ところが中身の高さは画面に固定されたまま：中身に当たる height の規則は `.art-modal-content.art-editing { height: 100dvh }`（css:4770）と `.ov-full { height: 100dvh }`（css:8433）。狭幅ではさらに `#publish-pages-modal .art-modal-content.art-editing { height: 100dvh }`（≤600px・css:8267）。≤900px の `.modal-content { height: 100%; max-height: 100% }` は、これらに負けている。中身の class は `modal-content publish-pages-content art-modal-content art-editing ov-full`。
3. 箱（740）より中身（800）が高い。PC の `.modal.show`（css:3025）は align-items:center なので、はみ出しが上下に半分ずつ（30px）出て、中身の上端が 60−30=30 になり、見出しのボタン（34）が帯の下に入る。上へのはみ出しはスクロールでも届かない（scrollTop 0・scrollHeight 770）。
4. 狭幅（≤900px の css:8007）は align-items:stretch なので上端は箱に揃い、はみ出しが下側に出る（下端 923）＝同じ原因の別の現れ。
5. `.art-editing` は article-editor.js:421 で付き、同じ時に setSize('publish-pages-modal','full')（:423）で `.ov-full` も付く（外す時は :402 と lg）＝記事エディタ固有の height:100dvh は `.ov-full` と重複している。
6. 漏れた理由：既存の守り status-bar-over-faces.spec.js は viewport 390×844 固定（:16）で、PC 幅は測っていない。狭幅では上端が揃うので、見出しの重なりとしては出ない（下端のはみ出しは測る項目が無かった）。

### 1-3 同種の洗い出し（PC 幅・帯あり。狭幅は下端）

| 面 | 段階 | 中身の高さの規則 | PC 1280×800・帯あり | 狭幅 390×844・帯あり | 判定 |
|---|---|---|---|---|---|
| 記事エディタ #publish-pages-modal（編集中） | full | .art-modal-content.art-editing・.ov-full・≤600px の #publish-pages-modal … 各 100dvh | 中身 30–830・見出し6件が帯の下・click NG | 下端 923（79px 外） | **本件** |
| 長文メモ #book-memo-modal（book-detail.js:637/651） | full | .ov-full 100dvh | 中身 30–830・最上の操作部品の上端 51（帯の下端 59.4 より上・中心は帯の外で押せる） | 下端 923（79px 外） | **同系統**（見出しの上端が帯で欠ける・下端が外） |
| 記事のプレビュー #pp-preview-modal（article-editor.js:3908・sizeTarget .pp-preview-dialog） | full | .ov-full 100dvh（≤760px は .pp-preview-dialog 100vh・css:5272） | **未実測**（測りの入口から開けなかった） | 未実測 | 構造は同じ（#pp-preview-modal の直下の .pp-preview-dialog に .ov-full）＝同じ規則に入る見込み |
| 記事の一覧 #publish-pages-modal（一覧） | lg | max-height 90vh | 中身 229.5–630.4・帯の下 0件 | - | 対象外 |
| 設定 #settings-modal | lg | （箱に合う） | 中身 60–800（740）・帯の下 0件 | - | 対象外 |

- size full の面は上の3つだけ（`size: 'full'`・`setSize(…,'full')` の全数：article-editor.js:423・:3908、book-detail.js:637・:651）。
- 帯が複数行になった時に、max-height 90vh の lg・md の面が上へはみ出すか（計画 4-(iii)）は、時間内に測れなかった（未実測）。計算では、1280×800 で帯が 1 行（60px）なら、箱 740−余白 64=676 に対して 90vh=720 で上へ 22px はみ出すが、余白 32px の内側に収まる（上端 70）。帯が約 120px を超えると、上端が帯の下端より上に来る計算になる。PC 幅の帯は 1 行（実測 59.4）。

### 1-4 直し方の案（②に選んでもらう・推奨は案A）

- **案A（推奨）**：帯の節（css:7311〜7334）に、全画面の段階を印に連動させる規則を 1 つ置く：`body.has-status-urgent [data-ov-below-notice] > .ov-full { height: 100%; }`（中身を下げた箱に合わせる）。あわせて、記事エディタ固有の height:100dvh（css:4770 と ≤600px の css:8267）は `.ov-full` と重複しているので外し、段階の規則に寄せる（帯が無い時は `.ov-full` の 100dvh のまま＝見た目は変わらない）。
  - 一時的に当てた実測（`!important` 付きで当てて測った・コードは変えていない）：PC 幅は中身 60–800（740）・見出しの上端 64・帯の下の操作部品 0件・編集→その他（メニューが開く）→完了が**通常の click で OK**（chromium・gate-webkit）。狭幅は中身 79–844（765）で下端のはみ出しが消える（記事エディタ・長文メモとも）。
  - 長文メモ・プレビューも同じ規則で直る（面ごとに書かない）。
  - 画像：`tmp/682/<chromium|gate-webkit>/pc-art-editor-band-ruleA-editmode.png`（案A を当てた編集状態）・`narrow-art-editor-band-ruleA.png`。1回目の測りの `pc-art-editor-band-ruleA.png` は、Escape で面が閉じた後に撮っていて使えないので、`tmp/682/invalid-escape-closed/` に分けた（値も使っていない）。
- 案B：各所の高さを `calc(100dvh - var(--status-urgent-h, 0px))` にする。`--status-urgent-h` は帯が無い時 0px（js/bookshelf.js:5448 `_syncStatusUrgent`）なので見た目は変わらないが、`.ov-full`・css:4770・css:8267・css:5272 の 4 か所に書く＝面ごとに書く形に近い。
- 案C：全画面の時だけ PC の `.modal.show` を align-items:stretch にする。見出しは出るが、下端が帯の分だけ画面の外に出る（狭幅の今の状態と同じ）＝不採用の見込み。

## §2 守りの spec（赤→緑）と直し（step2・2026-11-14）

### 2-1 直したこと（②が step1 の tp で選んだ案A・!important なし）

- css/bookshelf.css:7334（帯の節）に1つ足した：`body.has-status-urgent [data-ov-below-notice] > .ov-full { height: 100%; }`＝全画面の段階の中身を、帯の下に下げた箱（帯の下端〜画面の下端）に合わせる。面ごとの高さは書かない。
- 記事エディタ固有の `height: 100dvh` を外した：css:4770 `.art-modal-content.art-editing` と ≤600px の css:8271 `#publish-pages-modal .art-modal-content.art-editing`（どちらも `.ov-full` と重複。`.art-editing` と setSize full は article-editor.js:421/423 で同時に付き、:402/:403 で同時に外れる）。帯が無い時の高さは `.ov-full` の 100dvh のまま。
- 帯の節のコメント（css:7311〜）に、全画面の段階も中身の高さを箱に合わせる旨を足した。
- `?v=`：index.html の bookshelf.css を 2026111867 → 2026111893（origin/main の最大 2026111891・走っている worktree の最大 2026111892 より新しい）。sw.js の先読み一覧に bookshelf.css の版は無い。`check:version --range=origin/main..HEAD` は OK。
- 専用の回避（記事エディタだけの top ずらし等）は足していない。js は変えていない。

### 2-2 守りの spec（tests/e2e/status-bar-over-faces.spec.js の (g)）

- PC 幅 1280×800（describe「(g) PC 幅 1280×800 (イシュー#682)」・:515〜）
  - 記事エディタ：閲覧状態で中身と見えている操作部品が帯の下端以上にあることを確かめ、その他（メニューが開く→もう一度押して閉じる）・編集を通常の click で押す。編集状態でも同じ位置の確かめをする。本棚ブロックを足し、その他→「表示幅を切り替えて見る」でプレビューを開き、プレビューも位置を確かめて閉じる（閉じる）。完了・編集・公開も通常の click で押す。
  - 長文メモ：位置を確かめ、見出しのボタンを通常の click で押す。
  - 帯が無い時：記事エディタの中身の箱が 0〜innerHeight（見た目不変の守り）。
- 狭幅 390×844（describe「(g) 狭幅 390×844 (イシュー#682)」・:564〜）
  - 帯あり：記事エディタと長文メモの中身の下端が innerHeight 以下で、上端と操作部品が帯の下端以上。
  - 帯が無い時：記事エディタの中身の箱が 0〜innerHeight。webkit の 100dvh は 843.98 と端数が出る（直す前も同じ）ので 0.5px まで許す。
- 押せたかの判定：通常の `locator.click()`（force・evaluate・dispatchEvent の迂回なし）を使い、ボタン自身の capture の click の数が 1 であることで確かめる。押した後に面が閉じても同じ要素を数えるよう印（data-click682）を付ける。Escape は面ごと閉じるので使わない。
- `setupSaveFailure` は、PC 幅（901px 以上）では詳細を閉じない（詳細は面ではなく列）。390 幅の (a)〜(e) は今までどおり。共通の起動は `bootHub` に分けた。
- プレビュー：step1 で開けなかった理由は、`_artPreview` がブロック0件の時に「ブロックを1つ以上追加してください。」で止めるため。しかも見出しの #art-preview は今の画面では出ていない（今の入口は、その他→#art-width-preview）。引き出しの「表示中のN冊を追加」でブロックを作ってから開けたので、実測して spec に入れた（未実測ではなくなった）。

### 2-3 赤→緑

| 版 | (g) chromium | (g) gate-webkit | 内容 |
|---|---|---|---|
| 直す前の CSS（63b11a6 の spec） | 3 failed・2 passed | - | PC の記事エディタと長文メモで「中身の上端 30 が帯の下端 59.375 より上」、狭幅で「中身の下端 923 が画面の下端 844 より下」。帯なしの2件は緑 |
| 直した後の CSS・spec の直し後 | 5 passed | 5 passed | - |
| 直す前の CSS＋最終の spec（CSS を一時的に戻して確かめた・戻した後の差分は 4e04582 と同じ） | 3 failed・2 passed | - | 同じ3件が同じ理由で赤 |

- status-bar-over-faces.spec.js 全件（chromium・gate-webkit）：直した後の1回目は 49 passed・5 failed で、落ちた5件はすべて (g) の書き方（#art-preview が出ていない・数える要素の取り違え・webkit の端数）だった。(a)〜(e) の 44 件はこの時点で緑。最終の spec での全件の結果は 2-5。
- vitest（`npm test`）：80 files・1199 passed・2 todo（exit 0）。

### 2-4 直した後の値（step1 と同じ測り・`tmp/682/after/<project>/*.json`・画像は `*-after.png`）

| 幅・帯 | 中身 top–bottom（高さ） | 見出しのボタンの上端 | ボタン中心 | 直す前 |
|---|---|---|---|---|
| 1280×800・帯あり（59.4） | 60–800（740） | 64 | ボタン自身 | 30–830（800）・34・帯の行 |
| 1280×800・帯なし | 0–800（800） | 4 | ボタン自身 | 同じ（0–800・4） |
| 390×844・帯あり（78.4） | 79–844（765） | 91 | ボタン自身 | 79–923（844）・91 |
| 390×844・帯なし | 0–844（844・webkit は 843.98） | 12 | ボタン自身 | 同じ（0–844・12・webkit 843.98） |

- chromium・gate-webkit とも同じ値（帯の下端だけ 78.4 / 78.3）。

### 2-5 最終の確かめ（48dd1b3 の時点）

- `GATE_WEBKIT=1 PORT=8182 npx playwright test tests/e2e/status-bar-over-faces.spec.js --project=chromium --project=gate-webkit --workers=6`：**54 passed**（2.0分・(a)〜(e) の 44 件と (g) の 10 件）。
- `npm run lint`：12 本中 0 本失敗。`npm test`：1199 passed・2 todo。`check:version --range=origin/main..HEAD`：OK。
- 載せ直し（origin/main への rebase）は step4 で行う（この時点の基準は 95d6f9d。origin/main は fb3f3b9 まで進んでいる）。

## §3 回帰の確認：e2e-diff-main（step3・2026-11-14）

- 流し方：`node scripts/verify/e2e-diff-main.mjs --base=95d6f9d --port=8182 --workers=8 --out=/home/kuroko/kuroko/work/682-e2e-diff`。base は作業の分かれ目 95d6f9d に固定した。origin/main はその後 #675・#679 の分だけ進んでいて、比べると本件と関係のない差が混ざるため。work は HEAD 830d178。20:27〜20:37（約10分）で最後まで終わった（未完ではない）。
- 結果一式：`/home/kuroko/kuroko/work/682-e2e-diff/report.md`（json と log も同じ場所）。

| 区分 | E2E (playwright) | Unit (vitest) |
|---|---|---|
| 新しく落ちた | 1件（下）＝本件由来ではない | 0件 |
| 新しく通った | 0件 | 0件 |
| 両方で落ちた/既存の問題 | 0件 | 0件 |

- 画像の差分（playwright.visual.config.js・work 側のみ）：**0件 / 54件**＝帯が無い時の見た目は変わっていない。
- 新しく落ちた1件：`sync-conflict-overwrite.spec.js:76`「Asayake ハブ: 書き込みで衝突した時に「この端末の内容で保存先を上書き」を選ぶと…」。work 側では、1回目と流し直し3回の全部で `private/notes.json に「#645 端末Bが古い版のまま書いた短文メモ」が 20000ms 以内に届かなかった` で落ちた。base 側の1回は通っていた。
  - 本件由来かの切り分け：同じ1本を `--repeat-each=4` で流した（20:38〜20:39）。
    - 直した CSS（830d178）：ハブの回は4回中4回落ち、GitHub の回は4回中4回通った。
    - CSS だけ直す前（95d6f9d の css/bookshelf.css）に戻した場合：同じくハブ 4/4 落ち・GitHub 4/4 通り（戻した後は 830d178 の CSS に戻した）。
    - 直した CSS と直す前の CSS で結果が同じ＝本件の CSS は関係しない。本件は js を変えていない。
  - 原因の見立て：この1本は #679（「sync-conflict-overwrite.spec.js のハブの1本が main の CI で赤」）が扱った揺れ。#679 は、ハブの一覧の控え（ETag の表）の3秒の境目が原因と特定し、7ce3837 fix・49bb4b0 test で直した。どちらも base 95d6f9d より後に origin/main へ入っている（`merge-base --is-ancestor 6539649 95d6f9d` は no、origin/main には有り）。base 側の1回が通ったのは境目の揺れによる。
  - 扱い：本件では直さない。step4 で origin/main へ載せ直すと #679 の直しが入るので、載せ直した後にこの spec をもう一度流して確かめる。
