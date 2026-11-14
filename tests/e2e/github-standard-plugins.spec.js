// イシュー#683: GitHub を保存先にすると、標準機能5個 (js/plugin-loader.js の STANDARD_PLUGIN_IDS) が1回目の起動でリポジトリに書き込まれ
// (シード)、同じ起動で有効になる。再読込の後も5個のままで、シードを書き直さない。
// 前は E2E の GitHub の模擬 (helpers/gate-github.js) がフォルダの一覧を返さず、GitHub の E2E ではプラグインが常に0個で、
// 起動のたびにシードを書き直していた (683-results.md §1)。プラグインの数の読み方は plugin-seed.spec.js と同じ (bookshelf._* ではない)。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest } from './helpers/gate-github.js';

const STANDARD_IDS = ['author-grouping', 'dark-theme', 'highlights-builtin', 'series-grouping', 'memo-templates'].sort();

const loadedPluginIds = (page) => page.evaluate(() => {
    const l = window.bookshelf && window.bookshelf.pluginLoader;
    return l ? [...l.loaded.keys()].sort() : [];
});
// リポジトリの main にある plugins/<id>/ の id
const repoPluginIds = (gh) => [...new Set([...gh.trees.get(gh.commits.get(gh.head).tree).keys()]
    .filter((p) => p.startsWith('plugins/')).map((p) => p.split('/')[1]))].sort();
// main の履歴のうち、plugins/ の下を書いた commit の数 (シードの書き込みの回数)
function seedCommitCount(gh) {
    let n = 0;
    for (let sha = gh.head; sha;) {
        const c = gh.commits.get(sha);
        const parent = c.parents[0] ? gh.commits.get(c.parents[0]) : null;
        if (parent) {
            const now = gh.trees.get(c.tree);
            const before = gh.trees.get(parent.tree);
            if ([...now.keys()].some((p) => p.startsWith('plugins/') && now.get(p) !== before.get(p))) n += 1;
        }
        sha = c.parents[0] || null;
    }
    return n;
}
// from 番目から後に届いた、まとめ保存の書き込み (blobs・trees の POST) の数
const batchWrites = (gh, from) => gh.requests.slice(from).filter((r) => r.method === 'POST' && /\/git\/(blobs|trees)$/.test(r.path)).length;

test('GitHub: 1回目の起動で標準機能5個がリポジトリに書き込まれて有効になり、再読込の後も5個のまま、書き直さない', async ({ page }) => {
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    await seedGitHubLoginForTest(page, gh);
    await mockGitHubForTest(page, gh);

    // 1回目の起動: シードが1回入り、同じ起動で5個が有効になる
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect.poll(() => loadedPluginIds(page), { timeout: 20_000 }).toEqual(STANDARD_IDS);
    expect(repoPluginIds(gh), 'リポジトリに標準機能5個がある').toEqual(STANDARD_IDS);
    expect(seedCommitCount(gh), '1回目の起動のシードの書き込み').toBe(1);
    const failed = await page.evaluate(() => [...window.bookshelf.pluginLoader.failedToLoad.entries()]);
    expect(failed, '標準機能の読み込みの失敗が無い').toEqual([]);

    // 再読込: 一覧から5個が読めるので、シードを書かずに5個が有効になる
    const sentBefore = gh.requests.length;
    await page.reload();
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await waitForHubStartupForTest(page);
    // ensureStandardPlugins の後に loadEnabledPlugins が流れる (js/bookshelf.js _runStartupTail) ので、5個が有効になった時には書くかどうかが決まっている
    await expect.poll(() => loadedPluginIds(page), { timeout: 20_000 }).toEqual(STANDARD_IDS);
    expect(batchWrites(gh, sentBefore), '再読込の後のまとめ保存の書き込み (blobs・trees の POST)').toBe(0);
    expect(seedCommitCount(gh), 'シードの書き込みは1回目の起動の1回だけ').toBe(1);
    expect(repoPluginIds(gh)).toEqual(STANDARD_IDS);
});
