'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Circle, CheckCircle2, AlertTriangle, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { toggleChecklistItem, approveGoLive } from '@/app/admin/tenants/actions';
import {
  CHECKLIST, isItemRelevant, isItemDone,
  type OnboardingSignals, type ChecklistState, type OnboardingProgress, type GoLiveResult, type Stage,
} from '@/lib/tenant-onboarding';

export function TenantChecklist({
  storeId,
  signals,
  checklist,
  enabledModules,
  progress,
  goLive,
  stage,
}: {
  storeId: string;
  signals: OnboardingSignals;
  checklist: ChecklistState;
  enabledModules: string[];
  progress: OnboardingProgress;
  goLive: GoLiveResult;
  stage: Stage;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const toggle = (itemKey: string, done: boolean) =>
    startTransition(async () => {
      try {
        await toggleChecklistItem({ storeId, itemKey, done });
        router.refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : '更新に失敗しました', 'error');
      }
    });

  const doApprove = () =>
    startTransition(async () => {
      try {
        const res = await approveGoLive({ storeId });
        if (res.ok) {
          toast('Go Live を承認しました（本番稼働）');
          router.refresh();
        } else {
          toast(`未完了の必須項目があります: ${res.blockers?.join('、')}`, 'error');
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : '承認に失敗しました', 'error');
      }
    });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>導入チェックリスト</CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
            </div>
            <span className="text-sm font-semibold text-navy">{progress.percent}%</span>
            <span className="text-xs text-gray-500">（{progress.relevantDone}/{progress.relevantTotal}）</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Go Live 判定 */}
        <div className={`rounded-xl border p-4 ${goLive.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {goLive.ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
              <span className={`text-sm font-bold ${goLive.ready ? 'text-emerald-800' : 'text-amber-800'}`}>
                {goLive.ready ? 'Go Live 準備完了（READY）' : 'Go Live 準備未完了（NOT READY）'}
              </span>
            </div>
            {goLive.ready && stage !== 'live' && (
              <Button size="sm" onClick={doApprove} disabled={pending}>
                <Rocket className="h-4 w-4" />本番稼働を承認
              </Button>
            )}
            {stage === 'live' && <span className="text-xs font-medium text-emerald-700">本番稼働中</span>}
          </div>
          {!goLive.ready && (
            <ul className="mt-2 list-disc pl-8 text-xs text-amber-700">
              {goLive.blockers.map((b) => (<li key={b.key}>{b.label}</li>))}
            </ul>
          )}
        </div>

        {/* グループ別チェックリスト */}
        <div className="grid gap-4 md:grid-cols-2">
          {CHECKLIST.map((group) => {
            const items = group.items.filter((i) => isItemRelevant(i, enabledModules));
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <p className="mb-1.5 text-xs font-bold text-gray-500">{group.label}</p>
                <ul className="space-y-1">
                  {items.map((item) => {
                    const done = isItemDone(item, signals, checklist);
                    return (
                      <li key={item.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1.5">
                          {done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-gray-300" />}
                          <span className={done ? 'text-navy' : 'text-gray-500'}>{item.label}</span>
                          {item.critical && <span className="text-[10px] font-bold text-danger">必須</span>}
                          {item.kind === 'auto' && <span className="text-[10px] text-gray-400">自動</span>}
                        </span>
                        {item.kind === 'manual' ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => toggle(item.key, !done)}
                            className={`rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-50 ${done ? 'border-emerald-300 text-emerald-600' : 'border-gray-300 text-gray-400'}`}
                            aria-label={done ? '未完了に戻す' : '完了にする'}
                          >
                            {done ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-300">DB判定</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">「自動」項目はDBの実データから判定（未設定は埋めません）。「必須」はGo Live判定の対象です。</p>
      </CardContent>
    </Card>
  );
}
