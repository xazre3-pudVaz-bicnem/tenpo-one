'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, RotateCcw, XCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  suspendOrganization,
  reactivateOrganization,
  cancelOrganization,
  markOrganizationPendingDeletion,
} from '@/app/admin/organizations/actions';

type ConfirmKind = 'suspend' | 'reactivate' | 'cancel' | 'pending_deletion';

const CONFIRM_META: Record<ConfirmKind, { title: string; message: string; confirmLabel: string; requireReason: boolean }> = {
  suspend: {
    title: '企業を停止しますか',
    message: 'この企業に所属する全ユーザーが本サービスへログインできなくなります。',
    confirmLabel: '停止する',
    requireReason: true,
  },
  reactivate: {
    title: '企業を再開しますか',
    message: 'この企業のユーザーが本サービスへ再度ログインできるようになります。',
    confirmLabel: '再開する',
    requireReason: false,
  },
  cancel: {
    title: '企業を解約しますか',
    message:
      '契約を解約し、全ユーザーがログインできなくなります。データは物理削除されません（実削除は別途の運用手順に従います）。',
    confirmLabel: '解約する',
    requireReason: true,
  },
  pending_deletion: {
    title: '削除待ちへ遷移しますか',
    message:
      '解約済み企業を「削除待ち」に遷移します。この操作自体はデータを物理削除しません。実削除は保持期限経過後、別途の運用手順に従って行われます。',
    confirmLabel: '削除待ちにする',
    requireReason: true,
  },
};

/** 契約企業のステータス遷移（active/trial ↔ suspended → cancelled → pending_deletion）。物理削除は行わない。 */
export function OrganizationRowActions({ organizationId, status }: { organizationId: string; status: string }) {
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const canSuspend = status === 'active' || status === 'trial';
  const canReactivate = status === 'suspended';
  const canCancel = status === 'active' || status === 'trial' || status === 'suspended';
  const canMarkPendingDeletion = status === 'cancelled';

  const run = async (reason: string) => {
    try {
      if (confirmKind === 'suspend') {
        await suspendOrganization(organizationId, reason);
        toast('企業を停止しました');
      } else if (confirmKind === 'reactivate') {
        await reactivateOrganization(organizationId, reason);
        toast('企業を再開しました');
      } else if (confirmKind === 'cancel') {
        await cancelOrganization(organizationId, reason);
        toast('企業を解約しました');
      } else if (confirmKind === 'pending_deletion') {
        await markOrganizationPendingDeletion(organizationId, reason);
        toast('削除待ちへ遷移しました');
      }
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作に失敗しました', 'error');
    }
  };

  const meta = confirmKind ? CONFIRM_META[confirmKind] : null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
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
        {canCancel && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmKind('cancel')}>
            <XCircle className="h-3.5 w-3.5" />
            解約
          </Button>
        )}
        {canMarkPendingDeletion && (
          <Button variant="danger" size="sm" onClick={() => setConfirmKind('pending_deletion')}>
            <Trash2 className="h-3.5 w-3.5" />
            削除待ちにする
          </Button>
        )}
      </div>

      {meta && (
        <ConfirmDialog
          open={confirmKind !== null}
          onClose={() => setConfirmKind(null)}
          title={meta.title}
          message={meta.message}
          confirmLabel={meta.confirmLabel}
          requireReason={meta.requireReason}
          destructive={confirmKind !== 'reactivate'}
          onConfirm={run}
        />
      )}
    </>
  );
}
