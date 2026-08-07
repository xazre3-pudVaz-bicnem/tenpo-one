'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import {
  updateBookingPaymentSettings,
  type BookingPaymentMode,
  type BookingPaymentSettingsInput,
} from '@/app/app/settings/payments/actions';

const MODE_LABELS: Record<BookingPaymentMode, string> = {
  onsite: '現地払いのみ',
  prepay_full: '予約時全額決済',
  deposit: '予約金',
};

const MODES = Object.keys(MODE_LABELS) as BookingPaymentMode[];

export function BookingPaymentSettingsForm({ initial }: { initial: BookingPaymentSettingsInput }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateBookingPaymentSettings(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('予約決済設定を保存しました');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>予約決済設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="booking-payment-mode">決済方法</Label>
          <Select
            id="booking-payment-mode"
            value={form.bookingPaymentMode}
            onChange={(e) =>
              setForm((f) => ({ ...f, bookingPaymentMode: e.target.value as BookingPaymentMode }))
            }
            className="w-56"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </div>

        {form.bookingPaymentMode === 'deposit' && (
          <div>
            <Label htmlFor="booking-deposit-amount">予約金（1名あたり・円）</Label>
            <Input
              id="booking-deposit-amount"
              type="number"
              min={0}
              value={form.bookingDepositAmount}
              onChange={(e) =>
                setForm((f) => ({ ...f, bookingDepositAmount: Math.max(0, Number(e.target.value) || 0) }))
              }
              className="w-40"
            />
          </div>
        )}

        <p className="text-xs text-gray-500">
          全額決済はコース選択時のみ適用されます。コース未選択の予約は現地払いとなります。
        </p>

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end pt-2">
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
