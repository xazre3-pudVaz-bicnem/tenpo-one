/** 通知種別の表示ラベル（未登録の種別はそのままキーを表示する） */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  reservation: '予約',
  order: '注文・会計',
  invoice: '請求書',
  attendance: '勤怠',
  cash: 'レジ・現金',
  task: 'タスク',
  announcement: 'お知らせ',
  daily_report: '日報',
  alert: 'アラート',
  approval: '承認',
  inventory: '在庫',
  system: 'システム',
};

export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}
