'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createManual } from './actions';
import { MANUAL_CATEGORIES, MANUAL_CATEGORY_LABELS, MANUAL_FILE_ACCEPT, extFromFile, validateManualFile } from './labels';

export function ManualForm({ organizationId, storeId, storeName, canTargetAllStores }: { organizationId: string; storeId: string; storeName: string; canTargetAllStores: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'file' | 'url'>('file');
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
    try {
      let filePath: string | null = null;
      const url = mode === 'url' ? ((formData.get('url') as string) || null) : null;

      if (mode === 'file') {
        const file = formData.get('file') as File | null;
        if (!file || file.size === 0) throw new Error('ファイルを選択してください');
        const validationError = validateManualFile(file);
        if (validationError) throw new Error(validationError);
        const supabase = createClient();
        filePath = `${organizationId}/manuals/${crypto.randomUUID()}.${extFromFile(file)}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw new Error('アップロードに失敗しました');
      } else if (!url?.trim()) {
        throw new Error('URLを入力してください');
      }

      const target = formData.get('target') as string;
      await createManual({
        title: (formData.get('title') as string) ?? '',
        category: formData.get('category') as (typeof MANUAL_CATEGORIES)[number],
        storeId: target === 'all' ? null : storeId,
        filePath,
        url,
        note: (formData.get('note') as string) || null,
      });
      toast('マニュアルを登録しました');
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
        マニュアルを登録
      </Button>
      <Dialog open={open} onClose={close} title="マニュアルを登録">
        <form
          action={(fd) => {
            void handleSubmit(fd);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="m-title">タイトル</Label>
            <Input id="m-title" name="title" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-category">カテゴリ</Label>
              <Select id="m-category" name="category" defaultValue="other">
                {MANUAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {MANUAL_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="m-target">対象</Label>
              <Select id="m-target" name="target" defaultValue="store">
                <option value="store">{storeName}のみ</option>
                {canTargetAllStores && <option value="all">全店共通</option>}
              </Select>
            </div>
          </div>

          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setMode('file')} className={`rounded-lg px-3 py-1.5 font-medium ${mode === 'file' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
              ファイルをアップロード
            </button>
            <button type="button" onClick={() => setMode('url')} className={`rounded-lg px-3 py-1.5 font-medium ${mode === 'url' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>
              外部URL
            </button>
          </div>
          {mode === 'file' ? (
            <div>
              <Label htmlFor="m-file">ファイル（PDF・PNG・JPEG・WebP／20MBまで）</Label>
              <input id="m-file" name="file" type="file" accept={MANUAL_FILE_ACCEPT} className="block w-full text-sm" />
            </div>
          ) : (
            <div>
              <Label htmlFor="m-url">URL</Label>
              <Input id="m-url" name="url" type="url" placeholder="https://" />
            </div>
          )}

          <div>
            <Label htmlFor="m-note">メモ</Label>
            <Textarea id="m-note" name="note" rows={2} />
          </div>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  保存中…
                </>
              ) : (
                '登録する'
              )}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
