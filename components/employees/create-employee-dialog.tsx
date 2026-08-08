'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { StoreRef } from '@/lib/auth';
import { createEmployeeFromMember } from '@/app/app/employees/actions';

const TYPE_OPTIONS = [
  { value: 'full_time', label: '正社員' },
  { value: 'contract', label: '契約社員' },
  { value: 'part_time', label: 'アルバイト・パート' },
  { value: 'outsourced', label: '業務委託' },
];

/** memberships のスタッフから従業員台帳(employees)行を新規作成するダイアログ */
export function CreateEmployeeDialog({
  staffOptions,
  stores,
}: {
  staffOptions: { id: string; name: string }[];
  stores: StoreRef[];
}) {
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [employmentType, setEmploymentType] = useState('part_time');
  const [primaryStoreId, setPrimaryStoreId] = useState('');
  const [hiredOn, setHiredOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = () => {
    if (!profileId) {
      setError('対象スタッフを選択してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createEmployeeFromMember({
        profileId,
        employeeNo,
        employmentType,
        primaryStoreId: primaryStoreId || null,
        hiredOn: hiredOn || null,
      });
      toast(result.message, result.ok ? 'success' : 'error');
      if (result.ok && result.employeeId) {
        close();
        router.push(`/app/employees/${result.employeeId}`);
      } else if (!result.ok) {
        setError(result.message);
      }
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={staffOptions.length === 0}>
        <UserPlus className="h-4 w-4" />
        従業員情報を登録
      </Button>
      <Dialog open={open} onClose={close} title="従業員情報を登録">
        <div className="space-y-4">
          {staffOptions.length === 0 ? (
            <p className="text-sm text-gray-500">登録可能なスタッフがいません（すべてのスタッフが登録済みです）</p>
          ) : (
            <div>
              <Label htmlFor="emp-profile">対象スタッフ</Label>
              <Select id="emp-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="">選択してください</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="emp-no">社員番号</Label>
              <Input id="emp-no" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="emp-hired">入社日</Label>
              <Input id="emp-hired" type="date" value={hiredOn} onChange={(e) => setHiredOn(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="emp-type">雇用区分</Label>
            <Select id="emp-type" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="emp-store">所属店舗</Label>
            <Select id="emp-store" value={primaryStoreId} onChange={(e) => setPrimaryStoreId(e.target.value)}>
              <option value="">未設定</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={pending || staffOptions.length === 0}>
            {pending ? '登録中…' : '登録する'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
