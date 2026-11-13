// イシュー#587: 本棚を削除したら、保存先からも本棚ごとのファイル (private/bookshelves/<slug>.json) が
// 消えること。消えるはずのデータが保存先に残り続けないことを、保存先ごとに確かめる回帰テスト
// (門の E2E には数えない。確認の対象が画面ではなく保存先の中身のため)。
//
// 関数の直呼びでは「画面の削除 → 保存 → 保存先」の経路が切れていても通ってしまうので、
// 画面の操作 (ツリーの「…」メニュー → 削除 → 確認ダイアログ) だけで行い、保存先の模擬
// (tests/e2e/helpers/storage-fakes.js・状態は Node 側) に残ったファイルを見る。
// 本棚も画面から作る＝保存先のファイルはアプリ自身が書いた形のまま。
import { test, expect } from './helpers/test-base.js';
import { installFakeHub, FAKE_HUB_BASE, installFakeGitHub, FAKE_GITHUB, installFakeLocalFolder } from './helpers/storage-fakes.js';
import { openSettingsByClick } from './helpers/settings.js';

// 画面の操作が詰まった時に、テスト全体の制限時間 (60秒) まで待たずに落とす
test.use({ actionTimeout: 10_000 });

const shelfFile = (slug) => `private/bookshelves/${slug}.json`;

// 保存先の本棚一覧 (private/bookshelves.json) にある slug。「削除後の保存が保存先まで届いたか」の目印に使う
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

/** ハブ接続済みで起動する。空のハブでは「新規データで初期化しますか？」が出るので OK で進める */
async function bootWithHub(page) {
    const hub = await installFakeHub(page);
    await page.addInitScript((apiBase) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'hub',
            hub: { apiBase, key: 'hk_test', uid: 'u1', email: 'shelf-delete@example.com' }
        }));
    }, FAKE_HUB_BASE);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => hub.has(shelfFile('all'))).toBe(true);
    return hub;
}

/** GitHub 接続済みで起動する。空のリポジトリでは「新規データで初期化しますか？」が出るので OK で進める */
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
    return gh;
}

/** この端末のフォルダに保存: 設定 → 同期 →「フォルダを選ぶ」で、模擬のフォルダに繋いでから始める */
async function bootWithLocalFolder(page) {
    const local = await installFakeLocalFolder(page);
    await page.addInitScript(() => {
        // 保存先を「この端末のフォルダ」に決めた人 (決めた印つき・イシュー#596。印の無い local は設定がハブを見せる)
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true }));
    });
    await page.goto('index.html');
    await openSettingsByClick(page, 'sync-section');
    await page.locator('#obsidian-sync-btn').click();
    await expect.poll(() => local.has(shelfFile('all')), { message: '選んだフォルダが初期化される' }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    return local;
}

// 保存先ごとに同じ3ケースを流す
const BACKENDS = [
    { name: 'Asayake ハブ', boot: bootWithHub },
    { name: 'GitHub', boot: bootWithGitHub },
    { name: 'ローカルフォルダ', boot: bootWithLocalFolder }
];

/** ツリーの本棚の「…」メニューを開く */
async function openTreeMenu(page, slug) {
    const tree = page.locator('#sidebar-bookshelf-tree');
    // 最上位の「すべての本」は初めは畳まれていて、子の本棚が出ていない → 畳まれていれば展開する
    const allToggle = tree.locator('.tree-node[data-bookshelf-id="all"] .tree-toggle');
    await expect(allToggle).toBeVisible();
    if (await allToggle.getAttribute('title') === '展開') await allToggle.click();
    const node = tree.locator(`.tree-node[data-bookshelf-id="${slug}"]`);
    await expect(node).toBeVisible();
    await node.hover();
    await node.locator('.tree-more').click();
    await expect(page.locator('#tree-node-menu')).toBeVisible();
}

/** 画面から本棚を作り、保存先に本棚ファイルが届くまで待つ。作られた slug を返す */
async function createShelf(page, remote, name, { parentSlug } = {}) {
    const before = await remoteSlugs(remote);
    if (parentSlug) {
        await openTreeMenu(page, parentSlug);
        await page.locator('#tree-node-menu [data-act="add-child"]').click();
    } else {
        await page.locator('#sidebar-add-bookshelf').click();
    }
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
    await page.locator('#bookshelf-name').fill(name);
    await page.locator('#save-bookshelf-form').click();
    await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
    let slug;
    await expect.poll(async () => {
        slug = (await remoteSlugs(remote)).find((s) => !before.includes(s));
        return slug || null;
    }, { message: `本棚「${name}」が保存先の一覧に届く` }).not.toBeNull();
    await expect.poll(() => remote.has(shelfFile(slug)), { message: `${shelfFile(slug)} が保存先に書かれる` }).toBe(true);
    return slug;
}

/** 画面から本棚を削除する (ツリーの「…」→ 削除 → 確認ダイアログで「削除する」) */
async function deleteShelf(page, slug) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="delete"]').click();
    await confirmOk(page);
}

/** 保存先に届いた削除要求を結果に添付する (落ちた時に「削除が出ていないのか、出たが効かなかったのか」を見分ける) */
async function attachDeleteRequests(remote) {
    await test.info().attach('保存先に届いた削除要求', {
        body: JSON.stringify(remote.deleteRequests, null, 2),
        contentType: 'application/json'
    });
}

for (const { name, boot } of BACKENDS) {
    test.describe(`本棚の削除で保存先の本棚ファイルも消える: ${name} (イシュー#587)`, () => {
        test('本棚を1つ削除すると、保存先からその本棚のファイルが消える', async ({ page }) => {
            const remote = await boot(page);
            const slug = await createShelf(page, remote, '消す本棚');

            await deleteShelf(page, slug);

            // 削除後の保存が保存先まで届いた (一覧から消えた) のを先に待つ
            await expect.poll(() => remoteSlugs(remote), { message: '削除後の一覧が保存先に届く' }).not.toContain(slug);
            try {
                await expect.poll(() => remote.has(shelfFile(slug)), {
                    timeout: 8000,
                    message: `削除した本棚のファイル ${shelfFile(slug)} が保存先に残っていない`
                }).toBe(false);
            } finally {
                await attachDeleteRequests(remote);
            }
        });

        test('子を持つ本棚を削除すると、親と子の両方のファイルが保存先から消える', async ({ page }) => {
            const remote = await boot(page);
            const parent = await createShelf(page, remote, '親の本棚');
            const child = await createShelf(page, remote, '子の本棚', { parentSlug: parent });

            await deleteShelf(page, parent); // 子もまとめて消える (確認ダイアログに子の名前が出る)

            await expect.poll(() => remoteSlugs(remote), { message: '削除後の一覧が保存先に届く' }).toEqual(['all']);
            try {
                await expect.poll(async () => {
                    const left = [];
                    for (const s of [parent, child]) if (await remote.has(shelfFile(s))) left.push(s);
                    return left;
                }, {
                    timeout: 8000,
                    message: '削除した親と子の本棚ファイルが保存先に残っていない'
                }).toEqual([]);
            } finally {
                await attachDeleteRequests(remote);
            }
        });

        test('本棚の名前を変えても、保存先の本棚ファイルは同じ1つのまま (古いファイルが残らない)', async ({ page }) => {
            const remote = await boot(page);
            const slug = await createShelf(page, remote, '改名前');

            await openTreeMenu(page, slug);
            await page.locator('#tree-node-menu [data-act="edit"]').click();
            await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
            await page.locator('#bookshelf-name').fill('改名後');
            await page.locator('#save-bookshelf-form').click();
            await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);

            await expect.poll(async () => ((await remote.readJSON(shelfFile(slug))) || {}).name, { message: '新しい名前が保存先に届く' }).toBe('改名後');
            expect(await remote.list('private/bookshelves')).toEqual(['all.json', `${slug}.json`]);
        });
    });
}

// 保存の失敗を注入できる保存先 (ハブ・GitHub) だけで流す
for (const { name, boot } of BACKENDS.filter((b) => b.name !== 'ローカルフォルダ')) {
    test.describe(`本棚ファイルの削除待ち: ${name} (イシュー#587)`, () => {
        test('削除の保存が一度失敗しても、次の保存で本棚ファイルが消える', async ({ page }) => {
            const remote = await boot(page);
            const keeper = await createShelf(page, remote, '残す本棚');
            const slug = await createShelf(page, remote, '失敗する削除');

            remote.failNextWrites(1);
            await deleteShelf(page, slug);
            await expect.poll(() => remote.failuresLeft(), { message: '削除後の保存が失敗する' }).toBe(0);
            await page.waitForTimeout(1500); // 失敗の後始末 (表示の更新) を待つ
            expect(remote.has(shelfFile(slug)), '失敗した保存では消えない').toBe(true);
            // 失敗の直後は、自動の再試行 (1回目は5秒後) を待つ間なので状態バーには出さない (イシュー#603 案B)。
            // 再試行が尽きた時に出ることは tests/e2e/save-failure-visible.spec.js で確かめる
            await expect(page.locator('#app-status-bar [data-sync-failure]')).toHaveCount(0);

            // 次の保存 (別の操作＝残す本棚の名前を変える) で消える。新しく本棚を作ると、空いた slug が
            // 再利用されて「作り直し」になるので、ここでは使わない
            await openTreeMenu(page, keeper);
            await page.locator('#tree-node-menu [data-act="edit"]').click();
            await page.locator('#bookshelf-name').fill('残す本棚 (改名)');
            await page.locator('#save-bookshelf-form').click();
            await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
            await expect.poll(() => (remote.readJSON(shelfFile(keeper)) || {}).name, { message: '次の保存が届く' }).toBe('残す本棚 (改名)');
            expect(remote.has(shelfFile(slug)), '次の保存で消える').toBe(false);
        });

        test('保存先にまだ無い本棚ファイルの削除が混ざっても、保存は失敗しない', async ({ page }) => {
            const remote = await boot(page);
            await createShelf(page, remote, '残す本棚'); // bookshelf1 (削除した slug が作り直しで再利用されないように先に埋める)

            remote.failNextWrites(1); // 次の本棚は保存先に届かない
            await page.locator('#sidebar-add-bookshelf').click();
            await page.locator('#bookshelf-name').fill('届かない本棚');
            await page.locator('#save-bookshelf-form').click();
            await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
            await expect.poll(() => remote.failuresLeft(), { message: '作成後の保存が失敗する' }).toBe(0);
            await page.waitForTimeout(1500);
            const ghost = 'bookshelf2';
            expect(remote.has(shelfFile(ghost)), '保存先にはまだ無い').toBe(false);

            const writesBefore = remote.writes.length;
            await deleteShelf(page, ghost); // 保存先に無いファイルの削除が次の保存に載る
            await expect.poll(() => remote.writes.length, { message: '削除後の保存が成功する (書き込みが進む)' }).toBeGreaterThan(writesBefore);
            expect(remote.has(shelfFile('bookshelf1'))).toBe(true);
            expect(await remoteSlugs(remote)).toEqual(['all', 'bookshelf1']);
        });

        test('削除待ちの slug で作り直した本棚のファイルは消えない', async ({ page }) => {
            const remote = await boot(page);
            const slug = await createShelf(page, remote, '元の本棚');

            remote.failNextWrites(1); // 削除の保存を失敗させ、削除待ちに残す
            await deleteShelf(page, slug);
            await expect.poll(() => remote.failuresLeft()).toBe(0);
            await page.waitForTimeout(1500);

            // 同じ slug (空いている一番小さい番号) で作り直す
            await page.locator('#sidebar-add-bookshelf').click();
            await page.locator('#bookshelf-name').fill('作り直した本棚');
            await page.locator('#save-bookshelf-form').click();
            await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
            await expect.poll(() => (remote.readJSON(shelfFile(slug)) || {}).name, { message: '作り直した本棚が同じ slug で保存される' }).toBe('作り直した本棚');

            // もう1回保存しても消えない
            await createShelf(page, remote, 'もう1つ');
            expect((remote.readJSON(shelfFile(slug)) || {}).name).toBe('作り直した本棚');
        });
    });
}

test.describe('本棚ファイルの削除待ち: ローカルフォルダ (イシュー#587)', () => {
    test('フォルダ未接続の間に本棚を削除し、繋ぎ直した後も本棚とファイルが食い違わない', async ({ page }) => {
        // 再読込後の「権限待ち (要再接続)」を作る: 印が立っている間だけ queryPermission が 'prompt' を返す
        await page.addInitScript(() => {
            const orig = FileSystemHandle.prototype.queryPermission;
            FileSystemHandle.prototype.queryPermission = function (...args) {
                return localStorage.getItem('__e2e_perm_prompt') === '1' ? Promise.resolve('prompt') : orig.apply(this, args);
            };
        });
        const local = await bootWithLocalFolder(page);
        const slug = await createShelf(page, local, '未接続中に消す本棚');

        await page.evaluate(() => localStorage.setItem('__e2e_perm_prompt', '1'));
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');
        await deleteShelf(page, slug);
        const pendingWhileOffline = await page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingShelfDeletes'));

        await page.evaluate(() => localStorage.removeItem('__e2e_perm_prompt'));
        await openSettingsByClick(page, 'sync-section');
        await page.locator('#obsidian-sync-btn').click();
        await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(2500); // 繋ぎ直した後の保存を待つ

        const inApp = await page.evaluate((s) => !!window.bookshelf.bookshelfManager.getBySlug(s), slug);
        const inList = (await remoteSlugs(local)).includes(slug);
        const fileLeft = await local.has(shelfFile(slug));
        await test.info().attach('繋ぎ直した後', {
            body: JSON.stringify({ pendingWhileOffline, inApp, inList, fileLeft }, null, 2),
            contentType: 'application/json'
        });
        // 一覧にある本棚にはファイルがあり、一覧に無い本棚のファイルは残らない
        expect(fileLeft).toBe(inList);
    });
});
