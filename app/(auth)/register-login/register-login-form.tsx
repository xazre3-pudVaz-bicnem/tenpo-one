'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { signInRegister } from './actions';

/**
 * レジ（iPad）のログイン。
 *   企業番号（会社で1つ・6桁の数字）
 *   店舗ユーザー名（店舗ごと）
 *   レジ用パスワード（店舗ごと）
 * さらに、契約でお店の回線を登録している店舗は、その回線からしか入れない。
 */
export function RegisterLoginForm() {
  const router = useRouter();
  const [orgCode, setOrgCode] = useState('');
  const [storeUser, setStoreUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signInRegister({ orgCode, storeUser, password });
    if (res.error) {
      setError(res.error);
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
            <Label htmlFor="store-user">店舗ユーザー名</Label>
            <Input
              id="store-user"
              value={storeUser}
              onChange={(e) => setStoreUser(e.target.value.replace(/[^A-Za-z0-9-]/g, '').toLowerCase().slice(0, 32))}
              placeholder="ronnies-house"
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              spellCheck={false}
              className="text-lg"
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
          <FieldError message={error ?? undefined} />
          <Button type="submit" className="w-full" size="lg" disabled={busy || !orgCode || !storeUser || !password}>
            {busy ? 'ログイン中…' : 'レジを開く'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
