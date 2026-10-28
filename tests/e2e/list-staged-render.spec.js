// イシュー#401 案C (ADR-139): 並べ替えの時だけ段階描画（見えている所を先に置き、残りは小分けで後から足す）。
// 次の3点を確かめる（②の承認条件）:
//   1. 置き終えた時の DOM は、従来どおり全件の .book-item が並び順どおりにある
//   2. ui:books-rendered は全件を置き終えてから1回だけ出る（途中の段階では出ない）
//   3. 途中の状態で並べ替え・1冊移動・クリックが来ても壊れない（重複・欠け・順序ずれ・例外が無い）
import { test, expect } from './helpers/test-base.js';

const N = 913;
const books = Array.from({ length: N }, (_, i) => {
    const n = i + 1;
    return {
        asin: `B${String(n).padStart(9, '0')}`, title: `段階描画の本 第${n}話`, authors: `著者${n % 17}`,
        acquiredTime: 1700000000000 + ((n * 104729) % N) * 1000,
        readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000,
    };
});
const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [{ id: 'all', internalId: 'fixall401', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map((b) => b.asin), notes: {} }],
    notes: {}, settings: { sortOrder: 'acquiredTime', sortDirection: 'desc' }, bookOrder: {}, stats: {}, version: '2.0',
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
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.bookshelf.switchBookshelf('all');
    });
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, N);
    // ui:books-rendered の発火を数える（プラグインと同じ経路=pluginAPI._emit を外から包む）
    const hasApi = await page.evaluate(() => {
        const bs = window.bookshelf;
        if (!bs.pluginAPI) return false;
        window.__rendered = [];
        const orig = bs.pluginAPI._emit.bind(bs.pluginAPI);
        bs.pluginAPI._emit = (ev, payload) => {
            if (ev === 'ui:books-rendered') window.__rendered.push({ count: document.querySelectorAll('#bookshelf > .book-item').length, payload });
            return orig(ev, payload);
        };
        return true;
    });
    expect(hasApi, 'pluginAPI が無い（ui:books-rendered を数えられない）').toBe(true);
    return errors;
}

// DOM の並び（asin）が、アプリが描くべき並び順と完全に一致するか
async function expectDomMatchesOrder(page) {
    const r = await page.evaluate(() => {
        const dom = Array.from(document.querySelectorAll('#bookshelf > .book-item')).map((el) => el.dataset.asin);
        const want = window.bookshelf._orderedBooksToRender().map((b) => b.asin);
        return { dom, want, uniq: new Set(dom).size, others: document.querySelectorAll('#bookshelf > :not(.book-item)').length };
    });
    expect(r.dom.length).toBe(N);
    expect(r.uniq).toBe(N);
    expect(r.others).toBe(0);
    expect(r.dom).toEqual(r.want);
}

test.describe('#401 並べ替えの段階描画（913冊）', () => {
    test('昇順/降順の切替: 先に一部だけ置き、置き終えた時に全件が並び順どおり・通知は1回だけ', async ({ page }) => {
        const errors = await setup(page);
        const syncCount = await page.evaluate(() => {
            window.__rendered = [];
            document.getElementById('sort-direction').click();
            return document.querySelectorAll('#bookshelf > .book-item').length; // 同期処理の直後
        });
        expect(syncCount, '段階描画の経路を通っていない（同期で全件置いた）').toBeLessThan(N);
        expect(syncCount).toBeGreaterThan(0);
        const midEmits = await page.evaluate(() => window.__rendered.length);
        expect(midEmits, '途中の段階で ui:books-rendered が出た').toBe(0);
        await page.waitForFunction(() => window.__rendered.length > 0);
        await page.waitForTimeout(300);
        const emits = await page.evaluate(() => window.__rendered);
        expect(emits.length).toBe(1);
        expect(emits[0].count, '通知の時点で全件そろっていない').toBe(N);
        await expectDomMatchesOrder(page);
        expect(errors).toEqual([]);
    });

    test('途中で並び順を変える: 残りを置き切ってから差分を取り、重複・欠け・順序ずれが無い', async ({ page }) => {
        const errors = await setup(page);
        await page.evaluate(() => {
            window.__rendered = [];
            document.getElementById('sort-direction').click(); // 段階描画が始まる
            const sel = document.getElementById('sort-order'); // 残りを置く前に、もう一度並べ替える
            sel.value = 'title';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => !window.bookshelf._listTail);
        await page.waitForTimeout(300);
        await expectDomMatchesOrder(page);
        const emits = await page.evaluate(() => window.__rendered);
        expect(emits.length, '操作ごとに1回ずつ').toBe(2);
        for (const e of emits) expect(e.count).toBe(N);
        expect(errors).toEqual([]);
    });

    test('途中で1冊を動かす（まだ置かれていない本へのドロップ）: 並び順どおりに反映される', async ({ page }) => {
        const errors = await setup(page);
        const r = await page.evaluate(() => {
            const bs = window.bookshelf;
            document.getElementById('sort-direction').click(); // 段階描画が始まる
            const order = bs._orderedBooksToRender().map((b) => b.asin);
            const placed = document.querySelectorAll('#bookshelf > .book-item').length;
            const dragged = order[0];
            const target = order[order.length - 5]; // まだ DOM に無い位置
            const targetInDom = !!document.querySelector(`#bookshelf > .book-item[data-asin="${target}"]`);
            bs.reorderBooks(dragged, target);
            return { placed, targetInDom, dragged, target };
        });
        expect(r.targetInDom, 'ドロップ先がすでに置かれていた（途中状態を作れていない）').toBe(false);
        await page.waitForTimeout(300);
        await expectDomMatchesOrder(page);
        const pos = await page.evaluate(([d, t]) => {
            const dom = Array.from(document.querySelectorAll('#bookshelf > .book-item')).map((el) => el.dataset.asin);
            return { d: dom.indexOf(d), t: dom.indexOf(t) };
        }, [r.dragged, r.target]);
        expect(pos.d, '動かした本がドロップ先の直前に入っていない').toBe(pos.t - 1);
        expect(errors).toEqual([]);
    });

    test('途中でカードをクリックしても例外が出ず、置き終えた一覧は並び順どおり', async ({ page }) => {
        const errors = await setup(page);
        await page.evaluate(() => {
            document.getElementById('sort-direction').click();
            const first = document.querySelector('#bookshelf > .book-item');
            first.click();
        });
        await page.waitForFunction(() => !window.bookshelf._listTail);
        await page.waitForTimeout(300);
        await expectDomMatchesOrder(page);
        expect(errors).toEqual([]);
    });
});
