import { isUuid } from '@/lib/native-pos';

/**
 * iPad アプリのネイティブの「シフト」（Web の /app/shifts と同じ）。
 * 2026-10-24 Ronnie「iPad のオプション・サブオプションは全部ネイティブ」。
 * 読み込みは GET /api/app/v1/pos?part=shifts&week=YYYY-MM-DD、操作は POST { type: 'shift…', … }。
 * 中身は Web と同じ Server Action（app/app/shifts/actions.ts）を呼ぶだけ（lib/native-modules/shifts.ts）。
 * ここは形の確かめだけ（純粋な関数。tests/native-shifts.test.ts）。
 */

export type NativeShiftKind = 'planned' | 'requested' | 'confirmed';

export type NativeShiftAction =
  /** シフトの作成・更新（shifts.manage）。id があれば更新 */
  | { type: 'shiftUpsert'; id?: string; profileId: string; date: string; startTime: string; endTime: string; kind: NativeShiftKind }
  /** シフトの削除（shifts.manage） */
  | { type: 'shiftDelete'; id: string }
  /** 表示している週の下書きをまとめて公開（shifts.manage） */
  | { type: 'shiftPublish'; weekStart: string; weekEnd: string }
  /** 本人のシフト希望の提出・更新（自分のマスだけ） */
  | { type: 'shiftRequest'; id?: string; date: string; startTime: string; endTime: string }
  /** 公開済みの自分のシフトの変更申請（attendance.punch） */
  | { type: 'shiftChangeRequest'; shiftId: string; dayOff: boolean; desiredStart: string | null; desiredEnd: string | null; reason: string }
  /** 変更申請の却下（shifts.manage） */
  | { type: 'shiftRejectChange'; shiftId: string }
  /** 時間帯別の必要人数を追加（shifts.manage） */
  | { type: 'shiftReqAdd'; dayOfWeek: number; timeFrom: string; timeTo: string; requiredCount: number }
  /** 時間帯別の必要人数を削除（shifts.manage） */
  | { type: 'shiftReqDelete'; id: string };

export const NATIVE_SHIFT_ACTION_TYPES = [
  'shiftUpsert',
  'shiftDelete',
  'shiftPublish',
  'shiftRequest',
  'shiftChangeRequest',
  'shiftRejectChange',
  'shiftReqAdd',
  'shiftReqDelete',
] as const satisfies readonly NativeShiftAction['type'][];

export function isNativeShiftActionType(v: unknown): v is NativeShiftAction['type'] {
  return typeof v === 'string' && (NATIVE_SHIFT_ACTION_TYPES as readonly string[]).includes(v);
}

/** その週の月曜（UTC 基準で日付の文字列だけを見る。Web のシフト表と同じ） */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD（実在する日付） */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** HH:mm（00:00〜23:59。input type=time と同じ形） */
export function isHm(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

const KINDS: readonly NativeShiftKind[] = ['planned', 'requested', 'confirmed'];
const REASON_MAX = 500;

type Parsed = { ok: true; action: NativeShiftAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

export function parseNativeShiftAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case 'shiftUpsert': {
      if (b.id != null && !isUuid(b.id)) return bad('シフトが見つかりません');
      if (!isUuid(b.profileId)) return bad('スタッフを選択してください');
      if (!isYmd(b.date)) return bad('日付が正しくありません');
      if (!isHm(b.startTime) || !isHm(b.endTime)) return bad('時刻が正しくありません');
      if (typeof b.kind !== 'string' || !(KINDS as readonly string[]).includes(b.kind)) return bad('種別が正しくありません');
      return {
        ok: true,
        action: {
          type: 'shiftUpsert',
          ...(b.id ? { id: b.id as string } : {}),
          profileId: b.profileId,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          kind: b.kind as NativeShiftKind,
        },
      };
    }
    case 'shiftDelete':
      if (!isUuid(b.id)) return bad('シフトが見つかりません');
      return { ok: true, action: { type: 'shiftDelete', id: b.id } };
    case 'shiftPublish': {
      if (!isYmd(b.weekStart)) return bad('週が正しくありません');
      // 月曜にそろえ、終わりはサーバーで決める（Web の WeekNav と同じ 7 日間）
      const weekStart = mondayOf(b.weekStart);
      return { ok: true, action: { type: 'shiftPublish', weekStart, weekEnd: addDays(weekStart, 6) } };
    }
    case 'shiftRequest': {
      if (b.id != null && !isUuid(b.id)) return bad('この希望は編集できません');
      if (!isYmd(b.date)) return bad('日付が正しくありません');
      if (!isHm(b.startTime) || !isHm(b.endTime)) return bad('時刻が正しくありません');
      return {
        ok: true,
        action: { type: 'shiftRequest', ...(b.id ? { id: b.id as string } : {}), date: b.date, startTime: b.startTime, endTime: b.endTime },
      };
    }
    case 'shiftChangeRequest': {
      if (!isUuid(b.shiftId)) return bad('このシフトの変更申請はできません');
      const dayOff = b.dayOff === true;
      const reason = typeof b.reason === 'string' ? b.reason.slice(0, REASON_MAX) : '';
      if (!dayOff && (!isHm(b.desiredStart) || !isHm(b.desiredEnd))) return bad('希望時間を正しく入力してください');
      return {
        ok: true,
        action: {
          type: 'shiftChangeRequest',
          shiftId: b.shiftId,
          dayOff,
          desiredStart: dayOff ? null : (b.desiredStart as string),
          desiredEnd: dayOff ? null : (b.desiredEnd as string),
          reason,
        },
      };
    }
    case 'shiftRejectChange':
      if (!isUuid(b.shiftId)) return bad('シフトが見つかりません');
      return { ok: true, action: { type: 'shiftRejectChange', shiftId: b.shiftId } };
    case 'shiftReqAdd': {
      const day = b.dayOfWeek;
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) return bad('曜日が正しくありません');
      if (!isHm(b.timeFrom) || !isHm(b.timeTo)) return bad('時刻が正しくありません');
      const n = b.requiredCount;
      // 1 未満は Server Action が「必要人数は1以上で入力してください」を返す（Web と同じことば）。ここは整数かどうかだけ
      if (typeof n !== 'number' || !Number.isInteger(n) || n > 999) return bad('必要人数は1以上で入力してください');
      return { ok: true, action: { type: 'shiftReqAdd', dayOfWeek: day, timeFrom: b.timeFrom, timeTo: b.timeTo, requiredCount: n } };
    }
    case 'shiftReqDelete':
      if (!isUuid(b.id)) return bad('必要人数設定が見つかりません');
      return { ok: true, action: { type: 'shiftReqDelete', id: b.id } };
    default:
      return bad();
  }
}
