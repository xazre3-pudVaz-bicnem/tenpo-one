'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Textarea, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updateCustomerAttributes, type UpdateAttributesInput } from '@/app/app/customers/actions';

export interface CustomerAttributes {
  allergy_note: string | null;
  dislike_note: string | null;
  preference_note: string | null;
  seat_preference: string | null;
  anniversary_note: string | null;
  service_note: string | null;
}

const FIELDS: { key: keyof UpdateAttributesInput; attr: keyof CustomerAttributes; label: string; placeholder: string }[] = [
  { key: 'allergyNote', attr: 'allergy_note', label: 'アレルギー', placeholder: '小麦・えび 等' },
  { key: 'dislikeNote', attr: 'dislike_note', label: '苦手なもの', placeholder: 'パクチーが苦手 等' },
  { key: 'preferenceNote', attr: 'preference_note', label: '好み', placeholder: '辛い物が好き 等' },
  { key: 'seatPreference', attr: 'seat_preference', label: '座席希望', placeholder: '個室希望・喫煙可 等' },
  { key: 'anniversaryNote', attr: 'anniversary_note', label: '記念日', placeholder: '結婚記念日 6月 等' },
  { key: 'serviceNote', attr: 'service_note', label: '接客メモ', placeholder: '接客上の申し送り事項' },
];

export function AttributesCard({
  customerId,
  attributes,
  canEdit,
}: {
  customerId: string;
  attributes: CustomerAttributes;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UpdateAttributesInput>({
    allergyNote: attributes.allergy_note ?? '',
    dislikeNote: attributes.dislike_note ?? '',
    preferenceNote: attributes.preference_note ?? '',
    seatPreference: attributes.seat_preference ?? '',
    anniversaryNote: attributes.anniversary_note ?? '',
    serviceNote: attributes.service_note ?? '',
  });
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof UpdateAttributesInput>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateCustomerAttributes(customerId, form);
        toast('属性を更新しました');
        setOpen(false);
      } catch (err) {
        toast(err instanceof Error ? err.message : '更新に失敗しました', 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>接客上の属性</CardTitle>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            編集
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <dt className="text-xs font-medium text-gray-500">{f.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm text-navy">
                {attributes[f.attr] || <span className="text-gray-400">未設定</span>}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>

      {canEdit && (
        <Dialog open={open} onClose={() => setOpen(false)} title="接客上の属性を編集">
          <form onSubmit={handleSubmit} className="space-y-4">
            {FIELDS.filter((f) => f.key !== 'seatPreference').map((f) => (
              <div key={f.key}>
                <Label htmlFor={`attr-${f.key}`}>{f.label}</Label>
                <Textarea id={`attr-${f.key}`} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
              </div>
            ))}
            <div>
              <Label htmlFor="attr-seatPreference">座席希望</Label>
              <Input
                id="attr-seatPreference"
                value={form.seatPreference}
                onChange={(e) => set('seatPreference', e.target.value)}
                placeholder="個室希望・喫煙可 等"
              />
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
      )}
    </Card>
  );
}
