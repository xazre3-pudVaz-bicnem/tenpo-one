'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createStoreForOrg } from '@/app/admin/organizations/actions';

export function CreateStoreDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setName('');
    setAddress('');
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createStoreForOrg({ organizationId, name, address });
        toast('店舗を追加しました');
        close();
      } catch (err) {
        setError(err instanceof Error ? err.message : '作成に失敗しました');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        店舗を追加
      </Button>

      <Dialog open={open} onClose={close} title="店舗を追加">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="new-store-name">店舗名</Label>
            <Input id="new-store-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-store-address">住所</Label>
            <Input id="new-store-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <p className="text-xs text-gray-500">
            公開URL用のslugは店舗名から自動生成されます。詳細な設定（営業時間・テーブル等）は作成後に企業側の設定画面から行えます。
          </p>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? '作成中…' : '作成する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
