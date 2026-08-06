'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { attachCustomerTag, createCustomerTag, detachCustomerTag } from '@/app/app/customers/actions';

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

export function TagsEditor({
  customerId,
  allTags,
  attached,
  canEdit,
}: {
  customerId: string;
  allTags: TagOption[];
  attached: TagOption[];
  canEdit: boolean;
}) {
  const [selectId, setSelectId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#7B3FF2');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const attachedIds = new Set(attached.map((t) => t.id));
  const available = allTags.filter((t) => !attachedIds.has(t.id));

  const handleAttach = (tagId: string) => {
    if (!tagId) return;
    startTransition(async () => {
      try {
        await attachCustomerTag(customerId, tagId);
        setSelectId('');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'タグの付与に失敗しました', 'error');
      }
    });
  };

  const handleDetach = (tagId: string) => {
    startTransition(async () => {
      try {
        await detachCustomerTag(customerId, tagId);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'タグの解除に失敗しました', 'error');
      }
    });
  };

  const handleCreate = () => {
    if (!newName.trim()) {
      toast('タグ名を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        const { id } = await createCustomerTag(newName, newColor);
        await attachCustomerTag(customerId, id);
        toast('タグを作成して付与しました');
        setNewName('');
        setCreating(false);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'タグの作成に失敗しました', 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>タグ</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {attached.length === 0 && <span className="text-xs text-gray-400">タグはまだありません</span>}
          {attached.map((t) => (
            <Badge key={t.id} style={{ backgroundColor: `${t.color}1f`, color: t.color }} className="gap-1 pr-1">
              {t.name}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => handleDetach(t.id)}
                  disabled={pending}
                  aria-label={`${t.name}を解除`}
                  className="rounded-full p-0.5 hover:bg-black/10"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>

        {canEdit && (
          <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
            {available.length > 0 && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="tag-select">既存のタグを付与</Label>
                  <Select id="tag-select" value={selectId} onChange={(e) => { setSelectId(e.target.value); handleAttach(e.target.value); }}>
                    <option value="">選択してください</option>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            {creating ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="tag-new-name">新しいタグ名</Label>
                  <Input id="tag-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="VIP 等" />
                </div>
                <div>
                  <Label htmlFor="tag-new-color">色</Label>
                  <input
                    id="tag-new-color"
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-10 w-12 rounded-lg border border-gray-300"
                  />
                </div>
                <Button type="button" size="sm" onClick={handleCreate} disabled={pending}>
                  作成
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(false)} disabled={pending}>
                  取消
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" />
                新しいタグを作成
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
