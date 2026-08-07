'use client';

import { useState, useTransition } from 'react';
import { Loader2, Archive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { createMockDrawerProvider } from '@/lib/printing/providers';
import type { DrawerResultStatus } from '@/lib/printing/types';
import { saveDrawerSettings, type DrawerSettings } from '@/app/app/settings/printers/actions';

const DRAWER_STATUS_LABELS: Record<DrawerResultStatus, string> = {
  opened: '開放しました（シミュレーション）',
  failed: '開放に失敗しました（シミュレーション）',
  offline: 'オフラインです（シミュレーション）',
};

export function DrawerPanel({ storeId, initial }: { storeId: string; initial: DrawerSettings }) {
  const { toast } = useToast();
  const [autoOpenOnCash, setAutoOpenOnCash] = useState(initial.autoOpenOnCash);
  const [openOnCashless, setOpenOnCashless] = useState(initial.openOnCashless);
  const [savePending, startSave] = useTransition();
  const [testPending, startTest] = useTransition();
  const [testResult, setTestResult] = useState<DrawerResultStatus | null>(null);

  const handleSave = () => {
    startSave(async () => {
      const result = await saveDrawerSettings(storeId, { autoOpenOnCash, openOnCashless });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('ドロア設定を保存しました');
    });
  };

  const handleTest = () => {
    startTest(async () => {
      const result = await createMockDrawerProvider('opened').open();
      setTestResult(result.status);
      toast(DRAWER_STATUS_LABELS[result.status], result.status === 'opened' ? 'success' : 'error');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-navy">キャッシュドロア</p>
          <Badge tone="warning">実機未接続（シミュレーション）</Badge>
        </div>
        <p className="text-xs text-gray-500">
          プリンター経由でのドロア開放（ドロアキック）は実機SDK接続後に対応します。現在は動作確認用のシミュレーションです。
        </p>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={autoOpenOnCash}
            onChange={(e) => setAutoOpenOnCash(e.target.checked)}
          />
          現金会計時に自動でドロアを開く
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={openOnCashless}
            onChange={(e) => setOpenOnCashless(e.target.checked)}
          />
          キャッシュレス会計時にも開く
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={savePending}>
            {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            設定を保存
          </Button>
          <Button size="sm" variant="secondary" onClick={handleTest} disabled={testPending}>
            <Archive className="h-4 w-4" />
            ドロアテスト
          </Button>
          {testResult && (
            <Badge tone={testResult === 'opened' ? 'success' : 'danger'}>{DRAWER_STATUS_LABELS[testResult]}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
