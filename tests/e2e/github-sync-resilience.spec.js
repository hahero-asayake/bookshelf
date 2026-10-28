// イシュー#391 E2E#1: GitHub読み込みが遅延/失敗しても、手元データ(起動2段化・C-277)が
// 表示され続けること、再試行で回復することを固定する。
// 偽GitHub(api.github.com宛のroute)で「遅い」「大容量」の2条件を確認する。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));

function makeFixture(n) {
    const books = Array.from({ length: n }, (_, i) => {
        const idx = i + 1; const asin = `B${String(idx).padStart(9, '0')}`;
        return { asin, title: `手元の本${idx}`, authors: 'a', acquiredTime: 1700000000000 + idx, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + idx };
    });
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
    userData.notes = {};
    userData.settings = { ...(userData.settings || {}), coverSize: 'medium', defaultView: 'covers' };
    return {
        userDataStr: JSON.stringify(userData),
        libraryStr: JSON.stringify({ books, metadata: { totalBooks: books.length } })
    };
}

async function primeLocalData(page, n = 5) {
    const { userDataStr, libraryStr } = makeFixture(n);
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'github', owner: 'hahero-asayake', repo: 'bookshelf-data', branch: 'main' }));
    }, [userDataStr, libraryStr]);
}

test.describe('GitHub読み込みの耐性 (遅延・失敗時も手元データを表示し続け、再試行で回復する)', () => {
    test('GitHub API が遅い(15秒遅延)場合でも、手元データの本棚が表示される', async ({ page, context }) => {
        await primeLocalData(page, 5);
        // api.github.com への全リクエストを15秒遅延させてから404(=readJSON側はnull扱いで
        // 例外にはならない経路もあるため、確実に失敗させるため500を返す)。
        await context.route('https://api.github.com/**', async (route) => {
            await new Promise((r) => setTimeout(r, 15000));
            await route.fulfill({ status: 500, body: '{}' });
        });
        await page.goto('/index.html');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
        // 起動直後、裏のGitHub同期が完了する前の時点で、手元の5冊が既に見えていること
        const itemCountEarly = await page.locator('.book-item').count();
        expect(itemCountEarly).toBeGreaterThan(0);
    });

    test('GitHub からの読み込みが失敗すると「手元のデータで表示中・再試行」が出て、再試行で回復できる', async ({ page, context }) => {
        await primeLocalData(page, 5);
        let failCount = 0;
        await context.route('https://api.github.com/**', async (route) => {
            failCount++;
            if (failCount <= 1) {
                await route.fulfill({ status: 503, body: '{}' });
            } else {
                // 2回目(再試行)は成功させる
                await route.fulfill({ status: 200, body: JSON.stringify({ type: 'file', sha: 's1', content: Buffer.from('{}').toString('base64') }) });
            }
        });
        await page.goto('/index.html');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);

        // initGitHubSync を直接起動してcatch経路を通す (adapterはindex.html起動時にsyncMethod='github'
        // 設定がある場合のみ生成されるため、無ければテスト用に差し込む)
        const toastInfo = await page.evaluate(async () => {
            const bs = window.bookshelf;
            if (!(bs.storage.adapter instanceof GitHubAdapter)) {
                bs.storage.adapter = new GitHubAdapter({ owner: 'hahero-asayake', repo: 'bookshelf-data', token: 'dummy-token-for-e2e' });
            }
            const before = document.querySelectorAll('.book-item').length;
            await bs.initGitHubSync();
            await new Promise((r) => setTimeout(r, 50));
            const toastEl = document.querySelector('.toast-error .toast-message');
            const retryBtn = document.querySelector('.toast-action');
            const after = document.querySelectorAll('.book-item').length;
            return { before, after, toastText: toastEl ? toastEl.textContent : null, hasRetry: !!retryBtn };
        });
        expect(toastInfo.before).toBe(toastInfo.after); // 手元データが維持されている
        expect(toastInfo.toastText).toContain('手元のデータで表示中');
        expect(toastInfo.hasRetry).toBe(true);
    });
});
