// dark-theme
//
// 暗色テーマを適用するプラグイン。activate 時に <style> を head に挿入し、
// deactivate 時に除去する。状態は localStorage で保存され、リロードしても維持される。

const STORAGE_KEY = 'plugin-dark-theme:enabled';
const STYLE_ID = 'plugin-dark-theme-style';

const CSS = `
:root {
    --primary-color: #e4e6eb !important;
    --secondary-color: #4a90e2 !important;
    --accent-color: #ff6b6b !important;
    --text-color: #e4e6eb !important;
    --bg-color: #18191a !important;
    --border-color: #3a3b3c !important;
    --shadow-color: rgba(0, 0, 0, 0.5) !important;
}
body { background: #18191a !important; color: #e4e6eb !important; }
.header { background: #242526 !important; color: #e4e6eb !important; box-shadow: 0 2px 4px rgba(0,0,0,0.4) !important; }
.header-title, .header-subtitle { color: #e4e6eb !important; }
.sidebar > * , .bookshelf-container, .filter-section, .stats-section, .library-management,
.modal-content, .book-item, .bookshelf-preview, .pagination button, .management-group,
.import-options, .add-book-options, .book-selection, .book-detail {
    background: #242526 !important;
    color: #e4e6eb !important;
    border-color: #3a3b3c !important;
}
.management-group > summary { background: #3a3b3c !important; color: #e4e6eb !important; }
.management-group > summary:hover { background: #4e4f50 !important; }
.btn-secondary, .management-buttons .btn { background: #3a3b3c !important; color: #e4e6eb !important; border-color: #4e4f50 !important; }
.btn-secondary:hover, .management-buttons .btn:hover { background: #4e4f50 !important; }
.btn-primary { background: #4a90e2 !important; border-color: #357ab8 !important; color: white !important; }
.btn-primary:hover { background: #357ab8 !important; }
.btn-danger, .management-buttons .btn-danger { background: #b03a3a !important; border-color: #802929 !important; }
.btn-danger:hover { background: #802929 !important; }
.btn-outline { background: transparent !important; color: #e4e6eb !important; border-color: #4e4f50 !important; }
input, select, textarea {
    background: #1c1d1e !important;
    color: #e4e6eb !important;
    border-color: #4e4f50 !important;
}
.modal { background: rgba(0,0,0,0.7) !important; }
.book-title, .book-authors, .bookshelf-preview h3, .stat-value, .stat-label,
#current-bookshelf-title, .section-title, h1, h2, h3, h4 { color: #e4e6eb !important; }
.no-highlights, .highlight-location, small { color: #b0b3b8 !important; }
hr { border-color: #3a3b3c !important; }
.footer { background: #18191a !important; color: #b0b3b8 !important; }
.footer a { color: #4a90e2 !important; }
`;

export function activate(api, manifest) {
    let enabled = false;
    try { enabled = localStorage.getItem(STORAGE_KEY) !== '0'; } catch (_) { enabled = true; }
    // 初回 ON 起動デフォルト

    function apply() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }
    function unapply() {
        const s = document.getElementById(STYLE_ID);
        if (s) s.remove();
    }

    if (enabled) apply();

    const btn = api.addUIButton({
        id: 'dark-theme-toggle',
        where: 'library-management',
        emoji: enabled ? '🌙' : '☀️',
        label: enabled ? 'ダーク ON' : 'ダーク OFF',
        title: 'ダークテーマの ON/OFF',
        onClick: () => {
            enabled = !enabled;
            try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
            if (enabled) apply(); else unapply();
            if (btn && btn.element) {
                btn.element.textContent = `${enabled ? '🌙' : '☀️'} ダーク ${enabled ? 'ON' : 'OFF'}`;
            }
        }
    });

    return {
        deactivate() {
            unapply();
        }
    };
}
