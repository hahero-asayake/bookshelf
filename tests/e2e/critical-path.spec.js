// クリティカルパス台本 (ui-standards 観点2・シナリオ通し)
//  初回訪問 → 取込 (貼り付け) → リロード耐性 → 評価 → 公開プレビュー → ハブ接続 → 課金 → Plus 反映 → 退会
//  ハブ API (usage / billing / account) は route モック。意地悪ステップ (二度押し・リロード) を混ぜる。
//  ローンチ判定: この1本が緑 = 主要導線が通しで壊れていない。
import { test, expect } from '@playwright/test';

const HUB = 'https://mockhub.test';
const MB = 1024 * 1024;

const PASTE_JSON = JSON.stringify([
    { title: '旅の本', authors: '著者X', acquiredTime: 1700000000000, readStatus: 'UNKNOWN', asin: 'B0JOURNEY1', productImage: '' },
    { title: '山の本', authors: '著者Y', acquiredTime: 1700000001000, readStatus: 'READ', asin: 'B0JOURNEY2', productImage: '' }
]);

test('クリティカルパス: 初回→取込→公開→課金→退会 が通しで成立する', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    // ネイティブ confirm (退会・ログアウト) は常に OK
    page.on('dialog', (d) => d.accept());

    // --- ハブ API モック (plan は課金後に plus へ遷移) ---
    const hubState = { plan: 'free' };
    await page.route(`${HUB}/**`, async (route) => {
        const url = route.request().url();
        const method = route.request().method();
        if (url.includes('/usage')) {
            return route.fulfill({ json: { plan: hubState.plan, usedBytes: 10 * MB, quotaBytes: (hubState.plan === 'plus' ? 3072 : 100) * MB, billingManaged: hubState.plan === 'plus' } });
        }
        if (url.includes('/billing/checkout')) {
            hubState.plan = 'plus';   // 決済完了扱い (Webhook 相当)
            return route.fulfill({ json: { url: 'http://localhost:8000/index.html?billing=success' } });
        }
        if (url.includes('/account') && method === 'DELETE') {
            return route.fulfill({ json: { ok: true, deleted: true } });
        }
        return route.fulfill({ status: 404, json: {} });
    });

    // --- 起動 (真の初回: 蔵書ゼロ・ガード付きシードでリロード後も状態維持) ---
    // 注: ローカル保存が空だと data/ のフォールバック (公開モード用サンプル) が読まれるのが現仕様。
    //     welcome は QW4 と同じ方法 (蔵書ゼロ化) で成立させる。
    await page.addInitScript(() => {
        if (!localStorage.getItem('bs_e2e_journey')) {
            localStorage.setItem('bs_e2e_journey', '1');
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
            localStorage.setItem('virtualBookshelf_library', '[]');   // 真の初回 (data/ フォールバックを無効化)
        }
    });
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);

    // ⚠️ 発見 (2026-07-27 シナリオ打鍵): ローカル保存が空の初回訪問では data/library.json (公開フォールバック・
    //    2400冊超のフルエクスポート) が読み込まれるため、蔵書0の welcome オンボーディングは本番では出ない。
    //    フォールバックの扱い (撤去/縮小/維持) は本人判断待ち。本テストは現仕様 (フォールバックあり) を前提に走る。
    const baseline = await page.evaluate(() => (window.bookshelf.books || []).length);

    await test.step('取込: 貼り付け→全選択→確定を二度押ししても重複しない', async () => {
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.locator('#kindle-paste-input').fill(PASTE_JSON);
        await page.locator('#import-from-paste').click();
        await expect(page.locator('#book-selection')).toBeVisible();
        await expect(page.locator('#book-list .book-selection-item')).toHaveCount(2);
        await page.getByRole('button', { name: '全て選択' }).click();
        // 意地悪: 確定ボタンを素早く2回 (二重取込防止)
        const confirmBtn = page.getByRole('button', { name: '選択した本を取り込む' });
        await confirmBtn.click();
        await confirmBtn.click({ timeout: 1000 }).catch(() => {});
        await page.waitForFunction((b) => (window.bookshelf.books || []).length >= b + 2, baseline);
        const count = await page.evaluate(() => window.bookshelf.books.length);
        expect(count).toBe(baseline + 2);   // baseline+4 になったら二重取込
        await page.keyboard.press('Escape');   // 標準操作で閉じる
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
    });

    await test.step('意地悪: リロードしても取込結果が残る', async () => {
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        const count = await page.evaluate(() => (window.bookshelf.books || []).length);
        expect(count).toBe(baseline + 2);
    });

    await test.step('公開: ページ新規作成→プレビュー生成', async () => {
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#pp-new');
        await expect(page.locator('#pp-edit-view')).toBeVisible();
        await page.selectOption('#pp-style', 'shelf-sections');
        await page.click('#pp-shelves .bs-pick-row');
        await page.click('#pp-preview');
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        expect(srcdoc).not.toContain('生成できませんでした');
        expect(srcdoc).not.toContain('プレビュー失敗');
        expect(srcdoc).toContain('legal/terms.html');       // フッター法務リンク (WP-B5)
        expect(srcdoc).toContain('このページを通報');
        await page.keyboard.press('Escape');
    });

    await test.step('ハブ接続 (キャッシュ注入) → 無料プラン表示', async () => {
        await page.evaluate(([hub]) => {
            const cfg = JSON.parse(localStorage.getItem('bookshelf_sync'));
            cfg.hub = { key: 'hk_journey', apiBase: hub, email: 'journey@example.com', plan: 'free', usedBytes: 10 * 1048576, quotaBytes: 100 * 1048576 };
            localStorage.setItem('bookshelf_sync', JSON.stringify(cfg));
        }, [HUB]);
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await expect(page.locator('#sidebar-account-plan')).toHaveText('無料');
    });

    await test.step('課金: アップグレード→決済戻り→Plus 反映 (指数バックオフ)', async () => {
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; window.bookshelf._openSettingsModal('account-section'); });
        const yearly = page.locator('#account-upgrade-yearly');
        await expect(yearly).toBeVisible();
        await Promise.all([
            page.waitForURL(/billing=success/),
            yearly.click()
        ]);
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        // WP-B4: 最初のリトライ (2 秒) で /usage が plus を返し、チップが Plus になる
        await expect(page.locator('#sidebar-account-plan')).toHaveText('Plus', { timeout: 10_000 });
    });

    await test.step('退会: アカウント削除→接続情報が消えてログイン表示に戻る', async () => {
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; window.bookshelf._openSettingsModal('account-section'); });
        await page.locator('#account-delete-btn').click();
        // DELETE 成功 → HubAuth.disconnect() が接続情報を消して reload する
        await page.waitForFunction(
            () => !((JSON.parse(localStorage.getItem('bookshelf_sync') || '{}').hub || {}).key),
            null, { timeout: 20_000 }
        );
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, null, { timeout: 15_000 });
        await expect(page.locator('#sidebar-account-label')).toHaveText('ログイン');
    });

    // 通し中に console エラーゼロ (GIS 外部スクリプト等の環境要因は除外)
    expect(errors.filter(e => !/accounts\.google|gsi|net::ERR/.test(e))).toEqual([]);
});
