/**
 * 管理画面だけで変える設定（レジ端末＝iPad の「<店舗名>（レジ）」アカウントでは出さない・開けない・変えられない）。
 * 2026-09-29 Ronnie「プリンターの設定などは管理画面だけに。iPad に置くとスタッフが触って壊す」→「ハードウェアは管理画面だけ」
 */
export const ADMIN_ONLY_SETTING_HREFS: readonly string[] = [
  '/app/settings/printers',
  // メニューの一括編集（2026-09-29 Ronnie「管理画面からだけ」）
  '/app/settings/menu-bulk',
  // 予約受付ルール（予約枠・受付期間・公開予約ページの表示内容・リマインダー）（2026-09-29 Ronnie「管理画面」）
  '/app/settings/booking',
  // テーブル・フロア（2026-09-29 Ronnie「管理画面だけ」）。テーブルQRの印刷（/app/settings/tables/qr-print）は別
  '/app/settings/tables',
];

export function isAdminOnlySetting(href: string): boolean {
  const path = href.split('?')[0];
  return ADMIN_ONLY_SETTING_HREFS.includes(path);
}

/**
 * 管理画面だけで変える設定の一覧（2026-09-29 Ronnie「管理画面からだけ。レジからは要らない」）:
 *   ハードウェア（プリンター・ドロア・レジ端末）・メニューの一括編集・レシート・インボイス設定（店舗情報）・
 *   厨房伝票（分け方・言語）・来店経路（お客様情報のボタン）・予約受付ルール・テーブル・フロア
 */
export const ADMIN_ONLY_SETTINGS_NOTE = 'この設定は管理画面（パソコン・店長以上のアカウント）で変更します。レジ（iPad）からは変更できません';

/** レジ端末から開いたとき・変えようとしたときの説明 */
export const ADMIN_ONLY_MESSAGE =
  'ハードウェア（レジ端末・プリンター・キャッシュドロア）の設定は管理画面（パソコン・店長以上のアカウント）で変更してください。レジ（iPad）からは変更できません';
