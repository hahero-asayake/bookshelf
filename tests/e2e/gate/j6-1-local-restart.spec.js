// 門のE2E (イシュー#588)。観測点 J6-1「ローカル：保存→再起動で読める」(G-3)。
// 利用者と同じ操作だけで、設定の「同期」から「フォルダを選ぶ」で保存先のフォルダをつなぎ、本の短文メモを書いて、
// アプリを開き直す (再読込) と、その短文メモが見えて保存先がそのフォルダのままであることを確かめる。
// フォルダはブラウザの中の本物のフォルダ (OPFS・tests/e2e/helpers/gate-local.js)。アプリの読み書きは差し替えない。
// 開き直す前に端末内の控え (localStorage) だけを消し、見えるものがフォルダから読んだものに限られるようにする (②判断 (c))。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, seedLocalLibraryOnceForTest, seedLocalFolderForTest, waitForLocalFileContainsForTest, clearLocalCacheForTest } from '../helpers/gate-local.js';

const FOLDER = 'gate-local';
const BOOK = 'フィクスチャの本 1';
const MEMO = '門のE2E J6-1 フォルダに保存した短文メモ';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();

test('@gate J6-1 ローカル：フォルダを選んで短文メモを書き、開き直すとその短文メモが読める', async ({ page }) => {
    await test.step('前提: 端末内に蔵書を入れ、保存先の方式をローカルにしてアプリを開く。蔵書の入ったフォルダを用意する (まだ選んでいない)', async () => {
        await stubFolderPickerForTest(page, FOLDER);
        await seedLocalLibraryOnceForTest(page);
        await bootAppForTest(page);
        await seedLocalFolderForTest(page, FOLDER);
    });

    await test.step('操作: 設定 →「同期」→「フォルダを選ぶ」で保存先のフォルダをつなぐ', async () => {
        await page.locator('#sidebar-settings').click();
        await expect(page.locator('#settings-modal')).toBeVisible();
        await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
        await page.getByRole('button', { name: 'フォルダを選ぶ' }).click();
        await expect(page.getByText(`「${FOLDER}」から 5 冊を読み込みました。`)).toBeVisible();
        await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-modal')).toBeHidden();
    });

    await test.step('操作: 本を開き、短文メモを書いて「保存しました」を待つ', async () => {
        await bookButton(page).click();
        await memoBox(page).fill(MEMO);
        await expect(page.locator('.save-note-status:visible').first()).toContainText('保存しました');
    });

    await test.step('前提: 短文メモがフォルダに書かれるのを待ち、端末内の控えだけを消す', async () => {
        await waitForLocalFileContainsForTest(page, FOLDER, 'private/notes.json', MEMO);
        await clearLocalCacheForTest(page);
    });

    await test.step('操作: アプリを開き直し (再読込)、同じ本を開く', async () => {
        await page.reload();
        await expect(page.locator('#loading')).toBeHidden({ timeout: 15000 });
        await bookButton(page).click();
    });

    await test.step('確認: 書いた短文メモが見える', async () => {
        await expect(memoBox(page)).toHaveValue(MEMO);
    });

    await test.step('操作: 設定 →「同期」を開く', async () => {
        await page.keyboard.press('Escape');
        await page.locator('#sidebar-settings').click();
        await expect(page.locator('#settings-modal')).toBeVisible();
        await page.locator('#settings-master .settings-cat[data-cat="sync-section"]').click();
    });

    await test.step('確認: 保存先が同じフォルダのまま、同期済みと出る', async () => {
        await expect(page.locator('#obsidian-sync-path')).toContainText(FOLDER);
        await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
    });
});
