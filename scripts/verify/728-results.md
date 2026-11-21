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
