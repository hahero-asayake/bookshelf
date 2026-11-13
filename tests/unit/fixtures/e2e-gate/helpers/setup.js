// lint:e2e-gate のテスト用の見本ヘルパー(実行はしない・構文木で読まれるだけ)。前提の置き場。
export async function seedLibraryForTest(page, { books = 3 } = {}) {
    await page.addInitScript((n) => { localStorage.setItem('virtualBookshelf_library', JSON.stringify({ n })); }, books);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

// 外部(ハブ)の通信の模擬 = 前提で許される
export async function mockHubForTest(page) {
    await page.route('https://hub.example.com/**', (route) => route.fulfill({ status: 200, body: '{}' }));
}

// アプリ自身のファイルの差し替え = 前提のヘルパー経由でも違反
export async function stubAppScriptForTest(page) {
    await page.route('**/js/bookshelf.js', (route) => route.fulfill({ status: 200, body: '' }));
}

export async function stubAllForTest(page) {
    await stubIndex(page);
}

async function stubIndex(page) {
    await page.route(/\/index\.html/, (route) => route.abort());
}
