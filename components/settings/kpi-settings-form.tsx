'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { updateKpiSettings } from '@/app/app/settings/company/actions';

/**
 * 客数KPI設定（organizations.kpi_settings.includeTakeoutGuests）。
 * テイクアウト・デリバリー・事前注文の客数を、ダッシュボード/レポート/予算/日報の
 * 客数KPI・客単価に含めるかどうかを切り替える。省略時（未設定の企業）はtrue。
 */
export function KpiSettingsForm({ initialIncludeTakeoutGuests }: { initialIncludeTakeoutGuests: boolean }) {
  const [includeTakeoutGuests, setIncludeTakeoutGuests] = useState(initialIncludeTakeoutGuests);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const toggle = () => {
    const next = !includeTakeoutGuests;
    setIncludeTakeoutGuests(next);
    startTransition(async () => {
      const result = await updateKpiSettings(next);
      if (result.error) {
        setIncludeTakeoutGuests(!next);
        toast(result.error, 'error');
        return;
      }
      toast('KPI設定を保存しました');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPI設定</CardTitle>
      </CardHeader>
      <CardContent>
        <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-4">
          <span className="text-sm text-gray-700">
            テイクアウト・デリバリーの客数を客数KPIに含める
            <span className="mt-0.5 block text-xs text-gray-500">
              オフにすると、ダッシュボード・レポート・予算・日報の客数・客単価は店内飲食（テーブル会計・コース）のみで算出します。
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
            checked={includeTakeoutGuests}
            disabled={pending}
            onChange={toggle}
          />
        </label>
      </CardContent>
    </Card>
  );
}
