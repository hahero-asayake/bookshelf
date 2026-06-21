// publish-credit
//
// 公開ページのフッターに表示する「ひとこと」を編集できるプラグイン。
// 入力は plugins/publish-credit/data/publish.json に { footerNote } として保存する。
// 公開ビルド (exporter._collectPluginPublishData) がこの純データを読み、コアが必ず esc して
// 全ページ + トップ index のフッターに出す (ADR-042 の公開スナップショット dogfood)。
//
// 重要: 公開時にこのプラグインのコードは実行されない。出るのは data/publish.json の純データだけ。
// footerNote は文字列のみ — コアが esc するため、Amazon リンク等の能動的 HTML は注入できない。

export function activate(api, manifest) {
    const FILE = 'publish.json';

    api.registerSettings(async (host) => {
        const cfg = api.getConfig();
        const current = (cfg && typeof cfg.footerNote === 'string') ? cfg.footerNote : '';
        host.innerHTML = `
            <p class="pc-help" style="color:var(--muted); font-size:.85rem; margin:0 0 6px;">
              公開ページのフッターに表示する一文。空にすると非表示になります。</p>
            <textarea class="pc-input" rows="2" style="width:100%; box-sizing:border-box;"
              placeholder="例: 感想・依頼は ○○ まで"></textarea>
            <div style="margin-top:8px;">
              <button type="button" class="btn btn-primary btn-small pc-save">保存</button>
              <span class="pc-status" style="color:var(--muted); margin-left:8px;"></span>
            </div>`;
        const input = host.querySelector('.pc-input');
        const status = host.querySelector('.pc-status');
        input.value = current; // value 経由で入れる (HTML エスケープ不要 + 改行保持)
        host.querySelector('.pc-save').addEventListener('click', async () => {
            const value = input.value.trim();
            status.textContent = '保存中…';
            try {
                await api.setConfig({ footerNote: value });
                // 公開ビルドが読む純データ。文字列だけを JSON で保存する (コードは含めない)。
                await api.writePluginFile(FILE, JSON.stringify({ footerNote: value }));
                status.textContent = value ? '保存しました' : '保存しました (フッター非表示)';
            } catch (e) {
                status.textContent = '保存に失敗 (同期先が未接続)';
            }
        });
    });
}
