'use client';

import { useState, useTransition } from 'react';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FieldError } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { addFloor, renameFloor, deleteFloor } from '@/app/app/settings/tables/actions';

export interface FloorRow {
  id: string;
  name: string;
}

export function FloorsPanel({ storeId, initial }: { storeId: string; initial: FloorRow[] }) {
  const floors = initial;

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingFloor, setDeletingFloor] = useState<FloorRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleAdd = () => {
    setError(null);
    if (!newName.trim()) {
      setError('フロア名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await addFloor(storeId, newName);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNewName('');
      toast('フロアを追加しました');
    });
  };

  const startEdit = (floor: FloorRow) => {
    setEditingId(floor.id);
    setEditingName(floor.name);
  };

  const handleRename = () => {
    if (!editingId) return;
    startTransition(async () => {
      const result = await renameFloor(editingId, storeId, editingName);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      setEditingId(null);
      toast('フロア名を変更しました');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>フロア</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {floors.length === 0 ? (
          <p className="text-sm text-gray-500">フロアが登録されていません</p>
        ) : (
          <ul className="space-y-2">
            {floors.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                {editingId === f.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} className="h-8" />
                    <button type="button" onClick={handleRename} disabled={pending} className="text-primary" aria-label="保存">
                      <Check className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-gray-400" aria-label="キャンセル">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-medium text-navy">{f.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(f)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                        aria-label="名前変更"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingFloor(f)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-danger-soft hover:text-danger"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新しいフロア名"
            className="h-9"
          />
          <Button size="sm" onClick={handleAdd} disabled={pending}>
            <Plus className="h-4 w-4" />
            追加
          </Button>
        </div>
        <FieldError message={error ?? undefined} />
      </CardContent>

      {deletingFloor && (
        <ConfirmDialog
          open
          onClose={() => setDeletingFloor(null)}
          title="フロアを削除"
          message={`「${deletingFloor.name}」を削除します。このフロアに属するテーブルは別フロアへ移動してください。`}
          confirmLabel="削除する"
          onConfirm={async () => {
            const result = await deleteFloor(deletingFloor.id, storeId);
            if (result.error) {
              toast(result.error, 'error');
              return;
            }
            toast('フロアを削除しました');
          }}
        />
      )}
    </Card>
  );
}
