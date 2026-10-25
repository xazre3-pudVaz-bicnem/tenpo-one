'use client';

import Link from 'next/link';
import type { PendingDeviceRow } from '@/lib/device-control-admin-server';
import { DeviceItem } from '@/components/admin/store-device-control-panel';

/** 全店舗の承認待ち（/admin/devices）。店舗ごとに並べ、承認・却下は店舗の詳細と同じボタン */
export function PendingDeviceList({ rows }: { rows: PendingDeviceRow[] }) {
  const stores = new Map<string, { name: string; org: string; rows: PendingDeviceRow[] }>();
  for (const r of rows) {
    const s = stores.get(r.storeId) ?? { name: r.storeName, org: r.organizationName, rows: [] };
    s.rows.push(r);
    stores.set(r.storeId, s);
  }
  return (
    <div className="space-y-4">
      {[...stores.entries()].map(([storeId, s]) => (
        <section key={storeId} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-navy">
              {s.name || '店舗'}
              {s.org && <span className="ml-2 text-xs font-normal text-gray-500">{s.org}</span>}
            </p>
            <Link href={`/admin/tenants/${storeId}#device-control`} className="text-xs font-medium text-primary hover:underline">
              店舗の契約・端末を見る
            </Link>
          </div>
          <ul className="space-y-1.5">
            {s.rows.map((d) => (
              <DeviceItem key={`${d.type}:${d.id}`} device={d} storeId={storeId} ready highlight />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
