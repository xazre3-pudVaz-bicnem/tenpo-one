'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label, Select, Textarea, FieldError } from '@/components/ui/input';

export function SupportAccessForm({
  organizations,
  action,
}: {
  organizations: { id: string; name: string }[];
  action: (organizationId: string, reason: string) => Promise<void>;
}) {
  const [organizationId, setOrganizationId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await action(organizationId, reason);
        setDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : '記録に失敗しました');
      }
    });
  };

  if (done) {
    return (
      <Card>
        <CardContent className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <p className="mt-3 text-sm font-semibold text-navy">記録しました</p>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            cypress管理者はRLSにより全企業データを閲覧できます。すべての操作が監査ログに記録されます。
          </p>
          <Link href="/app/dashboard" className="mt-5 inline-flex">
            <Button>ダッシュボードへ</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <div className="mb-4 flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3 text-xs text-warning">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          企業データへアクセスする前に、必ずアクセス理由を記録してください。すべての操作が監査ログに残ります。
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="support-org">対象企業</Label>
            <Select
              id="support-org"
              required
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              <option value="">選択してください</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="support-reason">アクセス理由</Label>
            <Textarea
              id="support-reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: サポート対応のため、○○の不具合を確認します"
            />
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" className="w-full" disabled={pending || !organizationId || !reason.trim()}>
            {pending ? '記録中…' : 'アクセスを記録'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
