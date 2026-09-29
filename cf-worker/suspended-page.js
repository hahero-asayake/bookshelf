// サイト停止 (451) の応答本文。bookshelf-cdn.js (新配信) と asayake-hub.js (旧 /public/<siteId>/) の
// 両方が同じ本文を返すよう、serve-headers.js と同じ型で共有する (イシュー#247 決裁3)。
// 停止理由・解除の窓口を日本語で伝え、運営者のメールアドレス (privacy.html の開示請求窓口と同じ) を
// 案内する。ステータスは 451 のまま・X-Robots-Tag: noindex を付けて検索に出さない。

const OPERATOR_EMAIL = 'asayake.hahero@gmail.com'; // legal/privacy.html §8 の窓口と同一 (値はページ本文にのみ掲載)

export function suspendedResponse() {
    const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>このサイトは停止されました</title>
<style>
  body { margin: 0; padding: 1.5rem; max-width: 32rem; font-size: 16px; line-height: 1.7; font-family: system-ui, -apple-system, sans-serif; }
  p { margin: 0 0 1rem; }
</style>
</head>
<body>
<p>このサイトは停止されました。心当たりが無い場合や、解除を申し出たい場合は、運営者のメールアドレス（<a href="mailto:${OPERATOR_EMAIL}">${OPERATOR_EMAIL}</a>）へご連絡ください。</p>
<p>This site has been suspended. If you believe this is a mistake, or to request reinstatement, please contact the operator at ${OPERATOR_EMAIL}.</p>
</body>
</html>`;
    return new Response(html, {
        status: 451,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Robots-Tag': 'noindex',
            'Cache-Control': 'no-store'
        }
    });
}
