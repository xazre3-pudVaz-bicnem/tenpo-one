'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { StoreRef } from '@/lib/auth';
import { updateEmployeeBasic } from '@/app/app/employees/actions';

const TYPE_OPTIONS = [
  { value: 'full_time', label: '正社員' },
  { value: 'contract', label: '契約社員' },
  { value: 'part_time', label: 'アルバイト・パート' },
  { value: 'outsourced', label: '業務委託' },
];
const STATUS_OPTIONS = [
  { value: 'active', label: '在籍中' },
  { value: 'retired', label: '退職' },
];

export interface EmployeeBasicData {
  id: string;
  employeeNo: string;
  legalName: string;
  legalNameKana: string;
  postalCode: string;
  address: string;
  birthDate: string;
  hiredOn: string;
  terminatedOn: string;
  employmentType: string;
  position: string;
  primaryStoreId: string;
  status: string;
}

/** 基本情報の表示・編集。canEdit=false の場合は入力欄を読み取り専用にする（本人閲覧・自店店長など） */
export function BasicInfoForm({
  initial,
  stores,
  canEdit,
}: {
  initial: EmployeeBasicData;
  stores: StoreRef[];
  canEdit: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const set = <K extends keyof EmployeeBasicData>(key: K, value: EmployeeBasicData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateEmployeeBasic({
        id: form.id,
        employeeNo: form.employeeNo,
        legalName: form.legalName,
        legalNameKana: form.legalNameKana,
        postalCode: form.postalCode,
        address: form.address,
        birthDate: form.birthDate || null,
        hiredOn: form.hiredOn || null,
        terminatedOn: form.terminatedOn || null,
        employmentType: form.employmentType,
        position: form.position,
        primaryStoreId: form.primaryStoreId || null,
        status: form.status,
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>基本情報</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="basic-no">社員番号</Label>
            <Input id="basic-no" value={form.employeeNo} disabled={!canEdit} onChange={(e) => set('employeeNo', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="basic-status">状態</Label>
            <Select id="basic-status" value={form.status} disabled={!canEdit} onChange={(e) => set('status', e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="basic-name">戸籍名</Label>
            <Input id="basic-name" value={form.legalName} disabled={!canEdit} onChange={(e) => set('legalName', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="basic-kana">戸籍名（カナ）</Label>
            <Input id="basic-kana" value={form.legalNameKana} disabled={!canEdit} onChange={(e) => set('legalNameKana', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="basic-postal">郵便番号</Label>
            <Input id="basic-postal" value={form.postalCode} disabled={!canEdit} onChange={(e) => set('postalCode', e.target.value)} placeholder="123-4567" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="basic-address">住所</Label>
            <Input id="basic-address" value={form.address} disabled={!canEdit} onChange={(e) => set('address', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="basic-birth">生年月日</Label>
            <Input id="basic-birth" type="date" value={form.birthDate} disabled={!canEdit} onChange={(e) => set('birthDate', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="basic-position">役職</Label>
            <Input id="basic-position" value={form.position} disabled={!canEdit} onChange={(e) => set('position', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="basic-hired">入社日</Label>
            <Input id="basic-hired" type="date" value={form.hiredOn} disabled={!canEdit} onChange={(e) => set('hiredOn', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="basic-terminated">退職日</Label>
            <Input id="basic-terminated" type="date" value={form.terminatedOn} disabled={!canEdit} onChange={(e) => set('terminatedOn', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="basic-type">雇用区分</Label>
            <Select id="basic-type" value={form.employmentType} disabled={!canEdit} onChange={(e) => set('employmentType', e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="basic-store">所属店舗</Label>
            <Select id="basic-store" value={form.primaryStoreId} disabled={!canEdit} onChange={(e) => set('primaryStoreId', e.target.value)}>
              <option value="">未設定</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {canEdit && (
          <>
            <FieldError message={error ?? undefined} />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={pending}>
                {pending ? '保存中…' : '基本情報を保存'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
