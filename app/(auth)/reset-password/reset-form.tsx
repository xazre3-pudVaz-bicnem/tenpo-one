'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export function ResetForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password/update`,
    });
    if (resetError) {
      setError('送信に失敗しました。時間をおいて再度お試しください');
      setBusy(false);
      return;
    }
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return (
      <Card>
        <CardContent className="text-center text-sm text-gray-700">
          <p className="font-medium text-navy">再設定メールを送信しました</p>
          <p className="mt-2 text-gray-500">
            {email} 宛のメールに記載されたリンクから、新しいパスワードを設定してください。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="email">登録メールアドレス</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" className="w-full" disabled={busy || !email}>
            {busy ? '送信中…' : '再設定メールを送信'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
