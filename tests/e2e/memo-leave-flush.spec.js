// イシュー#618: 入力のあと少し待ってから保存するメモ2か所 (本の詳細の短文メモ=300ms・ホームの自由メモ=400ms) は、
// 保存待ちの間に再読込したりタブを閉じたりしても消えないこと (#609 の記事エディタの本のメモの横展開)。
// 操作は利用者の操作だけで行い、保存されたかは localStorage を直接読む (アプリの内部は読まない)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from './helpers/test-base.js';
import { seedLibraryOnceForTest, bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf-8');

const BOOK_ASIN = 'B000000002';
const BOOK_TITLE = 'フィクスチャの本 2';
const USER_DATA_KEY = 'virtualBookshelf_userData';
const PINNED_MEMO_KEY = 'bookshelf_pinnedMemo_v1';

const bookItem = (page) => page.locator(`#bookshelf .book-item[data-asin="${BOOK_ASIN}"]`).first();
const memoBox = (page) => page.locator('#bd-sections .note-textarea[data-scope="all"]').first();
const pinnedMemoBox = (page) => page.locator('#dashboard-grid .widget-pinned-memo');

// 下のナビ「本棚」→「すべての本」→ 本をタップして、本の詳細を開く (gate/j8-offline.spec.js と同じ道すじ)。
// 先にアプリの起動が済む (ホームに書名が出る) のを待つ (起動前に下のナビを押すと何も起きない)
async function tapToBookDetail(page) {
    await expect(page.getByText('フィクスチャの本 1').first()).toBeVisible();
    await page.locator('[data-mobile-nav="shelves"]').tap();
    await expect(page.locator('body')).toHaveClass(/drawer-open/);
    await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'すべての本' }).first().tap();
    await bookItem(page).tap();
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
}

// ホームにピン留めメモのウィジェットだけを置いた利用者データで、最初に開いた時の1回だけ入れる
// (再読込では入れ直さない = 再読込のあとに残っているかを見られる。seedLibraryOnceForTest と同じ作り)
async function seedPinnedMemoLayoutOnce(page) {
    const ud = JSON.parse(fixture('fixture-userdata.json'));
    ud._storage = ud._storage || {};
    ud._storage.main = { ...(ud._storage.main || {}), home: { widgets: [{ id: 'pinned-memo', span: 6 }] } };
    await page.addInitScript(([userData, library]) => {
        if (sessionStorage.getItem('memo-leave-seeded')) return;
        sessionStorage.setItem('memo-leave-seeded', '1');
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(ud), fixture('fixture-library.json')]);
}

// 利用者データ (localStorage) にある、その本の短文メモ (setMemo は notes[asin].memo に書く)
const memoIn = (raw, asin = BOOK_ASIN) => {
    try { return ((JSON.parse(raw || '{}').notes || {})[asin] || {}).memo ?? null; } catch (_) { return null; }
};
const readLocal = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

// タブを閉じる (閉じる時のイベントを走らせ、閉じ終わるまで待つ)。そのあと、ページを開き直さずに
// 同じ context の保存状態から localStorage を読む (開き直すとアプリの起動の書き込みが混ざるため)
async function closeTabAndReadLocal(page, context, baseURL, key) {
    const closed = page.waitForEvent('close');
    await page.close({ runBeforeUnload: true });
    await closed;
    const state = await context.storageState();
    const origin = state.origins.find((o) => o.origin === new URL(baseURL).origin);
    const item = origin && origin.localStorage.find((i) => i.name === key);
    return item ? item.value : null;
}

const NOT_YET = '離れる前に保存が済んでいた (保存の予約が先に発火した＝このテストは保存待ちの間に離れていない)';

test('M1 本の詳細の短文メモを入れてすぐ再読込しても、メモが残る', async ({ page }) => {
    const MEMO = 'M1 すぐ再読込するメモ';
    await seedLibraryOnceForTest(page);
    await bootAppForTest(page);
    await tapToBookDetail(page);
    await memoBox(page).fill(MEMO);
    expect(memoIn(await readLocal(page, USER_DATA_KEY)), NOT_YET).not.toBe(MEMO);
    await page.reload();
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    expect(memoIn(await readLocal(page, USER_DATA_KEY))).toBe(MEMO);
    // 本の詳細は URL (#book/<asin>) に載っているので、再読込すると同じ本の詳細が開いた状態で戻る (gate/j8-offline.spec.js の J8-3 と同じ)
    await expect(page.locator('#book-detail-pane .bd-title')).toHaveText(BOOK_TITLE);
    await expect(memoBox(page)).toHaveValue(MEMO);
});

test('M2 本の詳細の短文メモを入れてすぐタブを閉じても、メモが端末に残る', async ({ page, context, baseURL }) => {
    const MEMO = 'M2 すぐ閉じるメモ';
    await seedLibraryOnceForTest(page);
    await bootAppForTest(page);
    await tapToBookDetail(page);
    await memoBox(page).fill(MEMO);
    expect(memoIn(await readLocal(page, USER_DATA_KEY)), NOT_YET).not.toBe(MEMO);
    expect(memoIn(await closeTabAndReadLocal(page, context, baseURL, USER_DATA_KEY))).toBe(MEMO);
});

test('M3 ホームの自由メモを入れてすぐ再読込しても、メモが残る', async ({ page }) => {
    const MEMO = 'M3 すぐ再読込する自由メモ';
    await seedPinnedMemoLayoutOnce(page);
    await bootAppForTest(page);
    await pinnedMemoBox(page).fill(MEMO);
    expect(await readLocal(page, PINNED_MEMO_KEY), NOT_YET).not.toBe(MEMO);
    await page.reload();
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    expect(await readLocal(page, PINNED_MEMO_KEY)).toBe(MEMO);
    await expect(pinnedMemoBox(page)).toHaveValue(MEMO);
});

test('M4 ホームの自由メモを入れてすぐタブを閉じても、メモが端末に残る', async ({ page, context, baseURL }) => {
    const MEMO = 'M4 すぐ閉じる自由メモ';
    await seedPinnedMemoLayoutOnce(page);
    await bootAppForTest(page);
    await pinnedMemoBox(page).fill(MEMO);
    expect(await readLocal(page, PINNED_MEMO_KEY), NOT_YET).not.toBe(MEMO);
    expect(await closeTabAndReadLocal(page, context, baseURL, PINNED_MEMO_KEY)).toBe(MEMO);
});

// 保存先がハブの時 (ハブは tests/e2e/helpers/gate-hub.js の模擬・gate/j6-3 と同じ入口)。再読込すると、アプリはハブの
// データを読み直す。保存待ちの間に離れたメモが、ハブにある古いデータで上書きされずに残ることを見る
test.describe('保存先がハブの時', () => {
    test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false });

    test('M5 本の詳細の短文メモを入れてすぐ再読込しても、ハブの古いデータで上書きされない', async ({ page }) => {
        const MEMO = 'M5 ハブの時にすぐ再読込するメモ';
        const ASIN = 'B000000001';
        const bookButton = page.getByRole('button', { name: 'フィクスチャの本 1', exact: true }).first();
        const box = page.locator('.note-textarea[data-scope="all"]:visible').first();
        const hub = createHubStateForTest();
        seedHubDataForTest(hub);
        // exportDate が無いと、再読込で読込の決め方が 'ask' (3択「別の端末などで更新されています」) の分岐に入るので足している
        // (見本の蔵書には版の印が無く、控えが空になる。アプリが書く保存先と同じく、版の印を付けておく)
        const lib = hub.files.get('private/library.json');
        hub.files.set('private/library.json', { ...lib, content: JSON.stringify({ ...JSON.parse(lib.content), exportDate: '2026-11-01T00:00:00.000Z' }) });
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
        await bookButton.click();
        await box.fill(MEMO);
        expect(memoIn(await readLocal(page, USER_DATA_KEY), ASIN), NOT_YET).not.toBe(MEMO);
        await page.reload();
        await waitForHubStartupForTest(page);
        expect(memoIn(await readLocal(page, USER_DATA_KEY), ASIN)).toBe(MEMO);
        await bookButton.click();
        await expect(box).toHaveValue(MEMO);
    });
});
