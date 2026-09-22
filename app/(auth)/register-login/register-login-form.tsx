'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { signInRegister } from './actions';

/**
 * レジ（iPad）のログイン。
 * 打つのは 企業番号 と レジ用パスワード の2つだけ。
 * どの店舗のレジかは、お店の回線（契約時に登録したIP）で決まる。
 */
export function RegisterLoginForm() {
  const router = useRouter();
  const [orgCode, setOrgCode] = useState('');
  const [password, setPassword] = useState('');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signInRegister({ orgCode, password, storeId: storeId || null });
    if (res.error) {
      setError(res.error);
      setBusy(false);
      return;
    }
    if (res.choose) {
      setStores(res.choose);
      setStoreId(res.choose[0]?.id ?? '');
      setError('この回線に店舗が複数あります。店舗を選んでください');
      setBusy(false);
      return;
    }
    router.push('/app/pos');
    router.refresh();
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="org-code">企業番号</Label>
            <Input
              id="org-code"
              value={orgCode}
              onChange={(e) => setOrgCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="184203"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="text-lg tracking-widest"
              required
            />
          </div>
          <div>
            <Label htmlFor="register-password">レジ用パスワード</Label>
            <Input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="text-lg tracking-widest"
              required
            />
          </div>
          {stores.length > 0 && (
            <div>
              <Label htmlFor="store-pick">店舗</Label>
              <select
                id="store-pick"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-base"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <FieldError message={error ?? undefined} />
          <Button type="submit" className="w-full" size="lg" disabled={busy || !orgCode || !password}>
            {busy ? 'ログイン中…' : 'レジを開く'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
