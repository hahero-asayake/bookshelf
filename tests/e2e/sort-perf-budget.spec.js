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
    await page.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
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

test.describe('#397 並び替えの時間上限(913冊・390px・chromium CPUx6)', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'CPU制限はchromiumのCDPのみ(他ブラウザはskip)');

    test('並び順メニューの切り替え・昇順降順・ドラッグが、いずれも許容幅を超えない', async ({ page, context }) => {
        await setup(page);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

        // 準備: custom以外から始める
        await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'acquiredTime'; s.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(1500);

        const orderResult = await measureMedian(page, () => {
            const sel = document.getElementById('sort-order');
            sel.value = sel.value === 'title' ? 'acquiredTime' : 'title'; // 交互にして実際に並びが変わる操作を毎回発生させる
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(orderResult.tFrame, `order tFrame(中央値)=${orderResult.tFrame}ms(最大${orderResult.tFrameMax}ms・記録のみ)`).toBeLessThanOrEqual(BUDGET.order.tFrame);
        expect(orderResult.maxInputDelay, `order inputDelay(中央値)=${orderResult.maxInputDelay}ms(最大${orderResult.maxInputDelayMax}ms・記録のみ)`).toBeLessThanOrEqual(BUDGET.order.inputDelay);

        const directionResult = await measureMedian(page, () => { document.getElementById('sort-direction').click(); });
        expect(directionResult.tFrame, `direction tFrame(中央値)=${directionResult.tFrame}ms(最大${directionResult.tFrameMax}ms・記録のみ)`).toBeLessThanOrEqual(BUDGET.direction.tFrame);
        expect(directionResult.maxInputDelay, `direction inputDelay(中央値)=${directionResult.maxInputDelay}ms(最大${directionResult.maxInputDelayMax}ms・記録のみ)`).toBeLessThanOrEqual(BUDGET.direction.inputDelay);

        await page.evaluate(() => { const s = document.getElementById('sort-order'); s.value = 'custom'; s.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(1500);
        const dragResult = await measureMedian(page, () => {
            const items = Array.from(document.querySelectorAll('#bookshelf > .book-item[data-asin]'));
            window.bookshelf.reorderBooks(items[0].dataset.asin, items[Math.min(items.length - 1, 10)].dataset.asin);
        });
        expect(dragResult.tFrame, `drag tFrame(中央値)=${dragResult.tFrame}ms(最大${dragResult.tFrameMax}ms・記録のみ)`).toBeLessThanOrEqual(BUDGET.drag.tFrame);
        expect(dragResult.maxInputDelay, `drag inputDelay(中央値)=${dragResult.maxInputDelay}ms(最大${dragResult.maxInputDelayMax}ms・記録のみ)`).toBeLessThanOrEqual(BUDGET.drag.inputDelay);
    });
});
