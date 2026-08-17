// オンボーディング (welcome 3ステップ) の状態一致 + 表示設定の永続化 + 表紙フォールバック
// - welcome: ×で閉じてもセッション限り / step1 は実接続状態に連動 / step3 は蔵書0で無効
// - 本棚切替で検索・評価の絞り込みを持ち越さない
// - 並び順は保存され、リロード後に復元される
// - 表紙画像の読み込み失敗はタイトル入り生成表紙に差し替わる
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// 蔵書ありの通常起動 (standard-ops と同じ)
async function bootApp(page, { stubSave = true } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    // reload 後も init script は再実行されるため、seed は初回のみ (アプリが保存した値を上書きしない)
    await page.addInitScript(([userData, library]) => {
        if (!localStorage.getItem('virtualBookshelf_userData')) {
            localStorage.setItem('virtualBookshelf_userData', userData);
            localStorage.setItem('virtualBookshelf_library', library);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        }
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    if (stubSave) await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

// 蔵書0の起動 (welcome 検証用)。syncConfig は呼び出し側が指定 (null = 未設定)
async function bootEmpty(page, syncConfig = null) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript((cfg) => {
        if (cfg) localStorage.setItem('bookshelf_sync', JSON.stringify(cfg));
    }, syncConfig);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    return errors;
}

// ===== C: welcome の状態一致 =====
test('welcome: ×で閉じてもセッション限り (localStorage に恒久フラグを残さない)', async ({ page, context }) => {
    const errors = await bootEmpty(page);
    await expect(page.locator('#dashboard-welcome')).toBeVisible();
    await page.locator('#dw-close').click();
    await expect(page.locator('#dashboard-welcome')).toHaveCount(0);
    const flags = await page.evaluate(() => ({
        session: sessionStorage.getItem('bookshelf_welcome_dismissed'),
        local: localStorage.getItem('bookshelf_welcome_dismissed')
    }));
    expect(flags.session).toBe('1');
    expect(flags.local).toBeNull();
    // 新しいタブ (= 次のセッション相当) では蔵書0なのでまた出る
    const page2 = await context.newPage();
    await page2.goto('/index.html');
    await page2.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await expect(page2.locator('#dashboard-welcome')).toBeVisible();
    await page2.close();
    expect(errors).toEqual([]);
});

test('welcome step1: 未設定なら「保存先を選ぶ」(嘘の「設定済み」を出さない)', async ({ page }) => {
    const errors = await bootEmpty(page, null);
    const step1 = page.locator('#dashboard-welcome .dw-step').first();
    await expect(step1).not.toHaveClass(/is-done/);
    await expect(step1.locator('button')).toHaveText('保存先を選ぶ');
    expect(errors).toEqual([]);
});

test('welcome step1: hub 保存済みでも未認証 (key なし) なら「設定済み」にしない', async ({ page }) => {
    const errors = await bootEmpty(page, { method: 'hub', hub: {} });
    const step1 = page.locator('#dashboard-welcome .dw-step').first();
    await expect(step1).not.toHaveClass(/is-done/);
    expect(errors).toEqual([]);
});

test('welcome step1: hub 認証済み (key あり) なら「設定済み」', async ({ page }) => {
    // 実在しないハブへの裏同期は失敗してよい (welcome の表示検証が目的)。fetch は 404 で即答させる
    await page.route('https://hub.example/**', (route) => route.fulfill({ status: 404, body: '' }));
    await bootEmpty(page, { method: 'hub', hub: { key: 'hk_test', apiBase: 'https://hub.example' } });
    const step1 = page.locator('#dashboard-welcome .dw-step').first();
    await expect(step1).toHaveClass(/is-done/);
    await expect(step1.locator('button')).toHaveText('設定済み');
});

test('welcome step3: 蔵書0では公開ボタンが無効 (奥まで進ませてから弾かない)', async ({ page }) => {
    const errors = await bootEmpty(page);
    const step3Btn = page.locator('#dashboard-welcome .dw-step').nth(2).locator('button');
    await expect(step3Btn).toBeDisabled();
    expect(errors).toEqual([]);
});

// ===== D-1: 本棚切替で絞り込みを持ち越さない =====
test('本棚切替: 検索の絞り込みがリセットされる (見えないフィルタで空に見せない)', async ({ page }) => {
    const errors = await bootApp(page);
    // 全ての本 (5冊) → 検索で絞る
    await page.evaluate(() => {
        const si = document.getElementById('search-input');
        if (si) si.value = '存在しないタイトル';
        window.bookshelf.search('存在しないタイトル');
    });
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(0);
    // 本棚を切り替えると絞り込みは解除され、その本棚の本が見える
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    const state = await page.evaluate(() => ({
        query: window.bookshelf.searchQuery,
        input: document.getElementById('search-input')?.value ?? ''
    }));
    expect(state.query).toBe('');
    expect(state.input).toBe('');
    expect(await page.locator('#bookshelf .book-item').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

test('本棚切替: 評価フィルタもリセットされる', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => {
        window.bookshelf.ratingFilter.add(1); // ★1 の本は fixture に存在しない → 0件になる
        window.bookshelf.applyFilters();
    });
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(0);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    expect(await page.evaluate(() => window.bookshelf.ratingFilter.size)).toBe(0);
    expect(await page.locator('#bookshelf .book-item').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

// ===== D-2: 並び順の永続化 =====
test('並び順: 変更がリロード後も復元される', async ({ page }) => {
    const errors = await bootApp(page, { stubSave: false }); // 実際に localStorage へ保存させる
    // #sort-order はフィルタポップオーバー内で通常不可視のため、値変更+change を直接発火
    await page.evaluate(() => {
        const sel = document.getElementById('sort-order');
        sel.value = 'title';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
        const raw = localStorage.getItem('virtualBookshelf_userData');
        return raw && JSON.parse(raw).settings?.sortOrder === 'title';
    });
    await page.reload();
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    expect(await page.evaluate(() => window.bookshelf.sortOrder)).toBe('title');
    await expect(page.locator('#sort-order')).toHaveValue('title');
    expect(errors).toEqual([]);
});

// ===== B: 表紙フォールバック =====
test('表紙: productImage 空でも ASIN から表示を試み、失敗したらタイトル入り生成表紙に落ちる', async ({ page }) => {
    // Amazon への画像リクエストを遮断して「読み込み失敗」を決定化
    await page.route('https://images-na.ssl-images-amazon.com/**', (route) => route.abort());
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    // fixture は productImage が全て空 → img (組み立てURL) を出し、abort でフォールバックへ
    const fallback = page.locator('#bookshelf .cover-fallback').first();
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveText(/フィクスチャの本/);
    // 画像 abort 由来の「Failed to load resource」はこのテストの意図した失敗なので除外
    expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});
