// #509 step1: plan§6「公開の一覧/公開の設定の戻り先指定がPC幅で効かない疑い」の実測
// 使い方: python3 -m http.server 8109 を起動した状態で node scripts/verify/509-probe-pc-publish-route.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8109/';
const out = {};
for (const [label, vp] of [['pc1440', { width: 1440, height: 900 }], ['sp390', { width: 390, height: 844 }]]) {
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: vp, hasTouch: label.startsWith('sp'), isMobile: label.startsWith('sp'), serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.waitForSelector('#sidebar-publish', { state: 'attached', timeout: 15000 });
    const snap = async (tag) => ({ tag, hash: await p.evaluate(() => location.hash), len: await p.evaluate(() => history.length), faces: await p.evaluate(() => (window.bookshelf && window.bookshelf.nav ? window.bookshelf.nav.state.faces.map((f) => f.id) : null)) });
    const r = [await snap('boot')];
    await p.waitForTimeout(1500); { await p.evaluate(() => window.bookshelf.openPublishPagesModal()); }

    await p.waitForSelector('#publish-pages-modal.show', { timeout: 10000 });
    r.push(await snap('publish-pages open'));
    await p.evaluate(() => window.bookshelf.openPublishSettingsModal());
    await p.waitForSelector('#publish-settings-modal.show', { timeout: 10000 }).catch(() => {});
    r.push(await snap('publish-settings open'));
    out[label] = r;
    await b.close();
}
console.log(JSON.stringify(out, null, 1));
