// 2台が同じハブに、別々の本の短文メモを交互に保存しても、衝突の3択が出ずに両方残る (イシュー#612・ADR-163)。
// 直す前は、読み直していない側の次の保存で必ず3択が出た (notes.json を1ファイル丸ごと送るため・#616 の実測)。
// 同じ本の短文メモを2台が違う中身にした時は、今までどおり3択が出る (相手の変更を黙って消さない)。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from './helpers/gate-device.js';

const NOTES = 'private/notes.json';
const book = (page, n) => page.getByRole('button', { name: `フィクスチャの本 ${n}`, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const savedNote = (page) => page.locator('.save-note-status:visible').first();
const conflictDialog = (page) => page.locator('#sync-conflict-dialog');
const memoOf = (store, asin) => ((JSON.parse(store.files.get(NOTES).content).notes || {})[asin] || {}).memo;

async function writeMemo(page, n, text) {
    await book(page, n).click();
    await memoBox(page).fill(text);
    await expect(savedNote(page)).toContainText('保存しました');
}

test('2台が別々の本の短文メモを交互に保存しても3択は出ず両方残り、同じ本を違う中身にすると3択が出る', async ({ page }) => {
    test.setTimeout(120000);
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    // 前提: 端末Aで1回保存して、ハブの中身をアプリが書く形 (固定7本) にそろえる (見本は一部のファイルしか置かないため)
    await writeMemo(page, 5, '前提 A の本5');
    await waitForHubFileContainsForTest(hub, NOTES, '前提 A の本5');
    const other = await prepareOtherDeviceForTest(page, hub);
    await other.goto('index.html');
    await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
    await expect(book(other, 2)).toBeVisible();

    // 1. A が本1に書く → 届く
    await writeMemo(page, 1, '交互 A の本1');
    await waitForHubFileContainsForTest(hub, NOTES, '交互 A の本1');
    // 2. B が (読み直さずに) 本2に書く → 3択は出ず、両方残る
    await writeMemo(other, 2, '交互 B の本2');
    await waitForHubFileContainsForTest(hub, NOTES, '交互 B の本2');
    expect(memoOf(hub, 'B000000001')).toBe('交互 A の本1');
    // 3. A が (読み直さずに) 本1をもう一度書く → 3択は出ず、B の本2は消えない
    await writeMemo(page, 1, '交互 A の本1 2回目');
    await waitForHubFileContainsForTest(hub, NOTES, '交互 A の本1 2回目');
    expect(memoOf(hub, 'B000000002')).toBe('交互 B の本2');
    // 4. B が本3に書く → 3択は出ず、A の本1 (2回目) も残る
    await writeMemo(other, 3, '交互 B の本3');
    await waitForHubFileContainsForTest(hub, NOTES, '交互 B の本3');
    expect(memoOf(hub, 'B000000001')).toBe('交互 A の本1 2回目');
    expect(memoOf(hub, 'B000000002')).toBe('交互 B の本2');
    await expect(conflictDialog(page)).toHaveCount(0);
    await expect(conflictDialog(other)).toHaveCount(0);

    // 5. 同じ本 (本1) を、A が書いた後に B が (読み直さずに) 違う中身にする → B に3択が出て、A の中身は残る
    await writeMemo(page, 1, '同じ本 A');
    await waitForHubFileContainsForTest(hub, NOTES, '同じ本 A');
    await writeMemo(other, 1, '同じ本 B');
    await expect(conflictDialog(other)).toBeVisible({ timeout: 20000 });
    expect(memoOf(hub, 'B000000001')).toBe('同じ本 A');
    await closeOtherDeviceForTest(other);
});
