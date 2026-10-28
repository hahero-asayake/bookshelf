# #397 step2: #387直後版(9c2c413)とHEAD(9ed0978)の比較・差の説明

## 版の確定
- 「#387の最後のcommit」= `9c2c413`（Issue:#387 trailer）。直後に `5f6f05f`（既に適用済み・index.htmlのbookshelf.js?v=を2026102801に上げるcommit）があり、9c2c413自身はindex.htmlを変更していないため、**9c2c413時点のindex.htmlのbookshelf.js?v=は2026102801のまま**（git showで実測済み）＝brief記載の本番版と一致。9c2c413〜#389着手(965d407)の間に他のindex.html変更は無い。
- 比較対象HEAD = `9ed0978`（このstep着手時にgit archiveで固定。以降の並行issueのcommitはこの比較に影響しない）。
- 配信: `git archive 9c2c413` → tmp/397/archive-old（ポート8091）、`git archive 9ed0978` → tmp/397/archive-new（ポート8092）。

## 比較1: #387自身の記録（800冊・合成データ・SW block）を同じ手順で再現
#387のハーネス(`387-sort-perf.mjs`、未改造)をOLD版(8091)に対してそのまま実行（reps=3、時間予算のため5→3）。

| | chromium CPU x4・order | WebKit 素の速さ・order |
|---|---|---|
| #387記録 | 98ms | 120ms |
| 今回の再現 | **88.8ms** | **130.0ms** |

誤差は-9%/+8%で、同じ機械・同じ手順での再実行ノイズの範囲内＝**#387の記録は再現する**（9c2c413のコード自体に劣化は無い）。

## 比較2: 913冊・実データ・SW on で OLD(9c2c413) と NEW(9ed0978) を同条件比較
step1と同じ`397-sort-perf.mjs`・同じtmp/397/userdata.json(913冊)・同じ表紙画像で、配信元だけをOLD/NEWに変えて実行(reps=3)。

| 版 | 操作 | tFrame(med) | 固まる時間(med) | longtask件数/合計 | 表紙route命中 | _bookCardKey合計 | applySorting | _renderListDiff |
|---|---|---|---|---|---|---|---|---|
| OLD chromium x4 | order | 134.9ms | 101.0ms | 2/131ms | 2件 | 6.3ms | 60.3ms | 54.7ms |
| NEW chromium x4 | order | **125.7ms** | 114.4ms | 2/122ms | 9件 | 5.5ms | 55.5ms | 50.8ms |
| OLD WebKit | order | 180.0ms | 142.0ms | 0/0 | 0件 | 1.0ms | 41.0ms | 40.0ms |
| NEW WebKit | order | **185.0ms** | 147.0ms | 0/0 | 0件 | 2.0ms | 42.0ms | 41.0ms |
| OLD chromium x4 | drag | 40.6ms | 11.2ms | - | 1件 | - | - | - |
| NEW chromium x4 | drag | 44.9ms | 15.0ms | - | 0件 | - | - | - |

**結論: OLDとNEWはreps=3のノイズの範囲内で同じ**（NEWがわずかに速い条件もあれば遅い条件もある・いずれも数ms〜10ms差）。**#389/#390/#391は、落ち着いた状態での並び替えそのものに測定可能な regression を加えていない。**

表紙route命中数はOLD(2件)よりNEW(9件)で多い＝#389の列数/先読みマージン変更(`rootMargin: '300px 0px 1200px 0px'`)で並び替え後に新規可視化される画像が増えた可能性があるが、この差はtFrameの差（NEWの方が速い）には表れていない＝この条件では無視できる大きさ。

(step1のlive-serve計測との整合: step1のchromium-x4-swon order tFrame_med=131.6ms、本stepのgit archive配信での再計測=125.7ms。差5.9ms はreps=3のノイズ相当＝**live-serve配信とgit archive配信は結果に有意差を生まないことを確認**。step1で「working tree直接配信」とした逸脱は実測で裏付けられた。)

## 比較3: 800冊→913冊でいくら増えるか（内訳の説明）
OLD版・chromium x4で条件を揃えて比較（800冊=合成データ・SW block・387手順／913冊=実データ・SW on・397手順）:

- 800冊(合成・SW無): tFrame=88.8ms, applySorting=41.8ms
- 913冊(実データ・SW有): tFrame=134.9ms, applySorting=60.3ms, _bookCardKey=6.3ms

冊数だけの比例分(+14.1%増)なら 88.8×1.141 ≈ **101ms** のはず。実測は134.9msで、**冊数比例分を超える約34ms(+34%)の追加**がある。内訳:
1. **_bookCardKeyが合成データの想定より重い**: コード側コメント(js/bookshelf.js:1958)は「書誌はbook全体をJSONで持つ。800冊で1ms程度」としているが、**実データ(913冊)での実測は6.3ms**＝コメントの想定の約6倍。合成データ(387-sort-perf.mjsのbooks)はtitle/authorsが短い固定パターン文字列なのに対し、実データは日本語の長い書名・著者名・メモを含み、`JSON.stringify(book)`のコストが明確に増える。**この差はコメントを実データで見直す価値がある具体的な根拠**。
2. **applySorting自体も+18.5ms重い**(41.8→60.3ms)。913冊への冊数増(+14%なら+5.9ms相当)だけでは説明できず、実データの文字列比較(`toLowerCase()`を含む)が合成データの短い固定文字列より重いことが寄与していると推定（厳密な切り分けは今回のデータでは行っていない＝追加の検証余地として明記）。
3. **表紙画像の実バイト・実SW経路**: 800冊データはproductImage=''（空文字＝画像リクエスト無し）、913冊実データはm.media-amazon.comの実URL・実バイト(16-60KB)・SW cache-first経路が動く。この分は387の800冊計測には最初から無かった負荷＝比較不能枠だが、本番(iPhone)では常に乗っている負荷。

## 比較4: 先読み(#389)・SW(#391)との「重なり」はOLDでも同じ大きさで起きる
起動直後（先読みがまだ動いている30ms後）に並び替えを行う補助測定(`overlap-probe.mjs`)をOLD(8091)でも実行し、step1で測ったNEW(8097=working tree当時のHEAD)の値と比較:

| | WebKit tFrame(重なり時) | chromium tFrame(重なり時) | chromium longtask | 表紙route命中(重なり中) |
|---|---|---|---|---|
| OLD(9c2c413) | 309ms | 99.8ms | 1件・66ms | 3件 |
| NEW(HEAD, step1実測) | 311ms | 106ms | 1件・66ms | 1件 |

**OLDとNEWでほぼ同じ大きさ（誤差2〜6ms、longtaskは2版とも66msで一致）**。→ **「先読みが一斉に動く」「SWのcache.putが詰まる」という重なりの負荷自体は、#389/#391が新たに生んだものではなく、LazyLoader(#389より前から存在)+画像の読み込み+並び替えの組み合わせで元から起きていた**。OLDのsw.jsにはCOVER_HOSTS判定が無く（grep実測＝COVER_HOSTS自体が存在しない）cross-origin表紙キャッシュは#391の新規追加だが、重なり時の負荷は「画像のfetch+decode」自体から来ており、SWのcache.put追加分はこの計測では区別できるほど大きくない。

## updateStats・_showSavedNote・localStorage書き込み
- `updateStats`: OLD/NEWともに0ms（計測可能な負荷なし）。
- `_showSavedNote`: OLD 0.1ms・NEW 0.4ms（#387で導入。無視できる大きさ、2版とも）。
- drag後のbookOrder保存: `reorderBooks`→`saveUserData`で約0.6〜0.9ms、localStorageへ25,207バイト(913冊分のuserData全体)を書き込む。**リモート(GitHub)への同期は走っていない**（#387で「並び替えのたびの同期もやめた」が維持されている・sync=localで確認。GitHub実同期のdebounce挙動自体は#387で確立済みのため今回は再測定していない＝引き継ぎ事項）。

## WebKit→実iPhoneの推定（明記: 推定）
WebKit素の速さ(order 175-185ms)は、chromium x4(112-135ms)とx6(162-191ms)のほぼ中間〜x6側に位置する。iPhone実機はこの計測機のWebKitより一般に遅いと見られるため、**実機の値はx6相当かそれ以上という推定にとどまる**（実測不可・WebKitにCPU制限APIが無いための推定である旨を明記）。

## まとめ（step3への引き継ぎ）
1. 913冊化そのものが主因（比例分+14%を超える約+34%の追加負荷＝主に_bookCardKeyと文字列比較コストの実データ影響）。
2. #389/#390/#391による明確な regression は、落ち着いた状態の計測では確認できなかった。
3. ただし「起動直後の重なり」は実データ913冊・実サイズ画像では大きい（+130ms級）。これはOLDからある構造的な弱さで、#389/#391が原因ではないが、913冊・実画像の本番環境では#387以前から潜在していた問題がより目立つ状態になっている、と説明できる。
4. 以上からstep3の案は、「_bookCardKeyの軽量化」「冊数に比例しないDOM移動(フルソート時ほぼ全件insertBefore)の削減」「先読み/SWの並び替え中の一時停止または優先度調整」「一覧仮想化」の4系統を比較するのが筋が良い。
