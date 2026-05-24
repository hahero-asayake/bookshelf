// unrated-list
//
// 未評価本だけを一覧モーダルで表示。各行にクイック評価ボタン (1〜5★)。
// クリックで api.updateNote を呼び、即保存。

const MODAL_ID = 'plugin-unrated-list-modal';

export function activate(api, manifest) {
    api.addUIButton({
        id: 'unrated-list-open',
        where: 'library-management',
        emoji: '🌟',
        label: '未評価リスト',
        title: '評価が未設定の本を一覧',
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
                    <button class="modal-close" data-close-unrated>×</button>
                    <div class="modal-header"><h2>🌟 未評価リスト</h2></div>
                    <div class="modal-body" id="${MODAL_ID}-body"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.hasAttribute('data-close-unrated')) {
                    modal.classList.remove('show');
                }
            });
            modal.addEventListener('click', async (e) => {
                const star = e.target.closest('[data-rate-asin]');
                if (!star) return;
                const asin = star.dataset.rateAsin;
                const rating = Number(star.dataset.rateValue);
                try {
                    await api.updateNote(asin, { rating });
                    // 行を fade-out して再 render
                    const row = star.closest('[data-row-asin]');
                    if (row) {
                        row.style.transition = 'opacity 0.3s';
                        row.style.opacity = '0';
                        setTimeout(() => render(document.getElementById(`${MODAL_ID}-body`)), 320);
                    }
                } catch (err) {
                    alert('評価保存失敗: ' + (err.message || err));
                }
            });
        }
        render(document.getElementById(`${MODAL_ID}-body`));
        modal.classList.add('show');
    }

    function render(body) {
        const books = api.getBooks();
        const notes = api.getNotes();
        const unrated = books.filter(b => {
            const r = notes[b.asin]?.rating;
            return !(Number.isInteger(r) && r >= 1 && r <= 5);
        });

        if (!unrated.length) {
            body.innerHTML = '<p style="color:#888;">全ての本に評価がついています 🎉</p>';
            return;
        }

        body.innerHTML = `
            <p style="color:#666;">未評価の本 ${unrated.length} 冊。星ボタンをクリックでその場で評価。</p>
            <div style="display:flex;flex-direction:column;gap:0.4rem;margin-top:1rem;max-height:60vh;overflow-y:auto;">
                ${unrated.slice(0, 200).map(b => `
                    <div data-row-asin="${escapeAttr(b.asin)}"
                         style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem;border:1px solid #eee;border-radius:4px;">
                        <a href="#book/${encodeURIComponent(b.asin)}" data-close-unrated
                           style="flex:1;text-decoration:none;color:inherit;overflow:hidden;">
                            <div style="font-weight:500;">${escapeHtml(b.title || '(無題)')}</div>
                            <div style="font-size:0.8rem;color:#888;">${escapeHtml(authorsToString(b.authors))}</div>
                        </a>
                        <div style="display:flex;gap:2px;">
                            ${[1, 2, 3, 4, 5].map(n => `
                                <button data-rate-asin="${escapeAttr(b.asin)}" data-rate-value="${n}"
                                        style="background:none;border:none;cursor:pointer;font-size:1.2rem;padding:2px;line-height:1;"
                                        title="${n}★">⭐</button>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
            ${unrated.length > 200 ? `<p style="color:#888;font-size:0.85rem;margin-top:0.5rem;">…他 ${unrated.length - 200} 冊（最初の 200 件のみ表示）</p>` : ''}
        `;
    }

    function authorsToString(a) {
        return Array.isArray(a) ? a.join(', ') : (a || '');
    }
    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s ?? '';
        return d.innerHTML;
    }
    function escapeAttr(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    return {
        deactivate() {
            const m = document.getElementById(MODAL_ID);
            if (m) m.remove();
        }
    };
}
