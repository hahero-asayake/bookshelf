// イシュー#670: 本を除外した時、自作の本棚 (「すべての本」以外) の books に除外した本が残るかを測る (赤のまま)。
// 測ること: (a) 本棚の books・端末の控え (localStorage) に残るか・再読込の後も残るか
//           (b) ツリーの冊数と、本棚を開いた時に並ぶ冊数の食い違い
//           (c) 除外を取り消すと本棚に並び直すか
//           (d) プラグインのイベント (book:removed / bookshelf:updated / book:added) の回数
// 起動は tests/e2e/shelf-delete-open-descendant.spec.js と同じ型 (fixture を localStorage に入れる)。
// 再読込で見本を入れ直さないよう、入れたら印を立てる。1冊ずつの除外は window.bookshelf.excludeBook を呼び、確認の窓は
// 画面で押す (除外ボタンは編集モードの本の詳細にしか無い・#622 の 662-H と同じ入口の取り方)。一括の除外は選択モードから画面で行う。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const X = 'B000000001'; // 1冊ずつ除外する本
const Y = 'B000000002'; // 一括で除外する本
const Z = 'B000000003'; // 除外しない本

// fixture に、親 (X・Y・Z) > 子 (X・Y) の自作の本棚を足す
async function bootApp(page) {
    await page.addInitScript(([userData, library, x, y, z]) => {
        if (!localStorage.getItem('e2e670-seeded')) {
            const ud = JSON.parse(userData);
            ud.bookshelves.push({ id: 'e2e-p', internalId: 'e2ep0001', name: '親の本棚', iconName: 'library', books: [x, y, z], isSpecial: false, parent: 'fixall001' });
            ud.bookshelves.push({ id: 'e2e-c', internalId: 'e2ec0001', name: '子の本棚', iconName: 'library', books: [x, y], isSpecial: false, parent: 'e2ep0001' });
            localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
            localStorage.setItem('virtualBookshelf_library', library);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
            localStorage.setItem('e2e670-seeded', '1');
        }
    }, [fixtureUserData, fixtureLibrary, X, Y, Z]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    // プラグインのイベントを数える (起動の後に聞き始める)
    await page.evaluate(() => {
        window.__e2eEv = [];
        for (const ev of ['book:removed', 'book:added', 'bookshelf:updated', 'books:changed']) {
            window.bookshelfAPI.on(ev, (d) => window.__e2eEv.push({ ev, asin: d && (d.asin || (d.book && d.book.asin)), reason: d && d.reason, shelf: d && d.meta && d.meta.id }));
        }
    });
}

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);

async function expandTree(page, keys) {
    for (const key of keys) {
        const toggle = treeNode(page, key).locator('.tree-toggle').first();
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
}

// 本棚・端末の控え・ツリーの冊数を読む
async function snapshot(page) {
    return page.evaluate(() => {
        const shelf = (list, id) => (list || []).find(b => b.id === id) || {};
        const mem = window.bookshelf.userData.bookshelves;
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || 'null'); } catch (e) { stored = null; }
        const treeCount = (id) => {
            const el = document.querySelector(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${id}"] .bsr-count`);
            return el ? el.textContent.trim() : null;
        };
        return {
            memC: shelf(mem, 'e2e-c').books, memP: shelf(mem, 'e2e-p').books,
            storedC: stored ? shelf(stored.bookshelves, 'e2e-c').books : null,
            storedP: stored ? shelf(stored.bookshelves, 'e2e-p').books : null,
            exclusions: (window.bookshelf.userData._storage && window.bookshelf.userData._storage.exclusions) || [],
            treeC: treeCount('e2e-c'), treeP: treeCount('e2e-p'), treeAll: treeCount('all'),
            ev: window.__e2eEv ? [...window.__e2eEv] : null,
        };
    });
}

async function openShelfCount(page, slug, ancestors) {
    await expandTree(page, ['all', ...ancestors]);
    await treeNode(page, slug).click();
    await expect(page).toHaveURL(new RegExp(`#/bookshelf/${slug}$`));
    await page.waitForTimeout(300); // 計測用: 描画の後の冊数を読む (赤の spec・#670 step1 の実測だけに使う)
    return page.locator('.book-item[data-asin]:visible').evaluateAll(els => els.map(e => e.getAttribute('data-asin')));
}

async function confirmOk(page) {
    const cfm = page.locator('.cfm-overlay');
    await expect(cfm).toBeVisible();
    await cfm.locator('.cfm-ok').click();
    await expect(cfm).toBeHidden();
}

const log = (name, v) => console.log(`[670] ${name} ${JSON.stringify(v)}`);

test.describe('#670 除外した本と自作の本棚', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', '実測は chromium だけで取る');

    test('670-A 1冊除外すると、自作の本棚の books・冊数・イベント・再読込・取り消しはどうなるか', async ({ page }) => {
        await bootApp(page);
        const before = await snapshot(page);
        log('A0 before', before);

        const p = page.evaluate((x) => window.bookshelf.excludeBook(x), X);
        await confirmOk(page);
        await p;
        await expect.poll(() => page.evaluate((x) => window.bookshelf.books.some(b => b.asin === x), X)).toBe(false);
        const after = await snapshot(page);
        log('A1 after-exclude', after);
        const shownC = await openShelfCount(page, 'e2e-c', ['e2e-p']);
        log('A1 shown-in-c', shownC);
        const treeA1 = await snapshot(page);
        log('A1 tree-after-open', { treeC: treeA1.treeC, treeP: treeA1.treeP, treeAll: treeA1.treeAll });

        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
        await page.evaluate(() => { window.__e2eEv = []; for (const ev of ['book:removed', 'book:added', 'bookshelf:updated', 'books:changed']) window.bookshelfAPI.on(ev, (d) => window.__e2eEv.push({ ev, asin: d && (d.asin || (d.book && d.book.asin)), reason: d && d.reason })); });
        const afterReload = await snapshot(page);
        log('A2 after-reload', afterReload);
        const shownCReload = await openShelfCount(page, 'e2e-c', ['e2e-p']);
        log('A2 shown-in-c-after-reload', shownCReload);
        const treeA2 = await snapshot(page);
        log('A2 tree-after-open', { treeC: treeA2.treeC, treeP: treeA2.treeP, treeAll: treeA2.treeAll });

        // 再読込の後の取り消し: 書誌の控え (_storage.libraryBooks) が読み直されているかも記録する
        log('A3 libraryBooks-before-unexclude', await page.evaluate(() => {
            const st = window.bookshelf.userData._storage || {};
            return { libraryBooks: Array.isArray(st.libraryBooks) ? st.libraryBooks.length : null, exclusions: st.exclusions || null };
        }));
        await page.evaluate((x) => window.bookshelf.unexcludeBook(x), X);
        await page.waitForTimeout(300); // 計測用: 取り消しの後の状態を読む
        log('A3 x-back-in-books', await page.evaluate((x) => window.bookshelf.books.some(b => b.asin === x), X));
        const afterUndo = await snapshot(page);
        log('A3 after-unexclude', afterUndo);
        const shownCUndo = await openShelfCount(page, 'e2e-c', ['e2e-p']);
        log('A3 shown-in-c-after-unexclude', shownCUndo);

        // 期待 (方針が決まるまでの仮の期待＝「冊数は並ぶ冊数と合う」「除外は1回の book:removed で知らせる」)
        expect.soft(after.ev.filter(e => e.ev === 'book:removed' && e.asin === X)).toHaveLength(1);
        expect.soft(String(treeA1.treeC), 'ツリーの子の本棚の冊数が、並ぶ冊数と合う').toBe(String(shownC.length));
        expect.soft(String(treeA2.treeC), '再読込の後も、ツリーの冊数が並ぶ冊数と合う').toBe(String(shownCReload.length));
        expect.soft(shownCUndo, '取り消すと子の本棚に並び直す').toContain(X);
    });

    test('670-C 再読込せずに除外を取り消すと、自作の本棚に並び直すか・book:added は出るか', async ({ page }) => {
        await bootApp(page);
        const p = page.evaluate((x) => window.bookshelf.excludeBook(x), X);
        await confirmOk(page);
        await p;
        await page.evaluate((x) => window.bookshelf.unexcludeBook(x), X);
        await expect.poll(() => page.evaluate((x) => window.bookshelf.books.some(b => b.asin === x), X)).toBe(true);
        const afterUndo = await snapshot(page);
        log('C1 after-unexclude', afterUndo);
        const shownC = await openShelfCount(page, 'e2e-c', ['e2e-p']);
        log('C1 shown-in-c', shownC);
        expect.soft(afterUndo.ev.filter(e => e.ev === 'book:added' && e.asin === X && e.reason === 'unexcluded')).toHaveLength(1);
        expect.soft(shownC, '取り消すと子の本棚に並び直す').toContain(X);
    });

    test('670-D 1冊除外した後の、ホームのカードと本棚の管理一覧の冊数', async ({ page }) => {
        await bootApp(page);
        const p = page.evaluate((x) => window.bookshelf.excludeBook(x), X);
        await confirmOk(page);
        await p;
        await expect.poll(() => page.evaluate((x) => window.bookshelf.books.some(b => b.asin === x), X)).toBe(false);
        // .book-count から上へたどり、最初に本棚の名前を含む要素 (カード・行) で、どの本棚の冊数かを決める
        const readCounts = (root) => page.evaluate((root) => {
            const out = {};
            document.querySelectorAll(`${root} .book-count`).forEach(el => {
                let n = el.parentElement;
                for (let i = 0; i < 8 && n && !/子の本棚|親の本棚/.test(n.textContent); i++) n = n.parentElement;
                const t = n ? n.textContent : '';
                const key = t.includes('子の本棚') && !t.includes('親の本棚') ? 'c' : (t.includes('親の本棚') && !t.includes('子の本棚') ? 'p' : null);
                if (key && !(key in out)) out[key] = el.textContent.trim();
            });
            return out;
        }, root);
        await page.goto('index.html#/');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
        await page.waitForTimeout(500); // 計測用: ホームの描画の後に読む
        const home = await readCounts('body');
        log('D1 home-card-counts', home);
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        const manager = await readCounts('#bookshelves-list');
        log('D1 manager-list-counts', manager);
        expect.soft(manager.c, '管理一覧の子の本棚の冊数が、並ぶ冊数 (1冊) と合う').toBe('1冊');
    });

    test('670-B 一括で除外すると、book:removed は出るか・自作の本棚の books はどうなるか', async ({ page }) => {
        await bootApp(page);
        // 一括の除外は画面から: 「すべての本」を開き、選択モードで Y を選んで「すべての本から除外」
        await expandTree(page, []);
        await treeNode(page, 'all').click();
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await page.locator('#toggle-select-mode').click();
        await page.locator(`#bookshelf .book-item[data-asin="${Y}"]`).first().click();
        await page.locator('#bulk-exclude').click();
        await confirmOk(page);
        await expect(page.locator('.toast-success', { hasText: '冊を除外しました' })).toBeVisible();
        await page.locator('#toggle-select-mode').click();
        await expect.poll(() => page.evaluate((y) => window.bookshelf.books.some(b => b.asin === y), Y)).toBe(false);
        const after = await snapshot(page);
        log('B1 after-bulk-exclude', after);
        const shownC = await openShelfCount(page, 'e2e-c', ['e2e-p']);
        log('B1 shown-in-c', shownC);
        const treeB1 = await snapshot(page);
        log('B1 tree-after-open', { treeC: treeB1.treeC, treeP: treeB1.treeP, treeAll: treeB1.treeAll });

        expect.soft(after.ev.filter(e => e.ev === 'book:removed' && e.asin === Y), '一括の除外も book:removed を1回出す').toHaveLength(1);
        expect.soft(String(treeB1.treeC), 'ツリーの子の本棚の冊数が、並ぶ冊数と合う').toBe(String(shownC.length));
    });
});
