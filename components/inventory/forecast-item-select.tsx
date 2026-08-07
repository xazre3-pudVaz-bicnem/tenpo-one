'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/input';

interface ItemOption {
  id: string;
  name: string;
}

/** 予測タブの品目セレクト。選択すると即座に ?tab=forecast&item=... へ遷移する */
export function ForecastItemSelect({ items, selectedId }: { items: ItemOption[]; selectedId: string | null }) {
  const router = useRouter();

  return (
    <Select
      className="w-64"
      value={selectedId ?? ''}
      onChange={(e) => {
        const params = new URLSearchParams({ tab: 'forecast' });
        if (e.target.value) params.set('item', e.target.value);
        router.push(`/app/inventory?${params.toString()}`);
      }}
    >
      <option value="">品目を選択してください</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </Select>
  );
}
