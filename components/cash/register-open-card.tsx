'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
}: {
  storeId: string;
  registerId: string;
  registerName: string;
  /** 開局できたら移る画面（朝いちばんの開局画面 → テーブル一覧）。無ければその場に残る */
  afterOpenHref?: string;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<DenominationCounts>({});
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const entered = hasAnyCount(counts);
  const openingFloat = useMemo(() => sumDenominations(counts), [counts]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entered) {
      toast('釣銭準備金を金種ごとに数えて枚数を入力してください（0円のときは1円に0と入れてください）', 'error');
      return;
    }
    startTransition(async () => {
      try {
        const result = await openRegister(storeId, registerId, openingFloat, denominationsToJson(counts));
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        toast(`${registerName || 'レジ'}を開局しました（釣銭準備金 ${yen(openingFloat)}）`);
        setCounts({});
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
          <Button type="submit" size="lg" className="w-full" disabled={pending || !entered}>
            {pending ? '開局中…' : `開局する / Open（${yen(openingFloat)}）`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
