// quick-switcher
//
// Ctrl/Cmd+K でモーダルを開き、本/本棚をインクリメンタル検索。
// ↑↓ で選択、Enter で開く。Esc で閉じる。

const ROOT_ID = 'plugin-quick-switcher-root';

export function activate(api, manifest) {
    let isOpen = false;
    let items = [];
    let filtered = [];
    let cursor = 0;

    function buildItems() {
        const books = api.getBooks();
        const shelves = api.getBookshelves();
        const out = [];
        for (const s of shelves) {
            if (s.isSpecial) continue;
            out.push({
                type: 'bookshelf',
                key: `${s.id}|${s.name}`,
                label: `${s.emoji || '📚'} ${s.name}`,
                hint: `本棚 — ${(s.books || []).length} 冊`,
                url: `#/bookshelf/${encodeURIComponent(s.id)}`
            });
        }
        for (const b of books) {
            const authors = Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || '');
            out.push({
                type: 'book',
                key: `${b.asin}|${b.title}|${authors}`,
                label: `📖 ${b.title || '(無題)'}`,
                hint: authors,
                url: `#book/${encodeURIComponent(b.asin)}`
            });
        }
        return out;
    }

    function buildRoot() {
        let root = document.getElementById(ROOT_ID);
        if (root) return root;
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0, 0, 0, 0.45);
            display: none;
            align-items: flex-start; justify-content: center;
            z-index: 10000;
            padding-top: 12vh;
            font-family: inherit;
        `;
        root.innerHTML = `
            <div style="width: min(92vw, 600px); background: white; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); overflow: hidden; display: flex; flex-direction: column;">
                <input type="text" placeholder="本・本棚を検索..." data-qs-input
                       style="border: none; outline: none; padding: 14px 18px; font-size: 1rem; border-bottom: 1px solid #eee;">
                <div data-qs-list style="max-height: 60vh; overflow-y: auto; padding: 4px 0;"></div>
            </div>
        `;
        document.body.appendChild(root);
        root.addEventListener('click', (e) => {
            if (e.target === root) close();
        });
        const input = root.querySelector('[data-qs-input]');
        input.addEventListener('input', () => {
            applyFilter(input.value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                cursor = Math.min(filtered.length - 1, cursor + 1);
                renderList();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                cursor = Math.max(0, cursor - 1);
                renderList();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                jump();
            } else if (e.key === 'Escape') {
                close();
            }
        });
        return root;
    }

    function open() {
        const root = buildRoot();
        items = buildItems();
        filtered = items.slice(0, 50);
        cursor = 0;
        root.style.display = 'flex';
        const input = root.querySelector('[data-qs-input]');
        input.value = '';
        renderList();
        setTimeout(() => input.focus(), 0);
        isOpen = true;
    }
    function close() {
        const root = document.getElementById(ROOT_ID);
        if (root) root.style.display = 'none';
        isOpen = false;
    }
    function applyFilter(q) {
        const query = q.toLowerCase().trim();
        if (!query) {
            filtered = items.slice(0, 50);
        } else {
            filtered = items.filter(i => i.key.toLowerCase().includes(query)).slice(0, 50);
        }
        cursor = 0;
        renderList();
    }
    function renderList() {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;
        const list = root.querySelector('[data-qs-list]');
        if (!filtered.length) {
            list.innerHTML = '<div style="padding: 14px 18px; color: #888;">該当なし</div>';
            return;
        }
        list.innerHTML = filtered.map((item, i) => `
            <div data-qs-idx="${i}"
                 style="padding: 8px 18px; cursor: pointer; background: ${i === cursor ? '#e8f0fe' : 'transparent'}; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.label)}</span>
                <span style="color: #888; font-size: 0.85rem; white-space: nowrap;">${escapeHtml(item.hint || '')}</span>
            </div>
        `).join('');
        list.querySelectorAll('[data-qs-idx]').forEach(el => {
            el.addEventListener('click', () => {
                cursor = Number(el.dataset.qsIdx);
                jump();
            });
            el.addEventListener('mouseenter', () => {
                cursor = Number(el.dataset.qsIdx);
                renderList();
            });
        });
        // Scroll active into view
        const active = list.querySelector(`[data-qs-idx="${cursor}"]`);
        if (active) active.scrollIntoView({ block: 'nearest' });
    }
    function jump() {
        const item = filtered[cursor];
        if (!item) return;
        location.hash = item.url;
        close();
    }

    function keydown(e) {
        const isMac = navigator.platform.toLowerCase().includes('mac');
        const cmdKey = isMac ? e.metaKey : e.ctrlKey;
        if (cmdKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (isOpen) close(); else open();
        }
    }
    document.addEventListener('keydown', keydown);

    // ボタンからも開けるように
    api.addUIButton({
        id: 'quick-switcher-open',
        where: 'library-management',
        emoji: '⌘',
        label: 'クイック検索 (Ctrl+K)',
        title: 'Ctrl/Cmd+K でも開けます',
        onClick: () => open()
    });

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s ?? '';
        return d.innerHTML;
    }

    return {
        deactivate() {
            document.removeEventListener('keydown', keydown);
            const root = document.getElementById(ROOT_ID);
            if (root) root.remove();
        }
    };
}
