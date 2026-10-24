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
import { resetAlertRuleToDefault, upsertAlertRule } from '@/app/app/settings/alerts/actions';
import { ALERT_RULE_DEFAULTS, ALERT_RULE_KEYS, ALERT_RULE_LABELS, ALERT_RULE_UNITS, type AlertRuleKey } from '@/components/dashboard/alert-rules';
import { deleteApprovalRule, saveApprovalRule } from '@/app/app/settings/approvals/actions';
import { canAssignRole, HQ_ROLES, ROLE_LABELS, ROLES, roleOutranks, type Role } from '@/lib/permissions';
import { changeMemberRole, changeMemberStores, inviteStaff, resetMemberPassword, setMemberPin, setMemberStatus } from '@/app/app/staff/actions';
import { deleteAccount, installStandardAccounts, saveAccount } from '@/app/app/settings/accounts/actions';
import { ACCOUNT_CATEGORY_LABELS, ACCOUNT_CATEGORY_ORDER, SUB_TYPE_LABELS, type SubType } from '@/components/accounting/labels';
import { TAX_TREATMENT_LABELS, type AccountCategory, type TaxTreatment } from '@/lib/accounting';
import { canWriteAccounting } from '@/components/accounting/roles';
import { issueHandyPairing, renameHandyDevice, revokeHandyDevice } from '@/app/app/settings/handy/actions';
import { deleteCategory, deleteMenuItem, saveCategory, saveMenuItem, toggleSoldOut, updateCategoryStation } from '@/app/app/settings/menu/actions';
import { isCustomPriceHelper } from '@/lib/custom-price';
import { saveQrService } from '@/app/app/settings/qr-service/actions';
import { QR_SERVICE_MAX_ITEMS, qrServiceFrom } from '@/lib/qr-service';
import { saveCategoryLayout, saveItemOrder, saveMenuBookLunch, saveMenuBookPages, saveMenuBookPlans, saveTakeoutMenu } from '@/app/app/settings/menu-book/actions';
import { menuBookCategoryRows } from '@/components/settings/menu-book-rows';
import { isPlanAddOn, isPlanItem, MENU_BOOK_SHOW_LABELS, MENU_BOOK_SHOW_NOTES, MENU_BOOK_SHOWS, menuBookFrom, withPicksPage, type MenuBookShow } from '@/lib/menu-book';
import { takeoutMenuFrom } from '@/lib/takeout-menu';
import { addOptionItem, createOptionGroup, deleteOptionGroup, deleteOptionItem, moveOptionGroup, setGroupMenuItems, updateOptionGroup } from '@/app/app/settings/options/actions';
import { resolveSiteOrigin } from '@/lib/site-origin';
import { markGourmetSiteRegistered, regenerateGourmetMailToken, regenerateIcalToken, resolveGourmetMailImport, revokeIcalToken, saveSnsLinks, setGourmetMailEnabled } from '@/app/app/settings/reservation-book/actions';
import { prepareReservationReminders } from '@/app/app/reservations/reminder-actions';
import { GOURMET_SITE_BY_KEY, GOURMET_SITES, gourmetImportAddress, gourmetMailSettingsFrom, MAIL_KIND_LABEL, type GourmetSiteKey, type MailKind } from '@/lib/gourmet-mail';
import { bookingLinkWithSrc, GOOGLE_CHANNEL, icalFeedUrl, reservationBookSettingsFrom, SNS_CHANNELS } from '@/lib/reservation-book';
import { pushSubscriptionsFrom } from '@/lib/push-subscriptions';
import { deleteTerminalReader, registerSimulatedReader, saveCheckoutPresets, updateBookingPaymentSettings, type BookingPaymentMode } from '@/app/app/settings/payments/actions';
import { addSteraTerminal, deleteSteraTerminal, regenerateSteraLinkCode, updateSteraTerminal } from '@/app/app/settings/payments/stera-actions';
import { BRANDED_METHODS, checkoutPresetsFrom, DISCOUNT_KIND_LABELS, discountPresetsOf, methodBrandsOf, pointBrandsOf } from '@/lib/checkout-presets';
import { METHOD_LABELS } from '@/components/cash/labels';
import { isPaymentConfigured, isPaymentTestMode } from '@/lib/payments';
import { isSteraOnline } from '@/lib/stera';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatTime } from '@/lib/format';
import type {
  NativeAccountsPayload,
  NativeCategoriesPayload,
  NativeMenuBookPayload,
  NativePaymentsPayload,
  NativeStaffPayload,
  NativeReservationBookPayload,
  NativeMenuItemsPayload,
  NativeOptionsPayload,
  NativeQrServicePayload,
  NativeHandyDevicesPayload,
  NativeAlertsPayload,
  NativeApprovalsPayload,
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
export const NATIVE_SETTINGS_PAGE_PARTS = ['soldout', 'clerks', 'hours', 'store', 'tax', 'loyalty', 'alerts', 'approvals', 'accounts', 'handy', 'categories', 'menuItems', 'options', 'qrService', 'menuBook', 'payments', 'staff', 'reservationBook'] as const;
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
  | {
      ok: true;
      payload:
        | NativeSoldOutPayload
        | NativeClerksPayload
        | NativeHoursPayload
        | NativeStorePayload
        | NativeTaxPayload
        | NativeLoyaltyPayload
        | NativeAlertsPayload
        | NativeApprovalsPayload
        | NativeAccountsPayload
        | NativeHandyDevicesPayload
        | NativeCategoriesPayload
        | NativeMenuItemsPayload
        | NativeOptionsPayload
        | NativeQrServicePayload
        | NativeMenuBookPayload
        | NativePaymentsPayload
        | NativeStaffPayload
        | NativeReservationBookPayload;
    }
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
  if (part === 'alerts') {
    const { data: rows } = await supabase
      .from('alert_rules')
      .select('store_id, rule_key, threshold, enabled')
      .eq('organization_id', ctx.organizationId)
      .or(`store_id.is.null,store_id.eq.${store.id}`);
    const orgByKey = new Map((rows ?? []).filter((r) => r.store_id === null).map((r) => [r.rule_key as string, r]));
    const storeByKey = new Map((rows ?? []).filter((r) => r.store_id === store.id).map((r) => [r.rule_key as string, r]));
    return {
      ok: true,
      payload: {
        store,
        canEditStore: can(ctx.role, 'store.settings'),
        canEditOrg: ctx.role === 'org_owner' || ctx.role === 'hq_admin',
        items: ALERT_RULE_KEYS.map((key: AlertRuleKey) => {
          const o = orgByKey.get(key);
          const st = storeByKey.get(key);
          return {
            ruleKey: key,
            label: ALERT_RULE_LABELS[key],
            unit: ALERT_RULE_UNITS[key],
            defaultValue: ALERT_RULE_DEFAULTS[key],
            orgValue: o ? Number(o.threshold) : null,
            orgEnabled: o ? o.enabled !== false : true,
            storeValue: st ? Number(st.threshold) : null,
            storeEnabled: st ? st.enabled !== false : true,
            effectiveValue: st ? Number(st.threshold) : o ? Number(o.threshold) : ALERT_RULE_DEFAULTS[key],
            effectiveSource: (st ? 'store' : o ? 'org' : 'default') as 'store' | 'org' | 'default',
          };
        }),
      },
    };
  }
  if (part === 'approvals') {
    const { data } = await supabase
      .from('approval_rules')
      .select('id, target, min_amount, max_amount, approver_role, allow_self_approve')
      .eq('organization_id', ctx.organizationId)
      .order('target')
      .order('min_amount');
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'org.settings'),
        targets: [
          { id: 'invoice', label: '請求書' },
          { id: 'expense', label: '経費' },
          { id: 'petty_cash', label: '小口現金' },
          { id: 'purchase_order', label: '発注' },
        ],
        roles: (['store_manager', 'area_manager', 'hq_accounting', 'hq_admin', 'org_owner'] as const).map((r) => ({ id: r, label: ROLE_LABELS[r] })),
        rows: (data ?? []).map((r) => ({
          id: r.id as string,
          target: r.target as string,
          minAmount: Number(r.min_amount),
          maxAmount: r.max_amount == null ? null : Number(r.max_amount),
          approverRole: r.approver_role as string,
          allowSelfApprove: r.allow_self_approve === true,
        })),
      },
    };
  }
  if (part === 'accounts') {
    if (ctx.disabledFeatures?.has('accounting')) return { ok: false, error: '会計の機能は使えません' };
    const { data } = await supabase
      .from('accounts')
      .select('id, code, name, category, sub_type, default_tax_treatment, is_system, sort_order')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .order('sort_order')
      .order('code');
    return {
      ok: true,
      payload: {
        store,
        canEdit: canWriteAccounting(ctx.role),
        categories: ACCOUNT_CATEGORY_ORDER.map((c) => ({ id: c, label: ACCOUNT_CATEGORY_LABELS[c] })),
        subTypes: (['cash', 'bank', 'receivable', 'payable', 'inventory'] as SubType[]).map((t) => ({ id: t, label: SUB_TYPE_LABELS[t] })),
        taxTreatments: (Object.keys(TAX_TREATMENT_LABELS) as TaxTreatment[]).map((t) => ({ id: t, label: TAX_TREATMENT_LABELS[t] })),
        rows: (data ?? []).map((r) => ({
          id: r.id as string,
          code: r.code as string,
          name: r.name as string,
          category: r.category as string,
          subType: (r.sub_type as string | null) ?? null,
          defaultTaxTreatment: r.default_tax_treatment as string,
          isSystem: r.is_system === true,
          sortOrder: Number(r.sort_order ?? 0),
        })),
      },
    };
  }
  if (part === 'handy') {
    const { data: devices } = await supabase
      .from('handy_devices')
      .select('id, name, status, paired_at, last_seen_at, paired_ip, user_agent')
      .eq('store_id', store.id)
      .order('paired_at', { ascending: false });
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        pairBase: siteUrl ? `${siteUrl}/handy-pair#` : null,
        devices: (devices ?? []).map((d) => ({
          id: d.id as string,
          name: d.name as string,
          status: d.status === 'revoked' ? 'revoked' : 'active',
          pairedAt: d.paired_at as string,
          lastSeenAt: (d.last_seen_at as string | null) ?? null,
          pairedIp: (d.paired_ip as string | null) ?? null,
          userAgent: (d.user_agent as string | null) ?? null,
        })),
      },
    };
  }
  if (part === 'categories') {
    const { data: categories } = await supabase
      .from('menu_categories')
      .select('id, name, name_en, color, sort_order, station, store_id')
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active')
      .or(`store_id.is.null,store_id.eq.${store.id}`)
      .order('sort_order');
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'menu.manage'),
        // components/settings/category-panel.tsx の CATEGORY_COLORS と同じ（'use client' のファイルなのでここに写す）
        colors: ['#bc5940', '#EA580C', '#15803D', '#DC2626', '#2563EB', '#CA8A04', '#DB2777', '#0891B2'],
        stations: [
          { id: 'kitchen', label: 'キッチン' },
          { id: 'drink', label: 'ドリンク' },
          { id: 'dessert', label: 'デザート' },
          { id: 'grill', label: '焼き場' },
        ],
        rows: (categories ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
          nameEn: (c.name_en as string | null) ?? '',
          color: (c.color as string | null) ?? '#bc5940',
          sortOrder: Number(c.sort_order ?? 0),
          station: (c.station as string | null) ?? 'kitchen',
          shared: c.store_id === null,
        })),
      },
    };
  }
  if (part === 'menuItems') {
    const [{ data: categories }, { data: items }, { data: taxRates }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, sort_order')
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active')
        .or(`store_id.is.null,store_id.eq.${store.id}`)
        .order('sort_order'),
      supabase
        .from('menu_items')
        .select(
          'id, store_id, category_id, name, name_en, name_kana, description, item_type, price, takeout_price, cost, tax_rate_id, duration_minutes, sell_start_time, sell_end_time, sort_order, is_sold_out, status, price_pending'
        )
        .eq('organization_id', ctx.organizationId)
        .neq('status', 'deleted')
        .or(`store_id.is.null,store_id.eq.${store.id}`)
        .order('sort_order'),
      supabase.from('tax_rates').select('id, name').eq('organization_id', ctx.organizationId).eq('status', 'active').order('is_default', { ascending: false }),
    ]);
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'menu.manage'),
        categories: (categories ?? []).map((c) => ({ id: c.id as string, name: c.name as string, sortOrder: Number(c.sort_order ?? 0) })),
        taxRates: (taxRates ?? []).map((t) => ({ id: t.id as string, name: t.name as string })),
        // 「その他（価格入力）」用の非表示の商品は出さない（Web の loadMenuSettingsData と同じ）
        items: (items ?? [])
          .filter((i) => !isCustomPriceHelper(i))
          .map((i) => ({
            id: i.id as string,
            categoryId: (i.category_id as string | null) ?? null,
            name: i.name as string,
            nameEn: (i.name_en as string | null) ?? '',
            nameKana: (i.name_kana as string | null) ?? '',
            description: (i.description as string | null) ?? '',
            itemType: i.item_type as 'food' | 'drink' | 'course' | 'option',
            price: Number(i.price),
            takeoutPrice: i.takeout_price == null ? null : Number(i.takeout_price),
            cost: i.cost == null ? null : Number(i.cost),
            taxRateId: (i.tax_rate_id as string | null) ?? null,
            durationMinutes: i.duration_minutes == null ? null : Number(i.duration_minutes),
            sellStartTime: (i.sell_start_time as string | null)?.slice(0, 5) ?? null,
            sellEndTime: (i.sell_end_time as string | null)?.slice(0, 5) ?? null,
            sortOrder: Number(i.sort_order ?? 0),
            status: (i.status === 'hidden' ? 'hidden' : 'active') as 'active' | 'hidden',
            isSoldOut: i.is_sold_out === true,
            pricePending: i.price_pending === true,
            shared: i.store_id === null,
          })),
      },
    };
  }
  if (part === 'options') {
    const [{ data: groups }, { data: links }, { data: menuItems }] = await Promise.all([
      supabase
        .from('menu_option_groups')
        .select('id, name, is_required, min_select, max_select, sort_order, menu_option_items(id, name, name_en, price, sort_order, status)')
        .eq('store_id', store.id)
        .eq('status', 'active')
        .order('sort_order'),
      supabase.from('menu_item_option_groups').select('group_id, menu_item_id').eq('store_id', store.id),
      supabase.from('menu_items').select('id, name').eq('store_id', store.id).eq('status', 'active').neq('item_type', 'option').order('name'),
    ]);
    const itemsByGroup = new Map<string, string[]>();
    for (const l of links ?? []) {
      const arr = itemsByGroup.get(l.group_id as string) ?? [];
      arr.push(l.menu_item_id as string);
      itemsByGroup.set(l.group_id as string, arr);
    }
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        groups: (groups ?? []).map((g) => ({
          id: g.id as string,
          name: g.name as string,
          isRequired: g.is_required === true,
          minSelect: Number(g.min_select ?? 0),
          maxSelect: Number(g.max_select ?? 1),
          items: ((g.menu_option_items ?? []) as { id: string; name: string; name_en: string | null; price: number; sort_order: number; status: string }[])
            .filter((o) => o.status === 'active')
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((o) => ({ id: o.id, name: o.name, nameEn: o.name_en ?? null, price: Number(o.price) })),
          menuItemIds: itemsByGroup.get(g.id as string) ?? [],
        })),
        menuItems: (menuItems ?? []).map((m) => ({ id: m.id as string, name: m.name as string })),
      },
    };
  }
  if (part === 'qrService') {
    const { data } = await supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle();
    const cur = qrServiceFrom((data as { settings?: unknown } | null)?.settings ?? null);
    return { ok: true, payload: { store, canEdit: can(ctx.role, 'menu.manage'), enabled: cur.enabled, items: cur.items, maxItems: QR_SERVICE_MAX_ITEMS } };
  }
  if (part === 'reservationBook') {
    // Web の app/app/settings/reservation-book/page.tsx と同じ（4つのタブぶんを一度に）
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [{ data: settingsRow }, { data: storeRow }, { data: imports }, { data: recent }] = await Promise.all([
      supabase.from('store_settings').select('settings, reminder_enabled').eq('store_id', store.id).maybeSingle(),
      supabase.from('stores').select('slug').eq('id', store.id).maybeSingle(),
      supabase
        .from('gourmet_mail_imports')
        .select('id, site, kind, status, subject, from_address, external_id, received_at, reservation_id, error, resolved_at, parsed, body_text')
        .eq('store_id', store.id)
        .order('received_at', { ascending: false })
        .limit(50),
      supabase.from('reservations').select('id, reservation_sources(code)').eq('store_id', store.id).gte('created_at', since30).neq('status', 'cancelled').limit(5000),
    ]);
    const settings = (settingsRow?.settings as Record<string, unknown> | null) ?? {};
    const gm = gourmetMailSettingsFrom(settings);
    const rb = reservationBookSettingsFrom(settings);
    const bookingUrl = siteUrl && storeRow?.slug ? `${siteUrl}/book/${storeRow.slug}` : null;
    const counts30d: Record<string, number> = {};
    for (const r of recent ?? []) {
      const src = r.reservation_sources as { code: string } | { code: string }[] | null;
      const code = Array.isArray(src) ? src[0]?.code : src?.code;
      if (code) counts30d[code] = (counts30d[code] ?? 0) + 1;
    }
    const jst = (iso: string | null | undefined, withYear: boolean): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...(withYear ? { year: 'numeric' as const } : {}), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    };
    const importStatus: Record<string, string> = {
      imported: '台帳に登録',
      updated: '変更を反映',
      cancelled: 'キャンセル反映',
      verified: 'メール認証',
      duplicate: '重複（登録済）',
      ignored: '対象外',
      needs_review: '要確認',
    };
    const domain = process.env.NEXT_PUBLIC_INBOUND_MAIL_DOMAIN ?? 'in.tenpo-one.com';
    const sites = GOURMET_SITES.map((site) => {
      const st = gm.sites[site.key];
      return {
        key: site.key,
        name: site.name,
        en: site.en,
        howTo: site.howTo,
        adminUrl: site.adminUrl,
        status: (st?.verifiedAt ? 'verified' : st?.enabledAt ? 'registered' : 'off') as 'verified' | 'registered' | 'off',
        lastImportLabel: jst(st?.lastImportAt, true),
        setupLabel: jst(st?.enabledAt ?? st?.verifiedAt, true),
        lastKindLabel: st?.lastKind ? MAIL_KIND_LABEL[st.lastKind] ?? null : null,
      };
    });
    const channels = [...SNS_CHANNELS, GOOGLE_CHANNEL].map((c) => ({
      key: c.key,
      label: c.label,
      en: c.en,
      howTo: c.howTo,
      adminUrl: c.adminUrl,
      link: bookingUrl ? bookingLinkWithSrc(bookingUrl, c.key) : '',
      count30d: counts30d[c.sourceCode] ?? 0,
      google: c.key === 'google',
    }));
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        book: { pushDevices: pushSubscriptionsFrom(settings).map((d) => d.label ?? '端末'), reminderEnabled: settingsRow?.reminder_enabled === true },
        gourmet: {
          enabled: gm.enabled,
          address: gm.token ? gourmetImportAddress(gm.token, domain) : null,
          inboundReady: !!process.env.INBOUND_MAIL_SECRET,
          canRegenerate: ctx.isCypressAdmin === true,
          verifiedCount: sites.filter((s) => s.status === 'verified').length,
          sites,
          imports: (imports ?? []).map((r) => {
            const p = (r.parsed as { date?: string | null; time?: string | null; partySize?: number | null; guestName?: string | null; links?: string[] } | null) ?? {};
            const kind = r.kind as MailKind;
            return {
              id: r.id as string,
              siteName: GOURMET_SITE_BY_KEY[r.site as GourmetSiteKey]?.name ?? String(r.site),
              kind,
              kindLabel: MAIL_KIND_LABEL[kind] ?? String(r.kind),
              status: String(r.status),
              statusLabel: importStatus[String(r.status)] ?? String(r.status),
              summary: p.date ? `${p.date} ${p.time ?? ''} ${p.partySize ?? '?'}名 ${p.guestName ?? ''}`.trim() : ((r.subject as string | null) ?? ''),
              subject: (r.subject as string | null) ?? null,
              fromAddress: (r.from_address as string | null) ?? null,
              externalId: (r.external_id as string | null) ?? null,
              receivedLabel: jst(r.received_at as string, false) ?? '',
              reservationId: (r.reservation_id as string | null) ?? null,
              error: (r.error as string | null) ?? null,
              resolved: !!r.resolved_at,
              bodyText: typeof r.body_text === 'string' ? r.body_text.slice(0, 3000) : null,
              links: Array.isArray(p.links) ? p.links.filter((u): u is string => typeof u === 'string').slice(0, 5) : [],
            };
          }),
        },
        links: {
          bookingUrl,
          channels,
          sns: { instagram: rb.sns.instagram ?? '', line: rb.sns.line ?? '', facebook: rb.sns.facebook ?? '', x: rb.sns.x ?? '' },
          icalFeedUrl: rb.icalToken && siteUrl ? icalFeedUrl(siteUrl, rb.icalToken) : null,
        },
      },
    };
  }
  if (part === 'staff') {
    // Web の app/app/staff/page.tsx と同じ（requirePermission('staff.manage')）
    if (!can(ctx.role, 'staff.manage')) return { ok: false, error: 'スタッフ管理の権限がありません（店長以上のアカウントでログインしてください）' };
    if (!ctx.organizationId) return { ok: false, error: '企業が見つかりません' };
    const { data } = await supabase
      .from('memberships')
      .select(
        `id, role, status, profile_id,
         profiles ( id, display_name, display_name_kana, has_pin ),
         membership_stores ( store_id, stores ( id, name ) )`
      )
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false });
    type Row = {
      id: string;
      role: Role;
      status: string;
      profile_id: string;
      profiles: { id: string; display_name: string; display_name_kana: string | null; has_pin: boolean | null } | null;
      membership_stores: { store_id: string; stores: { id: string; name: string } | null }[];
    };
    const me = ctx.role as Role;
    const statusLabel: Record<string, string> = { active: '有効', invited: '招待中', suspended: '停止中' };
    return {
      ok: true,
      payload: {
        store,
        organizationName: ctx.organizationName ?? '',
        selfProfileId: ctx.userId,
        roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], assignable: canAssignRole(me, r), hq: HQ_ROLES.includes(r) })),
        stores: ctx.stores.map((s) => ({ id: s.id, name: s.name })),
        statuses: Object.entries(statusLabel).map(([id, label]) => ({ id, label })),
        rows: ((data ?? []) as unknown as Row[]).map((r) => ({
          membershipId: r.id,
          profileId: r.profile_id,
          displayName: r.profiles?.display_name ?? '—',
          displayNameKana: r.profiles?.display_name_kana ?? null,
          role: r.role,
          roleLabel: ROLE_LABELS[r.role] ?? r.role,
          status: r.status,
          storeIds: r.membership_stores.map((ms) => ms.store_id),
          storeNames: r.membership_stores.map((ms) => ms.stores?.name).filter((n): n is string => !!n),
          hasPin: r.profiles?.has_pin === true,
          canEdit: r.profile_id !== ctx.userId && !roleOutranks(me, r.role),
        })),
      },
    };
  }
  if (part === 'payments') {
    // Web の app/app/settings/payments/page.tsx と同じ組み立て
    const [{ data: readers }, { data: settingsRow }, { data: steraRows }] = await Promise.all([
      supabase.from('terminal_readers').select('id, label, device_type, is_simulated, status, last_seen_at').eq('store_id', store.id).order('created_at'),
      supabase.from('store_settings').select('booking_payment_mode, booking_deposit_amount, settings').eq('store_id', store.id).maybeSingle(),
      createAdminClient().from('stera_terminals').select('id, name, terminal_no, link_code, status, last_seen_at, app_version').eq('store_id', store.id).neq('status', 'deleted').order('created_at'),
    ]);
    const now = Date.now();
    const presets = checkoutPresetsFrom(settingsRow?.settings);
    const statusLabel: Record<string, string> = { online: 'オンライン', offline: 'オフライン', unknown: '不明' };
    const modeLabels: Record<BookingPaymentMode, string> = { onsite: '現地払いのみ', prepay_full: '予約時全額決済', deposit: '予約金' };
    const mode = (settingsRow?.booking_payment_mode as BookingPaymentMode | null) ?? 'onsite';
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'store.settings'),
        canEditStera: can(ctx.role, 'store.settings') && ctx.isRegisterDevice !== true,
        stripe: { configured: isPaymentConfigured(), testMode: isPaymentTestMode() },
        discountKinds: (['percent', 'amount', 'manual'] as const).map((id) => ({ id, label: DISCOUNT_KIND_LABELS[id] })),
        methods: BRANDED_METHODS.map((m) => ({ id: m, label: METHOD_LABELS[m] ?? m })),
        presets: {
          discounts: discountPresetsOf(presets),
          pointBrands: pointBrandsOf(presets),
          methodBrands: Object.fromEntries(BRANDED_METHODS.map((m) => [m, methodBrandsOf(presets, m)])),
        },
        stera: {
          serverUrl: await resolveSiteOrigin(),
          terminals: (steraRows ?? []).map((t) => ({
            id: t.id as string,
            name: t.name as string,
            terminalNo: (t.terminal_no as string | null) ?? null,
            linkCode: t.link_code as string,
            active: t.status === 'active',
            online: t.status === 'active' && isSteraOnline(t.last_seen_at as string | null, now),
            lastSeenLabel: t.last_seen_at
              ? new Date(t.last_seen_at as string).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }) + ' ' + formatTime(t.last_seen_at as string)
              : null,
            appVersion: (t.app_version as string | null) ?? null,
          })),
        },
        readers: (readers ?? []).map((r) => ({
          id: r.id as string,
          label: r.label as string,
          deviceType: (r.device_type as string | null) ?? null,
          isSimulated: r.is_simulated === true,
          status: String(r.status ?? 'unknown'),
          statusLabel: statusLabel[String(r.status ?? 'unknown')] ?? '不明',
          lastSeenAt: (r.last_seen_at as string | null) ?? null,
        })),
        booking: {
          mode,
          depositAmount: Number(settingsRow?.booking_deposit_amount ?? 0),
          modes: (Object.keys(modeLabels) as BookingPaymentMode[]).map((id) => ({ id, label: modeLabels[id] })),
        },
      },
    };
  }
  if (part === 'menuBook') {
    const [{ data: categories }, { data: items }, { data: settingsRow }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id, name, name_en, color, sort_order, station, store_id')
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active')
        .or(`store_id.is.null,store_id.eq.${store.id}`)
        .order('sort_order')
        .order('name'),
      supabase
        .from('menu_items')
        .select('id, category_id, name, item_type, price, sort_order, status, description')
        .eq('organization_id', ctx.organizationId)
        .eq('status', 'active')
        .or(`store_id.is.null,store_id.eq.${store.id}`)
        .order('sort_order')
        .order('name'),
      supabase.from('store_settings').select('settings').eq('store_id', store.id).maybeSingle(),
    ]);
    const book = menuBookFrom(settingsRow?.settings ?? null);
    const activeItems = (items ?? []).filter((i) => !isCustomPriceHelper(i));
    const rows = menuBookCategoryRows(categories ?? [], activeItems, book);
    return {
      ok: true,
      payload: {
        store,
        canEdit: can(ctx.role, 'menu.manage'),
        shows: MENU_BOOK_SHOWS.map((k: MenuBookShow) => ({ id: k, label: MENU_BOOK_SHOW_LABELS[k], note: MENU_BOOK_SHOW_NOTES[k] })),
        categories: rows.map((r) => ({ id: r.id, name: r.name, nameEn: r.nameEn, color: r.color, sortOrder: r.sortOrder, shared: r.shared, itemCount: r.itemCount, group: r.group, show: r.show, autoShow: r.autoShow })),
        items: activeItems.map((i) => ({ id: i.id as string, name: i.name as string, categoryId: (i.category_id as string | null) ?? null, price: Number(i.price), sortOrder: Number(i.sort_order ?? 0) })),
        plans: activeItems
          .filter((i) => isPlanItem(i.item_type as string, i.name as string))
          .map((i) => ({ id: i.id as string, name: i.name as string, price: Number(i.price), categoryIds: book.plans[i.id as string] ?? null, addOn: isPlanAddOn(i.name as string) }))
          .sort((a, b) => Number(a.addOn) - Number(b.addOn)),
        lunch: book.lunch,
        pages: withPicksPage(book.pages).map((pg) => ({ key: pg.key, name: pg.name })),
        categoryPage: book.categoryPage,
        takeoutItemIds: takeoutMenuFrom(settingsRow?.settings ?? null).itemIds,
      },
    };
  }
  return { ok: false, error: '画面が見つかりません' };
}

/** 設定の中の画面の操作（中身は Web と同じ Server Action。権限はその中で見る） */
export async function runNativeSettingsPageAction(
  action: NativeSettingsPageAction,
  store: Store
): Promise<{ ok: true; data?: Record<string, unknown> } | { ok: false; error: string }> {
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
    case 'alertSave': {
      if (!(ALERT_RULE_KEYS as readonly string[]).includes(action.ruleKey)) return { ok: false, error: '不正な項目です' };
      // この Server Action はエラーを throw する → 呼び出し側（route）が errorText で返す
      await upsertAlertRule({ storeId: action.scope === 'org' ? null : store.id, ruleKey: action.ruleKey as AlertRuleKey, threshold: action.threshold, enabled: action.enabled });
      return { ok: true };
    }
    case 'alertReset': {
      if (!(ALERT_RULE_KEYS as readonly string[]).includes(action.ruleKey)) return { ok: false, error: '不正な項目です' };
      await resetAlertRuleToDefault(store.id, action.ruleKey as AlertRuleKey);
      return { ok: true };
    }
    case 'approvalSave':
      return done(
        await saveApprovalRule({ id: action.id ?? undefined, target: action.target, minAmount: action.minAmount, maxAmount: action.maxAmount, approverRole: action.approverRole, allowSelfApprove: action.allowSelfApprove })
      );
    case 'approvalDelete':
      return done(await deleteApprovalRule(action.id));
    case 'accountSave':
      return done(
        await saveAccount({
          id: action.id ?? undefined,
          code: action.code,
          name: action.name,
          category: action.category as AccountCategory,
          subType: action.subType,
          defaultTaxTreatment: action.defaultTaxTreatment as TaxTreatment,
          sortOrder: action.sortOrder,
        })
      );
    case 'accountDelete':
      return done(await deleteAccount(action.id));
    case 'accountInstallStandard': {
      const r = await installStandardAccounts();
      return r.error ? { ok: false, error: r.error } : { ok: true };
    }
    case 'handyIssue': {
      // QR の中身（code）は返事にだけ載せる（DB には入れない。Web と同じ）
      const r = await issueHandyPairing(store.id, action.deviceName);
      return r.error || !r.code ? { ok: false, error: r.error ?? 'QRコードを発行できませんでした' } : { ok: true, data: { code: r.code, expiresAt: r.expiresAt } };
    }
    case 'handyRevoke':
      return done(await revokeHandyDevice(action.id));
    case 'handyRename':
      return done(await renameHandyDevice(action.id, action.name));
    case 'categorySave':
      return done(await saveCategory({ id: action.id ?? undefined, storeId: store.id, name: action.name, nameEn: action.nameEn, color: action.color, sortOrder: action.sortOrder }));
    case 'categoryDelete':
      return done(await deleteCategory(action.id));
    case 'categoryStation':
      return done(await updateCategoryStation(action.id, action.station));
    case 'menuItemSave':
      return done(await saveMenuItem({ ...action.item, id: action.item.id ?? undefined, storeId: store.id }));
    case 'menuItemDelete':
      return done(await deleteMenuItem(action.id));
    case 'menuItemSoldOut':
      return done(await toggleSoldOut(action.id, action.soldOut));
    case 'optionGroupSave':
      return done(
        action.id
          ? await updateOptionGroup({ id: action.id, storeId: store.id, name: action.name, isRequired: action.isRequired, minSelect: action.minSelect, maxSelect: action.maxSelect })
          : await createOptionGroup({ storeId: store.id, name: action.name, isRequired: action.isRequired, minSelect: action.minSelect, maxSelect: action.maxSelect })
      );
    case 'optionGroupDelete':
      return done(await deleteOptionGroup(action.id, store.id));
    case 'optionGroupMove':
      return done(await moveOptionGroup({ id: action.id, storeId: store.id, direction: action.direction }));
    case 'optionItemAdd':
      return done(await addOptionItem({ groupId: action.groupId, storeId: store.id, name: action.name, nameEn: action.nameEn, price: action.price }));
    case 'optionItemDelete':
      return done(await deleteOptionItem(action.id, store.id));
    case 'optionGroupItems':
      return done(await setGroupMenuItems({ groupId: action.groupId, storeId: store.id, menuItemIds: action.menuItemIds }));
    case 'qrServiceSave':
      return done(await saveQrService(store.id, { enabled: action.enabled, items: action.items }));
    case 'menuBookLayout':
      return done(await saveCategoryLayout(store.id, action.rows.map((r) => ({ id: r.id, show: r.show as MenuBookShow | 'auto' }))));
    case 'menuBookItemOrder':
      return done(await saveItemOrder(store.id, action.categoryId, action.itemIds));
    case 'menuBookPlans':
      return done(await saveMenuBookPlans(store.id, action.rows));
    case 'menuBookPages':
      return done(await saveMenuBookPages(store.id, { pages: action.pages, categoryPage: action.categoryPage }));
    case 'menuBookLunch':
      return done(await saveMenuBookLunch(store.id, action.start, action.end));
    case 'menuBookTakeout':
      return done(await saveTakeoutMenu(store.id, action.itemIds));
    case 'checkoutPresetsSave':
      return done(await saveCheckoutPresets(store.id, { discounts: action.discounts, pointBrands: action.pointBrands, methodBrands: action.methodBrands }));
    case 'readerAdd':
      return done(await registerSimulatedReader(store.id, action.label));
    case 'readerDelete':
      return done(await deleteTerminalReader(action.id, store.id));
    case 'bookingPaymentSave':
      return done(await updateBookingPaymentSettings({ storeId: store.id, bookingPaymentMode: action.mode, bookingDepositAmount: action.depositAmount }));
    case 'steraAdd':
      return done(await addSteraTerminal(store.id, action.name, action.terminalNo));
    case 'steraUpdate':
      return done(await updateSteraTerminal(action.id, store.id, { name: action.name, terminalNo: action.terminalNo, active: action.active }));
    case 'steraRegen':
      return done(await regenerateSteraLinkCode(action.id, store.id));
    case 'steraDelete':
      return done(await deleteSteraTerminal(action.id, store.id));
    case 'staffInvite': {
      // 初期パスワードは返事にだけ載せる（Web と同じ。ログ・監査ログには残さない）
      const r = await inviteStaff({ email: action.email, displayName: action.displayName, displayNameKana: action.displayNameKana, role: action.role, storeIds: action.storeIds });
      return r.error ? { ok: false, error: r.error } : { ok: true, data: { initialPassword: r.initialPassword ?? null } };
    }
    case 'staffRole':
      return done(await changeMemberRole({ membershipId: action.membershipId, profileId: action.profileId, newRole: action.role, storeIds: action.storeIds }));
    case 'staffStores':
      return done(await changeMemberStores({ membershipId: action.membershipId, profileId: action.profileId, storeIds: action.storeIds }));
    case 'staffPin':
      return done(await setMemberPin({ membershipId: action.membershipId, profileId: action.profileId, pin: action.pin }));
    case 'staffStatus':
      return done(await setMemberStatus({ membershipId: action.membershipId, profileId: action.profileId, status: action.status }));
    case 'staffPasswordReset': {
      const r = await resetMemberPassword({ membershipId: action.membershipId, profileId: action.profileId });
      return r.error ? { ok: false, error: r.error } : { ok: true, data: { newPassword: r.newPassword ?? null } };
    }
    case 'gourmetMailEnabled':
      return done(await setGourmetMailEnabled(store.id, action.enabled));
    case 'gourmetMailRegenerate':
      return done(await regenerateGourmetMailToken(store.id));
    case 'gourmetSiteRegistered':
      if (!GOURMET_SITE_BY_KEY[action.site as GourmetSiteKey]) return { ok: false, error: '対象のサイトがありません' };
      return done(await markGourmetSiteRegistered(store.id, action.site as GourmetSiteKey, action.registered));
    case 'gourmetImportResolve':
      return done(await resolveGourmetMailImport(store.id, action.importId));
    case 'snsLinksSave':
      return done(await saveSnsLinks(store.id, { instagram: action.instagram, line: action.line, facebook: action.facebook, x: action.x }));
    case 'icalRegenerate':
      return done(await regenerateIcalToken(store.id));
    case 'icalRevoke':
      return done(await revokeIcalToken(store.id));
    case 'remindersPrepare': {
      // この Server Action はエラーを throw する → 呼び出し側（route）が errorText で返す
      const r = await prepareReservationReminders(store.id);
      return { ok: true, data: { message: r.message, enqueued: r.enqueued } };
    }
  }
}
