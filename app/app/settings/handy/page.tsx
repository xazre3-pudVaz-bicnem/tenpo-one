import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { HandyDevicesPanel, type HandyDeviceRow } from '@/components/settings/handy-devices-panel';
import { issueHandyPairing, revokeHandyDevice, renameHandyDevice } from './actions';
import { selectDevicesWithApproval } from '@/lib/device-control-server';

export const metadata: Metadata = { title: 'ハンディ端末 | 設定' };

export default async function HandyDevicesSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="ハンディ端末" en="Handy devices" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  // 承認の列（コントロールセンター・migration 00104）があれば一緒に読む
  const { rows: devices } = await selectDevicesWithApproval<Record<string, unknown>>(
    (columns) => supabase.from('handy_devices').select(columns).eq('store_id', store.id).order('paired_at', { ascending: false }),
    'id, name, status, paired_at, last_seen_at, paired_ip, user_agent'
  );

  const rows: HandyDeviceRow[] = devices.map((d) => ({
    id: d.id as string,
    name: d.name as string,
    status: d.status === 'revoked' ? 'revoked' : 'active',
    pairedAt: d.paired_at as string,
    lastSeenAt: (d.last_seen_at as string | null) ?? null,
    pairedIp: (d.paired_ip as string | null) ?? null,
    userAgent: (d.user_agent as string | null) ?? null,
    approval: d.approval,
  }));

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="ハンディ端末" en="Handy devices" description={store.name} />
      <HandyDevicesPanel
        storeId={store.id}
        storeName={store.name}
        siteUrl={siteUrl}
        devices={rows}
        issueAction={issueHandyPairing}
        // 新しい端末の承認・台数は TENPO ONE 運営（コントロールセンター）。なくした端末の解除・名前・QR の表示はここでも（2026-10-25）
        revokeAction={revokeHandyDevice}
        renameAction={renameHandyDevice}
      />
    </div>
  );
}
