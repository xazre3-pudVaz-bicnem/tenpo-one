'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Check, X, Ban, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, FieldError } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { addRegister, renameRegister, toggleRegisterActive } from '@/app/app/settings/printers/actions';

export interface RegisterRow {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}

export function RegistersPanel({ storeId, initial }: { storeId: string; initial: RegisterRow[] }) {
  const registers = initial;

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleAdd = () => {
    setError(null);
    if (!newName.trim()) {
      setError('レジ名を入力してください');
      return;
    }
    startTransition(async () => {
      const result = await addRegister(storeId, newName);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNewName('');
      toast('レジを追加しました');
    });
  };

  const handleRename = () => {
    if (!editingId) return;
    startTransition(async () => {
      const result = await renameRegister(editingId, storeId, editingName);
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      setEditingId(null);
      toast('レジ名を変更しました');
    });
  };

  const handleToggle = (r: RegisterRow) => {
    startTransition(async () => {
      const result = await toggleRegisterActive(r.id, storeId, r.status === 'inactive');
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(r.status === 'inactive' ? 'レジを有効化しました' : 'レジを無効化しました');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>レジ端末</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {registers.length === 0 ? (
          <p className="text-sm text-gray-500">レジが登録されていません</p>
        ) : (
          <ul className="space-y-2">
            {registers.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                {editingId === r.id ? (
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
                    <span className="flex items-center gap-2 text-sm font-medium text-navy">
                      {r.name}
                      <Badge tone={r.status === 'active' ? 'success' : 'gray'}>
                        {r.status === 'active' ? '有効' : '無効'}
                      </Badge>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(r.id);
                          setEditingName(r.name);
                        }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                        aria-label="名前変更"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(r)}
                        disabled={pending}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                        aria-label={r.status === 'active' ? '無効化' : '有効化'}
                      >
                        {r.status === 'active' ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新しいレジ名" className="h-9" />
          <Button size="sm" onClick={handleAdd} disabled={pending}>
            <Plus className="h-4 w-4" />
            追加
          </Button>
        </div>
        <FieldError message={error ?? undefined} />
      </CardContent>
    </Card>
  );
}
