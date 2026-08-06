'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updateCustomerBasic, type UpdateBasicInput } from '@/app/app/customers/actions';

export interface CustomerBasic {
  id: string;
  name: string;
  name_kana: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  postal_code: string | null;
  address: string | null;
}

export function EditCustomerDialog({ customer }: { customer: CustomerBasic }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UpdateBasicInput>({
    name: customer.name,
    nameKana: customer.name_kana ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    birthday: customer.birthday ?? '',
    gender: customer.gender ?? '',
    postalCode: customer.postal_code ?? '',
    address: customer.address ?? '',
  });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof UpdateBasicInput>(key: K, value: UpdateBasicInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast('名前を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await updateCustomerBasic(customer.id, form);
        toast('基本情報を更新しました');
        setOpen(false);
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        編集
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="基本情報を編集">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="e-name">
              名前 <span className="text-danger">*</span>
            </Label>
            <Input id="e-name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="e-kana">フリガナ</Label>
            <Input id="e-kana" value={form.nameKana} onChange={(e) => set('nameKana', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="e-phone">電話番号</Label>
              <Input id="e-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="e-email">メールアドレス</Label>
              <Input id="e-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="e-birthday">誕生日</Label>
              <Input id="e-birthday" type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="e-gender">性別</Label>
              <Select id="e-gender" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                <option value="">未設定</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="e-postal">郵便番号</Label>
              <Input id="e-postal" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="123-4567" />
            </div>
            <div>
              <Label htmlFor="e-address">住所</Label>
              <Input id="e-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
