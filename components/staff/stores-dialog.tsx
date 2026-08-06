'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, FieldError } from '@/components/ui/input';
import type { StoreRef } from '@/lib/auth';
import { changeMemberStores } from '@/app/app/staff/actions';
import { useToast } from '@/components/ui/toast';

export function StoresDialog({
  membershipId,
  profileId,
  currentStoreIds,
  stores,
  onClose,
}: {
  membershipId: string;
  profileId: string;
  currentStoreIds: string[];
  stores: StoreRef[];
  onClose: () => void;
}) {
  const [storeIds, setStoreIds] = useState<string[]>(currentStoreIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const toggleStore = (id: string) => {
    setStoreIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSubmit = () => {
    setError(null);
    if (storeIds.length === 0) {
      setError('所属店舗を1つ以上選択してください');
      return;
    }
    startTransition(async () => {
      const result = await changeMemberStores({ membershipId, profileId, storeIds });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('所属店舗を変更しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title="所属店舗変更">
      <div className="space-y-4">
        {stores.length === 0 ? (
          <p className="text-sm text-gray-500">選択可能な店舗がありません</p>
        ) : (
          <div>
            <Label>所属店舗</Label>
            <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    checked={storeIds.includes(s.id)}
                    onChange={() => toggleStore(s.id)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        )}

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
