import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { OnboardingInitialData } from '@/app/app/onboarding/wizard';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  openTime: '11:00',
  closeTime: '22:00',
}));

/**
 * 初期導入ウィザード（初期設定）の最初の中身。Web の /app/onboarding と iPad ネイティブ（lib/native-modules/onboarding.ts）で同じ読み込み
 * （2026-10-24 22:05 Ronnie「iPad は全部ネイティブ」で page.tsx から移した。中身は同じ）
 */
export async function loadOnboardingInitial(supabase: Supabase, organizationId: string): Promise<OnboardingInitialData> {
  const { data: org } = await supabase
    .from('organizations')
    .select('name, name_kana, postal_code, address, phone, onboarding')
    .eq('id', organizationId)
    .single();

  const onboarding = (org?.onboarding ?? {}) as { step?: number; completed?: boolean };

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, address, phone, slug')
    .eq('organization_id', organizationId)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  let hours = DEFAULT_HOURS;
  let existingTablesCount = 0;
  let existingRegisterCount = 0;
  if (store) {
    const [{ data: hourRows }, { count: tableCount }, { count: registerCount }] = await Promise.all([
      supabase
        .from('business_hours')
        .select('day_of_week, is_closed, open_time, close_time')
        .eq('store_id', store.id)
        .order('day_of_week'),
      supabase
        .from('restaurant_tables')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('status', 'active'),
      supabase
        .from('registers')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', store.id)
        .eq('status', 'active'),
    ]);
    if (hourRows && hourRows.length === 7) {
      hours = hourRows.map((h) => ({
        dayOfWeek: h.day_of_week,
        isClosed: h.is_closed,
        openTime: h.open_time,
        closeTime: h.close_time,
      }));
    }
    existingTablesCount = tableCount ?? 0;
    existingRegisterCount = registerCount ?? 0;
  }

  const { data: categories } = await supabase
    .from('menu_categories')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('sort_order');

  const { count: itemsCount } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .neq('status', 'deleted');

  const { count: staffCount } = await supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  return {
    step: onboarding.step ?? 1,
    completed: onboarding.completed === true,
    company: {
      name: org?.name ?? '',
      nameKana: org?.name_kana ?? '',
      postalCode: org?.postal_code ?? '',
      address: org?.address ?? '',
      phone: org?.phone ?? '',
    },
    store: store
      ? { id: store.id, name: store.name, address: store.address ?? '', phone: store.phone ?? '', slug: store.slug }
      : null,
    hours,
    existingTablesCount,
    existingCategories: categories ?? [],
    existingItemsCount: itemsCount ?? 0,
    existingStaffCount: staffCount ?? 0,
    existingRegisterCount,
  };
}
