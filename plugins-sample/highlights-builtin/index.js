// highlights-builtin
//
// 本詳細モーダルに Kindle ハイライトを表示するプラグイン。
//
// データ配置:
//   同期フォルダ/plugins/highlights-builtin/data/
//     index.json        { "B0XXXXX": "ファイル名.txt", ... }
//     HighlightsASCII/
//       <filename>.txt  Obsidian Kindle Plugin 形式のハイライト Markdown
//
// 表示位置:
//   - bookshelfAPI.on('ui:book-modal-opened', { asin }) でフックし、modal-body に
//     <div class="book-highlights-section"> を append する。

export function activate(api, manifest) {
    const cache = new Map();
    let indexPromise = null;

    async function loadIndex() {
        if (!indexPromise) {
            indexPromise = api.readPluginFile('data/index.json').then(text => {
                if (!text) return {};
                try { return JSON.parse(text); } catch { return {}; }
            }).catch(() => ({}));
        }
        return indexPromise;
    }

    async function loadHighlightsForAsin(asin) {
        if (cache.has(asin)) return cache.get(asin);
        const index = await loadIndex();
        const fileName = index[asin];
        if (!fileName) {
            cache.set(asin, []);
            return [];
        }
        const text = await api.readPluginFile(`data/HighlightsASCII/${fileName}`).catch(() => null);
        if (!text) {
            cache.set(asin, []);
            return [];
        }
        const highlights = parseMarkdownHighlights(text);
        cache.set(asin, highlights);
        return highlights;
    }

    function parseMarkdownHighlights(markdownText) {
        const highlights = [];
        const m = markdownText.match(/## Highlights\s*\n([\s\S]*)/);
        if (!m) return highlights;
        const sections = m[1].split(/\n---\n/);
        for (const raw of sections) {
            const s = raw.trim();
            if (!s.includes('— location:')) continue;
            const loc = s.match(/(.+?)\s*—\s*location:\s*\[(\d+)\]/s);
            if (!loc) continue;
            const text = loc[1].trim();
            if (text.length <= 10) continue;
            highlights.push({ text, location: `Kindle の位置: ${loc[2]}`, note: null });
        }
        return highlights;
    }

    function escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function renderInto(container, highlights) {
        container.textContent = '';
        const header = document.createElement('h3');
        header.textContent = '🎯 ハイライト';
        container.appendChild(header);

        if (!highlights.length) {
            const p = document.createElement('p');
            p.className = 'no-highlights';
            p.textContent = 'この本のハイライトはありません';
            container.appendChild(p);
            return;
        }

        const headRow = document.createElement('div');
        headRow.className = 'highlights-header';
        headRow.innerHTML = `<span class="highlights-count">🎯 ${highlights.length}個のハイライト</span>`;
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-small toggle-highlights';
        toggleBtn.textContent = '全て表示';
        if (highlights.length <= 3) toggleBtn.style.display = 'none';
        headRow.appendChild(toggleBtn);
        container.appendChild(headRow);

        const visible = document.createElement('div');
        visible.className = 'highlights-list visible';
        highlights.slice(0, 3).forEach(h => visible.appendChild(buildItem(h)));
        container.appendChild(visible);

        if (highlights.length > 3) {
            const hidden = document.createElement('div');
            hidden.className = 'highlights-list hidden';
            hidden.style.display = 'none';
            highlights.slice(3).forEach(h => hidden.appendChild(buildItem(h)));
            container.appendChild(hidden);
            toggleBtn.addEventListener('click', () => {
                const isVisible = hidden.style.display !== 'none';
                hidden.style.display = isVisible ? 'none' : 'block';
                toggleBtn.textContent = isVisible ? '全て表示' : '一部のみ表示';
            });
        }
    }

    function buildItem(h) {
        const wrap = document.createElement('div');
        wrap.className = 'highlight-item';
        const text = document.createElement('div');
        text.className = 'highlight-text';
        text.textContent = `"${h.text}"`;
        wrap.appendChild(text);
        if (h.note) {
            const n = document.createElement('div');
            n.className = 'highlight-note';
            n.textContent = `📝 ${h.note}`;
            wrap.appendChild(n);
        }
        if (h.location) {
            const l = document.createElement('div');
            l.className = 'highlight-location';
            l.textContent = h.location;
            wrap.appendChild(l);
        }
        return wrap;
    }

    async function onModalOpened({ asin }) {
        if (!asin) return;
        const modalBody = document.querySelector('#book-modal .modal-body');
        if (!modalBody) return;
        // 重複防止
        let container = modalBody.querySelector('.book-highlights-section');
        if (!container) {
            container = document.createElement('div');
            container.className = 'book-highlights-section';
            modalBody.appendChild(container);
        }
        container.textContent = '';
        const loading = document.createElement('div');
        loading.className = 'highlights-loading';
        loading.textContent = 'ハイライトを読み込み中...';
        container.appendChild(loading);

        try {
            const highlights = await loadHighlightsForAsin(asin);
            renderInto(container, highlights);
        } catch (e) {
            container.textContent = '';
            const err = document.createElement('p');
            err.className = 'no-highlights';
            err.textContent = 'ハイライトの読み込みに失敗しました: ' + (e.message || e);
            container.appendChild(err);
        }
    }

    api.on('ui:book-modal-opened', onModalOpened);

    return {
        deactivate() {
            // モーダル内のハイライトセクションを除去
            const sec = document.querySelector('#book-modal .book-highlights-section');
            if (sec) sec.remove();
            cache.clear();
        }
    };
}
