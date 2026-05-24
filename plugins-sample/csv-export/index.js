// csv-export
//
// 蔵書を CSV としてダウンロード。
// 出力列: asin, title, authors, acquiredDate, rating, memo, bookshelves
//   - acquiredDate: acquiredTime を YYYY-MM-DD に変換
//   - rating / memo: notes から
//   - bookshelves: その本を含む本棚名を ";" 区切りで列挙

export function activate(api, manifest) {
    api.addUIButton({
        id: 'csv-export-button',
        where: 'library-management',
        emoji: '📑',
        label: 'CSV 出力',
        title: '蔵書を CSV としてダウンロード',
        onClick: () => exportCsv()
    });

    function exportCsv() {
        const books = api.getBooks();
        const notes = api.getNotes();
        const shelves = api.getBookshelves();

        // ASIN → 所属本棚名リスト
        const asinToShelves = new Map();
        for (const s of shelves) {
            if (s.isSpecial) continue;
            for (const asin of (s.books || [])) {
                if (!asinToShelves.has(asin)) asinToShelves.set(asin, []);
                asinToShelves.get(asin).push(s.name);
            }
        }

        const header = ['asin', 'title', 'authors', 'acquiredDate', 'rating', 'memo', 'bookshelves'];
        const rows = [header];

        for (const b of books) {
            const note = notes[b.asin] || {};
            const acquired = b.acquiredTime ? toDate(b.acquiredTime) : '';
            const shelfNames = (asinToShelves.get(b.asin) || []).join(';');
            rows.push([
                b.asin || '',
                b.title || '',
                Array.isArray(b.authors) ? b.authors.join(';') : (b.authors || ''),
                acquired,
                note.rating != null ? String(note.rating) : '',
                note.memo || '',
                shelfNames
            ]);
        }

        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
        const bom = '﻿';
        const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bookshelf-${formatDate(new Date())}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function csvEscape(v) {
        const s = String(v ?? '');
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    }
    function toDate(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n)) return '';
        const d = new Date(n);
        return Number.isFinite(d.getTime()) ? formatDate(d) : '';
    }
    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    return { deactivate() {} };
}
