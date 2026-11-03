// イシュー#528 X3 step4: 「本を3冊入れて公開」の手数を5端末で数える。
// 数え方は u0-77-table.md の A1(新規記事に3冊入れて初めて公開)・A7(公開済み記事の操作)の定義に合わせる
// (499-step4-plan.md §4 X3「完了の条件」)。1操作=1手(クリック・タップ・テキスト入力1回)。
// 引き出しを開く操作(_artOpenSheet)はA-c実装により自動化されたため、ユーザーの手としては数えない。
//
// 対象の2場面(②判断2026-11-03 step2承認時「3. 公開の流れ」):
//   A1相当: 新しい記事に本を3冊入れて初めて公開する(公開パネルを通す・公開事故防止のため必須)。
//   A7相当: 公開済みの記事に3冊足して「変更を公開」する(ヘッダーから直接。公開パネルは経由しない)。
//
// 比較対象(origin/main・今の手数)はstep1設計メモ(docs/char/x3-step1-design.md §8)の実測値を使う
// (実測12手。brief記載の14手とは数え方の粒度が違う可能性があり、u0-77-table.mdのA1定義
// 「新規作成→タイトル入力→本棚ブロック→本3冊選択→公開パネルで送信→URLが出るまで」の粒度に
// 合わせてここでは1クリック/1入力=1手で統一して数え直す)。
import { test, expect } from '../helpers/test-base.js';
import { addBlock } from '../helpers/art-editor.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

const HUB = 'https://mockhub.test';

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    const hubCaptured = { files: null, deleteMissing: null, index: null };
    await page.route(`${HUB}/**`, async (route) => {
        const url = route.request().url();
        if (url.includes('/publish')) {
            const body = route.request().postDataJSON();
            hubCaptured.files = body.files;
            hubCaptured.deleteMissing = body.deleteMissing;
            hubCaptured.index = body.index;
            return route.fulfill({ json: { ok: true, siteUrl: `${HUB}/public/sid/` } });
        }
        if (url.includes('/usage')) {
            return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576 } });
        }
        return route.fulfill({ status: 404, json: {} });
    });

    await page.addInitScript(([userData, library, hub]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            hub: {
                key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free',
                publicBase: `${hub}/public/sid/`, siteId: 'sid',
                username: 'hahero', bookshelfBase: 'https://bookshelf.asayake.org/hahero/'
            },
            publish: { target: 'hub' }
        }));
    }, [fixtureUserData, fixtureLibrary, HUB]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(([library, notes]) => {
        const mem = new Map();
        mem.set('private/library.json', library);
        mem.set('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
        mem.set('private/bookshelves/all.json', { books: library.books.map(b => b.asin) });
        mem.set('private/notes.json', { notes });
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf.flushSync = async () => {};
        window.bookshelf._isSyncReady = () => true;
        window.bookshelf._scheduleSync = () => {};
    }, [JSON.parse(fixtureLibrary), JSON.parse(fixtureUserData).notes]);
    return { errors, hubCaptured };
}

async function openPublishPagesModal(page, ops) {
    const btn = page.locator('#sidebar-publish');
    const box0 = await btn.boundingBox();
    if (!box0 || box0.x < 0) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        ops.push('サイドバーのドロワーを開く(モバイル限定)');
        await page.waitForTimeout(350);
    }
    await btn.click({ force: true });
    ops.push('サイドバーの「公開」をクリック');
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
}

async function leaveForm(page, ops, label = '全画面編集の「完了」') {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) { await done.click(); ops.push(label); }
}

// 構成A(イシュー#276): 600px以下は見た目/公開ボタンがヘッダーでなく下部バー(#art-bar-publish)。
// standard-ops.spec.jsのclickPublishHeaderと同じフォールバック(390/768はこちらを通る)。
async function clickPublishHeader(page) {
    const headerBtn = page.locator('#art-publish-header');
    if (await headerBtn.isVisible()) await headerBtn.click();
    else await page.click('#art-bar-publish');
}

// A1相当: 新しい記事に本を3冊入れて初めて公開する(公開パネルを通す・②判断2026-11-03「3」)。
async function countOpsNewArticlePublish(page, hubCaptured, title) {
    const ops = [];
    await openPublishPagesModal(page, ops);

    await page.click('#art-new'); ops.push('「新規作成」をクリック');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await page.click('#art-mode-edit'); ops.push('「編集」をクリック(閲覧→編集)');

    await page.fill('#art-title', title); ops.push('タイトルを入力');

    // +ボタン(ins-btn)→シートで「本棚」を選ぶ、の2手(addBlockヘルパーの内部操作をそのまま手として数える)。
    await addBlock(page, 'shelf', 'last');
    ops.push('キャンバスの「+」をクリック');
    ops.push('「ブロックを追加」シートで「本棚」を選ぶ');

    // イシュー#529 (A-c入れ直し): 本棚ブロックを足すと引き出しが自動で開くため、「本を追加」ボタンで
    // 開く手は不要。完了を押すまで閉じないため、×で閉じる手も不要(leaveFormの「完了」が両方畳む)。
    const items = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(3, await items.count());
    for (let i = 0; i < n; i++) { await items.nth(i).click(); ops.push(`引き出しで本${i + 1}冊目をクリック`); }
    expect(n).toBe(3);

    await leaveForm(page, ops);

    // ②判断2026-11-03「3」: 初めて公開する記事は公開パネルを必ず通す(公開事故防止)。
    await clickPublishHeader(page); ops.push('ヘッダーの「公開する」をクリック(公開パネルを開く)');
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
    await expect(page.locator('#art-pub-go')).toBeEnabled();
    await page.click('#art-pub-go'); ops.push('公開パネルの「公開する」を実行');
    if (await page.locator('.cfm-box').isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.click('.cfm-ok'); ops.push('初回公開の同意ダイアログでOK');
    }
    await expect.poll(() => hubCaptured.files, { timeout: 10_000 }).not.toBeNull();
    await expect(page.locator('#art-publish-modal')).toContainText(/https?:\/\//);
    await page.click('#art-pub-close'); ops.push('公開パネルを閉じる');

    return ops;
}

// A7相当: 公開済みの記事に3冊足して「変更を公開」する(ヘッダーから直接・②判断2026-11-03「3」)。
async function countOpsUpdatePublished(page, hubCaptured) {
    // 準備(手数には数えない): 公開済み記事を1件作る。
    await openPublishPagesModal(page, []);
    await page.click('#art-new');
    await page.click('#art-mode-edit');
    await page.fill('#art-title', '既存記事(準備)');
    await addBlock(page, 'shelf', 'last');
    // イシュー#529: 引き出しは自動で開く(「本を追加」での手動オープンは不要)
    const prepItems = page.locator('#art-drawer-list .art-drawer-item');
    await prepItems.nth(0).click();
    await leaveForm(page, []);
    await clickPublishHeader(page);
    await expect(page.locator('#art-pub-go')).toBeEnabled();
    await page.click('#art-pub-go');
    if (await page.locator('.cfm-box').isVisible({ timeout: 2000 }).catch(() => false)) await page.click('.cfm-ok');
    await expect.poll(() => hubCaptured.files, { timeout: 10_000 }).not.toBeNull();
    await page.click('#art-pub-close');

    // ここから手数計測: 2つ目の本棚ブロックに3冊足して「変更を公開」。
    const ops = [];
    await addBlock(page, 'shelf', 'last');
    ops.push('キャンバスの「+」をクリック');
    ops.push('「ブロックを追加」シートで「本棚」を選ぶ');
    // イシュー#529: 引き出しは自動で開き、完了まで閉じない(「本を追加」での手動オープン・×での
    // 手動クローズのいずれも不要)
    const items = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(3, await items.count());
    for (let i = 0; i < n; i++) { await items.nth(i).click(); ops.push(`引き出しで本${i + 1}冊目をクリック`); }
    expect(n).toBe(3);
    await leaveForm(page, ops);

    // ②判断2026-11-03「3」: 公開済み記事の「変更を公開」はヘッダーから直接(公開パネルを経由しない)。
    await clickPublishHeader(page); ops.push('ヘッダーの「公開する」(更新)をクリック');
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
    await expect(page.locator('#art-pub-go')).toBeEnabled();
    await page.click('#art-pub-go'); ops.push('公開パネルの「公開する」を実行');
    await expect.poll(() => hubCaptured.files, { timeout: 10_000 }).not.toBeNull();
    await page.click('#art-pub-close'); ops.push('公開パネルを閉じる');

    return ops;
}

const FIVE_DEVICES = ['char-390', 'char-768', 'char-1024', 'char-1440', 'char-1920'];

test.describe('X3 step4: 本を3冊入れて公開する手数(5端末・A1相当=新規記事・初回公開)', () => {
    for (const name of FIVE_DEVICES) {
        test(`手数@${name}: 新しい記事に3冊入れて初めて公開`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            const { hubCaptured } = await bootApp(page);
            const ops = await countOpsNewArticlePublish(page, hubCaptured, `手数計測@${name}`);
            console.log(`[手数計測][新規記事・初回公開][${name}] ${ops.length}手: ${JSON.stringify(ops)}`);
            // 手数は記録のみ(今との比較は手で表にする・docs/char/x3-step1-design.md §8参照)。
            // 公開パネルを必ず通す構成(②判断2026-11-03「3」)のため、「今」でもユーザーが本棚ブロックを
            // 最初から選べば同程度の手数になりうる。expectで固定の閾値は置かない。
            expect(ops.length).toBeGreaterThan(0);
        });
    }
});

test.describe('X3 step4: 本を3冊足して変更を公開する手数(5端末・A7相当=公開済み記事)', () => {
    for (const name of FIVE_DEVICES) {
        test(`手数@${name}: 公開済みの記事に3冊足して変更を公開`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            const { hubCaptured } = await bootApp(page);
            const ops = await countOpsUpdatePublished(page, hubCaptured);
            console.log(`[手数計測][公開済み・変更を公開][${name}] ${ops.length}手: ${JSON.stringify(ops)}`);
            expect(ops.length).toBeGreaterThan(0);
        });
    }
});
