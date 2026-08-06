'use client';

import { useState, useTransition } from 'react';
import { Plus, Copy, CheckCircle2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createOrganization, type CreateOrganizationResult } from '@/app/admin/organizations/actions';

export function CreateOrganizationDialog({ plans }: { plans: { code: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [nameKana, setNameKana] = useState('');
  const [planCode, setPlanCode] = useState(plans[0]?.code ?? '');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateOrganizationResult | null>(null);

  const reset = () => {
    setName('');
    setNameKana('');
    setPlanCode(plans[0]?.code ?? '');
    setOwnerEmail('');
    setOwnerName('');
    setError(null);
    setResult(null);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await createOrganization({ name, nameKana, planCode, ownerEmail, ownerName });
        setResult(res);
        toast('企業を作成しました');
      } catch (err) {
        setError(err instanceof Error ? err.message : '作成に失敗しました');
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        企業を作成
      </Button>

      <Dialog open={open} onClose={close} title="企業を作成">
        {result ? (
          <div>
            <div className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              企業とオーナーアカウントを作成しました
            </div>
            <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-surface p-4 text-sm">
              <p className="text-xs text-gray-500">
                初期パスワードは再表示できません。オーナー様へ安全な方法で共有してください。
              </p>
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
                    onClick={() => {
                      navigator.clipboard?.writeText(result.password);
                      toast('パスワードをコピーしました');
                    }}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-navy"
                    aria-label="パスワードをコピー"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={close}>閉じる</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="org-name">企業名</Label>
              <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="org-kana">企業名（カナ）</Label>
              <Input id="org-kana" value={nameKana} onChange={(e) => setNameKana(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="org-plan">プラン</Label>
              <Select id="org-plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                {plans.length === 0 && <option value="">プランが未登録です</option>}
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="owner-name">オーナー氏名</Label>
                <Input id="owner-name" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="owner-email">オーナーのメールアドレス</Label>
                <Input
                  id="owner-email"
                  type="email"
                  required
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">
              初期パスワードは作成後に自動生成・表示されます。オーナーには後ほどパスワード再設定をご案内ください。
            </p>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                キャンセル
              </Button>
              <Button type="submit" disabled={pending || !name || !ownerEmail || !ownerName}>
                {pending ? '作成中…' : '作成する'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
