'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/input';
import type { StoreRef } from '@/lib/auth';

const STATUS_OPTIONS = [
  { value: 'active', label: '有効' },
  { value: 'invited', label: '招待中' },
  { value: 'suspended', label: '停止中' },
];

export function StaffFilters({
  roles,
  stores,
  current,
}: {
  roles: { value: string; label: string }[];
  stores: StoreRef[];
  current: { role: string; store: string; status: string };
}) {
  const router = useRouter();

  const update = (key: 'role' | 'store' | 'status', value: string) => {
    const params = new URLSearchParams();
    const next = { ...current, [key]: value };
    if (next.role) params.set('role', next.role);
    if (next.store) params.set('store', next.store);
    if (next.status) params.set('status', next.status);
    const qs = params.toString();
    router.push(qs ? `/app/staff?${qs}` : '/app/staff');
  };

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <div className="w-40">
        <Select value={current.role} onChange={(e) => update('role', e.target.value)} aria-label="ロールで絞込">
          <option value="">すべてのロール</option>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-40">
        <Select value={current.store} onChange={(e) => update('store', e.target.value)} aria-label="店舗で絞込">
          <option value="">すべての店舗</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-36">
        <Select value={current.status} onChange={(e) => update('status', e.target.value)} aria-label="状態で絞込">
          <option value="">すべての状態</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
