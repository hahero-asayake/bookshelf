// 記事の通報ダイアログ (公開記事フッタの ?report=<記事URL>) と、管理者の通報審査パネル (ADR-099・イシュー#220)。
// ハブ API は page.route で差し替える。通報ダイアログは docs/ui-standards.md §1 の標準操作 (ESC・戻る・枠外クリックでは閉じない) も打鍵する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const HUB = 'https://mockhub.test';
const ARTICLE = 'https://bookshelf.asayake.org/alice/AbCdEfGhIj/';

// hub 接続済み (loggedIn=false なら hub 無し)・管理者かどうかを指定して起動する。/report と /admin は state で挙動を変える。
async function boot(page, { loggedIn = true, isAdmin = false, query = '', reportStatus = 200 } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error' && !/status of (4\d\d|5\d\d)/.test(msg.text())) errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    const captured = { reports: [], admin: [] };
    const state = {
        reports: [{ articleId: 'sA', url: ARTICLE, title: 'アリスの記事', articleStatus: 'active', count: 2, categories: { spam: 1, abuse: 1 }, latestReason: '広告ばかり', latestAt: 1, reportIds: ['r1', 'r2'] }],
        hidden: []
    };
    await page.route(`${HUB}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (path === '/usage') return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576, isAdmin } });
        if (path === '/community/report') {
            captured.reports.push({ auth: req.headers()['authorization'], body: req.postDataJSON() });
            return route.fulfill({ status: reportStatus, json: reportStatus === 200 ? { ok: true } : { error: 'x' } });
        }
        if (path === '/admin/reports' && req.method() === 'GET') return route.fulfill({ json: { reports: state.reports, hidden: state.hidden } });
        let m;
        if ((m = path.match(/^\/admin\/articles\/([^/]+)\/(hide|restore)$/))) {
            captured.admin.push(`${m[2]}:${m[1]}`);
            if (m[2] === 'hide') { const a = state.reports.find(r => r.articleId === m[1]); state.reports = state.reports.filter(r => r.articleId !== m[1]); if (a) state.hidden.push({ articleId: a.articleId, url: a.url, title: a.title, reportCount: a.count }); }
            else state.hidden = state.hidden.filter(h => h.articleId !== m[1]);
            return route.fulfill({ json: { ok: true } });
        }
        if ((m = path.match(/^\/admin\/reports\/([^/]+)\/dismiss$/))) {
            captured.admin.push(`dismiss:${m[1]}`);
            return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ status: 404, json: {} });
    });
    await page.addInitScript(([userData, library, hub, loggedIn, isAdmin]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            ...(loggedIn ? { hub: { key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free', isAdmin, siteId: 'sid' } } : {})
        }));
    }, [fixtureUserData, fixtureLibrary, HUB, loggedIn, isAdmin]);
    await page.goto('/index.html' + query);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.HubAuth.renderSignInButton = () => {};
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        adapter.readText = async (path) => (mem.has(path) ? mem.get(path) : null);
        adapter.writeText = async (path, text) => { mem.set(path, text); };
        window.bookshelf._isSyncReady = () => true;
    });
    return { errors, captured, state };
}

const reportQuery = `?report=${encodeURIComponent(ARTICLE)}`;

test.describe('通報ダイアログ (?report=<記事URL>)', () => {
    test('リンクから開くと対象が出て、query は URL から消える。種類を選んで送ると通報が POST され、受付の合図が出てダイアログが閉じる', async ({ page }) => {
        const { errors, captured } = await boot(page, { query: reportQuery });
        await expect(page.locator('#report-modal')).toHaveClass(/show/);
        await expect(page.locator('#report-target-url')).toHaveText(ARTICLE);
        expect(new URL(page.url()).search).toBe('');   // リロードで再表示しない
        await page.selectOption('#report-category', 'spam');
        await page.fill('#report-reason', '広告ばかりです');
        await page.click('#report-submit');
        await expect(page.locator('#report-modal')).not.toHaveClass(/show/);
        expect(captured.reports).toHaveLength(1);
        expect(captured.reports[0].auth).toBe('Bearer hk_test');
        expect(captured.reports[0].body).toEqual({ articleUrl: ARTICLE, category: 'spam', reason: '広告ばかりです' });
        await expect(page.locator('.toast').filter({ hasText: '返信はしません' })).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('種類を選ばずに送るとエラーが出て、何も送らずダイアログは開いたまま', async ({ page }) => {
        const { errors, captured } = await boot(page, { query: reportQuery });
        await page.click('#report-submit');
        await expect(page.locator('#report-error')).toBeVisible();
        await expect(page.locator('#report-error')).toContainText('種類を選んでください');
        await expect(page.locator('#report-modal')).toHaveClass(/show/);
        expect(captured.reports).toHaveLength(0);
        expect(errors).toEqual([]);
    });

    test('未ログインでリンクを開くとログイン案内が出て、通報ダイアログは開かない', async ({ page }) => {
        const { errors, captured } = await boot(page, { loggedIn: false, query: reportQuery });
        await expect(page.locator('.cfm-box')).toContainText('ログインが必要');
        await expect(page.locator('#report-modal')).not.toHaveClass(/show/);
        expect(captured.reports).toHaveLength(0);
        expect(errors).toEqual([]);
    });

    for (const [status, text] of [[404, '見つかりませんでした'], [429, '上限に達しました']]) {
        test(`ハブが ${status} を返したら理由を出し、ダイアログは開いたまま (再送できる)`, async ({ page }) => {
            const { errors } = await boot(page, { query: reportQuery, reportStatus: status });
            await page.selectOption('#report-category', 'abuse');
            await page.click('#report-submit');
            await expect(page.locator('#report-error')).toContainText(text);
            await expect(page.locator('#report-modal')).toHaveClass(/show/);
            await expect(page.locator('#report-submit')).toBeEnabled();   // 実行中 disabled は戻る
            expect(errors).toEqual([]);
        });
    }

    test('標準操作 (PC): ESC・×・キャンセルで閉じ、枠外クリックでは閉じない', async ({ page }) => {
        const { errors } = await boot(page, { query: reportQuery });
        const modal = page.locator('#report-modal');
        await expect(modal).toHaveClass(/show/);
        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/show/);
        await page.evaluate((u) => window.bookshelf.openReportModal(u), ARTICLE);
        await page.locator('#report-modal-close').click();
        await expect(modal).not.toHaveClass(/show/);
        await page.evaluate((u) => window.bookshelf.openReportModal(u), ARTICLE);
        await page.click('#report-cancel');
        await expect(modal).not.toHaveClass(/show/);
        await page.evaluate((u) => window.bookshelf.openReportModal(u), ARTICLE);
        await page.mouse.click(2, 2);   // 枠外 (バックドロップ): 入力途中の誤爆を防ぐため閉じない
        await expect(modal).toHaveClass(/show/);
        expect(errors).toEqual([]);
    });

    test('標準操作 (スマホ): 戻るで閉じてアプリに留まり、× で閉じても履歴が汚れない', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const { errors } = await boot(page, { query: reportQuery });
        const modal = page.locator('#report-modal');
        await expect(modal).toHaveClass(/show/);
        await page.goBack();
        await expect(modal).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');   // about:blank へ離脱しない
        await page.evaluate((u) => window.bookshelf.openReportModal(u), ARTICLE);
        await expect(modal).toHaveClass(/show/);
        await page.locator('#report-modal-close').click();
        await expect(modal).not.toHaveClass(/show/);
        await page.waitForTimeout(200);
        expect(page.url()).toContain('index.html');   // × の後始末で離脱しない
        expect(errors).toEqual([]);
    });

    for (const [w, h] of [[1280, 800], [390, 844]]) {
        test(`配置 (${w}x${h}): ダイアログと主要部品が画面内に収まり、ボタンが重ならず右端が揃う`, async ({ page }) => {
            await page.setViewportSize({ width: w, height: h });
            const { errors } = await boot(page, { query: reportQuery });
            await expect(page.locator('#report-modal')).toHaveClass(/show/);
            const box = async (sel) => page.locator(sel).boundingBox();
            const content = await box('#report-modal .modal-content');
            for (const sel of ['#report-category', '#report-reason', '#report-submit', '#report-cancel', '#report-modal-close']) {
                const b = await box(sel);
                expect(b.x, `${sel} 左`).toBeGreaterThanOrEqual(content.x - 0.5);
                expect(b.x + b.width, `${sel} 右`).toBeLessThanOrEqual(content.x + content.width + 0.5);
                expect(b.y, `${sel} 上`).toBeGreaterThanOrEqual(0);
                expect(b.y + b.height, `${sel} 下`).toBeLessThanOrEqual(h);
            }
            const cancel = await box('#report-cancel'), submit = await box('#report-submit');
            expect(cancel.x + cancel.width, 'キャンセルと送信が重ならない').toBeLessThanOrEqual(submit.x);
            expect(Math.abs(cancel.y - submit.y), '2つのボタンの上端が揃う').toBeLessThan(1);
            const cat = await box('#report-category'), reason = await box('#report-reason');
            expect(Math.abs(cat.x - reason.x), '種類と理由の左端が揃う').toBeLessThan(1);
            expect(Math.abs(cat.width - reason.width), '種類と理由の幅が揃う').toBeLessThan(1);
            const text = await page.locator('#report-modal .modal-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
            expect(text, '横あふれ無し').toBe(true);
            expect(errors).toEqual([]);
        });
    }
});

test.describe('通報の審査パネル (管理者のみ)', () => {
    test('非管理者には出ない', async ({ page }) => {
        const { errors } = await boot(page, { isAdmin: false });
        await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        await expect(page.locator('#account-admin-reports')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('管理者: 未対応の通報が出て、「一覧から外す」→外し中に移り、「一覧に戻す」で戻る。「却下」は通報ごとに送る', async ({ page }) => {
        const { errors, captured, state } = await boot(page, { isAdmin: true });
        await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
        const panel = page.locator('#account-admin-reports');
        await expect(panel).toBeVisible();
        const item = page.locator('#report-review-list .report-item');
        await expect(item).toHaveCount(1);
        await expect(item).toContainText('アリスの記事');
        await expect(item).toContainText('通報 2 件');
        await expect(item).toContainText('広告ばかり');

        await item.getByRole('button', { name: '一覧から外す' }).click();
        await expect(page.locator('#report-review-list .report-item-meta')).toHaveText('一覧から外し中');
        expect(captured.admin).toEqual(['hide:sA']);

        await page.getByRole('button', { name: '一覧に戻す' }).click();
        await expect(page.locator('#report-review-list')).toContainText('未対応の通報はありません');
        expect(captured.admin).toEqual(['hide:sA', 'restore:sA']);

        // 却下: 記事の全ての通報 (reportIds) を 1 件ずつ dismiss
        state.reports = [{ articleId: 'sB', url: ARTICLE + 'x', title: 'ボブの記事', articleStatus: 'active', count: 2, categories: { other: 2 }, latestReason: '', latestAt: 1, reportIds: ['r8', 'r9'] }];
        await page.click('#report-review-refresh');
        await page.getByRole('button', { name: '却下' }).click();
        await expect.poll(() => captured.admin.filter(a => a.startsWith('dismiss:'))).toEqual(['dismiss:r8', 'dismiss:r9']);
        expect(errors).toEqual([]);
    });
});
