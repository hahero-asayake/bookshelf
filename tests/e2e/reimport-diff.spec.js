// イシュー#406/#480: 再取込(importSelectedBooks)・並べ替え・手動追加・削除の差分描画(_renderListDiff)で、
// 見込み(movedEstimate)と実際の移動数(insertBefore呼び出し回数)がずれ、わずかな位置ズレでも
// 残り全件が連鎖してinsertBeforeされていた(406-results.md step1)。LIS(最長増加部分列)で
// 「動かさなくてよい本の集合」を決めて移動を最小化した(#406)。
// さらに#480: asinが重複する本(同じ本の二重登録=B0F2TC5B79型・別内容の本に同じasin=B00I8AT186型、
// tmp/401の実データで確認済み・scripts/verify/480-step1-investigation.md参照)でも、
// old/oldIndexのMapキーをasinからdedupKey(asin、重複時は`${asin}#${出現番号}`。保存はしない・
// 描画の中だけで閉じる・480-step2-decision.md)に変えることで、カードの消失・取り違えが起きない
// ようにした。確かめること:
//   1. 移動数(moved)が理論上の下限(見込みmovedEstimate)に近い上限に収まる(連鎖が起きていない)
//   2. 最終的なDOMの順序が _orderedBooksToRender と一致する
//   3. カードの枚数が books.length と一致する(asin重複によってカードが消えたり二重に出たりしない)
//   4. (#480) 内容・並び順を変えない2回目の描画で、重複カードの2枚目が作り直されない(同じ要素)
import { test, expect } from './helpers/test-base.js';

const N = 60;
const books = Array.from({ length: N }, (_, i) => {
    const n = i + 1;
    return {
        asin: `D${String(n).padStart(9, '0')}`, title: `再取込テストの本 ${String(n).padStart(3, '0')}`, authors: `著者${n % 7}`,
        acquiredTime: 1700000000000 + n * 1000, readStatus: n % 2 === 0 ? 'READ' : 'UNKNOWN',
        productImage: '', source: 'kindle_import', addedDate: 1700000000000 + n * 1000,
    };
});
// asin重複を2組仕込む(406-results.md/480-step1-investigation.mdで確認した実データの不備を模す):
// (1) B0F2TC5B79型: 同じ本の二重登録(内容はほぼ同一、acquiredTime/addedDateだけ僅差)
books[10] = { ...books[20], acquiredTime: books[20].acquiredTime + 1, addedDate: books[20].addedDate + 1 };
// (2) B00I8AT186型: 別内容の本に同じasinが付いている
books[40] = { ...books[40], asin: books[41].asin, title: '重複asinの別内容本A' };

const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [{ id: 'all', internalId: 'fixall406', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map((b) => b.asin), notes: {} }],
    notes: {}, settings: { sortOrder: 'custom', sortDirection: 'asc' }, bookOrder: { all: books.map((b) => b.asin) }, stats: {}, version: '2.0',
};

async function setup(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // ネイティブ confirm (削除確認) は常に OK (#480 削除テスト用)。
    // // CHAR→U5: confirm() が confirmDialog (DOM・Promise) になったため page.on('dialog') は発火しない。
    // 出現を MutationObserver で監視して自動で OK を押す。
    await page.addInitScript(() => {
        new MutationObserver(() => {
            const btn = document.querySelector('.cfm-overlay .cfm-ok');
            if (btn) btn.click();
        }).observe(document, { childList: true, subtree: true });
    });
    await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await page.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; window.bookshelf.switchBookshelf('all'); });
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, N);
    return errors;
}

// 1回分の差分描画トリガーの前後で、insertBefore呼び出し回数(moved)・wouldMove(LISの理論値)・
// 枚数・DOM順序を一括で測る。wouldMoveはトリガー直前のDOM(oldIndex)と直後の_orderedBooksToRender()
// からテスト側でLIS(bs._computeLisKeepSetを直接呼ぶ)を計算し、実測のinsCountと比較する。
// イシュー#480: キーは dataset.dedupKey を読む(前回描画時に bs が付与した値。無ければ asin に
// フォールバック)。asin をそのままMapキーにしていた#406時点の旧実装はここでは再現しない。
async function measureDiff(page, trigger) {
    return page.evaluate(async (triggerSrc) => {
        const bs = window.bookshelf;
        const container = document.getElementById('bookshelf');
        const oldIndex = new Map(); const oldEls = new Map();
        { let i = 0; for (const el of container.querySelectorAll('.book-item[data-asin]')) {
            const dk = el.dataset.dedupKey || el.dataset.asin;
            oldIndex.set(dk, i); oldEls.set(dk, el); i++;
        } }
        let insCount = 0;
        const orig = Node.prototype.insertBefore;
        Node.prototype.insertBefore = function (...a) { if (this.id === 'bookshelf') insCount++; return orig.apply(this, a); };
        try {
            // eslint-disable-next-line no-eval
            await (0, eval)(`(async () => { ${triggerSrc} })()`);
        } finally {
            Node.prototype.insertBefore = orig;
        }
        const expectedBooks = bs._orderedBooksToRender();
        const expected = expectedBooks.map((b) => b.asin);
        const dedupKeys = bs._dedupKeysFor(expectedBooks); // イシュー#480
        // _renderListDiff内のlisSeq計算と同じロジック(旧位置があっても内容が変わる=rkey不一致なら
        // 新規扱い-1にする)。
        const seq = expectedBooks.map((b, idx) => {
            const dk = dedupKeys[idx];
            const p = oldIndex.get(dk);
            if (p === undefined) return -1;
            const el = oldEls.get(dk);
            const key = bs._bookCardKey(b, bs.currentView);
            return (el && el.dataset.rkey === key) ? p : -1;
        });
        const keepSet = bs._computeLisKeepSet(seq);
        const wouldMove = expected.length - keepSet.size;
        const domAsins = [...container.querySelectorAll('.book-item[data-asin]')].map((e) => e.dataset.asin);
        return { insCount, wouldMove, expected, domAsins, booksLength: bs.books.length };
    }, trigger);
}

test('再取込(asin重複を含む)は枚数・並びが正しく、連鎖が起きない (#406)', async ({ page }) => {
    const errors = await setup(page);
    const r = await measureDiff(page, `
        const bs = window.bookshelf;
        bs.pendingImportBooks = bs.books.map((b, k) => ({ ...b, readStatus: (k % 10 === 0) ? (b.readStatus === 'READ' ? 'UNKNOWN' : 'READ') : b.readStatus }));
        bs.importSource = 'file';
        await bs.importSelectedBooks();
    `);
    expect(r.domAsins.length).toBe(r.booksLength);
    expect(r.expected.length).toBe(r.booksLength);
    expect(r.domAsins).toEqual(r.expected);
    // moved(insCount) は wouldMove(LISの理論値)にちょうど一致する(②差し戻し(1): anchor方式で保証)
    expect(r.insCount).toBe(r.wouldMove);
    expect(r.insCount).toBeLessThan(N / 2);
    expect(errors).toEqual([]);
});

// ②差し戻し(2): order/direction/custom切替/custom戻しでも moved===wouldMove を確認する。
// custom への切替(401-sort-perf.mjsの op('order', i=3) 相当)は旧実装(cursor比較のみ)で
// moved=787(全体の86%・連鎖)になっていた退行の回帰テスト。直接原因は、cursor比較が
// keepSet を参照せず「el===cursorか」だけで判定していたため、custom順の並びのように
// 孤立要素が無くても局所的なズレが多数分散すると連鎖したこと(406-results.md step3続き)。
for (const [label, run] of [
    ['order(title)', `document.getElementById('sort-order').value='title'; document.getElementById('sort-order').dispatchEvent(new Event('change',{bubbles:true}));`],
    ['direction', `document.getElementById('sort-direction').click();`],
    ['order→custom(切替)', `document.getElementById('sort-order').value='custom'; document.getElementById('sort-order').dispatchEvent(new Event('change',{bubbles:true}));`],
    ['order→acquiredTime(customから戻す)', `document.getElementById('sort-order').value='acquiredTime'; document.getElementById('sort-order').dispatchEvent(new Event('change',{bubbles:true}));`],
]) {
    test(`${label}: moved は wouldMove に一致し連鎖しない (#406)`, async ({ page }) => {
        const errors = await setup(page);
        const r = await measureDiff(page, run);
        expect(r.domAsins.length).toBe(r.booksLength);
        expect(r.domAsins).toEqual(r.expected);
        expect(r.insCount).toBe(r.wouldMove);
        expect(errors).toEqual([]);
    });
}

// イシュー#480: 手動追加・削除でも枚数・並びが正しいことを確認する(取込・並べ替えは上のテストでカバー済み)。
test('手動追加は枚数・並びが正しい、既存の重複asinも保たれる (#480)', async ({ page }) => {
    const errors = await setup(page);
    const r = await measureDiff(page, `
        const bs = window.bookshelf;
        document.getElementById('manual-asin').value = 'D000000099';
        document.getElementById('manual-title').value = '手動追加テスト本';
        document.getElementById('manual-authors').value = '著者Z';
        await bs.addBookManually();
    `);
    expect(r.domAsins.length).toBe(r.booksLength);
    expect(r.booksLength).toBe(N + 1);
    expect(r.domAsins).toEqual(r.expected);
    expect(errors).toEqual([]);
});

test('削除は枚数・並びが正しい、重複asinの片方だけ消しても残る方は壊れない (#480)', async ({ page }) => {
    const errors = await setup(page);
    // 重複asin(books[10]とbooks[20]、同じasin)のうち片方だけを消す。deleteBook(asin)は
    // asin一致の最初の1件だけを消す(book-manager.js:426 findIndex)。
    const dupAsin = books[20].asin;
    const r = await measureDiff(page, `
        const bs = window.bookshelf;
        await bs.deleteBook(${JSON.stringify(dupAsin)});
    `);
    expect(r.domAsins.length).toBe(r.booksLength);
    expect(r.booksLength).toBe(N - 1);
    expect(r.domAsins).toEqual(r.expected);
    // 重複asinのうち残った1件は消えずに表示されている
    expect(r.domAsins.filter((a) => a === dupAsin).length).toBe(1);
    expect(errors).toEqual([]);
});

// イシュー#480 合格条件(iii): 内容・並び順を変えない2回目の描画では、重複カードの2枚目が
// 作り直されない(同じDOM要素インスタンスのまま)。#406(c5a466d)が入れた「DOM走査で2枚目以降を
// 即removeする」対症療法は、dedupKey方式では不要になり撤去した(撤去後も要素が維持されることを
// ここで確認する)。
test('重複asinは2回目の描画でカードが作り直されない (#480)', async ({ page }) => {
    const errors = await setup(page);
    const result = await page.evaluate(() => {
        const bs = window.bookshelf;
        const container = document.getElementById('bookshelf');
        const currentBooks = bs._orderedBooksToRender();
        const counts = new Map();
        for (const b of currentBooks) counts.set(b.asin, (counts.get(b.asin) || 0) + 1);
        const dupAsins = [...counts.entries()].filter(([, c]) => c > 1).map(([a]) => a);
        // 重複asinを持つ要素にマーカーを付ける(dedupKeyごとに一意な印)
        const markBefore = new Map();
        for (const el of container.querySelectorAll('.book-item[data-asin]')) {
            if (dupAsins.includes(el.dataset.asin)) {
                const dk = el.dataset.dedupKey || el.dataset.asin;
                markBefore.set(dk, el);
            }
        }
        // 何も変えず再描画(内容・ソート順ともに不変=通常の2回目の描画)
        bs._renderListDiff(container);
        const sameRef = [];
        for (const [dk, elBefore] of markBefore) {
            const elAfter = [...container.querySelectorAll('.book-item[data-asin]')].find((e) => (e.dataset.dedupKey || e.dataset.asin) === dk);
            sameRef.push(elAfter === elBefore);
        }
        return { dupAsinsCount: dupAsins.length, markedCount: markBefore.size, sameRef };
    });
    expect(result.dupAsinsCount).toBe(2); // 406-results.md/480相当の2組
    expect(result.markedCount).toBe(4); // 2組×2枚
    expect(result.sameRef.every(Boolean)).toBe(true);
    expect(errors).toEqual([]);
});
