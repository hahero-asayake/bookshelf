// イシュー#631: 日付だけを入れる欄 (本の詳細の編集モードの「購入日」・手動追加の「読み終えた日」) と、
// 取得日時 (acquiredTime・ミリ秒) の行き来を、閲覧の表示と同じ「端末のタイムゾーンの日付」で行うことを確かめる。
//  - 欄を変えずに保存した時は acquiredTime を書き換えない (元の値をミリ秒まで保つ)
//  - 欄を変えた時・手動追加で日付を入れた時は、その日付がそのまま閲覧に出る (保存値はその日の端末の0時)
// 直す前は、欄の初期値が UTC の日付・保存が UTC の0時だった。そのため JST の 0〜9時に取得した本は
// 変えずに保存するだけで1日前になり、UTC より西のタイムゾーンではどの本も保存のたびに1日前になった。
// タイムゾーンは describe ごとにテスト側で固定する (手元は JST・CI は UTC で動くため、固定しないと判定が環境で変わる)。
import { test, expect } from './helpers/test-base.js';
import { openSettingsByClick } from './helpers/settings.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// フィクスチャの本2。acquiredTime 1700000001000 は
// UTC 2023-11-14 22:13:21 = 東京 2023-11-15 07:13:21 = ロサンゼルス 2023-11-14 14:13:21
const ASIN = 'B000000002';
const ACQUIRED = 1700000001000;
const NEW_ASIN = 'B0DATE0631';

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

// タイムゾーンの固定が効いていることを先に確かめる (効いていなければ、後ろの判定は意味を持たない)
async function expectTimezoneOffset(page, minutes) {
    expect(await page.evaluate(() => new Date(2023, 10, 15, 12).getTimezoneOffset()), 'テスト側のタイムゾーンの固定').toBe(minutes);
}

async function openDetail(page, asin) {
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.locator(`#bookshelf .book-item[data-asin="${asin}"]`).first().click();
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
}

async function enterEdit(page) {
    await page.click('.edit-mode-btn');
    await expect(page.locator('.bd.editing')).toBeVisible();
}

// topbar の編集終了ボタン = 保存。保存が済むと閲覧モードへ描き直される
async function saveEdit(page) {
    await page.click('.bd-edit-toggle.cancel-edit-btn');
    await expect(page.locator('.bd.editing')).toHaveCount(0);
}

const purchased = (page) => page.locator('#book-detail-pane .bd-meta-row', { hasText: '購入' });
const dateField = (page, asin) => page.locator(`.edit-acquired-time[data-asin="${asin}"]`);
const acquiredTimeOf = (page, asin) => page.evaluate((a) => window.bookshelf.books.find((b) => b.asin === a).acquiredTime, asin);

// 手動追加 (設定 → 蔵書 → 手動で追加)。「読み終えた日」に日付を入れて追加し、開いた画面を閉じる
async function addManually(page, asin, title, date) {
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await openSettingsByClick(page, 'library-section');
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(asin);
    await page.locator('#manual-title').fill(title);
    await page.locator('#manual-acquired-date').fill(date);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
}

test.describe('東京のタイムゾーン', () => {
    test.use({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });

    test('T1 東京 編集を開いて何も変えずに保存しても取得日時と購入の日付が変わらない', async ({ page }) => {
        await bootApp(page);
        await expectTimezoneOffset(page, -540);
        await openDetail(page, ASIN);
        await expect(purchased(page)).toContainText('2023/11/15');
        await enterEdit(page);
        await expect.soft(dateField(page, ASIN), '編集欄の初期値は閲覧と同じ端末の日付').toHaveValue('2023-11-15');
        await saveEdit(page);
        expect.soft(await acquiredTimeOf(page, ASIN), '変えずに保存したら acquiredTime は元のまま').toBe(ACQUIRED);
        await expect.soft(purchased(page), '閲覧の購入は元の日付のまま').toContainText('2023/11/15');
    });

    test('T3 東京 欄の日付を変えて保存するとその日付が閲覧と欄に出て保存値はその日の0時になる', async ({ page }) => {
        await bootApp(page);
        await expectTimezoneOffset(page, -540);
        await openDetail(page, ASIN);
        await enterEdit(page);
        await dateField(page, ASIN).fill('2023-11-20');
        await saveEdit(page);
        await expect.soft(purchased(page), '閲覧の購入は欄で選んだ日付').toContainText('2023/11/20');
        expect.soft(await acquiredTimeOf(page, ASIN), '保存値は選んだ日付の東京の0時').toBe(new Date('2023-11-20T00:00:00+09:00').getTime());
        await enterEdit(page);
        await expect.soft(dateField(page, ASIN), 'もう一度編集を開くと欄は選んだ日付').toHaveValue('2023-11-20');
    });

    test('T6 東京 手動追加で入れた日付がそのまま閲覧の購入に出る', async ({ page }) => {
        await bootApp(page);
        await expectTimezoneOffset(page, -540);
        await addManually(page, NEW_ASIN, '日付の確認の本', '2023-11-20');
        await openDetail(page, NEW_ASIN);
        await expect.soft(purchased(page), '閲覧の購入は手動追加で入れた日付').toContainText('2023/11/20');
    });
});

test.describe('ロサンゼルスのタイムゾーン', () => {
    test.use({ locale: 'ja-JP', timezoneId: 'America/Los_Angeles' });

    test('T2 ロサンゼルス 編集を開いて何も変えずに保存しても取得日時と購入の日付が変わらない', async ({ page }) => {
        await bootApp(page);
        await expectTimezoneOffset(page, 480);
        await openDetail(page, ASIN);
        await expect(purchased(page)).toContainText('2023/11/14');
        await enterEdit(page);
        await expect.soft(dateField(page, ASIN), '編集欄の初期値は閲覧と同じ端末の日付').toHaveValue('2023-11-14');
        await saveEdit(page);
        expect.soft(await acquiredTimeOf(page, ASIN), '変えずに保存したら acquiredTime は元のまま').toBe(ACQUIRED);
        await expect.soft(purchased(page), '閲覧の購入は元の日付のまま').toContainText('2023/11/14');
    });

    test('T4 ロサンゼルス 欄の日付を変えて保存するとその日付が閲覧と欄に出て保存値はその日の0時になる', async ({ page }) => {
        await bootApp(page);
        await expectTimezoneOffset(page, 480);
        await openDetail(page, ASIN);
        await enterEdit(page);
        await dateField(page, ASIN).fill('2023-11-20');
        await saveEdit(page);
        await expect.soft(purchased(page), '閲覧の購入は欄で選んだ日付').toContainText('2023/11/20');
        expect.soft(await acquiredTimeOf(page, ASIN), '保存値は選んだ日付のロサンゼルスの0時').toBe(new Date('2023-11-20T00:00:00-08:00').getTime());
        await enterEdit(page);
        await expect.soft(dateField(page, ASIN), 'もう一度編集を開くと欄は選んだ日付').toHaveValue('2023-11-20');
    });

    test('T5 ロサンゼルス 手動追加で入れた日付がそのまま閲覧の購入に出る', async ({ page }) => {
        await bootApp(page);
        await expectTimezoneOffset(page, 480);
        await addManually(page, NEW_ASIN, '日付の確認の本', '2023-11-20');
        await openDetail(page, NEW_ASIN);
        await expect.soft(purchased(page), '閲覧の購入は手動追加で入れた日付').toContainText('2023/11/20');
        expect.soft(await acquiredTimeOf(page, NEW_ASIN), '保存値は入れた日付のロサンゼルスの0時').toBe(new Date('2023-11-20T00:00:00-08:00').getTime());
    });
});
