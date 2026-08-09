'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateLeadStatus } from './actions';

const OPTIONS = [
  { value: 'new', label: '未対応' },
  { value: 'contacted', label: '対応中' },
  { value: 'closed', label: '完了' },
];

export function LeadStatusSelect({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          await updateLeadStatus(id, next);
          router.refresh();
        });
      }}
      className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-navy disabled:opacity-50"
      aria-label="対応状況"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
