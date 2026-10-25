import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireCypressAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/state';
import { loadPendingDevices } from '@/lib/device-control-admin-server';
import { PendingDeviceList } from '@/components/admin/pending-device-list';

export const metadata: Metadata = { title: '端末の承認' };

/**
 * コントロールセンター：全店舗の「承認待ち」の端末（2026-10-25 Ronnie「ipad monitor sabai control centre le ok garepaxi balla chalxa」）。
 * 承認制を ON にした店舗（移行期間のあと）の新しいレジ（iPad）・ハンディ・ディスプレイ端末は承認待ちで登録され、
 * ここ（または店舗の詳細）で承認するまで使えない。承認制は店舗の詳細で種類ごとに ON にする（既定 OFF）。
 * 契約（ON/OFF・台数）は店舗の詳細の「端末の契約と承認」で変える。
 */
export default async function AdminDevicesPage() {
  await requireCypressAdmin();
  const { ready, rows } = await loadPendingDevices();

  return (
    <div className="space-y-5">
      <PageHeader
        title="端末の承認"
        description="承認制を ON にした店舗（7日間の移行期間のあと）の新しいレジ（iPad）・ハンディ・ディスプレイ端末は「承認待ち」で登録され、承認するまで使えません。承認制・契約（ON/OFF・台数）は各店舗の詳細で変えます（既定は承認制 OFF＝今まで通り）。"
      />
      {!ready ? (
        <Card>
          <CardContent className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              migration 00104（端末の承認）が未適用です。適用するまでは今まで通り、新しい端末も承認なしで使えます（承認待ちは出ません）。
              Supabase の SQL エディタで <code className="font-mono text-xs">supabase/migrations/00104_control_centre_devices.sql</code> を適用してください。
            </span>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState title="承認待ちの端末はありません" description="承認制を ON にした店舗で新しい端末がつなごうとすると、ここに出ます" />
      ) : (
        <PendingDeviceList rows={rows} />
      )}
      <p className="text-xs text-gray-500">
        店舗ごとの契約・使用中の端末の解除は <Link href="/admin/tenants" className="text-primary hover:underline">導入店舗</Link> → 店舗の詳細 →「端末の契約と承認」から。
      </p>
    </div>
  );
}
