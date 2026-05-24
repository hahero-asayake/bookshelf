// export-markdown
//
// 蔵書一覧を Markdown でダウンロード。
// 出力形式:
//   # 蔵書一覧 (YYYY-MM-DD)
//   - 総数: N 冊
//
//   ## 📚 すべての本
//   - **タイトル** — 著者 (★★★☆☆)
//     - メモ: ...
//
//   ## <emoji> <本棚名>
//   ...

export function activate(api, manifest) {
    api.addUIButton({
        id: 'export-markdown-button',
        where: 'library-management',
        emoji: '📝',
        label: 'Markdown 出力',
        title: '蔵書を Markdown としてダウンロード',
        onClick: () => exportMd()
    });

    function exportMd() {
        const books = api.getBooks();
        const notes = api.getNotes();
        const shelves = api.getBookshelves();
        const byAsin = new Map(books.map(b => [b.asin, b]));

        const lines = [];
        const today = formatDate(new Date());
        lines.push(`# 蔵書一覧 (${today})`);
        lines.push('');
        lines.push(`- 総数: ${books.length} 冊`);
        lines.push(`- 本棚: ${shelves.filter(s => !s.isSpecial).length}`);
        lines.push('');

        // すべての本
        lines.push('## 📚 すべての本');
        lines.push('');
        for (const b of books) {
            lines.push(formatBookLine(b, notes[b.asin]));
        }
        lines.push('');

        // 本棚別
        for (const s of shelves) {
            if (s.isSpecial) continue;
            lines.push(`## ${s.emoji || '📚'} ${s.name}`);
            if (s.description) lines.push(`> ${s.description}`);
            lines.push('');
            for (const asin of (s.books || [])) {
                const b = byAsin.get(asin);
                if (!b) continue;
                const note = (s.notes && s.notes[asin]) || notes[asin] || {};
                lines.push(formatBookLine(b, note));
            }
            lines.push('');
        }

        const md = lines.join('\n');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bookshelf-${today}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function formatBookLine(book, note) {
        const title = book.title || '(無題)';
        const authors = Array.isArray(book.authors) ? book.authors.join(', ') : (book.authors || '');
        const rating = note?.rating;
        const stars = Number.isInteger(rating) && rating >= 1 && rating <= 5
            ? ' (' + '★'.repeat(rating) + '☆'.repeat(5 - rating) + ')'
            : '';
        let line = `- **${escape(title)}**${authors ? ' — ' + escape(authors) : ''}${stars}`;
        if (note?.memo) {
            line += '\n  - メモ: ' + escape(note.memo).replace(/\n/g, '\n    ');
        }
        return line;
    }

    function escape(s) {
        return String(s ?? '');
    }

    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    return { deactivate() {} };
}
