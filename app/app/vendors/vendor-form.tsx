'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createVendor, updateVendor, type VendorInput } from './actions';

export interface VendorFormData {
  id: string;
  name: string;
  nameKana: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  closingDay: number | null;
  paymentDay: number | null;
  bankInfo: string | null;
  note: string | null;
}

/** 仕入先の登録・編集ダイアログ（vendorを渡すと編集モード） */
export function VendorForm({ vendor }: { vendor?: VendorFormData }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const isEdit = !!vendor;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    const input: VendorInput = {
      name: (formData.get('name') as string) ?? '',
      nameKana: (formData.get('nameKana') as string) || null,
      contactName: (formData.get('contactName') as string) || null,
      phone: (formData.get('phone') as string) || null,
      email: (formData.get('email') as string) || null,
      address: (formData.get('address') as string) || null,
      closingDay: formData.get('closingDay') ? Number(formData.get('closingDay')) : null,
      paymentDay: formData.get('paymentDay') ? Number(formData.get('paymentDay')) : null,
      bankInfo: (formData.get('bankInfo') as string) || null,
      note: (formData.get('note') as string) || null,
    };
    try {
      if (isEdit) {
        await updateVendor(vendor.id, input);
      } else {
        await createVendor(input);
      }
      toast(isEdit ? '仕入先を更新しました' : '仕入先を登録しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {isEdit ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          仕入先を登録
        </Button>
      )}
      <Dialog open={open} onClose={close} title={isEdit ? '仕入先を編集' : '仕入先を登録'}>
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="v-name">名前</Label>
              <Input id="v-name" name="name" required defaultValue={vendor?.name} />
            </div>
            <div>
              <Label htmlFor="v-kana">カナ</Label>
              <Input id="v-kana" name="nameKana" defaultValue={vendor?.nameKana ?? ''} />
            </div>
            <div>
              <Label htmlFor="v-contact">担当者</Label>
              <Input id="v-contact" name="contactName" defaultValue={vendor?.contactName ?? ''} />
            </div>
            <div>
              <Label htmlFor="v-phone">電話番号</Label>
              <Input id="v-phone" name="phone" defaultValue={vendor?.phone ?? ''} />
            </div>
            <div>
              <Label htmlFor="v-email">メール</Label>
              <Input id="v-email" name="email" type="email" defaultValue={vendor?.email ?? ''} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-address">住所</Label>
              <Input id="v-address" name="address" defaultValue={vendor?.address ?? ''} />
            </div>
            <div>
              <Label htmlFor="v-closing">締め日</Label>
              <Input
                id="v-closing"
                name="closingDay"
                type="number"
                min={1}
                max={31}
                defaultValue={vendor?.closingDay ?? ''}
                placeholder="31=月末"
              />
            </div>
            <div>
              <Label htmlFor="v-payment">支払日</Label>
              <Input id="v-payment" name="paymentDay" type="number" min={1} max={31} defaultValue={vendor?.paymentDay ?? ''} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-bank">振込先</Label>
              <Input id="v-bank" name="bankInfo" defaultValue={vendor?.bankInfo ?? ''} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-note">メモ</Label>
              <Textarea id="v-note" name="note" defaultValue={vendor?.note ?? ''} />
            </div>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : isEdit ? '更新する' : '登録する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
