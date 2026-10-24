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
import { ROLE_LABELS } from '@/lib/permissions';
import { deleteAccount, installStandardAccounts, saveAccount } from '@/app/app/settings/accounts/actions';
import { ACCOUNT_CATEGORY_LABELS, ACCOUNT_CATEGORY_ORDER, SUB_TYPE_LABELS, type SubType } from '@/components/accounting/labels';
import { TAX_TREATMENT_LABELS, type AccountCategory, type TaxTreatment } from '@/lib/accounting';
import { canWriteAccounting } from '@/components/accounting/roles';
import { issueHandyPairing, renameHandyDevice, revokeHandyDevice } from '@/app/app/settings/handy/actions';
import { deleteCategory, deleteMenuItem, saveCategory, saveMenuItem, toggleSoldOut, updateCategoryStation } from '@/app/app/settings/menu/actions';
import { isCustomPriceHelper } from '@/lib/custom-price';
import { addOptionItem, createOptionGroup, deleteOptionGroup, deleteOptionItem, moveOptionGroup, setGroupMenuItems, updateOptionGroup } from '@/app/app/settings/options/actions';
import { resolveSiteOrigin } from '@/lib/site-origin';
import type {
  NativeAccountsPayload,
  NativeCategoriesPayload,
  NativeMenuItemsPayload,
  NativeOptionsPayload,
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
export const NATIVE_SETTINGS_PAGE_PARTS = ['soldout', 'clerks', 'hours', 'store', 'tax', 'loyalty', 'alerts', 'approvals', 'accounts', 'handy', 'categories', 'menuItems', 'options'] as const;
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
        | NativeOptionsPayload;
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
  }
}
