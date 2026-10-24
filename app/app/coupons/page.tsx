import type { Metadata } from 'next';
import Link from 'next/link';
import { requireFeature } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { CouponsPanel } from './coupons-panel';
import { loadCouponsData } from '@/lib/coupons-data-server';

export const metadata: Metadata = { title: 'クーポン管理' };

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

  // 読み込みは lib/coupons-data-server.ts（iPad アプリのネイティブ画面と共用）
  const { rows, stores, categories, items } = await loadCouponsData(await createClient(), ctx.organizationId ?? '');

  return (
    <div>
      <PageHeader
        title="クーポン管理"
        description="コード・割引内容・利用条件を管理します（POSでの適用は別画面）"
        actions={<BackLink />}
      />
      <CouponsPanel initial={rows} stores={stores} categories={categories} items={items} />
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
