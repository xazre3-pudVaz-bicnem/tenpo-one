'use client';

import { useState, useTransition } from 'react';
import { Copy, Check } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/input';
import { resetMemberPassword } from '@/app/app/staff/actions';
import { useToast } from '@/components/ui/toast';

/**
 * スタッフのログインパスワードを再発行するダイアログ。
 * 招待時の初期パスワードを忘れた／取りこぼした場合に、新パスワードを再生成して本人へ手渡すための導線。
 * 新パスワードは再発行時に一度だけ画面表示する（メール送信は行わない）。
 */
export function PasswordDialog({
  membershipId,
  profileId,
  displayName,
  onClose,
}: {
  membershipId: string;
  profileId: string;
  displayName: string;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleReset = () => {
    setError(null);
    startTransition(async () => {
      const result = await resetMemberPassword({ membershipId, profileId });
      if (result.error) {
        setError(result.error);
        return;
      }
      setNewPassword(result.newPassword ?? '');
      toast('パスワードを再発行しました');
    });
  };

  const handleCopy = async () => {
    try {
      if (!newPassword) return;
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードAPI非対応環境は無視
    }
  };

  if (newPassword) {
    return (
      <Dialog open onClose={onClose} title="パスワードを再発行しました">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            <span className="font-semibold text-navy">{displayName}</span> 様の新しいログインパスワードです。
          </p>
          <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
            <p className="text-xs font-medium text-primary-deep">
              新パスワード: <span className="font-mono text-sm">{newPassword}</span> を本人に安全な方法で伝えてください
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'コピーしました' : 'パスワードをコピー'}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            このパスワードは今だけ表示されます。閉じると再表示できません（必要な場合は再度発行してください）。
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>閉じる</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="パスワードを再発行">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          <span className="font-semibold text-navy">{displayName}</span> 様のログインパスワードを新しく発行します。
        </p>
        <p className="text-xs text-gray-500">
          現在のパスワードは無効になります。新パスワードは発行後にこの画面で一度だけ表示されるので、本人へ安全な方法で伝えてください（メールは送信されません）。
        </p>
        <FieldError message={error ?? undefined} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleReset} disabled={pending}>
            {pending ? '発行中…' : '再発行する'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
