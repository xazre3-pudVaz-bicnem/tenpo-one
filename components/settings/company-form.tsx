'use client';

import { useState, useTransition } from 'react';
import { ImageOff } from 'lucide-react';
import { Input, Label, Textarea, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { updateCompanyInfo } from '@/app/app/settings/company/actions';

export interface CompanyFormData {
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
  billingName: string;
  billingEmail: string;
  billingNote: string;
}

export function CompanyForm({ initial }: { initial: CompanyFormData }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof CompanyFormData>(key: K, value: CompanyFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('会社名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await updateCompanyInfo(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('企業情報を保存しました');
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="company-name">会社名</Label>
              <Input id="company-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="company-kana">会社名（カナ）</Label>
              <Input id="company-kana" value={form.nameKana} onChange={(e) => set('nameKana', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="company-postal">郵便番号</Label>
              <Input id="company-postal" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="123-4567" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="company-address">住所</Label>
              <Input id="company-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="company-phone">電話番号</Label>
            <Input id="company-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ロゴ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-surface px-4 py-6 text-sm text-gray-500">
            <ImageOff className="h-5 w-5 shrink-0 text-gray-400" />
            ロゴのアップロードは今後のアップデートで対応予定です。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>請求情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="billing-name">請求先名</Label>
              <Input id="billing-name" value={form.billingName} onChange={(e) => set('billingName', e.target.value)} placeholder="経理部 御中 など" />
            </div>
            <div>
              <Label htmlFor="billing-email">請求先メールアドレス</Label>
              <Input id="billing-email" type="email" value={form.billingEmail} onChange={(e) => set('billingEmail', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="billing-note">備考</Label>
            <Textarea id="billing-note" value={form.billingNote} onChange={(e) => set('billingNote', e.target.value)} placeholder="請求書送付先や支払条件など" />
          </div>
        </CardContent>
      </Card>

      <FieldError message={error ?? undefined} />

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={pending}>
          {pending ? '保存中…' : '保存する'}
        </Button>
      </div>
    </div>
  );
}
