'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { deleteBankAccount } from '@/app/app/accounting/banks/actions';

export function BankAccountDelete({ bankAccountId }: { bankAccountId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" /> 削除
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="銀行口座を削除"
        message="この銀行口座を削除します。取り込み済みの取引・仕訳は残ります。よろしいですか？"
        confirmLabel="削除する"
        onConfirm={async () => {
          try {
            await deleteBankAccount(bankAccountId);
            toast('削除しました');
            router.push('/app/accounting/banks');
            router.refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : '削除に失敗しました', 'error');
          }
        }}
      />
    </>
  );
}
