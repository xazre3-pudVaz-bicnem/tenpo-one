/**
 * 通知（予約リマインダー等）の抽象層。
 * 実送信（メール/SMS）は外部プロバイダ未接続。将来 SendGrid / Twilio 等を接続する。
 * ここでは「設定の有無判定」と「リマインダー文面の生成」を提供し、送信は notification_outbox
 * へ積む（=キュー）。実際の配送は別途プロバイダ接続＋定期実行で行う。
 */

export interface NotificationConfig {
  email: boolean;
  sms: boolean;
}

/** 送信プロバイダが接続済みか（環境変数の有無で判定）。未設定なら送信は行われない。 */
export function notificationConfig(): NotificationConfig {
  return {
    email: !!process.env.SENDGRID_API_KEY || !!process.env.RESEND_API_KEY || !!process.env.SMTP_URL,
    sms: !!process.env.TWILIO_AUTH_TOKEN,
  };
}

export function isNotificationConfigured(): boolean {
  const c = notificationConfig();
  return c.email || c.sms;
}

export interface ReminderContext {
  storeName: string;
  storePhone: string | null;
  guestName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  partySize: number;
  courseName: string | null;
  code: string;
}

/** 予約リマインダーの文面（日本語）。個人情報は最小限。 */
export function buildReservationReminder(ctx: ReminderContext): { subject: string; body: string } {
  const dateLabel = ctx.date.replaceAll('-', '/');
  const lines = [
    `${ctx.guestName} 様`,
    '',
    `ご予約のリマインドです。`,
    `店舗：${ctx.storeName}`,
    `日時：${dateLabel} ${ctx.time}`,
    `人数：${ctx.partySize}名`,
    ctx.courseName ? `内容：${ctx.courseName}` : `内容：席のみ`,
    `予約番号：${ctx.code}`,
    '',
    ctx.storePhone ? `ご変更・キャンセルは店舗（${ctx.storePhone}）までご連絡ください。` : `ご変更・キャンセルは店舗までご連絡ください。`,
    'ご来店をお待ちしております。',
  ];
  return {
    subject: `【${ctx.storeName}】ご予約のリマインド（${dateLabel} ${ctx.time}）`,
    body: lines.join('\n'),
  };
}
