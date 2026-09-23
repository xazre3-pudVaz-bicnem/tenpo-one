'use client';

import { useEffect, useState } from 'react';
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
 *
 * お店のiPadは毎日同じ端末で開くので、企業番号と店舗ユーザー名はこの端末に覚えておく。
 * パスワードは覚えない（端末を触れば誰でも入れてしまうため）。
 */
const REMEMBER_KEY = 'tenpo_register_login';

function loadRemembered(): { orgCode: string; storeUser: string } | null {
  try {
    const raw = window.localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { orgCode?: unknown; storeUser?: unknown };
    return {
      orgCode: typeof v.orgCode === 'string' ? v.orgCode.slice(0, 6) : '',
      storeUser: typeof v.storeUser === 'string' ? v.storeUser.slice(0, 32) : '',
    };
  } catch {
    return null;
  }
}

export function RegisterLoginForm() {
  const router = useRouter();
  const [orgCode, setOrgCode] = useState('');
  const [storeUser, setStoreUser] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = loadRemembered();
    if (!saved) return;
    // 画面が出たあとで入れる（サーバー側の描画と食い違わないように）
    void Promise.resolve().then(() => {
      setOrgCode(saved.orgCode);
      setStoreUser(saved.storeUser);
    });
  }, []);

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
    try {
      if (remember) window.localStorage.setItem(REMEMBER_KEY, JSON.stringify({ orgCode, storeUser }));
      else window.localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // プライベートブラウズなどで保存できなくても、ログインは続ける
    }
    // ログイン後はホーム（メニュー一覧）へ。POSレジは「オーダー・会計」から開く（2026-09-24 要望）
    router.push('/app/dashboard');
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
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="text-lg tracking-widest"
              required
            />
          </div>

          <div className="space-y-2 pt-1">
            <label htmlFor="show-password" className="flex items-center justify-between text-sm text-navy">
              パスワードを表示する
              <input
                id="show-password"
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 accent-primary"
              />
            </label>
            <label htmlFor="remember-login" className="flex items-center justify-between text-sm text-navy">
              企業番号・店舗ユーザー名を記憶する
              <input
                id="remember-login"
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 accent-primary"
              />
            </label>
            <p className="text-xs text-gray-400">パスワードはこの端末に残しません</p>
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
