// 空の保存先 (ハブ) の初期化と、初期化中に足した本の最初の保存が重なっても、初期化 (initEmpty) が1回だけ走り、
// 保存先の「すべての本」の id・冊数が食い違わないこと (イシュー#643)。
//
// 直す前は、「新規データで初期化しますか？」で OK を押した後、初期化の書き込み (7ファイル) が終わる前に本を足すと、
// 保存の経路 (js/bookshelf.js syncToObsidianFolder) が保存先を「空」と見て、もう一度 initEmpty を呼んでいた
// (「空」の判定は private/bookshelves/all.json の有無 = 初期化の5件目。#633 step1 で実測)。2回の初期化は
// 「すべての本」の id を別々に作る。
//
// 時機の作り方: 1件ずつの書き込み (PUT /data/*) を1件 1.5 秒遅らせる (本番のハブは1件 約2秒)。初期化の7件が
// 届く前に本を足せる。遅らせた後は gate-hub.js の模擬へ回す (gate-hub.js 本体は変えない)。
// 数えるのは模擬のハブの中身と通信だけ (アプリの内部は読まない)。gate-hub.js の模擬は PUT に常に 200 を返すので、
// 初期化が何回走ったかは、初期化の7ファイルへの PUT の回数で数える (まとめ保存は POST /data/batch で、PUT ではない)。
import { test, expect } from './helpers/test-base.js';
import { createHubStateForTest, seedHubLoginForTest, mockHubForTest, hubStoreForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { openSettingsByClick } from './helpers/settings.js';

const INIT_FILES = [
    'private/library.json', 'private/exclusions.json', 'private/notes.json', 'private/bookshelves.json',
    'private/bookshelves/all.json', 'private/settings.json', 'private/main.json'
];
const BOOK1 = { asin: 'B0INITSAV1', title: '初期化中に足した本', authors: '初期化 テスト' };
const BOOK2 = { asin: 'B0INITSAV2', title: '落ち着いた後に足した本', authors: '初期化 テスト' };

// 本物の操作で本を足す (設定 → 蔵書 → 手動で本を追加)
async function addBookByHand(page, book) {
    await openSettingsByClick(page, 'library-section');
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(book.asin);
    await page.locator('#manual-title').fill(book.title);
    await page.locator('#manual-authors').fill(book.authors);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
}

// 模擬のハブへの書き込みが quietMs の間1件も増えなくなるまで待つ (遅らせた PUT 1.5 秒・保存の待ち 0.8 秒より長く取る)
async function waitHubQuiet(store, quietMs = 4000, timeout = 60_000) {
    let last = -1;
    let since = Date.now();
    await expect.poll(() => {
        const n = store.writes.length;
        if (n !== last) { last = n; since = Date.now(); }
        return Date.now() - since >= quietMs;
    }, { timeout, intervals: [250] }).toBe(true);
}

// 保存先の「すべての本」の id (3か所)・冊数・asin を数える
function countHub(store) {
    const shelves = store.readJSON('private/bookshelves.json');
    const all = store.readJSON('private/bookshelves/all.json');
    const main = store.readJSON('private/main.json');
    const lib = store.readJSON('private/library.json');
    const allEntry = ((shelves && shelves.bookshelves) || []).find((b) => b.slug === 'all');
    return {
        ids: {
            bookshelvesJson: allEntry ? allEntry.internalId : null,
            allJson: all ? all.internalId : null,
            mainJson: main && Array.isArray(main.bookshelves) ? main.bookshelves[0] : null
        },
        libraryAsins: ((lib && lib.books) || []).map((b) => b.asin).sort(),
        allAsins: [...((all && all.books) || [])].sort()
    };
}

const distinct = (ids) => [...new Set(Object.values(ids))];

test('空のハブの初期化中に本を足しても、初期化は1回だけで、保存先の「すべての本」の id と冊数が揃い、再読込・次の保存の後も揃ったまま', async ({ page }) => {
    test.setTimeout(150_000);
    const hub = createHubStateForTest();
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false }); // 端末に蔵書なし・保存先はハブ
    await mockHubForTest(page, hub);                                          // ハブは空 (ファイル0件)
    const store = hubStoreForTest(hub);

    // 1件ずつの書き込みを遅らせる。page の route は context の模擬より先に効き、fallback で模擬へ回る
    await page.route('https://mockhub.test/data/**', async (route) => {
        if (route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, 1500));
        return route.fallback();
    });
    const puts = [];
    page.on('response', (res) => {
        const req = res.request();
        if (req.method() !== 'PUT') return;
        const m = req.url().match(/^https:\/\/mockhub\.test\/data\/([^?#]+)/);
        if (!m) return;
        // 「すべての本」の id を書くファイルは、書いた id も控える (2回の初期化が別々の id を作ったかを見る)
        let id;
        try {
            const body = JSON.parse(req.postData() || 'null');
            id = body && (body.internalId || (Array.isArray(body.bookshelves) ? (typeof body.bookshelves[0] === 'string' ? body.bookshelves[0] : body.bookshelves[0] && body.bookshelves[0].internalId) : undefined));
        } catch (_) { id = undefined; }
        puts.push({ path: decodeURIComponent(m[1]), status: res.status(), id });
    });
    const putCounts = () => Object.fromEntries(INIT_FILES.map((p) => [p, puts.filter((x) => x.path === p).map((x) => (x.id ? `${x.status}:${x.id}` : x.status))]));

    await bootAppForTest(page);
    const initDlg = page.locator('.cfm-overlay', { hasText: '初期化しますか' });
    await expect(initDlg).toBeVisible({ timeout: 15_000 });
    await initDlg.locator('.cfm-ok').click();
    await expect(initDlg).toBeHidden();

    // 初期化の途中 (all.json がまだ届いていない間) に、本物の操作で1冊足す
    await addBookByHand(page, BOOK1);
    const addedBeforeAllJson = !store.has('private/bookshelves/all.json');
    expect(addedBeforeAllJson, '本を足し終えた時、初期化の all.json はまだ届いていない (= 初期化の途中に足した)').toBe(true);

    // 落ち着くまで待つ (初期化→読込→最初の保存)
    await waitForHubStartupForTest(page);
    await waitHubQuiet(store);
    const afterFirst = { puts: putCounts(), ...countHub(store) };
    console.log(`[643] after-first-save ${JSON.stringify(afterFirst)}`);

    // 初期化は1回だけ = 初期化の7ファイルへの PUT はそれぞれ1回
    for (const p of INIT_FILES) expect.soft(afterFirst.puts[p].length, `${p} への PUT の回数`).toBe(1);
    // 「すべての本」の id が3か所で揃う・足した本が蔵書とすべての本の両方に1冊だけ
    expect.soft(distinct(afterFirst.ids), '「すべての本」の id (bookshelves.json・all.json・main.json)').toHaveLength(1);
    expect.soft(afterFirst.libraryAsins, 'library.json の本').toEqual([BOOK1.asin]);
    expect.soft(afterFirst.allAsins, 'all.json の本').toEqual([BOOK1.asin]);

    // 手元と保存先が食い違っていないか: 開き直して、3択・確認が出ず、足した本が画面に残る
    await page.reload();
    await waitForHubStartupForTest(page);
    await waitHubQuiet(store);
    const dialogAfterReload = await page.locator('.cfm-overlay:visible').count();
    const statusAfterReload = (await page.locator('#obsidian-sync-status').first().textContent({ timeout: 2000 }).catch(() => '')) || '';
    const afterReload = { ...countHub(store), dialogs: dialogAfterReload, status: statusAfterReload.trim() };
    console.log(`[643] after-reload ${JSON.stringify(afterReload)}`);
    expect.soft(dialogAfterReload, '開き直した時の確認・3択の数').toBe(0);
    await expect.soft(page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value')).toHaveText('1');
    expect.soft(distinct(afterReload.ids), '開き直した後の「すべての本」の id').toHaveLength(1);
    expect.soft(afterReload.ids, '開き直した後も id が変わらない').toEqual(afterFirst.ids);

    // 次の保存: 2冊目を本物の操作で足す。手元の id が保存先とずれていれば、ここで all.json/bookshelves.json と main.json が割れる
    await addBookByHand(page, BOOK2);
    await waitHubQuiet(store);
    const afterSecond = { puts: putCounts(), ...countHub(store) };
    console.log(`[643] after-second-save ${JSON.stringify(afterSecond)}`);
    expect.soft(distinct(afterSecond.ids), '2冊目の保存の後の「すべての本」の id').toHaveLength(1);
    expect.soft(afterSecond.ids, '2冊目の保存の後も id が変わらない').toEqual(afterFirst.ids);
    expect.soft(afterSecond.libraryAsins, '2冊目の保存の後の library.json の本').toEqual([BOOK1.asin, BOOK2.asin].sort());
    expect.soft(afterSecond.allAsins, '2冊目の保存の後の all.json の本').toEqual([BOOK1.asin, BOOK2.asin].sort());
    await expect.soft(page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value')).toHaveText('2');
});
