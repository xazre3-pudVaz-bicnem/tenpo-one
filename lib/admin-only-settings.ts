/**
 * 管理画面だけで変える設定（レジ端末＝iPad の「<店舗名>（レジ）」アカウントでは出さない・開けない・変えられない）。
 * 2026-09-29 Ronnie「プリンターの設定などは管理画面だけに。iPad に置くとスタッフが触って壊す」→「ハードウェアは管理画面だけ」
 */
export const ADMIN_ONLY_SETTING_HREFS: readonly string[] = ['/app/settings/printers'];

export function isAdminOnlySetting(href: string): boolean {
  const path = href.split('?')[0];
  return ADMIN_ONLY_SETTING_HREFS.includes(path);
}

/** レジ端末から開いたとき・変えようとしたときの説明 */
export const ADMIN_ONLY_MESSAGE =
  'ハードウェア（レジ端末・プリンター・キャッシュドロア）の設定は管理画面（パソコン・店長以上のアカウント）で変更してください。レジ（iPad）からは変更できません';
