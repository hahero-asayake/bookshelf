// イシュー#156 スコープ2: 記事プレビューを「実アダプタ（GitHubAdapter）＋実 fetch」経由で回す再現ハーネス。
//
// #155 はメモリ Map 差し替えアダプタで計測したため「実際に fetch が走るハング」を原理的に検証できない
// (adapter.readText 自体を直接差し替えると、fetch レイヤーの遅延・停止・タイムアウト機構を素通りする)。
// ここでは bookshelf_sync の method を 'github' にして SyncConfigManager.buildAdapter() に実際の
// GitHubAdapter を組み立てさせ、window.bookshelf.storage.adapter が本物の GitHubAdapter インスタンスに
// なった状態でプレビューを実行する。ネットワーク層だけを Playwright の page.route で差し替える
// (StorageAdapter.fetchText/fetchJSON・GitHubAdapter._getContent はコードの変更なしに実行される)。
//
// 【このテストが検証していないこと】
// - GitHubAdapter 経由での検証は、ハヘロの実環境が実際に GitHub アダプタであることを本人に確認済み
//   (2026-09-06 21:51 本人回答・projects/detail/bookshelf.md 参照) なので実環境相当だが、
//   Asayake ハブ(HubStorageAdapter) 経由の検証はここでは行わない (fetchText/fetchJSON を共有する
//   実装のため機序は同一と推定されるが、実測はしていない)。
// - ヘッダ受信直後・ボディ読了直前の間だけを止める応答は、Playwright の route.fulfill() が
//   レスポンスを一括で返す仕組みのため技術的に再現できない (ストリーミング分割送信の直接サポートが無い)。
//   代わりに「fetch 自体が最後まで応答しない」ケース (route ハンドラを恒久的に pending させる) で
//   タイムアウト機構が実アダプタ+実ブラウザ fetch 経由でも機能するかを検証する。
// - 蔵書規模による描画遅延(容疑者③)・ブラウザ環境固有(容疑者④) は対象外 (このイシューのスコープ外)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

const OWNER = 'testowner';
const REPO = 'testrepo';
const BRANCH = 'main';

function b64(text) {
    return Buffer.from(text, 'utf-8').toString('base64');
}

// GitHubAdapter.readText の呼び出し path (private/books/<ASIN>__<title>.md) が
// GitHub Contents API URL のどの位置に来るかは js/github-adapter.js:_apiUrl 参照。
function contentsUrlPattern() {
    return `https://api.github.com/repos/${OWNER}/${REPO}/contents/**`;
}

// 起動時にアプリが GitHub アダプタで自動的に何を叩くか(installations確認・接続チェック等)は
// tests/e2e/username-publish-gate.spec.js の実測パターンを踏襲し、未知のリクエストは安全なダミーで
// フルフィルする。長文メモ (.md) への GET だけ、テストごとに渡された responder で個別制御する。
async function bootAppGitHub(page, { onContentsGet } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.route('https://api.github.com/**', async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        const m = url.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/contents/(.+)$`));
        if (method === 'GET' && m) {
            const path = decodeURIComponent(m[1]);
            if (path.startsWith('private/books/') && onContentsGet) {
                return onContentsGet(route, path);
            }
        }
        // 起動時の installations 確認等、このテストの関心外のリクエストは無害な既定応答を返す。
        return route.fulfill({ status: 200, json: { installations: [], repositories: [] } });
    });

    await page.addInitScript(([userData, library, owner, repo, branch]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
            github: { owner, repo, branch, basePath: '', token: 'ghu_test_token' }
        }));
    }, [fixtureUserData, fixtureLibrary, OWNER, REPO, BRANCH]);

    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    // 自動同期の書込みはこのテストの関心外 (プレビュー生成のみを見る)。GET (readText) は
    // 実アダプタのまま通す一方、書込経路だけ無害化する (既存 bootApp パターンに倣う)。
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.HubAuth.renderSignInButton = () => {};
    });
    return errors;
}

// fixture の本 (B000000001〜) に長文メモ有りフラグを立て、本棚ブロック+longMemo表示ONの記事を作る。
async function createArticleWithLongMemoShelf(page, { bookCount = 3 } = {}) {
    await page.evaluate((count) => {
        window.bookshelf.userData.notes = window.bookshelf.userData.notes || {};
        for (let i = 1; i <= count; i++) {
            const asin = `B${String(i).padStart(9, '0')}`;
            window.bookshelf.userData.notes[asin] = { ...(window.bookshelf.userData.notes[asin] || {}), hasDetailMemo: true };
        }
    }, bookCount);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.locator('.art-add-btn').first().click();
    await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
    const drawerItems = page.locator('#art-drawer-list .art-drawer-item');
    const n = Math.min(bookCount, await drawerItems.count());
    for (let i = 0; i < n; i++) await drawerItems.nth(i).click();
    // ホバーで開いたツールチップ (「長文メモあり」等) が次のトグルのクリックを intercept することがある
    // ため、クリック前に mouse.move(0,0) でツールチップを閉じてから操作する (イシュー#133 系の実測パターン)。
    const longToggles = page.locator('.art-item-show-toggle[data-show-key="longMemo"]');
    const toggleCount = await longToggles.count();
    for (let i = 0; i < toggleCount; i++) {
        await page.mouse.move(0, 0);
        const t = longToggles.nth(i);
        if (!(await t.getAttribute('aria-pressed')).includes('true')) await t.click();
    }
}

test('(a) 通常応答: 実GitHubAdapter+実fetch経由でプレビューが完走する(容疑者②=fetchハングは実アダプタでも再現せず)', async ({ page }) => {
    const errors = await bootAppGitHub(page, {
        onContentsGet: (route, path) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ type: 'file', sha: 's1', content: b64(`# 長文メモ\n\n${path} の本文。`) })
        })
    });
    await createArticleWithLongMemoShelf(page, { bookCount: 3 });

    const startedAt = Date.now();
    await page.click('#art-preview');
    await expect.poll(async () => {
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        return srcdoc;
    }, { timeout: 10000 }).not.toContain('生成中');
    const elapsedMs = Date.now() - startedAt;

    const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
    expect(srcdoc).toContain('長文メモ');
    await expect(page.locator('#pp-preview-stall')).toBeHidden();
    expect(errors).toEqual([]);
    console.log(`[preview-real-adapter] (a) 通常応答 完走所要=${elapsedMs}ms (3冊・GitHubAdapter実fetch経由)`);
});

test('(b) 遅延応答(2000ms/冊×3冊): stallMs(20秒)未満のため完走する', async ({ page }) => {
    const errors = await bootAppGitHub(page, {
        onContentsGet: async (route, path) => {
            await new Promise((r) => setTimeout(r, 2000));
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ type: 'file', sha: 's1', content: b64(`# 長文メモ(遅延)\n\n${path}`) })
            });
        }
    });
    await createArticleWithLongMemoShelf(page, { bookCount: 3 });

    const startedAt = Date.now();
    await page.click('#art-preview');
    await expect.poll(async () => {
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        return srcdoc;
    }, { timeout: 15000 }).not.toContain('生成中');
    const elapsedMs = Date.now() - startedAt;

    await expect(page.locator('#pp-preview-stall')).toBeHidden();
    expect(errors).toEqual([]);
    console.log(`[preview-real-adapter] (b) 遅延応答(2000ms×3冊) 完走所要=${elapsedMs}ms (理論値目安 約6000ms・GitHubAdapter実fetch経由)`);
});

test('(c) fetchが最後まで応答しない場合、実GitHubAdapter+実fetch経由でもストール表示が発火し、段階名(fetch-start)とアダプタ種別(GitHub)が画面に出る', async ({ page }) => {
    const errors = await bootAppGitHub(page, {
        onContentsGet: () => new Promise(() => {}) // 恒久的にpending (route.fulfillを一切呼ばない)
    });
    await page.evaluate(() => {
        window.bookshelf._artPreviewStallMs = 1000; // 実時間20秒を待たないよう短く注入 (既存パターン踏襲)
    });
    await createArticleWithLongMemoShelf(page, { bookCount: 1 });

    await page.click('#art-preview');
    await expect(page.locator('#pp-preview-stall')).toBeVisible({ timeout: 10000 });
    const stallMsg = await page.locator('#pp-preview-stall-msg').textContent();
    console.log(`[preview-real-adapter] (c) fetch無応答 ストール表示文言="${stallMsg}"`);
    expect(stallMsg).toContain('長文メモ');
    expect(stallMsg).toContain('GitHub');
    expect(stallMsg).toContain('へ問合せ中');
    expect(errors).toEqual([]);
});
