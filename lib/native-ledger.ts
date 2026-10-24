import { isUuid } from '@/lib/native-pos';
import { RESERVATION_STATUS, type ReservationStatus } from '@/lib/reservations';
import { entryStatusToDb, normalizeTags, type EntryStatus } from '@/lib/reservation-entry';

/**
 * iPad アプリのネイティブの店舗台帳（予約）とサーバーの決まりごと（2026-10-24 Ronnie「店舗台帳もネイティブ。色は Tableo 風」）。
 * 読み込みは GET /api/app/v1/pos?part=ledger&date=YYYY-MM-DD（lib/native-ledger-server.ts）、操作は POST { type: 'ledger…' }。
 * 中身は Web の予約台帳と同じ Server Action（app/app/reservations/actions.ts）。ここは純粋な型と検証だけ。
 */

export type NativeLedgerAction =
  /** 電話予約の手動登録 */
  | {
      type: 'ledgerCreate';
      input: {
        date: string;
        time: string;
        adults: number;
        children: number;
        name: string;
        kana: string;
        phone: string;
        note: string;
        sourceCode: string;
        courseId: string | null;
        tableIds: string[];
        stayMinutes: number | null;
        status: 'confirmed' | 'pending';
        clerkId: string | null;
        /** メール（任意） */
        email: string;
        /** 人数を範囲で受けたときの最小人数（例 4〜6 名の 4）。最大人数＝大人＋子ども（席の割り当てに使う） */
        partySizeMin: number | null;
        /** キーワード（複数。予約ステータスの「要連絡」はここに入れる） */
        tags: string[];
        /** キャンセル待ちから「予約へ変換」するとき */
        waitlistEntryId?: string | null;
      };
    }
  | { type: 'ledgerStatus'; reservationId: string; toStatus: ReservationStatus }
  | { type: 'ledgerCancel'; reservationId: string; reason: string }
  | { type: 'ledgerNoShow'; reservationId: string; reason: string }
  | { type: 'ledgerTables'; reservationId: string; tableIds: string[] }
  | { type: 'ledgerMove'; reservationId: string; date: string; time: string; stayMinutes: number }
  | { type: 'ledgerMemo'; reservationId: string; memo: string }
  | { type: 'ledgerClerk'; reservationId: string; clerkId: string | null }
  | { type: 'ledgerSource'; reservationId: string; sourceId: string | null }
  | { type: 'ledgerCourse'; reservationId: string; courseId: string | null }
  /** 来店 → 伝票を立てて（または残っている伝票を）開く */
  | { type: 'ledgerSeat'; reservationId: string }
  /** 店頭ウェイティング：呼出・不在・取消・案内（卓に案内して伝票を開く） */
  | { type: 'ledgerWaitCall' | 'ledgerWaitNoShow' | 'ledgerWaitCancel' | 'ledgerWaitContacted' | 'ledgerWaitExpired'; entryId: string }
  | { type: 'ledgerWaitGuide'; entryId: string; tableId: string }
  /** 店頭受付の登録（受付番号を採番） */
  | { type: 'ledgerWaitTicket'; name: string; partySize: number; phone: string; seatPreference: string }
  /** キャンセル待ち（満席時）の登録 */
  | { type: 'ledgerWaitlistAdd'; name: string; phone: string; partySize: number; desiredDate: string; timeFrom: string | null; timeTo: string | null; note: string }
  /** 空席検索（その時間帯に割当のない卓。Web の FindSeatsDialog と同じ） */
  | { type: 'ledgerFindSeats'; date: string; time: string; stayMinutes: number; partySize: number }
  /** 直接来店（ウォークイン登録。Web の WalkInDialog と同じ） */
  | { type: 'ledgerWalkIn'; tableId: string; adults: number; children: number; name: string; phone: string }
  /** 店舗のキーワード（10 個・15 文字。中身はサーバーの sanitizeKeywords で確かめる） */
  | { type: 'ledgerKeywordsSave'; keywords: string[] }
  /** お客様・予約のタグの区分（店舗の設定。null は既定に戻す） */
  | { type: 'ledgerTagGroupsSave'; groups: unknown[] | null }
  /** 予約受付管理の「確定する／連絡済み／確認済み／対応済み」（Web の reservation-inbox と同じ） */
  | { type: 'ledgerInboxAct'; act: 'confirm' | 'contacted' | 'ack' | 'resolveImport'; id: string };

export type NativeLedgerActionType = NativeLedgerAction['type'];

export const NATIVE_LEDGER_ACTION_TYPES: readonly NativeLedgerActionType[] = [
  'ledgerCreate',
  'ledgerStatus',
  'ledgerCancel',
  'ledgerNoShow',
  'ledgerTables',
  'ledgerMove',
  'ledgerMemo',
  'ledgerClerk',
  'ledgerSource',
  'ledgerCourse',
  'ledgerSeat',
  'ledgerFindSeats',
  'ledgerWalkIn',
  'ledgerWaitCall',
  'ledgerWaitNoShow',
  'ledgerWaitCancel',
  'ledgerWaitContacted',
  'ledgerWaitExpired',
  'ledgerWaitGuide',
  'ledgerWaitTicket',
  'ledgerWaitlistAdd',
  'ledgerKeywordsSave',
  'ledgerTagGroupsSave',
  'ledgerInboxAct',
];

export function isNativeLedgerActionType(v: unknown): v is NativeLedgerActionType {
  return typeof v === 'string' && (NATIVE_LEDGER_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeLedgerAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optUuid = (v: unknown): string | null | undefined => (v == null || v === '' ? null : isUuid(v) ? v : undefined);

export function parseNativeLedgerAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'ledgerCreate': {
      const i = (b.input ?? {}) as Record<string, unknown>;
      if (typeof i.date !== 'string' || !DATE.test(i.date)) return bad('日付を確認してください');
      if (typeof i.time !== 'string' || !HM.test(i.time)) return bad('時刻を確認してください');
      if (!isInt(i.adults, 0, 999) || !isInt(i.children, 0, 999) || (i.adults as number) + (i.children as number) < 1) return bad('ご人数をご確認ください');
      const name = str(i.name, 80);
      const phone = str(i.phone, 30);
      if (!name) return bad('お名前を入れてください');
      const courseId = optUuid(i.courseId);
      if (courseId === undefined) return bad();
      const tableIds = i.tableIds ?? [];
      if (!Array.isArray(tableIds) || tableIds.length > 20 || !tableIds.every(isUuid)) return bad();
      const stay = i.stayMinutes == null ? null : i.stayMinutes;
      if (stay !== null && !isInt(stay, 15, 720)) return bad('滞在時間を確認してください');
      // 予約ステータス：来店待ち（confirmed）・仮予約（pending）・要連絡（仮予約＋キーワード「要連絡」）。Web の予約登録と同じ
      const entryStatus: EntryStatus = i.status === 'pending' ? 'pending' : i.status === 'needs_contact' ? 'needs_contact' : 'confirmed';
      const { status, tag } = entryStatusToDb(entryStatus);
      const clerkId = optUuid(i.clerkId);
      if (clerkId === undefined) return bad();
      const rawTags = i.tags ?? [];
      if (!Array.isArray(rawTags) || rawTags.length > 40 || !rawTags.every((t) => typeof t === 'string')) return bad();
      const tags = normalizeTags([...(tag ? [tag] : []), ...(rawTags as string[])]);
      const email = str(i.email, 254);
      const partyMax = (i.adults as number) + (i.children as number);
      const partySizeMin = i.partySizeMin == null ? null : i.partySizeMin;
      if (partySizeMin !== null && (!isInt(partySizeMin, 1, 999) || (partySizeMin as number) > partyMax)) return bad('人数の範囲を確認してください（最大人数が最小人数より小さい）');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('メールアドレスを確認してください');
      return {
        ok: true,
        action: {
          type: 'ledgerCreate',
          input: {
            date: i.date,
            time: i.time,
            adults: i.adults as number,
            children: i.children as number,
            name,
            kana: str(i.kana, 80),
            phone,
            note: str(i.note, 500),
            sourceCode: str(i.sourceCode, 40) || 'phone',
            courseId,
            tableIds: [...new Set(tableIds as string[])],
            stayMinutes: stay as number | null,
            status,
            clerkId,
            email,
            tags,
            partySizeMin: partySizeMin !== null && (partySizeMin as number) < partyMax ? (partySizeMin as number) : null,
            waitlistEntryId: isUuid(i.waitlistEntryId) ? (i.waitlistEntryId as string) : null,
          },
        },
      };
    }
    case 'ledgerStatus': {
      if (!isUuid(b.reservationId)) return bad();
      const to = b.toStatus;
      if (typeof to !== 'string' || !(to in RESERVATION_STATUS)) return bad();
      return { ok: true, action: { type: 'ledgerStatus', reservationId: b.reservationId, toStatus: to as ReservationStatus } };
    }
    case 'ledgerCancel':
    case 'ledgerNoShow': {
      if (!isUuid(b.reservationId)) return bad();
      const reason = str(b.reason, 200);
      if (b.type === 'ledgerCancel' && !reason) return bad('キャンセル理由を入れてください');
      return { ok: true, action: { type: b.type, reservationId: b.reservationId, reason } };
    }
    case 'ledgerTables': {
      const ids = b.tableIds;
      if (!isUuid(b.reservationId) || !Array.isArray(ids) || ids.length > 20 || !ids.every(isUuid)) return bad();
      return { ok: true, action: { type: 'ledgerTables', reservationId: b.reservationId, tableIds: [...new Set(ids as string[])] } };
    }
    case 'ledgerMove': {
      if (!isUuid(b.reservationId)) return bad();
      if (typeof b.date !== 'string' || !DATE.test(b.date) || typeof b.time !== 'string' || !HM.test(b.time)) return bad('日時を確認してください');
      if (!isInt(b.stayMinutes, 15, 720)) return bad('滞在時間を確認してください');
      return { ok: true, action: { type: 'ledgerMove', reservationId: b.reservationId, date: b.date, time: b.time, stayMinutes: b.stayMinutes } };
    }
    case 'ledgerMemo':
      if (!isUuid(b.reservationId) || typeof b.memo !== 'string') return bad();
      return { ok: true, action: { type: 'ledgerMemo', reservationId: b.reservationId, memo: b.memo.slice(0, 500) } };
    case 'ledgerClerk':
    case 'ledgerSource':
    case 'ledgerCourse': {
      if (!isUuid(b.reservationId)) return bad();
      const key = b.type === 'ledgerClerk' ? 'clerkId' : b.type === 'ledgerSource' ? 'sourceId' : 'courseId';
      const id = optUuid(b[key]);
      if (id === undefined) return bad();
      if (b.type === 'ledgerClerk') return { ok: true, action: { type: 'ledgerClerk', reservationId: b.reservationId, clerkId: id } };
      if (b.type === 'ledgerSource') return { ok: true, action: { type: 'ledgerSource', reservationId: b.reservationId, sourceId: id } };
      return { ok: true, action: { type: 'ledgerCourse', reservationId: b.reservationId, courseId: id } };
    }
    case 'ledgerSeat':
      if (!isUuid(b.reservationId)) return bad();
      return { ok: true, action: { type: 'ledgerSeat', reservationId: b.reservationId } };
    case 'ledgerFindSeats': {
      if (typeof b.date !== 'string' || !DATE.test(b.date) || typeof b.time !== 'string' || !HM.test(b.time)) return bad('日時を確認してください');
      if (!isInt(b.stayMinutes, 15, 720)) return bad('滞在時間を確認してください');
      if (!isInt(b.partySize, 1, 999)) return bad('人数を確認してください');
      return { ok: true, action: { type: 'ledgerFindSeats', date: b.date, time: b.time, stayMinutes: b.stayMinutes, partySize: b.partySize } };
    }
    case 'ledgerKeywordsSave': {
      if (!Array.isArray(b.keywords) || b.keywords.length > 40 || !b.keywords.every((k) => typeof k === 'string' && k.length <= 200)) return bad('キーワードの形が正しくありません');
      return { ok: true, action: { type: 'ledgerKeywordsSave', keywords: b.keywords as string[] } };
    }
    case 'ledgerTagGroupsSave': {
      if (b.groups !== null && (!Array.isArray(b.groups) || b.groups.length > 40)) return bad('タグの形が正しくありません');
      return { ok: true, action: { type: 'ledgerTagGroupsSave', groups: b.groups as unknown[] | null } };
    }
    case 'ledgerInboxAct': {
      if (!isUuid(b.id) || !['confirm', 'contacted', 'ack', 'resolveImport'].includes(b.act as string)) return bad();
      return { ok: true, action: { type: 'ledgerInboxAct', act: b.act as 'confirm' | 'contacted' | 'ack' | 'resolveImport', id: b.id } };
    }
    case 'ledgerWalkIn': {
      if (!isUuid(b.tableId)) return bad('テーブルを選択してください');
      if (!isInt(b.adults, 0, 999) || !isInt(b.children, 0, 999) || (b.adults as number) + (b.children as number) < 1) return bad('ご人数をご確認ください');
      return { ok: true, action: { type: 'ledgerWalkIn', tableId: b.tableId, adults: b.adults as number, children: b.children as number, name: str(b.name, 80), phone: str(b.phone, 30) } };
    }
    case 'ledgerWaitCall':
    case 'ledgerWaitNoShow':
    case 'ledgerWaitCancel':
    case 'ledgerWaitContacted':
    case 'ledgerWaitExpired':
      if (!isUuid(b.entryId)) return bad();
      return { ok: true, action: { type: b.type, entryId: b.entryId as string } };
    case 'ledgerWaitGuide':
      if (!isUuid(b.entryId) || !isUuid(b.tableId)) return bad('テーブルを選択してください');
      return { ok: true, action: { type: 'ledgerWaitGuide', entryId: b.entryId as string, tableId: b.tableId as string } };
    case 'ledgerWaitTicket': {
      const name = str(b.name, 80);
      if (!name) return bad('お名前を入力してください');
      if (!isInt(b.partySize, 1, 999)) return bad('ご人数をご確認ください');
      return { ok: true, action: { type: 'ledgerWaitTicket', name, partySize: b.partySize as number, phone: str(b.phone, 30), seatPreference: str(b.seatPreference, 60) } };
    }
    case 'ledgerWaitlistAdd': {
      const name = str(b.name, 80);
      const phone = str(b.phone, 30);
      if (!name || phone.length < 10) return bad('お名前・お電話番号をご確認ください');
      if (!isInt(b.partySize, 1, 999)) return bad('ご人数をご確認ください');
      if (typeof b.desiredDate !== 'string' || !DATE.test(b.desiredDate)) return bad('希望日を確認してください');
      const tf = typeof b.timeFrom === 'string' && HM.test(b.timeFrom) ? b.timeFrom : null;
      const tt = typeof b.timeTo === 'string' && HM.test(b.timeTo) ? b.timeTo : null;
      return { ok: true, action: { type: 'ledgerWaitlistAdd', name, phone, partySize: b.partySize as number, desiredDate: b.desiredDate, timeFrom: tf, timeTo: tt, note: str(b.note, 300) } };
    }
    default:
      return bad();
  }
}
