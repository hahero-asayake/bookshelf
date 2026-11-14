// イシュー#623: 本の詳細を開いたまま、本棚の名前・アイコンを変える・本棚を削除する・本棚を作る・親を付け替えると、
// 詳細の本棚のチップと「本棚を追加...」の選択肢が、その場で今の本棚に合う (詳細は閉じず、未保存の入力は残る)。
// 起動は tests/e2e/char/bookdetail.spec.js と同じ型 (fixture を localStorage に入れ、本はクリックで開く)。
// 保存 (saveUserData) だけを差し替える。本棚の操作はすべて画面から行う
// (ツリーの「…」→ 本棚フォーム・アイコン選択・確認ダイアログ。作法は shelf-file-delete.spec.js と同じ)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';

// fixture の「テスト本棚」(fixshelf・本1が所属) に、本1が入っている親子 (親の本棚 > 子の本棚) と、
// 本1が入っていない本棚を足す
async function bootApp(page) {
    await page.addInitScript(([userData, library, asin]) => {
        const ud = JSON.parse(userData);
        ud.bookshelves.push({ id: 'e2e-parent', internalId: 'e2eparent01', name: '親の本棚', iconName: 'library', books: [asin], isSpecial: false, parent: 'fixall001' });
        ud.bookshelves.push({ id: 'e2e-child', internalId: 'e2echild01', name: '子の本棚', iconName: 'library', books: [asin], isSpecial: false, parent: 'e2eparent01' });
        ud.bookshelves.push({ id: 'e2e-other', internalId: 'e2eother01', name: '入っていない本棚', iconName: 'library', books: [], isSpecial: false, parent: 'fixall001' });
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary, ASIN]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

// ホームの「最近追加した本」から、クリックだけで本の詳細を開く。edit なら編集モードへ切り替え、書名の欄に未保存の文字を入れる
async function openFromHome(page, { edit }) {
    await page.locator(`.widget-book-cell[data-asin="${ASIN}"]`).first().click();
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
    if (edit) {
        await page.click('#book-detail-pane .edit-mode-btn');
        await expect(page.locator('#book-detail-pane .bookshelf-select')).toBeVisible();
        await page.locator('#book-detail-pane input.edit-title').fill('未保存の書名');
    }
}

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);

// ツリーの「すべての本」と、渡した本棚 (上から順に書く) が畳まれていれば展開する
async function expandTree(page, ancestors = []) {
    for (const key of ['all', ...ancestors]) {
        const toggle = treeNode(page, key).locator('.tree-toggle');
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
}

// マウスのドラッグ (tests/e2e/touch-reorder.spec.js の mouseDrag と同じ手順。最後に同じ座標へもう1回動かして落ち着かせる)
async function mouseDrag(page, fromBox, toPoint) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0, y0 + 5, { steps: 3 });
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.move(toPoint.x, toPoint.y);
    await page.waitForTimeout(80);
    await page.mouse.up();
}

// ツリーの「…」を開く。子の本棚は、上の本棚 (ancestors に上から順に書く) が畳まれていれば展開してから
async function openTreeMenu(page, slug, ancestors = []) {
    await expandTree(page, ancestors);
    const node = treeNode(page, slug);
    await expect(node).toBeVisible();
    await node.hover();
    await node.locator('.tree-more').click();
    await expect(page.locator('#tree-node-menu')).toBeVisible();
}

async function openEditForm(page, slug, ancestors = []) {
    await openTreeMenu(page, slug, ancestors);
    await page.locator('#tree-node-menu [data-act="edit"]').click();
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
}

async function saveForm(page) {
    await page.locator('#save-bookshelf-form').click();
    // 親を付け替えた時だけ確認ダイアログが出る
    const ok = page.locator('.cfm-overlay .cfm-ok');
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
}

async function renameShelf(page, slug, name) {
    await openEditForm(page, slug);
    await page.locator('#bookshelf-name').fill(name);
    await saveForm(page);
}

// アイコンは本棚フォームの「アイコン」ボタン → アイコン選択の画面で Lucide 名を入れて「使う」
async function changeIcon(page, slug, icon) {
    await openEditForm(page, slug);
    await page.locator('#bookshelf-icon-trigger').click();
    await expect(page.locator('#icon-picker-modal')).toBeVisible();
    await page.locator('#icon-picker-lucide-input').fill(icon);
    await expect(page.locator('#icon-picker-lucide-use')).toBeEnabled();
    await page.locator('#icon-picker-lucide-use').click();
    await expect(page.locator('#bookshelf-icon-name')).toHaveValue(icon);
    await saveForm(page);
}

async function reparentShelf(page, slug, parentKey, ancestors = []) {
    await openEditForm(page, slug, ancestors);
    await page.locator('#bookshelf-parent').selectOption(parentKey);
    await saveForm(page);
}

async function deleteShelf(page, slug) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="delete"]').click();
    await page.locator('.cfm-overlay .cfm-ok').click();
    await expect.poll(() => shelfExists(page, slug)).toBe(false);
}

// parentSlug を渡すと、その本棚の「…」→「子本棚を追加」から作る (子の本棚は、親の本を初めから持つ)
async function createShelf(page, name, { parentSlug } = {}) {
    if (parentSlug) {
        await openTreeMenu(page, parentSlug);
        await page.locator('#tree-node-menu [data-act="add-child"]').click();
    } else {
        await page.locator('#sidebar-add-bookshelf').click();
    }
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
    await page.locator('#bookshelf-name').fill(name);
    await saveForm(page);
}

const shelfExists = (page, slug) => page.evaluate((s) => !!window.bookshelf.userData.bookshelves.find((b) => b.id === s), slug);
const memberOf = (page, slug) => page.evaluate(([s, a]) => {
    const bs = window.bookshelf.userData.bookshelves.find((b) => b.id === s);
    return !!bs && (bs.books || []).includes(a);
}, [slug, ASIN]);
const chip = (page, slug) => page.locator(`#current-bookshelves-${ASIN} .bd-chip[data-bookshelf-id="${slug}"]`);
const chips = (page) => page.locator(`#current-bookshelves-${ASIN} .bd-chip`);
const option = (page, slug) => page.locator(`#book-detail-pane .bookshelf-select option[value="${slug}"]`);
const optionByName = (page, name) => page.locator('#book-detail-pane .bookshelf-select option', { hasText: name });
// チップの並び (data-bookshelf-id の順) と、本1が入っている本棚の本棚の並び (userData.bookshelves の順) (イシュー#638)
const chipOrder = (page) => chips(page).evaluateAll((els) => els.map((el) => el.dataset.bookshelfId));
const memberOrder = (page) => page.evaluate((a) => window.bookshelf.userData.bookshelves
    .filter((b) => !b.isSpecial && (b.books || []).includes(a)).map((b) => b.id), ASIN);

// 詳細が閉じていない・未保存の書名が残っている (edit の時だけ)
async function expectDetailKept(page, edit) {
    await expect.soft(page.locator('body')).toHaveClass(/book-detail-pinned/);
    if (edit) await expect.soft(page.locator('#book-detail-pane input.edit-title')).toHaveValue('未保存の書名');
}

for (const [label, edit] of [['閲覧モード', false], ['編集モード', true]]) {
    test.describe(`PC 幅・${label}`, () => {
        test(`(a) ${label}: 本が入っている本棚の名前を変えると、すぐにチップの名前が変わる`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect(chip(page, 'fixshelf')).toContainText('テスト本棚');

            await renameShelf(page, 'fixshelf', '改名した本棚');

            await expect.soft(chip(page, 'fixshelf')).toContainText('改名した本棚');
            await expect.soft(chips(page).filter({ hasText: 'テスト本棚' })).toHaveCount(0);
            await expect.soft(chips(page)).toHaveCount(3);
            await expectDetailKept(page, edit);
        });

        test(`(b) ${label}: 本が入っている本棚のアイコンを変えると、すぐにチップのアイコンが変わる`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect(chip(page, 'fixshelf').locator('.bd-chip-icon')).toHaveAttribute('data-icon-value', 'library');

            await changeIcon(page, 'fixshelf', 'rocket');

            await expect.soft(chip(page, 'fixshelf').locator('.bd-chip-icon')).toHaveAttribute('data-icon-value', 'rocket');
            await expectDetailKept(page, edit);
        });

        test(`(c) ${label}: 本が入っている本棚を削除すると、子の本棚の分も含めてすぐにチップが消える`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect(chips(page)).toHaveCount(3);

            await deleteShelf(page, 'e2e-parent');
            expect(await shelfExists(page, 'e2e-child')).toBe(false);

            await expect.soft(chip(page, 'e2e-parent')).toHaveCount(0);
            await expect.soft(chip(page, 'e2e-child')).toHaveCount(0);
            await expect.soft(chips(page)).toHaveCount(1);
            await expectDetailKept(page, edit);
        });
    });
}

test.describe('PC 幅・編集モードの選択肢', () => {
    test('(d-1) 本が入っていない本棚の名前を変えると、すぐに選択肢の文字が変わる', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(option(page, 'e2e-other')).toHaveText('入っていない本棚');

        await renameShelf(page, 'e2e-other', '改名した候補');

        await expect.soft(option(page, 'e2e-other')).toHaveText('改名した候補');
        await expectDetailKept(page, true);
    });

    test('(d-2) 本が入っていない本棚を削除すると、すぐに選択肢から消える', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(option(page, 'e2e-other')).toHaveCount(1);

        await deleteShelf(page, 'e2e-other');

        // 候補が0になるので、追加の欄ごと消える
        await expect.soft(option(page, 'e2e-other')).toHaveCount(0);
        await expect.soft(page.locator('#book-detail-pane .bd-add-bookshelf')).toHaveCount(0);
        await expectDetailKept(page, true);
    });

    test('(d-3) 本棚を新しく作ると、すぐに選択肢に出て、そのまま選んで追加できる', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });

        await createShelf(page, '新しく作った本棚');

        await expect.soft(optionByName(page, '新しく作った本棚')).toHaveCount(1);
        await expectDetailKept(page, true);

        // 書き換えた後の選択肢と「追加」がつながっている
        await page.locator('#book-detail-pane .bookshelf-select').selectOption({ label: '新しく作った本棚' });
        await page.locator('#book-detail-pane .add-to-bookshelf').click();
        await expect(chips(page).filter({ hasText: '新しく作った本棚' })).toHaveCount(1);
        await expect(optionByName(page, '新しく作った本棚')).toHaveCount(0);
    });

    test('(d-4) 本が入っている本棚に子の本棚を作ると、すぐにその子のチップが出る (子は親の本を初めから持つ)', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(chips(page)).toHaveCount(3);

        await createShelf(page, '新しい子の本棚', { parentSlug: 'fixshelf' });

        await expect.soft(chips(page).filter({ hasText: '新しい子の本棚' })).toHaveCount(1);
        await expect.soft(chips(page)).toHaveCount(4);
        await expect.soft(optionByName(page, '新しい子の本棚')).toHaveCount(0);
        await expectDetailKept(page, true);
    });

    test('(f) 本が入っている本棚の親を、本が入っていない本棚に付け替えると、補充された親のチップがすぐに出て選択肢から消える', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(chip(page, 'e2e-other')).toHaveCount(0);

        await reparentShelf(page, 'e2e-child', 'e2eother01', ['e2e-parent']);
        // 付け替えると、子の本棚の本が新しい親へ補充される
        expect(await memberOf(page, 'e2e-other')).toBe(true);

        await expect.soft(chip(page, 'e2e-other')).toHaveCount(1);
        await expect.soft(chips(page)).toHaveCount(4);
        await expect.soft(option(page, 'e2e-other')).toHaveCount(0);
        await expectDetailKept(page, true);
    });

    test('(i) 改名の後も、チップの × で外せる (外すと詳細が閉じる今の動きのまま)', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await renameShelf(page, 'fixshelf', '改名した本棚');
        await expect(chip(page, 'fixshelf')).toContainText('改名した本棚');

        await chip(page, 'fixshelf').locator('.remove-from-bookshelf').click();
        await page.locator('.cfm-overlay .cfm-ok').click();

        await expect.poll(() => memberOf(page, 'fixshelf')).toBe(false);
        await expect(page.locator(`#current-bookshelves-${ASIN}`)).toHaveCount(0);
    });
});

test.describe('PC 幅・いま開いている本棚', () => {
    test('(e) 開いている本棚の本の詳細を開いたまま、その本棚を削除すると、すぐにチップが消える', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => { location.hash = '#/bookshelf/fixshelf'; });
        await page.locator(`.book-item[data-asin="${ASIN}"]`).first().click();
        await expect(chip(page, 'fixshelf')).toHaveClass(/is-context/);

        await deleteShelf(page, 'fixshelf');

        await expect.soft(chip(page, 'fixshelf')).toHaveCount(0);
        await expect.soft(chips(page)).toHaveCount(2);
        await expect.soft(page.locator(`#current-bookshelves-${ASIN} .bd-chip.is-context`)).toHaveCount(0);
        await expectDetailKept(page, false);
    });
});

// ツリーのドラッグ (マウス) で親を付け替える経路。本棚フォームでの付け替え (f) と同じく、補充された本棚のチップがすぐに出る
test.describe('PC 幅・ツリーのドラッグ', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('(j) 子の本棚を、本が入っていない本棚の上へドラッグして付け替えると、補充された本棚のチップがすぐに出て選択肢から消える', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(chip(page, 'e2e-other')).toHaveCount(0);

        await expandTree(page, ['e2e-parent']);
        const from = await treeNode(page, 'e2e-child').boundingBox();
        const to = await treeNode(page, 'e2e-other').boundingBox();
        // 行の真ん中へ落とす = その本棚の子にする (確認ダイアログが出る)
        await mouseDrag(page, from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
        await page.locator('.cfm-overlay .cfm-ok').click();
        await expect.poll(() => memberOf(page, 'e2e-other')).toBe(true);

        await expect.soft(chip(page, 'e2e-other')).toHaveCount(1);
        await expect.soft(chips(page)).toHaveCount(4);
        await expect.soft(option(page, 'e2e-other')).toHaveCount(0);
        await expectDetailKept(page, true);
    });

    // 同じ親の中での並べ替え (イシュー#638)。チップは本棚の並び (userData.bookshelves の順) で描くので、並べ替えた順にすぐ並び直す。
    // 行の上の端 (高さの0.3より上) へ落とすと前へ、下の端 (0.7より下) へ落とすと後ろへの並べ替え (親は変わらず、確認ダイアログは出ない)
    for (const [label, edit] of [['閲覧モード', false], ['編集モード', true]]) {
        test(`(k) ${label}: 同じ親の中で本棚を前へ並べ替えると、すぐにチップがその順に並び直す`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect.poll(() => chipOrder(page)).toEqual(['fixshelf', 'e2e-parent', 'e2e-child']);

            await expandTree(page);
            const from = await treeNode(page, 'e2e-parent').boundingBox();
            const to = await treeNode(page, 'fixshelf').boundingBox();
            await mouseDrag(page, from, { x: to.x + to.width / 2, y: to.y + to.height * 0.15 });
            await expect.poll(() => memberOrder(page)).toEqual(['e2e-parent', 'fixshelf', 'e2e-child']);
            await expect.soft(page.locator('.cfm-overlay')).toHaveCount(0);
            await expectDetailKept(page, edit);

            await expect.poll(() => chipOrder(page)).toEqual(['e2e-parent', 'fixshelf', 'e2e-child']);
        });
    }

    test('(k-2) 同じ親の最後の本棚の後ろへ並べ替えると、すぐにチップがその順に並び直す', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect.poll(() => chipOrder(page)).toEqual(['fixshelf', 'e2e-parent', 'e2e-child']);

        await expandTree(page);
        // 隣の行から落とす。ドラッグは元の行の上で 6px 以上動いた時に始まり、mouseDrag の2歩目は2行先だと元の行の外に出て始まらない
        const from = await treeNode(page, 'e2e-parent').boundingBox();
        const to = await treeNode(page, 'e2e-other').boundingBox();
        // 同じ親の最後の本棚の下の端へ落とす = 本棚の並びの最後へ動く
        await mouseDrag(page, from, { x: to.x + to.width / 2, y: to.y + to.height * 0.85 });
        await expect.poll(() => memberOrder(page)).toEqual(['fixshelf', 'e2e-child', 'e2e-parent']);
        await expect.soft(page.locator('.cfm-overlay')).toHaveCount(0);
        await expectDetailKept(page, true);

        await expect.poll(() => chipOrder(page)).toEqual(['fixshelf', 'e2e-child', 'e2e-parent']);
    });

    // 本棚管理のモーダル (⌘K の「本棚を管理」) のドラッグも、ツリーと同じ並べ替えを通る
    test('(l) 本棚管理のモーダルで同じ親の中で前へ並べ替えると、すぐにチップがその順に並び直す', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect.poll(() => chipOrder(page)).toEqual(['fixshelf', 'e2e-parent', 'e2e-child']);

        await page.keyboard.press('Control+k');
        await page.locator('#cmdk-input').fill('本棚を管理');
        await page.keyboard.press('Enter');
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);

        const item = (key) => page.locator(`#bookshelf-modal .bookshelf-item[data-internal-id="${key}"]`);
        const from = await item('e2eparent01').locator('.bookshelf-drag-handle').boundingBox();
        const to = await item('fixshelf01').boundingBox();
        await mouseDrag(page, from, { x: to.x + to.width / 2, y: to.y + to.height * 0.15 });
        await expect.poll(() => memberOrder(page)).toEqual(['e2e-parent', 'fixshelf', 'e2e-child']);
        await expect.soft(page.locator('.cfm-overlay')).toHaveCount(0);
        await expectDetailKept(page, true);

        await expect.poll(() => chipOrder(page)).toEqual(['e2e-parent', 'fixshelf', 'e2e-child']);
    });
});

// 詳細の外 (見張り): ホームの本棚のカードは、改名・削除の後に今の本棚に合っている (#623 step1 の実測で、もともと合っていた)
test.describe('PC 幅・ホームの本棚のカード', () => {
    test('(h) 詳細を開いたまま改名・削除すると、ホームの本棚のカードも今の本棚に合う', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: false });
        const card = (slug) => page.locator(`.bookshelf-preview[data-bookshelf-id="${slug}"]`);
        await expect(card('fixshelf')).toContainText('テスト本棚');
        await expect(card('e2e-parent')).toHaveCount(1);

        await renameShelf(page, 'fixshelf', '改名した本棚');
        await deleteShelf(page, 'e2e-parent');

        await expect.soft(card('fixshelf')).toContainText('改名した本棚');
        await expect.soft(card('e2e-parent')).toHaveCount(0);
    });
});

// 390 幅: 詳細を開いたまま、下のナビの「本棚」からツリーを出して本棚フォームまでたどり着ける
test.describe('390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('(g) 詳細を開いたまま、ツリーから本棚の名前を変えると、チップの名前が変わっている', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: false });
        await page.locator('#mobile-bottom-nav [data-mobile-nav="shelves"]').click();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);

        await renameShelf(page, 'fixshelf', '改名した本棚');

        await expect.soft(chip(page, 'fixshelf')).toContainText('改名した本棚');
        await expect.soft(page.locator('body')).toHaveClass(/book-detail-pinned/);
    });
});
