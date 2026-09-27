/**
 * APNs（iPhone/iPad アプリの通知）の純粋な部分。送信は lib/apns-server.ts。
 */

export type NativeApp = 'regi' | 'handy' | 'owner';
export type ApnsEnvironment = 'production' | 'sandbox';

/** アプリ（bundle id）ごとの APNs の topic。ios/tools/gen_project.py と同じ */
export const APNS_TOPIC: Record<NativeApp, string> = {
  regi: 'com.tenpoone.regi',
  handy: 'com.tenpoone.handy',
  owner: 'com.tenpoone.handy',
};

export const APNS_HOST: Record<ApnsEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

export function isNativeApp(v: unknown): v is NativeApp {
  return v === 'regi' || v === 'handy' || v === 'owner';
}

/** 端末トークン（16進・64〜200文字） */
export function isDeviceToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64,200}$/i.test(v);
}

export interface NativePushMessage {
  title: string;
  body: string;
  /** 通知をタップしたときに開く画面（/app/floor など） */
  url: string;
  /** 同じ知らせをまとめる（呼び出しの id など） */
  tag?: string;
  /** お客様の呼び出しはベルの音 */
  sound?: 'bell' | 'default';
  /** 集中モード中でも出す（呼び出し・新しい予約） */
  timeSensitive?: boolean;
}

/** APNs に送る JSON */
export function apnsPayload(m: NativePushMessage) {
  return {
    aps: {
      alert: { title: m.title, body: m.body },
      sound: m.sound === 'bell' ? 'bell.wav' : 'default',
      ...(m.timeSensitive ? { 'interruption-level': 'time-sensitive' } : {}),
      ...(m.tag ? { 'thread-id': m.tag } : {}),
    },
    url: m.url,
  };
}

/** トークンを消すべき返事（アプリを消した・別の環境のトークン） */
export function isDeadTokenResponse(status: number, reason: string | null | undefined): boolean {
  return status === 410 || (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic'));
}

/** base64url */
export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
