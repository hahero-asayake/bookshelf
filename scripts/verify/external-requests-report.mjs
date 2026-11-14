// external-requests-hook.cjs (イシュー#637) の記録を、ホスト別・spec 別の表 (markdown) にする。
// 使い方: node scripts/verify/external-requests-report.mjs <EXTREQ_DIR> [run ...]  (run を省くと全部)
// 判定: 画像 (resourceType=image または表紙のホスト) の要求のうち、実通信 (serverAddr あり) と
// 外へ向かって失敗したもの (プロキシ・名前解決・接続の失敗) を「外へ出た」と数える。
// ERR_ABORTED / ERR_FAILED (route.abort)・ERR_INTERNET_DISCONNECTED (setOffline) はテストが止めた＝外へ出ていない。
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...want] = process.argv.slice(2);
if (!dir) {
    console.error('usage: node scripts/verify/external-requests-report.mjs <EXTREQ_DIR> [run ...]');
    process.exit(2);
}
// 表紙のホスト (sw.js の COVER_HOSTS・tests/e2e/helpers/test-base.js の COVER_IMAGE_HOSTS と同じ3つ)
const COVER_HOSTS = new Set(['images-na.ssl-images-amazon.com', 'm.media-amazon.com', 'images-amazon.com']);
const NET_FAIL = /TUNNEL|NAME_NOT_RESOLVED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|TIMED_OUT|SSL|CERT/;
const readJsonl = (f) => fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const isImg = (e) => e.type === 'image' || COVER_HOSTS.has(e.host);

const files = fs.readdirSync(dir).filter((f) => /^req-.+-\d+\.jsonl$/.test(f));
const runs = [...new Set(files.map((f) => f.replace(/^req-/, '').replace(/-\d+\.jsonl$/, '')))].filter((r) => !want.length || want.includes(r)).sort();
let imageLeakTotal = 0;
for (const run of runs) {
    const ev = files.filter((f) => f.replace(/^req-/, '').replace(/-\d+\.jsonl$/, '') === run).flatMap((f) => readJsonl(path.join(dir, f)));
    const hooks = ev.filter((e) => e.ev === 'hook');
    const rows = new Map();
    const row = (e) => {
        const k = `${e.host}\t${isImg(e) ? '画像' : 'その他'}`;
        if (!rows.has(k)) rows.set(k, { req: 0, route: 0, net: 0, netFail: 0, stopped: 0 });
        return rows.get(k);
    };
    const leaks = new Map();
    for (const e of ev) {
        if (e.ev === 'request') row(e).req++;
        else if (e.ev === 'response') {
            if (e.serverAddr) {
                row(e).net++;
                const k = `${e.file}\t${e.host}\t${isImg(e) ? '画像' : 'その他'}\t実通信`;
                leaks.set(k, (leaks.get(k) || 0) + 1);
            } else row(e).route++;
        } else if (e.ev === 'failed') {
            if (NET_FAIL.test(e.error || '')) {
                row(e).netFail++;
                const k = `${e.file}\t${e.host}\t${isImg(e) ? '画像' : 'その他'}\t外へ向かって失敗 (${e.error})`;
                leaks.set(k, (leaks.get(k) || 0) + 1);
            } else row(e).stopped++;
        }
    }
    const imageLeak = [...leaks].filter(([k]) => k.split('\t')[2] === '画像').reduce((a, [, n]) => a + n, 0);
    imageLeakTotal += imageLeak;
    console.log(`### ${run}（hook ${hooks.length} 本 / ok ${hooks.filter((h) => h.ok).length}）\n`);
    console.log('| ホスト | 種類 | 要求 | route で返した | 実通信 | 外へ向かって失敗 | テストが止めた |');
    console.log('|---|---|---:|---:|---:|---:|---:|');
    for (const [k, r] of [...rows].sort((a, b) => b[1].req - a[1].req)) {
        const [host, kind] = k.split('\t');
        console.log(`| ${host} | ${kind} | ${r.req} | ${r.route} | ${r.net} | ${r.netFail} | ${r.stopped} |`);
    }
    if (!rows.size) console.log('| （外への要求なし） | | 0 | 0 | 0 | 0 | 0 |');
    console.log(`\n外へ出た要求（spec 別）: ${[...leaks.values()].reduce((a, b) => a + b, 0)} 件（うち画像 ${imageLeak} 件）\n`);
    if (leaks.size) {
        console.log('| spec | ホスト | 種類 | 結果 | 件数 |');
        console.log('|---|---|---|---|---:|');
        for (const [k, n] of [...leaks].sort((a, b) => b[1] - a[1])) { const [f, h, kind, r] = k.split('\t'); console.log(`| ${f} | ${h} | ${kind} | ${r} | ${n} |`); }
        console.log();
    }
}
console.log(`合計: 外へ出た画像の要求 ${imageLeakTotal} 件（run ${runs.join(', ') || 'なし'}）`);
