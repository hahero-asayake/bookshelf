// ハブは変えたファイルだけ送る (イシュー#612・ADR-163) ので、ファイルをまたぐ食い違いが保存先に残りうる
// (自分が変えていないファイルを、相手が変えても上書きしないため)。
// 食い違いのある保存先を読んでも、落ちない・利用者が書いた中身を消さない・表示が壊れないことを確かめる。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';

const NOTES = 'private/notes.json';
const SHELF_FILE = 'private/bookshelves/s0.json';
const ALL_FILE = 'private/bookshelves/all.json';
const tree = (page) => page.locator('#sidebar-bookshelf-tree');
const listItems = (page) => page.locator('#bookshelf .book-item');
const listItem = (page, n) => listItems(page).filter({ hasText: `フィクスチャの本 ${n}` }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const savedNote = (page) => page.locator('.save-note-status:visible').first();

test('食い違いのある保存先を読んでも落ちず、保存しても、本の無い短文メモと本棚の中身は消えない', async ({ page }) => {
    const store = createHubStateForTest();
    seedHubDataForTest(store);
    const put = (path, data) => { store.seq += 1; store.files.set(path, { content: JSON.stringify(data, null, 2), etag: `"v${store.seq}"` }); };
    const get = (path) => JSON.parse(store.files.get(path).content);
    const all = get(ALL_FILE);
    const lastReal = all.books[all.books.length - 1];
    // 食い違い1: 本の無い短文メモ
    put(NOTES, { notes: { ...(get(NOTES).notes || {}), B0GHOST001: { memo: '本の無い短文メモ' } } });
    // 食い違い2: 一覧 (library.json) に無い本が、本棚に載っている
    const shelf = { internalId: 'fixs000', slug: 's0', name: '棚ゼロ', iconName: null, parent: null };
    put('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }, shelf] });
    put(SHELF_FILE, { ...shelf, books: [all.books[0], 'B0GHOST002'], notes: {} });
    // 食い違い3: 一覧に無い本が「すべて」に載っている・一覧にある本 (最後の1冊) が「すべて」に載っていない
    put(ALL_FILE, { ...all, books: [...all.books.slice(0, -1), 'B0GHOST003'] });

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await seedHubLoginForTest(page, store, { method: 'hub', library: false });
    await mockHubForTest(page, store);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    page.setDefaultTimeout(10000);

    // 表示: 「すべて」の一覧に本が出る。食い違いのある本棚を開いても、一覧にある本だけが出る
    await tree(page).locator('[data-bookshelf-id="all"] .bsr-label').click();
    await expect(listItem(page, 1)).toBeVisible();
    const allCount = await listItems(page).count();
    await tree(page).locator('.tree-node', { hasText: '棚ゼロ' }).locator('.bsr-label').click();
    await expect(listItem(page, 1)).toBeVisible();
    const shelfCount = await listItems(page).count();

    // 保存を1回起こす (本1 に短文メモ)
    await listItem(page, 1).click();
    await memoBox(page).fill('食い違いの確認');
    await expect(savedNote(page)).toContainText('保存しました');
    await waitForHubFileContainsForTest(store, NOTES, '食い違いの確認');

    expect(allCount, '「すべて」には、一覧にある本が全部出る (all.json に載っていない本も)').toBe(all.books.length);
    expect(shelfCount, '本棚には、一覧にある本だけが出る').toBe(1);
    // bookshelves/all.json は、保存の時に一覧にある本だけで作り直される (一覧に無い番号は外れ、載っていなかった本は戻る)。
    // 利用者が書いた中身ではないので、このままとする (ADR-163)
    expect(get(ALL_FILE).books).toEqual(all.books);
    expect(all.books).toContain(lastReal);
    expect(get(NOTES).notes.B0GHOST001, '本の無い短文メモは残る').toEqual({ memo: '本の無い短文メモ' });
    expect(get(SHELF_FILE).books, '本棚に載っている、一覧に無い本の番号は残る').toContain('B0GHOST002');
    expect(errors, '画面のエラーは無い').toEqual([]);
});
