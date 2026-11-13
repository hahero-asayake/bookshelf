// イシュー#592: 初回にフォルダをつないだ時に、保存先の設定 (localStorage の bookshelf_sync) が保存され、
// ホームの案内 (手順1)・設定の保存先セレクトの表示が、実際の接続と一致することを確かめる。
// フォルダを選ぶ画面 (showDirectoryPicker) だけを、ブラウザの中の実際のフォルダ (OPFS) のハンドルを返す形に模擬する。
// 選んだ後の保存・IndexedDB へのハンドルの保存・再読込での復元は、アプリの本物のコードが行う (メモリへの置き換えはしない)。
import { test, expect } from './helpers/test-base.js';

const FOLDER = 'issue592-folder';
const SYNC_KEY = 'bookshelf_sync';
const methodSelect = (page) => page.locator('#sync-method-select');
const welcomeSyncBtn = (page) => page.locator('#dashboard-welcome button[data-dw="sync"]');
const syncPath = (page) => page.locator('#obsidian-sync-path');
const syncStatus = (page) => page.locator('#obsidian-sync-status');

test.use({ viewport: { width: 1280, height: 800 } });

/** 「フォルダを選ぶ」を押すと、ブラウザの中の実際のフォルダ (名前 folderName) が選ばれるようにする。アプリを開く前に呼ぶ。 */
async function mockFolderPicker(page, folderName) {
    await page.addInitScript((name) => {
        window.showDirectoryPicker = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle(name, { create: true });
        };
    }, folderName);
}

async function waitAppReady(page) {
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

async function openApp(page) {
    await page.goto('index.html');
    await waitAppReady(page);
}

async function reloadApp(page) {
    await page.reload();
    await waitAppReady(page);
}

const readSyncConfig = (page) => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
}, SYNC_KEY);

/** 案内の「保存先を選ぶ」→「この端末のフォルダ」→「フォルダを選ぶ」と押し、つながったと画面で分かるまで待つ。 */
async function connectFolderFromWelcome(page) {
    await welcomeSyncBtn(page).click();
    await expect(methodSelect(page)).toBeVisible();
    await methodSelect(page).selectOption('local');
    await page.locator('#obsidian-sync-btn').click();
    await expect(syncPath(page)).toHaveText(FOLDER);
    await expect(syncStatus(page)).toContainText('同期済み');
}

/** 案内の手順1のボタンから設定を開き、つないだフォルダが「この端末のフォルダ」として見えることを確かめる。 */
async function expectSettingsShowConnectedFolder(page) {
    await welcomeSyncBtn(page).click();
    await expect(methodSelect(page)).toBeVisible();
    await expect(syncPath(page)).toHaveText(FOLDER);
    await expect(syncStatus(page)).toContainText('同期済み');
    await expect.soft(methodSelect(page)).toHaveValue('local');
}

test('初回に設定画面からフォルダをつなぐと、保存先の設定が local で保存され、案内と設定の表示がつないだフォルダと一致する', async ({ page }) => {
    await mockFolderPicker(page, FOLDER);
    await openApp(page);
    expect(await readSyncConfig(page)).toBeNull();

    await connectFolderFromWelcome(page);
    expect.soft((await readSyncConfig(page))?.method ?? null, '保存先の設定 (bookshelf_sync) の method').toBe('local');

    await page.keyboard.press('Escape');
    await expect(methodSelect(page)).toBeHidden();
    await expect.soft(welcomeSyncBtn(page)).toHaveText('設定済み');

    await reloadApp(page);
    await expect(welcomeSyncBtn(page)).toBeVisible();
    await expectSettingsShowConnectedFolder(page);
});

test('修正前にフォルダをつないだ人 (フォルダは残り、保存先の設定だけが無い) も、再読込で案内と設定の表示がフォルダに戻る', async ({ page }) => {
    await mockFolderPicker(page, FOLDER);
    await openApp(page);
    await connectFolderFromWelcome(page);
    await page.keyboard.press('Escape');
    await expect(methodSelect(page)).toBeHidden();

    // 修正前につないだ人の状態を作る: フォルダのハンドルは IndexedDB に残り、保存先の設定だけが無い
    await page.evaluate((key) => localStorage.removeItem(key), SYNC_KEY);
    await reloadApp(page);
    await expect(syncStatus(page)).toContainText('同期済み');

    expect.soft((await readSyncConfig(page))?.method ?? null, '再読込後の保存先の設定 (bookshelf_sync) の method').toBe('local');
    await expect.soft(welcomeSyncBtn(page)).toHaveText('設定済み');
    await expectSettingsShowConnectedFolder(page);
});

for (const method of ['hub', 'github']) {
    test(`保存先を ${method} に決めた人は、ログインが切れてフォルダへ一時的に寄せた起動でも、保存先の設定の method が上書きされない`, async ({ page }) => {
        await mockFolderPicker(page, FOLDER);
        await openApp(page);
        await connectFolderFromWelcome(page);
        await page.keyboard.press('Escape');
        await expect(methodSelect(page)).toBeHidden();

        // フォルダのハンドルは IndexedDB に残したまま、保存先を ${method} (接続情報なし = 起動時はローカルへ一時的に寄せる) にする
        await page.evaluate(([key, m]) => localStorage.setItem(key, JSON.stringify({ method: m })), [SYNC_KEY, method]);
        await reloadApp(page);
        await expect(syncStatus(page)).toContainText('同期済み');

        expect((await readSyncConfig(page))?.method ?? null).toBe(method);
    });
}

test('何もつないでいない初回は、保存先セレクトの初期表示がハブで、保存先の設定も保存されない (ADR-056 追補2)', async ({ page }) => {
    await openApp(page);
    await expect(welcomeSyncBtn(page)).toHaveText('保存先を選ぶ');
    await welcomeSyncBtn(page).click();
    await expect(methodSelect(page)).toBeVisible();
    await expect(methodSelect(page)).toHaveValue('hub');

    await page.keyboard.press('Escape');
    await expect(methodSelect(page)).toBeHidden();
    await expect(welcomeSyncBtn(page)).toHaveText('保存先を選ぶ');
    expect(await readSyncConfig(page)).toBeNull();
});
