// イシュー#295: 「時間差で起きる挙動」を検出する共通ロジック。
// observe() は Playwright の Page (テストランナー経由・connectOverCDP 経由のどちらでも
// 同じ Page クラスなので区別なく渡せる) を受け取り、操作直後から一定時間 (既定3秒・100ms間隔)
// DOM/URL を定期観測する。judge() はその観測結果を次の3点で機械判定する:
//   (1) 最終状態が期待どおりか (expectFinal)
//   (2) 観測中に禁止状態 (ホーム・別モーダル・閉じたはずの面) が1フレームでも出ていないか (forbidden)
//   (3) 最終状態に達した後に状態が変化していないか (遅延の閉じ/開き/スクロール変化・
//       600msデバウンス自動保存後の変化等) — NG時は該当フレーム番号を返す。
// 3つの実行先すべてから import して使う:
//   - tests/e2e/checklist-timing.spec.js (ローカル chromium/webkit・test runner)
//   - scripts/verify/checklist295.mjs (本番・素の Playwright)
//   - /home/kuroko/kuroko/work/225-mobile/check295.mjs (Android エミュ実Chrome・CDP接続)
// このファイル自体は playwright 等の外部パッケージに依存しない (page 引数だけで動く) ため、
// どこからでも相対/絶対パスで素の import ができる。

export async function snapState(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        const headingMenu = document.querySelector('.mde-heading-menu');
        const ed = bs && (bs._bookMemoEditor || bs.bookMemoEditor);
        return {
            url: location.href,
            hash: location.hash,
            openModals: Array.from(document.querySelectorAll('.modal.show')).map((m) => m.id),
            detailPinned: document.body.classList.contains('book-detail-pinned'),
            drawer: document.body.classList.contains('drawer-open'),
            headingMenuOpen: !!headingMenu && headingMenu.offsetParent !== null,
            confirmOpen: !!document.querySelector('.cfm-overlay'),
            scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : null,
            memoValue: ed ? (() => { try { return ed.value(); } catch (_) { return null; } })() : null,
            histDepth: (bs && bs._modalHistStack) ? bs._modalHistStack.length : null,
        };
    }).catch((e) => ({ error: String(e).slice(0, 160) }));
}

// 判定(3)で使う「比較用の状態」。t/i/tWall等のタイムスタンプ系は除く。
const SNAPSHOT_KEYS = ['hash', 'openModals', 'detailPinned', 'drawer', 'headingMenuOpen', 'confirmOpen', 'scrollTop', 'memoValue', 'histDepth'];
function stateKey(r) { return JSON.stringify(SNAPSHOT_KEYS.map((k) => r[k])); }

// 操作直後から ms 間、step 間隔で DOM/URL を記録する。dir を渡すとフレーム毎にスクショも残す
// (番号0始まり・3桁ゼロ埋め)。実時間は page.evaluate 等のオーバーヘッド分 ms を超えることがある
// (「100ms間隔程度」で足りる・厳密同期は不要)。
// phases (イシュー#326 step2追加): [{until, step}, ...] を渡すと、経過時間 tWall < until の
// 間隔を順に適用する可変間隔撮影ができる (未指定時は従来通り step 固定・後方互換)。
// 例: phases=[{until:1000, step:50}, {until:3000, step:100}] = 1秒まで50ms間隔・以降100ms間隔。
export async function observe(page, { ms = 3000, step = 100, dir = null, phases = null } = {}) {
    const records = [];
    const start = Date.now();
    let i = 0;
    const stepAt = (tWall) => {
        if (!phases) return step;
        for (const p of phases) { if (tWall < p.until) return p.step; }
        return phases[phases.length - 1].step;
    };
    while (Date.now() - start <= ms) {
        const s = await snapState(page);
        const tWall = Date.now() - start;
        records.push({ i, tWall, ...s });
        if (dir) {
            await page.screenshot({ path: `${dir}/${String(i).padStart(3, '0')}.png` }).catch(() => {});
        }
        i++;
        await page.waitForTimeout(stepAt(tWall));
    }
    return records;
}

// expectFinal: { key: 値 または (actual)=>bool } の最終状態チェック。
// forbidden: (record)=>bool。観測中の1フレームでも true になれば禁止状態が出現したと判定する。
export function judge(records, { expectFinal = {}, forbidden = null } = {}) {
    const result = { ok: true, reasons: [], forbiddenFrame: null, settleFrame: null, driftFrame: null, frames: records.length };
    if (!records.length) { result.ok = false; result.reasons.push('観測0件'); return result; }
    const final = records[records.length - 1];
    // (1) 最終状態
    for (const [k, v] of Object.entries(expectFinal)) {
        const actual = final[k];
        const match = typeof v === 'function' ? !!v(actual) : JSON.stringify(actual) === JSON.stringify(v);
        if (!match) {
            result.ok = false;
            result.reasons.push(`最終状態不一致: ${k} actual=${JSON.stringify(actual)}`);
        }
    }
    // (2) 禁止状態の一瞬出現
    if (forbidden) {
        for (const r of records) {
            if (forbidden(r)) {
                result.ok = false;
                result.forbiddenFrame = r.i;
                result.reasons.push(`禁止状態がフレーム${r.i}(+${r.tWall}ms)で出現`);
                break;
            }
        }
    }
    // (3) 最終状態到達後の遅延変化 (最終状態と同じ状態になった最初のフレームを「落ち着いた」地点とし、
    //     それ以降で一度でも状態が変わればNG)
    const finalKey = stateKey(final);
    const settleIdx = records.findIndex((r) => stateKey(r) === finalKey);
    result.settleFrame = settleIdx;
    for (let j = settleIdx; j < records.length; j++) {
        if (stateKey(records[j]) !== finalKey) {
            result.ok = false;
            result.driftFrame = records[j].i;
            result.reasons.push(`最終状態到達(フレーム${settleIdx})後にフレーム${records[j].i}(+${records[j].tWall}ms)で状態が変化`);
            break;
        }
    }
    return result;
}
