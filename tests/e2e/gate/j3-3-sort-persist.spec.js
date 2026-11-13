// 門のE2E (イシュー#590)。観測点 J3-3「並べ替えが残る」。
// 一覧の「表示」から並び順をタイトル順に変え、昇順・降順を切り替えると一覧の順が変わり、再読込しても同じ順で
// 見えることを、先頭の3冊の書名で確かめる。並び順は localStorage に保存されるので、蔵書は最初の1回だけ入れる。
// 書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryOnceForTest, bootAppForTest } from '../helpers/gate-setup.js';

const listItems = (page) => page.locator('#bookshelf .book-item');
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J3-3 並び順をタイトル順に変えて昇順・降順を切り替えると一覧の順が変わり、再読込しても同じ順で見える', async ({ page }) => {
    await test.step('前提: 蔵書を最初の1回だけ入れて、アプリを開いておく', async () => {
        await seedLibraryOnceForTest(page);
        await bootAppForTest(page);
    });

    await test.step('操作: 「すべての本」を開き、「表示」→ 並び順「タイトル」を選ぶ', async () => {
        await allShelf(page).click();
        await expect(listItems(page)).toHaveCount(5);
        await page.locator('#toggle-display').click();
        await page.locator('#sort-order').selectOption('title');
    });

    await test.step('確認: 一覧がタイトル順の降順 (本 5・本 4・本 3) になる', async () => {
        await expect(listItems(page).nth(0)).toContainText('フィクスチャの本 5');
        await expect(listItems(page).nth(1)).toContainText('フィクスチャの本 4');
        await expect(listItems(page).nth(2)).toContainText('フィクスチャの本 3');
    });

    await test.step('操作: 昇順・降順のボタンを押す', async () => {
        await page.locator('#sort-direction').click();
    });

    await test.step('確認: 一覧が逆の順 (本 1・本 2・本 3) になる', async () => {
        await expect(listItems(page).nth(0)).toContainText('フィクスチャの本 1');
        await expect(listItems(page).nth(1)).toContainText('フィクスチャの本 2');
        await expect(listItems(page).nth(2)).toContainText('フィクスチャの本 3');
    });

    // 再読込の前に、既定の並び (カスタム順＝本 1・本 2・本 3) と違う降順へ戻しておく (再読込で既定に戻っても見分けられるように)
    await test.step('操作: もう一度、昇順・降順のボタンを押す', async () => {
        await page.locator('#sort-direction').click();
    });

    await test.step('確認: 一覧が降順 (本 5・本 4・本 3) に戻る', async () => {
        await expect(listItems(page).nth(0)).toContainText('フィクスチャの本 5');
        await expect(listItems(page).nth(1)).toContainText('フィクスチャの本 4');
    });

    await test.step('操作: 再読込して「すべての本」を開く', async () => {
        await page.reload();
        await allShelf(page).click();
        await expect(listItems(page)).toHaveCount(5);
    });

    await test.step('確認: 再読込のあとも同じ順 (本 5・本 4・本 3) で、並び順は「タイトル」のまま', async () => {
        await expect(listItems(page).nth(0)).toContainText('フィクスチャの本 5');
        await expect(listItems(page).nth(1)).toContainText('フィクスチャの本 4');
        await expect(listItems(page).nth(2)).toContainText('フィクスチャの本 3');
        await expect(page.locator('#sort-order')).toHaveValue('title');
    });
});
