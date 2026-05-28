// view-mosaic
//
// 本棚 (.bookshelf.view-covers) を Pinterest 風の masonry グリッドに変える。
// CSS columns で実装、表紙の縦横比を保ったまま隙間なく敷き詰める。
// ホバー時のみタイトル overlay を表示。

const STORAGE_KEY = 'plugin-view-mosaic:enabled';
const STYLE_ID = 'plugin-view-mosaic-style';
const BODY_CLASS = 'plugin-view-mosaic-active';

const CSS = `
body.${BODY_CLASS} .bookshelf.view-covers {
    display: block !important;
    column-count: 6 !important;
    column-gap: 4px !important;
    padding: 4px !important;
    background: #0a0a0a !important;
    border-radius: 8px;
}
@media (max-width: 1400px) { body.${BODY_CLASS} .bookshelf.view-covers { column-count: 5 !important; } }
@media (max-width: 1100px) { body.${BODY_CLASS} .bookshelf.view-covers { column-count: 4 !important; } }
@media (max-width: 800px)  { body.${BODY_CLASS} .bookshelf.view-covers { column-count: 3 !important; } }
@media (max-width: 500px)  { body.${BODY_CLASS} .bookshelf.view-covers { column-count: 2 !important; } }

body.${BODY_CLASS} .bookshelf.view-covers .book-item {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 4px 0 !important;
    padding: 0 !important;
    width: 100% !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    position: relative;
    overflow: hidden;
    border-radius: 4px;
    transition: transform 0.25s, box-shadow 0.25s;
    display: block !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover {
    transform: scale(1.03);
    z-index: 5;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover-container {
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover {
    width: 100% !important;
    height: auto !important;
    display: block !important;
    object-fit: cover !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover-placeholder {
    width: 100% !important;
    aspect-ratio: 2 / 3;
    display: flex !important;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #2a2a3e, #1a1a2e);
    color: #888 !important;
    font-size: 0.85rem;
    padding: 0.5rem;
    text-align: center;
    border-radius: 4px;
}
body.${BODY_CLASS} .bookshelf.view-covers .drag-handle {
    display: none !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-info {
    position: absolute !important;
    inset: auto 0 0 0 !important;
    background: linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 60%, transparent 100%) !important;
    color: #fff !important;
    padding: 1.2rem 0.6rem 0.5rem !important;
    transform: translateY(100%);
    transition: transform 0.25s;
    pointer-events: none;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover .book-info {
    transform: translateY(0);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-title {
    color: #fff !important;
    font-size: 0.78rem !important;
    font-weight: 600;
    margin: 0 0 0.15rem !important;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-author {
    color: #bbb !important;
    font-size: 0.7rem !important;
    margin: 0 !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-memo,
body.${BODY_CLASS} .bookshelf.view-covers .star-rating {
    display: none !important;
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
        id: 'view-mosaic-toggle',
        emoji: '🎨',
        label: 'Mosaic',
        title: 'Mosaic ビュー（Pinterest 風）の ON/OFF',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            if (enabled) apply(); else unapply();
        }
    });

    return { deactivate: unapply };
}
