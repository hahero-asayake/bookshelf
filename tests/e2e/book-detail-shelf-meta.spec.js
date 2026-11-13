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

// ツリーの「…」を開く。子の本棚は、上の本棚 (ancestors に上から順に書く) が畳まれていれば展開してから
async function openTreeMenu(page, slug, ancestors = []) {
    const tree = page.locator('#sidebar-bookshelf-tree');
    for (const key of ['all', ...ancestors]) {
        const toggle = tree.locator(`.tree-node[data-bookshelf-id="${key}"] .tree-toggle`);
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
    const node = tree.locator(`.tree-node[data-bookshelf-id="${slug}"]`);
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

async function createShelf(page, name) {
    await page.locator('#sidebar-add-bookshelf').click();
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
    await page.locator('#bookshelf-name').fill(name);
    await saveForm(page);
}

const shelfExists = (page, slug) => page.evaluate((s) => !!window.bookshelf.userData.bookshelves.find((b) => b.id === s), slug);
const chip = (page, slug) => page.locator(`#current-bookshelves-${ASIN} .bd-chip[data-bookshelf-id="${slug}"]`);
const chips = (page) => page.locator(`#current-bookshelves-${ASIN} .bd-chip`);
const option = (page, slug) => page.locator(`#book-detail-pane .bookshelf-select option[value="${slug}"]`);

// 詳細の今の状態 (赤の記録用。詳細が開いているか・チップ・選択肢・書名の欄)
async function detailState(page) {
    return page.evaluate((asin) => {
        const row = document.getElementById(`current-bookshelves-${asin}`);
        return {
            pinned: document.body.classList.contains('book-detail-pinned'),
            chips: row ? Array.from(row.querySelectorAll('.bd-chip')).map((c) => ({
                id: c.dataset.bookshelfId,
                name: c.textContent.replace('×', '').trim(),
                icon: c.querySelector('.bd-chip-icon')?.dataset.iconValue,
                ctx: c.classList.contains('is-context'),
            })) : null,
            options: Array.from(document.querySelectorAll('#book-detail-pane .bookshelf-select option')).filter((o) => o.value).map((o) => `${o.value}=${o.textContent}`),
            title: document.querySelector('#book-detail-pane input.edit-title')?.value ?? null,
        };
    }, ASIN);
}

async function logState(page, label) {
    console.log(`[#623] ${label}: ${JSON.stringify(await detailState(page))}`);
}

// 詳細が閉じていない・未保存の書名が残っている (edit の時だけ)
async function expectDetailKept(page, edit) {
    await expect.soft(page.locator('body')).toHaveClass(/book-detail-pinned/, { timeout: 1500 });
    if (edit) await expect.soft(page.locator('#book-detail-pane input.edit-title')).toHaveValue('未保存の書名', { timeout: 1500 });
}

const T = { timeout: 1500 };

for (const [label, edit] of [['閲覧モード', false], ['編集モード', true]]) {
    test.describe(`PC 幅・${label}`, () => {
        test(`(a) ${label}: 本が入っている本棚の名前を変えると、すぐにチップの名前が変わる`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect(chip(page, 'fixshelf')).toContainText('テスト本棚');

            await renameShelf(page, 'fixshelf', '改名した本棚');
            await logState(page, `(a)${label}`);

            await expect.soft(chip(page, 'fixshelf')).toContainText('改名した本棚', T);
            await expect.soft(chips(page).filter({ hasText: 'テスト本棚' })).toHaveCount(0, T);
            await expectDetailKept(page, edit);
        });

        test(`(b) ${label}: 本が入っている本棚のアイコンを変えると、すぐにチップのアイコンが変わる`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect(chip(page, 'fixshelf').locator('.bd-chip-icon')).toHaveAttribute('data-icon-value', 'library');

            await changeIcon(page, 'fixshelf', 'rocket');
            await logState(page, `(b)${label}`);

            await expect.soft(chip(page, 'fixshelf').locator('.bd-chip-icon')).toHaveAttribute('data-icon-value', 'rocket', T);
            await expectDetailKept(page, edit);
        });

        test(`(c) ${label}: 本が入っている本棚を削除すると、子の本棚の分も含めてすぐにチップが消える`, async ({ page }) => {
            await bootApp(page);
            await openFromHome(page, { edit });
            await expect(chips(page)).toHaveCount(3);

            await deleteShelf(page, 'e2e-parent');
            expect(await shelfExists(page, 'e2e-child')).toBe(false);
            await logState(page, `(c)${label}`);

            await expect.soft(chip(page, 'e2e-parent')).toHaveCount(0, T);
            await expect.soft(chip(page, 'e2e-child')).toHaveCount(0, T);
            await expect.soft(chips(page)).toHaveCount(1, T);
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
        await logState(page, '(d-1)');

        await expect.soft(option(page, 'e2e-other')).toHaveText('改名した候補', T);
        await expectDetailKept(page, true);
    });

    test('(d-2) 本が入っていない本棚を削除すると、すぐに選択肢から消える', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(option(page, 'e2e-other')).toHaveCount(1);

        await deleteShelf(page, 'e2e-other');
        await logState(page, '(d-2)');

        await expect.soft(option(page, 'e2e-other')).toHaveCount(0, T);
        await expectDetailKept(page, true);
    });

    test('(d-3) 本棚を新しく作ると、すぐに選択肢に出る', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });

        await createShelf(page, '新しく作った本棚');
        await logState(page, '(d-3)');

        await expect.soft(page.locator('#book-detail-pane .bookshelf-select option', { hasText: '新しく作った本棚' })).toHaveCount(1, T);
        await expectDetailKept(page, true);
    });

    test('(f) 本が入っている本棚の親を、本が入っていない本棚に付け替えると、補充された親のチップがすぐに出て選択肢から消える', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: true });
        await expect(chip(page, 'e2e-other')).toHaveCount(0);

        await reparentShelf(page, 'e2e-child', 'e2eother01', ['e2e-parent']);
        const inOther = await page.evaluate((a) => window.bookshelf.userData.bookshelves.find((b) => b.id === 'e2e-other').books.includes(a), ASIN);
        console.log(`[#623] (f) 付け替え後に「入っていない本棚」へ本1が補充されたか: ${inOther}`);
        await logState(page, '(f)');

        await expect.soft(chip(page, 'e2e-other')).toHaveCount(inOther ? 1 : 0, T);
        await expect.soft(option(page, 'e2e-other')).toHaveCount(inOther ? 0 : 1, T);
        await expectDetailKept(page, true);
    });
});

test.describe('PC 幅・いま開いている本棚', () => {
    test('(e) 開いている本棚の本の詳細を開いたまま、その本棚を削除すると、すぐにチップが消える', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => { location.hash = '#/bookshelf/fixshelf'; });
        await page.locator(`.book-item[data-asin="${ASIN}"]`).first().click();
        await expect(chip(page, 'fixshelf')).toHaveClass(/is-context/);

        await deleteShelf(page, 'fixshelf');
        await logState(page, '(e)');

        await expect.soft(chip(page, 'fixshelf')).toHaveCount(0, T);
        await expectDetailKept(page, false);
    });
});

// 詳細の外 (同じ種類の古い表示の洗い出し): ホームの本棚のカードが、改名・削除の後に今の本棚に合うか
test.describe('PC 幅・ホームの本棚のカード', () => {
    test('(h) 詳細を開いたまま改名・削除すると、ホームの本棚のカードも今の本棚に合う', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: false });
        const card = (slug) => page.locator(`.bookshelf-preview[data-bookshelf-id="${slug}"]`);
        console.log(`[#623] (h) 開いた直後のホームのカード: ${JSON.stringify(await page.locator('.bookshelf-preview').evaluateAll((els) => els.map((e) => `${e.dataset.bookshelfId}=${e.querySelector('h3')?.textContent.trim()}`)))}`);

        await renameShelf(page, 'fixshelf', '改名した本棚');
        await deleteShelf(page, 'e2e-parent');
        console.log(`[#623] (h) 改名・削除の後のホームのカード: ${JSON.stringify(await page.locator('.bookshelf-preview').evaluateAll((els) => els.map((e) => `${e.dataset.bookshelfId}=${e.querySelector('h3')?.textContent.trim()}`)))}`);

        await expect.soft(card('fixshelf')).toContainText('改名した本棚', T);
        await expect.soft(card('e2e-parent')).toHaveCount(0, T);
    });
});

// 390 幅: 詳細を開いたまま、下のナビの「本棚」からツリーを出して本棚フォームまでたどり着けるか
test.describe('390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('(g) 詳細を開いたまま、ツリーから本棚の名前を変えると、詳細に戻った時にチップの名前が変わっている', async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, { edit: false });
        await logState(page, '(g) 開いた直後');
        const navShelves = page.locator('#mobile-bottom-nav [data-mobile-nav="shelves"]');
        console.log(`[#623] (g) 下のナビの「本棚」が見えるか: ${await navShelves.isVisible()}`);
        await navShelves.click();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
        await logState(page, '(g) ツリーを出した後');

        await renameShelf(page, 'fixshelf', '改名した本棚');
        await logState(page, '(g) 改名の後');
        await expect.soft(chip(page, 'fixshelf')).toContainText('改名した本棚', T);
        await expect.soft(page.locator('body')).toHaveClass(/book-detail-pinned/, T);
    });
});
