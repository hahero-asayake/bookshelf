// 実行: DevToolsコンソールに貼り付け（node実行しない）
// Amazon「コンテンツと端末の管理」の「本」タブ（digital-console/contentlist/booksAll）で、
// 開発者ツールのコンソールに全文貼り付けて Enter するだけの実測スニペット。
// 目的: GetContentOwnershipData の itemStatusList / contentCategoryReference / originType 相当の
//       実フィールド名・値・件数を、名前を推測せずに確定させる（イシュー#41）。
//
// 実行結果は console に表示され、可能ならクリップボードにもコピーされる。
// 表示・コピーされた文字列をそのままコピーして返してほしい（書誌情報は含まれない）。
// リクエスト間には 300〜500ms のディレイを挟む（同一アカウントへの連打を避けるため）。

(async () => {
    const EXCLUDE_FIELDS = new Set([
        'title', 'authors', 'sortableAuthors', 'sortableTitle', 'asin', 'audibleAsin',
        'orderId', 'contentIdentifier', 'dpURL', 'orderDetailURL', 'productImage'
    ]);

    const out = {
        patterns: {}, bestPattern: null, totalFetched: null, keys: null, fieldSummary: null,
        diffFromActiveOnly: null, categoryDiscovery: null, categoryPatterns: {},
        possiblyNotRetrievableViaThisEndpoint: null, error: null
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const jitterDelay = () => sleep(300 + Math.random() * 200);

    const findCsrfToken = () => {
        if (window.csrfToken) return window.csrfToken;
        for (const s of document.scripts) {
            const m = (s.textContent || '').match(/csrfToken['"]?\s*[:=]\s*['"]([^'"]{8,})['"]/);
            if (m) return m[1];
        }
        const el = document.querySelector('input[name="csrfToken"], meta[name="csrfToken"]');
        return el ? (el.value || el.content || null) : null;
    };

    // ページ上のフィルタ UI (リンク・select) から contentCategoryReference の実値候補を
    // 推測せずに抜き出す。API 呼び出し候補にするのは href パターン由来のみ (高信頼度)。
    // select の option は参考情報として出力するだけに留める。
    const discoverCategoryCandidates = () => {
        const fromLinks = new Set();
        document.querySelectorAll('a[href]').forEach((a) => {
            const m = (a.getAttribute('href') || '').match(/contentlist\/([a-zA-Z0-9_]+)/);
            if (m && m[1] !== 'booksAll') fromLinks.add(m[1]);
        });
        const fromSelectOptions = new Set();
        document.querySelectorAll('select option[value]').forEach((o) => {
            const v = (o.getAttribute('value') || '').trim();
            if (v && v.length <= 40) fromSelectOptions.add(v);
        });
        const fromScripts = new Set();
        document.querySelectorAll('script').forEach((s) => {
            const text = s.textContent || '';
            const re = /contentCategoryReference["']?\s*[:=]\s*["']([a-zA-Z0-9_]+)["']/g;
            let m;
            while ((m = re.exec(text))) fromScripts.add(m[1]);
        });
        return {
            linkCandidates: Array.from(fromLinks).slice(0, 20),
            selectOptions: Array.from(fromSelectOptions).slice(0, 40),
            scriptCandidates: Array.from(fromScripts)
        };
    };

    try {
        const csrfToken = findCsrfToken();
        if (!csrfToken) {
            throw new Error('csrfToken が見つかりません。Amazon の「コンテンツと端末の管理 > 本」ページで実行してください。');
        }

        const fetchPage = async (activityInput, startIndex) => {
            await jitterDelay();
            const body = JSON.stringify({
                ...activityInput,
                fetchCriteria: {
                    sortOrder: 'DESCENDING',
                    sortIndex: 'DATE',
                    startIndex,
                    batchSize: 100,
                    totalContentCount: -1
                }
            });
            const res = await fetch('https://www.amazon.co.jp/hz/mycd/digital-console/ajax', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ activity: 'GetContentOwnershipData', activityInput: body, csrfToken })
            });
            const json = await res.json();
            if (json.hasOwnProperty('success') && !json['success']) {
                throw new Error(JSON.stringify(json['error']));
            }
            return json['GetContentOwnershipData'];
        };

        const base = {
            contentType: 'Ebook',
            contentCategoryReference: 'booksAll',
            showSharedContent: true,
            surfaceType: 'Desktop'
        };

        // 他OSS実装（Xetera/kindle-api, treetrum/amazon-kindle-bulk-downloader, 各種 gist,
        // 元exporter YujiSoftware/kindle_bookshelf_exporter）を机上調査した限り、
        // itemStatusList に "Active" 以外を使う実例は見つからなかった。
        // 以下の値は「あり得そうな綴り」の候補であって実装候補ではない。
        const candidateStatuses = ['Expired', 'Deprecated', 'Terminated', 'Returned', 'Revoked', 'Removed', 'Inactive', 'NotOwned', 'Cancelled'];

        const patterns = {
            activeOnly: { ...base, itemStatusList: ['Active'] },
            // 指定なし＝実装候補ではない。全件母集団を観測するためだけのパターン
            noStatusFilter: { ...base },
            activePlusAllCandidates: { ...base, itemStatusList: ['Active', ...candidateStatuses] }
        };
        candidateStatuses.forEach((s) => {
            patterns['status_' + s] = { ...base, itemStatusList: [s] };
        });

        for (const [name, input] of Object.entries(patterns)) {
            try {
                const data = await fetchPage(input, 0);
                out.patterns[name] = { numberOfItems: data.numberOfItems, sampleCount: data.items.length };
            } catch (e) {
                out.patterns[name] = { error: (e && e.message) || String(e) };
            }
        }

        // contentCategoryReference 軸: booksAll 以外に「利用終了」が別カテゴリで
        // 持たれている可能性を潰す。DOM 由来の候補ごとに Active 指定で件数だけ見る
        // (itemStatusList 12パターンをカテゴリ数だけ掛け合わせると連打になるため、
        //  ここでは母集団規模の把握に留める)。
        const discovery = discoverCategoryCandidates();
        out.categoryDiscovery = discovery;
        for (const cat of discovery.linkCandidates) {
            try {
                const data = await fetchPage({ ...base, contentCategoryReference: cat, itemStatusList: ['Active'] }, 0);
                out.categoryPatterns[cat] = { numberOfItems: data.numberOfItems };
            } catch (e) {
                out.categoryPatterns[cat] = { error: (e && e.message) || String(e) };
            }
        }

        const ranked = Object.entries(out.patterns)
            .filter(([, v]) => typeof v.numberOfItems === 'number')
            .sort((a, b) => b[1].numberOfItems - a[1].numberOfItems);
        if (ranked.length === 0) {
            throw new Error('全パターンが失敗しました。out.patterns を確認してください。');
        }
        const [bestName] = ranked[0];
        out.bestPattern = bestName;

        // 判定: itemStatusList 軸・contentCategoryReference 軸のどちらでも
        // activeOnly (booksAll) を超える件数が一度も出なかった場合、
        // このエンドポイント/カテゴリでは「利用終了」本を取得できない可能性が高い。
        const activeOnlyCount = out.patterns.activeOnly && typeof out.patterns.activeOnly.numberOfItems === 'number'
            ? out.patterns.activeOnly.numberOfItems : 0;
        const maxStatusCount = Math.max(activeOnlyCount, ...Object.values(out.patterns)
            .map((v) => (typeof v.numberOfItems === 'number' ? v.numberOfItems : 0)));
        const maxCategoryCount = Math.max(0, ...Object.values(out.categoryPatterns)
            .map((v) => (typeof v.numberOfItems === 'number' ? v.numberOfItems : 0)));
        out.possiblyNotRetrievableViaThisEndpoint = maxStatusCount <= activeOnlyCount && maxCategoryCount <= activeOnlyCount;

        const fetchAll = async (input, total) => {
            let items = [];
            let startIndex = 0;
            while (items.length < total) {
                const data = await fetchPage(input, startIndex);
                if (!data.items || data.items.length === 0) break; // 安全弁
                items = items.concat(data.items);
                startIndex += 100;
            }
            return items;
        };

        const bestItems = await fetchAll(patterns[bestName], out.patterns[bestName].numberOfItems);
        out.totalFetched = bestItems.length;

        const keySet = new Set();
        bestItems.forEach((it) => Object.keys(it).forEach((k) => keySet.add(k)));
        out.keys = Array.from(keySet).sort();

        const fieldValues = {};
        bestItems.forEach((it) => {
            out.keys.forEach((k) => {
                if (EXCLUDE_FIELDS.has(k)) return;
                const v = it[k];
                if (v === undefined) return;
                if (typeof v === 'object') return; // 配列・ネストは自動集計から除外(キー一覧には残る)
                if (!fieldValues[k]) fieldValues[k] = new Map();
                const vs = String(v);
                fieldValues[k].set(vs, (fieldValues[k].get(vs) || 0) + 1);
            });
        });
        out.fieldSummary = {};
        Object.entries(fieldValues).forEach(([k, m]) => {
            if (m.size <= 12) {
                out.fieldSummary[k] = Object.fromEntries(m);
            }
        });

        // Active-only との ASIN 差分（bestPattern が activeOnly ならゼロ）
        const activeItems = bestName === 'activeOnly'
            ? bestItems
            : await fetchAll(patterns.activeOnly, out.patterns.activeOnly.numberOfItems || 0);
        const activeAsins = new Set(activeItems.map((it) => it.asin));
        const bestAsins = new Set(bestItems.map((it) => it.asin));
        let diff = 0;
        bestAsins.forEach((a) => { if (!activeAsins.has(a)) diff++; });
        out.diffFromActiveOnly = diff;
    } catch (e) {
        out.error = (e && e.message) || String(e);
    }

    const json = JSON.stringify(out);
    console.log(json);
    try {
        await navigator.clipboard.writeText(json);
        console.log('%c↑ クリップボードにコピーしました。この文字列をそのまま貼り返してください。', 'color: green; font-weight: bold;');
    } catch (e) {
        console.log('クリップボードへの自動コピーに失敗しました。↑ の1行を選択してコピーし、貼り返してください。');
    }
})();
