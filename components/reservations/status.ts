import type { BadgeTone } from '@/components/ui/badge';

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'waitlisted';

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: '確認中',
  confirmed: '予約確定',
  seated: '着席中',
  completed: '会計済み',
  cancelled: 'キャンセル',
  no_show: '来店なし',
  waitlisted: 'キャンセル待ち',
};

export const STATUS_BADGE_TONE: Record<ReservationStatus, BadgeTone> = {
  pending: 'gray',
  confirmed: 'primary',
  seated: 'success',
  completed: 'gray',
  cancelled: 'danger',
  no_show: 'warning',
  waitlisted: 'gray',
};

/** タイムライングリッドのブロック色 */
export const STATUS_BLOCK_CLASS: Record<ReservationStatus, string> = {
  pending: 'bg-gray-200 text-gray-700',
  confirmed: 'bg-primary text-white',
  seated: 'bg-success text-white',
  completed: 'bg-gray-300 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-400 line-through',
  no_show: 'bg-warning-soft text-warning',
  waitlisted: 'bg-gray-200 text-gray-700',
};

export const CREATED_VIA_LABEL: Record<string, string> = {
  web: 'Web予約',
  phone: '電話',
  walk_in: 'ウォークイン',
  manual: '手動登録',
};

/** 予約台帳に表示する対象ステータス（確定〜完了系。キャンセル・来店なしは除外） */
export const ACTIVE_TIMELINE_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'seated', 'completed'];
