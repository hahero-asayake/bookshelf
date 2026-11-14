// 見本の userData で「すべての本」の本棚の books を書き換える時の部品 (イシュー#662・ADR-166)。
// アプリは本を変える時に bookOrder.all を先に変え、「すべての本」の books を bookOrder.all に揃える。
// 本棚の books だけを書いて bookOrder.all を見本ファイルのまま残すと、アプリが作らない形の見本になるので、
// 両方を同じ並びで書く。

/** userData の「すべての本」の books と bookOrder.all を、同じ並びの asins にする (userData をそのまま返す)。
 * @param {any} userData @param {string[]} asins */
export function setAllShelfBooksForTest(userData, asins) {
    const all = (userData.bookshelves || []).find((s) => s.isSpecial);
    if (all) all.books = [...asins];
    userData.bookOrder = { ...(userData.bookOrder || {}), all: [...asins] };
    return userData;
}
