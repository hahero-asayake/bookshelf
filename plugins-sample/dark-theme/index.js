// dark-theme
//
// 暗色テーマ。アプリは CSS 変数駆動 (--bg/--panel/--fg/--accent ...) なので、
// それらを body.plugin-dark スコープで上書きするだけで全体が暗くなる。
// ⌘K コマンド or ヘッダーボタンでトグル。状態は localStorage に保存。

const STORAGE_KEY = 'plugin-dark-theme:on';
const BODY_CLASS = 'plugin-dark';

const CSS = `
body.${BODY_CLASS} {
    --bg: #15171c; --panel: #1d2026; --side: #191c22;
    --fg: #e6e8ec; --fg2: #b3b9c4; --muted: #8b93a1;
    --line: #2c313a; --line2: #242831;
    --accent: #7c8cff; --accent-bg: #232842; --accent-strong: #9aa6ff;
    --shadow: 0 8px 24px rgba(0,0,0,0.5);
    --primary-color: #e6e8ec; --text-color: #e6e8ec; --bg-color: #15171c; --border-color: #2c313a;
    color-scheme: dark;
}
body.${BODY_CLASS} img.book-cover { box-shadow: 0 1px 6px rgba(0,0,0,0.6); }
`;

export function activate(api, manifest) {
    let on = false;
    try { on = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}

    api.injectCSS('dark', CSS);
    const sync = () => {
        document.body.classList.toggle(BODY_CLASS, on);
        if (btn && btn.element) btn.element.title = on ? 'ダークテーマ: ON' : 'ダークテーマ: OFF';
        api.setUIButtonActive('dark-theme-toggle-btn', on); // 背景色で ON/OFF を明示
    };
    const toggle = () => {
        on = !on;
        try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {}
        sync();
    };

    api.registerCommand({
        id: 'dark-theme-toggle',
        title: 'ダークテーマを切替',
        icon: 'moon',
        keywords: 'dark theme ダーク 暗色 テーマ だーく',
        run: toggle
    });
    const btn = api.addUIButton({
        id: 'dark-theme-toggle-btn',
        label: 'ダーク',
        title: 'ダークテーマの ON/OFF',
        iconName: 'moon',
        onClick: toggle
    });

    sync();

    return { deactivate() { document.body.classList.remove(BODY_CLASS); } };
}
