// イシュー#530 step2: 本棚→ホーム遷移の実測用、本番相当(約780冊)のfixture生成。
// 出典: tests/e2e/sort-perf-budget.spec.js(イシュー#397・N=913)の生成パターンを流用。
// 実データ種(日本語20〜30文字程度のタイトル/著者)にして文字列コストを過小評価しない方針も踏襲。
// 本棚ハイライト/読書統計ウィジェットも動かすため、all 1本だけでなく子本棚2つに本を振り分ける
// (記事エディタのコメント(#133項目5)にある「783冊のall」に合わせ、ここでは780冊に調整)。
export function genLibraryAndUserData(N = 780) {
    const TITLE_PARTS = ['ことばの', 'それから', '夜明けの', '静かな', '遠い街の', '記憶の中の', '小さな', '最後の'];
    const AUTHOR_PARTS = ['山田', '佐藤', '鈴木', '高橋', '田中', '渡辺'];
    const books = Array.from({ length: N }, (_, i) => {
        const n = i + 1;
        const title = `${TITLE_PARTS[n % TITLE_PARTS.length]}物語 第${n}話 〜${'あいうえお'.repeat(2)}〜`;
        const authors = `${AUTHOR_PARTS[n % AUTHOR_PARTS.length]}${AUTHOR_PARTS[(n * 7) % AUTHOR_PARTS.length]}`;
        return {
            asin: `B${String(n).padStart(9, '0')}`, title, authors,
            acquiredTime: 1700000000000 + ((n * 104729) % N) * 1000,
            addedDate: 1700000000000 + n * 1000,
            readStatus: n % 3 === 0 ? 'UNREAD' : 'READ',
            productImage: '', source: 'fixture'
        };
    });
    const allAsins = books.map(b => b.asin);
    const shelfAAsins = allAsins.filter((_, i) => i % 3 === 0);
    const shelfBAsins = allAsins.filter((_, i) => i % 3 === 1);
    const notes = {};
    for (let i = 0; i < books.length; i += 5) {
        notes[books[i].asin] = { rating: (i % 5) + 1, memo: i % 2 === 0 ? `短文メモ${i}` : '' };
    }
    const library = { books, metadata: { totalBooks: books.length } };
    const userData = {
        bookshelves: [
            { id: 'all', internalId: 'perfall001', name: 'すべての本', iconName: 'library', isSpecial: true, books: allAsins, notes: {} },
            { id: 'shelfA', internalId: 'perfshelfA', name: '小説', iconName: 'library', parent: 'perfall001', books: shelfAAsins, notes: {} },
            { id: 'shelfB', internalId: 'perfshelfB', name: '技術書', iconName: 'library', parent: 'perfall001', books: shelfBAsins, notes: {} }
        ],
        notes,
        settings: { version: '2.0', defaultView: 'covers', coverSize: 'medium', sortOrder: 'custom', disabledPlugins: [] },
        bookOrder: { all: allAsins, shelfA: shelfAAsins, shelfB: shelfBAsins },
        stats: { totalBooks: books.length, notesCount: Object.keys(notes).length },
        version: '2.0',
        _storage: { allInternalId: 'perfall001', exclusions: [] }
    };
    return { library, userData };
}
