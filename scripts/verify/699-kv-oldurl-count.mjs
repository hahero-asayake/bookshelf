// イシュー#699: 旧URL (hub.asayake.org/public/<siteId>/・username 未設定) で公開ページを持つ利用者が本番に居るかを、
// 読み取りだけで数える。出力は件数だけ (uid・メール・siteId は出さない)。
// - KV の site:<siteId> → uid → uid:<uid> の username の有無を見る
// - username の無い siteId は、旧URLのトップへ HEAD を打って公開ページ (200) があるかを見る
// Cloudflare のトークンは補助スクリプト (kuroko 側の wr210-lib.mjs) が実行時にファイルから読む。値は出力しない。
// 使い方: node scripts/verify/699-kv-oldurl-count.mjs
import { wr, KV } from '/home/kuroko/kuroko/discord/core/tmp/wr210-lib.mjs';

function list(prefix) {
    const r = wr(['kv', 'key', 'list', '--namespace-id', KV, '--prefix', prefix, '--remote']);
    if (r.status !== 0) throw new Error(`kv key list 失敗 prefix=${prefix} status=${r.status}`);
    return JSON.parse(r.stdout).map(k => k.name);
}
function get(key) {
    const r = wr(['kv', 'key', 'get', key, '--namespace-id', KV, '--remote', '--text']);
    return r.status === 0 ? r.stdout : null;
}

const sites = list('site:');
const unames = list('uname:');
const out = { siteKeys: sites.length, unameKeys: unames.length, withUsername: 0, withoutUsername: 0, unknown: 0, oldUrlTop: {} };
for (const s of sites) {
    const uid = (get(s) || '').trim();
    let rec = null;
    try { rec = uid ? JSON.parse(get('uid:' + uid)) : null; } catch (_) { rec = null; }
    if (!rec) { out.unknown++; continue; }
    if (rec.username) { out.withUsername++; continue; }
    out.withoutUsername++;
    const siteId = s.slice('site:'.length);
    let status = 'error';
    try {
        const res = await fetch(`https://hub.asayake.org/public/${encodeURIComponent(siteId)}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20000) });
        status = String(res.status);
    } catch (_) { status = 'error'; }
    out.oldUrlTop[status] = (out.oldUrlTop[status] || 0) + 1;
}
console.log(JSON.stringify(out));
