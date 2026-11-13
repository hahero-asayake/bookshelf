// 監査の検査で、実行する機械による差を消す手当て (docs/audit/machine-checks.md §4)。
// フォントを1書体に固定し、アニメーションと遷移を止め、フォントの読み込みを待つ。

export const AUDIT_FONT = 'Noto Sans CJK JP';
// 時刻を固定する基準日 (visual と同じ)
export const FIXED_TIME = new Date('2026-11-03T09:00:00+09:00');

const PIN_CSS = `
*, *::before, *::after {
    font-family: "${AUDIT_FONT}" !important;
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
}`;

/** ページと、同じオリジンの iframe の全部に、フォントの固定とアニメーションの停止を入れる */
export async function pinEnvironment(page) {
    for (const frame of page.frames()) {
        try {
            await frame.addStyleTag({ content: PIN_CSS });
        } catch (e) {
            if (frame === page.mainFrame()) throw e;   // 別オリジン・読み込み前の iframe は飛ばす
        }
    }
    await page.evaluate(() => document.fonts.ready);
}

/** 本文の文字が実際にどの書体で描かれたかを返す (Chromium の CSS.getPlatformFontsForNode) */
export async function platformFonts(page) {
    await page.evaluate(async () => {
        const probe = document.createElement('span');
        probe.id = 'audit-font-probe';
        probe.textContent = 'あ漢カA1';
        probe.style.cssText = 'position:fixed;left:0;top:0;opacity:0.01;pointer-events:none';
        document.body.appendChild(probe);
        // 書体の情報は、配置 (layout) が済んだ文字にしか付かない。配置を済ませ、1回描かせてから問い合わせる
        probe.getBoundingClientRect();
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const client = await page.context().newCDPSession(page);
    try {
        await client.send('DOM.enable');
        await client.send('CSS.enable');
        const { root } = await client.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#audit-font-probe' });
        const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
        return fonts.map((f) => f.familyName);
    } finally {
        await page.evaluate(() => document.getElementById('audit-font-probe')?.remove());
        await client.detach().catch(() => {});
    }
}

/** 固定した書体で描かれていなければ、件数を比べる前に落とす */
export async function assertAuditFont(page) {
    const families = await platformFonts(page);
    if (families.length !== 1 || families[0] !== AUDIT_FONT) {
        throw new Error(`フォントが違う: 期待「${AUDIT_FONT}」/ 実際「${families.join('・') || '(なし)'}」。fonts-noto-cjk を入れてから流すこと (docs/audit/machine-checks.md §4)`);
    }
}
