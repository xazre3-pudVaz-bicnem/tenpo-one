import type { ReservationStatus } from '@/lib/reservations';

/** 店舗台帳の 1 日の集計（店舗台帳の上のタイル・店舗ナウの上の帯で同じ数え方） */
export interface LedgerSummary {
  /** 有効な予約（キャンセル・無断・キャンセル待ちを除く） */
  count: number;
  guests: number;
  cancelled: number;
  sameDayCount: number;
  sameDayGuests: number;
  inCount: number;
  outCount: number;
  waitingCount: number;
  unconfirmed: number;
  unseated: number;
}

export interface LedgerDayRow {
  status: string;
  party_size: number;
  created_at: string;
  created_via: string | null;
  reservation_tables?: { table_id: string }[] | null;
}

const IN_STATUSES: ReservationStatus[] = ['arrived', 'seated', 'billing'];
const WAIT_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'waiting'];
const CANCEL_STATUSES: ReservationStatus[] = ['cancelled', 'no_show'];

function jstDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function summarizeLedgerDay(rows: readonly LedgerDayRow[], date: string): LedgerSummary {
  const summary: LedgerSummary = {
    count: 0,
    guests: 0,
    cancelled: 0,
    sameDayCount: 0,
    sameDayGuests: 0,
    inCount: 0,
    outCount: 0,
    waitingCount: 0,
    unconfirmed: 0,
    unseated: 0,
  };
  for (const r of rows) {
    const status = r.status as ReservationStatus;
    if (CANCEL_STATUSES.includes(status)) {
      summary.cancelled++;
      continue;
    }
    if (status === 'waitlisted') continue;
    summary.count++;
    summary.guests += r.party_size;
    if (r.created_via !== 'walk_in' && jstDateOf(r.created_at) === date) {
      summary.sameDayCount++;
      summary.sameDayGuests += r.party_size;
    }
    if (IN_STATUSES.includes(status)) summary.inCount++;
    else if (status === 'completed') summary.outCount++;
    else if (WAIT_STATUSES.includes(status)) {
      summary.waitingCount++;
      if (status === 'pending') summary.unconfirmed++;
      if ((r.reservation_tables ?? []).length === 0) summary.unseated++;
    }
  }
  return summary;
}
