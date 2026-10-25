import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadStoreDeviceControl } from '@/lib/device-control-admin-server';
import { StoreDeviceControlPanel } from '@/components/admin/store-device-control-panel';

/**
 * 運営コンソールの店舗の詳細（/admin/tenants/[storeId]）に出す「端末の契約と承認（コントロールセンター）」。
 * 読み込みはここで行う（ページのファイルには1行足すだけ）。
 */
export async function StoreDeviceControl({ storeId }: { storeId: string }) {
  const data = await loadStoreDeviceControl(storeId);
  if (!data) return null;
  // 保存のあと（router.refresh）に新しい値で入力欄を作り直す
  const key = JSON.stringify([data.register, data.handy, data.display.enabled, data.display.limit, data.approval]);
  return (
    <Card id="device-control">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>端末の契約と承認（コントロールセンター）</CardTitle>
        <Link href="/admin/devices" className="text-xs font-medium text-primary hover:underline">
          全店舗の承認待ちへ
        </Link>
      </CardHeader>
      <CardContent>
        <StoreDeviceControlPanel key={key} data={data} />
      </CardContent>
    </Card>
  );
}
