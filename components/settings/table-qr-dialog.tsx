'use client';

import { useCallback, useEffect, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { CopyLink } from './copy-link';
import { getTableQr, regenerateTableQrToken } from '@/app/app/settings/tables/actions';

export function TableQrDialog({
  tableId,
  tableName,
  onClose,
}: {
  tableId: string;
  tableName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ url: string; dataUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getTableQr(tableId);
    if (result.error || !result.url || !result.dataUrl) {
      setError(result.error ?? 'QRコードの取得に失敗しました');
    } else {
      setData({ url: result.url, dataUrl: result.dataUrl });
    }
    setLoading(false);
  }, [tableId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const handleRegenerate = async () => {
    const result = await regenerateTableQrToken(tableId);
    if (result.error || !result.url || !result.dataUrl) {
      toast(result.error ?? 'トークンの再発行に失敗しました', 'error');
      return;
    }
    setData({ url: result.url, dataUrl: result.dataUrl });
    toast('QRコードを再発行しました。旧QRコードは無効になりました');
  };

  return (
    <>
      <Dialog open onClose={onClose} title={`QRコード｜${tableName}`}>
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : data ? (
            <>
              <div className="print-area flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-6">
                <p className="text-base font-bold text-navy">{tableName}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.dataUrl} alt={`${tableName}の注文用QRコード`} className="h-56 w-56" width={224} height={224} />
                <p className="text-xs text-gray-500">スマートフォンのカメラで読み取ってください</p>
              </div>

              <CopyLink url={data.url} label="ご注文ページURL" />

              <div className="flex flex-wrap justify-end gap-2 pt-2 print:hidden">
                <Button type="button" variant="secondary" onClick={() => setConfirmOpen(true)}>
                  <RefreshCw className="h-4 w-4" />
                  トークン再発行
                </Button>
                <Button type="button" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                  印刷
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="QRコードを再発行しますか"
        message="トークンを再発行すると、印刷済みの旧QRコードは無効になり読み取れなくなります。テーブルに設置しているQRコードは新しいものにすべて差し替えてください。"
        confirmLabel="再発行する"
        onConfirm={handleRegenerate}
      />
    </>
  );
}
