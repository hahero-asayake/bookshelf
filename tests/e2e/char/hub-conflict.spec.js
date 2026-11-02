// イシュー#506 U0c: E4(ハブの412衝突→O27の衝突ダイアログが出て選べる)をタッチ3端末(390/768/1024)で
// 固定する。正本はdocs/char/u0-targets.md:108「hubの412(同期の衝突)→O27が出て選べる」。
//
// tests/e2e/sync-conflict.spec.jsは window.bookshelf._handleSyncConflict() を直接呼ぶ単体テスト
// だったが、ここでは経路を通す(js/bookshelf.js の syncToObsidianFolder → js/hub-adapter.js の
// commitBatch → POST /data/batch が412を返す → conflicts詳細なし(想定外応答扱い) → HubConflictError
// → _handleSyncConflict('Asayake ハブ') → #sync-conflict-dialog表示、という実際のコードパス)。
// addInitScriptのコールバックはブラウザ側で評価されるため、Node側変数(HUB等)は直接参照できず、
// 第2引数で渡す必要がある(u0-77-table §見つけた不具合の教訓)。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

const HUB = 'https://mockhub.test';

// sync.method=hubで起動し、hub APIをモックする。POST /data/batchは常に412(conflicts詳細なし)を
// 返す=js/hub-adapter.js:291-296の「個別判定できないので安全側に倒す」経路でHubConflictErrorに
// 直結させる(本当の競合の中身を模すより、E4の対象=ダイアログ表示/選択肢の固定には最短の経路)。
async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.route(`${HUB}/**`, async (route) => {
        const req = route.request();
        const url = req.url();
        const method = req.method();
        if (url.includes('/data/batch') && method === 'POST') {
            return route.fulfill({ status: 412, json: {} }); // conflicts無し→即HubConflictError
        }
        if (url.includes('/data/') && method === 'HEAD') {
            return route.fulfill({ status: 200, headers: { ETag: '"etag-1"' } });
        }
        if (url.includes('/data/') && method === 'GET') {
            return route.fulfill({ status: 404, json: {} }); // 一覧+ETagの取得は失敗してもフォールバックされる
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
            method: 'hub',
            hub: {
                key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free',
                publicBase: `${hub}/public/sid/`, siteId: 'sid', username: 'hahero'
            }
        }));
    }, [fixtureUserData, fixtureLibrary, HUB]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    return errors;
}

const TOUCH_3 = ['char-390', 'char-768', 'char-1024'];

test.describe('E4: ハブの412(同期の衝突)でO27(衝突ダイアログ)が出て選べる(77件表・今の振る舞い)', () => {
    for (const name of TOUCH_3) {
        test(`E4@${name}: 衝突ダイアログに3択が出て選べる`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用のE4テスト`);
            await bootApp(page);

            // 蔵書データの同期をトリガー(_scheduleSync→debounce後に_runPendingSync→
            // syncToObsidianFolder→hub-adapter.commitBatch)。ダイアログが選ばれるまで
            // _handleSyncConflictのPromiseは解決しないため、ここではawaitせずfire-and-forgetで
            // 呼び、ダイアログの出現をlocatorの自動待ちで確認する。
            await page.evaluate(() => {
                window.bookshelf._scheduleSync();
                window.bookshelf._runPendingSync();
            });

            const dlg = page.locator('#sync-conflict-dialog');
            await expect(dlg).toBeVisible({ timeout: 10_000 });
            await expect(dlg.locator('.cfm-message')).toContainText('Asayake ハブ');
            await expect(dlg.locator('.cfm-cancel')).toHaveText('何もしない');
            await expect(dlg.locator('.cfm-export')).toHaveText('編集内容をJSONで書き出す');
            await expect(dlg.locator('.cfm-ok')).toHaveText('再読込して最新版を取得');

            // 「何もしない」を選べる(今の振る舞い): ダイアログが閉じる
            await dlg.locator('.cfm-cancel').click();
            await expect(dlg).toBeHidden();
        });
    }
});
