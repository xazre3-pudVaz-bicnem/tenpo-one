import type { Metadata } from 'next';
import { requireFeature, requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { KdsBoard } from '@/components/kitchen/kds-board';
import { setItemKitchenStatus, markOrderServed, updateKdsSettings } from './actions';
import { loadKdsBoard } from '@/lib/kds-server';

export const metadata: Metadata = { title: 'キッチン（KDS）' };

export default async function KitchenPage() {
  await requireFeature('kds');
  const ctx = await requirePermission('pos.order');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <PageHeader title="キッチン" />
        <EmptyState title="アクセス可能な店舗がありません" description="管理者に店舗の割り当てを依頼してください" />
      </div>
    );
  }

  const supabase = await createClient();
  const { groups, now, unservedCount, avgElapsedMinutes, kdsSettings } = await loadKdsBoard(supabase, store);

  return (
    <div>
      <PageHeader title="キッチン" description={`${store.name}｜注文の古い順に表示`} />
      <KdsBoard
        storeId={store.id}
        groups={groups}
        now={now}
        unservedCount={unservedCount}
        avgElapsedMinutes={avgElapsedMinutes}
        kdsSettings={kdsSettings}
        canManageSettings={can(ctx.role, 'store.settings')}
        setItemStatusAction={setItemKitchenStatus}
        markOrderServedAction={markOrderServed}
        updateKdsSettingsAction={updateKdsSettings}
      />
    </div>
  );
}
