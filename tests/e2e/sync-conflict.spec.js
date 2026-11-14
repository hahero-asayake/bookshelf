// 同期衝突ダイアログ (WP-B2) の回帰テスト
//  書き込み時の選択 (保存先の内容を読み込む / この端末の内容を書き出す。イシュー#635 で読込時の選択と同じ定義に寄せた)
//  + 書き出し後に選び直せること + 最初のフォーカスと Enter・390幅の枠外クリックで何も消えないこと
import { test, expect } from './helpers/test-base.js';
import { triggerSyncConflict } from './helpers/sync.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest } from './helpers/gate-hub.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from './helpers/gate-device.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    return errors;
}

test('衝突ダイアログに2つの選び方が出て、同期元名が入る (ハブ)', async ({ page }) => {
    const errors = await bootApp(page);
    await triggerSyncConflict(page, 'Asayake ハブ');
    const dlg = page.locator('#sync-conflict-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.cfm-title')).toHaveText('保存先とこの端末の両方が変わっています');
    await expect(dlg.locator('.cfm-message')).toContainText('保存先（Asayake ハブ）の内容が');
    await expect(dlg.locator('.cfm-remote')).toHaveText('保存先の内容を読み込む');
    await expect(dlg.locator('.cfm-remote')).toHaveClass(/btn-danger/);
    await expect(dlg.locator('.cfm-export')).toHaveText('この端末の内容を書き出す');
    await expect(dlg.locator('.cfm-export')).toHaveClass(/btn-primary/);
    // 書き込み時は上書きを出さない。「何もしない」のボタンも無い (Esc・枠外クリックで選ばずに閉じる)
    await expect(dlg.locator('button')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect(errors).toEqual([]);
});

test('書き出しを選ぶと JSON がダウンロードされ、ダイアログに戻って読み込むも選べる', async ({ page }) => {
    const errors = await bootApp(page);
    await triggerSyncConflict(page, 'GitHub');
    const dlg = page.locator('#sync-conflict-dialog');
    await expect(dlg).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await dlg.locator('.cfm-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    // 退避後にダイアログへ戻る (改めて「保存先の内容を読み込む」を選べる)
    await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
    // 「保存先の内容を読み込む」を選ぶとページがリロードされる
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        page.locator('#sync-conflict-dialog .cfm-remote').click()
    ]);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    expect(errors).toEqual([]);
});

// イシュー#635 (②の指示): 2台の本当の衝突 (門の J6-4 と同じ起こし方) を 390 幅で起こし、最初のフォーカスが
// 「この端末の内容を書き出す」で Enter では何も消えないこと、枠外クリックで閉じた後も手元の短文メモ・衝突中の印・
// 未反映の印が残り、保存先へは送らないことを、利用者の操作で確かめる
test('390幅: 書き込みの衝突で Enter は書き出すだけ、枠外クリックで閉じても手元の短文メモと衝突中の印が残る (ハブ)', async ({ page }) => {
    const BOOK = 'フィクスチャの本 1';
    const MEMO_A = 'イシュー635 端末Aが先に書いた短文メモ';
    const MEMO_B = 'イシュー635 端末Bが古い版のまま書いた短文メモ';
    const bookButton = (p) => p.getByRole('button', { name: BOOK, exact: true }).first();
    const memoBox = (p) => p.locator('.note-textarea[data-scope="all"]:visible').first();
    const savedNote = (p) => p.locator('.save-note-status:visible').first();
    await page.setViewportSize({ width: 390, height: 844 });
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    const other = await prepareOtherDeviceForTest(page, hub);
    await other.setViewportSize({ width: 390, height: 844 });
    await other.goto('index.html');
    await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
    await expect(bookButton(other)).toBeVisible();
    await bookButton(page).click();
    await memoBox(page).fill(MEMO_A);
    await expect(savedNote(page)).toContainText('保存しました');
    await waitForHubFileContainsForTest(hub, 'private/notes.json', MEMO_A);
    await bookButton(other).click();
    await memoBox(other).fill(MEMO_B);
    await expect(savedNote(other)).toContainText('保存しました');
    const dlg = other.locator('#sync-conflict-dialog');
    await expect(dlg).toBeVisible({ timeout: 20000 });
    await expect(dlg.locator('.cfm-export')).toBeFocused();
    // Enter は既定の「書き出す」= 何も消えない (書き出した後にもう一度聞かれる)
    const download = other.waitForEvent('download');
    await other.keyboard.press('Enter');
    await download;
    await expect(dlg).toBeVisible();
    // 枠外クリックは選ばずに閉じる
    await other.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } });
    await expect(dlg).toBeHidden();
    await other.waitForTimeout(1500);
    const marks = await other.evaluate(() => ({
        conflict: localStorage.getItem('virtualBookshelf_syncConflict'),
        pending: localStorage.getItem('virtualBookshelf_pendingSync')
    }));
    expect.soft(marks.conflict, '衝突中の印は残る').not.toBeNull();
    expect.soft(marks.pending, '未反映の印は残る').toBe('1');
    await expect(memoBox(other), '手元の短文メモは残る').toHaveValue(MEMO_B);
    const remote = hub.files.get('private/notes.json').content;
    expect.soft(remote.includes(MEMO_A), '保存先は端末Aの短文メモのまま').toBe(true);
    expect.soft(remote.includes(MEMO_B), '保存先へは送らない').toBe(false);
    await closeOtherDeviceForTest(other);
});
