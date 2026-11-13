// コメントの日本語は拾わない
/* ブロックコメントも拾わない */
function f(n) {
    toast('保存しました');
    confirmDialog({ title: '削除の確認', message: `「${n}」を削除しますか？`, okLabel: '削除する', cancelLabel: 'やめる' });
    console.log('開発者向けのログ');
    const re = /['"`]/g; // 正規表現の中の引用符で走査が壊れないこと
    el.innerHTML = `<div class="x" title="ヒントの見本"><span>中の文字</span></div>`;
    throw new Error('読み込みに失敗しました');
}
const cmds = [{ title: '本を探す', keywords: '検索用の語 さがす' }];
const css = `.a { color: red; } /* CSS のコメントは拾わない */`;
const code = `(function(){var a=1;var b=2;if(a){alert('中のプログラムの文');} // 中のコメントは拾わない
return b;})()`;
