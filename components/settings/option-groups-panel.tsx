'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, Link2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/state';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { yen } from '@/lib/format';
import {
  createOptionGroup,
  updateOptionGroup,
  deleteOptionGroup,
  addOptionItem,
  deleteOptionItem,
  setGroupMenuItems,
} from '@/app/app/settings/options/actions';

export interface OptionGroupRow {
  id: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  items: { id: string; name: string; price: number }[];
  menuItemIds: string[];
}

type RunFn = (fn: () => Promise<{ error?: string }>, okMsg: string, after?: () => void) => void;

/**
 * メニュー選択肢グループの管理。
 * グループ（必須・最小/最大）→ 選択肢（追加料金）→ 対象商品の紐付け、の順に設定する。
 */
export function OptionGroupsPanel({
  storeId,
  groups,
  menuItems,
}: {
  storeId: string;
  groups: OptionGroupRow[];
  menuItems: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState('');
  const [linkTarget, setLinkTarget] = useState<OptionGroupRow | null>(null);

  const run: RunFn = (fn, okMsg, after) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast(res.error, 'error');
        return;
      }
      toast(okMsg);
      after?.();
      router.refresh();
    });

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">
            「サイズ」「トッピング」のように、商品に付ける<strong>選択肢</strong>を設定します。
            必須にしたり、選べる数の上限、追加料金を指定できます。POSで対象商品をタップすると選択画面が出ます。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="グループ名（例: サイズ）"
              className="max-w-xs"
              disabled={pending}
            />
            <Button
              onClick={() =>
                run(
                  () => createOptionGroup({ storeId, name: newName, isRequired: false, minSelect: 0, maxSelect: 1 }),
                  'グループを追加しました',
                  () => setNewName('')
                )
              }
              disabled={pending || !newName.trim()}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              グループを追加
            </Button>
          </div>
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <EmptyState title="選択肢グループがありません" description="上の入力欄からグループを追加してください" />
      ) : (
        groups.map((g) => (
          <GroupCard
            key={g.id}
            storeId={storeId}
            group={g}
            menuItems={menuItems}
            pending={pending}
            run={run}
            onOpenLink={() => setLinkTarget(g)}
          />
        ))
      )}

      {linkTarget && (
        <LinkDialog
          storeId={storeId}
          group={linkTarget}
          menuItems={menuItems}
          onClose={() => setLinkTarget(null)}
          run={run}
        />
      )}
    </div>
  );
}

function GroupCard({
  storeId,
  group,
  menuItems,
  pending,
  run,
  onOpenLink,
}: {
  storeId: string;
  group: OptionGroupRow;
  menuItems: { id: string; name: string }[];
  pending: boolean;
  run: RunFn;
  onOpenLink: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [isRequired, setIsRequired] = useState(group.isRequired);
  const [minSelect, setMinSelect] = useState(group.minSelect);
  const [maxSelect, setMaxSelect] = useState(group.maxSelect);
  const [optName, setOptName] = useState('');
  const [optPrice, setOptPrice] = useState(0);

  const linkedNames = group.menuItemIds
    .map((id) => menuItems.find((m) => m.id === id)?.name)
    .filter((n): n is string => !!n);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor={`n-${group.id}`}>グループ名</Label>
            <Input id={`n-${group.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`min-${group.id}`}>最小選択数</Label>
            <Input
              id={`min-${group.id}`}
              type="number"
              min={0}
              value={minSelect}
              onChange={(e) => setMinSelect(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor={`max-${group.id}`}>最大選択数</Label>
            <Input
              id={`max-${group.id}`}
              type="number"
              min={1}
              value={maxSelect}
              onChange={(e) => setMaxSelect(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            必須（最低1つ選ばないと注文に追加できない）
          </label>
          <Button
            size="sm"
            onClick={() =>
              run(
                () => updateOptionGroup({ id: group.id, storeId, name, isRequired, minSelect, maxSelect }),
                '保存しました'
              )
            }
            disabled={pending}
          >
            保存
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenLink} disabled={pending}>
            <Link2 className="h-4 w-4" />
            対象商品（{group.menuItemIds.length}）
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`「${group.name}」を削除します。選択肢と商品への紐付けも削除されます。よろしいですか？`)) {
                run(() => deleteOptionGroup(group.id, storeId), 'グループを削除しました');
              }
            }}
            disabled={pending}
          >
            <Trash2 className="h-4 w-4" />
            削除
          </Button>
        </div>

        {linkedNames.length > 0 && <p className="text-xs text-gray-500">対象商品: {linkedNames.join('、')}</p>}

        <div className="rounded-xl border border-gray-200 p-3">
          <p className="mb-2 text-sm font-semibold text-navy">選択肢</p>
          {group.items.length === 0 ? (
            <p className="mb-2 text-xs text-gray-500">まだ選択肢がありません。下の欄から追加してください。</p>
          ) : (
            <ul className="mb-3 divide-y divide-gray-100">
              {group.items.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <span className="text-sm text-navy">
                    {o.name}
                    {o.price !== 0 && <Badge tone="gray" className="ml-2">+{yen(o.price)}</Badge>}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run(() => deleteOptionItem(o.id, storeId), '選択肢を削除しました')}
                    disabled={pending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor={`on-${group.id}`}>選択肢名</Label>
              <Input
                id={`on-${group.id}`}
                value={optName}
                onChange={(e) => setOptName(e.target.value)}
                placeholder="例: 大盛り"
                className="max-w-[12rem]"
              />
            </div>
            <div>
              <Label htmlFor={`op-${group.id}`}>追加料金</Label>
              <Input
                id={`op-${group.id}`}
                type="number"
                value={optPrice}
                onChange={(e) => setOptPrice(Number(e.target.value))}
                className="max-w-[8rem]"
              />
            </div>
            <Button
              size="sm"
              onClick={() =>
                run(
                  () => addOptionItem({ groupId: group.id, storeId, name: optName, price: optPrice }),
                  '選択肢を追加しました',
                  () => {
                    setOptName('');
                    setOptPrice(0);
                  }
                )
              }
              disabled={pending || !optName.trim()}
            >
              <Plus className="h-4 w-4" />
              追加
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LinkDialog({
  storeId,
  group,
  menuItems,
  onClose,
  run,
}: {
  storeId: string;
  group: OptionGroupRow;
  menuItems: { id: string; name: string }[];
  onClose: () => void;
  run: RunFn;
}) {
  const [selected, setSelected] = useState<string[]>(group.menuItemIds);
  const [query, setQuery] = useState('');
  const filtered = menuItems.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Dialog open onClose={onClose} title={`「${group.name}」を使う商品`}>
      <div className="space-y-3">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="商品名で絞り込み" />
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
          {filtered.length === 0 ? (
            <p className="p-2 text-sm text-gray-500">該当する商品がありません</p>
          ) : (
            filtered.map((m) => (
              <label key={m.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)))
                  }
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                {m.name}
              </label>
            ))
          )}
        </div>
        <p className="text-xs text-gray-500">{selected.length}件を選択中</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            onClick={() =>
              run(
                () => setGroupMenuItems({ groupId: group.id, storeId, menuItemIds: selected }),
                '対象商品を更新しました',
                onClose
              )
            }
          >
            保存する
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
