'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { setMemberPin } from '@/app/app/staff/actions';
import { useToast } from '@/components/ui/toast';

export function PinDialog({
  membershipId,
  profileId,
  onClose,
}: {
  membershipId: string;
  profileId: string;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSubmit = () => {
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setError('PINは4〜6桁の数字で入力してください');
      return;
    }
    startTransition(async () => {
      const result = await setMemberPin({ membershipId, profileId, pin });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('PINを設定しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title="PIN設定">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">共用端末での打刻に使用します。</p>
        <div>
          <Label htmlFor="pin-input">PIN（4〜6桁の数字）</Label>
          <Input
            id="pin-input"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="例: 1234"
            className="font-mono tracking-widest"
          />
        </div>
        <FieldError message={error ?? undefined} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '保存中…' : '保存する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
