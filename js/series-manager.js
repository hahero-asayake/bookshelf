// Series Manager - 漫画シリーズ検出・グループ化
// Virtual Bookshelfの漫画シリーズをまとめて表示するためのロジック

class SeriesManager {
    constructor() {
        this.seriesGroups = [];
        this.bookToSeriesMap = new Map();
        this.cacheValid = false;
    }

    detectAndGroupSeries(books) {
        if (this.cacheValid && this.seriesGroups.length > 0) {
            return { seriesGroups: this.seriesGroups, bookToSeriesMap: this.bookToSeriesMap };
        }

        const seriesMap = new Map();

        books.forEach(book => {
            if (!book.title || !book.authors) return;

            const { volumeNumber, normalizedTitle } = this.extractVolumeNumber(book.title);
            if (volumeNumber === null) return;

            const seriesId = this.generateSeriesId(normalizedTitle, book.authors);

            if (!seriesMap.has(seriesId)) {
                seriesMap.set(seriesId, { seriesId, seriesName: normalizedTitle, authors: book.authors, volumes: [] });
            }
            seriesMap.get(seriesId).volumes.push({ book, volumeNumber });
        });

        this.seriesGroups = [];
        this.bookToSeriesMap = new Map();

        seriesMap.forEach((seriesData, seriesId) => {
            if (seriesData.volumes.length < 2) return;

            seriesData.volumes.sort((a, b) => {
                if (a.volumeNumber === null) return 1;
                if (b.volumeNumber === null) return -1;
                return a.volumeNumber - b.volumeNumber;
            });

            const representativeBook = seriesData.volumes[0].book;
            const seriesInfo = {
                seriesId,
                seriesName: seriesData.seriesName,
                authors: seriesData.authors,
                volumes: seriesData.volumes,
                representativeBook,
                totalVolumes: seriesData.volumes.length
            };

            this.seriesGroups.push(seriesInfo);
            seriesData.volumes.forEach(({ book }) => {
                // asin と bookId の両方に対応
                const id = book.asin || book.bookId;
                if (id) this.bookToSeriesMap.set(id, seriesId);
            });
        });

        this.cacheValid = true;
        return { seriesGroups: this.seriesGroups, bookToSeriesMap: this.bookToSeriesMap };
    }

    normalizeString(str) {
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

    extractVolumeNumber(title) {
        if (!title) return { volumeNumber: null, normalizedTitle: '' };

        let normalizedTitle = this.normalizeString(title);

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

        const prefixVolumeMatch = normalizedTitle.match(/^番外編(\d+)巻\s+(.+)$/);
        if (prefixVolumeMatch) {
            return { volumeNumber: parseInt(prefixVolumeMatch[1], 10), normalizedTitle: prefixVolumeMatch[2].trim() };
        }

        const prefixRangeMatch = normalizedTitle.match(/^(\d+)[~\-]\d+\s+(.+)$/);
        if (prefixRangeMatch) {
            return { volumeNumber: parseInt(prefixRangeMatch[1], 10), normalizedTitle: prefixRangeMatch[2].trim() };
        }

        const kanjiToNumber = {
            '上': 1, '中': 2, '下': 3,
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
            '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
        };

        for (const pattern of patterns) {
            const match = normalizedTitle.match(pattern);
            if (match) {
                const volumeStr = match[2];
                const volumeNumber = kanjiToNumber[volumeStr] !== undefined
                    ? kanjiToNumber[volumeStr]
                    : parseInt(volumeStr, 10);
                const cleanTitle = match[1].trim().replace(/[\s:;\-~]+$/, '').trim();
                return { volumeNumber, normalizedTitle: cleanTitle };
            }
        }

        return { volumeNumber: null, normalizedTitle: normalizedTitle.trim() };
    }

    generateSeriesId(normalizedTitle) {
        return this.normalizeForId(normalizedTitle);
    }

    normalizeForId(str) {
        if (!str) return '';
        return this.normalizeString(str)
            .toLowerCase()
            .replace(/[\s\-:;·・、。,.!?'"()[\]<>]/g, '')
            .trim();
    }

    getSeriesProgress(series) {
        if (!series || !series.volumes) return { total: 0, read: 0, unread: 0 };
        const total = series.volumes.length;
        const read = series.volumes.filter(({ book }) =>
            book.readStatus && book.readStatus.toLowerCase() === 'read'
        ).length;
        return { total, read, unread: total - read };
    }

    getSeriesById(seriesId) {
        return this.seriesGroups.find(s => s.seriesId === seriesId) || null;
    }

    getSeriesByBookId(bookId) {
        const seriesId = this.bookToSeriesMap.get(bookId);
        return seriesId ? this.getSeriesById(seriesId) : null;
    }

    getSeriesByBookAsin(asin) {
        return this.getSeriesByBookId(asin);
    }

    clearCache() {
        this.seriesGroups = [];
        this.bookToSeriesMap = new Map();
        this.cacheValid = false;
    }
}

window.SeriesManager = SeriesManager;
