import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { OnboardingWizard, type OnboardingInitialData } from './wizard';

export const metadata: Metadata = { title: '初期導入ウィザード' };

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  openTime: '11:00',
  closeTime: '22:00',
}));

export default async function OnboardingPage() {
  const ctx = await requirePermission('org.settings');
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('organizations')
    .select('name, name_kana, postal_code, address, phone, onboarding')
    .eq('id', ctx.organizationId)
    .single();

  const onboarding = (org?.onboarding ?? {}) as { step?: number; completed?: boolean };

  const { data: store } = await supabase
    .from('stores')
    .select('id, name, address, phone, slug')
    .eq('organization_id', ctx.organizationId)
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
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
    .order('sort_order');

  const { count: itemsCount } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.organizationId)
    .neq('status', 'deleted');

  const { count: staffCount } = await supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.organizationId);

  const initial: OnboardingInitialData = {
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

  return (
    <div className="mx-auto max-w-2xl">
      <OnboardingWizard initial={initial} />
    </div>
  );
}
