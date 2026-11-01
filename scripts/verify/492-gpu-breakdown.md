# #492 step1: GPU・描画状態とtFrame内訳のCI/ローカル対照（見立て確認）

前提（#487）: CIで単独・workers=1実行でも上限超過の操作がrunごとに変わる。DOMに依存しない
計算のtFrameはCI=31ms・ローカル=32msでほぼ同じ＝JSの速さの差ではCIの遅れを説明できない。
②の見立て: CIはGPUが無く、描画（ラスタ化）をソフトウェア（SwiftShader等）で行っている。
CPUスロットリングが掛からない描画の部分が、少ないvCPUで重くなっているのではないか（未確認）。

計測は記録専用（`[sort-perf-gpu]`/`[sort-perf-breakdown]`/`[sort-perf-aa]`）。判定・BUDGETは
変更していない（#377）。実装: `tests/e2e/sort-perf-budget.spec.js`（commit 4c1e9fc）。

## 1. GPU・描画状態（chrome://gpu相当）

取得元: CIは commit 4c1e9fc の mainへのpush（run、check-run id 124996057365、`[sort-perf-gpu]`annotation）、
ローカルはkuroko実機（worktree issue-492、PORT=8192）。

| 項目 | ローカル実機(kuroko) | CI |
|---|---|---|
| headless種別 | headless shell (HeadlessChrome UA) | headless shell (HeadlessChrome UA) |
| browserVersion | 148.0.7778.96 | 148.0.7778.96（同一） |
| hardwareConcurrency(vCPU) | **16** | **4** |
| WebGL renderer | ANGLE (Vulkan 1.3.0 (SwiftShader Device...), SwiftShader driver) | ANGLE (Vulkan 1.3.0 (SwiftShader Device...), SwiftShader driver)（同一） |
| gpu_compositing | disabled_software | disabled_software（同一） |
| rasterization | disabled_software | disabled_software（同一） |
| webgl featureStatus | unavailable_software | unavailable_software（同一） |
| displayType | ANGLE_SWIFTSHADER | ANGLE_SWIFTSHADER（同一） |
| 機械の生の速さ(スロットリング前tFrame) | T_REF=32ms | T_measured=65ms(rate=2.97に減速) |

**判定①（当たり/外れ）**: ②の見立ての前半「CIはGPUが無く、ソフトウェア描画(SwiftShader)」は
**外れ**。CIとローカルはGPU・描画構成が完全に同一（両方ともheadless shell + SwiftShaderの
ソフトウェア描画。gpu_compositing/rasterization/webgl featureStatusも1文字残らず一致）。
唯一の実機差は **hardwareConcurrency(vCPU数): CI=4 / ローカル=16** であり、機械の生の速さ
(T_measured 65ms vs T_REF 32ms、約2.0倍)もこのvCPU差で説明できる範囲（後述の内訳比較の通り
描画だけに偏った遅さではない）。

## 2. tFrame内訳（CDP Tracing、判定用5repとは別枠の追加2rep、ms）

スロットリング(rate)は適用後の値。ローカルrate=6.00、CIはrate=2.97（T_measuredに応じ#487の
動的倍率で自動的に下げられた・スロットリング自体は同一メカニズム）。

### direction

| rep | tFrame | js | layout | paint | eventCount |
|---|---|---|---|---|---|
| ローカル1 | 78 | 105 | 65 | 20 | 939 |
| ローカル2 | 84 | 130 | 69 | 20 | 1468 |
| CI1 | 70 | 117 | 58 | 14 | 1146 |
| CI2 | 85 | 135 | 55 | 15 | 916 |

### drag

| rep | tFrame | js | layout | paint | eventCount |
|---|---|---|---|---|---|
| ローカル1 | 71 | 17 | 34 | 5 | 371 |
| ローカル2 | 58 | 19 | 29 | 5 | 321 |
| CI1 | 57 | 18 | 30 | 6 | 1384 |
| CI2 | 57 | 19 | 30 | 7 | 323 |

注: js+layout+paintの合計がtFrameを超える行がある（トレースイベントが複数スレッド/フレームで
重複集計されるため、厳密な分解ではなく相対比較用）。イベント名リストは記録専用の近似分類
（js=FunctionCall/EvaluateScript/V8.Execute/RunMicrotasks/EventDispatch/TimerFire、
layout=Layout/UpdateLayoutTree/RecalculateStyles/PrePaint/ScheduleStyleRecalculation/
InvalidateLayout、paint=Paint/PaintImage/Rasterize/RasterTask/CompositeLayers/Layerize/
ActivateLayerTree/DrawFrame/GPUTask）。

**判定②（当たり/外れ）**: ②の見立ての後半「CPUスロットリングの掛からない描画部分が、
CIで(少ないvCPUのため)重くなっている」も**外れ**。js/layout/paintの絶対値・比率ともCIと
ローカルでほぼ同水準（direction: paintはCI(14-15ms)の方がローカル(20ms)より小さい。drag:
paintはCI(6-7ms)がローカル(5ms)よりわずかに大きいだけで有意差とは言えない）。「描画・ラスタ
だけがCIで特異的に膨らむ」という非対称性は、この2操作・各2repの記録専用データからは見られない。
CIの機械の遅さ(T_measured 65ms)はjs/layout/paintを含めた全体的な遅さであり、それは#487の
CPUスロットリング動的倍率(rate=2.97)で吸収されている（実際、適用後のtFrameはCIとローカルで
同程度〜CIの方が小さい値になっている）。

## 3. A/Aの揺れ（同じcommitのまま、組X→組Y交互×3組、中央値比・判定方式案Aの比上限候補の材料）

| 操作 | ローカル x | ローカル y | ローカル比 | CI x | CI y | CI比 |
|---|---|---|---|---|---|---|
| order | [85,88,84] | [94,90,91] | 1.075 | [73,73,67] | [74,73,73] | 1.004 |
| direction | [89,116,84] | [94,89,88] | 1.009 | [66,70,69] | [68,73,68] | 0.978 |
| drag | [80,58,57] | [58,60,69] | 1.049 | 未取得 | 未取得 | 未取得 |

CI側のdragのA/A行（`[sort-perf-aa] op=drag`）はテストログには出力されたはずだが、check-run
annotationsには現れなかった（取得した16件のannotation中、GPU/rate/breakdown/order/directionの
aaは全て取れたがdragのaaのみ欠落。GitHub Actionsのannotation側の制限か順序落ちの可能性があるが、
原因は未調査＝時間枠内で深追いしていない）。判定には使わない記録専用データのため、完了条件への
影響はない。5組（order/direction×ローカル/CI + drag×ローカル）のA/A比は0.978〜1.075の範囲
（最大で約7.5%の揺れ）。これがstep2の案Aの比の上限候補（例: 1.2〜1.5倍）の根拠データになる。

## 4. 見立ての判定（まとめ）

**②の見立て（CIはGPUが無くソフトウェア描画(SwiftShader)で、CPUスロットリングの掛からない
描画部分が少ないvCPUで重くなっている）は、前半・後半とも「外れ」。**

根拠:
1. GPU・描画構成（headless種別・WebGL renderer・gpu_compositing/rasterization/webgl
   featureStatus・displayType）はCIとローカルで完全一致。ローカルも既にheadless shell +
   SwiftShaderでソフトウェア描画している（GPU無し・ソフトウェア描画はCI固有の条件ではない）。
2. 実機差はvCPU数のみ（CI=4、ローカル=16）。機械の生の速さ(T_measured 65ms vs T_REF 32ms、
   約2.0倍)はこの差で説明できる範囲。
3. js/layout/paintの内訳（記録専用trace、direction/drag各2rep）を見ても、CIで描画・ラスタ
   (paint)だけが特異的に膨らんでいる形跡はない。js・layoutも含めて全体的に同水準かCIの方が
   小さい値で、「描画部分が少ないvCPUで特に重くなる」という質的な非対称性は見られない。
4. CIの遅さ(T_measured)は#487の動的CPUスロットリング倍率(rate=2.97)で吸収され、実際の判定対象
   tFrame（order中央値76ms/direction70ms/drag54ms、BUDGET380/340/120）はいずれもローカル
   （order100ms/direction90ms/drag67ms）と同程度かそれ以下でpassした。

→ #476/#487で過去に実際にBUDGET超過が起きた事実は、「CIの描画が質的に重い」からではなく、
「機械の遅さ(T_measured)自体がrunごとに変動し、動的倍率で吸収しても吸収しきれないほど遅い
runがあった」という量的な変動が原因と考えられる。これはstep2で、機械の絶対速度に依存しない
基準commitとの相対比較（案A）が筋として妥当であることを支持するデータになる。
