'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updateStage, setEnvironment, setEnabledModules } from '@/app/admin/tenants/actions';
import {
  ENVIRONMENTS, MODULES, ENVIRONMENT_LABELS, STAGE_LABELS, MODULE_LABELS,
  STAGE_TRANSITIONS, type Environment, type Stage,
} from '@/lib/tenant-onboarding';

export function TenantControls({
  storeId,
  stage,
  environment,
  enabledModules,
}: {
  storeId: string;
  stage: Stage;
  environment: Environment;
  enabledModules: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [modules, setModules] = useState<string[]>(enabledModules);

  // 現在ステージ + 遷移可能なステージのみ選択肢に
  const stageOptions = [stage, ...(STAGE_TRANSITIONS[stage] ?? [])];

  const run = (fn: () => Promise<unknown>, ok: string) =>
    startTransition(async () => {
      try {
        await fn();
        toast(ok);
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });

  const toggleModule = (m: string) => {
    const next = modules.includes(m) ? modules.filter((x) => x !== m) : [...modules, m];
    setModules(next);
    run(() => setEnabledModules({ storeId, modules: next }), '利用モジュールを更新しました');
  };

  return (
    <Card>
      <CardHeader><CardTitle>導入ステータス</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tc-stage">ステージ</Label>
            <Select
              id="tc-stage"
              value={stage}
              disabled={pending}
              onChange={(e) => run(() => updateStage({ storeId, stage: e.target.value as Stage }), 'ステージを更新しました')}
            >
              {stageOptions.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s as Stage]}{s === stage ? '（現在）' : ''}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tc-env">環境</Label>
            <Select
              id="tc-env"
              value={environment}
              disabled={pending}
              onChange={(e) => run(() => setEnvironment({ storeId, environment: e.target.value as Environment }), '環境を更新しました')}
            >
              {ENVIRONMENTS.map((e) => (<option key={e} value={e}>{ENVIRONMENT_LABELS[e]}</option>))}
            </Select>
          </div>
        </div>

        <div>
          <Label>利用モジュール（Go Live判定の対象）</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {MODULES.map((m) => {
              const on = modules.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={pending}
                  onClick={() => toggleModule(m)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${on ? 'border-primary bg-primary-soft text-primary-deep' : 'border-gray-300 text-gray-500'}`}
                >
                  {MODULE_LABELS[m]}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-gray-500">使わない機能は外すと、その機能のチェック項目はGo Live判定から除外されます。</p>
        </div>
      </CardContent>
    </Card>
  );
}
