// 記事エディタの公開パネル (イシュー#230): 公開前チェック / 公開先 / タグ / 広告 と、ヘッダー1行の ⋯ メニュー。
// 記事ストアはメモリ差し替え (publish-article-editor.spec.js の bootApp と同じ型)。公開先・プラン・GitHub 連携は
// localStorage の bookshelf_sync、自分のタグは userData.settings.affiliateId で与え、画面の実操作で確かめる。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// イシュー#268: 見たまま編集UI。ブロック追加はキャンバス(iframe)の＋→#art-add-sheet (publish-article-editor.spec.js の手本と同じ)。
function canvas(page) { return page.frameLocator('#art-canvas-frame'); }
async function addBlock(page, type, pos = 'last') {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    const before = await page.evaluate(() => (window.bookshelf._artDraft.blocks || []).length);
    const btns = canvas(page).locator('.art-cv-ins-btn');
    await expect(btns).toHaveCount(before + 1);
    await (pos === 'first' ? btns.first() : btns.last()).click();
    await page.locator('#art-add-sheet [data-block-type="' + type + '"]').click();
    if (type === 'text') await expect(canvas(page).locator('.art-cv-ta')).toBeVisible();
    else await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
}
// 全画面編集(form)中ならヘッダー操作の前に「完了」で編集状態へ戻す
async function leaveForm(page) {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
}
// 公開パネルは編集状態のヘッダー #art-publish-header から開く
async function openPublishPanel(page) {
    await leaveForm(page);
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await page.click('#art-publish-header');
}
// プレビューは記事メニュー ⋯ →「表示幅を切り替えて見る」(保存前の新規記事は⋯が出ないので直接呼ぶ)
async function openPreview(page) {
    await leaveForm(page);
    if (!(await page.locator('#art-more-btn').isVisible())) { await page.evaluate(() => { window.bookshelf._artPreview(); }); return; }
    await page.click('#art-more-btn');
    await page.click('#art-width-preview');
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = JSON.parse(readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8'));
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function boot(page, { target = 'hub', plan = 'free', github = false, affiliateId = '' } = {}) {
    const errors = [];
    // github 連携済みを模すダミー token では、起動時の GitHub API 照会が 401 になる (テスト環境の外部遮断由来で
    // 画面の不具合ではない)。その場合だけリソース読み込み失敗を除外する
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (github && /Failed to load resource/.test(msg.text())) return;
        errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    userData.settings = { ...(userData.settings || {}), affiliateId, publicDisplayName: 'テスト太郎' };
    const sync = {
        method: 'local',
        hub: { key: 'hk_test', apiBase: 'https://hub.example.test', plan, username: 'tester' },
        publish: { target },
        ...(github ? { github: { token: 'gho_test' } } : {}),
    };
    await page.addInitScript(([u, l, s]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', s);
    }, [JSON.stringify(userData), fixtureLibrary, JSON.stringify(sync)]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.HubAuth.renderSignInButton = () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}

async function newArticleWithBook(page, title = '公開テスト') {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    if (title) await page.fill('#art-title', title);
    await addBlock(page, 'book', 'last');
    await page.locator('#art-drawer-list .art-drawer-item').first().click();
    await leaveForm(page);
}

async function openPanel(page) {
    await openPublishPanel(page);
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
}

test('公開前チェック: 必須 (タイトル・本1冊以上) が欠けると公開ボタンが無効になり、チェックが自動で開く', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await openPanel(page);
    await expect(page.locator('#art-pub-go')).toBeDisabled();
    await expect(page.locator('#art-pub-check')).toHaveAttribute('open', '');
    await expect(page.locator('.art-pub-check-row[data-check="title"]')).toHaveClass(/is-ng/);
    await expect(page.locator('.art-pub-check-row[data-check="books"]')).toHaveClass(/is-ng/);
    await page.click('#art-pub-close');

    await page.fill('#art-title', 'タイトルあり');
    await addBlock(page, 'book', 'last');
    await page.locator('#art-drawer-list .art-drawer-item').first().click();
    await openPanel(page);
    await expect(page.locator('#art-pub-go')).toBeEnabled();
    // 必須が揃えば 1行に畳む (推奨＝タグ無しは警告だけで公開は止めない)
    await expect(page.locator('#art-pub-check')).not.toHaveAttribute('open', '');
    await expect(page.locator('.art-pub-check-row[data-check="tags"]')).toHaveClass(/is-warn/);
    expect(errors).toEqual([]);
});

test('広告: ハブ×Free は運営のタグ固定 (ロック表示＋「Plus を見る」リンク1つ)', async ({ page }) => {
    const errors = await boot(page, { target: 'hub', plan: 'free' });
    await newArticleWithBook(page);
    await openPanel(page);
    await expect(page.locator('#art-pub-ad .art-pub-lock')).toContainText('運営のタグ');
    await expect(page.locator('#art-pub-ad a.art-pub-link')).toHaveCount(1);
    await expect(page.locator('#art-pub-ad a.art-pub-link')).toHaveText('Plus を見る');
    await expect(page.locator('#art-pub-ad input[type="radio"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('広告: ハブ×Plus (タグ登録済み) は 自分のタグ/付けない の2択で、既定は自分のタグ。選んだ値は記事に保存される', async ({ page }) => {
    const errors = await boot(page, { target: 'hub', plan: 'plus', affiliateId: 'mine-22' });
    await newArticleWithBook(page);
    await openPanel(page);
    const radios = page.locator('#art-pub-ad input[name="art-pub-adtag"]');
    await expect(radios).toHaveCount(2);
    await expect(page.locator('#art-pub-ad input[value="own"]')).toBeChecked();
    await expect(page.locator('#art-pub-ad')).toContainText('mine-22');
    await expect(page.locator('#art-pub-ad')).not.toContainText('運営のタグ');
    await page.locator('#art-pub-ad input[value="none"]').check();
    await expect(page.locator('#art-pub-ad')).toContainText('「広告」ラベルは出ません');
    expect(await page.evaluate(() => window.bookshelf._artDraft.adTag)).toBe('none');
    expect(errors).toEqual([]);
});

test('広告: Plus でタグ未登録なら「付けない」が既定・自分のタグは無効表示＋「設定で登録」リンク', async ({ page }) => {
    const errors = await boot(page, { target: 'hub', plan: 'plus', affiliateId: '' });
    await newArticleWithBook(page);
    await openPanel(page);
    await expect(page.locator('#art-pub-ad input[value="own"]')).toBeDisabled();
    await expect(page.locator('#art-pub-ad input[value="none"]')).toBeChecked();
    await expect(page.locator('#art-pub-ad a.art-pub-link')).toHaveText('設定で登録');
    expect(errors).toEqual([]);
});

test('広告: 公開先 GitHub はプラン不問で 自分のタグ/付けない (運営のタグは入らない)・索引注記を出す', async ({ page }) => {
    const errors = await boot(page, { target: 'github', plan: 'free', github: true, affiliateId: 'mine-22' });
    await newArticleWithBook(page);
    await openPanel(page);
    await expect(page.locator('#art-pub-ad input[name="art-pub-adtag"]')).toHaveCount(2);
    await expect(page.locator('#art-pub-ad .art-pub-lock')).toHaveCount(0);
    await expect(page.locator('#art-pub-ad')).toContainText('運営のタグは付きません');
    await expect(page.locator('#art-pub-target')).toContainText('公開先：自分の GitHub（いつもの）');
    await expect(page.locator('#art-pub-target')).toContainText('ハブの索引（タグ検索・/top・マイページ）には載りません');
    expect(errors).toEqual([]);
});

test('公開先: 1行サマリ＋「設定で変更」。GitHub 未連携なら「設定で連携」リンクだけ・名義は1行', async ({ page }) => {
    const errors = await boot(page, { target: 'hub', github: false });
    await newArticleWithBook(page);
    await openPanel(page);
    const tgt = page.locator('#art-pub-target');
    await expect(tgt).toContainText('公開先：Asayake ハブ（いつもの）');
    await expect(tgt.locator('a.art-pub-link')).toHaveText(['設定で変更', 'GitHub に公開するには設定で連携']);
    await expect(tgt.locator('input, select')).toHaveCount(0);   // 公開先の選択肢・名義の選択・URL の入力欄は置かない
    await expect(tgt).toContainText('テスト太郎 として公開します');
    // 「設定で連携」はパネルを閉じて設定の同期を開く
    await tgt.locator('a.art-pub-link', { hasText: '設定で連携' }).click();
    await expect(page.locator('#art-publish-modal')).not.toHaveClass(/show/);
    await expect(page.locator('#sync-section')).toBeVisible();
    expect(errors).toEqual([]);
});

test('公開先: GitHub 連携済みでも、公開先の変更はパネルでは行わない (連携リンクは出ない)', async ({ page }) => {
    const errors = await boot(page, { target: 'hub', github: true });
    await newArticleWithBook(page);
    await openPanel(page);
    await expect(page.locator('#art-pub-target a.art-pub-link')).toHaveText(['設定で変更']);
    expect(errors).toEqual([]);
});

test('公開パネル: ×・ESC・枠外クリックでパネルだけ閉じ、エディタは残る', async ({ page }) => {
    const errors = await boot(page);
    await newArticleWithBook(page);
    for (const how of ['x', 'esc', 'outside']) {
        await openPanel(page);
        if (how === 'x') await page.click('#art-pub-close');
        if (how === 'esc') await page.keyboard.press('Escape');
        if (how === 'outside') await page.mouse.click(5, 5);
        await expect(page.locator('#art-publish-modal')).not.toHaveClass(/show/);
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await expect(page.locator('#art-edit-view')).toBeVisible();
    }
    expect(errors).toEqual([]);
});

test('ヘッダー1行: フッターは無く、⋯メニューに複製・削除。ESC と枠外クリックはメニューだけ閉じる', async ({ page }) => {
    const errors = await boot(page);
    await newArticleWithBook(page, '操作メニュー');
    await page.evaluate(() => window.bookshelf._artFlushSave());
    await expect(page.locator('.pp-edit-actions')).toHaveCount(0);
    await expect(page.locator('#art-page-ops')).toBeVisible();
    await page.click('#art-more-btn');
    await expect(page.locator('#art-more-menu')).toBeVisible();
    await expect(page.locator('#art-more-menu #art-dup')).toBeVisible();
    await expect(page.locator('#art-more-menu #art-del')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#art-more-menu')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.click('#art-more-btn');
    await page.locator('#art-title').click();
    await expect(page.locator('#art-more-menu')).toBeHidden();
    // 削除は確認つき (キャンセルすれば消えない)
    await page.click('#art-more-btn');
    await page.click('#art-del');
    await expect(page.locator('.cfm-box')).toBeVisible();
    await page.click('.cfm-cancel');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    expect(errors).toEqual([]);
});
