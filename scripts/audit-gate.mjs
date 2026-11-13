// 門の集計 (gate-report・イシュー#583) へ渡す監査の結果を書く (docs/audit/machine-checks.md §10)。
// _local/gate/audit.json = { checks: [{ name, detected, detail }] }。同じ name は上書きし、ほかの name は残す。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function writeGateChecks(root, checks) {
    const file = join(root, '_local/gate/audit.json');
    let current = [];
    try { current = JSON.parse(readFileSync(file, 'utf-8')).checks || []; } catch { current = []; }
    const byName = new Map(current.map((c) => [c.name, c]));
    for (const c of checks) byName.set(c.name, c);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ checks: [...byName.values()] }, null, 1) + '\n');
}
