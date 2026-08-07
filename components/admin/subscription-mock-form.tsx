'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Select, Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  updateOrgSubscriptionMock,
  type SaasSubscriptionStatus,
  type SubscriptionMockInput,
} from '@/app/admin/organizations/actions';

const STATUS_OPTIONS: { value: SaasSubscriptionStatus; label: string }[] = [
  { value: 'inactive', label: '未契約' },
  { value: 'trialing', label: 'トライアル中' },
  { value: 'active', label: '契約中' },
  { value: 'past_due', label: '支払遅延' },
  { value: 'canceled', label: '解約済み' },
];

function toDateInput(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function SubscriptionMockForm({
  organizationId,
  plans,
  initial,
}: {
  organizationId: string;
  plans: { code: string; name: string }[];
  initial: {
    status: SaasSubscriptionStatus;
    planCode: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  };
}) {
  const [status, setStatus] = useState<SaasSubscriptionStatus>(initial.status);
  const [planCode, setPlanCode] = useState(initial.planCode);
  const [periodStart, setPeriodStart] = useState(toDateInput(initial.currentPeriodStart));
  const [periodEnd, setPeriodEnd] = useState(toDateInput(initial.currentPeriodEnd));
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: SubscriptionMockInput = {
      status,
      planCode,
      currentPeriodStart: periodStart || null,
      currentPeriodEnd: periodEnd || null,
    };
    startTransition(async () => {
      try {
        await updateOrgSubscriptionMock(organizationId, input);
        toast('サブスクリプション状態を更新しました');
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Stripe Billing接続前のモック管理です。ここでの変更で実課金は発生しません。
      </div>

      <div>
        <Label htmlFor="sub-status">状態</Label>
        <Select id="sub-status" value={status} onChange={(e) => setStatus(e.target.value as SaasSubscriptionStatus)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="sub-plan">課金プランコード</Label>
        <Select id="sub-plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sub-start">現在の契約期間（開始）</Label>
          <Input id="sub-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sub-end">現在の契約期間（終了）</Label>
          <Input id="sub-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? '保存中…' : '保存する'}
        </Button>
      </div>
    </form>
  );
}
