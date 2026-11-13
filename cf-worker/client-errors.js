// 端末エラーの匿名受け口 (イシュー#584)。asayake-hub.js の fetch (POST /client-error) と scheduled から呼ばれる。
// =======================================================================
// アプリが拾った未捕捉エラーの「版・画面名・先頭行」だけを受け取り、D1 の client_errors 表で (JST の日, 指紋) ごとに数える。
// 認証なし・CORS は既存の cors() (APP_ORIGIN) に任せる。端末側は preflight を避けるため text/plain で送るので、
// Content-Type は見ずに本文を text で読んで JSON.parse する。
//
//   本文:   {v, screen, msg} だけ (余分なキー・型違い・1KB 超・JSON でないものは 400)
//   保存:   client_errors(day, fp, v, screen, msg, count, first_at, last_at, notified)。fp = sha256("v|screen|msg") の先頭 16 桁 hex
//           IP・User-Agent・Cookie・Bearer は保存しない (列を作らない)。IP はレート制限のキーにだけ使う
//   通知:   同じ (day, fp) が 10 件を超えた最初の 1 回だけ REPORT_WEBHOOK_URL へ 1 行 (notified 列で一度きりにする)
//   応答:   正常・停止中・日次の新規上限超えは 204 (本文なし)。レート超過 429・D1 未設定 503
//
// env:
//   DB                 D1 (community と同じ DB)。未設定なら 503
//   WRITE_LIMITER      (任意) ratelimit binding。キー cerr:<CF-Connecting-IP> で連投を弾く。未設定なら制限なし
//   REPORT_WEBHOOK_URL (任意) Discord webhook。未設定・失敗でも応答は 204
//   CLIENT_ERRORS_OFF  (任意) '1' なら保存も通知もせず 204 を返す (止めたい時の切替)
// 古い行は scheduled から pruneClientErrors() で 30 日分だけ残して消す。

const MAX_BODY_BYTES = 1024;
const NOTIFY_OVER = 10;                 // この件数を超えた最初の 1 回だけ通知する
const DAILY_NEW_FP_LIMIT = 500;         // 1 日の新規指紋の上限 (超えた新顔は保存しない・既存の加算は続ける)
const KEEP_DAYS = 30;
const SCREEN_RE = /^[A-Za-z0-9_-]{1,40}$/;
const LINE_BREAK_RE = /[\r\n\u2028\u2029]/;   // 通知を 1 行に保つため v・msg とも改行を拒む
const KEYS = ['v', 'screen', 'msg'];

function empty(status) { return new Response(null, { status }); }
function err(status, message) {
    return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

// JST の暦日 'YYYY-MM-DD'
export function jstDay(ms) { return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

export async function clientErrorFingerprint(v, screen, msg) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${v}|${screen}|${msg}`));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// 本文を max バイトまでだけ読む (超えたら読み捨てて null)。Content-Length を偽っても上限で止まる
async function readCapped(request, max) {
    if (Number(request.headers.get('Content-Length')) > max) return null;
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { try { await reader.cancel(); } catch { /* 読み捨て */ } return null; }
        chunks.push(value);
    }
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(buf);
}

// {v, screen, msg} を検証して返す。1 つでも外れたら null (= 400)。字数はコードポイントで数える
export function parseClientError(text) {
    let o;
    try { o = JSON.parse(text); } catch { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const keys = Object.keys(o);
    if (keys.length !== KEYS.length || !KEYS.every(k => keys.includes(k))) return null;
    const { v, screen, msg } = o;
    if (typeof v !== 'string' || typeof screen !== 'string' || typeof msg !== 'string') return null;
    const len = (s) => [...s].length;
    if (len(v) < 1 || len(v) > 32 || LINE_BREAK_RE.test(v)) return null;
    if (!SCREEN_RE.test(screen)) return null;
    if (len(msg) < 1 || len(msg) > 200 || LINE_BREAK_RE.test(msg)) return null;
    return { v, screen, msg };
}

// POST /client-error
export async function handleClientError(request, env, ctx) {
    if (env.CLIENT_ERRORS_OFF === '1') return empty(204);
    if (env.WRITE_LIMITER && typeof env.WRITE_LIMITER.limit === 'function') {
        const { success } = await env.WRITE_LIMITER.limit({ key: `cerr:${request.headers.get('CF-Connecting-IP') || 'anon'}` });
        if (!success) return err(429, 'rate limit exceeded (slow down)');
    }
    if (!env.DB || typeof env.DB.prepare !== 'function') return err(503, 'client error backend (D1) not configured');

    const text = await readCapped(request, MAX_BODY_BYTES);
    if (text == null) return err(400, 'body too large');
    const e = parseClientError(text);
    if (!e) return err(400, 'need {v, screen, msg}');

    const now = Date.now();
    const day = jstDay(now);
    const fp = await clientErrorFingerprint(e.v, e.screen, e.msg);
    // 既にある指紋は常に加算。新しい指紋はその日の行数が上限未満の時だけ入れる (1 文で数えるので競合しても上限を大きく超えない)
    const row = await env.DB.prepare(
        `INSERT INTO client_errors (day, fp, v, screen, msg, count, first_at, last_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6, ?6
         WHERE (SELECT COUNT(*) FROM client_errors WHERE day = ?1) < ?7
            OR EXISTS (SELECT 1 FROM client_errors WHERE day = ?1 AND fp = ?2)
         ON CONFLICT(day, fp) DO UPDATE SET count = count + 1, last_at = excluded.last_at
         RETURNING count, notified`
    ).bind(day, fp, e.v, e.screen, e.msg, now, DAILY_NEW_FP_LIMIT).first();
    if (!row) return empty(204);   // 日次の新規上限を超えた新顔は保存しない

    if (row.count > NOTIFY_OVER && !row.notified) {
        // notified 0→1 を取れた 1 回だけが通知する (同時に 11 件目が来ても二重に送らない)
        const upd = await env.DB.prepare(`UPDATE client_errors SET notified = 1 WHERE day = ?1 AND fp = ?2 AND notified = 0`).bind(day, fp).run();
        if (upd && upd.meta && upd.meta.changes === 1) {
            const p = notifyClientError(env, { ...e, count: row.count, day });
            if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); else await p;
        }
    }
    return empty(204);
}

// 通知 1 行。版・画面名・件数・先頭行だけ (端末を特定できる情報は元から持っていない)
async function notifyClientError(env, { v, screen, msg, count, day }) {
    if (!env.REPORT_WEBHOOK_URL) { console.warn('[client-error] REPORT_WEBHOOK_URL 未設定: 通知せず件数だけ記録した'); return; }
    const content = `【端末エラー】${day} 版 ${v}／画面 ${screen}／${count} 件: ${msg}`;
    try {
        const res = await fetch(env.REPORT_WEBHOOK_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'bookshelf 端末エラー', content: content.slice(0, 400), allowed_mentions: { parse: [] } })
        });
        if (!res.ok) console.warn('[client-error] webhook が失敗:', res.status);
    } catch (e2) { console.warn('[client-error] webhook が失敗:', e2 && e2.name); }
}

// 30 日より古い日 (JST) の行を消す。scheduled から呼ぶ。消した行数を返す (D1 未設定なら 0)
export async function pruneClientErrors(env, now = new Date()) {
    if (!env.DB || typeof env.DB.prepare !== 'function') return 0;
    const cutoff = jstDay(now.getTime() - KEEP_DAYS * 86400 * 1000);
    const r = await env.DB.prepare(`DELETE FROM client_errors WHERE day < ?1`).bind(cutoff).run();
    return (r && r.meta && r.meta.changes) || 0;
}
