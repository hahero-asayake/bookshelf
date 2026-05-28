// view-compact
//
// 本棚を超高密度のリストに変える。1 行 1 冊、表紙は小さく、評価・タイトル・著者を横並び。
// CSS のみで実装。1画面に 50+ 冊が並ぶ実用派向け。

const STORAGE_KEY = 'plugin-view-compact:enabled';
const STYLE_ID = 'plugin-view-compact-style';
const BODY_CLASS = 'plugin-view-compact-active';

const CSS = `
body.${BODY_CLASS} .bookshelf.view-covers,
body.${BODY_CLASS} .bookshelf.view-list {
    display: flex !important;
    flex-direction: column !important;
    gap: 0 !important;
    padding: 0 !important;
    background: var(--bg-color, #fff) !important;
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 6px;
    overflow: hidden;
}
body.${BODY_CLASS} .bookshelf .book-item {
    display: grid !important;
    grid-template-columns: 28px 22px 1fr auto 90px !important;
    align-items: center !important;
    gap: 0.6rem !important;
    margin: 0 !important;
    padding: 4px 0.8rem !important;
    background: transparent !important;
    border: none !important;
    border-bottom: 1px solid var(--border-color, #eee) !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    width: 100% !important;
    height: auto !important;
    min-height: 32px;
    transition: background 0.1s;
    cursor: pointer;
}
body.${BODY_CLASS} .bookshelf .book-item:hover {
    background: rgba(74, 144, 226, 0.08) !important;
}
body.${BODY_CLASS} .bookshelf .book-item:nth-child(even) {
    background: rgba(0,0,0,0.015);
}
body.${BODY_CLASS} .bookshelf .book-item:nth-child(even):hover {
    background: rgba(74, 144, 226, 0.08) !important;
}
body.${BODY_CLASS} .bookshelf .drag-handle {
    grid-column: 1;
    color: #ccc !important;
    font-size: 0.75rem !important;
    width: 20px;
    text-align: center;
    cursor: grab;
    display: block !important;
    padding: 0 !important;
}
body.${BODY_CLASS} .bookshelf .book-cover-container {
    grid-column: 2;
    width: 22px !important;
    height: 30px !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden;
    border-radius: 2px;
    background: #f0f0f0;
}
body.${BODY_CLASS} .bookshelf .book-cover,
body.${BODY_CLASS} .bookshelf .book-cover-placeholder {
    width: 22px !important;
    height: 30px !important;
    object-fit: cover !important;
    font-size: 0.5rem;
    display: block;
}
body.${BODY_CLASS} .bookshelf .book-cover-placeholder {
    display: flex !important;
    align-items: center;
    justify-content: center;
}
body.${BODY_CLASS} .bookshelf .book-info {
    grid-column: 3;
    display: flex !important;
    flex-direction: row !important;
    align-items: baseline;
    gap: 0.8rem;
    min-width: 0;
    overflow: hidden;
}
body.${BODY_CLASS} .bookshelf .book-title {
    font-size: 0.85rem !important;
    font-weight: 500 !important;
    color: var(--text-color, #222) !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0 !important;
    flex: 1 1 auto;
    min-width: 0;
}
body.${BODY_CLASS} .bookshelf .book-author {
    font-size: 0.75rem !important;
    color: #888 !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0 !important;
    flex: 0 1 220px;
    min-width: 0;
}
body.${BODY_CLASS} .bookshelf .book-memo {
    display: none !important;
}
body.${BODY_CLASS} .bookshelf .star-rating {
    grid-column: 5;
    font-size: 0.8rem !important;
    color: #ffa500 !important;
    white-space: nowrap;
    margin: 0 !important;
    text-align: right;
    justify-self: end;
}
@media (max-width: 700px) {
    body.${BODY_CLASS} .bookshelf .book-item {
        grid-template-columns: 22px 1fr 80px !important;
    }
    body.${BODY_CLASS} .bookshelf .drag-handle { display: none !important; }
    body.${BODY_CLASS} .bookshelf .book-cover-container { grid-column: 1; }
    body.${BODY_CLASS} .bookshelf .book-info { grid-column: 2; flex-direction: column !important; align-items: flex-start; gap: 0; }
    body.${BODY_CLASS} .bookshelf .book-author { font-size: 0.7rem !important; }
    body.${BODY_CLASS} .bookshelf .star-rating { grid-column: 3; }
}
`;

export function activate(api, manifest) {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

    function apply() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        document.body.classList.add(BODY_CLASS);
    }
    function unapply() {
        const s = document.getElementById(STYLE_ID);
        if (s) s.remove();
        document.body.classList.remove(BODY_CLASS);
    }

    if (enabled) apply();

    api.addUIButton({
        id: 'view-compact-toggle',
        emoji: '📋',
        label: 'Compact',
        title: 'コンパクトリスト表示の ON/OFF',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            if (enabled) apply(); else unapply();
        }
    });

    return { deactivate: unapply };
}
