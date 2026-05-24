// memo-templates
//
// 本詳細モーダルが開いたタイミングで、メモ欄 (textarea[data-asin]) の直前に
// テンプレ挿入ボタン群を inject する。クリックでテキストをカーソル位置に挿入し、
// input イベントを発火させて既存の自動保存ロジックに乗せる。

const HOST_CLASS = 'plugin-memo-templates-host';

const TEMPLATES = [
    { label: '感想', text: '\n\n### 感想\n' },
    { label: '要点', text: '\n\n### 要点\n- ' },
    { label: '引用', text: '\n\n> ' },
    { label: 'TODO', text: '\n\n- [ ] ' },
    { label: '日付', text: () => `\n\n[${formatDate(new Date())}] ` }
];

export function activate(api, manifest) {
    api.on('ui:book-modal-opened', onModalOpened);

    function onModalOpened({ asin }) {
        if (!asin) return;
        const modalBody = document.querySelector('#book-modal .modal-body');
        if (!modalBody) return;
        const textarea = modalBody.querySelector(`textarea[data-asin="${cssEscape(asin)}"]`);
        if (!textarea) return;

        // 既存ホストを除去
        modalBody.querySelectorAll(`.${HOST_CLASS}`).forEach(el => el.remove());

        const host = document.createElement('div');
        host.className = HOST_CLASS;
        host.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin:0.4rem 0;';
        TEMPLATES.forEach(t => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-small';
            btn.textContent = `+ ${t.label}`;
            btn.style.cssText = 'padding:2px 8px;font-size:0.8rem;';
            btn.addEventListener('click', () => {
                const text = typeof t.text === 'function' ? t.text() : t.text;
                insertAtCursor(textarea, text);
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
            });
            host.appendChild(btn);
        });

        textarea.parentNode.insertBefore(host, textarea);
    }

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        const before = textarea.value.slice(0, start);
        const after = textarea.value.slice(end);
        textarea.value = before + text + after;
        const pos = start + text.length;
        textarea.selectionStart = textarea.selectionEnd = pos;
    }

    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function cssEscape(s) {
        return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
    }

    return {
        deactivate() {
            document.querySelectorAll(`.${HOST_CLASS}`).forEach(el => el.remove());
        }
    };
}
