'use client';

import { useState, useTransition } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { updateStoreSlug } from '@/app/app/settings/booking/actions';

/**
 * 公開予約URLのスラッグ編集。既定は表示のみ。「編集」で入力欄を開き、
 * 変更時は既存URL・QRが無効になる旨を確認してから保存する。
 */
export function StoreSlugEditor({
  storeId,
  slug,
  baseUrl,
}: {
  storeId: string;
  slug: string;
  /** 例: https://www.tenpo-one.com/book/ （末尾スラッシュ付き） */
  baseUrl: string;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') // 不正文字をハイフンへ
      .replace(/-+/g, '-') // 連続ハイフンを1つに
      .replace(/^-+/, ''); // 先頭ハイフン除去（末尾は入力中のため残す）

  const cancel = () => {
    setValue(slug);
    setError(null);
    setEditing(false);
  };

  const save = () => {
    const next = value.replace(/-+$/, ''); // 保存時に末尾ハイフン除去
    if (next === slug) {
      setEditing(false);
      return;
    }
    if (
      !confirm(
        `予約URLを「${next}」に変更します。\n\n変更すると、これまでに配布した予約URL・QRコード・Google/Instagram等のリンクは開けなくなります。よろしいですか？`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateStoreSlug({ storeId, slug: next });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast('予約URLを変更しました');
      setEditing(false);
    });
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">スラッグ：</span>
        <span className="font-mono font-medium text-navy">{slug}</span>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-500">{baseUrl}</span>
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(normalize(e.target.value))}
            className="w-48 font-mono text-sm"
            placeholder="fogo-de-brasia-shinjuku"
            autoFocus
          />
          <Button size="sm" onClick={save} disabled={pending || value.replace(/-+$/, '').length < 3}>
            <Check className="h-4 w-4" />
            {pending ? '保存中…' : '保存'}
          </Button>
          <Button variant="ghost" size="icon" onClick={cancel} disabled={pending} aria-label="キャンセル">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-amber-700">
        変更すると既存の予約URL・QRコード・掲載リンクは無効になります。英小文字・数字・ハイフンのみ。
      </p>
      <FieldError message={error ?? undefined} />
    </div>
  );
}
