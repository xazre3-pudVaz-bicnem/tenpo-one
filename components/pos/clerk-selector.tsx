'use client';

import { useState, useTransition } from 'react';
import { UserRound } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { setOrderClerk } from '@/app/app/pos/clerk-actions';

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
}: {
  orderId: string;
  clerks: ClerkOption[];
  currentClerkId: string | null;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentClerkId ?? '');

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

  return (
    <label className="flex items-center gap-1.5 text-sm text-gray-600">
      <UserRound className="h-4 w-4 text-gray-400" />
      <span className="sr-only">担当者</span>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-navy disabled:opacity-60"
      >
        <option value="">担当者を選択</option>
        {clerks.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
