#!/usr/bin/env node
// イシュー#501: playwright実行をタイムアウトで中断すると、webServer(python3 -m http.server)が
// 孤児プロセスとして port に残り、次の実行が ERR_EMPTY_RESPONSE で落ちることを実機で確認した
// (②差し戻し・2026-11-03)。テスト実行の直前に必ず呼び、対象 port を使っている全プロセスを
// 強制終了してから playwright を起動する(reuseExistingServer:true が死んだサーバを拾わないように)。
//
// 使い方: node scripts/verify/501-free-port.mjs <port>
import { execSync } from 'node:child_process';

const port = process.argv[2] || process.env.PORT || '8101';

try {
    const out = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`).toString().trim();
    if (!out) {
        console.log(`[501-free-port] port ${port} is free`);
        process.exit(0);
    }
    const pids = out.split('\n').filter(Boolean);
    for (const pid of pids) {
        try {
            execSync(`kill -9 ${pid}`);
            console.log(`[501-free-port] killed pid ${pid} on port ${port}`);
        } catch (e) {
            console.warn(`[501-free-port] failed to kill pid ${pid}: ${e.message}`);
        }
    }
} catch (e) {
    console.warn(`[501-free-port] lsof unavailable or failed: ${e.message}`);
}
