/**
 * 予約UI共通の表示定数。
 * ステータスのラベル・遷移・色トーンは lib/reservations.ts（RESERVATION_STATUS / canTransition）を必ず使うこと。
 * ここには lib 層に置かない UI 専用の定数のみを置く。
 */
import type { ReservationStatus } from '@/lib/reservations';
import { RESERVATION_STATUS } from '@/lib/reservations';
import type { BadgeTone } from '@/components/ui/badge';

export const CREATED_VIA_LABEL: Record<string, string> = {
  web: 'Web予約',
  phone: '電話',
  walk_in: 'ウォークイン',
  manual: '手動登録',
};

/** 予約台帳・カレンダー集計に表示する対象ステータス（進行中〜完了。キャンセル・来店なしは除外） */
export const ACTIVE_TIMELINE_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'waiting',
  'arrived',
  'seated',
  'billing',
  'completed',
];

/** テーブル占有中とみなすステータス（割当競合判定・満席判定に使用） */
export const OCCUPYING_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'waiting',
  'arrived',
  'seated',
  'billing',
];

/** テーブル割当操作を許可するステータス（会計済み・キャンセル・来店なしは不可） */
export const ASSIGNABLE_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'waiting',
  'arrived',
  'seated',
  'billing',
  'waitlisted',
];

/** 日時変更を許可するステータス */
export const MOVABLE_STATUSES: ReservationStatus[] = [
  'pending',
  'confirmed',
  'waiting',
  'arrived',
  'seated',
  'billing',
  'waitlisted',
];

/** tone（Badgeと共通）→ タイムライングリッドのブロック配色 */
const TONE_BLOCK_CLASS: Record<BadgeTone, string> = {
  gray: 'bg-gray-200 text-gray-700',
  primary: 'bg-primary text-white',
  success: 'bg-success text-white',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-gray-100 text-gray-400 line-through',
  navy: 'bg-navy text-white',
};

export function statusBlockClass(status: ReservationStatus): string {
  return TONE_BLOCK_CLASS[RESERVATION_STATUS[status].tone as BadgeTone];
}
