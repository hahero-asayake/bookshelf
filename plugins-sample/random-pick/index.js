// random-pick
//
// ボタンを押すと蔵書からランダムに1冊選んで本詳細モーダルを開く。
// shift+click または右クリックで「未読のみ」モード。

export function activate(api, manifest) {
    const btn = api.addUIButton({
        id: 'random-pick-button',
        where: 'library-management',
        emoji: '🎲',
        label: 'ランダム1冊',
        title: 'ランダムに1冊選ぶ (右クリックで未読のみ)',
        onClick: () => pick(false)
    });

    if (btn && btn.element) {
        btn.element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            pick(true);
        });
    }

    function pick(unreadOnly) {
        const books = api.getBooks();
        if (!books.length) {
            alert('蔵書がありません');
            return;
        }
        const notes = api.getNotes();
        const pool = unreadOnly
            ? books.filter(b => {
                const status = (b.readStatus || '').toLowerCase();
                return status !== 'read' && !(notes[b.asin]?.rating);
            })
            : books;
        if (!pool.length) {
            alert(unreadOnly ? '未読本がありません' : '蔵書がありません');
            return;
        }
        const picked = pool[Math.floor(Math.random() * pool.length)];

        // VirtualBookshelf の showBookDetail を直接呼べると router 連携も働く
        if (window.bookshelf && typeof window.bookshelf.showBookDetail === 'function') {
            window.bookshelf.showBookDetail(picked, false);
        } else {
            // フォールバック: URL ハッシュで遷移
            location.hash = `#book/${encodeURIComponent(picked.asin)}`;
        }
    }

    return { deactivate() {} };
}
