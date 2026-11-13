// イシュー#575 step1: 本棚ハイライトのA/B計測用に「本棚の数 × 各本棚の冊数」を振るfixture。
// 蔵書(all)は本棚間で重なる前提で総冊数 = ceil(本棚数 × 冊数 / 2) (=各本が平均2本棚に属する)。
// 本棚 k は蔵書を M/2 ずつずらした窓から M 冊を取る (隣の本棚と半分重なる)。
// 表紙は fixtures/real-covers.mjs と同じ実Amazon CDN URLの割当て(?cb=ASINでユニーク化)。
// sortOrder: 'custom'(bookOrderあり) / それ以外('title'等)を引数で切替。
import { REAL_COVER_IDS } from './real-covers.mjs';

export function genScale({ shelves = 10, perShelf = 50, sortOrder = 'custom' } = {}) {
    const N = Math.max(perShelf, Math.ceil((shelves * perShelf) / 2));
    const TITLE_PARTS = ['ことばの', 'それから', '夜明けの', '静かな', '遠い街の', '記憶の中の', '小さな', '最後の'];
    const AUTHOR_PARTS = ['山田', '佐藤', '鈴木', '高橋', '田中', '渡辺'];
    const books = Array.from({ length: N }, (_, i) => {
        const n = i + 1;
        const asin = `B${String(n).padStart(9, '0')}`;
        return {
            asin,
            title: `${TITLE_PARTS[n % TITLE_PARTS.length]}物語 第${n}話 〜${'あいうえお'.repeat(2)}〜`,
            authors: `${AUTHOR_PARTS[n % AUTHOR_PARTS.length]}${AUTHOR_PARTS[(n * 7) % AUTHOR_PARTS.length]}`,
            acquiredTime: 1700000000000 + ((n * 104729) % N) * 1000,
            addedDate: 1700000000000 + n * 1000,
            readStatus: n % 3 === 0 ? 'UNREAD' : 'READ',
            productImage: `https://m.media-amazon.com/images/I/${REAL_COVER_IDS[i % REAL_COVER_IDS.length]}.jpg?cb=${asin}`,
            source: 'fixture'
        };
    });
    const allAsins = books.map(b => b.asin);
    const step = Math.max(1, Math.floor(perShelf / 2));
    const shelfList = [];
    const bookOrder = { all: allAsins.slice().reverse() }; // custom順が素の配列順と違うことを担保
    for (let k = 0; k < shelves; k++) {
        const id = `shelf${k + 1}`;
        const asins = Array.from({ length: perShelf }, (_, j) => allAsins[(k * step + j) % N]);
        shelfList.push({ id, internalId: `perf${id}`, name: `本棚${k + 1}`, iconName: 'library', parent: 'perfall001', books: asins, notes: {} });
        bookOrder[id] = asins.slice().reverse();
    }
    const notes = {};
    for (let i = 0; i < books.length; i += 5) notes[books[i].asin] = { rating: (i % 5) + 1, memo: '' };
    const library = { books, metadata: { totalBooks: N } };
    const userData = {
        bookshelves: [
            { id: 'all', internalId: 'perfall001', name: 'すべての本', iconName: 'library', isSpecial: true, books: allAsins, notes: {} },
            ...shelfList
        ],
        notes,
        settings: { version: '2.0', defaultView: 'covers', coverSize: 'medium', sortOrder, disabledPlugins: [] },
        bookOrder,
        stats: { totalBooks: N, notesCount: Object.keys(notes).length },
        version: '2.0',
        _storage: { allInternalId: 'perfall001', exclusions: [] }
    };
    return { library, userData, totalBooks: N };
}
