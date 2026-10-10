/**
 * 店舗ナウ（新しい管理画面。2026-10-10 Ronnie「店舗を押したら、どの卓に誰がいるか・予約まで全部見えるように」）。
 * 見るだけの画面。注文・会計はレジとハンディで行う。
 * ここは純粋な関数だけ（DB・Next 非依存・テスト対象）。読み込みは lib/store-now-server.ts。
 */
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';

export type NowTableStatus = 'free' | 'used' | 'pay' | 'cleaning' | 'closed';

export interface NowLine {
  name: string;
  quantity: number;
  lineTotal: number;
  /** 厨房へ送った（未送信はカートのまま） */
  sent: boolean;
}

export interface NowOrder {
  /** 代表の伝票（いちばん新しいもの） */
  id: string;
  /** この卓（連携した卓も）の未会計伝票すべて */
  orderIds: string[];
  guestCount: number;
  total: number;
  openedAtMs: number;
  endAtMs: number;
  guestName: string | null;
  customerName: string | null;
  sourceLabel: string;
  clerkName: string | null;
  courseName: string | null;
  courseMinutes: number | null;
  /** 予約の時刻（予約で来たとき） */
  reservationTime: string | null;
  memo: string | null;
  lines: NowLine[];
}

export interface NowNext {
  time: string;
  startMs: number;
  name: string;
  partySize: number;
}

export interface NowTable {
  id: string;
  name: string;
  floorId: string | null;
  capacity: number;
  status: NowTableStatus;
  order: NowOrder | null;
  /** テーブル連携しているとき、組の卓の名前（自分を含む）。していなければ空 */
  groupNames: string[];
  next: NowNext | null;
}

export interface NowReservation {
  id: string;
  time: string;
  startMs: number;
  name: string;
  partySize: number;
  tables: string;
  courseName: string | null;
  source: string;
  status: string;
  statusLabel: string;
  memo: string | null;
}

export interface NowSummary {
  tablesUsed: number;
  tablesTotal: number;
  guestsNow: number;
  openGroups: number;
  openTotal: number;
  /** 未会計のお客様の平均の滞在（分） */
  avgStayMin: number | null;
  resvGroups: number;
  resvGuests: number;
  /** まだ来ていない予約（このあと） */
  resvUpcoming: number;
}

export interface StoreNowData {
  store: { id: string; name: string };
  floors: { id: string; name: string }[];
  tables: NowTable[];
  reservations: NowReservation[];
  summary: NowSummary;
}

/** 2時間をこえたら赤 */
export const LONG_STAY_MINUTES = 120;
/** 予約の「次」：開始から30分の遅れまでは「このあと」として出す */
export const NEXT_GRACE_MS = 30 * 60_000;

const UPCOMING = new Set(['pending', 'confirmed', 'waiting']);

export function reservationStatusLabel(status: string): string {
  return RESERVATION_STATUS[status as ReservationStatus]?.label ?? status;
}

/** 予約のメモ（店のメモ・ご要望・アレルギー）を1行に */
export function reservationMemo(r: { memo?: string | null; request_note?: string | null; allergy_note?: string | null }): string | null {
  const parts = [r.memo, r.request_note, r.allergy_note ? `アレルギー：${r.allergy_note}` : null]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join('／') : null;
}

/** 卓の状態：会計中（伝票発行）・使用中・清掃中・利用停止・空席 */
export function nowTableStatus(currentStatus: string, hasOrder: boolean): NowTableStatus {
  if (currentStatus === 'billing' && hasOrder) return 'pay';
  if (hasOrder) return 'used';
  if (currentStatus === 'cleaning') return 'cleaning';
  if (currentStatus === 'unavailable') return 'closed';
  return 'free';
}

/** 卓の「このあとの予約」（来店前の予約のうち、いちばん早いもの） */
export function nextReservationFor(
  list: { startMs: number; time: string; name: string; partySize: number; status: string }[],
  now: number
): NowNext | null {
  const next = list
    .filter((r) => UPCOMING.has(r.status) && r.startMs >= now - NEXT_GRACE_MS)
    .sort((a, b) => a.startMs - b.startMs)[0];
  return next ? { time: next.time, startMs: next.startMs, name: next.name, partySize: next.partySize } : null;
}

/** 経過（分）と残り（分） */
export function stayMinutes(order: { openedAtMs: number; endAtMs: number }, now: number): { elapsed: number; left: number } {
  return {
    elapsed: Math.max(0, Math.floor((now - order.openedAtMs) / 60_000)),
    left: Math.ceil((order.endAtMs - now) / 60_000),
  };
}

/** 1:05 の形 */
export function hm(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 店のいまの数字（同じ伝票を連携した卓で数えないよう、伝票ごとにまとめる） */
export function summarizeNow(tables: NowTable[], reservations: NowReservation[], now: number): NowSummary {
  const orders = new Map<string, NowOrder>();
  for (const t of tables) if (t.order) orders.set(t.order.id, t.order);
  const list = [...orders.values()];
  const usable = tables.filter((t) => t.status !== 'closed');
  const stays = list.map((o) => stayMinutes(o, now).elapsed);
  const active = reservations.filter((r) => !['cancelled', 'no_show', 'waitlisted'].includes(r.status));
  return {
    tablesUsed: tables.filter((t) => !!t.order).length,
    tablesTotal: usable.length,
    guestsNow: list.reduce((a, o) => a + o.guestCount, 0),
    openGroups: list.length,
    openTotal: list.reduce((a, o) => a + o.total, 0),
    avgStayMin: stays.length > 0 ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null,
    resvGroups: active.length,
    resvGuests: active.reduce((a, r) => a + r.partySize, 0),
    resvUpcoming: active.filter((r) => UPCOMING.has(r.status)).length,
  };
}
