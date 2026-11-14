// 空の保存先を初めて使う時、初期化の確認が出てから読込が終わるまで、状態の欄 (#obsidian-sync-status) に
// 「保存できませんでした」が出ないこと (イシュー#648)。
//
// 直す前 (98de66d) は、ハブ・GitHub で保存先が空と分かると、確認を出す前に失敗の扱いで状態の欄を書いていた
// (js/bookshelf.js initCloudSync/initGitHubSync の updateSyncStatus('reconnect', '… (空)'))。読込が終わって
// 「保存済み」になるまで「保存できませんでした」が残る。ふだんは欄ごと隠れているが、保存先セレクトを
// 「この端末のフォルダ」に切り替えた時の確認の幕の後ろで見える (scripts/verify/648-results.md step1)。
// 直した後は、確認の待ち・初期化中は「読み込み中...」、読込の後は「保存済み」。確認でキャンセルした時だけ、
// 今までどおり「保存できませんでした」と「(空)（要再接続）」を出す。
//
// 状態の欄の文字は MutationObserver で全部集める (一定の間隔の読み取りだと、短い間の表示を落とす)。
// 集めるのはアプリを開いてから読込が終わるまで (確認が出た時の文字も入る)。アプリの内部は読まない。
// 時機の作り方: 初期化の書き込みを、確かめ終わるまで止める (ハブ・GitHub は page.route、ローカルは
// FileSystemFileHandle.createWritable を包む)。機械の速さによらず「初期化中」を作れる。
import { test, expect } from './helpers/test-base.js';
import { createHubStateForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { installFakeGitHub, installFakeLocalFolder, FAKE_GITHUB } from './helpers/storage-fakes.js';
import { openSettingsByClick } from './helpers/settings.js';

test.use({ viewport: { width: 1280, height: 800 } });

const SAVE_FAILED = '保存できませんでした';
const LOADING = '読み込み中...';
const GITHUB_LABEL = `${FAKE_GITHUB.owner}/${FAKE_GITHUB.repo}@${FAKE_GITHUB.branch}`;

const syncStatus = (page) => page.locator('#obsidian-sync-status');
const syncPath = (page) => page.locator('#obsidian-sync-path');
const initDialog = (page) => page.locator('.cfm-overlay', { hasText: '初期化しますか' });

/** 状態の欄の文字が変わるたびに、ページの中の配列へ残す。アプリを開く前に呼ぶ。 */
async function recordSyncStatusForTest(page) {
    await page.addInitScript(() => {
        if (window.__syncStatusTexts) return;
        const texts = window.__syncStatusTexts = [];
        let last = null;
        const read = () => {
            const el = document.getElementById('obsidian-sync-status');
            const text = el ? el.textContent : null;
            if (text !== null && text !== last) {
                last = text;
                texts.push(text);
            }
        };
        const start = () => {
            read();
            new MutationObserver(read).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    });
}

const syncStatusTexts = (page) => page.evaluate(() => window.__syncStatusTexts || []);

/** url への書き込み (GET 以外) を、release() を呼ぶまで止める。止めた後は先に取り付けた模擬へ回す。 */
async function holdWritesForTest(page, url) {
    let release = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    const held = { count: 0 };
    await page.route(url, async (route) => {
        const method = route.request().method();
        if (method !== 'GET' && method !== 'HEAD') {
            held.count += 1;
            await gate;
        }
        return route.fallback();
    });
    return { held, release };
}

/** 集めた文字の並びに「保存できませんでした」が無く、「読み込み中...」の後に done が出たこと */
function expectLoadingThenDone(texts, done, label) {
    const seq = JSON.stringify(texts);
    expect(texts.filter((t) => t.includes(SAVE_FAILED)), `${label}: 状態の欄の文字の並び ${seq}`).toEqual([]);
    const iLoading = texts.indexOf(LOADING);
    const iDone = texts.findIndex((t) => t.includes(done));
    expect(iLoading, `${label}: 「${LOADING}」が出た ${seq}`).toBeGreaterThanOrEqual(0);
    expect(iDone, `${label}: 「${LOADING}」の後に「${done}」が出た ${seq}`).toBeGreaterThan(iLoading);
}

async function bootEmptyHub(page) {
    const hub = createHubStateForTest();
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false }); // 端末に蔵書なし・保存先はハブ
    await mockHubForTest(page, hub);                                          // ハブは空 (ファイル0件)
    return hub;
}

async function bootEmptyGitHub(page) {
    await installFakeGitHub(page); // リポジトリは空 (ファイル0件)
    await page.addInitScript((cfg) => {
        if (sessionStorage.getItem('firstRunInitStatusSeeded')) return;
        sessionStorage.setItem('firstRunInitStatusSeeded', '1');
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
            github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, basePath: '', token: 'ght_test' }
        }));
    }, FAKE_GITHUB);
}

for (const target of [
    { name: 'ハブ', boot: bootEmptyHub, writes: 'https://mockhub.test/data/**' },
    { name: 'GitHub', boot: bootEmptyGitHub, writes: 'https://api.github.com/**' }
]) {
    test(`${target.name}: 空の保存先を初期化する間、状態の欄は「読み込み中...」で、読込の後に「保存済み」になり、「保存できませんでした」は出ない`, async ({ page }) => {
        test.setTimeout(90_000);
        await recordSyncStatusForTest(page);
        await target.boot(page);
        const writes = await holdWritesForTest(page, target.writes);
        await bootAppForTest(page);

        await expect(initDialog(page)).toBeVisible({ timeout: 15_000 });
        // 確認を待っている間 (欄はふだん隠れているので、文字だけを見る)
        await expect.soft(syncStatus(page), '確認を待っている間').toHaveText(LOADING);
        await initDialog(page).locator('.cfm-ok').click();
        await expect(initDialog(page)).toBeHidden();
        // 初期化の書き込みが始まって止まっている = 初期化中
        await expect.poll(() => writes.held.count).toBeGreaterThan(0);
        await expect.soft(syncStatus(page), '初期化中').toHaveText(LOADING);
        writes.release();

        // 読込が終わる (読み込み中の覆いが消える) と「保存済み」
        await waitForHubStartupForTest(page);
        await expect(syncStatus(page)).toContainText('保存済み');
        expectLoadingThenDone(await syncStatusTexts(page), '保存済み', target.name);
    });

    test(`${target.name}: 初期化の確認でキャンセルした後は、今までどおり「保存できませんでした」と「(空)（要再接続）」を出す`, async ({ page }) => {
        test.setTimeout(90_000);
        await target.boot(page);
        await bootAppForTest(page);

        await expect(initDialog(page)).toBeVisible({ timeout: 15_000 });
        await initDialog(page).locator('.cfm-cancel').click();
        await expect(initDialog(page)).toBeHidden();
        await expect(syncStatus(page)).toHaveText(SAVE_FAILED);
        await expect(syncPath(page)).toHaveText(`${target.name === 'ハブ' ? 'Asayake ハブ' : GITHUB_LABEL} (空)（要再接続）`);
        if (target.name === 'ハブ') {
            // ハブは状態バーにも、初期化していないことを出す (今までどおり)
            await expect(page.locator('#app-status-bar')).toContainText('Asayake ハブ は空です。初期化していません。');
        }
    });
}

test('ハブ: 初期化の途中で保存先を「この端末のフォルダ」に切り替えた時、確認の幕の後ろに見える状態の欄に「保存できませんでした」が出ない', async ({ page }) => {
    test.setTimeout(90_000);
    await recordSyncStatusForTest(page);
    await bootEmptyHub(page);
    const writes = await holdWritesForTest(page, 'https://mockhub.test/data/**');
    await bootAppForTest(page);

    await expect(initDialog(page)).toBeVisible({ timeout: 15_000 });
    await initDialog(page).locator('.cfm-ok').click();
    await expect(initDialog(page)).toBeHidden();
    await expect.poll(() => writes.held.count).toBeGreaterThan(0);

    try {
        // 設定 → 同期 → 保存先セレクトを「この端末のフォルダ」にすると、切替の確認が出て、その後ろにローカルの欄が出る
        await openSettingsByClick(page, 'sync-section');
        await page.locator('#sync-method-select').selectOption('local');
        const switchDialog = page.locator('.cfm-overlay', { hasText: '切り替えますか' });
        await expect(switchDialog).toBeVisible();
        await expect(syncStatus(page)).toBeVisible();
        await expect(syncStatus(page)).not.toContainText(SAVE_FAILED);
        await expect(syncStatus(page)).toHaveText(LOADING);
        // 切り替えない (ハブのまま)
        await switchDialog.locator('.cfm-cancel').click();
        await expect(switchDialog).toBeHidden();
    } finally {
        writes.release();
    }

    await waitForHubStartupForTest(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    expectLoadingThenDone(await syncStatusTexts(page), '保存済み', 'ハブ・切替');
});

test('ローカルのフォルダ: 空のフォルダを選んで初期化する間、状態の欄は「読み込み中...」で、読込の後に「同期済み」になり、「保存できませんでした」は出ない', async ({ page }) => {
    test.setTimeout(90_000);
    await recordSyncStatusForTest(page);
    await installFakeLocalFolder(page, { dirName: 'first-run-init-status' });
    // 初期化の書き込み (フォルダのファイルを書く口 createWritable) を、確かめ終わるまで止める
    await page.addInitScript(() => {
        if (window.__localWritesHeld !== undefined) return;
        window.__localWritesHeld = 0;
        const gate = new Promise((resolve) => { window.__releaseLocalWrites = resolve; });
        const createWritable = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = async function (...args) {
            window.__localWritesHeld += 1;
            await gate;
            return createWritable.apply(this, args);
        };
    });
    await bootAppForTest(page);

    // 初めての人の流れ (gate/j1-3 と同じ): 案内の「保存先を選ぶ」→「この端末のフォルダ」→「フォルダを選ぶ」
    await page.locator('#dashboard-welcome button[data-dw="sync"]').click();
    await expect(page.locator('#sync-method-select')).toBeVisible();
    await page.locator('#sync-method-select').selectOption('local');
    await page.locator('#obsidian-sync-btn').click();
    await expect.poll(() => page.evaluate(() => window.__localWritesHeld)).toBeGreaterThan(0);
    await expect.soft(syncStatus(page), '初期化中').toHaveText(LOADING);
    await page.evaluate(() => window.__releaseLocalWrites());

    await expect(syncStatus(page)).toContainText('同期済み', { timeout: 30_000 });
    expectLoadingThenDone(await syncStatusTexts(page), '同期済み', 'ローカルのフォルダ');
});
