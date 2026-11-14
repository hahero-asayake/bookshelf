// ハブへの一括保存は、変えたファイルと版の印だけを送る (イシュー#612)。
// 画面から短文メモを書いて保存し、POST /data/batch に載ったファイルを数える。直す前は毎回「固定7本＋本棚の数」を
// 全部送っていた (本棚20個で27件)。保存の中身に「今の時刻」が入るファイル (library.json の日時・追加日の無い本) は、
// 中身が同じでも毎回送られていたので、それも守る。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';

const NOTES = 'private/notes.json';
const STAMP = 'private/sync-stamp.json';
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const savedNote = (page) => page.locator('.save-note-status:visible').first();
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label');
const listItem = (page, n) => page.locator('#bookshelf .book-item').filter({ hasText: `フィクスチャの本 ${n}` }).first();

function seedFile(store, path, data) { store.seq += 1; store.files.set(path, { content: JSON.stringify(data), etag: `"v${store.seq}"` }); }

// 模擬のハブに蔵書 (と、指定があれば本棚20個) を置き、ハブを保存先にしてアプリを開く。一括書き込みに載ったパスを集める
async function openWithHub(page, { shelves = 0, mutate } = {}) {
    const store = createHubStateForTest();
    seedHubDataForTest(store);
    if (shelves) {
        const list = Array.from({ length: shelves }, (_, i) => ({ internalId: `fixs${String(i).padStart(3, '0')}`, slug: `s${i}`, name: `棚${i}`, iconName: null, parent: null }));
        seedFile(store, 'private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }, ...list] });
        for (const s of list) seedFile(store, `private/bookshelves/${s.slug}.json`, { ...s, books: [], notes: {} });
    }
    if (mutate) mutate(store);
    await seedHubLoginForTest(page, store, { method: 'hub', library: false });
    await mockHubForTest(page, store);
    const batches = [];
    page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/data/batch') batches.push(JSON.parse(r.postData()).entries.map((e) => e.path));
    });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    // 一覧から本を開いて短文メモを書き、保存先に届くのを待つ
    const writeMemo = async (n, text) => {
        await allShelf(page).click();
        await listItem(page, n).click();
        await memoBox(page).fill(text);
        await expect(savedNote(page)).toContainText('保存しました');
        await waitForHubFileContainsForTest(store, NOTES, text);
    };
    return { store, batches, writeMemo };
}

test('本棚20個でも、2回目以降の短文メモの保存は notes.json と版の印の2件だけを送る (読み直した直後も同じ)', async ({ page }) => {
    const { batches, writeMemo } = await openWithHub(page, { shelves: 20 });
    await writeMemo(1, '件数の確認 1回目');
    // 模擬に置いた種はアプリの書き方と違うので、最初の保存は全部 (固定7本＋本棚20個) と印を送る
    expect(batches[batches.length - 1].length).toBe(28);

    let mark = batches.length;
    await writeMemo(2, '件数の確認 2回目');
    expect(batches.slice(mark)).toEqual([[NOTES, STAMP]]);

    // アプリが書いた中身を読み直した直後の最初の保存でも、library.json などは送らない (日時を据え置く)
    await page.reload();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 15000 });
    await waitForHubStartupForTest(page);
    mark = batches.length;
    await writeMemo(3, '件数の確認 読み直した後');
    expect(batches.slice(mark)).toEqual([[NOTES, STAMP]]);
});

test('追加日・取得日の無い本があっても、2回目以降の保存で library.json を送らない', async ({ page }) => {
    const { batches, writeMemo } = await openWithHub(page, {
        mutate: (store) => {
            const lib = JSON.parse(store.files.get('private/library.json').content);
            lib.books.forEach((b) => { delete b.addedDate; delete b.acquiredTime; });
            seedFile(store, 'private/library.json', lib);
        }
    });
    await writeMemo(1, '日時の無い本 1回目'); // ここで補った時刻が library.json に書かれる
    let mark = batches.length;
    await writeMemo(2, '日時の無い本 2回目');
    expect(batches.slice(mark)).toEqual([[NOTES, STAMP]]);
    mark = batches.length;
    await writeMemo(3, '日時の無い本 3回目');
    expect(batches.slice(mark)).toEqual([[NOTES, STAMP]]);
});
