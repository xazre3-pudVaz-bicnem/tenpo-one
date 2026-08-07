'use client';

import { useState, useTransition } from 'react';
import { UserPlus, Copy, CheckCircle2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/permissions';
import { addOrgMember, type AddOrgMemberResult } from '@/app/admin/organizations/actions';

export function AddOrgMemberDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddOrgMemberResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setEmail('');
    setDisplayName('');
    setRole('staff');
    setError(null);
    setResult(null);
    setCopied(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await addOrgMember({ organizationId, email, displayName, role });
        setResult(res);
        toast('ユーザーを追加しました');
      } catch (err) {
        setError(err instanceof Error ? err.message : '追加に失敗しました');
      }
    });
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードAPI非対応環境は無視
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-3.5 w-3.5" />
        ユーザーを追加
      </Button>

      <Dialog open={open} onClose={close} title="ユーザーを追加">
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              ユーザーを追加しました
            </div>
            <div className="space-y-3 rounded-lg border border-gray-200 bg-surface p-4 text-sm">
              <p className="text-xs text-gray-500">初期パスワードは再表示できません。本人へ安全な方法で共有してください。</p>
              <div>
                <p className="text-xs font-medium text-gray-500">メールアドレス</p>
                <p className="font-mono text-sm text-navy">{result.email}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">初期パスワード</p>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm text-navy">{result.password}</p>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-navy"
                    aria-label="パスワードをコピー"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {copied && <span className="text-xs text-success">コピーしました</span>}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={close}>閉じる</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="add-member-email">メールアドレス</Label>
              <Input id="add-member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="add-member-name">氏名</Label>
              <Input id="add-member-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="add-member-role">ロール</Label>
              <Select id="add-member-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-gray-500">
              初期パスワードは作成後に自動生成・表示されます。店舗系ロールの所属店舗は追加後に企業側のスタッフ管理画面から設定してください。
            </p>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                キャンセル
              </Button>
              <Button type="submit" disabled={pending || !email.trim() || !displayName.trim()}>
                {pending ? '追加中…' : '追加する'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
