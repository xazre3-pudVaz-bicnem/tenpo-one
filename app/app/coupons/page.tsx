import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { CouponsPanel, type CouponRow } from './coupons-panel';

export const metadata: Metadata = { title: 'クーポン管理' };

interface CouponQueryRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  value: number;
  store_id: string | null;
  stores: { name: string } | null;
  target_category_id: string | null;
  menu_categories: { name: string } | null;
  target_menu_item_id: string | null;
  menu_items: { name: string } | null;
  min_total: number;
  starts_at: string | null;
  ends_at: string | null;
  time_from: string | null;
  time_to: string | null;
  max_uses: number | null;
  per_customer_limit: number | null;
  first_visit_only: boolean;
  stackable: boolean;
  status: string;
  coupon_redemptions: { count: number }[] | null;
}

export default async function CouponsPage() {
  const ctx = await requireFeature('crm');

  if (!can(ctx.role, 'menu.manage')) {
    return (
      <div>
        <PageHeader title="クーポン管理" actions={<BackLink />} />
        <EmptyState title="閲覧権限がありません" description="クーポン管理には権限が必要です。管理者にお問い合わせください。" />
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data: couponRows }, { data: storeRows }, { data: categoryRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from('coupons')
      .select(
        `id, code, name, kind, value, store_id, stores(name),
         target_category_id, menu_categories(name), target_menu_item_id, menu_items(name),
         min_total, starts_at, ends_at, time_from, time_to, max_uses, per_customer_limit,
         first_visit_only, stackable, status, coupon_redemptions(count)`
      )
      .eq('organization_id', ctx.organizationId)
      .order('created_at', { ascending: false }),
    supabase.from('stores').select('id, name').eq('organization_id', ctx.organizationId).eq('status', 'active').order('name'),
    supabase.from('menu_categories').select('id, name').eq('organization_id', ctx.organizationId).eq('status', 'active').order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, name')
      .eq('organization_id', ctx.organizationId)
      .neq('status', 'deleted')
      .order('sort_order'),
  ]);

  const rows: CouponRow[] = ((couponRows ?? []) as unknown as CouponQueryRow[]).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    kind: c.kind as 'fixed' | 'percent',
    value: c.value,
    storeId: c.store_id,
    storeName: c.stores?.name ?? null,
    targetCategoryId: c.target_category_id,
    targetMenuItemId: c.target_menu_item_id,
    targetLabel: c.menu_categories?.name ?? c.menu_items?.name ?? '全体',
    minTotal: c.min_total,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    timeFrom: c.time_from,
    timeTo: c.time_to,
    maxUses: c.max_uses,
    perCustomerLimit: c.per_customer_limit,
    firstVisitOnly: c.first_visit_only,
    stackable: c.stackable,
    status: c.status as CouponRow['status'],
    redemptionCount: c.coupon_redemptions?.[0]?.count ?? 0,
  }));

  return (
    <div>
      <PageHeader
        title="クーポン管理"
        description="コード・割引内容・利用条件を管理します（POSでの適用は別画面）"
        actions={<BackLink />}
      />
      <CouponsPanel
        initial={rows}
        stores={(storeRows ?? []).map((s) => ({ id: s.id, name: s.name }))}
        categories={(categoryRows ?? []).map((c) => ({ id: c.id, name: c.name }))}
        items={(itemRows ?? []).map((i) => ({ id: i.id, name: i.name }))}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/app/customers" className="text-sm font-medium text-gray-500 hover:text-primary">
      顧客一覧へ戻る
    </Link>
  );
}
