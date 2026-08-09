'use client';

import { useState, useTransition } from 'react';
import { UserPlus, Copy, Check } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { ROLES, ROLE_LABELS, HQ_ROLES, type Role } from '@/lib/permissions';
import type { StoreRef } from '@/lib/auth';
import { inviteStaff } from '@/app/app/staff/actions';

function isStoreScopedRole(role: Role): boolean {
  return !HQ_ROLES.includes(role);
}

export function InviteDialogTrigger({ stores }: { stores: StoreRef[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" />
        スタッフを招待
      </Button>
      {open && <InviteDialog stores={stores} onClose={() => setOpen(false)} />}
    </>
  );
}

function InviteDialog({ stores, onClose }: { stores: StoreRef[]; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayNameKana, setDisplayNameKana] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const storeScoped = isStoreScopedRole(role);

  const toggleStore = (id: string) => {
    setSelectedStoreIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSubmit = () => {
    setError(null);
    if (!email.trim() || !displayName.trim()) {
      setError('メールアドレスと氏名は必須です');
      return;
    }
    if (storeScoped && selectedStoreIds.length === 0) {
      setError('店舗系ロールは所属店舗を1つ以上選択してください');
      return;
    }
    startTransition(async () => {
      // 初期パスワードはサーバー側で生成される（クライアントからは送らない）
      const result = await inviteStaff({
        email,
        displayName,
        displayNameKana,
        role,
        storeIds: selectedStoreIds,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess({ password: result.initialPassword ?? '' });
    });
  };

  const handleCopy = async () => {
    try {
      if (!success?.password) return;
      await navigator.clipboard.writeText(success.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードAPI非対応環境は無視
    }
  };

  if (success) {
    return (
      <Dialog open onClose={onClose} title="招待が完了しました">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            <span className="font-semibold text-navy">{displayName}</span> 様を招待しました。
          </p>
          <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
            <p className="text-xs font-medium text-primary-deep">
              初期パスワード: <span className="font-mono text-sm">{success.password}</span> を本人に安全な方法で伝えてください
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'コピーしました' : 'パスワードをコピー'}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>閉じる</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="スタッフを招待">
      <div className="space-y-4">
        <div>
          <Label htmlFor="invite-email">メールアドレス</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@example.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="invite-name">氏名</Label>
            <Input id="invite-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="invite-kana">フリガナ</Label>
            <Input id="invite-kana" value={displayNameKana} onChange={(e) => setDisplayNameKana(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="invite-role">ロール</Label>
          <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>

        {storeScoped && (
          <div>
            <Label>所属店舗（必須）</Label>
            {stores.length === 0 ? (
              <p className="text-xs text-gray-500">選択可能な店舗がありません</p>
            ) : (
              <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
                {stores.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      checked={selectedStoreIds.includes(s.id)}
                      onChange={() => toggleStore(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-gray-500">
          初期パスワードは招待完了時にサーバー側で自動生成されます。招待後に表示されるパスワードを本人へ安全な方法で伝えてください。
        </p>

        <FieldError message={error ?? undefined} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? '招待中…' : '招待する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
