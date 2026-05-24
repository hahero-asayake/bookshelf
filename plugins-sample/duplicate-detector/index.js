// duplicate-detector
//
// タイトル + 著者を正規化したキーで蔵書をグルーピングし、複数本ある組を一覧表示する。
// 漫画シリーズ等は除外したいので、巻数表記 (第1巻, (1), Vol.1 等) を含むタイトルは比較対象外。

const MODAL_ID = 'plugin-duplicate-detector-modal';

export function activate(api, manifest) {
    api.addUIButton({
        id: 'duplicate-detector-open',
        where: 'library-management',
        emoji: '🔎',
        label: '重複検出',
        title: '同じタイトル+著者の本を一覧',
        onClick: () => showModal()
    });

    function normalize(s) {
        if (!s) return '';
        return String(s)
            .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
            .replace(/[\s　:;・、。,.!?'"()[\]<>{}!?&*+/\\|~`@#$%^=]/g, '')
            .toLowerCase()
            .trim();
    }

    function hasVolumeMarker(title) {
        if (!title) return false;
        return /第?\d+巻|\(\d+\)|vol\.?\s*\d+|分冊版|（\d+）/i.test(title);
    }

    function findDuplicates() {
        const books = api.getBooks();
        const groups = new Map();
        for (const b of books) {
            if (!b.title) continue;
            if (hasVolumeMarker(b.title)) continue; // シリーズはスキップ
            const authors = Array.isArray(b.authors) ? b.authors.join(',') : (b.authors || '');
            const key = normalize(b.title) + '|' + normalize(authors);
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(b);
        }
        return [...groups.values()].filter(g => g.length > 1);
    }

    function showModal() {
        let modal = document.getElementById(MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = MODAL_ID;
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <button class="modal-close" data-close-dup>×</button>
                    <div class="modal-header"><h2>🔎 重複検出</h2></div>
                    <div class="modal-body" id="${MODAL_ID}-body"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.hasAttribute('data-close-dup')) {
                    modal.classList.remove('show');
                }
            });
        }
        renderInto(document.getElementById(`${MODAL_ID}-body`));
        modal.classList.add('show');
    }

    function renderInto(body) {
        const dups = findDuplicates();
        if (!dups.length) {
            body.innerHTML = '<p style="color:#888;">重複は見つかりませんでした 🎉</p>';
            return;
        }
        body.innerHTML = `
            <p>${dups.length} 組の重複候補が見つかりました。シリーズの巻数違いは除外しています。</p>
            <div style="margin-top:1rem;display:flex;flex-direction:column;gap:1rem;">
                ${dups.map(group => `
                    <div style="border:1px solid #ccc;border-radius:6px;padding:0.8rem;">
                        <h4 style="margin:0 0 0.4rem 0;">${escapeHtml(group[0].title)}</h4>
                        <ul style="margin:0;padding-left:1.2rem;font-size:0.9rem;">
                            ${group.map(b => `
                                <li>
                                    <a href="#book/${encodeURIComponent(b.asin)}" data-close-dup>${escapeHtml(b.asin)}</a>
                                    — ${escapeHtml(Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || ''))}
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>
        `;
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
