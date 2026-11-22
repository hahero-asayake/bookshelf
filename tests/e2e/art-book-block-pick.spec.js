// イシュー#770 (切り替え② artBookBlock＝#767 と #758 の本ブロックの短文メモ)。触れるモック (_vault-work/767/harness/e2e767.mjs・
// smoke767.mjs) で確かめた形をアプリで見る。対象は全画面「本を編集」の本ブロック。
//   a 入口は本の下の1つのボタン (本棚の「本を追加」と同じ .art-fs-add)。バーの入口と空の時の「+ 本を選ぶ」は出さない
//   b 空の時も同じボタン (字は「本を選ぶ（本棚・リストから選ぶ）」・選んだ後は「本を替える（本棚・リストから選ぶ）」)
//   c 「＋ ここに追加→本」で足すと引き出しが自分で開く
//   d 全画面の間は引き出しの対象がずっとこの本ブロック (2冊目を押しても差し替え・本棚ブロックを作らない)
//   本を選ぶと引き出しは閉じる (案A)・「表示中のN冊を追加」は出さない・短文メモの欄は保存されて再読込でも残る
//   localStorage 'bookshelf.flag.artBookBlock' = '0' で前の形 (バーの入口・「+ 本を選ぶ」・自分で開かない) に戻る。
// 390幅 (iPhone 相当) の webkit は playwright.config の webkit / gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { getArtBlocks } from './helpers/art-editor.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ハブの模擬で起動し、記事エディタを編集状態で開く。flag は artBookBlock の値 (null＝既定)。
// flag は起動の後に page.evaluate で入れる (addInitScript は再読込のたびに走るため使わない)。
async function openEditor(page, { flag = null } = {}) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    if (flag != null) await page.evaluate((v) => localStorage.setItem('bookshelf.flag.artBookBlock', v), flag);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    await expect(page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').first()).toBeAttached();
    return hub;
}

// 「＋ ここに追加」から本を選んで足す (足した直後は本の全画面＝form)
async function insertBook(page) {
    const frame = page.frameLocator('#art-canvas-frame');
    await expect(async () => {
        await frame.locator('.art-cv-ins-btn').last().click();
        await expect(page.locator('#art-add-sheet [data-block-type="book"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.locator('#art-add-sheet [data-block-type="book"]').click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
}

// 引き出しの開く transition が止まるのを待つ
const waitSheetStill = (page) => expect.poll(() => page.evaluate(() => new Promise((r) => {
    const s = document.getElementById('art-drawer'); const a = s.getBoundingClientRect();
    setTimeout(() => { const b = s.getBoundingClientRect(); r(Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5); }, 150);
}))).toBe(true);

const books = (page) => getArtBlocks(page).then((bs) => bs.filter((b) => b.type === 'book'));
const target = (page) => page.locator('#art-blocks .art-block').first();

for (const dev of [
    { name: 'PC 1280', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'スマホ390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA } },
]) {
    test.describe(`${dev.name}: 本ブロックの切り替え (既定＝on)`, () => {
        test.use(dev.use);

        test('a〜d: 足すと引き出しが自分で開き、選ぶと閉じる・入口は本の下の1つ・2冊目も同じブロックへ差し替え・N冊を追加は出ない', async ({ page }) => {
            await openEditor(page);
            await insertBook(page);
            const side = page.locator('#art-drawer');
            // c: 自分で開く・add-all は出ない
            await expect(side).toHaveClass(/is-open/);
            await expect(page.locator('#art-drawer-add-all')).toBeHidden();
            // a・b: 入口は本の下の .art-fs-add 1つ (バー・空の「+ 本を選ぶ」は無い)
            const blk = target(page);
            await expect(blk.locator('.art-book-pick')).toHaveCount(1);
            await expect(blk.locator('.art-fs-actions > .art-fs-add.art-book-pick')).toHaveText('本を選ぶ（本棚・リストから選ぶ）');
            await expect(blk.locator('.pp-empty')).toHaveCount(0);
            await waitSheetStill(page);
            const first = page.locator('#art-drawer .art-drawer-item').nth(0);
            const a1 = await first.getAttribute('data-asin');
            await first.click();
            // 案A: 選ぶと閉じる
            await expect(side).not.toHaveClass(/is-open/);
            await expect.poll(async () => (await books(page)).map((b) => b.asin)).toEqual([a1]);
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            const pick = blk.locator('.art-fs-actions > .art-fs-add.art-book-pick');
            await expect(pick).toHaveText('本を替える（本棚・リストから選ぶ）');
            await expect(blk.locator('.art-book-pick')).toHaveCount(1);
            // 本棚の「本を追加」と同じ寸法 (.art-fs-add の高さ 44)
            expect(Math.round((await pick.boundingBox()).height)).toBe(44);
            // d: 替えるで開き、2冊目を押しても同じブロックの差し替え (本棚ブロックを作らない)
            await pick.click();
            await expect(side).toHaveClass(/is-open/);
            await expect(page.locator('#art-drawer-add-all')).toBeHidden();
            await waitSheetStill(page);
            const second = page.locator('#art-drawer .art-drawer-item').nth(1);
            const a2 = await second.getAttribute('data-asin');
            await second.click();
            await expect(side).not.toHaveClass(/is-open/);
            await expect.poll(async () => (await books(page)).map((b) => b.asin)).toEqual([a2]);
            expect((await getArtBlocks(page)).filter((b) => b.type === 'shelf')).toHaveLength(0);
        });

        test('#758: 本ブロックの短文メモの欄に書くと保存され、再読込しても残る', async ({ page }) => {
            const hub = await openEditor(page);
            await insertBook(page);
            await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
            await waitSheetStill(page);
            await page.locator('#art-drawer .art-drawer-item').first().click();
            await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
            const memo = target(page).locator('.art-block-book-info > .art-fs-memo');
            await expect(memo).toBeVisible();
            await expect(memo).toHaveAttribute('placeholder', '短文メモを書く');
            const asin = await memo.getAttribute('data-asin');
            const text = `本ブロックのメモ${Date.now() % 100000}`;
            await memo.fill(text);
            await waitForHubFileContainsForTest(hub, 'private/notes.json', text);
            await page.reload();
            await waitForHubStartupForTest(page);
            await expect.poll(() => page.evaluate((a) => window.bookshelf.bookshelfManager.resolveMemo(a), asin)).toBe(text);
        });
    });
}

test.describe('PC 1280: artBookBlock=0 で前の形', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('足しても引き出しは自分で開かず、入口はバーと「+ 本を選ぶ」・短文メモの欄は無い', async ({ page }) => {
        await openEditor(page, { flag: '0' });
        await insertBook(page);
        await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
        const blk = target(page);
        await expect(blk.locator('.pp-empty.art-book-pick')).toHaveText('+ 本を選ぶ');
        await expect(blk.locator('.art-block-bar .art-book-pick')).toHaveCount(1);
        await expect(blk.locator('.art-fs-add')).toHaveCount(0);
        await expect(blk.locator('.art-fs-memo')).toHaveCount(0);
    });
});
