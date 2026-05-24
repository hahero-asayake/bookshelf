// reading-stats
//
// 蔵書統計をモーダルで表示。
//   - 総蔵書数
//   - 年別取得数 (acquiredTime ベース)
//   - 評価分布 (★1..★5、未評価)
//   - 本棚別冊数 Top 5

const MODAL_ID = 'plugin-reading-stats-modal';

export function activate(api, manifest) {
    const btn = api.addUIButton({
        id: 'reading-stats-open',
        where: 'library-management',
        emoji: '📊',
        label: '読書統計',
        title: '蔵書の統計情報を表示',
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
                    <button class="modal-close" data-close-stats>×</button>
                    <div class="modal-header"><h2>📊 読書統計</h2></div>
                    <div class="modal-body" id="${MODAL_ID}-body"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.hasAttribute('data-close-stats')) {
                    modal.classList.remove('show');
                }
            });
        }
        renderInto(document.getElementById(`${MODAL_ID}-body`));
        modal.classList.add('show');
    }

    function renderInto(body) {
        const books = api.getBooks();
        const notes = api.getNotes();
        const shelves = api.getBookshelves();

        // 年別
        const yearCounts = new Map();
        for (const b of books) {
            if (!b.acquiredTime) continue;
            const ts = Number(b.acquiredTime);
            if (!Number.isFinite(ts)) continue;
            const year = new Date(ts).getFullYear();
            if (!Number.isFinite(year)) continue;
            yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
        }
        const sortedYears = [...yearCounts.entries()].sort((a, b) => a[0] - b[0]);
        const maxYearCount = sortedYears.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

        // 評価分布
        const ratingCounts = [0, 0, 0, 0, 0, 0]; // index 0 = 未評価, 1..5 = 星
        for (const b of books) {
            const r = notes[b.asin]?.rating;
            const idx = Number.isInteger(r) && r >= 1 && r <= 5 ? r : 0;
            ratingCounts[idx]++;
        }
        const maxRating = Math.max(...ratingCounts) || 1;

        // 本棚別冊数 Top 5
        const shelfCounts = shelves
            .filter(s => !s.isSpecial)
            .map(s => ({ name: `${s.emoji || '📚'} ${s.name}`, count: (s.books || []).length }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        body.innerHTML = `
            <p style="font-size: 1.1rem;"><strong>総蔵書数:</strong> ${books.length} 冊</p>
            <hr style="opacity:0.3;margin:1rem 0;">

            <h3>📅 年別取得数</h3>
            <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
                ${sortedYears.map(([y, c]) => `
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="width:50px;text-align:right;font-size:0.85rem;">${y}</span>
                        <div style="flex:1;background:#eee;height:18px;border-radius:3px;overflow:hidden;">
                            <div style="width:${(c / maxYearCount * 100).toFixed(1)}%;height:100%;background:#3498db;"></div>
                        </div>
                        <span style="width:50px;font-size:0.85rem;">${c} 冊</span>
                    </div>
                `).join('') || '<p style="color:#888;">取得日データがありません</p>'}
            </div>

            <h3>⭐ 評価分布</h3>
            <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:1rem;">
                ${[5, 4, 3, 2, 1, 0].map(r => {
                    const c = ratingCounts[r];
                    const label = r === 0 ? '未評価' : '⭐'.repeat(r);
                    return `
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="width:90px;text-align:right;font-size:0.85rem;">${label}</span>
                            <div style="flex:1;background:#eee;height:18px;border-radius:3px;overflow:hidden;">
                                <div style="width:${(c / maxRating * 100).toFixed(1)}%;height:100%;background:#f39c12;"></div>
                            </div>
                            <span style="width:50px;font-size:0.85rem;">${c} 冊</span>
                        </div>
                    `;
                }).join('')}
            </div>

            <h3>📚 本棚別冊数 Top 5</h3>
            ${shelfCounts.length ? `
                <ul style="padding-left:1.2rem;">
                    ${shelfCounts.map(s => `<li>${escapeHtml(s.name)} <strong>${s.count}</strong> 冊</li>`).join('')}
                </ul>
            ` : '<p style="color:#888;">ユーザ作成本棚がありません</p>'}
        `;
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    return {
        deactivate() {
            const m = document.getElementById(MODAL_ID);
            if (m) m.remove();
        }
    };
}
