// イシュー#657: 設定の同期欄 (#obsidian-sync-status) に、ハブ・GitHub でも保存の状態の文が見えること。
// 決め (scripts/verify/657-results.md §6・②承認 2026-11-14):
//   - 状態の行は保存先セレクトのすぐ下の、3つの保存先に共通の1行 (案A・id は据え置き)
//   - 文は状態バーと同じ源 (js/sync-failure.js) から描き、「再試行」「選ぶ」も状態バーと同じボタンを同期欄に出す (文とボタンを組で)
//   - ローカルの保存失敗も、状態バーと同じ文にそろえる
// 判定は見えている要素の文で行う (toBeVisible と toContainText。隠れた要素の文では通さない)。操作は画面からだけ行う。
import { test, expect } from './helpers/test-base.js';
import {
    createHubStateForTest, seedHubLoginForTest, mockHubForTest, hubStoreForTest,
    seedHubDataForTest, waitForHubStartupForTest, waitForHubFileContainsForTest, HUB_BASE
} from './helpers/gate-hub.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from './helpers/gate-device.js';
import { installFakeGitHub, FAKE_GITHUB, installFakeLocalFolder, installLocalWriteFailures } from './helpers/storage-fakes.js';
import { openSettingsByClick } from './helpers/settings.js';

test.use({ actionTimeout: 10_000 });

const ASIN_A = 'B065700001';
const ASIN_B = 'B065700002';
const ASIN_C = 'B065700003';
const LOAD_HOLD = '保存先とこの端末の両方が変わっているため、保存先へ保存していません。';
const SYNC_HOLD = '別の端末で保存先が更新されたため、保存先へ保存していません。';

const shelfFile = (slug) => `private/bookshelves/${slug}.json`;
const remoteAsins = async (remote) => {
    const lib = await remote.readJSON('private/library.json');
    return lib && Array.isArray(lib.books) ? lib.books.map((b) => b.asin) : [];
};
const confirmOk = async (page) => {
    const cfm = page.locator('.cfm-overlay');
    await cfm.waitFor({ state: 'visible' });
    await cfm.locator('.cfm-ok').click();
    await cfm.waitFor({ state: 'hidden' });
};
const retryDelays = (page, delays) => page.addInitScript((d) => {
    localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', d);
}, JSON.stringify(delays));

const syncLine = (page) => page.locator('#obsidian-sync-status');
const syncButton = (page, action) => page.locator(`#sync-section [data-status-action="${action}"]`);
const warnRow = (page) => page.locator('#app-status-bar .status-warn[data-sync-failure]');

async function openSync(page) {
    await openSettingsByClick(page, 'sync-section');
    await expect(page.locator('#sync-section')).toBeVisible();
}
async function closeSettings(page) {
    const modal = page.locator('#settings-modal');
    await page.keyboard.press('Escape');
    if (await modal.isVisible()) await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
}

async function bootWithHub(page) {
    const state = createHubStateForTest({ usedBytes: 0, email: 'sync-section@example.com' });
    await seedHubLoginForTest(page, state, { method: 'hub', library: false });
    await mockHubForTest(page, state);
    const hub = hubStoreForTest(state);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => hub.has(shelfFile('all'))).toBe(true);
    return { remote: hub, inject: hub };
}
async function bootWithGitHub(page) {
    const gh = await installFakeGitHub(page);
    await page.addInitScript((cfg) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github', methodChosen: true,
            github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, basePath: '', token: 'ght_test' }
        }));
    }, FAKE_GITHUB);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => gh.has(shelfFile('all'))).toBe(true);
    return { remote: gh, inject: gh };
}
async function bootWithLocalFolder(page) {
    const inject = await installLocalWriteFailures(page);
    const local = await installFakeLocalFolder(page);
    await page.addInitScript(() => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true }));
    });
    await page.goto('index.html');
    await openSync(page);
    await page.locator('#obsidian-sync-btn').click();
    await expect.poll(() => local.has(shelfFile('all'))).toBe(true);
    await closeSettings(page);
    return { remote: local, inject };
}

async function addBook(page, asin, title) {
    await openSettingsByClick(page, 'library-section');
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(asin);
    await page.locator('#manual-title').fill(title);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    if (await page.locator('#settings-modal').isVisible()) await closeSettings(page);
    await page.waitForFunction((a) => {
        const lib = JSON.parse(localStorage.getItem('virtualBookshelf_library') || '{}');
        return (lib.books || []).some((b) => b.asin === a);
    }, asin);
}

const CLOUD = [
    { name: 'Asayake ハブ', boot: bootWithHub,
        message: 'Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。' },
    { name: 'GitHub', boot: bootWithGitHub,
        message: 'GitHub に保存できませんでした。通信が戻ったら「再試行」を押してください。' }
];

for (const { name, boot, message } of CLOUD) {
    test.describe(`同期欄に保存の状態が見える: ${name} (イシュー#657)`, () => {
        test('正常: 保存の後、同期欄に「保存済み」が見える', async ({ page }) => {
            const { remote } = await boot(page);
            await addBook(page, ASIN_A, '保存できる間に足した本');
            await expect.poll(() => remoteAsins(remote)).toContain(ASIN_A);
            await openSync(page);
            await expect(syncLine(page), '同期欄の状態の行が見える').toBeVisible();
            await expect(syncLine(page)).toContainText('保存済み');
            await expect(syncButton(page, 'retry-sync'), '正常の時は「再試行」を出さない').toHaveCount(0);
        });

        test('保存失敗: 再試行が尽きた後、同期欄に状態バーと同じ文と「再試行」が見え、押すと保存されて正常に戻る', async ({ page }) => {
            await retryDelays(page, [300, 300, 300]);
            const { remote, inject } = await boot(page);
            await addBook(page, ASIN_A, '保存できる間に足した本');
            await expect.poll(() => remoteAsins(remote)).toContain(ASIN_A);
            // 最初の1回＋自動の再試行3回が全部失敗する
            await inject.failNextWrites(4);
            await addBook(page, ASIN_B, '保存できない間に足した本');
            await expect(warnRow(page)).toBeVisible({ timeout: 15_000 });
            await expect(warnRow(page)).toContainText(message);

            await openSync(page);
            await expect(syncLine(page), '同期欄の状態の行が見える').toBeVisible();
            await expect(syncLine(page), '状態バーと同じ文').toContainText(message);
            await expect(syncLine(page)).not.toContainText('保存済み');
            const retry = syncButton(page, 'retry-sync');
            await expect(retry, '同期欄に「再試行」が見える').toBeVisible();
            await retry.click();
            // 状態バーの「再試行」と同じ結果: 保存されて、失敗の表示が消え、同期欄は正常の文に戻る
            await expect.poll(() => remoteAsins(remote), { timeout: 15_000 }).toContain(ASIN_B);
            await expect(syncLine(page)).toContainText('保存済み');
            await expect(syncButton(page, 'retry-sync')).toHaveCount(0);
            await expect(page.locator('#app-status-bar [data-sync-failure]')).toHaveCount(0);
        });
    });
}

// ===== 未保存 (読込時の3択・load-conflict) =====
const failWrites = async (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.fallback();
    return route.fulfill({ status: 503, body: 'offline (e2e)' });
};
function otherDeviceUpdateHub(state) {
    const lib = JSON.parse(state.files.get('private/library.json').content);
    lib.books.push({ asin: ASIN_C, title: '他の端末で足した本', authors: '', acquiredTime: Date.now(), readStatus: 'UNKNOWN', productImage: '', source: 'manual_add', addedDate: Date.now() });
    lib.exportDate = new Date(Date.now() + 1000).toISOString();
    state.seq += 1;
    state.files.set('private/library.json', { content: JSON.stringify(lib), etag: `"v${state.seq}"` });
}

test.describe('同期欄に保存の状態が見える: Asayake ハブの未保存 (イシュー#657)', () => {
    test('読込時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、選ぶと正常に戻る', async ({ page }) => {
        const state = createHubStateForTest({ usedBytes: 0, email: 'sync-section-load@example.com' });
        await mockHubForTest(page, state);
        const store = hubStoreForTest(state);
        const cfg = {
            method: 'hub', methodChosen: true,
            hub: { apiBase: HUB_BASE, key: state.key, uid: state.uid, siteId: state.siteId, email: state.email, plan: state.plan }
        };
        // 入れるのはこのタブで最初の1回だけ (再読込のたびに入れ直すとアプリが書いた設定を上書きする・#639 と同じ)
        await page.addInitScript((c) => {
            if (sessionStorage.getItem('sssSeeded')) return;
            sessionStorage.setItem('sssSeeded', '1');
            localStorage.setItem('bookshelf_sync', JSON.stringify(c));
        }, cfg);
        await page.goto('index.html');
        await confirmOk(page);
        await expect.poll(() => store.has(shelfFile('all'))).toBe(true);
        await addBook(page, ASIN_A, '書ける間に足した本');
        await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync'))).toBeNull();

        // 書き込みだけ失敗させて編集し (未反映の印が立つ)、他の端末の更新を入れてから読み直す
        await page.route(`${HUB_BASE}/**`, failWrites);
        await addBook(page, ASIN_B, '書けない間に足した本');
        await page.waitForTimeout(2000);
        otherDeviceUpdateHub(state);
        await page.unroute(`${HUB_BASE}/**`, failWrites);
        await page.reload();
        const dlg = page.locator('#load-conflict-dialog');
        await expect(dlg).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        await expect(page.locator('#app-status-bar [data-sync-failure="load-conflict"]')).toBeVisible();

        await openSync(page);
        await expect(syncLine(page), '同期欄の状態の行が見える').toBeVisible();
        await expect(syncLine(page), '状態バーと同じ文').toContainText(LOAD_HOLD);
        const choose = syncButton(page, 'resolve-hold');
        await expect(choose, '同期欄に「選ぶ」が見える').toBeVisible();
        // 状態バーの「選ぶ」と同じ結果: 3択が開き直る
        await choose.click();
        await expect(dlg).toBeVisible();
        await dlg.locator('.cfm-remote').click();
        await expect(dlg).toBeHidden();
        await expect(page.locator('#app-status-bar [data-sync-failure]')).toHaveCount(0);
        if (!(await page.locator('#settings-modal').isVisible())) await openSync(page);
        await expect(syncLine(page)).toBeVisible();
        await expect(syncLine(page), '選んだ後は正常の文に戻る').toContainText('保存済み');
        await expect(syncButton(page, 'resolve-hold')).toHaveCount(0);
    });

    test('書き込み時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、選ぶと正常に戻る', async ({ page }) => {
        const BOOK = 'フィクスチャの本 1';
        const bookButton = (p) => p.getByRole('button', { name: BOOK, exact: true }).first();
        const memoBox = (p) => p.locator('.note-textarea[data-scope="all"]:visible').first();
        const savedNote = (p) => p.locator('.save-note-status:visible').first();
        const hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
        const other = await prepareOtherDeviceForTest(page, hub);
        try {
            await other.goto('index.html');
            await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
            await expect(bookButton(other)).toBeVisible();
            await bookButton(page).click();
            await memoBox(page).fill('端末Aが先に書いたメモ');
            await expect(savedNote(page)).toContainText('保存しました');
            await waitForHubFileContainsForTest(hub, 'private/notes.json', '端末Aが先に書いたメモ');
            await bookButton(other).click();
            await memoBox(other).fill('端末Bが古い版のまま書いたメモ');
            await expect(savedNote(other)).toContainText('保存しました');
            const dlg = other.locator('#sync-conflict-dialog');
            await expect(dlg).toBeVisible({ timeout: 20000 });
            await other.keyboard.press('Escape');
            await expect(dlg).toBeHidden();
            await expect(other.locator('#app-status-bar [data-sync-failure="sync-conflict"]')).toBeVisible();
            // スマホ幅では本の詳細が前に残るので、詳細の「戻る」で閉じてから設定を開く
            const detailBack = other.locator('#mobile-detail-back');
            if (await detailBack.isVisible()) { await detailBack.click(); await other.waitForTimeout(800); }

            await openSync(other);
            await expect(syncLine(other), '同期欄の状態の行が見える').toBeVisible();
            await expect(syncLine(other), '状態バーと同じ文').toContainText(SYNC_HOLD);
            const choose = syncButton(other, 'resolve-hold');
            await expect(choose, '同期欄に「選ぶ」が見える').toBeVisible();
            await choose.click();
            await expect(dlg).toBeVisible();
            await dlg.locator('.cfm-remote').click();
            // 「保存先の内容を読み込む」は読み直す (再読込)。読み直した後は正常の文
            await other.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
            await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
            await expect(other.locator('#app-status-bar [data-sync-failure]')).toHaveCount(0);
            await openSync(other);
            await expect(syncLine(other)).toBeVisible();
            await expect(syncLine(other), '選んだ後は正常の文に戻る').toContainText('保存済み');
        } finally {
            await closeOtherDeviceForTest(other);
        }
    });
});

// ===== ローカル: 同じ状態で同じ文・同じ種類になる (依頼の「ローカルと食い違わないこと」) =====
test.describe('同期欄に保存の状態が見える: ローカルフォルダ (イシュー#657)', () => {
    // ローカルフォルダは PC の Chrome/Edge だけで選べる (ADR-046)。iPhone 相当 (webkit) では流さない
    test.skip(({ browserName }) => browserName === 'webkit', 'ローカルフォルダは PC の Chrome/Edge だけ (ADR-046)');

    test('正常: 保存の後、同期欄に「同期済み」が見える', async ({ page }) => {
        const { remote } = await bootWithLocalFolder(page);
        await addBook(page, ASIN_A, '保存できる間に足した本');
        await expect.poll(() => remoteAsins(remote)).toContain(ASIN_A);
        await openSync(page);
        await expect(syncLine(page)).toBeVisible();
        await expect(syncLine(page)).toContainText('同期済み');
        await expect(syncButton(page, 'retry-sync')).toHaveCount(0);
    });

    test('保存失敗: 再試行が尽きた後、同期欄に状態バーと同じ文と「再試行」が見え、押すと保存されて正常に戻る', async ({ page }) => {
        await retryDelays(page, [300, 300, 300]);
        const { remote, inject } = await bootWithLocalFolder(page);
        await addBook(page, ASIN_A, '保存できる間に足した本');
        await expect.poll(() => remoteAsins(remote)).toContain(ASIN_A);
        const message = 'フォルダに保存できませんでした。「再試行」で直らないときは、設定からフォルダを選び直してください。';
        await inject.failNextWrites(4);
        await addBook(page, ASIN_B, '保存できない間に足した本');
        await expect(warnRow(page)).toBeVisible({ timeout: 15_000 });
        await expect(warnRow(page)).toContainText(message);

        await openSync(page);
        await expect(syncLine(page)).toBeVisible();
        await expect(syncLine(page), '状態バーと同じ文 (ローカルもそろえる)').toContainText(message);
        const retry = syncButton(page, 'retry-sync');
        await expect(retry, '同期欄に「再試行」が見える').toBeVisible();
        await retry.click();
        await expect.poll(() => remoteAsins(remote), { timeout: 15_000 }).toContain(ASIN_B);
        await expect(syncLine(page)).toContainText('同期済み');
        await expect(page.locator('#app-status-bar [data-sync-failure]')).toHaveCount(0);
    });
});
