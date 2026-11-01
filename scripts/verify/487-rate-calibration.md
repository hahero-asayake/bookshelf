# #487 step4: 機械の速さに応じたCPUスロットリング倍率の実装・ローカル確認

## 実装内容(②承認・2026-11-02 06:30の案)

- `measureBaselineTFrame(page, reps=5)`: CPUスロットリングを掛ける前に、DOM非依存の固定計算
  (2,000,000回のMath.sqrtループ)のtFrameを中央値(reps=5)で測る。inputDelayは記録しない。
- `T_REF = 32`(ローカル実機kuroko、スロットリング無し・reps=5中央値、3回実測30/32/32msの中央値)。
- `rate = clamp(6 * T_REF / T_measured, 1, 6)` でCPUx6スロットリングの倍率を動的に決め、
  `cdp.send('Emulation.setCPUThrottlingRate', { rate })` に渡す。
- `[sort-perf-rate] T_measured=...ms T_ref=...ms rate=...` をログに出し、`::notice`で拾う(ci.yml側)。
- dragとbaseline操作の比較ログ(ratio)は削除。baselineDom計測自体も削除(比較に使わなくなったため)。
- order/direction/dragの判定(BUDGET・中央値判定・最大値は記録のみ)は変更しない(#377方針)。
- ci.ymlの`--repeat-each=3`(データ収集専用)を外し、reps=5中央値の単発実行に戻した。

## ローカル確認1: 単独実行3回(無負荷、--workers=1)

T_REF=32確定後の実測、全てrate=6.00(クランプ上限)、全てpass:

| run | T_measured | rate | order tFrame/inputDelay(中央値) | direction | drag |
|---|---|---|---|---|---|
| 1 | 32ms | 6.00 | 98/103 | 91/114 | 71/42 |
| 2 | 32ms | 6.00 | 101/125 | 91/81 | 71/42 |
| 3 | 32ms | 6.00 | 93/102 | 93/116 | 59/29 |

全てBUDGET(order 380/420・direction 340/320・drag 120/80)以下。exit 0。

## ローカル確認2: 並列フルスイート1回(8 worker)

566 passed / 14 skipped(sort-perf-budget含む全ファイル)。sort-perf-budget自体も実測:

T_measured=32ms rate=6.00(無負荷時と同じ)。order tFrame/inputDelay(中央値)=133/172、
direction=119/247、drag=98/77。ホスト競合(他7ファイルのchromiumインスタンス)の影響で
単独実行より重くなっているが、BUDGET以下でpass。

## ローカル確認3: CPU負荷を掛けた状態での実測 — **想定と異なる結果**

②の確認項目「ローカルでCPUに負荷を掛けた状態(burnerなど)で測ったrateが下がり、判定が安定する
ことを表で示す」を試したところ、**rateは下がらず、むしろBUDGET超過(exit 1)が発生した**。

### 試行1: `yes > /dev/null` を16プロセス(論理コア数と同数)

| T_measured | rate | order inputDelay(中央値) | direction | drag |
|---|---|---|---|---|
| 30ms | 6.00(クランプ上限、無負荷時とほぼ同じ) | 453ms(BUDGET420超過) | 213ms | 80ms(BUDGET80ぎりぎり) |

exit 1(orderのinputDelayが超過)。

### 試行2: `node -e "while(true){Math.sqrt(Math.random());}"` を32プロセス(論理コア数の2倍)

| T_measured | rate | order inputDelay(中央値) | direction | drag |
|---|---|---|---|---|
| 30ms | 6.00(クランプ上限、無負荷時とほぼ同じ) | 3001ms(BUDGET420の7倍超) | 7989ms(BUDGET320の25倍超) | 685ms(BUDGET80の8倍超) |

exit 1(3操作とも大幅超過)。

### 原因の考察

`measureBaselineTFrame`はスロットリング無し・短時間(2,000,000回のループで約30ms)の同期処理のため、
OSのスケジューラが即座にCPU時間を割り当ててしまい、他プロセスとの競合(ノイジーネイバー)の影響を
ほとんど受けない。一方、order/direction/dragの測定はCPUx6スロットリングがかかった状態で実行時間が
約6倍に伸びるため、その間に他プロセスにCPU時間を奪われる機会が大幅に増え、競合の影響を強く受ける。

**つまり、「スロットリング無しの短時間固定計算でT_measuredを測る」方式は、ホスト上の他プロセスとの
一時的なCPU競合(ノイジーネイバー)を検出できない。** この方式は「CIランナー自体の素の性能差(クロック
周波数等の恒常的な違い)」には対応できる可能性があるが、#476・今回のCI実測で見られた「runごとに揺れる
負荷」の種類(一時的な競合・スロットリング自体の変動)に対しては機能しない恐れがある。

## ②への報告事項(push前のtp)

実装(spec変更・ci.yml変更)は指示通り完成し、無負荷時のローカル確認(単独3回・並列1回)は全てpassで
期待どおり安定した。しかし、CPU負荷を掛けた状態の確認では、想定(rateが下がり判定が安定する)とは
逆の結果(rateが下がらずBUDGET超過)になった。この事実を隠さず報告し、次のpush判断を②に委ねる。
