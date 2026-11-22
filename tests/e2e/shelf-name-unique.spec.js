// イシュー#745: 同じ親の下に同名の本棚を作れないようにした (一意なのは親を含めた階層パス)。
// 画面の操作で3つの口を確かめる (関数の直呼びで済ませない):
//   (1) 作る      : 本棚管理の「新しい本棚」→ フォームで保存
//   (2) 名前を変える: 本棚管理の「編集」→ フォームで保存
//   (3) 移す      : PC は左ツリーの D&D・本棚管理のつまみの D&D・フォームの「親本棚」。スマホは左ツリーが無い
//                   (画面の外) ので、本棚管理のつまみのタッチの D&D とフォームの「親本棚」
//   (4) 既存の同名 : 同じ親の下に「SF」が2つある見本で起動する (読み込みでは検査しない)
// 起動は tests/e2e/tree-drop-stays-home.spec.js と同じ型 (fixture を localStorage に入れる)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';
const ALL = 'fixall001';

const MSG_CREATE = '「小説」の下に「SF」という本棚がすでにあります。別の名前にしてください';
const MSG_MOVE = '「小説」の下に「SF」という本棚がすでにあるため移動できません。先にどちらかの名前を変えてください';

// 小説 > SF > 海外 (3階層)・小説 > ミステリー・漫画 > SF。dup: true で 小説 の下に2つ目の「SF」を足す (既存の同名)
async function bootApp(page, { dup = false, stubSave = true } = {}) {
    await page.addInitScript(([userData, library, asin, all, withDup]) => {
        try { if (sessionStorage.getItem('__745_seeded')) return; sessionStorage.setItem('__745_seeded', '1'); } catch (_) { return; }
        const ud = JSON.parse(userData);
        const add = (id, internalId, name, parent) => ud.bookshelves.push({ id, internalId, name, iconName: 'library', description: '', books: [asin], isSpecial: false, parent });
        add('n745', 'n745iid', '小説', all);
        add('sfn745', 'sfn745iid', 'SF', 'n745iid');
        add('k745', 'k745iid', '海外', 'sfn745iid');
        add('y745', 'y745iid', 'ミステリー', 'n745iid');
        add('m745', 'm745iid', '漫画', all);
        add('sfm745', 'sfm745iid', 'SF', 'm745iid');
        if (withDup) add('sfd745', 'sfd745iid', 'SF', 'n745iid');
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary, ASIN, ALL, dup]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    if (stubSave) await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

const shelves = (page) => page.evaluate(() => window.bookshelf.userData.bookshelves.map((b) => ({ id: b.id, name: b.name, parent: b.parent || null, books: [...(b.books || [])], description: b.description || '' })));
const namesUnder = async (page, parent) => (await shelves(page)).filter((b) => b.parent === parent).map((b) => b.name);
const shelf = async (page, id) => (await shelves(page)).find((b) => b.id === id);
const toastWith = (page, text) => page.locator('.toast', { hasText: text });
const formModal = (page) => page.locator('#bookshelf-form-modal');
const managerItem = (page, key) => page.locator(`#bookshelf-modal .bookshelf-item[data-internal-id="${key}"]`);

async function openManager(page) {
    await page.keyboard.press('Control+k').catch(() => {});
    const input = page.locator('#cmdk-input');
    if (await input.isVisible().catch(() => false)) {
        await input.fill('本棚を管理');
        await page.keyboard.press('Enter');
    } else {
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
    }
    await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
}

async function press(page, locator) {
    const isMobile = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    if (isMobile) await locator.tap(); else await locator.click();
}

async function openCreateForm(page) {
    await openManager(page);
    await press(page, page.locator('#add-bookshelf'));
    await expect(formModal(page)).toHaveClass(/show/);
}

async function openEditForm(page, internalId) {
    await openManager(page);
    const btn = managerItem(page, internalId).locator('.edit-bookshelf');
    await btn.scrollIntoViewIfNeeded();
    await press(page, btn);
    await expect(formModal(page)).toHaveClass(/show/);
}

async function save(page) {
    await press(page, page.locator('#save-bookshelf-form'));
}

// 本棚管理のつまみを運ぶ。マウスは tree-drop-stays-home.spec.js の mouseDrag と同じ手順・タッチは CDP のタッチ
// (book-card-tap-after-touch-drag.spec.js の cdpTouch と同じ。ブラウザのタッチ→ポインタの変換を通る)
async function dragHandleTo(page, fromKey, toKey, touch) {
    await managerItem(page, toKey).scrollIntoViewIfNeeded();
    await managerItem(page, fromKey).scrollIntoViewIfNeeded();
    const h = await managerItem(page, fromKey).locator('.bookshelf-drag-handle').boundingBox();
    const t = await managerItem(page, toKey).boundingBox();
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    const to = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    if (touch) {
        const cdp = await page.context().newCDPSession(page);
        const send = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
        await send('touchStart', from);
        for (let i = 1; i <= 8; i++) {
            await send('touchMove', { x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 });
            await page.waitForTimeout(30);
        }
        await page.waitForTimeout(100);
        await send('touchEnd', null);
    } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, from.y + 5, { steps: 3 });
        await page.mouse.move(to.x, to.y, { steps: 5 });
        await page.waitForTimeout(100);
        await page.mouse.move(to.x, to.y);
        await page.waitForTimeout(80);
        await page.mouse.up();
    }
}

function addCases(label, { touch }) {
    test(`${label} (1) 作る: 同じ親の下の「SF」は止まり、フォームは開いたまま・本棚は増えない。別の親なら作れる`, async ({ page }) => {
        await bootApp(page);
        const before = (await shelves(page)).length;
        await openCreateForm(page);
        await page.locator('#bookshelf-name').fill('ＳＦ');
        await page.locator('#bookshelf-parent').selectOption('n745iid');
        await save(page);
        await expect(toastWith(page, MSG_CREATE)).toBeVisible();
        await expect(formModal(page)).toHaveClass(/show/);
        await expect(page.locator('#bookshelf-name')).toBeFocused();
        expect((await shelves(page)).length).toBe(before);
        expect(await namesUnder(page, 'n745iid')).toEqual(['SF', 'ミステリー']);
        await expect(page.locator('#bookshelf-modal .bookshelf-item')).toHaveCount(before);
        // 親を「ミステリー」に変えれば作れる (別の親の下の同名は今どおり)
        await page.locator('#bookshelf-parent').selectOption('y745iid');
        await save(page);
        await expect(formModal(page)).not.toHaveClass(/show/);
        expect(await namesUnder(page, 'y745iid')).toEqual(['ＳＦ']);
        expect((await shelves(page)).length).toBe(before + 1);
    });

    test(`${label} (2) 名前を変える: 兄弟の名前にすると止まり、名前を変えない編集は通る`, async ({ page }) => {
        await bootApp(page);
        await openEditForm(page, 'y745iid');
        await page.locator('#bookshelf-name').fill(' sf ');
        await page.locator('#bookshelf-description').fill('変えた説明');
        await save(page);
        await expect(toastWith(page, MSG_CREATE)).toBeVisible();
        await expect(formModal(page)).toHaveClass(/show/);
        expect(await shelf(page, 'y745')).toMatchObject({ name: 'ミステリー', description: '' });
        // 名前を戻して説明だけ変える → 保存できる
        await page.locator('#bookshelf-name').fill('ミステリー');
        await save(page);
        await expect(formModal(page)).not.toHaveClass(/show/);
        expect(await shelf(page, 'y745')).toMatchObject({ name: 'ミステリー', description: '変えた説明' });
    });

    test(`${label} (3a) 移す (本棚管理のつまみ${touch ? 'をタッチで' : 'をマウスで'}): 衝突する親へは止まり、親も本も変わらない。衝突しなければ移せる`, async ({ page }) => {
        await bootApp(page);
        await openManager(page);
        const novelBooks = (await shelf(page, 'n745')).books;
        await dragHandleTo(page, 'sfm745iid', 'n745iid', touch);
        await expect(toastWith(page, MSG_MOVE)).toBeVisible();
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
        expect((await shelf(page, 'sfm745')).parent).toBe('m745iid');
        expect((await shelf(page, 'n745')).books).toEqual(novelBooks);
        expect(await namesUnder(page, 'n745iid')).toEqual(['SF', 'ミステリー']);
        // 衝突しない移動 (ミステリー → 漫画) は確認の後に今どおり移る
        await page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove()));
        await dragHandleTo(page, 'y745iid', 'm745iid', touch);
        await press(page, page.locator('.cfm-overlay .cfm-ok'));
        await expect.poll(async () => (await shelf(page, 'y745')).parent).toBe('m745iid');
    });

    test(`${label} (3b) 移す (フォームの「親本棚」): 衝突する親へは止まり、何も保存しない`, async ({ page }) => {
        await bootApp(page);
        await openEditForm(page, 'sfm745iid');
        await page.locator('#bookshelf-parent').selectOption('n745iid');
        await page.locator('#bookshelf-description').fill('変えない');
        await save(page);
        await expect(toastWith(page, MSG_MOVE)).toBeVisible();
        await expect(formModal(page)).toHaveClass(/show/);
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
        expect(await shelf(page, 'sfm745')).toMatchObject({ parent: 'm745iid', description: '' });
        // 衝突しない親 (トップ階層) へは確認の後に移る
        await page.locator('#bookshelf-parent').selectOption('');
        await save(page);
        await press(page, page.locator('.cfm-overlay .cfm-ok'));
        await expect(formModal(page)).not.toHaveClass(/show/);
        await expect.poll(async () => (await shelf(page, 'sfm745')).parent).toBe(ALL);
    });

    test(`${label} (4) 既存の同名: 同じ親の下の「SF」2つが読み込まれ、名前を変えない編集は保存・再読込で両方残る。片方を「SF2」にできる`, async ({ page }) => {
        await bootApp(page, { dup: true, stubSave: false });
        expect(await namesUnder(page, 'n745iid')).toEqual(['SF', 'ミステリー', 'SF']);
        await openManager(page);
        await expect(managerItem(page, 'sfn745iid')).toBeVisible();
        await managerItem(page, 'sfd745iid').scrollIntoViewIfNeeded();
        await expect(managerItem(page, 'sfd745iid')).toBeVisible();
        await openEditForm(page, 'sfd745iid');
        await page.locator('#bookshelf-description').fill('既存の同名の片方');
        await save(page);
        await expect(formModal(page)).not.toHaveClass(/show/);
        await expect(page.locator('.toast', { hasText: 'すでにあります' })).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('virtualBookshelf_userData') || '{}').bookshelves || []).find((b) => b.id === 'sfd745')?.description)).toBe('既存の同名の片方');
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
        expect(await namesUnder(page, 'n745iid')).toEqual(['SF', 'ミステリー', 'SF']);
        expect((await shelf(page, 'sfd745')).description).toBe('既存の同名の片方');
        // 片方の名前を別にすれば通る
        await openEditForm(page, 'sfd745iid');
        await page.locator('#bookshelf-name').fill('SF2');
        await save(page);
        await expect(formModal(page)).not.toHaveClass(/show/);
        expect(await namesUnder(page, 'n745iid')).toEqual(['SF', 'ミステリー', 'SF2']);
    });
}

test.describe('同じ親の下の同名を止める (イシュー#745) PC', () => {
    addCases('PC', { touch: false });

    test('PC (3c) 移す (左ツリーの D&D): 衝突する親の真ん中へ落とすと止まり、親は変わらない', async ({ page }) => {
        await bootApp(page);
        const node = (slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);
        for (const key of ['all', 'n745', 'm745']) {
            const toggle = node(key).locator('.tree-toggle');
            await expect(toggle).toBeVisible();
            if (await toggle.getAttribute('title') === '展開') await toggle.click();
        }
        await expect(node('sfm745')).toBeVisible();
        const from = await node('sfm745').boundingBox();
        const to = await node('n745').boundingBox();
        const x0 = from.x + from.width / 2, y0 = from.y + from.height / 2;
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        await page.mouse.move(x0 + 10, y0, { steps: 4 });
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
        await page.waitForTimeout(100);
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
        await page.waitForTimeout(80);
        await page.mouse.up();
        await expect(toastWith(page, MSG_MOVE)).toBeVisible();
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
        expect((await shelf(page, 'sfm745')).parent).toBe('m745iid');
    });
});

test.describe('同じ親の下の同名を止める (イシュー#745) 390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    addCases('390', { touch: true });

    test('390 左ツリーはスマホに出ない (移す口は本棚管理のつまみとフォームの「親本棚」)', async ({ page }) => {
        await bootApp(page);
        const visible = await page.evaluate(() => {
            const el = document.querySelector('.app-sidebar');
            if (!el || !el.getClientRects().length) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > 0 && r.left < innerWidth;
        });
        expect(visible).toBe(false);
    });
});
