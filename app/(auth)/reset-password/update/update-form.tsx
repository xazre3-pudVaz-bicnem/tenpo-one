'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('パスワードは8文字以上で設定してください');
      return;
    }
    if (password !== confirm) {
      setError('確認用パスワードが一致しません');
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError('更新に失敗しました。リンクの有効期限が切れている可能性があります');
      setBusy(false);
      return;
    }
    router.push('/app/dashboard');
    router.refresh();
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="password">新しいパスワード（8文字以上）</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="confirm">新しいパスワード（確認）</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
            {busy ? '更新中…' : 'パスワードを更新'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
