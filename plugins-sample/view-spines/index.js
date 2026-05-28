// view-spines
//
// 本棚を物理的な本棚風に変える。各本は背表紙（縦書き、色付き矩形）として表示。
// ASIN からハッシュで色相を決定し、本ごとに異なる背表紙色になる。
// ホバーで本が前に飛び出す物理アニメーション。

const STORAGE_KEY = 'plugin-view-spines:enabled';
const STYLE_ID = 'plugin-view-spines-style';
const BODY_CLASS = 'plugin-view-spines-active';

const CSS = `
body.${BODY_CLASS} .bookshelf.view-covers {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 2px !important;
    align-items: flex-end !important;
    padding: 1.5rem 1rem 1rem !important;
    background:
        linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.5) 100%),
        linear-gradient(90deg, #6b4423 0%, #8b6f47 20%, #8b6f47 80%, #6b4423 100%);
    border-radius: 6px;
    box-shadow:
        inset 0 6px 12px rgba(0,0,0,0.3),
        inset 0 -6px 12px rgba(0,0,0,0.4),
        0 4px 12px rgba(0,0,0,0.2);
    min-height: 360px;
    position: relative;
}
body.${BODY_CLASS} .bookshelf.view-covers::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 12px;
    background: linear-gradient(180deg, #3d2817 0%, #5a3920 100%);
    box-shadow: 0 -2px 4px rgba(0,0,0,0.4);
    border-radius: 0 0 6px 6px;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item {
    width: 42px !important;
    height: var(--spine-height, 280px) !important;
    margin: 0 !important;
    padding: 1.2rem 0.4rem 0.6rem !important;
    background: linear-gradient(90deg,
        rgba(0,0,0,0.25) 0%,
        var(--spine-color, hsl(220, 40%, 40%)) 12%,
        var(--spine-color, hsl(220, 40%, 40%)) 88%,
        rgba(0,0,0,0.3) 100%) !important;
    color: #fff !important;
    border: none !important;
    border-radius: 2px 2px 1px 1px;
    box-shadow:
        1px 0 2px rgba(0,0,0,0.4),
        inset 0 -3px 6px rgba(0,0,0,0.3),
        inset 0 2px 4px rgba(255,255,255,0.15);
    cursor: pointer;
    overflow: hidden;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: relative;
    transform-origin: center bottom;
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n)   { --spine-height: 295px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n+1) { --spine-height: 275px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n+2) { --spine-height: 290px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n+3) { --spine-height: 282px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover {
    transform: translateY(-20px) scaleY(1.05);
    z-index: 10;
    box-shadow:
        3px 6px 16px rgba(0,0,0,0.5),
        inset 0 -3px 6px rgba(0,0,0,0.3),
        inset 0 2px 4px rgba(255,255,255,0.2);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover-container,
body.${BODY_CLASS} .bookshelf.view-covers .drag-handle,
body.${BODY_CLASS} .bookshelf.view-covers .book-author,
body.${BODY_CLASS} .bookshelf.view-covers .book-memo,
body.${BODY_CLASS} .bookshelf.view-covers .star-rating {
    display: none !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-info {
    display: block !important;
    width: 100%;
    height: 100%;
    padding: 0 !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-title {
    writing-mode: vertical-rl !important;
    text-orientation: mixed !important;
    font-size: 0.78rem !important;
    font-weight: 700;
    color: rgba(255,255,255,0.95) !important;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-height: 100%;
    line-height: 42px;
    letter-spacing: 0.05em;
    margin: 0 auto !important;
}
`;

function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
}

function applyColors() {
    document.querySelectorAll(`body.${BODY_CLASS} .book-item`).forEach(item => {
        const asin = item.dataset.asin;
        if (!asin) return;
        const hue = hashHue(asin);
        const sat = 35 + (hashHue(asin + 'x') % 25);
        const lit = 30 + (hashHue(asin + 'y') % 20);
        item.style.setProperty('--spine-color', `hsl(${hue}, ${sat}%, ${lit}%)`);
    });
}

export function activate(api, manifest) {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

    let observer = null;
    let scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; applyColors(); });
    }

    function startObserver() {
        if (observer) return;
        const bs = document.getElementById('bookshelf');
        if (!bs) return;
        observer = new MutationObserver(schedule);
        observer.observe(bs, { childList: true, subtree: false });
    }
    function stopObserver() { if (observer) { observer.disconnect(); observer = null; } }

    function apply() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        document.body.classList.add(BODY_CLASS);
        startObserver();
        schedule();
    }
    function unapply() {
        stopObserver();
        const s = document.getElementById(STYLE_ID);
        if (s) s.remove();
        document.body.classList.remove(BODY_CLASS);
    }

    if (enabled) setTimeout(apply, 100);

    api.addUIButton({
        id: 'view-spines-toggle',
        emoji: '📚',
        label: 'Spines',
        title: '背表紙ビュー（物理本棚風）の ON/OFF',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            if (enabled) apply(); else unapply();
        }
    });

    return { deactivate: unapply };
}
