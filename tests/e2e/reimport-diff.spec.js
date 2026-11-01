// イシュー#406: 再取込(importSelectedBooks)の差分描画(_renderListDiff)で、
// 見込み(movedEstimate)と実際の移動数(insertBefore呼び出し回数)がずれ、わずかな位置ズレでも
// 残り全件が連鎖してinsertBeforeされていた(406-results.md step1)。LIS(最長増加部分列)で
// 「動かさなくてよい本の集合」を決めて移動を最小化した。確かめること:
//   1. 移動数(moved)が理論上の下限(見込みmovedEstimate)に近い上限に収まる(連鎖が起きていない)
//   2. 最終的なDOMのasin順序が _orderedBooksToRender と一致する
//   3. カードの枚数が books.length と一致する(asin重複によってカードが消えたり二重に出たりしない)
// データにはasin重複を2組含める(406-results.mdで確認した実データの不備を模す・②承認#406 step3(2))。
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
// asin重複を2組仕込む(406-results.mdで見つかったデータ不備の再現): 別内容の本に同じasinを付ける
books[10] = { ...books[10], asin: books[20].asin }; // D...011 の asin を D...021 と同じに
books[40] = { ...books[40], asin: books[41].asin, title: '重複asinの別内容本A' };

const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [{ id: 'all', internalId: 'fixall406', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map((b) => b.asin), notes: {} }],
    notes: {}, settings: { sortOrder: 'custom', sortDirection: 'asc' }, bookOrder: { all: books.map((b) => b.asin) }, stats: {}, version: '2.0',
};

async function setup(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
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
async function measureDiff(page, trigger) {
    return page.evaluate(async (triggerSrc) => {
        const bs = window.bookshelf;
        const container = document.getElementById('bookshelf');
        // トリガー前のDOM(asin→位置・asin→要素)を取る。重複asinは最初の出現だけ残し、
        // dupAsinsに記録する(_renderListDiffの初期走査と同じ=406-results.md step1の孤立要素対策・
        // ②差し戻しで見つかった退行対策)。
        const oldIndex = new Map(); const oldEls = new Map(); const dupAsins = new Set();
        { let i = 0; for (const el of container.querySelectorAll('.book-item[data-asin]')) { if (oldIndex.has(el.dataset.asin)) { dupAsins.add(el.dataset.asin); } else { oldIndex.set(el.dataset.asin, i); oldEls.set(el.dataset.asin, el); } i++; } }
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
        // _renderListDiff内のlisSeq計算と同じロジック(旧位置があっても内容が変わる=rkey不一致なら
        // 新規扱い-1にする。重複asinで片方が作り直しになる分を正しく除外する)。
        const seq = expectedBooks.map((b) => {
            if (dupAsins.has(b.asin)) return -1;
            const p = oldIndex.get(b.asin);
            if (p === undefined) return -1;
            const el = oldEls.get(b.asin);
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
