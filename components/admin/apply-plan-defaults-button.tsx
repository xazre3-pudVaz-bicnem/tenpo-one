'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { applyPlanDefaultsToOrg } from '@/app/admin/organizations/actions';

/** プランでOFFの機能を、企業のfeature_flagsへ反映するボタン（ONの機能は変更しない） */
export function ApplyPlanDefaultsButton({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const run = async () => {
    try {
      const result = await applyPlanDefaultsToOrg(organizationId);
      toast(
        result.disabledKeys.length > 0
          ? `${result.disabledKeys.length}件の機能をOFFに反映しました`
          : 'プランでOFFの機能はありませんでした'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : '適用に失敗しました', 'error');
    }
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        プラン既定を適用
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="プラン既定を適用しますか"
        message="現在のプランでOFFに設定されている機能を、この企業のfeature_flagsへ反映します（ONの機能は変更しません）。"
        confirmLabel="適用する"
        destructive={false}
        onConfirm={run}
      />
    </>
  );
}
