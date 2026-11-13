// 門のE2E (イシュー#588)。観測点 J6-2「GitHub：保存→別の端末で読める」(G-3)。
// 利用者と同じ操作だけで、保存先を GitHub のリポジトリにした端末Aで本の短文メモを書き、別の端末 (2つ目のブラウザ
// コンテキスト＝localStorage を共有しない) で同じリポジトリにつないでアプリを開くと、その短文メモが読めることを確かめる。
// GitHub は tests/e2e/helpers/gate-github.js の模擬 (2台で同じリポジトリを読み書きする)。アプリの読み書きは差し替えない。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { waitForHubStartupForTest } from '../helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest, waitForGitHubFileContainsForTest } from '../helpers/gate-github.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from '../helpers/gate-device.js';

const BOOK = 'フィクスチャの本 1';
const MEMO = '門のE2E J6-2 端末AからGitHubへ保存した短文メモ';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();

test('@gate J6-2 GitHub：端末Aで書いた短文メモが、別の端末で開くと読める', async ({ page }) => {
    let gh = null;
    let other = null;

    await test.step('前提: リポジトリに蔵書を置き、端末Aを GitHub に接続した (保存先 = そのリポジトリ) 状態でアプリを開く', async () => {
        gh = createMockGitHubForTest();
        seedGitHubDataForTest(gh);
        await seedGitHubLoginForTest(page, gh);
        await mockGitHubForTest(page, gh);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('操作: 端末Aで本を開き、短文メモを書いて「保存しました」を待つ', async () => {
        await bookButton(page).click();
        await memoBox(page).fill(MEMO);
        await expect(page.locator('.save-note-status:visible').first()).toContainText('保存しました');
    });

    await test.step('前提: 短文メモがリポジトリに届くのを待ち、別の端末を用意する (同じリポジトリに接続済み・端末内の蔵書は空)', async () => {
        await waitForGitHubFileContainsForTest(gh, 'private/notes.json', MEMO);
        other = await prepareOtherDeviceForTest(page, gh);
    });

    await test.step('操作: 別の端末でアプリを開き、同じ本を開く', async () => {
        await other.goto('index.html');
        await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
        await bookButton(other).click();
    });

    await test.step('確認: 別の端末に、端末Aで書いた短文メモが見える', async () => {
        await expect(memoBox(other)).toHaveValue(MEMO);
    });

    await test.step('前提: 別の端末を閉じる', async () => {
        await closeOtherDeviceForTest(other);
    });
});
