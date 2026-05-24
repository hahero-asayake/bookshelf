// last-acquired
//
// acquiredTime が直近 N 日以内の本を一覧モーダルで表示。N はモーダル内のセレクタで切替可能。

const MODAL_ID = 'plugin-last-acquired-modal';

export function activate(api, manifest) {
    let days = 30;

    api.addUIButton({
        id: 'last-acquired-open',
        where: 'library-management',
        emoji: '🆕',
        label: '最近追加',
        title: '直近で取得した本',
        onClick: () => showModal()
    });

    function showModal() {
        let modal = document.getElementById(MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = MODAL_ID;
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <button class="modal-close" data-close-recent>×</button>
                    <div class="modal-header"><h2>🆕 最近追加</h2></div>
                    <div class="modal-body">
                        <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;">
                            <label>期間:</label>
                            <select data-range-select>
                                <option value="7">直近7日</option>
                                <option value="30" selected>直近30日</option>
                                <option value="90">直近90日</option>
                                <option value="365">直近1年</option>
                            </select>
                        </div>
                        <div id="${MODAL_ID}-list"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.hasAttribute('data-close-recent')) {
                    modal.classList.remove('show');
                }
            });
            modal.querySelector('[data-range-select]').addEventListener('change', (e) => {
                days = Number(e.target.value) || 30;
                renderList();
            });
        }
        renderList();
        modal.classList.add('show');
    }

    function renderList() {
        const listEl = document.getElementById(`${MODAL_ID}-list`);
        if (!listEl) return;
        const threshold = Date.now() - days * 86400000;
        const books = api.getBooks()
            .filter(b => Number(b.acquiredTime) >= threshold)
            .sort((a, b) => Number(b.acquiredTime) - Number(a.acquiredTime));

        if (!books.length) {
            listEl.innerHTML = '<p style="color:#888;">対象期間に取得した本はありません</p>';
            return;
        }

        listEl.innerHTML = `
            <p style="color:#666;font-size:0.9rem;margin-bottom:0.8rem;">${books.length} 冊</p>
            <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:60vh;overflow-y:auto;">
                ${books.slice(0, 200).map(b => `
                    <a href="#book/${encodeURIComponent(b.asin)}" data-close-recent
                       style="display:flex;gap:0.6rem;padding:0.5rem;border:1px solid #eee;border-radius:4px;text-decoration:none;color:inherit;align-items:center;">
                        <span style="width:90px;color:#888;font-size:0.8rem;">${formatDate(b.acquiredTime)}</span>
                        <div style="flex:1;overflow:hidden;">
                            <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(b.title || '(無題)')}</div>
                            <div style="font-size:0.8rem;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(authorsToString(b.authors))}</div>
                        </div>
                    </a>
                `).join('')}
            </div>
            ${books.length > 200 ? `<p style="color:#888;font-size:0.85rem;margin-top:0.5rem;">…他 ${books.length - 200} 冊</p>` : ''}
        `;
    }

    function authorsToString(a) {
        return Array.isArray(a) ? a.join(', ') : (a || '');
    }
    function formatDate(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n)) return '';
        const d = new Date(n);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s ?? '';
        return d.innerHTML;
    }

    return {
        deactivate() {
            const m = document.getElementById(MODAL_ID);
            if (m) m.remove();
        }
    };
}
