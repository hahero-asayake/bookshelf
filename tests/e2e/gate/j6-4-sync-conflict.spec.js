// 門のE2E (イシュー#588)。観測点 J6-4「衝突した時に選べて失われない」(G-3)。
// 2台 (端末Aと別の端末B) で同じハブを開き、Aが先に短文メモを書いてハブに届いたあと、Bが古い版のまま同じ本の短文メモを
// 書くと、Bに「同期の衝突」の3択が出ること、「編集内容をJSONで書き出す」で書き出したファイルにBの短文メモが入って
// いること、「再読込して最新版を取得」のあとAの短文メモが見えることを、利用者の操作だけで確かめる (②判断 (d))。
// 衝突はハブの模擬 (tests/e2e/helpers/gate-hub.js) の ETag 照合が 412 を返して起きる。内部からの注入はしない。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { readFileSync } from 'node:fs';
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from '../helpers/gate-hub.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from '../helpers/gate-device.js';

const BOOK = 'フィクスチャの本 1';
const MEMO_A = '門のE2E J6-4 端末Aが先に書いた短文メモ';
const MEMO_B = '門のE2E J6-4 端末Bが古い版のまま書いた短文メモ';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const savedNote = (page) => page.locator('.save-note-status:visible').first();
const conflictDialog = (page) => page.locator('#sync-conflict-dialog');

test('@gate J6-4 ハブ：2台で同じ本の短文メモを書いて衝突すると、3択が出て、書き出しとやり直しで失われない', async ({ page }) => {
    let hub = null;
    let other = null;
    let exported = null;

    await test.step('前提: ハブに蔵書を置き、端末Aでハブにログインして保存先をハブにした状態でアプリを開く', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('前提: 別の端末Bを用意する (同じハブにログイン済み・端末内の蔵書は空)', async () => {
        other = await prepareOtherDeviceForTest(page, hub);
    });

    await test.step('操作: 端末Bでアプリを開いておく (この時点のハブの中身を読む)', async () => {
        await other.goto('index.html');
        await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
        await expect(bookButton(other)).toBeVisible();
    });

    await test.step('操作: 端末Aで本を開き、短文メモを書いて「保存しました」を待つ', async () => {
        await bookButton(page).click();
        await memoBox(page).fill(MEMO_A);
        await expect(savedNote(page)).toContainText('保存しました');
    });

    await test.step('前提: 端末Aの短文メモがハブに届くのを待つ', async () => {
        await waitForHubFileContainsForTest(hub, 'private/notes.json', MEMO_A);
    });

    await test.step('操作: 端末Bで (古い版のまま) 同じ本を開き、別の短文メモを書く', async () => {
        await bookButton(other).click();
        await memoBox(other).fill(MEMO_B);
        await expect(savedNote(other)).toContainText('保存しました');
    });

    await test.step('確認: 端末Bに「同期の衝突」が出て、3つの選び方が見える', async () => {
        await expect(conflictDialog(other)).toBeVisible({ timeout: 20000 });
        await expect(conflictDialog(other)).toContainText('同期の衝突');
        await expect(conflictDialog(other).getByRole('button', { name: '何もしない' })).toBeVisible();
        await expect(conflictDialog(other).getByRole('button', { name: '編集内容をJSONで書き出す' })).toBeVisible();
        await expect(conflictDialog(other).getByRole('button', { name: '再読込して最新版を取得' })).toBeVisible();
    });

    await test.step('操作: 「編集内容をJSONで書き出す」を押し、書き出されたファイルを受け取る', async () => {
        const download = other.waitForEvent('download');
        await conflictDialog(other).getByRole('button', { name: '編集内容をJSONで書き出す' }).click();
        exported = await download;
    });

    await test.step('確認: 書き出したファイルに、端末Bの短文メモが入っている', async () => {
        expect(readFileSync(await exported.path(), 'utf-8')).toContain(MEMO_B);
    });

    await test.step('操作: もう一度出た「同期の衝突」で「再読込して最新版を取得」を押し、読み込みが終わってから本を開く', async () => {
        await expect(conflictDialog(other)).toBeVisible();
        const reloaded = other.waitForEvent('load');
        await conflictDialog(other).getByRole('button', { name: '再読込して最新版を取得' }).click();
        await reloaded;
        await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
        await expect(other.getByText('最新のデータを確認しています…')).toHaveCount(0, { timeout: 15000 });
        // 再読込の前に開いていた本の詳細は、読み込み後もそのまま開いている (PC は右の欄・iPhone は全面で一覧を覆う)。
        // 開いていない時だけ一覧から本を開く (イシュー#616 で webkit を流して分かった)
        await expect(memoBox(other).or(bookButton(other)).first()).toBeVisible();
        if (!(await memoBox(other).isVisible())) await bookButton(other).click();
    });

    await test.step('確認: 端末Bに、端末Aの短文メモが見える', async () => {
        await expect(memoBox(other)).toHaveValue(MEMO_A);
    });

    await test.step('前提: 別の端末を閉じる', async () => {
        await closeOtherDeviceForTest(other);
    });
});
