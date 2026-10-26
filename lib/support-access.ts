/**
 * 運営（CYPRESS）が コントロールセンター から お店の管理画面 に入る「サポートアクセス」（2026-10-26 Ronnie
 * 「コントロールセンターから各店舗の管理画面に入れるように。企業ごとに入っていくのは面倒」）。
 *
 * 仕組み：データは RLS（会社のメンバーだけ見られる）なので、入るときに運営のユーザーをその会社の org_owner として
 * 一時的にメンバーにする（memberships。hourly_note に SUPPORT_MEMBERSHIP_NOTE の印）。どの会社に入っているかは
 * SUPPORT_ORG_COOKIE（lib/auth.ts がこの会社のメンバーシップを選ぶ）。「コントロールセンターに戻る」で印のついたメンバーシップを消す。
 * 入るたびに監査ログ（support_access）に残す。お店のスタッフ一覧には出さない（app/app/staff/page.tsx）。
 */
export const SUPPORT_ORG_COOKIE = 'tenpo_support_org';
export const SUPPORT_MEMBERSHIP_NOTE = '__cypress_support__';

export function isSupportMembership(m: { hourly_note?: string | null } | null | undefined): boolean {
  return m?.hourly_note === SUPPORT_MEMBERSHIP_NOTE;
}
