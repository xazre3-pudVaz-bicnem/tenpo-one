import type { Metadata } from 'next';
import { requirePermission } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/state';
import { PrintTrigger } from '@/components/settings/print-trigger';

export const metadata: Metadata = { title: 'テスト印刷' };

export default async function TestPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const ctx = await requirePermission('store.settings');
  const { job } = await searchParams;

  if (!job) {
    return <EmptyState title="印刷ジョブが指定されていません" className="m-6" />;
  }

  const supabase = await createClient();
  const { data: printJob } = await supabase
    .from('print_jobs')
    .select('id, status, printer_config_id, store_id, created_at, stores(name), printer_configs(name)')
    .eq('id', job)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  if (!printJob) {
    return <EmptyState title="印刷ジョブが見つかりません" className="m-6" />;
  }

  const storeName = (printJob.stores as unknown as { name: string } | null)?.name ?? '';
  const printerName = (printJob.printer_configs as unknown as { name: string } | null)?.name ?? '';

  return (
    <div className="mx-auto max-w-sm p-6">
      <style>{`
        @media print {
          aside, header, nav { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>

      <PrintTrigger jobId={printJob.id} />

      <div className="print-area rounded-xl border border-dashed border-gray-300 bg-white p-6 font-mono text-sm text-navy">
        <p className="text-center text-base font-bold">TENPO ONE テスト印刷</p>
        <p className="mt-2 text-center">{storeName}</p>
        {printerName && <p className="text-center text-xs text-gray-500">{printerName}</p>}
        <p className="mt-3 border-t border-dashed border-gray-400 pt-2 text-center text-xs">
          {formatDateTime(new Date())}
        </p>
        <div className="my-4 border-t border-dashed border-gray-400" />
        <p>------------------------------</p>
        <p>罫線サンプル TEST LINE SAMPLE</p>
        <p>------------------------------</p>
        <p className="mt-4 text-center text-xs text-gray-500">このプリンターは正常に印刷できています</p>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400 print:hidden">
        印刷ダイアログが表示されない場合はブラウザの印刷機能（Ctrl+P）をご利用ください
      </p>
    </div>
  );
}
