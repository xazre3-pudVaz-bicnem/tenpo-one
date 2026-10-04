'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { todayJst } from '@/lib/format';
import { createInvoice } from '@/app/app/invoices/actions';

/**
 * 仕入の請求書（仕入先からの請求・納品の金額）をその場で入れる（2026-10-04 Ronnie
 * 「請求書が来たら、どこからでも入れられるように。見るのは管理画面」）。
 * レジ（iPad）の「仕入・経費」とパソコンの両方から。仕入先・日付・金額だけの短い入力で、
 * 保存先は「請求書・書類」と同じ invoices（状態＝未処理）。管理画面の 月次清算 の仕入先の列にそのまま出る。
 */
export function VendorBillDialog({ storeId, vendors = [] }: { storeId: string; vendors?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayJst());
  const [memo, setMemo] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setVendorId('');
    setVendorName('');
    setAmount('');
    setDate(todayJst());
    setMemo('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountValue = Number(amount);
    if (!vendorName.trim()) {
      toast('仕入先を選ぶか、名前を入れてください', 'error');
      return;
    }
    if (!Number.isInteger(amountValue) || amountValue <= 0) {
      toast('金額は1円以上の整数で入力してください', 'error');
      return;
    }
    if (!date) {
      toast('日付を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await createInvoice({
          storeId,
          vendorId: vendorId || null,
          vendorName: vendorName.trim(),
          invoiceNo: null,
          issueDate: date,
          dueDate: null,
          amount: amountValue,
          taxAmount: 0,
          registrationNumber: null,
          paymentMethod: null,
          expenseAccountId: null,
          note: memo.trim() || null,
          file: null,
        });
        toast(`仕入の請求書を登録しました（${vendorName.trim()}）`);
        close();
        router.refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileText className="h-4 w-4" />
        仕入の請求書を登録
        <span className="en-inline">Vendor bill</span>
      </Button>
      <Dialog open={open} onClose={close} title="仕入の請求書を登録">
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-gray-500">
            仕入先からの請求書・納品書の金額を入れます。管理画面の「月次清算」で仕入先ごと・日ごとに集計されます。
          </p>
          <div>
            <Label htmlFor="bill-vendor-pick">仕入先</Label>
            <Select
              id="bill-vendor-pick"
              value={vendorId}
              onChange={(e) => {
                const id = e.target.value;
                setVendorId(id);
                const v = vendors.find((x) => x.id === id);
                setVendorName(v ? v.name : '');
              }}
            >
              <option value="">{vendors.length === 0 ? '仕入先が未登録（手入力）' : 'その他（手入力）'}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bill-vendor">仕入先名</Label>
            <Input
              id="bill-vendor"
              value={vendorName}
              onChange={(e) => {
                setVendorName(e.target.value);
                setVendorId('');
              }}
              placeholder="例：Komaki（仕入先を選ぶと自動で入ります）"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bill-amount">金額（税込）</Label>
              <Input
                id="bill-amount"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="9537"
              />
            </div>
            <div>
              <Label htmlFor="bill-date">日付</Label>
              <Input id="bill-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="bill-memo">メモ</Label>
            <Textarea id="bill-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="任意" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '登録中…' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
