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
    --accent: #4d5fd6; --accent-bg: #232842; --accent-strong: #9aa6ff;
    --danger: #ff6b6b; --warning: #e0a930;
    /* ホバー背景専用トークン(イシュー#247 決裁1・2 スコープ外指摘の解消)。--accent-strong は
       --accent-bg上の文字色にも使う明るい値のため、そのまま.btn-primary:hoverの背景に使うと
       白文字コントラストが2.26まで落ちる(実測)。--danger/--warningもテキスト用に明るく調整した値
       なので、ライト固定のホバー背景(#fce8e8/#fff7e0)と組み合わせると2.36/1.99まで落ちる(実測)。
       いずれも4.5以上になるダーク専用の暗い背景色に差し替える。 */
    --btn-primary-hover-bg: #293b8f; --btn-danger-hover-bg: #33191a; --btn-warning-hover-bg: #332811;
    --shadow: 0 8px 24px rgba(0,0,0,0.5);
    --primary-color: #e6e8ec; --text-color: #e6e8ec; --bg-color: #15171c; --border-color: #2c313a;
    color-scheme: dark;
}
body.${BODY_CLASS} img.book-cover { box-shadow: 0 1px 6px rgba(0,0,0,0.6); }
/* 削除ボタンの白文字ホバー (.bd-memo-block-remove:hover) は --danger をそのまま背景に使うと
   (このダーク値はテキスト用に明るく調整済みのため) 白文字コントラストが 4.5 を割る (実測2.7台)。
   この1箇所だけライトの危険色を固定で使う (イシュー#247 決裁2 実測・白文字コントラスト5.3)。 */
body.${BODY_CLASS} .bd-memo-block-remove:hover { background: #c23a3a; }
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
