// イシュー#620: 本の詳細を開いたまま本棚に追加・一括で追加/外すと、詳細の本棚のチップと「本棚を追加...」の
// 選択肢が、その場で今の所属に合う (詳細の全体は描き直さず、未保存の入力を消さない)。
// 起動は tests/e2e/char/bookdetail.spec.js と同じ型 (fixture を localStorage に入れ、本はクリックで開く)。
// 保存 (saveUserData) だけを差し替える。本棚の親子は、この spec の addInitScript の中だけで足す。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';
const ASIN2 = 'B000000002';

// fixture の「テスト本棚」(fixshelf・本1が所属) に加えて、本1が入っていない本棚を3つ足す (親子を1組含む)
async function bootApp(page, { saveDelayMs = 0 } = {}) {
    await page.addInitScript(([userData, library]) => {
        const ud = JSON.parse(userData);
        ud.bookshelves.push({ id: 'e2e-shelf', internalId: 'e2eshelf01', name: '追加用の本棚', books: [], isSpecial: false, parent: 'fixall001' });
        ud.bookshelves.push({ id: 'e2e-parent', internalId: 'e2eparent01', name: '親の本棚', books: [], isSpecial: false, parent: 'fixall001' });
        ud.bookshelves.push({ id: 'e2e-child', internalId: 'e2echild01', name: '子の本棚', books: [], isSpecial: false, parent: 'e2eparent01' });
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    // 保存は待ち時間だけを模す (0 なら即座に終わる)。(i) の場面では、この待ちの間に閉じる・別の本を開く
    await page.evaluate((ms) => {
        window.bookshelf.saveUserData = () => new Promise((resolve) => setTimeout(resolve, ms));
    }, saveDelayMs);
}

// ホームの「最近追加した本」から、クリックだけで本の詳細を開く。edit なら編集モードへ切り替える
async function openFromHome(page, asin, { edit = true } = {}) {
    await page.locator(`.widget-book-cell[data-asin="${asin}"]`).first().click();
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
    if (edit) {
        await page.click('#book-detail-pane .edit-mode-btn');
        await expect(page.locator('#book-detail-pane .bookshelf-select')).toBeVisible();
    }
}

async function addShelf(page, slug) {
    await page.locator('#book-detail-pane .bookshelf-select').selectOption(slug);
    await page.locator('#book-detail-pane .add-to-bookshelf').click();
}

const chips = (page) => page.locator(`#current-bookshelves-${ASIN} .bd-chip`);
const option = (page, slug) => page.locator(`#book-detail-pane .bookshelf-select option[value="${slug}"]`);
const memberOf = (page, slug, asin = ASIN) => page.evaluate(([s, a]) => {
    const bs = window.bookshelf.userData.bookshelves.find((b) => b.id === s);
    return !!bs && (bs.books || []).includes(a);
}, [slug, asin]);

// PC 幅 (既定の chromium) と 390 幅 (スマホ) の両方で流す本体
function addCases(label) {
    test(`${label}: 編集モードで追加すると、すぐにチップが増え、追加した本棚が選択肢から消える (未保存の書名は残る)`, async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, ASIN);
        await expect(chips(page)).toHaveCount(1);
        await expect(option(page, 'e2e-shelf')).toHaveCount(1);
        // 書名の欄に未保存の文字を入れておく (上の ✓ でしか保存されない欄・詳細の全体を描き直すと消える)
        await page.locator('#book-detail-pane input.edit-title').fill('未保存の書名');

        await addShelf(page, 'e2e-shelf');

        await expect(chips(page)).toHaveCount(2);
        await expect(chips(page).filter({ hasText: '追加用の本棚' })).toHaveCount(1);
        await expect(option(page, 'e2e-shelf')).toHaveCount(0);
        await expect(page.locator('#book-detail-pane input.edit-title')).toHaveValue('未保存の書名');
        expect(await memberOf(page, 'e2e-shelf')).toBe(true);
    });

    test(`${label}: 子の本棚に追加すると親のチップも出て、両方が選択肢から消える。候補が0になると追加欄が消える`, async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, ASIN);

        await addShelf(page, 'e2e-child');

        await expect(chips(page)).toHaveCount(3);
        await expect(chips(page).filter({ hasText: '子の本棚' })).toHaveCount(1);
        await expect(chips(page).filter({ hasText: '親の本棚' })).toHaveCount(1);
        await expect(option(page, 'e2e-child')).toHaveCount(0);
        await expect(option(page, 'e2e-parent')).toHaveCount(0);

        // 書き換えた後の選択肢と「追加」でもう1つ足す (つなぎ直しの確認)。残りの候補が0になる
        await addShelf(page, 'e2e-shelf');
        await expect(chips(page)).toHaveCount(4);
        await expect(page.locator('#book-detail-pane .bd-add-bookshelf')).toHaveCount(0);
    });

    test(`${label}: 書き換えた後のチップの × で外せる (外すと詳細が閉じる今の動きのまま)`, async ({ page }) => {
        await bootApp(page);
        await openFromHome(page, ASIN);
        await addShelf(page, 'e2e-shelf');
        const added = chips(page).filter({ hasText: '追加用の本棚' });
        await expect(added).toHaveCount(1);

        await added.locator('.remove-from-bookshelf').click();
        await page.locator('.cfm-overlay .cfm-ok').click();

        await expect.poll(() => memberOf(page, 'e2e-shelf')).toBe(false);
        await expect(page.locator(`#current-bookshelves-${ASIN}`)).toHaveCount(0);
    });
}

test.describe('PC 幅', () => {
    addCases('PC');

    // (i) 保存を待つ間に閉じた・別の本を開いた時は、元の本を開き直さない
    test('保存を待つ間に Esc で詳細を閉じると、保存の後も閉じたまま', async ({ page }) => {
        await bootApp(page, { saveDelayMs: 1500 });
        await openFromHome(page, ASIN);
        await addShelf(page, 'e2e-shelf');
        await page.keyboard.press('Escape');
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);

        // 追加の処理の最後の知らせ (保存の後に出る) を待ってから確かめる
        await expect(page.locator('.toast', { hasText: '「追加用の本棚」に追加しました' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
        expect(await page.evaluate(() => location.hash)).not.toContain(`#book/${ASIN}`);
        expect(await memberOf(page, 'e2e-shelf')).toBe(true);
    });

    test('保存を待つ間に別の本を開くと、保存の後もその本のまま (元の本の編集モードへ戻らない)', async ({ page }) => {
        await bootApp(page, { saveDelayMs: 1500 });
        await openFromHome(page, ASIN);
        await addShelf(page, 'e2e-shelf');
        await page.locator(`.widget-book-cell[data-asin="${ASIN2}"]`).first().click();
        await expect(page.locator('#book-detail-pane .bd-title')).toHaveText('フィクスチャの本 2');

        await expect(page.locator('.toast', { hasText: '「追加用の本棚」に追加しました' })).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#book-detail-pane .bd-title')).toHaveText('フィクスチャの本 2');
        await expect(page.locator('#book-detail-pane .bookshelf-select')).toHaveCount(0);
        expect(await page.evaluate(() => location.hash)).toContain(`#book/${ASIN2}`);
    });

    // (ii) 閲覧モードで詳細を開いたまま、選択モードで一括に追加・外す
    async function openShelfBookAndSelect(page) {
        await page.evaluate(() => { location.hash = '#/bookshelf/fixshelf'; });
        const card = page.locator(`.book-item[data-asin="${ASIN}"]`).first();
        await card.click();
        await expect(chips(page)).toHaveCount(1);
        await page.click('#toggle-select-mode');
        await card.click();
    }

    test('閲覧モードで詳細を開いたまま一括で追加すると、詳細のチップが増える', async ({ page }) => {
        await bootApp(page);
        await openShelfBookAndSelect(page);

        await page.click('#bulk-add-shelf');
        await page.locator('#bulk-shelf-popover [data-bs-internal="e2eshelf01"]').click();

        await expect(chips(page)).toHaveCount(2);
        await expect(chips(page).filter({ hasText: '追加用の本棚' })).toHaveCount(1);
        expect(await memberOf(page, 'e2e-shelf')).toBe(true);
    });

    test('閲覧モードで詳細を開いたまま一括で外すと、詳細のチップが消える', async ({ page }) => {
        await bootApp(page);
        await openShelfBookAndSelect(page);

        await page.click('#bulk-remove-shelf');
        await page.locator('.cfm-overlay .cfm-ok').click();

        await expect(chips(page)).toHaveCount(0);
        await expect(page.locator(`#current-bookshelves-${ASIN}`)).toContainText('どの本棚にも追加されていません');
        expect(await memberOf(page, 'fixshelf')).toBe(false);
    });
});

test.describe('390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    addCases('390');
});
