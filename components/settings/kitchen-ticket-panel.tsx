'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { KITCHEN_TICKET_SPLIT_LABELS, type KitchenTicketSplit } from '@/lib/kitchen-ticket';
import { saveKitchenTicketSplit } from '@/app/app/settings/printers/actions';

const DESCRIPTIONS: Record<KitchenTicketSplit, string> = {
  item: '唐揚げ×2・ポテト×1 を注文 → 「唐揚げ x2」「ポテト x1」の2枚。同じ商品はまとめて1枚（x2）。',
  order: '1回の注文の商品を1枚にまとめて出します（これまでの出し方）。',
};

/**
 * 厨房伝票（キッチン・ドリンクのプリンター）の分け方。店舗ごとの設定で、全キッチン機に効く。
 * 既定は「商品の種類ごとに1枚ずつ」（2026-09-21 店舗要望）。
 */
export function KitchenTicketPanel({ storeId, initial }: { storeId: string; initial: KitchenTicketSplit }) {
  const { toast } = useToast();
  const [split, setSplit] = useState<KitchenTicketSplit>(initial);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await saveKitchenTicketSplit(storeId, split);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast('厨房伝票の分け方を保存しました（次の注文から反映）');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-navy">厨房伝票の分け方</p>
          <Badge tone="gray">キッチン・ドリンク</Badge>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="厨房伝票の分け方">
          {(['item', 'order'] as const).map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm text-gray-700 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40"
            >
              <input
                type="radio"
                name="kitchen-ticket-split"
                value={value}
                checked={split === value}
                onChange={() => setSplit(value)}
                className="mt-0.5 h-4 w-4 border-gray-300 text-primary focus:ring-primary"
              />
              <span>
                <span className="block font-medium text-navy">{KITCHEN_TICKET_SPLIT_LABELS[value]}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{DESCRIPTIONS[value]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          1回の注文の伝票は続けて出て、1枚ごとに紙が切れます。どのプリンターに出るかは、各プリンターの「伝票種別」（キッチン／ドリンク／デザート）とカテゴリの厨房ステーションで決まります。
        </p>
        <Button size="sm" onClick={save} disabled={pending || split === initial}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          設定を保存
        </Button>
      </CardContent>
    </Card>
  );
}
