// アプリ本体の新バージョン検知 → 既存 PWA 更新バーへの接続 (イシュー#143・仮説a-1対策)。
// SW の updatefound は load 時の reg.update() 1回だけで、開きっぱなしのタブに新しい ?v= が
// 届く経路が無かった。_checkAppVersion() が index.html を取り直して差分を検知し、
// 既存の更新バー (_onPwaUpdateReady → _updateStatusBar → _applyPwaUpdate) にそのまま乗ることを
// 検証する (表示は自作しない)。抽出ロジック自体は tests/unit/app-version-check.test.js で検証済み。
import { test, expect } from './helpers/test-base.js';

test('index.html の ?v= が変わっていれば、既存の更新バーに「更新」が表示される', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);

    // 起動直後は新バージョン行は出ていない (E2E環境は同期未設定のため #app-status-bar 自体は
    // 別の警告行で既に表示されうる。ここで見るのは .status-update 行の有無)
    await expect(page.locator('#app-status-bar .status-update')).toHaveCount(0);

    // index.html への fetch だけ、異なる ?v= を含む HTML を返すようにモック
    await page.evaluate(() => {
        const origFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.includes('index.html')) {
                return Promise.resolve(new Response(
                    '<script src="js/bookshelf.js?v=9999999999"></script>',
                    { status: 200 }
                ));
            }
            return origFetch(input, init);
        };
    });

    // 検知は公開メソッド経由 (内部状態を直接書き換えない)
    await page.evaluate(() => window.bookshelf._checkAppVersion());

    await expect(page.locator('#app-status-bar')).toBeVisible();
    await expect(page.locator('#app-status-bar .status-update .status-msg')).toHaveText('新しいバージョンがあります');
    const updateBtn = page.locator('#app-status-bar [data-status-action="update"]');
    await expect(updateBtn).toBeVisible();
});

test('visibilitychange (タブ復帰) でも新バージョン検知が走る (load時1回で終わらない)', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);

    await page.evaluate(() => {
        window.__versionCheckCalls = 0;
        const orig = window.bookshelf._checkAppVersion.bind(window.bookshelf);
        window.bookshelf._checkAppVersion = (...args) => {
            window.__versionCheckCalls++;
            return orig(...args);
        };
    });

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => window.__versionCheckCalls)).toBeGreaterThan(0);
});

test('新バージョン検知後の「更新」クリックで location.reload() が呼ばれる (reg無し=SW非経由のフォールバック)', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);

    await page.evaluate(() => {
        window.__reloaded = false;
        window.bookshelf._applyPwaUpdate = (() => {
            const orig = window.bookshelf._applyPwaUpdate.bind(window.bookshelf);
            return function patched() {
                if (!(window.bookshelf._pwaUpdateReg && window.bookshelf._pwaUpdateReg.waiting)) {
                    window.__reloaded = true;
                    return; // 実際の reload はテストを止めてしまうので発火だけ確認する
                }
                return orig();
            };
        })();
        // reg=null で通知 (_checkAppVersion と同じ経路)
        window.bookshelf._onPwaUpdateReady(null);
    });

    await expect(page.locator('#app-status-bar [data-status-action="update"]')).toBeVisible();
    await page.locator('#app-status-bar [data-status-action="update"]').click();
    await expect.poll(() => page.evaluate(() => window.__reloaded)).toBe(true);
});
