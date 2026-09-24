import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { ClerksPanel, type ClerkRow } from '@/components/settings/clerks-panel';
import { loadStoreClerks } from '@/lib/pos-clerks-server';

export const metadata: Metadata = { title: 'POS担当者 | 設定' };

export default async function ClerksSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const targetStore = ctx.currentStore ?? ctx.stores[0];

  if (!targetStore) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="POS担当者" en="Clerks" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const rows: ClerkRow[] = (await loadStoreClerks(supabase, targetStore.id, { includeHidden: true })).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    role: c.role,
  }));

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="POS担当者" en="Clerks" description={targetStore.name} />
      <ClerksPanel storeId={targetStore.id} initial={rows} />
    </div>
  );
}
