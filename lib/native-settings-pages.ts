import { isUuid } from '@/lib/native-pos';
import { CLERK_ROLES, type ClerkRole } from '@/lib/clerk-roles';
import { parseCourseBuilderInput, type CourseBuilderInput } from '@/lib/course-builder';

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
  | { type: 'categoryStation'; id: string; station: string }
  /** メニュー・プラン（/app/settings/menu・/app/settings/plans。saveMenuItem / deleteMenuItem / toggleSoldOut） */
  | { type: 'menuItemSave'; item: NativeMenuItemFields }
  | { type: 'menuItemDelete'; id: string }
  | { type: 'menuItemSoldOut'; id: string; soldOut: boolean }
  /**
   * コース／放題プランを1回で保存（設定 › プラン の作成画面。lib/course-builder.ts・lib/course-builder-server.ts）。
   * コース本体・料理（出す順。名前だけの料理は ¥0・非表示で作る）・選べるメイン・プランで出すカテゴリ
   */
  | { type: 'courseBuilderSave'; input: CourseBuilderInput }
  /** オプション（/app/settings/options。app/app/settings/options/actions.ts） */
  | { type: 'optionGroupSave'; id: string | null; name: string; isRequired: boolean; minSelect: number; maxSelect: number }
  | { type: 'optionGroupDelete'; id: string }
  | { type: 'optionGroupMove'; id: string; direction: 'up' | 'down' }
  | { type: 'optionItemAdd'; groupId: string; name: string; nameEn: string; price: number }
  | { type: 'optionItemDelete'; id: string }
  | { type: 'optionGroupItems'; groupId: string; menuItemIds: string[] }
  /** QRのサービス（/app/settings/qr-service。saveQrService） */
  | { type: 'qrServiceSave'; enabled: boolean; items: { name: string; nameEn: string | null }[] }
  /** メニューブック（/app/settings/menu-book。app/app/settings/menu-book/actions.ts） */
  | { type: 'menuBookLayout'; rows: { id: string; show: string }[] }
  | { type: 'menuBookItemOrder'; categoryId: string; itemIds: string[] }
  | { type: 'menuBookPlans'; rows: { planItemId: string; categoryIds: string[] | null }[] }
  | { type: 'menuBookPages'; pages: { key: string; name: string }[]; categoryPage: Record<string, string> }
  | { type: 'menuBookLunch'; start: string; end: string }
  | { type: 'menuBookTakeout'; itemIds: string[] }
  /** 決済・端末（/app/settings/payments。actions.ts・stera-actions.ts） */
  | { type: 'checkoutPresetsSave'; discounts: NativeDiscountPreset[]; pointBrands: NativePointBrand[]; methodBrands: Record<string, NativePointBrand[]> }
  | { type: 'readerAdd'; label: string }
  | { type: 'readerDelete'; id: string }
  | { type: 'bookingPaymentSave'; mode: 'onsite' | 'prepay_full' | 'deposit'; depositAmount: number }
  | { type: 'steraAdd'; name: string; terminalNo: string }
  | { type: 'steraUpdate'; id: string; name?: string; terminalNo?: string; active?: boolean }
  | { type: 'steraRegen'; id: string }
  | { type: 'steraDelete'; id: string }
  /** スタッフ管理（/app/staff。app/app/staff/actions.ts） */
  | { type: 'staffInvite'; email: string; displayName: string; displayNameKana: string; role: string; storeIds: string[] }
  | { type: 'staffRole'; membershipId: string; profileId: string; role: string; storeIds: string[] }
  | { type: 'staffStores'; membershipId: string; profileId: string; storeIds: string[] }
  | { type: 'staffPin'; membershipId: string; profileId: string; pin: string }
  | { type: 'staffStatus'; membershipId: string; profileId: string; status: 'active' | 'suspended' }
  | { type: 'staffPasswordReset'; membershipId: string; profileId: string }
  /** 予約台帳設定（/app/settings/reservation-book。actions.ts・reminder-actions.ts） */
  | { type: 'gourmetMailEnabled'; enabled: boolean }
  | { type: 'gourmetMailRegenerate' }
  | { type: 'gourmetSiteRegistered'; site: string; registered: boolean }
  | { type: 'gourmetImportResolve'; importId: string }
  | { type: 'snsLinksSave'; instagram: string; line: string; facebook: string; x: string }
  | { type: 'icalRegenerate' }
  | { type: 'icalRevoke' }
  | { type: 'remindersPrepare' }
  /** 企業情報（/app/settings/company。actions.ts） */
  | { type: 'companySave'; company: NativeCompanyFields }
  | { type: 'kpiSave'; includeTakeoutGuests: boolean }
  /** テーブル・フロア（/app/settings/tables。actions.ts。管理画面だけ＝レジ端末からは Server Action 側が断る） */
  | { type: 'floorAdd'; name: string }
  | { type: 'floorRename'; id: string; name: string }
  | { type: 'floorDelete'; id: string }
  | { type: 'floorDefault'; id: string | null }
  | { type: 'tableSave'; table: NativeTableFields }
  | { type: 'tableDelete'; id: string }
  | { type: 'tableAvailable'; id: string; available: boolean }
  | { type: 'tablesReorderByName' }
  /** ダイナミックプライシング（/app/settings/dynamic-pricing。saveDynamicPricing。中身の確認は lib/dynamic-pricing.ts） */
  | { type: 'dynamicPricingSave'; rules: unknown[] }
  /** メニュー一括編集（/app/settings/menu-bulk。saveMenuBulk。中身の確認は lib/menu-bulk.ts） */
  | { type: 'menuBulkSave'; patches: NativeBulkPatch[] }
  /** データ取込（/app/settings/import。CSV の中身はサーバーで読む） */
  | { type: 'importPreview'; importType: string; csv: string }
  | { type: 'importRun'; importType: string; rows: { rowNumber: number; values: Record<string, string> }[] }
  /** 写真・PDFからメニュー（/app/settings/menu/scan）。iPad が読み取った行を Web と同じ parseMenuLines で商品に分ける */
  | { type: 'menuScanParse'; lines: string[] };

export interface NativeBulkPatch {
  id: string;
  name?: string;
  nameEn?: string;
  categoryId?: string | null;
  itemType?: string;
  price?: number;
  takeoutPrice?: number | null;
  status?: 'active' | 'hidden';
  isSoldOut?: boolean;
}

export interface NativeTableFields {
  id: string | null;
  floorId: string | null;
  name: string;
  capacityMin: number;
  capacityMax: number;
  isPrivateRoom: boolean;
  isCounter: boolean;
  smokingAllowed: boolean;
  sortOrder: number;
}

export interface NativeCompanyFields {
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
  billingName: string;
  billingEmail: string;
  billingNote: string;
}

export interface NativePointBrand {
  key: string;
  name: string;
}
export interface NativeDiscountPreset extends NativePointBrand {
  kind: 'percent' | 'amount' | 'manual';
  value: number;
}

export interface NativeMenuItemFields {
  id: string | null;
  categoryId: string | null;
  name: string;
  nameEn: string;
  nameKana: string;
  description: string;
  itemType: 'food' | 'drink' | 'course' | 'option';
  price: number;
  takeoutPrice: number | null;
  cost: number | null;
  taxRateId: string | null;
  durationMinutes: number | null;
  sellStartTime: string | null;
  sellEndTime: string | null;
  sortOrder: number;
  status: 'active' | 'hidden';
}

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
  'menuItemSave',
  'menuItemDelete',
  'menuItemSoldOut',
  'courseBuilderSave',
  'optionGroupSave',
  'optionGroupDelete',
  'optionGroupMove',
  'optionItemAdd',
  'optionItemDelete',
  'optionGroupItems',
  'qrServiceSave',
  'menuBookLayout',
  'menuBookItemOrder',
  'menuBookPlans',
  'menuBookPages',
  'menuBookLunch',
  'menuBookTakeout',
  'checkoutPresetsSave',
  'readerAdd',
  'readerDelete',
  'bookingPaymentSave',
  'steraAdd',
  'steraUpdate',
  'steraRegen',
  'steraDelete',
  'staffInvite',
  'staffRole',
  'staffStores',
  'staffPin',
  'staffStatus',
  'staffPasswordReset',
  'gourmetMailEnabled',
  'gourmetMailRegenerate',
  'gourmetSiteRegistered',
  'gourmetImportResolve',
  'snsLinksSave',
  'icalRegenerate',
  'icalRevoke',
  'remindersPrepare',
  'companySave',
  'kpiSave',
  'floorAdd',
  'floorRename',
  'floorDelete',
  'floorDefault',
  'tableSave',
  'tableDelete',
  'tableAvailable',
  'tablesReorderByName',
  'dynamicPricingSave',
  'menuBulkSave',
  'importPreview',
  'importRun',
  'menuScanParse',
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
  if (b.type === 'menuItemSave') {
    const f = b.item as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object') return bad();
    const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
    const numOrNull = (v: unknown): number | null | false => (v == null || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : false);
    const types = ['food', 'drink', 'course', 'option'] as const;
    const itemType = types.find((t) => t === f.itemType);
    if (!itemType) return bad('種別の指定が不正です');
    if (!str(f.name).trim()) return bad('商品名を入力してください');
    if (typeof f.price !== 'number' || !Number.isFinite(f.price) || f.price < 0) return bad('価格は0以上で入力してください');
    const takeout = numOrNull(f.takeoutPrice);
    const cost = numOrNull(f.cost);
    const duration = numOrNull(f.durationMinutes);
    if (takeout === false || cost === false || duration === false) return bad('金額・時間は0以上で入力してください');
    const uuidOrNull = (v: unknown): string | null | false => (v == null || v === '' ? null : isUuid(v) ? v : false);
    const id = uuidOrNull(f.id);
    const categoryId = uuidOrNull(f.categoryId);
    const taxRateId = uuidOrNull(f.taxRateId);
    if (id === false || categoryId === false || taxRateId === false) return bad('指定が正しくありません');
    const hhmm = (v: unknown): string | null => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : null);
    return {
      ok: true,
      action: {
        type: 'menuItemSave',
        item: {
          id,
          categoryId,
          name: str(f.name, 120),
          nameEn: str(f.nameEn, 120),
          nameKana: str(f.nameKana, 120),
          description: str(f.description, 1000),
          itemType,
          price: Math.round(f.price),
          takeoutPrice: takeout == null ? null : Math.round(takeout),
          cost: cost == null ? null : Math.round(cost),
          taxRateId,
          durationMinutes: duration == null ? null : Math.round(duration),
          sellStartTime: hhmm(f.sellStartTime),
          sellEndTime: hhmm(f.sellEndTime),
          sortOrder: typeof f.sortOrder === 'number' && Number.isInteger(f.sortOrder) ? f.sortOrder : 0,
          status: f.status === 'hidden' ? 'hidden' : 'active',
        },
      },
    };
  }
  if (b.type === 'menuItemDelete') {
    if (!isUuid(b.id)) return bad('商品が見つかりません');
    return { ok: true, action: { type: 'menuItemDelete', id: b.id } };
  }
  if (b.type === 'menuItemSoldOut') {
    if (!isUuid(b.id) || typeof b.soldOut !== 'boolean') return bad('商品が見つかりません');
    return { ok: true, action: { type: 'menuItemSoldOut', id: b.id, soldOut: b.soldOut } };
  }
  if (b.type === 'courseBuilderSave') {
    const r = parseCourseBuilderInput(b);
    if (!r.ok) return bad(r.error);
    return { ok: true, action: { type: 'courseBuilderSave', input: r.input } };
  }
  if (b.type === 'optionGroupSave') {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    if (!name) return bad('グループ名を入力してください');
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99 ? v : null);
    const mn = n(b.minSelect);
    const mx = n(b.maxSelect);
    if (mn === null || mx === null) return bad('選ぶ数は 0〜99 で入れてください');
    const id = b.id == null || b.id === '' ? null : isUuid(b.id) ? b.id : false;
    if (id === false) return bad('グループが見つかりません');
    return { ok: true, action: { type: 'optionGroupSave', id, name, isRequired: b.isRequired === true, minSelect: mn, maxSelect: mx } };
  }
  if (b.type === 'optionGroupDelete') {
    if (!isUuid(b.id)) return bad('グループが見つかりません');
    return { ok: true, action: { type: 'optionGroupDelete', id: b.id } };
  }
  if (b.type === 'optionGroupMove') {
    if (!isUuid(b.id) || (b.direction !== 'up' && b.direction !== 'down')) return bad('グループが見つかりません');
    return { ok: true, action: { type: 'optionGroupMove', id: b.id, direction: b.direction } };
  }
  if (b.type === 'optionItemAdd') {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    if (!isUuid(b.groupId)) return bad('グループが見つかりません');
    if (!name) return bad('選択肢の名前を入力してください');
    if (typeof b.price !== 'number' || !Number.isFinite(b.price)) return bad('追加料金は数字で入れてください');
    return { ok: true, action: { type: 'optionItemAdd', groupId: b.groupId, name, nameEn: typeof b.nameEn === 'string' ? b.nameEn.slice(0, 80) : '', price: Math.round(b.price) } };
  }
  if (b.type === 'optionItemDelete') {
    if (!isUuid(b.id)) return bad('選択肢が見つかりません');
    return { ok: true, action: { type: 'optionItemDelete', id: b.id } };
  }
  if (b.type === 'optionGroupItems') {
    if (!isUuid(b.groupId)) return bad('グループが見つかりません');
    if (!Array.isArray(b.menuItemIds) || b.menuItemIds.length > 2000 || !b.menuItemIds.every((x) => isUuid(x))) return bad('商品の指定が正しくありません');
    return { ok: true, action: { type: 'optionGroupItems', groupId: b.groupId, menuItemIds: b.menuItemIds as string[] } };
  }
  if (b.type === 'qrServiceSave') {
    if (!Array.isArray(b.items) || b.items.length > 50) return bad('サービスの数が多すぎます');
    const items = (b.items as Record<string, unknown>[]).map((i) => ({
      name: typeof i?.name === 'string' ? i.name.slice(0, 40) : '',
      nameEn: typeof i?.nameEn === 'string' && i.nameEn.trim() ? i.nameEn.slice(0, 40) : null,
    }));
    return { ok: true, action: { type: 'qrServiceSave', enabled: b.enabled !== false, items } };
  }
  const ids = (v: unknown, max = 1000): string[] | null => (Array.isArray(v) && v.length <= max && v.every((x) => isUuid(x)) ? (v as string[]) : null);
  if (b.type === 'menuBookLayout') {
    if (!Array.isArray(b.rows) || b.rows.length > 500) return bad('カテゴリの指定が正しくありません');
    const rows: { id: string; show: string }[] = [];
    for (const r of b.rows as Record<string, unknown>[]) {
      if (!isUuid(r?.id) || typeof r.show !== 'string' || !/^[a-z]{1,12}$/.test(r.show)) return bad('カテゴリの指定が正しくありません');
      rows.push({ id: r.id as string, show: r.show });
    }
    return { ok: true, action: { type: 'menuBookLayout', rows } };
  }
  if (b.type === 'menuBookItemOrder') {
    const list = ids(b.itemIds);
    if (!isUuid(b.categoryId) || !list || list.length === 0) return bad('商品の指定が正しくありません');
    return { ok: true, action: { type: 'menuBookItemOrder', categoryId: b.categoryId, itemIds: list } };
  }
  if (b.type === 'menuBookPlans') {
    if (!Array.isArray(b.rows) || b.rows.length > 500) return bad('プランの指定が正しくありません');
    const rows: { planItemId: string; categoryIds: string[] | null }[] = [];
    for (const r of b.rows as Record<string, unknown>[]) {
      if (!isUuid(r?.planItemId)) return bad('プランの指定が正しくありません');
      const c = r.categoryIds == null ? null : ids(r.categoryIds, 500);
      if (r.categoryIds != null && c === null) return bad('カテゴリの指定が正しくありません');
      rows.push({ planItemId: r.planItemId as string, categoryIds: c });
    }
    return { ok: true, action: { type: 'menuBookPlans', rows } };
  }
  if (b.type === 'menuBookPages') {
    if (!Array.isArray(b.pages) || b.pages.length > 30) return bad('ページの指定が正しくありません');
    const pages: { key: string; name: string }[] = [];
    for (const pg of b.pages as Record<string, unknown>[]) {
      if (typeof pg?.key !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(pg.key) || typeof pg.name !== 'string') return bad('ページの指定が正しくありません');
      pages.push({ key: pg.key, name: pg.name.slice(0, 40) });
    }
    const categoryPage: Record<string, string> = {};
    if (b.categoryPage && typeof b.categoryPage === 'object') {
      for (const [k, v] of Object.entries(b.categoryPage as Record<string, unknown>)) {
        if (isUuid(k) && typeof v === 'string' && /^[a-z0-9_-]{1,32}$/.test(v)) categoryPage[k] = v;
      }
    }
    return { ok: true, action: { type: 'menuBookPages', pages, categoryPage } };
  }
  if (b.type === 'menuBookLunch') {
    const hm = (v: unknown) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : null);
    const st = hm(b.start);
    const en = hm(b.end);
    if (!st || !en) return bad('時刻は HH:MM で指定してください');
    return { ok: true, action: { type: 'menuBookLunch', start: st, end: en } };
  }
  if (b.type === 'menuBookTakeout') {
    const list = ids(b.itemIds, 2000);
    if (!list) return bad('商品の指定が正しくありません');
    return { ok: true, action: { type: 'menuBookTakeout', itemIds: list } };
  }
  // 決済・端末
  const brandList = (v: unknown): NativePointBrand[] | null => {
    if (!Array.isArray(v) || v.length > 20) return null;
    const out: NativePointBrand[] = [];
    for (const b of v as Record<string, unknown>[]) {
      if (typeof b?.key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(b.key) || typeof b.name !== 'string') return null;
      out.push({ key: b.key, name: b.name.slice(0, 20) });
    }
    return out;
  };
  if (b.type === 'checkoutPresetsSave') {
    const brands = brandList(b.pointBrands);
    if (!Array.isArray(b.discounts) || b.discounts.length > 20 || !brands) return bad('選択肢の指定が正しくありません');
    const discounts: NativeDiscountPreset[] = [];
    for (const d of b.discounts as Record<string, unknown>[]) {
      const kind = d?.kind === 'percent' || d?.kind === 'amount' || d?.kind === 'manual' ? d.kind : null;
      if (typeof d?.key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(d.key) || typeof d.name !== 'string' || !kind) return bad('値引きの指定が正しくありません');
      const value = typeof d.value === 'number' && Number.isFinite(d.value) ? Math.floor(d.value) : 0;
      discounts.push({ key: d.key, name: d.name.slice(0, 20), kind, value });
    }
    const methodBrands: Record<string, NativePointBrand[]> = {};
    if (b.methodBrands && typeof b.methodBrands === 'object' && !Array.isArray(b.methodBrands)) {
      for (const [m, list] of Object.entries(b.methodBrands as Record<string, unknown>)) {
        if (!/^[a-z_]{1,20}$/.test(m)) continue;
        const l = brandList(list);
        if (!l) return bad('支払方法の種類の指定が正しくありません');
        methodBrands[m] = l;
      }
    }
    return { ok: true, action: { type: 'checkoutPresetsSave', discounts, pointBrands: brands, methodBrands } };
  }
  if (b.type === 'readerAdd') {
    if (typeof b.label !== 'string' || !b.label.trim() || b.label.length > 60) return bad('端末名を入力してください');
    return { ok: true, action: { type: 'readerAdd', label: b.label.trim() } };
  }
  if (b.type === 'readerDelete') {
    if (!isUuid(b.id)) return bad('端末が見つかりません');
    return { ok: true, action: { type: 'readerDelete', id: b.id } };
  }
  if (b.type === 'bookingPaymentSave') {
    if (b.mode !== 'onsite' && b.mode !== 'prepay_full' && b.mode !== 'deposit') return bad('予約決済方法の指定が不正です');
    if (typeof b.depositAmount !== 'number' || !Number.isInteger(b.depositAmount) || b.depositAmount < 0 || b.depositAmount > 10_000_000) return bad('予約金額の指定が正しくありません');
    return { ok: true, action: { type: 'bookingPaymentSave', mode: b.mode, depositAmount: b.depositAmount } };
  }
  const short = (v: unknown, max = 40): string | null => (typeof v === 'string' && v.length <= max ? v : null);
  if (b.type === 'steraAdd') {
    const n = short(b.name);
    if (!n || !n.trim()) return bad('端末の名前を入れてください');
    return { ok: true, action: { type: 'steraAdd', name: n.trim(), terminalNo: short(b.terminalNo) ?? '' } };
  }
  if (b.type === 'steraUpdate') {
    if (!isUuid(b.id)) return bad('端末が見つかりません');
    const a: Extract<NativeSettingsPageAction, { type: 'steraUpdate' }> = { type: 'steraUpdate', id: b.id };
    if (b.name !== undefined) {
      const n = short(b.name);
      if (!n || !n.trim()) return bad('端末の名前を入れてください');
      a.name = n.trim();
    }
    if (b.terminalNo !== undefined) {
      const t = short(b.terminalNo);
      if (t === null) return bad('端末番号が長すぎます');
      a.terminalNo = t;
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') return bad();
      a.active = b.active;
    }
    return { ok: true, action: a };
  }
  if (b.type === 'steraRegen' || b.type === 'steraDelete') {
    if (!isUuid(b.id)) return bad('端末が見つかりません');
    return { ok: true, action: { type: b.type, id: b.id } };
  }
  // スタッフ管理（細かい確認は Server Action 側と同じ。ここは形だけ）
  const member = (): { membershipId: string; profileId: string } | null => (isUuid(b.membershipId) && isUuid(b.profileId) ? { membershipId: b.membershipId, profileId: b.profileId } : null);
  if (b.type === 'staffInvite') {
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    const dn = typeof b.displayName === 'string' ? b.displayName.trim() : '';
    if (!email || email.length > 254) return bad('メールアドレスを入力してください');
    if (!dn || dn.length > 80) return bad('氏名を入力してください');
    if (typeof b.role !== 'string' || !b.role) return bad('不正なロールです');
    const st = ids(b.storeIds ?? [], 200);
    if (!st) return bad('店舗の指定が正しくありません');
    return { ok: true, action: { type: 'staffInvite', email, displayName: dn, displayNameKana: typeof b.displayNameKana === 'string' ? b.displayNameKana.trim().slice(0, 80) : '', role: b.role, storeIds: st } };
  }
  if (b.type === 'staffRole') {
    const m = member();
    const st = ids(b.storeIds ?? [], 200);
    if (!m) return bad('対象のスタッフが見つかりません');
    if (typeof b.role !== 'string' || !b.role) return bad('不正なロールです');
    if (!st) return bad('店舗の指定が正しくありません');
    return { ok: true, action: { type: 'staffRole', ...m, role: b.role, storeIds: st } };
  }
  if (b.type === 'staffStores') {
    const m = member();
    const st = ids(b.storeIds, 200);
    if (!m) return bad('対象のスタッフが見つかりません');
    if (!st) return bad('店舗の指定が正しくありません');
    return { ok: true, action: { type: 'staffStores', ...m, storeIds: st } };
  }
  if (b.type === 'staffPin') {
    const m = member();
    if (!m) return bad('対象のスタッフが見つかりません');
    if (typeof b.pin !== 'string' || !/^\d{4,6}$/.test(b.pin)) return bad('PINは4〜6桁の数字で入力してください');
    return { ok: true, action: { type: 'staffPin', ...m, pin: b.pin } };
  }
  if (b.type === 'staffStatus') {
    const m = member();
    if (!m) return bad('対象のスタッフが見つかりません');
    if (b.status !== 'active' && b.status !== 'suspended') return bad('状態の指定が正しくありません');
    return { ok: true, action: { type: 'staffStatus', ...m, status: b.status } };
  }
  if (b.type === 'staffPasswordReset') {
    const m = member();
    if (!m) return bad('対象のスタッフが見つかりません');
    return { ok: true, action: { type: 'staffPasswordReset', ...m } };
  }
  // 予約台帳設定
  if (b.type === 'gourmetMailEnabled') {
    if (typeof b.enabled !== 'boolean') return bad();
    return { ok: true, action: { type: 'gourmetMailEnabled', enabled: b.enabled } };
  }
  if (b.type === 'gourmetMailRegenerate' || b.type === 'icalRegenerate' || b.type === 'icalRevoke' || b.type === 'remindersPrepare') {
    return { ok: true, action: { type: b.type } };
  }
  if (b.type === 'gourmetSiteRegistered') {
    if (typeof b.site !== 'string' || !/^[a-z_]{1,20}$/.test(b.site) || typeof b.registered !== 'boolean') return bad('対象のサイトがありません');
    return { ok: true, action: { type: 'gourmetSiteRegistered', site: b.site, registered: b.registered } };
  }
  if (b.type === 'gourmetImportResolve') {
    if (!isUuid(b.importId)) return bad('メールが見つかりません');
    return { ok: true, action: { type: 'gourmetImportResolve', importId: b.importId } };
  }
  if (b.type === 'snsLinksSave') {
    const url = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : '');
    return { ok: true, action: { type: 'snsLinksSave', instagram: url(b.instagram), line: url(b.line), facebook: url(b.facebook), x: url(b.x) } };
  }
  // 企業情報
  if (b.type === 'companySave') {
    const c = (b.company ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
    const company: NativeCompanyFields = {
      name: str(c.name, 100),
      nameKana: str(c.nameKana, 100),
      postalCode: str(c.postalCode, 20),
      address: str(c.address, 300),
      phone: str(c.phone, 40),
      billingName: str(c.billingName, 100),
      billingEmail: str(c.billingEmail, 254),
      billingNote: str(c.billingNote, 1000),
    };
    if (!company.name.trim()) return bad('会社名を入力してください');
    return { ok: true, action: { type: 'companySave', company } };
  }
  if (b.type === 'kpiSave') {
    if (typeof b.includeTakeoutGuests !== 'boolean') return bad();
    return { ok: true, action: { type: 'kpiSave', includeTakeoutGuests: b.includeTakeoutGuests } };
  }
  // テーブル・フロア
  if (b.type === 'floorAdd' || b.type === 'floorRename') {
    const n = typeof b.name === 'string' ? b.name.trim() : '';
    if (!n || n.length > 40) return bad('フロア名を入力してください');
    if (b.type === 'floorRename') {
      if (!isUuid(b.id)) return bad('フロアが見つかりません');
      return { ok: true, action: { type: 'floorRename', id: b.id, name: n } };
    }
    return { ok: true, action: { type: 'floorAdd', name: n } };
  }
  if (b.type === 'floorDelete' || b.type === 'tableDelete') {
    if (!isUuid(b.id)) return bad('対象が見つかりません');
    return { ok: true, action: { type: b.type, id: b.id } };
  }
  if (b.type === 'floorDefault') {
    if (b.id != null && !isUuid(b.id)) return bad('フロアが見つかりません');
    return { ok: true, action: { type: 'floorDefault', id: (b.id as string | null | undefined) ?? null } };
  }
  if (b.type === 'tableSave') {
    const t = (b.table ?? {}) as Record<string, unknown>;
    const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback);
    if (t.id != null && !isUuid(t.id)) return bad('テーブルが見つかりません');
    if (t.floorId != null && !isUuid(t.floorId)) return bad('フロアが見つかりません');
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (!name || name.length > 40) return bad('テーブル名を入力してください');
    const table: NativeTableFields = {
      id: (t.id as string | null | undefined) ?? null,
      floorId: (t.floorId as string | null | undefined) ?? null,
      name,
      capacityMin: int(t.capacityMin, 1),
      capacityMax: int(t.capacityMax, 4),
      isPrivateRoom: t.isPrivateRoom === true,
      isCounter: t.isCounter === true,
      smokingAllowed: t.smokingAllowed === true,
      sortOrder: int(t.sortOrder, 0),
    };
    if (table.capacityMin < 1 || table.capacityMax < table.capacityMin || table.capacityMax > 999) return bad('席数の指定が正しくありません');
    return { ok: true, action: { type: 'tableSave', table } };
  }
  if (b.type === 'tableAvailable') {
    if (!isUuid(b.id) || typeof b.available !== 'boolean') return bad('テーブルが見つかりません');
    return { ok: true, action: { type: 'tableAvailable', id: b.id, available: b.available } };
  }
  if (b.type === 'tablesReorderByName') return { ok: true, action: { type: 'tablesReorderByName' } };
  if (b.type === 'dynamicPricingSave') {
    if (!Array.isArray(b.rules) || b.rules.length > 50) return bad('ルールは50件までです');
    return { ok: true, action: { type: 'dynamicPricingSave', rules: b.rules } };
  }
  if (b.type === 'menuBulkSave') {
    if (!Array.isArray(b.patches) || b.patches.length === 0 || b.patches.length > 2000) return bad('変更がありません');
    const patches: NativeBulkPatch[] = [];
    for (const raw of b.patches as Record<string, unknown>[]) {
      if (!isUuid(raw?.id)) return bad('商品の指定が正しくありません');
      const p: NativeBulkPatch = { id: raw.id as string };
      if (typeof raw.name === 'string') p.name = raw.name;
      if (typeof raw.nameEn === 'string') p.nameEn = raw.nameEn;
      if (raw.categoryId === null || typeof raw.categoryId === 'string') p.categoryId = raw.categoryId as string | null;
      if (typeof raw.itemType === 'string') p.itemType = raw.itemType;
      if (typeof raw.price === 'number') p.price = raw.price;
      if (raw.takeoutPrice === null || typeof raw.takeoutPrice === 'number') p.takeoutPrice = raw.takeoutPrice as number | null;
      if (raw.status === 'active' || raw.status === 'hidden') p.status = raw.status;
      if (typeof raw.isSoldOut === 'boolean') p.isSoldOut = raw.isSoldOut;
      patches.push(p);
    }
    return { ok: true, action: { type: 'menuBulkSave', patches } };
  }
  const importType = (v: unknown): string | null => (typeof v === 'string' && /^[a-z_]{1,32}$/.test(v) ? v : null);
  if (b.type === 'importPreview') {
    const t = importType(b.importType);
    if (!t) return bad('取り込む種類が正しくありません');
    if (typeof b.csv !== 'string' || !b.csv.trim()) return bad('CSV が空です');
    if (b.csv.length > 4_000_000) return bad('CSV が大きすぎます（4MB まで）');
    return { ok: true, action: { type: 'importPreview', importType: t, csv: b.csv } };
  }
  if (b.type === 'importRun') {
    const t = importType(b.importType);
    if (!t) return bad('取り込む種類が正しくありません');
    if (!Array.isArray(b.rows) || b.rows.length > 1000) return bad('一度にインポートできるのは1000行までです');
    const rows: { rowNumber: number; values: Record<string, string> }[] = [];
    for (const r of b.rows as Record<string, unknown>[]) {
      if (typeof r?.rowNumber !== 'number' || !r.values || typeof r.values !== 'object' || Array.isArray(r.values)) return bad('行の指定が正しくありません');
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) if (typeof v === 'string' && /^[a-zA-Z_]{1,40}$/.test(k)) values[k] = v;
      rows.push({ rowNumber: Math.floor(r.rowNumber), values });
    }
    return { ok: true, action: { type: 'importRun', importType: t, rows } };
  }
  if (b.type === 'menuScanParse') {
    if (!Array.isArray(b.lines) || b.lines.length > 5000) return bad('読み取った行が多すぎます（5000行まで）');
    const lines = (b.lines as unknown[]).filter((l): l is string => typeof l === 'string').map((l) => l.slice(0, 500));
    return { ok: true, action: { type: 'menuScanParse', lines } };
  }
  return bad();
}

/** メニュー一括編集の画面の読み込み（GET ?part=menuBulk） */
export interface NativeMenuBulkPayload {
  store: { id: string; name: string };
  /** 管理画面だけ（レジ端末では見るだけ） */
  canEdit: boolean;
  adminOnlyNote: string;
  categories: { id: string; name: string }[];
  itemTypes: { id: string; label: string }[];
  rows: {
    id: string;
    name: string;
    nameEn: string;
    categoryId: string | null;
    itemType: string;
    price: number;
    takeoutPrice: number | null;
    status: 'active' | 'hidden';
    isSoldOut: boolean;
  }[];
}

/** データ取込の画面の読み込み（GET ?part=import） */
export interface NativeImportPayload {
  store: { id: string; name: string };
  hasStore: boolean;
  types: { id: string; label: string; listPath: string; fields: { key: string; label: string; required: boolean; hint: string | null }[] }[];
  maxRows: number;
}

/** importPreview の返事（data） */
export interface NativeImportPreview {
  headers: string[];
  /** フィールドキー → 対応した列名（対応できなければ null） */
  mapping: Record<string, string | null>;
  missingRequired: string[];
  rows: { rowNumber: number; status: 'ok' | 'error' | 'duplicate'; reason: string | null; values: Record<string, string> }[];
  counts: { ok: number; error: number; duplicate: number };
}

/** ダイナミックプライシングの画面の読み込み（GET ?part=dynamicPricing） */
export interface NativeDynamicPricingPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  rules: {
    id: string;
    name: string;
    enabled: boolean;
    days: number[];
    start: string;
    end: string;
    target: 'all' | 'categories' | 'items';
    categoryIds: string[];
    itemIds: string[];
    kind: 'percent' | 'amount' | 'fixed';
    value: number;
    roundTo10: boolean;
  }[];
  categories: { id: string; name: string }[];
  items: { id: string; name: string; categoryId: string | null; price: number }[];
}

/** 集計（/app/settings/summary。レジの一覧から外した 店舗運営・仕入・在庫・経理・労務・経営・店舗内共有・管理 の画面） */
export interface NativeSummaryPayload {
  store: { id: string; name: string };
  groups: { label: string; en: string; items: { href: string; label: string; en: string; icon: string }[] }[];
}

/** テーブル・フロアの画面の読み込み（GET ?part=tables） */
export interface NativeTablesPayload {
  store: { id: string; name: string };
  /** 管理画面だけ（レジ端末では見るだけ） */
  canEdit: boolean;
  adminOnlyNote: string;
  defaultFloorId: string | null;
  floors: { id: string; name: string; tableCount: number }[];
  tables: {
    id: string;
    name: string;
    floorId: string | null;
    floorName: string | null;
    capacityMin: number;
    capacityMax: number;
    isPrivateRoom: boolean;
    isCounter: boolean;
    smokingAllowed: boolean;
    sortOrder: number;
    available: boolean;
  }[];
}

/** 連携の画面の読み込み（GET ?part=integrations。見るだけ） */
export interface NativeIntegrationsPayload {
  store: { id: string; name: string };
  rows: { key: string; name: string; status: string; tone: 'gray' | 'primary' | 'danger' | 'warning' | 'success'; note: string; href: string | null; hrefLabel: string | null }[];
  migration: { key: string; name: string; note: string }[];
}

/** 監査ログの画面の読み込み（GET ?part=audit。新しい順・最大200件。絞り込みはアプリ側） */
export interface NativeAuditPayload {
  store: { id: string; name: string };
  rows: {
    id: string;
    createdAt: string;
    createdLabel: string;
    actorName: string;
    actorRole: string | null;
    action: string;
    targetTable: string | null;
    targetId: string | null;
    before: string | null;
    after: string | null;
    note: string | null;
  }[];
}

/** 企業情報の画面の読み込み（GET ?part=company） */
export interface NativeCompanyPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  company: NativeCompanyFields;
  includeTakeoutGuests: boolean;
}

/** 予約台帳設定の画面の読み込み（GET ?part=reservationBook） */
export interface NativeReservationBookPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  book: { pushDevices: string[]; reminderEnabled: boolean };
  gourmet: {
    enabled: boolean;
    /** 取り込み専用アドレス（オンにすると作られる） */
    address: string | null;
    inboundReady: boolean;
    /** アドレスの作り直しは運営（CYPRESS）だけ */
    canRegenerate: boolean;
    verifiedCount: number;
    sites: { key: string; name: string; en: string; howTo: string; adminUrl: string | null; status: 'verified' | 'registered' | 'off'; lastImportLabel: string | null; setupLabel: string | null; lastKindLabel: string | null }[];
    imports: {
      id: string;
      siteName: string;
      kind: string;
      kindLabel: string;
      status: string;
      statusLabel: string;
      summary: string;
      subject: string | null;
      fromAddress: string | null;
      externalId: string | null;
      receivedLabel: string;
      reservationId: string | null;
      error: string | null;
      resolved: boolean;
      bodyText: string | null;
      links: string[];
    }[];
  };
  links: {
    /** 公開予約URL（NEXT_PUBLIC_SITE_URL と店舗のスラッグが無いと null） */
    bookingUrl: string | null;
    channels: { key: string; label: string; en: string; howTo: string; adminUrl: string | null; link: string; count30d: number; google: boolean }[];
    sns: { instagram: string; line: string; facebook: string; x: string };
    /** Google カレンダー購読URL（未発行なら null） */
    icalFeedUrl: string | null;
  };
}

/** スタッフ管理の画面の読み込み（GET ?part=staff） */
export interface NativeStaffPayload {
  store: { id: string; name: string };
  organizationName: string;
  /** 自分の membership の profile id（自分の行は変えられない） */
  selfProfileId: string;
  /** 自分が付けられるロール（lib/permissions.ts の canAssignRole） */
  roles: { id: string; label: string; assignable: boolean; hq: boolean }[];
  stores: { id: string; name: string }[];
  statuses: { id: string; label: string }[];
  rows: {
    membershipId: string;
    profileId: string;
    displayName: string;
    displayNameKana: string | null;
    role: string;
    roleLabel: string;
    status: string;
    storeIds: string[];
    storeNames: string[];
    hasPin: boolean;
    /** 自分より上のロールは触れない（Web の row-menu と同じ） */
    canEdit: boolean;
  }[];
}

/** 決済・端末の画面の読み込み（GET ?part=payments） */
export interface NativePaymentsPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  /** stera 端末の追加・変更は管理画面だけ（レジの iPad からは見るだけ） */
  canEditStera: boolean;
  stripe: { configured: boolean; testMode: boolean };
  discountKinds: { id: 'percent' | 'amount' | 'manual'; label: string }[];
  /** 内訳を選ばせる支払方法（クレジット・QR・電子マネー） */
  methods: { id: string; label: string }[];
  presets: { discounts: NativeDiscountPreset[]; pointBrands: NativePointBrand[]; methodBrands: Record<string, NativePointBrand[]> };
  stera: {
    serverUrl: string;
    terminals: { id: string; name: string; terminalNo: string | null; linkCode: string; active: boolean; online: boolean; lastSeenLabel: string | null; appVersion: string | null }[];
  };
  readers: { id: string; label: string; deviceType: string | null; isSimulated: boolean; status: string; statusLabel: string; lastSeenAt: string | null }[];
  booking: { mode: 'onsite' | 'prepay_full' | 'deposit'; depositAmount: number; modes: { id: string; label: string }[] };
}

/** メニューブックの画面の読み込み（GET ?part=menuBook） */
export interface NativeMenuBookPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  shows: { id: string; label: string; note: string }[];
  categories: { id: string; name: string; nameEn: string; color: string; sortOrder: number; shared: boolean; itemCount: number; group: string; show: string; autoShow: string }[];
  items: { id: string; name: string; categoryId: string | null; price: number; sortOrder: number }[];
  plans: { id: string; name: string; price: number; categoryIds: string[] | null; addOn: boolean }[];
  lunch: { start: string; end: string };
  pages: { key: string; name: string }[];
  categoryPage: Record<string, string>;
  takeoutItemIds: string[];
}

/** QRのサービスの画面の読み込み（GET ?part=qrService） */
export interface NativeQrServicePayload {
  store: { id: string; name: string };
  canEdit: boolean;
  enabled: boolean;
  items: { name: string; nameEn: string | null }[];
  maxItems: number;
}

/** オプションの画面の読み込み（GET ?part=options） */
export interface NativeOptionsPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  groups: { id: string; name: string; isRequired: boolean; minSelect: number; maxSelect: number; items: { id: string; name: string; nameEn: string | null; price: number }[]; menuItemIds: string[] }[];
  menuItems: { id: string; name: string }[];
}

/** メニュー・プランの画面の読み込み（GET ?part=menuItems） */
export interface NativeMenuItemsPayload {
  store: { id: string; name: string };
  canEdit: boolean;
  categories: { id: string; name: string; sortOrder: number }[];
  taxRates: { id: string; name: string }[];
  items: (NativeMenuItemFields & {
    id: string;
    isSoldOut: boolean;
    pricePending: boolean;
    shared: boolean;
    /** コース・プランの中身の印（飲み放題つき・食べ放題） */
    includesDrinks: boolean | null;
    includesAyce: boolean | null;
  })[];
  /** 以下はプランの画面（コース／放題プランの作成）で使う。lib/course-builder-server.ts の loadCourseBuilderExtras */
  courseSteps: Record<string, { id: string; name: string; hidden: boolean }[]>;
  courseMains: Record<string, { groupId: string; name: string; choices: { id: string; name: string; price: number }[] }>;
  planCategories: Record<string, string[]>;
  planOnlyCategoryIds: string[];
  maxCourseSteps: number;
  maxMainChoices: number;
  canEditOptions: boolean;
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
  /** 店舗では一覧を見るだけ（解除・承認・台数は TENPO ONE 運営のコントロールセンター。2026-10-25） */
  readOnlyNote?: string;
  devices: {
    id: string;
    name: string;
    status: 'active' | 'revoked';
    pairedAt: string;
    lastSeenAt: string | null;
    pairedIp: string | null;
    userAgent: string | null;
    /** TENPO ONE 運営の承認（migration 00104 の前は approved） */
    approval?: 'pending' | 'approved' | 'rejected' | 'revoked';
  }[];
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
