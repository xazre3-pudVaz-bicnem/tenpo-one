'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createCustomer, type CreateCustomerInput } from '@/app/app/customers/actions';

const EMPTY: CreateCustomerInput = {
  name: '',
  nameKana: '',
  phone: '',
  email: '',
  birthday: '',
  allergyNote: '',
  preferenceNote: '',
  serviceNote: '',
};

export function CreateCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateCustomerInput>(EMPTY);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const set = <K extends keyof CreateCustomerInput>(key: K, value: CreateCustomerInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast('名前を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        const { id } = await createCustomer(form);
        toast('顧客を登録しました');
        setForm(EMPTY);
        setOpen(false);
        router.push(`/app/customers/${id}`);
      } catch (err) {
        toast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>顧客を登録</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="顧客を登録">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="c-name">
              名前 <span className="text-danger">*</span>
            </Label>
            <Input id="c-name" value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="山田 太郎" />
          </div>
          <div>
            <Label htmlFor="c-kana">フリガナ</Label>
            <Input id="c-kana" value={form.nameKana} onChange={(e) => set('nameKana', e.target.value)} placeholder="ヤマダ タロウ" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-phone">電話番号</Label>
              <Input id="c-phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="090-1234-5678" />
            </div>
            <div>
              <Label htmlFor="c-email">メールアドレス</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="taro@example.com" />
            </div>
          </div>
          <div>
            <Label htmlFor="c-birthday">誕生日</Label>
            <Input id="c-birthday" type="date" value={form.birthday} onChange={(e) => set('birthday', e.target.value)} className="max-w-[200px]" />
          </div>
          <div>
            <Label htmlFor="c-allergy">アレルギー</Label>
            <Textarea id="c-allergy" value={form.allergyNote} onChange={(e) => set('allergyNote', e.target.value)} placeholder="小麦・えび 等" />
          </div>
          <div>
            <Label htmlFor="c-preference">好み</Label>
            <Textarea id="c-preference" value={form.preferenceNote} onChange={(e) => set('preferenceNote', e.target.value)} placeholder="辛い物が好き 等" />
          </div>
          <div>
            <Label htmlFor="c-memo">メモ</Label>
            <Textarea id="c-memo" value={form.serviceNote} onChange={(e) => set('serviceNote', e.target.value)} placeholder="接客上の申し送り事項" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
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
