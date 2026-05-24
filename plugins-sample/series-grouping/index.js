// series-grouping
//
// 漫画シリーズを検出し、第1巻のみ代表として表示する。
// 表紙表示・リスト表示両方で適用される（applyFilters で filteredBooks を絞り込む）。
//
// 状態は localStorage に保存（'plugin-series-grouping:enabled'）。

const STORAGE_KEY = 'plugin-series-grouping:enabled';

export function activate(api, manifest) {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

    let cache = null; // { representativeAsins: Set, knownAsins: Set }

    function clearCache() { cache = null; }

    function normalizeString(str) {
        if (!str) return '';
        return str
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/（/g, '(').replace(/）/g, ')').replace(/【/g, '[').replace(/】/g, ']')
            .replace(/「/g, '[').replace(/」/g, ']').replace(/　/g, ' ')
            .replace(/：/g, ':').replace(/；/g, ';')
            .replace(/[－―─ー−]/g, '-').replace(/[～〜]/g, '~')
            .replace(/！/g, '!').replace(/？/g, '?').replace(/＆/g, '&')
            .replace(/＊/g, '*').replace(/＋/g, '+').replace(/，/g, ',').replace(/．/g, '.')
            .replace(/\s+/g, ' ').trim();
    }

    function extractVolumeNumber(title) {
        if (!title) return { volumeNumber: null, normalizedTitle: '' };
        let nt = normalizeString(title);
        const patterns = [
            /^(.+?)\s*\(?第?(\d+)巻\)?\s*$/,
            /^(.+?)\s+第?(\d+)巻\s*.*$/,
            /^(.+?)\s*第(\d+)巻\s*$/,
            /^(.+?)\s+第(\d+)話.+$/,
            /^(.+?)\s*\(?Vol\.?\s*(\d+)\)?\s*$/i,
            /^(.+?)\s+分冊版(\d+)\s*$/,
            /^(.+?)\s*:\s*(\d+)\s+.+$/,
            /^(.+?)\((\d+)\)\s+\(.+\)\s*$/,
            /^(.+?)\((\d+)\)\s+.+$/,
            /^(.+?)\((\d+)\)\S.+$/,
            /^(.+?[^\d\s])(\d+)\s+.+\s*\(.+\)\s*$/,
            /^(.+?)\s*\((\d+)\)\s*$/,
            /^(.+?)\s+(\d+)\s*\(.+\)\s*$/,
            /^(.+?)\s+(\d+)\s*$/,
            /^(.+?\))(\d+)$/,
            /^(.+?)\s*\(?(上|中|下)\)?\s*$/,
            /^(.+?)\s+(一|二|三|四|五|六|七|八|九|十)[ノの]巻\s*$/,
        ];
        const prefixVol = nt.match(/^番外編(\d+)巻\s+(.+)$/);
        if (prefixVol) return { volumeNumber: parseInt(prefixVol[1], 10), normalizedTitle: prefixVol[2].trim() };
        const prefixRange = nt.match(/^(\d+)[~\-]\d+\s+(.+)$/);
        if (prefixRange) return { volumeNumber: parseInt(prefixRange[1], 10), normalizedTitle: prefixRange[2].trim() };
        const kanjiToNumber = {
            '上': 1, '中': 2, '下': 3,
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
        };
        for (const pat of patterns) {
            const m = nt.match(pat);
            if (m) {
                const v = m[2];
                const num = kanjiToNumber[v] !== undefined ? kanjiToNumber[v] : parseInt(v, 10);
                const clean = m[1].trim().replace(/[\s:;\-~]+$/, '').trim();
                return { volumeNumber: num, normalizedTitle: clean };
            }
        }
        return { volumeNumber: null, normalizedTitle: nt.trim() };
    }

    function normalizeForId(str) {
        if (!str) return '';
        return normalizeString(str).toLowerCase()
            .replace(/[\s\-:;·・、。,.!?'"()[\]<>]/g, '').trim();
    }

    function buildCache(books) {
        const seriesMap = new Map();
        for (const book of books) {
            if (!book.title || !book.authors) continue;
            const { volumeNumber, normalizedTitle } = extractVolumeNumber(book.title);
            if (volumeNumber === null) continue;
            const seriesId = normalizeForId(normalizedTitle);
            if (!seriesMap.has(seriesId)) seriesMap.set(seriesId, []);
            seriesMap.get(seriesId).push({ book, volumeNumber });
        }
        const representativeAsins = new Set();
        const knownAsins = new Set();
        for (const [, volumes] of seriesMap) {
            if (volumes.length < 2) continue;
            volumes.sort((a, b) => {
                if (a.volumeNumber === null) return 1;
                if (b.volumeNumber === null) return -1;
                return a.volumeNumber - b.volumeNumber;
            });
            const rep = volumes[0].book;
            representativeAsins.add(rep.asin || rep.bookId);
            for (const { book } of volumes) knownAsins.add(book.asin || book.bookId);
        }
        return { representativeAsins, knownAsins };
    }

    function filter(books) {
        if (!enabled) return books;
        if (!cache) {
            const allBooks = api.getBooks();
            cache = buildCache(allBooks);
        }
        const { representativeAsins, knownAsins } = cache;
        return books.filter(b => {
            const id = b.asin || b.bookId;
            return !knownAsins.has(id) || representativeAsins.has(id);
        });
    }

    api.registerBookFilter(filter);
    api.on('books:changed', clearCache);

    const btn = api.addUIButton({
        id: 'series-grouping-toggle',
        where: 'library-management',
        emoji: enabled ? '📚' : '📖',
        label: enabled ? 'シリーズまとめ ON' : 'シリーズまとめ OFF',
        title: 'シリーズの第2巻以降を折りたたむ',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            cache = null;
            if (btn && btn.element) {
                btn.element.textContent = `${enabled ? '📚' : '📖'} シリーズまとめ ${enabled ? 'ON' : 'OFF'}`;
            }
            api.refreshUI();
        }
    });

    return {
        deactivate() {
            cache = null;
        }
    };
}
