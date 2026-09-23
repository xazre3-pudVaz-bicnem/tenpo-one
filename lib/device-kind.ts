/**
 * 端末の見分け（2026-09-23 要望）。
 *
 * スマホからは ハンディ だけを開かせる。売上・設定などの本体（/app）は
 * パソコンと iPad からだけ。判定は User-Agent で行う。
 *
 * iPad を「スマホ」と間違えないことが一番大事（iPad はレジ本体で使う）。
 * iPadOS は「デスクトップ用サイト」既定なので Macintosh を名乗ることがあり、
 * どちらの名乗り方でもスマホ扱いしない。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。
 */

/** スマホ（手のひらサイズ）か。タブレット・パソコンは false */
export function isPhoneUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();

  // iPad は必ず除外（レジ本体で使う）
  if (ua.includes('ipad')) return false;
  // iPadOS が「デスクトップ用サイト」で Macintosh を名乗る場合も除外
  if (ua.includes('macintosh')) return false;

  if (ua.includes('iphone') || ua.includes('ipod')) return true;
  // Android はタブレットにも入る。スマホのときだけ "mobile" が付く
  if (ua.includes('android')) return ua.includes('mobile');
  if (ua.includes('windows phone')) return true;
  // その他のスマホ系ブラウザ
  if (ua.includes('iemobile') || ua.includes('blackberry') || ua.includes('opera mini')) return true;

  return false;
}
