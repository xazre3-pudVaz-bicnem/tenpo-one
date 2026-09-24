'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, EyeOff, Eye, Pencil, Check, X, Loader2, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/state';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { addPosClerk, deletePosClerk, renamePosClerk, setPosClerkRole, setPosClerkStatus } from '@/app/app/settings/clerks/actions';
import { CLERK_ROLE_LABELS, CLERK_ROLES, type ClerkRole } from '@/lib/clerk-roles';

export interface ClerkRow {
  id: string;
  name: string;
  status: 'active' | 'hidden';
  /** 役職。レジ取消は店長以上だけができる */
  role: ClerkRole;
}

/**
 * POS担当者（名前のみ）の管理。ログインアカウントは作らず、会計時に選ぶ名前だけを登録する。
 * 退職者は「非表示」にする（削除しない＝過去の伝票・レシートの担当名表示を壊さないため）。
 */
export function ClerksPanel({ storeId, initial }: { storeId: string; initial: ClerkRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<ClerkRole>('staff');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ClerkRow | null>(null);

  const run = (fn: () => Promise<{ error?: string }>, okMsg: string, after?: () => void) =>
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

  const handleAdd = () => {
    if (!newName.trim()) return;
    run(() => addPosClerk(storeId, newName, newRole), '担当者を追加しました', () => {
      setNewName('');
      setNewRole('staff');
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          会計・伝票で選ぶ<strong>担当者名</strong>を登録します。ログインアカウントやメール招待は不要です。
          登録した名前は POSレジの伝票で選択でき、レシートの担当欄に印字されます。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            placeholder="担当者名（例: Ronnie）"
            className="max-w-xs"
            disabled={pending}
          />
          <Select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as ClerkRole)}
            className="max-w-[12rem]"
            aria-label="役職"
            disabled={pending}
          >
            {CLERK_ROLES.map((r) => (
              <option key={r} value={r}>
                {CLERK_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Button onClick={handleAdd} disabled={pending || !newName.trim()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            追加
          </Button>
        </div>

        {initial.length === 0 ? (
          <EmptyState title="担当者が登録されていません" description="上の入力欄から担当者名を追加してください" />
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {initial.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                {editingId === c.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="max-w-xs"
                      disabled={pending}
                    />
                    <Button
                      size="sm"
                      onClick={() =>
                        run(() => renamePosClerk(c.id, storeId, editingName), '名前を変更しました', () =>
                          setEditingId(null)
                        )
                      }
                      disabled={pending || !editingName.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={pending}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={c.status === 'hidden' ? 'text-gray-400 line-through' : 'font-medium text-navy'}>
                        {c.name}
                      </span>
                      {c.status === 'hidden' && <Badge tone="gray">非表示</Badge>}
                      <Select
                        value={c.role}
                        onChange={(e) =>
                          run(
                            () => setPosClerkRole(c.id, storeId, e.target.value as ClerkRole),
                            '役職を変更しました'
                          )
                        }
                        className="h-9 max-w-[11rem] text-sm"
                        aria-label={`${c.name}の役職`}
                        disabled={pending}
                      >
                        {CLERK_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {CLERK_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditingName(c.name);
                        }}
                        disabled={pending}
                      >
                        <Pencil className="h-4 w-4" />
                        名前変更
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          run(
                            () => setPosClerkStatus(c.id, storeId, c.status === 'hidden' ? 'active' : 'hidden'),
                            c.status === 'hidden' ? '選択肢に表示しました' : '選択肢から外しました'
                          )
                        }
                        disabled={pending}
                      >
                        {c.status === 'hidden' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        {c.status === 'hidden' ? '表示に戻す' : '非表示'}
                      </Button>
                      {/* 伝票で使っていない担当者は消せる（使っていれば「非表示」を案内する） */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger-soft"
                        aria-label={`${c.name}を削除`}
                        disabled={pending}
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                        削除
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <ConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title="担当者を削除しますか"
          message={
            deleteTarget
              ? `「${deleteTarget.name}」を削除します。伝票で使っている担当者は削除できません（その場合は「非表示」にしてください）。`
              : ''
          }
          confirmLabel="削除する"
          onConfirm={async () => {
            if (!deleteTarget) return;
            const target = deleteTarget;
            setDeleteTarget(null);
            run(() => deletePosClerk(target.id, storeId), '担当者を削除しました');
          }}
        />

        <p className="text-xs text-gray-500">
          退職などで選択肢から外す場合は「非表示」にしてください。削除ではないため、過去の伝票・レシートに残る担当名は変わりません。
        </p>
        <p className="text-xs text-gray-500">
          <strong>役職</strong>は、レジでの取消（品目取消・注文取消）に使います。取消は
          <strong>店長以上</strong>（店長・エリアマネージャー・オーナー）の担当者を選んだときだけできます。
          店長以上を1人も登録していない間は、今まで通り誰でも取消できます。
        </p>
      </CardContent>
    </Card>
  );
}
