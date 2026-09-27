'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { mdLabel, openingCheck } from '@/lib/register-day';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { openRegister } from '@/app/app/cash/actions';
import { toUserMessage } from '@/lib/action-error';
import { hasAnyCount, sumDenominations, type DenominationCounts } from '@/lib/cash-count';
import { denominationsToJson } from '@/lib/register-report';
import { CashDenominationCounter } from '@/components/cash/cash-denomination-counter';

/**
 * 未開局のレジ1台分のカード。釣銭準備金（開始現金）を金種別に数えて、そのレジだけを開局する。
 * 金額の直接入力ではなく枚数入力にしているのは、毎日の開局時に「レジに実際にいくら入っているか」を
 * 必ず数える運用にするため（締めの精算レシートの釣銭準備金と突き合わせる）。
 * 複数レジがそれぞれ独立してこのカードを持つため、同時に何台でも開局できることが一覧から分かる。
 */
export function RegisterOpenCard({
  storeId,
  registerId,
  registerName,
  afterOpenHref,
  expectedOpening = null,
  expectedFrom = null,
}: {
  storeId: string;
  registerId: string;
  registerName: string;
  /** 開局できたら移る画面（朝いちばんの開局画面 → テーブル一覧）。無ければその場に残る */
  afterOpenHref?: string;
  /** 前回のレジクローズで残した金額（翌準備金）。記録が無ければ null＝比べない（2026-09-28 Ronnie） */
  expectedOpening?: number | null;
  /** 前回のレジクローズの営業日（表示用） */
  expectedFrom?: string | null;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<DenominationCounts>({});
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const entered = hasAnyCount(counts);
  const openingFloat = useMemo(() => sumDenominations(counts), [counts]);
  const check = openingCheck(openingFloat, expectedOpening);
  const needsReason = entered && check.needsReason;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entered) {
      toast('釣銭準備金を金種ごとに数えて枚数を入力してください（0円のときは1円に0と入れてください）', 'error');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast('前回のレジクローズで残した金額と違います。違う理由を入れてください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        const result = await openRegister(
          storeId,
          registerId,
          openingFloat,
          denominationsToJson(counts),
          needsReason ? reason.trim() : null
        );
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        toast(`${registerName || 'レジ'}を開局しました（釣銭準備金 ${yen(openingFloat)}）`);
        setCounts({});
        setReason('');
        if (afterOpenHref) router.push(afterOpenHref);
      } catch (err) {
        toast(toUserMessage(err, '開局に失敗しました'), 'error');
      }
    });
  };

  return (
    <Card className="max-w-md">
      {/* 箱は1つ・小さく。レジ名（プリンターの名前）は出さない（2026-09-28 Ronnie） */}
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 py-3">
        <CardTitle en="Open register">レジ開局</CardTitle>
        <Badge tone="gray">未開局</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <p className="text-xs text-ink-3">釣銭準備金（レジに入っている現金）を金種ごとに数えて枚数を入れる。合計がそのまま釣銭準備金。</p>
          <CashDenominationCounter idPrefix={`open-${registerId}`} counts={counts} onChange={setCounts} disabled={pending} compact />
          {/* 前回のレジクローズで残した金額（翌準備金）と比べる。違えば ± と理由（2026-09-28 Ronnie） */}
          {check.expected != null && (
            <div className="space-y-1 rounded-lg border border-line bg-lilac-soft/40 px-3 py-2 text-[13px]">
              <p className="flex items-center justify-between gap-2 text-ink-2">
                <span>前回のレジクローズで残した金額{expectedFrom ? `（${mdLabel(expectedFrom)}）` : ''}</span>
                <b className="tabular-nums text-ink">{yen(check.expected)}</b>
              </p>
              <p className="flex items-center justify-between gap-2 text-ink-2">
                <span>過不足</span>
                <b
                  className={cn(
                    'text-[15px] tabular-nums',
                    !entered ? 'text-ink-3' : check.difference === 0 ? 'text-success' : 'text-danger'
                  )}
                >
                  {!entered || check.difference == null
                    ? '—'
                    : check.difference === 0
                      ? '±¥0（合っています）'
                      : `${check.difference > 0 ? '+' : '−'}${yen(Math.abs(check.difference))}`}
                </b>
              </p>
            </div>
          )}
          {needsReason && (
            <div>
              <label htmlFor={`open-reason-${registerId}`} className="mb-1 block text-[13px] font-bold text-danger">
                違う理由（必須）
              </label>
              <Textarea
                id={`open-reason-${registerId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                placeholder="例：昨日の締めのあと両替した／本部に持って行った"
              />
            </div>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={pending || !entered || (needsReason && !reason.trim())}>
            {pending ? '開局中…' : `開局する / Open（${yen(openingFloat)}）`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
