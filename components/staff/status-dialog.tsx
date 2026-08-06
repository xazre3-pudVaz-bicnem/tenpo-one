'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { setMemberStatus } from '@/app/app/staff/actions';
import { useToast } from '@/components/ui/toast';

export function StatusDialog({
  membershipId,
  profileId,
  targetStatus,
  displayName,
  onClose,
}: {
  membershipId: string;
  profileId: string;
  targetStatus: 'active' | 'suspended';
  displayName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const suspending = targetStatus === 'suspended';

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={suspending ? '利用停止' : '利用再開'}
      message={
        suspending
          ? `${displayName} 様を利用停止にします。ログイン・打刻ができなくなります。`
          : `${displayName} 様の利用を再開します。`
      }
      confirmLabel={suspending ? '利用停止する' : '再開する'}
      destructive={suspending}
      requireReason={suspending}
      onConfirm={async (reason) => {
        const result = await setMemberStatus({ membershipId, profileId, status: targetStatus, reason });
        if (result.error) {
          toast(result.error, 'error');
          return;
        }
        toast(suspending ? '利用停止にしました' : '利用を再開しました');
      }}
    />
  );
}
