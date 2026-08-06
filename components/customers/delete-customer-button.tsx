'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { deleteCustomer } from '@/app/app/customers/actions';

export function DeleteCustomerButton({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" />
        削除
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="顧客を削除"
        message={`「${customerName}」を削除します。この操作は履歴に記録され、一覧・検索から除外されます。`}
        confirmLabel="削除する"
        requireReason
        destructive
        onConfirm={async (reason) => {
          try {
            await deleteCustomer(customerId, reason);
            toast('顧客を削除しました');
            router.push('/app/customers');
          } catch (err) {
            toast(err instanceof Error ? err.message : '削除に失敗しました', 'error');
            throw err;
          }
        }}
      />
    </>
  );
}
