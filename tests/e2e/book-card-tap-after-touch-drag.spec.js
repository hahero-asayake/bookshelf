// イシュー#654: 本のカードをタッチでドラッグ (長押しを含む) した後、次の正しいタップで本の詳細が開くかを見る。
// 疑い: つまみの pointerdown で付く印 _suppressClick (js/bookshelf.js の _onBookPointerDown) は、カードの click でしか
// 外れない。タッチで動かすとブラウザは click を作らないので、印が残り、次の正しいタップを1回捨てる。
//
// ドラッグの作り方は2つ。
//   cdp    : chromium の CDP Input.dispatchTouchEvent。ブラウザのタッチ→ポインタ→click の変換を通る (本物に一番近い)。
//   direct : PointerEvent(pointerType:'touch') をつまみへ直に送る。ブラウザは click を作らない (「動かしたタッチ」と同じ)。
// 次のタップは、どちらの場合も本物のタップ (locator.tap = click はブラウザが作る)。
// 各場面で、ドラッグの終わりに click が出たか・1回目/2回目のタップで詳細が開いたかを _local/654/probe-<browser>.jsonl に
// 記録する (結果の表は scripts/verify/654-results.md)。
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest, stubStorageForTest } from './helpers/gate-setup.js';

const BOOKS = [['B0TAP00001', 'タップの本 1'], ['B0TAP00002', 'タップの本 2'], ['B0TAP00003', 'タップの本 3']];
const listItems = (page) => page.locator('#bookshelf .book-item');
const card = (page, asin) => page.locator(`#bookshelf .book-item[data-asin="${asin}"]`);
const detail = (page) => page.locator('#book-detail-pane');
const drawer = (page) => page.locator('#app-sidebar');
const LOG_DIR = path.join(process.cwd(), '_local', '654');

function seed(page, { pop }) {
    const library = {
        books: BOOKS.map(([asin, title], i) => ({ asin, title, authors: '著者', acquiredTime: 1727000000000 + i, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1727000000000 })),
        metadata: { lastImportDate: 1727000000000, totalBooks: BOOKS.length },
    };
    const settings = pop ? { sortOrder: 'custom', starVisibility: 'hover', memoVisibility: 'hover' } : { sortOrder: 'custom' };
    const notes = pop ? Object.fromEntries(BOOKS.map(([asin]) => [asin, { memo: '短文メモ' }])) : {};
    const userData = {
        bookshelves: [{ id: 'all', name: 'すべての本', books: BOOKS.map(([a]) => a), isSpecial: true, internalId: 'all' }],
        notes, settings, bookOrder: {}, stats: {}, version: 2,
    };
    return page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        // document の capture で、ドラッグの終わりに click が出たかを記録する (649 の click-probe と同じ記録の仕方)
        window.__654events = [];
        for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'touchend', 'click', 'contextmenu']) {
            document.addEventListener(t, (e) => {
                const el = e.target && e.target.closest ? e.target : null;
                const where = el ? (el.closest('.drag-handle') ? 'handle' : (el.closest('.book-item') ? 'card' : (el.id || el.tagName))) : '?';
                window.__654events.push(`${t}@${where}${e.isTrusted ? '' : '[合成]'}`);
            }, true);
        }
    }, [JSON.stringify(userData), JSON.stringify(library)]);
}

async function openAllShelf(page, opts) {
    await seed(page, opts);
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
const takeEvents = (page) => page.evaluate(() => window.__654events.splice(0));

// カードの余白 (書名の真ん中) の座標。つまみ・星でないことを確かめる
async function blankPoint(page, asin) {
    const p = center(await card(page, asin).locator('.book-title').boundingBox());
    const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? { inCard: !!el.closest('.book-item'), bad: !!el.closest('.drag-handle, .star-rating, .star') } : null;
    }, [p.x, p.y]);
    expect(hit).toEqual({ inCard: true, bad: false });
    return p;
}

async function isOpened(page, asin, timeout) {
    try {
        await expect(page).toHaveURL(new RegExp(`#book/${asin}$`), { timeout });
        await expect(detail(page)).toBeVisible({ timeout });
        return true;
    } catch { return false; }
}

// 本物のタップを1回目・(開かなければ) 2回目と押し、結果を記録してから「1回目で開く」を確かめる。
// CDP のタッチでドラッグした直後は、ブラウザのジェスチャの判定 (離す直前の動きの続き) が残り、すぐのタップで
// click が出ないことがある (step1 の場面 (d) で実測)。cdp の場面は、人が離してから次に押すまでと同じく 600ms 置く。
// direct は ジェスチャの判定を通らないので、すぐ (400ms より前に) 押す
async function tapAndExpectOpen(page, asin, record) {
    if (record.mode === 'cdp') await page.waitForTimeout(600);
    // 座標は押す直前に取る (並べ替えの後は待つ間に配置が動き、古い座標がカードの外に当たった・step1 で実測)
    let p = await blankPoint(page, asin);
    await page.touchscreen.tap(p.x, p.y);
    const first = await isOpened(page, asin, 2000);
    const firstEvents = await takeEvents(page);
    const firstClicked = firstEvents.includes('click@card');
    let second = null;
    let secondEvents = [];
    if (!first) {
        await page.waitForTimeout(600); // 2回目を2度押し (ダブルタップ) と見なされないように間を置く
        p = await blankPoint(page, asin);
        await page.touchscreen.tap(p.x, p.y);
        second = await isOpened(page, asin, 2000);
        secondEvents = await takeEvents(page);
    }
    record.firstTapOpened = first;
    record.firstTapClicked = firstClicked;
    record.secondTapOpened = second;
    record.tapEvents = [...firstEvents, ...secondEvents];
    writeRecord(record);
    // CDP でドラッグした直後の1回目のタップで、ブラウザが click 自体を作らないことがある (原因未特定・654-results.md)。
    // CDP の場面だけは「カードに届いた最初の click で開く」を見る。1回目で click が届いたのに開かなければ赤
    if (record.mode === 'cdp' && !firstClicked) {
        expect(secondEvents.includes('click@card'), '2回目のタップでカードに click が届く').toBe(true);
        expect(second, 'ドラッグの後、カードに届いた最初の click で本の詳細が開く').toBe(true);
        return;
    }
    expect(first, '1回目の本物のタップで本の詳細が開く').toBe(true);
}

function writeRecord(record) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `probe-${record.browser}.jsonl`), JSON.stringify(record) + '\n');
}

// ---- ドラッグの作り方 ----
async function cdpTouch(page) {
    const cdp = await page.context().newCDPSession(page);
    return {
        start: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }),
        move: (p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }),
        end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
        cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
    };
}
// 直送: つまみは setPointerCapture するので、move/up もつまみへ送る (捕まえた要素に届くのと同じ)
function directTouch(page) {
    const send = (type, p) => page.evaluate(([t, x, y]) => {
        const h = window.__654handle || (window.__654handle = document.elementFromPoint(x, y).closest('.drag-handle') || document.elementFromPoint(x, y));
        h.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: x, clientY: y }));
        if (t === 'pointerup' || t === 'pointercancel') window.__654handle = null;
    }, [type, p.x, p.y]);
    let last = null;
    return {
        start: (p) => { last = p; return send('pointerdown', p); },
        move: (p) => { last = p; return send('pointermove', p); },
        end: () => send('pointerup', last),
        cancel: () => send('pointercancel', last),
    };
}
const touchOf = (page, mode) => (mode === 'cdp' ? cdpTouch(page) : directTouch(page));
// 長押しの口 (_initBookPopLongPress) は touchstart/touchend を見る。touch はその型のイベントを押した所の要素へ直に送る。
// webkit は new Touch() を作れない (Illegal constructor・step2 で実測)。口が読むのは e.touches[0] の座標だけなので、
// ふつうの Event に touches を持たせて送る
function directTouchEvents(page) {
    const send = (type, p) => page.evaluate(([t, x, y]) => {
        const el = document.elementFromPoint(x, y);
        const ev = new Event(t, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { value: t === 'touchend' ? [] : [{ clientX: x, clientY: y, target: el }] });
        el.dispatchEvent(ev);
    }, [type, p.x, p.y]);
    let last = null;
    return { start: (p) => { last = p; return send('touchstart', p); }, end: () => send('touchend', last) };
}
const longPressOf = (page, mode) => (mode === 'cdp' ? cdpTouch(page) : directTouchEvents(page));

async function handlePoint(page, asin) {
    return center(await card(page, asin).locator('.drag-handle').boundingBox());
}
const dragStarted = (page) => page.evaluate(() => !!document.querySelector('.book-item.dragging'));

test.describe('本のカード: タッチでドラッグした後のタップ (イシュー#654)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('(a) 普通のタップで詳細が開く', async ({ page, browserName }) => {
        await openAllShelf(page, { pop: false });
        await takeEvents(page);
        await tapAndExpectOpen(page, BOOKS[0][0], { browser: browserName, scene: 'a', mode: 'tap' });
    });

    for (const mode of ['cdp', 'direct']) {
        test.describe(`ドラッグの作り方: ${mode}`, () => {
            test.skip(({ browserName }) => mode === 'cdp' && browserName !== 'chromium', 'CDP は chromium だけ');

            test(`(b) つまみを押してすぐ離した後、カードの余白のタップで詳細が開く [${mode}]`, async ({ page, browserName }) => {
                await openAllShelf(page, { pop: false });
                const t = await touchOf(page, mode);
                const asin = BOOKS[0][0];
                await takeEvents(page);
                await t.start(await handlePoint(page, asin));
                const started = await dragStarted(page);
                await t.end();
                // つまみの click は既存の決まりで捨てる (詳細は開かない)
                expect(await isOpened(page, asin, 800)).toBe(false);
                const dragEvents = await takeEvents(page);
                await tapAndExpectOpen(page, asin, { browser: browserName, scene: 'b', mode, started, dragEvents });
            });

            // 下へ 72px 以上運ぶと、一覧の先頭では「引っぱって更新」(js/bookshelf.js の _initPullToRefresh) が働いて
            // 再読込し、印ごとカードが作り直される (step2 で実測)。印の確かめを再読込で隠さないよう、2冊目を1冊目の上へ運ぶ
            test(`(c) つまみでドラッグして別の本の上で離した後、同じカードのタップで詳細が開く [${mode}]`, async ({ page, browserName }) => {
                await openAllShelf(page, { pop: false });
                const t = await touchOf(page, mode);
                const asin = BOOKS[1][0];
                const before = await order(page);
                const from = await handlePoint(page, asin);
                const to = center(await card(page, BOOKS[0][0]).boundingBox());
                await takeEvents(page);
                await t.start(from);
                const started = await dragStarted(page);
                for (let i = 1; i <= 6; i++) await t.move({ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 });
                await t.end();
                const after = await order(page);
                const dragEvents = await takeEvents(page);
                await tapAndExpectOpen(page, asin, { browser: browserName, scene: 'c', mode, started, reordered: JSON.stringify(before) !== JSON.stringify(after), dragEvents });
            });

            test(`(d) つまみでドラッグして行き先の無い所で離した後、タップで詳細が開く [${mode}]`, async ({ page, browserName }) => {
                await openAllShelf(page, { pop: false });
                const t = await touchOf(page, mode);
                const asin = BOOKS[0][0];
                const before = await order(page);
                const from = await handlePoint(page, asin);
                await takeEvents(page);
                await t.start(from);
                const started = await dragStarted(page);
                for (let i = 1; i <= 4; i++) await t.move({ x: from.x - 6 * i, y: from.y + 4 * i });
                await t.move(from);
                await t.end();
                const after = await order(page);
                const dragEvents = await takeEvents(page);
                await tapAndExpectOpen(page, asin, { browser: browserName, scene: 'd', mode, started, reordered: JSON.stringify(before) !== JSON.stringify(after), dragEvents });
            });

            test(`(e) つまみを押して pointercancel で終わった後、タップで詳細が開く [${mode}]`, async ({ page, browserName }) => {
                await openAllShelf(page, { pop: false });
                const t = await touchOf(page, mode);
                const asin = BOOKS[0][0];
                const from = await handlePoint(page, asin);
                await takeEvents(page);
                await t.start(from);
                const started = await dragStarted(page);
                await t.move({ x: from.x, y: from.y + 20 });
                await t.cancel();
                const dragEvents = await takeEvents(page);
                await tapAndExpectOpen(page, asin, { browser: browserName, scene: 'e', mode, started, dragEvents });
            });

            test(`(g) つまみを長押ししてから動かして離した後、タップで詳細が開く [${mode}]`, async ({ page, browserName }) => {
                await openAllShelf(page, { pop: false });
                const t = await touchOf(page, mode);
                const asin = BOOKS[1][0];
                const before = await order(page);
                const from = await handlePoint(page, asin);
                const to = center(await card(page, BOOKS[0][0]).boundingBox()); // (c) と同じ理由で上・横へ運ぶ
                await takeEvents(page);
                await t.start(from);
                await page.waitForTimeout(550); // 長押し (450ms) を跨ぐ
                const started = await dragStarted(page);
                await t.move({ x: from.x, y: from.y + 4 });
                for (let i = 1; i <= 6; i++) await t.move({ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 });
                await t.end();
                const after = await order(page);
                const dragEvents = await takeEvents(page);
                await tapAndExpectOpen(page, asin, { browser: browserName, scene: 'g', mode, started, reordered: JSON.stringify(before) !== JSON.stringify(after), dragEvents });
            });
        });
    }

    // (f) 長押しの口 (js/bookshelf.js の _initBookPopLongPress) は touchstart/touchend を見る。
    // chromium は CDP のタッチで本物の touchstart を作る。webkit (step2) は別に用意する
    // webkit には本物のタッチを長く押す口が無いので、touch は TouchEvent を直に送る (click はブラウザが作らない)
    for (const mode of ['cdp', 'touch']) {
    test(`(f) pop 有りの設定で長押しして離した後、同じカードの余白のタップで詳細が開く [${mode}]`, async ({ page, browserName }) => {
        test.skip(mode === 'cdp' && browserName !== 'chromium', 'CDP は chromium だけ');
        await openAllShelf(page, { pop: true });
        const t = await longPressOf(page, mode);
        const asin = BOOKS[0][0];
        const p = await blankPoint(page, asin);
        await takeEvents(page);
        await t.start(p);
        await page.waitForTimeout(600);
        const popShown = await card(page, asin).evaluate((el) => el.classList.contains('show-pop'));
        await t.end();
        const opened = await isOpened(page, asin, 800);
        const dragEvents = await takeEvents(page);
        await tapAndExpectOpen(page, asin, { browser: browserName, scene: 'f', mode,popShown, openedByLongPress: opened, dragEvents });
    });

    test(`(f-星) pop 有りの設定で長押しして離した後、pop の星のタップで評価が変わる [${mode}]`, async ({ page, browserName }) => {
        test.skip(mode === 'cdp' && browserName !== 'chromium', 'CDP は chromium だけ');
        await openAllShelf(page, { pop: true });
        const t = await longPressOf(page, mode);
        const asin = BOOKS[0][0];
        const p = await blankPoint(page, asin);
        await t.start(p);
        await page.waitForTimeout(600);
        await t.end();
        await expect(card(page, asin)).toHaveClass(/show-pop/);
        await takeEvents(page);
        const star = card(page, asin).locator('.card-hover-pop .star[data-rating="4"]');
        const sp = center(await star.boundingBox());
        await page.touchscreen.tap(sp.x, sp.y);
        let rated = true;
        try { await expect(card(page, asin).locator('.star-rating').first()).toHaveAttribute('data-current-rating', '4', { timeout: 2000 }); } catch { rated = false; }
        const tapEvents = await takeEvents(page);
        writeRecord({ browser: browserName, scene: 'f-star', mode,firstTapRated: rated, tapEvents });
        expect(rated, '長押しの後の1回目の星のタップで評価が変わる').toBe(true);
    });

    }

    test('対照: マウスでつまみをドラッグした後、カードのクリックで詳細が開く', async ({ page, browserName }) => {
        await openAllShelf(page, { pop: false });
        const asin = BOOKS[0][0];
        const from = await handlePoint(page, asin);
        const to = center(await card(page, BOOKS[2][0]).boundingBox());
        await takeEvents(page);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 6 });
        await page.mouse.up();
        const dragEvents = await takeEvents(page);
        const p = await blankPoint(page, asin);
        await page.mouse.click(p.x, p.y);
        const first = await isOpened(page, asin, 2000);
        writeRecord({ browser: browserName, scene: 'mouse', mode: 'mouse', firstTapOpened: first, dragEvents, tapEvents: await takeEvents(page) });
        expect(first, 'マウスのドラッグの後の1回目のクリックで本の詳細が開く').toBe(true);
    });
});
