// キャラクタリゼーションテスト専用の6端末の定義(1箇所だけに置く・DRY)。
// 390/768/820/1024 はタッチ端末 (hasTouch+isMobile)、1440/1920 はマウス
// (#499 step4-plan §3-1・§4 U0)。
//
// 由来: イシュー#501(U0)が playwright.config.js の projects に最初に足した6端末
// (CHAR_DEVICES)と、イシュー#502(U1)の playwright.visual.config.js が、この定義を
// それぞれ別ファイルに複製していた(DRY違反・②指摘2026-11-03)。ここに1本化し、
// playwright.visual.config.js はここから import する。playwright.config.js 側を
// この共有モジュールに合わせる作業は #501 側で行う(②が #501 の push 前レビューで指示)。
export const CHAR_DEVICES = [
    { name: 'char-390', width: 390, height: 844, touch: true },
    { name: 'char-768', width: 768, height: 1024, touch: true },
    { name: 'char-820', width: 820, height: 1180, touch: true },
    { name: 'char-1024', width: 1024, height: 1366, touch: true },
    { name: 'char-1440', width: 1440, height: 900, touch: false },
    { name: 'char-1920', width: 1920, height: 1080, touch: false },
];
