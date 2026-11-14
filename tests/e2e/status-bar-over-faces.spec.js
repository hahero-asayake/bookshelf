// イシュー#660: スマホ幅で本の詳細などの面を開いたままでも、保存の失敗・未保存の知らせ (状態バーの data-sync-failure の行) に
// 気づけて、そこから「再試行」「選ぶ」を押せる。出し方は、行だけを面より前の帯 (#app-status-bar .status-urgent・--ov-z-notice)
// に固定し、外枠と全画面の面を帯の高さだけ下げる (css「保存の失敗・未保存の帯」・overlay-manager の data-ov-above)。
//   (a) 保存の失敗: ハブへの書き込みを失敗させ、自動の再試行が尽きて出る「再試行」を、面を開いたまま押す → 行が消え、保存先へ書かれる
//   (b) 未保存: 読込時の3択を選ばずに閉じて出る「選ぶ」を、面を開いたまま押す → 3択が開き (帯は背後で押せない)、選ぶと行が消える
//   (c) 面を開いたまま状態バーが作り直されても (版の検知・focus)、帯は押せて、帯以外は背後で押せないまま
// 見えるかは、行とボタンの中心の elementFromPoint で見る (toBeVisible は重なりを見ない)。押すのは実際の click。
// 390幅の chromium はこのファイルの test.use、webkit (iPhone 13) は playwright.config の gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, failHubWritesForTest, hubStoreForTest, publicBaseOf, HUB_BASE } from './helpers/gate-hub.js';
import { shortenSyncRetryForTest } from './helpers/gate-sync-retry.js';
import { openSettingsByClick } from './helpers/settings.js';
import fs from 'node:fs';

test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 10_000 });

const ROW = '#app-status-bar .status-urgent .status-row[data-sync-failure]';
const rowButton = (page, name) => page.locator(ROW).getByRole('button', { name, exact: true });
const MEMO = 'イシュー#660 面を開いたまま再試行する短文メモ';

async function openDetail(page) {
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.waitForFunction(() => !!document.querySelector('#bookshelf > .book-item'));
    // content-visibility 下のカードは可視判定が揺れるので、ネイティブ click でアプリのハンドラを呼ぶ (#639 の editMemo と同じ)
    await page.evaluate(() => document.querySelector('#bookshelf > .book-item').click());
    await expect(page.locator('#book-detail-pane .note-textarea').first()).toBeVisible();
}

// 狭幅で全画面になる面 (step1 の洗い出し: scripts/verify/660-results.md)。開くのは利用者と同じ入口 (下部ナビ・設定・一覧)
const FACES = [
    { id: 'detail', label: '本の詳細', open: openDetail, isOpen: (p) => p.evaluate(() => document.body.classList.contains('book-detail-pinned')) },
    {
        id: 'drawer', label: '横のメニュー',
        open: async (p) => { await p.locator('[data-mobile-nav="shelves"]').click(); await expect(p.locator('body')).toHaveClass(/drawer-open/); },
        isOpen: (p) => p.evaluate(() => document.body.classList.contains('drawer-open'))
    },
    {
        id: 'settings', label: '設定',
        open: async (p) => { await p.locator('[data-mobile-nav="settings"]').click(); await expect(p.locator('#settings-modal')).toBeVisible(); },
        isOpen: (p) => p.locator('#settings-modal').isVisible()
    },
    {
        id: 'add-book', label: '設定の上のモーダル (手動で追加)',
        open: async (p) => {
            await openSettingsByClick(p, 'library-section');
            await p.locator('#add-book-manually').click();
            await expect(p.locator('#add-book-modal')).toHaveClass(/show/);
        },
        isOpen: (p) => p.locator('#add-book-modal').isVisible()
    },
    {
        id: 'palette', label: 'コマンドパレット',
        open: async (p) => { await p.locator('[data-mobile-nav="search"]').click(); await expect(p.locator('#command-palette')).toBeVisible(); },
        isOpen: (p) => p.locator('#command-palette').isVisible()
    },
    {
        id: 'publish-list', label: '記事の一覧',
        open: async (p) => { await p.evaluate(() => window.bookshelf.openPublishPagesModal()); await expect(p.locator('#publish-pages-modal')).toBeVisible(); },
        isOpen: (p) => p.locator('#publish-pages-modal').isVisible()
    },
    {
        // ホームの編集 (Surface の dashboard-edit・exit:'edit') は全画面の面ではないが、step1 で測っていない面として確かめる
        id: 'dashboard-edit', label: 'ホームの編集',
        open: async (p) => {
            await p.locator('[data-mobile-nav="home"]').click();
            await p.locator('#dashboard-edit-toggle').click();
            await expect(p.locator('#dashboard-edit-done')).toBeVisible();
        },
        isOpen: (p) => p.locator('#dashboard-edit-done').isVisible()
    },
    {
        id: 'art-editor', label: '記事エディタ',
        open: async (p) => {
            await p.evaluate(() => window.bookshelf.openPublishPagesModal());
            await p.locator('#art-new').click();
            await expect(p.locator('#art-title')).toBeVisible();
        },
        isOpen: (p) => p.locator('#art-title').isVisible()
    }
];

/** 行とボタンの中心で一番上にあるのが、行・ボタン自身か (面の下に隠れていないか) */
function hitState(page) {
    return page.evaluate((sel) => {
        const row = document.querySelector(sel);
        const btn = row && row.querySelector('button.status-btn');
        if (!btn) return 'ボタンが無い';
        const onTop = (t) => {
            const r = t.getBoundingClientRect();
            if (!(r.width > 0 && r.height > 0)) return false;
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!el && t.contains(el);
        };
        return onTop(row) && onTop(btn) ? '一番上' : '隠れている';
    }, ROW);
}

/** 帯 (または指定の要素) が背後の inert の中にあるか */
const isInert = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? !!el.closest('[inert]') : null;
}, sel);

// ---- (a) 保存の失敗 (J6-5 の2本目と同じ手順) ----
async function setupSaveFailure(page) {
    const hub = createHubStateForTest();
    await shortenSyncRetryForTest(page);
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    failHubWritesForTest(hub);
    await openDetail(page);
    await page.locator('.note-textarea[data-scope="all"]:visible').first().fill(MEMO);
    await expect(rowButton(page, '再試行')).toHaveCount(1, { timeout: 15000 });
    // 詳細の「戻る」は帯の下に出る (帯が見出しを隠さない)。押して詳細を閉じ、面ごとの確かめを同じ形で始める
    await page.locator('#mobile-detail-back').click();
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('book-detail-pinned'))).toBe(false);
    return hub;
}

/** 面を開くと保存が走ることがある (設定の記録など)。失敗の最初からやり直すので、自動の再試行が尽きて
 * 「確認」が出た所 (止まった状態) まで待ち、少し置いてもう一度確かめる。止まる前に失敗を解くと、
 * 自動の再試行が先に成功して行が消え、「再試行」を押す前に無くなる (step3 の初回の実測で9件中7件) */
async function waitStableFailed(page) {
    await expect(rowButton(page, '確認')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await expect(rowButton(page, '確認')).toBeVisible({ timeout: 15000 });
}

const hubHasMemo = (hub) => [...hub.files.values()].some((f) => typeof f.content === 'string' && f.content.includes(MEMO));

for (const face of FACES) {
    test(`(a) 保存の失敗: ${face.label}を開いたまま「再試行」を押すと、行が消えて保存先へ書かれる`, async ({ page }) => {
        test.setTimeout(90_000);
        const hub = await setupSaveFailure(page);
        await face.open(page);
        await expect.poll(() => hitState(page), { message: `${face.label}を開いたまま、行とボタンが一番上に出る` }).toBe('一番上');
        expect(await face.isOpen(page), `${face.label}は開いたまま`).toBe(true);
        expect(await isInert(page, '#app-status-bar .status-urgent'), '帯は背後の inert に入らない').toBe(false);
        await waitStableFailed(page);
        hub.failWrites = false;
        hub.failNextWrites = 0;
        await rowButton(page, '再試行').click();
        await expect(page.locator(ROW)).toHaveCount(0, { timeout: 15000 });
        await expect.poll(() => hubHasMemo(hub), { message: '短文メモが保存先 (ハブ) へ届く', timeout: 15000 }).toBe(true);
    });
}

// ---- (b) 未保存 (tests/e2e/load-conflict-unsaved.spec.js のハブの手順) ----
const ASIN_A = 'B0SBOF6601';
const ASIN_B = 'B0SBOF6602';
const ASIN_C = 'B0SBOF6603';

const confirmOk = async (page) => {
    const cfm = page.locator('.cfm-overlay');
    await cfm.waitFor({ state: 'visible' });
    await cfm.locator('.cfm-ok').click();
    await cfm.waitFor({ state: 'hidden' });
};

async function addBook(page, asin, title) {
    await openSettingsByClick(page, 'library-section');
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(asin);
    await page.locator('#manual-title').fill(title);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    // スマホ幅では同期のページから設定の一覧に戻ってから閉じるので、Esc を閉じるまで (最大3回) 押す
    for (let i = 0; i < 3 && await page.locator('#settings-modal').isVisible(); i++) await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    await page.waitForFunction((a) => {
        const lib = JSON.parse(localStorage.getItem('virtualBookshelf_library') || '{}');
        return (lib.books || []).some((b) => b.asin === a);
    }, asin);
}

const failWrites = async (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.fallback();
    return route.fulfill({ status: 503, body: 'offline (e2e)' });
};

function otherDeviceUpdateHub(state) {
    const lib = JSON.parse(state.files.get('private/library.json').content);
    lib.books.push({ asin: ASIN_C, title: '他の端末で足した本', authors: '', acquiredTime: Date.now(), readStatus: 'UNKNOWN', productImage: '', source: 'manual_add', addedDate: Date.now() });
    lib.exportDate = new Date(Date.now() + 1000).toISOString();
    state.seq += 1;
    state.files.set('private/library.json', { content: JSON.stringify(lib), etag: `"v${state.seq}"` });
}

async function setupUnsavedHold(page) {
    const state = createHubStateForTest({ usedBytes: 0, email: 'sbf-660@example.com' });
    await mockHubForTest(page, state);
    const store = hubStoreForTest(state);
    const cfg = {
        method: 'hub', methodChosen: true,
        hub: {
            apiBase: HUB_BASE, key: state.key, uid: state.uid, siteId: state.siteId, email: state.email, plan: state.plan,
            publicBase: `${HUB_BASE}/public/${state.siteId}/`, username: state.username, bookshelfBase: publicBaseOf(state)
        },
        publish: { target: 'hub' }
    };
    // 入れるのはこのタブで最初の1回だけ (再読込のたびに入れ直すとアプリが書いた設定を上書きする)
    await page.addInitScript((c) => {
        if (sessionStorage.getItem('sbfSeeded')) return;
        sessionStorage.setItem('sbfSeeded', '1');
        localStorage.setItem('bookshelf_sync', JSON.stringify(c));
    }, cfg);
    await page.goto('index.html');
    await confirmOk(page); // 空の保存先の「新規データで初期化しますか？」
    await expect.poll(() => store.has('private/bookshelves/all.json')).toBe(true);
    await addBook(page, ASIN_A, '書ける間に足した本');
    await expect.poll(async () => {
        const lib = await store.readJSON('private/library.json');
        return ((lib && lib.books) || []).map((b) => b.asin);
    }).toContain(ASIN_A);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync'))).toBeNull();

    // 書き込みだけ失敗させて、この端末で編集する (未反映の印が立つ)。その間に他の端末が保存先を更新する
    await page.route(`${HUB_BASE}/**`, failWrites);
    await addBook(page, ASIN_B, '書けない間に足した本');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync'))).not.toBeNull();
    otherDeviceUpdateHub(state);
    await page.unroute(`${HUB_BASE}/**`, failWrites);

    await page.reload();
    const dlg = page.locator('#load-conflict-dialog');
    await expect(dlg).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(rowButton(page, '選ぶ')).toHaveCount(1, { timeout: 10_000 });
    return { state, store };
}

for (const face of FACES) {
    test(`(b) 未保存: ${face.label}を開いたまま「選ぶ」を押すと3択が開き (帯は背後で押せない)、選ぶと行が消える`, async ({ page }) => {
        test.setTimeout(120_000);
        const { store } = await setupUnsavedHold(page);
        await face.open(page);
        await expect.poll(() => hitState(page), { message: `${face.label}を開いたまま、行とボタンが一番上に出る` }).toBe('一番上');
        expect(await face.isOpen(page), `${face.label}は開いたまま`).toBe(true);
        await rowButton(page, '選ぶ').click();
        const dlg = page.locator('#load-conflict-dialog');
        await expect(dlg).toBeVisible();
        // 確認ダイアログが最前面の間は、帯も背後の inert に入る (ダイアログで選ぶのが先・②の決め)
        await expect.poll(() => isInert(page, '#app-status-bar .status-urgent'), { message: '3択の背後で帯は押せない' }).toBe(true);
        await dlg.locator('.cfm-local').click();
        await expect(dlg).toBeHidden();
        await expect(page.locator(ROW)).toHaveCount(0, { timeout: 15_000 });
        await expect.poll(async () => {
            const lib = await store.readJSON('private/library.json');
            return ((lib && lib.books) || []).map((b) => b.asin);
        }, { message: 'この端末の内容 (本B) が保存先へ書かれる', timeout: 15_000 }).toContain(ASIN_B);
    });
}

// ---- (c) 作り直し: 面を開いたまま状態バーが作り直されても、帯は押せて、帯以外は背後で押せないまま ----
test('(c) 設定を開いたまま、版の検知と focus で状態バーが作り直されても、帯は押せて帯以外は背後で押せない', async ({ page }) => {
    test.setTimeout(90_000);
    // 新しい版の検知 (_checkAppVersion の index.html 取り直し) を、合図を立てた後だけ起こす (app-version-check.spec.js と同じ模擬)
    await page.addInitScript(() => {
        const origFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (window.__sbf660NewVersion && url.includes('index.html')) {
                return Promise.resolve(new Response('<script src="js/bookshelf.js?v=9999999999"></script>', { status: 200 }));
            }
            return origFetch(input, init);
        };
    });
    const hub = await setupSaveFailure(page);
    await FACES.find((f) => f.id === 'settings').open(page);
    await expect.poll(() => hitState(page)).toBe('一番上');
    expect(await isInert(page, '#view-main'), '設定の背後のホームは押せない').toBe(true);

    // 版の検知 (タブ復帰) → 「新しいバージョン」の行が足されて状態バーが作り直される
    await page.evaluate(() => { window.__sbf660NewVersion = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('#app-status-bar .status-update')).toHaveCount(1);
    // focus (30秒ごとと同じ再評価) も通す
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => hitState(page), { message: '作り直した後も、帯は一番上' }).toBe('一番上');
    expect(await isInert(page, '#app-status-bar .status-urgent'), '作り直した後も、帯は inert に入らない').toBe(false);
    expect(await isInert(page, '#app-status-bar .status-update'), '帯以外の行 (新しいバージョン) は設定の背後で押せない').toBe(true);
    expect(await isInert(page, '#view-main'), '設定の背後のホームは押せないまま').toBe(true);

    await waitStableFailed(page);
    hub.failWrites = false;
    hub.failNextWrites = 0;
    await rowButton(page, '再試行').click();
    await expect(page.locator(ROW)).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('#settings-modal')).toBeVisible();
});

// ---- (d) 画像と数値: 帯が出ている間 (面が帯の分だけ低くなる)、本の詳細と設定の一番下の操作まで届くか ----
// 合否には使わない (step3 の初回で本の詳細の一番下が下部ナビに重なった。帯の無い時も同じかを step4 で比べる)
const bottomReach = (page, scopeSel, scrollSel) => page.evaluate(([scope, scroller]) => {
    const desc = (el) => (el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('data-mobile-nav') ? `[data-mobile-nav=${el.getAttribute('data-mobile-nav')}]` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ''}` : null);
    const sc = scroller ? document.querySelector(scroller) : null;
    if (sc) sc.scrollTop = sc.scrollHeight;
    const items = [...document.querySelectorAll(`${scope} button, ${scope} textarea, ${scope} input, ${scope} a, ${scope} select`)].filter((el) => el.getBoundingClientRect().height > 0);
    const last = items[items.length - 1];
    if (!last) return { last: null };
    last.scrollIntoView({ block: 'end' });
    const r = last.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + Math.min(10, r.width / 2), r.top + r.height / 2);
    const nav = document.querySelector('.mobile-bottom-nav');
    return { last: desc(last), bottom: Math.round(r.bottom), navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null, top: desc(el), reach: !!el && (last === el || last.contains(el)) };
}, [scopeSel, scrollSel]);

test('(d) 帯が出ている間に、本の詳細と設定の一番下の操作まで届くかを記録する (画像)', async ({ page }) => {
    test.setTimeout(90_000);
    await setupSaveFailure(page);
    await openDetail(page);
    const detail = await bottomReach(page, '#app-detail .detail-body', '#app-detail .detail-body');
    const detailShot = test.info().outputPath('detail-bottom.png');
    await page.screenshot({ path: detailShot });
    await test.info().attach('detail-bottom.png', { path: detailShot, contentType: 'image/png' });
    await page.locator('#mobile-detail-back').click();
    await FACES.find((f) => f.id === 'settings').open(page);
    const settings = await bottomReach(page, '#settings-modal', null);
    const settingsShot = test.info().outputPath('settings-bottom.png');
    await page.screenshot({ path: settingsShot });
    await test.info().attach('settings-bottom.png', { path: settingsShot, contentType: 'image/png' });
    await test.info().attach('bottom-reach.json', { body: JSON.stringify({ detail, settings }, null, 2), contentType: 'application/json' });
    console.log(`[#660 bottom-reach] ${test.info().project.name} ${JSON.stringify({ detail, settings })}`);
    await expect.poll(() => hitState(page), { message: '設定の一番下まで送っても、帯は一番上' }).toBe('一番上');
});

// ---- (e) イシュー#671: ホームのウィジェット選択 (kind 'popover'・全画面の重ね) を開いたまま、帯の文が1〜4行の時 ----
// iPhone 13 の高さ (390×664) で、panel の上端が帯の下端より下にあり (見出しの × が帯に隠れない)、帯の「再試行」が押せる。
// 帯の文は「文言を長くして再現」= .status-msg の文だけを置き換えて行数を決める (状態の判定・描画は変えない。
// 状態バーは中身が変わった時だけ作り直すので、focus の再評価では置き換えた文が残る = #660 の _statusHtml の控え)。
// 画像と数値は tmp/671/<project>/<行数>line-<before|after>.png・.json (before = 帯の下げ対象の印がまだ無い時)
const PICKER_ROW_MSG = `${ROW} .status-msg`;

/** 帯の文を n 行にする (1行は短文・2行以上は文を伸ばし、n 行目が半分ほど埋まる長さにする) */
const setBandLines = (page, n) => page.evaluate(([sel, want]) => {
    const msg = document.querySelector(sel);
    if (!msg) return { ok: false, why: '帯の文が無い' };
    const linesOf = () => {
        const r = document.createRange();
        r.selectNodeContents(msg);
        return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
    };
    if (want === 1) {
        msg.textContent = '保存できていません';
        return { ok: linesOf() === 1, lines: linesOf(), text: msg.textContent };
    }
    const base = '保存先へ書けませんでした。電波の良い所へ移ってから「再試行」を押してください。届くまでこの端末に残ります。'.repeat(4);
    let reach = 0;
    let over = 0;
    for (let i = 1; i <= base.length; i++) {
        msg.textContent = base.slice(0, i);
        const l = linesOf();
        if (!reach && l >= want) reach = i;
        if (l > want) { over = i; break; }
    }
    if (!reach || !over) return { ok: false, why: `${want}行に届かない`, reach, over };
    msg.textContent = base.slice(0, Math.floor((reach + over - 1) / 2));
    return { ok: linesOf() === want, lines: linesOf(), text: msg.textContent };
}, [PICKER_ROW_MSG, n]);

/** 帯・panel・×・「再試行」の座標と、× と「再試行」の中心で一番上にあるのが自分か */
const pickerGeometry = (page) => page.evaluate((rowSel) => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, height: Math.round(r.height * 10) / 10 }; };
    const onTop = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && el.contains(hit);
    };
    const band = document.querySelector('#app-status-bar .status-urgent');
    const panel = document.querySelector('#widget-picker-overlay .widget-picker-panel');
    const close = document.querySelector('#widget-picker-overlay .widget-picker-close');
    const retry = [...document.querySelectorAll(`${rowSel} button.status-btn`)].find((b) => b.textContent.trim() === '再試行') || null;
    const overlay = document.getElementById('widget-picker-overlay');
    return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        statusUrgentH: getComputedStyle(document.documentElement).getPropertyValue('--status-urgent-h').trim(),
        band: rect(band), panel: rect(panel), overlay: rect(overlay),
        gap: band && panel ? Math.round((panel.getBoundingClientRect().top - band.getBoundingClientRect().bottom) * 10) / 10 : null,
        panelBottomInView: panel ? panel.getBoundingClientRect().bottom <= window.innerHeight : null,
        closeOnTop: onTop(close), retryOnTop: onTop(retry),
        belowNoticeMark: overlay ? overlay.hasAttribute('data-ov-below-notice') : null,
        overlayKind: overlay ? overlay.dataset.ovKind || null : null
    };
}, ROW);

test.describe('(e) ホームのウィジェット選択 (390×664・イシュー#671)', () => {
    test.use({ viewport: { width: 390, height: 664 } });

    for (const lines of [1, 2, 3, 4]) {
        test(`(e) 帯の文が${lines}行: ウィジェット選択の panel の上端が帯の下端より下にあり、× と「再試行」が押せる`, async ({ page }) => {
            test.setTimeout(90_000);
            const hub = await setupSaveFailure(page);
            // ホームの編集から、利用者と同じ入口 (「ここにウィジェットを追加」) で開く
            await page.locator('[data-mobile-nav="home"]').click();
            await page.locator('#dashboard-edit-toggle').click();
            await expect(page.locator('#dashboard-edit-done')).toBeVisible();
            await page.locator('#add-widget-card').click();
            await expect(page.locator('#widget-picker-overlay .widget-picker-panel')).toBeVisible();
            await waitStableFailed(page);

            const set = await setBandLines(page, lines);
            expect(set.ok, `帯の文を${lines}行にする (${JSON.stringify(set)})`).toBe(true);
            // 帯の高さの変数 (--status-urgent-h・ResizeObserver が測り直す) が、帯の実高に追いつくまで待つ
            await expect.poll(() => page.evaluate(() => {
                const band = document.querySelector('#app-status-bar .status-urgent');
                const v = getComputedStyle(document.documentElement).getPropertyValue('--status-urgent-h').trim();
                return !!band && v === `${Math.ceil(band.getBoundingClientRect().height)}px`;
            }), { message: '--status-urgent-h が帯の実高と同じになる' }).toBe(true);
            // focus の再評価 (30秒ごとと同じ) でも状態バーは作り直されず、置き換えた文が残る
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(page.locator(PICKER_ROW_MSG)).toHaveText(set.text);

            const geo = await pickerGeometry(page);
            const tag = geo.belowNoticeMark ? 'after' : 'before';
            const project = test.info().project.name;
            const dir = `tmp/671/${project}`;
            fs.mkdirSync(dir, { recursive: true });
            await page.screenshot({ path: `${dir}/${lines}line-${tag}.png` });
            fs.writeFileSync(`${dir}/${lines}line-${tag}.json`, JSON.stringify({ lines, text: set.text, ...geo }, null, 2));
            await test.info().attach(`${lines}line-${tag}.json`, { body: JSON.stringify({ lines, ...geo }, null, 2), contentType: 'application/json' });
            console.log(`[#671 picker] ${project} lines=${lines} ${tag} ${JSON.stringify(geo)}`);

            expect.soft(geo.gap, `panel の上端 (${geo.panel && geo.panel.top}) が帯の下端 (${geo.band && geo.band.bottom}) より下`).toBeGreaterThanOrEqual(0);
            expect.soft(geo.closeOnTop, 'ウィジェット選択の × が帯に隠れず一番上').toBe(true);
            expect(geo.retryOnTop, '帯の「再試行」が一番上').toBe(true);
            await rowButton(page, '再試行').click({ trial: true });

            hub.failWrites = false;
            hub.failNextWrites = 0;
            await rowButton(page, '再試行').click();
            await expect(page.locator(ROW)).toHaveCount(0, { timeout: 15000 });
            await expect.poll(() => hubHasMemo(hub), { message: '短文メモが保存先 (ハブ) へ届く', timeout: 15000 }).toBe(true);
        });
    }
});

// ---- (f) アンカー付きメニュー (_placeAnchoredMenu) と帯 (イシュー#673) ----
// 帯を出したまま記事エディタを開き、_placeAnchoredMenu で置くメニューの高さ・z・位置と帯の下端を測る。
// 引き出しの本棚の選択 (max-height 60vh) を高くするため、保存先の見本に本棚を足す (データの用意だけ・位置は DOM で書き換えない)。
function seedShelves673(hub, n) {
    const put = (path, data) => { hub.seq += 1; hub.files.set(path, { content: JSON.stringify(data), etag: `"v${hub.seq}"` }); };
    const shelves = [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }];
    for (let i = 1; i <= n; i++) {
        shelves.push({ internalId: `s673x${i}`, slug: `s673-${i}`, name: `本棚${i}` });
        put(`private/bookshelves/s673-${i}.json`, { books: [] });
    }
    put('private/bookshelves.json', { bookshelves: shelves });
}

// setupSaveFailure と同じ手順。PC 幅では詳細が列なので「戻る」が無い時は押さない
async function setupSaveFailure673(page, shelves) {
    const hub = createHubStateForTest();
    await shortenSyncRetryForTest(page);
    seedHubDataForTest(hub);
    if (shelves) seedShelves673(hub, shelves);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    failHubWritesForTest(hub);
    await openDetail(page);
    await page.locator('.note-textarea[data-scope="all"]:visible').first().fill(MEMO);
    await expect(rowButton(page, '再試行')).toHaveCount(1, { timeout: 15000 });
    const back = page.locator('#mobile-detail-back');
    if (await back.isVisible()) {
        await back.click();
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('book-detail-pinned'))).toBe(false);
    }
    return hub;
}

const measureMenu673 = (page, menuSel, anchorSel) => page.evaluate(([m, a]) => {
    const menu = document.querySelector(m);
    const anchor = a ? document.querySelector(a) : null;
    const band = document.querySelector('#app-status-bar .status-urgent');
    const r = (el) => {
        if (!el) return null;
        const x = el.getBoundingClientRect();
        return { top: Math.round(x.top), bottom: Math.round(x.bottom), left: Math.round(x.left), width: Math.round(x.width), height: Math.round(x.height) };
    };
    const mr = r(menu);
    const first = menu ? [...menu.querySelectorAll('button, [role="option"], [role="menuitem"]')].find((el) => el.getBoundingClientRect().height > 0) : null;
    let firstHit = null;
    if (first) {
        const fr = first.getBoundingClientRect();
        const el = document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2);
        firstHit = !el ? null : el.closest('#app-status-bar') ? 'band' : menu.contains(el) ? 'item' : (el.id || String(el.className) || el.tagName);
    }
    return {
        visible: !!menu && !menu.hidden && !!mr && mr.height > 0,
        menu: mr, anchor: r(anchor), isUp: menu ? menu.classList.contains('is-up') : null,
        z: menu ? getComputedStyle(menu).zIndex : null, scrollH: menu ? menu.scrollHeight : null, styleTop: menu ? menu.style.top : null,
        band: r(band), bandVar: getComputedStyle(document.documentElement).getPropertyValue('--status-urgent-h').trim(),
        hasUrgent: document.body.classList.contains('has-status-urgent'),
        innerW: innerWidth, innerH: innerHeight, firstHit,
    };
}, [menuSel, anchorSel]);

test.describe('(f) アンカー付きメニューと帯 (イシュー#673)', () => {
    for (const vp of [{ tag: 'pc', width: 1280, height: 800 }, { tag: 'narrow', width: 390, height: 664 }]) {
        test.describe(`${vp.width}×${vp.height}`, () => {
            test.use({ viewport: { width: vp.width, height: vp.height } });

            test(`(f) 測る: 記事エディタのアンカー付きメニューの高さ・z・位置と帯の下端 (${vp.tag})`, async ({ page }, testInfo) => {
                test.setTimeout(120_000);
                await setupSaveFailure673(page, 24);
                await page.evaluate(() => window.bookshelf.openPublishPagesModal());
                await page.click('#art-new');
                await expect(page.locator('#art-edit-view')).toBeVisible();
                const out = { vp, project: testInfo.project.name, menus: {} };
                // 押せない時 (帯などが前にある) は理由を残し、アプリのハンドラをネイティブ click で呼んで測りを続ける
                const press = async (sel) => {
                    const loc = page.locator(sel).first();
                    try { await loc.click({ timeout: 4000 }); return 'click'; } catch (e) {
                        const why = (String(e).match(/<[^>]+> from <[^>]+> subtree intercepts pointer events|<[^>]+> intercepts pointer events/) || [String(e).slice(0, 100)])[0];
                        await page.evaluate((s) => document.querySelector(s).click(), sel);
                        return `native (${why})`;
                    }
                };
                const edit = page.locator('#art-mode-edit');
                if (await edit.isVisible()) out.editButton = await press('#art-mode-edit');
                await page.waitForTimeout(500);
                // 本棚ブロックを置くと引き出しが開く (狭幅は下から出るシート .art-side・_artOpenSheet)。入口はキャンバスの＋
                try {
                    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').first().click({ timeout: 5000 });
                    out.addShelf = await press('#art-add-sheet [data-block-type="shelf"]');
                    await page.waitForTimeout(800);
                } catch (e) { out.addShelf = `失敗 ${String(e).slice(0, 100)}`; }
                out.sheet = await page.evaluate(() => {
                    const s = document.querySelector('.art-side');
                    if (!s) return null;
                    const r = s.getBoundingClientRect();
                    const cs = getComputedStyle(s);
                    return { open: s.classList.contains('is-open'), top: Math.round(r.top), bottom: Math.round(r.bottom), transform: cs.transform, overflow: cs.overflow };
                });
                const dir = `tmp/673/${testInfo.project.name}`;
                fs.mkdirSync(dir, { recursive: true });
                const cases = [
                    { name: 'art-more-menu', btn: '#art-more-btn', menu: '#art-more-menu' },
                    { name: 'art-drawer-shelf-popover', btn: '#art-drawer-shelf-btn', menu: '#art-drawer-shelf-popover' },
                    { name: 'art-add-menu', btn: '#art-blocks .art-add-btn', menu: '#art-blocks .art-add-menu', anchor: '#art-blocks .art-add' },
                ];
                for (const c of cases) {
                    const btn = page.locator(c.btn).first();
                    if (!(await btn.isVisible().catch(() => false))) { out.menus[c.name] = { opened: false, reason: 'ボタンが見えない' }; continue; }
                    const via = await press(c.btn);
                    await page.waitForTimeout(300);
                    out.menus[c.name] = { opened: true, via, ...(await measureMenu673(page, c.menu, c.anchor || c.btn)) };
                    await page.screenshot({ path: `${dir}/${vp.tag}-${c.name}-before.png` });
                    await page.evaluate((s) => document.querySelector(s).click(), c.btn).catch(() => {});
                    await page.waitForTimeout(200);
                }
                fs.writeFileSync(`${dir}/measure-${vp.tag}.json`, JSON.stringify(out, null, 2));
                console.log(`[673-measure] ${JSON.stringify(out)}`);
            });
        });
    }
});
