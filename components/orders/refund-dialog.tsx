'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import { METHOD_LABELS } from '@/components/cash/labels';

type Method = 'cash' | 'credit' | 'qr' | 'emoney' | 'voucher' | 'on_account';
const METHODS: Method[] = ['cash', 'credit', 'qr', 'emoney', 'voucher', 'on_account'];

export function RefundDialog({
  orderId,
  refundable,
  refundOrderAction,
}: {
  orderId: string;
  refundable: number;
  refundOrderAction: (orderId: string, amount: number, method: Method, reason: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(refundable);
  const [method, setMethod] = useState<Method>('cash');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  const openDialog = () => {
    setAmount(refundable);
    setMethod('cash');
    setReason('');
    setOpen(true);
  };

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        await refundOrderAction(orderId, amount, method, reason);
        toast('返金を記録しました');
        setOpen(false);
      } catch (e) {
        toast(e instanceof Error ? e.message : '返金に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button variant="danger" className="w-full" onClick={openDialog}>
        返金する
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="返金">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">返金可能額: {yen(refundable)}</p>
          <div>
            <Label htmlFor="refund-amount">返金額</Label>
            <Input
              id="refund-amount"
              type="number"
              min={1}
              max={refundable}
              value={amount}
              onChange={(e) => setAmount(Math.min(refundable, Math.max(0, Number(e.target.value) || 0)))}
            />
          </div>
          <div>
            <Label htmlFor="refund-method">返金方法</Label>
            <Select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="refund-reason">理由（必須・操作履歴に記録されます）</Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="返金理由を入力してください"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirm}
              disabled={pending || amount <= 0 || amount > refundable || !reason.trim()}
            >
              {pending ? '処理中…' : '返金を確定'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
