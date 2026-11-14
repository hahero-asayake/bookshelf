// イシュー#670: 本を除外しても、自作の本棚 (「すべての本」以外) の所属 (books) は消さない。見せる側は
// 「所属 ∩ 蔵書 (library − exclusions)」= window.bookshelf.shelfVisibleAsins だけを数える・渡す。解除すると元の本棚に戻る。
// 読み手ごとに1行: ツリーの冊数・本棚の管理一覧・ホームのカード・読書統計の本棚別 Top5・プラグインの getBookshelves/getBookshelf・
// 本棚を開いた一覧・記事の本の引き出し (#669 の着地後に載せる)・書き出しの bookshelves/<slug>.json (所属をそのまま書く)。
// 起動は tests/e2e/shelf-delete-open-descendant.spec.js と同じ型 (fixture を localStorage に入れる)。再読込で見本を入れ直さない
// よう、入れたら印を立てる。1冊ずつの除外は window.bookshelf.excludeBook を呼び、確認の窓は画面で押す (除外ボタンは編集モードの
// 本の詳細にしか無い・#622 の 662-H と同じ入口の取り方)。一括の除外は選択モードから画面で行う。
// フォルダ未接続で再読込した後に解除すると本が蔵書に戻らない件 (results の c-2) は別イシュー (#670 では扱わない)。
import { test, expect } from './helpers/test-base.js';
import { addBlock, getArtBlocks } from './helpers/art-editor.js';
import { mockSyncReady } from './helpers/sync.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from './helpers/gate-local.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const X = 'B000000001'; // 1冊ずつ除外する本
const Y = 'B000000002'; // 一括で除外する本
const Z = 'B000000003'; // 除外しない本

// fixture に、親 (X・Y・Z) > 子 (X・Y) の自作の本棚を足す
async function bootApp(page) {
    await page.addInitScript(([userData, library, x, y, z]) => {
        if (!localStorage.getItem('e2e670-seeded')) {
            const ud = JSON.parse(userData);
            ud.bookshelves.push({ id: 'e2e-p', internalId: 'e2ep0001', name: '親の本棚', iconName: 'library', books: [x, y, z], isSpecial: false, parent: 'fixall001' });
            ud.bookshelves.push({ id: 'e2e-c', internalId: 'e2ec0001', name: '子の本棚', iconName: 'library', books: [x, y], isSpecial: false, parent: 'e2ep0001' });
            localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
            localStorage.setItem('virtualBookshelf_library', library);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
            localStorage.setItem('e2e670-seeded', '1');
        }
    }, [fixtureUserData, fixtureLibrary, X, Y, Z]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await listenPluginEvents(page);
}

// プラグインのイベントを数える (起動の後に聞き始める)
const listenPluginEvents = (page) => page.evaluate(() => {
    window.__e2eEv = [];
    for (const ev of ['book:removed', 'book:added', 'bookshelf:updated', 'books:changed']) {
        window.bookshelfAPI.on(ev, (d) => window.__e2eEv.push({ ev, asin: d && (d.asin || (d.book && d.book.asin)), reason: d && d.reason }));
    }
});
const events = (page) => page.evaluate(() => [...(window.__e2eEv || [])]);

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);
const treeCount = (page, slug) => treeNode(page, slug).locator('.bsr-count').first();

async function expandTree(page, keys) {
    for (const key of keys) {
        const toggle = treeNode(page, key).locator('.tree-toggle').first();
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
}

// 本棚の所属 (メモリ・端末の控え) を読む
const members = (page, id) => page.evaluate((id) => {
    const find = (list) => ((list || []).find(b => b.id === id) || {}).books || null;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || 'null'); } catch (e) { stored = null; }
    return { mem: find(window.bookshelf.userData.bookshelves), stored: stored ? find(stored.bookshelves) : null };
}, id);

// 子の本棚を開き、並んだ本の ASIN を返す (want 冊が並ぶまで待つ)
async function openChildShelf(page, want) {
    await expandTree(page, ['all', 'e2e-p']);
    await treeNode(page, 'e2e-c').click();
    await expect(page).toHaveURL(/#\/bookshelf\/e2e-c$/);
    const items = page.locator('.book-item[data-asin]:visible');
    await expect(items).toHaveCount(want);
    return items.evaluateAll(els => els.map(e => e.getAttribute('data-asin')));
}

async function confirmOk(page) {
    const cfm = page.locator('.cfm-overlay');
    await expect(cfm).toBeVisible();
    await cfm.locator('.cfm-ok').click();
    await expect(cfm).toBeHidden();
}

async function excludeOne(page, asin) {
    const p = page.evaluate((a) => window.bookshelf.excludeBook(a), asin);
    await confirmOk(page);
    await p;
    await expect.poll(() => page.evaluate((a) => window.bookshelf.books.some(b => b.asin === a), asin)).toBe(false);
}

test.describe('#670 除外した本と自作の本棚', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'chromium で確かめる (画面の幅・エンジンに依らない決まり)');

    test('670-A 1冊除外すると、所属は残り、ツリーの冊数と本棚を開いた一覧は見える本だけになる (再読込の後も)', async ({ page }) => {
        await bootApp(page);
        await excludeOne(page, X);
        // 所属は書き換えない (メモリ・端末の控えとも)
        expect(await members(page, 'e2e-c')).toEqual({ mem: [X, Y], stored: [X, Y] });
        expect(await members(page, 'e2e-p')).toEqual({ mem: [X, Y, Z], stored: [X, Y, Z] });
        // 読み手: ツリーの冊数・本棚を開いた一覧
        expect(await openChildShelf(page, 1)).toEqual([Y]);
        await expect(treeCount(page, 'e2e-c')).toHaveText('1');
        await expect(treeCount(page, 'e2e-p')).toHaveText('2');
        // イベント: 1冊ずつの除外は book:removed を1回。所属は変わらないので bookshelf:updated は出ない
        const ev = await events(page);
        expect(ev.filter(e => e.ev === 'book:removed' && e.asin === X && e.reason === 'excluded')).toHaveLength(1);
        expect(ev.filter(e => e.ev === 'bookshelf:updated')).toHaveLength(0);

        // 既存データ: 本棚に除外した本が残った状態から起動しても、書き換えずに見える本だけを数える
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
        expect(await members(page, 'e2e-c')).toEqual({ mem: [X, Y], stored: [X, Y] });
        expect(await openChildShelf(page, 1)).toEqual([Y]);
        await expect(treeCount(page, 'e2e-c')).toHaveText('1');
    });

    test('670-C 除外を解除すると、元の本棚にそのまま戻り、冊数も戻る', async ({ page }) => {
        await bootApp(page);
        await excludeOne(page, X);
        await page.evaluate((x) => window.bookshelf.unexcludeBook(x), X);
        await expect.poll(() => page.evaluate((x) => window.bookshelf.books.some(b => b.asin === x), X)).toBe(true);
        expect((await openChildShelf(page, 2)).sort()).toEqual([X, Y]);
        await expect(treeCount(page, 'e2e-c')).toHaveText('2');
        const ev = await events(page);
        expect(ev.filter(e => e.ev === 'book:added' && e.asin === X && e.reason === 'unexcluded')).toHaveLength(1);
        const viaPlugin = await page.evaluate(() => window.bookshelfAPI.getBookshelf('e2ec0001').books);
        expect(viaPlugin.sort()).toEqual([X, Y]);
    });

    test('670-D 1冊除外した後、本棚の管理一覧・ホームのカード・読書統計の本棚別 Top5 は見える本だけを数える', async ({ page }) => {
        await bootApp(page);
        await excludeOne(page, X);
        // .book-count から上へたどり、最初に本棚の名前を含む要素 (カード・行) で、どの本棚の冊数かを決める
        const readCounts = (root) => page.evaluate((root) => {
            const out = {};
            document.querySelectorAll(`${root} .book-count`).forEach(el => {
                let n = el.parentElement;
                for (let i = 0; i < 8 && n && !/子の本棚|親の本棚/.test(n.textContent); i++) n = n.parentElement;
                const t = n ? n.textContent : '';
                const key = t.includes('子の本棚') && !t.includes('親の本棚') ? 'c' : (t.includes('親の本棚') && !t.includes('子の本棚') ? 'p' : null);
                if (key && !(key in out)) out[key] = el.textContent.trim();
            });
            return out;
        }, root);
        const readStats = () => page.evaluate(() => {
            const out = {};
            document.querySelectorAll('.rs-shelves li').forEach(li => { out[li.querySelector('span')?.textContent || ''] = li.querySelector('strong')?.textContent || ''; });
            return out;
        });
        // ホーム (カードと読書統計は既定のホームにある)
        await page.goto('index.html#/');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
        await expect.poll(() => readCounts('body'), { message: 'ホームのカードの冊数' }).toEqual({ p: '2冊', c: '1冊' });
        await expect.poll(readStats, { message: '読書統計の本棚別 Top5' }).toMatchObject({ '親の本棚': '2', '子の本棚': '1' });
        // 本棚の管理一覧
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        await expect.poll(() => readCounts('#bookshelves-list'), { message: '管理一覧の冊数' }).toEqual({ p: '2冊', c: '1冊' });
    });

    test('670-G 1冊除外した後、プラグインの getBookshelves・getBookshelf の books は見える本だけ', async ({ page }) => {
        await bootApp(page);
        await excludeOne(page, X);
        const got = await page.evaluate(() => {
            const list = window.bookshelfAPI.getBookshelves();
            return {
                c: (list.find(b => b.internalId === 'e2ec0001') || {}).books,
                p: (list.find(b => b.internalId === 'e2ep0001') || {}).books,
                one: window.bookshelfAPI.getBookshelf('e2ec0001').books,
                // 所属そのもの (本体) は残っている
                memberC: window.bookshelf.userData.bookshelves.find(b => b.id === 'e2e-c').books,
            };
        });
        expect(got).toEqual({ c: [Y], p: [Y, Z], one: [Y], memberC: [X, Y] });
    });

    test('670-E 1冊除外した後、記事の本の引き出しで子の本棚を選ぶと、除外した本は並ばず N にも数えない', async ({ page }) => {
        await bootApp(page);
        await excludeOne(page, X);
        // 記事の保存先だけメモリに差し替え、接続済み相当にする (tests/e2e/publish-article-editor.spec.js の bootApp と同じ)
        await page.evaluate(() => {
            window.HubAuth.renderSignInButton = () => {};
            const mem = new Map();
            const adapter = window.bookshelf.storage.adapter;
            adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
            adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        });
        await mockSyncReady(page, true);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addBlock(page, 'shelf', 'first'); // 本の引き出しは本棚の全画面編集で出る (#268)
        await page.click('#art-drawer-shelf-btn');
        await page.locator('#art-drawer-shelf-popover [data-shelf-internal="e2ec0001"]').click();
        await expect(page.locator('#art-drawer-shelf-label')).toHaveText('親の本棚 / 子の本棚');
        const rows = page.locator('#art-drawer-list .art-drawer-item');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toHaveAttribute('data-asin', Y);
        await expect(page.locator('#art-drawer-add-all')).toHaveText('表示中の1冊を追加');
        await page.locator('#art-drawer-add-all').click();
        await expect.poll(async () => (await getArtBlocks(page)).flatMap(b => (b.items || []).map(it => it.asin))).toEqual([Y]);
    });

    test('670-B 一括で除外すると、1冊ごとに book:removed が出て、所属は残り、冊数は見える本だけになる', async ({ page }) => {
        await bootApp(page);
        // 一括の除外は画面から: 「すべての本」を開き、選択モードで Y を選んで「すべての本から除外」
        await expandTree(page, []);
        await treeNode(page, 'all').click();
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await page.locator('#toggle-select-mode').click();
        await page.locator(`#bookshelf .book-item[data-asin="${Y}"]`).first().click();
        await page.locator('#bulk-exclude').click();
        await confirmOk(page);
        await expect(page.locator('.toast-success', { hasText: '冊を除外しました' })).toBeVisible();
        await page.locator('#toggle-select-mode').click();

        const ev = await events(page);
        expect(ev.filter(e => e.ev === 'book:removed' && e.asin === Y && e.reason === 'excluded')).toHaveLength(1);
        expect(ev.filter(e => e.ev === 'bookshelf:updated')).toHaveLength(0);
        expect(await members(page, 'e2e-c')).toEqual({ mem: [X, Y], stored: [X, Y] });
        expect(await openChildShelf(page, 1)).toEqual([X]);
        await expect(treeCount(page, 'e2e-c')).toHaveText('1');
    });
});

// ── フォルダの保存先 (#664 の tests/e2e/exclude-export-all-shelf.spec.js と同じ作り方) ──
const EXPORT_JSON = readFileSync(join(here, '../fixtures/gate-kindle-export.json'), 'utf-8');
const TARGET = 'B0GATEIMP3';

async function pasteImport(page, json) {
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(json);
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#import-results')).toContainText('取込結果');
}

// フォルダの private/ の中身 (library・exclusions・bookshelves/*.json の books) と未反映の印を読む
const readFolder = (page, dirName) => page.evaluate(async (name) => {
    const out = { shelves: {} };
    const readJson = async (dir, file) => JSON.parse(await (await (await dir.getFileHandle(file)).getFile()).text());
    try {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        dir = await dir.getDirectoryHandle('private');
        try { out.lib = ((await readJson(dir, 'library.json')).books || []).map((b) => b.asin); } catch (e) { out.lib = null; }
        try { out.excl = (await readJson(dir, 'exclusions.json')).excludedASINs || []; } catch (e) { out.excl = null; }
        try {
            const sh = await dir.getDirectoryHandle('bookshelves');
            for await (const [fname] of sh.entries()) {
                try { out.shelves[fname] = (await readJson(sh, fname)).books || null; } catch (e) { out.shelves[fname] = 'unreadable'; }
            }
        } catch (e) { out.shelves = null; }
    } catch (e) { out.err = String(e && e.name); }
    out.pending = localStorage.getItem('virtualBookshelf_pendingSync');
    return out;
}, dirName);

const callApp = (page, method, asin) => page.evaluate(async ({ method, asin }) => {
    window.confirmDialog = async () => true;
    await window.bookshelf[method](asin);
}, { method, asin });

// 書き出しの完了 = exclusions.json が want の除外を持ち、未反映の印が消える
const exported = (page, dirName, wantExcluded) => expect.poll(async () => {
    const s = await readFolder(page, dirName);
    return Array.isArray(s.excl) && s.excl.includes(TARGET) === wantExcluded && s.pending !== '1';
}, { timeout: 20000, message: '書き出しの完了 (exclusions.json と未反映の印)' }).toBe(true);

test('670-F フォルダにつないだまま除外して書き出しても、自作の本棚のファイルの所属は残り、再読込の後に解除すると戻る', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'chromium で確かめる (OPFS のフォルダの模擬)');
    const dirName = `e670-F-${testInfo.repeatEachIndex}-${testInfo.retry}`;
    await stubFolderPickerForTest(page, dirName);
    await bootAppForTest(page);
    await connectLocalFolderForTest(page);
    await page.locator('#dashboard-welcome button[data-dw="import"]').click();
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await pasteImport(page, EXPORT_JSON);
    await expect.poll(async () => ((await readFolder(page, dirName)).lib || []).length, { timeout: 20000 }).toBe(3);
    await page.keyboard.press('Escape');
    // 自作の本棚を1つ足して TARGET を入れる (入口だけ直に足して保存する)
    await page.evaluate(async (t) => {
        const ud = window.bookshelf.userData;
        const all = ud.bookshelves.find(b => b.isSpecial);
        ud.bookshelves.push({ id: 'e670f', internalId: 'e670f0001', name: '自作の本棚F', iconName: 'library', books: [t], isSpecial: false, parent: all.internalId });
        await window.bookshelf.saveUserData();
    }, TARGET);
    await expect.poll(async () => ((await readFolder(page, dirName)).shelves || {})['e670f.json'] || null, { timeout: 20000 }).toEqual([TARGET]);

    await callApp(page, 'excludeBook', TARGET);
    await exported(page, dirName, true);
    // 書き出し: 所属の正本はそのまま書く (exclusions.json と合わせて読む)。library.json は除外を含む全書誌のまま
    const s1 = await readFolder(page, dirName);
    expect(s1.shelves['e670f.json']).toEqual([TARGET]);
    expect(s1.lib).toContain(TARGET);
    await expandTree(page, ['all']);
    await expect(treeCount(page, 'e670f')).toHaveText('0');

    await page.reload();
    await expect(page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]')).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.evaluate(() => (window.bookshelf.userData.bookshelves || []).some(b => b.id === 'e670f')), { timeout: 20000 }).toBe(true);
    await expandTree(page, ['all']);
    await expect(treeCount(page, 'e670f')).toHaveText('0');

    // 解除は、再読込の読込が書誌の控え (_storage.libraryBooks・除外した本を含む3冊) を作り直した後に行う。
    // 作り直す前に解除すると書誌が見つからず蔵書に戻らない (フォルダ未接続の c-2 と同じ形・別イシュー)。e2e-diff の高負荷で1回落ちた
    await expect.poll(() => page.evaluate(() => (((window.bookshelf.userData || {})._storage || {}).libraryBooks || []).length), { timeout: 20000, message: '書誌の控えの読み直し' }).toBe(3);
    await callApp(page, 'unexcludeBook', TARGET);
    await exported(page, dirName, false);
    await expect.poll(() => page.evaluate((t) => window.bookshelf.books.some(b => b.asin === t), TARGET)).toBe(true);
    await expandTree(page, ['all']);
    await expect(treeCount(page, 'e670f')).toHaveText('1');
    expect((await readFolder(page, dirName)).shelves['e670f.json']).toEqual([TARGET]);
});
