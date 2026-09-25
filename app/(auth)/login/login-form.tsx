'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { safeNextPath } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Safari の自動入力は onChange が飛ばないことがあるので、フォームから直接読む
    const fd = new FormData(e.currentTarget);
    const mail = ((fd.get('email') as string | null) ?? email).trim();
    const pass = (fd.get('password') as string | null) ?? password;
    if (!mail || !pass) {
      setError('メールアドレスとパスワードを入れてください');
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email: mail, password: pass });
    if (authError) {
      setError('メールアドレスまたはパスワードが正しくありません');
      setBusy(false);
      return;
    }
    router.push(safeNextPath(next));
    router.refresh();
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? 'ログイン中…' : 'ログイン'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
