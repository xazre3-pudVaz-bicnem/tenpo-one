'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { updateBookingSettings } from '@/app/app/settings/booking/actions';

export interface BookingSettingsData {
  storeId: string;
  slotMinutes: number;
  defaultStayMinutes: number;
  bookingCutoffMinutes: number;
  bookingWindowDays: number;
  maxPartySize: number;
  cancelDeadlineHours: number;
  cleaningBufferMinutes: number;
  bookingPhotoUrl: string;
  bookingNotes: string;
  cancellationPolicy: string;
}

export function BookingSettingsForm({ initial }: { initial: BookingSettingsData }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof BookingSettingsData>(key: K, value: BookingSettingsData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateBookingSettings(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('予約設定を保存しました');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="slot-minutes">予約枠間隔</Label>
            <Select id="slot-minutes" value={form.slotMinutes} onChange={(e) => set('slotMinutes', Number(e.target.value))}>
              <option value={15}>15分</option>
              <option value={30}>30分</option>
              <option value={60}>60分</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="stay-minutes">既定の滞在時間（分）</Label>
            <Input
              id="stay-minutes"
              type="number"
              min={1}
              value={form.defaultStayMinutes}
              onChange={(e) => set('defaultStayMinutes', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cutoff-minutes">予約受付締切（分前）</Label>
            <Input
              id="cutoff-minutes"
              type="number"
              min={0}
              value={form.bookingCutoffMinutes}
              onChange={(e) => set('bookingCutoffMinutes', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="window-days">予約受付期間（日先まで）</Label>
            <Input
              id="window-days"
              type="number"
              min={1}
              value={form.bookingWindowDays}
              onChange={(e) => set('bookingWindowDays', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="max-party">最大人数</Label>
            <Input
              id="max-party"
              type="number"
              min={1}
              value={form.maxPartySize}
              onChange={(e) => set('maxPartySize', Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="cancel-deadline">キャンセル期限（時間前）</Label>
            <Input
              id="cancel-deadline"
              type="number"
              min={0}
              value={form.cancelDeadlineHours}
              onChange={(e) => set('cancelDeadlineHours', Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="cleaning-buffer">清掃バッファ（分）</Label>
          <Input
            id="cleaning-buffer"
            type="number"
            min={0}
            max={120}
            value={form.cleaningBufferMinutes}
            onChange={(e) => set('cleaningBufferMinutes', Number(e.target.value))}
            className="max-w-[10rem]"
          />
          <p className="mt-1 text-xs text-gray-500">
            予約の間に清掃時間を確保します。空席判定で滞在時間+バッファが占有扱いになります。
          </p>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="mb-3 text-sm font-semibold text-navy">公開予約ページの表示内容</p>
          <div className="space-y-4">
            <div>
              <Label htmlFor="photo-url">店舗写真URL</Label>
              <Input
                id="photo-url"
                type="text"
                placeholder="/store-photo.jpg または https://..."
                value={form.bookingPhotoUrl}
                onChange={(e) => set('bookingPhotoUrl', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                公開予約ページ上部に表示します。同一サイトのパス（/…）または https のURLを指定してください。
              </p>
            </div>
            <div>
              <Label htmlFor="booking-notes">ご予約時の注意事項</Label>
              <textarea
                id="booking-notes"
                rows={3}
                value={form.bookingNotes}
                onChange={(e) => set('bookingNotes', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="例：コースは3日前までのご予約制です。お子様連れの場合は事前にご相談ください。"
              />
            </div>
            <div>
              <Label htmlFor="cancel-policy">キャンセルポリシー</Label>
              <textarea
                id="cancel-policy"
                rows={3}
                value={form.cancellationPolicy}
                onChange={(e) => set('cancellationPolicy', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="例：前日以降のキャンセルはご連絡をお願いします。無断キャンセルはご遠慮ください。"
              />
              <p className="mt-1 text-xs text-gray-500">
                キャンセル料の自動請求は行いません。ポリシーの明示のみ表示します。
              </p>
            </div>
          </div>
        </div>

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
