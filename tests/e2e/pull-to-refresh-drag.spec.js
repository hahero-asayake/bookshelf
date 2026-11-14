// イシュー#659: 一覧の先頭で本のつまみをタッチで下へ運んで離すと、「引っぱって更新」(js/bookshelf.js の
// _initPullToRefresh・72px 以上で離すと 350ms 後に location.reload) が働き、ページが再読込されるかを見る。
// タッチは chromium の CDP Input.dispatchTouchEvent (ブラウザのタッチ→ポインタの変換を通る・本物に一番近い。#654 と同じ)。
// 再読込の判定: 操作の前に window へ印を置き、離してから 1.5 秒の間に (a) 印が消えたか (b) load の回数
// (c) 離した直後に #ptr-indicator に is-refreshing が付いたか を見る。場面ごとの記録は _local/659/probe.jsonl。
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest, stubStorageForTest } from './helpers/gate-setup.js';

const BOOKS = [['B0PTR00001', '引っぱりの本 1'], ['B0PTR00002', '引っぱりの本 2'], ['B0PTR00003', '引っぱりの本 3']];
const listItems = (page) => page.locator('#bookshelf .book-item');
const card = (page, asin) => page.locator(`#bookshelf .book-item[data-asin="${asin}"]`);
const drawer = (page) => page.locator('#app-sidebar');
const LOG_DIR = path.join(process.cwd(), '_local', '659');

function seed(page) {
    const library = {
        books: BOOKS.map(([asin, title], i) => ({ asin, title, authors: '著者', acquiredTime: 1727000000000 + i, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1727000000000 })),
        metadata: { lastImportDate: 1727000000000, totalBooks: BOOKS.length },
    };
    const userData = {
        bookshelves: [{ id: 'all', name: 'すべての本', books: BOOKS.map(([a]) => a), isSpecial: true, internalId: 'all' }],
        notes: {}, settings: { sortOrder: 'custom' }, bookOrder: {}, stats: {}, version: 2,
    };
    return page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
}

async function openAllShelf(page) {
    await seed(page);
    await bootAppForTest(page);
    await stubStorageForTest(page);
    await page.locator('[data-mobile-nav="shelves"]').tap();
    await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').tap();
    await expect(page).toHaveURL(/#\/bookshelf\/all$/);
    await expect(listItems(page)).toHaveCount(BOOKS.length);
    await expect(drawer(page)).not.toBeInViewport({ ratio: 0.01 });
    await expect(page.locator('#bookshelf')).toHaveClass(/is-custom-order/);
}

const order = (page) => listItems(page).evaluateAll((els) => els.map((e) => e.dataset.asin));
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function cdpTouch(page) {
    const cdp = await page.context().newCDPSession(page);
    return {
        start: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }),
        move: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }),
        end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    };
}

// 印を置き、load を数え始める (印は再読込で消える。addInitScript は再読込でも流れるので、印は evaluate で置く)
async function armProbe(page) {
    const probe = { loads: 0 };
    page.on('load', () => { probe.loads += 1; });
    await page.evaluate(() => { window.__ptr659 = 'before'; });
    return probe;
}

// from から真下へ dy だけ、steps 回に分けて運んで離す。離す前の様子と、離した直後の印 (is-refreshing) を返す
const dragDown = (page, from, dy, steps = 8) => dragTo(page, from, { x: from.x, y: from.y + dy }, steps);

async function dragTo(page, from, to, steps = 8) {
    const t = await cdpTouch(page);
    await t.start(from);
    for (let i = 1; i <= steps; i++) await t.move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    const before = await page.evaluate(() => ({
        dragging: !!document.querySelector('.book-item.dragging'),
        armed: !!document.getElementById('ptr-indicator')?.classList.contains('is-armed'),
    }));
    await t.end();
    const refreshing = await page.evaluate(() => !!document.getElementById('ptr-indicator')?.classList.contains('is-refreshing'));
    return { ...before, refreshing };
}

// 離してから 1.5 秒の間に再読込されたか
async function observeReload(page, probe) {
    await page.waitForTimeout(1500);
    await page.waitForLoadState('load');
    const marker = await page.evaluate(() => window.__ptr659 || null);
    return { loads: probe.loads, markerKept: marker === 'before' };
}

function writeRecord(record) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'probe.jsonl'), JSON.stringify(record) + '\n');
}

test.describe('引っぱって更新: 本のつまみをタッチで下へ運ぶ (イシュー#659)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test.skip(({ browserName }) => browserName !== 'chromium', 'CDP のタッチは chromium だけ');

    test('(B) 対照: カード以外の空いた所から下へ 120px 引いて離すと再読込される', async ({ page }, info) => {
        await openAllShelf(page);
        expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches), 'タッチ端末として開いている (引っぱって更新が付く条件)').toBe(true);
        // 一覧の中の、カードでもボタンでもない所を上から探す (下へ 120px 引ける高さに限る)
        const hit = await page.evaluate(() => {
            const maxY = window.innerHeight - 200;
            for (let y = 60; y <= maxY; y += 10) {
                for (const x of [20, 195, 370]) {
                    const el = document.elementFromPoint(x, y);
                    if (!el || !el.closest('#view-bookshelf') || el.closest('.book-item, button, a, input, select, textarea, label, [role="button"]')) continue;
                    return { x, y, el: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` };
                }
            }
            return null;
        });
        expect(hit, '一覧の中に、カードでもボタンでもない所がある').not.toBeNull();
        const from = { x: hit.x, y: hit.y };
        const probe = await armProbe(page);
        const gesture = await dragDown(page, from, 120);
        const result = await observeReload(page, probe);
        writeRecord({ scene: 'B', repeat: info.repeatEachIndex, from, startEl: hit.el, dy: 120, ...gesture, ...result });
        expect(gesture.refreshing, '離した直後に「更新中」の印が付く').toBe(true);
        await expect.poll(() => probe.loads, { timeout: 3000 }).toBeGreaterThan(0);
        expect(result.markerKept, '再読込で印が消える').toBe(false);
    });

    test('(A) つまみを一覧の先頭で下へ 120px 運んで離しても再読込されない', async ({ page }, info) => {
        await openAllShelf(page);
        const from = center(await card(page, BOOKS[0][0]).locator('.drag-handle').boundingBox());
        const orderBefore = await order(page);
        const probe = await armProbe(page);
        const gesture = await dragDown(page, from, 120);
        const result = await observeReload(page, probe);
        const orderAfter = result.markerKept ? await order(page) : null;
        writeRecord({ scene: 'A', repeat: info.repeatEachIndex, from, dy: 120, ...gesture, ...result, orderBefore, orderAfter });
        expect(gesture.dragging, 'つまみのドラッグが始まっている (離す前に .dragging が付く)').toBe(true);
        expect(gesture.refreshing, '離した直後に「更新中」の印が付かない').toBe(false);
        expect(result.loads, '離してから 1.5 秒の間に再読込されない').toBe(0);
        expect(result.markerKept, '置いた印が残っている').toBe(true);
    });

    // (A) の続き: 運んだ先が別の本の上になる形で、並べ替えが効いたこと (並びが変わった) も確かめる。
    // 390幅では本が2列に並ぶので、1冊目の下の段の本の上まで運ぶ (下へ 72px より遠く・横より縦に離れた向き＝引っぱりと見なされる向き)
    test('(A2) つまみを下の段の本の上まで運んで離すと、並びが変わり再読込されない', async ({ page }, info) => {
        await openAllShelf(page);
        const from = center(await card(page, BOOKS[0][0]).locator('.drag-handle').boundingBox());
        // 1冊目の前へ入れても並びが変わらない2冊目は除き、一番下の段の本を選ぶ (1冊目をその前へ入れると並びが変わる)
        const target = await listItems(page).evaluateAll((els, f) => {
            let found = null;
            for (const el of els.slice(2)) {
                const r = el.getBoundingClientRect();
                const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                if (p.y - f.y > 72 && Math.abs(p.x - f.x) < p.y - f.y) found = { asin: el.dataset.asin, x: p.x, y: p.y };
            }
            return found;
        }, from);
        expect(target, '1冊目の下の段に本がある').not.toBeNull();
        const orderBefore = await order(page);
        const probe = await armProbe(page);
        const gesture = await dragTo(page, from, target, 12);
        const result = await observeReload(page, probe);
        const orderAfter = result.markerKept ? await order(page) : null;
        writeRecord({ scene: 'A2', repeat: info.repeatEachIndex, from, to: target, ...gesture, ...result, orderBefore, orderAfter });
        expect(gesture.dragging, 'つまみのドラッグが始まっている').toBe(true);
        expect(result.loads, '離してから 1.5 秒の間に再読込されない').toBe(0);
        expect(result.markerKept, '置いた印が残っている').toBe(true);
        expect(orderAfter, '下の段の本の上で離すと並びが変わる').not.toEqual(orderBefore);
    });

    // 同種: ホームのウィジェットの並べ替え (js/dashboard.js の Reorder・handle 無し=タッチは長押し 450ms で始まる)。
    // ホーム (#view-main) も .app-main-pane の中にあり、引っぱって更新のリスナーに届く
    test('(D) 同種: ホームのウィジェットを長押しして下へ 120px 運んで離しても再読込されない', async ({ page }, info) => {
        await seed(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
        await page.locator('#dashboard-edit-toggle').tap();
        const widget = page.locator('#view-main .dashboard-widget').first();
        await expect(widget).toBeVisible();
        const grip = widget.locator('.widget-grip');
        const from = center(await ((await grip.count()) ? grip.first() : widget).boundingBox());
        const probe = await armProbe(page);
        const t = await cdpTouch(page);
        await t.start(from);
        await page.waitForTimeout(600); // 長押しの成立 (450ms) を跨ぐ
        for (let i = 1; i <= 8; i++) await t.move({ x: from.x, y: from.y + (120 * i) / 8 });
        const before = await page.evaluate(() => ({
            dragging: !!document.querySelector('.dashboard-widget.is-dragging'),
            armed: !!document.getElementById('ptr-indicator')?.classList.contains('is-armed'),
        }));
        await t.end();
        const refreshing = await page.evaluate(() => !!document.getElementById('ptr-indicator')?.classList.contains('is-refreshing'));
        const result = await observeReload(page, probe);
        writeRecord({ scene: 'D-home', repeat: info.repeatEachIndex, from, dy: 120, ...before, refreshing, ...result });
        expect(before.dragging, 'ウィジェットの並べ替えが始まっている (離す前に .is-dragging が付く)').toBe(true);
        expect(result.loads, '離してから 1.5 秒の間に再読込されない').toBe(0);
        expect(result.markerKept, '置いた印が残っている').toBe(true);
    });

    test('(C) つまみを下へ 50px だけ運んで離しても再読込されない', async ({ page }, info) => {
        await openAllShelf(page);
        const from = center(await card(page, BOOKS[0][0]).locator('.drag-handle').boundingBox());
        const probe = await armProbe(page);
        const gesture = await dragDown(page, from, 50);
        const result = await observeReload(page, probe);
        writeRecord({ scene: 'C', repeat: info.repeatEachIndex, from, dy: 50, ...gesture, ...result });
        expect(gesture.dragging, 'つまみのドラッグが始まっている').toBe(true);
        expect(result.loads, '離してから 1.5 秒の間に再読込されない').toBe(0);
        expect(result.markerKept, '置いた印が残っている').toBe(true);
    });
});
