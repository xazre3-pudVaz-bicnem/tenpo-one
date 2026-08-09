'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { anonymizeCustomer } from '@/app/app/customers/actions';

/**
 * 顧客の個人情報を匿名化する導線（データ保護 PHASE6）。
 * org.settings権限保有者のみ表示（customer detail pageで制御）。取消不可のため理由入力必須+確認ダイアログ。
 */
export function AnonymizeCustomerButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UserX className="h-3.5 w-3.5" />
        個人情報を匿名化
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="個人情報を匿名化"
        message={`「${customerName}」の氏名・連絡先・住所・生年月日・自由記述メモ等を匿名化します。来店・注文・ポイント等の取引実績は保持されますが、この操作は取り消せません。`}
        confirmLabel="匿名化する"
        requireReason
        destructive
        onConfirm={async (reason) => {
          try {
            await anonymizeCustomer(customerId, reason);
            toast('顧客情報を匿名化しました');
            router.refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : '匿名化に失敗しました', 'error');
            throw err;
          }
        }}
      />
    </>
  );
}
