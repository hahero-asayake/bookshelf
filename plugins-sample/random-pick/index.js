// random-pick
//
// ⌘K パレットから「ランダムに1冊」開く。未読のみ版も登録。
// 旧版は window.bookshelf.showBookDetail を直接叩いていたが、
// 現行は api.openBook(asin) でナビゲートする。

export function activate(api, manifest) {
    api.registerCommand({
        id: 'random-pick',
        title: 'ランダムに1冊開く',
        icon: 'dices',
        keywords: 'random ランダム らんだむ おみくじ pick',
        run: () => pick(false)
    });
    api.registerCommand({
        id: 'random-pick-unread',
        title: 'ランダムに1冊開く（未読のみ）',
        icon: 'dices',
        keywords: 'random ランダム 未読 みどく unread pick',
        run: () => pick(true)
    });

    function pick(unreadOnly) {
        const books = api.getBooks();
        if (!books.length) { alert('蔵書がありません'); return; }
        const notes = api.getNotes();
        const pool = unreadOnly
            ? books.filter(b => (b.readStatus || '').toLowerCase() !== 'read' && !(notes[b.asin]?.rating))
            : books;
        if (!pool.length) { alert(unreadOnly ? '未読本がありません' : '蔵書がありません'); return; }
        const picked = pool[Math.floor(Math.random() * pool.length)];
        api.openBook(picked.asin);
    }

    return {};
}
