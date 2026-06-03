// reading-goal
//
// 年間読書目標と進捗をダッシュボード widget に表示する。
// 旧版は独自モーダルだったが、現行はホームに registerWidget で並ぶ。
// 読了 = ★4以上 かつ 取得日が今年。目標値は localStorage 保存 (widget内で変更可)。

const STORAGE_KEY = 'plugin-reading-goal:value';
const DEFAULT_GOAL = 50;

export function activate(api, manifest) {
    const getGoal = () => {
        const n = Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_GOAL;
    };
    const setGoal = (n) => { try { localStorage.setItem(STORAGE_KEY, String(Math.floor(n))); } catch (_) {} };

    const yearReads = () => {
        const year = new Date().getFullYear();
        const notes = api.getNotes();
        let c = 0;
        for (const b of api.getBooks()) {
            const n = notes[b.asin];
            if (!n || !Number.isInteger(n.rating) || n.rating < 4) continue;
            const ts = Number(b.acquiredTime);
            if (Number.isFinite(ts) && new Date(ts).getFullYear() === year) c++;
        }
        return c;
    };

    api.registerWidget({
        id: 'reading-goal',
        label: '年間読書目標',
        icon: 'target',
        defaultSpan: 4,
        allowedSpans: [3, 4, 6],
        render(host) {
            const goal = getGoal();
            const reads = yearReads();
            const year = new Date().getFullYear();
            const pct = Math.min(100, (reads / goal) * 100);
            const remaining = Math.max(0, goal - reads);
            const monthsLeft = 12 - new Date().getMonth();
            const pace = monthsLeft > 0 ? (remaining / monthsLeft).toFixed(1) : '0';

            host.innerHTML = `
                <div class="rg-head">${year} 年 <strong>${reads}</strong> / ${goal} 冊</div>
                <div class="rg-track"><div class="rg-fill" style="width:${pct.toFixed(1)}%"></div></div>
                <div class="rg-sub">${remaining > 0
                    ? `残り ${remaining} 冊・月 ${pace} 冊ペース`
                    : '🎉 目標達成'}</div>
                <button type="button" class="rg-edit">目標を変更</button>
            `;
            host.querySelector('.rg-edit').addEventListener('click', () => {
                const v = prompt('年間目標 (冊):', String(goal));
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) { setGoal(n); api.refreshUI(); }
            });
        }
    });

    api.injectCSS('reading-goal', `
        .rg-head { font-size: 0.9rem; margin-bottom: 0.4rem; }
        .rg-track { height: 18px; background: var(--line, #eee); border-radius: 9px; overflow: hidden; }
        .rg-fill { height: 100%; background: linear-gradient(90deg, #5b6cff, #2ecc71); transition: width .3s; }
        .rg-sub { font-size: 0.74rem; color: var(--muted, #888); margin-top: 0.35rem; }
        .rg-edit { margin-top: 0.4rem; font-size: 0.72rem; background: none; border: none; padding: 0;
            color: var(--accent, #5b6cff); cursor: pointer; }
    `);

    return {};
}
