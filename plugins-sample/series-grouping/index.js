// series-grouping
//
// 漫画シリーズを検出し、第1巻のみ代表として表示する (第2巻以降を折りたたむ)。
// registerBookFilter で applyFilters の末尾に絞り込みを挿す方式。
// 表示状態は localStorage。⌘K コマンド or ヘッダーボタンでトグル。

const STORAGE_KEY = 'plugin-series-grouping:on';

export function activate(api, manifest) {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
    let cache = null;

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
            /^(.+?)\s*\(?第?(\d+)巻\)?\s*$/, /^(.+?)\s+第?(\d+)巻\s*.*$/, /^(.+?)\s*第(\d+)巻\s*$/,
            /^(.+?)\s+第(\d+)話.+$/, /^(.+?)\s*\(?Vol\.?\s*(\d+)\)?\s*$/i, /^(.+?)\s+分冊版(\d+)\s*$/,
            /^(.+?)\s*:\s*(\d+)\s+.+$/, /^(.+?)\((\d+)\)\s+\(.+\)\s*$/, /^(.+?)\((\d+)\)\s+.+$/,
            /^(.+?)\((\d+)\)\S.+$/, /^(.+?[^\d\s])(\d+)\s+.+\s*\(.+\)\s*$/, /^(.+?)\s*\((\d+)\)\s*$/,
            /^(.+?)\s+(\d+)\s*\(.+\)\s*$/, /^(.+?)\s+(\d+)\s*$/, /^(.+?\))(\d+)$/,
            /^(.+?)\s*\(?(上|中|下)\)?\s*$/, /^(.+?)\s+(一|二|三|四|五|六|七|八|九|十)[ノの]巻\s*$/,
        ];
        const prefixVol = nt.match(/^番外編(\d+)巻\s+(.+)$/);
        if (prefixVol) return { volumeNumber: parseInt(prefixVol[1], 10), normalizedTitle: prefixVol[2].trim() };
        const prefixRange = nt.match(/^(\d+)[~\-]\d+\s+(.+)$/);
        if (prefixRange) return { volumeNumber: parseInt(prefixRange[1], 10), normalizedTitle: prefixRange[2].trim() };
        const kanji = { '上': 1, '中': 2, '下': 3, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
        for (const pat of patterns) {
            const m = nt.match(pat);
            if (m) {
                const v = m[2];
                const num = kanji[v] !== undefined ? kanji[v] : parseInt(v, 10);
                return { volumeNumber: num, normalizedTitle: m[1].trim().replace(/[\s:;\-~]+$/, '').trim() };
            }
        }
        return { volumeNumber: null, normalizedTitle: nt.trim() };
    }

    function normalizeForId(str) {
        if (!str) return '';
        return normalizeString(str).toLowerCase().replace(/[\s\-:;·・、。,.!?'"()[\]<>]/g, '').trim();
    }

    function buildCache(books) {
        const seriesMap = new Map();
        for (const book of books) {
            if (!book.title || !book.authors) continue;
            const { volumeNumber, normalizedTitle } = extractVolumeNumber(book.title);
            if (volumeNumber === null) continue;
            const id = normalizeForId(normalizedTitle);
            if (!seriesMap.has(id)) seriesMap.set(id, []);
            seriesMap.get(id).push({ book, volumeNumber });
        }
        const representativeAsins = new Set(), knownAsins = new Set();
        for (const [, vols] of seriesMap) {
            if (vols.length < 2) continue;
            vols.sort((a, b) => (a.volumeNumber ?? 1e9) - (b.volumeNumber ?? 1e9));
            representativeAsins.add(vols[0].book.asin || vols[0].book.bookId);
            for (const { book } of vols) knownAsins.add(book.asin || book.bookId);
        }
        return { representativeAsins, knownAsins };
    }

    function filter(books) {
        if (!enabled) return books;
        if (!cache) cache = buildCache(api.getBooks());
        const { representativeAsins, knownAsins } = cache;
        return books.filter(b => {
            const id = b.asin || b.bookId;
            return !knownAsins.has(id) || representativeAsins.has(id);
        });
    }

    api.registerBookFilter(filter);
    api.on('books:changed', () => { cache = null; });

    const sync = () => {
        if (btn && btn.element) btn.element.title = `シリーズまとめ: ${enabled ? 'ON' : 'OFF'}`;
        api.setUIButtonActive('series-grouping-toggle-btn', enabled); // 背景色で ON/OFF を明示
    };
    const toggle = () => {
        enabled = !enabled;
        try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
        cache = null;
        sync();
        api.refreshUI();
    };

    api.registerCommand({
        id: 'series-grouping-toggle',
        title: 'シリーズまとめ表示を切替',
        icon: 'layers',
        keywords: 'series シリーズ まとめ 巻 折りたたみ manga 漫画',
        run: toggle
    });
    const btn = api.addUIButton({
        id: 'series-grouping-toggle-btn',
        label: 'シリーズまとめ',
        title: 'シリーズの第2巻以降を折りたたむ',
        iconName: 'layers',
        onClick: toggle
    });
    sync();

    return { deactivate() { cache = null; } };
}
