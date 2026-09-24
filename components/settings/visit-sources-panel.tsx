'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { DEFAULT_VISIT_SOURCE_IDS, VISIT_SOURCES } from '@/lib/handy-visit';
import { saveVisitSources } from '@/app/app/settings/printers/actions';

/**
 * この店で使う来店経路を選ぶ（2026-09-24 店舗要望「使わないものは出さない設定がほしい」）。
 * ここで外した経路は、お客様情報（レジ・ハンディの着席画面）のボタンに出なくなる。
 */
export function VisitSourcesPanel({ storeId, initial }: { storeId: string; initial: string[] }) {
  const { toast } = useToast();
  const [on, setOn] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setOn((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = () => {
    startTransition(async () => {
      const res = await saveVisitSources(storeId, on);
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      toast('来店経路を保存しました（次の着席から反映）');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-2">
          お客様情報の「来店経路」に出すものを選びます。使わないサイトは外してください。
          （全部外すと選べなくなるので、その場合は既定の12個を出します）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {VISIT_SOURCES.map((s) => {
            const enabled = on.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={enabled}
                onClick={() => toggle(s.id)}
                className={cn(
                  'tap3d min-h-9 rounded-full border-[1.5px] border-royal px-3 text-[13px] font-bold',
                  enabled ? 'bg-royal text-white' : 'bg-white text-royal opacity-60'
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            設定を保存
          </Button>
          <Button
            variant="secondary"
            onClick={() => setOn([...DEFAULT_VISIT_SOURCE_IDS])}
            disabled={pending}
          >
            既定に戻す
          </Button>
          <Button variant="secondary" onClick={() => setOn(VISIT_SOURCES.map((s) => s.id))} disabled={pending}>
            全部出す
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
