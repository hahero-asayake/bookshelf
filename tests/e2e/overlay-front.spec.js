// 重なる画面の前面判定 (イシュー#367・設計案 19_重なる画面の共通化 §1-1 経路4／§5 ハヘロ 05:40 指摘)。
//
// ハヘロの指摘「公開から公開設定へ飛ぶと設定が裏に出る」を、画面の実操作で再現して判定する。
// #settings-modal (index.html L364) と #publish-pages-modal (L869) は同じ .modal (z-index:1000) で、
// DOM が後ろの公開側が上に来る。_openSettingsModal は記事エディタの公開パネル (#art-publish-modal) しか
// 閉じないので、公開記事モーダルの中から設定へ移ると、設定は .show になるのに公開側の裏に出る (見込み)。
// #361 step5 は PC1280 で「settingsShow:true・pubPanelShow:false」だけを見て「問題なし」と誤判定した
// (topTag:IFRAME を描画待ちと片付けた)。ここでは「設定の中心点で elementFromPoint が #settings-modal の
// 配下か」を 2 秒まで待って判定する＝描画待ちでは説明できない形にする。
//
// 判定は PC1280 と SP390 の 2 幅。修正前 (重なり管理役の導入前) はこのテストが落ちる＝落ちることを確認してから
// 直す (依頼文「直す前に失敗するE2Eを先に書いて落ちることを確かめる」)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = JSON.parse(readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8'));
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// publish-panel.spec.js の boot と同じ型 (記事ストアはメモリ差し替え・ハブ×Free)。
// syncReady=false は「保存先に未接続」の状態＝公開記事モーダルの一覧に「保存先を選ぶ」ボタンが出る。
async function boot(page, { syncReady = true } = {}) {
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    userData.settings = { ...(userData.settings || {}), publicDisplayName: 'テスト太郎' };
    const sync = {
        method: 'local',
        hub: { key: 'hk_test', apiBase: 'https://hub.example.test', plan: 'free', username: 'tester' },
        publish: { target: 'hub' },
    };
    await page.addInitScript(([u, l, s]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', s);
    }, [JSON.stringify(userData), fixtureLibrary, JSON.stringify(sync)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate((ready) => {
        window.bookshelf.saveUserData = async () => {};
        window.HubAuth.renderSignInButton = () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf._isSyncReady = () => ready;
    }, syncReady);
}

// 設定モーダルの中心点で「いちばん手前にある要素」を調べる。insideSettings=true が期待値。
function probeFront() {
    const s = document.getElementById('settings-modal');
    const p = document.getElementById('publish-pages-modal');
    const panel = document.getElementById('art-publish-modal');
    const c = (s && (s.querySelector('.modal-content') || s));
    const r = c ? c.getBoundingClientRect() : null;
    const cx = r ? r.left + r.width / 2 : 0;
    const cy = r ? r.top + r.height / 2 : 0;
    const top = r ? document.elementFromPoint(cx, cy) : null;
    const topModal = top ? top.closest('.modal, .art-publish-modal, .plugin-settings-modal') : null;
    return {
        insideSettings: !!(top && top.closest('#settings-modal')),
        topTag: top ? top.tagName : null,
        topId: top ? (top.id || null) : null,
        topModal: topModal ? (topModal.id || topModal.className) : null,
        settingsShow: !!(s && s.classList.contains('show')),
        publishShow: !!(p && p.classList.contains('show')),
        panelShow: !!(panel && panel.classList.contains('show')),
        zSettings: s ? getComputedStyle(s).zIndex : null,
        zPublish: p ? getComputedStyle(p).zIndex : null,
        point: [Math.round(cx), Math.round(cy)],
        viewport: [window.innerWidth, window.innerHeight],
    };
}

// 2 秒まで前面になるのを待ってから最後の観測を返す (描画待ちを理由にした誤判定を避ける)
async function waitSettingsFront(page, label) {
    let last = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
        last = await page.evaluate(probeFront);
        if (last.insideSettings) break;
        await page.waitForTimeout(100);
    }
    console.log(`[overlay-front] ${label} ${JSON.stringify(last)}`);
    return last;
}

function assertSettingsFront(last) {
    expect(last.settingsShow, '設定モーダルは .show になっている (開く処理そのものは走る)').toBe(true);
    expect(last.insideSettings, `設定モーダルの中心点 ${last.point} で最前面の要素が設定の配下ではない: ${JSON.stringify(last)}`).toBe(true);
    expect(last.topModal, '公開側 (#publish-pages-modal / #art-publish-modal) が設定より手前にある').toBe('settings-modal');
}

// 記事エディタ → 公開パネル。SP では #art-publish-header が隠れる場合があるので、その時は同じ入口関数を直接呼ぶ
async function openNewArticleAndPanel(page) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.click('#art-new');
    await page.fill('#art-title', '前面判定');
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    const hd = page.locator('#art-publish-header');
    if (await hd.isVisible()) await hd.click();
    else await page.evaluate(() => window.bookshelf._artOpenPublishPanel());
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
}

for (const vp of [{ name: 'PC1280', width: 1280, height: 800 }, { name: 'SP390', width: 390, height: 844 }]) {
    test.describe(`重なりの前面判定 ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test(`公開パネルの設定リンク → 設定モーダルが最前面に出る (${vp.name})`, async ({ page }) => {
            await boot(page);
            await openNewArticleAndPanel(page);
            // ハブ×Free の広告節に出る「Plus を見る」(data-settings="account-section") を押す (js/bookshelf.js _artRenderPublishPanel)
            const link = page.locator('#art-publish-modal .art-pub-link[data-settings]').first();
            await expect(link).toBeVisible();
            await link.click();
            await expect(page.locator('#settings-modal')).toHaveClass(/show/);
            // D05: パネル自体は閉じる (ここは #361 step5 でも確認済み)
            await expect(page.locator('#art-publish-modal')).not.toHaveClass(/show/);
            const last = await waitSettingsFront(page, `panel-link ${vp.name}`);
            assertSettingsFront(last);
        });

        test(`公開記事一覧の「保存先を選ぶ」→ 設定モーダルが最前面に出る (${vp.name})`, async ({ page }) => {
            await boot(page, { syncReady: false });
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
            await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
            // 未接続時の通知ボタン (#art-store-notice-btn → _openSettingsModal('sync-method-select'))
            const btn = page.locator('#art-store-notice-btn');
            await expect(btn).toBeVisible();
            await expect(btn).toHaveText('保存先を選ぶ');
            await btn.click();
            await expect(page.locator('#settings-modal')).toHaveClass(/show/);
            const last = await waitSettingsFront(page, `store-notice ${vp.name}`);
            assertSettingsFront(last);
        });

        test(`公開記事一覧の読込エラー行「設定を開く」(ハブ認証切れ) → 設定モーダルが最前面に出る (${vp.name})`, async ({ page }) => {
            await boot(page);
            // 接続済みで load() が HubAuthError を投げる = 一覧にエラー行と「設定を開く」ボタン (js/bookshelf.js _artRenderList)
            await page.evaluate(() => {
                window.bookshelf.publishArticleStore.load = async () => { const e = new Error('認証切れ'); e.name = 'HubAuthError'; throw e; };
            });
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
            await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
            const btn = page.locator('#publish-pages-modal [data-act="open-settings"]');
            await expect(btn).toBeVisible();
            await btn.click();
            await expect(page.locator('#settings-modal')).toHaveClass(/show/);
            const last = await waitSettingsFront(page, `auth-error ${vp.name}`);
            assertSettingsFront(last);
        });

        // 対照: _confirmOpenSettings 経由 (公開に必要な設定が無い時の確認ダイアログ → 「設定を開く」) は
        // closePublishPagesModal() を先に呼ぶので、修正前でも設定が前面に出る＝入口ごとに閉じ方が違う実例
        test(`対照: 確認ダイアログの「設定を開く」経由は公開モーダルを閉じるので前面に出る (${vp.name})`, async ({ page }) => {
            await boot(page);
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
            await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
            await page.evaluate(() => { window.bookshelf._confirmOpenSettings('対照テスト', 'account-section'); });
            await page.locator('.cfm-box .cfm-ok').click();
            await expect(page.locator('#settings-modal')).toHaveClass(/show/);
            const last = await waitSettingsFront(page, `confirm-path ${vp.name}`);
            expect(last.publishShow, '確認ダイアログ経由は公開モーダルを閉じてから設定を開く').toBe(false);
            assertSettingsFront(last);
        });
    });
}
