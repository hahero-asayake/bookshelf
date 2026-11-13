// イシュー#595: 記事エディタで入力して 600ms 以内 (保存の予約が発火する前) に画面を離れても、
// 記事が一覧・保存先・下書きに残ること。離れる経路ごとに1本ずつ (H1〜H6・step1 の穴の一覧)。
// 新規作成は閲覧状態で開き、題名はそのまま打てる (J5-1 と同じ入口)。
import { test, expect } from './helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from './helpers/gate-setup.js';
import { mockSyncReady } from './helpers/sync.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const articleRow = (page, title) => page.locator('#art-list .pp-row', { hasText: title });

async function bootWithStorage(page) {
    await seedLibraryForTest(page);
    await bootAppForTest(page);
    await stubStorageForTest(page);
    await mockSyncReady(page, true);
}

// 下のナビ「本棚」→ 引き出しの「公開」。引き出しが開いたままの時 (一覧を閉じた直後) は「公開」だけを押す
async function openArticleList(page, { drawerOpen = false } = {}) {
    if (!drawerOpen) await page.locator('[data-mobile-nav="shelves"]').tap();
    await page.locator('#sidebar-publish').tap();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await expect(page.locator('#art-list-view')).toBeVisible();
}

async function newArticleWithTitle(page, title) {
    await page.locator('#art-new').tap();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await page.locator('#art-title').fill(title);
}

// 保存先への書き込みを失敗させる (保存先の模擬だけを差し替える)
const failStorageWrites = (page) => page.evaluate(() => {
    const a = window.bookshelf.storage.adapter;
    a.writeJSON = async () => { throw new Error('書き込みの失敗の模擬'); };
    a.writeText = async () => { throw new Error('書き込みの失敗の模擬'); };
});

test('H1 題名を入れてすぐ「記事の一覧」で戻っても、一覧にその記事が出る', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    await newArticleWithTitle(page, 'H1 すぐ戻る記事');
    await page.locator('#art-back').tap();
    await expect(page.locator('#art-list-view')).toBeVisible();
    await expect(articleRow(page, 'H1 すぐ戻る記事')).toHaveCount(1);
});

test('H2 題名を入れてすぐブラウザの戻るで戻っても、一覧にその記事が出る', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    await newArticleWithTitle(page, 'H2 戻るで戻る記事');
    await page.goBack();
    await expect(page.locator('#art-list-view')).toBeVisible();
    await expect(articleRow(page, 'H2 戻るで戻る記事')).toHaveCount(1);
});

test('H3 題名を入れてすぐEscで閉じても、開き直した一覧にその記事が出る', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    await newArticleWithTitle(page, 'H3 すぐ閉じる記事');
    await page.keyboard.press('Escape');
    await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
    await openArticleList(page, { drawerOpen: true });
    await expect(articleRow(page, 'H3 すぐ閉じる記事')).toHaveCount(1);
});

test('H4 すぐ戻ってすぐ次の記事を作っても、前の記事の題名が消えない', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    await newArticleWithTitle(page, 'H4 前の記事');
    await page.locator('#art-back').tap();
    await page.locator('#art-new').tap();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await page.locator('#art-back').tap();
    await expect(page.locator('#art-list-view')).toBeVisible();
    await expect(articleRow(page, 'H4 前の記事')).toHaveCount(1);
    await expect(articleRow(page, '無題の記事')).toHaveCount(0);
});

test('H4\' 既存の記事を直してすぐ別の記事を開いても、直した分が残り、開いた記事は書き換わらない', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    for (const title of ['H4d 記事A', 'H4d 記事B']) {
        await newArticleWithTitle(page, title);
        await page.locator('#art-back').tap();
        await expect(articleRow(page, title)).toHaveCount(1);
    }
    const updatedAtOfB = () => page.evaluate(() => window.bookshelf.publishArticleStore.articles().find((a) => a.title === 'H4d 記事B').updatedAt);
    const before = await updatedAtOfB();
    await articleRow(page, 'H4d 記事A').locator('[data-act="edit"]').tap();
    await page.locator('#art-title').fill('H4d 記事A 直した');
    await page.locator('#art-back').tap();
    await articleRow(page, 'H4d 記事B').locator('[data-act="edit"]').tap();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await page.locator('#art-back').tap();
    await expect(articleRow(page, 'H4d 記事A 直した')).toHaveCount(1);
    // 開いただけの記事Bは、無変更のまま (updatedAt が進むと公開済みの記事が「未反映の変更あり」に化ける)
    expect(await updatedAtOfB()).toBe(before);
});

test('H5 題名を入れてすぐタブが裏に回っても、その時点で下書きが端末に残る', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    await newArticleWithTitle(page, 'H5 裏に回る記事');
    // タブを閉じる・裏に回る時に来るイベント。発火した直後 (同じ処理の中) に端末の下書きを読む
    const drafts = await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        return Object.keys(localStorage).filter((k) => k.startsWith('bookshelf_art_draft_')).map((k) => localStorage.getItem(k));
    });
    expect(drafts.some((d) => d.includes('H5 裏に回る記事'))).toBe(true);
});

test('H6 保存先に送れない時は←でその場にとどまり、閉じて開き直しても記事が消えない', async ({ page }) => {
    await bootWithStorage(page);
    await openArticleList(page);
    await failStorageWrites(page);
    await newArticleWithTitle(page, 'H6 送れない記事');
    await page.locator('#art-back').tap();
    // 送れなかった=編集状態と同じくその場にとどまり、保存できなかったことを知らせる
    await expect(page.locator('#art-save-status')).toContainText('保存できませんでした');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
    // 開き直しても、まだ送れていない記事を保存先から読み直して捨てない
    await openArticleList(page, { drawerOpen: true });
    await expect(articleRow(page, 'H6 送れない記事')).toHaveCount(1);
});
