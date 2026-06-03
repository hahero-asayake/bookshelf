// csv-export
//
// 蔵書を CSV (UTF-8 BOM 付) でダウンロード。⌘K パレットから実行。
// 列: asin, title, authors, acquiredDate, rating, memo, bookshelves

export function activate(api, manifest) {
    api.registerCommand({
        id: 'csv-export',
        title: 'CSV で蔵書をエクスポート',
        icon: 'file-spreadsheet',
        keywords: 'csv export エクスポート 出力 ダウンロード',
        run: () => exportCsv()
    });

    function exportCsv() {
        const books = api.getBooks();
        const notes = api.getNotes();
        const shelves = api.getBookshelves();

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
            rows.push([
                b.asin || '',
                b.title || '',
                Array.isArray(b.authors) ? b.authors.join(';') : (b.authors || ''),
                b.acquiredTime ? toDate(b.acquiredTime) : '',
                note.rating != null ? String(note.rating) : '',
                note.memo || '',
                (asinToShelves.get(b.asin) || []).join(';')
            ]);
        }

        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
        download('﻿' + csv, `bookshelf-${ymd(new Date())}.csv`, 'text/csv;charset=utf-8');
    }

    function csvEscape(v) {
        const s = String(v ?? '');
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }
    function toDate(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n)) return '';
        const d = new Date(n);
        return Number.isFinite(d.getTime()) ? ymd(d) : '';
    }

    return {};
}

function download(text, filename, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
function ymd(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}
