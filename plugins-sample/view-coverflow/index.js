// view-coverflow
//
// 本棚 (.bookshelf.view-covers) を Coverflow 風に変える。
// 横スクロール、scroll-snap、傾斜カバー、中央フォーカス時の拡大。
// CSS 注入 + body class のみで動作。状態は localStorage。

const STORAGE_KEY = 'plugin-view-coverflow:enabled';
const STYLE_ID = 'plugin-view-coverflow-style';
const BODY_CLASS = 'plugin-view-coverflow-active';

const CSS = `
body.${BODY_CLASS} .bookshelf.view-covers {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    overflow-x: auto !important;
    overflow-y: visible !important;
    perspective: 1400px;
    perspective-origin: 50% 50%;
    padding: 5rem 50% 5rem 50% !important;
    gap: 0 !important;
    scroll-snap-type: x mandatory;
    scroll-padding: 0 50%;
    background: linear-gradient(180deg, #1a1d2e 0%, #2d3148 60%, #1a1d2e 100%);
    border-radius: 12px;
    box-shadow: inset 0 0 60px rgba(0,0,0,0.7);
    min-height: 480px;
    scrollbar-width: thin;
    scrollbar-color: #4a90e2 transparent;
}
body.${BODY_CLASS} .bookshelf.view-covers::-webkit-scrollbar { height: 10px; }
body.${BODY_CLASS} .bookshelf.view-covers::-webkit-scrollbar-thumb {
    background: linear-gradient(90deg, #4a90e2, #357ab8);
    border-radius: 5px;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item {
    flex: 0 0 220px !important;
    width: 220px !important;
    height: 320px !important;
    margin: 0 -60px !important;
    padding: 0 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    transform-style: preserve-3d;
    transform: rotateY(45deg) scale(0.75);
    transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.3, 1), z-index 0s 0.25s;
    scroll-snap-align: center;
    cursor: pointer;
    position: relative;
    z-index: 1;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(odd) {
    transform: rotateY(45deg) scale(0.75);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover {
    transform: rotateY(0deg) scale(1.15) translateZ(50px) !important;
    z-index: 99 !important;
    transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.3, 1), z-index 0s 0s;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover ~ .book-item {
    transform: rotateY(-45deg) scale(0.75);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover-container {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    position: relative;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover,
body.${BODY_CLASS} .bookshelf.view-covers .book-cover-placeholder {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
    border-radius: 4px;
    box-shadow:
        0 20px 40px rgba(0,0,0,0.6),
        0 0 0 1px rgba(255,255,255,0.05),
        inset 6px 0 12px rgba(0,0,0,0.3);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 60%);
    transform: scaleY(-1);
    opacity: 0.4;
    pointer-events: none;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-info,
body.${BODY_CLASS} .bookshelf.view-covers .drag-handle {
    display: none !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover .book-info {
    display: block !important;
    position: absolute !important;
    bottom: -80px !important;
    left: -40px !important;
    right: -40px !important;
    background: rgba(0,0,0,0.85) !important;
    backdrop-filter: blur(8px);
    color: #fff !important;
    padding: 0.6rem 1rem !important;
    border-radius: 6px !important;
    text-align: center;
    pointer-events: none;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover .book-title {
    color: #fff !important;
    font-weight: 600;
    font-size: 0.95rem;
    margin: 0 0 0.2rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover .book-author {
    color: #aaa !important;
    font-size: 0.8rem;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover .book-memo,
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover .star-rating {
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

    const btn = api.addUIButton({
        id: 'view-coverflow-toggle',
        emoji: '🌊',
        label: 'Coverflow',
        title: 'Coverflow ビューの ON/OFF',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            if (enabled) apply(); else unapply();
        }
    });

    return { deactivate: unapply };
}
