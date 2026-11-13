// ボタン名の揺れの検出 (docs/audit/machine-checks.md §5-4)。
// ページ上のボタンに「操作キー」を付け、操作キーごとに名前を突き合わせて、名前が2種類以上ある操作を出す。
import { evaluateInFrames } from './common.js';

// ページの中で実行される
function collect(arg) {
    const H = window.__auditH;
    const base = arg && arg.scope ? document.querySelector(arg.scope) : document;
    if (!base) throw new Error(`測る範囲が見つからない: ${arg.scope}`);
    const out = [];
    for (const el of base.querySelectorAll('button, [role="button"], a.btn, input[type="button"], input[type="submit"]')) {
        if (!H.visible(el) || el.closest('[aria-hidden="true"]')) continue;
        // 名前は、aria-label、中の文字、title の順で最初にあるもの
        const name = H.text(el.getAttribute('aria-label'))
            || H.text(el.tagName === 'INPUT' ? el.value : el.textContent)
            || H.text(el.getAttribute('title'));
        const id = el.id || '';
        const classes = [...el.classList];
        // 操作キーは、上から順に最初に当たったもの
        let opKey = null;
        if (el.hasAttribute('data-act')) opKey = `act:${el.getAttribute('data-act')}`;
        else if (classes.includes('cfm-cancel')) opKey = 'confirm:cancel';
        else if (classes.includes('cfm-ok')) opKey = 'confirm:ok';
        else if (classes.includes('modal-close') || /-close$/.test(id)) opKey = 'std:close';
        else if (/-back$/.test(id) || classes.some((c) => /-back$/.test(c))) opKey = 'std:back';
        else if (/-cancel$/.test(id)) opKey = 'std:cancel';
        else if (/-save$/.test(id)) opKey = 'std:save';
        else if (/-done$/.test(id)) opKey = 'std:done';
        else if (/-delete$/.test(id)) opKey = 'std:delete';
        out.push({ opKey, name, ident: H.ident(el) });
    }
    return out;
}

/** ページを受け取り、見えているボタンの一覧 { screen, opKey, name, ident } を返す */
export async function collectButtons(page, screen, { scope = null } = {}) {
    return (await evaluateInFrames(page, collect, { scope })).map((b) => ({ ...b, screen }));
}

// 確認ダイアログの実行ボタンは、操作ごとに名前が違うのが正しいので、揺れの判定に入れない
const NOT_JUDGED = new Set(['confirm:ok']);

/**
 * 集めたボタンの一覧から揺れを出す。
 * extraNames = { 操作キー: [名前, …] } は、巡回で開かなかった分 (抽出した cancelLabel) を足すためのもの。
 * 件数 (total) は、操作キーごとの (名前の種類の数 − 1) の合計。未分類のボタンは別に返し、件数に入れない。
 */
export function buttonVariants(buttons, extraNames = {}) {
    const byKey = new Map();
    const put = (key, name, where) => {
        if (!name) return;   // 名前が空のものは「名前の無い部品」で数える
        if (!byKey.has(key)) byKey.set(key, new Map());
        const names = byKey.get(key);
        if (!names.has(name)) names.set(name, new Set());
        names.get(name).add(where);
    };
    for (const b of buttons) {
        if (b.opKey && !NOT_JUDGED.has(b.opKey)) put(b.opKey, b.name, `${b.screen}: ${b.ident}`);
    }
    for (const [key, names] of Object.entries(extraNames)) {
        for (const name of names) put(key, name, '(抽出)');
    }
    // 並びは文字コード順 (実行する機械のロケールで順が変わらないようにする)
    const byCode = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const variants = [];
    for (const [opKey, names] of [...byKey.entries()].sort(byCode)) {
        if (names.size < 2) continue;
        variants.push({
            opKey,
            count: names.size - 1,
            names: [...names.entries()].sort(byCode).map(([name, where]) => ({ name, where: [...where].sort() })),
        });
    }
    const unclassified = buttons.filter((b) => !b.opKey && b.name);
    return { total: variants.reduce((sum, v) => sum + v.count, 0), variants, unclassified };
}
