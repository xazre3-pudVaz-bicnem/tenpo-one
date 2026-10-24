import { isUuid } from '@/lib/native-pos';
import { isIsoDate } from '@/lib/handy-reservations';
import { entryStatusToDb, normalizeTags, type EntryStatus } from '@/lib/reservation-entry';
import { holidayName } from '@/lib/jp-holidays';

/**
 * iPhone アプリのネイティブのハンディ：予約（RESERVATION）の画面（2026-10-25 Ronnie「iPhone も native に。デザインは iPad のネイティブ」）。
 *   GET  ?part=handyReservations&date=&tab=     … 予約一覧・受付管理・メッセージ（Web の /handy/reservations と同じ中身）
 *   GET  ?part=handyReservationEntry&date=&exclude= … 予約登録・テーブル変更に使うその日の卓と予約（Web の getReservationEntryData と同じ）
 *   GET  ?part=handyReservationMonth&month=       … 日付選択のカレンダー（Web の getReservationCalendar と同じ集計）
 *   POST handyRsvArrive / handyRsvCancel / handyRsvTables / handyRsvInbox / handyRsvCreate
 * 中身は Web のハンディと同じ Server Action（app/app/reservations/actions.ts）。ここは入力の確認だけ（DB・Next 非依存・テスト対象）。
 */

export type HandyRsvTab = 'list' | 'inbox' | 'messages';

/** 上のタブ（予約一覧 ｜ 受付管理 ｜ メッセージ）。Web の ?tab= と同じ。分からなければ予約一覧 */
export function parseHandyRsvTab(raw: unknown): HandyRsvTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'inbox' || v === 'messages' ? v : 'list';
}

/** カレンダーの月（'YYYY-MM'）。壊れていれば今日の月 */
export function parseHandyRsvMonth(raw: unknown, today: string): string {
  if (typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return today.slice(0, 7);
}

/** 詳細から 来店・キャンセル・テーブル変更 ができる予約（来店前。Web の handy-reservation-detail の OPEN_STATUSES と同じ） */
export const HANDY_RSV_OPEN_STATUSES: readonly string[] = ['pending', 'confirmed', 'waiting'];
export const isHandyRsvOpen = (status: string): boolean => HANDY_RSV_OPEN_STATUSES.includes(status);

/** 'HH:MM'〜'HH:MM' の分（日をまたぐときは翌日として）。終わりが無ければ 120（Web の minutesBetween と同じ） */
export function handyRsvStayMinutes(start: string, end: string | null): number {
  if (!end) return 120;
  const [ah, am] = start.split(':').map(Number);
  const [bh, bm] = end.split(':').map(Number);
  if (![ah, am, bh, bm].every(Number.isFinite)) return 120;
  const d = bh * 60 + bm - (ah * 60 + am);
  return d > 0 ? d : d + 24 * 60;
}

export type HandyRsvCancelKind = 'guest' | 'store' | 'no_show';
export type HandyRsvInboxAct = 'confirm' | 'contacted' | 'ack' | 'resolveImport';

/** 予約登録（Web のハンディの予約登録と同じ項目。登録は createManualReservation） */
export interface HandyRsvCreateInput {
  date: string;
  time: string;
  adults: number;
  children: number;
  name: string;
  phone: string;
  note: string;
  sourceCode: string;
  courseId: string | null;
  tableIds: string[];
  stayMinutes: number | null;
  status: 'confirmed' | 'pending';
  tags: string[];
  clerkId: string | null;
}

export type NativeHandyRsvAction =
  /** 来店（仮予約はいったん確定にしてから） */
  | { type: 'handyRsvArrive'; reservationId: string }
  /** キャンセル：お客様キャンセル・店舗キャンセル（担当が必要）・無断キャンセル */
  | { type: 'handyRsvCancel'; reservationId: string; kind: HandyRsvCancelKind; staffId: string | null }
  /** テーブル変更（空にすると割当を外す） */
  | { type: 'handyRsvTables'; reservationId: string; tableIds: string[] }
  /** 受付管理の「確定する／連絡済み／確認済み／対応済み」 */
  | { type: 'handyRsvInbox'; act: HandyRsvInboxAct; id: string }
  | { type: 'handyRsvCreate'; input: HandyRsvCreateInput };

export const NATIVE_HANDY_RSV_TYPES = ['handyRsvArrive', 'handyRsvCancel', 'handyRsvTables', 'handyRsvInbox', 'handyRsvCreate'] as const;

type Parsed = { ok: true; action: NativeHandyRsvAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optUuid = (v: unknown): string | null | undefined => (v == null || v === '' ? null : isUuid(v) ? v : undefined);

function uuidList(v: unknown, max: number): string[] | null {
  const list = v ?? [];
  if (!Array.isArray(list) || list.length > max || !list.every(isUuid)) return null;
  return [...new Set(list as string[])];
}

export function parseNativeHandyRsvAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'handyRsvArrive':
      if (!isUuid(b.reservationId)) return bad('予約の指定が正しくありません');
      return { ok: true, action: { type: 'handyRsvArrive', reservationId: b.reservationId } };
    case 'handyRsvCancel': {
      if (!isUuid(b.reservationId)) return bad('予約の指定が正しくありません');
      const kind = b.kind;
      if (kind !== 'guest' && kind !== 'store' && kind !== 'no_show') return bad('キャンセルの種類を選んでください');
      const staffId = optUuid(b.staffId);
      if (staffId === undefined) return bad('担当の指定が正しくありません');
      // 店舗キャンセルは担当が必須（2026-10-20 Ronnie「担当選択必ず」）
      if (kind === 'store' && !staffId) return bad('店舗キャンセルは担当を選んでください');
      return { ok: true, action: { type: 'handyRsvCancel', reservationId: b.reservationId, kind, staffId: kind === 'store' ? staffId : null } };
    }
    case 'handyRsvTables': {
      if (!isUuid(b.reservationId)) return bad('予約の指定が正しくありません');
      const tableIds = uuidList(b.tableIds, 20);
      if (!tableIds) return bad('テーブルの指定が正しくありません');
      return { ok: true, action: { type: 'handyRsvTables', reservationId: b.reservationId, tableIds } };
    }
    case 'handyRsvInbox': {
      const act = b.act;
      if (act !== 'confirm' && act !== 'contacted' && act !== 'ack' && act !== 'resolveImport') return bad();
      if (!isUuid(b.id)) return bad();
      return { ok: true, action: { type: 'handyRsvInbox', act, id: b.id } };
    }
    case 'handyRsvCreate': {
      const i = (b.input ?? {}) as Record<string, unknown>;
      if (typeof i !== 'object' || Array.isArray(i)) return bad();
      if (!isIsoDate(i.date)) return bad('来店日を確認してください');
      if (typeof i.time !== 'string' || !HM.test(i.time)) return bad('時間を確認してください');
      if (!isInt(i.adults, 0, 999) || !isInt(i.children, 0, 999) || i.adults + i.children < 1) return bad('ご人数をご確認ください');
      const name = str(i.name, 80);
      const phone = str(i.phone, 30);
      // Web の予約登録と同じ：お名前は必須・電話番号は10桁以上（createManualReservation も確かめる）
      if (!name) return bad('お名前を入れてください');
      if (phone.replace(/\D/g, '').length < 10) return bad('電話番号は10桁以上で入れてください');
      const courseId = optUuid(i.courseId);
      if (courseId === undefined) return bad('コースの指定が正しくありません');
      const clerkId = optUuid(i.clerkId);
      if (clerkId === undefined) return bad('担当者の指定が正しくありません');
      const tableIds = uuidList(i.tableIds, 20);
      if (!tableIds) return bad('テーブルの指定が正しくありません');
      const stay = i.stayMinutes == null ? null : i.stayMinutes;
      if (stay !== null && !isInt(stay, 15, 720)) return bad('確保時間を確認してください');
      // 予約ステータス：来店待ち（confirmed）・仮予約（pending）・要連絡（仮予約＋キーワード「要連絡」）。Web と同じ
      const entryStatus: EntryStatus = i.status === 'pending' ? 'pending' : i.status === 'needs_contact' ? 'needs_contact' : 'confirmed';
      const { status, tag } = entryStatusToDb(entryStatus);
      const rawTags = i.tags ?? [];
      if (!Array.isArray(rawTags) || rawTags.length > 40 || !rawTags.every((t) => typeof t === 'string')) return bad('キーワードの指定が正しくありません');
      return {
        ok: true,
        action: {
          type: 'handyRsvCreate',
          input: {
            date: i.date,
            time: i.time,
            adults: i.adults,
            children: i.children,
            name,
            phone,
            note: str(i.note, 1000),
            sourceCode: str(i.sourceCode, 40) || 'phone',
            courseId,
            tableIds,
            stayMinutes: stay as number | null,
            status,
            tags: normalizeTags([...(tag ? [tag] : []), ...(rawTags as string[])]),
            clerkId,
          },
        },
      };
    }
    default:
      return bad();
  }
}

/* ------------------------------------------------------------------ 日付選択のカレンダー */

export interface HandyMonthDay {
  date: string;
  day: number;
  /** 0=日〜6=土 */
  dow: number;
  /** その日の予約の人数（キャンセル・無断キャンセル・キャンセル待ち以外） */
  guests: number;
  /** 仮予約・要連絡がある */
  attention: boolean;
  /** 休業日（臨時休業・定休日） */
  closed: boolean;
  /** 祝日の名前 */
  holiday: string | null;
}

export interface HandyCalendarData {
  days: Record<string, { guests: number; attention: boolean }>;
  closedDates: string[];
  closedWeekdays: number[];
}

/** その月の初日と末日（'YYYY-MM-DD'） */
export function handyMonthRange(month: string): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** となりの月（'YYYY-MM'） */
export function shiftHandyMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 月のカレンダー（日曜はじまり。月の外の日は null）。Web の ReservationCalendarSheet と同じ中身：
 * 日ごとの予約の人数・休業日（臨時休業・定休日）・仮予約／要連絡・祝日
 */
export function handyMonthGrid(month: string, data: HandyCalendarData): (HandyMonthDay | null)[][] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const closed = new Set(data.closedDates);
  const closedWd = new Set(data.closedWeekdays);
  const cells: (HandyMonthDay | null)[] = Array.from({ length: firstWd }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const dow = (firstWd + d - 1) % 7;
    const info = data.days[date];
    cells.push({
      date,
      day: d,
      dow,
      guests: info?.guests ?? 0,
      attention: info?.attention ?? false,
      closed: closed.has(date) || closedWd.has(dow),
      holiday: holidayName(date),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (HandyMonthDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
