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

/**
 * TENPO ONE の iPhone/iPad アプリ（ios/）が User-Agent に付ける印：`TenpoOneApp/<mode>/<version>`
 *   regi … レジ（iPad）、handy … ハンディ（iPhone・スタッフ）、owner … オーナー・店長（iPhone）
 * 2026-09-28 Ronnie「iPhone と iPad のアプリ。レジは iPad、ハンディとオーナーは iPhone」
 */
export type NativeAppMode = 'regi' | 'handy' | 'owner';

export function nativeAppMode(userAgent: string | null | undefined): NativeAppMode | null {
  const m = /tenpooneapp\/(regi|handy|owner)\b/i.exec(userAgent ?? '');
  return m ? (m[1].toLowerCase() as NativeAppMode) : null;
}

/**
 * スマホでも本体（/app）を開いてよいか：iPhone アプリの「オーナー・店長」モードだけ。
 * それ以外のスマホは今まで通り ハンディ（/handy）へ
 */
export function phoneMayOpenApp(userAgent: string | null | undefined): boolean {
  return nativeAppMode(userAgent) === 'owner';
}

/**
 * レジ（iPad）か：User-Agent に iPad／Android タブレット／iPad アプリ（regi）の印があるか、
 * 画面がタッチ（maxTouchPoints > 1。iPadOS は「デスクトップ用サイト」で Macintosh を名乗るので UA だけでは分からない）。
 * パソコン（マウス・タッチ無し）は false。
 */
export function isRegisterTablet(userAgent: string | null | undefined, touchPoints: number | null | undefined): boolean {
  const ua = (userAgent ?? '').toLowerCase();
  if (nativeAppMode(userAgent) === 'regi') return true;
  if (ua.includes('ipad')) return true;
  if (ua.includes('android') && !ua.includes('mobile')) return true;
  return (touchPoints ?? 0) > 1;
}

/**
 * ログアウトを止めるか（レジを閉めていないとき）。
 * 止めるのは「レジのアカウントで入った iPad（タブレット）」だけ。同じレジのアカウントでもパソコンから入った管理画面は
 * ログアウトできる（2026-10-05 Ronnie「レジを閉めていないとパソコンの管理画面からもログアウトできない。パソコン版はログアウトできるように」）。
 * パソコン・ハンディ・メール＋パスワードのログインは今までどおり止めない。
 */
export function shouldBlockRegisterSignOut(input: {
  isRegisterDevice: boolean;
  userAgent: string | null | undefined;
  touchPoints: number | null | undefined;
}): boolean {
  return input.isRegisterDevice && isRegisterTablet(input.userAgent, input.touchPoints);
}
