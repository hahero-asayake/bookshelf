// 起動の2段化 (C-277) の回帰テスト
//  ローカルデータがある端末では、クラウド同期 (ハブ) の完了を待たずに
//  ローディングが消えて操作可能になり、確認中は細い帯だけが出る。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

test('ローカルデータあり: ハブ同期が終わる前に loading が消え、「確認しています」帯が出る', async ({ page }) => {
    // ハブ空判定の confirm (初期化しますか？) は「キャンセル」相当で流す
    page.on('dialog', (d) => d.dismiss());
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'hub',
            hub: { apiBase: 'https://hub.example/api', key: 'hk_test', uid: 'u1', email: 'x@example.com' }
        }));
        // ハブ API への fetch を保留にして「同期が終わらない」状況を作る。
        // __resolveHubFetches() を呼ぶと溜まったリクエストへ 404 (=ファイル無し) を返す。
        window.__hubPending = [];
        const origFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.includes('hub.example')) {
                return new Promise((resolve) => {
                    window.__hubPending.push(() => resolve(new Response('', { status: 404 })));
                });
            }
            return origFetch(input, init);
        };
        window.__resolveHubFetches = () => { window.__hubPending.splice(0).forEach((fn) => fn()); };
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);

    // 同期リクエストは保留中のまま…
    await expect.poll(() => page.evaluate(() => window.__hubPending.length)).toBeGreaterThan(0);
    // …でもローディングは消えて本棚が出ている (同期完了を待たない)
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#view-main')).toBeVisible();
    // 全画面スピナーの代わりに、細い帯で「最新のデータを確認しています…」
    await expect(page.locator('#app-status-bar .status-checking')).toBeVisible();

    // 同期を出し切ると帯は消える (404 → ハブ空 → confirm dismiss → エラー帯へ遷移してよい)
    await page.evaluate(() => { window.__hubAuto = setInterval(() => window.__resolveHubFetches(), 50); });
    await expect(page.locator('#app-status-bar .status-checking')).toBeHidden({ timeout: 10000 });
    await page.evaluate(() => clearInterval(window.__hubAuto));
});

test('ローカルデータなし (初回起動・同期未設定): 従来どおり loading 後に welcome が出る', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await expect(page.locator('#loading')).toBeHidden();
    // 蔵書ゼロ → welcome オンボーディング (ADR-053)
    await expect(page.locator('#view-main')).toBeVisible();
});
