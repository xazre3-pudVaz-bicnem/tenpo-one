'use client';

import { useState, useTransition } from 'react';
import { Check, Eye, EyeOff, Pencil, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

/**
 * レジ（iPad）のログイン情報（運営だけが見る）。
 * 企業番号は会社で1つ、レジ用パスワードは店舗ごと。
 * 「表示」で今のパスワードを出し、「作り直す」で新しいものを発行する。
 * 作り直すと、その店舗のレジは入り直しになる。
 */
export function StoreRegisterPassword({
  storeId,
  orgCode,
  storeUser,
  compact = false,
  revealAction,
  reissueAction,
  renameAction,
}: {
  storeId: string;
  orgCode?: string | null;
  storeUser?: string | null;
  compact?: boolean;
  renameAction?: (input: { storeId: string; username: string }) => Promise<{ username?: string; error?: string }>;
  revealAction: (input: { storeId: string }) => Promise<{ password?: string; updatedAt?: string | null; notSet?: boolean; error?: string }>;
  reissueAction: (input: { storeId: string }) => Promise<{ password?: string; error?: string }>;
}) {
  const { toast } = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const [user, setUser] = useState(storeUser ?? '');
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const rename = () =>
    startTransition(async () => {
      if (!renameAction) return;
      const r = await renameAction({ storeId, username: user });
      if (r.error) toast(r.error, 'error');
      else {
        setUser(r.username ?? user);
        setEditing(false);
        toast('店舗ユーザー名を保存しました');
      }
    });

  const reveal = () => {
    if (shown) {
      setShown(null);
      return;
    }
    startTransition(async () => {
      const r = await revealAction({ storeId });
      if (r.error) toast(r.error, 'error');
      else if (r.notSet) toast('この店舗にはレジ用パスワードがまだありません。「作り直す」で発行してください', 'error');
      else setShown(r.password ?? null);
    });
  };

  const reissue = () => {
    startTransition(async () => {
      const r = await reissueAction({ storeId });
      if (r.error) toast(r.error, 'error');
      else {
        setShown(r.password ?? null);
        toast('レジ用パスワードを作り直しました。今のレジは入り直しになります');
      }
    });
  };

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-2'}>
      {orgCode !== undefined && (
        <span className="text-xs text-gray-500">
          企業番号 <span className="font-mono text-sm text-navy">{orgCode ?? '（未発行）'}</span>
        </span>
      )}
      {storeUser !== undefined &&
        (editing ? (
          <span className="flex items-center gap-1">
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value.replace(/[^A-Za-z0-9-]/g, '').toLowerCase().slice(0, 32))}
              className="h-8 w-44 font-mono text-sm"
              placeholder="ronnies-house"
            />
            <Button size="sm" variant="ghost" onClick={rename} disabled={pending}>
              <Check className="h-3.5 w-3.5" />
              保存
            </Button>
          </span>
        ) : (
          <span className="text-xs text-gray-500">
            店舗ユーザー名 <span className="font-mono text-sm text-navy">{user || '（未設定）'}</span>
            {renameAction && (
              <button type="button" onClick={() => setEditing(true)} className="ml-1 text-gray-400 hover:text-primary" aria-label="店舗ユーザー名を変更">
                <Pencil className="inline h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      <span className="rounded-lg bg-surface px-2 py-1 font-mono text-sm text-navy">{shown ?? '••••••••'}</span>
      <Button size="sm" variant="ghost" onClick={reveal} disabled={pending}>
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {shown ? '隠す' : '表示'}
      </Button>
      <Button size="sm" variant="secondary" onClick={reissue} disabled={pending}>
        <RefreshCw className="h-3.5 w-3.5" />
        作り直す
      </Button>
    </div>
  );
}
