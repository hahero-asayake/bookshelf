// lint:e2e-gate のテスト用の見本ヘルパー(実行はしない)。辿る深さの上限(8)を超える呼び出しの連なり。
export async function deep1(page) { await deep2(page); }
async function deep2(page) { await deep3(page); }
async function deep3(page) { await deep4(page); }
async function deep4(page) { await deep5(page); }
async function deep5(page) { await deep6(page); }
async function deep6(page) { await deep7(page); }
async function deep7(page) { await deep8(page); }
async function deep8(page) { await deep9(page); }
async function deep9(page) { await deep10(page); }
async function deep10(page) { await page.locator('#deep').click(); }
