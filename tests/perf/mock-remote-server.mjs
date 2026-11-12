#!/usr/bin/env node
// イシュー#530 step4: 「モックした処理を外して本物のまま測り直す」の対象(flushSync/_scheduleSync/
// _isSyncReady・画像取得)を、実際のHTTP経路に乗せるためのローカルモックサーバー(②指示どおり
// 同期の通信先はローカルのモックサーバーに差し替えてよい)。
// 使い方: node tests/perf/mock-remote-server.mjs --port <port> --delay <ms>
import http from 'node:http';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
}, []));
const PORT = Number(args.port || 9530);
const DELAY = Number(args.delay || 0);

// 1x1 透明png相当の短いバイナリ(実画像デコードコストを持たせるため、ごく小さいがcontent-typeは本物)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const server = http.createServer((req, res) => {
    const delay = () => new Promise((r) => setTimeout(r, DELAY));
    (async () => {
        await delay();
        if (req.url.startsWith('/img/')) {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
            res.end(PNG_1PX);
            return;
        }
        if (req.url.startsWith('/hub/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.writeHead(404);
        res.end();
    })();
});
server.listen(PORT, () => console.log(`mock-remote-server up on :${PORT} (delay=${DELAY}ms)`));
