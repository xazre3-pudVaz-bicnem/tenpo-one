'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label, Select, FieldError } from '@/components/ui/input';
import { ROLES, ROLE_LABELS, HQ_ROLES, type Role } from '@/lib/permissions';
import type { StoreRef } from '@/lib/auth';
import { changeMemberRole } from '@/app/app/staff/actions';
import { useToast } from '@/components/ui/toast';

function isStoreScopedRole(role: Role): boolean {
  return !HQ_ROLES.includes(role);
}

export function RoleDialog({
  membershipId,
  profileId,
  currentRole,
  currentStoreIds,
  stores,
  onClose,
}: {
  membershipId: string;
  profileId: string;
  currentRole: Role;
  currentStoreIds: string[];
  stores: StoreRef[];
  onClose: () => void;
}) {
  const [role, setRole] = useState<Role>(currentRole);
  const [storeIds, setStoreIds] = useState<string[]>(currentStoreIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const storeScoped = isStoreScopedRole(role);

  const toggleStore = (id: string) => {
    setStoreIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSubmit = () => {
    setError(null);
    if (storeScoped && storeIds.length === 0) {
      setError('店舗系ロールは所属店舗を1つ以上選択してください');
      return;
    }
    startTransition(async () => {
      const result = await changeMemberRole({ membershipId, profileId, newRole: role, storeIds });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('ロールを変更しました');
      onClose();
    });
  };

  return (
    <Dialog open onClose={onClose} title="ロール変更">
      <div className="space-y-4">
        <div>
          <Label htmlFor="role-select">ロール</Label>
          <Select id="role-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>

        {storeScoped && (
          <div>
            <Label>所属店舗</Label>
            {stores.length === 0 ? (
              <p className="text-xs text-gray-500">選択可能な店舗がありません</p>
            ) : (
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
            )}
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
