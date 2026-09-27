'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { saveLunchUntil } from '@/app/app/settings/hours/actions';
import { businessHourOptions } from '@/lib/business-hours';

/** 区切りは 10:00〜20:00 の15分刻み（レジ精算の「ランチ売上／ディナー売上」） */
const OPTIONS = businessHourOptions(10 * 60, 20 * 60);

/**
 * レジ精算レシートの ランチ売上／ディナー売上 の区切り時刻（2026-09-28 Ronnie「3時までのオーダーがランチ、3時1分からがディナー」）。
 */
export function DaypartForm({ storeId, initial }: { storeId: string; initial: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const r = await saveLunchUntil(storeId, value);
      if (r.error) return toast(r.error, 'error');
      toast('ランチ／ディナーの区切りを保存しました');
      router.refresh();
    });

  const dinnerFrom = (() => {
    const [h, m] = value.split(':').map(Number);
    const t = h * 60 + m + 1;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="h-5 w-5 text-saffron" aria-hidden />
          ランチ／ディナーの区切り
          <span className="en-inline text-xs">Lunch / Dinner cutoff</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-2">
          レジ精算レシートの「ランチ売上」「ディナー売上」の分け方。この時刻までにオーダーが始まった伝票がランチ、それより後がディナーになります。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-ink-2">
            <Sun className="h-4 w-4 text-saffron" aria-hidden />
            ランチ：〜
          </span>
          <Select aria-label="ランチの終わり" value={value} onChange={(e) => setValue(e.target.value)} className="w-28">
            {OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          <span className="flex items-center gap-1.5 text-sm text-ink-2">
            <Moon className="h-4 w-4 text-royal" aria-hidden />
            ディナー：{dinnerFrom}〜締め
          </span>
          <Button onClick={save} disabled={pending || value === initial}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
