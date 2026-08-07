/**
 * 顧客管理モジュール共通の表示ラベル定義。
 * セグメント分類は lib/crm.ts（classifyCustomer / SEGMENT_LABELS）、
 * 予約ステータスは lib/reservations.ts（RESERVATION_STATUS）を必ず使うこと。
 * ここには lib 層に置かない UI 専用の定数のみを置く。
 */

export type ConsentType = 'privacy' | 'marketing_email' | 'marketing_line';

export const CONSENT_LABELS: Record<ConsentType, string> = {
  privacy: '個人情報の取り扱いへの同意',
  marketing_email: 'メールでのお知らせ配信',
  marketing_line: 'LINEでのお知らせ配信',
};

export const CONSENT_TYPES: ConsentType[] = ['privacy', 'marketing_email', 'marketing_line'];

// -------------------------------------------------------------
// 会員・ポイント（v0.3 項目13）
// -------------------------------------------------------------

export type MemberRank = 'regular' | 'silver' | 'gold' | 'vip';

export const MEMBER_RANK_LABELS: Record<MemberRank, string> = {
  regular: 'レギュラー',
  silver: 'シルバー',
  gold: 'ゴールド',
  vip: 'VIP',
};

export const MEMBER_RANKS: MemberRank[] = ['regular', 'silver', 'gold', 'vip'];

export type PointTransactionKind = 'earn' | 'redeem' | 'revoke' | 'refund_return' | 'adjust' | 'expire';

export const POINT_KIND_LABELS: Record<PointTransactionKind, string> = {
  earn: '獲得',
  redeem: '利用',
  revoke: '付与取消（返金）',
  refund_return: '返還（返金）',
  adjust: '手動調整',
  expire: '失効',
};
