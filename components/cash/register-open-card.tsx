'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { openRegister } from '@/app/app/cash/actions';

/**
 * 未開局のレジ1台分のカード。開始現金（釣銭準備金）を入力してそのレジだけを開局する。
 * 複数レジがそれぞれ独立してこのカードを持つため、同時に何台でも開局できることが一覧から分かる。
 */
export function RegisterOpenCard({
  storeId,
  registerId,
  registerName,
}: {
  storeId: string;
  registerId: string;
  registerName: string;
}) {
  const [openingFloat, setOpeningFloat] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(openingFloat);
    if (!Number.isInteger(amount) || amount < 0) {
      toast('釣銭準備金は0以上の整数で入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await openRegister(storeId, registerId, amount);
        toast(`${registerName}を開局しました`);
        setOpeningFloat('');
      } catch (err) {
        toast(err instanceof Error ? err.message : '開局に失敗しました', 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{registerName}</CardTitle>
        <Badge tone="gray">未開局</Badge>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor={`opening-float-${registerId}`}>釣銭準備金（開始現金）</Label>
            <Input
              id={`opening-float-${registerId}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              placeholder="30000"
              className="w-40"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? '開局中…' : 'このレジを開局'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
