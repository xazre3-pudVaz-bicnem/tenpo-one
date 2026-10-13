/**
 * iPad アプリのネイティブの「テーブル一覧」（Order & Pay のフロア）とサーバーの決まりごと。
 * 2026-10-13 Ronnie「iPad がアプリらしくない」「Native ON ＋ テーブルの画面も」。
 * 卓の状態の決め方は Web の components/floor/types.ts（tileState）と同じ。アプリ（Swift）も同じ順で決める。
 */

import { isUuid } from '@/lib/native-pos';

export interface NativeFloorSlip {
  id: string;
  orderNo: number;
}

/** 卓の未会計の伝票（同じ卓に複数あれば合算。Web のフロアと同じ） */
export interface NativeFloorOrder {
  /** 代表の伝票（いちばん新しいもの） */
  id: string;
  orderNo: number;
  /** 経過時間の起点（最初の伝票の開始。ミリ秒） */
  openedAtMs: number;
  /** 終了予定（ミリ秒） */
  endAtMs: number;
  guestCount: number;
  total: number;
  clerkName: string | null;
  guestName: string | null;
  sourceLabel: string;
  courseLabel: string | null;
  slips: NativeFloorSlip[];
}

export interface NativeFloorTable {
  id: string;
  floorId: string | null;
  name: string;
  capacityMin: number;
  capacityMax: number;
  /** restaurant_tables.current_status（available / seated / ordering / billing / cleaning / reserved / waiting / unavailable） */
  status: string;
  isCounter: boolean;
  isPrivateRoom: boolean;
  order: NativeFloorOrder | null;
  /** 今日のこれからの予約（開始の早い順） */
  upcoming: { id: string; startMs: number; time: string; name: string; partySize: number; sourceLabel: string }[];
  /** テーブル連携（グループ）の卓の名前（2卓以上のときだけ） */
  groupNames: string[];
  /** お客様QRからの未対応の呼び出し */
  calls: { kind: string }[];
}

export interface NativeFloorPayload {
  ok: true;
  store: { id: string; name: string };
  floors: { id: string; name: string }[];
  defaultFloorId: string | null;
  tables: NativeFloorTable[];
  /** 今日の予約（右の一覧。ウォークインは除く） */
  reservations: { id: string; startMs: number; time: string; name: string; partySize: number; tableLabel: string; status: string }[];
  /** 卓を操作できる（着席・清掃完了） */
  canOperate: boolean;
  serverNow: number;
}

export type NativeFloorAction =
  | { type: 'walkIn'; tableId: string; partySize: number }
  | { type: 'openOrder'; tableId: string }
  | { type: 'cleaningDone'; tableId: string };

type Parsed = { ok: true; action: NativeFloorAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

/** アプリから来た操作を確かめる */
export function parseNativeFloorAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (!isUuid(b.tableId)) return bad();
  switch (b.type) {
    case 'walkIn': {
      const n = b.partySize;
      // orders.guest_count の制約（startWalkIn と同じ 1〜999）
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 999) return bad('人数は1〜999名で指定してください');
      return { ok: true, action: { type: 'walkIn', tableId: b.tableId, partySize: n } };
    }
    case 'openOrder':
      return { ok: true, action: { type: 'openOrder', tableId: b.tableId } };
    case 'cleaningDone':
      return { ok: true, action: { type: 'cleaningDone', tableId: b.tableId } };
    default:
      return bad();
  }
}

/**
 * 卓の終了予定（app/app/floor/page.tsx と同じ順）:
 * 予約の開始が伝票の開始と同じ（ウォークイン・席の時間を直した伝票）なら予約の終了予定 → コースの所要時間 →
 * 予約の終了予定（伝票より後なら）→ 店舗の既定滞在時間。
 */
export function floorEndAtMs(input: {
  openedAtMs: number;
  resvStartMs: number | null;
  resvEndMs: number | null;
  courseMinutes: number | null;
  stayMinutes: number;
}): number {
  const { openedAtMs, resvStartMs, resvEndMs, courseMinutes, stayMinutes } = input;
  const start = resvStartMs ?? NaN;
  const end = resvEndMs ?? NaN;
  const seatTimeSet = Number.isFinite(start) && Math.abs(start - openedAtMs) < 60_000 && end > openedAtMs;
  if (seatTimeSet) return end;
  if (courseMinutes && courseMinutes > 0) return openedAtMs + courseMinutes * 60_000;
  if (Number.isFinite(end) && end > openedAtMs) return end;
  return openedAtMs + stayMinutes * 60_000;
}

/** コースの種類（Web のフロアと同じ言い方） */
export function floorCourseLabel(c: { course_includes_drinks: boolean | null; course_includes_ayce: boolean | null }): string {
  if (c.course_includes_ayce && c.course_includes_drinks) return '食飲放';
  if (c.course_includes_ayce) return '食放';
  if (c.course_includes_drinks) return '飲放';
  return '時間制';
}
