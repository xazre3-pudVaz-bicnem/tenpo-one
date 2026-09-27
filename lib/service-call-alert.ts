/**
 * お客様QRからの呼び出し（スタッフ／お会計希望）の知らせ方（2026-09-28 Ronnie「ハンディは振動、卓の箱にも出す。iPad とハンディ」）。
 * 純粋関数・テスト対象。
 */

/** 対応済みになるまで、音と振動をくり返す間隔 */
export const CALL_REPEAT_MS = 30_000;
/** くり返す回数の上限（最初の1回のあと。30秒×10＝5分） */
export const CALL_REPEAT_MAX = 10;
/** 画面を開いた・戻ったときに拾い直す呼び出し（これより古いものは卓のマークだけ） */
export const CALL_PICKUP_WINDOW_MS = 30 * 60 * 1000;
/** QR から呼んだ直後だけ Push を送る（同じ呼び出しを何度も送らない） */
export const CALL_PUSH_FRESH_MS = 90_000;

export type CallKind = 'staff' | 'checkout';

export function callKindLabel(kind: CallKind): string {
  return kind === 'checkout' ? 'お会計希望' : 'スタッフ呼び出し';
}

/** 振動のパターン（ミリ秒）。Android は navigator.vibrate、iPhone は通知（Push）か触覚フィードバックで */
export const CALL_VIBRATION: number[] = [300, 120, 300, 120, 300];

export interface TrackedCall {
  id: string;
  /** 最後に鳴らした時刻 */
  lastAlertAt: number;
  /** 鳴らした回数（最初を含む） */
  alerts: number;
}

/** いまもう一度鳴らすか（対応済み・閉じたものは呼ぶ側で外す） */
export function shouldRepeatCall(call: TrackedCall, now: number): boolean {
  return call.alerts <= CALL_REPEAT_MAX && now - call.lastAlertAt >= CALL_REPEAT_MS;
}

/** 画面を開いた／戻ったときに拾う呼び出しか */
export function isPickupCall(createdAtMs: number, now: number): boolean {
  return now - createdAtMs <= CALL_PICKUP_WINDOW_MS;
}

/** QR から作った直後の呼び出しか（Push はこのときだけ送る） */
export function isFreshCall(createdAtIso: string, now: number): boolean {
  const t = Date.parse(createdAtIso);
  return Number.isFinite(t) && now - t >= -5_000 && now - t <= CALL_PUSH_FRESH_MS;
}

/** Push の中身（sw.js が { title, body, url, tag } を表示・振動する） */
export function serviceCallPushPayload(input: { tableName: string | null; kind: CallKind; callId: string }) {
  return {
    title: `${input.tableName ?? '卓'}　${callKindLabel(input.kind)}`,
    body: 'お客様のQRからの呼び出しです。対応したら「対応済み」を押してください',
    // iPhone のハンディは /app を開くと /handy に移る。iPad はテーブル一覧
    url: '/app/floor',
    tag: `call-${input.callId}`,
  };
}
