import { isUuid } from '@/lib/native-pos';
import { CLERK_ROLES, type ClerkRole } from '@/lib/clerk-roles';

/**
 * iPad アプリのネイティブの「設定の中の画面」（2026-10-24 Ronnie「設定の中も全部ネイティブ。テーブルQRなど何でも」）。
 * Web の各設定画面と同じ Server Action を /api/app/v1/pos の POST から呼ぶ。読み込みは GET ?part=<画面>。
 *   soldout … 品切れ（/app/pos/sold-out。lib/sold-out-loader + app/app/pos/sold-out-actions）
 */
export type NativeSettingsPageAction =
  /** 品切れ：商品を売切／販売再開 */
  | { type: 'soldOutSet'; itemId: string; soldOut: boolean }
  /** POS担当者（/app/settings/clerks。app/app/settings/clerks/actions.ts） */
  | { type: 'clerkAdd'; name: string; role: ClerkRole }
  | { type: 'clerkRename'; id: string; name: string }
  | { type: 'clerkStatus'; id: string; status: 'active' | 'hidden' }
  | { type: 'clerkRole'; id: string; role: ClerkRole }
  | { type: 'clerkDelete'; id: string }
  /** 営業時間・休業日（/app/settings/hours。app/app/settings/hours/actions.ts） */
  | { type: 'hoursSave'; hours: NativeBusinessHour[] }
  | { type: 'lunchUntilSave'; lunchUntil: string }
  | { type: 'nextFloatSave'; nextFloat: number | null }
  | { type: 'holidayAdd'; date: string; name: string; isTemporary: boolean }
  | { type: 'holidayDelete'; id: string }
  /** 店舗情報（/app/settings/store。app/app/settings/store/actions.ts の updateStoreInfo） */
  | { type: 'storeSave'; store: NativeStoreFields };

export interface NativeStoreFields {
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
  description: string;
  seatCount: number | null;
  bookingEnabled: boolean;
  receiptHeader: string;
  receiptFooter: string;
  invoiceRegistrationNumber: string;
  serviceChargeRate: number;
  rounding: string;
  allowNegativeStock: boolean;
}

export interface NativeBusinessHour {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  lastEntryTime: string | null;
}

export type NativeSettingsPageActionType = NativeSettingsPageAction['type'];
export const NATIVE_SETTINGS_PAGE_ACTION_TYPES: readonly NativeSettingsPageActionType[] = [
  'soldOutSet',
  'clerkAdd',
  'clerkRename',
  'clerkStatus',
  'clerkRole',
  'clerkDelete',
  'hoursSave',
  'lunchUntilSave',
  'nextFloatSave',
  'holidayAdd',
  'holidayDelete',
  'storeSave',
];

export function isNativeSettingsPageActionType(v: unknown): v is NativeSettingsPageActionType {
  return typeof v === 'string' && (NATIVE_SETTINGS_PAGE_ACTION_TYPES as readonly string[]).includes(v);
}

type Parsed = { ok: true; action: NativeSettingsPageAction } | { ok: false; error: string };
const bad = (error = '内容が正しくありません'): Parsed => ({ ok: false, error });

export function parseNativeSettingsPageAction(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (b.type === 'soldOutSet') {
    if (!isUuid(b.itemId) || typeof b.soldOut !== 'boolean') return bad('商品の指定が正しくありません');
    return { ok: true, action: { type: 'soldOutSet', itemId: b.itemId, soldOut: b.soldOut } };
  }
  const role = (v: unknown): ClerkRole | null => (typeof v === 'string' && (CLERK_ROLES as readonly string[]).includes(v) ? (v as ClerkRole) : null);
  const name = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= 80 ? v : null);
  if (b.type === 'clerkAdd') {
    const n = name(b.name);
    const r = role(b.role ?? 'staff');
    if (!n) return bad('担当者名を入力してください');
    if (!r) return bad('役職が正しくありません');
    return { ok: true, action: { type: 'clerkAdd', name: n, role: r } };
  }
  if (b.type === 'clerkRename') {
    const n = name(b.name);
    if (!isUuid(b.id)) return bad('担当者が見つかりません');
    if (!n) return bad('担当者名を入力してください');
    return { ok: true, action: { type: 'clerkRename', id: b.id, name: n } };
  }
  if (b.type === 'clerkStatus') {
    if (!isUuid(b.id) || (b.status !== 'active' && b.status !== 'hidden')) return bad('担当者が見つかりません');
    return { ok: true, action: { type: 'clerkStatus', id: b.id, status: b.status } };
  }
  if (b.type === 'clerkRole') {
    const r = role(b.role);
    if (!isUuid(b.id)) return bad('担当者が見つかりません');
    if (!r) return bad('役職が正しくありません');
    return { ok: true, action: { type: 'clerkRole', id: b.id, role: r } };
  }
  if (b.type === 'clerkDelete') {
    if (!isUuid(b.id)) return bad('担当者が見つかりません');
    return { ok: true, action: { type: 'clerkDelete', id: b.id } };
  }
  // 営業時間・休業日
  const hhmm = (v: unknown): string | null => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : null);
  if (b.type === 'hoursSave') {
    if (!Array.isArray(b.hours) || b.hours.length !== 7) return bad('曜日が足りません');
    const hours: NativeBusinessHour[] = [];
    for (const h of b.hours as Record<string, unknown>[]) {
      const day = h?.dayOfWeek;
      if (typeof day !== 'number' || day < 0 || day > 6 || typeof h.isClosed !== 'boolean') return bad('営業時間の内容が正しくありません');
      hours.push({
        dayOfWeek: day,
        isClosed: h.isClosed,
        openTime: h.openTime == null ? null : hhmm(h.openTime),
        closeTime: h.closeTime == null ? null : hhmm(h.closeTime),
        lastEntryTime: h.lastEntryTime == null ? null : hhmm(h.lastEntryTime),
      });
    }
    return { ok: true, action: { type: 'hoursSave', hours } };
  }
  if (b.type === 'lunchUntilSave') {
    const t = hhmm(b.lunchUntil);
    if (!t) return bad('時刻は 15:00 のように入れてください');
    return { ok: true, action: { type: 'lunchUntilSave', lunchUntil: t } };
  }
  if (b.type === 'nextFloatSave') {
    if (!(b.nextFloat === null || (typeof b.nextFloat === 'number' && Number.isInteger(b.nextFloat) && b.nextFloat >= 0 && b.nextFloat <= 10_000_000))) {
      return bad('金額は 0〜10,000,000 円の整数で入れてください');
    }
    return { ok: true, action: { type: 'nextFloatSave', nextFloat: b.nextFloat as number | null } };
  }
  if (b.type === 'holidayAdd') {
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return bad('日付を選択してください');
    return { ok: true, action: { type: 'holidayAdd', date: b.date, name: typeof b.name === 'string' ? b.name.slice(0, 80) : '', isTemporary: b.isTemporary === true } };
  }
  if (b.type === 'holidayDelete') {
    if (!isUuid(b.id)) return bad('休業日が見つかりません');
    return { ok: true, action: { type: 'holidayDelete', id: b.id } };
  }
  if (b.type === 'storeSave') {
    const f = b.store as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object') return bad();
    const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '');
    const seat = f.seatCount;
    const rate = f.serviceChargeRate;
    if (!(seat === null || seat === undefined || (typeof seat === 'number' && Number.isInteger(seat) && seat >= 0 && seat <= 9999))) return bad('座席数は 0〜9999 で入れてください');
    if (typeof rate !== 'number' || rate < 0 || rate > 100) return bad('サービス料率は0〜100の範囲で入力してください');
    return {
      ok: true,
      action: {
        type: 'storeSave',
        store: {
          name: str(f.name, 100),
          nameKana: str(f.nameKana, 100),
          postalCode: str(f.postalCode, 20),
          address: str(f.address, 300),
          phone: str(f.phone, 40),
          email: str(f.email, 200),
          description: str(f.description, 2000),
          seatCount: seat == null ? null : (seat as number),
          bookingEnabled: f.bookingEnabled === true,
          receiptHeader: str(f.receiptHeader, 500),
          receiptFooter: str(f.receiptFooter, 500),
          invoiceRegistrationNumber: str(f.invoiceRegistrationNumber, 40),
          serviceChargeRate: rate,
          rounding: str(f.rounding, 10) || 'floor',
          allowNegativeStock: f.allowNegativeStock !== false,
        },
      },
    };
  }
  return bad();
}

/** 店舗情報の画面の読み込み（GET ?part=store） */
export interface NativeStorePayload {
  store: { id: string; name: string };
  canEdit: boolean;
  /** レジ端末：レシート・インボイス設定は管理画面だけ */
  receiptLocked: boolean;
  /** お客様がネットで予約するページ */
  bookingUrl: string | null;
  slug: string | null;
  fields: NativeStoreFields;
  roundings: { id: string; label: string }[];
}

/** 営業時間・休業日の画面の読み込み（GET ?part=hours） */
export interface NativeHoursPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  hours: NativeBusinessHour[];
  /** レジ精算レシートのランチ／ディナーの区切り（HH:MM） */
  lunchUntil: string;
  /** 翌準備金（毎日レジに残す金額。null＝未設定） */
  nextFloat: number | null;
  holidays: { id: string; holidayDate: string; name: string | null; isTemporary: boolean }[];
}

/** POS担当者の画面の読み込み（GET ?part=clerks） */
export interface NativeClerksPayload {
  store: { id: string; name: string };
  /** レジ端末：オーナーの担当者は削除・役職の変更ができない */
  lockOwner: boolean;
  /** 店長以上（追加・変更・削除）。無ければ見るだけ */
  canEdit: boolean;
  roles: { id: ClerkRole; label: string; en: string }[];
  rows: { id: string; name: string; status: 'active' | 'hidden'; role: ClerkRole }[];
}

/** 品切れの画面の読み込み（GET ?part=soldout） */
export interface NativeSoldOutPayload {
  store: { id: string; name: string };
  /** 全店共通の商品も切り替えられる（店長以上） */
  canManageShared: boolean;
  categories: { id: string; name: string; sortOrder: number }[];
  items: {
    id: string;
    categoryId: string | null;
    name: string;
    nameKana: string | null;
    price: number;
    isSoldOut: boolean;
    sortOrder: number;
    shared: boolean;
  }[];
}
