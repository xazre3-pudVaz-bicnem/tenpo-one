import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { claimNextJob, finishJob, generateKitchenJobs, releaseJob, touchPrinter, type PrinterRow } from '@/lib/print-queue';
import { isLanRelayPrinter, parseLanTarget } from '@/lib/direct-print';
import { eposXmlToEscPos } from '@/lib/escpos';
import type { NativePrintJob } from '@/lib/native-pos';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 注文確定のあと、その場で厨房伝票を作って、iPad から LAN で直接出せる分（SII RP-F10・EPSON など、お店の中の IP が
 * 入っているプリンター）を claimed にして返す（2026-10-21 Ronnie「印刷は超速く」。サーバーの順番待ち・1秒ごとの取りに行く
 * のを待たず、注文の返事と一緒に印刷データを渡す）。
 * iPad から出せなかった（unreachable）ときは printDone で戻すと、今まで通り Web の DirectPrintAgent かプリンター自身が出す。
 * Star（CloudPRNT）はプリンター自身が取りに来るのでここには入らない。
 */
export async function claimLanKitchenPrints(admin: Admin, storeId: string, maxPerPrinter = 6): Promise<NativePrintJob[]> {
  const { data } = await admin
    .from('printer_configs')
    .select('id, organization_id, store_id, name, usage, paper_width_mm, kitchen_stations, auto_print, floor_ids, bill_slips, upside_down, maker, ip_address, connection_type, last_polled_at')
    .eq('store_id', storeId)
    .eq('usage', 'kitchen')
    .eq('cloudprnt_enabled', true)
    .eq('status', 'active');
  const printers = ((data ?? []) as (PrinterRow & { connection_type?: string | null })[]).filter((p) =>
    isLanRelayPrinter({ maker: p.maker, connection: p.connection_type, ip: p.ip_address })
  );
  const out: NativePrintJob[] = [];
  await Promise.all(
    printers.map(async (printer) => {
      const target = parseLanTarget(printer.ip_address);
      if (!target) return;
      try {
        await generateKitchenJobs(admin, printer, { batchDelaySeconds: 0 });
        for (let i = 0; i < maxPerPrinter; i++) {
          const job = await claimNextJob(admin, printer.id);
          if (!job) break;
          const epos = job.payload?.epos;
          const bytes = epos ? eposXmlToEscPos(epos) : null;
          if (!bytes) {
            await finishJob(admin, printer.id, job.id, false, 'LAN 用の印刷データがありません');
            continue;
          }
          out.push({
            id: job.id,
            printerId: printer.id,
            printerName: printer.name,
            host: target.host,
            port: target.port,
            data: Buffer.from(bytes).toString('base64'),
          });
        }
      } catch (e) {
        console.error('[native-print] claim failed', printer.id, e instanceof Error ? e.message : e);
      }
    })
  );
  return out;
}

/** iPad から LAN で出した結果（/api/print/direct の done と同じ） */
export async function finishLanPrint(
  admin: Admin,
  printerId: string,
  jobId: string,
  result: 'printed' | 'unreachable' | 'failed',
  code: string | null
): Promise<void> {
  if (result === 'printed') {
    await finishJob(admin, printerId, jobId, true);
    await touchPrinter(admin, printerId);
  } else if (result === 'unreachable') {
    // iPad からプリンターにつながらなかった → キューに戻す（Web の DirectPrintAgent かプリンター自身が出す）
    await releaseJob(admin, printerId, jobId);
  } else {
    await finishJob(admin, printerId, jobId, false, code ?? 'lan: printer error');
  }
}
