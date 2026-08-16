// publish-credit プラグインの拡張点契約テスト (ADR-042 dogfood)。
//
// plugins-sample/publish-credit は repo から削除される予定 (標準機能5個への絞り込み)。
// このプラグインは「同じリポジトリを再入力したときに差分があったとき」を検証する唯一の
// テストであり、削除後も拡張点契約 (registerSettings での入力 → data/publish.json への
// 純データ保存 → 公開ビルドでの footer 反映) を検証し続ける必要があるため、
// plugins-sample/publish-credit/index.js への動的 import は行わず、
// activate ロジック相当をこのファイル自身に inline 実装する
// (実体は plugins-sample/publish-credit/index.js 参照。ロジックは同一)。
import { describe, it, expect } from 'vitest';

await import('../../js/plugin-api.js');
await import('../../js/exporter.js');
const BookshelfPluginAPI = window.BookshelfPluginAPI;
const BookshelfExporter = window.BookshelfExporter;

function activatePublishCredit(api) {
    const FILE = 'publish.json';
    api.registerSettings(async (host) => {
        const cfg = api.getConfig();
        const current = (cfg && typeof cfg.footerNote === 'string') ? cfg.footerNote : '';
        host.innerHTML = `
            <textarea class="pc-input" rows="2"></textarea>
            <button type="button" class="pc-save">保存</button>
            <span class="pc-status"></span>`;
        const input = host.querySelector('.pc-input');
        const status = host.querySelector('.pc-status');
        input.value = current;
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

function makeApp() {
    const store = {};
    return {
        store,
        _isSyncReady: () => true,
        storage: {
            async syncBatch(entries) { for (const e of entries) store[e.path] = e.data; },
            async readText(path) { return path in store ? store[path] : null; }
        },
        userData: { settings: {} },
        saveUserData: async () => {}
    };
}

async function bootSettingsPanel() {
    const app = makeApp();
    const pluginApi = new BookshelfPluginAPI(app);
    const scoped = pluginApi.forPlugin('publish-credit');
    activatePublishCredit(scoped);
    const render = pluginApi.getPluginSettingsRenderer('publish-credit');
    expect(render).toBeTypeOf('function');
    const host = document.createElement('div');
    await render(host, scoped);
    return { app, pluginApi, host };
}

async function save(host, value) {
    host.querySelector('.pc-input').value = value;
    host.querySelector('.pc-save').click();
    // クリックハンドラは非同期 (setConfig → writePluginFile) なのでマイクロタスクの完了を待つ
    await new Promise((r) => setTimeout(r, 0));
}

describe('publish-credit (拡張点契約: registerSettings + 公開スナップショット, ADR-042 dogfood)', () => {
    it('入力→保存で setConfig と data/publish.json (純データ) の両方に書かれる', async () => {
        const { app, host } = await bootSettingsPanel();
        await save(host, '感想・依頼はこちらまで');

        expect(app.userData.settings.pluginConfig['publish-credit'].footerNote).toBe('感想・依頼はこちらまで');
        expect(JSON.parse(app.store['plugins/publish-credit/data/publish.json'])).toEqual({ footerNote: '感想・依頼はこちらまで' });
        expect(host.querySelector('.pc-status').textContent).toBe('保存しました');
    });

    it('空欄で保存すると footerNote 非表示扱いのメッセージになる', async () => {
        const { app, host } = await bootSettingsPanel();
        await save(host, '   ');

        expect(JSON.parse(app.store['plugins/publish-credit/data/publish.json'])).toEqual({ footerNote: '' });
        expect(host.querySelector('.pc-status').textContent).toBe('保存しました (フッター非表示)');
    });

    it('保存済みの値が設定画面を開き直した際に反映される (getConfig 経由)', async () => {
        const { app, host: host1 } = await bootSettingsPanel();
        await save(host1, '再訪時の一言');

        // 同じ app (同じ pluginConfig) で設定画面を開き直す
        const pluginApi = new BookshelfPluginAPI(app);
        const scoped = pluginApi.forPlugin('publish-credit');
        activatePublishCredit(scoped);
        const render = pluginApi.getPluginSettingsRenderer('publish-credit');
        const host2 = document.createElement('div');
        await render(host2, scoped);
        expect(host2.querySelector('.pc-input').value).toBe('再訪時の一言');
    });

    it('保存した publish.json を実際の BookshelfExporter._collectPluginPublishData (コア側, ADR-042) が読み取り footerNote を収集する', async () => {
        const { app, pluginApi, host } = await bootSettingsPanel();
        await save(host, '公開ページのフッターに出す一言');

        // exporter が呼ぶのは app.pluginAPI.readPluginFile(id, 'publish.json') という
        // 2引数シグネチャ (BookshelfPluginAPI 本体のメソッド。forPlugin スコープ API ではない)
        app._collectPublishablePluginIds = async () => new Set(['publish-credit']);
        app.pluginAPI = pluginApi;
        const out = await new BookshelfExporter(app)._collectPluginPublishData();
        expect(out).toEqual([{ id: 'publish-credit', footerNote: '公開ページのフッターに出す一言' }]);
    });

    it('公開時にプラグインのコードは実行されない (収集は data/publish.json の読み取りのみ)', async () => {
        // _collectPluginPublishData は readPluginFile を呼ぶだけで、
        // activate/registerSettings 経由のプラグインコードには一切触れないことを確認する
        const app = makeApp();
        app.store['plugins/publish-credit/data/publish.json'] = JSON.stringify({ footerNote: 'コード非実行の確認' });
        app._collectPublishablePluginIds = async () => new Set(['publish-credit']);
        app.pluginAPI = { readPluginFile: (id, rel) => app.storage.readText(`plugins/${id}/data/${rel}`) };
        const out = await new BookshelfExporter(app)._collectPluginPublishData();
        expect(out).toEqual([{ id: 'publish-credit', footerNote: 'コード非実行の確認' }]);
    });
});
