// acquisition-heatmap
//
// acquiredTime を集計し、年×月のグリッドでヒートマップを描く。
// 各セルの濃度はその月の取得冊数に比例。ホバーで件数を表示。

const MODAL_ID = 'plugin-acquisition-heatmap-modal';

export function activate(api, manifest) {
    api.addUIButton({
        id: 'acquisition-heatmap-open',
        where: 'library-management',
        emoji: '🗓️',
        label: '取得ヒートマップ',
        title: '月別取得数のヒートマップ',
        onClick: () => showModal()
    });

    function showModal() {
        let modal = document.getElementById(MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = MODAL_ID;
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 800px;">
                    <button class="modal-close" data-close-heat>×</button>
                    <div class="modal-header"><h2>🗓️ 取得ヒートマップ</h2></div>
                    <div class="modal-body" id="${MODAL_ID}-body"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.hasAttribute('data-close-heat')) {
                    modal.classList.remove('show');
                }
            });
        }
        renderInto(document.getElementById(`${MODAL_ID}-body`));
        modal.classList.add('show');
    }

    function renderInto(body) {
        const books = api.getBooks();
        const yearMonth = new Map(); // 'YYYY-MM' -> count
        let minYear = Infinity, maxYear = -Infinity;
        for (const b of books) {
            const ts = Number(b.acquiredTime);
            if (!Number.isFinite(ts)) continue;
            const d = new Date(ts);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            if (!Number.isFinite(y)) continue;
            const key = `${y}-${String(m).padStart(2, '0')}`;
            yearMonth.set(key, (yearMonth.get(key) || 0) + 1);
            if (y < minYear) minYear = y;
            if (y > maxYear) maxYear = y;
        }

        if (!Number.isFinite(minYear)) {
            body.innerHTML = '<p style="color:#888;">取得日データがありません</p>';
            return;
        }

        const maxCount = Math.max(...yearMonth.values()) || 1;

        let html = `
            <p style="font-size:0.9rem;color:#666;">セルの色が濃いほど取得数が多い月。最大: ${maxCount} 冊/月</p>
            <div style="overflow-x:auto;margin-top:1rem;">
            <table style="border-collapse:separate;border-spacing:3px;font-size:0.8rem;">
                <thead>
                    <tr>
                        <th></th>
                        ${range(1, 12).map(m => `<th style="font-weight:normal;color:#888;padding:0 2px;">${m}月</th>`).join('')}
                        <th style="font-weight:normal;color:#888;padding-left:1em;">合計</th>
                    </tr>
                </thead>
                <tbody>
        `;
        for (let y = maxYear; y >= minYear; y--) {
            let yearTotal = 0;
            html += `<tr><td style="padding-right:6px;color:#888;">${y}</td>`;
            for (let m = 1; m <= 12; m++) {
                const key = `${y}-${String(m).padStart(2, '0')}`;
                const c = yearMonth.get(key) || 0;
                yearTotal += c;
                const intensity = c === 0 ? 0 : 0.15 + (c / maxCount) * 0.85;
                const bg = c === 0 ? '#eee' : `rgba(46, 204, 113, ${intensity.toFixed(2)})`;
                html += `<td title="${y}/${m}: ${c} 冊" style="width:30px;height:24px;background:${bg};border-radius:3px;text-align:center;color:${intensity > 0.5 ? 'white' : '#333'};">${c || ''}</td>`;
            }
            html += `<td style="padding-left:1em;font-weight:600;">${yearTotal}</td></tr>`;
        }
        html += `
                </tbody>
            </table>
            </div>
        `;
        body.innerHTML = html;
    }

    function range(a, b) {
        const arr = [];
        for (let i = a; i <= b; i++) arr.push(i);
        return arr;
    }

    return {
        deactivate() {
            const m = document.getElementById(MODAL_ID);
            if (m) m.remove();
        }
    };
}
