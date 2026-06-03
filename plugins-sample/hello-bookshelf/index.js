// hello-bookshelf — API 入門サンプル
//
// 新プラグインAPI (プラットフォーム化版) の最小例。
//   - registerCommand : ⌘K コマンドパレットに項目を足す
//   - addUIButton     : ヘッダーにアイコンボタンを足す
//   - injectCSS       : スコープ付き <style> を注入 (unload で自動除去)
//   - api.on          : イベント購読
//
// activate(api, manifest) を export する ES Module。api = window.bookshelfAPI。

export function activate(api, manifest) {
    console.log(`[${manifest.id}] v${manifest.version} activated — books:${api.getBooks().length} shelves:${api.getBookshelves().length}`);

    // 1) ⌘K パレットにコマンド
    api.registerCommand({
        id: 'hello-summary',
        title: 'Hello: 蔵書サマリを表示',
        icon: 'hand',
        keywords: 'hello greet サマリ さまり あいさつ',
        run: () => {
            const books = api.getBooks();
            const shelves = api.getBookshelves();
            alert(`蔵書 ${books.length} 冊 / 本棚 ${shelves.length} 個\n\n（${manifest.name} プラグインより）`);
        }
    });

    // 2) ヘッダーにアイコンボタン
    api.addUIButton({
        id: 'hello-greet',
        label: 'Hello',
        title: 'プラグインからの挨拶',
        iconName: 'hand',
        onClick: () => alert('👋 Hello from a plugin!')
    });

    // 3) ちょっとした見た目変更 (injectCSS のデモ; unload で自動的に剥がれる)
    api.injectCSS('accent-demo', `
        .plugin-button-item [data-icon-value="hand"] { transition: transform .15s; }
        .plugin-button-item:hover [data-icon-value="hand"] { transform: rotate(-15deg); }
    `);

    // 4) イベント購読 (戻り値の off で解除できるが、unregister でも自動解除される)
    api.on('note:updated', ({ asin, note }) => {
        console.log(`[${manifest.id}] note:updated`, asin, note);
    });
    api.on('book:added', ({ book }) => console.log(`[${manifest.id}] book:added`, book && book.asin));

    // deactivate を返すと無効化時に呼ばれる (任意)。
    return { deactivate() { console.log(`[${manifest.id}] deactivated`); } };
}
