// 初めての利用者が、空の保存先 (ハブ・この端末のフォルダ) の最初の保存が済む前に本を足して記事の画面を開いても、
// 引き出しに本が出る (イシュー#636)。
//
// 直す前は、手元の userData に「すべての本」(isSpecial の本棚) が無く、最初の保存の書き出しで初めて作っていた。
// その前に記事の画面を開くと引き出しの本棚が見つからず 0件で畳まれ、保存の後も描き直されなかった (開き直すと出る)。
// 今は「すべての本」をメモリに必ず1つ置く (js/bookshelf.js _ensureAllShelf)。
// tests/e2e/first-run-add-article-drawer.spec.js (イシュー#633) は「最初の保存の後に開く」場面。こちらは「前に開く」場面。
//
// 時機の作り方は #633 と同じ: 初期化の書き込みを、記事の画面を確かめ終えるまで止める (機械の速さによらず
// 「最初の保存の前」になる)。止めた後は模擬へ回す (gate-hub.js・gate-local.js の本体は変えない)。アプリの内部は読まない。
// 保存の後に、bookshelves.json と all.json の「すべての本」の id が同じであることも確かめる (書き出しは all.json に
// _storage.allInternalId、bookshelves.json にメモリの本棚の id を書くため、揃えないと食い違う)。
import { test, expect } from './helpers/test-base.js';
import { createHubStateForTest, seedHubLoginForTest, mockHubForTest, hubStoreForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, waitForLocalFileContainsForTest } from './helpers/gate-local.js';
import { openSettingsByClick } from './helpers/settings.js';

// 本物の操作で本を足す (設定 → 蔵書 → 手動で本を追加)
async function addBookByUi(page, book) {
    await openSettingsByClick(page, 'library-section');
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(book.asin);
    await page.locator('#manual-title').fill(book.title);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
}

// ホームの「最近追加した本」から本を押すと、短文メモの欄が出る
async function expectMemoField(page, asin) {
    await page.locator(`.widget-book-row [data-asin="${asin}"]`).first().click();
    await expect(page.locator(`.note-textarea[data-asin="${asin}"][data-scope="all"]`).first()).toBeVisible({ timeout: 10_000 });
}

// 公開 → 記事を新規作成 → 編集 → 本の引き出し (PC 幅では常駐) に足した本が出る
async function expectBookInDrawer(page, asin) {
    await page.locator('#sidebar-publish').click();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.locator('#art-new').click();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const formDone = page.locator('#art-fs-done');
    if (await formDone.isVisible()) await formDone.click();
    const toEdit = page.locator('#art-mode-edit');
    if (await toEdit.isVisible()) await toEdit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    await expect(page.locator(`.art-drawer-item[data-asin="${asin}"]`)).toBeVisible({ timeout: 10_000 });
}

test('空のハブで、最初の保存の前に本を足して記事の画面を開いても、引き出しに本が出る (保存の後も「すべての本」の id が揃う)', async ({ page }) => {
    test.setTimeout(90_000);
    const BOOK = { asin: 'B0FIRSTDR1', title: '最初の保存の前に足した本' };
    const hub = createHubStateForTest();
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false }); // 端末に蔵書なし・保存先はハブ
    await mockHubForTest(page, hub);                                          // ハブは空 (ファイル0件)
    // 書き込み (PUT) を、記事の画面を確かめ終えるまで止める。page の route は context の模擬より先に効き、fallback で模擬へ回る
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
    await expect.poll(() => heldPuts).toBeGreaterThan(0); // 初期化の書き込みが始まって止まっている = 読込も保存もまだ
    try {
        await addBookByUi(page, BOOK);
        await expectMemoField(page, BOOK.asin);
        await expectBookInDrawer(page, BOOK.asin);
        // ここまで書き込みは1件も保存先に届いていない = 最初の保存の前に開いた
        expect(hubStoreForTest(hub).has('private/library.json')).toBe(false);
    } finally {
        release();
    }
    // 初期化→読込→保存が済んだ後も、保存先に本が残り、「すべての本」の id が2つのファイルで同じ
    await waitForHubStartupForTest(page);
    const store = hubStoreForTest(hub);
    await expect.poll(() => (store.readJSON('private/library.json')?.books || []).map((b) => b.asin), { timeout: 30_000 }).toEqual([BOOK.asin]);
    await expect.poll(() => store.readJSON('private/bookshelves/all.json')?.books || [], { timeout: 30_000 }).toEqual([BOOK.asin]);
    const allIdIn = () => ({
        bookshelves: ((store.readJSON('private/bookshelves.json')?.bookshelves) || []).filter((b) => b.isSpecial).map((b) => b.internalId),
        allJson: store.readJSON('private/bookshelves/all.json')?.internalId || null
    });
    await expect.poll(() => { const ids = allIdIn(); return ids.bookshelves.length === 1 && ids.bookshelves[0] === ids.allJson; }, { timeout: 30_000 }).toBe(true);
    await expect(page.locator(`.art-drawer-item[data-asin="${BOOK.asin}"]`)).toBeVisible();
});

test('空のフォルダを初めてつないで、最初の保存の前に本を足して記事の画面を開いても、引き出しに本が出る (保存の後も「すべての本」の id が揃う)', async ({ page }) => {
    test.setTimeout(90_000);
    const BOOK = { asin: 'B0FIRSTDR2', title: '最初の保存の前に足した本 (フォルダ)' };
    const dir = 'first-run-drawer';
    const hub = createHubStateForTest();
    await seedHubLoginForTest(page, hub, { method: 'local', library: false }); // 公開先はハブ・データの保存先はこの端末
    await mockHubForTest(page, hub);
    await stubFolderPickerForTest(page, dir);
    // フォルダへの書き込み (書き込みの close) を、記事の画面を確かめ終えるまで止める
    await page.addInitScript(() => {
        const P = window.FileSystemWritableFileStream && window.FileSystemWritableFileStream.prototype;
        if (!P || window.testFolderWriteGate) return;
        let release = () => {};
        const gate = new Promise((resolve) => { release = resolve; });
        window.testFolderWriteGate = { held: 0, release };
        const close = P.close;
        P.close = async function (...args) { window.testFolderWriteGate.held += 1; await gate; return close.apply(this, args); };
    });
    await bootAppForTest(page);
    // 空のフォルダをつなぐ (アプリの「フォルダを選ぶ」と同じ処理・終わるのは待たない)
    await page.evaluate(() => { window.bookshelf.selectObsidianFolder(); });
    await expect.poll(() => page.evaluate(() => window.testFolderWriteGate.held)).toBeGreaterThan(0); // 初期化の書き込みが止まっている
    try {
        await addBookByUi(page, BOOK);
        await expectMemoField(page, BOOK.asin);
        await expectBookInDrawer(page, BOOK.asin);
    } finally {
        await page.evaluate(() => window.testFolderWriteGate.release());
    }
    await waitForLocalFileContainsForTest(page, dir, 'private/library.json', BOOK.asin, 30_000);
    await waitForLocalFileContainsForTest(page, dir, 'private/bookshelves/all.json', BOOK.asin, 30_000);
    const readJson = (path) => page.evaluate(async ([name, filePath]) => {
        try {
            let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
            const parts = filePath.split('/');
            for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
            return JSON.parse(await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text());
        } catch (_) { return null; }
    }, [dir, path]);
    await expect.poll(async () => {
        const metas = ((await readJson('private/bookshelves.json'))?.bookshelves || []).filter((b) => b.isSpecial).map((b) => b.internalId);
        const allId = (await readJson('private/bookshelves/all.json'))?.internalId || null;
        return metas.length === 1 && metas[0] === allId;
    }, { timeout: 30_000 }).toBe(true);
    await expect(page.locator(`.art-drawer-item[data-asin="${BOOK.asin}"]`)).toBeVisible();
});
