import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/state';
import { SettingsBackLink } from '@/components/settings/back-link';
import { DisplayDevicesPanel } from '@/components/settings/display-devices-panel';
import { loadDisplayDevicesPayload } from '@/lib/display-monitor-server';
import { issueDisplayPairing, renameDisplayDevice, updateDisplayDevice } from './actions';

export const metadata: Metadata = { title: 'ディスプレイ端末 | 設定' };

/** 描画の基準時刻（「使用中」の判定の初期値） */
function requestTime() {
  return Date.now();
}

/**
 * 設定 › デバイス管理 › ディスプレイ端末（キッチンディスプレイ・呼び出しモニター。2026-10-24 Ronnie）。
 * 一覧（デバイス管理）に出るのは、運営がこの企業・店舗で ON にしたときだけ（lib/settings-hubs.ts）。
 * 直接開いたときは OFF の案内を出す。端末の解除・承認は TENPO ONE 運営（コントロールセンター）で行う（2026-10-25）。
 */
export default async function DisplayDevicesSettingsPage() {
  const ctx = await requirePermission('store.settings');
  const store = ctx.currentStore ?? ctx.stores[0];

  if (!store) {
    return (
      <div>
        <SettingsBackLink />
        <PageHeader title="ディスプレイ端末" en="Display monitors" />
        <EmptyState title="対象の店舗がありません" description="店舗を選択してから設定を行ってください" />
      </div>
    );
  }

  const supabase = await createClient();
  const payload = await loadDisplayDevicesPayload(supabase, { organizationId: ctx.organizationId, canEdit: true }, { id: store.id, name: store.name });

  return (
    <div>
      <SettingsBackLink />
      <PageHeader title="ディスプレイ端末" en="Display monitors" description={store.name} />
      <DisplayDevicesPanel
        payload={payload}
        now={requestTime()}
        issueAction={issueDisplayPairing}
        // 端末の解除・承認・台数は TENPO ONE 運営（コントロールセンター）で行う（2026-10-25）。QR の表示・名前・種類・持ち場はここで
        renameAction={renameDisplayDevice}
        updateAction={updateDisplayDevice}
      />
    </div>
  );
}
