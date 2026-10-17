'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { deleteOrphanMenuItems } from '@/app/app/settings/menu/actions';

/**
 * 設定 > カテゴリ：消したカテゴリに残っている商品（どこにも出ない商品）をまとめて削除扱いにする。
 * 0件なら何も出さない。2026-10-17 SHUNKA 新宿本店（メニュー入れ直しで旧商品 919 件が残った）。
 */
export function OrphanItemsPanel({ storeId, count }: { storeId: string; count: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (count <= 0) return null;

  return (
    <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3">
      <p className="text-sm font-semibold text-navy">消したカテゴリに残っている商品：{count.toLocaleString('ja-JP')}件</p>
      <p className="mt-1 text-xs text-gray-600">
        カテゴリを削除しても商品は残ります。残った商品はレジ・ハンディ・お客様QRのどこにも出ませんが、
        商品が 1,000 件を超えるとメニューの読み込みが途中で切れて新しい商品が出ないことがあります。
        メニューを入れ直したあとは、ここでまとめて削除してください（元には戻せません）。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-4 w-4" />
        {pending ? '削除中…' : `${count.toLocaleString('ja-JP')}件を削除する`}
      </Button>
      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          title="消したカテゴリに残っている商品を削除"
          message={`${count.toLocaleString('ja-JP')}件の商品を削除扱いにします。いまのカテゴリに入っている商品は触りません。元には戻せません。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            await new Promise<void>((resolve) => {
              startTransition(async () => {
                const result = await deleteOrphanMenuItems(storeId);
                if (result.error) toast(result.error, 'error');
                else toast(`${(result.deleted ?? 0).toLocaleString('ja-JP')}件を削除しました`);
                router.refresh();
                resolve();
              });
            });
          }}
        />
      )}
    </div>
  );
}
