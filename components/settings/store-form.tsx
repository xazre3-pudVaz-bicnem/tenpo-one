'use client';

import { useState, useTransition } from 'react';
import { Input, Textarea, Label, Select, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { updateStoreInfo } from '@/app/app/settings/store/actions';

export interface StoreFormData {
  storeId: string;
  name: string;
  nameKana: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
  description: string;
  seatCount: number | null;
  bookingEnabled: boolean;
  receiptHeader: string;
  receiptFooter: string;
  invoiceRegistrationNumber: string;
  serviceChargeRate: number;
  rounding: string;
  allowNegativeStock: boolean;
}

const ROUNDING_OPTIONS = [
  { value: 'floor', label: '切り捨て' },
  { value: 'ceil', label: '切り上げ' },
  { value: 'round', label: '四捨五入' },
];

export function StoreForm({ initial }: { initial: StoreFormData }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof StoreFormData>(key: K, value: StoreFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('店舗名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await updateStoreInfo(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('店舗情報を保存しました');
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
              <Label htmlFor="store-name">店舗名</Label>
              <Input id="store-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="store-kana">フリガナ</Label>
              <Input id="store-kana" value={form.nameKana} onChange={(e) => set('nameKana', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="store-postal">郵便番号</Label>
              <Input id="store-postal" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="123-4567" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="store-address">住所</Label>
              <Input id="store-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="store-phone">電話番号</Label>
              <Input id="store-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="store-email">メールアドレス</Label>
              <Input id="store-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="store-desc">紹介文</Label>
            <Textarea id="store-desc" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="store-seats">座席数</Label>
              <Input
                id="store-seats"
                type="number"
                min={0}
                value={form.seatCount ?? ''}
                onChange={(e) => set('seatCount', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  checked={form.bookingEnabled}
                  onChange={(e) => set('bookingEnabled', e.target.checked)}
                />
                オンライン予約を受け付ける
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>レシート・インボイス設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="receipt-header">レシートヘッダー</Label>
              <Textarea id="receipt-header" value={form.receiptHeader} onChange={(e) => set('receiptHeader', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="receipt-footer">レシートフッター</Label>
              <Textarea id="receipt-footer" value={form.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="invoice-number">インボイス登録番号</Label>
            <Input
              id="invoice-number"
              value={form.invoiceRegistrationNumber}
              onChange={(e) => set('invoiceRegistrationNumber', e.target.value)}
              placeholder="T1234567890123"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="service-charge">サービス料率（%）</Label>
              <Input
                id="service-charge"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={form.serviceChargeRate}
                onChange={(e) => set('serviceChargeRate', Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="rounding">端数処理</Label>
              <Select id="rounding" value={form.rounding} onChange={(e) => set('rounding', e.target.value)}>
                {ROUNDING_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>在庫設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              checked={form.allowNegativeStock}
              onChange={(e) => set('allowNegativeStock', e.target.checked)}
            />
            マイナス在庫を許可する
          </label>
          <p className="text-xs text-gray-500">
            OFFにすると在庫不足時の発送・出庫がエラーになります
          </p>
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
