# イシュー#728 の記録：画像比較（Visual）の基準画像が CI で全件差分になる件

## §1 step1：原因を確かめた（2026-11-22 07:02〜07:10 JST・リポジトリは変えていない・push していない）

### 結論

- **原因は日本語の書体の違い。** CI のランナーでは日本語が WenQuanYi Zen Hei（中国語の書体）で描かれる。基準画像を撮った手元（homelab・Ubuntu 24.04.5）では Takao Pゴシックで描かれる。
- アプリの書体は `css/bookshelf.css:206` の `font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`。Linux ではどれも無いので、日本語の字は OS の既定の書体（fontconfig の `sans-serif:lang=ja`）になる。
- **Playwright 公式コンテナで、CI の差分を手元で再現できた。** 54 件のうち 42 件は、差分の画素数が CI（run 4）と1画素まで同じだった。残りの 12 件も差は 0.2〜10.9%。
- 差分は全 54 件で「字の形が違う」。そのうち 14 件は、字の幅が変わって折り返しが変わり、下の部分が縦にずれている。アンチエイリアスだけの差、画像の大きさの差は 0 件。

### 1-1 CI の件数（run 画面の HTML で読んだ）

| run | commit | ランナー | Playwright | 結果 |
|---|---|---|---|---|
| Visual run 3 | dd0ccd9 | ubuntu-24.04 | 1.60.0 | 差分 54/54 件（713-results.md L49-51） |
| Visual run 4（44953432551） | ef72c7b | ubuntu-26.04 | 1.65.1 | 差分 54/54 件。1〜11%・3,030〜36,112px。一番大きいのは char-390 のホームの編集（36,112px） |

- 比率は Playwright の文の丸め（小数2桁）なので、比べる時は画素数を使った。
- 見出しの 12 枚（05/06-*-header）は CI では比べられていない。同じテストの全画面の比較が先に落ちて、テストがそこで止まるため。
- 差分画像の artifact は認証が要り、取り出せない。そのため手元のコンテナで再現した。

### 1-2 書体（`fc-match sans-serif:lang=ja`）

| 環境 | 結果 | 出典 |
|---|---|---|
| CI run 4（26.04・fonts-noto-cjk を入れる前） | WenQuanYi Zen Hei | run 4 の annotation「フォント確認(導入前)」 |
| CI run 4（fonts-noto-cjk を入れた後） | WenQuanYi Zen Hei（変わらない） | 同「フォント確認(導入後)」 |
| 手元 homelab（24.04.5） | Takao Pゴシック（fonts-japanese-gothic.ttf） | `fc-match` |
| 公式コンテナ v1.65.1-resolute | WenQuanYi Zen Hei | run.log の1行目 |
| 公式コンテナ v1.65.1-resolute ＋ fonts-noto-cjk 1:20240730 | WenQuanYi Zen Hei（変わらない） | 同 |
| 公式コンテナ v1.65.1-noble | WenQuanYi Zen Hei | 同 |

- Playwright の `--with-deps` は fonts-wqy-zenhei を入れる。fonts-noto-cjk を足しても既定は WenQuanYi のまま。CI の visual.yml で fonts-noto-cjk を入れても、書体は揃わない。
- 手元の fonts-noto-cjk は 1:20230817、26.04 は 1:20240730。

### 1-3 公式コンテナで再現した

- 流し方：ホストで `python3 -m http.server 8128`、コンテナは `docker run --rm --init --ipc=host --user 1001:1001 -e HOME=/tmp --network host -v <worktree>:/work -w /work <image> npx playwright test -c playwright.visual.config.js`（PLAYWRIGHT_BASE_URL=http://localhost:8128）。手順は `_local/728/run-visual.sh`。
- コンテナの中にも python3 がある（resolute は 3.14.4、noble は 3.12.3）。
- 1回は 20 秒ほど。

| 流した環境 | 差分 | CI run 4 と同じ画素数 | CI との差が ±10% 以内 |
|---|---|---|---|
| resolute（1回目） | 54/54 | 42 件 | 53 件 |
| resolute（2回目） | 54/54 | 1回目と 54 件とも同じ画素数 | — |
| resolute ＋ fonts-noto-cjk | 54/54 | resolute と 54 件とも同じ画素数 | — |
| noble | 54/54 | resolute と 54 件とも同じ画素数 | — |

- コンテナの中の OS の版（24.04/26.04）でも、fonts-noto-cjk の有無でも、結果は1画素も変わらない。同じコンテナで2回流しても同じ。
- CI とずれた 12 件：設定の1節（6端末とも CI より 13px 少ない）と記事の編集（6端末で CI より 113〜378px 少ない・char-1440 で −10.9%）。CI のランナーにだけある何か（入っている書体などの違い）が効いている見込み。突き止めていない。
  - **step2 への含み**：コンテナで撮った基準画像でも、CI を素のランナー（`runs-on` だけ）で流すとこの 12 件は差が残る見込み。CI もコンテナの中（`container:`）で流す必要がある。

### 1-4 差分の分類

差分画像を Read で6枚見た（char-390 のホームの編集 diff・expected・actual、char-390 の記事の一覧 diff、char-1440 の本の詳細 diff ほか）。全 54 件は、帯ごとの縦のずれを探すスクリプト（`_local/728/shift.cjs`）で分けた。

| 分類 | 件数 | 例 |
|---|---|---|
| 字の形が違う（位置は同じ・書体が別） | 54（全部） | char-1440 の本の詳細：本の題・見出し・ボタンの字だけが赤。英字（AsayakeBookshelf）も違う |
| 上のうち、折り返し・行の高さが変わって下が縦にずれる | 14 | char-390 のホームの編集：「ウィジェット追加・完了」が「ホーム」の横に収まらず次の行へ落ち、下が全部 40px 下がる（36,112px の大半）。char-390 の記事の一覧：説明文の行数が変わり 20〜69px 下がる |
| アンチエイリアスだけ | 0 | — |
| その他（画像の大きさ・スクロールバー・ビューポート） | 0 | 54 件とも期待と実際の画像の大きさが同じ |

縦にずれた 14 件：ホーム（1024）、ホームの編集（390・1024）、引き出し（390・768・820・1024）、本の詳細（390・768・820）、記事の一覧（390・768・1024）、記事の編集（390）。−3〜8px の小さなずれは、行の高さの違いと見ている。

- 見た画像と表：`/home/kuroko/kuroko/work/728-visual/`（4テスト × expected/actual/diff と compare.tsv・shift.tsv）。
- 生の結果：`_local/728/{resolute-cur,resolute-cur2,resolute-noto,noble-cur}/`（visual-results.json・compare.tsv）。

### 1-5 step2 への申し送り

- 書体を固定すれば（(c)）、14 件の縦のずれも、40 件の字の形の差もまとめて消える見込み。ただし CI の 12 件のずれ（1-3）が書体の固定で消えるかは未確認。
- (a) コンテナで撮るなら、CI もコンテナの中で流す（`container:`）。手元の素の環境（Takao）で流すと 54/54 件が差分になる＝e2e-diff-main.mjs の既定の visual がそのままでは使えなくなる。

## §2 step2：方針案を手元で測って比べた（2026-11-22 07:10〜07:13 JST・リポジトリの基準画像は変えていない）

測り方：`_local/728/drive-step2.sh` で順に流した（1回 10〜25 秒）。書体の固定と見逃しの確かめは、`bootApp` の最後に一時の `addStyleTag` を足して行った（`_local/728/step2-spec-temp.patch`・commit しない・測った後に `git checkout` で戻し、`git status` が空なのを確かめた）。書体の固定は `*, *::before, *::after { font-family: "Noto Sans CJK JP" !important }`（tests/audit/boot.js の PIN_CSS と同じ書体）。撮った画像は `_local/728/{a-base,c-base,d-base}/`。

### 2-1 測った数

| 案 | 撮った所 | 流した所 | 差分 | 残る差の画素数 |
|---|---|---|---|---|
| (a) コンテナで撮る | resolute | resolute ×3 | **0/54・0/54・0/54** | 0 |
| (a) | resolute | 手元の素のまま（Takao） | **54/54** | 書体が違う（§1 と同じ大きさ） |
| (c) 書体を固定 | 手元（fonts-noto-cjk 1:20230817） | 手元（もう1回） | 0/54 | 0 |
| (c) | 手元 | resolute＋fonts-noto-cjk 1:20240730 | **39/54** | 43〜2,797px（390幅で最大 2,517px＝0.76%） |
| (d) 書体を固定してコンテナで撮る | resolute＋noto | resolute＋noto ×2 | **0/54・0/54** | 0 |
| (d) | resolute＋noto | 手元（書体は固定） | **38/54** | 43〜2,797px |

- 撮り直した (a) の画像は 66 枚とも、今の基準画像とバイトが違う。
- 書体を固定しても、手元とコンテナの差は消えない（39 件・最大 0.76%）。fonts-noto-cjk の版（20230817 と 20240730）か、描画の設定（ヒンティング等）の違いとみている。突き止めていない。
- **同じ環境で撮って同じ環境で流す限り、差分は 0（(a) も (d) も）。環境をまたぐと、書体を固定しても誤検知が残る。**

### 2-2 見逃しの確かめ（(a) の基準画像・resolute で流した）

| 一時の変化 | 大きさ | 拾えた数 |
|---|---|---|
| 「あ」を1文字足す（14px） | 100px ほど | **0/54**（今の閾値 maxDiffPixelRatio 0.1% より小さい） |
| 40×24px の青い四角を足す | 最大 960px | **16/54**（390・768 幅の 8 画面ずつ。820 幅以上は 0.1% が 960px を超えるので拾えない） |

- 1文字の見逃しは、今の閾値（0.1%）そのものの限界。どの案を採っても変わらない。(a)/(d) は閾値を変えないので、見逃しは今と同じ。
- (b) と (c) は閾値を広げる必要があるので、見逃しが増える（下の表）。

### 2-3 比較表

| 軸 | (a) コンテナで撮る | (b) 許容差だけ | (c) 書体を固定＋許容差 | (d) 書体を固定＋コンテナで撮る |
|---|---|---|---|---|
| 誤検知（測った数） | 同じコンテナ同士は 0/54 ×3 | 許容差を 11% にすれば 0 | 手元⇔コンテナで 39/54。0 にするには、390 幅で maxDiffPixelRatio 0.8% 程度が要る | 同じコンテナ同士は 0/54 ×2 |
| 見逃し | 今と同じ（閾値 0.1%） | 11% 以上（run 4 の最大は char-390 ホームの編集の 10.97%）にすると、#512 の 0.097%、#511 の 1.3〜2.1%、四角 960px をすべて見逃す | 0.8% にすると、#512 の 0.097% と 390 幅の四角（0.29%）を見逃す。#511 の 1.3〜2.1% は拾える | 今と同じ |
| 手元での更新 | `docker run … mcr.microsoft.com/playwright:v1.65.1-resolute npx playwright test -c playwright.visual.config.js -g "<テスト名>" --update-snapshots`（下の 2-4） | 今と同じ | 今と同じ（手元の素のまま撮る） | (a) と同じ＋コンテナで fonts-noto-cjk を入れる（apt で 20 秒ほど増える） |
| e2e-diff-main.mjs（全③の push 前） | 手元の素のままでは **54/54 が誤検知**になる。visual をコンテナで流すように直す。docker が無ければ1行の警告を出して飛ばす | 直さなくてよい | 直さなくてよい（ただし手元同士の比較なので、CI とは別の基準になる） | (a) と同じ（手元の素のままでは 38/54 が誤検知） |
| 版を上げる時 | イメージのタグ（visual.yml・e2e-diff-main.mjs・README）を package.json の版に揃え、基準画像 66 枚を撮り直す。揃っているかを tests/unit で検査する | 何もしない | 版で字の形が変わると撮り直す（#713 の4枚と同じ） | (a) と同じ |
| CI の時間 | run 4 は全体で 1分46秒。コンテナ（3.8GB）の pull が増え、`playwright install --with-deps` と fonts-noto-cjk の apt が減る。未計測 | 今と同じ | 今と同じ | (a) と同じ＋apt |
| CI で差分 0 になる見込み | 高い（CI も `container:` で同じイメージ） | 0 にはなるが、比べる意味がほぼ無い | 低い（39/54 は許容差でしか消せない） | 高い |

### 2-4 推奨：(a) コンテナで撮る

- 誤検知を 0 にできて、閾値を変えない（見逃しが今より増えない）のは (a) と (d) だけ。
- (d) は (a) に書体の固定と apt を足すだけで、得るものが無い。同じコンテナの中なら、書体は WenQuanYi のままでも決まった絵になる（(a) で 3 回とも 0）。
- 書体を固定すると、アプリの実際の書体の並び（`'Segoe UI', … sans-serif`）が絵に出なくなる。(a) はそれを変えない。
- 費用：e2e-diff-main.mjs の visual をコンテナで流すように直す必要がある。docker が無い所では1行の警告を出して飛ばす（②の申し送りどおり）。

(a) の実装で触る所（step3 の見込み）：
- visual.yml：job に `container: mcr.microsoft.com/playwright:v1.65.1-resolute` を足す。`playwright install --with-deps` と fonts-noto-cjk の step は外す。
- e2e-diff-main.mjs：visual を `docker run` で流す。docker が無い・イメージが無い時は1行の警告を出し、report に「スキップ（docker が無い）」と書く。
- README：更新手順の1段落（docker run のコマンド）。
- tests/unit：イメージのタグと package.json の @playwright/test の版が揃っているかを検査する（visual.yml・e2e-diff-main.mjs の両方）。
- 基準画像 66 枚の撮り直し：PNG だけの commit。

### 2-5 あわせて②に決めてほしいこと

1. **採る案**：推奨は (a)。
2. **「同じ commit で2回」の取り方**：re-run と workflow_dispatch は認証が要り、③は使えない。そこで visual.yml の job に `strategy.matrix: { attempt: [1, 2] }` を足し、同じ commit を別のランナーで2本流す案を出す。完了条件を満たした後に1本へ戻すかは、step4 の tp で決める。
3. **paths を足すか**：今は visual.yml だけ（L14-18）。推奨は `tests/visual/**` と `playwright.visual.config.js` を足すこと。基準画像やテストを変えた push でも CI で確かめられるようにするため。アプリの UI のファイル（js/・css/）は足さない（continue-on-error を外すかと一緒に step4 で決める）。

## §3 step3：(a) を実装し、手元で確かめた（2026-11-22 07:14〜07:18 JST・push していない）

②の決定（07:14）：(a) を採る。2回は matrix attempt [1, 2] で取る。paths に tests/visual/** と playwright.visual.config.js を足す。1文字を拾えないことを README に書く。
着手の時、#713 は done（DB）。origin/main（6e7ac8d）へ rebase した。

### 3-1 変えたもの（commit を3つに分けた）

1. b5896b7 `ci(visual): …`（仕組み・5ファイル）
   - `.github/workflows/visual.yml`
     - job に `container: mcr.microsoft.com/playwright:v1.65.1-resolute`（options `--user 1001 --ipc=host`）を足した。
     - `playwright install --with-deps` と fonts-noto-cjk の apt を外した。フォント確認は、コンテナの中の `fc-match` 1行にした。
     - `strategy.matrix.attempt: [1, 2]` を足した。artifact 名は `visual-results-<attempt>`。
     - paths に `tests/visual/**`・`playwright.visual.config.js` を足した。
   - `scripts/verify/visual-image.mjs`（新規）：イメージ名を package-lock.json の @playwright/test の版から決める。
   - `scripts/verify/visual-docker.mjs`（新規）：手元で、画像比較をコンテナの中で流す。
     - 作業ツリー・node_modules の実体・JSON の出力先を同じパスで mount し、`--user <自分>`・`--network host` で流す。
     - docker かイメージが無い時は、1行の警告（`docker pull <イメージ>` つき）を出し、終了コード 3 で終わる。自動では pull しない。
   - `scripts/verify/e2e-diff-main.mjs`：visual を visual-docker.mjs で流す。終了コード 3 の時は警告を出し、report の「画像の差分」に「スキップ（…）」と書く。
   - `tests/unit/visual-image.test.js`（新規）：次の2つを検査する。
     - package.json の範囲（^1.65.1）の版と lock の版（1.65.1）が同じ。
     - visual.yml の image が `visualImage()` と同じ。
2. 6f79748 `test(visual): 基準画像66枚を Playwright 公式コンテナ v1.65.1-resolute で撮り直す（画像だけ）`：PNG 66 枚だけ（PNG 以外は 0 件）。
3. docs（この節・tests/visual/README.md）：
   - 冒頭の説明と実行例を、visual-docker.mjs に変えた。
   - 「CIの扱い」を今の形に直し、閾値 0.1% の限界（1文字は拾えない）を1行書いた。
   - e2e-diff-main の節に、スキップの振る舞いを足した。
   - 「基準画像の更新手順」を1段落で書き直した。

アプリのコード（js/・css/・index.html）と playwright.visual.config.js・screens.spec.js は変えていない。

### 3-2 手元で確かめた

| 確かめ | 結果 |
|---|---|
| visual-docker.mjs `--update-snapshots`（撮り直し） | 54 passed・66 枚を書き換え |
| 同じコンテナで3回続けて流した | **54 passed・54 passed・54 passed**（全画面 54 件と、同じテストの中の見出し 12 枚を含む） |
| 見逃しの確かめ（40×24px の四角・一時の spec を当てて流し、戻した） | 16/54 で拾えた（step2 と同じ） |
| `e2e-diff-main.mjs --skip-e2e --skip-vitest --port=8128` | report「画像の差分」＝**0件 / 54件** |
| 同じものを docker の無い PATH で流した | 1行の警告「[visual] 警告: 画像比較をスキップする（docker が無い。取得は docker pull mcr.microsoft.com/playwright:v1.65.1-resolute）」が出て、report に「スキップ（…）」と書かれた。終了コードは 0 |
| visual-docker.mjs を docker の無い PATH で流した | 同じ1行の警告・終了コード 3 |
| `npm run lint` | 12 本中 0 本失敗 |
| `npm test` | 85 ファイル・1,261 件通過・0 件失敗（2 todo） |

- 記録は `_local/728/s3/`（drive.log・run{1,2,3}.log・e2ediff/report.md・e2ediff-nodocker/report.md・lint.log・test.log）。
- CI で同じになるかは step4 で確かめる。見込みは2本とも 0/54。

## §4 step4：push して、CI の Visual を同じ commit で2本流した（2026-11-22 07:19〜07:22 JST）

- push 前：fetch と rebase をした（origin/main 6e7ac8d のまま・変化なし）。`npm run lint` は 12 本中 0 本失敗、`npm test` は 1,261 件通過・0 件失敗。
- push：`BOOKSHELF_ISSUE=728 git push origin 07bd006:main`（6e7ac8d..07bd006・07:19:56）。pre-push の lint も 12 本中 0 本失敗。
- CI：Visual run 5（run id 44956190046・head 07bd006・ubuntu-26.04 の上で container mcr.microsoft.com/playwright:v1.65.1-resolute）。結論は Success。run 画面の HTML で読んだ。

| ジョブ | job id | visual 集計 | テストの所要 | フォント確認 |
|---|---|---|---|---|
| visual (1)（attempt 1） | 137004734636 | **差分 0/54 件** | 19.7 秒 | WenQuanYi Zen Hei |
| visual (2)（attempt 2） | 137004734991 | **差分 0/54 件** | 19.5 秒 | WenQuanYi Zen Hei |

- run 全体の所要は **1分10秒**（コンテナの pull・npm ci を含む。2本は並行）。前の run 4（ランナーの素の環境・install --with-deps と apt あり）は 1分46秒だった。ジョブごとの step の時間は、未認証の HTML には出ない。
- container の `--user 1001` でも、checkout・setup-node（cache npm）・npm ci は通った。
- 注記は、2本とも「Node.js 20 is deprecated」の警告だけ（actions/checkout@v4 などの版の話で、このイシューとは関係ない）。
- **判定：同じ commit を2本流して、2本とも差分 0/54 件で同じ結果になった。完了条件の「CI で安定して緑」を満たす。** 手元（§3-2・3回）とも同じ。
- 見出しの 12 枚は、同じテストの中で比べられて通っている（54 テストが全部 passed）。

### 4-1 ②に決めてほしいこと

1. **continue-on-error を外すか**
   - 推奨は「外す」（job と、visual の step の両方）。外すと、差分が出た push で Visual が赤になる。
   - 理由：手元3回と CI 2本の計5回で 0 件。環境はイメージで固定されている。
   - 外さない場合は、今までどおり件数を annotation で読むだけになる。
2. **matrix の2本を残すか**
   - 推奨は「1本に戻す」。同じイメージの中で2本とも同じ結果だった。時間は並行なので増えないが、ランナーを2倍使う。
   - 揺れを見張りたいなら残す。
3. **paths を広げるか・ci.yml の suite に入れるか**
   - 推奨は「visual.yml のまま、paths に js/**・css/**・index.html を足す」。UI を変えた push で基準画像の更新漏れ（#524 型）を CI で拾える。
   - ci.yml の matrix に入れると、container の指定がジョブ全体に効いて、他の suite と分けにくい。
   - 代わりの案：今の paths のまま（基準画像・テストを変えた時だけ）にする。

## §5 step5：②の決定を入れた（2026-11-22 07:23〜07:26 JST）

②の決定（step4 の tp）：continue-on-error を外す（job と step）・matrix を1本に戻す・paths に js/**・css/**・index.html を足す（ci.yml には入れない）・撮り直しのコマンドを README とプロジェクトノートに1行・括弧の二重を直す。

- 2e1c76f `ci(visual): …`（3ファイル）
  - visual.yml：
    - continue-on-error を job と visual の step から外した。
    - matrix を外して1本に戻した（artifact 名は visual-results に戻した）。
    - paths に js/**・css/**・index.html を足した。
    - コメントに撮り直しのコマンドを書いた。
  - e2e-diff-main.mjs：スキップの文は、警告文の括弧の中だけを使う。docker の無い PATH で流し、report が「スキップ（docker が無い。取得は docker pull mcr.microsoft.com/playwright:v1.65.1-resolute）」の1重になるのを確かめた。
  - README「CIの扱い」：赤になること・走る時・撮り直しのコマンド（1行）に直した。
- push 前：`npm run lint` は 12 本中 0 本失敗。`npm test` は 1,261 件通過・0 件失敗。push は 2bc8ff5..2e1c76f（07:24:22）。
- **CI：Visual run 6（44956582939・head 2e1c76f・continue-on-error なし）は Success。visual 集計は差分 0/54 件（テストの所要 27.8 秒）。run 全体は 1分9秒。** フォントは WenQuanYi Zen Hei。
- これで、同じ環境で差分 0 になったのは、CI で3本（run 5 の2本・run 6）、手元で3回。
- プロジェクトノート（bookshelf）に、撮り方・原因・版の揃え方・件数の読み方を追記した。
