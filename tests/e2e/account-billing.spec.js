// アカウント画面の課金ボタン ([hidden] 罠の根本対処, イシュー#227/#231)
//  - #account-manage-billing (プラン変更・支払い・解約) は Free/comp (管理者付与Plus)/stale では
//    非表示、実際に Stripe サブスクがある (billingManaged) ときだけ表示 (ADR-039)。
//  - 従来は `.btn-small` の display:flex が UA の [hidden] を上書きし、非表示のはずが表示されて
//    しまうバグがあった (ui-standards §2-2, 4回目の再発)。css/bookshelf.css の
//    `[hidden]{display:none !important}` で構造的に直したため、ここでは attribute でなく
//    getComputedStyle().display を実測して検証する (attribute だけ見るテストだと今回のバグを検出できない)。
//  - あわせて、B案 (グローバル !important) の副作用調査で見つかった hub-goto-account
//    (`style.display` による個別回避を `el.hidden` へ書き換えた箇所) の回帰も確認する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, hubOverrides = {}, settingsOverrides = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userDataJson, library, hub, settingsOv]) => {
        const userData = JSON.parse(userDataJson);
        Object.assign(userData.settings, settingsOv);
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(userData));
        localStorage.setItem('virtualBookshelf_library', library);
        // 同期方式 (データの保存先) はローカルのまま、アカウント (ハブ) 接続だけ設定する
        // (account-username.spec.js と同じ理由: 同期=hub にすると起動時に実ハブへ fetch しにいく)。
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub }));
    }, [fixtureUserData, fixtureLibrary, {
        apiBase: 'https://hub.example.test', key: 'hk_test', uid: 'u1', siteId: 's1', email: 'taro@example.com',
        plan: 'free', quotaBytes: 100000000, usedBytes: 0, username: null, bookshelfBase: null,
        ...hubOverrides
    }, settingsOverrides]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
    return errors;
}

// attribute の hidden ではなく実際の computed display を見る (今回のバグは属性はあるのに
// CSS が上書きして見えてしまう、という attribute だけでは検出できない種類のため)。
function getDisplay(page, id) {
    return page.evaluate((id) => getComputedStyle(document.getElementById(id)).display, id);
}

test.describe('アカウント画面: プラン変更・支払い・解約ボタンの表示 (イシュー#227/#231)', () => {
    test('Free では非表示・comp説明もpast_due警告も出ない', async ({ page }) => {
        const errors = await bootApp(page, { plan: 'free' });
        await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
        expect(await getDisplay(page, 'account-manage-billing')).toBe('none');
        expect(await getDisplay(page, 'account-comp-notice')).toBe('none');
        expect(await getDisplay(page, 'account-past-due-notice')).toBe('none');
        expect(errors).toEqual([]);
    });

    test('comp (管理者付与 Plus, billingManaged=false) では非表示・代わりに説明行が見える', async ({ page }) => {
        const errors = await bootApp(page, { plan: 'plus', billingManaged: false });
        await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
        expect(await getDisplay(page, 'account-manage-billing')).toBe('none');
        expect(await getDisplay(page, 'account-comp-notice')).not.toBe('none');
        await expect(page.locator('#account-comp-notice')).toContainText('管理者付与');
        expect(await getDisplay(page, 'account-past-due-notice')).toBe('none');
        expect(errors).toEqual([]);
    });

    test('active (Stripe サブスクあり, billingManaged=true) では表示される', async ({ page }) => {
        const errors = await bootApp(page, { plan: 'plus', billingManaged: true, subStatus: 'active' });
        await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
        expect(await getDisplay(page, 'account-manage-billing')).not.toBe('none');
        expect(await getDisplay(page, 'account-comp-notice')).toBe('none');
        expect(await getDisplay(page, 'account-past-due-notice')).toBe('none');
        expect(errors).toEqual([]);
    });

    test('past_due (支払い遅延) ではボタンは表示のまま警告も出る', async ({ page }) => {
        const errors = await bootApp(page, { plan: 'plus', billingManaged: true, subStatus: 'past_due' });
        await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
        expect(await getDisplay(page, 'account-manage-billing')).not.toBe('none');
        expect(await getDisplay(page, 'account-past-due-notice')).not.toBe('none');
        expect(await getDisplay(page, 'account-comp-notice')).toBe('none');
        expect(errors).toEqual([]);
    });
});

test.describe('ハブ未接続の誘導ボタン (hub-goto-account): B案の副作用回帰 (イシュー#231)', () => {
    // 元々 `gotoBtn.style.display` で個別に回避していた箇所 (「[hidden] が効かない」というコメント
    // 付き)。グローバル [hidden]{display:none !important} を入れる際に el.hidden へ書き換えたため、
    // 未同意/同意済みの両方で意図通り出し分けられるかを固定する。
    test('規約未同意なら表示される', async ({ page }) => {
        const errors = await bootApp(page, { key: '', apiBase: '' });
        await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
        await page.locator('#sync-method-select').selectOption('hub');
        expect(await getDisplay(page, 'hub-goto-account')).not.toBe('none');
        expect(errors).toEqual([]);
    });

    test('規約同意済みなら非表示になる', async ({ page }) => {
        const errors = await bootApp(page, { key: '', apiBase: '' }, { ackTermsPrivacy: { at: '2026-01-01T00:00:00.000Z', v: 'v1.0' } });
        await page.evaluate(() => window.bookshelf._openSettingsModal('sync-method-select'));
        await page.locator('#sync-method-select').selectOption('hub');
        expect(await getDisplay(page, 'hub-goto-account')).toBe('none');
        expect(errors).toEqual([]);
    });
});
