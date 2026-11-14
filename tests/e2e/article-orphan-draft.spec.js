// イシュー#599: 新規記事に入力して、保存先 (ハブ) へ届く前にタブが落ちても (再読込しても)、入力が戻ること。
// 新規記事の下書きは仮idの鍵 (bookshelf_art_draft_<id>) で端末に残るが、新規作成の復元は 'new' の鍵を見ていたため、
// 一覧は0件・題名は空のまま、下書きだけが残っていた (#595 step1 の H7・T7)。
// 「届く前に落ちた」は、ハブの模擬 (tests/e2e/helpers/gate-hub.js) で記事のファイルへの書き込みを、次に再読込するまで
// 宙づりにして作る (外部の模擬だけを差し替え、アプリ自身のファイルは差し替えない)。
// 再読込すると、アプリは URL (#/publish・#/publish/<id>) に合わせて公開の画面を自分で開き直す (js/bookshelf.js の
// route.view === 'publish')。そのため再読込の後は下のナビを押さない (開いた画面に遮られて押せない)。
// 門の観測点には数えない回帰 (@gate を付けない)。書き方は門に揃え、操作と確認では evaluate の類を使わない。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import {
    createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest,
    waitForHubFileContainsForTest, holdHubArticleWritesUntilReloadForTest, hubStoreForTest
} from './helpers/gate-hub.js';

const ARTICLES_PATH = 'private/publish/articles.json';

const listView = (page) => page.locator('#art-list-view');
const editView = (page) => page.locator('#art-edit-view');
const titleInput = (page) => page.locator('#art-title');
const articleRow = (page, title) => page.locator('#art-list .pp-row', { hasText: title });
const untitledRow = (page) => page.locator('#art-list .pp-row', { hasText: '無題の記事' });
// 保存先 (ハブ) の記事のファイルにある、その題名の記事の数 (ハブの中身は gate-hub.js の読み口 hubStoreForTest で読む)
const hubArticleCount = (hub, title) => ((hubStoreForTest(hub).readJSON(ARTICLES_PATH) || {}).articles || []).filter((a) => a.title === title).length;

// 下のナビ「本棚」→ 引き出しの「公開」で、記事の一覧を開く (#595 article-leave-flush.spec.js と同じ押し方)
async function tapToArticleList(page) {
    await page.locator('[data-mobile-nav="shelves"]').tap();
    await page.locator('#sidebar-publish').tap();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await expect(listView(page)).toBeVisible();
}

// 一覧の「新規作成」を押して、題名を入れる (新規作成は閲覧状態で開き、題名はそのまま打てる)
async function tapNewArticleAndType(page, title) {
    await page.locator('#art-new').tap();
    await expect(editView(page)).toBeVisible();
    await titleInput(page).fill(title);
}

// 「記事の一覧」(←) で一覧へ戻る
async function tapBackToList(page) {
    await page.locator('#art-back').tap();
    await expect(listView(page)).toBeVisible();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

let hub = null;

test.beforeEach(async ({ page }) => {
    // 前提: ハブに蔵書を置き、保存先をハブにしてログインした状態でアプリを開く (J5 の門のE2E と同じ前提)
    hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
});

test('R1 新規記事に題名を入れてすぐ再読込しても、同じ記事が題名つきで開き直り、一覧にも1つある', async ({ page }) => {
    const TITLE = '599 R1 すぐ再読込した記事';

    await test.step('前提: 次に再読込するまで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて、すぐ (600ms以内に) 再読込する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE);
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 再読込の前と同じ記事が開き直り、題名欄に入れた題名が入っている', async () => {
        await expect(editView(page)).toBeVisible({ timeout: 10000 });
        await expect(titleInput(page)).toHaveValue(TITLE);
    });

    await test.step('操作: 「記事の一覧」で一覧へ戻る', async () => {
        await tapBackToList(page);
    });

    await test.step('確認: 一覧に入れた題名の記事が1つある', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(1);
    });
});

test('R2 新規記事に題名を入れて1秒後 (端末には作られたが保存先へ届く前) に再読込しても、同じ記事が開き直り、一覧にも1つある', async ({ page }) => {
    const TITLE = '599 R2 1秒後に再読込した記事';

    await test.step('前提: 次に再読込するまで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて、1秒待ってから再読込する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE);
        await page.waitForTimeout(1000);
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 再読込の前と同じ記事が開き直り、題名欄に入れた題名が入っている', async () => {
        await expect(editView(page)).toBeVisible({ timeout: 10000 });
        await expect(titleInput(page)).toHaveValue(TITLE);
    });

    await test.step('操作: 「記事の一覧」で一覧へ戻る', async () => {
        await tapBackToList(page);
    });

    await test.step('確認: 一覧に入れた題名の記事が1つある', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(1);
    });
});

test('R3 保存先へ届かないまま新規記事を2本作って再読込しても、2本とも一覧に戻る', async ({ page }) => {
    const TITLE_A = '599 R3 1本目の記事';
    const TITLE_B = '599 R3 2本目の記事';

    await test.step('前提: 次に再読込するまで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: 新規作成で1本目の題名を入れ、端末の戻るで一覧へ戻り、新規作成で2本目の題名を入れて再読込する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE_A);
        await page.waitForTimeout(1000);
        // 「記事の一覧」(←) は保存先へ届くのを待つ (届かなければその場にとどまる・#595)。端末の戻るは待たずに一覧へ戻る
        await page.goBack();
        await expect(listView(page)).toBeVisible();
        await tapNewArticleAndType(page, TITLE_B);
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 再読込の前に開いていた2本目が開き直り、題名欄に2本目の題名が入っている', async () => {
        await expect(editView(page)).toBeVisible({ timeout: 10000 });
        await expect(titleInput(page)).toHaveValue(TITLE_B);
    });

    await test.step('操作: 「記事の一覧」で一覧へ戻る', async () => {
        await tapBackToList(page);
    });

    await test.step('確認: 一覧に2本とも1つずつある', async () => {
        await expect(articleRow(page, TITLE_A)).toHaveCount(1);
        await expect(articleRow(page, TITLE_B)).toHaveCount(1);
    });
});

test('R4 戻った記事は、もう一度再読込しても1つのまま (二重に作らない)・保存先にも1件だけ', async ({ page }) => {
    const TITLE = '599 R4 二重にならない記事';

    await test.step('前提: 次に再読込するまで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて、1秒待ってから再読込する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE);
        await page.waitForTimeout(1000);
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 再読込の前と同じ記事が開き直り、題名欄に入れた題名が入っている', async () => {
        await expect(editView(page)).toBeVisible({ timeout: 10000 });
        await expect(titleInput(page)).toHaveValue(TITLE);
    });

    await test.step('操作: 「記事の一覧」で一覧へ戻る', async () => {
        await tapBackToList(page);
    });

    await test.step('確認: 一覧に入れた題名の記事が1つある', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(1);
    });

    await test.step('前提: 戻った記事が保存先 (ハブ) へ届くのを待つ', async () => {
        await waitForHubFileContainsForTest(hub, ARTICLES_PATH, TITLE);
    });

    await test.step('操作: もう一度再読込する', async () => {
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 記事の一覧が開き、その記事は1つのまま', async () => {
        await expect(listView(page)).toBeVisible({ timeout: 10000 });
        await expect(articleRow(page, TITLE)).toHaveCount(1);
    });

    await test.step('確認: 保存先 (ハブ) の記事のファイルにも、その題名の記事は1件だけ', async () => {
        expect(hubArticleCount(hub, TITLE)).toBe(1);
    });
});

test('R5 新規作成を押しただけ (題名も本文も空) で再読込しても、「無題の記事」が一覧に湧かない', async ({ page }) => {
    await test.step('前提: 次に再読込するまで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: 本棚 → 公開 → 新規作成を押して、何も入れずに再読込する', async () => {
        await tapToArticleList(page);
        await page.locator('#art-new').tap();
        await expect(editView(page)).toBeVisible();
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 記事の一覧が開き、「無題の記事」は無い (記事は0件のまま)', async () => {
        await expect(listView(page)).toBeVisible({ timeout: 10000 });
        await expect(untitledRow(page)).toHaveCount(0);
        await expect(page.locator('#art-list .pp-row')).toHaveCount(0);
    });
});

test('R7 戻った記事が保存先へ届かないうちにもう一度再読込しても、また戻る (下書きを消さない)', async ({ page }) => {
    const TITLE = '599 R7 届かないまま2回再読込した記事';

    await test.step('前提: 2回目の再読込まで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub, 2);
    });

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて、1秒待ってから再読込する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE);
        await page.waitForTimeout(1000);
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 再読込の前と同じ記事が開き直り、題名欄に入れた題名が入っている', async () => {
        await expect(editView(page)).toBeVisible({ timeout: 10000 });
        await expect(titleInput(page)).toHaveValue(TITLE);
    });

    await test.step('操作: 保存先へ届かないうちに、もう一度再読込する', async () => {
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: また同じ記事が開き直り、題名欄に入れた題名が入っている', async () => {
        await expect(editView(page)).toBeVisible({ timeout: 10000 });
        await expect(titleInput(page)).toHaveValue(TITLE);
    });

    await test.step('操作: 「記事の一覧」で一覧へ戻る', async () => {
        await tapBackToList(page);
    });

    await test.step('確認: 一覧にその記事が1つあり、保存先 (ハブ) にも1件だけ届いている', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(1);
        expect(hubArticleCount(hub, TITLE)).toBe(1);
    });
});

test('R8 前に届かなかった別の記事の直しは、ほかの記事を保存しても消えず、開くと戻る', async ({ page }) => {
    const TITLE_OLD = '599 R8 元の題名';
    const TITLE_NEW = '599 R8 直した題名';
    const TITLE_OTHER = '599 R8 ほかの記事';

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて「記事の一覧」で戻る (保存先へ届く)', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE_OLD);
        await tapBackToList(page);
    });

    await test.step('前提: その記事が保存先 (ハブ) へ届くのを待ち、次に再読込するまで書き込みを宙づりにする', async () => {
        await waitForHubFileContainsForTest(hub, ARTICLES_PATH, TITLE_OLD);
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: その記事の「編集」で題名を直し、1秒待って端末の戻るで一覧へ戻り、再読込する', async () => {
        await articleRow(page, TITLE_OLD).locator('[data-act="edit"]').tap();
        await expect(editView(page)).toBeVisible();
        await titleInput(page).fill(TITLE_NEW);
        await page.waitForTimeout(1000);
        await page.goBack();
        await expect(listView(page)).toBeVisible();
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 記事の一覧が開き、直しは保存先へ届いていないので元の題名のまま', async () => {
        await expect(listView(page)).toBeVisible({ timeout: 10000 });
        await expect(articleRow(page, TITLE_OLD)).toHaveCount(1);
    });

    await test.step('操作: 新規作成でほかの記事を作って「記事の一覧」で戻り (保存先へ届く)、元の記事の「編集」を押す', async () => {
        await tapNewArticleAndType(page, TITLE_OTHER);
        await tapBackToList(page);
        await expect(articleRow(page, TITLE_OTHER)).toHaveCount(1);
        await articleRow(page, TITLE_OLD).locator('[data-act="edit"]').tap();
    });

    await test.step('確認: 題名欄に、前に直した題名が戻っている', async () => {
        await expect(editView(page)).toBeVisible();
        await expect(titleInput(page)).toHaveValue(TITLE_NEW);
    });
});

test('R9 一覧へ戻ってから再読込した時も、記事が一覧に戻って知らせが出て、「保存できていない変更があります。」は残らない', async ({ page }) => {
    const TITLE = '599 R9 一覧で再読込した記事';

    await test.step('前提: 次に再読込するまで、記事のファイルへの書き込みを宙づりにする (保存先へ届かない)', async () => {
        holdHubArticleWritesUntilReloadForTest(page, hub);
    });

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて1秒待ち、端末の戻るで一覧へ戻ってから再読込する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE);
        await page.waitForTimeout(1000);
        await page.goBack();
        await expect(listView(page)).toBeVisible();
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 記事の一覧が開き、その記事が1つあり、戻した知らせが出る', async () => {
        await expect(listView(page)).toBeVisible({ timeout: 10000 });
        await expect(articleRow(page, TITLE)).toHaveCount(1);
        await expect(page.locator('.toast-success', { hasText: '保存先へ届く前に閉じた記事を戻しました（1件）' })).toBeVisible();
    });

    await test.step('前提: 戻った記事が保存先 (ハブ) へ届くのを待つ', async () => {
        await waitForHubFileContainsForTest(hub, ARTICLES_PATH, TITLE);
    });

    await test.step('確認: 保存先へ届いた後は、「保存できていない変更があります。」が出ていない', async () => {
        await expect(page.getByText('保存できていない変更があります。')).toBeHidden();
    });
});

test('R6 新規記事を作ってすぐ削除すると、再読込しても甦らない', async ({ page }) => {
    const TITLE = '599 R6 すぐ削除した記事';

    await test.step('操作: 本棚 → 公開 → 新規作成 → 題名を入れて1秒待ち、「その他の操作」→「削除」→ 確認で削除する', async () => {
        await tapToArticleList(page);
        await tapNewArticleAndType(page, TITLE);
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'その他の操作' }).tap();
        await page.getByRole('menuitem', { name: '削除' }).tap();
        await page.getByRole('dialog').getByRole('button', { name: '削除', exact: true }).tap();
        await expect(listView(page)).toBeVisible();
    });

    await test.step('確認: 一覧からその記事が消える', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(0);
    });

    await test.step('操作: 再読込する', async () => {
        await page.reload();
    });

    await test.step('前提: 再読込の後、ハブからの読み込みが終わるのを待つ', async () => {
        await waitForHubStartupForTest(page);
    });

    await test.step('確認: 記事の一覧が開き、削除した記事は戻ってこない', async () => {
        await expect(listView(page)).toBeVisible({ timeout: 10000 });
        await expect(articleRow(page, TITLE)).toHaveCount(0);
    });
});
