// グローバル例外 → 匿名のエラー報告 (イシュー#584・門(e) 見張り)。
// js/ui-feedback.js が、予期しないエラーをハブの受け口 (POST /client-error) へ送ることを確認する。
//  - 送るのは 版・画面名・エラーの先頭行 の3つだけ (認証ヘッダ・Cookie なし)
//  - 同じエラーは1日1回まで。日付が変わればもう一度送る
//  - アプリが投げたエラーに題名・URL が入っていても、送信本文には出ない
//  - 送信が失敗しても再送せず、トーストは今までどおり1つ
//  - 本番以外の配信元・アプリ同梱の js/ 以外で起きたエラーは送らない
// ハブへの通信だけを route で模擬する (アプリ自身のファイルは本物を通す)。
// エラーは「アプリのコードの中」で起こす必要がある (出どころが js/ 以外のエラーは送らない仕様のため):
//   window.toast('x', null)          → js/ui-feedback.js の中で TypeError (同期・window error)
//   StorageAdapter.withTimeout(...)  → js/storage-adapter.js の中で Error を作って reject (unhandledrejection)
//   StorageAdapter.fetchText(...)    → 同上 (「通信がタイムアウトしました」= 書き出しを送ってよい文面)
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

const ENDPOINT = 'https://hub.asayake.org/client-error';
const TOAST = '予期しないエラーが発生しました。しばらくしてからもう一度お試しください。';

// global-error-toast.spec.js の bootApp と同じ起動手順。flag='1' で本番以外の配信元 (localhost) でも送る。
async function bootApp(page, { flag = '1' } = {}) {
    await page.addInitScript(([userData, library, f]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        if (f !== null) localStorage.setItem('bookshelf.flag.errReport', f);
    }, [fixtureUserData, fixtureLibrary, flag]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

// 受け口の模擬。届いたリクエストを溜めて返す。
async function mockEndpoint(page, { fail = false } = {}) {
    const requests = [];
    await page.route(ENDPOINT, async (route) => {
        requests.push(route.request());
        if (fail) await route.abort();
        else await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    return requests;
}

const throwInApp = (page) => page.evaluate(() => { setTimeout(() => window.toast('x', null)); });

test('アプリの中の例外は1回だけ送られ、本文は 版・画面名・先頭行 の3つだけ', async ({ page }) => {
    const requests = await mockEndpoint(page);
    await bootApp(page);

    await throwInApp(page);
    await expect.poll(() => requests.length).toBe(1);

    const req = requests[0];
    expect(req.method()).toBe('POST');
    const body = JSON.parse(req.postData());
    expect(Object.keys(body).sort()).toEqual(['msg', 'screen', 'v']);
    expect(body.v).toMatch(/^\d{6,12}$/);
    expect(body.screen).toBe('main');
    expect(body.msg).toMatch(/^TypeError: /);
    expect(body.msg.length).toBeLessThanOrEqual(120);
    const headers = req.headers();
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers.referer).toBeUndefined();

    // 同じエラーをもう一度起こしても、今日は送らない
    await throwInApp(page);
    await page.waitForTimeout(400);
    expect(requests.length).toBe(1);
    await expect(page.locator('.toast-error', { hasText: TOAST })).toHaveCount(1);
});

test('日付が変わると同じエラーをもう一度送る', async ({ page }) => {
    const requests = await mockEndpoint(page);
    await bootApp(page);

    await throwInApp(page);
    await expect.poll(() => requests.length).toBe(1);

    // 端末の記録を「前の日に送った」状態にする (= 日付が変わった後の状態)
    await page.evaluate(() => {
        const st = JSON.parse(localStorage.getItem('bookshelf_errReport_v1'));
        st.day = '2000-01-01';
        localStorage.setItem('bookshelf_errReport_v1', JSON.stringify(st));
    });
    await throwInApp(page);
    await expect.poll(() => requests.length).toBe(2);
    expect(JSON.parse(requests[1].postData()).msg).toBe(JSON.parse(requests[0].postData()).msg);
});

test('アプリが投げたエラーに題名や URL が入っていても送信本文に出ない (unhandledrejection)', async ({ page }) => {
    const requests = await mockEndpoint(page);
    await page.route('https://hub.asayake.org/data/**', () => { /* 応答しない = タイムアウトさせる */ });
    await bootApp(page);

    // 一覧に無い文面 (題名が先頭に入る) → 種類名だけ
    await page.evaluate(() => { StorageAdapter.withTimeout(new Promise(() => {}), 20, '吾輩は猫である_MARKER1 の読み込み'); });
    await expect.poll(() => requests.length).toBe(1);
    const first = requests[0].postData();
    expect(first).not.toContain('MARKER1');
    expect(first).not.toContain('吾輩');
    expect(JSON.parse(first).msg).toBe('Error: (内容は伏せた)');

    // 一覧にある文面 (URL が後ろに付く) → 固定の書き出しだけ
    await page.evaluate(() => { StorageAdapter.fetchText('https://hub.asayake.org/data/坊っちゃん_MARKER2.md', {}, 30); });
    await expect.poll(() => requests.length).toBe(2);
    const second = requests[1].postData();
    expect(second).not.toContain('MARKER2');
    expect(second).not.toContain('坊っちゃん');
    expect(JSON.parse(second).msg).toBe('Error: 通信がタイムアウトしました');
});

test('送信が失敗しても再送せず、トーストは1つ', async ({ page }) => {
    const requests = await mockEndpoint(page, { fail: true });
    await bootApp(page);

    await throwInApp(page);
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator('.toast-error', { hasText: TOAST })).toHaveCount(1);
    await page.waitForTimeout(600);
    expect(requests.length).toBe(1);
    await expect(page.locator('.toast-error')).toHaveCount(1);
});

test('本番以外の配信元では送らない・アプリの外で起きたエラーは送らない', async ({ page }) => {
    const requests = await mockEndpoint(page);

    // フラグ無し (localhost は本番の配信元ではない)
    await bootApp(page, { flag: null });
    await throwInApp(page);
    await expect(page.locator('.toast-error', { hasText: TOAST })).toBeVisible();
    await page.waitForTimeout(400);
    expect(requests.length).toBe(0);

    // フラグあり・出どころがアプリ同梱の js/ ではない (テストが注入したコード)
    await page.evaluate(() => {
        localStorage.setItem('bookshelf.flag.errReport', '1');
        setTimeout(() => { throw new Error('outside-app'); });
        Promise.reject(new Error('outside-app-reject'));
    });
    await page.waitForTimeout(400);
    expect(requests.length).toBe(0);

    // フラグ '0' はアプリの中のエラーでも送らない (止める弁)
    await page.evaluate(() => { localStorage.setItem('bookshelf.flag.errReport', '0'); });
    await throwInApp(page);
    await page.waitForTimeout(400);
    expect(requests.length).toBe(0);
});
