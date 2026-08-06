'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { addCustomerNote } from '@/app/app/customers/actions';
import { formatDateTime } from '@/lib/format';

export interface NoteRow {
  id: string;
  body: string;
  created_at: string;
  creatorName: string | null;
}

export function NotesSection({
  customerId,
  notes,
  canEdit,
}: {
  customerId: string;
  notes: NoteRow[];
  canEdit: boolean;
}) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      toast('メモ内容を入力してください', 'error');
      return;
    }
    startTransition(async () => {
      try {
        await addCustomerNote(customerId, body);
        setBody('');
        toast('メモを追加しました');
      } catch (err) {
        toast(err instanceof Error ? err.message : '追加に失敗しました', 'error');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>接客メモ</CardTitle>
      </CardHeader>
      <CardContent>
        {canEdit && (
          <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="来店時の様子・お伝えしたいこと等を記録します"
              rows={2}
              className="flex-1"
            />
            <Button type="submit" disabled={pending} className="sm:mt-0">
              {pending ? '追加中…' : '追加'}
            </Button>
          </form>
        )}

        {notes.length === 0 ? (
          <p className="text-sm text-gray-400">記録されたメモはありません</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p className="whitespace-pre-wrap text-sm text-navy">{n.body}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {formatDateTime(n.created_at)}
                  {n.creatorName ? `｜${n.creatorName}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
