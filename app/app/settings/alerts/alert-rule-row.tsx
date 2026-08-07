'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { upsertAlertRule, resetAlertRuleToDefault } from './actions';
import type { AlertRuleKey } from '@/components/dashboard/alert-rules';

export interface AlertRuleRowData {
  ruleKey: AlertRuleKey;
  label: string;
  unit: string;
  defaultValue: number;
  orgValue: number | null;
  orgEnabled: boolean;
  storeValue: number | null;
  storeEnabled: boolean;
  effectiveValue: number;
  effectiveSource: 'store' | 'org' | 'default';
}

const SOURCE_LABEL: Record<string, string> = { store: '店舗設定', org: '企業既定', default: 'コード既定値' };
const SOURCE_TONE: Record<string, BadgeTone> = { store: 'primary', org: 'navy', default: 'gray' };

export function AlertRuleRow({
  data,
  storeId,
  canEditOrg,
  canEditStore,
}: {
  data: AlertRuleRowData;
  storeId: string | null;
  canEditOrg: boolean;
  canEditStore: boolean;
}) {
  const [orgInput, setOrgInput] = useState(String(data.orgValue ?? data.defaultValue));
  const [storeInput, setStoreInput] = useState(String(data.storeValue ?? ''));
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const saveOrg = async () => {
    const v = Number(orgInput);
    if (!Number.isFinite(v) || v < 0) {
      toast('数値を正しく入力してください', 'error');
      return;
    }
    setBusy(true);
    try {
      await upsertAlertRule({ storeId: null, ruleKey: data.ruleKey, threshold: v, enabled: true });
      toast('企業既定を保存しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveStore = async () => {
    if (!storeId) return;
    const v = Number(storeInput);
    if (!Number.isFinite(v) || v < 0) {
      toast('数値を正しく入力してください', 'error');
      return;
    }
    setBusy(true);
    try {
      await upsertAlertRule({ storeId, ruleKey: data.ruleKey, threshold: v, enabled: true });
      toast('店舗設定を保存しました');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetStore = async () => {
    if (!storeId) return;
    setBusy(true);
    try {
      await resetAlertRuleToDefault(storeId, data.ruleKey);
      toast('企業既定に戻しました');
      setStoreInput('');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : '削除に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <p className="font-medium text-navy">{data.label}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
          有効値: {data.effectiveValue.toLocaleString('ja-JP')}
          {data.unit}
          <Badge tone={SOURCE_TONE[data.effectiveSource]}>{SOURCE_LABEL[data.effectiveSource]}</Badge>
        </p>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step="any"
            value={orgInput}
            onChange={(e) => setOrgInput(e.target.value)}
            disabled={!canEditOrg || busy}
            className="w-28"
          />
          {canEditOrg && (
            <Button size="sm" variant="secondary" onClick={() => void saveOrg()} disabled={busy}>
              保存
            </Button>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {storeId ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="未設定"
              value={storeInput}
              onChange={(e) => setStoreInput(e.target.value)}
              disabled={!canEditStore || busy}
              className="w-28"
            />
            {canEditStore && (
              <>
                <Button size="sm" variant="secondary" onClick={() => void saveStore()} disabled={busy}>
                  保存
                </Button>
                {data.storeValue != null && (
                  <Button size="sm" variant="ghost" onClick={() => void resetStore()} disabled={busy} title="企業既定に戻す">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">店舗を選択してください</span>
        )}
      </td>
    </tr>
  );
}
