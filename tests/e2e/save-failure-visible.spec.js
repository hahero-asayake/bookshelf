// イシュー#603: 保存先 (ハブ/GitHub/ローカル) への書き込みが失敗した時に、画面に出ること。
// 見せ方は案B (docs: scripts/verify/603-step2-options.md・②承認 2026-11-14):
//   - 通信・時間切れ・書き込みの失敗はアプリが自動で再試行する。1回目の再試行で直れば何も出さない
//   - 再試行が尽きたら状態バーに原因別の文言と「再試行」を出す。次の保存・「再試行」で消える
//   - 直らない種類 (ログイン切れ・フォルダが見つからない等) は再試行せず、すぐ出す
//   - ネットにつながった時に再試行する
// 失敗は保存先の模擬 (tests/e2e/helpers/storage-fakes.js) で注入し、操作は画面からだけ行う。
// 再試行の間隔は E2E 用のフラグ (bookshelf.flag.syncRetryDelaysMs) で短くする。
import { test, expect } from './helpers/test-base.js';
import {
    installFakeHub, FAKE_HUB_BASE, installFakeGitHub, FAKE_GITHUB,
    installFakeLocalFolder, installLocalWriteFailures
} from './helpers/storage-fakes.js';
import { openSettingsByClick } from './helpers/settings.js';

test.use({ actionTimeout: 10_000 });

const shelfFile = (slug) => `private/bookshelves/${slug}.json`;

const remoteSlugs = async (remote) => {
    const meta = await remote.readJSON('private/bookshelves.json');
    return meta && Array.isArray(meta.bookshelves) ? meta.bookshelves.map((b) => b.slug) : [];
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

async function bootWithHub(page) {
    const hub = await installFakeHub(page);
    await page.addInitScript((apiBase) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'hub',
            hub: { apiBase, key: 'hk_test', uid: 'u1', email: 'save-failure@example.com' }
        }));
    }, FAKE_HUB_BASE);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => hub.has(shelfFile('all'))).toBe(true);
    return { remote: hub, inject: hub };
}

async function bootWithGitHub(page) {
    const gh = await installFakeGitHub(page);
    await page.addInitScript((cfg) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
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
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    });
    await page.goto('index.html');
    await openSettingsByClick(page, 'sync-section');
    await page.locator('#obsidian-sync-btn').click();
    await expect.poll(() => local.has(shelfFile('all'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    return { remote: local, inject };
}

const BACKENDS = [
    { name: 'Asayake ハブ', boot: bootWithHub, kind: 'network',
        message: 'Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。' },
    { name: 'GitHub', boot: bootWithGitHub, kind: 'network',
        message: 'GitHub に保存できませんでした。通信が戻ったら「再試行」を押してください。' },
    { name: 'ローカルフォルダ', boot: bootWithLocalFolder, kind: 'write',
        message: 'フォルダに保存できませんでした。「再試行」で直らないときは、設定からフォルダを選び直してください。' }
];

async function openTreeMenu(page, slug) {
    const tree = page.locator('#sidebar-bookshelf-tree');
    const allToggle = tree.locator('.tree-node[data-bookshelf-id="all"] .tree-toggle');
    await expect(allToggle).toBeVisible();
    if (await allToggle.getAttribute('title') === '展開') await allToggle.click();
    const node = tree.locator(`.tree-node[data-bookshelf-id="${slug}"]`);
    await expect(node).toBeVisible();
    await node.hover();
    await node.locator('.tree-more').click();
    await expect(page.locator('#tree-node-menu')).toBeVisible();
}

async function createShelf(page, remote, name) {
    const before = await remoteSlugs(remote);
    await page.locator('#sidebar-add-bookshelf').click();
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
    await page.locator('#bookshelf-name').fill(name);
    await page.locator('#save-bookshelf-form').click();
    await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
    let slug;
    await expect.poll(async () => {
        slug = (await remoteSlugs(remote)).find((s) => !before.includes(s));
        return slug || null;
    }).not.toBeNull();
    await expect.poll(() => remote.has(shelfFile(slug))).toBe(true);
    return slug;
}

async function renameShelf(page, slug, name) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="edit"]').click();
    await page.locator('#bookshelf-name').fill(name);
    await page.locator('#save-bookshelf-form').click();
    await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
}

async function deleteShelf(page, slug) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="delete"]').click();
    await confirmOk(page);
}

const remoteName = async (remote, slug) => ((await remote.readJSON(shelfFile(slug))) || {}).name || null;
const failureRow = (page) => page.locator('#app-status-bar [data-sync-failure]');
const warnRow = (page) => page.locator('#app-status-bar .status-warn[data-sync-failure]');

for (const { name, boot, kind, message } of BACKENDS) {
    test.describe(`保存の失敗が画面に出る: ${name} (イシュー#603)`, () => {
        test('1回目の自動の再試行で直る失敗は、何も出さずに保存される', async ({ page }) => {
            await retryDelays(page, [300, 300, 300]);
            const { remote, inject } = await boot(page);
            const keep = await createShelf(page, remote, '残す本棚');

            await inject.failNextWrites(1);
            await renameShelf(page, keep, '改名1');
            await expect.poll(() => inject.failuresLeft(), { timeout: 15_000, message: '保存が1回失敗する' }).toBe(0);
            await expect.poll(() => remoteName(remote, keep), { timeout: 15_000, message: '自動の再試行で届く' }).toBe('改名1');
            await expect(failureRow(page)).toHaveCount(0);
            await expect(page.locator('#app-status-bar')).toBeHidden();
        });

        test('再試行が尽きた失敗は状態バーに原因と「再試行」が出て、「再試行」・次の保存で消える (通常の保存と本棚の削除)', async ({ page }) => {
            await retryDelays(page, [300, 300, 300]);
            const { remote, inject } = await boot(page);
            const keep = await createShelf(page, remote, '残す本棚');
            const gone = await createShelf(page, remote, '消す本棚');

            // 通常の保存: 最初の1回＋自動の再試行3回が全部失敗する
            await inject.failNextWrites(4);
            await renameShelf(page, keep, '改名1');
            await expect(warnRow(page)).toBeVisible({ timeout: 15_000 });
            await expect(warnRow(page)).toHaveAttribute('data-sync-failure', kind);
            await expect(warnRow(page)).toContainText(message);
            expect(await remoteName(remote, keep), '失敗した保存は届いていない').toBe('残す本棚');
            // 「再試行」で保存され、表示が消える
            await warnRow(page).locator('[data-status-action="retry-sync"]').click();
            await expect.poll(() => remoteName(remote, keep), { timeout: 15_000 }).toBe('改名1');
            await expect(failureRow(page)).toHaveCount(0);

            // 本棚の削除: 同じく再試行が尽きると出る
            await inject.failNextWrites(4);
            await deleteShelf(page, gone);
            await expect(warnRow(page)).toBeVisible({ timeout: 15_000 });
            expect(await remote.has(shelfFile(gone)), '失敗した削除では消えない').toBe(true);
            // 次の保存 (別の操作) で、溜まっていた削除も届き、表示が消える
            await renameShelf(page, keep, '改名2');
            await expect.poll(() => remote.has(shelfFile(gone)), { timeout: 15_000 }).toBe(false);
            await expect(failureRow(page)).toHaveCount(0);
        });
    });
}

test('直らない種類の失敗 (ローカルのフォルダが見つからない) は、再試行せずにすぐ状態バーに出る (イシュー#603)', async ({ page }) => {
    await retryDelays(page, [60_000, 60_000, 60_000]);
    const { remote, inject } = await bootWithLocalFolder(page);
    const keep = await createShelf(page, remote, '残す本棚');

    await inject.failNextWrites(1, { error: 'NotFoundError' });
    await renameShelf(page, keep, '改名1');
    await expect(warnRow(page)).toBeVisible({ timeout: 10_000 });
    await expect(warnRow(page)).toHaveAttribute('data-sync-failure', 'folder-missing');
    await expect(warnRow(page)).toContainText('保存先のフォルダが見つからないため、保存できませんでした。');
    await expect(warnRow(page).locator('[data-status-action="retry-sync"]'), '直らない種類に「再試行」は出さない').toHaveCount(0);
    await expect(page.locator('#obsidian-sync-path')).toContainText('（要再接続）');
});

test('自動の再試行を待つ間にネットにつながったら、すぐ再試行して保存する (イシュー#603)', async ({ page }) => {
    await retryDelays(page, [60_000, 60_000, 60_000]);
    const { remote, inject } = await bootWithHub(page);
    const keep = await createShelf(page, remote, '残す本棚');

    await inject.failNextWrites(1);
    await renameShelf(page, keep, '改名1');
    await expect.poll(() => inject.failuresLeft(), { timeout: 15_000 }).toBe(0);
    await page.waitForTimeout(500);
    expect(await remoteName(remote, keep), '次の自動の再試行は60秒後＝まだ届かない').toBe('残す本棚');
    await expect(failureRow(page), '1回目の再試行を待つ間は出さない').toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => remoteName(remote, keep), { timeout: 10_000, message: 'つながった時の再試行で届く' }).toBe('改名1');
    await expect(failureRow(page)).toHaveCount(0);
});
