// イシュー#453 step1: 本の詳細 .bd-meta-edit (入れ子編集) の現状・案A・案B を実アプリの JS で撮る。
// #435 の 435-shot-settings-v2.mjs と同じ型 (fixtureでログイン→実アプリJSを動かす→CSS/evaluateで仮実装を当てる)。
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8153';
const SHOT_DIR = 'tmp/453';
mkdirSync(SHOT_DIR, { recursive: true });

const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const ASIN = 'B000000001';

async function newLoggedInPage(ctx) {
    const page = await ctx.newPage();
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        adapter.readText = async (path) => (mem.has(path) ? mem.get(path) : null);
        adapter.writeText = async (path, text) => { mem.set(path, text); };
        window.bookshelf._isSyncReady = () => true;
    });
    return page;
}

async function openBookEdit(page) {
    await page.evaluate((asin) => {
        const book = window.bookshelf.books.find(b => b.asin === asin);
        window.bookshelf.showBookDetail(book, true);
    }, ASIN);
    await page.waitForTimeout(150);
}

// 案A: インライン化。<details> を外し、メタ編集フィールドを基本情報セクション内に常時表示。
// 専用の保存/キャンセルは消し、保存は topbar の編集終了ボタン(チェック)1つに統合する。
async function applyPlanA(page) {
    await page.evaluate(() => {
        const details = document.querySelector('.bd-meta-edit');
        if (!details) return;
        const body = details.querySelector('.bd-meta-edit-body');
        const actions = body.querySelector('.bd-meta-edit-actions');
        actions.remove(); // 専用保存/キャンセルを削除
        // <details><summary> を外し中身をそのまま親に展開(常時表示)
        const parent = details.parentElement;
        parent.insertBefore(body, details);
        details.remove();
        body.classList.add('bd-meta-edit-inline-a');
        // topbar の編集終了(チェック)ボタンに保存処理を差し込む(既存ハンドラより先に実行)
        const toggle = document.querySelector('.bd-edit-toggle.cancel-edit-btn');
        if (toggle && !toggle._planAWired) {
            toggle._planAWired = true;
            toggle.addEventListener('click', () => { window.bookshelf.saveBookChanges(toggle.dataset.asin); }, { capture: true });
        }
    });
    await page.waitForTimeout(100);
}

// 案B: 項目ごとのその場編集。<details> ごと撤去し、bd-meta-row の各値をクリックで
// インライン input に変え、blur/Enter で即時に該当フィールドだけ保存する(全体の保存ボタンは無い)。
async function applyPlanB(page) {
    await page.evaluate((asin) => {
        document.querySelector('.bd-meta-edit')?.remove(); // 折りたたみ自体を撤去
        const bd = window.bookshelf.books.find(b => b.asin === asin);
        const rows = [
            { key: 'acquired', label: '購入', type: 'date', value: new Date(bd.acquiredTime).toISOString().split('T')[0] },
            { key: 'title', label: 'タイトル', type: 'text', value: bd.title },
            { key: 'authors', label: '著者', type: 'text', value: bd.authors },
            { key: 'asin', label: 'ASIN', type: 'text', value: bd.asin },
        ];
        const metaBox = document.querySelector('.bd-meta');
        metaBox.innerHTML = rows.map(r => `
            <div class="bd-meta-row bd-meta-row-b" data-field="${r.key}">
                <span class="k">${r.label}</span>
                <span class="bd-meta-value-b" data-field="${r.key}" tabindex="0" title="クリックして編集">${r.value}</span>
            </div>`).join('');
        metaBox.querySelectorAll('.bd-meta-value-b').forEach(span => {
            const startEdit = () => {
                if (span.querySelector('input')) return;
                const field = span.dataset.field;
                const row = rows.find(r => r.key === field);
                const input = document.createElement('input');
                input.type = row.type;
                input.value = row.type === 'date' ? row.value : span.textContent.trim();
                input.className = 'bd-meta-inline-input';
                span.textContent = '';
                span.appendChild(input);
                input.focus();
                const commit = () => {
                    span.textContent = input.value || row.value;
                    // 実保存はフィールドごとに window.bookshelf.saveBookChanges相当を簡略実装(検証用)
                };
                input.addEventListener('blur', commit, { once: true });
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
            };
            span.addEventListener('click', startEdit);
            span.addEventListener('keydown', (e) => { if (e.key === 'Enter') startEdit(); });
        });
    }, ASIN);
    await page.waitForTimeout(100);
}

async function inspect(page) {
    return page.evaluate(() => {
        const pane = document.getElementById('book-detail-pane');
        const paneRect = pane.getBoundingClientRect();
        const leaks = [];
        const overlaps = [];
        const clipped = [];
        const nodes = [...pane.querySelectorAll('*')];
        nodes.forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            if (r.right > window.innerWidth + 1 || r.left < -1) {
                leaks.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), left: Math.round(r.left), right: Math.round(r.right) });
            }
        });
        // 兄弟同士の重なり検出(同じ親の直接の子同士で矩形が重なっていないか・ざっくり)
        pane.querySelectorAll('.bd-meta, .bd-meta-edit, .bd-meta-edit-inline-a, .bd-meta-row-b, .bd-meta-edit-actions').forEach(container => {
            const kids = [...container.children].filter(k => {
                const r = k.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            for (let i = 0; i < kids.length; i++) {
                for (let j = i + 1; j < kids.length; j++) {
                    const a = kids[i].getBoundingClientRect();
                    const b = kids[j].getBoundingClientRect();
                    const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
                    const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                    if (overlapX > 2 && overlapY > 2) {
                        overlaps.push({ a: kids[i].className?.toString().slice(0, 30), b: kids[j].className?.toString().slice(0, 30) });
                    }
                }
            }
        });
        // 欠け: scrollWidth > clientWidth (横に切れている要素)
        nodes.forEach(el => {
            if (el.scrollWidth - el.clientWidth > 4) {
                const cs = getComputedStyle(el);
                if (['hidden', 'clip'].includes(cs.overflowX)) {
                    clipped.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40) });
                }
            }
        });
        return { leakCount: leaks.length, leaks: leaks.slice(0, 5), overlapCount: overlaps.length, overlaps: overlaps.slice(0, 5), clippedCount: clipped.length, paneRect: { w: Math.round(paneRect.width), h: Math.round(paneRect.height) } };
    });
}

// 390でキーボードが開いた状態を近似: viewport高さを縮める(iOS Safari実測で概ね40-45%占有)。
// 保存ボタン(または案Bは無いので編集終了ボタン)が縮小後のviewport内に見えるかを機械判定する。
async function checkKeyboardOverlap(page, selector) {
    const before = await page.viewportSize();
    await page.setViewportSize({ width: before.width, height: Math.round(before.height * 0.55) }); // キーボード相当45%を差し引く近似
    await page.waitForTimeout(100);
    const visible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && r.height > 0;
    }, selector);
    await page.setViewportSize(before);
    await page.waitForTimeout(100);
    return visible;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const results = {};

// --- 現状 ---
for (const [label, viewport] of [['current-pc', { width: 1920, height: 1080 }], ['current-390', { width: 390, height: 844 }]]) {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize(viewport);
    await openBookEdit(page);
    const m = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, `453-${label}.png`) });
    if (label === 'current-390') {
        // detailsを開いてから保存ボタンが見えるかを見る(入れ子展開後)
        await page.click('.bd-meta-edit summary');
        await page.waitForTimeout(150);
        await page.screenshot({ path: join(SHOT_DIR, `453-current-390-expanded.png`) });
        m.kbSaveVisible = await checkKeyboardOverlap(page, '.save-book-changes');
    }
    console.log('→', label, JSON.stringify(m));
    results[label] = m;
    await page.close();
}

// --- 案A ---
for (const [label, viewport] of [['planA-pc', { width: 1920, height: 1080 }], ['planA-390', { width: 390, height: 844 }]]) {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize(viewport);
    await openBookEdit(page);
    await applyPlanA(page);
    const m = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, `453-${label}.png`) });
    if (label === 'planA-390') {
        m.kbSaveVisible = await checkKeyboardOverlap(page, '.bd-edit-toggle.cancel-edit-btn');
    }
    console.log('→', label, JSON.stringify(m));
    results[label] = m;
    await page.close();
}

// --- 案B ---
for (const [label, viewport] of [['planB-pc', { width: 1920, height: 1080 }], ['planB-390', { width: 390, height: 844 }]]) {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize(viewport);
    await openBookEdit(page);
    await applyPlanB(page);
    const m = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, `453-${label}.png`) });
    if (label === 'planB-390') {
        // 案Bはフィールドをクリックしてinput表示にした状態で保存操作自体が無い(blurで即時反映)ため
        // 「保存ボタン」に相当するものが無い=編集終了ボタンの可視性で近似評価
        await page.click('.bd-meta-value-b[data-field="asin"]');
        await page.waitForTimeout(100);
        await page.screenshot({ path: join(SHOT_DIR, `453-planB-390-editing.png`) });
        m.kbSaveVisible = await checkKeyboardOverlap(page, '.bd-edit-toggle.cancel-edit-btn');
    }
    console.log('→', label, JSON.stringify(m));
    results[label] = m;
    await page.close();
}

writeFileSync(join(SHOT_DIR, '453-shot-metrics.json'), JSON.stringify(results, null, 2));
console.log('\n=== metrics written to tmp/453/453-shot-metrics.json ===');

// ===== 追加計測: ASIN欄にフォーカスした状態(キーボードが出る実際のタイミング)で揃えて比較 =====
async function focusAsinAndCheck(ctx, variant) {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBookEdit(page);
    if (variant === 'current') {
        await page.click('.bd-meta-edit summary');
        await page.waitForTimeout(100);
        await page.click('.edit-original-asin');
    } else if (variant === 'planA') {
        await applyPlanA(page);
        await page.click('.edit-original-asin');
    } else if (variant === 'planB') {
        await applyPlanB(page);
        await page.click('.bd-meta-value-b[data-field="asin"]');
    }
    await page.waitForTimeout(100);
    const saveSelector = variant === 'current' ? '.save-book-changes' : '.bd-edit-toggle.cancel-edit-btn';
    const visible = await checkKeyboardOverlap(page, saveSelector);
    await page.screenshot({ path: join(SHOT_DIR, `453-${variant}-390-asin-focused.png`) });
    await page.close();
    return visible;
}

const fairResults = {
    current: await focusAsinAndCheck(ctx, 'current'),
    planA: await focusAsinAndCheck(ctx, 'planA'),
    planB: await focusAsinAndCheck(ctx, 'planB'),
};
console.log('\n=== 公平な比較(ASIN欄フォーカス後・キーボード近似時の保存操作可視性) ===');
console.log(JSON.stringify(fairResults, null, 2));
writeFileSync(join(SHOT_DIR, '453-fair-kb-compare.json'), JSON.stringify(fairResults, null, 2));
await browser.close();
