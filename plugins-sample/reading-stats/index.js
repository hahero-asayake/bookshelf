// reading-stats
//
// 蔵書統計をダッシュボード widget として表示する。
// 旧版は独自モーダル (.modal/.show) を使っていたが、現行はホームの
// ダッシュボードに registerWidget で正式に並ぶ。
//   - 総蔵書数 / 年別取得数 / 評価分布 / 本棚別 Top5

export function activate(api, manifest) {
    api.registerWidget({
        id: 'reading-stats',
        label: '読書統計',
        icon: 'bar-chart-3',
        defaultSpan: 6,
        allowedSpans: [4, 6, 8, 12],
        render(host) {
            const books = api.getBooks();
            const notes = api.getNotes();
            const shelves = api.getBookshelves();

            // 年別取得
            const yearCounts = new Map();
            for (const b of books) {
                const ts = Number(b.acquiredTime);
                if (!Number.isFinite(ts)) continue;
                const y = new Date(ts).getFullYear();
                if (Number.isFinite(y)) yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
            }
            const years = [...yearCounts.entries()].sort((a, b) => a[0] - b[0]);
            const maxYear = years.reduce((m, [, v]) => Math.max(m, v), 0) || 1;

            // 評価分布 (0=未評価)
            const ratings = [0, 0, 0, 0, 0, 0];
            for (const b of books) {
                const r = notes[b.asin]?.rating;
                ratings[(Number.isInteger(r) && r >= 1 && r <= 5) ? r : 0]++;
            }
            const maxRating = Math.max(...ratings) || 1;

            // 本棚別 Top5
            const shelfTop = shelves.filter(s => !s.isSpecial)
                .map(s => ({ name: s.name, count: (s.books || []).length }))
                .sort((a, b) => b.count - a.count).slice(0, 5);

            const bar = (w, cls) => `<div class="rs-track"><div class="rs-fill ${cls}" style="width:${w}%"></div></div>`;
            host.innerHTML = `
                <div class="rs-total">蔵書 <strong>${books.length}</strong> 冊</div>
                <div class="rs-block">
                    <div class="rs-h">年別取得</div>
                    ${years.length ? years.map(([y, c]) => `
                        <div class="rs-row"><span class="rs-k">${y}</span>${bar((c / maxYear * 100).toFixed(1), 'rs-y')}<span class="rs-v">${c}</span></div>
                    `).join('') : '<div class="rs-empty">取得日データなし</div>'}
                </div>
                <div class="rs-block">
                    <div class="rs-h">評価分布</div>
                    ${[5, 4, 3, 2, 1, 0].map(r => `
                        <div class="rs-row"><span class="rs-k">${r === 0 ? '未評価' : '★' + r}</span>${bar((ratings[r] / maxRating * 100).toFixed(1), 'rs-r')}<span class="rs-v">${ratings[r]}</span></div>
                    `).join('')}
                </div>
                <div class="rs-block">
                    <div class="rs-h">本棚別 Top5</div>
                    ${shelfTop.length ? `<ul class="rs-shelves">${shelfTop.map(s =>
                        `<li><span>${escapeHtml(s.name)}</span><strong>${s.count}</strong></li>`).join('')}</ul>`
                        : '<div class="rs-empty">ユーザ本棚なし</div>'}
                </div>
            `;
        }
    });

    api.injectCSS('reading-stats', `
        .rs-total { font-size: 1rem; margin-bottom: 0.5rem; }
        .rs-block { margin-bottom: 0.6rem; }
        .rs-h { font-size: 0.72rem; color: var(--muted, #888); margin-bottom: 0.25rem; }
        .rs-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
        .rs-k { width: 44px; font-size: 0.72rem; text-align: right; flex: 0 0 auto; }
        .rs-v { width: 34px; font-size: 0.72rem; flex: 0 0 auto; }
        .rs-track { flex: 1; height: 14px; background: var(--line, #eee); border-radius: 3px; overflow: hidden; }
        .rs-fill { height: 100%; }
        .rs-fill.rs-y { background: #4a90e2; }
        .rs-fill.rs-r { background: #f5a623; }
        .rs-shelves { list-style: none; margin: 0; padding: 0; }
        .rs-shelves li { display: flex; justify-content: space-between; font-size: 0.78rem; padding: 1px 0; }
        .rs-empty { font-size: 0.74rem; color: var(--muted, #888); }
    `);

    return {};
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
