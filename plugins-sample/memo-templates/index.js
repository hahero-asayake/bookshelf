// memo-templates
//
// 本詳細ペインのメモ欄にテンプレ挿入ボタンを足す。
// 旧版は ui:book-modal-opened + #book-modal の textarea を直接触っていたが、
// 現行は registerDetailSection でペインにボタン群を差し込み、メモ textarea
// (.bd-textarea) のカーソル位置に挿入 → input イベントで既存の自動保存に乗せる。

const TEMPLATES = [
    { label: '感想', text: '\n\n### 感想\n' },
    { label: '要点', text: '\n\n### 要点\n- ' },
    { label: '引用', text: '\n\n> ' },
    { label: 'TODO', text: '\n\n- [ ] ' },
    { label: '日付', text: () => `\n\n[${ymd(new Date())}] ` }
];

export function activate(api, manifest) {
    api.registerDetailSection({
        id: 'memo-templates',
        render(host, book) {
            host.innerHTML = `<div class="mt-row"></div>`;
            const row = host.querySelector('.mt-row');
            TEMPLATES.forEach(t => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mt-btn';
                btn.textContent = `+ ${t.label}`;
                btn.addEventListener('click', () => {
                    const ta = pickTextarea(book && book.asin);
                    if (!ta) return;
                    insertAtCursor(ta, typeof t.text === 'function' ? t.text() : t.text);
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.focus();
                });
                row.appendChild(btn);
            });
        }
    });

    // 直近フォーカスされた bd-textarea を優先。無ければ ALL スコープ。
    function pickTextarea(asin) {
        const pane = document.getElementById('book-detail-pane');
        if (!pane) return null;
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('bd-textarea') && pane.contains(active)) return active;
        return pane.querySelector('textarea.bd-textarea[data-scope="all"]') || pane.querySelector('textarea.bd-textarea');
    }

    function insertAtCursor(ta, text) {
        const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + text.length;
    }

    api.injectCSS('memo-templates', `
        .plugin-detail-section .mt-row { display: flex; gap: 4px; flex-wrap: wrap; }
        .plugin-detail-section .mt-btn {
            font-size: 0.74rem; padding: 2px 9px; border: 1px solid var(--line, #e5e7eb);
            border-radius: 6px; background: var(--surface, #fff); color: inherit; cursor: pointer;
        }
        .plugin-detail-section .mt-btn:hover { border-color: var(--accent, #5b6cff); color: var(--accent, #5b6cff); }
    `);

    return {};
}

function ymd(d) {
    const m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}
