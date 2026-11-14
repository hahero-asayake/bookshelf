// 空の保存先 (ハブ) を初期化した直後、読込が終わる前に手で足した本が消えないこと (イシュー#633)。
//
// 直す前 (f6dd65a) は、「新規データで初期化しますか？」で OK を押してから、初期化の書き込み→読込が終わるまでの間に
// 足した本を、後から届いた空の読込が消していた (開き直さずに記事の画面へ行くと引き出しが0件・保存先にも残らない)。
// 本番のハブは書き込み1件に約2秒かかるので、初期化 (7ファイル) の間に人が本を足せる (この間、画面は塞がれない)。
// #602 の 029bf88 で直った (読込の時、保存先が空で手元にデータがあれば手元を採る・js/bookshelf.js _decideLoadedState)。
// #602 の E2E (sync-offline-reconnect.spec.js) は「つなぐ前から手元に本がある」形で、「確認の後・読込の前に足す」
// 時機は通していないので、ここで固定する。
//
// 時機の作り方: 初期化の書き込み (PUT /data/*) を、本を足し終えるまで止める (機械の速さによらず「読込の前に足した」に
// なる)。止めた後は gate-hub.js の模擬へ回す (gate-hub.js 本体は変えない)。アプリの内部は読まない。
// 直す前の版で赤・main で緑になることは scripts/verify/633-results.md に残した。
import { test, expect } from './helpers/test-base.js';
import { createHubStateForTest, seedHubLoginForTest, mockHubForTest, hubStoreForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { openSettingsByClick } from './helpers/settings.js';

const BOOK = { asin: 'B0FIRSTRN1', title: '初期化中に足した本', authors: '初期化 テスト' };

test('空のハブを初期化した直後、読込が終わる前に手で足した本が、開き直さずに記事の引き出しに出て、保存先にも残る', async ({ page }) => {
    test.setTimeout(90_000);
    const hub = createHubStateForTest();
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false }); // 端末に蔵書なし・保存先はハブ
    await mockHubForTest(page, hub);                                          // ハブは空 (ファイル0件)

    // 初期化の書き込み (PUT) を、本を足し終えるまで止める。page の route は context の模擬より先に効き、fallback で模擬へ回る
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    let heldPuts = 0;
    await page.route('https://mockhub.test/data/**', async (route) => {
        if (route.request().method() === 'PUT') {
            heldPuts += 1;
            await gate;
        }
        return route.fallback();
    });

    await bootAppForTest(page);
    const initDlg = page.locator('.cfm-overlay', { hasText: '初期化しますか' });
    await expect(initDlg).toBeVisible({ timeout: 15_000 });
    await initDlg.locator('.cfm-ok').click();
    await expect(initDlg).toBeHidden();
    // 初期化の書き込みが始まって止まっている = 読込はまだ
    await expect.poll(() => heldPuts).toBeGreaterThan(0);

    try {
        // 本物の操作で本を足す (設定 → 蔵書 → 手動で本を追加)
        await openSettingsByClick(page, 'library-section');
        await page.locator('#add-book-manually').click();
        await page.locator('#manual-asin').fill(BOOK.asin);
        await page.locator('#manual-title').fill(BOOK.title);
        await page.locator('#manual-authors').fill(BOOK.authors);
        await page.locator('#add-manually').click();
        await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
        await page.locator('#add-book-modal-close').click();
        await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
        // ここまで初期化の書き込みは1件も保存先に届いていない = 本を足したのは読込の前
        expect(hubStoreForTest(hub).has('private/library.json')).toBe(false);
    } finally {
        release();
    }

    // 初期化→読込が終わるのを待つ (読み込み中の表示が消える)。読込の後も、足した本が手元に残っている (ホームの蔵書数)
    await waitForHubStartupForTest(page);
    await expect(page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value')).toHaveText('1');

    // 保存先 (模擬のハブの中身) にも残る: 蔵書とすべての本の本棚に、足した本が1冊だけ
    const store = hubStoreForTest(hub);
    await expect.poll(() => (store.readJSON('private/library.json')?.books || []).map((b) => b.asin), { timeout: 20_000 }).toEqual([BOOK.asin]);
    await expect.poll(() => store.readJSON('private/bookshelves/all.json')?.books || [], { timeout: 20_000 }).toEqual([BOOK.asin]);

    // 開き直さずに記事の画面へ: 公開 → 記事を新規作成 → 編集 → 本の引き出し (PC 幅では常駐)。
    // 最初の保存が済んでから開く (済む前に開くと引き出しが空のまま戻らない別の不具合がある・633-results.md step3)
    await page.locator('#sidebar-publish').click();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.locator('#art-new').click();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const formDone = page.locator('#art-fs-done');
    if (await formDone.isVisible()) await formDone.click();
    const toEdit = page.locator('#art-mode-edit');
    if (await toEdit.isVisible()) await toEdit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    await expect(page.locator(`.art-drawer-item[data-asin="${BOOK.asin}"]`)).toBeVisible({ timeout: 10_000 });
});
