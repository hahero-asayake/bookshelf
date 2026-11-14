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
