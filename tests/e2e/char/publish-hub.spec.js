// イシュー#506 U0c: A1(記事に本を3冊入れて公開するまで)・A7(公開記事の一覧で開く/削除/非公開)を
// タッチ3端末(390/768/1024)で固定する。保存先はhub構成のモック(publish-article-editor.spec.jsの
// bootAppForPublish型・②承認2026-11-03で #504 の「待つ時は状態の条件で待つ」方針に合わせる)。
//
// 390/768は900px以下=ボトムシート方式の引き出し(_artOpenSheet/_artCloseSheetで明示開閉・イシュー#165)。
// 1024は900px超=常駐の畳める引き出し(イシュー#168)で、ボトムシートの開閉関数を呼ばない。
// この違いはstep1実測(#506)で確認した「オフキャンバスの引き出しをisVisible()で見分けられない」
// 問題(#502)の根本原因そのもので、addBlockヘルパー本体は変えずcharテスト側でこの分岐を吸収する。
import { test, expect } from '../helpers/test-base.js';
import { addBlock } from '../helpers/art-editor.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

const HUB = 'https://mockhub.test';

// hub構成でbootする(publish-article-editor.spec.js bootAppForPublishと同型)。公開先をhubに固定し
// page.routeで/publish・/usageをモックすることで、実通信なしに公開送信(commitBatch/publishSite)を
// 最後まで通す。
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

// #sidebar-publishはモバイルではドロワーに隠れている(u0-findings §4実測)。
// [data-mobile-nav="shelves"]がドロワーの開閉トリガー(js/bookshelf.js 6322行)。
async function openPublishPagesModal(page) {
    const btn = page.locator('#sidebar-publish');
    const box0 = await btn.boundingBox();
    if (!box0 || box0.x < 0) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await page.waitForTimeout(350);
    }
    await btn.click({ force: true });
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
}

async function leaveForm(page) {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
}

async function openPublishPanel(page) {
    await leaveForm(page);
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    const headerBtn = page.locator('#art-publish-header');
    if (await headerBtn.isVisible()) await headerBtn.click();
    else await page.click('#art-bar-publish');
}

// 本の引き出し(#art-drawer)を「選べる状態」にする。900px以下はボトムシート(毎回閉じた状態から
// 始まる・_artOpenSheetで明示的に開く、イシュー#165)。900px超は常駐の畳める引き出し(イシュー#168)
// で、addBlock(shelf)直後から既に選べる状態にある(開閉関数を呼ばない)。
// is-openクラスかboundingClientRect().xで開いたことを確認する(isVisible()では見分けられない・#502)。
async function ensureDrawerPickable(page) {
    const isNarrow = await page.evaluate(() => window.matchMedia('(max-width: 900px)').matches);
    if (isNarrow) {
        await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
        await expect.poll(() => page.evaluate(() => document.getElementById('art-drawer')?.classList.contains('is-open'))).toBe(true);
    } else {
        await expect.poll(() => page.evaluate(() => {
            const r = document.getElementById('art-drawer')?.getBoundingClientRect();
            return r ? r.x >= 0 : null;
        })).toBe(true);
    }
    return isNarrow;
}

async function closeDrawerIfNarrow(page, isNarrow) {
    if (isNarrow) await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
}

// A1本体: 新規作成→タイトル→本棚ブロック→本を3冊選ぶ→公開パネルで送信→URLが出るまで。
// A7が「公開済み記事」を用意するときにも再利用する(同じ経路の揺れは#504の結論=状態の条件で待つに合わせる)。
async function publishNewArticle(page, hubCaptured, title) {
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    // 公開の必須チェック(_artPublishCheck)はタイトル必須(js/bookshelf.js:12203)。
    // u0-targets.mdの手順には明示が無いが、タイトル無しでは#art-pub-goがdisabledのまま
    // (今の振る舞い)なので、ここで入れる。
    await page.fill('#art-title', title);

    await addBlock(page, 'shelf', 'last');
    const isNarrow = await ensureDrawerPickable(page);
    const items = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(3, await items.count());
    for (let i = 0; i < n; i++) await items.nth(i).click();
    expect(n).toBe(3); // 今の振る舞い: fixtureは3冊以上あり、3冊とも選べる
    await closeDrawerIfNarrow(page, isNarrow);
    await leaveForm(page);

    await openPublishPanel(page);
    await expect(page.locator('#art-pub-go')).toBeEnabled();
    await page.click('#art-pub-go');
    // 無料プラン(ハブ)は初回公開時に同意ダイアログが挟まる(今の振る舞い・publish-article-editor.spec.js同型)
    if (await page.locator('.cfm-box').isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.click('.cfm-ok');
    }
    // commitBatch(hubへのpublish push)到達は非同期。1回読み禁止・expect.pollで読み直す
    // (プロジェクトノートの型・#384)。
    await expect.poll(() => hubCaptured.files, { timeout: 10_000 }).not.toBeNull();
    await expect(page.locator('#art-publish-modal')).toContainText(/https?:\/\//);
    const href = await page.locator('#art-pub-url').getAttribute('href');
    expect(href).toMatch(/^https?:\/\//);
    await page.click('#art-pub-close');
}

const TOUCH_3 = ['char-390', 'char-768', 'char-1024'];

test.describe('A1: 新規作成→本棚ブロック→本を3冊→公開(77件表・今の振る舞い)', () => {
    for (const name of TOUCH_3) {
        test(`A1@${name}: 公開済みになりURLが出る`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用のA1テスト`);
            const { hubCaptured } = await bootApp(page);
            await openPublishPagesModal(page);
            await publishNewArticle(page, hubCaptured, `A1@${name}テスト記事`);
        });
    }
});

test.describe('A7: 公開記事の一覧で開く・削除・非公開にする(77件表・今の振る舞い)', () => {
    for (const name of TOUCH_3) {
        test(`A7@${name}: 一覧操作(開く/非公開にする/削除)が反映される`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用のA7テスト`);
            const { hubCaptured } = await bootApp(page);
            await openPublishPagesModal(page);

            // 1件目を公開まで通す(A1と同じ経路)。
            await publishNewArticle(page, hubCaptured, `A7@${name}記事1`);
            await leaveForm(page);
            await page.click('#art-back');
            await expect(page.locator('#art-list-view')).toBeVisible();
            await expect(page.locator('#art-list .pp-row')).toHaveCount(1);
            await expect(page.locator('#art-list .pp-status-on')).toHaveCount(1); // 公開済み(今の振る舞い)

            // A7-開く: 一覧の「編集」ボタンでエディタへ戻る。
            await page.locator('#art-list [data-act="edit"]').first().click();
            await expect(page.locator('#art-edit-view')).toBeVisible();

            // A7-非公開にする: ⋯メニュー→「公開を取り消す」→確認ダイアログでOK。
            await leaveForm(page);
            await page.click('#art-more-btn');
            await page.click('#art-unpublish');
            await expect(page.locator('.cfm-box')).toBeVisible();
            await page.click('.cfm-ok');
            await leaveForm(page);
            await page.click('#art-back');
            await expect(page.locator('#art-list-view')).toBeVisible();
            // 状態が一覧に反映される(今の振る舞い): 公開済み→未公開
            await expect(page.locator('#art-list .pp-status-off')).toHaveCount(1);
            await expect(page.locator('#art-list .pp-status-on')).toHaveCount(0);

            // 削除の確認用に2件目(未公開のまま)を作る。タイトル入力は600msデバウンス後に
            // _artFlushSave()でストアへ反映される(js/bookshelf.js:11930)。即座にart-backへ進むと
            // 反映前の一覧が描画されてしまうため、保存完了を明示的に待つ(1回読み禁止・状態確認の型)。
            await page.click('#art-new');
            await page.fill('#art-title', `A7@${name}記事2(削除用)`);
            await page.evaluate(() => window.bookshelf._artFlushSave());
            await leaveForm(page);
            await page.click('#art-back');
            await expect(page.locator('#art-list-view')).toBeVisible();
            await expect(page.locator('#art-list .pp-row')).toHaveCount(2);

            // A7-削除: 2件目を開いて⋯メニュー→「削除」→確認ダイアログでOK。
            await page.locator('#art-list [data-act="edit"]').nth(1).click();
            await expect(page.locator('#art-edit-view')).toBeVisible();
            await leaveForm(page);
            await page.click('#art-more-btn');
            await page.click('#art-del');
            await expect(page.locator('.cfm-box')).toBeVisible();
            await page.click('.cfm-ok');
            // _artDelete成功後は自動で一覧へ戻る(js/bookshelf.js:9402)。
            await expect(page.locator('#art-list-view')).toBeVisible();
            // 状態が一覧に反映される(今の振る舞い): 1件削除されて残り1件
            await expect(page.locator('#art-list .pp-row')).toHaveCount(1);
        });
    }
});
