'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { saveNextFloat } from '@/app/app/settings/hours/actions';

/**
 * 翌準備金（毎日レジに残す金額）。2026-09-28 Ronnie：
 * レジ精算で数えた現金のうち、この金額はレジに残し（翌日の開局で数えて比べる）、超えた分は 銀行・預り金、
 * 足りなければ 準備金不足（マイナス）。空にすると「その日の開局の金額と同じ」。
 */
export function NextFloatForm({ storeId, initial }: { storeId: string; initial: number | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(initial == null ? '' : String(initial));
  const [pending, startTransition] = useTransition();
  const parsed = value === '' ? null : Number(value);
  const changed = parsed !== initial;

  const save = () =>
    startTransition(async () => {
      const r = await saveNextFloat(storeId, parsed);
      if (r.error) return toast(r.error, 'error');
      toast(parsed == null ? '翌準備金を「開局の金額と同じ」にしました' : `翌準備金を ¥${parsed.toLocaleString('ja-JP')} にしました`);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-royal" aria-hidden />
          翌準備金（毎日レジに残す金額）
          <span className="en-inline text-xs">Next-day float</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-2">
          レジ精算で数えた現金のうち、この金額をレジに残します。多い分は「預入金（銀行・預り金）」、足りない分は「準備金不足（マイナス）」として
          レジ精算に出ます。翌日の開局では、数えた金額をこの残した金額と比べます。空にすると、その日の開局の金額と同じになります。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            ¥
            <input
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              placeholder="開局の金額と同じ"
              aria-label="翌準備金"
              className={cn(
                'h-10 w-44 rounded-lg border border-line bg-white px-3 text-right text-[15px] font-bold text-ink tabular-nums placeholder:text-[12px] placeholder:font-normal placeholder:text-ink-3'
              )}
            />
          </label>
          {value !== '' && (
            <button type="button" onClick={() => setValue('')} className="text-[12px] font-bold text-royal hover:underline">
              空にする（開局の金額と同じ）
            </button>
          )}
          <Button onClick={save} disabled={pending || !changed}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
