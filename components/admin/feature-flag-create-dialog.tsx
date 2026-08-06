'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createFeatureFlag } from '@/app/admin/feature-flags/actions';

const GLOBAL = '__global__';

export function FeatureFlagCreateDialog({ organizations }: { organizations: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const [flagKey, setFlagKey] = useState('');
  const [target, setTarget] = useState(GLOBAL);
  const [enabled, setEnabled] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setFlagKey('');
    setTarget(GLOBAL);
    setEnabled(false);
    setNote('');
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createFeatureFlag({
          flagKey,
          organizationId: target === GLOBAL ? null : target,
          enabled,
          note,
        });
        toast('機能フラグを作成しました');
        router.refresh();
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '作成に失敗しました');
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        フラグを作成
      </Button>

      <Dialog open={open} onClose={close} title="機能フラグを作成">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="flag-key">フラグキー</Label>
            <Input
              id="flag-key"
              required
              value={flagKey}
              onChange={(e) => setFlagKey(e.target.value)}
              placeholder="printer_sdk_enabled"
            />
          </div>
          <div>
            <Label htmlFor="flag-target">対象企業</Label>
            <Select id="flag-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={GLOBAL}>グローバル（全企業の既定値）</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            有効にする
          </label>
          <div>
            <Label htmlFor="flag-note">メモ</Label>
            <Textarea id="flag-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="用途や変更理由など" />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !flagKey}>
              {pending ? '作成中…' : '作成する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
