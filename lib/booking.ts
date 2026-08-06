/**
 * 予約枠判定の純関数ロジック。
 * DB側 get_booking_availability と同一の判定規則。テスト対象。
 */

export interface BusinessHour {
  dayOfWeek: number; // 0=日
  isClosed: boolean;
  openTime: string | null; // 'HH:MM'
  closeTime: string | null;
  lastEntryTime: string | null;
}

export interface ExistingReservation {
  startAt: Date;
  endAt: Date;
  partySize: number;
}

export interface SlotOptions {
  date: string; // 'YYYY-MM-DD' (JST)
  partySize: number;
  capacity: number; // 利用可能テーブルの最大席数合計
  slotMinutes: number;
  stayMinutes: number;
  cutoffMinutes: number;
  now: Date;
  businessHour: BusinessHour | null;
  isHoliday: boolean;
  reservations: ExistingReservation[];
}

export interface Slot {
  time: string; // 'HH:MM'
  available: boolean;
}

function jstDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function computeSlots(opts: SlotOptions): Slot[] {
  const { businessHour: bh } = opts;
  if (opts.isHoliday || !bh || bh.isClosed || !bh.openTime || !bh.closeTime) return [];
  if (opts.capacity <= 0 || opts.partySize > opts.capacity) return [];

  const open = timeToMinutes(bh.openTime);
  const last = bh.lastEntryTime
    ? timeToMinutes(bh.lastEntryTime)
    : timeToMinutes(bh.closeTime) - 60;

  const cutoff = addMinutes(opts.now, opts.cutoffMinutes);
  const slots: Slot[] = [];

  for (let t = open; t <= last; t += opts.slotMinutes) {
    const time = minutesToTime(t);
    const slotStart = jstDateTime(opts.date, time);
    const slotEnd = addMinutes(slotStart, opts.stayMinutes);

    if (slotStart < cutoff) {
      slots.push({ time, available: false });
      continue;
    }
    // 滞在時間が重複する予約の合計人数
    const used = opts.reservations
      .filter((r) => r.startAt < slotEnd && r.endAt > slotStart)
      .reduce((acc, r) => acc + r.partySize, 0);
    slots.push({ time, available: used + opts.partySize <= opts.capacity });
  }
  return slots;
}
