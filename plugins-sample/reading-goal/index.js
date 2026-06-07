// reading-goal
//
// 年間読書目標と進捗バーをダッシュボード widget に表示。
// 目標値は registerSettings によるプラグイン設定画面で変更でき、
// api.getConfig()/setConfig() で永続化される (userData.settings.pluginConfig)。
// 読了 = ★4以上 かつ 取得日が今年。

const DEFAULT_GOAL = 50;

export function activate(api, manifest) {
    const getGoal = () => {
        const n = Number(api.getConfig().goal);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_GOAL;
    };

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
                <div class="rg-sub">${remaining > 0 ? `残り ${remaining} 冊・月 ${pace} 冊ペース` : '🎉 目標達成'}</div>`;
        }
    });

    // プラグイン設定画面 (設定モーダルの「プラグイン設定」枠に描画される)
    api.registerSettings((host) => {
        host.innerHTML = `
            <label class="rg-set-label">年間目標（冊）
                <input type="number" min="1" max="1000" class="rg-set-goal" value="${getGoal()}">
            </label>
            <button type="button" class="btn btn-small btn-primary rg-set-save">保存</button>
            <span class="rg-set-status"></span>`;
        const input = host.querySelector('.rg-set-goal');
        const status = host.querySelector('.rg-set-status');
        host.querySelector('.rg-set-save').addEventListener('click', async () => {
            const v = Number(input.value);
            if (!Number.isFinite(v) || v <= 0) { status.textContent = '正の数を入力'; return; }
            await api.setConfig({ goal: Math.floor(v) });
            status.textContent = '保存しました';
            api.refreshUI();
        });
    });

    api.injectCSS('reading-goal', `
        .rg-head { font-size: 0.9rem; margin-bottom: 0.4rem; }
        .rg-track { height: 18px; background: var(--line, #eee); border-radius: 9px; overflow: hidden; }
        .rg-fill { height: 100%; background: linear-gradient(90deg, #5b6cff, #2ecc71); transition: width .3s; }
        .rg-sub { font-size: 0.74rem; color: var(--muted, #888); margin-top: 0.35rem; }
        .rg-set-label { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; margin-right: 0.5rem; }
        .rg-set-goal { width: 84px; padding: 0.25rem 0.4rem; border: 1px solid var(--line, #ccc); border-radius: 6px; }
        .rg-set-status { font-size: 0.75rem; color: var(--muted, #888); margin-left: 0.4rem; }
    `);

    return {};
}
