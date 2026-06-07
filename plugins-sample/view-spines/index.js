// view-spines
//
// 本棚 (.view-covers) を物理的な背表紙風に変える「ビュー系」プラグインの例。
// アプリ標準の DOM/クラスを CSS で上書きする方式 (専用ビューAPIは将来課題)。
//   - api.injectCSS でスタイル注入 (unload で自動除去)
//   - body class をトグルして ON/OFF (⌘K コマンド or ヘッダーボタン)
//   - ui:books-rendered イベントで再描画時に背表紙色を再付与
//
// 背表紙色は ASIN ハッシュから決まる (本ごとに異なる色)。

const STORAGE_KEY = 'plugin-view-spines:on';
const BODY_CLASS = 'plugin-view-spines-active';

const CSS = `
body.${BODY_CLASS} .bookshelf.view-covers {
    display: flex !important; flex-wrap: wrap !important; gap: 2px !important; align-items: flex-end !important;
    padding: 1.5rem 1rem 1rem !important;
    background:
        linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.5) 100%),
        linear-gradient(90deg, #6b4423 0%, #8b6f47 20%, #8b6f47 80%, #6b4423 100%);
    border-radius: 6px; min-height: 360px; position: relative;
    box-shadow: inset 0 6px 12px rgba(0,0,0,0.3), inset 0 -6px 12px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.2);
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item {
    width: 42px !important; height: var(--spine-height, 280px) !important; margin: 0 !important;
    padding: 1.2rem 0.4rem 0.6rem !important;
    background: linear-gradient(90deg, rgba(0,0,0,0.25) 0%, var(--spine-color, hsl(220,40%,40%)) 12%,
        var(--spine-color, hsl(220,40%,40%)) 88%, rgba(0,0,0,0.3) 100%) !important;
    color: #fff !important; border: none !important; border-radius: 2px;
    box-shadow: 1px 0 2px rgba(0,0,0,0.4), inset 0 -3px 6px rgba(0,0,0,0.3), inset 0 2px 4px rgba(255,255,255,0.15);
    cursor: pointer; overflow: hidden; position: relative; transform-origin: center bottom;
    transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
    display: flex !important; flex-direction: column; align-items: center; justify-content: flex-start;
    content-visibility: visible !important;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n)   { --spine-height: 295px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n+1) { --spine-height: 275px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n+2) { --spine-height: 290px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:nth-child(4n+3) { --spine-height: 282px; }
body.${BODY_CLASS} .bookshelf.view-covers .book-item:hover {
    transform: translateY(-20px) scaleY(1.05); z-index: 10;
}
body.${BODY_CLASS} .bookshelf.view-covers .book-cover-container,
body.${BODY_CLASS} .bookshelf.view-covers .drag-handle,
body.${BODY_CLASS} .bookshelf.view-covers .book-author,
body.${BODY_CLASS} .bookshelf.view-covers .book-memo,
body.${BODY_CLASS} .bookshelf.view-covers .card-hover-pop,
body.${BODY_CLASS} .bookshelf.view-covers .star-rating { display: none !important; }
body.${BODY_CLASS} .bookshelf.view-covers .book-info { display: block !important; width: 100%; height: 100%; padding: 0 !important; }
body.${BODY_CLASS} .bookshelf.view-covers .book-title {
    writing-mode: vertical-rl !important; text-orientation: mixed !important;
    font-size: 0.78rem !important; font-weight: 700; color: rgba(255,255,255,0.95) !important;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-height: 100%; line-height: 42px; letter-spacing: 0.05em; margin: 0 auto !important;
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
    let on = false;
    try { on = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

    api.injectCSS('spines', CSS);

    let scheduled = false;
    const schedule = () => {
        if (scheduled || !on) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; applyColors(); });
    };
    const sync = () => {
        document.body.classList.toggle(BODY_CLASS, on);
        api.setUIButtonActive('view-spines-toggle-btn', on); // 背景色で ON/OFF を明示
        if (on) schedule();
    };
    const toggle = () => {
        on = !on;
        try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {}
        sync();
    };

    // 一覧が再描画されたら背表紙色を付け直す
    api.on('ui:books-rendered', schedule);

    api.registerCommand({
        id: 'view-spines-toggle',
        title: '背表紙ビューを切替',
        icon: 'library-big',
        keywords: 'spine 背表紙 せびょうし view ビュー 本棚 physical',
        run: toggle
    });
    api.addUIButton({
        id: 'view-spines-toggle-btn',
        label: 'Spines',
        title: '背表紙ビュー（物理本棚風）の ON/OFF',
        iconName: 'library-big',
        onClick: toggle
    });

    if (on) setTimeout(sync, 100);

    return { deactivate() { document.body.classList.remove(BODY_CLASS); } };
}
