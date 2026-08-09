'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Input, Textarea, Select, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { submitContact } from './actions';

const STORE_COUNTS = [
  { value: '', label: '選択してください' },
  { value: '1', label: '1店舗' },
  { value: '2-5', label: '2〜5店舗' },
  { value: '6-10', label: '6〜10店舗' },
  { value: '11-30', label: '11〜30店舗' },
  { value: '31+', label: '31店舗以上' },
];

export function ContactForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
        <p className="mt-4 text-base font-bold text-navy">お問い合わせを受け付けました</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          内容を確認のうえ、担当より順次ご連絡いたします。<br />
          お急ぎの場合は、恐れ入りますが少しお時間をいただく場合があります。
        </p>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input = {
      companyName: String(fd.get('companyName') || ''),
      storeName: String(fd.get('storeName') || ''),
      contactName: String(fd.get('contactName') || ''),
      phone: String(fd.get('phone') || ''),
      email: String(fd.get('email') || ''),
      storeCount: String(fd.get('storeCount') || '') || undefined,
      currentTools: String(fd.get('currentTools') || ''),
      message: String(fd.get('message') || ''),
    };
    startTransition(async () => {
      const res = await submitContact(input);
      if (res.ok) setDone(true);
      else setError(res.error ?? '送信に失敗しました');
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="companyName">会社名</Label>
          <Input id="companyName" name="companyName" autoComplete="organization" />
        </div>
        <div>
          <Label htmlFor="storeName">店舗名</Label>
          <Input id="storeName" name="storeName" />
        </div>
        <div>
          <Label htmlFor="contactName">お名前 <span className="text-danger">*</span></Label>
          <Input id="contactName" name="contactName" required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="phone">電話番号</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" />
        </div>
        <div>
          <Label htmlFor="email">メールアドレス <span className="text-danger">*</span></Label>
          <Input id="email" name="email" type="email" required autoComplete="email" inputMode="email" />
        </div>
        <div>
          <Label htmlFor="storeCount">店舗数</Label>
          <Select id="storeCount" name="storeCount" defaultValue="">
            {STORE_COUNTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="currentTools">現在利用中のシステム</Label>
        <Input id="currentTools" name="currentTools" placeholder="例: 予約サイト・POS・勤怠アプリ・Excel など" />
      </div>
      <div>
        <Label htmlFor="message">ご相談内容</Label>
        <Textarea id="message" name="message" rows={4} placeholder="導入時期・店舗の状況・気になる機能などをお聞かせください" />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs leading-relaxed text-gray-400">
          送信により<a href="/privacy" className="underline hover:text-gray-600">プライバシーポリシー</a>に同意したものとします。
        </p>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? '送信中…' : '無料で相談する'}
        </Button>
      </div>
    </form>
  );
}
