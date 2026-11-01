// ハブの通報専用ページ (bookshelf.asayake.org/report?target=<対象URLのencodeURIComponent>)。
// イシュー#408 (ハヘロ決裁2026-11-01「B」): 「通報はアプリ(bookshelf側)に遷移せず、ハブのオリジン上で
// 完結させる」。/public (ユーザーの公開ページ) の CSP は ADR-032 のまま変えず、このページだけ専用の CSP で
// GIS (Google Identity Services) の script/frame/connect と、通報 API (hub.asayake.org) への送信を許可する。
//
// 配信は bookshelf-cdn.js (read-only・認証なし) 側に置く。「配信ロジックと hub の API を混在させない」という
// bookshelf-cdn.js 冒頭コメントの設計方針を踏襲し、このファイルも GET 配信 (HTML/JS 文字列を組むだけ) のみを
// 持ち、書込・秘匿情報の扱いは一切しない。通報の送信・認証そのものは hub.asayake.org 側 (asayake-hub.js の
// /session・/community/report) へフロント JS が別オリジン fetch する (APP_ORIGIN に bookshelf.asayake.org は
// 既に含まれているため追加の CORS 設定は不要)。
//
// 認証: ハブで得た Bearer キー (hk_...) は sessionStorage に保存する (cookie は使わない・ADR-032 の不変条件
// 「認証は Authorization: Bearer・cookie を使わない」と整合させる)。タブを閉じれば消える＝通報という低頻度
// 操作に見合う保持期間とし、cookie を使わない設計を別ドメインへ広げることもしない。
//
// サーバー側の判定 (sess.uid 必須・自分の記事は400・日次上限・WRITE_LIMITER・D1 の重複排除) は変更しない。
// 既存の POST /community/report (articleUrl 指定時は sites.url 一致で記事/本棚トップを解決) をそのまま使う。

export const REPORT_CATEGORIES = [
    ['spam', 'スパム・宣伝'],
    ['abuse', '誹謗中傷・嫌がらせ'],
    ['illegal', '違法・犯罪予告'],
    ['discrimination', '差別・侮辱'],
    ['other', 'その他']
];

// このページ専用の CSP。/public (記事・本棚トップ) の CSP (ADR-032: default-src 'none'; script-src 無し)
// には一切手を入れず、この1ページだけ GIS と通報 API への通信を許可する。
//   - script-src: 自ホスト配信の /report.js と GIS の client script のみ
//   - frame-src : GIS が使う accounts.google.com の iframe/popup 経路
//   - connect-src: GIS 自身の通信 + hub.asayake.org (/session・/community/report)
//   - form-action 'none': 送信は fetch (JS) のみで行い、<form> の素送信は使わない
export function reportPageCsp(hubApiOrigin) {
    return [
        "default-src 'none'",
        "script-src 'self' https://accounts.google.com/gsi/client",
        "frame-src https://accounts.google.com",
        `connect-src 'self' https://accounts.google.com ${hubApiOrigin}`,
        "style-src 'unsafe-inline' https://accounts.google.com",
        "img-src https: data:",
        "base-uri 'none'",
        "form-action 'none'"
    ].join('; ');
}

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// GET /report?target=<対象URL> のHTML本体。target が無い/不正なら「対象を読み取れません」の案内のみ表示する
// (直接 /report を踏んだ・リンクが壊れていた場合に、フォームを出して誤送信させないため)。
export function renderReportPage({ target, googleClientId }) {
    const validTarget = /^https:\/\/[^\s]+$/i.test(String(target || '')) && String(target).length <= 500;
    const categoryOptions = REPORT_CATEGORIES.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');

    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>通報 — AsayakeBookshelf</title>
<style>
  :root{--bg:#fafafa;--ink:#24292e;--sub:#596f80;--line:#c1d2de;--acc:#2177bb;--danger:#c23a3a;--ok:#1f8a4c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
  main{max-width:480px;margin:0 auto;padding:24px 20px 40px}
  h1{font-size:18px;margin:0 0 4px}
  .target{font-size:12px;color:var(--sub);word-break:break-all;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:0 0 20px}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:13px;font-weight:600;margin-bottom:5px}
  select,textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:14px;font-family:inherit;background:#fff}
  textarea{resize:vertical;min-height:70px}
  .hint{font-size:12px;color:var(--sub);margin:0 0 16px}
  #report-error{font-size:13px;color:var(--danger);margin:0 0 12px}
  #report-error:empty{display:none}
  #report-done{display:none;align-items:center;gap:8px;font-size:14px;color:var(--ok);background:#eafbf1;border:1px solid #bfe8cf;border-radius:8px;padding:12px}
  #report-done.show{display:flex}
  .actions{display:flex;justify-content:flex-end;gap:8px}
  button{border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;border:1px solid var(--line);background:#fff;cursor:pointer}
  button.primary{background:var(--acc);border-color:var(--acc);color:#fff}
  button:disabled{opacity:.6;cursor:default}
  #gsi-btn-wrap{margin:8px 0 20px}
  #login-gate .hint{margin-bottom:12px}
  [hidden]{display:none !important}
  @media (max-width:420px){main{padding:18px 14px 32px}}
</style>
</head>
<body>
<main id="report-root" data-target="${esc(target)}" data-google-client-id="${esc(googleClientId)}">
  <h1>この記事・本棚を通報</h1>
  ${validTarget
    ? `<p class="target">対象: ${esc(target)}</p>`
    : `<p id="report-error" role="alert">通報の対象を読み取れませんでした。記事・本棚トップのページから、もう一度「通報」リンクを開いてください。</p>`}
  ${validTarget ? `
  <section id="login-gate">
    <p class="hint">通報には Asayake アカウントへの Google ログインが必要です(このページ上で完結します。他サイトには移動しません)。</p>
    <div id="gsi-btn-wrap"></div>
  </section>
  <form id="report-form" hidden aria-labelledby="report-form-title">
    <h2 id="report-form-title" style="font-size:14px;margin:0 0 10px">通報の内容</h2>
    <div class="field">
      <label for="report-category">通報の種類 <span style="color:var(--danger)">必須</span></label>
      <select id="report-category" required>
        <option value="">選んでください</option>
        ${categoryOptions}
      </select>
    </div>
    <div class="field">
      <label for="report-reason">詳しい内容（任意）</label>
      <textarea id="report-reason" maxlength="500" placeholder="どこが問題かを書いてください"></textarea>
    </div>
    <p class="hint">通報への返信はしません。内容を確認し、必要な場合は記事・本棚を一覧から外します。</p>
    <p id="report-error" role="alert"></p>
    <div id="report-done" role="status" aria-live="polite">✓ 通報を受け付けました</div>
    <div class="actions">
      <button type="submit" id="report-submit" class="primary">送信</button>
    </div>
  </form>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script src="/report.js?v=1"></script>
  ` : ''}
</main>
</body>
</html>`;
}

// /report.js: ページのロジック (GIS 初期化→/session→sessionStorage 保存→フォーム送信→/community/report)。
// インライン script は一切使わない。values は #report-root の data-* 属性 (renderReportPage が esc 済みで
// 埋め込む) から読む。インラインscriptでJSONを渡す実装は、このページ専用CSP(script-src 'self' ...)に
// 'unsafe-inline'/nonceが無いためブラウザにブロックされる(本番実機確認で検出・イシュー#408)。
export function renderReportScript(hubApiOrigin) {
    return `(function(){
  'use strict';
  var root = document.getElementById('report-root');
  var cfg = root ? { target: root.dataset.target || '', googleClientId: root.dataset.googleClientId || '' } : {};
  var KEY = 'bookshelf.report.hubKey';
  function $(id){ return document.getElementById(id); }
  function setError(msg){ var el=$('report-error'); if(el) el.textContent = msg || ''; }
  function getKey(){ try { return sessionStorage.getItem(KEY) || ''; } catch(_) { return ''; } }
  function setKey(k){ try { sessionStorage.setItem(KEY, k); } catch(_) {} }

  function showForm(){
    var gate = $('login-gate'), form = $('report-form');
    if (gate) gate.hidden = true;
    if (form) form.hidden = false;
  }

  function onCredential(resp){
    fetch('${hubApiOrigin}/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: resp.credential })
    }).then(function(r){
      if (!r.ok) throw new Error('login failed');
      return r.json();
    }).then(function(data){
      setKey(data.key);
      showForm();
    }).catch(function(){
      setError('ログインに失敗しました。もう一度お試しください。');
    });
  }

  // google.accounts までは先に生えるが google.accounts.id はやや遅れて生える瞬間がある(本番実機確認で検出・
  // イシュー#408)。ポーリング側の判定が .accounts までしか見ていないと、その隙間でclearIntervalしてしまい
  // initGsi が1回だけ早期returnして二度と呼ばれなくなる(ボタンが永久に描画されない)。両箇所で同じ条件を使う。
  function gsiReady(){ return !!(window.google && google.accounts && google.accounts.id); }

  function initGsi(){
    if (!cfg.googleClientId || !gsiReady()) return;
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onCredential });
    var wrap = $('gsi-btn-wrap');
    if (wrap) google.accounts.id.renderButton(wrap, { theme: 'outline', size: 'large', text: 'signin_with' });
  }

  // GIS の外部scriptは async のため、読込完了を待ってから初期化する
  if (gsiReady()) initGsi();
  else {
    var tries = 0;
    var t = setInterval(function(){
      tries++;
      if (gsiReady()) { clearInterval(t); initGsi(); }
      else if (tries > 100) { clearInterval(t); setError('Google ログインの読み込みに失敗しました。時間をおいて再読み込みしてください。'); }
    }, 100);
  }

  // 既にこのタブでログイン済みならフォームを先に出す(ページ再読込・戻る等での再ログインを避ける)
  if (getKey()) showForm();

  var form = $('report-form');
  if (form) form.addEventListener('submit', function(ev){
    ev.preventDefault();
    var key = getKey();
    if (!key) { setError('ログインが切れています。もう一度ログインしてください。'); return; }
    var category = ($('report-category') || {}).value || '';
    if (!category) { setError('通報の種類を選んでください。'); return; }
    var reason = (($('report-reason') || {}).value || '').trim();
    var btn = $('report-submit');
    if (btn) btn.disabled = true;
    setError('');
    fetch('${hubApiOrigin}/community/report', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleUrl: cfg.target, category: category, reason: reason })
    }).then(function(res){
      if (res.status === 404) { setError('対象が見つかりませんでした。すでに一覧から外れているか、ハブで公開されたものではありません。'); if(btn) btn.disabled=false; return; }
      if (res.status === 429) { setError('本日の通報の上限に達しました。明日もう一度お試しください。'); if(btn) btn.disabled=false; return; }
      if (res.status === 401) { setError('ログインが切れています。もう一度ログインしてください。'); try{ sessionStorage.removeItem(KEY); }catch(_){} if(btn) btn.disabled=false; return; }
      if (res.status === 400) { setError('これは通報できません（自分の記事、または入力の不備です）。'); if(btn) btn.disabled=false; return; }
      if (!res.ok) { setError('通報を送れませんでした。時間をおいて、もう一度お試しください。'); if(btn) btn.disabled=false; return; }
      return res.json().catch(function(){ return {}; }).then(function(data){
        if (form) form.hidden = true;
        var done = $('report-done');
        if (done) { done.textContent = data.duplicate ? 'この記事・本棚はすでに通報済みです。' : '✓ 通報を受け付けました。返信はしませんが、内容を確認します。'; done.className = 'show'; }
      });
    }).catch(function(){
      setError('通信に失敗しました。時間をおいて、もう一度お試しください。');
      if (btn) btn.disabled = false;
    });
  });
})();`;
}
