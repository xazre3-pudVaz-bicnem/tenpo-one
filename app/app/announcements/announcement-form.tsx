'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createAnnouncement, type AnnouncementInput } from './actions';

export function AnnouncementForm({ storeId, storeName, canTargetAllStores }: { storeId: string; storeName: string; canTargetAllStores: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const handleSubmit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    const target = formData.get('target') as string;
    const input: AnnouncementInput = {
      title: (formData.get('title') as string) ?? '',
      body: (formData.get('body') as string) ?? '',
      isImportant: formData.get('isImportant') === 'on',
      publishFrom: (formData.get('publishFrom') as string) || null,
      publishTo: (formData.get('publishTo') as string) || null,
      storeId: target === 'all' ? null : storeId,
    };
    try {
      await createAnnouncement(input);
      toast('お知らせを作成しました');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        お知らせを作成
      </Button>
      <Dialog open={open} onClose={close} title="お知らせを作成">
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="a-title">タイトル</Label>
            <Input id="a-title" name="title" required />
          </div>
          <div>
            <Label htmlFor="a-body">本文</Label>
            <Textarea id="a-body" name="body" required rows={5} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="a-from">公開開始日</Label>
              <Input id="a-from" name="publishFrom" type="date" />
            </div>
            <div>
              <Label htmlFor="a-to">公開終了日</Label>
              <Input id="a-to" name="publishTo" type="date" />
            </div>
            <div>
              <Label htmlFor="a-target">対象</Label>
              <Select id="a-target" name="target" defaultValue="store">
                <option value="store">{storeName}のみ</option>
                {canTargetAllStores && <option value="all">全店舗</option>}
              </Select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="isImportant" className="h-4 w-4 rounded border-gray-300" />
              重要（強調表示）
            </label>
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '作成中…' : '作成する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
