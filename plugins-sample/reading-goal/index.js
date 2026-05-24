// reading-goal
//
// 年間読書目標。★4以上を付けた本 (今年度) を「読了」とみなしてカウント、目標値との進捗をモーダル表示。
// 目標値は localStorage('plugin-reading-goal:value') に保存。

const STORAGE_KEY = 'plugin-reading-goal:value';
const MODAL_ID = 'plugin-reading-goal-modal';
const DEFAULT_GOAL = 50;

export function activate(api, manifest) {
    api.addUIButton({
        id: 'reading-goal-open',
        where: 'library-management',
        emoji: '🎯',
        label: '読書目標',
        title: '年間読書目標と進捗',
        onClick: () => showModal()
    });

    function getGoal() {
        const raw = localStorage.getItem(STORAGE_KEY);
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_GOAL;
    }
    function setGoal(n) {
        try { localStorage.setItem(STORAGE_KEY, String(n)); } catch (_) {}
    }

    function thisYearReadCount() {
        const year = new Date().getFullYear();
        const notes = api.getNotes();
        const books = api.getBooks();
        let count = 0;
        for (const b of books) {
            const n = notes[b.asin];
            if (!n || !Number.isInteger(n.rating) || n.rating < 4) continue;
            // 「今年に評価が付いた本」を読了とみなす。timestamp が無いので acquiredTime で代替
            const ts = Number(b.acquiredTime);
            if (Number.isFinite(ts) && new Date(ts).getFullYear() === year) count++;
        }
        return count;
    }

    function totalReadCount() {
        const notes = api.getNotes();
        return Object.values(notes).filter(n => Number.isInteger(n?.rating) && n.rating >= 4).length;
    }

    function showModal() {
        let modal = document.getElementById(MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = MODAL_ID;
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <button class="modal-close" data-close-goal>×</button>
                    <div class="modal-header"><h2>🎯 年間読書目標</h2></div>
                    <div class="modal-body" id="${MODAL_ID}-body"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.hasAttribute('data-close-goal')) {
                    modal.classList.remove('show');
                }
            });
        }
        render(document.getElementById(`${MODAL_ID}-body`));
        modal.classList.add('show');
    }

    function render(body) {
        const goal = getGoal();
        const yearReads = thisYearReadCount();
        const allReads = totalReadCount();
        const year = new Date().getFullYear();
        const progress = Math.min(100, (yearReads / goal) * 100);
        const remaining = Math.max(0, goal - yearReads);
        const monthsLeft = 12 - new Date().getMonth();
        const pace = monthsLeft > 0 ? (remaining / monthsLeft).toFixed(1) : '0';

        body.innerHTML = `
            <p style="font-size:1.1rem;"><strong>${year} 年の進捗</strong></p>
            <div style="background:#eee;height:24px;border-radius:12px;overflow:hidden;margin:0.8rem 0;">
                <div style="width:${progress.toFixed(1)}%;height:100%;background:linear-gradient(90deg,#3498db,#2ecc71);transition:width 0.3s;"></div>
            </div>
            <p>${yearReads} / ${goal} 冊 (${progress.toFixed(1)}%)</p>
            ${remaining > 0 ? `<p style="color:#666;">残り ${remaining} 冊。${monthsLeft} ヶ月で達成するには月 ${pace} 冊ペース。</p>` : '<p style="color:#27ae60;">🎉 目標達成！</p>'}

            <hr style="opacity:0.3;margin:1.5rem 0;">

            <p style="color:#666;font-size:0.85rem;">読了の判定: ★4 以上を付けた本 (取得日が今年のもの)</p>
            <p style="color:#666;font-size:0.85rem;">累計読了 (全期間): ${allReads} 冊</p>

            <div style="margin-top:1.5rem;display:flex;gap:0.5rem;align-items:center;">
                <label>目標値:</label>
                <input type="number" id="${MODAL_ID}-goal-input" value="${goal}" min="1" max="1000"
                       style="width:80px;padding:0.3rem;border:1px solid #ccc;border-radius:4px;">
                <button id="${MODAL_ID}-save-btn" class="btn btn-primary btn-small">保存</button>
            </div>
        `;

        const input = document.getElementById(`${MODAL_ID}-goal-input`);
        const btn = document.getElementById(`${MODAL_ID}-save-btn`);
        btn.addEventListener('click', () => {
            const v = Number(input.value);
            if (Number.isFinite(v) && v > 0) {
                setGoal(Math.floor(v));
                render(body);
            }
        });
    }

    return {
        deactivate() {
            const m = document.getElementById(MODAL_ID);
            if (m) m.remove();
        }
    };
}
