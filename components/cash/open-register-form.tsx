'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { openRegister } from '@/app/app/cash/actions';

export function OpenRegisterForm({
  storeId,
  registers,
}: {
  storeId: string;
  registers: { id: string; name: string }[];
}) {
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? '');
  const [openingFloat, setOpeningFloat] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(openingFloat);
    if (!registerId) {
      toast('レジを選択してください', 'error');
      return;
    }
    if (!Number.isInteger(amount) || amount < 0) {
      toast('釣銭準備金は0以上の整数で入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await openRegister(storeId, registerId, amount);
        toast('レジを開局しました');
        setOpeningFloat('');
      } catch (err) {
        toast(err instanceof Error ? err.message : '開局に失敗しました', 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>レジを開局</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="register-select">レジ</Label>
            <Select
              id="register-select"
              value={registerId}
              onChange={(e) => setRegisterId(e.target.value)}
              className="w-48"
            >
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="opening-float">釣銭準備金</Label>
            <Input
              id="opening-float"
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
            {pending ? '開局中…' : 'レジを開局'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
