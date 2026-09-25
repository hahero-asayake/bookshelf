// 公開先の格下げ (ADR-099・イシュー#220): 設定→公開で、公開先の切替 (自前の GitHub 公開) は「一度決めたら触らない設定項目」として
// 折りたたみ (公開先の変更) の中に置く。既定はハブ。自前公開を選ぶと「ハブの索引に載りません」を明示する。
// 配置は 3 幅 (1280 / 900 以下 / スマホ) で boundingBox を数値検証する (UI の整列が弱い→座標で検証してから見せる)。
// ISSUE220_SHOT_DIR を指定すると同じ状態のスクリーンショットも保存する (検証の証跡用・通常の CI では保存しない)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const SHOT_DIR = process.env.ISSUE220_SHOT_DIR || '';
const HUB = 'https://mockhub.test';

async function boot(page, { target = null } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.route(`${HUB}/**`, (route) => route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576 } }));
    await page.addInitScript(([userData, library, hub, target]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            hub: { key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free', siteId: 'sid', publicBase: `${hub}/public/sid/`, username: 'alice', bookshelfBase: 'https://bookshelf.asayake.org/alice/' },
            ...(target ? { publish: { target } } : {})
        }));
    }, [fixtureUserData, fixtureLibrary, HUB, target]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.HubAuth.renderSignInButton = () => {};
        window.bookshelf.saveUserData = async () => {};
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}

async function shot(page, name) {
    if (!SHOT_DIR) return;
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

test.describe('公開先の格下げ (設定→公開)', () => {
    test('既定 (ハブ): 公開先の切替は折りたたまれ、ハブの状態表示が主導線。「公開先の変更」を開くと切替が出る', async ({ page }) => {
        const errors = await boot(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal('publish-section'));
        await expect(page.locator('#publish-section')).toHaveClass(/pane-active/);
        await expect(page.locator('#publish-config-hub')).toBeVisible();          // 主導線
        await expect(page.locator('#publish-target-details > summary')).toBeVisible();
        expect(await page.locator('#publish-target-details').evaluate(d => d.open)).toBe(false);
        await expect(page.locator('#publish-target-select')).toBeHidden();         // 切替は畳まれている
        await expect(page.locator('#publish-config-github')).toBeHidden();
        await expect(page.locator('#publish-index-note')).toBeHidden();
        await page.locator('#publish-target-details > summary').click();
        await expect(page.locator('#publish-target-select')).toBeVisible();
        await expect(page.locator('#publish-target-select')).toHaveValue('hub');
        expect(errors).toEqual([]);
    });

    test('設定への案内 (_openSettingsModal(publish-target-select)) は折りたたみを開いて切替を見せる', async ({ page }) => {
        const errors = await boot(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal('publish-target-select'));
        await expect(page.locator('#publish-target-select')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('自前公開 (GitHub) を選ぶと「ハブの索引に載りません」を明示し、リポジトリ設定が出る。ハブに戻すと注記は消える', async ({ page }) => {
        const errors = await boot(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal('publish-target-select'));
        await page.selectOption('#publish-target-select', 'github');
        await expect(page.locator('#publish-index-note')).toBeVisible();
        await expect(page.locator('#publish-index-note')).toContainText('ハブの索引（タグ検索・/top・マイページ）には載りません');
        await expect(page.locator('#publish-config-github')).toBeVisible();
        await expect(page.locator('#publish-config-hub')).toBeHidden();
        await page.selectOption('#publish-target-select', 'hub');
        await expect(page.locator('#publish-index-note')).toBeHidden();
        await expect(page.locator('#publish-config-hub')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('自前公開を選んで保存済みの人には、設定を開いた時点で折りたたみが開いていて注記も見える', async ({ page }) => {
        const errors = await boot(page, { target: 'github' });
        await page.evaluate(() => window.bookshelf._openSettingsModal('publish-section'));
        expect(await page.locator('#publish-target-details').evaluate(d => d.open)).toBe(true);
        await expect(page.locator('#publish-index-note')).toBeVisible();
        await expect(page.locator('#publish-config-github')).toBeVisible();
        expect(errors).toEqual([]);
    });

    for (const [name, w, h] of [['1280', 1280, 800], ['800', 800, 900], ['390', 390, 844]]) {
        test(`配置 (${w}x${h}): 主要要素の左端が揃い、重ならず、画面内に収まる (畳んだ状態と GitHub 選択の展開状態)`, async ({ page }) => {
            await page.setViewportSize({ width: w, height: h });
            const errors = await boot(page);
            await page.evaluate(() => window.bookshelf._openSettingsModal('publish-section'));
            await expect(page.locator('#publish-section')).toHaveClass(/pane-active/);
            const box = async (sel) => { const b = await page.locator(sel).boundingBox(); expect(b, sel).not.toBeNull(); return b; };
            const near = (a, b, tol, msg) => expect(Math.abs(a - b), `${msg}: ${a} vs ${b}`).toBeLessThanOrEqual(tol);
            const scroller = async () => page.locator('#publish-section .settings-section-body').evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));

            // --- 畳んだ状態 ---
            await page.locator('#publish-section').scrollIntoViewIfNeeded();
            await shot(page, `publish-target-collapsed-${name}`);
            const name1 = await box('#setting-public-name'), hub = await box('#publish-config-hub'), sum = await box('#publish-target-details > summary'), det = await box('#publish-target-details');
            near(name1.x, hub.x, 1, '公開名義の入力と hub ブロックの左端');
            near(name1.x, det.x, 1, '公開名義の入力と公開先の変更の左端');
            near(hub.x + hub.width, det.x + det.width, 1, 'hub ブロックと公開先の変更の右端');
            // 入力は幅の上限 (420px・ui-standards §5) で枠より狭くなり得る。枠からははみ出さないことを見る
            expect(name1.x + name1.width, '公開名義の入力が枠内').toBeLessThanOrEqual(det.x + det.width + 1);
            expect(name1.y + name1.height, '入力 → hub ブロック の順で重ならない').toBeLessThanOrEqual(hub.y + 0.5);
            expect(hub.y + hub.height, 'hub ブロック → 公開先の変更 の順で重ならない').toBeLessThanOrEqual(det.y + 0.5);
            expect(sum.y, '見出しが折りたたみ枠内').toBeGreaterThanOrEqual(det.y - 0.5);
            expect(sum.y + sum.height).toBeLessThanOrEqual(det.y + det.height + 0.5);
            expect(det.x + det.width, '右端が画面内').toBeLessThanOrEqual(w);
            const s1 = await scroller(); expect(s1.sw, '横あふれ無し (畳んだ状態)').toBeLessThanOrEqual(s1.cw + 1);
            // 畳んだ状態の高さは 1 行分 (目立たない): 見出しが 44px 以内
            expect(sum.height, '畳んだ見出しは 1 行分').toBeLessThanOrEqual(64);

            // --- GitHub 選択の展開状態 ---
            await page.locator('#publish-target-details > summary').click();
            await page.selectOption('#publish-target-select', 'github');
            await expect(page.locator('#publish-index-note')).toBeVisible();
            await page.locator('#publish-index-note').scrollIntoViewIfNeeded();
            await shot(page, `publish-target-github-${name}`);
            const label = await box('#publish-target-details label[for="publish-target-select"]'), sel = await box('#publish-target-select');
            const note = await box('#publish-index-note'), repoLabel = await box('#publish-config-github label[for="publish-repo-select"]'), repo = await box('#publish-repo-select');
            near(label.x, sel.x, 1, '公開先ラベルとセレクトの左端');
            near(sel.x, note.x, 1, 'セレクトと注記の左端');
            near(sel.x, repo.x, 1, '公開先セレクトとリポジトリ選択の左端');
            near(repoLabel.x, repo.x, 1, 'リポジトリのラベルと選択の左端');
            near(sel.width, repo.width, 1, '2 つのセレクトの幅');
            expect(label.y + label.height, 'ラベル → セレクト').toBeLessThanOrEqual(sel.y + 0.5);
            expect(sel.y + sel.height, 'セレクト → 注記').toBeLessThanOrEqual(note.y + 0.5);
            expect(note.y + note.height, '注記 → リポジトリ設定').toBeLessThanOrEqual(repoLabel.y + 0.5);
            const det2 = await box('#publish-target-details');
            for (const [n, b] of [['セレクト', sel], ['注記', note], ['リポジトリ選択', repo]]) {
                expect(b.x, `${n} 左が枠内`).toBeGreaterThanOrEqual(det2.x - 0.5);
                expect(b.x + b.width, `${n} 右が枠内`).toBeLessThanOrEqual(det2.x + det2.width + 0.5);
            }
            expect(det2.x + det2.width, '右端が画面内').toBeLessThanOrEqual(w);
            const s2 = await scroller(); expect(s2.sw, '横あふれ無し (展開状態)').toBeLessThanOrEqual(s2.cw + 1);
            expect(errors).toEqual([]);
        });
    }
});
