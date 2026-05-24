// Hello Bookshelf - sample plugin
//
// 同期フォルダの plugins/hello-bookshelf/ に manifest.json + この index.js を配置し、
// プラグイン管理画面で「有効」にすると activate が呼ばれる。
//
// 公式 API は window.bookshelfAPI 経由でも参照可能。引数の api と同じインスタンス。

export function activate(api, manifest) {
    console.log(`[${manifest.id}] v${manifest.version} activated`);
    console.log(`  books: ${api.getBooks().length}, bookshelves: ${api.getBookshelves().length}`);

    api.addUIButton({
        id: 'hello-bookshelf-greet',
        where: 'library-management',
        emoji: '👋',
        label: 'Hello',
        title: 'プラグインからの挨拶',
        onClick: () => {
            const books = api.getBooks();
            const shelves = api.getBookshelves();
            alert(`📚 蔵書数: ${books.length} 冊\n📁 本棚数: ${shelves.length} 個\n\n（${manifest.name} プラグインから）`);
        }
    });

    // メモ更新イベントを購読
    api.on('note:updated', ({ asin, note }) => {
        console.log(`[${manifest.id}] note:updated`, asin, note);
    });
}
