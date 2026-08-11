'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { addSupportNote, deleteSupportNote } from '@/app/admin/tenants/actions';

interface Note { id: string; body: string; createdAt: string; authorName: string }

/** CYPRESS運営だけが見る導入メモ。店舗ユーザーには表示されない（RLS cypress限定）。 */
export function TenantSupportNotes({ storeId, notes }: { storeId: string; notes: Note[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');

  const add = () =>
    startTransition(async () => {
      try {
        await addSupportNote({ storeId, body });
        setBody('');
        router.refresh();
      } catch (e) { toast(e instanceof Error ? e.message : '追加に失敗しました', 'error'); }
    });

  const remove = (noteId: string) =>
    startTransition(async () => {
      try { await deleteSupportNote({ storeId, noteId }); router.refresh(); }
      catch (e) { toast(e instanceof Error ? e.message : '削除に失敗しました', 'error'); }
    });

  return (
    <Card>
      <CardHeader><CardTitle>サポートメモ（CYPRESS内部のみ）</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="例：プリンター型番確認待ち／8/15オーナー確認予定（※個人情報・パスワードは書かない）"
          />
          <Button size="sm" onClick={add} disabled={pending || !body.trim()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}追加
          </Button>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-gray-500">メモはありません。</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-navy">{n.body}</p>
                  <button type="button" disabled={pending} onClick={() => remove(n.id)} className="shrink-0 rounded p-1 text-gray-400 hover:text-danger disabled:opacity-50" title="削除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">{n.authorName}・{new Date(n.createdAt).toLocaleString('ja-JP')}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">※ 個人情報・パスワード・秘密情報は記載しない運用です。</p>
      </CardContent>
    </Card>
  );
}
