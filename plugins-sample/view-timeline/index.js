// view-timeline
//
// 本棚を「取得月でグループ化」したタイムラインに変える。
// DOM の各 .book-item を acquiredTime でソートし、月が変わるところに月ヘッダーを inject。
// MutationObserver で本棚が再描画されたら再 inject する。

const STORAGE_KEY = 'plugin-view-timeline:enabled';
const STYLE_ID = 'plugin-view-timeline-style';
const BODY_CLASS = 'plugin-view-timeline-active';
const HEADER_CLASS = 'plugin-view-timeline-header';

const CSS = `
body.${BODY_CLASS} .bookshelf.view-covers,
body.${BODY_CLASS} .bookshelf.view-list {
    display: grid !important;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important;
    gap: 12px !important;
    padding: 1rem !important;
    align-items: start;
}
body.${BODY_CLASS} .${HEADER_CLASS} {
    grid-column: 1 / -1 !important;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.2rem 0.5rem 0.6rem !important;
    margin: 1.5rem 0 0.5rem !important;
    border-bottom: 2px solid var(--secondary-color, #4a90e2);
    position: sticky;
    top: 0;
    background: linear-gradient(180deg, var(--bg-color, #f5f5f5) 80%, transparent 100%);
    z-index: 5;
}
body.${BODY_CLASS} .${HEADER_CLASS}:first-child {
    margin-top: 0 !important;
}
body.${BODY_CLASS} .${HEADER_CLASS} .timeline-month {
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text-color, #222);
    letter-spacing: 0.05em;
}
body.${BODY_CLASS} .${HEADER_CLASS} .timeline-count {
    font-size: 0.9rem;
    color: var(--secondary-color, #4a90e2);
    background: rgba(74, 144, 226, 0.12);
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    font-weight: 600;
}
body.${BODY_CLASS} .bookshelf .book-item {
    padding: 0.4rem !important;
    background: var(--bg-color, #fff);
    border: 1px solid var(--border-color, #e0e0e0);
    border-radius: 6px;
    transition: transform 0.15s, box-shadow 0.15s;
}
body.${BODY_CLASS} .bookshelf .book-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0,0,0,0.12);
}
body.${BODY_CLASS} .bookshelf .book-cover {
    width: 100% !important;
    height: auto !important;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    border-radius: 4px;
}
body.${BODY_CLASS} .bookshelf .book-title {
    font-size: 0.78rem !important;
    margin-top: 0.4rem !important;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
body.${BODY_CLASS} .bookshelf .book-author {
    font-size: 0.7rem !important;
    color: #888 !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
body.${BODY_CLASS} .bookshelf .book-memo {
    display: none !important;
}
`;

export function activate(api, manifest) {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

    let observer = null;
    let injectScheduled = false;

    function getBookshelfEl() {
        return document.getElementById('bookshelf');
    }

    function clearHeaders() {
        const bs = getBookshelfEl();
        if (!bs) return;
        bs.querySelectorAll(`.${HEADER_CLASS}`).forEach(h => h.remove());
    }

    function scheduleInject() {
        if (injectScheduled) return;
        injectScheduled = true;
        requestAnimationFrame(() => {
            injectScheduled = false;
            inject();
        });
    }

    function inject() {
        if (!enabled) return;
        const bs = getBookshelfEl();
        if (!bs) return;
        clearHeaders();

        const items = Array.from(bs.querySelectorAll('.book-item'));
        if (items.length === 0) return;

        const booksByAsin = new Map();
        for (const b of api.getBooks()) booksByAsin.set(b.asin, b);

        // 取得日（降順）で並び替え（DOM 順を書き換え）
        items.sort((a, b) => {
            const ba = booksByAsin.get(a.dataset.asin);
            const bb = booksByAsin.get(b.dataset.asin);
            const ta = ba && ba.acquiredTime ? parseInt(ba.acquiredTime) : 0;
            const tb = bb && bb.acquiredTime ? parseInt(bb.acquiredTime) : 0;
            return tb - ta;
        });

        // groupByMonth
        const groups = [];
        let currentKey = null;
        let currentGroup = null;
        for (const item of items) {
            const book = booksByAsin.get(item.dataset.asin);
            const t = book && book.acquiredTime ? parseInt(book.acquiredTime) : 0;
            let key, label;
            if (!t) { key = 'unknown'; label = '取得日不明'; }
            else {
                const d = new Date(t);
                key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                label = `${d.getFullYear()}年${d.getMonth()+1}月`;
            }
            if (key !== currentKey) {
                currentKey = key;
                currentGroup = { key, label, items: [] };
                groups.push(currentGroup);
            }
            currentGroup.items.push(item);
        }

        // DOM 再構築
        bs.innerHTML = '';
        for (const g of groups) {
            const header = document.createElement('div');
            header.className = HEADER_CLASS;
            header.innerHTML = `<span class="timeline-month">📅 ${g.label}</span><span class="timeline-count">${g.items.length} 冊</span>`;
            bs.appendChild(header);
            for (const item of g.items) bs.appendChild(item);
        }
    }

    function startObserver() {
        const bs = getBookshelfEl();
        if (!bs || observer) return;
        observer = new MutationObserver((mutations) => {
            // 自分が動かしたヘッダー以外の変化のみ反応
            const meaningful = mutations.some(m => {
                if (m.type !== 'childList') return false;
                for (const node of m.addedNodes) {
                    if (node.nodeType === 1 && !node.classList?.contains(HEADER_CLASS)) return true;
                }
                for (const node of m.removedNodes) {
                    if (node.nodeType === 1 && !node.classList?.contains(HEADER_CLASS)) return true;
                }
                return false;
            });
            if (meaningful) scheduleInject();
        });
        observer.observe(bs, { childList: true });
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
    }

    function apply() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        document.body.classList.add(BODY_CLASS);
        startObserver();
        scheduleInject();
    }
    function unapply() {
        stopObserver();
        clearHeaders();
        const s = document.getElementById(STYLE_ID);
        if (s) s.remove();
        document.body.classList.remove(BODY_CLASS);
        // 元の表示に戻すため再描画
        if (window.bookshelf && typeof window.bookshelf.updateDisplay === 'function') {
            window.bookshelf.updateDisplay();
        }
    }

    if (enabled) {
        // app 初期化完了後に inject 開始
        setTimeout(apply, 100);
    }

    api.addUIButton({
        id: 'view-timeline-toggle',
        emoji: '📅',
        label: 'Timeline',
        title: 'タイムラインビュー（取得月グループ化）の ON/OFF',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            if (enabled) apply(); else unapply();
        }
    });

    return { deactivate: unapply };
}
