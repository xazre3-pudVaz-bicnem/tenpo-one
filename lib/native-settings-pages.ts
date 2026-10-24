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
  | { type: 'storeSave'; store: NativeStoreFields }
  /** 税率（/app/settings/tax。saveTaxRate / deleteTaxRate） */
  | { type: 'taxSave'; id: string | null; name: string; rate: number; isReduced: boolean; isInclusive: boolean; isDefault: boolean }
  | { type: 'taxDelete'; id: string }
  /** 会員・ポイント（/app/settings/loyalty。saveLoyaltySettings） */
  | { type: 'loyaltySave'; enabled: boolean; yenPerPoint: number; pointValue: number; expiryMonths: number | null }
  /** 異常検知の閾値（/app/settings/alerts。upsertAlertRule / resetAlertRuleToDefault。scope: store＝この店／org＝企業既定） */
  | { type: 'alertSave'; scope: 'store' | 'org'; ruleKey: string; threshold: number; enabled: boolean }
  | { type: 'alertReset'; ruleKey: string }
  /** 承認ルール（/app/settings/approvals。saveApprovalRule / deleteApprovalRule） */
  | {
      type: 'approvalSave';
      id: string | null;
      target: 'invoice' | 'expense' | 'petty_cash' | 'purchase_order';
      minAmount: number;
      maxAmount: number | null;
      approverRole: 'store_manager' | 'area_manager' | 'hq_accounting' | 'hq_admin' | 'org_owner';
      allowSelfApprove: boolean;
    }
  | { type: 'approvalDelete'; id: string }
  /** 勘定科目（/app/settings/accounts。saveAccount / deleteAccount / installStandardAccounts） */
  | { type: 'accountSave'; id: string | null; code: string; name: string; category: string; subType: string | null; defaultTaxTreatment: string; sortOrder: number }
  | { type: 'accountDelete'; id: string }
  | { type: 'accountInstallStandard' }
  /** ハンディ端末（/app/settings/handy。issueHandyPairing / revokeHandyDevice / renameHandyDevice） */
  | { type: 'handyIssue'; deviceName: string }
  | { type: 'handyRevoke'; id: string }
  | { type: 'handyRename'; id: string; name: string }
  /** カテゴリ（/app/settings/categories。saveCategory / deleteCategory / updateCategoryStation） */
  | { type: 'categorySave'; id: string | null; name: string; nameEn: string; color: string; sortOrder: number }
  | { type: 'categoryDelete'; id: string }
  | { type: 'categoryStation'; id: string; station: string };

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
  'taxSave',
  'taxDelete',
  'loyaltySave',
  'alertSave',
  'alertReset',
  'approvalSave',
  'approvalDelete',
  'accountSave',
  'accountDelete',
  'accountInstallStandard',
  'handyIssue',
  'handyRevoke',
  'handyRename',
  'categorySave',
  'categoryDelete',
  'categoryStation',
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
  if (b.type === 'taxSave') {
    const n = typeof b.name === 'string' ? b.name.trim().slice(0, 50) : '';
    if (!n) return bad('税率名を入力してください');
    if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 100) return bad('税率は0〜100の範囲で入力してください');
    const id = b.id == null || b.id === '' ? null : isUuid(b.id) ? b.id : false;
    if (id === false) return bad('税率が見つかりません');
    return { ok: true, action: { type: 'taxSave', id, name: n, rate: b.rate, isReduced: b.isReduced === true, isInclusive: b.isInclusive === true, isDefault: b.isDefault === true } };
  }
  if (b.type === 'taxDelete') {
    if (!isUuid(b.id)) return bad('税率が見つかりません');
    return { ok: true, action: { type: 'taxDelete', id: b.id } };
  }
  if (b.type === 'loyaltySave') {
    const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!pos(b.yenPerPoint)) return bad('円/pt は1以上で入力してください');
    if (!pos(b.pointValue)) return bad('pt単価は1以上で入力してください');
    if (!(b.expiryMonths === null || b.expiryMonths === undefined || (typeof b.expiryMonths === 'number' && Number.isInteger(b.expiryMonths) && b.expiryMonths > 0))) {
      return bad('失効月数は1以上で入力してください（無期限の場合は空欄）');
    }
    return {
      ok: true,
      action: { type: 'loyaltySave', enabled: b.enabled === true, yenPerPoint: b.yenPerPoint as number, pointValue: b.pointValue as number, expiryMonths: (b.expiryMonths as number | null | undefined) ?? null },
    };
  }
  if (b.type === 'alertSave') {
    if (typeof b.ruleKey !== 'string' || !/^[a-z_]{1,60}$/.test(b.ruleKey)) return bad('不正な項目です');
    if (typeof b.threshold !== 'number' || !Number.isFinite(b.threshold) || b.threshold < 0) return bad('閾値を正しく入力してください');
    return { ok: true, action: { type: 'alertSave', scope: b.scope === 'org' ? 'org' : 'store', ruleKey: b.ruleKey, threshold: b.threshold, enabled: b.enabled !== false } };
  }
  if (b.type === 'alertReset') {
    if (typeof b.ruleKey !== 'string' || !/^[a-z_]{1,60}$/.test(b.ruleKey)) return bad('不正な項目です');
    return { ok: true, action: { type: 'alertReset', ruleKey: b.ruleKey } };
  }
  if (b.type === 'approvalSave') {
    const targets = ['invoice', 'expense', 'petty_cash', 'purchase_order'] as const;
    const roles = ['store_manager', 'area_manager', 'hq_accounting', 'hq_admin', 'org_owner'] as const;
    const target = targets.find((t) => t === b.target);
    const role = roles.find((r) => r === b.approverRole);
    if (!target) return bad('対象が正しくありません');
    if (!role) return bad('承認ロールが正しくありません');
    if (typeof b.minAmount !== 'number' || !Number.isInteger(b.minAmount) || b.minAmount < 0) return bad('下限金額は0以上の整数で入力してください');
    if (!(b.maxAmount === null || b.maxAmount === undefined || (typeof b.maxAmount === 'number' && Number.isInteger(b.maxAmount)))) return bad('上限金額は整数で入力してください（空欄=上限なし）');
    const id = b.id == null || b.id === '' ? null : isUuid(b.id) ? b.id : false;
    if (id === false) return bad('ルールが見つかりません');
    return {
      ok: true,
      action: { type: 'approvalSave', id, target, minAmount: b.minAmount, maxAmount: (b.maxAmount as number | null | undefined) ?? null, approverRole: role, allowSelfApprove: b.allowSelfApprove === true },
    };
  }
  if (b.type === 'approvalDelete') {
    if (!isUuid(b.id)) return bad('ルールが見つかりません');
    return { ok: true, action: { type: 'approvalDelete', id: b.id } };
  }
  if (b.type === 'accountSave') {
    const cats = ['asset', 'liability', 'equity', 'revenue', 'expense'];
    const taxes = ['taxable_standard', 'taxable_reduced', 'non_taxable', 'tax_exempt', 'out_of_scope'];
    const subs = ['cash', 'bank', 'receivable', 'payable', 'inventory'];
    const code = typeof b.code === 'string' ? b.code.trim().slice(0, 20) : '';
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    if (!code) return bad('科目コードを入力してください');
    if (!name) return bad('科目名を入力してください');
    if (typeof b.category !== 'string' || !cats.includes(b.category)) return bad('区分が正しくありません');
    if (typeof b.defaultTaxTreatment !== 'string' || !taxes.includes(b.defaultTaxTreatment)) return bad('税区分が正しくありません');
    const subType = b.subType == null || b.subType === '' ? null : typeof b.subType === 'string' && subs.includes(b.subType) ? b.subType : false;
    if (subType === false) return bad('補助区分が正しくありません');
    const id = b.id == null || b.id === '' ? null : isUuid(b.id) ? b.id : false;
    if (id === false) return bad('科目が見つかりません');
    const sortOrder = typeof b.sortOrder === 'number' && Number.isInteger(b.sortOrder) ? b.sortOrder : 0;
    return { ok: true, action: { type: 'accountSave', id, code, name, category: b.category, subType, defaultTaxTreatment: b.defaultTaxTreatment, sortOrder } };
  }
  if (b.type === 'accountDelete') {
    if (!isUuid(b.id)) return bad('科目が見つかりません');
    return { ok: true, action: { type: 'accountDelete', id: b.id } };
  }
  if (b.type === 'accountInstallStandard') return { ok: true, action: { type: 'accountInstallStandard' } };
  if (b.type === 'handyIssue') {
    const n = typeof b.deviceName === 'string' ? b.deviceName.trim().slice(0, 40) : '';
    if (!n) return bad('端末の名前を入力してください');
    return { ok: true, action: { type: 'handyIssue', deviceName: n } };
  }
  if (b.type === 'handyRevoke') {
    if (!isUuid(b.id)) return bad('端末が見つかりません');
    return { ok: true, action: { type: 'handyRevoke', id: b.id } };
  }
  if (b.type === 'handyRename') {
    const n = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
    if (!isUuid(b.id)) return bad('端末が見つかりません');
    if (!n) return bad('端末の名前を入力してください');
    return { ok: true, action: { type: 'handyRename', id: b.id, name: n } };
  }
  if (b.type === 'categorySave') {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    if (!name) return bad('カテゴリ名を入力してください');
    const color = typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#bc5940';
    const id = b.id == null || b.id === '' ? null : isUuid(b.id) ? b.id : false;
    if (id === false) return bad('カテゴリが見つかりません');
    return { ok: true, action: { type: 'categorySave', id, name, nameEn: typeof b.nameEn === 'string' ? b.nameEn.slice(0, 80) : '', color, sortOrder: typeof b.sortOrder === 'number' && Number.isInteger(b.sortOrder) ? b.sortOrder : 0 } };
  }
  if (b.type === 'categoryDelete') {
    if (!isUuid(b.id)) return bad('カテゴリが見つかりません');
    return { ok: true, action: { type: 'categoryDelete', id: b.id } };
  }
  if (b.type === 'categoryStation') {
    if (!isUuid(b.id)) return bad('カテゴリが見つかりません');
    if (typeof b.station !== 'string' || !/^[a-z_]{1,20}$/.test(b.station)) return bad('ステーションの指定が不正です');
    return { ok: true, action: { type: 'categoryStation', id: b.id, station: b.station } };
  }
  return bad();
}

/** カテゴリの画面の読み込み（GET ?part=categories） */
export interface NativeCategoriesPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  colors: string[];
  stations: { id: string; label: string }[];
  rows: { id: string; name: string; nameEn: string; color: string; sortOrder: number; station: string; shared: boolean }[];
}

/** ハンディ端末の画面の読み込み（GET ?part=handy） */
export interface NativeHandyDevicesPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  /** QR に入れる登録ページ（siteUrl + /handy-pair#code）。無ければ QR を作れない */
  pairBase: string | null;
  devices: { id: string; name: string; status: 'active' | 'revoked'; pairedAt: string; lastSeenAt: string | null; pairedIp: string | null; userAgent: string | null }[];
}

/** 勘定科目の画面の読み込み（GET ?part=accounts） */
export interface NativeAccountsPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  categories: { id: string; label: string }[];
  subTypes: { id: string; label: string }[];
  taxTreatments: { id: string; label: string }[];
  rows: { id: string; code: string; name: string; category: string; subType: string | null; defaultTaxTreatment: string; isSystem: boolean; sortOrder: number }[];
}

/** 異常検知の閾値の画面の読み込み（GET ?part=alerts） */
export interface NativeAlertsPayload {
  store: { id: string; name: string };
  canEditStore: boolean;
  canEditOrg: boolean;
  items: {
    ruleKey: string;
    label: string;
    unit: string;
    defaultValue: number;
    orgValue: number | null;
    orgEnabled: boolean;
    storeValue: number | null;
    storeEnabled: boolean;
    effectiveValue: number;
    effectiveSource: 'store' | 'org' | 'default';
  }[];
}

/** 承認ルールの画面の読み込み（GET ?part=approvals） */
export interface NativeApprovalsPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  targets: { id: string; label: string }[];
  roles: { id: string; label: string }[];
  rows: { id: string; target: string; minAmount: number; maxAmount: number | null; approverRole: string; allowSelfApprove: boolean }[];
}

/** 税率の画面の読み込み（GET ?part=tax） */
export interface NativeTaxPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  rows: { id: string; name: string; rate: number; isReduced: boolean; isInclusive: boolean; isDefault: boolean }[];
}

/** 会員・ポイントの画面の読み込み（GET ?part=loyalty） */
export interface NativeLoyaltyPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  enabled: boolean;
  yenPerPoint: number;
  pointValue: number;
  expiryMonths: number | null;
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
