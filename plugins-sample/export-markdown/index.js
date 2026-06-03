// export-markdown
//
// 蔵書一覧を本棚別セクション付き Markdown でダウンロード。⌘K パレットから実行。

export function activate(api, manifest) {
    api.registerCommand({
        id: 'export-markdown',
        title: 'Markdown で蔵書をエクスポート',
        icon: 'file-text',
        keywords: 'markdown md export エクスポート 出力 ダウンロード',
        run: () => exportMd()
    });

    function exportMd() {
        const books = api.getBooks();
        const notes = api.getNotes();
        const shelves = api.getBookshelves();
        const byAsin = new Map(books.map(b => [b.asin, b]));

        const today = ymd(new Date());
        const lines = [`# 蔵書一覧 (${today})`, '', `- 総数: ${books.length} 冊`,
            `- 本棚: ${shelves.filter(s => !s.isSpecial).length}`, '', '## すべての本', ''];
        for (const b of books) lines.push(bookLine(b, notes[b.asin]));
        lines.push('');

        for (const s of shelves) {
            if (s.isSpecial) continue;
            lines.push(`## ${s.name}`);
            if (s.description) lines.push(`> ${s.description}`);
            lines.push('');
            for (const asin of (s.books || [])) {
                const b = byAsin.get(asin);
                if (!b) continue;
                lines.push(bookLine(b, (s.notes && s.notes[asin]) || notes[asin]));
            }
            lines.push('');
        }

        download(lines.join('\n'), `bookshelf-${today}.md`, 'text/markdown;charset=utf-8');
    }

    function bookLine(book, note) {
        const title = book.title || '(無題)';
        const authors = Array.isArray(book.authors) ? book.authors.join(', ') : (book.authors || '');
        const r = note?.rating;
        const stars = Number.isInteger(r) && r >= 1 && r <= 5 ? ` (${'★'.repeat(r)}${'☆'.repeat(5 - r)})` : '';
        let line = `- **${title}**${authors ? ' — ' + authors : ''}${stars}`;
        if (note?.memo) line += '\n  - メモ: ' + String(note.memo).replace(/\n/g, '\n    ');
        return line;
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
