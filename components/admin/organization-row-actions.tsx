'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { suspendOrganization, reactivateOrganization } from '@/app/admin/organizations/actions';

export function OrganizationRowActions({ organizationId, status }: { organizationId: string; status: string }) {
  const [confirmKind, setConfirmKind] = useState<'suspend' | 'reactivate' | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const canSuspend = status === 'active' || status === 'trial';
  const canReactivate = status === 'suspended';

  const run = async (reason: string) => {
    try {
      if (confirmKind === 'suspend') {
        await suspendOrganization(organizationId, reason);
        toast('企業を停止しました');
      } else if (confirmKind === 'reactivate') {
        await reactivateOrganization(organizationId, reason);
        toast('企業を再開しました');
      }
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作に失敗しました', 'error');
    }
  };

  return (
    <>
      <div className="flex justify-end gap-2">
        {canSuspend && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmKind('suspend')}>
            <Ban className="h-3.5 w-3.5" />
            停止
          </Button>
        )}
        {canReactivate && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmKind('reactivate')}>
            <RotateCcw className="h-3.5 w-3.5" />
            再開
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmKind !== null}
        onClose={() => setConfirmKind(null)}
        title={confirmKind === 'suspend' ? '企業を停止しますか' : '企業を再開しますか'}
        message={
          confirmKind === 'suspend'
            ? 'この企業に所属する全ユーザーが本サービスへログインできなくなります。'
            : 'この企業のユーザーが本サービスへ再度ログインできるようになります。'
        }
        confirmLabel={confirmKind === 'suspend' ? '停止する' : '再開する'}
        requireReason={confirmKind === 'suspend'}
        destructive={confirmKind === 'suspend'}
        onConfirm={run}
      />
    </>
  );
}
