'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ROLES, ROLE_LABELS, type Role } from '@/lib/permissions';
import { saveStaffStep, skipOnboardingStep, type StaffInviteStepInput } from '../actions';

export function StepStaff({ onAdvance }: { onAdvance: (next: number) => void }) {
  const [rows, setRows] = useState<StaffInviteStepInput[]>([{ email: '', displayName: '', role: 'staff' }]);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; password: string }[] | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const update = (i: number, patch: Partial<StaffInviteStepInput>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { email: '', displayName: '', role: 'staff' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveStaffStep(rows);
      if (res.error) return setError(res.error);
      if (res.invited && res.invited.length > 0) {
        setInvited(res.invited);
        toast('スタッフを招待しました');
      } else {
        onAdvance(8);
      }
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      await skipOnboardingStep(8);
      onAdvance(8);
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('コピーしました');
    } catch {
      // クリップボードAPI非対応環境は無視
    }
  };

  if (invited) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>スタッフを招待しました</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500">初期パスワードは再表示できません。本人へ安全な方法で共有してください。</p>
          {invited.map((inv) => (
            <div key={inv.email} className="rounded-lg border border-gray-200 bg-surface p-3 text-sm">
              <p className="font-mono text-xs text-navy">{inv.email}</p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm text-navy">{inv.password}</p>
                <button type="button" onClick={() => copy(inv.password)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-navy" aria-label="コピー">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
        <div className="flex justify-end px-5 pb-5">
          <Button onClick={() => onAdvance(8)}>次へ</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>スタッフを招待しましょう（任意）</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label className="text-xs">メールアドレス</Label>
                <Input type="email" value={r.email} onChange={(e) => update(i, { email: e.target.value })} placeholder="staff@example.com" />
              </div>
              <div className="min-w-0 flex-1">
                <Label className="text-xs">氏名</Label>
                <Input value={r.displayName} onChange={(e) => update(i, { displayName: e.target.value })} />
              </div>
              <div className="w-36">
                <Label className="text-xs">ロール</Label>
                <Select value={r.role} onChange={(e) => update(i, { role: e.target.value as Role })}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label="削除" disabled={rows.length === 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" />
            行を追加
          </Button>
          <FieldError message={error ?? undefined} />
        </CardContent>
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <Button type="button" variant="secondary" onClick={handleSkip} disabled={pending}>
            後で設定する
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? '招待中…' : '招待して次へ'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
