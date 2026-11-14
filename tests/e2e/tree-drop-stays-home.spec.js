// イシュー#649: ツリーで本棚をドラッグして離した後に、ブラウザが出す click が掴んだ行へ届き、
// 掴んだ本棚の一覧が開いてホームを離れていた。原因は、並べ替えの部品 (js/ui/reorder.js) が掴んだ行に
// pointer capture を付けるため、click が掴んだ行に出ること (scripts/verify/649-results.md §1)。
// 部品は、ドラッグが始まった時だけ、終わった後の click を1回捨てる (次の pointerdown か 400ms で口を外す)。
// ここでは次を確かめる:
//   - 落とす・別の親の端・外へ落とす・Esc・循環 のどれでも、ホームのまま (body.app-view-main・hash が空)
//   - 真ん中・別の親の端へ落とした時は、確認の後に親が付け替わる
//   - 正しいクリックは捨てない (ドラッグの直後 400ms 以内のクリック・6px 未満で離したクリック)
//   - 同じ部品を使う本棚管理のモーダル・ホームの部品も、ドラッグの後に何も開かない・「選んで置く」にならない
// 起動は tests/e2e/book-detail-shelf-meta.spec.js と同じ型 (fixture を localStorage に入れ、保存だけ差し替える)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);

// ツリーの「すべての本」と、渡した本棚 (上から順に書く) が畳まれていれば展開する (book-detail-shelf-meta.spec.js と同じ)
async function expandTree(page, ancestors = []) {
    for (const key of ['all', ...ancestors]) {
        const toggle = treeNode(page, key).locator('.tree-toggle');
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
}

// all と p649 を展開した時のツリーの並び: all / fixshelf / p649 / c649 (p649 の子) / s649a / s649b / s649c
async function bootApp(page) {
    await page.addInitScript(([userData, library, asin]) => {
        const ud = JSON.parse(userData);
        const add = (id, internalId, name, parent) => ud.bookshelves.push({ id, internalId, name, iconName: 'library', books: [asin], isSpecial: false, parent });
        add('p649', 'p649iid01', '親P', 'fixall001');
        add('c649', 'c649iid01', '子C', 'p649iid01');
        add('s649a', 's649aiid01', '兄弟A', 'fixall001');
        add('s649b', 's649biid01', '兄弟B', 'fixall001');
        add('s649c', 's649ciid01', '兄弟C', 'fixall001');
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary, ASIN]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await expandTree(page, ['p649']);
    await expect(treeNode(page, 'c649')).toBeVisible();
    await expectHome(page);
}

// マウスのドラッグ (book-detail-shelf-meta.spec.js の mouseDrag と同じ手順。落とす先は隣の行にする)
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

// 遠くへ運ぶ時: 元の行の中で横へ 10px 動かしてドラッグを始めてから運ぶ (ドラッグは元の行の上で 6px を超えた時に
// 始まる＝2行以上先へいきなり運ぶと始まらない。#638 の落とし穴)。beforeUp は離す直前に行う操作 (Esc など)
async function mouseDragFar(page, fromBox, toPoint, { beforeUp } = {}) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 10, y0, { steps: 4 });
    await expect(page.locator('#sidebar-bookshelf-tree .tree-node.tree-dragging')).toHaveCount(1);
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.move(toPoint.x, toPoint.y);
    await page.waitForTimeout(80);
    if (beforeUp) await beforeUp();
    await page.mouse.up();
}

const box = (page, slug) => treeNode(page, slug).boundingBox();
const at = (b, ratio) => ({ x: b.x + b.width / 2, y: b.y + b.height * ratio });
const parentOf = (page, slug) => page.evaluate((s) => window.bookshelf.userData.bookshelves.find((b) => b.id === s)?.parent || null, slug);
const hashOf = (page) => page.evaluate(() => location.hash);

async function expectHome(page) {
    await expect(page.locator('body')).toHaveClass(/app-view-main/);
    expect(await hashOf(page)).toBe('');
}

// 離した後の click は、離してから 0〜14ms で出る (649-results.md §1)。一覧へ移る処理がもし走るなら
// 済んでいる時間だけ置いてから、ホームのままかを見る
async function settleAfterDrop(page) {
    await page.waitForTimeout(300);
}

test.describe('ツリーで本棚を落とした後もホームのまま (イシュー#649)', () => {
    test('1. 本棚の真ん中へ落とす → 確認で移動する → ホームのままで、親が付け替わる', async ({ page }) => {
        await bootApp(page);
        await mouseDrag(page, await box(page, 's649b'), at(await box(page, 's649c'), 0.5));
        await page.locator('.cfm-overlay .cfm-ok').click();
        await expect.poll(() => parentOf(page, 's649b')).toBe('s649ciid01');
        await settleAfterDrop(page);
        await expectHome(page);
    });

    test('2. 別の親の本棚の下の端へ落とす → 確認で移動する → ホームのままで、親が付け替わる', async ({ page }) => {
        await bootApp(page);
        await mouseDrag(page, await box(page, 's649a'), at(await box(page, 'c649'), 0.85));
        await page.locator('.cfm-overlay .cfm-ok').click();
        await expect.poll(() => parentOf(page, 's649a')).toBe('p649iid01');
        await settleAfterDrop(page);
        await expectHome(page);
    });

    test('3. ツリーの外へ落とす → ホームのままで、親は変わらない', async ({ page }) => {
        await bootApp(page);
        await mouseDragFar(page, await box(page, 's649b'), { x: 800, y: 450 });
        await expect(page.locator('#sidebar-bookshelf-tree .tree-node.tree-dragging')).toHaveCount(0);
        await settleAfterDrop(page);
        await expectHome(page);
        expect(await parentOf(page, 's649b')).toBe('fixall001');
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
    });

    test('4. ドラッグ中に Esc で取り消してから離す → ホームのままで、親は変わらない', async ({ page }) => {
        await bootApp(page);
        await mouseDragFar(page, await box(page, 's649b'), at(await box(page, 's649c'), 0.5), {
            beforeUp: async () => {
                await page.keyboard.press('Escape');
                await expect(page.locator('#sidebar-bookshelf-tree .tree-node.tree-dragging')).toHaveCount(0);
            },
        });
        await settleAfterDrop(page);
        await expectHome(page);
        expect(await parentOf(page, 's649b')).toBe('fixall001');
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
    });

    test('5. 親を自分の子の真ん中へ落とす → 循環の知らせが出て、ホームのまま', async ({ page }) => {
        await bootApp(page);
        await mouseDrag(page, await box(page, 'p649'), at(await box(page, 'c649'), 0.5));
        await expect(page.locator('.toast', { hasText: '循環参照になるため移動できません' })).toBeVisible();
        await settleAfterDrop(page);
        await expectHome(page);
        expect(await parentOf(page, 'p649')).toBe('fixall001');
    });

    test('6. ドラッグの直後 (400ms 以内) に別の行を普通にクリックすると、その本棚の一覧が開く', async ({ page }) => {
        await bootApp(page);
        const target = await box(page, 's649a');
        const t0 = Date.now();
        await mouseDragFar(page, await box(page, 's649b'), { x: 800, y: 450 });
        const tUp = Date.now();
        await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
        // 捨てる口が開いている 400ms の中で押したことを確かめる (離してから押すまで)
        expect(Date.now() - tUp).toBeLessThan(400);
        expect(tUp - t0).toBeGreaterThan(0);
        await expect.poll(() => hashOf(page)).toBe('#/bookshelf/s649a');
        await expect(page.locator('body')).not.toHaveClass(/app-view-main/);
    });

    test('7. 6px 未満しか動かさずに離したクリックは、ドラッグにならず、その本棚の一覧が開く', async ({ page }) => {
        await bootApp(page);
        const b = await box(page, 's649b');
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2, { steps: 2 });
        await expect(page.locator('#sidebar-bookshelf-tree .tree-node.tree-dragging')).toHaveCount(0);
        await page.mouse.up();
        await expect.poll(() => hashOf(page)).toBe('#/bookshelf/s649b');
        await expect(page.locator('body')).not.toHaveClass(/app-view-main/);
    });

    test('8. 本棚管理のモーダルでつまみを運んでも、モーダルは開いたままでホームも離れない (同じ部品の見張り)', async ({ page }) => {
        await bootApp(page);
        await page.keyboard.press('Control+k');
        await page.locator('#cmdk-input').fill('本棚を管理');
        await page.keyboard.press('Enter');
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        const item = (key) => page.locator(`#bookshelf-modal .bookshelf-item[data-internal-id="${key}"]`);
        // 一覧はモーダルの中で縦に流れる。本棚が7つあると下の行が見えていないことがあるので、先に見える所へ出す
        await item('s649ciid01').scrollIntoViewIfNeeded();
        const from = await item('s649biid01').locator('.bookshelf-drag-handle').boundingBox();
        const to = await item('s649ciid01').boundingBox();
        await mouseDrag(page, from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
        await page.locator('.cfm-overlay .cfm-ok').click();
        await expect.poll(() => parentOf(page, 's649b')).toBe('s649ciid01');
        await settleAfterDrop(page);
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        await expectHome(page);
    });

    test('9. ホームの部品をつまみから運んでも、「選んで置く」にならない (同じ部品の見張り)', async ({ page }) => {
        await bootApp(page);
        await page.click('#dashboard-edit-toggle');
        const grip = page.locator('#dashboard-grid .dashboard-widget').first().locator('.widget-grip');
        await expect(grip).toBeVisible();
        const g = await grip.boundingBox();
        await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
        await page.mouse.down();
        await page.mouse.move(g.x + g.width / 2 + 10, g.y + g.height / 2, { steps: 4 });
        await expect(page.locator('#dashboard-grid .dashboard-widget.is-dragging, #dashboard-grid .dashboard-widget.widget-dragging, .drag-ghost')).not.toHaveCount(0);
        await page.mouse.move(120, 800, { steps: 5 });
        await page.mouse.up();
        await settleAfterDrop(page);
        await expect(page.locator('#dashboard-grid')).not.toHaveClass(/is-picking/);
        await expectHome(page);
    });
});
