import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { pendingJobsByPrinter, printerConnectionRows, type PrinterConnectionDbRow, type PrinterConnectionRow } from '@/lib/printer-connection';

/** 運営コンソールの「プリンター接続」に出す店舗 1 つぶん */
export interface AdminStorePrinterConnections {
  storeId: string;
  storeName: string;
  /** この店のレシート・厨房のプリンター（使っているもの。レシート機が先） */
  printers: PrinterConnectionRow[];
}

/**
 * 運営コンソール（/admin/organizations/[id]）：企業の店舗ごとの「プリンター接続」
 * （2026-10-25 Ronnie「yo data haru pani control centre mai rakhdeu」）。お店の 設定 › レジ・プリンター と同じ行・同じ列
 * （lib/printer-connection.ts の printerConnectionRows）。サービスロールで読む（呼ぶ側で requireCypressAdmin 済み）。
 */
export async function loadOrgPrinterConnections(
  organizationId: string,
  stores: { id: string; name: string }[]
): Promise<AdminStorePrinterConnections[]> {
  if (stores.length === 0) return [];
  const storeIds = stores.map((s) => s.id);
  const admin = createAdminClient();
  const [printersRes, jobsRes] = await Promise.all([
    admin
      .from('printer_configs')
      .select(
        'id, store_id, name, maker, model, connection_type, usage, paper_width_mm, drawer_kick, cloudprnt_enabled, cloudprnt_token, drawer_command, poll_interval_seconds, last_polled_at, mac_address, kitchen_stations'
      )
      .eq('organization_id', organizationId)
      .in('store_id', storeIds)
      .eq('status', 'active')
      .order('name'),
    // 未印刷のまま待っているジョブ数（プリンタ未接続の気付きのため。お店の画面と同じ）
    admin
      .from('print_jobs')
      .select('printer_config_id')
      .eq('organization_id', organizationId)
      .in('store_id', storeIds)
      .eq('target', 'cloudprnt')
      .in('status', ['queued', 'claimed']),
  ]);
  if (printersRes.error) throw new Error(printersRes.error.message);
  if (jobsRes.error) throw new Error(jobsRes.error.message);

  const pending = pendingJobsByPrinter(jobsRes.data ?? []);
  return stores.map((store) => ({
    storeId: store.id,
    storeName: store.name,
    printers: printerConnectionRows(
      (printersRes.data ?? []).filter((p) => p.store_id === store.id) as PrinterConnectionDbRow[],
      pending
    ),
  }));
}
