'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { closeStoreDay } from '@/app/app/cash/actions';
import { ChecklistCard, type ChecklistItem } from '@/components/cash/checklist-card';

/**
 * 店舗日次締め（2段階目）の実行前チェック＋実行ボタン。
 * チェック項目が0件でなくても実行は可能（未締めレジのみRPC側で拒否される）。
 */
export function StoreDayClosePanel({
  storeId,
  businessDate,
  items,
  alreadyClosed,
  canClose,
}: {
  storeId: string;
  businessDate: string;
  items: ChecklistItem[];
  alreadyClosed: boolean;
  canClose: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleClose = () => {
    startTransition(async () => {
      try {
        await closeStoreDay(storeId, businessDate);
        toast(alreadyClosed ? '店舗日次締めを更新しました' : '店舗日次締めを実行しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '店舗日次締めに失敗しました', 'error');
      }
    });
  };

  return (
    <div className="space-y-3">
      <ChecklistCard
        title="店舗日次締め 実行前チェック"
        description="警告があっても実行できます（未締めレジが残っている場合のみ実行できません）。各項目をクリックすると該当ページへ移動します。"
        items={items}
      />
      <div className="flex items-center justify-end gap-3">
        {!canClose && <p className="text-xs text-gray-500">実行には店長以上の権限が必要です</p>}
        {canClose && (
          <Button onClick={handleClose} disabled={pending} size="lg">
            {pending ? '処理中…' : alreadyClosed ? '店舗日次締めを再実行（集計を更新）' : '店舗日次締めを実行'}
          </Button>
        )}
      </div>
    </div>
  );
}
