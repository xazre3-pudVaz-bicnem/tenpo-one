'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { createStoreForOrg } from '@/app/admin/organizations/actions';

export function CreateStoreDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [storeUser, setStoreUser] = useState('');
  const [registerLimit, setRegisterLimit] = useState('2');
  const [handyLimit, setHandyLimit] = useState('2');
  const [issued, setIssued] = useState<{ orgCode?: string; storeUser?: string; registerPassword?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const close = () => {
    setOpen(false);
    setName('');
    setAddress('');
    setStoreUser('');
    setRegisterLimit('2');
    setHandyLimit('2');
    setIssued(null);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await createStoreForOrg({
          organizationId,
          name,
          address,
          storeUser: storeUser || undefined,
          registerLimit: Number(registerLimit) || 0,
          handyLimit: Number(handyLimit) || 0,
        });
        toast('店舗を追加しました');
        setIssued({ orgCode: res.orgCode, storeUser: res.storeUser, registerPassword: res.registerPassword });
      } catch (err) {
        setError(err instanceof Error ? err.message : '作成に失敗しました');
      }
    });
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        店舗を追加
      </Button>

      <Dialog open={open} onClose={close} title="店舗を追加">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="new-store-name">店舗名</Label>
            <Input id="new-store-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-store-address">住所</Label>
            <Input id="new-store-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-3 rounded-xl border border-gray-100 bg-surface p-3">
            <p className="text-sm font-semibold text-navy">契約（レジ・ハンディ）</p>
            <div>
              <Label htmlFor="new-store-user">店舗ユーザー名（任意・未指定なら店舗名から生成）</Label>
              <Input
                id="new-store-user"
                value={storeUser}
                onChange={(e) => setStoreUser(e.target.value.replace(/[^A-Za-z0-9-]/g, '').toLowerCase().slice(0, 32))}
                placeholder="shunka-shinjuku"
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-store-rlimit">レジ（iPad）の台数</Label>
                <Input id="new-store-rlimit" value={registerLimit} onChange={(e) => setRegisterLimit(e.target.value.replace(/[^0-9]/g, ''))} className="text-right" inputMode="numeric" />
              </div>
              <div>
                <Label htmlFor="new-store-hlimit">ハンディの台数</Label>
                <Input id="new-store-hlimit" value={handyLimit} onChange={(e) => setHandyLimit(e.target.value.replace(/[^0-9]/g, ''))} className="text-right" inputMode="numeric" />
              </div>
            </div>
            <p className="text-xs text-gray-500">レジは 企業番号 ＋ 店舗ユーザー名 ＋ レジ用パスワード で開きます。</p>
          </div>
          {issued && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-800">レジ（iPad）のログイン（この画面でしか表示されません）</p>
              <p className="mt-1">企業番号：<span className="font-mono text-base">{issued.orgCode ?? '—'}</span></p>
              <p className="mt-1">店舗ユーザー名：<span className="font-mono text-base">{issued.storeUser ?? '—'}</span></p>
              <p className="mt-1">レジ用パスワード：<span className="font-mono text-base">{issued.registerPassword ?? '—'}</span></p>
            </div>
          )}
          <p className="text-xs text-gray-500">
            公開URL用のslugは店舗名から自動生成されます。詳細な設定（営業時間・テーブル等）は作成後に企業側の設定画面から行えます。
          </p>
          <FieldError message={error ?? undefined} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              キャンセル
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || !!issued}>
              {pending ? '作成中…' : '作成する'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
