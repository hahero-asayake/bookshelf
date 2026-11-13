// イシュー#397: 913冊・390px・chromium CPUx6で、並び順の3操作(メニュー切替・昇順/降順・ドラッグ)の
// 「入力から画面が変わるまで」と「入力を受け付けない時間」に上限を固定する(回帰ガード)。
//
// 許容幅について(CIの速さのばらつきを踏まえる):
//   scripts/verify/397-sort-perf.mjs での実測(ローカル・各3回・中央値/最大値、修正後=A1/A4/A5/A6実装後)は
//   以下(chromium CPUx6・SW on・913冊・実データ種のpadding):
//     order:     tFrame最大 195ms / 固まる最大 229ms
//     direction: tFrame最大 155ms / 固まる最大 161ms
//     drag:      tFrame最大  64ms / 固まる最大  35ms
//   イシューの目標(≤150ms / ≤100ms)は、この修正では order/direction ともに未達(特に「固まる時間」)。
//   CIは実測機より遅い・速いどちらもあり得るため、ローカル最大値のさらに上を
//   このテストの上限にする=「今回の改善を割らない」ための回帰ガードであり、イシューの目標値そのものの
//   達成を保証するものではない(目標未達は②へ報告済み・次の改善の種として残す)。
//   さらに、全50ファイルのE2Eを8 worker並列で回すと host の実CPUコアを他ファイルのchromium
//   インスタンスと奪い合い、CDPのCPUx6スロットリング(ページの処理速度を落とす)の上に実コンテンション
//   が乗って単独実行より悪化することを実測で確認(direction.tFrameが単独150ms台→並列下285.9ms)。
//   そのため下のBUDGETは単独実行時の最大値よりもさらに余裕を持たせてある(根拠はBUDGET定義の直前コメント)。
// データについて: ハヘロの実データは使わない(E2Eはcommitされるため)。387-sort-perf.mjsの生成方式を
// 踏襲しつつ、タイトル/著者を実データ相当の長さ(日本語20〜30文字程度)にして_bookCardKey/applySortingの
// 文字列コストを過小評価しない(ステップ2で短い合成文字列が実コストを過小評価すると分かったため)。
//
// イシュー#405 step2: mainのCI test(1b61b06・f01c257・03a64d5)でこのテストが3回連続で最終的に
// 失敗した(1回目: order 548.4ms、2回目: drag 166.3ms、3回目: order 429.8ms。いずれもreps=3の中央値)。
// #405 step1の切り分けで、直前の緑commit以降アプリ側(js/)にこのテストの対象(並び替え処理)以外の
// 退行は無く、CI全並列実行下の負荷依存と判定(詳細: scripts/verify/405-ci-breakdown.md)。
// 対策: reps=3→5に増やし(単発の強い外れ値にさらに強くする)、最大値は判定せず記録のみに変更。
// BUDGET自体は変更しない(②方針#377=上限を緩めてアプリの問題を隠さない・上限は消さずfail判定を残す)。
//
// ⚠️重要な前提のずれ(②へ報告済み・tp時点): このspecを編集した時点のローカル作業ツリーには、
// #401/#402(本棚一覧の仮想化)が並び替え処理自体を変更したcommit(441cd65「並び順の変更・昇順/降順の
// 切替で一覧を段階描画し、固まる時間を約130ms→約20msに」)が未push(origin/main..HEAD)で既に含まれている。
// このためローカルで実測した値は「仮想化を入れる前の値」ではない。②承認時(#405 step1完了時点)は
// このcommitが無かったため、前提がずれている。
//   - 441cd65を含まない状態(#405 step1のCI実測・reps=3中央値): order 429.8〜548.4ms、drag 166.3ms
//     (いずれもBUDGET超過＝これが赤の直接原因)
//   - 441cd65を含む状態(今回のローカル実測・reps=3): 単独実行3回 tFrame 60〜93ms / 全50ファイル
//     8 worker並列実行1回 tFrame 93〜140ms(dragのみ1回だけ最大131.7ms>BUDGET.drag.tFrame=120msだが
//     中央値96.6msはBUDGET以下)。441cd65が無い状態の3〜6倍の余裕がある。
// つまり#401/#402がmainにpushされればBUDGET超過問題はほぼ解消する見込みだが、441cd65を含めて
// pushするかは本イシュー(#405)の管轄を超える判断のため②に委ねる(push前のtpで報告)。
import { test, expect } from './helpers/test-base.js';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// イシュー#492 step4(案A・ADR-149): 基準commit(固定タグ)と今のcommitを同じjob内で交互に測り、
// 比が上限を超えたら赤にする。#377(上限を消さない・警告止めにしない・skipしない)を守るため、
// 判定の分担はCI/ローカルで分ける: CIは比較判定(機械の速さに左右されない)、ローカル(push前)は
// 既存の絶対値BUDGET判定(CIの揺れを考慮しない、素早く確実に劣化を検出)。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const IS_CI = !!process.env.CI;
// 基準タグ(ADR-149): origin/mainの1つ前ではなく固定タグ(既定perf-base)にする。1つ前にすると
// 1.29倍以下の退行が毎回「基準より1.3倍未満」としてすり抜け、連続commitで積み重なってしまうため。
const BASE_TAG = process.env.SORT_PERF_BASE_TAG || 'perf-base';
const RATIO_LIMIT = Number(process.env.SORT_PERF_RATIO_LIMIT || 1.3);
const NOW_PORT = Number(process.env.PORT || 8192);
const BASE_PORT = Number(process.env.SORT_PERF_BASE_PORT || NOW_PORT + 1);
const BASE_WORKTREE_DIR = process.env.SORT_PERF_BASE_WORKTREE_DIR || path.join(REPO_ROOT, '.sort-perf-base-worktree');
let baseServerProc = null;

function ensureBaseWorktree() {
    try { execSync(`git worktree remove --force "${BASE_WORKTREE_DIR}"`, { cwd: REPO_ROOT, stdio: 'ignore' }); } catch (_) { /* 無ければ無視 */ }
    try { execSync(`git fetch origin tag ${BASE_TAG} --force`, { cwd: REPO_ROOT, stdio: 'ignore' }); } catch (_) { /* ローカルに既にタグがあれば不要 */ }
    execSync(`git worktree add --force --detach "${BASE_WORKTREE_DIR}" ${BASE_TAG}`, { cwd: REPO_ROOT, stdio: 'pipe' });
}

function startBaseServer() {
    return spawn('python3', ['-m', 'http.server', String(BASE_PORT)], { cwd: BASE_WORKTREE_DIR, stdio: 'ignore' });
}

async function waitForServer(url, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try { await fetch(url); return; } catch (_) { /* 起動待ち */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`base server did not come up: ${url}`);
}

const N = 913;
const TITLE_PARTS = ['ことばの', 'それから', '夜明けの', '静かな', '遠い街の', '記憶の中の', '小さな', '最後の'];
const AUTHOR_PARTS = ['山田', '佐藤', '鈴木', '高橋', '田中', '渡辺'];
const books = Array.from({ length: N }, (_, i) => {
    const n = i + 1;
    const title = `${TITLE_PARTS[n % TITLE_PARTS.length]}物語 第${n}話 〜${'あいうえお'.repeat(2)}〜`;
    const authors = `${AUTHOR_PARTS[n % AUTHOR_PARTS.length]}${AUTHOR_PARTS[(n * 7) % AUTHOR_PARTS.length]}`;
    return {
        asin: `B${String(n).padStart(9, '0')}`, title, authors,
        acquiredTime: 1700000000000 + ((n * 104729) % N) * 1000,
        readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000,
    };
});
const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [{ id: 'all', internalId: 'fixall397', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map((b) => b.asin), notes: {} }],
    notes: {}, settings: { sortOrder: 'acquiredTime', sortDirection: 'desc' }, bookOrder: {}, stats: {}, version: '2.0',
};

// 許容幅(ローカル実測の最大値のおおよそ1.5倍・CIのばらつき分の上乗せ)
// イシュー#397 step5: 全50ファイルのE2E(8 worker並列)下でdirection.tFrameが285.9ms(単独実行では
// 7.5〜7.6s/回・3回とも150〜155ms程度で安定)になり失敗した。CDPのCPUx6スロットリングは「ページの
// 処理速度」を落とす仕組みで、host機の実CPUコアを他のworker(無関係な7ファイル分のchromiumインスタンス)
// と奪い合う状態では、スロットリングの影響に host 側の実コンテンション分が上乗せされ単独実行より
// 悪化しうる(実測で確認)。このテストの目的は「今回の改善を大きく割っていないかの回帰ガード」であり、
// CI全体の並列負荷を厳密に再現した基準ではないため、単独実行時の最大値に対してさらに余裕を持たせる。
const BUDGET = {
    order: { tFrame: 380, inputDelay: 420 },
    direction: { tFrame: 340, inputDelay: 320 },
    drag: { tFrame: 120, inputDelay: 80 },
};

async function setup(page) {
    await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.waitForTimeout(800);
}

// イシュー#492 step4: 基準/今どちらのoriginでも使うナビゲーションヘルパー(setup()のgoto以降と同じ手順)。
// localStorageのuserData/libraryはsetup()のaddInitScriptでpage全体に仕込んでいるため、別originへの
// navigationでも毎回再適用される(Playwrightのpage.addInitScriptは全navigationに効く)。
async function gotoApp(page, urlOrPath) {
    await page.goto(urlOrPath);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.waitForTimeout(800);
}

// イシュー#492 step4(案A): 基準commit(タグ)と今のcommitを「基準→今→基準→今…」交互にgotoして
// 測り、中央値の比(今/基準)を返す。CPUスロットリングはクロスオリジンnavigationでリセットされうる
// ため毎回再設定する。prepareFnは各gotoの直後に呼ぶ(navigationでJS側の状態がリセットされるため)。
async function measureCompare(page, cdp, rate, prepareFn, triggerFn, reps = 3) {
    const nowVals = []; const baseVals = [];
    for (let i = 0; i < reps; i++) {
        await gotoApp(page, `http://localhost:${BASE_PORT}/index.html`);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        if (prepareFn) await prepareFn(page);
        baseVals.push((await measure(page, triggerFn)).tFrame);

        await gotoApp(page, 'index.html');
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        if (prepareFn) await prepareFn(page);
        nowVals.push((await measure(page, triggerFn)).tFrame);
    }
    return {
        nowVals: nowVals.map((v) => Math.round(v)), baseVals: baseVals.map((v) => Math.round(v)),
        ratio: Number((median(nowVals) / median(baseVals)).toFixed(3)),
    };
}

// 絶対値判定(#377=上限は消さない): ローカル・push前はここでfailさせる(機械の揺れの影響を受けるが、
// CIを待たずすぐ確実に劣化を検出できる)。CIでは機械差の影響が大きいため記録のみにし、判定は
// measureCompareの比(judgeRatio)に委ねる(ADR-149)。
function judgeAbsolute(result, budget, label) {
    const tFrameMsg = `${label} tFrame(中央値)=${result.tFrame}ms(最大${result.tFrameMax}ms)・BUDGET=${budget.tFrame}ms`;
    const delayMsg = `${label} inputDelay(中央値)=${result.maxInputDelay}ms(最大${result.maxInputDelayMax}ms)・BUDGET=${budget.inputDelay}ms`;
    if (IS_CI) {
        console.log(`[sort-perf-absolute] ${tFrameMsg}(CI記録のみ) / ${delayMsg}(CI記録のみ)`);
    } else {
        expect(result.tFrame, `${tFrameMsg}・ローカル判定`).toBeLessThanOrEqual(budget.tFrame);
        expect(result.maxInputDelay, `${delayMsg}・ローカル判定`).toBeLessThanOrEqual(budget.inputDelay);
    }
}

// 比較判定(#377=skip・警告止めにしない): CIでのみfailさせる(機械の速さに左右されない・ADR-149)。
// ローカルではjudgeAbsoluteが判定を担当するため記録のみ。
function judgeRatio(ratio, label) {
    if (IS_CI) {
        expect(ratio, `${label} ratio(今/基準)=${ratio} > 上限${RATIO_LIMIT}倍(基準タグ=${BASE_TAG}・ADR-149)`).toBeLessThanOrEqual(RATIO_LIMIT);
    }
}

// 操作直後からpointerdownを16ms間隔でスケジュールし、ハンドラ発火までの実遅延の最大値=「固まる時間」
async function measure(page, triggerFn) {
    await page.evaluate(() => {
        window.__long = [];
        try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch (_) {}
        const probe = document.getElementById('__inputProbe') || document.body.appendChild(Object.assign(document.createElement('div'), { id: '__inputProbe' }));
        probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
        window.__inputDelays = [];
        probe.onpointerdown = null;
        probe.addEventListener('pointerdown', (e) => { if (e.__sched != null) window.__inputDelays.push(Math.max(0, performance.now() - e.__sched)); });
    });
    await page.evaluate(() => {
        const probe = document.getElementById('__inputProbe');
        let n = 0; const t0 = performance.now();
        const tick = () => {
            if (n++ > 40) return;
            const sched = t0 + n * 16;
            const ev = new PointerEvent('pointerdown', { bubbles: true }); ev.__sched = sched;
            probe.dispatchEvent(ev);
            setTimeout(tick, Math.max(0, sched - performance.now()));
        };
        tick();
    });
    const { tFrame } = await page.evaluate(async (fnSrc) => {
        const t0 = performance.now();
        // eslint-disable-next-line no-new-func
        await new Function('return (' + fnSrc + ')()')();
        const tSync = performance.now() - t0;
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        return { tSync, tFrame: performance.now() - t0 };
    }, triggerFn.toString());
    await page.waitForTimeout(900);
    const inputDelays = await page.evaluate(() => window.__inputDelays || []);
    return { tFrame, maxInputDelay: inputDelays.length ? Math.max(...inputDelays) : 0 };
}

const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };

// イシュー#492 step1: 判定には使わない記録専用の計測(見立て確認用)。BUDGET/expectは一切変えない(#377)。

// (a) chromiumのGPU・描画状態(chrome://gpuに相当)。headless shellかどうか・SwiftShaderかどうかを見る。
// SystemInfo.getInfoはpage用CDPセッションでは呼べず(Protocol error: "only supported on the browser
// target"、ローカル実測で確認済み)、browser用セッション(browser.newBrowserCDPSession())が必要。
async function logGpuInfo(page) {
    const browser = page.context().browser();
    const ua = await page.evaluate(() => navigator.userAgent);
    const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
    const webgl = await page.evaluate(() => {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return { supported: false };
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return {
                supported: true,
                renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            };
        } catch (e) { return { supported: false, error: String(e) }; }
    });
    let systemInfo = null;
    try {
        const bcdp = await browser.newBrowserCDPSession();
        const info = await bcdp.send('SystemInfo.getInfo');
        const device = (info.gpu && info.gpu.devices && info.gpu.devices[0]) || {};
        systemInfo = {
            gpu_compositing: info.gpu && info.gpu.featureStatus && info.gpu.featureStatus.gpu_compositing,
            rasterization: info.gpu && info.gpu.featureStatus && info.gpu.featureStatus.rasterization,
            webgl: info.gpu && info.gpu.featureStatus && info.gpu.featureStatus.webgl,
            deviceString: device.deviceString,
            displayType: info.gpu && info.gpu.auxAttributes && info.gpu.auxAttributes.displayType,
        };
        await bcdp.detach();
    } catch (e) { systemInfo = { error: String(e) }; }
    console.log(`[sort-perf-gpu] headlessShell=${/HeadlessChrome/.test(ua)} browserVersion=${browser.version()} hardwareConcurrency=${hardwareConcurrency} webgl=${JSON.stringify(webgl)} systemInfo=${JSON.stringify(systemInfo)}`);
}

// (b) tFrameのうちJS/レイアウト・スタイル/描画・ラスタの内訳。CDP Tracingで取る。
// trace取得自体が値を歪めるため、判定用のmeasureMedian(5rep)とは別枠の追加repでのみ使う。
const TRACE_JS_EVENTS = ['FunctionCall', 'EvaluateScript', 'V8.Execute', 'RunMicrotasks', 'EventDispatch', 'TimerFire'];
const TRACE_LAYOUT_EVENTS = ['Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'PrePaint', 'ScheduleStyleRecalculation', 'InvalidateLayout'];
const TRACE_PAINT_EVENTS = ['Paint', 'PaintImage', 'Rasterize', 'RasterTask', 'CompositeLayers', 'Layerize', 'ActivateLayerTree', 'DrawFrame', 'GPUTask'];

async function measureWithTrace(page, cdp, triggerFn) {
    const events = [];
    const onData = (p) => { if (p.value) events.push(...p.value); };
    cdp.on('Tracing.dataCollected', onData);
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
    const result = await measure(page, triggerFn);
    const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
    await cdp.send('Tracing.end');
    await done;
    cdp.off('Tracing.dataCollected', onData);
    const sumMs = (names) => events.filter((e) => names.includes(e.name) && typeof e.dur === 'number').reduce((s, e) => s + e.dur, 0) / 1000;
    return { tFrame: result.tFrame, js: sumMs(TRACE_JS_EVENTS), layout: sumMs(TRACE_LAYOUT_EVENTS), paint: sumMs(TRACE_PAINT_EVENTS), eventCount: events.length };
}

async function measureTraceReps(page, cdp, triggerFn, reps = 2) {
    const rows = [];
    for (let i = 0; i < reps; i++) {
        rows.push(await measureWithTrace(page, cdp, triggerFn));
        await page.waitForTimeout(150);
    }
    return rows;
}

// (c) A/Aの揺れ(判定方式案Aの比の上限候補を決めるための記録専用データ)。同じcommitのまま、
// 「組X→組Y→組X→組Y…」と交互に計6回(3組)測り、組Y/組Xの中央値の比を見る。
async function measureAA(page, triggerFn, rounds = 3) {
    const xs = []; const ys = [];
    for (let i = 0; i < rounds; i++) {
        xs.push((await measure(page, triggerFn)).tFrame);
        await page.waitForTimeout(150);
        ys.push((await measure(page, triggerFn)).tFrame);
        await page.waitForTimeout(150);
    }
    const mx = median(xs); const my = median(ys);
    return { x: xs.map((v) => Math.round(v)), y: ys.map((v) => Math.round(v)), ratio: Number((my / mx).toFixed(3)) };
}

// イシュー#487: CPUx6スロットリングは「ページの処理速度を落とす倍率」指定のため、CIランナー自体の
// 素の速さが揃っていないと、固定倍率(6)のままでは「見かけの負荷」がrunごとに揺れる(#476実測86ms→
// #487の構造修正後run 41350063972ではdragは通りdirectionが329/343msで超過・超える操作がrunごとに
// 変わった＝機械の速さ側の要因と判定済み・②承認2026-11-02 06:30)。
// 当初試した「dragと基準操作の比」方式(step1〜3で実装)は、CI実測でbaselineDom/baselineComputeの
// inputDelayがローカルと大小関係が逆転し0msも出るなど比の分母として不安定だったため不採用(②判断)。
// 代わりに、スロットリングを掛ける前に固定計算のtFrame(CPU生の速さだけを見る・DOM非依存)を測り、
// ローカル基準値(T_REF)との比でCPUx6相当の「見かけの負荷」を揃うようスロットリング倍率を動的に決める。
// tFrameはCI実測でも安定していた(reps=[18,16,18,15,13]・[18,15,17,14,16]、run 41350063972)。
async function measureBaselineTFrame(page, reps = 5) {
    const results = [];
    for (let i = 0; i < reps; i++) {
        const t = await page.evaluate(async () => {
            const t0 = performance.now();
            let x = 0;
            for (let i = 0; i < 2_000_000; i++) { x += Math.sqrt(i) % 7; }
            await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
            return performance.now() - t0;
        });
        results.push(t);
    }
    return median(results);
}

// T_REF: ローカル実機(kuroko、2026-11-02、commit 73fff08時点のworktree)でmeasureBaselineTFrameを
// スロットリング無しで実行した中央値(reps=5)。rate = clamp(6 * T_REF / T_measured, 1, 6)で、
// CIランナーがローカルより遅ければ(T_measured大)rateを下げ、速ければrate=6のまま(上限でクランプ)。
// 値を変える時はここに測った日・commit・実測値を追記する。
// 2026-11-02、73fff08時点のworktree、ローカル実機(kuroko)、スロットリング無し・reps=5中央値を3回
// 実測: 30ms/32ms/32ms。中央値32msを採用。
const T_REF = 32;

// 1操作につき3回測って中央値を使う(単発のhost競合スパイクに引きずられないため・397-sort-perf.mjsの
// reps=3中央値と同じ考え方)。中央値を使うことで「2回に1回明らかに遅い」ような本物の劣化は検出しつつ、
// 8 worker並列実行で稀に1回だけ host 側のスケジューリング遅延を踏むケースはならされる。
async function measureMedian(page, triggerFn, reps = 5) {
    const results = [];
    for (let i = 0; i < reps; i++) {
        results.push(await measure(page, triggerFn));
        await page.waitForTimeout(150);
    }
    // 中央値は判定に使う。最大値は記録のみ(判定しない)=CIの単発スパイクでfailさせず、
    // かつログに残して「どこまで悪化したか」を追える形にする(イシュー#405)。
    const tFrames = results.map((r) => r.tFrame);
    const inputDelays = results.map((r) => r.maxInputDelay);
    console.log(`[sort-perf] tFrame reps=${JSON.stringify(tFrames.map((v) => Math.round(v)))} inputDelay reps=${JSON.stringify(inputDelays.map((v) => Math.round(v)))}`);
    return {
        tFrame: median(tFrames), tFrameMax: Math.max(...tFrames),
        maxInputDelay: median(inputDelays), maxInputDelayMax: Math.max(...inputDelays),
    };
}

const prepareNonCustom = async (page) => {
    await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'acquiredTime'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(1500);
};
const prepareCustom = async (page) => {
    await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(1500);
};

test.describe('#397 並び替えの時間上限(913冊・390px・chromium CPUx6)', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'CPU制限はchromiumのCDPのみ(他ブラウザはskip)');

    // イシュー#492 step4(ADR-149): 基準commit(固定タグ)をworktreeで展開し別portで配信する。
    test.beforeAll(async () => {
        ensureBaseWorktree();
        baseServerProc = startBaseServer();
        await waitForServer(`http://localhost:${BASE_PORT}/index.html`);
    });
    test.afterAll(() => {
        if (baseServerProc) baseServerProc.kill();
    });

    test('並び順メニューの切り替え・昇順降順・ドラッグが、いずれも許容幅を超えない', async ({ page, context }) => {
        // イシュー#492 step4: 基準commitとの交互比較(3操作×3rep×2=18回のgoto)が増えた分、
        // 既定60秒のtestタイムアウトでは不足する(実測で60秒超・timeout発生)。十分な余裕を取る。
        test.setTimeout(240000);
        await setup(page);
        const cdp = await context.newCDPSession(page);

        // イシュー#492 step1: GPU・描画状態は操作前(スロットリング前)に1回だけ記録(環境固有・操作に依らない)。
        await logGpuInfo(page);

        // イシュー#487: スロットリングを掛ける前に機械の速さを測り、倍率を動的に決める(詳細はT_REFの
        // コメント)。rateが下限1になっても後続のBUDGETを超えるなら、それは機械の遅さでは説明できない
        // 本物の赤として扱う(緩めない・#377方針)。
        const tMeasured = await measureBaselineTFrame(page);
        const rate = Math.min(6, Math.max(1, 6 * (T_REF / tMeasured)));
        console.log(`[sort-perf-rate] T_measured=${Math.round(tMeasured)}ms T_ref=${T_REF}ms rate=${rate.toFixed(2)}`);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });

        // イシュー#487: 3操作を測り終えてから最後にまとめてexpectを評価する(判定の中身・BUDGETは変えない)。
        // 理由: 以前はexpectを各操作の直後に挟んでいたため、先の操作(order/direction)でBUDGETを超えると
        // そこでテストが止まり、後続(drag)の測定が行われず数値が全く取れなかった。dragだけが赤いこの
        // イシューでは影響していないが、将来どの操作が先に超えても残り2操作の数値を必ず記録する。

        // 準備: custom以外から始める
        await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'acquiredTime'; s.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(1500);

        const orderTrigger = () => {
            const sel = document.getElementById('sort-order');
            sel.value = sel.value === 'title' ? 'acquiredTime' : 'title'; // 交互にして実際に並びが変わる操作を毎回発生させる
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const directionTrigger = () => { document.getElementById('sort-direction').click(); };

        const orderResult = await measureMedian(page, orderTrigger);
        const directionResult = await measureMedian(page, directionTrigger);

        // イシュー#492 step1: directionのtrace内訳・order/directionのA/A(custom切替前=sort-order/
        // sort-directionの状態が崩れないうち)。記録専用・判定には使わない(annotation件数対策で
        // 1操作1行にまとめず、最後に全操作まとめて1〜2行で出す・②承認note(4))。
        const directionTraceRows = await measureTraceReps(page, cdp, directionTrigger, 2);
        const orderAA = await measureAA(page, orderTrigger, 3);
        const directionAA = await measureAA(page, directionTrigger, 3);

        await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(1500);
        const dragTrigger = () => {
            const items = Array.from(document.querySelectorAll('#bookshelf > .book-item[data-asin]'));
            window.bookshelf.reorderBooks(items[0].dataset.asin, items[Math.min(items.length - 1, 10)].dataset.asin);
        };
        const dragResult = await measureMedian(page, dragTrigger);

        // イシュー#492 step1: dragのtrace内訳・A/A(custom状態のまま)。記録専用・判定には使わない。
        const dragTraceRows = await measureTraceReps(page, cdp, dragTrigger, 2);
        const dragAA = await measureAA(page, dragTrigger, 3);

        const summarizeTrace = (rows) => rows.map((r) => ({ tFrame: Math.round(r.tFrame), js: Math.round(r.js), layout: Math.round(r.layout), paint: Math.round(r.paint) }));
        console.log(`[sort-perf-breakdown] direction=${JSON.stringify(summarizeTrace(directionTraceRows))} drag=${JSON.stringify(summarizeTrace(dragTraceRows))}`);
        console.log(`[sort-perf-aa] order=${JSON.stringify(orderAA)} direction=${JSON.stringify(directionAA)} drag=${JSON.stringify(dragAA)}`);

        // 絶対値判定(ローカル・push前でfail、CIでは記録のみ・#377の上限は消さない。judgeAbsolute参照)
        judgeAbsolute(orderResult, BUDGET.order, 'order');
        judgeAbsolute(directionResult, BUDGET.direction, 'direction');
        judgeAbsolute(dragResult, BUDGET.drag, 'drag');

        // イシュー#492 step4(案A・ADR-149): 基準commit(タグ`perf-base`)と今を交互に測り、比が
        // RATIO_LIMIT(既定1.3倍)を超えたらCIでfail。machineの速さに左右されない(#377適合)。
        const orderCompare = await measureCompare(page, cdp, rate, prepareNonCustom, orderTrigger, 3);
        const directionCompare = await measureCompare(page, cdp, rate, prepareNonCustom, directionTrigger, 3);
        const dragCompare = await measureCompare(page, cdp, rate, prepareCustom, dragTrigger, 3);
        console.log(`[sort-perf-ratio] baseTag=${BASE_TAG} limit=${RATIO_LIMIT} order=${JSON.stringify(orderCompare)} direction=${JSON.stringify(directionCompare)} drag=${JSON.stringify(dragCompare)}`);

        judgeRatio(orderCompare.ratio, 'order');
        judgeRatio(directionCompare.ratio, 'direction');
        judgeRatio(dragCompare.ratio, 'drag');
    });
});
