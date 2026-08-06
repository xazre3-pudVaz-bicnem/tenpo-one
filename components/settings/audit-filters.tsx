'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface AuditFilterValues {
  from: string;
  to: string;
  action: string;
  targetTable: string;
}

export function AuditFilters({ current }: { current: AuditFilterValues }) {
  const router = useRouter();
  const [form, setForm] = useState(current);

  const apply = () => {
    const params = new URLSearchParams();
    if (form.from) params.set('from', form.from);
    if (form.to) params.set('to', form.to);
    if (form.action) params.set('action', form.action);
    if (form.targetTable) params.set('table', form.targetTable);
    const qs = params.toString();
    router.push(qs ? `/app/settings/audit?${qs}` : '/app/settings/audit');
  };

  const reset = () => {
    setForm({ from: '', to: '', action: '', targetTable: '' });
    router.push('/app/settings/audit');
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="audit-from">期間（開始）</Label>
        <Input id="audit-from" type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} />
      </div>
      <div>
        <Label htmlFor="audit-to">期間（終了）</Label>
        <Input id="audit-to" type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
      </div>
      <div>
        <Label htmlFor="audit-action">アクション</Label>
        <Input
          id="audit-action"
          value={form.action}
          onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
          placeholder="staff.role_change 等"
          className="w-48"
        />
      </div>
      <div>
        <Label htmlFor="audit-table">対象テーブル</Label>
        <Input
          id="audit-table"
          value={form.targetTable}
          onChange={(e) => setForm((f) => ({ ...f, targetTable: e.target.value }))}
          placeholder="memberships 等"
          className="w-48"
        />
      </div>
      <Button size="sm" onClick={apply}>
        絞り込む
      </Button>
      <Button size="sm" variant="secondary" onClick={reset}>
        リセット
      </Button>
    </div>
  );
}
