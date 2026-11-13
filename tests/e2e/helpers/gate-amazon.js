// 門のE2E (イシュー#590 J2-4) の前提: Amazon の外部の応答の模擬 (取込ブックマークを使う蔵書一覧のページと、蔵書の API)。
// 模擬するのは Amazon 側の応答だけ。取込ブックマーク (ブックマークレット) の中身はアプリが作る本物
// (js/screens/import.js _buildKindleBookmarkletCode) で、アプリの取込画面のリンク #kindle-bookmarklet-link と
// 同じ href を、模擬の蔵書一覧のページに「ブックマークバーのボタン」として置く (Playwright はブックマークバーを
// 押せないため)。押すと、ブックマークレットが蔵書の API を呼び、window.opener (アプリ) へ postMessage で渡す。
// 開いた新しいタブにも効くよう、page ではなく context に route をかける。

const AMAZON_ORIGIN = 'https://www.amazon.co.jp';

/** Amazon の蔵書一覧のページと蔵書の API を模擬する。items は蔵書の API が返す本 (title・authors・asin 等)。
 * ページには、その時アプリの取込画面にある取込ブックマークと同じ href のリンク (#gate-bookmarklet) を置く。
 * アプリを開く前でも後でもよい。
 * @param {import('@playwright/test').Page} page アプリのページ
 * @param {object[]} items */
export async function mockAmazonLibraryForTest(page, items) {
    await page.context().route('https://www.amazon.co.jp/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname === '/hz/mycd/digital-console/ajax') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'Access-Control-Allow-Origin': AMAZON_ORIGIN },
                body: JSON.stringify({ success: true, GetContentOwnershipData: { numberOfItems: items.length, items } })
            });
        }
        if (url.pathname.startsWith('/hz/mycd/digital-console/contentlist/')) {
            const href = await page.locator('#kindle-bookmarklet-link').getAttribute('href');
            const body = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>コンテンツと端末の管理 (模擬)</title></head>
<body><script>window.csrfToken = 'gate-csrf-token-0123456789';</script>
<nav>ブックマークバー: <a id="gate-bookmarklet" href="${href}">bookshelf 取込</a></nav>
<h1>コンテンツと端末の管理 (模擬)</h1></body></html>`;
            return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
        }
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found (gate mock)' });
    });
}
