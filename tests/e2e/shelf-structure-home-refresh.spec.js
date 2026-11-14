// イシュー#642: 本棚そのものを変える3つの経路 (本棚フォームでの親の付け替え・ツリーのドラッグでの親の付け替え・
// 子の本棚ごとの削除) の直後に、ホームの集計 (本棚別 Top5・本棚ハイライトのカードの冊数) と左ツリーの本棚の冊数が
// 今の本棚に合っていることを、利用者の操作で確かめる。親を付け替えると、移した本棚の本が新しい親へ補充される
// (#623)。#615 は評価・本の所属の変更の最後に _onLibraryChanged() を呼ぶ決まりにしたが、この3経路は入れていない。
// 場面は3つ。S1: ホームを表示したまま操作する。S2: ホームから本の詳細を開いたまま操作する (#615 の場面)。
// S3: 本棚の一覧を表示したまま操作し、左上のロゴ (ホーム) でホームへ戻ってから見る。S3 で開いておく本棚は、
// 消す本棚とその子ではない本棚にする (子の本棚を開いたまま親を消すと「すべて」へ切り替わらない不具合は #634 で扱う)。
// 390 幅は S1 の本棚フォームだけを見る。保存 (saveUserData) だけを差し替える。本棚の操作はすべて画面から行う。
// 描き直しは、ホーム表示中なら各経路の最後の updateBookshelfSelector() (ホームなら dashboard.render())、ホームへ戻る時は
// _applyRoute の dashboard.render() が担う (#642 step2 で、どちらかを外すとこの spec が赤になることを確かめた。
// 結果は scripts/verify/642-results.md)。蔵書の冊数は変わらないので _onLibraryChanged() は通さない。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// 蔵書は fixture の5冊 (F1〜F5) と、足した15冊 (N1〜N15) の20冊
const F = [1, 2, 3, 4, 5].map((n) => `B00000000${n}`);
const N = Array.from({ length: 15 }, (_, i) => `B0SH642${String(i + 1).padStart(3, '0')}`);
const EXTRA_BOOKS = N.map((asin, i) => ({
    asin, title: `本棚の集計の本 ${i + 1}`, authors: '集計 確認', acquiredTime: 1600000000000 + i * 1000,
    readStatus: 'UNKNOWN', productImage: '', source: 'kindle_import', addedDate: 1600000000000 + i * 1000
}));
const TOTAL = F.length + N.length;

// 利用者の本棚。冊数は全部ちがう (Top5 の並びが同数で揺れないように)。子は親の本の中から持つ。
// 受ける本棚 P1・P2 は、移す本棚に無い本を1冊だけ持つ (補充の後も、移す本棚と同じ冊数にならないように)。
//   消す本棚Q 14 > Qの子 13 > 移す本棚A1 11 > 移す本棚A2 9 > A1の子 4 > テスト本棚 3 (fixture) > A2の子 2 > 受ける本棚P1・P2 1
const SHELVES = [
    { id: 'q642', internalId: 'q642iid01', name: '消す本棚Q', parent: 'fixall001', books: N.slice(0, 14) },
    { id: 'qc642', internalId: 'qc642iid01', name: 'Qの子', parent: 'q642iid01', books: N.slice(0, 13) },
    { id: 'a1642', internalId: 'a1642iid01', name: '移す本棚A1', parent: 'fixall001', books: [...F, ...N.slice(0, 6)] },
    { id: 'a1c642', internalId: 'a1c642iid01', name: 'A1の子', parent: 'a1642iid01', books: F.slice(0, 4) },
    { id: 'p1642', internalId: 'p1642iid01', name: '受ける本棚P1', parent: 'fixall001', books: [N[14]] },
    { id: 'a2642', internalId: 'a2642iid01', name: '移す本棚A2', parent: 'fixall001', books: [...F, ...N.slice(6, 10)] },
    { id: 'a2c642', internalId: 'a2c642iid01', name: 'A2の子', parent: 'a2642iid01', books: [F[4], N[6]] },
    { id: 'p2642', internalId: 'p2642iid01', name: '受ける本棚P2', parent: 'fixall001', books: [N[14]] },
];

// 期待値 (手で数えた値)。本棚別 Top5 は「名前:冊数」を上から順に並べる
const TOP5_BEFORE = ['消す本棚Q:14', 'Qの子:13', '移す本棚A1:11', '移す本棚A2:9', 'A1の子:4'];
const CASES = {
    // ① 本棚フォームで A1 (子つき) を P1 の下へ。P1 = 自分の1冊 + A1 の11冊 = 12 冊。A1の子 (4) が Top5 から落ちる
    form: {
        label: '本棚フォームで親を付け替える',
        top5: ['消す本棚Q:14', 'Qの子:13', '受ける本棚P1:12', '移す本棚A1:11', '移す本棚A2:9'],
        counts: { p1642: 12 }, gone: [],
    },
    // ② ツリーで A2 (子つき) を P2 の真ん中へドラッグ。P2 = 自分の1冊 + A2 の9冊 = 10 冊
    drag: {
        label: 'ツリーのドラッグで親を付け替える',
        top5: ['消す本棚Q:14', 'Qの子:13', '移す本棚A1:11', '受ける本棚P2:10', '移す本棚A2:9'],
        counts: { p2642: 10 }, gone: [],
    },
    // ③ Q を削除 (Qの子も一緒に消える)。6位・7位だったテスト本棚 (3)・A2の子 (2) が繰り上がる
    delete: {
        label: '子つきの本棚を削除する',
        top5: ['移す本棚A1:11', '移す本棚A2:9', 'A1の子:4', 'テスト本棚:3', 'A2の子:2'],
        counts: {}, gone: ['q642', 'qc642'],
    },
};

async function bootApp(page) {
    await page.addInitScript(([userData, library, shelves, extraBooks]) => {
        const ud = JSON.parse(userData);
        const lib = JSON.parse(library);
        lib.books = [...lib.books, ...extraBooks];
        lib.metadata = { ...(lib.metadata || {}), totalBooks: lib.books.length };
        const all = lib.books.map((b) => b.asin);
        ud.bookshelves.find((s) => s.isSpecial).books = all.slice();
        ud.bookOrder = { ...(ud.bookOrder || {}), all: all.slice() };
        for (const s of shelves) ud.bookshelves.push({ iconName: 'library', isSpecial: false, ...s, books: s.books.slice() });
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(lib));
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary, SHELVES, EXTRA_BOOKS]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await expect(page.locator('body')).toHaveClass(/app-view-main/);
}

// ---- ツリーの操作 (tests/e2e/book-detail-shelf-meta.spec.js L41-120 の expandTree・mouseDrag・openTreeMenu・
// openEditForm・deleteShelf と同じ手順) ----
const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);

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

async function openTreeMenu(page, slug, ancestors = []) {
    await expandTree(page, ancestors);
    const node = treeNode(page, slug);
    await expect(node).toBeVisible();
    await node.hover();
    await node.locator('.tree-more').click();
    await expect(page.locator('#tree-node-menu')).toBeVisible();
}

const shelfOf = (page, slug) => page.evaluate((s) => {
    const bs = window.bookshelf.userData.bookshelves.find((b) => b.id === s);
    return bs ? { parent: bs.parent || null, count: (bs.books || []).length } : null;
}, slug);

// ① 本棚フォーム (ツリーの「…」→「編集」) で親を選んで保存する。親が変わる時は確認ダイアログが出る
async function reparentByForm(page, slug, parentKey) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="edit"]').click();
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
    await page.locator('#bookshelf-parent').selectOption(parentKey);
    await page.locator('#save-bookshelf-form').click();
    await page.locator('.cfm-overlay .cfm-ok').click();
    await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
    await expect.poll(async () => (await shelfOf(page, slug))?.parent).toBe(parentKey);
}

// ② ツリーで本棚を別の本棚の行の真ん中へ落とす = その本棚の子にする (確認ダイアログが出る)
async function reparentByDrag(page, slug, targetSlug, targetKey) {
    await expandTree(page);
    const from = await treeNode(page, slug).boundingBox();
    const to = await treeNode(page, targetSlug).boundingBox();
    await mouseDrag(page, from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
    await page.locator('.cfm-overlay .cfm-ok').click();
    await expect.poll(async () => (await shelfOf(page, slug))?.parent).toBe(targetKey);
}

// ③ ツリーの「…」→「削除」→ 確認ダイアログ (子の本棚も一緒に消える)
async function deleteShelf(page, slug) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="delete"]').click();
    await page.locator('.cfm-overlay .cfm-ok').click();
    await expect.poll(() => shelfOf(page, slug)).toBe(null);
}

async function runCase(page, kind) {
    if (kind === 'form') await reparentByForm(page, 'a1642', 'p1642iid01');
    else if (kind === 'drag') await reparentByDrag(page, 'a2642', 'p2642', 'p2642iid01');
    else await deleteShelf(page, 'q642');
}

// ---- 観測 (tests/e2e/library-count-refresh.spec.js L58-79 の locator と同じ形) ----
const top5Items = (page) => page.locator('#dashboard .widget-reading-stats .rs-shelves li');
// 1行は <span>名前</span><strong>冊数</strong>。期待値の「名前:冊数」を行の文字 (名前と冊数が続いたもの) に直して、上から順に比べる
const top5Texts = (list) => list.map((s) => s.replace(':', ''));
const homeTotal = (page) => page.locator('#dashboard .rs-total');
const sidebarAllCount = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-count');
const sidebarShelfCount = (page, slug) => page.locator(`#sidebar-bookshelf-tree [data-bookshelf-id="${slug}"] .bsr-count`);
const shelfCard = (page, slug) => page.locator(`#dashboard .bookshelf-preview[data-bookshelf-id="${slug}"]`);

// ホームの集計と左ツリーを期待値と比べる。1か所が違っても止めずに残りの観測点も見る (expect.soft)
async function expectHome(page, c) {
    await expect.soft(top5Items(page), '本棚別 Top5').toHaveText(top5Texts(c.top5));
    for (const [slug, n] of Object.entries(c.counts)) {
        await expect.soft(shelfCard(page, slug).locator('.book-count'), `本棚ハイライトのカード ${slug}`).toHaveText(`${n}冊`);
        await expect.soft(sidebarShelfCount(page, slug), `左ツリーの冊数 ${slug}`).toHaveText(String(n));
    }
    for (const slug of c.gone) {
        await expect.soft(shelfCard(page, slug), `消えた本棚のカード ${slug}`).toHaveCount(0);
        await expect.soft(treeNode(page, slug), `消えた本棚のツリーの行 ${slug}`).toHaveCount(0);
    }
    // 蔵書の冊数は変わらない
    await expect.soft(homeTotal(page)).toHaveText(`蔵書 ${TOTAL} 冊`);
    await expect.soft(sidebarAllCount(page)).toHaveText(String(TOTAL));
}

// 操作の後に、その場で見る場面 (S1・S2) の確かめ方。フォームと削除はホームのまま (詳細も開いたまま) で、その場で見る。
// ツリーのドラッグは、今は落とした直後にドラッグした本棚の一覧が開いてホームを離れる (#642 step1 で見つけた・範囲外)。
// ホームを離れるかどうかは確かめず (直っても赤にしない)、離れていたら左上のロゴでホームへ戻り、戻った時の値を見る
async function settleOnHome(page, kind, { detail = false } = {}) {
    if (kind === 'drag') {
        if (!/app-view-main/.test(await page.locator('body').getAttribute('class') || '')) {
            await page.locator('.sidebar-brand').click();
        }
        await expect(page.locator('body')).toHaveClass(/app-view-main/);
        return;
    }
    await expect(page.locator('body')).toHaveClass(/app-view-main/);
    if (detail) await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
}

test.describe('PC 幅 (1280x800)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    for (const kind of ['form', 'drag', 'delete']) {
        const c = CASES[kind];

        test(`S1 ホームを表示したまま${c.label}と、その場でホームの本棚別 Top5 と本棚の冊数が今の本棚に合う`, async ({ page }) => {
            await bootApp(page);
            await expect(top5Items(page)).toHaveText(top5Texts(TOP5_BEFORE));
            await runCase(page, kind);
            await settleOnHome(page, kind);
            await expectHome(page, c);
        });

        test(`S2 本の詳細を開いたまま${c.label}と、その場でホームの本棚別 Top5 と本棚の冊数が今の本棚に合う`, async ({ page }) => {
            await bootApp(page);
            await expect(top5Items(page)).toHaveText(top5Texts(TOP5_BEFORE));
            await page.locator('#dashboard .widget-book-cell').first().click();
            await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
            await runCase(page, kind);
            await settleOnHome(page, kind, { detail: true });
            await expectHome(page, c);
        });

        test(`S3 本棚の一覧を表示したまま${c.label}と、ホームへ戻った時に本棚別 Top5 と本棚の冊数が今の本棚に合う`, async ({ page }) => {
            await bootApp(page);
            await expect(top5Items(page)).toHaveText(top5Texts(TOP5_BEFORE));
            // 消す本棚・移す本棚とは関係のないテスト本棚を開いておく
            await expandTree(page);
            await treeNode(page, 'fixshelf').locator('.bsr-label').click();
            await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
            await runCase(page, kind);
            await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
            await page.locator('.sidebar-brand').click();
            await expect(page.locator('body')).toHaveClass(/app-view-main/);
            await expectHome(page, c);
        });
    }
});

// 390 幅 (スマホ): 下のナビの「本棚」からツリーを出し、本棚フォームで親を付け替える (S1 だけ)
test.describe('390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('S1 ホームから本棚フォームで親を付け替えると、その場でホームの本棚別 Top5 と本棚の冊数が今の本棚に合う', async ({ page }) => {
        await bootApp(page);
        await expect(top5Items(page)).toHaveText(top5Texts(TOP5_BEFORE));
        await page.locator('#mobile-bottom-nav [data-mobile-nav="shelves"]').click();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
        await runCase(page, 'form');
        await expect(page.locator('body')).toHaveClass(/app-view-main/);
        await expectHome(page, CASES.form);
    });
});
