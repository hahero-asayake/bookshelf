// 名前の無い部品の検出 (docs/audit/machine-checks.md §5-5)。
// ボタン・画像・入力に、読み上げられる名前があるかを自前で判定し、あわせて axe の名前のルールだけを流す。
import AxeBuilder from '@axe-core/playwright';
import { evaluateInFrames, uniqueFindings } from './common.js';

// 名前の有無に関するルールだけ (コントラスト等は門(b)の範囲)
export const A11Y_AXE_RULES = [
    'button-name', 'link-name', 'image-alt', 'input-image-alt', 'input-button-name', 'label', 'select-name',
    'aria-command-name', 'aria-input-field-name', 'aria-toggle-field-name', 'role-img-alt', 'svg-img-alt',
    'summary-name', 'frame-title',
];

// ページの中で実行される
function ownCheck(arg) {
    const H = window.__auditH;
    const base = arg && arg.scope ? document.querySelector(arg.scope) : document;
    if (!base) throw new Error(`測る範囲が見つからない: ${arg.scope}`);
    const byIds = (el, attr) => H.text((el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)
        .map((id) => (document.getElementById(id) || {}).textContent || '').join(' '));
    // 中の文字 (中の画像の alt・svg の title・aria-label を含む。aria-hidden の中は数えない)
    const inner = (el) => {
        let out = '';
        const walk = (n) => {
            for (const c of n.childNodes) {
                if (c.nodeType === 3) { out += c.textContent; continue; }
                if (c.nodeType !== 1 || c.getAttribute('aria-hidden') === 'true') continue;
                if (c.hasAttribute('aria-label')) out += ` ${c.getAttribute('aria-label')} `;
                else if (c.tagName === 'IMG') out += ` ${c.getAttribute('alt') || ''} `;
                else if (c.tagName.toLowerCase() === 'svg') out += ` ${(c.querySelector('title') || {}).textContent || ''} `;
                else walk(c);
            }
        };
        walk(el);
        return H.text(out);
    };
    const label = (el) => H.text(el.labels ? [...el.labels].map((l) => l.textContent).join(' ') : '');
    const aria = (el) => byIds(el, 'aria-labelledby') || H.text(el.getAttribute('aria-label'));
    const title = (el) => H.text(el.getAttribute('title'));
    const findings = [];
    const add = (kind, el) => findings.push({ kind, ident: H.ident(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 140) });
    const targets = base.querySelectorAll('button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, img, [role="img"], summary, iframe');
    for (const el of targets) {
        if (!H.visible(el) || el.closest('[aria-hidden="true"]')) continue;
        const tag = el.tagName;
        const role = el.getAttribute('role');
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'IMG') {
            // alt="" は飾り。alt 属性そのものが無い時に検出する
            if (role === 'presentation' || role === 'none') continue;
            if (!el.hasAttribute('alt') && !aria(el) && !title(el)) add('image', el);
        } else if (role === 'img') {
            if (!aria(el) && !title(el)) add('image', el);
        } else if (tag === 'IFRAME') {
            if (!aria(el) && !title(el)) add('other', el);
        } else if (tag === 'SELECT') {
            if (!aria(el) && !label(el) && !title(el)) add('select', el);
        } else if (tag === 'INPUT' && ['button', 'submit', 'reset', 'image'].includes(type)) {
            // submit・reset は value が無くてもブラウザが既定の名前を付ける
            const value = type === 'image' ? el.getAttribute('alt') : (el.getAttribute('value') || (type === 'button' ? '' : type));
            if (!aria(el) && !H.text(value) && !title(el)) add('button', el);
        } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
            if (aria(el) || label(el) || title(el)) continue;
            add(H.text(el.getAttribute('placeholder')) ? 'inputPlaceholderOnly' : 'input', el);
        } else if (tag === 'A') {
            if (!aria(el) && !inner(el) && !title(el)) add('link', el);
        } else if (!aria(el) && !inner(el) && !title(el)) {
            add('button', el);   // button・[role=button]・summary
        }
    }
    return findings;
}

/**
 * ページを受け取り、名前の無い部品の一覧を返す。
 * 種類 (kind): 自前 = button・link・image・input・inputPlaceholderOnly・select・other / axe = axe
 */
export async function detectA11yNames(page, { axe = true, scope = null } = {}) {
    const findings = await evaluateInFrames(page, ownCheck, { scope });
    if (axe) {
        // setLegacyMode: axe は既定で、iframe の結果をまとめるために白紙のページを新しく開く。公開プレビューを
        // 開いた状態ではそのページが開けず時間切れになるので、新しいページを開かない形で流す (同じオリジンの iframe は見る)
        let builder = new AxeBuilder({ page }).withRules(A11Y_AXE_RULES).setLegacyMode(true);
        if (scope) builder = builder.include(scope);   // その面の中だけを測る
        const results = await builder.analyze();
        for (const violation of results.violations) {
            for (const node of violation.nodes) {
                const target = node.target.map(String);
                const ident = target.length === 1
                    ? await page.evaluate((sel) => {
                        try { const el = document.querySelector(sel); return el ? window.__auditH.ident(el) : sel; } catch { return sel; }
                    }, target[0])
                    : target.join(' >> ');
                findings.push({ kind: 'axe', ident: `${violation.id}: ${ident}`, html: String(node.html || '').replace(/\s+/g, ' ').slice(0, 140) });
            }
        }
    }
    return uniqueFindings(findings);
}
