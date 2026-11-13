// 変異検査 (実画面): 実行時に誤りを1つ入れる (docs/audit/machine-checks.md §9)。ソースは書き換えない。
// 環境変数 AUDIT_PLANT で選ぶ。対応する検査の件数が1つ増え、npm script が基準値の超過で落ちることを確かめる。
//   aria    ホームで、名前を aria-label に頼っているボタンから aria-label を外す (検査 a11y)
//   button  本の手動追加の閉じるボタンの名前を変える (検査 buttons)。同じ操作キー・同じ名前のボタンがほかの画面にも
//           ある所を選ぶ = 名前の種類が1つ増える (1つしか無い名前を変えると、入れ替わるだけで件数は増えない)
//   clip    ホームで、文字を持つ要素を狭めて切る (検査 layout)
const PLANT = process.env.AUDIT_PLANT || '';
const TARGET = {
    aria: { check: 'a11y', screen: 'home' },
    button: { check: 'buttons', screen: 'add-book' },
    clip: { check: 'layout', screen: 'home' },
};

export async function plantFault(page, check, screen) {
    const target = TARGET[PLANT];
    if (!target || target.check !== check || target.screen !== screen) return;
    const planted = await page.evaluate((kind) => {
        const shown = (el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]');
        if (kind === 'aria') {
            // 見えているボタンを1つ選び、名前の元 (aria-label・title・中の文字) を外す。大きさは残す
            const button = [...document.querySelectorAll('#dashboard button, button')].find((el) => shown(el));
            if (!button) return false;
            const { width, height } = button.getBoundingClientRect();
            button.removeAttribute('aria-label');
            button.removeAttribute('aria-labelledby');
            button.removeAttribute('title');
            for (const node of [...button.childNodes]) if (node.nodeType === 3) node.remove();
            for (const el of button.querySelectorAll('*')) { el.setAttribute('aria-hidden', 'true'); }
            button.style.cssText += `;min-width:${Math.max(width, 24)}px;min-height:${Math.max(height, 24)}px;`;
            button.id = 'audit-planted-aria';
            return true;
        }
        if (kind === 'button') {
            const close = document.querySelector('#add-book-modal-close');
            if (!close) return false;
            close.removeAttribute('aria-label');
            close.textContent = '変異検査のとじる';
            return true;
        }
        if (kind === 'clip') {
            const el = [...document.querySelectorAll('#dashboard *')].find((x) => shown(x)
                && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length >= 4));
            if (!el) return false;
            el.id = 'audit-planted-clip';
            el.style.cssText += ';display:block;width:24px;overflow:hidden;white-space:nowrap;';
            return true;
        }
        return false;
    }, PLANT);
    if (!planted) throw new Error(`変異検査 (${PLANT}): 誤りを入れる要素が ${screen} に見つからない`);
}
