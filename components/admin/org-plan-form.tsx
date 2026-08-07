'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { changeOrgPlan } from '@/app/admin/organizations/actions';

export function OrgPlanForm({
  organizationId,
  currentPlanCode,
  plans,
}: {
  organizationId: string;
  currentPlanCode: string;
  plans: { code: string; name: string }[];
}) {
  const [planCode, setPlanCode] = useState(currentPlanCode);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const handleSubmit = () => {
    startTransition(async () => {
      try {
        await changeOrgPlan(organizationId, planCode);
        toast('プランを変更しました');
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'プラン変更に失敗しました', 'error');
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="w-40">
        {plans.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSubmit}
        disabled={pending || planCode === currentPlanCode}
      >
        {pending ? '変更中…' : '変更する'}
      </Button>
    </div>
  );
}
