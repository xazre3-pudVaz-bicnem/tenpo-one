import 'server-only';
import type { SessionContext } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { todayJst } from '@/lib/format';
import { toBusinessDayTime } from '@/lib/business-hours';
import { daypartSettingsFrom } from '@/lib/daypart';
import { nextFloatSettingFrom } from '@/lib/register-day';
import { loadSoldOutBoard } from '@/lib/sold-out-loader';
import { loadStoreClerks } from '@/lib/pos-clerks-server';
import { CLERK_ROLES, CLERK_ROLE_EN, CLERK_ROLE_LABELS } from '@/lib/clerk-roles';
import { setItemSoldOut } from '@/app/app/pos/sold-out-actions';
import { addPosClerk, deletePosClerk, renamePosClerk, setPosClerkRole, setPosClerkStatus } from '@/app/app/settings/clerks/actions';
import { addHoliday, deleteHoliday, saveBusinessHours, saveLunchUntil, saveNextFloat } from '@/app/app/settings/hours/actions';
import { updateStoreInfo } from '@/app/app/settings/store/actions';
import { deleteTaxRate, saveTaxRate } from '@/app/app/settings/tax/actions';
import { saveLoyaltySettings } from '@/app/app/settings/loyalty/actions';
import { resolveSiteOrigin } from '@/lib/site-origin';
import type {
  NativeClerksPayload,
  NativeHoursPayload,
  NativeLoyaltyPayload,
  NativeSettingsPageAction,
  NativeSoldOutPayload,
  NativeStorePayload,
  NativeTaxPayload,
} from '@/lib/native-settings-pages';

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Store = { id: string; name: string };

/** 設定の中の画面の名前（GET ?part=） */
export const NATIVE_SETTINGS_PAGE_PARTS = ['soldout', 'clerks', 'hours', 'store', 'tax', 'loyalty'] as const;
export type NativeSettingsPagePart = (typeof NATIVE_SETTINGS_PAGE_PARTS)[number];
export function isNativeSettingsPagePart(v: unknown): v is NativeSettingsPagePart {
  return typeof v === 'string' && (NATIVE_SETTINGS_PAGE_PARTS as readonly string[]).includes(v);
}

/**
 * 設定の中の画面の読み込み（Web の各ページの page.tsx と同じ組み立て。2026-10-24 Ronnie「設定の中も全部ネイティブ」）。
 * 返事は { ok: true, ...payload }。読めないときは { ok: false, error }
 */
export async function loadNativeSettingsPage(
  part: NativeSettingsPagePart,
  ctx: SessionContext,
  supabase: Supabase,
  store: Store
): Promise<
  | { ok: true; payload: NativeSoldOutPayload | NativeClerksPayload | NativeHoursPayload | NativeStorePayload | NativeTaxPayload | NativeLoyaltyPayload }
  | { ok: false; error: string }
> {
  if (part === 'soldout') {
    if (!ctx.organizationId) return { ok: false, error: '企業が見つかりません' };
    const board = await loadSoldOutBoard(supabase, ctx.organizationId, store.id);
    if (board.error) return { ok: false, error: '商品を読み込めませんでした' };
    return {
      ok: true,
      payload: { store, canManageShared: can(ctx.role, 'menu.manage'), categories: board.categories, items: board.items },
    };
  }
  if (part === 'clerks') {
    const rows = await loadStoreClerks(supabase, store.id, { includeHidden: true });
    return {
      ok: true,
      payload: {
        store,
        lockOwner: ctx.isRegisterDevice === true,
        canEdit: can(ctx.role, 'store.settings'),
        roles: CLERK_ROLES.map((r) => ({ id: r, label: CLERK_ROLE_LABELS[r], en: CLERK_ROLE_EN[r] })),
        rows: rows.map((c) => ({ id: c.id, name: c.name, status: c.status, role: c.role })),
      },
    };
  }
  if (part === 'hours') {
    const [{ data: hours }, { data: settingsRow }, { data: holidays }] = await Promise.all([
      supabase.from('business_hours').select('day_of_week, is_closed, open_time, close_time, last_entry_time').eq('store_id', store.id),
      supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
      supabase
        .from('holidays')
        .select('id, holiday_date, name, is_temporary')
        .eq('store_id', store.id)
        .gte('holiday_date', todayJst())
        .order('holiday_date', { ascending: true }),
    ]);
    const byDay = new Map((hours ?? []).map((h) => [h.day_of_week as number, h]));
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        hours: Array.from({ length: 7 }, (_, day) => {
          const h = byDay.get(day);
          return {
            dayOfWeek: day,
            isClosed: h?.is_closed ?? false,
            openTime: (h?.open_time as string | null | undefined)?.slice(0, 5) ?? null,
            closeTime: toBusinessDayTime(h?.close_time as string | null | undefined, h?.open_time as string | null | undefined),
            lastEntryTime: toBusinessDayTime(h?.last_entry_time as string | null | undefined, h?.open_time as string | null | undefined),
          };
        }),
        lunchUntil: daypartSettingsFrom(settingsRow?.settings).lunchUntil,
        nextFloat: nextFloatSettingFrom(settingsRow?.settings),
        holidays: (holidays ?? []).map((h) => ({
          id: h.id as string,
          holidayDate: h.holiday_date as string,
          name: (h.name as string | null) ?? null,
          isTemporary: h.is_temporary === true,
        })),
      },
    };
  }
  if (part === 'store') {
    const [{ data: row }, { data: settings }, origin] = await Promise.all([
      supabase
        .from('stores')
        .select('id, slug, name, name_kana, postal_code, address, phone, email, description, seat_count, booking_enabled')
        .eq('id', store.id)
        .maybeSingle(),
      supabase
        .from('store_settings')
        .select('receipt_header, receipt_footer, invoice_registration_number, service_charge_rate, rounding, allow_negative_stock')
        .eq('store_id', store.id)
        .maybeSingle(),
      resolveSiteOrigin(),
    ]);
    if (!row) return { ok: false, error: '店舗情報を取得できませんでした' };
    const slug = (row.slug as string | null) ?? null;
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        receiptLocked: ctx.isRegisterDevice === true,
        bookingUrl: slug ? `${origin}/book/${slug}` : null,
        slug,
        fields: {
          name: row.name as string,
          nameKana: (row.name_kana as string | null) ?? '',
          postalCode: (row.postal_code as string | null) ?? '',
          address: (row.address as string | null) ?? '',
          phone: (row.phone as string | null) ?? '',
          email: (row.email as string | null) ?? '',
          description: (row.description as string | null) ?? '',
          seatCount: (row.seat_count as number | null) ?? null,
          bookingEnabled: row.booking_enabled === true,
          receiptHeader: (settings?.receipt_header as string | null) ?? '',
          receiptFooter: (settings?.receipt_footer as string | null) ?? '',
          invoiceRegistrationNumber: (settings?.invoice_registration_number as string | null) ?? '',
          serviceChargeRate: Number(settings?.service_charge_rate ?? 0),
          rounding: (settings?.rounding as string | null) ?? 'floor',
          allowNegativeStock: settings?.allow_negative_stock !== false,
        },
        roundings: [
          { id: 'floor', label: '切り捨て' },
          { id: 'ceil', label: '切り上げ' },
          { id: 'round', label: '四捨五入' },
        ],
      },
    };
  }
  if (part === 'tax') {
    const { data } = await supabase
      .from('tax_rates')
      .select('id, name, rate, is_reduced, is_inclusive, is_default')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false })
      .order('name');
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        rows: (data ?? []).map((r) => ({
          id: r.id as string,
          name: r.name as string,
          rate: Number(r.rate),
          isReduced: r.is_reduced === true,
          isInclusive: r.is_inclusive === true,
          isDefault: r.is_default === true,
        })),
      },
    };
  }
  if (part === 'loyalty') {
    const { data } = await supabase.from('loyalty_settings').select('enabled, yen_per_point, point_value, expiry_months').eq('organization_id', ctx.organizationId).maybeSingle();
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'org.settings'),
        enabled: data?.enabled === true,
        yenPerPoint: Number(data?.yen_per_point ?? 100),
        pointValue: Number(data?.point_value ?? 1),
        expiryMonths: (data?.expiry_months as number | null | undefined) ?? null,
      },
    };
  }
  return { ok: false, error: '画面が見つかりません' };
}

/** 設定の中の画面の操作（中身は Web と同じ Server Action。権限はその中で見る） */
export async function runNativeSettingsPageAction(
  action: NativeSettingsPageAction,
  store: Store
): Promise<{ ok: true } | { ok: false; error: string }> {
  const done = (r: { error?: string }): { ok: true } | { ok: false; error: string } => (r.error ? { ok: false, error: r.error } : { ok: true });
  switch (action.type) {
    case 'soldOutSet':
      return done(await setItemSoldOut(action.itemId, action.soldOut));
    case 'clerkAdd':
      return done(await addPosClerk(store.id, action.name, action.role));
    case 'clerkRename':
      return done(await renamePosClerk(action.id, store.id, action.name));
    case 'clerkStatus':
      return done(await setPosClerkStatus(action.id, store.id, action.status));
    case 'clerkRole':
      return done(await setPosClerkRole(action.id, store.id, action.role));
    case 'clerkDelete':
      return done(await deletePosClerk(action.id, store.id));
    case 'hoursSave':
      return done(await saveBusinessHours(store.id, action.hours));
    case 'lunchUntilSave':
      return done(await saveLunchUntil(store.id, action.lunchUntil));
    case 'nextFloatSave':
      return done(await saveNextFloat(store.id, action.nextFloat));
    case 'holidayAdd':
      return done(await addHoliday({ storeId: store.id, holidayDate: action.date, name: action.name, isTemporary: action.isTemporary }));
    case 'holidayDelete':
      return done(await deleteHoliday(action.id, store.id));
    case 'storeSave':
      return done(await updateStoreInfo({ storeId: store.id, ...action.store }));
    case 'taxSave':
      return done(await saveTaxRate({ id: action.id ?? undefined, name: action.name, rate: action.rate, isReduced: action.isReduced, isInclusive: action.isInclusive, isDefault: action.isDefault }));
    case 'taxDelete':
      return done(await deleteTaxRate(action.id));
    case 'loyaltySave':
      return done(await saveLoyaltySettings({ enabled: action.enabled, yenPerPoint: action.yenPerPoint, pointValue: action.pointValue, expiryMonths: action.expiryMonths }));
  }
}
