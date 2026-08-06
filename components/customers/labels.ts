/** 顧客管理モジュール共通の表示ラベル定義 */

export type CustomerSegment = 'new' | 'repeater' | 'regular' | 'dormant' | 'no_show';

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  new: '新規（来店1回以下）',
  repeater: 'リピーター（2〜9回）',
  regular: '常連（10回以上）',
  dormant: '休眠（90日以上来店なし）',
  no_show: '無断キャンセルあり',
};

export type ReservationStatus =
  | 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show' | 'waitlisted';

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: '仮予約',
  confirmed: '予約確定',
  seated: '来店中',
  completed: '来店済み',
  cancelled: 'キャンセル',
  no_show: '無断キャンセル',
  waitlisted: 'キャンセル待ち',
};

export const RESERVATION_STATUS_TONES: Record<
  ReservationStatus,
  'gray' | 'primary' | 'success' | 'warning' | 'danger'
> = {
  pending: 'gray',
  confirmed: 'primary',
  seated: 'success',
  completed: 'success',
  cancelled: 'danger',
  no_show: 'danger',
  waitlisted: 'warning',
};

export type ConsentType = 'privacy' | 'marketing_email' | 'marketing_line';

export const CONSENT_LABELS: Record<ConsentType, string> = {
  privacy: '個人情報の取り扱いへの同意',
  marketing_email: 'メールでのお知らせ配信',
  marketing_line: 'LINEでのお知らせ配信',
};

export const CONSENT_TYPES: ConsentType[] = ['privacy', 'marketing_email', 'marketing_line'];
