'use client';

import { useTransition, useState } from 'react';
import { Info } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { updateCustomerConsent } from '@/app/app/customers/actions';
import { CONSENT_LABELS, CONSENT_TYPES, type ConsentType } from '@/components/customers/labels';
import { formatDate } from '@/lib/format';

export interface ConsentState {
  granted: boolean;
  grantedAt: string | null;
}

export function ConsentPanel({
  customerId,
  consents,
  canEdit,
}: {
  customerId: string;
  consents: Record<ConsentType, ConsentState>;
  canEdit: boolean;
}) {
  const [pendingType, setPendingType] = useState<ConsentType | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const handleToggle = (type: ConsentType, next: boolean) => {
    setPendingType(type);
    startTransition(async () => {
      try {
        await updateCustomerConsent(customerId, type, next);
        toast(next ? '同意を記録しました' : '同意を取り消しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      } finally {
        setPendingType(null);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>同意状態</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-gray-100">
          {CONSENT_TYPES.map((type) => {
            const state = consents[type];
            return (
              <li key={type} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium text-navy">{CONSENT_LABELS[type]}</p>
                  <p className="text-xs text-gray-500">
                    {state.granted ? `同意済み（${state.grantedAt ? formatDate(state.grantedAt) : '—'}）` : '未同意'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.granted}
                  aria-label={CONSENT_LABELS[type]}
                  disabled={!canEdit || pendingType === type}
                  onClick={() => handleToggle(type, !state.granted)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    state.granted ? 'bg-primary' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      state.granted ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>配信同意のない顧客へはメッセージを送信できません。</p>
        </div>
      </CardContent>
    </Card>
  );
}
