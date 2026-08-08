'use client';

import { useState, useTransition } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updateEmployeeConfidential } from '@/app/app/employees/actions';

export interface ConfidentialData {
  employeeId: string;
  bank: { bank: string; branch: string; type: string; last4: string; holder: string };
  emergency: { name: string; relation: string; phone: string };
}

/**
 * 機密セクション（銀行振込情報・緊急連絡先）。payroll.view_all のみ表示され、
 * canEdit（payroll.manage）の場合のみ編集可能。口座番号は末尾4桁のみ保存する。
 */
export function ConfidentialForm({ initial, canEdit }: { initial: ConfidentialData; canEdit: boolean }) {
  const [bank, setBank] = useState(initial.bank);
  const [emergency, setEmergency] = useState(initial.emergency);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateEmployeeConfidential({ id: initial.employeeId, bank, emergency });
      toast(result.message, result.ok ? 'success' : 'error');
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>機密情報</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>この情報は給与閲覧権限を持つロールにのみ表示されます。口座番号は全桁を保存せず末尾4桁のみ保存します。</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-gray-500">銀行振込情報</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-name">銀行名</Label>
              <Input id="bank-name" value={bank.bank} disabled={!canEdit} onChange={(e) => setBank((b) => ({ ...b, bank: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="bank-branch">支店名</Label>
              <Input id="bank-branch" value={bank.branch} disabled={!canEdit} onChange={(e) => setBank((b) => ({ ...b, branch: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="bank-type">種別</Label>
              <Input id="bank-type" value={bank.type} disabled={!canEdit} placeholder="普通・当座 など" onChange={(e) => setBank((b) => ({ ...b, type: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="bank-last4">口座番号（末尾4桁のみ）</Label>
              <Input
                id="bank-last4"
                value={bank.last4}
                disabled={!canEdit}
                maxLength={4}
                inputMode="numeric"
                placeholder="1234"
                onChange={(e) => setBank((b) => ({ ...b, last4: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="bank-holder">口座名義</Label>
              <Input id="bank-holder" value={bank.holder} disabled={!canEdit} onChange={(e) => setBank((b) => ({ ...b, holder: e.target.value }))} />
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-gray-500">緊急連絡先</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="emg-name">氏名</Label>
              <Input id="emg-name" value={emergency.name} disabled={!canEdit} onChange={(e) => setEmergency((v) => ({ ...v, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="emg-relation">続柄</Label>
              <Input id="emg-relation" value={emergency.relation} disabled={!canEdit} onChange={(e) => setEmergency((v) => ({ ...v, relation: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="emg-phone">電話番号</Label>
              <Input id="emg-phone" value={emergency.phone} disabled={!canEdit} onChange={(e) => setEmergency((v) => ({ ...v, phone: e.target.value }))} />
            </div>
          </div>
        </div>

        {canEdit && (
          <>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={pending}>
                {pending ? '保存中…' : '機密情報を保存'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
