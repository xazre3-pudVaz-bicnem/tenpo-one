/**
 * 重要なお知らせのポップアップ（2026-09-28 Ronnie「アラートは時々画面にポップアップ。了解を押すまで」）。純粋関数・テスト対象。
 */

/** 「あとで」を押してから、もう一度出すまで（ミリ秒） */
export const POPUP_SNOOZE_MS = 10 * 60 * 1000;

export interface PopupAnnouncement {
  id: string;
  title: string;
  body: string;
  publishFrom: string | null;
  publishTo: string | null;
}

/** 公開期間内か（'YYYY-MM-DD' の今日で判定。components/dashboard/announcement-banner.tsx と同じ） */
export function inPublishPeriod(a: { publishFrom: string | null; publishTo: string | null }, today: string): boolean {
  if (a.publishFrom && today < a.publishFrom) return false;
  if (a.publishTo && today > a.publishTo) return false;
  return true;
}

/** 出すもの：公開期間内・未読（了解を押していない） */
export function popupQueue<T extends PopupAnnouncement>(rows: T[], readIds: ReadonlySet<string>, today: string): T[] {
  return rows.filter((a) => inPublishPeriod(a, today) && !readIds.has(a.id));
}

/** いま出してよいか：「あとで」から10分たった／注文画面（/app/pos）では出さない */
export function shouldShowPopup(input: { queueLength: number; snoozedUntil: number | null; now: number; pathname: string }): boolean {
  if (input.queueLength === 0) return false;
  if (input.pathname === '/app/pos' || input.pathname.startsWith('/app/pos/')) return false;
  return input.snoozedUntil == null || input.now >= input.snoozedUntil;
}
