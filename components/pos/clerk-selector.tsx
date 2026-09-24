'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { UserRound } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';
import { useClerkGate } from './clerk-gate';

export interface ClerkOption {
  id: string;
  name: string;
}

/**
 * 伝票の担当者を選ぶセレクタ。選択すると即座に伝票へ保存され、レシートの担当欄に印字される。
 * 担当者が未登録の店舗では「設定 > POS担当者」への案内を出す。
 */
export function ClerkSelector({
  orderId,
  clerks,
  currentClerkId,
  required = false,
}: {
  orderId: string;
  clerks: ClerkOption[];
  currentClerkId: string | null;
  /** 未選択のときに赤く強調する（注文・会計には担当者が必要） */
  required?: boolean;
}) {
  const { toast } = useToast();
  const gate = useClerkGate();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentClerkId ?? '');
  const appliedRef = useRef(false);

  // レジ（iPad）は入口で担当者を選んでいるので、伝票にはそれをそのまま入れる。
  // 伝票に担当者が入っていないときだけ。手で選び直した伝票は上書きしない（2026-09-24 店舗要望）。
  const gateClerkId = gate?.clerk?.id ?? null;
  useEffect(() => {
    if (!gateClerkId || value || appliedRef.current) return;
    if (!clerks.some((c) => c.id === gateClerkId)) return;
    appliedRef.current = true;
    startTransition(async () => {
      const res = await setOrderClerk(orderId, gateClerkId);
      if (res.ok) setValue(gateClerkId);
      else appliedRef.current = false;
    });
  }, [gateClerkId, value, clerks, orderId]);

  if (clerks.length === 0) {
    return (
      <span className="text-xs text-gray-400">
        担当者未登録（設定 &gt; POS担当者 で追加）
      </span>
    );
  }

  const handleChange = (next: string) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await setOrderClerk(orderId, next || null);
      if (!res.ok) {
        setValue(previous); // 失敗したら選択を元に戻す
        toast(res.error ?? '担当者の設定に失敗しました', 'error');
        return;
      }
      toast(res.clerkName ? `担当: ${res.clerkName}` : '担当者を未設定にしました');
    });
  };

  const missing = required && !value;

  return (
    <label className={cn('flex items-center gap-1.5 text-sm', missing ? 'text-danger' : 'text-gray-600')}>
      <UserRound className={cn('h-4 w-4', missing ? 'text-danger' : 'text-gray-400')} />
      <span className="sr-only">担当者</span>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        aria-invalid={missing || undefined}
        className={cn(
          'rounded-lg border bg-white px-2 py-1 text-sm disabled:opacity-60',
          missing ? 'border-danger bg-danger-soft font-bold text-danger' : 'border-gray-300 text-navy'
        )}
      >
        <option value="">{missing ? '担当者を選んでください' : '担当者を選択'}</option>
        {clerks.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
