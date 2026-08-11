'use client';

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, FieldError } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { saveCategory, deleteCategory, type CategoryInput } from '@/app/app/settings/menu/actions';

export interface CategoryRow {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  sortOrder: number;
}

export const CATEGORY_COLORS = [
  '#7B3FF2', '#EA580C', '#15803D', '#DC2626', '#2563EB', '#CA8A04', '#DB2777', '#0891B2',
];

const EMPTY: Omit<CategoryInput, 'storeId'> = { name: '', nameEn: '', color: CATEGORY_COLORS[0], sortOrder: 0 };

export function CategoryPanel({ storeId, initial }: { storeId: string; initial: CategoryRow[] }) {
  const rows = initial;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [form, setForm] = useState(EMPTY);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const openAdd = () => {
    setEditingId(undefined);
    setForm({ ...EMPTY, sortOrder: rows.length });
    setError(null);
    setDialogOpen(true);
  };
  const openEdit = (row: CategoryRow) => {
    setEditingId(row.id);
    setForm({ name: row.name, nameEn: row.nameEn ?? '', color: row.color, sortOrder: row.sortOrder });
    setError(null);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('カテゴリ名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await saveCategory({ ...form, id: editingId, storeId });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast(editingId ? 'カテゴリを更新しました' : 'カテゴリを追加しました');
      setDialogOpen(false);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-navy">カテゴリ</p>
        <Button size="sm" variant="secondary" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          追加
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">カテゴリが登録されていません</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-gray-700">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  aria-label="編集"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(c)}
                  aria-label="削除"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <Dialog open onClose={() => setDialogOpen(false)} title={editingId ? 'カテゴリ編集' : 'カテゴリ追加'}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="category-name">カテゴリ名</Label>
              <Input
                id="category-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="category-name-en">英語名（任意）</Label>
              <Input
                id="category-name-en"
                value={form.nameEn}
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
                placeholder="e.g. Churrasco (Beef)"
              />
            </div>
            <div>
              <Label>カラー</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color }))}
                    aria-label={color}
                    className={cn(
                      'h-8 w-8 rounded-full ring-offset-2',
                      form.color === color && 'ring-2 ring-navy'
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="category-sort">並び順</Label>
              <Input
                id="category-sort"
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
              />
            </div>

            <FieldError message={error ?? undefined} />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button onClick={handleSubmit} disabled={pending}>
                {pending ? '保存中…' : '保存する'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onClose={() => setDeleting(null)}
          title="カテゴリを削除"
          message={`「${deleting.name}」を削除します。所属する商品はカテゴリ未設定になります。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteCategory(deleting.id);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('カテゴリを削除しました');
          }}
        />
      )}
    </div>
  );
}
